import { useMemo, useState } from 'react';
import { filterBulletins, sortedBulletins, type BulletinRecord } from '../shared/bulletins';
import type { TemplateRecord } from '../shared/templates';

export type CreationSource =
  | { kind: 'template'; record: TemplateRecord }
  | { kind: 'bulletin'; record: BulletinRecord };

export function CreateFromDialog({ destination, templates, bulletins, initialTemplatePath, onCancel, onCreate }: {
  destination: 'bulletin' | 'template';
  templates: TemplateRecord[];
  bulletins: BulletinRecord[];
  initialTemplatePath?: string;
  onCancel(): void;
  onCreate(source: CreationSource, value: string): Promise<void> | void;
}) {
  const [sourceKind, setSourceKind] = useState<CreationSource['kind']>('template');
  const [selectedKey, setSelectedKey] = useState(initialTemplatePath ?? templates[0]?.path ?? '');
  const [query, setQuery] = useState('');
  const [value, setValue] = useState(destination === 'bulletin' ? new Date().toISOString().slice(0, 10) : '');
  const [creating, setCreating] = useState(false);
  const shownBulletins = useMemo(() => query ? filterBulletins(bulletins, query) : sortedBulletins(bulletins), [bulletins, query]);
  const selected: CreationSource | undefined = sourceKind === 'template'
    ? templates.find(record => record.path === selectedKey) && { kind: 'template', record: templates.find(record => record.path === selectedKey)! }
    : bulletins.find(record => record.path === selectedKey) && { kind: 'bulletin', record: bulletins.find(record => record.path === selectedKey)! };
  const switchKind = (kind: CreationSource['kind']) => {
    setSourceKind(kind);
    setSelectedKey(kind === 'template' ? templates[0]?.path ?? '' : sortedBulletins(bulletins)[0]?.path ?? '');
  };
  const create = async () => {
    if (!selected || !value.trim()) return;
    setCreating(true);
    try { await onCreate(selected, value.trim()); }
    catch { /* The parent reports workspace save failures in the global status UI. */ }
    finally { setCreating(false); }
  };
  const title = destination === 'bulletin' ? 'Create a bulletin' : 'Create a template';
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}>
    <section className="create-from-modal" role="dialog" aria-modal="true" aria-labelledby="create-from-title">
      <header><div><div className="eyebrow">New {destination}</div><h2 id="create-from-title">{title}</h2><p>Start from any existing template or bulletin in this workspace.</p></div><button aria-label="Close" onClick={onCancel}>×</button></header>
      <div className="create-from-settings">
        <label>{destination === 'bulletin' ? 'Service date' : 'New template name'}<input autoFocus type={destination === 'bulletin' ? 'date' : 'text'} value={value} placeholder={destination === 'template' ? 'e.g. Festival Service' : undefined} onChange={event => setValue(event.target.value)} /></label>
        <div className="create-from-tabs" role="tablist" aria-label="Source type">
          <button role="tab" aria-selected={sourceKind === 'template'} className={sourceKind === 'template' ? 'active' : ''} onClick={() => switchKind('template')}>Templates <span>{templates.length}</span></button>
          <button role="tab" aria-selected={sourceKind === 'bulletin'} className={sourceKind === 'bulletin' ? 'active' : ''} onClick={() => switchKind('bulletin')}>Bulletins <span>{bulletins.length}</span></button>
        </div>
        {sourceKind === 'bulletin' && <label>Search bulletins<input type="search" value={query} placeholder="Date, title, series, or church event" onChange={event => setQuery(event.target.value)} /></label>}
      </div>
      <div className="create-source-list">
        {sourceKind === 'template' && templates.map(record => <button className={selectedKey === record.path ? 'selected' : ''} key={record.path} onClick={() => setSelectedKey(record.path)}><span>◇</span><div><b>{record.template.name}</b><small>Version {record.template.version}{record.template.status === 'draft' ? ' · Draft' : ' · Published'}</small></div><strong>{selectedKey === record.path ? 'Selected' : 'Select'}</strong></button>)}
        {sourceKind === 'bulletin' && shownBulletins.map(record => <button className={selectedKey === record.path ? 'selected' : ''} key={record.path} onClick={() => setSelectedKey(record.path)}><time dateTime={record.document.info.date}>{new Date(`${record.document.info.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</time><div><b>{record.document.info.title || 'Untitled bulletin'}</b><small>{record.document.info.churchWeek}{record.document.info.series ? ` · ${record.document.info.series}` : ''}</small></div><strong>{selectedKey === record.path ? 'Selected' : 'Select'}</strong></button>)}
        {sourceKind === 'bulletin' && !shownBulletins.length && <div className="create-source-empty">No matching bulletins.</div>}
      </div>
      <footer><span>{selected ? `Using ${selected.kind === 'template' ? selected.record.template.name : `${selected.record.document.info.title} · ${selected.record.document.info.date}`}` : 'Choose a source to continue.'}</span><div><button className="secondary" onClick={onCancel}>Cancel</button><button className="primary" disabled={!selected || !value.trim() || creating} onClick={() => void create()}>{creating ? 'Creating…' : title}</button></div></footer>
    </section>
  </div>;
}
