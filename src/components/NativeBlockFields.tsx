import type { BulletinBlock, BulletinDocumentV1, CustomPropertyDefinition, CustomPropertyValue, LibraryManifestV1, ResponsiveReadingSettings, TemplateV1 } from '../shared/types';
import { childBlocks, createElementChooser, createLayoutContainer, flattenBlocks, groupAcceptsChild, groupChildCell, moveGroupChildToCell, placeGroupChild, updateBlockTree, type LayoutCell } from '../shared/blocks';
import { paragraphsFromPlainText } from '../shared/plainText';
import { SongBlockFields } from './SongBlockFields';
import { ImageBlockFields } from './ImageBlockFields';
import { LibraryTextFields } from './LibraryTextFields';
import { AnnouncementFields } from './AnnouncementFields';
import { ListFields } from './ListFields';
import { CopyrightFields } from './CopyrightFields';
import { ResponsiveReadingFields } from './ResponsiveReadingFields';
import { effectiveResponsiveReadingSettings } from '../shared/responsiveReading';
import { RichTextEditor } from './RichTextEditor';
import { RichTextBindingControl } from './RichTextBindingControl';
import { boundRichTextParagraphs, resetBoundRichTextContent } from '../shared/canvas';
import { createBulletin } from '../shared/defaults';
import { ConditionModal } from './ConditionModal';
import { useState } from 'react';
import { ElementPickerDialog } from './ElementPickerDialog';
import { flowElementPaletteItems, type ElementPalettePayload } from './elementPaletteCatalog';
import type { ElementPaletteItem } from './ElementPalette';
import { instantiateComponentDefinition } from '../componentDefinitions';
import { randomId } from '../shared/id';
import { ImageAssetDialog } from './ImageAssetDialog';
import { LayoutContainerFields } from './LayoutContainerFields';
import { SortableHandle, SortableItem, SortableList } from './SortableList';
import { HeadingFields } from './HeadingFields';
import { effectiveCustomPropertyValue } from '../shared/customProperties';
import { blockDisplayName } from '../shared/blockNames';
import { EditableElementName } from './EditableElementName';
import { useDroppable } from '@dnd-kit/core';

const plain = (content: Extract<BulletinBlock, { type: 'richText' }>['content'] | undefined) =>
  content?.map(paragraph => paragraph.children.map(run => run.type === 'text' ? run.text : run.type === 'lineBreak' ? '\n' : '✠').join('')).join('\n\n') ?? '';

function EmptyChooserSlot({ chooserId, choiceId, onAdd }: { chooserId: string; choiceId: string; onAdd(): void }) {
  const dropId = `__chooser-option__:${chooserId}:${choiceId}`;
  const droppable = useDroppable({ id: dropId });
  return <button type="button" ref={droppable.setNodeRef} className={`sortable-grid-cell empty chooser-empty-slot ${droppable.isOver ? 'active' : ''}`} data-editor-block-id={dropId} data-layout-container="true" data-layout-cell="true" data-layout-container-id={chooserId} data-layout-row="1" data-layout-column="1" onClick={onAdd}><span>This option has no element.</span><b>＋ Add element</b></button>;
}

