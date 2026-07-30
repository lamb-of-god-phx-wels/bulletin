import { cloneElement, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactElement, type Ref } from 'react';
import { DndContext, DragOverlay, PointerSensor, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import {
  canvasAssetRefs,
  canvasNativeBlocks,
  canvasLineMetrics,
  canvasSpace,
  canvasTextParagraphs,
  convertCanvasCoordinateSpace,
  normalizeCanvasScene,
  rotateCanvasLine,
  snapCanvasPosition,
  snapCanvasValue,
  validateCanvasScene
} from '../shared/canvas.js';
import type {
  AssetRef,
  BulletinDocumentV1,
  CanvasBlock,
  CanvasElement,
  CanvasScene,
  CanvasTextBinding,
  LibraryManifestV1,
  Paragraph,
  TemplateV1
} from '../shared/types.js';
import type { DeclarativeComponentDefinition } from '../component-engine/types.js';
import { CanvasSceneView } from './CanvasSceneView.js';
import { ElementPalette, type ElementPaletteItem } from './ElementPalette.js';
import { canvasElementPaletteItems, type ElementPalettePayload } from './elementPaletteCatalog.js';
import { instantiateComponentDefinition } from '../componentDefinitions.js';
import { NativeBlockFields } from './NativeBlockFields.js';
import { BlockFormattingModal } from './BlockFormattingModal.js';
import { NativeBlockPreview, PageRulers, stopTrackingPointer, trackPointer } from './DocumentView.js';
import { PreviewZoomControls, stepPreviewZoom } from './PreviewZoomControls.js';

const text = (value: string): Paragraph[] => value.split(/\n\s*\n/).map(item => ({
  type: 'paragraph',
  children: [{ type: 'text', text: item }]
}));
const plainText = (content: Paragraph[] | undefined) => content?.map(item => item.children.map(run => run.type === 'text' ? run.text : run.type === 'lineBreak' ? '\n' : '✠').join('')).join('\n\n') ?? '';
const clone = <T,>(value: T): T => structuredClone(value);

function CanvasDropTarget({ stage, children }: { stage: MutableRefObject<HTMLDivElement | null>; children: ReactElement<{ ref?: Ref<HTMLDivElement>; className?: string }> }) {
  const drop = useDroppable({ id: 'canvas-stage-drop' });
  return cloneElement(children, {
    ref: (node: HTMLDivElement | null) => { stage.current = node; drop.setNodeRef(node); },
    className: `${children.props.className ?? ''} ${drop.isOver ? 'palette-drop-active' : ''}`.trim()
  });
}

export function CanvasDesigner({ block, document, template, scope, marginIn, assets, root, definitions = [], library, onChooseAsset, onChange, onClose }: {
  block: CanvasBlock;
  document: BulletinDocumentV1;
  template: TemplateV1;
  scope: 'template' | 'weekly';
  marginIn: number;
  assets: Record<string, string>;
  root?: string;
  definitions?: DeclarativeComponentDefinition[];
  library?: LibraryManifestV1;
  onChooseAsset?(): Promise<AssetRef | null>;
  onChange(block: CanvasBlock): void;
  onClose(): void;
}) {
  const initial = normalizeCanvasScene(block.scene);
  const [scene, setScene] = useState<CanvasScene>(() => clone(initial));
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [past, setPast] = useState<CanvasScene[]>([]);
  const [future, setFuture] = useState<CanvasScene[]>([]);
  const [resolvedAssets, setResolvedAssets] = useState<Record<string, string>>(assets);
  const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>({});
  const [formattingElementId, setFormattingElementId] = useState<string>();
  const drag = useRef<{ x: number; y: number; scene: CanvasScene; resize: boolean } | undefined>(undefined);
  const stage = useRef<HTMLDivElement>(null);
  const workarea = useRef<HTMLElement>(null);
  const initialZoom = Number(localStorage.getItem('bulletin-preview-zoom'));
  const hasInitialZoom = Number.isFinite(initialZoom) && initialZoom >= .1 && initialZoom <= 2;
  const [zoom, setZoom] = useState(hasInitialZoom ? initialZoom : .72);
  const zoomMode = useRef<'page' | 'width' | 'manual'>(hasInitialZoom ? 'manual' : 'page');
  const [showRulers, setShowRulers] = useState(() => localStorage.getItem('bulletin-show-rulers') !== 'false');
  const paletteSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [paletteOverlay, setPaletteOverlay] = useState('');
  const canvasWidth = (block.widthMode ?? 'contentBox') === 'fullPage' ? 7 : 7 - marginIn * 2;
  const elements = useMemo(() => new Map(scene.elements.map(element => [element.id, element])), [scene.elements]);
  const primary = [...selected].map(id => elements.get(id)).find(Boolean);
  const nativePrimary = primary?.type === 'block' ? primary.block : undefined;
  const linePrimary = primary && (primary.type === 'line' || (primary.type === 'shape' && primary.shape === 'line')) ? primary : undefined;
  const issues = validateCanvasScene(scene, marginIn, '/scene', 7, block.heightIn);

  const changeZoom = (next: number) => {
    zoomMode.current = 'manual';
    setZoom(next);
    localStorage.setItem('bulletin-preview-zoom', String(next));
  };
  const fitCanvas = (mode: 'width' | 'page') => {
    if (!workarea.current) return;
    const rulerWidth = showRulers ? 46 : 0;
    const rulerHeight = showRulers ? 75 : 0;
    const fitWidth = (workarea.current.clientWidth - 74 - rulerWidth) / (canvasWidth * 96);
    const fitPage = Math.min(fitWidth, (workarea.current.clientHeight - 86 - rulerHeight) / (block.heightIn * 96));
    const next = Math.round(Math.max(.1, Math.min(2, mode === 'width' ? fitWidth : fitPage)) * 1000) / 1000;
    zoomMode.current = mode;
    setZoom(next);
    localStorage.setItem('bulletin-preview-zoom', String(next));
  };
  const handleWheel = (event: React.WheelEvent<HTMLElement>) => {
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

  useEffect(() => {
    if (!workarea.current) return;
    const applyActiveFit = () => {
      if (zoomMode.current !== 'manual') fitCanvas(zoomMode.current);
    };
    const timer = window.setTimeout(applyActiveFit);
    const observer = new ResizeObserver(applyActiveFit);
    observer.observe(workarea.current);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [canvasWidth, block.heightIn, showRulers]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (!stage.current) return;
      const pxPerIn = stage.current.getBoundingClientRect().width / canvasWidth;
      setMeasuredHeights(Object.fromEntries(scene.elements.flatMap(element => {
        if (element.type !== 'block' || element.sizing !== 'autoHeight') return [];
        const node = stage.current?.querySelector<HTMLElement>(`[data-canvas-element-id="${CSS.escape(element.id)}"]`);
        return node ? [[element.id, node.getBoundingClientRect().height / pxPerIn]] : [];
      })));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [scene, resolvedAssets, canvasWidth]);

  useEffect(() => {
    if (!root || !window.bulletin) return;
    let active = true;
    const nativeLibraryAssets = canvasNativeBlocks(scene).flatMap(native => 'libraryItemId' in native
      ? library?.items.filter(item => item.id === native.libraryItemId && (!native.libraryItemVersion || item.version === native.libraryItemVersion)).sort((a, b) => b.version - a.version)[0]?.assets ?? []
      : []);
    const missing = [...canvasAssetRefs(scene), ...nativeLibraryAssets].filter(asset => !resolvedAssets[asset.path]);
    if (!missing.length) return;
    void Promise.all(missing.map(async asset => [asset.path, await window.bulletin!.readAsset(root, asset.path)] as const))
      .then(entries => {
        if (active) setResolvedAssets(current => ({ ...current, ...Object.fromEntries(entries) }));
      });
    return () => { active = false; };
  }, [root, scene, resolvedAssets, library]);

  const publish = (next: CanvasScene, previous = scene) => {
    setPast(value => [...value.slice(-49), clone(previous)]);
    setFuture([]);
    setScene(next);
    onChange({ ...block, scene: next });
  };
  const updateElements = (updater: (element: CanvasElement) => CanvasElement, ids = selected) =>
    publish({ ...scene, elements: scene.elements.map(element => ids.has(element.id) ? updater(element) : element) });
  const editable = (_element: CanvasElement) => true;

  const selectionFor = (id: string) => {
    const element = elements.get(id);
    return new Set(element?.groupId ? scene.elements.filter(item => item.groupId === element.groupId).map(item => item.id) : [id]);
  };
  const select = (id: string, additive: boolean) => setSelected(current => {
    const related = selectionFor(id);
    if (!additive) return related;
    const next = new Set(current);
    if (next.has(id)) related.forEach(item => next.delete(item)); else related.forEach(item => next.add(item));
    return next;
  });
  const beginDrag = (event: React.PointerEvent, element: CanvasElement, resize = false) => {
    event.stopPropagation();
    select(element.id, event.shiftKey);
    const related = selectionFor(element.id);
    const ids = event.shiftKey ? new Set([...selected, ...related]) : selected.has(element.id) ? selected : related;
    setSelected(ids);
    if (![...ids].every(id => { const item = elements.get(id); return item && editable(item); })) return;
    const dragScene = clone(scene);
    if (resize) dragScene.elements = dragScene.elements.map(item => ids.has(item.id) && item.type === 'block' && item.sizing === 'autoHeight'
      ? { ...item, height: measuredHeights[item.id] ?? item.height, sizing: 'fixed' }
      : item);
    drag.current = { x: event.clientX, y: event.clientY, scene: dragScene, resize };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: React.PointerEvent) => {
    if (!drag.current || !stage.current) return;
    const pixelsPerInch = stage.current.getBoundingClientRect().width / canvasWidth;
    const dx = (event.clientX - drag.current.x) / pixelsPerInch;
    const dy = (event.clientY - drag.current.y) / pixelsPerInch;
    setScene({
      ...drag.current.scene,
      elements: drag.current.scene.elements.map(element => {
        if (!selected.has(element.id) || !editable(element)) return element;
        const others = drag.current!.scene.elements.filter(item => !selected.has(item.id));
        const space = canvasSpace(drag.current!.scene, 0, canvasWidth, block.heightIn);
        const line = element.type === 'line' || (element.type === 'shape' && element.shape === 'line');
        return drag.current!.resize
          ? line && element.rotationDeg !== undefined
            ? { ...element, width: Math.max(1 / 16, snapCanvasValue(element.width + dx, event.altKey)), height: 0 }
            : { ...element, ...(element.type === 'block' ? { sizing: 'fixed' as const } : {}), width: Math.max(1 / 16, snapCanvasValue(element.width + dx, event.altKey)), height: Math.max(line ? 0 : 1 / 16, snapCanvasValue(element.height + dy, event.altKey)) }
          : {
              ...element,
              x: snapCanvasPosition(element.x + dx, element.width, space.width, others.flatMap(item => [item.x, item.x + item.width / 2, item.x + item.width]), event.altKey),
              y: snapCanvasPosition(element.y + dy, element.height, space.height, others.flatMap(item => [item.y, item.y + item.height / 2, item.y + item.height]), event.altKey)
            };
      })
    });
  };
  const endDrag = () => {
    if (!drag.current) return;
    const previous = drag.current.scene;
    drag.current = undefined;
    publish(scene, previous);
  };

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.matches('input, textarea, select')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selected.size && [...selected].every(id => { const item = elements.get(id); return item && editable(item); })) {
          event.preventDefault();
          publish({ ...scene, elements: scene.elements.filter(item => !selected.has(item.id)) });
          setSelected(new Set());
        }
        return;
      }
      const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const direction = directions[event.key];
      if (direction && selected.size) {
        event.preventDefault();
        const step = event.shiftKey ? .25 : 1 / 16;
        updateElements(element => ({ ...element, x: element.x + direction[0] * step, y: element.y + direction[1] * step }));
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });

  const undo = () => {
    const previous = past.at(-1);
    if (!previous) return;
    setPast(value => value.slice(0, -1)); setFuture(value => [clone(scene), ...value]); setScene(previous);
    onChange({ ...block, scene: previous });
  };
  const redo = () => {
    const next = future[0];
    if (!next) return;
    setFuture(value => value.slice(1)); setPast(value => [...value, clone(scene)]); setScene(next);
    onChange({ ...block, scene: next });
  };
  const nextId = (prefix: string) => {
    let index = 1;
    while (elements.has(`${prefix}-${index}`)) index++;
    return `${prefix}-${index}`;
  };
  const placePaletteItem = async (item: ElementPaletteItem, x = 1, y = 1) => {
    const payload = item.payload as ElementPalettePayload;
    const base = { id: nextId(payload.kind === 'shape' ? payload.shape : payload.kind), name: item.label, x, y, width: 2, height: payload.kind === 'shape' && payload.shape === 'line' ? 0 : .75 };
    let element: CanvasElement | undefined;
    if (payload.kind === 'component') {
      const native = instantiateComponentDefinition(payload.definition);
      element = { ...base, type: 'block', block: native, sizing: 'autoHeight' };
    } else if (payload.kind === 'image') {
      const asset = await onChooseAsset?.();
      if (!asset || asset.mediaType === 'application/pdf') return;
      element = { ...base, type: 'block', sizing: 'fixed', block: { id: `${base.id}-image`, type: 'image', asset, fit: 'contain', heightIn: base.height } };
    } else if (payload.kind === 'shape') {
      element = payload.shape === 'rectangle'
        ? { ...base, type: 'shape', shape: 'rectangle', fill: '#efe8dc', borderColor: '#a44d2a', borderWidthPt: 1 }
        : { ...base, type: 'shape', shape: 'line', color: '#25302d', widthPt: 1, rotationDeg: 0 };
    }
    if (!element) return;
    element.x = Math.max(0, Math.min(space.width - element.width, snapCanvasValue(element.x)));
    element.y = Math.max(0, Math.min(space.height - Math.max(element.height, 0), snapCanvasValue(element.y)));
    publish({ ...scene, elements: [...scene.elements, element] });
    setSelected(new Set([element.id]));
  };
  const endPaletteDrag = (event: DragEndEvent) => {
    setPaletteOverlay('');
    const item = event.active.data.current?.paletteItem as ElementPaletteItem | undefined;
    if (!item || event.over?.id !== 'canvas-stage-drop' || !stage.current || !event.active.rect.current.translated) return;
    const bounds = stage.current.getBoundingClientRect();
    const translated = event.active.rect.current.translated;
    const pxPerIn = bounds.width / canvasWidth;
    void placePaletteItem(item, (translated.left + translated.width / 2 - bounds.left) / pxPerIn - 1, (translated.top + translated.height / 2 - bounds.top) / pxPerIn - .375);
  };
  const duplicate = () => {
    const copies = scene.elements.filter(item => selected.has(item.id)).map(item => ({ ...clone(item), id: nextId(item.type), x: item.x + .125, y: item.y + .125 }));
    if (!copies.length) return;
    publish({ ...scene, elements: [...scene.elements, ...copies] });
    setSelected(new Set(copies.map(item => item.id)));
  };
  const group = () => {
    if (selected.size < 2) return;
    const groupId = `group-${Date.now().toString(36)}`;
    updateElements(element => ({ ...element, groupId }));
  };
  const align = (edge: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
    const items = scene.elements.filter(item => selected.has(item.id));
    if (items.length < 2) return;
    const left = Math.min(...items.map(item => item.x)); const right = Math.max(...items.map(item => item.x + item.width));
    const top = Math.min(...items.map(item => item.y)); const bottom = Math.max(...items.map(item => item.y + item.height));
    updateElements(element => ({
      ...element,
      x: edge === 'left' ? left : edge === 'right' ? right - element.width : edge === 'center' ? (left + right - element.width) / 2 : element.x,
      y: edge === 'top' ? top : edge === 'bottom' ? bottom - element.height : edge === 'middle' ? (top + bottom - element.height) / 2 : element.y
    }));
  };
  const distribute = (axis: 'horizontal' | 'vertical') => {
    const items = scene.elements.filter(item => selected.has(item.id)).sort((left, right) => axis === 'horizontal' ? left.x - right.x : left.y - right.y);
    if (items.length < 3) return;
    const first = items[0]; const last = items.at(-1)!;
    const occupied = items.reduce((total, item) => total + (axis === 'horizontal' ? item.width : item.height), 0);
    const extent = axis === 'horizontal' ? last.x + last.width - first.x : last.y + last.height - first.y;
    const gap = (extent - occupied) / (items.length - 1);
    let cursor = axis === 'horizontal' ? first.x : first.y;
    const positions = new Map<string, number>();
    items.forEach(item => { positions.set(item.id, cursor); cursor += (axis === 'horizontal' ? item.width : item.height) + gap; });
    updateElements(item => axis === 'horizontal' ? { ...item, x: positions.get(item.id)! } : { ...item, y: positions.get(item.id)! });
  };
  const updatePrimary = (changes: Partial<CanvasElement>) => {
    if (!primary) return;
    updateElements(element => element.id === primary.id ? { ...element, ...changes } as CanvasElement : element, new Set([primary.id]));
  };
  const setNumber = (key: 'x' | 'y' | 'width' | 'height', value: number) => {
    if (Number.isFinite(value)) updatePrimary({ [key]: value } as Partial<CanvasElement>);
  };
  const space = canvasSpace(scene, 0, canvasWidth, block.heightIn);

  const paletteItems = canvasElementPaletteItems(definitions);
  return <DndContext sensors={paletteSensors} onDragStart={event => setPaletteOverlay((event.active.data.current?.paletteItem as ElementPaletteItem | undefined)?.label ?? '')} onDragCancel={() => setPaletteOverlay('')} onDragEnd={endPaletteDrag}>
  <div className="canvas-designer" role="dialog" aria-modal="true" aria-labelledby="canvas-designer-title">
    <header className="canvas-designer-toolbar">
      <div><div className="eyebrow">Positioned page content</div><h2 id="canvas-designer-title">Canvas designer</h2></div>
      <div className="canvas-tools">
        <button disabled={!selected.size} onClick={duplicate}>Duplicate</button><button disabled={selected.size < 2} onClick={group}>Group</button><button disabled={!selected.size} onClick={() => updateElements(item => ({ ...item, locked: ![...selected].every(id => elements.get(id)?.locked) }))}>Lock / unlock</button>
        <button disabled={!past.length} onClick={undo}>Undo</button><button disabled={!future.length} onClick={redo}>Redo</button>
      </div>
      <div className="canvas-view-tools">
        <button type="button" className={`ruler-toggle ${showRulers ? 'active' : ''}`} aria-label={`${showRulers ? 'Hide' : 'Show'} rulers`} aria-pressed={showRulers} onClick={toggleRulers}>Rulers</button>
        <PreviewZoomControls zoom={zoom} onChange={changeZoom} onFit={fitCanvas} />
      </div>
      <button className="primary" onClick={onClose}>Done</button>
    </header>
    <aside className="canvas-layers">
      <ElementPalette items={paletteItems} storageKey="bulletin-elements-canvas" onUse={item => void placePaletteItem(item)} />
      <div className="canvas-layer-heading"><div className="eyebrow">Layers</div><small>{scene.elements.length}</small></div>
      <ol>{[...scene.elements].reverse().map(element => <li className={selected.has(element.id) ? 'selected' : ''} key={element.id}>
        <button onClick={event => select(element.id, event.shiftKey)}><span>{element.type === 'block' ? element.block.type === 'image' ? '▧' : '◇' : element.type === 'shape' ? element.shape === 'line' ? '╱' : '□' : element.type === 'text' ? 'T' : element.type === 'image' ? '▧' : element.type === 'line' ? '╱' : '□'}</span><b>{element.name ?? element.id}</b>{element.locked && <small>🔒</small>}</button>
        <div><button title="Move forward" onClick={() => { const index = scene.elements.indexOf(element); if (index < scene.elements.length - 1) { const next = [...scene.elements]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; publish({ ...scene, elements: next }); } }}>↑</button><button title="Move backward" onClick={() => { const index = scene.elements.indexOf(element); if (index > 0) { const next = [...scene.elements]; [next[index], next[index - 1]] = [next[index - 1], next[index]]; publish({ ...scene, elements: next }); } }}>↓</button></div>
      </li>)}</ol>
    </aside>
    <main className="canvas-workarea" ref={workarea} onWheel={handleWheel}>
      <div className={`canvas-stage-frame ${showRulers ? 'with-rulers' : ''}`} style={{ width: `${canvasWidth * 96 * zoom}px`, height: `${block.heightIn * 96 * zoom}px` }}>
      {showRulers && <><PageRulers widthIn={canvasWidth} heightIn={block.heightIn} /><div className="page-crosshairs" aria-hidden="true"><i className="crosshair-vertical" /><i className="crosshair-horizontal" /></div></>}
      <CanvasDropTarget stage={stage}><div className="canvas-stage" style={{ width: `${canvasWidth}in`, height: `${block.heightIn}in`, transform: `scale(${zoom})` }} onPointerMove={event => { moveDrag(event); if (showRulers) trackPointer(event); }} onPointerLeave={showRulers ? stopTrackingPointer : undefined} onPointerUp={endDrag} onPointerCancel={endDrag} onPointerDown={event => { if (event.target === event.currentTarget) setSelected(new Set()); }}>
        <CanvasSceneView scene={scene} document={document} assets={resolvedAssets} marginIn={0} widthIn={canvasWidth} heightIn={block.heightIn} renderNativeBlock={native => <NativeBlockPreview block={native} library={library} assets={resolvedAssets} document={document} marginIn={marginIn} />} />
        <div className="canvas-safe-guide" style={{ left: `${space.x}in`, top: `${space.y}in`, width: `${space.width}in`, height: `${space.height}in` }} />
        <div className="canvas-selection-layer" style={{ left: `${space.x}in`, top: `${space.y}in`, width: `${space.width}in`, height: `${space.height}in` }}>
          {scene.elements.map(element => {
            const line = element.type === 'line' || (element.type === 'shape' && element.shape === 'line');
            const metrics = line ? canvasLineMetrics(element) : undefined;
            return <div className={`canvas-selection ${selected.has(element.id) ? 'selected' : ''} ${element.locked ? 'locked' : ''}`} key={element.id} style={{ left: `${element.x}in`, top: `${element.y}in`, width: `${metrics?.length ?? element.width}in`, height: `${line ? .04 : Math.max(measuredHeights[element.id] ?? element.height, .04)}in`, transform: metrics ? `rotate(${metrics.rotationDeg}deg)` : undefined, transformOrigin: metrics ? '0 50%' : undefined }} onPointerDown={event => beginDrag(event, element)}>
              {selected.has(element.id) && editable(element) && <i className="canvas-resize-handle" onPointerDown={event => beginDrag(event, element, true)} />}
            </div>;
          })}
        </div>
      </div></CanvasDropTarget>
      </div>
      <div className="canvas-align-tools"><span>Align selection</span>{(['left', 'center', 'right', 'top', 'middle', 'bottom'] as const).map(edge => <button disabled={selected.size < 2} onClick={() => align(edge)} key={edge}>{edge}</button>)}<button disabled={selected.size < 3} onClick={() => distribute('horizontal')}>distribute H</button><button disabled={selected.size < 3} onClick={() => distribute('vertical')}>distribute V</button></div>
    </main>
    <aside className="canvas-properties">
      <div className="eyebrow">Properties</div>
      <label>Coordinate space<select value={scene.coordinateSpace} onChange={event => publish(convertCanvasCoordinateSpace(scene, event.target.value as CanvasScene['coordinateSpace'], 0))}><option value="fullPage">Canvas bounds</option><option value="contentBox">Canvas content box</option></select></label>
      <label>Background color<input type="color" value={scene.background?.color ?? '#ffffff'} onChange={event => publish({ ...scene, background: { ...scene.background, color: event.target.value } })} /></label>
      <div className="builder-actions"><button className="secondary" onClick={async () => { const asset = await onChooseAsset?.(); if (asset) publish({ ...scene, background: { ...scene.background, asset, fit: 'cover' } }); }}>{scene.background?.asset ? 'Replace background' : 'Add image / PDF background'}</button>{scene.background?.asset && <button className="danger-text" onClick={() => { const background = { ...scene.background }; delete background.asset; publish({ ...scene, background }); }}>Remove</button>}</div>
      {scene.background?.asset && <label>Background fit<select value={scene.background.fit ?? 'cover'} onChange={event => publish({ ...scene, background: { ...scene.background, fit: event.target.value as 'contain' | 'cover' | 'fill' } })}><option value="contain">Contain</option><option value="cover">Cover</option><option value="fill">Fill</option></select></label>}
      {primary ? <>
        <h3>{primary.name ?? primary.id}</h3>
        <label>Name<input value={primary.name ?? ''} disabled={!editable(primary)} onChange={event => updatePrimary({ name: event.target.value })} /></label>
        <div className="canvas-geometry-grid">{(['x', 'y', 'width', 'height'] as const).map(key => <label key={key}>{key}<input type="number" step=".0625" value={primary[key]} disabled={!editable(primary)} onChange={event => setNumber(key, event.currentTarget.valueAsNumber)} /></label>)}</div>
        <label className="check"><input type="checkbox" checked={primary.locked ?? false} onChange={event => updatePrimary({ locked: event.target.checked })} />Locked</label>
        {primary.type === 'block' && <>
          <label>Sizing<select value={primary.sizing ?? 'autoHeight'} onChange={event => updatePrimary({ sizing: event.target.value as 'autoHeight' | 'fixed' } as Partial<CanvasElement>)}><option value="autoHeight">Auto height</option><option value="fixed">Fixed / clip</option></select></label>
          {nativePrimary && <NativeBlockFields block={nativePrimary} onChange={next => updatePrimary({ block: next } as Partial<CanvasElement>)} />}
          {nativePrimary && nativePrimary.type !== 'image' && <>
            <label>Vertical alignment<select value={primary.verticalAlign ?? 'top'} onChange={event => updatePrimary({ verticalAlign: event.target.value as 'top' | 'middle' | 'bottom' } as Partial<CanvasElement>)}><option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option></select></label>
            <button className="secondary canvas-format-button" onClick={() => setFormattingElementId(primary.id)}>Format block…</button>
          </>}
        </>}
        {primary.type === 'shape' && primary.shape === 'rectangle' && <><label>Fill<input type="color" value={primary.fill ?? '#efe8dc'} onChange={event => updatePrimary({ fill: event.target.value } as Partial<CanvasElement>)} /></label><label>Border<input type="color" value={primary.borderColor ?? '#a44d2a'} onChange={event => updatePrimary({ borderColor: event.target.value } as Partial<CanvasElement>)} /></label></>}
        {linePrimary && <>
          <label>Line color<input type="color" value={linePrimary.color ?? '#25302d'} onChange={event => updatePrimary({ color: event.target.value } as Partial<CanvasElement>)} /></label>
          <div className="canvas-geometry-grid">
            <label>Weight (pt)<input type="number" min=".25" max="24" step=".25" value={linePrimary.widthPt ?? 1} onChange={event => { if (event.currentTarget.valueAsNumber > 0) updatePrimary({ widthPt: event.currentTarget.valueAsNumber } as Partial<CanvasElement>); }} /></label>
            <label>Rotation (°)<input type="number" step="1" value={Math.round(canvasLineMetrics(linePrimary).rotationDeg * 100) / 100} onChange={event => { if (Number.isFinite(event.currentTarget.valueAsNumber)) updatePrimary(rotateCanvasLine(linePrimary, event.currentTarget.valueAsNumber)); }} /></label>
          </div>
          <label>Line style<select value={linePrimary.dash ?? 'solid'} onChange={event => updatePrimary({ dash: event.target.value as 'solid' | 'dashed' | 'dotted' } as Partial<CanvasElement>)}><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select></label>
        </>}
        {primary.type === 'text' && <>
          <label>Text binding<select disabled={!editable(primary)} value={primary.source.binding ?? ''} onChange={event => updatePrimary({ source: { ...primary.source, binding: event.target.value as CanvasTextBinding || undefined } } as Partial<CanvasElement>)}><option value="">Literal text</option><option value="info.title">Sermon title</option><option value="info.date">Service date</option><option value="info.churchWeek">Church week</option><option value="info.series">Series</option><option value="church.name">Church name</option></select></label>
          <label>{primary.source.binding ? 'Weekly override' : 'Text'}<textarea rows={5} disabled={!editable(primary)} value={plainText(primary.source.binding ? primary.source.override : primary.source.literal)} placeholder={primary.source.binding ? plainText(canvasTextParagraphs(primary, document)) : ''} onChange={event => updatePrimary({ source: { ...primary.source, [primary.source.binding ? 'override' : 'literal']: text(event.target.value) } } as Partial<CanvasElement>)} /></label>
          {primary.source.binding && primary.source.override && <button className="text-button" onClick={() => { const { override: _override, ...source } = primary.source; updatePrimary({ source } as Partial<CanvasElement>); }}>Reset to bound value</button>}
          {primary.source.binding === 'info.date' && <label>Date format<select value={primary.source.dateFormat ?? 'long'} onChange={event => updatePrimary({ source: { ...primary.source, dateFormat: event.target.value as 'long' | 'medium' | 'short' | 'iso' } } as Partial<CanvasElement>)}><option value="long">July 27, 2026</option><option value="medium">Jul 27, 2026</option><option value="short">7/27/26</option><option value="iso">2026-07-27</option></select></label>}
          <div className="canvas-geometry-grid"><label>Size (pt)<input type="number" min="5" value={primary.fontSizePt ?? 12} onChange={event => updatePrimary({ fontSizePt: event.currentTarget.valueAsNumber } as Partial<CanvasElement>)} /></label><label>Overflow<select value={primary.overflow ?? 'fixed'} onChange={event => updatePrimary({ overflow: event.target.value as 'autoHeight' | 'shrinkToFit' | 'fixed' } as Partial<CanvasElement>)}><option value="autoHeight">Auto height</option><option value="shrinkToFit">Shrink to fit</option><option value="fixed">Fixed / clip</option></select></label></div>
        </>}
        {primary.type === 'image' && <label>Image fit<select value={primary.fit ?? 'contain'} onChange={event => updatePrimary({ fit: event.target.value as 'contain' | 'cover' | 'fill' } as Partial<CanvasElement>)}><option value="contain">Contain</option><option value="cover">Cover</option><option value="fill">Fill</option></select></label>}
      </> : <p className="helper">Select an object to edit its geometry and content. Shift-click selects more than one.</p>}
      {issues.length > 0 && <div className="canvas-issues"><b>{issues.length} scene notice{issues.length === 1 ? '' : 's'}</b>{issues.map(issue => <p className={issue.severity} key={`${issue.path}-${issue.message}`}>{issue.message}</p>)}</div>}
    </aside>
  </div>
  {formattingElementId && (() => {
    const element = scene.elements.find(item => item.id === formattingElementId);
    if (element?.type !== 'block') return null;
    return <div className="canvas-formatting-layer"><BlockFormattingModal
      block={element.block}
      template={template}
      scope={scope}
      onClose={() => setFormattingElementId(undefined)}
      onSave={(presentation, layout) => {
        publish({ ...scene, elements: scene.elements.map(item => item.id === element.id && item.type === 'block' ? { ...item, block: { ...item.block, presentation, layout } } : item) });
        setFormattingElementId(undefined);
      }}
    /></div>;
  })()}
  <DragOverlay>{paletteOverlay && <div className="palette-drag-overlay">{paletteOverlay}</div>}</DragOverlay>
  </DndContext>;
}
