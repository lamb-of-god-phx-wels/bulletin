import { describe, expect, it } from 'vitest';
import { imageFolderAncestors, imageFolderDescendantIds, imageFolderNameAvailable, imageLibraryId, libraryImageChoices, nextImageLibraryItem, setImageCatalogEntry } from '../src/shared/images';
import type { LibraryManifestV1 } from '../src/shared/types';

const image = { path: 'assets/library/banner.png', mediaType: 'image/png' as const, alt: 'Banner' };
const library: LibraryManifestV1 = {
  schemaVersion: 1,
  name: 'Shared',
  items: [
    { id: 'banner', version: 1, kind: 'image', title: 'Old banner', assets: [image] },
    { id: 'banner', version: 2, kind: 'image', title: 'Current banner', assets: [{ ...image, path: 'assets/library/banner-v2.png' }] },
    { id: 'pdf-art', version: 1, kind: 'image', title: 'PDF art', assets: [{ path: 'assets/art.pdf', mediaType: 'application/pdf' }] },
    { id: 'song-art', version: 1, kind: 'song', title: 'Song', assets: [image] }
  ],
  folders: [
    { id: 'seasonal', name: 'Seasonal' },
    { id: 'advent', name: 'Advent', parentId: 'seasonal' }
  ],
  catalog: [{ targetKind: 'library-item', targetId: 'banner', folderId: 'advent', displayName: 'Advent banner' }]
};

describe('library images', () => {
  it('offers the newest raster or SVG asset from each image family', () => {
    expect(libraryImageChoices(library)).toEqual([{
      id: 'banner',
      version: 2,
      title: 'Advent banner',
      asset: { ...image, path: 'assets/library/banner-v2.png' },
      folderId: 'advent'
    }]);
  });

  it('creates the next version with image metadata', () => {
    expect(nextImageLibraryItem(library, {
      id: 'banner',
      title: 'Summer banner',
      asset: image,
      notice: 'Used with permission'
    })).toEqual({
      id: 'banner',
      version: 3,
      kind: 'image',
      title: 'Summer banner',
      assets: [image],
      license: { notice: 'Used with permission' }
    });
  });

  it('makes stable IDs from uploaded file names', () => {
    expect(imageLibraryId('Summer Picnic 2026.PNG')).toBe('summer-picnic-2026');
  });

  it('navigates nested folders and enforces sibling names', () => {
    expect(imageFolderAncestors(library, 'advent').map(folder => folder.name)).toEqual(['Seasonal', 'Advent']);
    expect([...imageFolderDescendantIds(library, 'seasonal')]).toEqual(['advent']);
    expect(imageFolderNameAvailable(library, 'ADVENT', 'seasonal')).toBe(false);
    expect(imageFolderNameAvailable(library, 'Lent', 'seasonal')).toBe(true);
  });

  it('moves and renames catalog entries without changing image versions', () => {
    const next = setImageCatalogEntry(library, { imageId: 'banner', folderId: 'seasonal', displayName: 'Moved banner' });
    expect(next.items).toBe(library.items);
    expect(next.catalog).toContainEqual({ targetKind: 'library-item', targetId: 'banner', folderId: 'seasonal', displayName: 'Moved banner' });
  });
});
