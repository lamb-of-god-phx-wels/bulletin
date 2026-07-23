import { describe, expect, it } from 'vitest';
import { paragraphsFromPlainText } from '../src/shared/plainText';

describe('plain text paragraphs', () => {
  it('preserves lyric lines while using blank lines as verse boundaries', () => {
    expect(paragraphsFromPlainText('First line\r\nSecond line\r\n\r\nThird line\nFourth line', { preserveLineBreaks: true })).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: 'First line\nSecond line' }] },
      { type: 'paragraph', children: [{ type: 'text', text: 'Third line\nFourth line' }] }
    ]);
  });

  it('continues to flow ordinary single-line breaks as prose', () => {
    expect(paragraphsFromPlainText('First line\nSecond line')[0].children[0]).toEqual({ type: 'text', text: 'First line Second line' });
  });
});
