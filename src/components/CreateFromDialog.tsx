import { useMemo, useState } from 'react';
import { filterBulletins, sortedBulletins, type BulletinRecord } from '../shared/bulletins';
import type { TemplateRecord } from '../shared/templates';
import { localIsoDate, sundayOnOrAfter } from '../shared/dates';
import { ToggleSwitch } from './ToggleSwitch';

const sundayPreferenceKey = 'bulletin-new-week-snap-to-sunday';
const storedSundayPreference = () => typeof window === 'undefined' ? null : window.localStorage.getItem(sundayPreferenceKey);

export type CreationSource =
  | { kind: 'blank' }
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
  const [sourceKind, setSourceKind] = useState<CreationSource['kind']>();
  const [selectedKey, setSelectedKey] = useState(initialTemplatePath ?? templates[0]?.path ?? '');
  const [query, setQuery] = useState('');
  const [snapToSunday, setSnapToSunday] = useState(() => storedSundayPreference() !== 'false');
  const today = localIsoDate();
  const [value, setValue] = useState(destination === 'bulletin' ? (storedSundayPreference() === 'false' ? today : sundayOnOrAfter(today)) : '');
  const [creating, setCreating] = useState(false);
  const shownBulletins = useMemo(() => query ? filterBulletins(bulletins, query) : sortedBulletins(bulletins), [bulletins, query]);
  const selected: CreationSource | undefined = sourceKind === 'blank'
    ? { kind: 'blank' }
    : sourceKind === 'template'
    ? templates.find(record => record.path === selectedKey) && { kind: 'template', record: templates.find(record => record.path === selectedKey)! }
    : bulletins.find(record => record.path === selectedKey) && { kind: 'bulletin', record: bulletins.find(record => record.path === selectedKey)! };
  const switchKind = (kind: CreationSource['kind']) => {
    setSourceKind(kind);
    setSelectedKey(kind === 'template' ? templates[0]?.path ?? '' : kind === 'bulletin' ? sortedBulletins(bulletins)[0]?.path ?? '' : '');
    setQuery('');
  };
  const create = async () => {
    if (!selected || !value.trim()) return;
    setCreating(true);
    try { await onCreate(selected, value.trim()); }
    catch { /* The parent reports workspace save failures in the global status UI. */ }
    finally { setCreating(false); }
  };
  const title = destination === 'bulletin' ? 'Create a bulletin' : 'Create a template';
  if (!sourceKind) return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}>
    <section className="create-from-modal create-kind-modal" role="dialog" aria-modal="true" aria-labelledby="create-from-title">
      <header><div><div className="eyebrow">New {destination}</div><h2 id="create-from-title">How would you like to start?</h2><p>Choose the starting point for your new {destination === 'bulletin' ? 'bulletin' : 'bulletin template'}.</p></div><button aria-label="Close" onClick={onCancel}>×</button></header>
      <div className="create-kind-options">
        <button onClick={() => switchKind('blank')}><span>□</span><b>{destination === 'bulletin' ? 'Blank' : 'Blank template'}</b><small>Start with an empty outline and the standard page and typography settings.</small></button>
        <button onClick={() => switchKind('template')}><span>◇</span><b>{destination === 'bulletin' ? 'Template' : 'Existing template'}</b><small>{destination === 'bulletin' ? 'Start from a reusable bulletin template.' : 'Copy an existing bulletin template, including its elements and properties.'}</small></button>
        <button onClick={() => switchKind('bulletin')}><span>▦</span><b>{destination === 'bulletin' ? 'Past bulletin' : 'Existing bulletin'}</b><small>{destination === 'bulletin' ? 'Copy a previously saved bulletin and assign it a new service date.' : 'Turn a completed or in-progress bulletin into a reusable template.'}</small></button>
      </div>
      <footer><span>Select a starting point to continue.</span><div><button className="secondary" onClick={onCancel}>Cancel</button></div></footer>
    </section>
  </div>;
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}>
    <section className="create-from-modal" role="dialog" aria-modal="true" aria-labelledby="create-from-title">
      <header><div><div className="eyebrow">New {destination}</div><h2 id="create-from-title">{title}</h2><p>{sourceKind === 'blank' ? `Start with a clean, empty ${destination}.` : `Choose the existing ${sourceKind === 'bulletin' && destination === 'bulletin' ? 'past bulletin' : sourceKind} to use as your starting point.`}</p></div><button aria-label="Close" onClick={onCancel}>×</button></header>
      <div className="create-from-settings">
        <label>{destination === 'bulletin' ? 'Service date' : 'New template name'}<input autoFocus type={destination === 'bulletin' ? 'date' : 'text'} value={value} placeholder={destination === 'template' ? 'e.g. Festival Service' : undefined} onChange={event => setValue(destination === 'bulletin' && snapToSunday ? sundayOnOrAfter(event.target.value) : event.target.value)} /></label>
        {destination === 'bulletin' && <div className="create-from-toggle-row"><span>Snap service dates forward to the next Sunday</span><ToggleSwitch label="Snap service dates forward to the next Sunday" checked={snapToSunday} onChange={checked => { setSnapToSunday(checked); localStorage.setItem(sundayPreferenceKey, String(checked)); if (checked) setValue(current => sundayOnOrAfter(current)); }} /></div>}
        {destination === 'bulletin' && <div className="create-from-tabs" role="tablist" aria-label="Source type">
          <button role="tab" aria-selected={sourceKind === 'blank'} className={sourceKind === 'blank' ? 'active' : ''} onClick={() => switchKind('blank')}>Blank</button>
          <button role="tab" aria-selected={sourceKind === 'template'} className={sourceKind === 'template' ? 'active' : ''} onClick={() => switchKind('template')}>Bulletin Templates <span>{templates.length}</span></button>
          <button role="tab" aria-selected={sourceKind === 'bulletin'} className={sourceKind === 'bulletin' ? 'active' : ''} onClick={() => switchKind('bulletin')}>Past Bulletins <span>{bulletins.length}</span></button>
        </div>}
        {sourceKind === 'bulletin' && <label>Search bulletins<input type="search" value={query} placeholder="Date, title, series, or church event" onChange={event => setQuery(event.target.value)} /></label>}
      </div>
      <div className="create-source-list">
        {sourceKind === 'blank' && <div className="create-source-empty"><b>Empty starter outline</b><span>Add pages, text, songs, images, and other elements after creating the {destination}.</span></div>}
        {sourceKind === 'template' && templates.map(record => <button className={selectedKey === record.path ? 'selected' : ''} key={record.path} onClick={() => setSelectedKey(record.path)}><span>◇</span><div><b>{record.template.name}</b><small>Version {record.template.version}{record.template.status === 'draft' ? ' · Draft' : ' · Published'}</small></div><strong>{selectedKey === record.path ? 'Selected' : 'Select'}</strong></button>)}
        {sourceKind === 'bulletin' && shownBulletins.map(record => <button className={selectedKey === record.path ? 'selected' : ''} key={record.path} onClick={() => setSelectedKey(record.path)}><time dateTime={record.document.info.date}>{new Date(`${record.document.info.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</time><div><b>{record.document.info.title || 'Untitled bulletin'}</b><small>{record.document.info.churchWeek}{record.document.info.series ? ` · ${record.document.info.series}` : ''}</small></div><strong>{selectedKey === record.path ? 'Selected' : 'Select'}</strong></button>)}
        {sourceKind === 'bulletin' && !shownBulletins.length && <div className="create-source-empty">No matching bulletins.</div>}
      </div>
      <footer><span>{selected ? `Using ${selected.kind === 'blank' ? `a blank ${destination}` : selected.kind === 'template' ? selected.record.template.name : `${selected.record.document.info.title} · ${selected.record.document.info.date}`}` : 'Choose a source to continue.'}</span><div><button className="secondary" onClick={() => setSourceKind(undefined)}>Back</button><button className="secondary" onClick={onCancel}>Cancel</button><button className="primary" disabled={!selected || !value.trim() || creating} onClick={() => void create()}>{creating ? 'Creating…' : title}</button></div></footer>
    </section>
  </div>;
}
