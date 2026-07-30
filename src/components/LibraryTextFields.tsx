import { useState } from 'react';
import { libraryCatalogRecords } from '../shared/libraryCatalog';
import type { BulletinBlock, LibraryManifestV1 } from '../shared/types';
import { LibraryBrowserDialog } from './LibraryBrowserDialog';

type LibraryTextBlock = Extract<BulletinBlock, { type: 'libraryText' }>;

export function LibraryTextFields({ block, library, root, onChange }: {
  block: LibraryTextBlock;
  library?: LibraryManifestV1;
  root?: string;
  onChange(block: LibraryTextBlock): void;
}) {
  const [choosing, setChoosing] = useState(false);
  const versions = library?.items
    .filter(item => item.kind === 'liturgy' && item.id === block.libraryItemId)
    .sort((left, right) => right.version - left.version) ?? [];
  const selected = versions.find(item => item.version === block.libraryItemVersion) ?? versions[0];
  return <>
    <div className="field-row">
      <label>Library text<input readOnly value={selected?.title ?? (block.libraryItemId ? `Missing: ${block.title ?? block.libraryItemId}` : '')} placeholder="Choose reusable text…" /></label>
      <button className="secondary" disabled={!root} onClick={() => setChoosing(true)}>{selected ? 'Choose another…' : 'Choose from library…'}</button>
    </div>
    {choosing && root && <LibraryBrowserDialog
      library={library ?? { schemaVersion: 1, name: 'Library', items: [] }}
      root={root}
      records={libraryCatalogRecords(library)}
      title="Choose reusable text"
      allowedTypes={['liturgy']}
      onLibraryChange={async () => undefined}
      onClose={() => setChoosing(false)}
      onSelect={record => {
        const latest = library?.items
          .filter(item => item.kind === 'liturgy' && item.id === record.targetId)
          .sort((left, right) => right.version - left.version)[0];
        onChange({
          ...block,
          libraryItemId: record.targetId,
          libraryItemVersion: latest?.version,
          contentOverride: undefined,
        });
        setChoosing(false);
      }}
    />}
  </>;
}
