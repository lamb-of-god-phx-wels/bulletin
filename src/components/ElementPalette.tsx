import { useDraggable } from '@dnd-kit/core';
import { useLayoutEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ElementPaletteItem {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  category: 'content' | 'layout' | 'media' | 'pages' | 'shapes';
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

export function ElementPalette({ items, actions, portalTargetId, docked = false, onUse }: {
  items: ElementPaletteItem[];
  actions?: ReactNode;
  portalTargetId?: string;
  docked?: boolean;
  onUse(item: ElementPaletteItem): void;
}) {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(() =>
    portalTargetId ? document.getElementById(portalTargetId) : null
  );
  useLayoutEffect(() => {
    setPortalTarget(portalTargetId ? document.getElementById(portalTargetId) : null);
  }, [portalTargetId]);
  const isDocked = docked || Boolean(portalTargetId);
  const palette = <aside className={`element-palette ${isDocked ? 'docked' : ''}`}>
    <header><div><div className="eyebrow">Drag into place</div><b>Elements</b></div></header>
    <div className="element-palette-scroll">
      {(['content', 'layout', 'media', 'pages', 'shapes'] as const).map(category => {
        const categoryItems = items.filter(item => item.category === category);
        return categoryItems.length ? <section key={category}><small>{category}</small>{categoryItems.map(item => <PaletteItem item={item} onUse={onUse} key={item.id} />)}</section> : null;
      })}
      {actions && <div className="element-palette-actions">{actions}</div>}
    </div>
  </aside>;
  return portalTarget ? createPortal(palette, portalTarget) : palette;
}
