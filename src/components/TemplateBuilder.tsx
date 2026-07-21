import { useState } from 'react';
import type { BulletinBlock, TemplateV1 } from '../shared/types';

export function TemplateBuilder({ template, onChange, onSave, onDelete, canDelete }: { template: TemplateV1; onChange(value: TemplateV1): void; onSave(publish: boolean): Promise<void>; onDelete(): void; canDelete: boolean }) {
  const [saveStatus, setSaveStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const updateTheme = (key: keyof TemplateV1['theme'], value: string | number) => onChange({ ...template, status: 'draft', theme: { ...template.theme, [key]: value } });
  const move = (index: number, by: number) => { const blocks = [...template.starterBlocks]; const target = index + by; if (target < 0 || target >= blocks.length) return; [blocks[index], blocks[target]] = [blocks[target], blocks[index]]; onChange({ ...template, status: 'draft', starterBlocks: blocks }); };
  const add = (type: BulletinBlock['type']) => {
    const id = `${type}-${Date.now()}`;
    const block: BulletinBlock = type === 'heading' || type === 'sectionHeading'
      ? { id, type, text: 'New heading' }
      : type === 'richText' ? { id, type, content: [{ type: 'paragraph', children: [{ type: 'text', text: 'New text' }] }] }
      : type === 'spacer' ? { id, type, size: 'medium' }
      : type === 'scriptureReading' ? { id, type, reference: '', translation: 'NIV', label: 'Reading', weeklyEditable: true }
      : type === 'song' ? { id, type, songType: 'hymn', libraryItemId: '', selection: { mode: 'all' }, renderMode: 'lyrics', label: 'Hymn', weeklyEditable: true }
      : type === 'responsiveReading' ? { id, type, entries: [{ reader: 'M', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'New response' }] }] }] }
      : type === 'libraryText' ? { id, type, libraryItemId: '', title: 'Reusable text', weeklyEditable: true }
      : type === 'announcements' ? { id, type, items: [], weeklyEditable: true }
      : type === 'churchInfo' ? { id, type }
      : { id, type: 'copyright' };
    onChange({ ...template, status: 'draft', starterBlocks: [...template.starterBlocks, block] });
  };
  const updateBlock = (id: string, changes: Partial<BulletinBlock>) => onChange({ ...template, status: 'draft', starterBlocks: template.starterBlocks.map(block => block.id === id ? { ...block, ...changes } as BulletinBlock : block) });
  const save = async (publish: boolean) => {
    setSaving(true); setSaveStatus(publish ? 'Publishing…' : 'Saving draft…');
    try { await onSave(publish); setSaveStatus(publish ? 'New version published' : 'Draft saved'); }
    catch { setSaveStatus(publish ? 'Could not publish' : 'Could not save draft'); }
    finally { setSaving(false); }
  };
  return <div className="builder-layout"><div className="builder-panel"><div className="eyebrow">Template builder</div><h1>{template.name}</h1><p className="lead">Shape the reusable service without placing individual text boxes.</p><div className="builder-actions"><button className="secondary" disabled={saving} onClick={() => save(false)}>Save draft</button><button className="primary" disabled={saving} onClick={() => save(true)}>Publish new version</button><button className="danger-text" disabled={saving || !canDelete} title={canDelete ? 'Delete this template version' : 'A workspace must keep at least one template'} onClick={() => void onDelete()}>Delete version</button>{saveStatus && <span className="template-save-status" role="status" aria-live="polite">{saveStatus}</span>}</div><section className="editor-card"><h2>Theme</h2><label>Body font<input value={template.theme.bodyFont} onChange={e => updateTheme('bodyFont', e.target.value)} /></label><label>Display font<input value={template.theme.displayFont} onChange={e => updateTheme('displayFont', e.target.value)} /></label><div className="field-row"><label>Accent<input type="color" value={template.theme.accent} onChange={e => updateTheme('accent', e.target.value)} /></label><label>Body size (points)<input type="number" min="8" max="14" step="0.5" value={template.theme.bodySizePt} onChange={e => { if (Number.isFinite(e.currentTarget.valueAsNumber)) updateTheme('bodySizePt', e.currentTarget.valueAsNumber); }} /></label></div><label>Page margin (inches)<input type="number" min="0.2" max="1.25" step="0.05" value={template.theme.marginIn} onChange={e => { if (Number.isFinite(e.currentTarget.valueAsNumber)) updateTheme('marginIn', e.currentTarget.valueAsNumber); }} /><small className="field-help">Applies to all four sides. The PDF print dialog should use no additional margins.</small></label></section><section className="editor-card"><div className="editor-section-title"><h2>Starter outline</h2><select value="" onChange={e => { if (e.target.value) add(e.target.value as BulletinBlock['type']); }}><option value="">＋ Add block</option><option value="heading">Heading</option><option value="sectionHeading">Section heading</option><option value="richText">Text</option><option value="responsiveReading">Responsive reading</option><option value="scriptureReading">Scripture reading</option><option value="song">Song or hymn</option><option value="libraryText">Reusable library text</option><option value="announcements">Announcements</option><option value="churchInfo">Church information page</option><option value="spacer">Spacer</option><option value="copyright">Copyright</option></select></div><ol className="outline">{template.starterBlocks.map((block, index) => <li key={block.id}><div className="outline-main"><b>{block.label ?? ('text' in block ? block.text : block.type)}</b><small>{block.type}</small><label className="check"><input type="checkbox" checked={block.weeklyEditable ?? false} onChange={e => updateBlock(block.id, { weeklyEditable: e.target.checked })} />Editable each week</label></div><div className="reorder"><button onClick={() => move(index, -1)}>↑</button><button onClick={() => move(index, 1)}>↓</button><button className="danger-text" onClick={() => onChange({ ...template, status: 'draft', starterBlocks: template.starterBlocks.filter(item => item.id !== block.id) })}>×</button></div></li>)}</ol></section></div></div>;
}
