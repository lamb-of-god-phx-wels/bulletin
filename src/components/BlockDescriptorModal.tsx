import { useMemo, useState } from 'react';
import { createBulletin } from '../shared/defaults';
import { instantiateBlockDescriptor, parseBlockDescriptor } from '../prepackagedBlocks';
import type { BlockDescriptorV1, LibraryManifestV1, TemplateV1 } from '../shared/types';
import { DocumentView } from './DocumentView';

export function BlockDescriptorModal({ initialText, fileName, readOnly = false, confirmLabel = 'Import block', existing, template, library, root, onClose, onSave }: {
  initialText: string;
  fileName?: string;
  readOnly?: boolean;
  confirmLabel?: string;
  existing: BlockDescriptorV1[];
  template: TemplateV1;
  library?: LibraryManifestV1;
  root?: string;
  onClose(): void;
  onSave?(descriptor: BlockDescriptorV1): Promise<void>;
}) {
  const [text, setText] = useState(initialText);
  const [saving, setSaving] = useState(false);
  const parsed = useMemo(() => parseBlockDescriptor(text), [text]);
  const duplicate = !readOnly && parsed.descriptor && existing.some(item => item.id === parsed.descriptor!.id && item.version === parsed.descriptor!.version)
    ? `A workspace block with ID “${parsed.descriptor.id}” version ${parsed.descriptor.version} already exists. Increase the version before importing.`
    : undefined;
  const preview = useMemo(() => {
    if (!parsed.descriptor) return undefined;
    const document = createBulletin(template);
    document.id = 'descriptor-preview';
    document.blocks = [instantiateBlockDescriptor(parsed.descriptor)];
    return document;
  }, [parsed.descriptor, template]);
  const issues = [...parsed.issues, ...(duplicate ? [duplicate] : [])];

  return <div className="modal-backdrop block-modal-backdrop"><section className="descriptor-modal" role="dialog" aria-modal="true" aria-labelledby="descriptor-modal-title">
    <header><div><div className="eyebrow">{readOnly ? 'Pre-packaged JSON' : 'Import review'}</div><h2 id="descriptor-modal-title">{parsed.descriptor?.name ?? fileName ?? 'Block descriptor'}</h2><p>{fileName ? `${fileName} · ` : ''}{readOnly ? 'Use this definition as an example for your own blocks.' : 'Review validation and the rendered result before saving.'}</p></div><button aria-label="Close block descriptor" onClick={onClose}>×</button></header>
    <div className="descriptor-modal-body"><main>
      <label>JSON definition<textarea aria-label="JSON definition" readOnly={readOnly} spellCheck={false} value={text} onChange={event => setText(event.target.value)} /></label>
      <section className={`descriptor-validation ${issues.length ? 'invalid' : 'valid'}`} aria-live="polite">
        <b>{issues.length ? `${issues.length} validation ${issues.length === 1 ? 'problem' : 'problems'}` : '✓ Valid block descriptor'}</b>
        {issues.length > 0 && <ol>{issues.map((issue, index) => <li key={`${issue}-${index}`}>{issue}</li>)}</ol>}
        {!issues.length && parsed.descriptor && <span>{parsed.descriptor.id} · version {parsed.descriptor.version} · {parsed.descriptor.block.type}</span>}
      </section>
    </main><aside><div className="eyebrow">Rendered preview</div>{preview && !issues.length ? <div className="descriptor-document-preview"><DocumentView document={preview} template={template} library={library} root={root} rulers={false} guides={false} zoom={.48} /></div> : <div className="descriptor-preview-empty"><span>◇</span><b>Preview unavailable</b><p>Correct the JSON validation problems to render this block.</p></div>}</aside></div>
    <footer><span>{!readOnly && 'Nothing is saved until you confirm.'}</span><div><button className="secondary" onClick={onClose}>{readOnly ? 'Close' : 'Cancel'}</button>{!readOnly && <button className="primary" disabled={saving || issues.length > 0 || !parsed.descriptor} onClick={async () => { if (!parsed.descriptor || !onSave) return; setSaving(true); try { await onSave(parsed.descriptor); onClose(); } finally { setSaving(false); } }}>{saving ? 'Saving…' : confirmLabel}</button>}</div></footer>
  </section></div>;
}
