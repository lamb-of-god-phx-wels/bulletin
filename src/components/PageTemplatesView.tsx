import { useMemo, useState } from 'react';
import type { DeclarativeComponentDefinition } from '../component-engine/types';
import { createPageTemplate, duplicatePageTemplate, nextPageTemplateVersion, pageTemplateChoices, pageTemplateLayout, pageTemplateVersions, type PageTemplateRecord } from '../shared/pageTemplates';
import { createCanvasBlock } from '../shared/canvas';
import { randomId } from '../shared/id';
import type { BulletinDocumentV1, LibraryManifestV1, PageTemplateV1, TemplateV1 } from '../shared/types';
import { PageTemplateEditor } from './PageTemplateEditor';

export function PageTemplatesView({ records, template, document, library, root, definitions, onSave, onArchive, onLibraryChange, onError }: {
  records: PageTemplateRecord[];
  template: TemplateV1;
  document?: BulletinDocumentV1;
  library?: LibraryManifestV1;
  root: string;
  definitions: DeclarativeComponentDefinition[];
  onSave(page: PageTemplateV1, expectedUpdatedAt?: string): Promise<PageTemplateRecord>;
  onArchive(record: PageTemplateRecord): Promise<void>;
  onLibraryChange(library: LibraryManifestV1, alreadySaved?: boolean): Promise<void>;
  onError(message: string): void;
}) {
  const choices = useMemo(() => pageTemplateChoices(records), [records]);
  const [selectedId, setSelectedId] = useState(choices[0]?.pageTemplate.id);
  const selected = pageTemplateVersions(records, selectedId ?? '')[0] ?? choices[0];
  const [draft, setDraft] = useState<PageTemplateV1>();
  const [creatingName, setCreatingName] = useState<string>();
  const edit = (page: PageTemplateV1) => setDraft({ ...structuredClone(page), layout: pageTemplateLayout(page) });
  const createBlank = () => {
    const name = window.prompt('Page template name', 'New page');
    if (name?.trim()) setCreatingName(name.trim());
  };
  const createWithLayout = (layout: 'canvas' | 'regular') => {
    if (!creatingName) return;
    edit(createPageTemplate(
      creatingName,
      records,
      layout === 'canvas' ? [createCanvasBlock(`canvas-${randomId()}`)] : [],
      layout === 'canvas' ? { mode: 'fixed', marginIn: 0 } : { mode: 'inherit', referenceMarginIn: .4 },
      layout
    ));
    setCreatingName(undefined);
  };
  const duplicate = () => {
    if (!selected) return;
    const name = window.prompt('Name for the copy', `${selected.pageTemplate.name} copy`);
    if (name?.trim()) edit(duplicatePageTemplate(selected.pageTemplate, name.trim(), records));
  };
  const save = async (publish: boolean) => {
    if (!draft) return;
    const current = records.find(record => record.pageTemplate.id === draft.id && record.pageTemplate.version === draft.version && record.pageTemplate.status === draft.status);
    const next = {
      ...draft,
      status: publish ? 'published' as const : 'draft' as const,
      version: publish ? nextPageTemplateVersion(records, draft.id) : draft.version,
      updatedAt: new Date().toISOString()
    };
    const saved = await onSave(next, current?.pageTemplate.updatedAt);
    setSelectedId(saved.pageTemplate.id);
    setDraft(saved.pageTemplate);
  };
  return <div className="page-templates-screen">
    <header className="library-intro"><div><div className="eyebrow">Synchronized reusable pages</div><h2>{choices.length} page template{choices.length === 1 ? '' : 's'}</h2><p>Create either a positioned canvas page or a regular block-layout page, then pin it into any bulletin or bulletin template.</p></div><div className="builder-actions"><button className="secondary" disabled={!selected} onClick={duplicate}>Duplicate</button><button className="primary" onClick={createBlank}>＋ New page template</button></div></header>
    {!choices.length ? <div className="empty-state"><span>▣</span><h2>No reusable pages yet</h2><p>Create a blank page to begin.</p></div> : <section className="page-template-cards">{choices.map(record => <article className={record.pageTemplate.id === selected?.pageTemplate.id ? 'selected' : ''} key={record.pageTemplate.id} onClick={() => setSelectedId(record.pageTemplate.id)}>
      <div><b>{record.pageTemplate.name}</b><small>{pageTemplateLayout(record.pageTemplate) === 'canvas' ? 'Canvas' : 'Regular layout'} · Latest v{record.pageTemplate.version} · {record.pageTemplate.status} · {record.pageTemplate.margin.mode === 'inherit' ? 'inherits margins' : `${record.pageTemplate.margin.marginIn} in margins`}</small></div>
      <div className="builder-actions"><button className="secondary" onClick={event => { event.stopPropagation(); edit(record.pageTemplate); }}>Edit</button><button className="danger-text" onClick={event => { event.stopPropagation(); void onArchive(record).catch(error => onError(error instanceof Error ? error.message : String(error))); }}>Delete</button></div>
    </article>)}</section>}
    {draft && <PageTemplateEditor value={draft} template={template} document={document} library={library} root={root} definitions={definitions} onLibraryChange={onLibraryChange} onError={onError} onChange={setDraft} onSave={save} onClose={() => setDraft(undefined)} />}
    {creatingName && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setCreatingName(undefined); }}>
      <section className="page-layout-choice" role="dialog" aria-modal="true" aria-labelledby="page-layout-choice-title">
        <div className="eyebrow">New page template</div>
        <h2 id="page-layout-choice-title">Choose how to build {creatingName}</h2>
        <p>The page type stays fixed so canvas objects and flowing document blocks are not accidentally mixed.</p>
        <div className="page-layout-options">
          <button onClick={() => createWithLayout('canvas')}><span>▧</span><b>Canvas</b><small>Position text, images, shapes, and lines anywhere on a full 7 × 8.5-inch page.</small></button>
          <button onClick={() => createWithLayout('regular')}><span>☷</span><b>Regular layout</b><small>Build a page from document blocks that flow within the selected page margins.</small></button>
        </div>
        <div className="builder-actions"><button className="secondary" onClick={() => setCreatingName(undefined)}>Cancel</button></div>
      </section>
    </div>}
  </div>;
}
