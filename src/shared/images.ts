import { libraryFamilies } from './library.js';
import type { AssetRef, LibraryCatalogEntry, LibraryFolder, LibraryItemV1, LibraryManifestV1 } from './types.js';

export interface LibraryImageChoice {
  id: string;
  version: number;
  title: string;
  asset: AssetRef;
  folderId?: string;
}

export const isImageAsset = (asset: AssetRef) => asset.mediaType.startsWith('image/');
const folders = (library?: LibraryManifestV1) => library?.folders ?? library?.imageFolders ?? [];
const imageCatalog = (library?: LibraryManifestV1) => library?.catalog
  ?? (library?.imageCatalog ?? []).map(entry => ({ targetKind: 'library-item' as const, targetId: entry.imageId, folderId: entry.folderId, displayName: entry.displayName }));

export function libraryImageChoices(library?: LibraryManifestV1): LibraryImageChoice[] {
  return libraryFamilies(library?.items ?? [])
    .filter(family => family.kind === 'image')
    .flatMap(family => {
      const item = family.versions[0];
      const asset = item.assets?.find(isImageAsset);
      const catalog = imageCatalog(library).find(entry => entry.targetKind === 'library-item' && entry.targetId === item.id);
      return asset ? [{ id: item.id, version: item.version, title: catalog?.displayName?.trim() || item.title, asset, folderId: catalog?.folderId }] : [];
    });
}

export function nextImageLibraryItem(
  library: LibraryManifestV1 | undefined,
  input: { id: string; title: string; asset: AssetRef; notice?: string }
): LibraryItemV1 {
  const id = input.id.trim();
  const version = Math.max(0, ...(library?.items ?? []).filter(item => item.id === id).map(item => item.version)) + 1;
  return {
    id,
    version,
    kind: 'image',
    title: input.title.trim(),
    assets: [input.asset],
    ...(input.notice?.trim() ? { license: { notice: input.notice.trim() } } : {})
  };
}

export function imageLibraryId(title: string) {
  return title.toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export function imageFolderChildren(library: LibraryManifestV1 | undefined, parentId?: string) {
  return folders(library).filter(folder => folder.parentId === parentId).sort((left, right) => left.name.localeCompare(right.name));
}

export function imageFolderAncestors(library: LibraryManifestV1 | undefined, folderId?: string) {
  const folderMap = new Map(folders(library).map(folder => [folder.id, folder]));
  const result: LibraryFolder[] = [];
  const visited = new Set<string>();
  let current = folderId ? folderMap.get(folderId) : undefined;
  while (current && !visited.has(current.id)) {
    result.unshift(current);
    visited.add(current.id);
    current = current.parentId ? folderMap.get(current.parentId) : undefined;
  }
  return result;
}

export function imageFolderDescendantIds(library: LibraryManifestV1 | undefined, folderId: string) {
  const result = new Set<string>();
  const visit = (id: string) => {
    for (const child of imageFolderChildren(library, id)) {
      if (result.has(child.id)) continue;
      result.add(child.id);
      visit(child.id);
    }
  };
  visit(folderId);
  return result;
}

export function imageFolderNameAvailable(library: LibraryManifestV1 | undefined, name: string, parentId?: string, excludingId?: string) {
  const normalized = name.trim().toLocaleLowerCase();
  return Boolean(normalized) && !folders(library).some(folder =>
    folder.id !== excludingId && folder.parentId === parentId && folder.name.trim().toLocaleLowerCase() === normalized
  );
}

export function setImageCatalogEntry(library: LibraryManifestV1, entry: { imageId: string; folderId?: string; displayName?: string }) {
  const catalogEntry: LibraryCatalogEntry = {
    targetKind: 'library-item',
    targetId: entry.imageId,
    ...(entry.folderId ? { folderId: entry.folderId } : {}),
    ...(entry.displayName ? { displayName: entry.displayName } : {})
  };
  return {
    ...library,
    catalog: [...imageCatalog(library).filter(item => item.targetKind !== 'library-item' || item.targetId !== entry.imageId), catalogEntry]
  };
}
