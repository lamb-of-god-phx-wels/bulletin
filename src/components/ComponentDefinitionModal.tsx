import { useMemo, useState } from 'react';
import { createBulletin } from '../shared/defaults';
import { instantiateComponentDefinition, parseImportedComponent } from '../componentDefinitions';
import { parseComponentDefinition } from '../component-engine/catalog';
import type { DeclarativeComponentDefinition } from '../component-engine/types';
import type { LibraryManifestV1, TemplateV1 } from '../shared/types';
import { DocumentView } from './DocumentView';

export function ComponentDefinitionModal({ initialText, fileName, readOnly = false, confirmLabel = 'Import component', existing, template, library, root, onClose, onSave }: {
  initialText: string;
  fileName?: string;
  readOnly?: boolean;
  confirmLabel?: string;
  existing: DeclarativeComponentDefinition[];
  template: TemplateV1;
  library?: LibraryManifestV1;
  root?: string;
  onClose(): void;
  onSave?(definition: DeclarativeComponentDefinition): Promise<void>;
}) {
  const [text, setText] = useState(initialText);
  const [saving, setSaving] = useState(false);
  const parsed = useMemo(() => readOnly ? parseComponentDefinition(text) : parseImportedComponent(text, existing), [text, existing, readOnly]);
  const definition = parsed.definition;
  const duplicate = !readOnly && definition && existing.some(item => item.type === definition.type && item.version === definition.version)
    ? `A workspace component with type “${definition.type}” version ${definition.version} already exists. Increase the version before importing.`
    : undefined;
  const preview = useMemo(() => {
    if (!definition) return undefined;
    const document = createBulletin(template);
    document.id = 'descriptor-preview';
    document.blocks = [instantiateComponentDefinition(definition)];
    return document;
  }, [definition, template]);
  const issues = [...parsed.diagnostics.map(item => `${item.jsonPointer ?? '/'}: ${item.message}`), ...(duplicate ? [duplicate] : [])];

  return <div className="modal-backdrop block-modal-backdrop"><section className="descriptor-modal" role="dialog" aria-modal="true" aria-labelledby="descriptor-modal-title">
    <header><div><div className="eyebrow">{readOnly ? 'Pre-packaged JSON' : 'Import review'}</div><h2 id="descriptor-modal-title">{definition?.name ?? fileName ?? 'Component definition'}</h2><p>{fileName ? `${fileName} · ` : ''}{readOnly ? 'Use this definition as an example for your own components.' : 'Review validation and the rendered result before saving.'}</p></div><button aria-label="Close component definition" onClick={onClose}>×</button></header>
    <div className="descriptor-modal-body"><main>
      <label>JSON definition<textarea aria-label="JSON definition" readOnly={readOnly} spellCheck={false} value={text} onChange={event => setText(event.target.value)} /></label>
      <section className={`descriptor-validation ${issues.length ? 'invalid' : 'valid'}`} aria-live="polite">
        <b>{issues.length ? `${issues.length} validation ${issues.length === 1 ? 'problem' : 'problems'}` : '✓ Valid component definition'}</b>
        {issues.length > 0 && <ol>{issues.map((issue, index) => <li key={`${issue}-${index}`}>{issue}</li>)}</ol>}
        {!issues.length && definition && <span>{definition.type} · version {definition.version}</span>}
      </section>
    </main><aside><div className="eyebrow">Rendered preview</div>{preview && !issues.length ? <div className="descriptor-document-preview"><DocumentView document={preview} template={template} library={library} root={root} rulers={false} guides={false} zoom={.48} /></div> : <div className="descriptor-preview-empty"><span>◇</span><b>Preview unavailable</b><p>Correct the JSON validation problems to render this block.</p></div>}</aside></div>
    <footer><span>{!readOnly && 'Nothing is saved until you confirm.'}</span><div><button className="secondary" onClick={onClose}>{readOnly ? 'Close' : 'Cancel'}</button>{!readOnly && <button className="primary" disabled={saving || issues.length > 0 || !definition} onClick={async () => { if (!definition || !onSave) return; setSaving(true); try { await onSave(definition); onClose(); } finally { setSaving(false); } }}>{saving ? 'Saving…' : confirmLabel}</button>}</div></footer>
  </section></div>;
}
