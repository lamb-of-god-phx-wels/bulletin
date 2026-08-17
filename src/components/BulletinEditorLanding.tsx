import { useMemo, useState } from 'react';
import { filterBulletins, type BulletinRecord } from '../shared/bulletins';

export function BulletinEditorLanding({ bulletins, canCreate, onCreate, onEditTemplate, onSelect }: {
  bulletins: BulletinRecord[];
  canCreate: boolean;
  onCreate(): void;
  onEditTemplate(): void;
  onSelect(record: BulletinRecord): void;
}) {
  const [query, setQuery] = useState('');
  const matches = useMemo(() => filterBulletins(bulletins, query), [bulletins, query]);

  return <section className="bulletin-editor-landing">
    <header>
      <div>
        <div className="eyebrow">Workspace bulletins</div>
        <h2>Current bulletins</h2>
        <p>{bulletins.length} saved bulletin{bulletins.length === 1 ? '' : 's'}, newest first.</p>
      </div>
      <div className="bulletin-editor-landing-actions"><button type="button" className="secondary" onClick={onEditTemplate}>Edit Template</button><button type="button" className="primary" disabled={!canCreate} onClick={onCreate}>＋ Create New</button></div>
    </header>
    <div className="bulletin-editor-search">
      <label>Search bulletins<input type="search" value={query} placeholder="Title, series, date, or church event" onChange={event => setQuery(event.target.value)} /></label>
      <span>{matches.length} result{matches.length === 1 ? '' : 's'}</span>
    </div>
    <div className="bulletin-editor-list">
      {matches.map(record => {
        const date = new Date(`${record.document.info.date}T12:00:00`).toLocaleDateString(undefined, {
          weekday: 'short',
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        });
        return <button type="button" key={record.path} onClick={() => onSelect(record)}>
          <time dateTime={record.document.info.date}><b>{date}</b><small>{record.document.info.churchWeek}</small></time>
          <span><b>{record.document.info.title || 'Untitled bulletin'}</b><small>{record.document.info.series || record.document.church.name}</small></span>
          <strong>Edit</strong>
        </button>;
      })}
      {!matches.length && <div className="bulletin-editor-empty">
        <span>⌕</span>
        <b>{bulletins.length ? 'No matching bulletins' : 'No bulletins yet'}</b>
        <p>{bulletins.length ? 'Try a title, date, series, or church event.' : 'Create a bulletin to begin editing.'}</p>
      </div>}
    </div>
  </section>;
}
