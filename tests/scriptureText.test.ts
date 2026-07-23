import { describe, expect, it } from 'vitest';
import { scriptureParagraphsFromText, VERSE_NUMBER_END, VERSE_NUMBER_START } from '../src/shared/scriptureText';

describe('scripture text', () => {
  it('preserves explicitly marked verse numbers as superscript runs', () => {
    expect(scriptureParagraphsFromText(`${VERSE_NUMBER_START}16${VERSE_NUMBER_END} For God so loved the world`)[0].children).toEqual([
      { type: 'text', text: '16', marks: ['superscript'] },
      { type: 'text', text: 'For God so loved the world' }
    ]);
  });

  it('detects leading verse numbers in manually pasted passage lines', () => {
    expect(scriptureParagraphsFromText('16 For God so loved\n17 For God did not send', { detectLeadingNumbers: true }).map(paragraph => paragraph.children[0])).toEqual([
      { type: 'text', text: '16', marks: ['superscript'] },
      { type: 'text', text: '17', marks: ['superscript'] }
    ]);
  });

  it('does not superscript ordinary numbers inside a verse', () => {
    expect(scriptureParagraphsFromText('He fasted for 40 days', { detectLeadingNumbers: true })[0].children).toEqual([
      { type: 'text', text: 'He fasted for 40 days' }
    ]);
  });
});
