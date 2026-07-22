import { useState } from 'react';
import { bindingKey, customBindingSources, customBlockDefinitionIssues, newCustomBlockDefinition } from '../shared/customBlocks';
import type { BulletinBlock, CustomBlockBinding, CustomBlockDefinitionV1, CustomBlockStyle } from '../shared/types';

export const builtInBlocks: Array<{ type: Exclude<BulletinBlock['type'], 'custom' | 'titlePage' | 'fullPageAsset' | 'sermonTitle'>; name: string; description: string }> = [
  { type: 'scriptureReading', name: 'Scripture reading', description: 'Reference, translation, introduction, and imported passage.' },
  { type: 'song', name: 'Song or hymn', description: 'Lyrics or a music image from the shared library.' },
  { type: 'heading', name: 'Heading', description: 'A simple heading within the service.' },
  { type: 'paragraph', name: 'Paragraph', description: 'Body text with an optional tightly coupled header.' },
  { type: 'sectionHeading', name: 'Section heading', description: 'A centered divider for a major service section.' },
  { type: 'richText', name: 'Text', description: 'Structured paragraph content.' },
  { type: 'responsiveReading', name: 'Responsive reading', description: 'Minister and congregation responses.' },
  { type: 'libraryText', name: 'Reusable library text', description: 'Approved text stored in the content library.' },
  { type: 'announcements', name: 'Announcements', description: 'A weekly list of announcements.' },
  { type: 'churchInfo', name: 'Church information page', description: 'The standard welcome and church information page.' },
  { type: 'spacer', name: 'Spacer', description: 'Controlled vertical space between blocks.' },
  { type: 'copyright', name: 'Copyright', description: 'Generated music and Scripture notices.' }
];

function ChoiceIcon({ type }: { type: string }) {
  return <span className="block-choice-icon">{type === 'scriptureReading' ? '¶' : type === 'song' ? '♫' : type === 'custom' ? '✦' : type === 'spacer' ? '↕' : 'T'}</span>;
}

