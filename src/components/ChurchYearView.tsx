import { useEffect, useMemo, useState } from 'react';
import { churchCalendarIssues, churchEventDates, churchEventDisplayName, churchEventsForDate, churchLectionaryYear, welsCalendarPreset } from '../shared/churchCalendar';
import { randomId } from '../shared/id';
import type { ChurchCalendarEvent, ChurchEventRule, ChurchLectionaryYear, LibraryManifestV1 } from '../shared/types';

const monthKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const isoDate = (year: number, month: number, day: number) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
const monthName = (key: string) => new Date(`${key}-15T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const blankRule = (date?: string): ChurchEventRule => date ? { kind: 'once', date } : { kind: 'annualDate', month: 1, day: 1 };
const blankEvent = (date?: string): ChurchCalendarEvent => ({
  id: `event-${randomId()}`,
  name: 'New church event',
  enabled: true,
  priority: 50,
  rules: [blankRule(date)]
});

function RuleFields({ rule, events, onChange, onRemove }: { rule: ChurchEventRule; events: ChurchCalendarEvent[]; onChange(rule: ChurchEventRule): void; onRemove(): void }) {
  const number = (key: string, value: number) => onChange({ ...rule, [key]: value } as ChurchEventRule);
  const anchors = events.filter(event => event.id && event.enabled);
  return <div className="calendar-rule">
    <label>Rule<select value={rule.kind} onChange={event => {
      const kind = event.target.value as ChurchEventRule['kind'];
      onChange(kind === 'once' ? { kind, date: new Date().toISOString().slice(0, 10) }
        : kind === 'annualDate' ? { kind, month: 1, day: 1 }
            : kind === 'nthWeekday' ? { kind, weekday: 0, ordinal: 1 }
              : kind === 'weekdayOnOrAfter' ? { kind, month: 1, day: 1, weekday: 0 }
                : kind === 'weekdayInDateRange' ? { kind, startMonth: 1, startDay: 1, endMonth: 1, endDay: 7, weekday: 0 }
              : kind === 'easter' ? { kind }
                : kind === 'relativeDays' ? { kind, eventId: anchors[0]?.id ?? '', days: 0 }
                  : { kind, eventId: anchors[0]?.id ?? '', weekday: 0, ordinal: 1, direction: 'before' });
    }}>
      <option value="once">One-time date</option><option value="annualDate">Annual date</option><option value="nthWeekday">Nth weekday</option><option value="weekdayOnOrAfter">Weekday on or after date</option><option value="weekdayInDateRange">Weekday within annual range</option><option value="easter">Gregorian Easter</option><option value="relativeDays">Days from another event</option><option value="weekdayRelative">Weekday before / after event</option>
    </select></label>
    {rule.kind === 'once' && <label>Date<input type="date" value={rule.date} onChange={event => onChange({ ...rule, date: event.target.value })} /></label>}
    {(rule.kind === 'annualDate' || rule.kind === 'weekdayOnOrAfter') && <><label>Month<input type="number" min="1" max="12" value={rule.month} onChange={event => number('month', event.currentTarget.valueAsNumber)} /></label><label>Day<input type="number" min="1" max="31" value={rule.day} onChange={event => number('day', event.currentTarget.valueAsNumber)} /></label></>}
    {rule.kind === 'weekdayInDateRange' && <><label>Start month<input type="number" min="1" max="12" value={rule.startMonth} onChange={event => number('startMonth', event.currentTarget.valueAsNumber)} /></label><label>Start day<input type="number" min="1" max="31" value={rule.startDay} onChange={event => number('startDay', event.currentTarget.valueAsNumber)} /></label><label>End month<input type="number" min="1" max="12" value={rule.endMonth} onChange={event => number('endMonth', event.currentTarget.valueAsNumber)} /></label><label>End day<input type="number" min="1" max="31" value={rule.endDay} onChange={event => number('endDay', event.currentTarget.valueAsNumber)} /></label></>}
    {(rule.kind === 'nthWeekday' || rule.kind === 'weekdayOnOrAfter' || rule.kind === 'weekdayInDateRange' || rule.kind === 'weekdayRelative') && <label>Weekday<select value={rule.weekday} onChange={event => number('weekday', Number(event.target.value))}>{weekdays.map((name, index) => <option value={index} key={name}>{name}</option>)}</select></label>}
    {rule.kind === 'nthWeekday' && <><label>Month<select value={rule.month ?? ''} onChange={event => onChange({ ...rule, month: event.target.value ? Number(event.target.value) : undefined })}><option value="">Every month</option>{Array.from({ length: 12 }, (_, index) => <option value={index + 1} key={index}>{new Date(2026, index, 1).toLocaleDateString(undefined, { month: 'long' })}</option>)}</select></label><label>Occurrence<select value={rule.ordinal} onChange={event => onChange({ ...rule, ordinal: Number(event.target.value) as typeof rule.ordinal })}><option value="1">First</option><option value="2">Second</option><option value="3">Third</option><option value="4">Fourth</option><option value="5">Fifth</option><option value="-1">Last</option></select></label></>}
    {(rule.kind === 'relativeDays' || rule.kind === 'weekdayRelative') && <label>Anchor event<select value={rule.eventId} onChange={event => onChange({ ...rule, eventId: event.target.value })}>{anchors.map(anchor => <option value={anchor.id} key={anchor.id}>{anchor.name}</option>)}</select></label>}
    {rule.kind === 'relativeDays' && <label>Only before event<select value={rule.beforeEventId ?? ''} onChange={event => onChange({ ...rule, beforeEventId: event.target.value || undefined })}><option value="">No restriction</option>{anchors.filter(anchor => anchor.id !== rule.eventId).map(anchor => <option value={anchor.id} key={anchor.id}>{anchor.name}</option>)}</select></label>}
    {rule.kind === 'weekdayInDateRange' && <label>Only after event<select value={rule.afterEventId ?? ''} onChange={event => onChange({ ...rule, afterEventId: event.target.value || undefined })}><option value="">No restriction</option>{anchors.map(anchor => <option value={anchor.id} key={anchor.id}>{anchor.name}</option>)}</select></label>}
    {rule.kind === 'relativeDays' && <label>Day offset<input type="number" value={rule.days} onChange={event => number('days', event.currentTarget.valueAsNumber)} /></label>}
    {rule.kind === 'weekdayRelative' && <><label>Occurrence<select value={rule.ordinal} onChange={event => onChange({ ...rule, ordinal: Number(event.target.value) as typeof rule.ordinal })}>{[1, 2, 3, 4, 5].map(value => <option value={value} key={value}>{value}</option>)}</select></label><label>Direction<select value={rule.direction} onChange={event => onChange({ ...rule, direction: event.target.value as typeof rule.direction })}><option value="before">Before</option><option value="after">After</option></select></label></>}
    <button className="danger-text" onClick={onRemove}>Remove rule</button>
  </div>;
}

function EventEditor({ value, events, onChange, onClose, onDelete }: { value: ChurchCalendarEvent; events: ChurchCalendarEvent[]; onChange(value: ChurchCalendarEvent): void; onClose(): void; onDelete(): void }) {
  const year = new Date().getFullYear();
  const previewEvents = events.some(event => event.id === value.id) ? events.map(event => event.id === value.id ? value : event) : [...events, value];
  const upcoming = [year, year + 1].flatMap(item => churchEventDates(value.id, item, previewEvents)).slice(0, 8);
  return <aside className="calendar-event-editor">
    <header><div><div className="eyebrow">Church-owned asset</div><h3>{value.name}</h3></div><button aria-label="Close event editor" onClick={onClose}>×</button></header>
    <label>Asset name<input value={value.name} onChange={event => onChange({ ...value, name: event.target.value })} /></label>
    <label>Bulletin name<select value={value.nameMode ?? 'literal'} onChange={event => onChange({ ...value, nameMode: event.target.value === 'literal' ? undefined : 'sundayAfterPentecost' })}><option value="literal">Use asset name</option><option value="sundayAfterPentecost">Numbered Sunday After Pentecost</option></select></label>
    <div className="field-row"><label>Priority<input type="number" value={value.priority} onChange={event => onChange({ ...value, priority: event.currentTarget.valueAsNumber })} /></label><label className="check"><input type="checkbox" checked={value.enabled} onChange={event => onChange({ ...value, enabled: event.target.checked })} />Enabled</label></div>
    <fieldset className="calendar-cycle"><legend>Lectionary years</legend>{(['A', 'B', 'C'] as const).map(year => <label className="check" key={year}><input type="checkbox" checked={!value.lectionaryYears?.length || value.lectionaryYears.includes(year)} onChange={event => {
	      const current: ChurchLectionaryYear[] = value.lectionaryYears?.length ? value.lectionaryYears : ['A', 'B', 'C'];
      const next = event.target.checked ? [...new Set([...current, year])] : current.filter(item => item !== year);
      onChange({ ...value, lectionaryYears: next.length === 3 ? undefined : next });
    }} />{year}</label>)}</fieldset>
    <div className="calendar-rules-heading"><b>Date rules</b><button className="secondary" onClick={() => onChange({ ...value, rules: [...value.rules, blankRule()] })}>＋ Add rule</button></div>
    {value.rules.map((rule, index) => <RuleFields rule={rule} events={events.filter(event => event.id !== value.id)} key={index} onChange={next => onChange({ ...value, rules: value.rules.map((item, itemIndex) => itemIndex === index ? next : item) })} onRemove={() => onChange({ ...value, rules: value.rules.filter((_item, itemIndex) => itemIndex !== index) })} />)}
    <div className="calendar-occurrence-preview"><b>Upcoming occurrences</b>{upcoming.length ? upcoming.map(date => <span key={date}>{new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} · {churchEventDisplayName(value, date, previewEvents)}</span>) : <span>No dates produced by these rules.</span>}</div>
    <button className="danger-text calendar-delete-event" onClick={onDelete}>Delete event</button>
  </aside>;
}

export function ChurchYearView({ library, onSave, onDirtyChange }: {
  library: LibraryManifestV1;
  onSave(library: LibraryManifestV1): Promise<void>;
  onDirtyChange?(dirty: boolean): void;
}) {
  const [events, setEvents] = useState(() => structuredClone(library.calendarEvents ?? []));
  const [month, setMonth] = useState(monthKey());
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [editing, setEditing] = useState<ChurchCalendarEvent>();
  const [saving, setSaving] = useState(false);
  const issues = churchCalendarIssues(events);
  useEffect(() => { setEvents(structuredClone(library.calendarEvents ?? [])); onDirtyChange?.(false); }, [library.calendarEvents]);
  const change = (next: ChurchCalendarEvent[]) => { setEvents(next); onDirtyChange?.(true); };
  const updateEditing = (next: ChurchCalendarEvent) => {
    setEditing(next);
    change(events.some(event => event.id === next.id) ? events.map(event => event.id === next.id ? next : event) : [...events, next]);
  };
  const [year, monthNumber] = month.split('-').map(Number);
  const firstWeekday = new Date(year, monthNumber - 1, 1).getDay();
  const days = new Date(year, monthNumber, 0).getDate();
  const cells = Array.from({ length: Math.ceil((firstWeekday + days) / 7) * 7 }, (_, index) => {
    const day = index - firstWeekday + 1;
    return day >= 1 && day <= days ? isoDate(year, monthNumber, day) : undefined;
  });
  const selectedEvents = useMemo(() => churchEventsForDate(selectedDate, events), [selectedDate, events]);
  const moveMonth = (offset: number) => {
    const next = new Date(year, monthNumber - 1 + offset, 1);
    const key = monthKey(next); setMonth(key); setSelectedDate(`${key}-01`);
  };
  const save = async () => {
    if (issues.length) return;
    setSaving(true);
    try { await onSave({ ...library, calendarEvents: events, churchWeekNames: undefined }); onDirtyChange?.(false); }
    finally { setSaving(false); }
  };
  return <div className="church-calendar-screen">
    <header className="church-calendar-toolbar">
      <div><div className="eyebrow">Shared church assets</div><h2>Church Calendar</h2><p>Church year {churchLectionaryYear(selectedDate)} · events are synchronized with this workspace.</p></div>
      <div className="calendar-navigation"><button onClick={() => moveMonth(-1)}>‹</button><button onClick={() => { const key = monthKey(); setMonth(key); setSelectedDate(new Date().toISOString().slice(0, 10)); }}>Today</button><button onClick={() => moveMonth(1)}>›</button><strong>{monthName(month)}</strong></div>
      <div className="calendar-toolbar-actions"><button className="secondary" onClick={() => {
        const missing = welsCalendarPreset().filter(preset => !events.some(event => event.id === preset.id));
        change([...events, ...missing]);
      }}>Restore missing WELS presets</button><button className="primary" disabled={saving || Boolean(issues.length)} onClick={() => void save()}>{saving ? 'Saving…' : 'Save calendar'}</button></div>
    </header>
    <main className="church-calendar-layout">
      <section className="church-calendar-grid">
        {weekdays.map(day => <b className="calendar-weekday" key={day}>{day.slice(0, 3)}</b>)}
        {cells.map((date, index) => date ? <button className={`calendar-day ${date === selectedDate ? 'selected' : ''} ${date === new Date().toISOString().slice(0, 10) ? 'today' : ''}`} key={date} onClick={() => setSelectedDate(date)}>
          <span>{Number(date.slice(-2))}</span>
          <div>{churchEventsForDate(date, events).slice(0, 4).map(event => <i className={event.id === churchEventsForDate(date, events)[0]?.id ? 'default' : ''} key={event.id} onClick={click => { click.stopPropagation(); setSelectedDate(date); setEditing(structuredClone(event)); }}>{churchEventDisplayName(event, date, events)}</i>)}</div>
        </button> : <span className="calendar-day outside" key={index} />)}
      </section>
      <aside className="calendar-day-panel">
        <div className="eyebrow">{new Date(`${selectedDate}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long' })}</div>
        <h3>{new Date(`${selectedDate}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</h3>
        <button className="primary" onClick={() => { const next = blankEvent(selectedDate); updateEditing(next); }}>＋ Add event</button>
        <div className="calendar-day-events">{selectedEvents.map((event, index) => <button key={event.id} onClick={() => setEditing(structuredClone(event))}><span>{churchEventDisplayName(event, selectedDate, events)}</span><small>{index === 0 ? 'Bulletin default' : `Priority ${event.priority}`}</small></button>)}{!selectedEvents.length && <p>No church events occur on this date.</p>}</div>
        {issues.length > 0 && <div className="validation warning"><b>{issues.length} calendar issue{issues.length === 1 ? '' : 's'}</b>{issues.slice(0, 6).map(issue => <p key={`${issue.eventId}-${issue.message}`}>{issue.message}</p>)}</div>}
      </aside>
      {editing && <EventEditor value={editing} events={events} onChange={updateEditing} onClose={() => setEditing(undefined)} onDelete={() => { change(events.filter(event => event.id !== editing.id)); setEditing(undefined); }} />}
    </main>
  </div>;
}
