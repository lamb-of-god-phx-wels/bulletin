import { Fragment, type ElementType, type ReactNode } from "react";
import type {
  BlockNode,
  InlineNode,
  ListItemBlock,
  RichTextDocument,
} from "@cbb/core";

function Inline({ node, index }: { readonly node: InlineNode; readonly index: number }) {
  if (node.type === "lineBreak") return <br />;
  let content: ReactNode = node.text;
  if (node.marks?.includes("emphasis") === true) content = <em>{content}</em>;
  if (node.marks?.includes("strong") === true) content = <strong>{content}</strong>;
  return <Fragment key={index}>{content}</Fragment>;
}

function Inlines({ nodes }: { readonly nodes: readonly InlineNode[] }) {
  return <>{nodes.map((node, index) => <Inline key={index} node={node} index={index} />)}</>;
}

function ListItem({ item }: { readonly item: ListItemBlock }) {
  return <li>{item.children.map((block, index) => <Block key={index} block={block} />)}</li>;
}

function Scripture({ block }: { readonly block: Extract<BlockNode, { type: "scripture" }> }) {
  return (
    <figure className="cbb-scripture">
      {block.reference === undefined || block.reference.length === 0
        ? null
        : <figcaption>{block.reference}</figcaption>}
      {block.structureKind === "verseStructured"
        ? block.verses.map((verse) => (
            <span className="cbb-scripture__verse" key={verse.verseId}>
              <sup>{verse.label}</sup> <Inlines nodes={verse.children} />{" "}
            </span>
          ))
        : block.paragraphs.map((paragraph, index) => (
            <p key={index}><Inlines nodes={paragraph.children} /></p>
          ))}
      {block.translationLabel === undefined || block.translationLabel.length === 0
        ? null
        : <small>{block.translationLabel}</small>}
    </figure>
  );
}

function Block({ block }: { readonly block: BlockNode }) {
  switch (block.type) {
    case "paragraph":
      return <p><Inlines nodes={block.children} /></p>;
    case "heading": {
      const Tag = `h${block.level}` as ElementType;
      return <Tag><Inlines nodes={block.children} /></Tag>;
    }
    case "bulletList":
      return <ul>{block.children.map((item, index) => <ListItem key={index} item={item} />)}</ul>;
    case "orderedList":
      return (
        <ol {...(block.start === undefined ? {} : { start: block.start })}>
          {block.children.map((item, index) => <ListItem key={index} item={item} />)}
        </ol>
      );
    case "blockquote":
      return <blockquote>{block.children.map((child, index) => <Block key={index} block={child} />)}</blockquote>;
    case "scripture":
      return <Scripture block={block} />;
  }
}

export function RichTextView({
  document,
  fragmentIndices,
}: {
  readonly document: RichTextDocument;
  readonly fragmentIndices?: readonly number[] | undefined;
}) {
  const blocks = fragmentIndices === undefined
    ? document.blocks.map((block, index) => ({ block, index }))
    : fragmentIndices
        .map((index) => ({ block: document.blocks[index], index }))
        .filter((entry): entry is { readonly block: BlockNode; readonly index: number } => entry.block !== undefined);
  return <>{blocks.map(({ block, index }) => (
    <div className="cbb-rich-fragment" data-cbb-fragment-index={index} key={index}>
      <Block block={block} />
    </div>
  ))}</>;
}
