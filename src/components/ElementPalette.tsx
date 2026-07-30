import { useDraggable } from '@dnd-kit/core';
import { useEffect, useReducer, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ElementPaletteItem {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  category: 'content' | 'media' | 'pages' | 'shapes';
  payload: unknown;
}

function PaletteItem({ item, onUse }: { item: ElementPaletteItem; onUse(item: ElementPaletteItem): void }) {
  const drag = useDraggable({ id: `palette:${item.id}`, data: { paletteItem: item } });
  return <button
    className={`element-palette-item ${drag.isDragging ? 'dragging' : ''}`}
    ref={drag.setNodeRef}
    {...drag.attributes}
    {...drag.listeners}
    title={item.description}
    onClick={() => onUse(item)}
  ><span>{item.icon ?? '◇'}</span><b>{item.label}</b></button>;
}

export function ElementPalette({ items, storageKey, actions, portalTargetId, onUse }: {
  items: ElementPaletteItem[];
  storageKey: string;
  actions?: ReactNode;
  portalTargetId?: string;
  onUse(item: ElementPaletteItem): void;
}) {
  const collapsed = localStorage.getItem(storageKey) === 'collapsed';
  const setCollapsed = (value: boolean) => {
    localStorage.setItem(storageKey, value ? 'collapsed' : 'expanded');
    window.dispatchEvent(new CustomEvent('element-palette:toggle'));
  };
  // The event forces this tiny uncontrolled preference component to refresh.
  const [, force] = useReducer(value => value + 1, 0);
  useEffect(() => {
    const refresh = () => force();
    window.addEventListener('element-palette:toggle', refresh);
    return () => window.removeEventListener('element-palette:toggle', refresh);
  }, []);
  const isCollapsed = !portalTargetId && collapsed;
  const palette = <aside className={`element-palette ${isCollapsed ? 'collapsed' : ''}`}>
    <header><div><div className="eyebrow">Drag into place</div><b>Elements</b></div>{!portalTargetId && <button title={isCollapsed ? 'Expand elements' : 'Collapse elements'} onClick={() => setCollapsed(!isCollapsed)}>{isCollapsed ? '›' : '‹'}</button>}</header>
    {!isCollapsed && <div className="element-palette-scroll">
      {(['content', 'media', 'pages', 'shapes'] as const).map(category => {
        const categoryItems = items.filter(item => item.category === category);
        return categoryItems.length ? <section key={category}><small>{category}</small>{categoryItems.map(item => <PaletteItem item={item} onUse={onUse} key={item.id} />)}</section> : null;
      })}
      {actions && <div className="element-palette-actions">{actions}</div>}
    </div>}
  </aside>;
  const portalTarget = portalTargetId ? document.getElementById(portalTargetId) : null;
  return portalTarget ? createPortal(palette, portalTarget) : palette;
}
