import { describe, expect, it } from 'vitest';
import { libraryFamilies, normalizeLibrary } from '../src/shared/library';
import { libraryCatalogRecords } from '../src/shared/libraryCatalog';
import type { LibraryManifestV1 } from '../src/shared/types';
import { defaultTemplate } from '../src/shared/defaults';

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

  it('migrates image-only organization into the universal folder catalog', () => {
    const legacy: LibraryManifestV1 = {
      schemaVersion: 1,
      name: 'Library',
      items: [],
      imageFolders: [{ id: 'seasonal', name: 'Seasonal' }],
      imageCatalog: [{ imageId: 'banner', folderId: 'seasonal', displayName: 'Banner art' }]
    };
    expect(normalizeLibrary(legacy)).toEqual({
      schemaVersion: 1,
      name: 'Library',
      items: [],
      folders: [{ id: 'seasonal', name: 'Seasonal' }],
      catalog: [{ targetKind: 'library-item', targetId: 'banner', folderId: 'seasonal', displayName: 'Banner art' }]
    });
  });

  it('repairs invalid folder parents and catalog locations deterministically', () => {
    const malformed: LibraryManifestV1 = {
      schemaVersion: 1,
      name: 'Library',
      items: [],
      folders: [{ id: 'a', name: 'A', parentId: 'b' }, { id: 'b', name: 'B', parentId: 'a' }],
      catalog: [{ targetKind: 'component', targetId: 'bulletin:prayer', folderId: 'missing' }]
    };
    expect(normalizeLibrary(malformed)).toMatchObject({
      folders: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      catalog: [{ targetKind: 'component', targetId: 'bulletin:prayer' }]
    });
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

  it('keeps church calendar events out of the universal library browser', () => {
    const library: LibraryManifestV1 = {
      schemaVersion: 1,
      name: 'Library',
      items: [{ id: 'anthem', version: 1, kind: 'song', title: 'Anthem' }],
      calendarEvents: [{ id: 'easter', name: 'Easter', enabled: true, priority: 100, rules: [{ kind: 'easter' }] }],
      catalog: [{ targetKind: 'calendar-event', targetId: 'easter', folderId: 'seasonal' }]
    };
    expect(libraryCatalogRecords(library).map(record => record.targetId)).toEqual(['anthem']);
    expect(normalizeLibrary(library).catalog).toBeUndefined();
  });

  it('shows published bulletin templates as folder-organizable library records', () => {
    const library: LibraryManifestV1 = {
      schemaVersion: 1, name: 'Library', items: [],
      folders: [{ id: 'services', name: 'Services' }],
      catalog: [{ targetKind: 'template', targetId: 'festival', folderId: 'services', displayName: 'Festival service' }]
    };
    const records = libraryCatalogRecords(library, [], [], [
      { ...defaultTemplate, id: 'festival', name: 'Festival', version: 1, status: 'published' },
      { ...defaultTemplate, id: 'festival', name: 'Festival', version: 2, status: 'published' }
    ]);
    expect(records).toEqual([expect.objectContaining({ targetKind: 'template', targetId: 'festival', title: 'Festival service', folderId: 'services', versionCount: 2 })]);
  });
});
