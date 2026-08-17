import type { BulletinBlock, BulletinDocumentV1, LibraryManifestV1, ResponsiveReadingSettings, TemplateV1 } from '../shared/types';
import { childBlocks, createLayoutContainer, createTableCell, groupAcceptsChild, groupChildCell, moveGroupChildToCell, placeGroupChild, updateBlockTree, type LayoutCell } from '../shared/blocks';
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

const plain = (content: Extract<BulletinBlock, { type: 'richText' }>['content'] | undefined) =>
  content?.map(paragraph => paragraph.children.map(run => run.type === 'text' ? run.text : run.type === 'lineBreak' ? '\n' : '✠').join('')).join('\n\n') ?? '';

export function NativeBlockFields({ block, document, library, template, responsiveReadingSettings, scope, root, imageTargetFolder = 'assets/images', includeChildren = true, onLibraryChange, onError, onChange, onMoveOut }: {
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
}) {
  const [conditionChildId, setConditionChildId] = useState<string>();
  const [elementPickerOpen, setElementPickerOpen] = useState(false);
  const [elementPickerCell, setElementPickerCell] = useState<LayoutCell>();
  const [childImageOpen, setChildImageOpen] = useState(false);
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
    setElementPickerOpen(false);
    if (payload.kind !== 'image') setElementPickerCell(undefined);
  };
  return <div className="native-block-fields">
    {(block.type === 'heading' || block.type === 'sectionHeading' || block.type === 'sermonTitle') && <label>Text<RichTextEditor content={block.content ?? paragraphsFromPlainText(block.text)} label="Heading text" onChange={content => onChange({ ...block, text: plain(content), content })} /></label>}
    {block.type === 'richText' && <><RichTextBindingControl value={block.binding} template={template} library={library} root={root} onChange={binding => onChange({ ...block, binding, bindingOverride: undefined })} /><label>{block.binding ? 'Override' : 'Text'}<textarea rows={4} value={plain(boundRichTextParagraphs(block, document ?? createBulletin(template), template, library))} onChange={event => onChange(block.binding ? { ...block, bindingOverride: paragraphsFromPlainText(event.target.value) } : { ...block, content: paragraphsFromPlainText(event.target.value) })} /></label>{block.bindingOverride && <button className="text-button" onClick={() => onChange(resetBoundRichTextContent(block))}>Reset to bound value</button>}</>}
    {block.type === 'custom' && <><label>Block name<input value={block.name} onChange={event => onChange({ ...block, name: event.target.value })} /></label><label>Content<textarea rows={4} value={block.layoutText} onChange={event => onChange({ ...block, layoutText: event.target.value })} /></label></>}
    {block.type === 'scriptureReading' && <><label>Reference<input value={block.reference} onChange={event => onChange({ ...block, reference: event.target.value })} /></label><label>Caption<input value={block.caption ?? ''} onChange={event => onChange({ ...block, caption: event.target.value || undefined })} /></label></>}
    {block.type === 'song' && <SongBlockFields block={block} library={library} template={template} scope={scope} root={root} onChange={onChange} />}
    {block.type === 'libraryText' && <LibraryTextFields block={block} library={library} root={root} onChange={onChange} />}
    {block.type === 'spacer' && <label>Size<select value={block.size} onChange={event => onChange({ ...block, size: event.target.value as typeof block.size })}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>}
    {block.type === 'image' && <ImageBlockFields block={block} library={library} root={root} targetFolder={imageTargetFolder} onLibraryChange={onLibraryChange} onError={onError} onChange={onChange} />}
    {block.type === 'group' && <LayoutContainerFields block={block} onChange={onChange} onAdd={cell => { setElementPickerCell(cell); setElementPickerOpen(true); }} />}
    {block.type === 'copyright' && <CopyrightFields block={block} onChange={onChange} />}
    {block.type === 'announcements' && <AnnouncementFields block={block} library={library} root={root} targetFolder={`${imageTargetFolder}/announcements`} onLibraryChange={onLibraryChange} onError={onError} onChange={onChange} />}
    {block.type === 'list' && <ListFields block={block} library={library} root={root} targetFolder={`${imageTargetFolder}/lists`} onLibraryChange={onLibraryChange} onError={onError} onChange={onChange} />}
    {block.type === 'responsiveReading' && <ResponsiveReadingFields block={block} settings={readerSettings} template={template} onChange={onChange} />}
    {includeChildren && (() => {
      const children = childBlocks(block);
      if (!children) return null;
      const cards = children.map(child => {
        const card = <div className="page-native-child" data-editor-block-id={child.id} data-layout-container={child.type === 'group' ? 'true' : undefined}><div className="page-native-child-heading"><small>{child.label ?? ('text' in child ? child.text : child.type)}</small><button className={`text-button condition-toggle ${child.condition ? 'condition-active' : ''}`} aria-pressed={Boolean(child.condition)} onClick={() => setConditionChildId(child.id)}>Condition</button>{block.type === 'group' && block.layoutMode !== 'table' && <><button className="danger-text" aria-label={`Remove ${child.label ?? child.type}`} onClick={() => onChange({ ...block, children: block.children.filter(item => item.id !== child.id) })}>×</button><SortableHandle label={`Drag ${child.label ?? child.type}`} /></>}</div><NativeBlockFields block={child} document={document} library={library} template={template} responsiveReadingSettings={readerSettings} scope={scope} root={root} imageTargetFolder={imageTargetFolder} onLibraryChange={onLibraryChange} onError={onError} onChange={updateChild} onMoveOut={onMoveOut} /></div>;
        return block.type === 'group' ? <SortableItem id={child.id} key={child.id}>{card}</SortableItem> : <div key={child.id}>{card}</div>;
      });
      if (block.type !== 'group') return cards;
      const grid = (block.layoutMode ?? 'stack') !== 'stack' ? { rows: Math.max(1, block.rows ?? 2), columns: Math.max(1, block.columns ?? 2), containerId: block.id, cells: Object.fromEntries(block.children.map((child, index) => [child.id, groupChildCell(block, child, index)])), onMove: (id: string, cell: LayoutCell) => onChange(moveGroupChildToCell(block, id, cell)), onAdd: (cell: LayoutCell) => block.layoutMode === 'table' ? onChange(placeGroupChild(block, createTableCell(`text-${randomId()}`), cell)) : (setElementPickerCell(cell), setElementPickerOpen(true)) } : undefined;
      return <SortableList items={block.children} onChange={children => onChange({ ...block, children })} grid={grid} onMoveOut={onMoveOut ? (id, targetId, position) => { onMoveOut(block.id, id, targetId, position); return true; } : undefined}>{cards}</SortableList>;
    })()}
    {conditionChildId && (() => { const child = childBlocks(block)?.find(item => item.id === conditionChildId); return child ? <ConditionModal value={child.condition} template={template} onClose={() => setConditionChildId(undefined)} onSave={condition => { updateChild({ ...child, condition } as BulletinBlock); setConditionChildId(undefined); }} /> : null; })()}
    {elementPickerOpen && <ElementPickerDialog items={flowElementPaletteItems(library?.componentDefinitions ?? [], false).filter(item => block.type !== 'group' || block.layoutMode !== 'table' || (item.payload as ElementPalettePayload).kind === 'component' && (item.payload as Extract<ElementPalettePayload, { kind: 'component' }>).definition.type === 'bulletin:text')} onSelect={chooseGroupElement} onClose={() => { setElementPickerOpen(false); setElementPickerCell(undefined); }} />}
    {childImageOpen && root && <ImageAssetDialog library={library} root={root} targetFolder={imageTargetFolder} onLibraryChange={onLibraryChange} onError={onError} onClose={() => { setChildImageOpen(false); setElementPickerCell(undefined); }} onSelect={asset => { addGroupChild({ id: `image-${randomId()}`, type: 'image', asset, alt: asset.alt, fit: 'contain', heightIn: 2.5 }); setChildImageOpen(false); setElementPickerCell(undefined); }} />}
  </div>;
}
