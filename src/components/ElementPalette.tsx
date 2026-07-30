import { useDraggable } from '@dnd-kit/core';
import { useEffect, useLayoutEffect, useReducer, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ElementPaletteItem {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  category: 'content' | 'media' | 'pages' | 'shapes';
  payload: unknown;
}

export function ElementSidebarPortal({ children, targetId = 'app-element-palette-slot' }: {
  children: ReactNode;
  targetId?: string;
}) {
  const [target, setTarget] = useState<HTMLElement | null>(() => document.getElementById(targetId));
  useLayoutEffect(() => setTarget(document.getElementById(targetId)), [targetId]);
  return target ? createPortal(children, target) : null;
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
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(() =>
    portalTargetId ? document.getElementById(portalTargetId) : null
  );
  useLayoutEffect(() => {
    setPortalTarget(portalTargetId ? document.getElementById(portalTargetId) : null);
  }, [portalTargetId]);
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
  const isCollapsed = collapsed;
  const docked = Boolean(portalTargetId);
  const palette = <aside className={`element-palette ${docked ? 'docked' : ''} ${isCollapsed ? 'collapsed' : ''}`}>
    <header><div><div className="eyebrow">Drag into place</div><b>Elements</b></div><button title={isCollapsed ? 'Expand elements' : 'Collapse elements'} aria-label={isCollapsed ? 'Expand elements' : 'Collapse elements'} onClick={() => setCollapsed(!isCollapsed)}>{docked ? '›' : (isCollapsed ? '›' : '‹')}</button></header>
    {!isCollapsed && <div className="element-palette-scroll">
      {(['content', 'media', 'pages', 'shapes'] as const).map(category => {
        const categoryItems = items.filter(item => item.category === category);
        return categoryItems.length ? <section key={category}><small>{category}</small>{categoryItems.map(item => <PaletteItem item={item} onUse={onUse} key={item.id} />)}</section> : null;
      })}
      {actions && <div className="element-palette-actions">{actions}</div>}
    </div>}
  </aside>;
  return portalTarget ? createPortal(palette, portalTarget) : palette;
}
