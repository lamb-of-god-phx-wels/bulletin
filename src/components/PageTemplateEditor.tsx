import { useMemo, useState } from 'react';
import type { DeclarativeComponentDefinition } from '../component-engine/types';
import { instantiateComponentDefinition } from '../componentDefinitions';
import { createBulletin } from '../shared/defaults';
import { estimateBlockPoints } from '../shared/pagination';
import { pageTemplateIssues, pageTemplateLayout } from '../shared/pageTemplates';
import { paragraphsFromPlainText } from '../shared/plainText';
import type { BulletinBlock, BulletinDocumentV1, LibraryManifestV1, PageTemplateV1, TemplateV1 } from '../shared/types';
import { BlockFormattingModal } from './BlockFormattingModal';
import { BlockLibraryModal } from './BlockLibraryModal';
import { CanvasDesigner } from './CanvasDesigner';
import { DocumentView } from './DocumentView';
import { SortableHandle, SortableItem, SortableList } from './SortableList';
import { childBlocks, updateBlockTree } from '../shared/blocks';

const plain = (block: Extract<BulletinBlock, { type: 'richText' }>) => block.content.map(paragraph => paragraph.children.map(run => run.type === 'text' ? run.text : run.type === 'lineBreak' ? '\n' : '✠').join('')).join('\n\n');
const title = (block: BulletinBlock) => block.type === 'custom' ? block.name : block.type === 'canvas' ? 'Canvas' : block.label ?? ('text' in block ? block.text : block.type);

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
  const nativeFields = (block: BulletinBlock): React.ReactNode => <div className="page-native-fields">
    {(block.type === 'heading' || block.type === 'sectionHeading' || block.type === 'sermonTitle') && <input value={block.text} onChange={event => updateBlock({ ...block, text: event.target.value })} />}
    {block.type === 'richText' && <><label>Binding<select value={block.binding ?? ''} onChange={event => updateBlock({ ...block, binding: event.target.value as typeof block.binding || undefined, bindingOverride: undefined })}><option value="">Literal text</option><option value="info.title">Sermon title</option><option value="info.date">Service date</option><option value="info.churchWeek">Church week</option><option value="info.series">Series</option><option value="church.name">Church name</option></select></label><textarea rows={3} value={block.binding ? (block.bindingOverride ? plain({ ...block, content: block.bindingOverride }) : '') : plain(block)} placeholder={block.binding ? 'Uses the host bulletin value' : ''} onChange={event => updateBlock(block.binding ? { ...block, bindingOverride: paragraphsFromPlainText(event.target.value) } : { ...block, content: paragraphsFromPlainText(event.target.value) })} />{block.bindingOverride && <button className="text-button" onClick={() => { const { bindingOverride: _override, ...next } = block; updateBlock(next); }}>Reset to bound value</button>}{block.binding === 'info.date' && <label>Date format<select value={block.dateFormat ?? 'long'} onChange={event => updateBlock({ ...block, dateFormat: event.target.value as typeof block.dateFormat })}><option value="long">July 27, 2026</option><option value="medium">Jul 27, 2026</option><option value="short">7/27/26</option><option value="iso">2026-07-27</option></select></label>}</>}
    {block.type === 'custom' && <><label>Block name<input value={block.name} onChange={event => updateBlock({ ...block, name: event.target.value })} /></label><label>Content layout<textarea rows={3} value={block.layoutText} onChange={event => updateBlock({ ...block, layoutText: event.target.value })} /></label></>}
    {block.type === 'scriptureReading' && <><label>Reference<input value={block.reference} onChange={event => updateBlock({ ...block, reference: event.target.value })} /></label><label>Caption<input value={block.caption ?? ''} onChange={event => updateBlock({ ...block, caption: event.target.value || undefined })} /></label></>}
    {block.type === 'song' && <><label>Display title<input value={block.title ?? ''} onChange={event => updateBlock({ ...block, title: event.target.value })} /></label><label>Library item ID<input value={block.libraryItemId} onChange={event => updateBlock({ ...block, libraryItemId: event.target.value })} /></label></>}
    {block.type === 'libraryText' && <label>Library item ID<input value={block.libraryItemId} onChange={event => updateBlock({ ...block, libraryItemId: event.target.value })} /></label>}
    {block.type === 'spacer' && <label>Size<select value={block.size} onChange={event => updateBlock({ ...block, size: event.target.value as typeof block.size })}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>}
    {block.type === 'announcements' && block.items.map((item, index) => <div className="page-native-child" key={item.id}><input value={item.title} onChange={event => updateBlock({ ...block, items: block.items.map((entry, itemIndex) => itemIndex === index ? { ...entry, title: event.target.value } : entry) })} /><textarea rows={3} value={item.content.map(paragraph => paragraph.children.map(run => run.type === 'text' ? run.text : '').join('')).join('\n\n')} onChange={event => updateBlock({ ...block, items: block.items.map((entry, itemIndex) => itemIndex === index ? { ...entry, content: paragraphsFromPlainText(event.target.value) } : entry) })} /></div>)}
    {childBlocks(block)?.map(child => <div className="page-native-child" key={child.id}><small>{title(child)}</small>{nativeFields(child)}</div>)}
  </div>;
  const save = async (publish: boolean) => {
    if (publish && issues.length) { setStatus(issues[0]); return; }
    setStatus(publish ? 'Publishing…' : 'Saving…');
    try { await onSave?.(publish); setStatus(publish ? 'Published' : 'Draft saved'); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
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
      {layout === 'regular'
        ? <div className="builder-actions"><button className="primary" onClick={() => setLibraryOpen(true)}>＋ Native block</button></div>
        : <p className="helper">This page is a single positioned canvas. Use Design to edit its contents.</p>}
      <ol className="outline"><SortableList items={value.blocks} onChange={blocks => change({ blocks })}>{value.blocks.map(block => <SortableItem id={block.id} key={block.id}><li>
        <div className="outline-main"><b>{title(block)}</b><small>{block.type}</small>
          {block.type !== 'canvas' && nativeFields(block)}
          {block.type === 'canvas' && <small>7 × 8.5 in · full page</small>}
        </div><div className="reorder">{block.type === 'canvas' ? <button onClick={() => setCanvasId(block.id)}>Design</button> : <button onClick={() => setFormatId(block.id)}>Format</button>}{layout === 'regular' && <button className="danger-text" onClick={() => change({ blocks: value.blocks.filter(item => item.id !== block.id) })}>×</button>}{layout === 'regular' && <SortableHandle label={`Drag ${title(block)} to reorder`} />}</div>
      </li></SortableItem>)}</SortableList></ol>
      {issues.length > 0 && <div className="validation warning">{issues.map(issue => <p key={issue}>{issue}</p>)}</div>}{status && <p className="template-save-status">{status}</p>}
    </aside>
    <main className="page-template-preview"><DocumentView document={{ ...document, blocks: value.blocks, layout: { ...document.layout, marginIn } }} template={previewTemplate} library={library} root={root} rulers guides zoom={.72} singlePage /></main>
    {libraryOpen && <BlockLibraryModal workspaceDefinitions={definitions} template={template} library={library} root={root} onClose={() => setLibraryOpen(false)} onUsePrepackaged={definition => { change({ blocks: [...value.blocks, instantiateComponentDefinition(definition)] }); setLibraryOpen(false); }} onUseDefinition={definition => { change({ blocks: [...value.blocks, instantiateComponentDefinition(definition)] }); setLibraryOpen(false); }} onSaveDefinition={async () => undefined} onDeleteDefinition={async () => undefined} />}
    {canvasId && (() => { const block = value.blocks.find(item => item.id === canvasId); return block?.type === 'canvas' ? <CanvasDesigner block={block} document={document} marginIn={marginIn} assets={{}} root={root} onChooseAsset={() => window.bulletin?.importAsset(root ?? '', `assets/page-templates/${value.id}`) ?? Promise.resolve(null)} onChange={updateBlock} onClose={() => setCanvasId(undefined)} /> : null; })()}
    {formatId && (() => { const block = value.blocks.find(item => item.id === formatId); return block ? <BlockFormattingModal block={block} template={previewTemplate} scope="template" onClose={() => setFormatId(undefined)} onSave={(presentation, layout) => { updateBlock({ ...block, presentation, layout } as BulletinBlock); setFormatId(undefined); }} /> : null; })()}
  </div>;
}
