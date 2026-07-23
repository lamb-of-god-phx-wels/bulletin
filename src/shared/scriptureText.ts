import type { Inline, Paragraph } from './types.js';

export const VERSE_NUMBER_START = '\uE000';
export const VERSE_NUMBER_END = '\uE001';
export const SCRIPTURE_LINE_BREAK = '\uE002';
export const SCRIPTURE_PARAGRAPH_BREAK = '\uE003';

function verseRuns(value: string): Inline[] {
  const children: Inline[] = [];
  const pattern = new RegExp(`${VERSE_NUMBER_START}(\\d{1,3})${VERSE_NUMBER_END}[ \\t\\u00a0]*`, 'g');
  let offset = 0;
  for (const match of value.matchAll(pattern)) {
    if (match.index! > offset) children.push({ type: 'text', text: value.slice(offset, match.index) });
    children.push({ type: 'text', text: match[1], marks: ['superscript'] });
    offset = match.index! + match[0].length;
  }
  if (offset < value.length) children.push({ type: 'text', text: value.slice(offset) });
  return children.length ? children : [{ type: 'text', text: value }];
}

export function scriptureParagraphsFromText(value: string, { detectLeadingNumbers = false }: { detectLeadingNumbers?: boolean } = {}): Paragraph[] {
  const normalized = value
    .replace(/\r\n?/g, '\n')
    .replaceAll(SCRIPTURE_PARAGRAPH_BREAK, '\n\n')
    .replaceAll(SCRIPTURE_LINE_BREAK, '\n')
    .trim();
  if (!normalized) return [{ type: 'paragraph', children: [{ type: 'text', text: '' }] }];
  return normalized.split(/\n[ \t]*\n+/).map(paragraphText => {
    const lines = paragraphText.split('\n');
    const children: Inline[] = [];
    lines.forEach((line, index) => {
      const marked = detectLeadingNumbers
        ? line.replace(/^[ \t]*(\d{1,3})(?=[ \t\u00a0])/, `${VERSE_NUMBER_START}$1${VERSE_NUMBER_END}`)
        : line;
      if (index) children.push({ type: 'lineBreak' });
      children.push(...verseRuns(marked.trimEnd()));
    });
    return { type: 'paragraph', children };
  });
}

export function scripturePlainText(content: Paragraph[]): string {
  return content.map(paragraph => paragraph.children.map(child => {
    if (child.type === 'lineBreak') return '\n';
    if (child.type === 'symbol') return '✠';
    return child.text;
  }).join('')).join('\n\n');
}
