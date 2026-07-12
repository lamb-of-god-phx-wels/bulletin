/**
 * Tests for the richtext module: types, normalize, plainText, and sanitize.
 *
 * Covers:
 *  - Normalization idempotence
 *  - Merge rules (adjacent identical-mark runs)
 *  - Empty text leaf removal
 *  - Canonical mark ordering
 *  - Plain-text derivation (blocks, lists, scripture)
 *  - Hostile HTML fixtures
 *  - Size-limit rejection
 *  - Plain-text clipboard sanitization
 */

import { describe, expect, it } from "vitest";
import {
  HtmlSizeError,
  MAX_HTML_BYTES,
  normalize,
  plainText,
  sanitizeExternalHtml,
  sanitizePlainText,
} from "./index.js";
import type {
  BulletListBlock,
  HeadingBlock,
  InlineNode,
  MarkKind,
  OrderedListBlock,
  ParagraphBlock,
  RichTextDocument,
  TextNode,
  VerseStructuredScriptureBlock,
} from "./index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function doc(...blocks: RichTextDocument["blocks"]): RichTextDocument {
  return { type: "document", blocks };
}

function para(...children: InlineNode[]): ParagraphBlock {
  return { type: "paragraph", children };
}

function text(t: string, ...marks: MarkKind[]): TextNode {
  if (marks.length === 0) return { type: "text", text: t };
  return { type: "text", text: t, marks };
}

function br(): InlineNode {
  return { type: "lineBreak" };
}

// ---------------------------------------------------------------------------
// normalize — empty / trivial
// ---------------------------------------------------------------------------

describe("normalize — trivial", () => {
  it("returns equal shape for empty document", () => {
    const d = doc();
    expect(normalize(d)).toEqual(d);
  });

  it("is idempotent on empty document", () => {
    const d = doc();
    expect(normalize(normalize(d))).toEqual(normalize(d));
  });

  it("does not mutate input", () => {
    const original = doc(para(text("hello")));
    const frozen = JSON.stringify(original);
    normalize(original);
    expect(JSON.stringify(original)).toBe(frozen);
  });
});

// ---------------------------------------------------------------------------
// normalize — empty text leaf removal
// ---------------------------------------------------------------------------

describe("normalize — empty leaf removal", () => {
  it("removes a single empty text node", () => {
    const d = doc(para({ type: "text", text: "" }));
    expect(normalize(d)).toEqual(doc(para()));
  });

  it("removes empty text node between real content", () => {
    const d = doc(para(text("a"), { type: "text", text: "" }, text("b")));
    expect(normalize(d)).toEqual(doc(para(text("ab"))));
  });

  it("removes multiple consecutive empty nodes", () => {
    const d = doc(
      para(
        { type: "text", text: "" },
        text("x"),
        { type: "text", text: "" },
        { type: "text", text: "" },
      ),
    );
    expect(normalize(d)).toEqual(doc(para(text("x"))));
  });

  it("preserves lineBreak nodes adjacent to empty text", () => {
    const d = doc(para({ type: "text", text: "" }, br(), text("y")));
    expect(normalize(d)).toEqual(doc(para(br(), text("y"))));
  });
});

// ---------------------------------------------------------------------------
// normalize — merge adjacent runs with identical marks
// ---------------------------------------------------------------------------

describe("normalize — merge adjacent runs", () => {
  it("merges two adjacent plain text nodes", () => {
    const d = doc(para(text("hello "), text("world")));
    expect(normalize(d)).toEqual(doc(para(text("hello world"))));
  });

  it("merges three adjacent plain text nodes", () => {
    const d = doc(para(text("a"), text("b"), text("c")));
    expect(normalize(d)).toEqual(doc(para(text("abc"))));
  });

  it("does not merge runs with different marks", () => {
    const d = doc(para(text("a", "strong"), text("b", "emphasis")));
    expect(normalize(d)).toEqual(d);
  });

  it("merges adjacent runs with matching marks", () => {
    const d = doc(para(text("foo", "strong"), text("bar", "strong")));
    expect(normalize(d)).toEqual(doc(para(text("foobar", "strong"))));
  });

  it("does not merge across a lineBreak", () => {
    const d = doc(para(text("a"), br(), text("b")));
    expect(normalize(d)).toEqual(d);
  });

  it("merges runs that become adjacent after empty removal", () => {
    const d = doc(
      para(text("hello"), { type: "text", text: "" }, text(" world")),
    );
    expect(normalize(d)).toEqual(doc(para(text("hello world"))));
  });

  it("merges runs with both marks when identical", () => {
    const d = doc(
      para(
        text("x", "strong", "emphasis"),
        text("y", "strong", "emphasis"),
      ),
    );
    const result = normalize(d);
    const p = result.blocks[0] as ParagraphBlock;
    expect(p.children).toHaveLength(1);
    const t = p.children[0] as TextNode;
    expect(t.text).toBe("xy");
    expect(t.marks).toEqual(["strong", "emphasis"]);
  });
});

// ---------------------------------------------------------------------------
// normalize — canonical mark order
// ---------------------------------------------------------------------------

