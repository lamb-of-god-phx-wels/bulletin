import { useState } from 'react';
import { BlockLibraryModal } from './BlockLibraryModal';
import { BlockFormattingModal } from './BlockFormattingModal';
import { customBlockDefinitionIssues, customBlockFromDefinition } from '../shared/customBlocks';
import type { BulletinBlock, CustomBlockDefinitionV1, TemplateV1 } from '../shared/types';

function builtInBlock(type: BulletinBlock['type']): BulletinBlock {
  const id = `${type}-${Date.now()}`;
  return type === 'heading' || type === 'sectionHeading'
    ? { id, type, text: 'New heading' }
    : type === 'richText' ? { id, type, content: [{ type: 'paragraph', children: [{ type: 'text', text: 'New text' }] }] }
    : type === 'spacer' ? { id, type, size: 'medium' }
    : type === 'scriptureReading' ? { id, type, reference: '', translation: 'NIV', label: 'Reading', weeklyEditable: true }
    : type === 'song' ? { id, type, songType: 'hymn', libraryItemId: '', selection: { mode: 'all' }, renderMode: 'lyrics', label: 'Hymn', weeklyEditable: true }
    : type === 'responsiveReading' ? { id, type, entries: [{ reader: 'M', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'New response' }] }] }] }
    : type === 'libraryText' ? { id, type, libraryItemId: '', title: 'Reusable text', weeklyEditable: true }
    : type === 'announcements' ? { id, type, items: [], weeklyEditable: true }
    : type === 'churchInfo' ? { id, type }
    : type === 'titlePage' ? { id, type, weeklyEditable: true }
    : type === 'fullPageAsset' ? { id, type, asset: { path: '', mediaType: 'image/png' } }
    : type === 'sermonTitle' ? { id, type, text: 'Sermon title', weeklyEditable: true }
    : type === 'custom' ? customBlockFromDefinition({ id: 'custom-block', name: 'Custom block', showName: true, layoutText: '{{text}}', bindings: [{ key: 'text', label: 'Text', source: 'weekly' }], style: { widthPercent: 100, placement: 'left', textAlign: 'left', paddingIn: { top: 0, right: 0, bottom: 0, left: 0 }, marginIn: { top: 0, bottom: .12 }, fontFamily: 'body', fontSizePt: 10, lineHeight: 1.28, fontWeight: 'normal', fontStyle: 'normal', textTransform: 'none', color: '#25302d', borderWidthPt: 0, borderColor: '#a44d2a', borderRadiusPt: 0 }, updatedAt: new Date().toISOString() })
    : { id, type: 'copyright' };
}

