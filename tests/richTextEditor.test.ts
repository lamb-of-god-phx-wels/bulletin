import { describe, expect, it } from 'vitest';
import { alignParagraphRange, effectiveSelectedTextStyle, formatParagraphRange, formatTextRange, formatTextStyleRange, selectedTextMarks, structuredTextForClipboard } from '../src/components/RichTextEditor';
import type { Paragraph } from '../src/shared/types';

describe('rich-text segment formatting', () => {
  it('reports the inherited block font for unformatted live text', () => {
    const content: Paragraph[] = [{ type: 'paragraph', children: [{ type: 'text', text: 'Display text' }] }];
    expect(effectiveSelectedTextStyle(content, 0, 7, { fontRef: { kind: 'themeRole', roleId: 'display' } })).toMatchObject({ fontRef: { kind: 'themeRole', roleId: 'display' } });
    const styled = formatTextStyleRange(content, 0, 7, { fontRef: { kind: 'libraryFont', family: { id: 'font', version: 2 } } });
    expect(effectiveSelectedTextStyle(styled, 0, 7, { fontRef: { kind: 'themeRole', roleId: 'display' } })).toMatchObject({ fontRef: { kind: 'libraryFont', family: { id: 'font', version: 2 } } });
  });

  it('formats only the selected characters within a text run', () => {
    const content: Paragraph[] = [{
      type: 'paragraph',
      children: [{ type: 'text', text: 'The Book Title is licensed.' }],
    }];

    expect(formatTextRange(content, 4, 14, 'italic')).toEqual([{
      type: 'paragraph',
      children: [
        { type: 'text', text: 'The ' },
        { type: 'text', text: 'Book Title', marks: ['italic'] },
        { type: 'text', text: ' is licensed.' },
      ],
    }]);
  });

  it('combines, toggles, and clears marks without changing adjacent text', () => {
    const content: Paragraph[] = [{
      type: 'paragraph',
      children: [
        { type: 'text', text: 'One ' },
        { type: 'text', text: 'important', marks: ['italic'] },
        { type: 'text', text: ' notice' },
      ],
    }];

    const combined = formatTextRange(content, 4, 13, 'bold');
    expect(combined[0].children[1]).toEqual({ type: 'text', text: 'important', marks: ['bold', 'italic'] });
    expect(selectedTextMarks(combined, 4, 13)).toEqual(['bold', 'italic']);

    const toggled = formatTextRange(combined, 4, 13, 'italic');
    expect(toggled[0].children[1]).toEqual({ type: 'text', text: 'important', marks: ['bold'] });

    const cleared = formatTextRange(combined, 4, 13);
    expect(cleared[0].children).toEqual([
      { type: 'text', text: 'One important notice' },
    ]);
  });

  it('aligns only paragraphs touched by the selection', () => {
    const content: Paragraph[] = [
      { type: 'paragraph', children: [{ type: 'text', text: 'First' }] },
      { type: 'paragraph', children: [{ type: 'text', text: 'Second' }] },
    ];
    expect(alignParagraphRange(content, 0, 4, 'center')).toEqual([
      { ...content[0], align: 'center' },
      content[1],
    ]);
  });

  it('applies font, size, capitalization, and spacing only to the selected range', () => {
    const content: Paragraph[] = [
      { type: 'paragraph', children: [{ type: 'text', text: 'First second' }] },
      { type: 'paragraph', children: [{ type: 'text', text: 'Third' }] },
    ];
    expect(formatTextStyleRange(content, 6, 12, { fontFamily: 'display', fontSizePt: 18, textTransform: 'uppercase' })[0].children).toEqual([
      { type: 'text', text: 'First ' },
      { type: 'text', text: 'second', style: { fontFamily: 'display', fontSizePt: 18, textTransform: 'uppercase' } },
    ]);
    expect(formatParagraphRange(content, 0, 5, { align: 'justify', lineHeight: 1.5 })).toEqual([
      { ...content[0], align: 'justify', lineHeight: 1.5 },
      content[1],
    ]);
  });

  it('copies hard lines with one newline and paragraphs with two', () => {
    expect(structuredTextForClipboard([
      { type: 'paragraph', children: [{ type: 'text', text: 'First' }] },
      { type: 'paragraph', breakBefore: 'line', children: [{ type: 'text', text: 'Second' }] },
      { type: 'paragraph', children: [{ type: 'text', text: 'Third' }] },
    ])).toBe('First\nSecond\n\nThird');
  });
});
