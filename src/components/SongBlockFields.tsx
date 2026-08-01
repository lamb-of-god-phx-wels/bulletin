import { useState } from 'react';
import { paragraphsFromPlainText } from '../shared/plainText.js';
import {
  selectSong,
  songFamilies,
  songHeader,
  songLibraryItem,
  songPresentations,
  songTitle,
} from '../shared/songs.js';
import type { BulletinBlock, CustomBlockStyle, LibraryManifestV1, Paragraph, SongBlock, TemplateV1 } from '../shared/types.js';
import { BlockFormattingModal } from './BlockFormattingModal.js';
import { RichTextEditor } from './RichTextEditor.js';
import { LibraryBrowserDialog } from './LibraryBrowserDialog.js';
import { libraryCatalogRecords } from '../shared/libraryCatalog.js';

type SongPart = 'header' | 'title' | 'body';
const songPartNames: Record<SongPart, string> = {
  header: 'Song header',
  title: 'Song display title',
  body: 'Song body',
};
const songPartTabNames: Record<SongPart, string> = {
  header: 'Header',
  title: 'Display title',
  body: 'Body',
};
const songPartDefaults: Record<SongPart, Partial<CustomBlockStyle>> = {
  header: { fontWeight: 'bold', textTransform: 'uppercase' },
  title: { fontWeight: 'normal', textTransform: 'none' },
  body: { fontWeight: 'normal', textTransform: 'none' },
};

const plainText = (content: Paragraph[] | undefined) =>
  content?.map(paragraph => paragraph.children.map(child =>
    child.type === 'text' ? child.text : child.type === 'lineBreak' ? '\n' : '✠'
  ).join('')).join('\n\n') ?? '';