export function TemplateBuilder({ template, definitions, onChange, onDefinitionsChange, onSave, onDelete, canDelete }: {
  template: TemplateV1;
  definitions: CustomBlockDefinitionV1[];
  onChange(value: TemplateV1): void;
  onDefinitionsChange(value: CustomBlockDefinitionV1[]): Promise<void>;
  onSave(publish: boolean): Promise<void>;
  onDelete(): void;
  canDelete: boolean;
}) {
  const [saveStatus, setSaveStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [blockLibraryOpen, setBlockLibraryOpen] = useState(false);
  const [formattingBlockId, setFormattingBlockId] = useState<string>();
  const updateTemplate = (changes: Partial<TemplateV1>) => onChange({ ...template, ...changes, status: 'draft' });
  const updateTheme = (key: keyof TemplateV1['theme'], value: string | number) => updateTemplate({ theme: { ...template.theme, [key]: value } });
  const move = (index: number, by: number) => {
    const blocks = [...template.starterBlocks]; const target = index + by;
    if (target < 0 || target >= blocks.length) return;
    [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
    updateTemplate({ starterBlocks: blocks });
  };
  const addBlock = (block: BulletinBlock) => { updateTemplate({ starterBlocks: [...template.starterBlocks, block] }); setBlockLibraryOpen(false); };
  const updateBlock = (id: string, changes: Partial<BulletinBlock>) => updateTemplate({ starterBlocks: template.starterBlocks.map(block => block.id === id ? { ...block, ...changes } as BulletinBlock : block) });
  const saveDefinition = async (definition: CustomBlockDefinitionV1) => {
    const exists = definitions.some(item => item.id === definition.id);
    await onDefinitionsChange(exists ? definitions.map(item => item.id === definition.id ? definition : item) : [...definitions, definition]);
    if (exists) updateTemplate({ starterBlocks: template.starterBlocks.map(block => block.type === 'custom' && block.definitionId === definition.id ? { ...customBlockFromDefinition(definition), id: block.id, values: block.values, layout: block.layout } : block) });
  };
  const save = async (publish: boolean) => {
    const customIssues = template.starterBlocks.flatMap(block => block.type === 'custom' ? customBlockDefinitionIssues(block) : []);
    if (publish && customIssues.length) { setSaveStatus(`Fix ${customIssues.length} custom block ${customIssues.length === 1 ? 'issue' : 'issues'} before publishing`); return; }
    setSaving(true); setSaveStatus(publish ? 'Publishing…' : 'Saving draft…');
    try { await onSave(publish); setSaveStatus(publish ? 'New version published' : 'Draft saved'); }
    catch { setSaveStatus(publish ? 'Could not publish' : 'Could not save draft'); }
    finally { setSaving(false); }
  };
  return <div className="builder-layout"><div className="builder-panel">
    <div className="eyebrow">Template builder</div><h1>{template.name}</h1><p className="lead">Build the reusable service from built-in and church-created blocks.</p>
    <div className="builder-actions"><button className="secondary" disabled={saving} onClick={() => save(false)}>Save draft</button><button className="primary" disabled={saving} onClick={() => save(true)}>Publish new version</button><button className="danger-text" disabled={saving || !canDelete} title={canDelete ? 'Delete this template version' : 'A workspace must keep at least one template'} onClick={() => void onDelete()}>Delete version</button>{saveStatus && <span className="template-save-status" role="status" aria-live="polite">{saveStatus}</span>}</div>
    <section className="editor-card"><h2>Theme</h2><label>Body font<input value={template.theme.bodyFont} onChange={event => updateTheme('bodyFont', event.target.value)} /></label><label>Display font<input value={template.theme.displayFont} onChange={event => updateTheme('displayFont', event.target.value)} /></label><div className="field-row"><label>Accent<input type="color" value={template.theme.accent} onChange={event => updateTheme('accent', event.target.value)} /></label><label>Body size (points)<input type="number" min="8" max="14" step="0.5" value={template.theme.bodySizePt} onChange={event => { if (Number.isFinite(event.currentTarget.valueAsNumber)) updateTheme('bodySizePt', event.currentTarget.valueAsNumber); }} /></label></div><label>Page margin (inches)<input type="number" min="0" max="1.25" step="0.05" value={template.theme.marginIn} onChange={event => { if (Number.isFinite(event.currentTarget.valueAsNumber)) updateTheme('marginIn', event.currentTarget.valueAsNumber); }} /><small className="field-help">Applies to all four sides. The PDF print dialog should use no additional margins.</small></label></section>
    <section className="editor-card"><div className="editor-section-title"><div><h2>Starter outline</h2><small>{template.starterBlocks.length} blocks</small></div><button className="primary" onClick={() => setBlockLibraryOpen(true)}>＋ Add block</button></div><ol className="outline">{template.starterBlocks.map((block, index) => <li key={block.id}><div className="outline-main"><b>{block.type === 'custom' ? block.name : block.label ?? ('text' in block ? block.text : block.type)}</b><small>{block.type === 'custom' ? 'Church block' : block.type}{block.presentation ? ' · Formatted' : ''}</small><label className="check"><input type="checkbox" checked={block.weeklyEditable ?? false} onChange={event => updateBlock(block.id, { weeklyEditable: event.target.checked })} />Editable each week</label></div><div className="reorder"><button className="format-block-button" title="Format block" onClick={() => setFormattingBlockId(block.id)}>Format</button><button title="Move up" onClick={() => move(index, -1)}>↑</button><button title="Move down" onClick={() => move(index, 1)}>↓</button><button className="danger-text" title="Remove block" onClick={() => updateTemplate({ starterBlocks: template.starterBlocks.filter(item => item.id !== block.id) })}>×</button></div></li>)}</ol></section>
  </div>{blockLibraryOpen && <BlockLibraryModal definitions={definitions} onClose={() => setBlockLibraryOpen(false)} onAddBuiltIn={type => addBlock(builtInBlock(type))} onUseDefinition={definition => addBlock(customBlockFromDefinition(definition))} onSaveDefinition={saveDefinition} onDeleteDefinition={async id => onDefinitionsChange(definitions.filter(item => item.id !== id))} />}{formattingBlockId && (() => { const block = template.starterBlocks.find(item => item.id === formattingBlockId); return block ? <BlockFormattingModal block={block} template={template} scope="template" onClose={() => setFormattingBlockId(undefined)} onSave={(presentation, layout) => { updateBlock(block.id, { presentation, layout }); setFormattingBlockId(undefined); }} /> : null; })()}</div>;
}
