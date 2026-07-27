import { describe, expect, it } from 'vitest';
import { libraryFamilies, normalizeLibrary } from '../src/shared/library';
import type { LibraryManifestV1 } from '../src/shared/types';

describe('library normalization', () => {
  it('removes the retired block-descriptor catalog from stored libraries', () => {
    const legacy = {
      schemaVersion: 1,
      name: 'Library',
      items: [],
      blockDescriptors: [{ schemaVersion: 1, id: 'old' }]
    } as unknown as LibraryManifestV1;
    expect(normalizeLibrary(legacy)).toEqual({ schemaVersion: 1, name: 'Library', items: [] });
  });

  it('converts legacy music items into songs', () => {
    const legacy = { schemaVersion: 1, name: 'Library', items: [{ id: 'anthem', version: 1, kind: 'music', title: 'Anthem', assets: [{ path: 'anthem.pdf', mediaType: 'application/pdf' }] }] } as unknown as LibraryManifestV1;
    expect(normalizeLibrary(legacy).items[0]).toMatchObject({ id: 'anthem', version: 1, kind: 'song' });
  });

  it('merges matching lyric and sheet-music records without losing either', () => {
    const legacy = { schemaVersion: 1, name: 'Library', items: [
      { id: 'anthem', version: 1, kind: 'song', title: 'Anthem', aliases: ['Hymn 1'], content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Lyrics' }] }] },
      { id: 'anthem', version: 1, kind: 'music', title: 'Anthem Music', assets: [{ path: 'anthem.pdf', mediaType: 'application/pdf' }], license: { notice: 'Licensed' } }
    ] } as unknown as LibraryManifestV1;
    const normalized = normalizeLibrary(legacy);
    expect(normalized.items).toHaveLength(1);
    expect(normalized.items[0]).toMatchObject({ kind: 'song', title: 'Anthem', aliases: ['Hymn 1'], content: [{ children: [{ text: 'Lyrics' }] }], assets: [{ path: 'anthem.pdf' }], license: { notice: 'Licensed' } });
  });

  it('returns an unchanged current library by reference', () => {
    const current: LibraryManifestV1 = { schemaVersion: 1, name: 'Library', items: [{ id: 'anthem', version: 1, kind: 'song', title: 'Anthem' }] };
    expect(normalizeLibrary(current)).toBe(current);
  });

  it('groups an item’s versions newest-first under one stable identity', () => {
    const items: LibraryManifestV1['items'] = [
      { id: 'anthem', version: 1, kind: 'song', title: 'Original Anthem' },
      { id: 'prayer', version: 1, kind: 'liturgy', title: 'Prayer' },
      { id: 'anthem', version: 2, kind: 'song', title: 'Revised Anthem' }
    ];
    expect(libraryFamilies(items)).toEqual([
      { id: 'prayer', kind: 'liturgy', versions: [items[1]] },
      { id: 'anthem', kind: 'song', versions: [items[2], items[0]] }
    ]);
  });
});