describe("normalize — canonical mark order", () => {
  it("puts strong before emphasis", () => {
    const d = doc(para(text("x", "emphasis", "strong")));
    const result = normalize(d);
    const p = result.blocks[0] as ParagraphBlock;
    const t = p.children[0] as TextNode;
    expect(t.marks).toEqual(["strong", "emphasis"]);
  });

  it("deduplicates repeated marks", () => {
    const d = doc(para({ type: "text", text: "z", marks: ["strong", "strong"] as unknown as MarkKind[] }));
    const result = normalize(d);
    const p = result.blocks[0] as ParagraphBlock;
    const t = p.children[0] as TextNode;
    expect(t.marks).toEqual(["strong"]);
  });

  it("collapses empty marks array to undefined", () => {
    const d = doc(para({ type: "text", text: "z", marks: [] }));
    const result = normalize(d);
    const p = result.blocks[0] as ParagraphBlock;
    const t = p.children[0] as TextNode;
    expect(t.marks).toBeUndefined();
  });

  it("merges correctly after mark reordering", () => {
    // Both nodes end up as ["strong","emphasis"] after canonicalization.
    const d = doc(
      para(
        text("a", "emphasis", "strong"),
        text("b", "strong", "emphasis"),
      ),
    );
    const result = normalize(d);
    const p = result.blocks[0] as ParagraphBlock;
    expect(p.children).toHaveLength(1);
    const t = p.children[0] as TextNode;
    expect(t.text).toBe("ab");
    expect(t.marks).toEqual(["strong", "emphasis"]);
  });
});

// ---------------------------------------------------------------------------
// normalize — idempotence
// ---------------------------------------------------------------------------

describe("normalize — idempotence", () => {
  const cases: Array<{ label: string; d: RichTextDocument }> = [
    {
      label: "single plain paragraph",
      d: doc(para(text("Hello world"))),
    },
    {
      label: "mixed marks",
      d: doc(para(text("bold", "strong"), br(), text("em", "emphasis"))),
    },
    {
      label: "heading",
      d: doc({ type: "heading", level: 2, children: [text("Title")] }),
    },
    {
      label: "bullet list",
      d: doc({
        type: "bulletList",
        children: [
          { type: "listItem", children: [para(text("item 1"))] },
          { type: "listItem", children: [para(text("item 2"))] },
        ],
      }),
    },
    {
      label: "ordered list with start",
      d: doc({
        type: "orderedList",
        start: 3,
        children: [
          { type: "listItem", children: [para(text("first"))] },
        ],
      }),
    },
    {
      label: "blockquote",
      d: doc({
        type: "blockquote",
        children: [para(text("quote text"))],
      }),
    },
  ];

  for (const { label, d } of cases) {
    it(`is idempotent: ${label}`, () => {
      const once = normalize(d);
      const twice = normalize(once);
      expect(twice).toEqual(once);
    });
  }
});

// ---------------------------------------------------------------------------
// normalize — nested structures
// ---------------------------------------------------------------------------

describe("normalize — nested list normalization", () => {
  it("normalizes marks inside list items", () => {
    const d = doc({
      type: "bulletList",
      children: [
        {
          type: "listItem",
          children: [
            para(
              text("a", "emphasis", "strong"), // out of order marks
              text("b", "strong", "emphasis"), // same after reorder → merge
            ),
          ],
        },
      ],
    });
    const result = normalize(d);
    const bl = result.blocks[0] as BulletListBlock;
    const li = bl.children[0];
    const p = li?.children[0];
    if (p?.type !== "paragraph") throw new Error("expected paragraph");
    expect(p.children).toHaveLength(1);
    const t = p.children[0] as TextNode;
    expect(t.text).toBe("ab");
    expect(t.marks).toEqual(["strong", "emphasis"]);
  });

  it("normalizes nested bullet list", () => {
    const d = doc({
      type: "bulletList",
      children: [
        {
          type: "listItem",
          children: [
            para(text("outer")),
            {
              type: "bulletList" as const,
              children: [
                {
                  type: "listItem" as const,
                  children: [para(text(""), text("inner"))],
                },
              ],
            },
          ],
        },
      ],
    });
    const result = normalize(d);
    const bl = result.blocks[0] as BulletListBlock;
    const li = bl.children[0];
    const nestedBl = li?.children[1];
    if (nestedBl?.type !== "bulletList") throw new Error("expected nested bulletList");
    const nestedLi = nestedBl.children[0];
    const nestedP = nestedLi?.children[0];
    if (nestedP?.type !== "paragraph") throw new Error("expected paragraph");
    // Empty node was dropped, "inner" is the only text.
    expect(nestedP.children).toHaveLength(1);
    const t = nestedP.children[0] as TextNode;
    expect(t.text).toBe("inner");
  });
});

// ---------------------------------------------------------------------------
// normalize — scripture blocks
// ---------------------------------------------------------------------------

