import type { BulletinBlock, BulletinDocumentV1, LibraryManifestV1, ResponsiveReadingSettings, TemplateV1 } from '../shared/types';
import { childBlocks, updateBlockTree } from '../shared/blocks';
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
import { boundRichTextParagraphs } from '../shared/canvas';
import { createBulletin } from '../shared/defaults';
import { ConditionModal } from './ConditionModal';

const plain = (content: Extract<BulletinBlock, { type: 'richText' }>['content'] | undefined) =>
  content?.map(paragraph => paragraph.children.map(run => run.type === 'text' ? run.text : run.type === 'lineBreak' ? '\n' : '✠').join('')).join('\n\n') ?? '';

export function NativeBlockFields({ block, document, library, template, responsiveReadingSettings, scope, root, imageTargetFolder = 'assets/images', onLibraryChange, onError, onChange }: {
  block: BulletinBlock;
  document?: BulletinDocumentV1;
  library?: LibraryManifestV1;
  template: TemplateV1;
  responsiveReadingSettings?: ResponsiveReadingSettings;
  scope: 'template' | 'weekly';
  root?: string;
  imageTargetFolder?: string;
  onLibraryChange?(library: LibraryManifestV1, alreadySaved?: boolean): Promise<void>;
  onError?(message: string): void;
  onChange(block: BulletinBlock): void;
}) {
  const [conditionChildId, setConditionChildId] = useState<string>();
  const readerSettings = responsiveReadingSettings ?? effectiveResponsiveReadingSettings(template);
  const updateChild = (next: BulletinBlock) => onChange(updateBlockTree([block], next.id, next)[0]);
  return <div className="native-block-fields">
    {(block.type === 'heading' || block.type === 'sectionHeading' || block.type === 'sermonTitle') && <label>Text<RichTextEditor content={block.content ?? paragraphsFromPlainText(block.text)} label="Heading text" onChange={content => onChange({ ...block, text: plain(content), content })} /></label>}
    {block.type === 'richText' && <><RichTextBindingControl value={block.binding} template={template} library={library} root={root} onChange={binding => onChange({ ...block, binding, bindingOverride: undefined })} /><label>{block.binding ? 'Override' : 'Text'}<textarea rows={4} value={plain(boundRichTextParagraphs(block, document ?? createBulletin(template), template, library))} onChange={event => onChange(block.binding ? { ...block, bindingOverride: paragraphsFromPlainText(event.target.value) } : { ...block, content: paragraphsFromPlainText(event.target.value) })} /></label>{block.bindingOverride && <button className="text-button" onClick={() => { const { bindingOverride: _override, ...next } = block; onChange(next); }}>Reset to bound value</button>}</>}
    {block.type === 'custom' && <><label>Block name<input value={block.name} onChange={event => onChange({ ...block, name: event.target.value })} /></label><label>Content<textarea rows={4} value={block.layoutText} onChange={event => onChange({ ...block, layoutText: event.target.value })} /></label></>}
    {block.type === 'scriptureReading' && <><label>Reference<input value={block.reference} onChange={event => onChange({ ...block, reference: event.target.value })} /></label><label>Caption<input value={block.caption ?? ''} onChange={event => onChange({ ...block, caption: event.target.value || undefined })} /></label></>}
    {block.type === 'song' && <SongBlockFields block={block} library={library} template={template} scope={scope} root={root} onChange={onChange} />}
    {block.type === 'libraryText' && <LibraryTextFields block={block} library={library} root={root} onChange={onChange} />}
    {block.type === 'spacer' && <label>Size<select value={block.size} onChange={event => onChange({ ...block, size: event.target.value as typeof block.size })}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>}
    {block.type === 'image' && <ImageBlockFields block={block} library={library} root={root} targetFolder={imageTargetFolder} onLibraryChange={onLibraryChange} onError={onError} onChange={onChange} />}
    {block.type === 'group' && <><div className="field-row container-options"><label>Layout<select value={block.layoutMode ?? 'stack'} onChange={event => onChange({ ...block, layoutMode: event.target.value as NonNullable<typeof block.layoutMode> })}><option value="stack">Stack</option><option value="grid">Grid</option><option value="table">Table</option></select></label>{(block.layoutMode ?? 'stack') !== 'stack' && <label>Columns<input type="number" min="1" max="12" value={block.columns ?? 2} onChange={event => onChange({ ...block, columns: Math.max(1, Math.min(12, event.currentTarget.valueAsNumber || 1)) })} /></label>}{(block.layoutMode ?? 'stack') !== 'table' && <label>Gap (in)<input type="number" min="0" max="2" step=".025" value={block.gapIn ?? .12} onChange={event => onChange({ ...block, gapIn: Math.max(0, event.currentTarget.valueAsNumber || 0) })} /></label>}</div><button className="secondary" onClick={() => onChange({ ...block, children: [...block.children, { id: `${block.id}-item-${Date.now()}`, type: 'paragraph', children: [{ id: `${block.id}-text-${Date.now()}`, type: 'richText', role: 'body', content: paragraphsFromPlainText('New item') }] }] })}>＋ Item</button></>}
    {block.type === 'copyright' && <CopyrightFields block={block} onChange={onChange} />}
    {block.type === 'announcements' && <AnnouncementFields block={block} library={library} root={root} targetFolder={`${imageTargetFolder}/announcements`} onLibraryChange={onLibraryChange} onError={onError} onChange={onChange} />}
    {block.type === 'list' && <ListFields block={block} library={library} root={root} targetFolder={`${imageTargetFolder}/lists`} onLibraryChange={onLibraryChange} onError={onError} onChange={onChange} />}
    {block.type === 'responsiveReading' && <ResponsiveReadingFields block={block} settings={readerSettings} template={template} onChange={onChange} />}
    {childBlocks(block)?.map(child => <div className="page-native-child" key={child.id}><div className="page-native-child-heading"><small>{child.label ?? ('text' in child ? child.text : child.type)}</small><button className={`text-button condition-toggle ${child.condition ? 'condition-active' : ''}`} aria-pressed={Boolean(child.condition)} onClick={() => setConditionChildId(child.id)}>Condition</button>{block.type === 'group' && <button className="danger-text" aria-label={`Remove ${child.label ?? child.type}`} onClick={() => onChange({ ...block, children: block.children.filter(item => item.id !== child.id) })}>×</button>}</div><NativeBlockFields block={child} document={document} library={library} template={template} responsiveReadingSettings={readerSettings} scope={scope} root={root} imageTargetFolder={imageTargetFolder} onLibraryChange={onLibraryChange} onError={onError} onChange={updateChild} /></div>)}
    {conditionChildId && (() => { const child = childBlocks(block)?.find(item => item.id === conditionChildId); return child ? <ConditionModal value={child.condition} template={template} onClose={() => setConditionChildId(undefined)} onSave={condition => { updateChild({ ...child, condition } as BulletinBlock); setConditionChildId(undefined); }} /> : null; })()}
  </div>;
}
import { useState } from 'react';
