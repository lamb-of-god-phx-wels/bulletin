/**
 * Clipboard sanitization for @cbb/core rich-text.
 *
 * Spec (lines 2328-2333):
 *  - "Plain-text paste creates paragraphs and line breaks."
 *  - "HTML or rich clipboard paste may preserve only the allowed block/mark
 *    semantics; scripts, styles, links, images, hidden content, event
 *    handlers, and unknown elements are removed, with readable descendant
 *    text retained when safe."
 *  - "Control characters other than supported whitespace are rejected or
 *    replaced with visible safe text."
 *
 * sanitizeExternalHtml and sanitizePlainText both produce a RichTextDocument
 * using only the allowlisted vocabulary from types.ts.
 */

import {
  htmlDecodeText,
  HtmlSizeError,
  MAX_HTML_BYTES,
  tokenize,
} from "./htmlTokenizer.js";
import type { HtmlToken } from "./htmlTokenizer.js";
import type {
  BlockNode,
  BulletListBlock,
  HeadingBlock,
  InlineNode,
  ListItemBlock,
  MarkKind,
  OrderedListBlock,
  ParagraphBlock,
  RichTextDocument,
} from "./types.js";
import { normalize } from "./normalize.js";

// Re-export so consumers can catch it.
export { HtmlSizeError, MAX_HTML_BYTES };

// ---------------------------------------------------------------------------
// Control-character sanitization
// ---------------------------------------------------------------------------

/**
 * Strip control characters except tab (U+0009), LF (U+000A), and CR (U+000D).
 * Replace CR/CRLF with LF. NUL and other C0/C1 control chars are removed.
 * Spec: "Control characters other than supported whitespace are rejected or
 * replaced with visible safe text."
 */
function sanitizeControlChars(text: string): string {
  // Normalize line endings.
  let s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // Remove disallowed control characters (C0 except tab/LF, and C1 U+007F–U+009F).
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "");
  return s;
}

// ---------------------------------------------------------------------------
// Allowlisted tag sets
// ---------------------------------------------------------------------------

/**
 * Tags that produce block structure.
 * Heading level is derived from the tag name.
 */
const BLOCK_TAGS = new Set([
  "p", "div", "section", "article", "main", "header", "footer", "aside", "nav",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li",
  "blockquote",
  "pre", "address",
  "br", // treated as inline line-break signal
]);

/**
 * Tags that produce inline marks.
 */
const INLINE_MARK_TAGS: Readonly<Record<string, MarkKind>> = {
  strong: "strong",
  b: "strong",
  em: "emphasis",
  i: "emphasis",
};

/**
 * Inline-passthrough tags — no marks, just pass through content.
 */
const INLINE_PASSTHROUGH_TAGS = new Set([
  "span", "abbr", "cite", "code", "dfn", "kbd", "mark", "q", "s", "samp",
  "small", "sub", "sup", "time", "u", "var",
  "font", "tt",
]);

/**
 * Tags whose entire subtree (including text content) is dropped.
 * Spec: "scripts, styles, links, images, hidden content, event handlers … are
 * removed".
 */
const DROP_SUBTREE_TAGS = new Set([
  "script", "style", "noscript", "template", "iframe", "frame",
  "object", "embed", "applet", "canvas", "svg", "math",
  "head", "meta", "link", "title",
]);

// ---------------------------------------------------------------------------
// Sanitizer state machine
// ---------------------------------------------------------------------------

/**
 * Parsed fragment — a flat list of "segments" that the assembler turns into
 * RichTextDocument blocks.
 */
type Segment =
  | { kind: "text"; text: string; marks: readonly MarkKind[] }
  | { kind: "lineBreak" }
  | { kind: "blockStart"; tag: string; start?: number }
  | { kind: "blockEnd"; tag: string }
  | { kind: "listItemStart" }
  | { kind: "listItemEnd" };

interface SanitizerState {
  segments: Segment[];
  /** Stack of active mark kinds (from outer to inner). */
  markStack: MarkKind[];
  /** Stack of block/drop tag names currently open. */
  tagStack: string[];
  /**
   * Parallel to tagStack: true when the corresponding tagStack entry is the
   * hidden-root element that caused hiddenDepth to increment.  All other
   * entries are false.  This lets close-tag unwinding know exactly which
   * popped tag should decrement hiddenDepth without misidentifying inner
   * block/inline tags inside the hidden subtree.
   */
  tagIsHiddenRoot: boolean[];
  /** Depth of DROP_SUBTREE_TAGS currently open. */
  dropDepth: number;
  /** Depth of hidden content (hidden attribute or style=display:none). */
  hiddenDepth: number;
}

