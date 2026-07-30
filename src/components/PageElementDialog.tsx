import { useState } from 'react';
import { createCanvasBlock } from '../shared/canvas';
import { createPageTemplate } from '../shared/pageTemplates';
import type { PageTemplateV1 } from '../shared/types';

export function PageElementDialog({ pages, onSelect, onCreate, onClose }: {
  pages: PageTemplateV1[];
  onSelect(page: PageTemplateV1): void;
  onCreate(page: PageTemplateV1): void;
  onClose(): void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('New page');
  const records = pages.map((pageTemplate, index) => ({ path: `page-${index}`, pageTemplate }));
  const create = (layout: 'canvas' | 'regular') => onCreate(createPageTemplate(
    name.trim() || 'New page',
    records,
    layout === 'canvas' ? [createCanvasBlock(`canvas-${crypto.randomUUID()}`)] : [],
    layout === 'canvas' ? { mode: 'fixed', marginIn: 0 } : { mode: 'inherit', referenceMarginIn: .4 },
    layout
  ));
  return <div className="modal-backdrop block-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="page-element-dialog" role="dialog" aria-modal="true" aria-labelledby="page-element-title">
      <header><div><div className="eyebrow">Page element</div><h2 id="page-element-title">{creating ? 'Create a reusable page' : 'Choose a reusable page'}</h2></div><button aria-label="Close" onClick={onClose}>×</button></header>
      {creating ? <div className="page-element-create">
        <label>Page name<input autoFocus value={name} onChange={event => setName(event.target.value)} /></label>
        <div className="page-layout-options">
          <button disabled={!name.trim()} onClick={() => create('canvas')}><span>▧</span><b>Canvas</b><small>Position native elements and shapes freely.</small></button>
          <button disabled={!name.trim()} onClick={() => create('regular')}><span>☷</span><b>Regular layout</b><small>Flow native blocks inside page margins.</small></button>
        </div>
      </div> : <div className="page-element-list">
        {pages.filter(page => page.status === 'published').map(page => <button key={`${page.id}@${page.version}`} onClick={() => onSelect(page)}><span>▣</span><div><b>{page.name}</b><small>Version {page.version} · {page.layout === 'canvas' ? 'Canvas' : 'Regular layout'}</small></div></button>)}
        {!pages.some(page => page.status === 'published') && <p>No published reusable pages yet.</p>}
      </div>}
      <footer><button className="secondary" onClick={() => creating ? setCreating(false) : onClose()}>{creating ? 'Back' : 'Cancel'}</button>{!creating && <button className="primary" onClick={() => setCreating(true)}>＋ Create new page</button>}</footer>
    </section>
  </div>;
}
