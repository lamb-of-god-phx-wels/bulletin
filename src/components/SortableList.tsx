import { cloneElement, createContext, useContext, useRef, useState, type CSSProperties, type MouseEvent, type MutableRefObject, type ReactElement, type ReactNode } from 'react';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  useDroppable
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { reorderBlocks } from '../shared/weeklyBlocks';

interface SortableRecord { id: string }

const SortableItemContext = createContext<ReturnType<typeof useSortable> | undefined>(undefined);
const SortableListContext = createContext<{ suppressClick: MutableRefObject<boolean> } | undefined>(undefined);

function EmptyDropTarget() {
  const droppable = useDroppable({ id: '__empty-list__' });
  return <div className={`palette-empty-drop ${droppable.isOver ? 'active' : ''}`} ref={droppable.setNodeRef}>Drop an element here</div>;
}

export function SortableList<T extends SortableRecord>({ items, onChange, onInsert, palette, dockedPalette = false, children }: {
  items: T[];
  onChange(items: T[]): void;
  onInsert?(descriptor: unknown, index: number): void;
  palette?: ReactNode;
  dockedPalette?: boolean;
  children: ReactNode;
}) {
  const suppressClick = useRef(false);
  const detailsState = useRef<{ id: string; open: boolean } | undefined>(undefined);
  const [overlayLabel, setOverlayLabel] = useState('');
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const restoreDetailsState = () => {
    const state = detailsState.current;
    if (!state) return;
    const element = document.querySelector<HTMLElement>(`[data-editor-block-id="${globalThis.CSS.escape(state.id)}"]`);
    if (element instanceof HTMLDetailsElement) element.open = state.open;
  };
  const clearInsertionMarker = () => document.querySelectorAll('.palette-insert-before, .palette-insert-after').forEach(element => element.classList.remove('palette-insert-before', 'palette-insert-after'));
  const move = (event: DragMoveEvent) => {
    restoreDetailsState();
    clearInsertionMarker();
    if (!event.active.data.current?.paletteItem || !event.over || event.over.id === '__empty-list__') return;
    const element = document.querySelector<HTMLElement>(`[data-editor-block-id="${globalThis.CSS.escape(String(event.over.id))}"]`);
    if (!element) return;
    const center = event.active.rect.current.translated ? event.active.rect.current.translated.top + event.active.rect.current.translated.height / 2 : event.over.rect.top;
    element.classList.add(center < event.over.rect.top + event.over.rect.height / 2 ? 'palette-insert-before' : 'palette-insert-after');
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
    }, 0);
  };
  const finish = ({ active, over }: DragEndEvent) => {
    const paletteItem = active.data.current?.paletteItem;
    if (paletteItem) {
      if (over && onInsert) {
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
    if (!over || active.id === over.id) { releaseClick(); return; }
    const sourceIndex = items.findIndex(item => item.id === active.id);
    const targetIndex = items.findIndex(item => item.id === over.id);
    if (sourceIndex < 0 || targetIndex < 0) { releaseClick(); return; }
    const next = reorderBlocks(items, String(active.id), String(over.id), sourceIndex < targetIndex ? 'after' : 'before');
    if (next !== items) onChange(next);
    releaseClick();
  };
  return <SortableListContext.Provider value={{ suppressClick }}>
    <DndContext sensors={sensors} collisionDetection={closestCenter} autoScroll onDragStart={begin} onDragMove={move} onDragCancel={releaseClick} onDragEnd={finish}>
      {palette && dockedPalette ? <>{palette}<div className="palette-sortable-content"><SortableContext items={items.map(item => item.id)} strategy={verticalListSortingStrategy}>{children}</SortableContext>{!items.length && <EmptyDropTarget />}</div></> : palette ? <div className="palette-sortable-layout">
        {palette}
        <div className="palette-sortable-content"><SortableContext items={items.map(item => item.id)} strategy={verticalListSortingStrategy}>{children}</SortableContext>{!items.length && <EmptyDropTarget />}</div>
      </div> : <><SortableContext items={items.map(item => item.id)} strategy={verticalListSortingStrategy}>{children}</SortableContext>{!items.length && <EmptyDropTarget />}</>}
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