function currentMarks(state: SanitizerState): readonly MarkKind[] {
  // Deduplicate (a tag can nest: <b><b>…</b></b>).
  return [...new Set(state.markStack)];
}

function processTokens(
  tokens: HtmlToken[],
  state: SanitizerState,
): void {
  for (const tok of tokens) {
    if (tok.kind === "doctype" || tok.kind === "comment") continue;

    if (tok.kind === "text") {
      if (state.dropDepth > 0 || state.hiddenDepth > 0) continue;
      const decoded = htmlDecodeText(sanitizeControlChars(tok.raw));
      if (decoded.length > 0) {
        state.segments.push({
          kind: "text",
          text: decoded,
          marks: currentMarks(state),
        });
      }
      continue;
    }

    if (tok.kind === "openTag") {
      const tag = tok.tag;

      // Drop entire subtrees.
      if (DROP_SUBTREE_TAGS.has(tag)) {
        state.dropDepth++;
        state.tagStack.push(tag);
        state.tagIsHiddenRoot.push(false);
        continue;
      }

      if (state.dropDepth > 0) {
        // Inside a dropped subtree — track nesting to know when we exit.
        state.tagStack.push(tag);
        state.tagIsHiddenRoot.push(false);
        continue;
      }

      // Hidden content (spec line 2330): elements with the 'hidden' attribute
      // or style="display:none" are removed including their text content.
      const hidden = tok.attrs.has("hidden") ||
        (tok.attrs.get("style") ?? "").replace(/\s/g, "").toLowerCase().includes("display:none");
      if (hidden) {
        state.hiddenDepth++;
        state.tagStack.push(tag);
        state.tagIsHiddenRoot.push(true); // this tag is the hidden-subtree root
        if (tok.selfClose) {
          state.hiddenDepth--;
          state.tagStack.pop();
          state.tagIsHiddenRoot.pop();
        }
        continue;
      }

      if (state.hiddenDepth > 0) {
        // Inside hidden content — track nesting to know when we exit.
        state.tagStack.push(tag);
        state.tagIsHiddenRoot.push(false);
        if (tok.selfClose) {
          state.tagStack.pop();
          state.tagIsHiddenRoot.pop();
        }
        continue;
      }

      // Event handlers on any element: skip (the element itself may still
      // emit content — we just strip its handlers). We do not abort.
      // (Handlers are attrs — we simply don't use attrs for marks/blocks.)

      // Marks.
      const markKind = INLINE_MARK_TAGS[tag];
      if (markKind !== undefined) {
        state.markStack.push(markKind);
        state.tagStack.push(tag);
        state.tagIsHiddenRoot.push(false);
        if (tok.selfClose) {
          // Self-closed mark: pop immediately.
          state.markStack.pop();
          state.tagStack.pop();
          state.tagIsHiddenRoot.pop();
        }
        continue;
      }

      // Inline passthroughs — just track for close-tag matching.
      if (INLINE_PASSTHROUGH_TAGS.has(tag)) {
        state.tagStack.push(tag);
        state.tagIsHiddenRoot.push(false);
        if (tok.selfClose) {
          state.tagStack.pop();
          state.tagIsHiddenRoot.pop();
        }
        continue;
      }

      // <br> → lineBreak segment.
      if (tag === "br") {
        state.segments.push({ kind: "lineBreak" });
        continue;
      }

      // Block tags.
      if (BLOCK_TAGS.has(tag)) {
        if (tag === "li") {
          state.segments.push({ kind: "listItemStart" });
        } else if (tag !== "br") {
          let seg: Segment;
          if (tag === "ol") {
            const olStart = parseOlStart(tok.attrs);
            seg = olStart !== undefined
              ? { kind: "blockStart", tag, start: olStart }
              : { kind: "blockStart", tag };
          } else {
            seg = { kind: "blockStart", tag };
          }
          state.segments.push(seg);
        }
        state.tagStack.push(tag);
        state.tagIsHiddenRoot.push(false);
        if (tok.selfClose) {
          if (tag === "li") {
            state.segments.push({ kind: "listItemEnd" });
          } else if (tag !== "br") {
            state.segments.push({ kind: "blockEnd", tag });
          }
          state.tagStack.pop();
          state.tagIsHiddenRoot.pop();
        }
        continue;
      }

      // Unknown/unrecognized tags — pass through content, track for close.
      state.tagStack.push(tag);
      state.tagIsHiddenRoot.push(false);
      if (tok.selfClose) {
        state.tagStack.pop();
        state.tagIsHiddenRoot.pop();
      }
      continue;
    }

    if (tok.kind === "closeTag") {
      const tag = tok.tag;

      // Find the matching open tag in the stack (most recent).
      const idx = [...state.tagStack].reverse().findIndex((t) => t === tag);
      if (idx === -1) {
        // Unmatched close tag — ignore.
        continue;
      }

      // Pop back to (and including) the matched tag.
      const depth = idx + 1;
      const stackLen = state.tagStack.length;
      const popped = state.tagStack.splice(stackLen - depth, depth);
      const poppedHiddenRoot = state.tagIsHiddenRoot.splice(stackLen - depth, depth);

      for (let pi = popped.length - 1; pi >= 0; pi--) {
        // pi is always in [0, popped.length-1] by loop bounds, so these
        // array accesses are always defined. The guard satisfies
        // noUncheckedIndexedAccess without a non-null assertion.
        const popped_tag = popped[pi];
        const isHiddenRoot = poppedHiddenRoot[pi];
        if (popped_tag === undefined || isHiddenRoot === undefined) continue;

        if (DROP_SUBTREE_TAGS.has(popped_tag)) {
          if (state.dropDepth > 0) state.dropDepth--;
          continue;
        }
        if (state.dropDepth > 0) continue;

        // Handle hidden-content depth unwinding.
        // Only the tag that was marked as a hidden-root (isHiddenRoot === true)
        // decrements hiddenDepth.  Tags nested inside the hidden subtree are
        // simply discarded without touching the counter.
        if (isHiddenRoot) {
          if (state.hiddenDepth > 0) state.hiddenDepth--;
          continue;
        }
        if (state.hiddenDepth > 0) {
          // Inside hidden content but not the root: discard without side-effects.
          continue;
        }

        const markKind = INLINE_MARK_TAGS[popped_tag];
        if (markKind !== undefined) {
          // Pop the innermost matching mark.
          const mi = [...state.markStack].reverse().findIndex((m) => m === markKind);
          if (mi !== -1) {
            state.markStack.splice(state.markStack.length - 1 - mi, 1);
          }
          continue;
        }

        if (popped_tag === "li") {
          state.segments.push({ kind: "listItemEnd" });
          continue;
        }

        if (BLOCK_TAGS.has(popped_tag) && popped_tag !== "br") {
          state.segments.push({ kind: "blockEnd", tag: popped_tag });
          continue;
        }
      }
    }
  }
}

