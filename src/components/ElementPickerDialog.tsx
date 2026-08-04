import type { ElementPaletteItem } from './ElementPalette';

export function ElementPickerDialog({ items, title = 'Add element', onSelect, onClose }: {
  items: ElementPaletteItem[];
  title?: string;
  onSelect(item: ElementPaletteItem): void;
  onClose(): void;
}) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="library-create-type-dialog" role="dialog" aria-modal="true" aria-labelledby="nested-element-picker-title">
      <header><div><div className="eyebrow">Layout contents</div><h3 id="nested-element-picker-title">{title}</h3></div><button aria-label="Close" onClick={onClose}>×</button></header>
      <div className="library-create-type-options">
        {items.map(item => <button key={item.id} onClick={() => onSelect(item)}><span>{item.icon ?? '◇'}</span><b>{item.label}</b><small>{item.description}</small></button>)}
      </div>
      <footer><button className="secondary" onClick={onClose}>Cancel</button></footer>
    </section>
  </div>;
}