export function NativeBlockFields({ block, document, library, template, responsiveReadingSettings, scope, root, imageTargetFolder = 'assets/images', includeChildren = true, onLibraryChange, onError, onChange, onMoveOut, onChooserChange, onFormatBlock, onRequestElement }: {
  block: BulletinBlock;
  document?: BulletinDocumentV1;
  library?: LibraryManifestV1;
  template: TemplateV1;
  responsiveReadingSettings?: ResponsiveReadingSettings;
  scope: 'template' | 'weekly';
  root?: string;
  imageTargetFolder?: string;
  includeChildren?: boolean;
  onLibraryChange?(library: LibraryManifestV1, alreadySaved?: boolean): Promise<void>;
  onError?(message: string): void;
  onChange(block: BulletinBlock): void;
  onMoveOut?(parentId: string, childId: string, targetId?: string, position?: 'before' | 'after'): void;
  onChooserChange?(block: Extract<BulletinBlock, { type: 'elementChooser' }>, property: CustomPropertyDefinition, selectedValue?: CustomPropertyValue, additionalProperties?: CustomPropertyDefinition[], removePropertyIds?: string[]): void;
  onFormatBlock?(blockId: string): void;
  onRequestElement?(item: ElementPaletteItem, parentId: string, cell?: LayoutCell, chooserChoiceId?: string): void;
}) {
  const [conditionChildId, setConditionChildId] = useState<string>();
  const [elementPickerOpen, setElementPickerOpen] = useState(false);
  const [elementPickerCell, setElementPickerCell] = useState<LayoutCell>();
  const [childImageOpen, setChildImageOpen] = useState(false);
  const [chooserPickerOpen, setChooserPickerOpen] = useState(false);
  const [chooserPickerTargetChoiceId, setChooserPickerTargetChoiceId] = useState<string>();
  const [chooserImageOpen, setChooserImageOpen] = useState(false);
  const [chooserSetupOpen, setChooserSetupOpen] = useState(() => block.type === 'elementChooser' && block.choices.length === 0 && /^Element choice(?: \d+)?$/.test(block.property.propertyName));
  const [chooserSetupName, setChooserSetupName] = useState(() => block.type === 'elementChooser' ? block.property.propertyName : 'Element choice');
  const [optionSetupOpen, setOptionSetupOpen] = useState(false);
  const [optionSetupName, setOptionSetupName] = useState('Option 1');
  const readerSettings = responsiveReadingSettings ?? effectiveResponsiveReadingSettings(template);
  const updateChild = (next: BulletinBlock) => onChange(updateBlockTree([block], next.id, next)[0]);
  const addGroupChild = (child: BulletinBlock) => {
    if (block.type === 'group') onChange(placeGroupChild(block, child, elementPickerCell));
  };
  const chooseGroupElement = (item: ElementPaletteItem) => {
    const payload = item.payload as ElementPalettePayload;
    if (payload.kind === 'component') {
      const child = instantiateComponentDefinition(payload.definition);
      if (block.type === 'group' && groupAcceptsChild(block, child)) addGroupChild(child);
    }
    else if (payload.kind === 'container') addGroupChild(createLayoutContainer(payload.layoutMode, `container-${randomId()}`));
    else if (payload.kind === 'image') setChildImageOpen(true);
    else onRequestElement?.(item, block.id, elementPickerCell);
    setElementPickerOpen(false);
    if (payload.kind !== 'image') setElementPickerCell(undefined);
  };
  const chooserProperty = block.type === 'elementChooser' ? template.customProperties?.find(property => property.id === block.property.propertyId) : undefined;
  const chooserValue = block.type === 'elementChooser' && chooserProperty
    ? String(scope === 'weekly' && document ? effectiveCustomPropertyValue(chooserProperty.id, template, document) ?? chooserProperty.defaultValue : chooserProperty.defaultValue)
    : '';
  const selectedChoice = block.type === 'elementChooser' ? block.choices.find(choice => choice.id === chooserValue) ?? block.choices[0] : undefined;
  const changeChooser = (next: Extract<BulletinBlock, { type: 'elementChooser' }>, property: CustomPropertyDefinition, selectedValue?: string, additionalProperties?: CustomPropertyDefinition[], removePropertyIds?: string[]) => onChooserChange?.(next, property, selectedValue, additionalProperties, removePropertyIds);
  const managedPropertiesIn = (child?: BulletinBlock) => child ? flattenBlocks([child]).flatMap(item => item.type === 'elementChooser' ? [item.property.propertyId] : []) : [];
  const addChooserBlock = (child: BulletinBlock, additionalProperties?: CustomPropertyDefinition[]) => {
    if (block.type !== 'elementChooser' || !chooserProperty) return;
    const id = `choice-${randomId()}`;
    const name = `Option ${block.choices.length + 1}`;
    const nextProperty = { ...chooserProperty, options: [...(chooserProperty.options ?? []), { id, label: name }], defaultValue: chooserProperty.defaultValue || id };
    changeChooser({ ...block, choices: [...block.choices, { id, name, block: child }] }, nextProperty, id, additionalProperties);
  };
  const addEmptyChooserOption = (name: string) => {
    if (block.type !== 'elementChooser' || !chooserProperty) return;
    const id = `choice-${randomId()}`;
    changeChooser({ ...block, choices: [...block.choices, { id, name }] }, { ...chooserProperty, options: [...(chooserProperty.options ?? []), { id, label: name }], defaultValue: chooserProperty.defaultValue || id }, id);
  };
  const beginAddChooserOption = () => {
    if (block.type !== 'elementChooser') return;
    const names = new Set(block.choices.map(choice => choice.name.trim().toLocaleLowerCase()));
    let suffix = block.choices.length + 1;
    while (names.has(`option ${suffix}`)) suffix += 1;
    setOptionSetupName(`Option ${suffix}`);
    setOptionSetupOpen(true);
  };
  const putChooserBlock = (child: BulletinBlock, additionalProperties?: CustomPropertyDefinition[]) => {
    if (block.type !== 'elementChooser' || !chooserProperty) return;
    if (!chooserPickerTargetChoiceId) { addChooserBlock(child, additionalProperties); return; }
    const replaced = block.choices.find(choice => choice.id === chooserPickerTargetChoiceId)?.block;
    changeChooser({ ...block, choices: block.choices.map(choice => choice.id === chooserPickerTargetChoiceId ? { ...choice, block: child } : choice) }, chooserProperty, undefined, additionalProperties, managedPropertiesIn(replaced));
  };
  const chooseChooserElement = (item: ElementPaletteItem) => {
    const payload = item.payload as ElementPalettePayload;
    if (payload.kind === 'component') putChooserBlock(instantiateComponentDefinition(payload.definition) as BulletinBlock);
    else if (payload.kind === 'container') putChooserBlock(createLayoutContainer(payload.layoutMode, `container-${randomId()}`));
    else if (payload.kind === 'elementChooser') { const created = createElementChooser(template.customProperties ?? []); putChooserBlock(created.block, [created.property]); }
    else if (payload.kind === 'image') setChooserImageOpen(true);
    else if (chooserPickerTargetChoiceId) onRequestElement?.(item, block.id, undefined, chooserPickerTargetChoiceId);
    setChooserPickerOpen(false);
    if (payload.kind !== 'image') setChooserPickerTargetChoiceId(undefined);
  };
  return <div className="native-block-fields">
    {(block.type === 'heading' || block.type === 'sectionHeading') && <HeadingFields block={block} onChange={onChange} />}
    {block.type === 'sermonTitle' && <label>Text<RichTextEditor content={block.content ?? paragraphsFromPlainText(block.text)} label="Heading text" onChange={content => onChange({ ...block, text: plain(content), content })} /></label>}
    {block.type === 'richText' && <><RichTextBindingControl value={block.binding} template={template} library={library} root={root} onChange={binding => onChange({ ...block, binding, bindingOverride: undefined })} /><label>{block.binding ? 'Override' : 'Text'}<textarea rows={4} value={plain(boundRichTextParagraphs(block, document ?? createBulletin(template), template, library))} onChange={event => onChange(block.binding ? { ...block, bindingOverride: paragraphsFromPlainText(event.target.value) } : { ...block, content: paragraphsFromPlainText(event.target.value) })} /></label>{block.bindingOverride && <button className="text-button" onClick={() => onChange(resetBoundRichTextContent(block))}>Reset to bound value</button>}</>}
    {block.type === 'custom' && <><label>Block name<input value={block.name} onChange={event => onChange({ ...block, name: event.target.value })} /></label><label>Content<textarea rows={4} value={block.layoutText} onChange={event => onChange({ ...block, layoutText: event.target.value })} /></label></>}
    {block.type === 'scriptureReading' && <><label>Reference<input value={block.reference} onChange={event => onChange({ ...block, reference: event.target.value })} /></label><label>Caption<input value={block.caption ?? ''} onChange={event => onChange({ ...block, caption: event.target.value || undefined })} /></label></>}
    {block.type === 'song' && <SongBlockFields block={block} library={library} template={template} scope={scope} root={root} onChange={onChange} />}
    {block.type === 'libraryText' && <LibraryTextFields block={block} library={library} root={root} onChange={onChange} />}
    {block.type === 'spacer' && <label>Size<select value={block.size} onChange={event => onChange({ ...block, size: event.target.value as typeof block.size })}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>}
    {block.type === 'image' && <ImageBlockFields block={block} library={library} root={root} targetFolder={imageTargetFolder} onLibraryChange={onLibraryChange} onError={onError} onChange={onChange} />}
    {block.type === 'group' && <LayoutContainerFields block={block} onChange={onChange} />}
    {block.type === 'elementChooser' && chooserProperty && <div className="element-chooser-fields">
      <label>Selector name<input value={chooserProperty.name} onChange={event => { const property = { ...chooserProperty, name: event.target.value }; changeChooser({ ...block, property: { ...block.property, propertyName: property.name } }, property); }} /></label>
      {block.choices.length ? <><label>Selection<select value={selectedChoice?.id ?? ''} onChange={event => { const value = event.target.value; changeChooser(block, { ...chooserProperty, ...(scope === 'template' ? { defaultValue: value } : {}) }, value); }}>{block.choices.map(choice => <option value={choice.id} key={choice.id}>{choice.name}</option>)}</select></label>{selectedChoice && <div className="element-chooser-choice-controls"><label>Option name<input value={selectedChoice.name} onChange={event => { const name = event.target.value; changeChooser({ ...block, choices: block.choices.map(choice => choice.id === selectedChoice.id ? { ...choice, name } : choice) }, { ...chooserProperty, options: chooserProperty.options?.map(option => option.id === selectedChoice.id ? { ...option, label: name } : option) }); }} /></label><button className="danger-text" title="Delete option" aria-label={`Delete option ${selectedChoice.name}`} onClick={() => { const index = block.choices.findIndex(choice => choice.id === selectedChoice.id); const choices = block.choices.filter(choice => choice.id !== selectedChoice.id); const fallback = choices[index]?.id ?? choices[index - 1]?.id ?? ''; changeChooser({ ...block, choices }, { ...chooserProperty, options: chooserProperty.options?.filter(option => option.id !== selectedChoice.id), defaultValue: chooserProperty.defaultValue === selectedChoice.id ? fallback : chooserProperty.defaultValue }, fallback); }}>×</button></div>}
      {selectedChoice && (selectedChoice.block ? <div className="sortable-grid-cell occupied chooser-element-cell"><details className="nested-block-editor collapsible-editor" data-editor-block-id={selectedChoice.block.id} data-layout-container={selectedChoice.block.type === 'group' ? 'true' : undefined}><summary><div><span className="block-type">{selectedChoice.block.type}{selectedChoice.block.presentation ? ' · formatted' : ''}</span><EditableElementName as="b" value={blockDisplayName(selectedChoice.block)} onRename={displayName => changeChooser({ ...block, choices: block.choices.map(choice => choice.id === selectedChoice.id && choice.block ? { ...choice, block: { ...choice.block, displayName } as BulletinBlock } : choice) }, chooserProperty)} /></div><div className="reorder" onClick={event => event.preventDefault()}><button className={`format-block-button condition-toggle ${selectedChoice.block.condition ? 'condition-active' : ''}`} aria-pressed={Boolean(selectedChoice.block.condition)} title="Set conditional visibility" onClick={() => setConditionChildId(selectedChoice.block!.id)}>Condition</button>{onFormatBlock && <button className="format-block-button format-action" onClick={() => onFormatBlock(selectedChoice.block!.id)}>Format</button>}<button className="danger-text" title="Remove element" aria-label={`Remove ${blockDisplayName(selectedChoice.block)}`} onClick={() => changeChooser({ ...block, choices: block.choices.map(choice => { if (choice.id !== selectedChoice.id) return choice; const { block: _removed, ...empty } = choice; return empty; }) }, chooserProperty, undefined, undefined, managedPropertiesIn(selectedChoice.block))}>×</button></div></summary><div className="collapsible-editor-fields"><NativeBlockFields block={selectedChoice.block} document={document} library={library} template={template} responsiveReadingSettings={readerSettings} scope={scope} root={root} imageTargetFolder={imageTargetFolder} onLibraryChange={onLibraryChange} onError={onError} onChange={child => changeChooser({ ...block, choices: block.choices.map(choice => choice.id === selectedChoice.id ? { ...choice, block: child } : choice) }, chooserProperty)} onChooserChange={onChooserChange} onFormatBlock={onFormatBlock} onRequestElement={onRequestElement} /></div></details></div> : <EmptyChooserSlot chooserId={block.id} choiceId={selectedChoice.id} onAdd={() => { setChooserPickerTargetChoiceId(selectedChoice.id); setChooserPickerOpen(true); }} />)}</> : <p className="helper">No options yet. Add an option to begin.</p>}
      <button className="secondary" onClick={beginAddChooserOption}>＋ Add option</button>
    </div>}
    {block.type === 'copyright' && <CopyrightFields block={block} onChange={onChange} />}
    {block.type === 'announcements' && <AnnouncementFields block={block} library={library} root={root} targetFolder={`${imageTargetFolder}/announcements`} onLibraryChange={onLibraryChange} onError={onError} onChange={onChange} />}
    {block.type === 'list' && <ListFields block={block} library={library} root={root} targetFolder={`${imageTargetFolder}/lists`} onLibraryChange={onLibraryChange} onError={onError} onChange={onChange} />}
    {block.type === 'responsiveReading' && <ResponsiveReadingFields block={block} settings={readerSettings} template={template} onChange={onChange} />}
    {includeChildren && (() => {
      if (block.type === 'elementChooser') return null;
      const children = childBlocks(block);
      if (!children) return null;
      const cards = children.map(child => {
        const card = <div className="page-native-child" data-editor-block-id={child.id} data-layout-container={child.type === 'group' ? 'true' : undefined}><div className="page-native-child-heading"><small>{child.label ?? ('text' in child ? child.text : child.type)}</small><button className={`text-button condition-toggle ${child.condition ? 'condition-active' : ''}`} aria-pressed={Boolean(child.condition)} onClick={() => setConditionChildId(child.id)}>Condition</button>{block.type === 'group' && <><button className="danger-text" aria-label={`Remove ${child.label ?? child.type}`} onClick={() => onChange({ ...block, children: block.children.filter(item => item.id !== child.id) })}>×</button><SortableHandle label={`Drag ${child.label ?? child.type}`} /></>}</div><NativeBlockFields block={child} document={document} library={library} template={template} responsiveReadingSettings={readerSettings} scope={scope} root={root} imageTargetFolder={imageTargetFolder} onLibraryChange={onLibraryChange} onError={onError} onChange={updateChild} onMoveOut={onMoveOut} onChooserChange={onChooserChange} onFormatBlock={onFormatBlock} onRequestElement={onRequestElement} /></div>;
        return block.type === 'group' ? <SortableItem id={child.id} key={child.id}>{card}</SortableItem> : <div key={child.id}>{card}</div>;
      });
      if (block.type !== 'group') return cards;
      const grid = { rows: Math.max(1, block.rows ?? 2), columns: Math.max(1, block.columns ?? 2), containerId: block.id, cells: Object.fromEntries(block.children.map((child, index) => [child.id, groupChildCell(block, child, index)])), onMove: (id: string, cell: LayoutCell) => onChange(moveGroupChildToCell(block, id, cell)), onAdd: (cell: LayoutCell) => { setElementPickerCell(cell); setElementPickerOpen(true); } };
      return <SortableList items={block.children} onChange={children => onChange({ ...block, children })} grid={grid} onMoveOut={onMoveOut ? (id, targetId, position) => { onMoveOut(block.id, id, targetId, position); return true; } : undefined}>{cards}</SortableList>;
    })()}
    {conditionChildId && (() => { const child = childBlocks(block)?.find(item => item.id === conditionChildId); return child ? <ConditionModal value={child.condition} template={template} onClose={() => setConditionChildId(undefined)} onSave={condition => { updateChild({ ...child, condition } as BulletinBlock); setConditionChildId(undefined); }} /> : null; })()}
    {elementPickerOpen && <ElementPickerDialog items={flowElementPaletteItems(library?.componentDefinitions ?? [], Boolean(onRequestElement))} onSelect={chooseGroupElement} onClose={() => { setElementPickerOpen(false); setElementPickerCell(undefined); }} />}
    {childImageOpen && root && <ImageAssetDialog library={library} root={root} targetFolder={imageTargetFolder} onLibraryChange={onLibraryChange} onError={onError} onClose={() => { setChildImageOpen(false); setElementPickerCell(undefined); }} onSelect={asset => { addGroupChild({ id: `image-${randomId()}`, type: 'image', asset, alt: asset.alt, fit: 'contain', heightIn: 2.5 }); setChildImageOpen(false); setElementPickerCell(undefined); }} />}
    {chooserPickerOpen && <ElementPickerDialog items={flowElementPaletteItems(library?.componentDefinitions ?? [], Boolean(onRequestElement))} title={chooserPickerTargetChoiceId ? 'Add element' : 'Add option'} onSelect={chooseChooserElement} onClose={() => { setChooserPickerOpen(false); setChooserPickerTargetChoiceId(undefined); }} />}
    {chooserImageOpen && root && <ImageAssetDialog library={library} root={root} targetFolder={imageTargetFolder} onLibraryChange={onLibraryChange} onError={onError} onClose={() => { setChooserImageOpen(false); setChooserPickerTargetChoiceId(undefined); }} onSelect={asset => { putChooserBlock({ id: `image-${randomId()}`, type: 'image', asset, alt: asset.alt, fit: 'contain', heightIn: 2.5 }); setChooserImageOpen(false); setChooserPickerTargetChoiceId(undefined); }} />}
    {chooserSetupOpen && block.type === 'elementChooser' && chooserProperty && <div className="modal-backdrop" role="presentation"><form className="library-create-type-dialog element-chooser-setup-dialog" role="dialog" aria-modal="true" aria-labelledby={`chooser-setup-${block.id}`} onSubmit={event => { event.preventDefault(); const name = chooserSetupName.trim(); if (!name) return; changeChooser({ ...block, property: { ...block.property, propertyName: name } }, { ...chooserProperty, name }); setChooserSetupOpen(false); }}><header><div><div className="eyebrow">Element Chooser</div><h3 id={`chooser-setup-${block.id}`}>Name the selector</h3></div></header><div className="element-chooser-setup-fields"><p className="helper">The selector name labels this choice wherever it appears, including the chooser editor and <i>This Sunday</i>.</p><label>Selector name<input autoFocus value={chooserSetupName} onChange={event => setChooserSetupName(event.target.value)} /></label></div><footer><button className="primary" type="submit" disabled={!chooserSetupName.trim()}>Continue</button></footer></form></div>}
    {optionSetupOpen && block.type === 'elementChooser' && <div className="modal-backdrop" role="presentation"><form className="library-create-type-dialog element-chooser-option-dialog" role="dialog" aria-modal="true" aria-labelledby={`chooser-option-${block.id}`} onSubmit={event => { event.preventDefault(); const name = optionSetupName.trim(); if (!name || block.choices.some(choice => choice.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) return; addEmptyChooserOption(name); setOptionSetupOpen(false); }}><header><div><div className="eyebrow">Element Chooser</div><h3 id={`chooser-option-${block.id}`}>Name the option</h3></div></header><div className="element-chooser-setup-fields"><p className="helper">The option name is shown as a choice in the selector dropdown.</p><label>Option name<input autoFocus value={optionSetupName} onChange={event => setOptionSetupName(event.target.value)} /></label></div><footer><button className="primary" type="submit" disabled={!optionSetupName.trim() || block.choices.some(choice => choice.name.trim().toLocaleLowerCase() === optionSetupName.trim().toLocaleLowerCase())}>Continue</button></footer></form></div>}
  </div>;
}
