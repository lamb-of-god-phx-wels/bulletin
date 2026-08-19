import { Children, cloneElement, createContext, isValidElement, useContext, useRef, useState, type CSSProperties, type MouseEvent, type MutableRefObject, type ReactElement, type ReactNode } from 'react';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  type CollisionDetection,
  useDroppable
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { reorderBlocks } from '../shared/weeklyBlocks';

interface SortableRecord { id: string }
interface SortableGridConfig {
  rows: number;
  columns: number;
  cells: Record<string, { row: number; column: number }>;
  containerId: string;
  onMove(itemId: string, cell: { row: number; column: number }): void;
  onAdd?(cell: { row: number; column: number }): void;
}

const SortableItemContext = createContext<ReturnType<typeof useSortable> | undefined>(undefined);
const SortableListContext = createContext<{ suppressClick: MutableRefObject<boolean> } | undefined>(undefined);
const chooserAwareCollisionDetection: CollisionDetection = args => {
  const pointerCollisions = pointerWithin(args);
  const chooserSlot = pointerCollisions.find(collision => String(collision.id).startsWith('__chooser-option__:'));
  return chooserSlot ? [chooserSlot] : closestCenter(args);
};

function EmptyDropTarget() {
  const droppable = useDroppable({ id: '__empty-list__' });
  return <div className={`palette-empty-drop ${droppable.isOver ? 'active' : ''}`} ref={droppable.setNodeRef}>Drop an element here</div>;
}

function EmptyGridCell({ row, column, containerId, onAdd }: { row: number; column: number; containerId: string; onAdd?(): void }) {
  const droppable = useDroppable({ id: `__grid-cell__:${row}:${column}` });
  return <button type="button" ref={droppable.setNodeRef} className={`sortable-grid-cell empty ${droppable.isOver ? 'active' : ''}`} data-layout-cell="true" data-layout-container-id={containerId} data-layout-row={row} data-layout-column={column} onClick={onAdd}><b>＋ Add element</b></button>;
}

