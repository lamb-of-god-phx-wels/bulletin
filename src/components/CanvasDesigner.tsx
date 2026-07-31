import { cloneElement, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactElement, type Ref } from 'react';
import { closestCenter, DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import {
  canvasAssetRefs,
  canvasElementBounds,
  canvasNativeBlocks,
  canvasLineMetrics,
  canvasSpace,
  canvasTextParagraphs,
  cloneCanvasSelection,
  normalizeCanvasScene,
  reorderCanvasElements,
  rotateCanvasLine,
  snapCanvasAxis,
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
import { songHeader } from '../shared/songs.js';
import { BlockFormattingModal } from './BlockFormattingModal.js';
import { NativeBlockPreview, PageRulers, stopTrackingPointer, trackPointer } from './DocumentView.js';
import { PreviewZoomControls, stepPreviewZoom } from './PreviewZoomControls.js';
import { ImageAssetDialog } from './ImageAssetDialog.js';
import { SortableHandle, SortableItem } from './SortableList.js';
import { InlineTypographyControls, supportsInlineTypography } from './InlineTypographyControls.js';

const text = (value: string): Paragraph[] => value.split(/\n\s*\n/).map(item => ({
  type: 'paragraph',
  children: [{ type: 'text', text: item }]
}));
const plainText = (content: Paragraph[] | undefined) => content?.map(item => item.children.map(run => run.type === 'text' ? run.text : run.type === 'lineBreak' ? '\n' : '✠').join('')).join('\n\n') ?? '';
const clone = <T,>(value: T): T => structuredClone(value);
const CANVAS_CLIPBOARD_PREFIX = 'bulletin-canvas-elements:';
let canvasElementClipboard: CanvasElement[] = [];

const isTextInput = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable);
const matchingSnapGuide = (position: number, size: number, lines: number[]) =>
  lines.find(line => [position, position + size / 2, position + size].some(edge => Math.abs(edge - line) < .001));

function CanvasDropTarget({ stage, children }: { stage: MutableRefObject<HTMLDivElement | null>; children: ReactElement<{ ref?: Ref<HTMLDivElement>; className?: string }> }) {
  const drop = useDroppable({ id: 'canvas-stage-drop' });
  return cloneElement(children, {
    ref: (node: HTMLDivElement | null) => { stage.current = node; drop.setNodeRef(node); },
    className: `${children.props.className ?? ''} ${drop.isOver ? 'palette-drop-active' : ''}`.trim()
  });
}

export function CanvasDesigner({ block, document, template, scope, marginIn, assets, root, definitions = [], library, imageTargetFolder = 'assets/canvases', onLibraryChange, onError, onChooseAsset, onChange, onClose }: {
  block: CanvasBlock;
  document: BulletinDocumentV1;
  template: TemplateV1;
  scope: 'template' | 'weekly';
  marginIn: number;
  assets: Record<string, string>;
  root?: string;
  definitions?: DeclarativeComponentDefinition[];
  library?: LibraryManifestV1;
  imageTargetFolder?: string;
  onLibraryChange?(library: LibraryManifestV1, alreadySaved?: boolean): Promise<void>;
  onError?(message: string): void;
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
  const [, setSnapGuides] = useState<{ x?: number; y?: number }>({});
  const snapGuidesRef = useRef<{ x?: number; y?: number }>({});
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number }>();
  const drag = useRef<{ x: number; y: number; scene: CanvasScene; preview: CanvasScene; ids: Set<string>; resize: boolean } | undefined>(undefined);
  const snapGuideTimer = useRef<number | undefined>(undefined);
  const stage = useRef<HTMLDivElement>(null);
  const workarea = useRef<HTMLElement>(null);
  const initialZoom = Number(localStorage.getItem('bulletin-preview-zoom'));
  const hasInitialZoom = Number.isFinite(initialZoom) && initialZoom >= .1 && initialZoom <= 2;
  const [zoom, setZoom] = useState(hasInitialZoom ? initialZoom : .72);
  const zoomMode = useRef<'page' | 'width' | 'manual'>(hasInitialZoom ? 'manual' : 'page');
  const [showRulers, setShowRulers] = useState(() => localStorage.getItem('bulletin-show-rulers') !== 'false');
  const [showGuides, setShowGuides] = useState(() => localStorage.getItem('bulletin-show-guides') === 'true');
  const [snapEnabled, setSnapEnabled] = useState(() => localStorage.getItem('bulletin-canvas-snap') !== 'false');
  const [clipboardAvailable, setClipboardAvailable] = useState(() => canvasElementClipboard.length > 0);
  const paletteSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const [paletteOverlay, setPaletteOverlay] = useState('');
  const [pendingImage, setPendingImage] = useState<{ id: string; name: string; x: number; y: number; width: number; height: number }>();
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
  const toggleGuides = () => {
    setShowGuides(current => {
      const next = !current;
      localStorage.setItem('bulletin-show-guides', String(next));
      return next;
    });
  };
  const toggleSnap = () => {
    setSnapEnabled(current => {
      const next = !current;
      localStorage.setItem('bulletin-canvas-snap', String(next));
      return next;
    });
  };
  const updateSnapGuides = (next: { x?: number; y?: number }) => {
    snapGuidesRef.current = next;
    setSnapGuides(next);
  };

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = (event: PointerEvent) => {
      if (!(event.target as Element | null)?.closest('.canvas-context-menu')) setContextMenu(undefined);
    };
    window.addEventListener('pointerdown', dismiss);
    return () => window.removeEventListener('pointerdown', dismiss);
  }, [contextMenu]);
  useEffect(() => () => {
    if (snapGuideTimer.current !== undefined) window.clearTimeout(snapGuideTimer.current);
  }, []);

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
    if (snapGuideTimer.current !== undefined) window.clearTimeout(snapGuideTimer.current);
    const dragScene = clone(scene);
    if (resize) dragScene.elements = dragScene.elements.map(item => ids.has(item.id) && item.type === 'block' && item.sizing === 'autoHeight'
      ? { ...item, height: measuredHeights[item.id] ?? item.height, sizing: 'fixed' }
      : item);
    drag.current = { x: event.clientX, y: event.clientY, scene: dragScene, preview: dragScene, ids, resize };
    setContextMenu(undefined);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: React.PointerEvent) => {
    if (!drag.current || !stage.current) return;
    const pixelsPerInch = stage.current.getBoundingClientRect().width / canvasWidth;
    const dx = (event.clientX - drag.current.x) / pixelsPerInch;
    const dy = (event.clientY - drag.current.y) / pixelsPerInch;
    const active = drag.current.scene.elements.filter(element => drag.current!.ids.has(element.id));
    const others = drag.current.scene.elements.filter(element => !drag.current!.ids.has(element.id));
    const currentSpace = canvasSpace(drag.current.scene, 0, canvasWidth, block.heightIn);
    const xTargets = [
      ...(marginIn > 0 ? [marginIn, currentSpace.width - marginIn] : []),
      ...others.flatMap(item => [item.x, item.x + item.width / 2, item.x + item.width])
    ];
    const yTargets = [
      ...(marginIn > 0 ? [marginIn, currentSpace.height - marginIn] : []),
      ...others.flatMap(item => [item.y, item.y + item.height / 2, item.y + item.height])
    ];
    const bypass = !snapEnabled || event.altKey;
    const horizontalLines = [0, currentSpace.width / 2, currentSpace.width, ...xTargets];
    const verticalLines = [0, currentSpace.height / 2, currentSpace.height, ...yTargets];
    let next: CanvasScene;
    if (drag.current.resize) {
      const element = active[0];
      if (!element) return;
      const right = snapCanvasAxis(element.x + element.width + dx, 0, currentSpace.width, xTargets, bypass);
      const bottom = snapCanvasAxis(element.y + element.height + dy, 0, currentSpace.height, yTargets, bypass);
      const line = element.type === 'line' || (element.type === 'shape' && element.shape === 'line');
      next = {
        ...drag.current.scene,
        elements: drag.current.scene.elements.map(item => item.id !== element.id ? item : line && element.rotationDeg !== undefined
          ? { ...item, width: Math.max(1 / 16, right.value - element.x), height: 0 } as CanvasElement
          : {
              ...item,
              ...(item.type === 'block' ? { sizing: 'fixed' as const } : {}),
              width: Math.max(1 / 16, right.value - element.x),
              height: Math.max(line ? 0 : 1 / 16, bottom.value - element.y)
            } as CanvasElement)
      };
      updateSnapGuides(bypass ? {} : {
        x: right.guide ?? matchingSnapGuide(right.value, 0, horizontalLines),
        y: line ? undefined : bottom.guide ?? matchingSnapGuide(bottom.value, 0, verticalLines)
      });
    } else {
      const bounds = canvasElementBounds(active);
      const horizontal = snapCanvasAxis(bounds.x + dx, bounds.width, currentSpace.width, xTargets, bypass);
      const vertical = snapCanvasAxis(bounds.y + dy, bounds.height, currentSpace.height, yTargets, bypass);
      const moveX = horizontal.value - bounds.x;
      const moveY = vertical.value - bounds.y;
      next = {
        ...drag.current.scene,
        elements: drag.current.scene.elements.map(element => drag.current!.ids.has(element.id) && editable(element)
          ? { ...element, x: element.x + moveX, y: element.y + moveY }
          : element)
      };
      updateSnapGuides(bypass ? {} : {
        x: horizontal.guide ?? matchingSnapGuide(horizontal.value, bounds.width, horizontalLines),
        y: vertical.guide ?? matchingSnapGuide(vertical.value, bounds.height, verticalLines)
      });
    }
    drag.current.preview = next;
    setScene(next);
  };
  const endDrag = () => {
    if (!drag.current) return;
    const previous = drag.current.scene;
    const next = drag.current.preview;
    drag.current = undefined;
    snapGuideTimer.current = window.setTimeout(() => {
      updateSnapGuides({});
      snapGuideTimer.current = undefined;
    }, 180);
    publish(next, previous);
  };

  const addClonedElements = (source: CanvasElement[]) => {
    if (!source.length) return;
    let copies = cloneCanvasSelection(source, new Set(source.map(element => element.id)), .125, scene.elements);
    const bounds = canvasElementBounds(copies);
    const currentSpace = canvasSpace(scene, 0, canvasWidth, block.heightIn);
    const shiftX = bounds.width <= currentSpace.width
      ? bounds.x < 0 ? -bounds.x : bounds.x + bounds.width > currentSpace.width ? currentSpace.width - bounds.x - bounds.width : 0
      : 0;
    const shiftY = bounds.height <= currentSpace.height
      ? bounds.y < 0 ? -bounds.y : bounds.y + bounds.height > currentSpace.height ? currentSpace.height - bounds.y - bounds.height : 0
      : 0;
    if (shiftX || shiftY) copies = copies.map(element => ({ ...element, x: element.x + shiftX, y: element.y + shiftY }));
    publish({ ...scene, elements: [...scene.elements, ...copies] });
    setSelected(new Set(copies.map(element => element.id)));
  };
  const copySelection = () => {
    const copied = scene.elements.filter(element => selected.has(element.id)).map(clone);
    if (!copied.length) return;
    canvasElementClipboard = copied;
    setClipboardAvailable(true);
    const serialized = `${CANVAS_CLIPBOARD_PREFIX}${JSON.stringify(copied)}`;
    void navigator.clipboard?.writeText(serialized).catch(() => undefined);
  };
  const pasteSelection = (serialized?: string) => {
    let source = canvasElementClipboard;
    if (serialized?.startsWith(CANVAS_CLIPBOARD_PREFIX)) {
      try {
        const parsed = JSON.parse(serialized.slice(CANVAS_CLIPBOARD_PREFIX.length));
        if (Array.isArray(parsed)) source = parsed as CanvasElement[];
      } catch {
        // Keep the reliable in-application clipboard fallback.
      }
    }
    addClonedElements(source);
  };

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (isTextInput(event.target)) return;
      if (event.key === 'Escape' && contextMenu) {
        event.preventDefault();
        setContextMenu(undefined);
        return;
      }
      const command = event.ctrlKey || event.metaKey;
      if ((command && event.key.toLowerCase() === 'c') || (event.ctrlKey && event.key === 'Insert')) {
        if (selected.size) {
          event.preventDefault();
          copySelection();
        }
        return;
      }
      if ((command && event.key.toLowerCase() === 'v') || (event.shiftKey && event.key === 'Insert')) {
        if (canvasElementClipboard.length) {
          event.preventDefault();
          pasteSelection();
        }
        return;
      }
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
    const copyEvent = (event: ClipboardEvent) => {
      if (isTextInput(event.target) || !selected.size) return;
      copySelection();
      event.clipboardData?.setData('text/plain', `${CANVAS_CLIPBOARD_PREFIX}${JSON.stringify(canvasElementClipboard)}`);
      event.preventDefault();
    };
    const pasteEvent = (event: ClipboardEvent) => {
      if (isTextInput(event.target)) return;
      const serialized = event.clipboardData?.getData('text/plain');
      if (!serialized?.startsWith(CANVAS_CLIPBOARD_PREFIX) && !canvasElementClipboard.length) return;
      event.preventDefault();
      pasteSelection(serialized);
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('copy', copyEvent);
    window.addEventListener('paste', pasteEvent);
    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('copy', copyEvent);
      window.removeEventListener('paste', pasteEvent);
    };
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
      setPendingImage(base);
      return;
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
  const endDesignerDrag = (event: DragEndEvent) => {
    setPaletteOverlay('');
    const activeId = String(event.active.id);
    if (!activeId.startsWith('canvas-layer:')) {
      endPaletteDrag(event);
      return;
    }
    const overId = event.over ? String(event.over.id) : '';
    if (!overId.startsWith('canvas-layer:') || activeId === overId) return;
    const frontToBack = [...scene.elements].reverse();
    const activeElement = frontToBack.find(element => `canvas-layer:${element.id}` === activeId);
    if (!activeElement) return;
    const movingIds = new Set(activeElement.groupId
      ? scene.elements.filter(element => element.groupId === activeElement.groupId).map(element => element.id)
      : [activeElement.id]);
    if (movingIds.has(overId.slice('canvas-layer:'.length))) return;
    if (movingIds.size > 1) {
      const moving = frontToBack.filter(element => movingIds.has(element.id));
      const remaining = frontToBack.filter(element => !movingIds.has(element.id));
      const targetIndex = remaining.findIndex(element => `canvas-layer:${element.id}` === overId);
      if (targetIndex < 0) return;
      publish({ ...scene, elements: [...remaining.slice(0, targetIndex), ...moving, ...remaining.slice(targetIndex)].reverse() });
      setSelected(movingIds);
      return;
    }
    const sourceIndex = frontToBack.findIndex(element => element.id === activeElement.id);
    const targetIndex = frontToBack.findIndex(element => `canvas-layer:${element.id}` === overId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    publish({ ...scene, elements: arrayMove(frontToBack, sourceIndex, targetIndex).reverse() });
  };
  const duplicate = () => {
    addClonedElements(scene.elements.filter(item => selected.has(item.id)));
  };
  const group = () => {
    if (selected.size < 2) return;
    const used = new Set(scene.elements.flatMap(element => element.groupId ? [element.groupId] : []));
    let index = 1;
    while (used.has(`group-${index}`)) index++;
    const groupId = `group-${index}`;
    updateElements(element => ({ ...element, groupId }));
  };
  const ungroup = () => {
    if (![...selected].some(id => elements.get(id)?.groupId)) return;
    updateElements(element => {
      const next = { ...element };
      delete next.groupId;
      return next;
    });
  };
  const changeLayer = (action: 'front' | 'forward' | 'backward' | 'back') => {
    const next = reorderCanvasElements(scene.elements, selected, action);
    if (next.some((element, index) => element !== scene.elements[index])) {
      publish({ ...scene, elements: next });
    }
    setContextMenu(undefined);
  };
  const changeLayerFor = (element: CanvasElement, action: 'forward' | 'backward') => {
    const ids = selected.has(element.id) ? selected : selectionFor(element.id);
    const next = reorderCanvasElements(scene.elements, ids, action);
    if (next.some((item, index) => item !== scene.elements[index])) publish({ ...scene, elements: next });
    setSelected(ids);
  };
  const openContextMenu = (event: React.MouseEvent, element: CanvasElement) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selected.has(element.id)) {
      const next = selectionFor(element.id);
      setSelected(next);
    }
    setContextMenu({
      x: Math.max(6, Math.min(event.clientX, window.innerWidth - 184)),
      y: Math.max(6, Math.min(event.clientY, window.innerHeight - 142))
    });
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

  const elementName = (element: CanvasElement) =>
    element.type === 'block' && element.block.type === 'song'
      ? songHeader(element.block)
      : element.name ?? element.id;
  const elementIcon = (element: CanvasElement) =>
    element.type === 'block'
      ? element.block.type === 'image' ? '▧' : '◇'
      : element.type === 'shape'
        ? element.shape === 'line' ? '╱' : '□'
        : element.type === 'text' ? 'T' : element.type === 'image' ? '▧' : element.type === 'line' ? '╱' : '□';
  const elementKind = (element: CanvasElement) => {
    const kind = element.type === 'block'
      ? element.block.type
      : element.type === 'shape' ? element.shape : element.type;
    return kind.replace(/([a-z])([A-Z])/g, '$1 $2');
  };
  const paletteItems = canvasElementPaletteItems(definitions);
  const frontToBack = [...scene.elements].reverse();
  return <DndContext sensors={paletteSensors} collisionDetection={closestCenter} autoScroll onDragStart={event => setPaletteOverlay((event.active.data.current?.paletteItem as ElementPaletteItem | undefined)?.label ?? '')} onDragCancel={() => setPaletteOverlay('')} onDragEnd={endDesignerDrag}>
  <div className="canvas-designer" role="dialog" aria-modal="true" aria-labelledby="canvas-designer-title">
    <header className="canvas-designer-toolbar">
      <div><div className="eyebrow">Positioned page content</div><h2 id="canvas-designer-title">Canvas designer</h2></div>
      <div className="canvas-tools">
        <button disabled={!selected.size} onClick={duplicate}>Duplicate</button><button disabled={!selected.size} onClick={copySelection}>Copy</button><button disabled={!clipboardAvailable} onClick={() => pasteSelection()}>Paste</button><button disabled={selected.size < 2} onClick={group}>Group</button><button disabled={!selected.size || ![...selected].some(id => elements.get(id)?.groupId)} onClick={ungroup}>Ungroup</button><button disabled={!selected.size} onClick={() => updateElements(item => ({ ...item, locked: ![...selected].every(id => elements.get(id)?.locked) }))}>Lock / unlock</button>
        <button disabled={!past.length} onClick={undo}>Undo</button><button disabled={!future.length} onClick={redo}>Redo</button>
      </div>
      <div className="canvas-view-tools">
        <button type="button" className={`guide-toggle ${showGuides ? 'active' : ''}`} aria-label={`${showGuides ? 'Hide' : 'Show'} guides`} aria-pressed={showGuides} onClick={toggleGuides}>Guides</button>
        <button type="button" className={`guide-toggle ${snapEnabled ? 'active' : ''}`} aria-label={`${snapEnabled ? 'Disable' : 'Enable'} snapping`} aria-pressed={snapEnabled} onClick={toggleSnap}>Snap</button>
        <button type="button" className={`ruler-toggle ${showRulers ? 'active' : ''}`} aria-label={`${showRulers ? 'Hide' : 'Show'} rulers`} aria-pressed={showRulers} onClick={toggleRulers}>Rulers</button>
        <PreviewZoomControls zoom={zoom} onChange={changeZoom} onFit={fitCanvas} />
      </div>
      <button className="primary" onClick={onClose}>Done</button>
    </header>
    <aside className="canvas-elements-sidebar">
      <ElementPalette items={paletteItems} storageKey="bulletin-elements-canvas" docked onUse={item => void placePaletteItem(item)} />
    </aside>
    <aside className="canvas-layers">
      <div className="canvas-layer-heading"><div className="eyebrow">Layers</div><small>{scene.elements.length}</small></div>
      <SortableContext items={frontToBack.map(element => `canvas-layer:${element.id}`)} strategy={verticalListSortingStrategy}><ol>{frontToBack.map(element => <SortableItem id={`canvas-layer:${element.id}`} key={element.id}><li className={selected.has(element.id) ? 'selected' : ''} onContextMenu={event => openContextMenu(event, element)}>
        <button className="canvas-layer-select" type="button" onClick={event => select(element.id, event.shiftKey)}>
          <span className="canvas-layer-icon">{elementIcon(element)}</span>
          <span className="canvas-layer-copy"><b>{elementName(element)}</b><small>{elementKind(element)}{element.groupId ? ' · Grouped' : ''}{element.locked ? ' · Locked' : ''}</small></span>
        </button>
        <div className="canvas-layer-actions"><button type="button" aria-label={`Move ${elementName(element)} forward`} title="Move forward" onClick={() => changeLayerFor(element, 'forward')}>↑</button><button type="button" aria-label={`Move ${elementName(element)} backward`} title="Move backward" onClick={() => changeLayerFor(element, 'backward')}>↓</button><SortableHandle label={`Drag ${elementName(element)} to reorder layers`} /></div>
      </li></SortableItem>)}</ol></SortableContext>
    </aside>
    <main className="canvas-workarea" ref={workarea} onWheel={handleWheel}>
      <div className={`canvas-stage-frame ${showRulers ? 'with-rulers' : ''}`} style={{ width: `${canvasWidth * 96 * zoom}px`, height: `${block.heightIn * 96 * zoom}px` }}>
      {showRulers && <><PageRulers widthIn={canvasWidth} heightIn={block.heightIn} /><div className="page-crosshairs" aria-hidden="true"><i className="crosshair-vertical" /><i className="crosshair-horizontal" /></div></>}
      <CanvasDropTarget stage={stage}><div className="canvas-stage" style={{ width: `${canvasWidth}in`, height: `${block.heightIn}in`, transform: `scale(${zoom})` }} onPointerMove={event => { moveDrag(event); if (showRulers) trackPointer(event); }} onPointerLeave={showRulers ? stopTrackingPointer : undefined} onPointerUp={endDrag} onPointerCancel={endDrag} onPointerDown={event => { setContextMenu(undefined); if (event.target === event.currentTarget) setSelected(new Set()); }}>
        <CanvasSceneView scene={scene} document={document} assets={resolvedAssets} marginIn={0} widthIn={canvasWidth} heightIn={block.heightIn} renderNativeBlock={native => <NativeBlockPreview block={native} library={library} assets={resolvedAssets} document={document} marginIn={marginIn} />} />
        {showGuides && <div className="canvas-safe-guide" style={{ left: `${marginIn}in`, top: `${marginIn}in`, width: `${Math.max(0, canvasWidth - marginIn * 2)}in`, height: `${Math.max(0, block.heightIn - marginIn * 2)}in` }} />}
        {snapGuidesRef.current.x !== undefined && <div className="canvas-smart-guide vertical" style={{ left: `${space.x + snapGuidesRef.current.x}in` }} />}
        {snapGuidesRef.current.y !== undefined && <div className="canvas-smart-guide horizontal" style={{ top: `${space.y + snapGuidesRef.current.y}in` }} />}
        <div className="canvas-selection-layer" style={{ left: `${space.x}in`, top: `${space.y}in`, width: `${space.width}in`, height: `${space.height}in` }}>
          {scene.elements.map(element => {
            const line = element.type === 'line' || (element.type === 'shape' && element.shape === 'line');
            const metrics = line ? canvasLineMetrics(element) : undefined;
            return <div className={`canvas-selection ${selected.has(element.id) ? 'selected' : ''} ${element.locked ? 'locked' : ''}`} key={element.id} style={{ left: `${element.x}in`, top: `${element.y}in`, width: `${metrics?.length ?? element.width}in`, height: `${line ? .04 : Math.max(measuredHeights[element.id] ?? element.height, .04)}in`, transform: metrics ? `rotate(${metrics.rotationDeg}deg)` : undefined, transformOrigin: metrics ? '0 50%' : undefined }} onContextMenu={event => openContextMenu(event, element)} onPointerDown={event => beginDrag(event, element)}>
              {selected.size === 1 && selected.has(element.id) && editable(element) && <i className="canvas-resize-handle" onPointerDown={event => beginDrag(event, element, true)} />}
            </div>;
          })}
        </div>
      </div></CanvasDropTarget>
      </div>
      <div className="canvas-align-tools"><span>Align selection</span>{(['left', 'center', 'right', 'top', 'middle', 'bottom'] as const).map(edge => <button disabled={selected.size < 2} onClick={() => align(edge)} key={edge}>{edge}</button>)}<button disabled={selected.size < 3} onClick={() => distribute('horizontal')}>distribute H</button><button disabled={selected.size < 3} onClick={() => distribute('vertical')}>distribute V</button></div>
    </main>
    <aside className="canvas-properties">
      <div className="eyebrow">Properties</div>
      <label>Background color<input type="color" value={scene.background?.color ?? '#ffffff'} onChange={event => publish({ ...scene, background: { ...scene.background, color: event.target.value } })} /></label>
      <div className="builder-actions"><button className="secondary" onClick={async () => { const asset = await onChooseAsset?.(); if (asset) publish({ ...scene, background: { ...scene.background, asset, fit: 'cover' } }); }}>{scene.background?.asset ? 'Replace background' : 'Add image / PDF background'}</button>{scene.background?.asset && <button className="danger-text" onClick={() => { const background = { ...scene.background }; delete background.asset; publish({ ...scene, background }); }}>Remove</button>}</div>
      {scene.background?.asset && <label>Background fit<select value={scene.background.fit ?? 'cover'} onChange={event => publish({ ...scene, background: { ...scene.background, fit: event.target.value as 'contain' | 'cover' | 'fill' } })}><option value="contain">Contain</option><option value="cover">Cover</option><option value="fill">Fill</option></select></label>}
      {primary ? <>
        <h3>{elementName(primary)}</h3>
        {!(primary.type === 'block' && primary.block.type === 'song') &&
          <label>Name<input value={primary.name ?? ''} disabled={!editable(primary)} onChange={event => updatePrimary({ name: event.target.value })} /></label>}
        <div className="canvas-geometry-grid">{(['x', 'y', 'width', 'height'] as const).map(key => <label key={key}>{key}<input type="number" step=".0625" value={primary[key]} disabled={!editable(primary)} onChange={event => setNumber(key, event.currentTarget.valueAsNumber)} /></label>)}</div>
        <label className="check"><input type="checkbox" checked={primary.locked ?? false} onChange={event => updatePrimary({ locked: event.target.checked })} />Locked</label>
        {primary.type === 'block' && <>
          <label>Sizing<select value={primary.sizing ?? 'autoHeight'} onChange={event => updatePrimary({ sizing: event.target.value as 'autoHeight' | 'fixed' } as Partial<CanvasElement>)}><option value="autoHeight">Auto height</option><option value="fixed">Fixed / clip</option></select></label>
          {nativePrimary && selected.size === 1 && supportsInlineTypography(nativePrimary) && <InlineTypographyControls
            block={nativePrimary}
            template={template}
            verticalAlign={primary.verticalAlign ?? 'top'}
            onVerticalAlignChange={verticalAlign => updatePrimary({
              verticalAlign,
              block: { ...nativePrimary, presentation: { ...nativePrimary.presentation, verticalAlign } },
            } as Partial<CanvasElement>)}
            onChange={presentation => updatePrimary({ block: { ...nativePrimary, presentation } } as Partial<CanvasElement>)}
          />}
          {nativePrimary && <NativeBlockFields block={nativePrimary} library={library} template={template} scope={scope} root={root} imageTargetFolder={imageTargetFolder} onLibraryChange={onLibraryChange} onError={onError} onChange={next => updatePrimary({ block: next } as Partial<CanvasElement>)} />}
          {nativePrimary && nativePrimary.type !== 'image' && <>
            {!supportsInlineTypography(nativePrimary) && <label>Vertical alignment<select value={primary.verticalAlign ?? 'top'} onChange={event => updatePrimary({ verticalAlign: event.target.value as 'top' | 'middle' | 'bottom' } as Partial<CanvasElement>)}><option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option></select></label>}
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
          <label>Text binding<select disabled={!editable(primary)} value={primary.source.binding ?? ''} onChange={event => updatePrimary({ source: { ...primary.source, binding: event.target.value as CanvasTextBinding || undefined } } as Partial<CanvasElement>)}><option value="">Literal text</option><option value="info.title">Sermon title</option><option value="info.date">Service date</option><option value="info.churchEvent">Church event</option>{primary.source.binding === 'info.churchWeek' && <option value="info.churchWeek">Church event (legacy)</option>}<option value="info.series">Series</option><option value="church.name">Church name</option></select></label>
          <label>{primary.source.binding ? 'Weekly override' : 'Text'}<textarea rows={5} disabled={!editable(primary)} value={plainText(primary.source.binding ? primary.source.override : primary.source.literal)} placeholder={primary.source.binding ? plainText(canvasTextParagraphs(primary, document)) : ''} onChange={event => updatePrimary({ source: { ...primary.source, [primary.source.binding ? 'override' : 'literal']: text(event.target.value) } } as Partial<CanvasElement>)} /></label>
          {primary.source.binding && primary.source.override && <button className="text-button" onClick={() => { const { override: _override, ...source } = primary.source; updatePrimary({ source } as Partial<CanvasElement>); }}>Reset to bound value</button>}
          {primary.source.binding === 'info.date' && <label>Date format<select value={primary.source.dateFormat ?? 'long'} onChange={event => updatePrimary({ source: { ...primary.source, dateFormat: event.target.value as 'long' | 'medium' | 'short' | 'iso' } } as Partial<CanvasElement>)}><option value="long">July 27, 2026</option><option value="medium">Jul 27, 2026</option><option value="short">7/27/26</option><option value="iso">2026-07-27</option></select></label>}
          <div className="canvas-geometry-grid"><label>Size (pt)<input type="number" min="5" value={primary.fontSizePt ?? 12} onChange={event => updatePrimary({ fontSizePt: event.currentTarget.valueAsNumber } as Partial<CanvasElement>)} /></label><label>Overflow<select value={primary.overflow ?? 'fixed'} onChange={event => updatePrimary({ overflow: event.target.value as 'autoHeight' | 'shrinkToFit' | 'fixed' } as Partial<CanvasElement>)}><option value="autoHeight">Auto height</option><option value="shrinkToFit">Shrink to fit</option><option value="fixed">Fixed / clip</option></select></label></div>
        </>}
        {primary.type === 'image' && <label>Image fit<select value={primary.fit ?? 'contain'} onChange={event => updatePrimary({ fit: event.target.value as 'contain' | 'cover' | 'fill' } as Partial<CanvasElement>)}><option value="contain">Contain</option><option value="cover">Cover</option><option value="fill">Fill</option></select></label>}
      </> : <p className="helper">Select an object to edit its geometry and content. Shift-click selects more than one.</p>}
      {issues.length > 0 && <div className="canvas-issues"><b>{issues.length} scene notice{issues.length === 1 ? '' : 's'}</b>{issues.map(issue => <p className={issue.severity} key={`${issue.path}-${issue.message}`}>{issue.message}</p>)}</div>}
    </aside>
    {pendingImage && root && <ImageAssetDialog
      library={library}
      root={root}
      targetFolder={imageTargetFolder}
      onLibraryChange={onLibraryChange}
      onError={onError}
      onClose={() => setPendingImage(undefined)}
      onSelect={asset => {
        const element: CanvasElement = {
          ...pendingImage,
          type: 'block',
          sizing: 'fixed',
          block: { id: `${pendingImage.id}-image`, type: 'image', asset, alt: asset.alt, fit: 'contain', heightIn: pendingImage.height }
        };
        element.x = Math.max(0, Math.min(space.width - element.width, snapCanvasValue(element.x)));
        element.y = Math.max(0, Math.min(space.height - element.height, snapCanvasValue(element.y)));
        publish({ ...scene, elements: [...scene.elements, element] });
        setSelected(new Set([element.id]));
      }}
    />}
    {contextMenu && <div
      className="canvas-context-menu"
      role="menu"
      style={{ left: contextMenu.x, top: contextMenu.y }}
      onPointerDown={event => event.stopPropagation()}
    >
      <button role="menuitem" onClick={() => changeLayer('front')}>Bring to front</button>
      <button role="menuitem" onClick={() => changeLayer('forward')}>Bring forward</button>
      <button role="menuitem" onClick={() => changeLayer('backward')}>Send backward</button>
      <button role="menuitem" onClick={() => changeLayer('back')}>Send to back</button>
    </div>}
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
