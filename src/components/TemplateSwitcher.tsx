import { useState } from 'react';
import { templateChoices, templateVersions, type TemplateRecord } from '../shared/templates';

export function TemplateSwitcher({ records, currentPath, onSelect, onCreate }: { records: TemplateRecord[]; currentPath: string; onSelect(path: string): void; onCreate(name: string): Promise<void> }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const current = records.find(record => record.path === currentPath) ?? templateChoices(records)[0];
  const families = templateChoices(records);
  const versions = current ? templateVersions(records, current.template.id) : [];
  const create = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try { await onCreate(name.trim()); setName(''); setCreating(false); }
    catch { /* The parent reports the actionable error in the global status UI. */ }
    finally { setSaving(false); }
  };
  return <section className="template-switcher">
    <div className="template-selectors">
      <label>Template<select aria-label="Template" value={current?.template.id ?? ''} onChange={event => {
        const selected = families.find(record => record.template.id === event.target.value);
        if (selected) onSelect(selected.path);
      }}>{families.map(record => <option value={record.template.id} key={record.template.id}>{record.template.name}</option>)}</select></label>
      <label>Version<select aria-label="Template version" value={currentPath} onChange={event => onSelect(event.target.value)}>{versions.map(record => <option value={record.path} key={record.path}>v{record.template.version}{record.template.status === 'draft' ? ' · Draft' : ' · Published'}</option>)}</select></label>
    </div>
    {!creating && <button className="secondary" onClick={() => setCreating(true)}>New template</button>}
    {creating && <div className="new-template-form"><label>New template name<input autoFocus value={name} placeholder="e.g. Festival Service" onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void create(); if (event.key === 'Escape') setCreating(false); }} /></label><button className="secondary" disabled={saving} onClick={() => { setCreating(false); setName(''); }}>Cancel</button><button className="primary" disabled={saving || !name.trim()} onClick={() => void create()}>{saving ? 'Creating…' : 'Create from current'}</button></div>}
  </section>;
}
