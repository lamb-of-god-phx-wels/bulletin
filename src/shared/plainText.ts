import type { Paragraph } from './types.js';

export function paragraphsFromPlainText(value: string, { preserveLineBreaks = false }: { preserveLineBreaks?: boolean } = {}): Paragraph[] {
  const normalized = value.replace(/\r\n?/g, '\n');
  return normalized.split(/\n[ \t]*\n+/).map(text => ({
    type: 'paragraph',
    children: [{ type: 'text', text: preserveLineBreaks ? text : text.replace(/\n/g, ' ') }]
  }));
}
