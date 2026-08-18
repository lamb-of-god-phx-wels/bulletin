import { describe, expect, it } from 'vitest';
import { migrateLegacyBulletin } from '../src/shared/migrate';

describe('legacy bulletin migration', () => {
  it('normalizes the known example date, readings, verse selections, and cross symbols', () => {
    const migrated = migrateLegacyBulletin({
      churchInfo: { name: 'Lamb of God Lutheran Church' },
      bulletinInfo: { title: 'God Loves Sinners', date: { type: 'date', data: '2026-07-20' }, churchWeek: 'Second Sunday' },
      content: [
        { type: 'responsiveReading', content: [{ reader: 'M', content: [{ type: 'text', text: 'In the name of <<cross>> Jesus.' }] }] },
        { type: 'scriptureReading', label: 'Gospel', scriptureReference: 'Matthew 9:9-13', translation: 'niv' },
        { type: 'song', songType: 'hymn', hymnNumber: 'CW399', verses: [1, 3], lyricsOnly: true }
      ]
    });
    expect(migrated.info.date).toBe('2026-06-07');
    expect(migrated.blocks[1]).toMatchObject({ type: 'scriptureReading', reference: 'Matthew 9:9-13', translation: 'NIV' });
    expect(migrated.blocks[2]).toMatchObject({ type: 'song', libraryItemId: 'cw399', selection: { mode: 'verses', verses: [1, 3] } });
    expect(migrated.blocks[0]).toMatchObject({ type: 'responsiveReading', entries: [{ reader: 'M', role: 'leader' }] });
    expect(JSON.stringify(migrated.blocks[0])).toContain('"name":"cross"');
  });

  it('creates stable unique IDs when headings repeat', () => {
    const migrated = migrateLegacyBulletin({ bulletinInfo: { date: { data: '2026-01-01' } }, content: [{ type: 'heading', text: 'Prayer' }, { type: 'heading', text: 'Prayer' }] });
    expect(migrated.blocks.map(block => block.id)).toEqual(['prayer', 'prayer-2']);
    expect(migrated.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'heading', level: 'h3' }),
    ]));
  });

  it('migrates legacy section headings into H2 headings', () => {
    const migrated = migrateLegacyBulletin({ bulletinInfo: { date: { data: '2026-01-01' } }, content: [{ type: 'sectionHeading', text: 'The Word' }] });
    expect(migrated.blocks[0]).toMatchObject({ type: 'heading', level: 'h2', text: 'The Word' });
  });
});
