import type { LibraryItemV1, LibraryManifestV1 } from './types.js';

export interface LibraryFamily { id: string; kind: LibraryItemV1['kind']; versions: LibraryItemV1[] }

export function libraryFamilies(items: LibraryItemV1[]): LibraryFamily[] {
  const families = new Map<string, LibraryItemV1[]>();
  for (const item of items) families.set(item.id, [...(families.get(item.id) ?? []), item]);
  return [...families.entries()].map(([id, versions]) => {
    versions.sort((left, right) => right.version - left.version);
    return { id, kind: versions[0].kind, versions };
  }).sort((left, right) => left.versions[0].title.localeCompare(right.versions[0].title));
}

function mergeSongItems(first: LibraryItemV1, second: LibraryItemV1): LibraryItemV1 {
  const assets = [...(first.assets ?? []), ...(second.assets ?? [])].filter((asset, index, all) => all.findIndex(candidate => candidate.path === asset.path && candidate.variant === asset.variant) === index);
  const aliases = [...(first.aliases ?? []), ...(second.aliases ?? [])].filter((alias, index, all) => all.indexOf(alias) === index);
  const notices = [first.license?.notice, second.license?.notice].filter((notice, index, all): notice is string => Boolean(notice) && all.indexOf(notice) === index);
  const license = first.license || second.license ? { ...second.license, ...first.license, notice: notices.join('\n') } : undefined;
  return {
    ...second,
    ...first,
    kind: 'song',
    title: first.title || second.title,
    ...(first.content ?? second.content ? { content: first.content ?? second.content } : {}),
    ...(assets.length ? { assets } : {}),
    ...(aliases.length ? { aliases } : {}),
    ...(license ? { license } : {})
  };
}

const supportedLibraryKinds = new Set(['song', 'liturgy', 'image', 'font', 'music']);

export function normalizeLibrary(library: LibraryManifestV1): LibraryManifestV1 {
  const stored = library as LibraryManifestV1 & { blockDescriptors?: unknown };
  const { blockDescriptors: removedLegacyDescriptors, ...currentLibrary } = stored;
  let changed = removedLegacyDescriptors !== undefined;
  const items: LibraryItemV1[] = [];
  const songs = new Map<string, number>();
  for (const original of currentLibrary.items) {
    if (!supportedLibraryKinds.has((original as { kind: string }).kind)) {
      changed = true;
      continue;
    }
    const legacyMusic = (original.kind as string) === 'music';
    const item: LibraryItemV1 = legacyMusic ? { ...original, kind: 'song' } : original;
    changed ||= legacyMusic;
    if (item.kind !== 'song') { items.push(item); continue; }
    const key = `${item.id}:${item.version}`;
    const existingIndex = songs.get(key);
    if (existingIndex === undefined) { songs.set(key, items.length); items.push(item); continue; }
    items[existingIndex] = mergeSongItems(items[existingIndex], item); changed = true;
  }
  const folders = currentLibrary.folders ?? currentLibrary.imageFolders ?? [];
  changed ||= currentLibrary.imageFolders !== undefined || currentLibrary.imageCatalog !== undefined;
  if (!currentLibrary.folders && currentLibrary.imageFolders?.length) changed = true;
  const uniqueFolders = folders.filter((folder, index) => Boolean(folder.id && folder.name.trim()) && folders.findIndex(candidate => candidate.id === folder.id) === index);
  const folderIds = new Set(uniqueFolders.map(folder => folder.id));
  const normalizedFolders = uniqueFolders.map(folder => {
    if (!folder.parentId || folder.parentId === folder.id || !folderIds.has(folder.parentId)) {
      if (folder.parentId) changed = true;
      return folder.parentId ? { id: folder.id, name: folder.name } : folder;
    }
    const visited = new Set([folder.id]);
    let parentId: string | undefined = folder.parentId;
    while (parentId) {
      if (visited.has(parentId)) {
        changed = true;
        return { id: folder.id, name: folder.name };
      }
      visited.add(parentId);
      parentId = uniqueFolders.find(candidate => candidate.id === parentId)?.parentId;
    }
    return folder;
  });
  changed ||= normalizedFolders.length !== folders.length;
  const legacyCatalog = (currentLibrary.imageCatalog ?? []).map(entry => ({
    targetKind: 'library-item' as const,
    targetId: entry.imageId,
    ...(entry.folderId ? { folderId: entry.folderId } : {}),
    ...(entry.displayName ? { displayName: entry.displayName } : {})
  }));
  if (!currentLibrary.catalog && legacyCatalog.length) changed = true;
  const sourceCatalog = currentLibrary.catalog ?? legacyCatalog;
  const catalog = sourceCatalog.filter((entry, index, all) =>
    entry.targetKind !== 'calendar-event'
    && entry.targetId
    && all.findIndex(candidate => candidate.targetKind === entry.targetKind && candidate.targetId === entry.targetId) === index
  ).map(entry => entry.folderId && !folderIds.has(entry.folderId)
    ? { targetKind: entry.targetKind, targetId: entry.targetId, ...(entry.displayName ? { displayName: entry.displayName } : {}) }
    : entry);
  changed ||= catalog.length !== sourceCatalog.length
    || catalog.some((entry, index) => JSON.stringify(entry) !== JSON.stringify(sourceCatalog[index]));
  const { imageFolders: _legacyFolders, imageCatalog: _legacyCatalog, ...generalLibrary } = currentLibrary;
  return changed ? {
    ...generalLibrary,
    items,
    ...(normalizedFolders.length ? { folders: normalizedFolders } : { folders: undefined }),
    ...(catalog.length ? { catalog } : { catalog: undefined })
  } : library;
}
