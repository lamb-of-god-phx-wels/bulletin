import { useState } from 'react';
import { libraryCatalogRecords, type LibraryCatalogRecord } from '../shared/libraryCatalog';
import type { LibraryManifestV1, TemplateV1 } from '../shared/types';
import { LibraryBrowserDialog } from './LibraryBrowserDialog';

export function TemplateElementDialog({ templates, library, root, excludeTemplateId, onSelect, onClose }: {
  templates: TemplateV1[];
  library?: LibraryManifestV1;
  root?: string;
  excludeTemplateId?: string;
  onSelect(template: TemplateV1): void;
  onClose(): void;
}) {
  const [selectedFamily, setSelectedFamily] = useState<LibraryCatalogRecord>();
  const published = templates.filter(template => template.status === 'published' && template.id !== excludeTemplateId);
  if (selectedFamily) {
    const versions = (selectedFamily.value as TemplateV1[]).filter(template => template.status === 'published').sort((left, right) => right.version - left.version);
    return <div className="modal-backdrop block-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="page-element-dialog" role="dialog" aria-modal="true" aria-labelledby="template-version-title">
        <header><div><div className="eyebrow">Bulletin template</div><h2 id="template-version-title">Choose {selectedFamily.title} version</h2></div><button aria-label="Close" onClick={onClose}>×</button></header>
        <div className="page-layout-options">
          {versions.map((template, index) => <button key={`${template.id}:${template.version}`} onClick={() => onSelect(template)}>
            <span>☷</span><b>Version {template.version}{index === 0 ? ' · Latest' : ''}</b><small>Published {new Date(template.updatedAt).toLocaleDateString()}</small>
          </button>)}
        </div>
        <footer><button className="secondary" onClick={() => setSelectedFamily(undefined)}>Back</button></footer>
      </section>
    </div>;
  }
  return <LibraryBrowserDialog
    library={library ?? { schemaVersion: 1, name: 'Library', items: [] }}
    root={root ?? 'library'}
    records={libraryCatalogRecords(library, [], [], published)}
    title="Choose a bulletin template"
    allowedTypes={['template']}
    onLibraryChange={async () => undefined}
    onClose={onClose}
    onSelect={setSelectedFamily}
  />;
}
