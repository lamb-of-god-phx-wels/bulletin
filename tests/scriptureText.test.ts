import { describe, expect, it } from 'vitest';
import { scriptureParagraphsFromText, scripturePlainText, VERSE_NUMBER_END, VERSE_NUMBER_START } from '../src/shared/scriptureText';

describe('scripture text', () => {
  it('preserves explicitly marked verse numbers as superscript runs', () => {
    expect(scriptureParagraphsFromText(`${VERSE_NUMBER_START}16${VERSE_NUMBER_END} For God so loved the world`)[0].children).toEqual([
      { type: 'text', text: '16', marks: ['superscript'] },
      { type: 'text', text: 'For God so loved the world' }
    ]);
  });

  it('detects leading verse numbers in manually pasted passage lines', () => {
    expect(scriptureParagraphsFromText('16 For God so loved\n17 For God did not send', { detectLeadingNumbers: true })[0].children).toEqual([
      { type: 'text', text: '16', marks: ['superscript'] },
      { type: 'text', text: 'For God so loved' },
      { type: 'lineBreak' },
      { type: 'text', text: '17', marks: ['superscript'] },
      { type: 'text', text: 'For God did not send' }
    ]);
  });

  it('does not superscript ordinary numbers inside a verse', () => {
    expect(scriptureParagraphsFromText('He fasted for 40 days', { detectLeadingNumbers: true })[0].children).toEqual([
      { type: 'text', text: 'He fasted for 40 days' }
    ]);
  });

  it('round-trips hard line breaks and paragraph breaks without moving verse markers', () => {
    const content = scriptureParagraphsFromText(`${VERSE_NUMBER_START}1${VERSE_NUMBER_END} A psalm\nA deliberate poetry line\n\n${VERSE_NUMBER_START}2${VERSE_NUMBER_END} A new paragraph`);
    expect(content).toEqual([
      {
        type: 'paragraph',
        children: [
          { type: 'text', text: '1', marks: ['superscript'] },
          { type: 'text', text: 'A psalm' },
          { type: 'lineBreak' },
          { type: 'text', text: 'A deliberate poetry line' }
        ]
      },
      {
        type: 'paragraph',
        children: [
          { type: 'text', text: '2', marks: ['superscript'] },
          { type: 'text', text: 'A new paragraph' }
        ]
      }
    ]);
    expect(scripturePlainText(content)).toBe('1A psalm\nA deliberate poetry line\n\n2A new paragraph');
  });
});
