import { describe, expect, it } from 'vitest';
import { normalizeLibrary } from '../src/shared/library';
import type { LibraryManifestV1 } from '../src/shared/types';

describe('library normalization', () => {
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
});
