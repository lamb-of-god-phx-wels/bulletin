import { useEffect, useMemo, useRef, useState, type WheelEvent as ReactWheelEvent } from 'react';
import type { DeclarativeComponentDefinition } from '../component-engine/types';
import { instantiateComponentDefinition } from '../componentDefinitions';
import { createBulletin } from '../shared/defaults';
import { estimateBlockPoints } from '../shared/pagination';
import { pageTemplateIssues, pageTemplateLayout } from '../shared/pageTemplates';
import { createLayoutContainer, findBlock, groupAcceptsChild, moveGroupChildToRoot, placeGroupChild, updateBlockTree, type LayoutCell } from '../shared/blocks';
import type { BulletinBlock, BulletinDocumentV1, LibraryManifestV1, PageTemplateV1, TemplateV1 } from '../shared/types';
import { BlockFormattingModal } from './BlockFormattingModal';
import { BlockLibraryModal } from './BlockLibraryModal';
import { CanvasDesigner } from './CanvasDesigner';
import { DocumentView } from './DocumentView';
import { SortableHandle, SortableItem, SortableList } from './SortableList';
import { ElementPalette, type ElementPaletteItem } from './ElementPalette';
import { flowElementPaletteItems, type ElementPalettePayload } from './elementPaletteCatalog';
import { NativeBlockFields } from './NativeBlockFields';
import { randomId } from '../shared/id';
import { customPropertyIssues } from '../shared/customProperties';
import { ConditionModal } from './ConditionModal';
import { ImageAssetDialog } from './ImageAssetDialog';
import { PreviewZoomControls, stepPreviewZoom } from './PreviewZoomControls';
import { isRedoShortcut, isUndoShortcut, UndoRedoButtons, useUndoRedoHistory, type UndoRedoCommands } from './useUndoRedo';
import { RichTextToolbar } from './RichTextEditing';
import { PageTemplatePropertiesPanel } from './CustomProperties';
import { blockDisplayName } from '../shared/blockNames';
import { EditableElementName } from './EditableElementName';

const title = blockDisplayName;

