import { useRef, useState } from 'react';
import { prepackagedBlockDescriptors } from '../prepackagedBlocks';
import type { BlockDescriptorV1, LibraryManifestV1, TemplateV1 } from '../shared/types';
import { BlockDescriptorModal } from './BlockDescriptorModal';

function ChoiceIcon({ icon = 'T' }: { icon?: string }) {
  return <span className="block-choice-icon">{icon}</span>;
}

export function BlockLibraryModal({ workspaceDescriptors, template, library, root, onClose, onUsePrepackaged, onUseDescriptor, onSaveDescriptor, onDeleteDescriptor }: {
  workspaceDescriptors: BlockDescriptorV1[];
  template: TemplateV1;
  library?: LibraryManifestV1;
  root?: string;
  onClose(): void;
  onUsePrepackaged(descriptor: BlockDescriptorV1): void;
  onUseDescriptor(descriptor: BlockDescriptorV1): void;
  onSaveDescriptor(descriptor: BlockDescriptorV1): Promise<void>;
  onDeleteDescriptor(descriptor: BlockDescriptorV1): Promise<void>;
}) {
  const [descriptorReview, setDescriptorReview] = useState<{ text: string; fileName?: string; readOnly?: boolean; confirmLabel?: string }>();
  const [deleteDescriptor, setDeleteDescriptor] = useState<BlockDescriptorV1>();
  const fileInput = useRef<HTMLInputElement>(null);
  const descriptorText = (descriptor: BlockDescriptorV1) => `${JSON.stringify(descriptor, null, 2)}\n`;
  const beginDescriptorEdit = (descriptor: BlockDescriptorV1) => {
    const nextVersion = Math.max(...workspaceDescriptors.filter(item => item.id === descriptor.id).map(item => item.version)) + 1;
    setDescriptorReview({ text: descriptorText({ ...descriptor, version: nextVersion }), fileName: `${descriptor.id}.v${nextVersion}.json`, confirmLabel: 'Save new version' });
  };

  if (descriptorReview) return <BlockDescriptorModal initialText={descriptorReview.text} fileName={descriptorReview.fileName} readOnly={descriptorReview.readOnly} confirmLabel={descriptorReview.confirmLabel} existing={workspaceDescriptors} template={template} library={library} root={root} onClose={() => setDescriptorReview(undefined)} onSave={onSaveDescriptor} />;
  if (deleteDescriptor) return <div className="modal-backdrop block-modal-backdrop"><section className="confirmation-modal" role="alertdialog" aria-modal="true" aria-labelledby="descriptor-delete-title"><div className="eyebrow">Delete workspace block</div><h2 id="descriptor-delete-title">{deleteDescriptor.name} v{deleteDescriptor.version}</h2><p>This removes this descriptor version from the workspace library. Blocks already copied into templates remain unchanged.</p><p>This action cannot be undone.</p><div><button className="secondary" autoFocus onClick={() => setDeleteDescriptor(undefined)}>Cancel</button><button className="danger" onClick={async () => { await onDeleteDescriptor(deleteDescriptor); setDeleteDescriptor(undefined); }}>Delete version</button></div></section></div>;

  return <div className="modal-backdrop block-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="block-library-modal" role="dialog" aria-modal="true" aria-labelledby="block-library-title">
    <header><div><div className="eyebrow">Block library</div><h2 id="block-library-title">Add a block</h2><p>Choose an omakase block or import a reusable JSON definition for this workspace.</p></div><button aria-label="Close block library" onClick={onClose}>×</button></header>
    <div className="block-library-toolbar"><b>Workspace JSON blocks</b><button className="primary" onClick={() => fileInput.current?.click()}>＋ Import JSON</button><input ref={fileInput} hidden type="file" accept=".json,application/json" onChange={async event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) setDescriptorReview({ text: await file.text(), fileName: file.name }); }} /></div>
    {workspaceDescriptors.length ? <div className="block-choice-grid custom-choices workspace-descriptor-choices">{workspaceDescriptors.slice().sort((left, right) => left.name.localeCompare(right.name) || right.version - left.version).map(descriptor => <article className="block-choice" key={`${descriptor.id}@${descriptor.version}`}><ChoiceIcon icon={descriptor.icon ?? '◇'} /><div><b>{descriptor.name}</b><span>{descriptor.id} · v{descriptor.version} · {descriptor.block.type}</span></div><div className="block-choice-actions"><button className="text-button" onClick={() => setDescriptorReview({ text: descriptorText(descriptor), fileName: `${descriptor.id}.v${descriptor.version}.json`, readOnly: true })}>View JSON</button><button className="text-button" onClick={() => beginDescriptorEdit(descriptor)}>Edit</button><button className="danger-text" onClick={() => setDeleteDescriptor(descriptor)}>Delete</button><button className="secondary" onClick={() => onUseDescriptor(descriptor)}>Add</button></div></article>)}</div> : <div className="block-library-empty">Import a JSON descriptor to add a versioned workspace block. It will be validated and previewed before it is saved.</div>}
    <div className="block-library-toolbar built-in-heading"><b>Pre-packaged blocks</b><span className="descriptor-source-note">Loaded from JSON descriptors</span></div>
    <div className="block-choice-grid">{prepackagedBlockDescriptors.map(descriptor => <article className="block-choice built-in-choice" key={`${descriptor.id}@${descriptor.version}`}><ChoiceIcon icon={descriptor.icon} /><span><b>{descriptor.name}</b><small>{descriptor.description}</small></span><div className="block-choice-actions"><button className="text-button" onClick={() => setDescriptorReview({ text: descriptorText(descriptor), fileName: `${descriptor.id}.json`, readOnly: true })}>View JSON</button><button className="secondary" onClick={() => onUsePrepackaged(descriptor)}>Add</button></div></article>)}</div>
  </section></div>;
}