export function SongBlockFields({ block, library, template, scope, root, onChange }: {
  block: SongBlock;
  library?: LibraryManifestV1;
  template: TemplateV1;
  scope: 'template' | 'weekly';
  root?: string;
  onChange(block: SongBlock): void;
}) {
  const [formatPart, setFormatPart] = useState<SongPart>();
  const [activePart, setActivePart] = useState<SongPart>('header');
  const [choosing, setChoosing] = useState(false);
  const families = songFamilies(library);
  const selected = songLibraryItem(block, library);
  const presentations = songPresentations(block, selected);
  const selectedPresentation = presentations.includes(block.renderMode) ? block.renderMode : '';
  const legacyAsset = Boolean(block.asset) && !selected?.assets?.length;
  const missingPinnedVersion = Boolean(
    block.libraryItemId &&
    block.libraryItemVersion &&
    families.some(family => family.id === block.libraryItemId) &&
    !selected
  );

  const partBlock = (part: SongPart) => ({
    id: `${block.id}-${part}`,
    type: 'richText' as const,
    role: part === 'body' ? 'body' as const : 'header' as const,
    content: part === 'header'
      ? paragraphsFromPlainText(songHeader(block))
      : part === 'title'
        ? paragraphsFromPlainText(songTitle(block, selected))
        : block.contentOverride ?? selected?.content ?? paragraphsFromPlainText('No song body is available.'),
    presentation: {
      ...songPartDefaults[part],
      ...block.elements?.[part]?.presentation,
    },
  }) satisfies BulletinBlock;
  const updatePartFormatting = (part: SongPart, presentation: NonNullable<NonNullable<SongBlock['elements']>[SongPart]>['presentation'] | undefined) => {
    const elements = { ...block.elements };
    if (presentation) elements[part] = { presentation };
    else delete elements[part];
    const next: SongBlock = { ...block, elements };
    if (!Object.keys(elements).length) delete next.elements;
    onChange(next);
  };
  const savePartFormatting = (part: SongPart, presentation: NonNullable<NonNullable<SongBlock['elements']>[SongPart]>['presentation'] | undefined) => {
    updatePartFormatting(part, presentation);
    setFormatPart(undefined);
  };

  return <><div className="song-block-fields">
    <label>Library song<input readOnly value={selected?.title ?? (block.libraryItemId ? `Missing: ${block.title || block.libraryItemId}` : '')} placeholder="Choose a song…" /></label>
    <button className="secondary" disabled={!root} onClick={() => setChoosing(true)}>{selected ? 'Choose another song…' : 'Choose from library…'}</button>
    {missingPinnedVersion && <p className="lookup-status">
      This song’s pinned library version is unavailable.{' '}
      <button className="text-button" onClick={() => onChange(selectSong(block, block.libraryItemId, library))}>Use latest version</button>
    </p>}
    <div className="field-row">
      <label>
        Header
        <RichTextEditor content={block.headerContent ?? paragraphsFromPlainText(block.label ?? 'Song')} label="Song header" onChange={headerContent => onChange({ ...block, label: plainText(headerContent) || 'Song', headerContent })} />
      </label>
      <label>
        Display title
        <RichTextEditor content={block.titleContent ?? paragraphsFromPlainText(block.title ?? selected?.title ?? '')} label="Song display title" onChange={titleContent => onChange({ ...block, title: plainText(titleContent), titleContent })} onReset={(block.titleContent || block.title) ? () => { const next = { ...block }; delete next.title; delete next.titleContent; onChange(next); } : undefined} />
      </label>
    </div>
    <label>
      Presentation
      <select
        value={selectedPresentation}
        disabled={!presentations.length}
        onChange={event => onChange({ ...block, renderMode: event.target.value as SongBlock['renderMode'] })}
      >
        {!presentations.length && <option value="">No presentation available</option>}
        {!selectedPresentation && presentations.length > 0 &&
          <option value="" disabled>Choose an available presentation</option>}
        {presentations.includes('lyrics') && <option value="lyrics">Lyrics</option>}
        {presentations.includes('asset') &&
          <option value="asset">{legacyAsset ? 'Music image (legacy)' : 'Music image'}</option>}
      </select>
    </label>
    {block.renderMode === 'lyrics' && presentations.includes('lyrics') && <details>
      <summary>Edit lyrics for this document</summary>
      <textarea
        rows={10}
        value={plainText(block.contentOverride ?? selected?.content)}
        placeholder="Enter song lyrics…"
        onChange={event => onChange({
          ...block,
          contentOverride: paragraphsFromPlainText(event.target.value, { preserveLineBreaks: true }),
        })}
      />
      {block.contentOverride && <button
        className="danger-text content-reset"
        onClick={() => {
          const next = { ...block };
          delete next.contentOverride;
          onChange(next);
        }}
      >Restore library lyrics</button>}
    </details>}
    {legacyAsset && <p className="helper">This document contains a legacy local music image. It remains printable but cannot be replaced.</p>}
    <div className="song-typography">
      <div className="song-part-tabs" role="group" aria-label="Song text part">
        {(Object.keys(songPartNames) as SongPart[]).map(part => <button
          type="button"
          className={activePart === part ? 'active' : ''}
          aria-pressed={activePart === part}
          key={part}
          onClick={() => setActivePart(part)}
        >{songPartTabNames[part]}</button>)}
      </div>
      <button
        type="button"
        className="text-button song-more-formatting"
        onClick={() => setFormatPart(activePart)}
      >More formatting…</button>
    </div>
  </div>
  {choosing && root && <LibraryBrowserDialog
    library={library ?? { schemaVersion: 1, name: 'Library', items: [] }}
    root={root}
    records={libraryCatalogRecords(library)}
    title="Choose a song"
    allowedTypes={['song']}
    onLibraryChange={async () => undefined}
    onClose={() => setChoosing(false)}
    onSelect={record => { onChange(selectSong(block, record.targetId, library)); setChoosing(false); }}
  />}
  {formatPart && <BlockFormattingModal
    block={partBlock(formatPart)}
    template={template}
    library={library}
    scope={scope}
    name={songPartNames[formatPart]}
    hidePageFlow
    onClose={() => setFormatPart(undefined)}
    onSave={presentation => savePartFormatting(formatPart, presentation)}
  />}</>;
}
