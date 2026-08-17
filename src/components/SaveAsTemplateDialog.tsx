import { useState } from "react";

export function SaveAsTemplateDialog({ suggestedName, onSave, onClose }: {
  suggestedName: string;
  onSave(name: string): Promise<void>;
  onClose(): void;
}) {
  const [name, setName] = useState(suggestedName);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try { await onSave(name.trim()); }
    finally { setSaving(false); }
  };
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="save-as-template-modal" role="dialog" aria-modal="true" aria-labelledby="save-as-template-title">
      <header><div><div className="eyebrow">Reusable bulletin</div><h2 id="save-as-template-title">Save as Template</h2><p>Create a draft template from the current bulletin and continue editing it.</p></div><button aria-label="Close Save as Template" onClick={onClose}>×</button></header>
      <div className="create-from-settings"><label>Template name<input autoFocus value={name} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void save(); }} /></label></div>
      <footer><span>The original bulletin remains saved as its own item.</span><div><button className="secondary" disabled={saving} onClick={onClose}>Cancel</button><button className="primary" disabled={saving || !name.trim()} onClick={() => void save()}>{saving ? "Saving…" : "Save as Template"}</button></div></footer>
    </section>
  </div>;
}