export function PageTemplateEditor({ value, template, document = createBulletin(template), library, root, definitions, onLibraryChange, onError, onChange, history, onSave, onClose }: {
  value: PageTemplateV1;
  template: TemplateV1;
  document?: BulletinDocumentV1;
  library?: LibraryManifestV1;
  root?: string;
  definitions: DeclarativeComponentDefinition[];
  onLibraryChange?(library: LibraryManifestV1, alreadySaved?: boolean): Promise<void>;
  onError?(message: string): void;
  onChange(value: PageTemplateV1): void;
  history?: UndoRedoCommands;
  onSave?(publish: boolean): Promise<void>;
  onClose(): void;
}) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [canvasId, setCanvasId] = useState<string>();
  const [formatId, setFormatId] = useState<string>();
  const [status, setStatus] = useState('');
  const [imageIndex, setImageIndex] = useState<number>();
  const [nestedImageTarget, setNestedImageTarget] = useState<{ parentId: string; cell?: LayoutCell }>();
  const [conditionBlockId, setConditionBlockId] = useState<string>();
  const preview = useRef<HTMLElement>(null);
  const initialZoom = Number(localStorage.getItem('bulletin-preview-zoom'));
  const [zoom, setZoom] = useState(Number.isFinite(initialZoom) && initialZoom >= .1 && initialZoom <= 2 ? initialZoom : .72);
  const zoomMode = useRef<'page' | 'width' | 'manual'>(Number.isFinite(initialZoom) ? 'manual' : 'page');
  const [showRulers, setShowRulers] = useState(() => localStorage.getItem('bulletin-show-rulers') !== 'false');
  const [showGuides, setShowGuides] = useState(() => localStorage.getItem('bulletin-show-guides') === 'true');
  const localHistory = useUndoRedoHistory<PageTemplateV1>();
  const marginIn = value.margin.mode === 'fixed' ? value.margin.marginIn : value.margin.referenceMarginIn;
  const layout = pageTemplateLayout(value);
  const previewTemplate = useMemo<TemplateV1>(() => ({ ...template, theme: { ...template.theme, marginIn }, customProperties: value.customProperties ?? [], starterBlocks: value.blocks }), [template, value.blocks, value.customProperties, marginIn]);
  const previewDocument = useMemo<BulletinDocumentV1>(() => ({ ...document, customProperties: value.customProperties ?? [], customPropertyOverrides: undefined, blocks: value.blocks, layout: { ...document.layout, marginIn } }), [document, value.blocks, value.customProperties, marginIn]);
  const used = value.blocks.reduce((total, block) => total + estimateBlockPoints(block, previewTemplate, library, document), 0);
  const capacity = (8.5 - marginIn * 2) * 72;
  const issues = [...pageTemplateIssues(value), ...customPropertyIssues(previewTemplate).map(issue => issue.message), ...(layout === 'regular' && used > capacity ? [`Page content exceeds the available height by ${((used - capacity) / 72).toFixed(2)} inches.`] : [])];
  const change = (changes: Partial<PageTemplateV1>) => {
    if (!history) localHistory.record(value);
    onChange({ ...value, ...changes, status: 'draft', updatedAt: new Date().toISOString() });
  };
  const undoLocal = () => {
    const previous = localHistory.undo(value);
    if (previous) onChange(previous);
  };
  const redoLocal = () => {
    const next = localHistory.redo(value);
    if (next) onChange(next);
  };
  const activeHistory: UndoRedoCommands = history ?? {
    canUndo: localHistory.canUndo,
    canRedo: localHistory.canRedo,
    undo: undoLocal,
    redo: redoLocal,
  };
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
    } else if (payload.kind === 'container') {
      const block = createLayoutContainer(payload.layoutMode, `container-${randomId()}`);
      change({ blocks: [...value.blocks.slice(0, index), block, ...value.blocks.slice(index)] });
    } else if (payload.kind === 'image' && root && window.bulletin) {
      setImageIndex(index);
    }
  };
  const insertIntoContainer = (item: ElementPaletteItem, containerId: string, cell?: LayoutCell) => {
    const parent = findBlock(value.blocks, containerId);
    if (parent?.type !== 'group') return false;
    if (parent.layoutMode === 'table') return true;
    const payload = item.payload as ElementPalettePayload;
    if (payload.kind === 'component') {
      const child = instantiateComponentDefinition(payload.definition);
      if (!groupAcceptsChild(parent, child)) return true;
      change({ blocks: updateBlockTree(value.blocks, parent.id, placeGroupChild(parent, child, cell)) });
    }
    else if (payload.kind === 'container') change({ blocks: updateBlockTree(value.blocks, parent.id, placeGroupChild(parent, createLayoutContainer(payload.layoutMode, `container-${randomId()}`), cell)) });
    else if (payload.kind === 'image') setNestedImageTarget({ parentId: parent.id, cell });
    else return false;
    return true;
  };
  const moveBlockIntoContainer = (blockId: string, containerId: string, cell?: LayoutCell) => {
    const child = value.blocks.find(block => block.id === blockId);
    const parent = findBlock(value.blocks, containerId);
    if (!child || parent?.type !== 'group' || findBlock([child], containerId)) return false;
    if (parent.layoutMode === 'table') return true;
    if (!groupAcceptsChild(parent, child)) return true;
    const remaining = value.blocks.filter(block => block.id !== child.id);
    change({ blocks: updateBlockTree(remaining, parent.id, placeGroupChild(parent, child, cell)) });
    return true;
  };
  const changeZoom = (next: number) => {
    zoomMode.current = 'manual';
    setZoom(next);
    localStorage.setItem('bulletin-preview-zoom', String(next));
  };
  const fitPreview = (mode: 'width' | 'page') => {
    const stack = preview.current?.querySelector<HTMLElement>('.document-stack');
    if (!stack) return;
    const rulerWidth = showRulers ? 46 : 0;
    const rulerHeight = showRulers ? 75 : 0;
    const fitWidth = (stack.clientWidth - 48 - rulerWidth) / 672;
    const fitPage = Math.min(fitWidth, (stack.clientHeight - 56 - rulerHeight) / 816);
    const next = Math.round(Math.max(.1, Math.min(2, mode === 'width' ? fitWidth : fitPage)) * 1000) / 1000;
    zoomMode.current = mode;
    setZoom(next);
    localStorage.setItem('bulletin-preview-zoom', String(next));
  };
  const handlePreviewWheel = (event: ReactWheelEvent<HTMLElement>) => {
    if (!event.ctrlKey || event.deltaY === 0) return;
    event.preventDefault();
    zoomMode.current = 'manual';
    setZoom(current => {
      const next = stepPreviewZoom(current, event.deltaY < 0 ? 1 : -1);
      localStorage.setItem('bulletin-preview-zoom', String(next));
      return next;
    });
  };
  const toggleRulers = () => {
    setShowRulers(current => {
      const next = !current;
      localStorage.setItem('bulletin-show-rulers', String(next));
      return next;
    });
  };
  const toggleGuides = () => {
    setShowGuides(current => {
      const next = !current;
      localStorage.setItem('bulletin-show-guides', String(next));
      return next;
    });
  };
  useEffect(() => {
    if (!preview.current) return;
    const applyFit = () => {
      if (zoomMode.current !== 'manual') fitPreview(zoomMode.current);
    };
    const timer = window.setTimeout(applyFit);
    const observer = new ResizeObserver(applyFit);
    observer.observe(preview.current);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [showRulers]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.target as Element | null)?.closest?.('.modal-backdrop')) return;
      if (window.document.querySelector('.canvas-designer, .block-formatting-modal')) return;
      if (isUndoShortcut(event)) {
        event.preventDefault();
        activeHistory.undo();
      } else if (isRedoShortcut(event)) {
        event.preventDefault();
        activeHistory.redo();
      }
    };
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  }, [value, history, localHistory.canUndo, localHistory.canRedo]);
  const pageSetup = <details className="editor-card collapsible-editor page-setup-card sidebar-page-setup">
    <summary><div><div className="eyebrow">Reusable page</div><b>Page setup</b></div></summary>
    <div className="collapsible-editor-fields">
      <label>Name<input value={value.name} onChange={event => change({ name: event.target.value })} /></label>
      <label>Margins<select value={value.margin.mode} onChange={event => change({ margin: event.target.value === 'fixed' ? { mode: 'fixed', marginIn } : { mode: 'inherit', referenceMarginIn: marginIn } })}><option value="inherit">Inherit host margins</option><option value="fixed">Use fixed margins</option></select></label>
      <label>{value.margin.mode === 'fixed' ? 'Fixed margin' : 'Designer reference margin'}<input type="number" min="0" max="1.25" step=".05" value={marginIn} onChange={event => {
        const next = Math.max(0, Math.min(1.25, event.currentTarget.valueAsNumber));
        if (Number.isFinite(next)) change({ margin: value.margin.mode === 'fixed' ? { mode: 'fixed', marginIn: next } : { mode: 'inherit', referenceMarginIn: next } });
      }} /></label>
    </div>
  </details>;
  const palette = <ElementPalette
    items={flowElementPaletteItems(definitions, false)}
    portalTargetId="page-template-element-palette-slot"
    onUse={item => void usePaletteItem(item, value.blocks.length)}
    actions={<button className="text-button" onClick={() => setLibraryOpen(true)}>Manage components…</button>}
  />;
  const previewPane = <main className="page-template-preview" ref={preview} onWheel={handlePreviewWheel}>
    <div className="preview-toolbar">
      <div><b>Page preview</b><span>7 × 8.5 inches</span></div>
      <div className="preview-toolbar-end">
        <button type="button" className={`guide-toggle ${showGuides ? 'active' : ''}`} aria-label={`${showGuides ? 'Hide' : 'Show'} guides`} aria-pressed={showGuides} onClick={toggleGuides}>Guides</button>
        <button type="button" className={`ruler-toggle ${showRulers ? 'active' : ''}`} aria-label={`${showRulers ? 'Hide' : 'Show'} rulers`} aria-pressed={showRulers} onClick={toggleRulers}>Rulers</button>
        <PreviewZoomControls zoom={zoom} onChange={changeZoom} onFit={fitPreview} />
      </div>
      <RichTextToolbar />
    </div>
    <DocumentView document={previewDocument} template={previewTemplate} library={library} root={root} rulers={showRulers} guides={showGuides} zoom={zoom} singlePage onBlockChange={updateBlock} />
  </main>;
  return <div className={`page-template-designer page-template-${layout}`} role="dialog" aria-modal="true" aria-labelledby="page-template-editor-title">
    <header><div><div className="eyebrow">Reusable {layout === 'canvas' ? 'canvas' : 'regular-layout'} page · v{value.version}</div><h2 id="page-template-editor-title">{value.name}</h2></div><div className="builder-actions"><UndoRedoButtons history={activeHistory} />{onSave && <><button className="secondary" onClick={() => void save(false)}>Save draft</button><button className="primary" disabled={issues.length > 0} onClick={() => void save(true)}>Publish version</button></>}<button onClick={onClose}>Done</button></div></header>
    {layout === 'regular' ? <>
      <aside className="elements-sidebar page-template-elements" aria-label="Page template elements"><div className="sidebar-palette-slot">{pageSetup}<PageTemplatePropertiesPanel pageTemplate={value} onChange={next => change(next)} /><div className="page-template-palette-slot" id="page-template-element-palette-slot" /></div></aside>
      <section className="editor-pane page-template-flow-editor"><div className="editor-scroll">
        <div className="editor-section-title"><div><div className="eyebrow">Page content</div><h2>Elements</h2><small>{value.blocks.length} block{value.blocks.length === 1 ? '' : 's'}</small></div></div>
        <SortableList
          items={value.blocks}
          onChange={blocks => change({ blocks })}
          onInsert={(descriptor, index) => void usePaletteItem(descriptor as ElementPaletteItem, index)}
          onInsertInto={(descriptor, containerId, cell) => insertIntoContainer(descriptor as ElementPaletteItem, containerId, cell)}
          onMoveInto={moveBlockIntoContainer}
          dockedPalette
          palette={palette}
        >
          {value.blocks.map(block => <SortableItem id={block.id} key={block.id}><details className="editor-card block-editor collapsible-editor" data-editor-block-id={block.id} data-sortable-root-item="true" data-layout-container={block.type === 'group' ? 'true' : undefined} tabIndex={-1}>
            <summary>
              <div><span className="block-type">{block.type}{block.presentation ? ' · formatted' : ''}</span><EditableElementName as="h3" value={title(block)} onRename={displayName => updateBlock({ ...block, displayName } as BulletinBlock)} /></div>
              <div className="reorder" onClick={event => event.preventDefault()}>
                <button className={`format-block-button condition-toggle ${block.condition ? 'condition-active' : ''}`} aria-pressed={Boolean(block.condition)} title="Set conditional visibility" onClick={() => setConditionBlockId(block.id)}>Condition</button>
                <button className="format-block-button format-action" title="Format block" onClick={() => setFormatId(block.id)}>Format</button>
                <button className="danger-text" title={`Remove ${title(block)}`} aria-label={`Remove ${title(block)}`} onClick={() => change({ blocks: value.blocks.filter(item => item.id !== block.id) })}>×</button>
                <SortableHandle label={`Drag ${title(block)} to reorder`} />
              </div>
            </summary>
            <div className="collapsible-editor-fields">
              <NativeBlockFields block={block} library={library} template={previewTemplate} scope="template" root={root} imageTargetFolder={`assets/page-templates/${value.id}`} onLibraryChange={onLibraryChange} onError={onError} onChange={updateBlock} onMoveOut={(parentId, childId, targetId, position) => change({ blocks: moveGroupChildToRoot(value.blocks, parentId, childId, targetId, position) })} />
            </div>
          </details></SortableItem>)}
        </SortableList>
        {issues.length > 0 && <div className="validation warning">{issues.map(issue => <p key={issue}>{issue}</p>)}</div>}{status && <p className="template-save-status">{status}</p>}
      </div></section>
      {previewPane}
    </> : <>
      <aside className="page-template-controls">
        {pageSetup}
        <PageTemplatePropertiesPanel pageTemplate={value} onChange={next => change(next)} />
        <p className="helper">This page is a single positioned canvas. Use Design to edit its contents.</p>
      <SortableList
        items={value.blocks}
        onChange={blocks => change({ blocks })}
        onInsert={undefined}
      ><ol className="outline">{value.blocks.map(block => <SortableItem id={block.id} key={block.id}><li>
        <div className="outline-main"><EditableElementName as="b" value={title(block)} onRename={displayName => updateBlock({ ...block, displayName } as BulletinBlock)} /><small>{block.type}</small>
          {block.type === 'canvas' && <small>7 × 8.5 in · full page</small>}
        </div><div className="reorder"><button className="format-block-button" onClick={() => setCanvasId(block.id)}>Design</button></div>
      </li></SortableItem>)}</ol></SortableList>
      {issues.length > 0 && <div className="validation warning">{issues.map(issue => <p key={issue}>{issue}</p>)}</div>}{status && <p className="template-save-status">{status}</p>}
      </aside>
      {previewPane}
    </>}
    {conditionBlockId && (() => { const block = value.blocks.find(item => item.id === conditionBlockId); return block ? <ConditionModal value={block.condition} template={previewTemplate} onClose={() => setConditionBlockId(undefined)} onSave={condition => { updateBlock({ ...block, condition } as BulletinBlock); setConditionBlockId(undefined); }} /> : null; })()}
    {libraryOpen && <BlockLibraryModal workspaceDefinitions={definitions} template={previewTemplate} library={library} root={root} onClose={() => setLibraryOpen(false)} onUsePrepackaged={definition => { change({ blocks: [...value.blocks, instantiateComponentDefinition(definition)] }); setLibraryOpen(false); }} onUseDefinition={definition => { change({ blocks: [...value.blocks, instantiateComponentDefinition(definition)] }); setLibraryOpen(false); }} onSaveDefinition={async () => undefined} onDeleteDefinition={async () => undefined} />}
    {canvasId && (() => { const block = value.blocks.find(item => item.id === canvasId); return block?.type === 'canvas' ? <CanvasDesigner block={block} document={previewDocument} template={previewTemplate} scope="template" marginIn={marginIn} assets={{}} root={root} definitions={definitions} library={library} imageTargetFolder={`assets/page-templates/${value.id}`} onLibraryChange={onLibraryChange} onError={onError} onChooseAsset={() => window.bulletin?.importAsset(root ?? '', `assets/page-templates/${value.id}`) ?? Promise.resolve(null)} onChange={updateBlock} history={activeHistory} onClose={() => setCanvasId(undefined)} /> : null; })()}
    {formatId && (() => { const block = value.blocks.find(item => item.id === formatId); return block ? <BlockFormattingModal block={block} template={previewTemplate} document={document} library={library} scope="template" onClose={() => setFormatId(undefined)} onSave={(presentation, layout) => { updateBlock({ ...block, presentation, layout } as BulletinBlock); setFormatId(undefined); }} /> : null; })()}
    {imageIndex !== undefined && root && <ImageAssetDialog library={library} root={root} targetFolder={`assets/page-templates/${value.id}`} onLibraryChange={onLibraryChange} onError={onError} onClose={() => setImageIndex(undefined)} onSelect={asset => change({ blocks: [...value.blocks.slice(0, imageIndex), { id: `image-${randomId()}`, type: 'image', asset, alt: asset.alt, fit: 'contain', heightIn: 2.5 }, ...value.blocks.slice(imageIndex)] })} />}
    {nestedImageTarget && root && <ImageAssetDialog library={library} root={root} targetFolder={`assets/page-templates/${value.id}`} onLibraryChange={onLibraryChange} onError={onError} onClose={() => setNestedImageTarget(undefined)} onSelect={asset => { const parent = findBlock(value.blocks, nestedImageTarget.parentId); if (parent?.type === 'group') change({ blocks: updateBlockTree(value.blocks, parent.id, placeGroupChild(parent, { id: `image-${randomId()}`, type: 'image', asset, alt: asset.alt, fit: 'contain', heightIn: 2.5 }, nestedImageTarget.cell)) }); setNestedImageTarget(undefined); }} />}
  </div>;
}
