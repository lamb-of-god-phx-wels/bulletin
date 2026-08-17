import { useMemo, useState } from "react";
import { editableTemplateChoices, type TemplateRecord } from "../shared/templates";

export function TemplateChooserDialog({ records, canCreate, onSelect, onCreate, onClose }: {
  records: TemplateRecord[];
  canCreate: boolean;
  onSelect(record: TemplateRecord): void;
  onCreate(): void;
  onClose(): void;
}) {
  const [query, setQuery] = useState("");
  const choices = useMemo(() => editableTemplateChoices(records).filter(record =>
    record.template.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  ), [records, query]);

  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="template-chooser-modal" role="dialog" aria-modal="true" aria-labelledby="template-chooser-title">
      <header><div><div className="eyebrow">Bulletin Editor</div><h2 id="template-chooser-title">Edit a template</h2><p>Select a reusable bulletin template or create a new one.</p></div><button aria-label="Close template chooser" onClick={onClose}>×</button></header>
      <div className="create-from-settings"><label>Search templates<input autoFocus type="search" value={query} placeholder="Template name" onChange={event => setQuery(event.target.value)} /></label></div>
      <div className="create-source-list template-chooser-list">
        {choices.map(record => <button key={record.template.id} onClick={() => onSelect(record)}><span>◇</span><div><b>{record.template.name}</b><small>Version {record.template.version} · {record.template.status === "draft" ? "Draft" : "Published"}</small></div><strong>Edit</strong></button>)}
        {!choices.length && <div className="create-source-empty"><b>{records.length ? "No matching templates" : "No templates yet"}</b><span>{records.length ? "Try another template name." : "Create a template to begin."}</span></div>}
      </div>
      <footer><span>{choices.length} template{choices.length === 1 ? "" : "s"}</span><div><button className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={!canCreate} onClick={onCreate}>＋ Create New</button></div></footer>
    </section>
  </div>;
}
