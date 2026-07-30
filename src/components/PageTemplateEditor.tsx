import { useMemo, useState } from 'react';
import type { DeclarativeComponentDefinition } from '../component-engine/types';
import { instantiateComponentDefinition } from '../componentDefinitions';
import { createBulletin } from '../shared/defaults';
import { estimateBlockPoints } from '../shared/pagination';
import { pageTemplateIssues, pageTemplateLayout } from '../shared/pageTemplates';
import type { BulletinBlock, BulletinDocumentV1, LibraryManifestV1, PageTemplateV1, TemplateV1 } from '../shared/types';
import { BlockFormattingModal } from './BlockFormattingModal';
import { BlockLibraryModal } from './BlockLibraryModal';
import { CanvasDesigner } from './CanvasDesigner';
import { DocumentView } from './DocumentView';
import { SortableHandle, SortableItem, SortableList } from './SortableList';
import { updateBlockTree } from '../shared/blocks';
import { ElementPalette, type ElementPaletteItem } from './ElementPalette';
import { flowElementPaletteItems, type ElementPalettePayload } from './elementPaletteCatalog';
import { NativeBlockFields } from './NativeBlockFields';
import { randomId } from '../shared/id';
import { songHeader } from '../shared/songs';

const title = (block: BulletinBlock) => block.type === 'custom'
  ? block.name
  : block.type === 'canvas'
    ? 'Canvas'
    : block.type === 'song'
      ? songHeader(block)
      : block.label ?? ('text' in block ? block.text : block.type);

