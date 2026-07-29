import { useState } from 'react';
import { BlockLibraryModal } from './BlockLibraryModal';
import { BlockFormattingModal } from './BlockFormattingModal';
import { customBlockIssues } from '../shared/customBlocks';
import { instantiateComponentDefinition } from '../componentDefinitions';
import { childBlocks, findBlock, updateBlockTree } from '../shared/blocks';
import { scriptureElementNames } from '../shared/scriptureReading';
import type { DeclarativeComponentDefinition } from '../component-engine/types';
import type { BulletinBlock, LibraryManifestV1, TemplateV1 } from '../shared/types';
import { CanvasCoverDesigner } from './CanvasCoverDesigner';
import { createBulletin } from '../shared/defaults';
import { SortableHandle, SortableItem, SortableList } from './SortableList';

const contentText = (block: Extract<BulletinBlock, { type: 'richText' }>) => block.content.map(paragraph => paragraph.children.map(child => child.type === 'text' ? child.text : child.type === 'lineBreak' ? '\n' : '✠').join('')).join('\n\n');
const textContent = (value: string) => value.split(/\n\s*\n/).map(text => ({ type: 'paragraph' as const, children: [{ type: 'text' as const, text: text.replace(/\n/g, ' ') }] }));

export function TemplateBuilder({ template, workspaceDefinitions, library, root, onChange, onDefinitionsChange, onSave, onDeleteVersion, onDeleteTemplate, canDeleteVersion, canDeleteTemplate }: {
  template: TemplateV1;
  workspaceDefinitions: DeclarativeComponentDefinition[];
  library?: LibraryManifestV1;
  root?: string;
  onChange(value: TemplateV1): void;
  onDefinitionsChange(value: DeclarativeComponentDefinition[]): Promise<void>;
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
  const [canvasBlockId, setCanvasBlockId] = useState<string>();
  const toggleEditor = (id: string) => setEditingBlockIds(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const updateTemplate = (changes: Partial<TemplateV1>) => onChange({ ...template, ...changes, status: 'draft' });
  const blockTitle = (block: BulletinBlock) => block.type === 'custom' ? block.name : block.type === 'canvasCover' ? 'Canvas cover' : block.type === 'paragraph' ? contentText((childBlocks(block)?.find(child => child.type === 'richText' && child.role === 'header') as Extract<BulletinBlock, { type: 'richText' }> | undefined) ?? { id: '', type: 'richText', content: [] }) || 'Paragraph' : block.type === 'richText' && block.scriptureRole ? scriptureElementNames[block.scriptureRole] : block.type === 'richText' && block.role ? (block.role === 'header' ? 'Header text' : 'Paragraph text') : block.label ?? ('text' in block ? block.text : block.type);
  const updateTheme = (key: keyof TemplateV1['theme'], value: string | number) => updateTemplate({ theme: { ...template.theme, [key]: value } });
  const addBlock = (block: BulletinBlock) => { updateTemplate({ starterBlocks: [...template.starterBlocks, block] }); setBlockLibraryOpen(false); };
  const updateBlock = (id: string, changes: Partial<BulletinBlock>) => { const block = findBlock(template.starterBlocks, id); if (block) updateTemplate({ starterBlocks: updateBlockTree(template.starterBlocks, id, { ...block, ...changes } as BulletinBlock) }); };
  const blockOptions = (block: BulletinBlock) => block.type === 'scriptureReading'
    ? <div className="outline-options"><label className="outline-option">Heading and reference<select value={block.headingReferenceLayout ?? 'inline'} onChange={event => updateBlock(block.id, { headingReferenceLayout: event.target.value as 'inline' | 'stacked' })}><option value="inline">Same line</option><option value="stacked">Stacked</option></select></label><label className="outline-option">Space (inches)<input type="number" min="0" max="2" step="0.01" disabled={(block.headingReferenceLayout ?? 'inline') !== 'inline'} value={block.headingReferenceGapIn ?? 0.12} onChange={event => { if (Number.isFinite(event.currentTarget.valueAsNumber)) updateBlock(block.id, { headingReferenceGapIn: Math.max(0, event.currentTarget.valueAsNumber) }); }} /></label></div>
    : null;
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
    <div className="builder-actions"><button className="secondary" disabled={saving} onClick={() => save(false)}>Save draft</button><button className="primary" disabled={saving} onClick={() => save(true)}>Publish new version</button><button className="danger-text" disabled={saving || !canDeleteVersion} title={canDeleteVersion ? 'Archive only the selected version' : 'A workspace must keep at least one template version'} onClick={() => void onDeleteVersion()}>Archive version</button><button className="danger-text" disabled={saving || !canDeleteTemplate} title={canDeleteTemplate ? 'Archive this template and every version' : 'A workspace must keep at least one template'} onClick={() => void onDeleteTemplate()}>Archive template</button>{saveStatus && <span className="template-save-status" role="status" aria-live="polite">{saveStatus}</span>}</div>
    <section className="editor-card"><h2>Theme</h2><label>Body font<input value={template.theme.bodyFont} onChange={event => updateTheme('bodyFont', event.target.value)} /></label><label>Display font<input value={template.theme.displayFont} onChange={event => updateTheme('displayFont', event.target.value)} /></label><div className="field-row"><label>Accent<input type="color" value={template.theme.accent} onChange={event => updateTheme('accent', event.target.value)} /></label><label>Body size (points)<input type="number" min="8" max="14" step="0.5" value={template.theme.bodySizePt} onChange={event => { if (Number.isFinite(event.currentTarget.valueAsNumber)) updateTheme('bodySizePt', event.currentTarget.valueAsNumber); }} /></label></div></section>
    <details className="editor-card collapsible-editor page-setup-card"><summary><div><span className="block-type">Document</span><h3>Page setup</h3></div><small>{template.theme.marginIn} in margins</small></summary><div className="collapsible-editor-fields"><p className="helper">Physical page: 7 × 8.5 inches. These defaults apply to every bulletin created from this template.</p><label>Page margin (inches)<input type="number" min="0" max="1.25" step="0.05" value={template.theme.marginIn} onChange={event => { if (Number.isFinite(event.currentTarget.valueAsNumber)) updateTheme('marginIn', event.currentTarget.valueAsNumber); }} /><small className="field-help">Applies to all four sides. The PDF print dialog should use no additional margins.</small></label></div></details>
    <section className="editor-card"><div className="editor-section-title"><div><h2>Starter outline</h2><small>{template.starterBlocks.length} blocks</small></div><button className="primary" onClick={() => setBlockLibraryOpen(true)}>＋ Add block</button></div><ol className="outline"><SortableList items={template.starterBlocks} onChange={starterBlocks => updateTemplate({ starterBlocks })}>{template.starterBlocks.map(block => <SortableItem id={block.id} key={block.id}><li className={childBlocks(block) ? 'outline-container' : undefined} data-editor-block-id={block.id} tabIndex={-1}><div className="outline-main"><b>{blockTitle(block)}</b><small>{block.type === 'custom' ? 'Church block' : block.type}{block.presentation ? ' · Formatted' : ''}</small><label className="check"><input type="checkbox" checked={block.weeklyEditable ?? false} onChange={event => updateBlock(block.id, { weeklyEditable: event.target.checked })} />Editable each week</label>{blockOptions(block)}</div><div className="reorder">{block.type === 'canvasCover' ? <button className="format-block-button" title="Design cover" onClick={() => setCanvasBlockId(block.id)}>Design</button> : <button className="format-block-button" title="Format block" onClick={() => setFormattingBlockId(block.id)}>Format</button>}<button className="danger-text" title="Remove block" onClick={() => updateTemplate({ starterBlocks: template.starterBlocks.filter(item => item.id !== block.id) })}>×</button><SortableHandle label={`Drag ${blockTitle(block)} to reorder`} /></div>{nestedOutline(block)}</li></SortableItem>)}</SortableList></ol></section>
  </div>{blockLibraryOpen && <BlockLibraryModal workspaceDefinitions={workspaceDefinitions} template={template} library={library} root={root} onClose={() => setBlockLibraryOpen(false)} onUsePrepackaged={definition => addBlock(instantiateComponentDefinition(definition))} onUseDefinition={definition => addBlock(instantiateComponentDefinition(definition))} onSaveDefinition={async definition => onDefinitionsChange([...workspaceDefinitions, definition])} onDeleteDefinition={async definition => onDefinitionsChange(workspaceDefinitions.filter(item => item.type !== definition.type || item.version !== definition.version))} />}{formattingBlockId && (() => { const block = findBlock(template.starterBlocks, formattingBlockId); return block ? <BlockFormattingModal block={block} template={template} scope="template" onClose={() => setFormattingBlockId(undefined)} onSave={(presentation, layout) => { updateBlock(block.id, { presentation, layout }); setFormattingBlockId(undefined); }} /> : null; })()}{canvasBlockId && (() => { const block = findBlock(template.starterBlocks, canvasBlockId); return block?.type === 'canvasCover' ? <CanvasCoverDesigner block={block} document={createBulletin(template)} mode="template" marginIn={template.theme.marginIn} assets={{}} root={root} onChooseAsset={async () => root && window.bulletin ? window.bulletin.importAsset(root, 'assets/covers') : null} onChange={next => updateBlock(next.id, next)} onClose={() => setCanvasBlockId(undefined)} /> : null; })()}</div>;
}
