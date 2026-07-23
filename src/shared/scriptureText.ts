import type { Inline, Paragraph } from './types.js';

export const VERSE_NUMBER_START = '\uE000';
export const VERSE_NUMBER_END = '\uE001';

function verseRuns(value: string): Inline[] {
  const children: Inline[] = [];
  const pattern = new RegExp(`${VERSE_NUMBER_START}(\\d{1,3})${VERSE_NUMBER_END}\\s*`, 'g');
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
  const normalized = value.replace(/\r\n?/g, '\n');
  return normalized.split(/\n\s*\n|\n+/).map(text => text.trim()).filter(Boolean).map(text => {
    const marked = detectLeadingNumbers
      ? text.replace(/^(\d{1,3})(?=[ \t\u00a0])/, `${VERSE_NUMBER_START}$1${VERSE_NUMBER_END}`)
      : text;
    return { type: 'paragraph', children: verseRuns(marked) };
  });
}
