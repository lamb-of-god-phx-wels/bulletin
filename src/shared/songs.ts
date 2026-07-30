import { libraryFamilies, type LibraryFamily } from './library.js';
import type { LibraryItemV1, LibraryManifestV1, SongBlock } from './types.js';

const hasText = (content: LibraryItemV1['content'] | SongBlock['contentOverride']) =>
  Boolean(content?.some(paragraph => paragraph.children.some(child =>
    child.type !== 'text' || child.text.trim().length > 0
  )));

export function songFamilies(library?: LibraryManifestV1): LibraryFamily[] {
  return libraryFamilies(library?.items.filter(item => item.kind === 'song') ?? []);
}

export function songLibraryItem(block: SongBlock, library?: LibraryManifestV1): LibraryItemV1 | undefined {
  const family = songFamilies(library).find(item => item.id === block.libraryItemId);
  if (!family) return undefined;
  return block.libraryItemVersion
    ? family.versions.find(item => item.version === block.libraryItemVersion)
    : family.versions[0];
}

export function songHeader(block: SongBlock): string {
  return block.label?.trim() || 'Song';
}

export function songTitle(block: SongBlock, item = undefined as LibraryItemV1 | undefined): string {
  return block.title?.trim() || item?.title || block.libraryItemId || 'Choose a song';
}

export function songPresentations(
  block: SongBlock,
  item = undefined as LibraryItemV1 | undefined,
): Array<SongBlock['renderMode']> {
  return [
    ...(hasText(block.contentOverride) || hasText(item?.content) ? ['lyrics' as const] : []),
    ...(Boolean(block.asset) || Boolean(item?.assets?.length) ? ['asset' as const] : []),
  ];
}

export function selectSong(
  block: SongBlock,
  libraryItemId: string,
  library?: LibraryManifestV1,
): SongBlock {
  const family = songFamilies(library).find(item => item.id === libraryItemId);
  const item = family?.versions[0];
  const available = [
    ...(hasText(item?.content) ? ['lyrics' as const] : []),
    ...(item?.assets?.length ? ['asset' as const] : []),
  ];
  const renderMode = available.includes(block.renderMode)
    ? block.renderMode
    : available[0] ?? block.renderMode;
  const next: SongBlock = {
    ...block,
    libraryItemId,
    libraryItemVersion: item?.version,
    renderMode,
  };
  delete next.title;
  delete next.contentOverride;
  delete next.asset;
  return next;
}
