import type { Paragraph } from '../shared/types.js';
import type { StructuredText, StructuredTextBlock, StructuredTextInline } from './types.js';

function inlineValue(child: Paragraph['children'][number]): StructuredTextInline | undefined {
  if (child.type === 'lineBreak') return undefined;
  if (child.type === 'symbol') return { type: 'text', value: '✠' };
  if (child.marks?.includes('superscript')) return {
    type: 'verseNumber',
    value: child.text,
    marks: child.marks
  };
  return {
    type: 'text',
    value: child.text,
    ...(child.marks?.length ? { marks: child.marks } : {}),
    ...(child.marks?.includes('bold') ? { emphasis: 'bold' as const } : child.marks?.includes('italic') ? { emphasis: 'italic' as const } : {})
  };
}

export function structuredTextFromV1Paragraphs(paragraphs: Paragraph[]): StructuredText {
  const blocks: StructuredTextBlock[] = [];
  for (const paragraph of paragraphs) {
    let inlines: StructuredTextInline[] = [];
    const flush = () => {
      blocks.push({ type: 'paragraph', inlines });
      inlines = [];
    };
    for (const child of paragraph.children) {
      if (child.type === 'lineBreak') {
        flush();
        blocks.push({ type: 'lineBreak' });
      } else {
        const inline = inlineValue(child);
        if (inline) inlines.push(inline);
      }
    }
    flush();
  }
  return { blocks };
}
