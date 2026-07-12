/**
 * normalize(doc): produce canonical rich-text AST form.
 *
 * Rules derived from spec.md §"Text" (lines 2314-2326):
 *  - Merge adjacent text leaves with identical marks.
 *  - Remove empty text leaves.
 *  - Canonical mark order: strong, then emphasis.
 *  - Idempotent: normalize(normalize(x)) === normalize(x) structurally.
 *
 * This function never mutates its input; it always returns a new object tree.
 * No Date.now / Math.random / locale-sensitive operations.
 */

import type {
  BlockNode,
  BlockquoteBlock,
  BulletListBlock,
  HeadingBlock,
  InlineNode,
  LineBreakNode,
  ListItemBlock,
  MarkKind,
  OrderedListBlock,
  ParagraphBlock,
  ParagraphOnlyScriptureBlock,
  RichTextDocument,
  ScriptureBlock,
  ScriptureParagraph,
  ScriptureVerse,
  TextNode,
  VerseStructuredScriptureBlock,
} from "./types.js";
import { MARK_ORDER } from "./types.js";

// ---------------------------------------------------------------------------
// Mark helpers
// ---------------------------------------------------------------------------

/** Canonical marks array: unique, sorted by MARK_ORDER, or undefined. */
function canonicalMarks(
  marks: readonly MarkKind[] | undefined,
): readonly MarkKind[] | undefined {
  if (marks === undefined || marks.length === 0) return undefined;
  const unique = [...new Set(marks)];
  unique.sort((a, b) => (MARK_ORDER[a] ?? 0) - (MARK_ORDER[b] ?? 0));
  return unique;
}

/** Stable key for a marks set — used for merge-adjacency comparison. */
function marksKey(marks: readonly MarkKind[] | undefined): string {
  if (marks === undefined || marks.length === 0) return "";
  // After canonicalization marks are already sorted.
  return marks.join(",");
}

// ---------------------------------------------------------------------------
// Inline normalization
// ---------------------------------------------------------------------------

/**
 * Normalize an array of inline nodes:
 * 1. Discard TextNode with empty `.text`.
 * 2. Normalize marks on each TextNode.
 * 3. Merge adjacent TextNodes whose marks keys are identical.
 */
function normalizeInlines(
  children: readonly InlineNode[],
): readonly InlineNode[] {
  const result: InlineNode[] = [];

  for (const node of children) {
    if (node.type === "lineBreak") {
      result.push(node as LineBreakNode);
      continue;
    }

    // TextNode
    if (node.text.length === 0) continue; // drop empty

    const cm = canonicalMarks(node.marks);
    const normalized: TextNode = cm !== undefined
      ? { type: "text", text: node.text, marks: cm }
      : { type: "text", text: node.text };

    // Try to merge with the last result node.
    const last = result[result.length - 1];
    if (
      last !== undefined &&
      last.type === "text" &&
      marksKey(last.marks) === marksKey(normalized.marks)
    ) {
      // Merge: replace last entry with concatenated text.
      const merged: TextNode = last.marks !== undefined
        ? { type: "text", text: last.text + normalized.text, marks: last.marks }
        : { type: "text", text: last.text + normalized.text };
      result[result.length - 1] = merged;
    } else {
      result.push(normalized);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Block normalization (forward declarations resolved by mutual recursion)
// ---------------------------------------------------------------------------

function normalizeParagraph(block: ParagraphBlock): ParagraphBlock {
  return { type: "paragraph", children: normalizeInlines(block.children) };
}

function normalizeHeading(block: HeadingBlock): HeadingBlock {
  return {
    type: "heading",
    level: block.level,
    children: normalizeInlines(block.children),
  };
}

function normalizeListItem(item: ListItemBlock): ListItemBlock {
  const children = item.children.map((child) => {
    if (child.type === "paragraph") return normalizeParagraph(child);
    if (child.type === "bulletList") return normalizeBulletList(child);
    return normalizeOrderedList(child);
  });
  return { type: "listItem", children };
}

function normalizeBulletList(block: BulletListBlock): BulletListBlock {
  return { type: "bulletList", children: block.children.map(normalizeListItem) };
}

function normalizeOrderedList(block: OrderedListBlock): OrderedListBlock {
  const base: OrderedListBlock = {
    type: "orderedList",
    children: block.children.map(normalizeListItem),
  };
  if (block.start !== undefined) {
    return { ...base, start: block.start };
  }
  return base;
}

function normalizeBlockquote(block: BlockquoteBlock): BlockquoteBlock {
  const children = block.children.map((child) => {
    if (child.type === "paragraph") return normalizeParagraph(child);
    if (child.type === "bulletList") return normalizeBulletList(child);
    return normalizeOrderedList(child);
  });
  return { type: "blockquote", children };
}

function normalizeScriptureVerseInlines(
  verse: ScriptureVerse,
): ScriptureVerse {
  return {
    verseId: verse.verseId,
    label: verse.label,
    paragraphStart: verse.paragraphStart,
    children: normalizeInlines(verse.children),
  };
}

function normalizeScriptureParagraphInlines(
  para: ScriptureParagraph,
): ScriptureParagraph {
  return { children: normalizeInlines(para.children) };
}

function normalizeScripture(block: ScriptureBlock): ScriptureBlock {
  if (block.structureKind === "verseStructured") {
    const normalized: VerseStructuredScriptureBlock = {
      ...block,
      verses: block.verses.map(normalizeScriptureVerseInlines),
    };
    return normalized;
  } else {
    const normalized: ParagraphOnlyScriptureBlock = {
      ...block,
      paragraphs: block.paragraphs.map(normalizeScriptureParagraphInlines),
    };
    return normalized;
  }
}

function normalizeBlock(block: BlockNode): BlockNode {
  switch (block.type) {
    case "paragraph":
      return normalizeParagraph(block);
    case "heading":
      return normalizeHeading(block);
    case "bulletList":
      return normalizeBulletList(block);
    case "orderedList":
      return normalizeOrderedList(block);
    case "blockquote":
      return normalizeBlockquote(block);
    case "scripture":
      return normalizeScripture(block);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return the canonical form of a `RichTextDocument`.
 *
 * - Drops empty text leaves.
 * - Merges adjacent text leaves with identical marks.
 * - Puts marks in canonical order (strong, emphasis).
 * - Idempotent.
 * - Does not modify `doc`.
 */
export function normalize(doc: RichTextDocument): RichTextDocument {
  return { type: "document", blocks: doc.blocks.map(normalizeBlock) };
}
