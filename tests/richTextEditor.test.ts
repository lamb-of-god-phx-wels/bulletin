import { describe, expect, it } from 'vitest';
import { formatTextRange, selectedTextMarks } from '../src/components/RichTextEditor';
import type { Paragraph } from '../src/shared/types';

describe('rich-text segment formatting', () => {
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
});
