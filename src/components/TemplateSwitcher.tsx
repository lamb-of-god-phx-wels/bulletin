import { templateChoices, templateVersions, type TemplateRecord } from '../shared/templates';

export function TemplateSwitcher({ records, currentPath, onSelect, onCreate }: { records: TemplateRecord[]; currentPath: string; onSelect(path: string): void; onCreate(): void }) {
  const current = records.find(record => record.path === currentPath) ?? templateChoices(records)[0];
  const versions = current ? templateVersions(records, current.template.id) : [];
  return <section className="template-switcher">
    <div className="template-selectors">
      <label>Version<select aria-label="Template version" value={currentPath} onChange={event => onSelect(event.target.value)}>{versions.map(record => <option value={record.path} key={record.path}>v{record.template.version}{record.template.status === 'draft' ? ' · Draft' : ' · Published'}</option>)}</select></label>
    </div>
    <button className="secondary" onClick={onCreate}>New template</button>
  </section>;
}
