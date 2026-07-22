import { useState } from 'react';
import { sortedTemplateRecords, type TemplateRecord } from '../shared/templates';

export function TemplateSwitcher({ records, currentPath, onSelect, onCreate }: { records: TemplateRecord[]; currentPath: string; onSelect(path: string): void; onCreate(name: string): Promise<void> }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const create = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try { await onCreate(name.trim()); setName(''); setCreating(false); }
    catch { /* The parent reports the actionable error in the global status UI. */ }
    finally { setSaving(false); }
  };
  return <section className="template-switcher">
    <label>Template and version<select aria-label="Template and version" value={currentPath} onChange={event => onSelect(event.target.value)}>{sortedTemplateRecords(records).map(record => <option value={record.path} key={record.path}>{record.template.name} · v{record.template.version}{record.template.status === 'draft' ? ' draft' : ''}</option>)}</select></label>
    {!creating && <button className="secondary" onClick={() => setCreating(true)}>New template</button>}
    {creating && <div className="new-template-form"><label>New template name<input autoFocus value={name} placeholder="e.g. Festival Service" onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void create(); if (event.key === 'Escape') setCreating(false); }} /></label><button className="secondary" disabled={saving} onClick={() => { setCreating(false); setName(''); }}>Cancel</button><button className="primary" disabled={saving || !name.trim()} onClick={() => void create()}>{saving ? 'Creating…' : 'Create from current'}</button></div>}
  </section>;
}
