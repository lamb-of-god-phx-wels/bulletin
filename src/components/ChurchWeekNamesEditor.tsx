import { useEffect, useState } from 'react';
import { validChurchWeekNames } from '../shared/churchWeeks';
import type { ChurchWeekName, LibraryManifestV1 } from '../shared/types';

const blankName = (): ChurchWeekName => ({ sourceName: '', displayName: '' });

export function ChurchWeekNamesEditor({ library, onSave }: { library: LibraryManifestV1; onSave(library: LibraryManifestV1): Promise<void> }) {
  const [names, setNames] = useState<ChurchWeekName[]>(library.churchWeekNames ?? []);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => setNames(library.churchWeekNames ?? []), [library.churchWeekNames]);

  const update = (index: number, changes: Partial<ChurchWeekName>) => {
    setSaved(false);
    setNames(current => current.map((name, itemIndex) => itemIndex === index ? { ...name, ...changes } : name));
  };
  const save = async () => {
    setSaving(true);
    try {
      const next = validChurchWeekNames(names);
      await onSave({ ...library, churchWeekNames: next.length ? next : undefined });
      setNames(next);
      setSaved(true);
    } catch {
      // The parent owns workspace-save error reporting.
    } finally {
      setSaving(false);
    }
  };

  return <details className="editor-card church-week-names">
    <summary><span><span className="eyebrow">Church year</span><b>Manage church-week names</b></span><small>{names.length} saved alias{names.length === 1 ? '' : 'es'}</small></summary>
    <p className="helper">Keep Service Builder’s terse name as the source and choose the wording shown in bulletins. Either name can be entered during weekly editing.</p>
    <div className="church-week-name-list">
      {names.map((name, index) => <div className="church-week-name-row" key={index}>
        <label>Source name<input value={name.sourceName} placeholder="Service Builder name" onChange={event => update(index, { sourceName: event.target.value })} /></label>
        <label>Bulletin display name<input value={name.displayName} placeholder="Preferred full name" onChange={event => update(index, { displayName: event.target.value })} /></label>
        <button className="danger-text" aria-label={`Remove church-week name ${index + 1}`} onClick={() => { setSaved(false); setNames(current => current.filter((_name, itemIndex) => itemIndex !== index)); }}>Remove</button>
      </div>)}
      {!names.length && <p className="helper">No aliases saved yet. Weekly church-week text remains free-form.</p>}
    </div>
    <div className="builder-actions">
      <button className="secondary" onClick={() => { setSaved(false); setNames(current => [...current, blankName()]); }}>＋ Add name</button>
      <button className="primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : saved ? 'Saved' : 'Save church-week names'}</button>
    </div>
  </details>;
}
