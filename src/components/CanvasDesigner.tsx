import { useEffect, useMemo, useRef, useState } from 'react';
import {
  canvasAssetRefs,
  canvasSpace,
  canvasTextParagraphs,
  convertCanvasCoordinateSpace,
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
  Paragraph
} from '../shared/types.js';
import { CanvasSceneView } from './CanvasSceneView.js';

const text = (value: string): Paragraph[] => value.split(/\n\s*\n/).map(item => ({
  type: 'paragraph',
  children: [{ type: 'text', text: item }]
}));
const plainText = (content: Paragraph[] | undefined) => content?.map(item => item.children.map(run => run.type === 'text' ? run.text : run.type === 'lineBreak' ? '\n' : '✠').join('')).join('\n\n') ?? '';
const clone = <T,>(value: T): T => structuredClone(value);

export function CanvasDesigner({ block, document, marginIn, assets, root, onChooseAsset, onChange, onClose }: {
  block: CanvasBlock;
  document: BulletinDocumentV1;
  marginIn: number;
  assets: Record<string, string>;
  root?: string;
  onChooseAsset?(): Promise<AssetRef | null>;
  onChange(block: CanvasBlock): void;
  onClose(): void;
}) {
  const initial = block.scene;
  const [scene, setScene] = useState<CanvasScene>(() => clone(initial));
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [past, setPast] = useState<CanvasScene[]>([]);
  const [future, setFuture] = useState<CanvasScene[]>([]);
  const [resolvedAssets, setResolvedAssets] = useState<Record<string, string>>(assets);
  const drag = useRef<{ x: number; y: number; scene: CanvasScene; resize: boolean } | undefined>(undefined);
  const stage = useRef<HTMLDivElement>(null);
  const canvasWidth = (block.widthMode ?? 'contentBox') === 'fullPage' ? 7 : 7 - marginIn * 2;
  const elements = useMemo(() => new Map(scene.elements.map(element => [element.id, element])), [scene.elements]);
  const primary = [...selected].map(id => elements.get(id)).find(Boolean);
  const issues = validateCanvasScene(scene, marginIn, '/scene', 7, block.heightIn);

  useEffect(() => {
    if (!root || !window.bulletin) return;
    let active = true;
    const missing = canvasAssetRefs(scene).filter(asset => !resolvedAssets[asset.path]);
    if (!missing.length) return;
    void Promise.all(missing.map(async asset => [asset.path, await window.bulletin!.readAsset(root, asset.path)] as const))
      .then(entries => {
        if (active) setResolvedAssets(current => ({ ...current, ...Object.fromEntries(entries) }));
      });
    return () => { active = false; };
  }, [root, scene, resolvedAssets]);

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
    drag.current = { x: event.clientX, y: event.clientY, scene: clone(scene), resize };
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
        return drag.current!.resize
          ? { ...element, width: Math.max(1 / 16, snapCanvasValue(element.width + dx, event.altKey)), height: Math.max(element.type === 'line' ? 0 : 1 / 16, snapCanvasValue(element.height + dy, event.altKey)) }
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
  const add = async (type: CanvasElement['type']) => {
    const base = { id: nextId(type), name: `New ${type}`, x: 1, y: 1, width: 2, height: type === 'line' ? 0 : .75 };
    let element: CanvasElement;
    if (type === 'text') element = { ...base, type, source: { literal: text('New text') }, fontSizePt: 16 };
    else if (type === 'rectangle') element = { ...base, type, fill: '#efe8dc', borderColor: '#a44d2a', borderWidthPt: 1 };
    else if (type === 'line') element = { ...base, type, color: '#25302d', widthPt: 1 };
    else {
      const asset = await onChooseAsset?.();
      if (!asset || asset.mediaType === 'application/pdf') return;
      element = { ...base, type, asset, fit: 'contain' };
    }
    publish({ ...scene, elements: [...scene.elements, element] });
    setSelected(new Set([element.id]));
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

  return <div className="canvas-designer" role="dialog" aria-modal="true" aria-labelledby="canvas-designer-title">
    <header className="canvas-designer-toolbar">
      <div><div className="eyebrow">Positioned page content</div><h2 id="canvas-designer-title">Canvas designer</h2></div>
      <div className="canvas-tools">
        <button onClick={() => void add('text')}>＋ Text</button><button onClick={() => void add('image')}>＋ Image</button><button onClick={() => void add('rectangle')}>＋ Rectangle</button><button onClick={() => void add('line')}>＋ Line</button>
        <button disabled={!selected.size} onClick={duplicate}>Duplicate</button><button disabled={selected.size < 2} onClick={group}>Group</button><button disabled={!selected.size} onClick={() => updateElements(item => ({ ...item, locked: ![...selected].every(id => elements.get(id)?.locked) }))}>Lock / unlock</button>
        <button disabled={!past.length} onClick={undo}>Undo</button><button disabled={!future.length} onClick={redo}>Redo</button>
      </div>
      <button className="primary" onClick={onClose}>Done</button>
    </header>
    <aside className="canvas-layers">
      <div className="eyebrow">Layers</div>
      <ol>{[...scene.elements].reverse().map(element => <li className={selected.has(element.id) ? 'selected' : ''} key={element.id}>
        <button onClick={event => select(element.id, event.shiftKey)}><span>{element.type === 'text' ? 'T' : element.type === 'image' ? '▧' : element.type === 'line' ? '╱' : '□'}</span><b>{element.name ?? element.id}</b>{element.locked && <small>🔒</small>}</button>
        <div><button title="Move forward" onClick={() => { const index = scene.elements.indexOf(element); if (index < scene.elements.length - 1) { const next = [...scene.elements]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; publish({ ...scene, elements: next }); } }}>↑</button><button title="Move backward" onClick={() => { const index = scene.elements.indexOf(element); if (index > 0) { const next = [...scene.elements]; [next[index], next[index - 1]] = [next[index - 1], next[index]]; publish({ ...scene, elements: next }); } }}>↓</button></div>
      </li>)}</ol>
    </aside>
    <main className="canvas-workarea">
      <div className="canvas-ruler-label horizontal">0　1　2　3　4　5　6　7 in</div>
      <div className="canvas-ruler-label vertical">0　1　2　3　4　5　6　7　8</div>
      <div className="canvas-stage" ref={stage} style={{ width: `${canvasWidth}in`, height: `${block.heightIn}in` }} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onPointerDown={event => { if (event.target === event.currentTarget) setSelected(new Set()); }}>
        <CanvasSceneView scene={scene} document={document} assets={resolvedAssets} marginIn={0} widthIn={canvasWidth} heightIn={block.heightIn} />
        <div className="canvas-safe-guide" style={{ left: `${space.x}in`, top: `${space.y}in`, width: `${space.width}in`, height: `${space.height}in` }} />
        <div className="canvas-selection-layer" style={{ left: `${space.x}in`, top: `${space.y}in`, width: `${space.width}in`, height: `${space.height}in` }}>
          {scene.elements.map(element => <div className={`canvas-selection ${selected.has(element.id) ? 'selected' : ''} ${element.locked ? 'locked' : ''}`} key={element.id} style={{ left: `${element.x}in`, top: `${element.y}in`, width: `${element.width}in`, height: `${Math.max(element.height, .04)}in` }} onPointerDown={event => beginDrag(event, element)}>
            {selected.has(element.id) && editable(element) && <i className="canvas-resize-handle" onPointerDown={event => beginDrag(event, element, true)} />}
          </div>)}
        </div>
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
  </div>;
}