export function PageTemplateEditor({ value, template, document = createBulletin(template), library, root, definitions, onChange, onSave, onClose }: {
  value: PageTemplateV1;
  template: TemplateV1;
  document?: BulletinDocumentV1;
  library?: LibraryManifestV1;
  root?: string;
  definitions: DeclarativeComponentDefinition[];
  onChange(value: PageTemplateV1): void;
  onSave?(publish: boolean): Promise<void>;
  onClose(): void;
}) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [canvasId, setCanvasId] = useState<string>();
  const [formatId, setFormatId] = useState<string>();
  const [status, setStatus] = useState('');
  const marginIn = value.margin.mode === 'fixed' ? value.margin.marginIn : value.margin.referenceMarginIn;
  const layout = pageTemplateLayout(value);
  const previewTemplate = useMemo<TemplateV1>(() => ({ ...template, theme: { ...template.theme, marginIn }, starterBlocks: value.blocks }), [template, value.blocks, marginIn]);
  const used = value.blocks.reduce((total, block) => total + estimateBlockPoints(block, previewTemplate, library), 0);
  const capacity = (8.5 - marginIn * 2) * 72;
  const issues = [...pageTemplateIssues(value), ...(used > capacity ? [`Page content exceeds the available height by ${((used - capacity) / 72).toFixed(2)} inches.`] : [])];
  const change = (changes: Partial<PageTemplateV1>) => onChange({ ...value, ...changes, status: 'draft', updatedAt: new Date().toISOString() });
  const updateBlock = (next: BulletinBlock) => change({ blocks: updateBlockTree(value.blocks, next.id, next) });
  const save = async (publish: boolean) => {
    if (publish && issues.length) { setStatus(issues[0]); return; }
    setStatus(publish ? 'Publishing…' : 'Saving…');
    try { await onSave?.(publish); setStatus(publish ? 'Published' : 'Draft saved'); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  };
  const usePaletteItem = async (item: ElementPaletteItem, index: number) => {
    const payload = item.payload as ElementPalettePayload;
    if (payload.kind === 'component') {
      const block = instantiateComponentDefinition(payload.definition);
      change({ blocks: [...value.blocks.slice(0, index), block, ...value.blocks.slice(index)] });
    } else if (payload.kind === 'image' && root && window.bulletin) {
      const asset = await window.bulletin.importAsset(root, `assets/page-templates/${value.id}`);
      if (asset?.mediaType === 'application/pdf') { window.alert('Choose a PNG, JPEG, or SVG for an Image element.'); return; }
      if (asset) change({ blocks: [...value.blocks.slice(0, index), { id: `image-${randomId()}`, type: 'image', asset, fit: 'contain', heightIn: 2.5 }, ...value.blocks.slice(index)] });
    }
  };
  return <div className="page-template-designer" role="dialog" aria-modal="true" aria-labelledby="page-template-editor-title">
    <header><div><div className="eyebrow">Reusable {layout === 'canvas' ? 'canvas' : 'regular-layout'} page · v{value.version}</div><h2 id="page-template-editor-title">{value.name}</h2></div><div className="builder-actions">{onSave && <><button className="secondary" onClick={() => void save(false)}>Save draft</button><button className="primary" disabled={issues.length > 0} onClick={() => void save(true)}>Publish version</button></>}<button onClick={onClose}>Done</button></div></header>
    <aside className="page-template-controls">
      <label>Name<input value={value.name} onChange={event => change({ name: event.target.value })} /></label>
      <label>Margins<select value={value.margin.mode} onChange={event => change({ margin: event.target.value === 'fixed' ? { mode: 'fixed', marginIn } : { mode: 'inherit', referenceMarginIn: marginIn } })}><option value="inherit">Inherit host margins</option><option value="fixed">Use fixed margins</option></select></label>
      <label>{value.margin.mode === 'fixed' ? 'Fixed margin' : 'Designer reference margin'}<input type="number" min="0" max="1.25" step=".05" value={marginIn} onChange={event => {
        const next = Math.max(0, Math.min(1.25, event.currentTarget.valueAsNumber));
        if (Number.isFinite(next)) change({ margin: value.margin.mode === 'fixed' ? { mode: 'fixed', marginIn: next } : { mode: 'inherit', referenceMarginIn: next } });
      }} /></label>
      {layout === 'canvas' && <p className="helper">This page is a single positioned canvas. Use Design to edit its contents.</p>}
      <SortableList
        items={value.blocks}
        onChange={blocks => change({ blocks })}
        onInsert={layout === 'regular' ? (descriptor, index) => void usePaletteItem(descriptor as ElementPaletteItem, index) : undefined}
        palette={layout === 'regular' ? <ElementPalette
          items={flowElementPaletteItems(definitions, false)}
          storageKey="bulletin-elements-page-template"
          onUse={item => void usePaletteItem(item, value.blocks.length)}
          actions={<button className="text-button" onClick={() => setLibraryOpen(true)}>Manage components…</button>}
        /> : undefined}
      ><ol className="outline">{value.blocks.map(block => <SortableItem id={block.id} key={block.id}><li>
        <div className="outline-main"><b>{title(block)}</b><small>{block.type}</small>
          {block.type !== 'canvas' && <NativeBlockFields block={block} library={library} template={previewTemplate} scope="template" onChange={updateBlock} />}
          {block.type === 'canvas' && <small>7 × 8.5 in · full page</small>}
        </div><div className="reorder">{block.type === 'canvas' ? <button className="format-block-button" onClick={() => setCanvasId(block.id)}>Design</button> : <button className="format-block-button" onClick={() => setFormatId(block.id)}>Format</button>}{layout === 'regular' && <button className="danger-text" onClick={() => change({ blocks: value.blocks.filter(item => item.id !== block.id) })}>×</button>}{layout === 'regular' && <SortableHandle label={`Drag ${title(block)} to reorder`} />}</div>
      </li></SortableItem>)}</ol></SortableList>
      {issues.length > 0 && <div className="validation warning">{issues.map(issue => <p key={issue}>{issue}</p>)}</div>}{status && <p className="template-save-status">{status}</p>}
    </aside>
    <main className="page-template-preview"><DocumentView document={{ ...document, blocks: value.blocks, layout: { ...document.layout, marginIn } }} template={previewTemplate} library={library} root={root} rulers guides zoom={.72} singlePage /></main>
    {libraryOpen && <BlockLibraryModal workspaceDefinitions={definitions} template={template} library={library} root={root} onClose={() => setLibraryOpen(false)} onUsePrepackaged={definition => { change({ blocks: [...value.blocks, instantiateComponentDefinition(definition)] }); setLibraryOpen(false); }} onUseDefinition={definition => { change({ blocks: [...value.blocks, instantiateComponentDefinition(definition)] }); setLibraryOpen(false); }} onSaveDefinition={async () => undefined} onDeleteDefinition={async () => undefined} />}
    {canvasId && (() => { const block = value.blocks.find(item => item.id === canvasId); return block?.type === 'canvas' ? <CanvasDesigner block={block} document={document} template={previewTemplate} scope="template" marginIn={marginIn} assets={{}} root={root} definitions={definitions} library={library} onChooseAsset={() => window.bulletin?.importAsset(root ?? '', `assets/page-templates/${value.id}`) ?? Promise.resolve(null)} onChange={updateBlock} onClose={() => setCanvasId(undefined)} /> : null; })()}
    {formatId && (() => { const block = value.blocks.find(item => item.id === formatId); return block ? <BlockFormattingModal block={block} template={previewTemplate} scope="template" onClose={() => setFormatId(undefined)} onSave={(presentation, layout) => { updateBlock({ ...block, presentation, layout } as BulletinBlock); setFormatId(undefined); }} /> : null; })()}
  </div>;
}
