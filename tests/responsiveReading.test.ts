import { describe, expect, it } from 'vitest';
import {
  defaultReaderForRole,
  defaultResponsiveReadingSettings,
  parseResponsiveReadingContent,
  responsiveEntryReader,
  responsiveEntryRole,
  responsiveReadingEditorContent,
  safeParseResponsiveReadingContent,
  shouldItalicizeSilentPrayer,
  updateResponsiveReaderLabels,
} from '../src/shared/responsiveReading';
import type { BulletinBlock, Paragraph, ResponsiveReadingSettings } from '../src/shared/types';

describe('responsive reading roles', () => {
  it('keeps explicit leader and follower roles independent of their display labels', () => {
    expect(responsiveEntryRole({ reader: 'Pastor', role: 'leader' })).toBe('leader');
    expect(responsiveEntryRole({ reader: 'Everyone', role: 'follower' })).toBe('follower');
  });

  it('recognizes existing congregation labels without requiring a data migration', () => {
    expect(responsiveEntryRole({ reader: 'M' })).toBe('leader');
    expect(responsiveEntryRole({ reader: 'C' })).toBe('follower');
    expect(responsiveEntryRole({ reader: 'C (cont.)' })).toBe('follower');
    expect(responsiveEntryRole({ reader: 'All' })).toBe('all');
  });

  it('uses the template defaults for newly selected roles', () => {
    expect(defaultReaderForRole('leader')).toBe('M');
    expect(defaultReaderForRole('follower')).toBe('C');
    expect(defaultReaderForRole('all')).toBe('All');
  });

  it('parses configured prefixes, formatting, hard lines, paragraphs, and all responses', () => {
    const source: Paragraph[] = [
      { type: 'paragraph', children: [
        { type: 'text', text: 'm: First words', marks: ['italic'] },
        { type: 'lineBreak' },
        { type: 'text', text: 'continued' },
        { type: 'lineBreak' },
        { type: 'text', text: 'C: Congregation', marks: ['bold'] },
      ] },
      { type: 'paragraph', align: 'center', children: [{ type: 'text', text: 'second paragraph' }] },
      { type: 'paragraph', children: [{ type: 'text', text: 'All: Amen: indeed' }, { type: 'symbol', name: 'cross' }] },
    ];
    const result = parseResponsiveReadingContent(source, defaultResponsiveReadingSettings);
    expect(result.entries).toHaveLength(3);
    expect(result.entries?.[0]).toMatchObject({ role: 'leader', readerMode: 'configured', content: [{ children: [{ text: 'First words', marks: ['italic'] }] }, { breakBefore: 'line', children: [{ text: 'continued' }] }] });
    expect(result.entries?.[1]).toMatchObject({ role: 'follower', content: [{ children: [{ text: 'Congregation', marks: ['bold'] }] }, { align: 'center', children: [{ text: 'second paragraph' }] }] });
    expect(result.entries?.[2]).toMatchObject({ role: 'all', content: [{ children: [{ text: 'Amen: indeed' }, { type: 'symbol', name: 'cross' }] }] });
  });

  it('round-trips configured and legacy custom labels and rejects leading raw text', () => {
    const settings: ResponsiveReadingSettings = { labels: { leader: 'Pastor', follower: 'People', all: 'Together' } };
    const entries = [
      { reader: 'M', role: 'leader' as const, content: [{ type: 'paragraph' as const, children: [{ type: 'text' as const, text: 'Configured leader' }] }] },
      { reader: 'Cantor', role: 'leader' as const, readerMode: 'custom' as const, content: [{ type: 'paragraph' as const, children: [{ type: 'text' as const, text: 'Custom leader' }] }] },
    ];
    const serialized = responsiveReadingEditorContent(entries, settings);
    expect(serialized[0].children[0]).toMatchObject({ text: 'Pastor: ' });
    expect(serialized[1].children[0]).toMatchObject({ text: 'Cantor: ' });
    expect(parseResponsiveReadingContent(serialized, settings, entries).entries).toMatchObject([
      { reader: 'Pastor', readerMode: 'configured' },
      { reader: 'Cantor', readerMode: 'custom' },
    ]);
    expect(safeParseResponsiveReadingContent([{ type: 'paragraph', children: [{ type: 'text', text: 'No prefix yet' }] }], settings).error).toMatch(/configured reader label/i);
  });

  it('stores one newline as a hard break and blank lines as paragraph boundaries', () => {
    const result = parseResponsiveReadingContent([{
      type: 'paragraph',
      children: [
        { type: 'text', text: 'M: First line' },
        { type: 'lineBreak' },
        { type: 'text', text: 'Second line' },
        { type: 'lineBreak' },
        { type: 'lineBreak' },
        { type: 'text', text: 'Second paragraph' },
        { type: 'lineBreak' },
        { type: 'lineBreak' },
        { type: 'lineBreak' },
        { type: 'text', text: 'Third paragraph' },
      ],
    }], defaultResponsiveReadingSettings);
    expect(result.entries?.[0].content).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: 'First line' }] },
      { type: 'paragraph', breakBefore: 'line', children: [{ type: 'text', text: 'Second line' }] },
      { type: 'paragraph', children: [{ type: 'text', text: 'Second paragraph' }] },
      { type: 'paragraph', children: [{ type: 'text', text: 'Third paragraph' }] },
    ]);
  });

  it('parses only an exact standalone Silent Prayer line as a special element', () => {
    const result = parseResponsiveReadingContent([{
      type: 'paragraph',
      children: [
        { type: 'text', text: 'M: Let us pray.' },
        { type: 'lineBreak' },
        { type: 'text', text: 'Silent Prayer' },
        { type: 'lineBreak' },
        { type: 'text', text: 'M: Amen.' },
      ],
    }], defaultResponsiveReadingSettings);
    expect(result.entries).toMatchObject([
      { role: 'leader', content: [{ children: [{ text: 'Let us pray.' }] }] },
      { reader: '', element: 'silentPrayer', content: [{ children: [{ text: 'Silent Prayer' }] }] },
      { role: 'leader', content: [{ children: [{ text: 'Amen.' }] }] },
    ]);
    expect(responsiveReadingEditorContent(result.entries!, defaultResponsiveReadingSettings)).toMatchObject([
      { children: [{ text: 'M: ' }, { text: 'Let us pray.' }] },
      { children: [{ text: 'Silent Prayer' }] },
      { children: [{ text: 'M: ' }, { text: 'Amen.' }] },
    ]);
    expect(parseResponsiveReadingContent([
      { type: 'paragraph', children: [{ type: 'text', text: 'Silent Prayer' }] },
    ], defaultResponsiveReadingSettings).entries).toMatchObject([{ element: 'silentPrayer' }]);

    for (const text of ['silent prayer', 'Silent Prayer ', 'A Silent Prayer']) {
      const parsed = parseResponsiveReadingContent([{ type: 'paragraph', children: [{ type: 'text', text: `M: ${text}` }] }], defaultResponsiveReadingSettings);
      expect(parsed.entries?.[0]).not.toHaveProperty('element');
    }
  });

  it('defaults automatic Silent Prayer italics to enabled', () => {
    expect(defaultResponsiveReadingSettings.italicizeSilentPrayer).toBe(true);
    expect(shouldItalicizeSilentPrayer({ labels: { leader: 'M', follower: 'C', all: 'All' } })).toBe(true);
    expect(shouldItalicizeSilentPrayer({ labels: { leader: 'M', follower: 'C', all: 'All' }, italicizeSilentPrayer: false })).toBe(false);
  });

  it('preserves independent alignment for each hard line', () => {
    const result = parseResponsiveReadingContent([
      { type: 'paragraph', align: 'left', children: [{ type: 'text', text: 'M: First line' }] },
      { type: 'paragraph', breakBefore: 'line', align: 'right', children: [{ type: 'text', text: 'Second line' }] },
      { type: 'paragraph', align: 'center', children: [{ type: 'text', text: 'New paragraph' }] },
    ], defaultResponsiveReadingSettings);
    expect(result.entries?.[0].content).toMatchObject([
      { align: 'left', children: [{ text: 'First line' }] },
      { breakBefore: 'line', align: 'right', children: [{ text: 'Second line' }] },
      { align: 'center', children: [{ text: 'New paragraph' }] },
    ]);
  });

  it('updates canonical labels recursively while preserving custom labels', () => {
    const reading: BulletinBlock = { id: 'reading', type: 'responsiveReading', entries: [
      { reader: 'M', role: 'leader', content: [] },
      { reader: 'Pastor', role: 'leader', content: [] },
    ] };
    const next = { labels: { leader: 'L', follower: 'P', all: 'A' } } satisfies ResponsiveReadingSettings;
    const blocks = updateResponsiveReaderLabels([{ id: 'group', type: 'group', children: [reading] }], defaultResponsiveReadingSettings, next);
    const nested = blocks[0].type === 'group' ? blocks[0].children[0] : undefined;
    expect(nested).toMatchObject({ entries: [
      { reader: 'L', readerMode: 'configured' },
      { reader: 'Pastor', readerMode: 'custom' },
    ] });
    if (nested?.type === 'responsiveReading') expect(responsiveEntryReader(nested.entries[0], next)).toBe('L');
  });
});
