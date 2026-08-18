import { randomId } from './id.js';
import type { ListBlock, Paragraph } from './types.js';

const blankParagraph = (): Paragraph => ({ type: 'paragraph', children: [{ type: 'text', text: '' }] });

function paragraphIsBlank(paragraph: Paragraph) {
  return !paragraph.children.some(run => run.type === 'symbol' || (run.type === 'text' && run.text.trim().length > 0));
}

function paragraphText(paragraph: Paragraph) {
  return paragraph.children.map(run => run.type === 'text' ? run.text : run.type === 'symbol' ? '✠' : '\n').join('');
}

function titleParagraphs(item: ListBlock['items'][number]) {
  if (item.titleContent?.length) return structuredClone(item.titleContent);
  return [{ type: 'paragraph' as const, children: [{ type: 'text' as const, text: item.title ?? '' }] }];
}

function splitFirstLine(content: Paragraph[]) {
  const [first = blankParagraph(), ...following] = content;
  const breakIndex = first.children.findIndex(run => run.type === 'lineBreak');
  if (breakIndex < 0) return { heading: first, body: following };
  const heading = { ...first, children: first.children.slice(0, breakIndex) };
  const tail = first.children.slice(breakIndex + 1);
  return {
    heading: { ...heading, children: heading.children.length ? heading.children : [{ type: 'text' as const, text: '' }] },
    body: [...(tail.length ? [{ ...first, children: tail }] : []), ...following],
  };
}

function withoutBreakBefore(paragraph: Paragraph): Paragraph {
  const { breakBefore: _breakBefore, ...rest } = paragraph;
  return structuredClone(rest);
}

function normalizeListSegment(content: Paragraph[]): Paragraph[] {
  const result: Paragraph[] = [];
  let blanks: Paragraph[] = [];
  for (const paragraph of content) {
    if (paragraphIsBlank(paragraph)) {
      blanks.push(paragraph);
      continue;
    }
    const next = withoutBreakBefore(paragraph);
    if (!result.length) {
      result.push(next);
    } else if (!blanks.length) {
      result.push({ ...next, breakBefore: 'line' });
    } else {
      result.push(next);
    }
    blanks = [];
  }
  result.push(...blanks.map(paragraph => ({ ...withoutBreakBefore(paragraph), breakBefore: 'line' as const })));
  return result;
}

function listEditorLines(content: Paragraph[]): Paragraph[] {
  const lines: Paragraph[] = [];
  content.forEach((paragraph, index) => {
    if (index && paragraph.breakBefore !== 'line') lines.push(blankParagraph());
    lines.push(withoutBreakBefore(paragraph));
  });
  return lines;
}

export function listItemEditorContent(item: ListBlock['items'][number], headingsEnabled = true): Paragraph[] {
  const content = !headingsEnabled
    ? structuredClone(item.content)
    : [
      ...titleParagraphs(item),
      ...structuredClone(item.content).map((paragraph, index) => index ? paragraph : { ...paragraph, breakBefore: 'line' as const }),
    ];
  return listEditorLines(content);
}

export function setListHeadingsEnabled(block: ListBlock, headingsEnabled: boolean): ListBlock {
  if ((block.headingsEnabled !== false) === headingsEnabled) return block;
  return {
    ...block,
    headingsEnabled,
    items: block.items.map(item => {
      if (!headingsEnabled) {
        const heading = titleParagraphs(item).filter(paragraph => !paragraphIsBlank(paragraph));
        const { title: _title, titleContent: _titleContent, ...rest } = item;
        return { ...rest, content: [...heading, ...item.content.map((paragraph, index) => index ? paragraph : { ...paragraph, breakBefore: 'line' as const })] };
      }
      const { heading, body } = splitFirstLine(item.content);
      return { ...item, title: paragraphText(heading), titleContent: [heading], content: body };
    }),
  };
}

export function updateListItemContent(block: ListBlock, index: number, content: Paragraph[]): {
  block: ListBlock;
} {
  const item = block.items[index];
  if (!item) return { block };
  return { block: { ...block, items: block.items.map((candidate, itemIndex) => itemIndex === index ? { ...candidate, content } : candidate) } };
}

function splitAtListSeparators(content: Paragraph[]) {
  const separatorNewlineCharacters = 2;
  const segments: Paragraph[][] = [];
  let current: Paragraph[] = [];
  let blanks: Paragraph[] = [];
  let foundSeparator = false;
  for (const paragraph of content) {
    if (paragraphIsBlank(paragraph)) {
      blanks.push(paragraph);
      continue;
    }
    const newlineCharacters = blanks.length + (current.length ? 1 : 0);
    if (newlineCharacters > separatorNewlineCharacters) {
      segments.push(current);
      current = [];
      foundSeparator = true;
    } else current.push(...blanks);
    blanks = [];
    current.push(paragraph);
  }
  if (blanks.length > separatorNewlineCharacters) {
    segments.push(current);
    current = [];
    foundSeparator = true;
  } else current.push(...blanks);
  segments.push(current);
  return foundSeparator ? segments : undefined;
}

function itemFromEditorContent(item: ListBlock['items'][number], content: Paragraph[], headingsEnabled: boolean) {
  const normalized = normalizeListSegment(content);
  if (!headingsEnabled) {
    const { title: _title, titleContent: _titleContent, ...rest } = item;
    return { ...rest, content: normalized };
  }
  if (!normalized.some(paragraph => !paragraphIsBlank(paragraph))) return { ...item, title: 'New item', titleContent: undefined, content: [] };
  const { heading, body } = splitFirstLine(normalized);
  return { ...item, title: paragraphText(heading), titleContent: [heading], content: body };
}

export function updateListItemEditorContent(block: ListBlock, index: number, content: Paragraph[]): {
  block: ListBlock;
  createdItemId?: string;
} {
  const item = block.items[index];
  if (!item) return { block };
  const headingsEnabled = block.headingsEnabled !== false;
  const segments = splitAtListSeparators(content);
  if (!segments) {
    const updated = itemFromEditorContent(item, content, headingsEnabled);
    return { block: { ...block, items: block.items.map((candidate, itemIndex) => itemIndex === index ? updated : candidate) } };
  }
  const parsed = segments.map((segment, segmentIndex) => itemFromEditorContent(
    segmentIndex ? { id: `list-item-${randomId()}`, content: [] } : item,
    segment,
    headingsEnabled,
  ));
  const trailingItem = segments.at(-1)?.some(paragraph => !paragraphIsBlank(paragraph)) === false ? parsed.at(-1) : undefined;
  return {
    block: { ...block, items: [...block.items.slice(0, index), ...parsed, ...block.items.slice(index + 1)] },
    ...(trailingItem ? { createdItemId: trailingItem.id } : {}),
  };
}