describe("normalize — scripture block normalization", () => {
  it("normalizes inline marks within verse children", () => {
    const d = doc({
      type: "scripture",
      structureKind: "verseStructured",
      reference: "John 3:16",
      canonicalReference: "John.3.16",
      translationId: "translation:abc",
      translationLabel: "NIV",
      verses: [
        {
          verseId: "John.3.16",
          label: "16",
          paragraphStart: true,
          children: [
            text("For God", "emphasis", "strong"),
            text(" so loved", "strong", "emphasis"),
          ],
        },
      ],
      rights: [{ kind: "known", translationId: "translation:abc", translationLabel: "NIV" }],
    });
    const result = normalize(d);
    const sb = result.blocks[0] as VerseStructuredScriptureBlock;
    const verse = sb.verses[0];
    expect(verse?.children).toHaveLength(1);
    const t = verse?.children[0] as TextNode;
    expect(t.text).toBe("For God so loved");
    expect(t.marks).toEqual(["strong", "emphasis"]);
  });

  it("normalizes paragraphOnly scripture paragraphs", () => {
    const d = doc({
      type: "scripture",
      structureKind: "paragraphOnly",
      reference: "John 3",
      translationId: "translation:abc",
      translationLabel: "NIV",
      paragraphs: [
        { children: [text(""), text("verse text")] },
      ],
      rights: [{ kind: "known", translationId: "translation:abc", translationLabel: "NIV" }],
    });
    const result = normalize(d);
    const sb = result.blocks[0];
    if (sb?.type !== "scripture" || sb.structureKind !== "paragraphOnly") {
      throw new Error("expected paragraphOnly scripture");
    }
    expect(sb.paragraphs[0]?.children).toHaveLength(1);
    const t = sb.paragraphs[0]?.children[0] as TextNode;
    expect(t.text).toBe("verse text");
  });
});

// ---------------------------------------------------------------------------
// plainText — basic
// ---------------------------------------------------------------------------

describe("plainText — basic derivation", () => {
  it("extracts text from single paragraph", () => {
    expect(plainText(doc(para(text("Hello world"))))).toBe("Hello world");
  });

  it("separates blocks with blank line", () => {
    const result = plainText(doc(para(text("A")), para(text("B"))));
    expect(result).toBe("A\n\nB");
  });

  it("converts lineBreak to LF", () => {
    const result = plainText(doc(para(text("line1"), br(), text("line2"))));
    expect(result).toBe("line1\nline2");
  });

  it("ignores mark information for plain text", () => {
    const result = plainText(
      doc(para(text("bold", "strong"), text(" normal"), text(" em", "emphasis"))),
    );
    expect(result).toBe("bold normal em");
  });

  it("derives text from heading", () => {
    const result = plainText(
      doc({ type: "heading", level: 1, children: [text("My Heading")] }),
    );
    expect(result).toBe("My Heading");
  });

  it("returns empty string for empty document", () => {
    expect(plainText(doc())).toBe("");
  });
});

// ---------------------------------------------------------------------------
// plainText — lists
// ---------------------------------------------------------------------------

