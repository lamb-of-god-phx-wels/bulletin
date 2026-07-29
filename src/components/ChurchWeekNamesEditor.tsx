import { useEffect, useState } from 'react';
import { validChurchWeekNames } from '../shared/churchWeeks';
import type { ChurchWeekName, LibraryManifestV1 } from '../shared/types';

const blankName = (): ChurchWeekName => ({ sourceName: '', displayName: '' });

export function ChurchWeekNamesEditor({ library, onSave, onDirtyChange }: { library: LibraryManifestV1; onSave(library: LibraryManifestV1): Promise<void>; onDirtyChange?(dirty: boolean): void }) {
  const [names, setNames] = useState<ChurchWeekName[]>(library.churchWeekNames ?? []);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { setNames(library.churchWeekNames ?? []); onDirtyChange?.(false); }, [library.churchWeekNames]);

  const update = (index: number, changes: Partial<ChurchWeekName>) => {
    setSaved(false);
    onDirtyChange?.(true);
    setNames(current => current.map((name, itemIndex) => itemIndex === index ? { ...name, ...changes } : name));
  };
  const save = async () => {
    setSaving(true);
    try {
      const next = validChurchWeekNames(names);
      await onSave({ ...library, churchWeekNames: next.length ? next : undefined });
      setNames(next);
      setSaved(true);
      onDirtyChange?.(false);
    } catch {
      // The parent owns workspace-save error reporting.
    } finally {
      setSaving(false);
    }
  };

  return <details className="editor-card church-week-names">
    <summary><span><span className="eyebrow">Church year</span><b>Manage display-name overrides</b></span><small>{names.length} saved override{names.length === 1 ? '' : 's'}</small></summary>
    <p className="helper">Service Builder names are matched exactly. The preferred display name is used in this bulletin and in bound cover text.</p>
    <div className="church-week-name-list">
      {names.map((name, index) => <div className="church-week-name-row" key={index}>
        <label>Service Builder name<input value={name.sourceName} onChange={event => update(index, { sourceName: event.target.value })} /></label>
        <label>Bulletin display name<input value={name.displayName} onChange={event => update(index, { displayName: event.target.value })} /></label>
        <button className="danger-text" aria-label={`Remove church-week override ${index + 1}`} onClick={() => { setSaved(false); onDirtyChange?.(true); setNames(current => current.filter((_name, itemIndex) => itemIndex !== index)); }}>Remove</button>
      </div>)}
      {!names.length && <p className="helper">No overrides saved. Choosing a date will prompt when Service Builder returns a new name.</p>}
    </div>
    <div className="builder-actions"><button className="secondary" onClick={() => { setSaved(false); onDirtyChange?.(true); setNames(current => [...current, blankName()]); }}>＋ Add override</button><button className="primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : saved ? 'Saved' : 'Save overrides'}</button></div>
  </details>;
}
