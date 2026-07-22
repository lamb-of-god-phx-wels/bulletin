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

export function normalizeLibrary(library: LibraryManifestV1): LibraryManifestV1 {
  let changed = false;
  const items: LibraryItemV1[] = [];
  const songs = new Map<string, number>();
  for (const original of library.items) {
    const legacyMusic = (original.kind as string) === 'music';
    const item: LibraryItemV1 = legacyMusic ? { ...original, kind: 'song' } : original;
    changed ||= legacyMusic;
    if (item.kind !== 'song') { items.push(item); continue; }
    const key = `${item.id}:${item.version}`;
    const existingIndex = songs.get(key);
    if (existingIndex === undefined) { songs.set(key, items.length); items.push(item); continue; }
    items[existingIndex] = mergeSongItems(items[existingIndex], item); changed = true;
  }
  return changed ? { ...library, items } : library;
}
