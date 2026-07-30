import { useState } from 'react';
import { paragraphsFromPlainText } from '../shared/plainText.js';
import {
  selectSong,
  songFamilies,
  songLibraryItem,
  songPresentations,
} from '../shared/songs.js';
import type { BulletinBlock, LibraryManifestV1, Paragraph, SongBlock, TemplateV1 } from '../shared/types.js';
import { BlockFormattingModal } from './BlockFormattingModal.js';
import { LibraryBrowserDialog } from './LibraryBrowserDialog.js';
import { libraryCatalogRecords } from '../shared/libraryCatalog.js';

type SongPart = 'header' | 'title' | 'body';
const songPartNames: Record<SongPart, string> = {
  header: 'Song header',
  title: 'Song display title',
  body: 'Song body',
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

  const partBlock = formatPart ? {
    id: `${block.id}-${formatPart}`,
    type: 'richText' as const,
    role: formatPart === 'body' ? 'body' as const : 'header' as const,
    content: [],
    presentation: block.elements?.[formatPart]?.presentation,
  } satisfies BulletinBlock : undefined;
  const savePartFormatting = (part: SongPart, presentation: NonNullable<NonNullable<SongBlock['elements']>[SongPart]>['presentation'] | undefined) => {
    const elements = { ...block.elements };
    if (presentation) elements[part] = { presentation };
    else delete elements[part];
    const next: SongBlock = { ...block, elements };
    if (!Object.keys(elements).length) delete next.elements;
    onChange(next);
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
        <input
          value={block.label ?? 'Song'}
          onChange={event => onChange({ ...block, label: event.target.value })}
          onBlur={() => {
            if (!block.label?.trim()) onChange({ ...block, label: 'Song' });
          }}
        />
      </label>
      <label>
        Display title
        <input
          value={block.title ?? selected?.title ?? ''}
          placeholder={selected?.title ?? 'Choose a library song'}
          onChange={event => onChange({ ...block, title: event.target.value })}
          onBlur={() => {
            if (!block.title?.trim() || block.title.trim() === selected?.title) {
              const next = { ...block };
              delete next.title;
              onChange(next);
            }
          }}
        />
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
    <div className="song-format-actions">
      {(Object.keys(songPartNames) as SongPart[]).map(part => <button
        className="secondary"
        key={part}
        onClick={() => setFormatPart(part)}
      >Format {part === 'title' ? 'display title' : part}</button>)}
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
  {formatPart && partBlock && <BlockFormattingModal
    block={partBlock}
    template={template}
    scope={scope}
    name={songPartNames[formatPart]}
    hidePageFlow
    onClose={() => setFormatPart(undefined)}
    onSave={presentation => savePartFormatting(formatPart, presentation)}
  />}</>;
}