export function BlockLibraryModal({ definitions, onClose, onAddBuiltIn, onUseDefinition, onSaveDefinition, onDeleteDefinition }: {
  definitions: CustomBlockDefinitionV1[];
  onClose(): void;
  onAddBuiltIn(type: BulletinBlock['type']): void;
  onUseDefinition(definition: CustomBlockDefinitionV1): void;
  onSaveDefinition(definition: CustomBlockDefinitionV1): Promise<void>;
  onDeleteDefinition(id: string): Promise<void>;
}) {
  const [designer, setDesigner] = useState<CustomBlockDefinitionV1>();
  if (designer) return <CustomBlockDesigner definition={designer} isNew={!definitions.some(item => item.id === designer.id)} onCancel={() => setDesigner(undefined)} onSave={async definition => { await onSaveDefinition(definition); setDesigner(undefined); }} onDelete={async id => { await onDeleteDefinition(id); setDesigner(undefined); }} />;
  return <div className="modal-backdrop block-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="block-library-modal" role="dialog" aria-modal="true" aria-labelledby="block-library-title">
    <header><div><div className="eyebrow">Block library</div><h2 id="block-library-title">Add a block</h2><p>Built-in and church-created blocks can be used anywhere in this template.</p></div><button aria-label="Close block library" onClick={onClose}>×</button></header>
    <div className="block-library-toolbar"><b>Church blocks</b><button className="primary" onClick={() => setDesigner(newCustomBlockDefinition())}>＋ Create custom block</button></div>
    {definitions.length ? <div className="block-choice-grid custom-choices">{definitions.map(definition => <article className="block-choice" key={definition.id}><ChoiceIcon type="custom" /><div><b>{definition.name}</b><span>{definition.bindings.filter(binding => binding.source === 'weekly').length} weekly field{definition.bindings.filter(binding => binding.source === 'weekly').length === 1 ? '' : 's'} · {definition.style.widthPercent}% wide</span></div><div className="block-choice-actions"><button className="text-button" onClick={() => setDesigner(structuredClone(definition))}>Edit</button><button className="secondary" onClick={() => onUseDefinition(definition)}>Add</button></div></article>)}</div> : <div className="block-library-empty">No custom blocks yet. Create one once, then reuse it in any template.</div>}
    <div className="block-library-toolbar built-in-heading"><b>Built-in blocks</b></div>
    <div className="block-choice-grid">{builtInBlocks.map(choice => <button className="block-choice built-in-choice" key={choice.type} onClick={() => onAddBuiltIn(choice.type)}><ChoiceIcon type={choice.type} /><span><b>{choice.name}</b><small>{choice.description}</small></span><strong>Add</strong></button>)}</div>
  </section></div>;
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange(value: T): void; label: string }) {
  return <fieldset className="segmented-field"><legend>{label}</legend><div>{options.map(option => <button type="button" className={value === option.value ? 'active' : ''} aria-pressed={value === option.value} key={option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}</div></fieldset>;
}

function NumberField({ label, value, min, max, step = .05, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange(value: number): void }) {
  return <label>{label}<input type="number" value={value} min={min} max={max} step={step} onChange={event => { if (Number.isFinite(event.currentTarget.valueAsNumber)) onChange(event.currentTarget.valueAsNumber); }} /></label>;
}

function CustomBlockDesigner({ definition: initial, isNew, onCancel, onSave, onDelete }: { definition: CustomBlockDefinitionV1; isNew: boolean; onCancel(): void; onSave(definition: CustomBlockDefinitionV1): Promise<void>; onDelete(id: string): Promise<void> }) {
  const [definition, setDefinition] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const issues = customBlockDefinitionIssues(definition);
  const change = (changes: Partial<CustomBlockDefinitionV1>) => setDefinition(current => ({ ...current, ...changes }));
  const style = (changes: Partial<CustomBlockStyle>) => change({ style: { ...definition.style, ...changes } });
  const padding = (side: keyof CustomBlockStyle['paddingIn'], value: number) => style({ paddingIn: { ...definition.style.paddingIn, [side]: value } });
  const margin = (side: keyof CustomBlockStyle['marginIn'], value: number) => style({ marginIn: { ...definition.style.marginIn, [side]: value } });
  const updateBinding = (index: number, changes: Partial<CustomBlockBinding>) => {
    const previous = definition.bindings[index]; const next = { ...previous, ...changes }; let layoutText = definition.layoutText;
    if (changes.key !== undefined && changes.key !== previous.key) { next.key = bindingKey(changes.key); layoutText = layoutText.replace(new RegExp(`{{\\s*${previous.key}\\s*}}`, 'g'), `{{${next.key}}}`); }
    change({ layoutText, bindings: definition.bindings.map((binding, bindingIndex) => bindingIndex === index ? next : binding) });
  };
  const addBinding = () => {
    let suffix = definition.bindings.length + 1; let key = `field${suffix}`;
    while (definition.bindings.some(binding => binding.key === key)) key = `field${++suffix}`;
    change({ bindings: [...definition.bindings, { key, label: `Field ${suffix}`, source: 'weekly' }], layoutText: `${definition.layoutText}${definition.layoutText ? '\n\n' : ''}{{${key}}}` });
  };
  const previewStyle = {
    width: `${definition.style.widthPercent}%`, marginLeft: definition.style.placement === 'center' ? 'auto' : definition.style.placement === 'right' ? 'auto' : 0, marginRight: definition.style.placement === 'center' || definition.style.placement === 'left' ? 'auto' : 0,
    textAlign: definition.style.textAlign, padding: `${definition.style.paddingIn.top * 48}px ${definition.style.paddingIn.right * 48}px ${definition.style.paddingIn.bottom * 48}px ${definition.style.paddingIn.left * 48}px`,
    fontFamily: definition.style.fontFamily === 'display' ? 'Georgia, serif' : definition.style.fontFamily === 'body' ? 'Arial, sans-serif' : definition.style.fontFamily,
    fontSize: `${definition.style.fontSizePt}px`, lineHeight: definition.style.lineHeight, fontWeight: definition.style.fontWeight, fontStyle: definition.style.fontStyle,
    fontVariant: definition.style.textTransform === 'small-caps' ? 'small-caps' : undefined, textTransform: definition.style.textTransform === 'uppercase' ? 'uppercase' : undefined,
    color: definition.style.color, background: definition.style.backgroundColor ?? 'transparent', border: definition.style.borderWidthPt ? `${definition.style.borderWidthPt}px solid ${definition.style.borderColor}` : 'none', borderRadius: `${definition.style.borderRadiusPt}px`
  } as React.CSSProperties;
  return <div className="modal-backdrop block-modal-backdrop"><section className="custom-block-designer" role="dialog" aria-modal="true" aria-labelledby="custom-designer-title">
    <header><div><div className="eyebrow">{isNew ? 'Create block' : 'Edit reusable block'}</div><h2 id="custom-designer-title">{definition.name}</h2></div><button aria-label="Close custom block designer" onClick={onCancel}>×</button></header>
    <div className="custom-designer-body"><main>
      <section className="designer-section"><h3>Identity and content</h3><div className="field-row"><label>Block name<input autoFocus value={definition.name} onChange={event => change({ name: event.target.value })} /></label><label className="check custom-heading-toggle"><input type="checkbox" checked={definition.showName} onChange={event => change({ showName: event.target.checked })} />Show name as a heading</label></div><label>Content layout<textarea rows={5} value={definition.layoutText} onChange={event => change({ layoutText: event.target.value })} /><small className="field-help">Insert fields with double braces, such as {'{{serviceTime}}'}. Blank lines create paragraphs.</small></label></section>
      <section className="designer-section"><div className="binding-heading"><div><h3>Data bindings</h3><p>Connect placeholders to weekly fields or bulletin information.</p></div><button className="secondary compact-button" onClick={addBinding}>＋ Add binding</button></div><div className="binding-list">{definition.bindings.map((binding, index) => <div className="binding-row" key={`${binding.key}-${index}`}><label>Field label<input value={binding.label} onChange={event => updateBinding(index, { label: event.target.value })} /></label><label>Placeholder<input value={binding.key} onChange={event => updateBinding(index, { key: event.target.value })} /><small>{`{{${binding.key}}}`}</small></label><label>Value source<select value={binding.source} onChange={event => updateBinding(index, { source: event.target.value as CustomBlockBinding['source'] })}>{customBindingSources.map(source => <option value={source.value} key={source.value}>{source.label}</option>)}</select></label><button className="danger-text binding-remove" onClick={() => change({ bindings: definition.bindings.filter((_binding, bindingIndex) => bindingIndex !== index) })}>Remove</button>{binding.source === 'weekly' && <><label className="binding-default">Default value{binding.multiline ? <textarea rows={2} value={binding.defaultValue ?? ''} onChange={event => updateBinding(index, { defaultValue: event.target.value })} /> : <input value={binding.defaultValue ?? ''} onChange={event => updateBinding(index, { defaultValue: event.target.value })} />}</label><label className="check binding-multiline"><input type="checkbox" checked={binding.multiline ?? false} onChange={event => updateBinding(index, { multiline: event.target.checked })} />Multi-line field</label></>}</div>)}</div></section>
    </main><aside className="appearance-panel">
      <section className="designer-preview"><span>Live preview</span><div><article style={previewStyle}>{definition.showName && <b>{definition.name || 'Block name'}</b>}<p>{definition.layoutText.replace(/{{\s*([^}]+)\s*}}/g, (_match, key) => definition.bindings.find(binding => binding.key === key.trim())?.defaultValue || `[${key.trim()}]`)}</p></article></div></section>
      <section className="appearance-section"><h3>Size and position</h3><NumberField label="Width (%)" value={definition.style.widthPercent} min={10} max={100} step={1} onChange={value => style({ widthPercent: value })} /><Segmented label="Place block" value={definition.style.placement} onChange={value => style({ placement: value })} options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }]} /><div className="four-side-fields"><NumberField label="Top padding (in)" value={definition.style.paddingIn.top} min={0} max={2} onChange={value => padding('top', value)} /><NumberField label="Right padding (in)" value={definition.style.paddingIn.right} min={0} max={2} onChange={value => padding('right', value)} /><NumberField label="Bottom padding (in)" value={definition.style.paddingIn.bottom} min={0} max={2} onChange={value => padding('bottom', value)} /><NumberField label="Left padding (in)" value={definition.style.paddingIn.left} min={0} max={2} onChange={value => padding('left', value)} /></div><div className="field-row"><NumberField label="Space before (in)" value={definition.style.marginIn.top} min={0} max={2} onChange={value => margin('top', value)} /><NumberField label="Space after (in)" value={definition.style.marginIn.bottom} min={0} max={2} onChange={value => margin('bottom', value)} /></div></section>
      <section className="appearance-section"><h3>Typography</h3><label>Font<select value={definition.style.fontFamily} onChange={event => style({ fontFamily: event.target.value })}><option value="body">Template body font</option><option value="display">Template display font</option><option value="Arial, sans-serif">Arial</option><option value="Georgia, serif">Georgia</option><option value="Times New Roman, serif">Times New Roman</option></select></label><div className="field-row"><NumberField label="Size (pt)" value={definition.style.fontSizePt} min={6} max={72} step={.5} onChange={value => style({ fontSizePt: value })} /><NumberField label="Line spacing" value={definition.style.lineHeight} min={.8} max={3} step={.05} onChange={value => style({ lineHeight: value })} /></div><Segmented label="Text alignment" value={definition.style.textAlign} onChange={value => style({ textAlign: value })} options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }, { value: 'justify', label: 'Justify' }]} /><div className="field-row"><label>Weight<select value={definition.style.fontWeight} onChange={event => style({ fontWeight: event.target.value as CustomBlockStyle['fontWeight'] })}><option value="normal">Regular</option><option value="bold">Bold</option></select></label><label>Style<select value={definition.style.fontStyle} onChange={event => style({ fontStyle: event.target.value as CustomBlockStyle['fontStyle'] })}><option value="normal">Regular</option><option value="italic">Italic</option></select></label></div><label>Capitalization<select value={definition.style.textTransform} onChange={event => style({ textTransform: event.target.value as CustomBlockStyle['textTransform'] })}><option value="none">Normal</option><option value="uppercase">Uppercase</option><option value="small-caps">Small caps</option></select></label></section>
      <section className="appearance-section"><h3>Fill and border</h3><div className="field-row"><label>Text color<input type="color" value={definition.style.color} onChange={event => style({ color: event.target.value })} /></label><label>Background<input type="color" value={definition.style.backgroundColor ?? '#ffffff'} onChange={event => style({ backgroundColor: event.target.value })} /></label></div><label className="check"><input type="checkbox" checked={!definition.style.backgroundColor} onChange={event => style({ backgroundColor: event.target.checked ? undefined : '#ffffff' })} />Transparent background</label><div className="field-row"><NumberField label="Border (pt)" value={definition.style.borderWidthPt} min={0} max={12} step={.5} onChange={value => style({ borderWidthPt: value })} /><NumberField label="Corner radius (pt)" value={definition.style.borderRadiusPt} min={0} max={36} step={1} onChange={value => style({ borderRadiusPt: value })} /></div><label>Border color<input type="color" value={definition.style.borderColor} onChange={event => style({ borderColor: event.target.value })} /></label></section>
    </aside></div>
    <footer><div>{!isNew && (confirmDelete ? <span className="delete-definition-confirm"><span>Existing template copies will remain.</span><button className="danger" onClick={() => void onDelete(definition.id)}>Delete reusable block</button><button className="text-button" onClick={() => setConfirmDelete(false)}>Cancel</button></span> : <button className="danger-text" onClick={() => setConfirmDelete(true)}>Delete from block library</button>)}</div><div>{issues.length > 0 && <span className="designer-issues">{issues[0]}</span>}<button className="secondary" onClick={onCancel}>Cancel</button><button className="primary" disabled={saving || issues.length > 0} onClick={async () => { setSaving(true); try { await onSave({ ...definition, updatedAt: new Date().toISOString() }); } finally { setSaving(false); } }}>{saving ? 'Saving…' : isNew ? 'Create block' : 'Save changes'}</button></div></footer>
  </section></div>;
}