function parseOlStart(attrs: Map<string, string>): number | undefined {
  const raw = attrs.get("start");
  if (raw === undefined) return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

// ---------------------------------------------------------------------------
// Segment assembler
// ---------------------------------------------------------------------------

/**
 * Convert flat segments into a RichTextDocument block tree.
 *
 * We handle nesting up to 4 levels (spec requirement) via a recursive descent
 * over the segment stream.
 */

interface InlineAccum {
  children: InlineNode[];
}

function flushInline(accum: InlineAccum): InlineNode[] {
  const result = [...accum.children];
  accum.children = [];
  return result;
}

function assembleDocument(segments: Segment[]): RichTextDocument {
  let pos = 0;

  function peek(): Segment | undefined {
    return segments[pos];
  }
  function consume(): Segment | undefined {
    return segments[pos++];
  }

  function parseInlines(): InlineNode[] {
    const nodes: InlineNode[] = [];
    while (pos < segments.length) {
      const seg = peek();
      if (seg === undefined) break;
      if (
        seg.kind === "blockEnd" ||
        seg.kind === "blockStart" ||
        seg.kind === "listItemStart" ||
        seg.kind === "listItemEnd"
      ) {
        break;
      }
      consume();
      if (seg.kind === "lineBreak") {
        nodes.push({ type: "lineBreak" });
      } else if (seg.kind === "text") {
        const marks = seg.marks.length > 0 ? seg.marks : undefined;
        nodes.push(
          marks !== undefined
            ? { type: "text", text: seg.text, marks }
            : { type: "text", text: seg.text },
        );
      }
    }
    return nodes;
  }

  /** Spec: lists may nest at most four levels (spec line 2306-2307). */
  const MAX_LIST_DEPTH = 4;

  function parseListItem(depth: number): ListItemBlock | null {
    const seg = peek();
    if (seg?.kind !== "listItemStart") return null;
    consume(); // eat listItemStart

    const children: (ParagraphBlock | BulletListBlock | OrderedListBlock)[] = [];
    // Collect content until listItemEnd or next listItemStart or blockEnd.
    while (pos < segments.length) {
      const s = peek();
      if (s === undefined) break;
      if (s.kind === "listItemEnd") {
        consume();
        break;
      }
      if (s.kind === "listItemStart") break; // next sibling
      if (s.kind === "blockEnd") break;

      if (s.kind === "blockStart") {
        const block = parseBlock(depth);
        if (block !== null) {
          if (
            block.type === "paragraph" ||
            block.type === "bulletList" ||
            block.type === "orderedList"
          ) {
            children.push(block);
          }
          // Other block types inside li: skip.
        }
      } else {
        // Inline content — wrap in paragraph.
        const inlines = parseInlines();
        if (inlines.length > 0) {
          children.push({ type: "paragraph", children: inlines });
        }
      }
    }

    // Spec line 2307-2308: empty list items are not valid — drop them.
    if (children.length === 0) {
      return null;
    }

    return { type: "listItem", children };
  }

  function parseBulletList(depth: number = 0): BulletListBlock {
    const items: ListItemBlock[] = [];
    while (pos < segments.length) {
      const s = peek();
      if (s === undefined) break;
      if (s.kind === "blockEnd" && s.tag === "ul") break;
      if (s.kind === "listItemStart") {
        const item = parseListItem(depth);
        if (item !== null) items.push(item);
      } else {
        consume(); // skip unexpected
      }
    }
    // Consume the blockEnd for ul.
    const end = peek();
    if (end?.kind === "blockEnd" && end.tag === "ul") consume();

    return { type: "bulletList", children: items };
  }

  function parseOrderedList(start: number | undefined, depth: number = 0): OrderedListBlock {
    const items: ListItemBlock[] = [];
    while (pos < segments.length) {
      const s = peek();
      if (s === undefined) break;
      if (s.kind === "blockEnd" && s.tag === "ol") break;
      if (s.kind === "listItemStart") {
        const item = parseListItem(depth);
        if (item !== null) items.push(item);
      } else {
        consume(); // skip unexpected
      }
    }
    const end = peek();
    if (end?.kind === "blockEnd" && end.tag === "ol") consume();

    if (start !== undefined) {
      return { type: "orderedList", start, children: items };
    }
    return { type: "orderedList", children: items };
  }

  /**
   * Parse one block node. `depth` is the current list nesting depth (0 = top
   * level). The spec (line 2306-2307) limits list nesting to four levels.
   * When depth >= MAX_LIST_DEPTH, nested ul/ol are skipped rather than
   * producing a 5th level in the AST.
   */
  function parseBlock(depth: number = 0): BlockNode | null {
    const seg = peek();
    if (seg?.kind !== "blockStart") return null;
    consume(); // eat blockStart

    const tag = seg.tag;

    // Heading tags.
    if (/^h[1-6]$/.test(tag)) {
      const level = parseInt(tag[1] ?? "1", 10) as 1 | 2 | 3 | 4 | 5 | 6;
      const children = parseInlines();
      // Consume blockEnd.
      const end = peek();
      if (end?.kind === "blockEnd" && end.tag === tag) consume();
      const heading: HeadingBlock = { type: "heading", level, children };
      return heading;
    }

    if (tag === "ul") {
      if (depth >= MAX_LIST_DEPTH) {
        // At cap: skip the entire nested list contents.
        let depth2 = 1;
        while (pos < segments.length && depth2 > 0) {
          const s = consume();
          if (s?.kind === "blockStart" && s.tag === "ul") depth2++;
          else if (s?.kind === "blockEnd" && s.tag === "ul") depth2--;
          else if (s?.kind === "blockStart" && s.tag === "ol") depth2++;
          else if (s?.kind === "blockEnd" && s.tag === "ol") depth2--;
        }
        return null;
      }
      return parseBulletList(depth + 1);
    }

    if (tag === "ol") {
      if (depth >= MAX_LIST_DEPTH) {
        // At cap: skip the entire nested list contents.
        let depth2 = 1;
        while (pos < segments.length && depth2 > 0) {
          const s = consume();
          if (s?.kind === "blockStart" && (s.tag === "ul" || s.tag === "ol")) depth2++;
          else if (s?.kind === "blockEnd" && (s.tag === "ul" || s.tag === "ol")) depth2--;
        }
        return null;
      }
      const start = seg.kind === "blockStart" ? seg.start : undefined;
      return parseOrderedList(start, depth + 1);
    }

    if (tag === "blockquote") {
      const bqChildren: (ParagraphBlock | BulletListBlock | OrderedListBlock)[] = [];
      while (pos < segments.length) {
        const s = peek();
        if (s === undefined) break;
        if (s.kind === "blockEnd" && s.tag === "blockquote") break;
        if (s.kind === "blockStart") {
          const b = parseBlock(depth);
          if (b !== null && (b.type === "paragraph" || b.type === "bulletList" || b.type === "orderedList")) {
            bqChildren.push(b);
          }
        } else if (s.kind === "text" || s.kind === "lineBreak") {
          const inlines = parseInlines();
          if (inlines.length > 0) {
            bqChildren.push({ type: "paragraph", children: inlines });
          }
        } else {
          consume();
        }
      }
      const end = peek();
      if (end?.kind === "blockEnd" && end.tag === "blockquote") consume();
      // Spec: empty blockquote children are not valid — drop it rather than
      // emitting an empty paragraph.
      if (bqChildren.length === 0) {
        return null;
      }
      return { type: "blockquote", children: bqChildren };
    }

    // Generic block (p, div, etc.) → paragraph.
    const inlines = parseInlines();
    const end = peek();
    if (end?.kind === "blockEnd" && end.tag === tag) consume();
    const para: ParagraphBlock = { type: "paragraph", children: inlines };
    return para;
  }

  function parseTopLevel(): BlockNode[] {
    const blocks: BlockNode[] = [];
    // Pending inline accumulator between blocks.
    const inlineAccum: InlineAccum = { children: [] };

    function flushAccum(): void {
      if (inlineAccum.children.length > 0) {
        blocks.push({ type: "paragraph", children: flushInline(inlineAccum) });
      }
    }

    while (pos < segments.length) {
      const s = peek();
      if (s === undefined) break;

      if (s.kind === "blockStart") {
        flushAccum();
        const b = parseBlock();
        if (b !== null) blocks.push(b);
        continue;
      }

      if (s.kind === "text" || s.kind === "lineBreak") {
        consume();
        if (s.kind === "lineBreak") {
          inlineAccum.children.push({ type: "lineBreak" });
        } else {
          const marks = s.marks.length > 0 ? s.marks : undefined;
          inlineAccum.children.push(
            marks !== undefined
              ? { type: "text", text: s.text, marks }
              : { type: "text", text: s.text },
          );
        }
        continue;
      }

      // Unexpected block-end, listItemStart/End at top level — skip.
      consume();
    }

    flushAccum();
    return blocks;
  }

  const blocks = parseTopLevel();
  return normalize({ type: "document", blocks });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sanitize external HTML clipboard content into a safe RichTextDocument.
 *
 * - Strips scripts, styles, event handlers, images, links, unknown elements
 *   (retaining their text content).
 * - Preserves bold/italic marks, headings, paragraphs, lists, blockquotes.
 * - Rejects inputs over MAX_HTML_BYTES.
 * - Result is normalized.
 *
 * @throws {HtmlSizeError} when input exceeds MAX_HTML_BYTES.
 */
export function sanitizeExternalHtml(html: string): RichTextDocument {
  if (html.length > MAX_HTML_BYTES) {
    throw new HtmlSizeError(html.length);
  }

  const tokens: HtmlToken[] = tokenize(html);

  const state: SanitizerState = {
    segments: [],
    markStack: [],
    tagStack: [],
    tagIsHiddenRoot: [],
    dropDepth: 0,
    hiddenDepth: 0,
  };

  processTokens(tokens, state);
  return assembleDocument(state.segments);
}

/**
 * Sanitize plain-text clipboard content into a RichTextDocument.
 *
 * Spec: "Plain-text paste creates paragraphs and line breaks."
 *  - Split on blank lines to create paragraph blocks.
 *  - Within each paragraph, LF becomes a lineBreak node.
 *  - Control characters are sanitized.
 *
 * @throws {HtmlSizeError} when input exceeds MAX_HTML_BYTES.
 */
export function sanitizePlainText(text: string): RichTextDocument {
  if (text.length > MAX_HTML_BYTES) {
    throw new HtmlSizeError(text.length);
  }

  const cleaned = sanitizeControlChars(text);

  // Split into paragraphs at blank lines (one or more blank lines).
  const rawParas = cleaned.split(/\n{2,}/);

  const blocks: BlockNode[] = rawParas.map((para): ParagraphBlock => {
    const lines = para.split("\n");
    const children: InlineNode[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (line.length > 0) {
        children.push({ type: "text", text: line });
      }
      if (i < lines.length - 1) {
        children.push({ type: "lineBreak" });
      }
    }
    return { type: "paragraph", children };
  });

  return normalize({ type: "document", blocks });
}
