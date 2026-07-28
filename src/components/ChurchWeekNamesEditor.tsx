import { useEffect, useMemo, useState } from 'react';
import { churchWeekForDate, importChurchWeekCalendar, validChurchWeekCalendar, validChurchWeekNames } from '../shared/churchWeeks';
import type { ChurchWeekCalendarEntry, ChurchWeekName, LibraryManifestV1 } from '../shared/types';

const blankName = (): ChurchWeekName => ({ sourceName: '', displayName: '' });

export function ChurchWeekNamesEditor({ library, serviceDate, onChurchWeekImported, onSave }: { library: LibraryManifestV1; serviceDate: string; onChurchWeekImported(value: string): void; onSave(library: LibraryManifestV1): Promise<void> }) {
  const [names, setNames] = useState<ChurchWeekName[]>(library.churchWeekNames ?? []);
  const [calendar, setCalendar] = useState<ChurchWeekCalendarEntry[]>(library.churchWeekCalendar ?? []);
  const [panel, setPanel] = useState<'import' | 'manage'>();
  const [importText, setImportText] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const detected = useMemo(() => importChurchWeekCalendar(importText), [importText]);

  useEffect(() => setNames(library.churchWeekNames ?? []), [library.churchWeekNames]);
  useEffect(() => setCalendar(library.churchWeekCalendar ?? []), [library.churchWeekCalendar]);

  const update = (index: number, changes: Partial<ChurchWeekName>) => {
    setSaved(false);
    setNames(current => current.map((name, itemIndex) => itemIndex === index ? { ...name, ...changes } : name));
  };
  const persist = async (nextNames: ChurchWeekName[], nextCalendar: ChurchWeekCalendarEntry[]) => {
    setSaving(true);
    try {
      const cleanNames = validChurchWeekNames(nextNames);
      const cleanCalendar = validChurchWeekCalendar(nextCalendar);
      await onSave({ ...library, churchWeekNames: cleanNames.length ? cleanNames : undefined, churchWeekCalendar: cleanCalendar.length ? cleanCalendar : undefined });
      setNames(cleanNames);
      setCalendar(cleanCalendar);
      const currentWeek = churchWeekForDate(serviceDate, cleanCalendar, cleanNames);
      if (currentWeek) onChurchWeekImported(currentWeek);
      setSaved(true);
    } catch {
      // The parent owns workspace-save error reporting.
    } finally {
      setSaving(false);
    }
  };
  const applyImport = () => {
    const merged = new Map(calendar.map(entry => [entry.date, entry]));
    for (const entry of detected) merged.set(entry.date, entry);
    void persist(names, [...merged.values()]);
  };
  const chooseFile = async (file?: File) => {
    if (!file) return;
    setImportText(await file.text());
    setSaved(false);
  };

  return <section className="editor-card church-week-names">
    <header><span><span className="eyebrow">Church year</span><b>Service Builder calendar</b><small>{calendar.length} imported date{calendar.length === 1 ? '' : 's'} · {names.length} display-name alias{names.length === 1 ? '' : 'es'}</small></span><div className="builder-actions"><button className="primary" onClick={() => setPanel(panel === 'import' ? undefined : 'import')}>Import from Service Builder</button><button className="secondary" onClick={() => setPanel(panel === 'manage' ? undefined : 'manage')}>Manage names</button></div></header>
    {panel === 'import' && <div className="church-week-import">
      <p className="helper">In Service Builder, export a bulletin as HTML and select it here. For several dates, paste calendar rows as <b>date, church week</b>—one per line.</p>
      <div className="builder-actions"><button className="text-button" onClick={() => window.bulletin?.openChurchYearSource()}>Open Service Builder ↗</button><label className="secondary file-button">Choose exported HTML or text<input type="file" accept=".html,.htm,.txt,.csv,text/html,text/plain,text/csv" onChange={event => void chooseFile(event.target.files?.[0])} /></label></div>
      <label>Exported or copied calendar data<textarea rows={6} value={importText} placeholder={'2026-08-02, Pentecost 10\n2026-08-09, Pentecost 11'} onChange={event => { setImportText(event.target.value); setSaved(false); }} /></label>
      <div className="church-week-import-preview"><b>Detected entries</b>{detected.length ? detected.map(entry => <span key={entry.date}><time>{entry.date}</time>{entry.sourceName}</span>) : <small>No date/name pairs detected yet.</small>}</div>
      <div className="builder-actions"><button className="primary" disabled={!detected.length || saving} onClick={applyImport}>{saving ? 'Importing…' : `Import ${detected.length} date${detected.length === 1 ? '' : 's'}`}</button>{saved && <small>Imported and saved.</small>}</div>
    </div>}
    {panel === 'manage' && <>
      <p className="helper">Keep Service Builder’s terse name as the source and choose the wording shown in bulletins. Either name can be entered during weekly editing.</p>
      <div className="church-week-name-list">
        {names.map((name, index) => <div className="church-week-name-row" key={index}>
          <label>Source name<input value={name.sourceName} placeholder="Service Builder name" onChange={event => update(index, { sourceName: event.target.value })} /></label>
          <label>Bulletin display name<input value={name.displayName} placeholder="Preferred full name" onChange={event => update(index, { displayName: event.target.value })} /></label>
          <button className="danger-text" aria-label={`Remove church-week name ${index + 1}`} onClick={() => { setSaved(false); setNames(current => current.filter((_name, itemIndex) => itemIndex !== index)); }}>Remove</button>
        </div>)}
        {!names.length && <p className="helper">No aliases saved yet. Imported source names will be used as-is.</p>}
      </div>
      <div className="builder-actions"><button className="secondary" onClick={() => { setSaved(false); setNames(current => [...current, blankName()]); }}>＋ Add name</button><button className="primary" disabled={saving} onClick={() => void persist(names, calendar)}>{saving ? 'Saving…' : saved ? 'Saved' : 'Save display names'}</button></div>
      {calendar.length > 0 && <details className="church-week-calendar-list"><summary>Review {calendar.length} imported dates</summary>{calendar.map((entry, index) => <div className="church-week-name-row" key={entry.date}><label>Date<input type="date" value={entry.date} onChange={event => { setSaved(false); setCalendar(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, date: event.target.value } : item)); }} /></label><label>Source name<input value={entry.sourceName} onChange={event => { setSaved(false); setCalendar(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, sourceName: event.target.value } : item)); }} /></label><button className="danger-text" onClick={() => { setSaved(false); setCalendar(current => current.filter((_item, itemIndex) => itemIndex !== index)); }}>Remove</button></div>)}</details>}
    </>}
  </section>;
}
