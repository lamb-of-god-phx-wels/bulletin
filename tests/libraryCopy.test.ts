import { describe, expect, it, vi } from 'vitest';
import { copyEmbeddedAssets, uniqueCopyId, uniqueCopyName } from '../src/shared/libraryCopy';
import type { LibraryCatalogRecord } from '../src/shared/libraryCatalog';
import type { AssetRef } from '../src/shared/types';

describe('library copying', () => {
  it('chooses collision-safe names within only the destination folder', () => {
    const records = [
      { title: 'Logo copy', folderId: 'art' },
      { title: 'Logo copy 2', folderId: 'art' },
      { title: 'Logo copy', folderId: 'other' }
    ] as LibraryCatalogRecord[];
    const reserved: Array<{ title: string; folderId?: string }> = [];
    expect(uniqueCopyName('Logo', 'art', records, reserved)).toBe('Logo copy 3');
    expect(uniqueCopyName('Logo', 'art', records, reserved)).toBe('Logo copy 4');
    expect(uniqueCopyName('Logo', undefined, records, reserved)).toBe('Logo copy');
  });

  it('creates a stable unique ID for a copied family', () => {
    const used = new Set(['prayer-copy', 'prayer-copy-2']);
    expect(uniqueCopyId('Prayer copy', used, 'item')).toBe('prayer-copy-3');
    expect(used.has('prayer-copy-3')).toBe(true);
  });

  it('duplicates nested assets and reuses the duplicate for repeated references', async () => {
    const copy = vi.fn(async (asset: AssetRef, folder: string): Promise<AssetRef> => ({ ...asset, path: `${folder}/copied.png` }));
    const source = {
      hero: { path: 'assets/blobs/source.png', mediaType: 'image/png', alt: 'Hero' },
      blocks: [{ asset: { path: 'assets/blobs/source.png', mediaType: 'image/png', variant: 'thumbnail' } }]
    };
    const result = await copyEmbeddedAssets(source, 'assets/library/hero-copy', copy);
    expect(copy).toHaveBeenCalledTimes(1);
    expect(result.hero.path).toBe('assets/library/hero-copy/copied.png');
    expect(result.blocks[0].asset).toMatchObject({ path: 'assets/library/hero-copy/copied.png', variant: 'thumbnail' });
  });
});
