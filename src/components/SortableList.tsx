import { cloneElement, createContext, useContext, useRef, type CSSProperties, type MouseEvent, type MutableRefObject, type ReactElement, type ReactNode } from 'react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
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

export function SortableList<T extends SortableRecord>({ items, onChange, children }: {
  items: T[];
  onChange(items: T[]): void;
  children: ReactNode;
}) {
  const suppressClick = useRef(false);
  const detailsState = useRef<{ id: string; open: boolean } | undefined>(undefined);
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
  const begin = ({ active }: DragStartEvent) => {
    suppressClick.current = true;
    const id = String(active.id);
    const element = document.querySelector<HTMLElement>(`[data-editor-block-id="${globalThis.CSS.escape(id)}"]`);
    detailsState.current = element instanceof HTMLDetailsElement ? { id, open: element.open } : undefined;
  };
  const releaseClick = () => {
    restoreDetailsState();
    window.requestAnimationFrame(restoreDetailsState);
    window.setTimeout(() => {
      restoreDetailsState();
      suppressClick.current = false;
      detailsState.current = undefined;
    }, 0);
  };
  const finish = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) { releaseClick(); return; }
    const sourceIndex = items.findIndex(item => item.id === active.id);
    const targetIndex = items.findIndex(item => item.id === over.id);
    if (sourceIndex < 0 || targetIndex < 0) { releaseClick(); return; }
    const next = reorderBlocks(items, String(active.id), String(over.id), sourceIndex < targetIndex ? 'after' : 'before');
    if (next !== items) onChange(next);
    releaseClick();
  };
  return <SortableListContext.Provider value={{ suppressClick }}>
    <DndContext sensors={sensors} collisionDetection={closestCenter} autoScroll onDragStart={begin} onDragMove={restoreDetailsState} onDragCancel={releaseClick} onDragEnd={finish}>
      <SortableContext items={items.map(item => item.id)} strategy={verticalListSortingStrategy}>{children}</SortableContext>
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
