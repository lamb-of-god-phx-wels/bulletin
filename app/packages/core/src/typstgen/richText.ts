import type {
  EffectiveScripturePresentation,
  ResolvedInline,
  ResolvedRichTextBlock,
  ResolvedRichTextDocument,
  ResolvedScriptureBlock,
} from "../document/resolvedTypes.js";
import { typstStringLiteral } from "./escape.js";
import { typstLength } from "./values.js";

function renderInline(node: ResolvedInline): string {
  if (node.type === "lineBreak") return "#linebreak()";

  let content = `#text(${typstStringLiteral(node.text)})`;
  const marks = node.marks ?? [];
  // Canonical mark order is strong then emphasis. Wrap in reverse so the
  // first canonical mark remains the outer semantic construct.
  for (let index = marks.length - 1; index >= 0; index--) {
    const mark = marks[index];
    if (mark === "strong") content = `#strong[${content}]`;
    if (mark === "emphasis") content = `#emph[${content}]`;
  }
  return content;
}

function renderInlines(children: readonly ResolvedInline[]): string {
  return children.map(renderInline).join("");
}

function referenceLine(
  block: ResolvedScriptureBlock,
  presentation: EffectiveScripturePresentation
): string | undefined {
  const hasReference = block.reference.length > 0;
  const translationWithReference =
    presentation.translationLabelPlacement === "withReference" &&
    block.translationLabel.length > 0;
  if (!hasReference && !translationWithReference) return undefined;
  const label = hasReference
    ? translationWithReference
      ? `${block.reference} (${block.translationLabel})`
      : block.reference
    : block.translationLabel;
  return `#strong[#text(${typstStringLiteral(label)})]`;
}

function scripturePassage(block: ResolvedScriptureBlock): string {
  const spacing = typstLength(block.presentation.paragraphSpacing, "spacing");
  const paragraphs: string[] = [];

  if (block.structureKind === "paragraphOnly") {
    for (const paragraph of block.paragraphs) {
      paragraphs.push(`#block[${renderInlines(paragraph.children)}]`);
    }
  } else {
    let current = "";
    for (const [index, verse] of block.verses.entries()) {
      const beginsParagraph =
        block.presentation.paragraphPolicy === "oneVerse" ||
        verse.paragraphStart ||
        index === 0;
      if (beginsParagraph && current.length > 0) {
        paragraphs.push(`#block[${current}]`);
        current = "";
      }

      if (block.presentation.verseNumberStyle === "inline") {
        current += `#text(${typstStringLiteral(`${verse.label} `)})`;
      } else if (block.presentation.verseNumberStyle === "superscript") {
        current += `#super[#text(${typstStringLiteral(verse.label)})]#h(0.15em)`;
      }
      current += renderInlines(verse.children);
      if (block.presentation.paragraphPolicy === "oneVerse") current += " ";
    }
    if (current.length > 0) paragraphs.push(`#block[${current}]`);
  }

  return paragraphs.join(`#v(${spacing})`);
}

function renderScripture(block: ResolvedScriptureBlock): string {
  const parts: string[] = [];
  if (block.presentation.referencePlacement === "before") {
    const reference = referenceLine(block, block.presentation);
    if (reference !== undefined) parts.push(reference);
  }
  parts.push(scripturePassage(block));
  if (
    block.presentation.translationLabelPlacement === "afterPassage" &&
    block.translationLabel.length > 0
  ) {
    parts.push(
      `#emph[#text(${typstStringLiteral(`(${block.translationLabel})`)})]`
    );
  }
  if (block.presentation.referencePlacement === "after") {
    const reference = referenceLine(block, block.presentation);
    if (reference !== undefined) parts.push(reference);
  }
  return `#quote(block: true)[${parts.join("#parbreak()")}]`;
}

function renderListItem(block: ResolvedRichTextBlock): string {
  if (block.type === "listItem") {
    return `[${block.children.map(renderRichTextBlock).join("")}]`;
  }
  return `[${renderRichTextBlock(block)}]`;
}

export function renderRichTextBlock(block: ResolvedRichTextBlock): string {
  switch (block.type) {
    case "paragraph":
      return `#block[${renderInlines(block.children)}]`;
    case "heading":
      return `#heading(level: ${block.level})[${renderInlines(block.children)}]`;
    case "bulletList":
      return `#list(${block.children.map(renderListItem).join(", ")})`;
    case "orderedList":
      return `#enum(start: ${block.start ?? 1}, ${block.children
        .map(renderListItem)
        .join(", ")})`;
    case "blockquote":
      return `#quote(block: true)[${block.children
        .map(renderRichTextBlock)
        .join("")}]`;
    case "listItem":
      return block.children.map(renderRichTextBlock).join("");
    case "scripture":
      return renderScripture(block);
  }
}

export function renderRichTextDocument(document: ResolvedRichTextDocument): string {
  return document.blocks.map(renderRichTextBlock).join("#parbreak()\n");
}
