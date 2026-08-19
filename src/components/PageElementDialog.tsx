import { useState } from 'react';
import { createCanvasBlock } from '../shared/canvas';
import { randomId } from '../shared/id';
import { createPageTemplate } from '../shared/pageTemplates';
import { libraryCatalogRecords } from '../shared/libraryCatalog';
import type { LibraryManifestV1, PageTemplateV1 } from '../shared/types';
import { LibraryBrowserDialog } from './LibraryBrowserDialog';

export function PageElementDialog({ pages, library, root, onSelect, onCreate, onClose }: {
  pages: PageTemplateV1[];
  library?: LibraryManifestV1;
  root?: string;
  onSelect(page: PageTemplateV1): void;
  onCreate?(page: PageTemplateV1): void;
  onClose(): void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('New page');
  const records = pages.map((pageTemplate, index) => ({ path: `page-${index}`, pageTemplate }));
  const create = (layout: 'canvas' | 'regular') => onCreate?.(createPageTemplate(
    name.trim() || 'New page',
    records,
    layout === 'canvas' ? [createCanvasBlock(`canvas-${randomId()}`)] : [],
    layout === 'canvas' ? { mode: 'fixed', marginIn: 0 } : { mode: 'inherit', referenceMarginIn: .4 },
    layout
  ));
  if (!creating) return <LibraryBrowserDialog
    library={library ?? { schemaVersion: 1, name: 'Library', items: [] }}
    root={root ?? 'library'}
    records={libraryCatalogRecords(library, pages.filter(page => page.status === 'published'))}
    title="Choose a Page Design"
    allowedTypes={['page-template']}
    actions={onCreate ? <button className="primary" onClick={() => setCreating(true)}>＋ Create new Page Design</button> : undefined}
    onLibraryChange={async () => undefined}
    onClose={onClose}
    onSelect={record => {
      const versions = record.value as PageTemplateV1[];
      const page = versions.find(item => item.status === 'published') ?? versions[0];
      if (page) onSelect(page);
    }}
  />;
  return <div className="modal-backdrop block-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="page-element-dialog" role="dialog" aria-modal="true" aria-labelledby="page-element-title">
      <header><div><div className="eyebrow">Page Design element</div><h2 id="page-element-title">{creating ? 'Create a Page Design' : 'Choose a Page Design'}</h2></div><button aria-label="Close" onClick={onClose}>×</button></header>
      <div className="page-element-create">
        <label>Page Design name<input autoFocus value={name} onChange={event => setName(event.target.value)} /></label>
        <div className="page-layout-options">
          <button disabled={!name.trim()} onClick={() => create('canvas')}><span>▧</span><b>Canvas</b><small>Position native elements and shapes freely.</small></button>
          <button disabled={!name.trim()} onClick={() => create('regular')}><span>☷</span><b>Regular layout</b><small>Flow native blocks inside page margins.</small></button>
        </div>
      </div>
      <footer><button className="secondary" onClick={() => setCreating(false)}>Back</button></footer>
    </section>
  </div>;
}
