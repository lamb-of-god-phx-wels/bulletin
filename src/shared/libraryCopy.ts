import type { AssetRef } from './types.js';
import type { LibraryCatalogRecord } from './libraryCatalog.js';

export const copySlug = (value: string, fallback: string) =>
  value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || fallback;

export function uniqueCopyName(source: string, folderId: string | undefined, records: LibraryCatalogRecord[], reserved: Array<{ title: string; folderId?: string }>) {
  const used = new Set([...records, ...reserved].filter(record => record.folderId === folderId).map(record => record.title.trim().toLocaleLowerCase()));
  let name = `${source} copy`;
  for (let suffix = 2; used.has(name.toLocaleLowerCase()); suffix++) name = `${source} copy ${suffix}`;
  reserved.push({ title: name, folderId });
  return name;
}

export function uniqueCopyId(name: string, used: Set<string>, fallback: string) {
  const base = copySlug(name, fallback);
  let id = base;
  for (let suffix = 2; used.has(id); suffix++) id = `${base}-${suffix}`;
  used.add(id);
  return id;
}

const isAssetRef = (value: unknown): value is AssetRef => Boolean(value && typeof value === 'object' && typeof (value as AssetRef).path === 'string' && typeof (value as AssetRef).mediaType === 'string');

export async function copyEmbeddedAssets<T>(value: T, targetFolder: string, copy: (asset: AssetRef, targetFolder: string) => Promise<AssetRef>, cache = new Map<string, AssetRef>()): Promise<T> {
  if (isAssetRef(value)) {
    const existing = cache.get(value.path);
    if (existing) return { ...value, path: existing.path } as T;
    const copied = await copy(value, targetFolder);
    cache.set(value.path, copied);
    return copied as T;
  }
  if (Array.isArray(value)) {
    const copied = [];
    for (const item of value) copied.push(await copyEmbeddedAssets(item, targetFolder, copy, cache));
    return copied as T;
  }
  if (value && typeof value === 'object') {
    const entries: Array<[string, unknown]> = [];
    for (const [key, item] of Object.entries(value)) entries.push([key, await copyEmbeddedAssets(item, targetFolder, copy, cache)]);
    return Object.fromEntries(entries) as T;
  }
  return value;
}
