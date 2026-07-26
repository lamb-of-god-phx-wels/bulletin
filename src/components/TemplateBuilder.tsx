import { useState } from 'react';
import { BlockLibraryModal } from './BlockLibraryModal';
import { BlockFormattingModal } from './BlockFormattingModal';
import { customBlockIssues } from '../shared/customBlocks';
import { instantiateBlockDescriptor } from '../prepackagedBlocks';
import { childBlocks, findBlock, updateBlockTree } from '../shared/blocks';
import { scriptureElementNames } from '../shared/scriptureReading';
import type { BlockDescriptorV1, BulletinBlock, LibraryManifestV1, TemplateV1 } from '../shared/types';

const contentText = (block: Extract<BulletinBlock, { type: 'richText' }>) => block.content.map(paragraph => paragraph.children.map(child => child.type === 'text' ? child.text : child.type === 'lineBreak' ? '\n' : '✠').join('')).join('\n\n');
const textContent = (value: string) => value.split(/\n\s*\n/).map(text => ({ type: 'paragraph' as const, children: [{ type: 'text' as const, text: text.replace(/\n/g, ' ') }] }));

export function TemplateBuilder({ template, workspaceDescriptors, library, root, onChange, onDescriptorsChange, onSave, onDeleteVersion, onDeleteTemplate, canDeleteVersion, canDeleteTemplate }: {
  template: TemplateV1;
  workspaceDescriptors: BlockDescriptorV1[];
  library?: LibraryManifestV1;
  root?: string;
  onChange(value: TemplateV1): void;
  onDescriptorsChange(value: BlockDescriptorV1[]): Promise<void>;
  onSave(publish: boolean): Promise<void>;
  onDeleteVersion(): void;
  onDeleteTemplate(): void;
  canDeleteVersion: boolean;
  canDeleteTemplate: boolean;
}) {
  const [saveStatus, setSaveStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [blockLibraryOpen, setBlockLibraryOpen] = useState(false);
  const [formattingBlockId, setFormattingBlockId] = useState<string>();
  const [editingBlockIds, setEditingBlockIds] = useState<Set<string>>(() => new Set());
  const toggleEditor = (id: string) => setEditingBlockIds(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const updateTemplate = (changes: Partial<TemplateV1>) => onChange({ ...template, ...changes, status: 'draft' });
  const blockTitle = (block: BulletinBlock) => block.type === 'custom' ? block.name : block.type === 'paragraph' ? contentText((childBlocks(block)?.find(child => child.type === 'richText' && child.role === 'header') as Extract<BulletinBlock, { type: 'richText' }> | undefined) ?? { id: '', type: 'richText', content: [] }) || 'Paragraph' : block.type === 'richText' && block.scriptureRole ? scriptureElementNames[block.scriptureRole] : block.type === 'richText' && block.role ? (block.role === 'header' ? 'Header text' : 'Paragraph text') : block.label ?? ('text' in block ? block.text : block.type);
  const updateTheme = (key: keyof TemplateV1['theme'], value: string | number) => updateTemplate({ theme: { ...template.theme, [key]: value } });
  const move = (index: number, by: number) => {
    const blocks = [...template.starterBlocks]; const target = index + by;
    if (target < 0 || target >= blocks.length) return;
    [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
    updateTemplate({ starterBlocks: blocks });
  };
  const addBlock = (block: BulletinBlock) => { updateTemplate({ starterBlocks: [...template.starterBlocks, block] }); setBlockLibraryOpen(false); };
  const updateBlock = (id: string, changes: Partial<BulletinBlock>) => { const block = findBlock(template.starterBlocks, id); if (block) updateTemplate({ starterBlocks: updateBlockTree(template.starterBlocks, id, { ...block, ...changes } as BulletinBlock) }); };
  const nestedOutline = (parent: BulletinBlock): React.ReactNode => childBlocks(parent) && <ol className="nested-outline">{childBlocks(parent)!.map(child => <li className={childBlocks(child) ? 'outline-container' : undefined} data-editor-block-id={child.id} tabIndex={-1} key={child.id}><div className="outline-main"><b>{blockTitle(child)}</b><small>{child.type} · Nested element{child.presentation ? ' · Formatted' : ''}</small>{child.type === 'richText' && !child.scriptureRole && editingBlockIds.has(child.id) && <textarea className="outline-text-editor" autoFocus rows={child.role === 'header' ? 2 : 3} aria-label={`Edit ${blockTitle(child)}`} value={contentText(child)} onChange={event => updateBlock(child.id, { content: textContent(event.target.value) })} />}</div><div className="reorder">{child.type === 'richText' && !child.scriptureRole && <button className="edit-content-button" aria-expanded={editingBlockIds.has(child.id)} onClick={() => toggleEditor(child.id)}>{editingBlockIds.has(child.id) ? 'Done' : 'Edit'}</button>}<button className="format-block-button" onClick={() => setFormattingBlockId(child.id)}>Format</button></div>{nestedOutline(child)}</li>)}</ol>;
  const save = async (publish: boolean) => {
    const customIssues = template.starterBlocks.flatMap(block => block.type === 'custom' ? customBlockIssues(block) : []);
    if (publish && customIssues.length) { setSaveStatus(`Fix ${customIssues.length} custom block ${customIssues.length === 1 ? 'issue' : 'issues'} before publishing`); return; }
    setSaving(true); setSaveStatus(publish ? 'Publishing…' : 'Saving draft…');
    try { await onSave(publish); setSaveStatus(publish ? 'New version published' : 'Draft saved'); }
    catch { setSaveStatus(publish ? 'Could not publish' : 'Could not save draft'); }
    finally { setSaving(false); }
  };
  return <div className="builder-layout"><div className="builder-panel">
    <div className="eyebrow">Template builder</div><h1>{template.name}</h1><p className="lead">Arrange pre-packaged and workspace JSON blocks into a reusable service.</p>
    <div className="builder-actions"><button className="secondary" disabled={saving} onClick={() => save(false)}>Save draft</button><button className="primary" disabled={saving} onClick={() => save(true)}>Publish new version</button><button className="danger-text" disabled={saving || !canDeleteVersion} title={canDeleteVersion ? 'Delete only the selected version' : 'A workspace must keep at least one template version'} onClick={() => void onDeleteVersion()}>Delete version</button><button className="danger-text" disabled={saving || !canDeleteTemplate} title={canDeleteTemplate ? 'Delete this template and every version' : 'A workspace must keep at least one template'} onClick={() => void onDeleteTemplate()}>Delete template</button>{saveStatus && <span className="template-save-status" role="status" aria-live="polite">{saveStatus}</span>}</div>
    <section className="editor-card"><h2>Theme</h2><label>Body font<input value={template.theme.bodyFont} onChange={event => updateTheme('bodyFont', event.target.value)} /></label><label>Display font<input value={template.theme.displayFont} onChange={event => updateTheme('displayFont', event.target.value)} /></label><div className="field-row"><label>Accent<input type="color" value={template.theme.accent} onChange={event => updateTheme('accent', event.target.value)} /></label><label>Body size (points)<input type="number" min="8" max="14" step="0.5" value={template.theme.bodySizePt} onChange={event => { if (Number.isFinite(event.currentTarget.valueAsNumber)) updateTheme('bodySizePt', event.currentTarget.valueAsNumber); }} /></label></div><label>Page margin (inches)<input type="number" min="0" max="1.25" step="0.05" value={template.theme.marginIn} onChange={event => { if (Number.isFinite(event.currentTarget.valueAsNumber)) updateTheme('marginIn', event.currentTarget.valueAsNumber); }} /><small className="field-help">Applies to all four sides. The PDF print dialog should use no additional margins.</small></label></section>
    <section className="editor-card"><div className="editor-section-title"><div><h2>Starter outline</h2><small>{template.starterBlocks.length} blocks</small></div><button className="primary" onClick={() => setBlockLibraryOpen(true)}>＋ Add block</button></div><ol className="outline">{template.starterBlocks.map((block, index) => <li className={childBlocks(block) ? 'outline-container' : undefined} data-editor-block-id={block.id} tabIndex={-1} key={block.id}><div className="outline-main"><b>{blockTitle(block)}</b><small>{block.type === 'custom' ? 'Church block' : block.type}{block.presentation ? ' · Formatted' : ''}</small><label className="check"><input type="checkbox" checked={block.weeklyEditable ?? false} onChange={event => updateBlock(block.id, { weeklyEditable: event.target.checked })} />Editable each week</label></div><div className="reorder"><button className="format-block-button" title="Format block" onClick={() => setFormattingBlockId(block.id)}>Format</button><button title="Move up" onClick={() => move(index, -1)}>↑</button><button title="Move down" onClick={() => move(index, 1)}>↓</button><button className="danger-text" title="Remove block" onClick={() => updateTemplate({ starterBlocks: template.starterBlocks.filter(item => item.id !== block.id) })}>×</button></div>{nestedOutline(block)}</li>)}</ol></section>
  </div>{blockLibraryOpen && <BlockLibraryModal workspaceDescriptors={workspaceDescriptors} template={template} library={library} root={root} onClose={() => setBlockLibraryOpen(false)} onUsePrepackaged={descriptor => addBlock(instantiateBlockDescriptor(descriptor))} onUseDescriptor={descriptor => addBlock(instantiateBlockDescriptor(descriptor))} onSaveDescriptor={async descriptor => onDescriptorsChange([...workspaceDescriptors, descriptor])} onDeleteDescriptor={async descriptor => onDescriptorsChange(workspaceDescriptors.filter(item => item.id !== descriptor.id || item.version !== descriptor.version))} />}{formattingBlockId && (() => { const block = findBlock(template.starterBlocks, formattingBlockId); return block ? <BlockFormattingModal block={block} template={template} scope="template" onClose={() => setFormattingBlockId(undefined)} onSave={(presentation, layout) => { updateBlock(block.id, { presentation, layout }); setFormattingBlockId(undefined); }} /> : null; })()}</div>;
}