export function SortableList<T extends SortableRecord>({ items, onChange, onInsert, onInsertInto, onMoveInto, onMoveOut, grid, palette, dockedPalette = false, children }: {
  items: T[];
  onChange(items: T[]): void;
  onInsert?(descriptor: unknown, index: number): void;
  onInsertInto?(descriptor: unknown, containerId: string, cell?: { row: number; column: number }): boolean;
  onMoveInto?(itemId: string, containerId: string, cell?: { row: number; column: number }): boolean;
  onMoveOut?(itemId: string, targetId?: string, position?: 'before' | 'after'): boolean;
  grid?: SortableGridConfig;
  palette?: ReactNode;
  dockedPalette?: boolean;
  children: ReactNode;
}) {
  const suppressClick = useRef(false);
  const exitRegionRef = useRef<HTMLDivElement>(null);
  const chooserDropTarget = useRef<string | undefined>(undefined);
  const detailsState = useRef<{ id: string; open: boolean } | undefined>(undefined);
  const [overlayLabel, setOverlayLabel] = useState('');
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const childElements = Children.toArray(children).filter(isValidElement) as Array<ReactElement<{ id?: string }>>;
  const childrenById = new Map(childElements.map(child => [String(child.props.id), child]));
  const gridCell = (id: string) => {
    const match = /^__grid-cell__:(\d+):(\d+)$/.exec(id);
    return match ? { row: Number(match[1]), column: Number(match[2]) } : grid?.cells[id];
  };
  const restoreDetailsState = () => {
    const state = detailsState.current;
    if (!state) return;
    const element = document.querySelector<HTMLElement>(`[data-editor-block-id="${globalThis.CSS.escape(state.id)}"]`);
    if (element instanceof HTMLDetailsElement) element.open = state.open;
  };
  const clearInsertionMarker = () => document.querySelectorAll('.palette-insert-before, .palette-insert-after, .palette-insert-inside').forEach(element => element.classList.remove('palette-insert-before', 'palette-insert-after', 'palette-insert-inside'));
  const dropIntent = (event: Pick<DragMoveEvent, 'active' | 'over'>) => {
    if (!event.over || event.over.id === '__empty-list__') return undefined;
    const element = document.querySelector<HTMLElement>(`[data-editor-block-id="${globalThis.CSS.escape(String(event.over.id))}"]`);
    if (!element) return undefined;
    const center = event.active.rect.current.translated
      ? event.active.rect.current.translated.top + event.active.rect.current.translated.height / 2
      : event.over.rect.top;
    const centerX = event.active.rect.current.translated
      ? event.active.rect.current.translated.left + event.active.rect.current.translated.width / 2
      : event.over.rect.left + event.over.rect.width / 2;
    const cellElement = document.elementFromPoint(centerX, center)?.closest<HTMLElement>('[data-layout-cell="true"]');
    const cell = cellElement && element.contains(cellElement) ? {
      row: Number(cellElement.dataset.layoutRow),
      column: Number(cellElement.dataset.layoutColumn)
    } : undefined;
    const edge = Math.min(32, event.over.rect.height * .25);
    const inside = element.dataset.layoutContainer === 'true' && (cell || (center >= event.over.rect.top + edge && center <= event.over.rect.bottom - edge));
    return { element, cell, containerId: cellElement?.dataset.layoutContainerId ?? String(event.over.id), position: inside ? 'inside' as const : center < event.over.rect.top + event.over.rect.height / 2 ? 'before' as const : 'after' as const };
  };
  const move = (event: DragMoveEvent) => {
    restoreDetailsState();
    clearInsertionMarker();
    chooserDropTarget.current = undefined;
    const translated = event.active.rect.current.translated;
    const overElement = event.over
      ? document.querySelector<HTMLElement>(`[data-editor-block-id="${globalThis.CSS.escape(String(event.over.id))}"]`)
      : undefined;
    const slot = overElement?.closest<HTMLElement>('.chooser-empty-slot') ?? (translated
      ? document.elementFromPoint(translated.left + translated.width / 2, translated.top + translated.height / 2)?.closest<HTMLElement>('.chooser-empty-slot')
      : undefined);
    if (slot?.dataset.layoutContainerId) {
      chooserDropTarget.current = slot.dataset.layoutContainerId;
      slot.classList.add('palette-insert-inside');
    }
    if (!event.over || event.over.id === '__empty-list__') return;
    const intent = dropIntent(event);
    if (event.active.data.current?.paletteItem && intent) intent.element.classList.add(`palette-insert-${intent.position}`);
    else if (onMoveInto && intent?.position === 'inside' && event.active.id !== event.over.id) intent.element.classList.add('palette-insert-inside');
  };
  const begin = ({ active }: DragStartEvent) => {
    suppressClick.current = true;
    const paletteItem = active.data.current?.paletteItem as { label?: string } | undefined;
    setOverlayLabel(paletteItem?.label ?? '');
    if (paletteItem) return;
    const id = String(active.id);
    const element = document.querySelector<HTMLElement>(`[data-editor-block-id="${globalThis.CSS.escape(id)}"]`);
    detailsState.current = element instanceof HTMLDetailsElement ? { id, open: element.open } : undefined;
  };
  const releaseClick = () => {
    clearInsertionMarker();
    restoreDetailsState();
    window.requestAnimationFrame(restoreDetailsState);
    window.setTimeout(() => {
      restoreDetailsState();
      suppressClick.current = false;
      detailsState.current = undefined;
      setOverlayLabel('');
      chooserDropTarget.current = undefined;
    }, 0);
  };
  const finish = ({ active, over }: DragEndEvent) => {
    const paletteItem = active.data.current?.paletteItem;
    if (paletteItem) {
      if (chooserDropTarget.current && onInsertInto?.(paletteItem, chooserDropTarget.current)) { releaseClick(); return; }
      if (over && onInsert) {
        const intent = dropIntent({ active, over });
        if (intent?.position === 'inside' && onInsertInto?.(paletteItem, intent.containerId, intent.cell)) {
          releaseClick();
          return;
        }
        const targetIndex = over.id === '__empty-list__' ? 0 : items.findIndex(item => item.id === over.id);
        if (targetIndex >= 0) {
          const center = active.rect.current.translated
            ? active.rect.current.translated.top + active.rect.current.translated.height / 2
            : over.rect.top;
          const index = over.id === '__empty-list__' || center < over.rect.top + over.rect.height / 2 ? targetIndex : targetIndex + 1;
          onInsert(paletteItem, index);
        }
      }
      releaseClick();
      return;
    }
    if (chooserDropTarget.current && onMoveInto?.(String(active.id), chooserDropTarget.current)) { releaseClick(); return; }
    if (onMoveOut && active.rect.current.translated && exitRegionRef.current) {
      const center = {
        x: active.rect.current.translated.left + active.rect.current.translated.width / 2,
        y: active.rect.current.translated.top + active.rect.current.translated.height / 2
      };
      const bounds = exitRegionRef.current.getBoundingClientRect();
      if (center.x < bounds.left || center.x > bounds.right || center.y < bounds.top || center.y > bounds.bottom) {
        const target = document.elementsFromPoint(center.x, center.y).map(element => element.closest<HTMLElement>('[data-sortable-root-item="true"]')).find((element): element is HTMLElement => Boolean(element) && element!.dataset.editorBlockId !== String(active.id));
        const targetBounds = target?.getBoundingClientRect();
        const position = targetBounds && center.y < targetBounds.top + targetBounds.height / 2 ? 'before' : 'after';
        if (onMoveOut(String(active.id), target?.dataset.editorBlockId, position)) { releaseClick(); return; }
      }
    }
    if (!over || active.id === over.id) { releaseClick(); return; }
    const targetCell = grid && gridCell(String(over.id));
    if (targetCell) { grid.onMove(String(active.id), targetCell); releaseClick(); return; }
    const intent = dropIntent({ active, over });
    if (intent?.position === 'inside' && onMoveInto?.(String(active.id), intent.containerId, intent.cell)) { releaseClick(); return; }
    const sourceIndex = items.findIndex(item => item.id === active.id);
    const targetIndex = items.findIndex(item => item.id === over.id);
    if (sourceIndex < 0 || targetIndex < 0) { releaseClick(); return; }
    const next = reorderBlocks(items, String(active.id), String(over.id), sourceIndex < targetIndex ? 'after' : 'before');
    if (next !== items) onChange(next);
    releaseClick();
  };
  const sortableChildren = grid ? <div className="sortable-grid" style={{ '--sortable-grid-columns': grid.columns } as CSSProperties}>{Array.from({ length: grid.rows * grid.columns }, (_, index) => {
    const row = Math.floor(index / grid.columns) + 1;
    const column = index % grid.columns + 1;
    const entry = Object.entries(grid.cells).find(([, cell]) => cell.row === row && cell.column === column);
    const child = entry ? childrenById.get(entry[0]) : undefined;
    return child ? <div className="sortable-grid-cell occupied" data-layout-cell="true" data-layout-container-id={grid.containerId} data-layout-row={row} data-layout-column={column} key={`${row}:${column}`}>{child}</div> : <EmptyGridCell row={row} column={column} containerId={grid.containerId} onAdd={() => grid.onAdd?.({ row, column })} key={`${row}:${column}`} />;
  })}</div> : children;
  const presentedChildren = onMoveOut ? <div className={`sortable-exit-region ${grid ? 'grid-region' : 'list-region'}`} ref={exitRegionRef}>{sortableChildren}</div> : sortableChildren;
  const strategy = grid ? rectSortingStrategy : verticalListSortingStrategy;
  return <SortableListContext.Provider value={{ suppressClick }}>
    <DndContext sensors={sensors} collisionDetection={chooserAwareCollisionDetection} autoScroll onDragStart={begin} onDragMove={move} onDragCancel={releaseClick} onDragEnd={finish}>
      {palette && dockedPalette ? <>{palette}<div className="palette-sortable-content"><SortableContext items={items.map(item => item.id)} strategy={strategy}>{presentedChildren}</SortableContext>{!items.length && !grid && <EmptyDropTarget />}</div></> : palette ? <div className="palette-sortable-layout">
        {palette}
        <div className="palette-sortable-content"><SortableContext items={items.map(item => item.id)} strategy={strategy}>{presentedChildren}</SortableContext>{!items.length && !grid && <EmptyDropTarget />}</div>
      </div> : <><SortableContext items={items.map(item => item.id)} strategy={strategy}>{presentedChildren}</SortableContext>{!items.length && !grid && <EmptyDropTarget />}</>}
      <DragOverlay>{overlayLabel && <div className="palette-drag-overlay">{overlayLabel}</div>}</DragOverlay>
    </DndContext>
  </SortableListContext.Provider>;
}