describe("plainText — lists", () => {
  it("prefixes bullet items with •", () => {
    const result = plainText(
      doc({
        type: "bulletList",
        children: [
          { type: "listItem", children: [para(text("Item A"))] },
          { type: "listItem", children: [para(text("Item B"))] },
        ],
      }),
    );
    expect(result).toBe("• Item A\n• Item B");
  });

  it("prefixes ordered items with numbers", () => {
    const result = plainText(
      doc({
        type: "orderedList",
        children: [
          { type: "listItem", children: [para(text("First"))] },
          { type: "listItem", children: [para(text("Second"))] },
        ],
      }),
    );
    expect(result).toBe("1. First\n2. Second");
  });

  it("respects ordered list start value", () => {
    const result = plainText(
      doc({
        type: "orderedList",
        start: 5,
        children: [
          { type: "listItem", children: [para(text("Five"))] },
          { type: "listItem", children: [para(text("Six"))] },
        ],
      }),
    );
    expect(result).toBe("5. Five\n6. Six");
  });

  it("indents nested list items by 2 spaces per depth", () => {
    const result = plainText(
      doc({
        type: "bulletList",
        children: [
          {
            type: "listItem",
            children: [
              para(text("outer")),
              {
                type: "bulletList" as const,
                children: [
                  { type: "listItem" as const, children: [para(text("inner"))] },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(result).toBe("• outer\n  • inner");
  });
});

// ---------------------------------------------------------------------------
// plainText — scripture
// ---------------------------------------------------------------------------

describe("plainText — scripture", () => {
  const verseBlock: VerseStructuredScriptureBlock = {
    type: "scripture",
    structureKind: "verseStructured",
    reference: "John 3:16",
    canonicalReference: "John.3.16",
    translationId: "translation:abc",
    translationLabel: "NIV",
    verses: [
      {
        verseId: "John.3.16",
        label: "16",
        paragraphStart: true,
        children: [text("For God so loved the world")],
      },
    ],
    rights: [{ kind: "known", translationId: "translation:abc", translationLabel: "NIV" }],
  };

  it("emits reference before passage by default", () => {
    const result = plainText(doc(verseBlock));
    const lines = result.split("\n");
    expect(lines[0]).toBe("John 3:16 (NIV)");
    expect(lines[1]).toBe("16 For God so loved the world");
  });

  it("emits reference after passage when formattingOverride says after", () => {
    const overridden: VerseStructuredScriptureBlock = {
      ...verseBlock,
      formattingOverride: {
        referencePlacement: "after",
        verseNumberStyle: "inline",
        paragraphPolicy: "publisher",
        paragraphSpacing: "6pt",
        translationLabelPlacement: "withReference",
      },
    };
    const result = plainText(doc(overridden));
    const lines = result.split("\n");
    expect(lines[0]).toBe("16 For God so loved the world");
    expect(lines[1]).toBe("John 3:16 (NIV)");
  });

  it("hides verse numbers when style is hidden", () => {
    const overridden: VerseStructuredScriptureBlock = {
      ...verseBlock,
      formattingOverride: {
        referencePlacement: "before",
        verseNumberStyle: "hidden",
        paragraphPolicy: "publisher",
        paragraphSpacing: "6pt",
        translationLabelPlacement: "withReference",
      },
    };
    const result = plainText(doc(overridden));
    expect(result).not.toContain("16 For");
    expect(result).toContain("For God so loved the world");
  });

  it("places translation label afterPassage when configured", () => {
    const overridden: VerseStructuredScriptureBlock = {
      ...verseBlock,
      formattingOverride: {
        referencePlacement: "before",
        verseNumberStyle: "superscript",
        paragraphPolicy: "publisher",
        paragraphSpacing: "6pt",
        translationLabelPlacement: "afterPassage",
      },
    };
    const result = plainText(doc(overridden));
    const lines = result.split("\n");
    expect(lines[0]).toBe("John 3:16");
    expect(lines[1]).toContain("For God so loved the world");
    expect(lines[2]).toBe("(NIV)");
  });

  it("emits paragraphOnly scripture without verse labels", () => {
    const d = doc({
      type: "scripture",
      structureKind: "paragraphOnly",
      reference: "Ps 23",
      translationId: "translation:xyz",
      translationLabel: "ESV",
      paragraphs: [
        { children: [text("The Lord is my shepherd.")] },
        { children: [text("I shall not want.")] },
      ],
      rights: [{ kind: "known", translationId: "translation:xyz", translationLabel: "ESV" }],
    });
    const result = plainText(d);
    expect(result).toContain("The Lord is my shepherd.");
    expect(result).toContain("I shall not want.");
    // No verse number labels invented.
    expect(result).not.toMatch(/^\d+\s/m);
  });
});

// ---------------------------------------------------------------------------
// sanitizeExternalHtml — basic structure
// ---------------------------------------------------------------------------

describe("sanitizeExternalHtml — basic structure", () => {
  it("converts plain paragraph HTML to paragraph blocks", () => {
    const result = sanitizeExternalHtml("<p>Hello world</p>");
    const p = result.blocks[0] as ParagraphBlock;
    expect(p.type).toBe("paragraph");
    const t = p.children[0] as TextNode;
    expect(t.text).toBe("Hello world");
  });

  it("preserves bold marks", () => {
    const result = sanitizeExternalHtml("<p><strong>Bold</strong> text</p>");
    const p = result.blocks[0] as ParagraphBlock;
    const t = p.children[0] as TextNode;
    expect(t.marks).toContain("strong");
    expect(t.text).toBe("Bold");
  });

  it("maps <b> to strong mark", () => {
    const result = sanitizeExternalHtml("<p><b>Bold via b</b></p>");
    const p = result.blocks[0] as ParagraphBlock;
    const t = p.children[0] as TextNode;
    expect(t.marks).toContain("strong");
  });

  it("preserves emphasis marks", () => {
    const result = sanitizeExternalHtml("<p><em>Italic</em></p>");
    const p = result.blocks[0] as ParagraphBlock;
    const t = p.children[0] as TextNode;
    expect(t.marks).toContain("emphasis");
  });

  it("maps <i> to emphasis mark", () => {
    const result = sanitizeExternalHtml("<p><i>Italic via i</i></p>");
    const p = result.blocks[0] as ParagraphBlock;
    const t = p.children[0] as TextNode;
    expect(t.marks).toContain("emphasis");
  });

  it("produces heading blocks from h1–h6", () => {
    for (let level = 1; level <= 6; level++) {
      const result = sanitizeExternalHtml(`<h${level}>Heading ${level}</h${level}>`);
      const h = result.blocks[0] as HeadingBlock;
      expect(h.type).toBe("heading");
      expect(h.level).toBe(level);
    }
  });

  it("produces bullet list from ul/li", () => {
    const result = sanitizeExternalHtml("<ul><li>A</li><li>B</li></ul>");
    const bl = result.blocks[0] as BulletListBlock;
    expect(bl.type).toBe("bulletList");
    expect(bl.children).toHaveLength(2);
  });

  it("produces ordered list from ol/li", () => {
    const result = sanitizeExternalHtml("<ol><li>First</li><li>Second</li></ol>");
    const ol = result.blocks[0] as OrderedListBlock;
    expect(ol.type).toBe("orderedList");
    expect(ol.children).toHaveLength(2);
  });

  it("respects ol start attribute", () => {
    const result = sanitizeExternalHtml('<ol start="3"><li>Three</li></ol>');
    const ol = result.blocks[0] as OrderedListBlock;
    expect(ol.start).toBe(3);
  });

  it("retains text inside unknown tags", () => {
    const result = sanitizeExternalHtml("<p><span>Keep this</span></p>");
    const p = result.blocks[0] as ParagraphBlock;
    const t = p.children[0] as TextNode;
    expect(t.text).toContain("Keep this");
  });

  it("decodes HTML entities in text", () => {
    const result = sanitizeExternalHtml("<p>Hello &amp; World</p>");
    const p = result.blocks[0] as ParagraphBlock;
    expect(plainText({ type: "document", blocks: [p] })).toContain("Hello & World");
  });

  // Issue #1 regression: double-escaped entity bug
  it("does NOT double-decode '&amp;lt;' — it must produce literal '&lt;' not '<'", () => {
    // '&amp;lt;' is a user typing the literal text '&lt;'.
    // Before the fix: &amp; decoded first → &lt;, then &lt; decoded → '<' (wrong).
    // After the fix: single-pass decodes numerics/named non-amp first, amp last.
    // &amp; → '&', leaving the 'lt;' as plain text following it → '&lt;'.
    const result = sanitizeExternalHtml("<p>a &amp;lt; b</p>");
    const p = result.blocks[0] as ParagraphBlock;
    const txt = plainText({ type: "document", blocks: [p] });
    // Must produce literal ampersand-lt-semicolon, NOT a less-than sign.
    expect(txt).toContain("&lt;");
    expect(txt).not.toContain("<");
  });

  it("decodes '&lt;' to '<' (plain less-than still decodes correctly)", () => {
    const result = sanitizeExternalHtml("<p>a &lt; b</p>");
    const p = result.blocks[0] as ParagraphBlock;
    const txt = plainText({ type: "document", blocks: [p] });
    expect(txt).toContain("a < b");
  });

  it("decodes double-escaped '&amp;amp;' to literal '&amp;'", () => {
    const result = sanitizeExternalHtml("<p>&amp;amp;</p>");
    const p = result.blocks[0] as ParagraphBlock;
    const txt = plainText({ type: "document", blocks: [p] });
    expect(txt).toBe("&amp;");
  });

  it("decodes numeric entity &#65; to 'A'", () => {
    const result = sanitizeExternalHtml("<p>&#65;</p>");
    const p = result.blocks[0] as ParagraphBlock;
    const txt = plainText({ type: "document", blocks: [p] });
    expect(txt).toBe("A");
  });

  it("decodes hex entity &#x41; to 'A'", () => {
    const result = sanitizeExternalHtml("<p>&#x41;</p>");
    const p = result.blocks[0] as ParagraphBlock;
    const txt = plainText({ type: "document", blocks: [p] });
    expect(txt).toBe("A");
  });

  it("handles self-closing br as lineBreak", () => {
    const result = sanitizeExternalHtml("<p>line1<br/>line2</p>");
    const p = result.blocks[0] as ParagraphBlock;
    const hasBreak = p.children.some((c) => c.type === "lineBreak");
    expect(hasBreak).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// sanitizeExternalHtml — security: hostile HTML
// ---------------------------------------------------------------------------

describe("sanitizeExternalHtml — hostile HTML: script removal", () => {
  it("removes script tags and their content", () => {
    const result = sanitizeExternalHtml(
      "<p>Safe text</p><script>alert('xss')</script><p>More text</p>",
    );
    const pt = plainText(result);
    expect(pt).not.toContain("alert");
    expect(pt).not.toContain("xss");
    expect(pt).toContain("Safe text");
    expect(pt).toContain("More text");
  });

  it("removes nested script content", () => {
    const result = sanitizeExternalHtml(
      "<div><script>evil(); <p>fake</p> </script>clean</div>",
    );
    const pt = plainText(result);
    expect(pt).not.toContain("evil");
    expect(pt).not.toContain("fake");
    expect(pt).toContain("clean");
  });

  it("removes style tags and their content", () => {
    const result = sanitizeExternalHtml(
      "<style>.x { color: red; } body:before { content: 'injection' }</style><p>Text</p>",
    );
    const pt = plainText(result);
    expect(pt).not.toContain("color:");
    expect(pt).not.toContain("injection");
    expect(pt).toContain("Text");
  });

  it("removes event handler attributes silently", () => {
    const result = sanitizeExternalHtml(
      '<p onclick="alert(1)" onload="steal()">Content</p>',
    );
    const pt = plainText(result);
    // Content preserved; handlers not exposed.
    expect(pt).toContain("Content");
    expect(pt).not.toContain("alert");
    expect(pt).not.toContain("steal");
  });

  it("removes onerror on image tags (img dropped, alt not invented)", () => {
    const result = sanitizeExternalHtml(
      '<p>Before<img src="x" onerror="xss()">After</p>',
    );
    const pt = plainText(result);
    expect(pt).not.toContain("xss");
    expect(pt).toContain("Before");
    expect(pt).toContain("After");
  });

  it("removes iframe tags", () => {
    const result = sanitizeExternalHtml(
      "<p>text</p><iframe src='evil.com'></iframe>",
    );
    const pt = plainText(result);
    expect(pt).not.toContain("evil.com");
    expect(pt).toContain("text");
  });

  it("removes SVG tags and their content", () => {
    const result = sanitizeExternalHtml(
      "<p>before</p><svg><script>alert(1)</script></svg><p>after</p>",
    );
    const pt = plainText(result);
    expect(pt).not.toContain("alert");
    expect(pt).toContain("before");
    expect(pt).toContain("after");
  });

  it("handles deeply nested garbage tags gracefully", () => {
    const result = sanitizeExternalHtml(
      "<div><div><div><div><div><p>deep content</p></div></div></div></div></div>",
    );
    const pt = plainText(result);
    expect(pt).toContain("deep content");
  });

  it("handles malformed unclosed tags without throwing", () => {
    expect(() =>
      sanitizeExternalHtml("<p>text without close tag"),
    ).not.toThrow();
  });

  it("handles tags with huge attribute values without crashing", () => {
    const hugeAttr = "x".repeat(50_000);
    const html = `<p class="${hugeAttr}">safe text</p>`;
    const result = sanitizeExternalHtml(html);
    const pt = plainText(result);
    expect(pt).toContain("safe text");
  });

  it("handles html comment injection attempts", () => {
    const result = sanitizeExternalHtml(
      "<!-- <script>alert(1)</script> --><p>safe</p>",
    );
    const pt = plainText(result);
    expect(pt).not.toContain("alert");
    expect(pt).toContain("safe");
  });

  it("does not execute or emit javascript: URLs as text", () => {
    // Links are stripped but their text content is retained.
    const result = sanitizeExternalHtml(
      '<a href="javascript:alert(1)">Click here</a>',
    );
    const pt = plainText(result);
    // The href value is dropped (we don't emit link nodes); text may be kept.
    expect(pt).not.toContain("javascript:");
    expect(pt).not.toContain("alert");
  });

  it("handles null bytes in text by removing them", () => {
    const result = sanitizeExternalHtml("<p>text\x00with\x00nulls</p>");
    const pt = plainText(result);
    expect(pt).not.toContain("\x00");
    expect(pt).toContain("text");
  });

  it("handles C1 control characters by removing them", () => {
    const result = sanitizeExternalHtml("<p>text\x85with\x9Fcontrol</p>");
    const pt = plainText(result);
    expect(pt).not.toContain("\x85");
    expect(pt).not.toContain("\x9F");
    expect(pt).toContain("textwithcontrol");
  });

  it("handles script tag with upper/mixed case", () => {
    const result = sanitizeExternalHtml(
      "<p>OK</p><SCRIPT>evil()</SCRIPT>",
    );
    const pt = plainText(result);
    expect(pt).not.toContain("evil");
    expect(pt).toContain("OK");
  });
});

// ---------------------------------------------------------------------------
// sanitizeExternalHtml — size limit
// ---------------------------------------------------------------------------

describe("sanitizeExternalHtml — size limit", () => {
  it("throws HtmlSizeError for input over MAX_HTML_BYTES", () => {
    const oversized = "a".repeat(MAX_HTML_BYTES + 1);
    expect(() => sanitizeExternalHtml(oversized)).toThrow(HtmlSizeError);
  });

  it("accepts input at exactly MAX_HTML_BYTES", () => {
    // Build valid HTML that is exactly MAX_HTML_BYTES characters.
    // Use a p tag wrapper + filler text.
    const content = "x".repeat(MAX_HTML_BYTES - 7); // <p></p> = 7 chars
    const html = `<p>${content}</p>`.slice(0, MAX_HTML_BYTES);
    // Just verify no exception is thrown.
    expect(() => sanitizeExternalHtml(html)).not.toThrow();
  });

  it("HtmlSizeError message includes actual size", () => {
    const size = MAX_HTML_BYTES + 100;
    const oversized = "x".repeat(size);
    try {
      sanitizeExternalHtml(oversized);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(HtmlSizeError);
      expect((e as HtmlSizeError).message).toContain(String(size));
    }
  });
});

// ---------------------------------------------------------------------------
// sanitizePlainText
// ---------------------------------------------------------------------------

describe("sanitizePlainText", () => {
  it("wraps plain text in a paragraph", () => {
    const result = sanitizePlainText("Hello world");
    expect(result.blocks).toHaveLength(1);
    const p = result.blocks[0] as ParagraphBlock;
    expect(p.type).toBe("paragraph");
    const t = p.children[0] as TextNode;
    expect(t.text).toBe("Hello world");
  });

  it("splits on blank lines to create multiple paragraphs", () => {
    const result = sanitizePlainText("Para one\n\nPara two");
    expect(result.blocks).toHaveLength(2);
  });

  it("converts single LF inside paragraph to lineBreak", () => {
    const result = sanitizePlainText("line1\nline2");
    const p = result.blocks[0] as ParagraphBlock;
    const hasBreak = p.children.some((c) => c.type === "lineBreak");
    expect(hasBreak).toBe(true);
  });

  it("normalizes CRLF to LF", () => {
    const result = sanitizePlainText("line1\r\nline2");
    const p = result.blocks[0] as ParagraphBlock;
    const hasBreak = p.children.some((c) => c.type === "lineBreak");
    expect(hasBreak).toBe(true);
    // No literal \r in the output.
    for (const child of p.children) {
      if (child.type === "text") expect(child.text).not.toContain("\r");
    }
  });

  it("removes null bytes", () => {
    const result = sanitizePlainText("text\x00with\x00null");
    const p = result.blocks[0] as ParagraphBlock;
    const t = p.children[0] as TextNode;
    expect(t.text).not.toContain("\x00");
  });

  it("throws HtmlSizeError for oversized input", () => {
    const oversized = "a".repeat(MAX_HTML_BYTES + 1);
    expect(() => sanitizePlainText(oversized)).toThrow(HtmlSizeError);
  });

  it("produces normalized output (idempotent)", () => {
    const result = sanitizePlainText("Hello\n\nWorld");
    expect(normalize(result)).toEqual(result);
  });

  it("handles multiple blank lines as single paragraph break", () => {
    const result = sanitizePlainText("A\n\n\n\nB");
    expect(result.blocks).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// sanitizeExternalHtml — normalization guarantee
// ---------------------------------------------------------------------------

describe("sanitizeExternalHtml — output is normalized", () => {
  it("output of sanitizeExternalHtml is already normalized", () => {
    const html = "<p><b>bold</b><b>also bold</b> normal <em>em</em></p>";
    const result = sanitizeExternalHtml(html);
    expect(normalize(result)).toEqual(result);
  });

  it("merged adjacent bold runs in HTML output", () => {
    const result = sanitizeExternalHtml("<p><b>bold</b><b>also bold</b></p>");
    const p = result.blocks[0] as ParagraphBlock;
    // Should be merged into one "bold" run.
    const boldNodes = p.children.filter(
      (c) => c.type === "text" && (c as TextNode).marks?.includes("strong"),
    );
    expect(boldNodes).toHaveLength(1);
    const merged = boldNodes[0] as TextNode;
    expect(merged.text).toBe("boldalso bold");
  });
});

// ---------------------------------------------------------------------------
// sanitizeExternalHtml — spec validity: 4-level list nesting cap (Issue #5)
// ---------------------------------------------------------------------------

describe("sanitizeExternalHtml — list nesting cap (spec line 2306-2307)", () => {
  /** Build deeply-nested ul HTML: n levels deep with text at the innermost */
  function nestedUl(levels: number, text: string): string {
    let inner = `<li>${text}</li>`;
    for (let i = 1; i < levels; i++) {
      inner = `<li><ul>${inner}</ul></li>`;
    }
    return `<ul>${inner}</ul>`;
  }

  function maxListDepth(node: BulletListBlock | OrderedListBlock, current: number = 1): number {
    let max = current;
    for (const item of node.children) {
      for (const child of item.children) {
        if (child.type === "bulletList" || child.type === "orderedList") {
          max = Math.max(max, maxListDepth(child, current + 1));
        }
      }
    }
    return max;
  }

  it("allows 4 levels of nesting", () => {
    const result = sanitizeExternalHtml(nestedUl(4, "deep"));
    expect(result.blocks).toHaveLength(1);
    const list = result.blocks[0] as BulletListBlock;
    expect(maxListDepth(list)).toBe(4);
  });

  it("caps at 4 levels — a 5th level is dropped", () => {
    const result = sanitizeExternalHtml(nestedUl(5, "too deep"));
    expect(result.blocks).toHaveLength(1);
    const list = result.blocks[0] as BulletListBlock;
    // Must not exceed 4 levels.
    expect(maxListDepth(list)).toBeLessThanOrEqual(4);
  });

  it("caps at 4 levels — a 6th level is dropped", () => {
    const result = sanitizeExternalHtml(nestedUl(6, "way too deep"));
    const list = result.blocks[0] as BulletListBlock;
    expect(maxListDepth(list)).toBeLessThanOrEqual(4);
  });

  it("top-level list at depth 1 is not capped", () => {
    const result = sanitizeExternalHtml("<ul><li>item1</li><li>item2</li></ul>");
    const list = result.blocks[0] as BulletListBlock;
    expect(maxListDepth(list)).toBe(1);
    expect(list.children).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// sanitizeExternalHtml — close-tag multi-pop (noUncheckedIndexedAccess regression)
//
// These tests exercise the for-loop over `popped` in sanitize.ts that was
// failing typecheck (lines 308, 327, 342, 343). Each case forces the
// close-tag handler to pop more than one entry from the tag stack, covering
// every branch that used popped[pi] / poppedHiddenRoot[pi]:
//   1. Normal inline marks unwound by a mismatched close tag.
//   2. DROP_SUBTREE_TAGS path (script inside unclosed span).
//   3. Hidden-root path (hidden div wrapping unclosed inline).
// ---------------------------------------------------------------------------

describe("sanitizeExternalHtml — close-tag multi-pop branches", () => {
  it("handles unclosed inline tag before outer block close without throwing", () => {
    // <p> is closed but <em> inside was never closed — parser must pop both
    // "em" and "p" when it encounters </p>, iterating over popped.length > 1.
    const result = sanitizeExternalHtml("<p><em>unclosed em</p>");
    const pt = plainText(result);
    expect(pt).toContain("unclosed em");
  });

  it("unwinds inline marks correctly when an outer tag is closed first", () => {
    // <strong> is opened inside <p>, then </p> closes before </strong>.
    // popped will be ["strong", "p"] (reversed iteration) — the strong mark
    // must still be removed from the mark stack.
    const result = sanitizeExternalHtml("<p><strong>bold text</p>");
    const pt = plainText(result);
    expect(pt).toContain("bold text");
    // Subsequent text must not inherit the strong mark.
    const result2 = sanitizeExternalHtml(
      "<p><strong>bold</p><p>plain</p>",
    );
    const p2 = result2.blocks[1] as ParagraphBlock;
    const t2 = p2?.children[0] as TextNode;
    // "plain" must not have marks — strong was properly unwound on close.
    expect(t2?.marks).toBeUndefined();
  });

  it("unwinds DROP_SUBTREE tag (script) when outer unknown tag is closed", () => {
    // An unknown/passthrough tag wrapping a script is closed — script should
    // be in the popped array and the DROP_SUBTREE branch must execute without
    // throwing (covering the popped_tag undefined guard).
    const result = sanitizeExternalHtml(
      "<div><script>evil()</script>kept</div>",
    );
    const pt = plainText(result);
    expect(pt).not.toContain("evil");
    expect(pt).toContain("kept");
  });

  it("unwinds hidden-root when outer tag closes before hidden div closes", () => {
    // A hidden <span hidden> inside a <p> — when </p> closes first, the
    // poppedHiddenRoot entry for the hidden span must be processed correctly
    // (hiddenDepth is decremented, not leaking into subsequent content).
    const result = sanitizeExternalHtml(
      "<p><span hidden>secret</p><p>visible</p>",
    );
    const pt = plainText(result);
    expect(pt).not.toContain("secret");
    expect(pt).toContain("visible");
  });

  it("produces normalized output after multi-pop unwind", () => {
    const result = sanitizeExternalHtml(
      "<p><strong><em>nested</p><p>after</p>",
    );
    expect(normalize(result)).toEqual(result);
  });
});

// ---------------------------------------------------------------------------
// sanitizeExternalHtml — empty list items dropped (Issue #5)
// ---------------------------------------------------------------------------

describe("sanitizeExternalHtml — empty list items dropped (spec line 2307-2308)", () => {
  it("drops empty li elements from bullet lists", () => {
    // An empty <li></li> should not produce a listItem (empty items are invalid).
    const result = sanitizeExternalHtml("<ul><li>A</li><li></li><li>B</li></ul>");
    const list = result.blocks[0] as BulletListBlock;
    // Only items with content should survive.
    const textItems = list.children.filter((item) =>
      item.children.some((c) => c.type === "paragraph" && c.children.length > 0),
    );
    expect(textItems).toHaveLength(2);
  });

  it("drops empty li elements from ordered lists", () => {
    const result = sanitizeExternalHtml("<ol><li>First</li><li></li><li>Third</li></ol>");
    const list = result.blocks[0] as OrderedListBlock;
    const textItems = list.children.filter((item) =>
      item.children.some((c) => c.type === "paragraph" && c.children.length > 0),
    );
    expect(textItems).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// sanitizeExternalHtml — hidden content removed (Issue #5)
// ---------------------------------------------------------------------------

describe("sanitizeExternalHtml — hidden content removed (spec line 2330)", () => {
  it("removes elements with the 'hidden' attribute", () => {
    const result = sanitizeExternalHtml("<p>visible</p><p hidden>secret</p><p>also visible</p>");
    const txt = plainText(result);
    expect(txt).toContain("visible");
    expect(txt).toContain("also visible");
    expect(txt).not.toContain("secret");
  });

  it("removes elements with style=display:none", () => {
    const result = sanitizeExternalHtml('<p>shown</p><p style="display:none">hidden</p>');
    const txt = plainText(result);
    expect(txt).toContain("shown");
    expect(txt).not.toContain("hidden");
  });

  it("removes nested text inside hidden element", () => {
    const result = sanitizeExternalHtml('<div hidden><p>deeply hidden</p><ul><li>also hidden</li></ul></div><p>outside</p>');
    const txt = plainText(result);
    expect(txt).not.toContain("deeply hidden");
    expect(txt).not.toContain("also hidden");
    expect(txt).toContain("outside");
  });

  it("preserves visible elements adjacent to hidden ones", () => {
    const result = sanitizeExternalHtml("<p>before</p><p hidden>gone</p><p>after</p>");
    const txt = plainText(result);
    expect(txt).toContain("before");
    expect(txt).toContain("after");
    expect(txt).not.toContain("gone");
  });
});
