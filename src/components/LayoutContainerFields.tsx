import type { GroupBlock } from '../shared/types';
import { ToggleSwitch } from './ToggleSwitch';

export function LayoutContainerFields({ block, onChange }: {
  block: GroupBlock;
  onChange(block: GroupBlock): void;
}) {
  const mode = block.layoutMode ?? 'grid';
  const columns = Math.max(1, Math.min(12, block.columns ?? 2));
  const minimumRows = mode === 'table' ? 1 : Math.max(1, Math.ceil(block.children.length / columns));
  const rows = Math.max(minimumRows, Math.min(12, block.rows ?? 2));
  const reflow = (nextColumns: number, nextRows: number) => {
    const next = {
    ...block,
    columns: nextColumns,
    rows: nextRows,
    gridSizing: 'equal' as const,
    columnWidths: undefined,
    rowHeightsIn: undefined,
    children: mode === 'table' ? block.children : block.children.map((child, index) => ({ ...child, gridPosition: { row: Math.floor(index / nextColumns) + 1, column: index % nextColumns + 1 } }))
    } as GroupBlock;
    return next;
  };
  return <>
    <div className="field-row container-options">
      <label>Layout<input value={mode === 'table' ? 'Table' : 'Grid'} disabled /></label>
      <label>Columns<input type="number" min="1" max="12" value={columns} onChange={event => { const next = Math.max(1, Math.min(12, event.currentTarget.valueAsNumber || 1)); onChange(reflow(next, mode === 'table' ? rows : Math.max(block.rows ?? 2, Math.ceil(block.children.length / next)))); }} /></label><label>Rows<input type="number" min={minimumRows} max="12" value={rows} onChange={event => { const next = Math.max(minimumRows, Math.min(12, event.currentTarget.valueAsNumber || 1)); onChange(mode === 'table' || next < rows ? reflow(columns, next) : { ...block, rows: next, gridSizing: 'equal', columnWidths: undefined, rowHeightsIn: undefined }); }} /></label>
      {mode !== 'table' && <label>Gap (in)<input type="number" min="0" max="2" step=".025" value={block.gapIn ?? .12} onChange={event => onChange({ ...block, gapIn: Math.max(0, event.currentTarget.valueAsNumber || 0) })} /></label>}
    </div>
    {mode === 'table' && <div className="table-options"><div className="table-toggle-row"><span>Header row</span><ToggleSwitch label="Header row" checked={Boolean(block.tableHeaderRow)} onChange={tableHeaderRow => onChange({ ...block, tableHeaderRow })} /></div><div className="table-toggle-row"><span>Show lines</span><ToggleSwitch label="Show table lines" checked={block.tableShowLines !== false} onChange={tableShowLines => onChange({ ...block, tableShowLines })} /></div></div>}
    <p className="helper">Drag row and column separators in the preview to resize cells.</p>
  </>;
}
