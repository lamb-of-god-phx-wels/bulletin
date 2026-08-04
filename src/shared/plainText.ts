import type { Paragraph } from './types.js';

export function paragraphsHaveVisibleContent(content: Paragraph[] | undefined): boolean {
  return Boolean(content?.some(paragraph => paragraph.children.some(run =>
    run.type === 'symbol' || (run.type === 'text' && run.text.trim().length > 0)
  )));
}

export function paragraphsFromPlainText(value: string, { preserveLineBreaks = false }: { preserveLineBreaks?: boolean } = {}): Paragraph[] {
  const normalized = value.replace(/\r\n?/g, '\n');
  return normalized.split(/\n[ \t]*\n+/).map(text => ({
    type: 'paragraph',
    children: [{ type: 'text', text: preserveLineBreaks ? text : text.replace(/\n/g, ' ') }]
  }));
}
