import { templateChoices, templateVersions, type TemplateRecord } from '../shared/templates';

export function TemplateSwitcher({ records, currentPath, onSelect, onCreate }: { records: TemplateRecord[]; currentPath: string; onSelect(path: string): void; onCreate(): void }) {
  const current = records.find(record => record.path === currentPath) ?? templateChoices(records)[0];
  const families = templateChoices(records);
  const versions = current ? templateVersions(records, current.template.id) : [];
  return <section className="template-switcher">
    <div className="template-selectors">
      <label>Template<select aria-label="Template" value={current?.template.id ?? ''} onChange={event => {
        const selected = families.find(record => record.template.id === event.target.value);
        if (selected) onSelect(selected.path);
      }}>{families.map(record => <option value={record.template.id} key={record.template.id}>{record.template.name}</option>)}</select></label>
      <label>Version<select aria-label="Template version" value={currentPath} onChange={event => onSelect(event.target.value)}>{versions.map(record => <option value={record.path} key={record.path}>v{record.template.version}{record.template.status === 'draft' ? ' · Draft' : ' · Published'}</option>)}</select></label>
    </div>
    <button className="secondary" onClick={onCreate}>New template</button>
  </section>;
}
