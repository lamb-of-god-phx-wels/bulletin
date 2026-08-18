import { useRef, useState } from 'react';
import {
  prepackagedComponentDefinitions
} from '../componentDefinitions';
import type { DeclarativeComponentDefinition } from '../component-engine/types';
import type { LibraryManifestV1, PageTemplateV1, TemplateV1 } from '../shared/types';
import { ComponentDefinitionModal } from './ComponentDefinitionModal';
import { LibraryBrowserDialog } from './LibraryBrowserDialog';
import { libraryCatalogRecords } from '../shared/libraryCatalog';

function ChoiceIcon({ icon = 'T' }: { icon?: string }) {
  return <span className="block-choice-icon">{icon}</span>;
}

export function BlockLibraryModal({ workspaceDefinitions, pageTemplates = [], template, library, root, excludedComponentTypes = [], onClose, onUsePageTemplate, onUsePrepackaged, onUseDefinition, onSaveDefinition, onDeleteDefinition }: {
  workspaceDefinitions: DeclarativeComponentDefinition[];
  pageTemplates?: PageTemplateV1[];
  template: TemplateV1;
  library?: LibraryManifestV1;
  root?: string;
  excludedComponentTypes?: string[];
  onClose(): void;
  onUsePageTemplate?(pageTemplate: PageTemplateV1): void;
  onUsePrepackaged(definition: DeclarativeComponentDefinition): void;
  onUseDefinition(definition: DeclarativeComponentDefinition): void;
  onSaveDefinition(definition: DeclarativeComponentDefinition): Promise<void>;
  onDeleteDefinition(definition: DeclarativeComponentDefinition): Promise<void>;
}) {
  const [review, setReview] = useState<{ text: string; fileName?: string; readOnly?: boolean; confirmLabel?: string }>();
  const [pendingDelete, setPendingDelete] = useState<DeclarativeComponentDefinition>();
  const [managing, setManaging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const excludedTypes = new Set([...excludedComponentTypes, 'bulletin:sectionHeading']);
  const availableWorkspaceDefinitions = workspaceDefinitions.filter(definition => !excludedTypes.has(definition.type));
  const availablePrepackagedDefinitions = prepackagedComponentDefinitions.filter(definition => !excludedTypes.has(definition.type));
  const availableLibrary = library ? { ...library, componentDefinitions: library.componentDefinitions?.filter(definition => !excludedTypes.has(definition.type)) } : library;
  const definitionText = (definition: DeclarativeComponentDefinition) => `${JSON.stringify(definition, null, 2)}\n`;
  const fileStem = (definition: DeclarativeComponentDefinition) => definition.type.replace(':', '-');
  const beginEdit = (definition: DeclarativeComponentDefinition) => {
    const nextVersion = Math.max(...workspaceDefinitions.filter(item => item.type === definition.type).map(item => item.version)) + 1;
    setReview({
      text: definitionText({ ...definition, version: nextVersion }),
      fileName: `${fileStem(definition)}.v${nextVersion}.json`,
      confirmLabel: 'Save new version'
    });
  };

  if (review) return <ComponentDefinitionModal
    initialText={review.text}
    fileName={review.fileName}
    readOnly={review.readOnly}
    confirmLabel={review.confirmLabel}
    existing={workspaceDefinitions}
    template={template}
    library={library}
    root={root}
    onClose={() => setReview(undefined)}
    onSave={onSaveDefinition}
  />;
  if (pendingDelete) return <div className="modal-backdrop block-modal-backdrop"><section className="confirmation-modal" role="alertdialog" aria-modal="true" aria-labelledby="component-delete-title">
    <div className="eyebrow">Delete workspace component</div>
    <h2 id="component-delete-title">{pendingDelete.name} v{pendingDelete.version}</h2>
    <p>This removes this component version from the workspace library. Components already placed in templates remain unchanged.</p>
    <p>This action cannot be undone.</p>
    <div><button className="secondary" autoFocus onClick={() => setPendingDelete(undefined)}>Cancel</button><button className="danger" onClick={async () => { await onDeleteDefinition(pendingDelete); setPendingDelete(undefined); }}>Delete version</button></div>
  </section></div>;
  if (!managing) return <LibraryBrowserDialog
    library={availableLibrary ?? { schemaVersion: 1, name: 'Library', items: [] }}
    root={root ?? 'library'}
    records={libraryCatalogRecords(availableLibrary, pageTemplates.filter(page => page.status === 'published'), availablePrepackagedDefinitions)}
    title="Add a block or reusable page"
    allowedTypes={['component', 'page-template']}
    actions={<>
      <button className="secondary" onClick={() => setManaging(true)}>Manage component JSON</button>
      <button className="primary" onClick={() => fileInput.current?.click()}>＋ Import JSON</button>
      <input ref={fileInput} hidden type="file" accept=".json,application/json" onChange={async event => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) setReview({ text: await file.text(), fileName: file.name });
      }} />
    </>}
    onLibraryChange={async () => undefined}
    onClose={onClose}
    onSelect={record => {
      if (record.type === 'page-template') {
        const pages = record.value as PageTemplateV1[];
        const page = pages.find(item => item.status === 'published') ?? pages[0];
        if (page) onUsePageTemplate?.(page);
        return;
      }
      if (record.builtin) onUsePrepackaged(record.value as DeclarativeComponentDefinition);
      else {
        const versions = record.value as DeclarativeComponentDefinition[];
        if (versions[0]) onUseDefinition(versions[0]);
      }
    }}
  />;

  return <div className="modal-backdrop block-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="block-library-modal" role="dialog" aria-modal="true" aria-labelledby="block-library-title">
    <header><div><div className="eyebrow">Component library</div><h2 id="block-library-title">Manage component JSON</h2><p>Import, inspect, version, or delete workspace component definitions.</p></div><div><button className="secondary" onClick={() => setManaging(false)}>Back to browser</button><button aria-label="Close component library" onClick={onClose}>×</button></div></header>
    {pageTemplates.length > 0 && <><div className="block-library-toolbar"><b>Reusable pages</b><span className="descriptor-source-note">Pinned to the selected published version</span></div>
    <div className="block-choice-grid">{pageTemplates.filter(page => page.status === 'published').sort((left, right) => left.name.localeCompare(right.name)).map(page => <article className="block-choice" key={`${page.id}@${page.version}`}>
      <ChoiceIcon icon="▣" /><span><b>{page.name}</b><small>Page design · v{page.version} · {page.margin.mode === 'inherit' ? 'Host margins' : `${page.margin.marginIn} in margins`}</small></span>
      <div className="block-choice-actions"><button className="secondary" onClick={() => onUsePageTemplate?.(page)}>Insert page</button></div>
    </article>)}</div></>}
    <div className="block-library-toolbar"><b>Workspace JSON components</b><button className="primary" onClick={() => fileInput.current?.click()}>＋ Import JSON</button><input ref={fileInput} hidden type="file" accept=".json,application/json" onChange={async event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) setReview({ text: await file.text(), fileName: file.name }); }} /></div>
    {availableWorkspaceDefinitions.length ? <div className="block-choice-grid custom-choices workspace-descriptor-choices">{availableWorkspaceDefinitions.slice().sort((left, right) => left.name.localeCompare(right.name) || right.version - left.version).map(definition => <article className="block-choice" key={`${definition.type}@${definition.version}`}>
      <ChoiceIcon icon={definition.editor?.icon ?? '◇'} />
      <div><b>{definition.name}</b><span>{definition.type} · v{definition.version}</span></div>
      <div className="block-choice-actions"><button className="text-button" onClick={() => setReview({ text: definitionText(definition), fileName: `${fileStem(definition)}.v${definition.version}.json`, readOnly: true })}>View JSON</button><button className="text-button" onClick={() => beginEdit(definition)}>Edit</button><button className="danger-text" onClick={() => setPendingDelete(definition)}>Delete</button><button className="secondary" onClick={() => onUseDefinition(definition)}>Add</button></div>
    </article>)}</div> : <div className="block-library-empty">Import a component definition to add a versioned workspace component. It will be validated and previewed before it is saved.</div>}
    <div className="block-library-toolbar built-in-heading"><b>Pre-packaged components</b><span className="descriptor-source-note">Loaded from component-definitions/prepackaged</span></div>
    <div className="block-choice-grid">{availablePrepackagedDefinitions.map(definition => <article className="block-choice built-in-choice" key={`${definition.type}@${definition.version}`}>
      <ChoiceIcon icon={definition.editor?.icon} />
      <span><b>{definition.name}</b><small>{definition.description}</small></span>
      <div className="block-choice-actions"><button className="text-button" onClick={() => setReview({ text: definitionText(definition), fileName: `${fileStem(definition)}.json`, readOnly: true })}>View JSON</button><button className="secondary" onClick={() => onUsePrepackaged(definition)}>Add</button></div>
    </article>)}</div>
  </section></div>;
}
