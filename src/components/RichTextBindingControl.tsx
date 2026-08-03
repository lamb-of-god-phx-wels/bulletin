import { useState } from 'react';
import type { CanvasTextBinding, LibraryManifestV1, RichTextBinding, TemplateV1 } from '../shared/types';
import { libraryCatalogRecords } from '../shared/libraryCatalog';
import { CustomPropertyBindingSelect } from './CustomProperties';
import { LibraryBrowserDialog } from './LibraryBrowserDialog';

export const isLibraryTextBinding = (binding: RichTextBinding | undefined): binding is Extract<RichTextBinding, { kind: 'libraryItem' }> =>
  Boolean(binding && typeof binding === 'object' && binding.kind === 'libraryItem');

export function RichTextBindingControl({ value, template, library, root, onChange }: {
  value?: RichTextBinding;
  template: TemplateV1;
  library?: LibraryManifestV1;
  root?: string;
  onChange(value?: RichTextBinding): void;
}) {
  const [choosing, setChoosing] = useState(false);
  const libraryBinding = isLibraryTextBinding(value) ? value : undefined;
  const selected = libraryBinding
    ? library?.items.filter(item => item.kind === 'liturgy' && item.id === libraryBinding.itemId && (!libraryBinding.version || item.version === libraryBinding.version)).sort((left, right) => right.version - left.version)[0]
    : undefined;
  return <div className="rich-text-binding-control">
    <label>Binding
      {libraryBinding
        ? <input readOnly value={selected?.title ?? `Missing: ${libraryBinding.itemId}`} />
        : <CustomPropertyBindingSelect value={value as CanvasTextBinding | undefined} template={template} onChange={onChange} />}
    </label>
    <button type="button" className="secondary" disabled={!root} onClick={() => setChoosing(true)}>{libraryBinding ? 'Choose another…' : 'Bind library text…'}</button>
    {libraryBinding && <button type="button" className="text-button" onClick={() => onChange(undefined)}>Remove binding</button>}
    {choosing && root && <LibraryBrowserDialog
      library={library ?? { schemaVersion: 1, name: 'Library', items: [] }}
      root={root}
      records={libraryCatalogRecords(library)}
      title="Choose reusable text"
      allowedTypes={['liturgy']}
      onLibraryChange={async () => undefined}
      onClose={() => setChoosing(false)}
      onSelect={record => {
        const latest = library?.items.filter(item => item.kind === 'liturgy' && item.id === record.targetId).sort((left, right) => right.version - left.version)[0];
        onChange({ kind: 'libraryItem', itemId: record.targetId, version: latest?.version });
        setChoosing(false);
      }}
    />}
  </div>;
}
