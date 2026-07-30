export const PREVIEW_ZOOMS = [0.5, 0.6, 0.72, 0.85, 1, 1.25];

export function stepPreviewZoom(zoom: number, direction: -1 | 1) {
  if (direction < 0) {
    return [...PREVIEW_ZOOMS].reverse().find(value => value < zoom - .001) ?? PREVIEW_ZOOMS[0];
  }
  return PREVIEW_ZOOMS.find(value => value > zoom + .001) ?? PREVIEW_ZOOMS.at(-1)!;
}

export function PreviewZoomControls({ zoom, onChange, onFit }: {
  zoom: number;
  onChange(zoom: number): void;
  onFit(mode: 'width' | 'page'): void;
}) {
  const options = PREVIEW_ZOOMS.includes(zoom)
    ? PREVIEW_ZOOMS
    : [...PREVIEW_ZOOMS, zoom].sort((left, right) => left - right);
  return <div className="preview-zoom">
    <div className="preview-zoom-steps">
      <button type="button" aria-label="Zoom out" title="Zoom out" disabled={zoom <= PREVIEW_ZOOMS[0]} onClick={() => onChange(stepPreviewZoom(zoom, -1))}>−</button>
      <select aria-label="Preview zoom" value={zoom} onChange={event => onChange(Number(event.target.value))}>
        {options.map(value => <option value={value} key={value}>{Math.round(value * 100)}%</option>)}
      </select>
      <button type="button" aria-label="Zoom in" title="Zoom in" disabled={zoom >= PREVIEW_ZOOMS.at(-1)!} onClick={() => onChange(stepPreviewZoom(zoom, 1))}>＋</button>
    </div>
    <div className="preview-zoom-presets">
      <button type="button" onClick={() => onFit('width')}>Fit to width</button>
      <button type="button" onClick={() => onFit('page')}>Fit to page</button>
      <button type="button" onClick={() => onChange(1)}>100%</button>
    </div>
  </div>;
}