export function SortableItem({ id, children }: {
  id: string;
  children: ReactElement<{ className?: string; style?: CSSProperties; ref?: (node: HTMLElement | null) => void; onClickCapture?: (event: MouseEvent<HTMLElement>) => void }>;
}) {
  const sortable = useSortable({ id });
  const list = useContext(SortableListContext);
  const style: CSSProperties = {
    ...children.props.style,
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    position: sortable.isDragging ? 'relative' : children.props.style?.position,
    zIndex: sortable.isDragging ? 20 : children.props.style?.zIndex
  };
  return <SortableItemContext.Provider value={sortable}>
    {cloneElement(children, {
      ref: sortable.setNodeRef,
      className: `${children.props.className ?? ''}${sortable.isDragging ? ' is-dragging' : ''}`.trim(),
      style,
      onClickCapture: event => {
        if (list?.suppressClick.current) {
          event.preventDefault();
          event.stopPropagation();
        } else children.props.onClickCapture?.(event);
      }
    })}
  </SortableItemContext.Provider>;
}

export function SortableHandle({ label }: { label: string }) {
  const sortable = useContext(SortableItemContext);
  if (!sortable) return null;
  const pointerDown = sortable.listeners?.onPointerDown;
  const keyDown = sortable.listeners?.onKeyDown;
  return <span
    className="drag-handle"
    ref={sortable.setActivatorNodeRef}
    title={label}
    {...sortable.attributes}
    {...sortable.listeners}
    onPointerDown={event => {
      event.stopPropagation();
      pointerDown?.(event);
    }}
    onClick={event => {
      event.preventDefault();
      event.stopPropagation();
    }}
    onKeyDown={event => {
      event.stopPropagation();
      keyDown?.(event);
      if (event.key === ' ' || event.key === 'Enter') event.preventDefault();
    }}
  >☰</span>;
}
