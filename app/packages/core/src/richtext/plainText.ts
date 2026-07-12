/**
 * plainText(doc): deterministic plain-text derivation.
 *
 * Spec (lines 2320-2326):
 *  - Concatenate inline text; convert lineBreak to LF.
 *  - Separate blocks with a blank line.
 *  - Prefix list items with stable bullets/numbers and two spaces per nesting
 *    level.
 *  - For a Scripture block: emit the configured reference/translation placement
 *    and each verse's label/text in canonical order without using inert source
 *    text as a second rendered copy; for paragraphOnly emit stored paragraphs
 *    in order with no invented verse labels.
 *
 * This is a pure function; no side effects, no I/O.
 */

import type {
  BlockNode,
  BlockquoteBlock,
  BulletListBlock,
  InlineNode,
  ListItemBlock,
  OrderedListBlock,
  ParagraphBlock,
  ParagraphOnlyScriptureBlock,
  RichTextDocument,
  ScriptureBlock,
  ScriptureFormatting,
  VerseStructuredScriptureBlock,
} from "./types.js";
import { SCRIPTURE_FORMATTING_DEFAULTS } from "./types.js";

// ---------------------------------------------------------------------------
// Inline rendering
// ---------------------------------------------------------------------------

function inlinesToText(children: readonly InlineNode[]): string {
  let out = "";
  for (const node of children) {
    if (node.type === "text") {
      out += node.text;
    } else {
      // lineBreak → LF
      out += "\n";
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Block rendering (depth-aware for list nesting)
// ---------------------------------------------------------------------------

function renderListItem(
  item: ListItemBlock,
  prefix: string,
  depth: number,
): string {
  const indent = "  ".repeat(depth);
  const lines: string[] = [];

  for (const child of item.children) {
    if (child.type === "paragraph") {
      const text = inlinesToText(child.children);
      lines.push(`${indent}${prefix}${text}`);
    } else if (child.type === "bulletList") {
      lines.push(renderBulletList(child, depth + 1));
    } else {
      lines.push(renderOrderedList(child, depth + 1));
    }
  }

  return lines.join("\n");
}

function renderBulletList(block: BulletListBlock, depth: number = 0): string {
  return block.children
    .map((item) => renderListItem(item, "• ", depth))
    .join("\n");
}

function renderOrderedList(
  block: OrderedListBlock,
  depth: number = 0,
): string {
  const start = block.start ?? 1;
  return block.children
    .map((item, i) => renderListItem(item, `${start + i}. `, depth))
    .join("\n");
}

function renderParagraph(block: ParagraphBlock): string {
  return inlinesToText(block.children);
}

function renderBlockquote(block: BlockquoteBlock): string {
  return block.children.map(renderBlock).join("\n\n");
}

/**
 * Render a scripture block to plain text.
 *
 * Spec lines 2322-2326:
 *   "For a Scripture block it emits the configured reference/translation
 *   placement and each verse's label/text in canonical order without using
 *   inert source text as a second rendered copy; for paragraphOnly it emits
 *   the stored paragraphs in order with no invented verse labels."
 *
 * The effective formatting is from `formattingOverride` if present, otherwise
 * we use the spec's v1 defaults (we don't have a doc-level presentation here;
 * plainText operates on the block alone). The caller may pass effective
 * formatting via the wrapper below.
 */
function renderScripture(
  block: ScriptureBlock,
  formatting: ScriptureFormatting,
): string {
  const refLabel =
    formatting.translationLabelPlacement === "withReference"
      ? `${block.reference} (${block.translationLabel})`
      : block.reference;

  const translationLine =
    formatting.translationLabelPlacement === "afterPassage"
      ? `(${block.translationLabel})`
      : null;

  const passageLines: string[] = [];

  if (block.structureKind === "verseStructured") {
    const vb = block as VerseStructuredScriptureBlock;
    for (const verse of vb.verses) {
      const text = inlinesToText(verse.children);
      const verseNumberStyle = formatting.verseNumberStyle;
      if (verseNumberStyle === "hidden") {
        passageLines.push(text);
      } else {
        // Both "inline" and "superscript" render label inline in plain text.
        passageLines.push(`${verse.label} ${text}`);
      }
    }
  } else {
    const pb = block as ParagraphOnlyScriptureBlock;
    for (const para of pb.paragraphs) {
      passageLines.push(inlinesToText(para.children));
    }
  }

  const passage = passageLines.join("\n");

  const parts: string[] = [];
  if (formatting.referencePlacement === "before") {
    parts.push(refLabel);
    parts.push(passage);
    if (translationLine !== null) parts.push(translationLine);
  } else {
    parts.push(passage);
    if (translationLine !== null) parts.push(translationLine);
    parts.push(refLabel);
  }

  return parts.join("\n");
}

function renderBlock(block: BlockNode): string {
  switch (block.type) {
    case "paragraph":
      return renderParagraph(block);
    case "heading":
      return inlinesToText(block.children);
    case "bulletList":
      return renderBulletList(block);
    case "orderedList":
      return renderOrderedList(block);
    case "blockquote":
      return renderBlockquote(block);
    case "scripture": {
      const formatting: ScriptureFormatting =
        block.formattingOverride ?? {
          referencePlacement: SCRIPTURE_FORMATTING_DEFAULTS.referencePlacement,
          verseNumberStyle: SCRIPTURE_FORMATTING_DEFAULTS.verseNumberStyle,
          paragraphPolicy: SCRIPTURE_FORMATTING_DEFAULTS.paragraphPolicy,
          paragraphSpacing: SCRIPTURE_FORMATTING_DEFAULTS.paragraphSpacing,
          translationLabelPlacement:
            SCRIPTURE_FORMATTING_DEFAULTS.translationLabelPlacement,
        };
      return renderScripture(block, formatting);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Derive deterministic plain text from a `RichTextDocument`.
 *
 * Blocks are separated by a blank line (`\n\n`).
 * The result has no trailing newline.
 */
export function plainText(doc: RichTextDocument): string {
  const blockTexts = doc.blocks.map(renderBlock);
  return blockTexts.join("\n\n");
}
