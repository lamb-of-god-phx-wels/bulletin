import { useEffect, useState, type SetStateAction } from 'react';
import { childBlocks } from '../shared/blocks';
import { scriptureElementNames } from '../shared/scriptureReading';
import { songHeader } from '../shared/songs';
import type { BulletinBlock, BulletinDocumentV1, CustomBlockStyle, LayoutHints, LibraryManifestV1, TemplateV1 } from '../shared/types';
import { createBulletin } from '../shared/defaults';
import { effectiveBlockStyle } from './InlineTypographyControls';
import { NativeBlockPreview } from './DocumentView';
import { isRedoShortcut, isUndoShortcut, UndoRedoButtons, useUndoRedoHistory } from './useUndoRedo';

function NumberField({ label, value, min, max, step = .05, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange(value: number): void }) {
  return <label>{label}<input type="number" value={value} min={min} max={max} step={step} onChange={event => { if (Number.isFinite(event.currentTarget.valueAsNumber)) onChange(event.currentTarget.valueAsNumber); }} /></label>;
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange(value: T): void; label: string }) {
  return <fieldset className="segmented-field"><legend>{label}</legend><div>{options.map(option => <button type="button" className={value === option.value ? 'active' : ''} aria-pressed={value === option.value} key={option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}</div></fieldset>;
}

function displayName(block: BulletinBlock) {
  const headerBlock = block.type === 'paragraph'
    ? childBlocks(block)?.find(child => child.type === 'richText' && child.role === 'header')
    : undefined;
  const paragraphHeader = headerBlock?.type === 'richText'
    ? headerBlock.content.flatMap(paragraph => paragraph.children).map(child => child.type === 'text' ? child.text : child.type === 'lineBreak' ? '\n' : '✠').join('')
    : undefined;
  return block.type === 'custom' ? block.name : block.type === 'song' ? songHeader(block) : block.type === 'paragraph' ? paragraphHeader || 'Paragraph' : block.type === 'richText' && block.scriptureRole ? scriptureElementNames[block.scriptureRole] : block.type === 'richText' && block.role ? (block.role === 'header' ? 'Header text' : 'Paragraph text') : block.label ?? ('text' in block ? block.text : block.type);
}

export function BlockFormattingModal({ block, template, document, library, assets = {}, scope, name, hidePageFlow = false, onClose, onSave }: { block: BulletinBlock; template: TemplateV1; document?: BulletinDocumentV1; library?: LibraryManifestV1; assets?: Record<string, string>; scope: 'template' | 'weekly'; name?: string; hidePageFlow?: boolean; onClose(): void; onSave(presentation: Partial<CustomBlockStyle> | undefined, layout: LayoutHints | undefined): void }) {
  const baseline = effectiveBlockStyle(block, template);
  const [styleValue, setStyleValue] = useState(baseline);
  const [layout, setLayoutValue] = useState<LayoutHints>({ density: 'normal', ...block.layout });
  const history = useUndoRedoHistory<{ style: CustomBlockStyle; layout: LayoutHints }>();
  const record = () => history.record({ style: styleValue, layout });
  const style = (changes: Partial<CustomBlockStyle>) => {
    record();
    setStyleValue(current => ({ ...current, ...changes }));
  };
  const setLayout = (action: SetStateAction<LayoutHints>) => {
    record();
    setLayoutValue(action);
  };
  const applyHistory = (direction: 'undo' | 'redo') => {
    const current = { style: styleValue, layout };
    const next = direction === 'undo' ? history.undo(current) : history.redo(current);
    if (!next) return;
    setStyleValue(next.style);
    setLayoutValue(next.layout);
  };
  const commands = { canUndo: history.canUndo, canRedo: history.canRedo, undo: () => applyHistory('undo'), redo: () => applyHistory('redo') };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (isUndoShortcut(event)) {
        event.preventDefault();
        commands.undo();
      } else if (isRedoShortcut(event)) {
        event.preventDefault();
        commands.redo();
      }
    };
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  }, [styleValue, layout]);
  const padding = (side: keyof CustomBlockStyle['paddingIn'], value: number) => style({ paddingIn: { ...styleValue.paddingIn, [side]: value } });
  const margin = (side: keyof CustomBlockStyle['marginIn'], value: number) => style({ marginIn: { ...styleValue.marginIn, [side]: value } });
  const effectiveName = name ?? displayName(block);
  const previewDocument = document ?? createBulletin(template);
  const previewBlock = { ...block, presentation: styleValue, layout } as BulletinBlock;
  return <div className="modal-backdrop block-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="block-formatting-modal" role="dialog" aria-modal="true" aria-labelledby="format-block-title">
    <header><div><div className="eyebrow">{scope === 'weekly' ? 'This bulletin only' : 'Template formatting'}</div><h2 id="format-block-title">Format “{effectiveName}”</h2><p>{scope === 'weekly' ? 'Fine-tune this instance without changing the template.' : 'These settings become the baseline for every bulletin created from this template.'}</p></div><div className="builder-actions"><UndoRedoButtons history={commands} /><button aria-label="Close block formatting" onClick={onClose}>×</button></div></header>
    <div className="formatting-body"><aside><div className="format-preview-page"><div className="format-actual-preview"><NativeBlockPreview block={previewBlock} library={library} assets={assets} document={previewDocument} marginIn={template.theme.marginIn} /></div></div><div className="format-scope-note"><b>{scope === 'weekly' ? 'Weekly override' : 'Template default'}</b><span>{scope === 'weekly' ? 'Only this bulletin JSON will be changed.' : 'Existing bulletins remain unchanged.'}</span></div></aside><main>
      {!hidePageFlow && <section className="appearance-section"><h3>Page flow</h3><div className="format-checks"><label className="check"><input type="checkbox" checked={layout.pageBreakBefore ?? false} onChange={event => setLayout(current => ({ ...current, pageBreakBefore: event.target.checked }))} />Start on a new page</label><label className="check"><input type="checkbox" checked={layout.keepTogether ?? false} onChange={event => setLayout(current => ({ ...current, keepTogether: event.target.checked }))} />Keep block together</label></div><label>Content spacing<select value={layout.density ?? 'normal'} onChange={event => setLayout(current => ({ ...current, density: event.target.value as 'normal' | 'compact' }))}><option value="normal">Comfortable</option><option value="compact">Compact</option></select></label></section>}
      <section className="appearance-section"><h3>Size and position</h3><NumberField label="Width (%)" value={styleValue.widthPercent} min={10} max={100} step={1} onChange={value => style({ widthPercent: value })} /><Segmented label="Place block" value={styleValue.placement} onChange={value => style({ placement: value })} options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }]} /><div className="four-side-fields"><NumberField label="Top padding (in)" value={styleValue.paddingIn.top} min={0} max={2} onChange={value => padding('top', value)} /><NumberField label="Right padding (in)" value={styleValue.paddingIn.right} min={0} max={2} onChange={value => padding('right', value)} /><NumberField label="Bottom padding (in)" value={styleValue.paddingIn.bottom} min={0} max={2} onChange={value => padding('bottom', value)} /><NumberField label="Left padding (in)" value={styleValue.paddingIn.left} min={0} max={2} onChange={value => padding('left', value)} /></div><div className="field-row"><NumberField label="Space before (in)" value={styleValue.marginIn.top} min={0} max={2} onChange={value => margin('top', value)} /><NumberField label="Space after (in)" value={styleValue.marginIn.bottom} min={0} max={2} onChange={value => margin('bottom', value)} /></div></section>
      <section className="appearance-section"><h3>Typography</h3><label>Font<select value={styleValue.fontFamily} onChange={event => style({ fontFamily: event.target.value })}><option value="body">Template body font</option><option value="display">Template display font</option><option value="Arial, sans-serif">Arial</option><option value="Georgia, serif">Georgia</option><option value="Times New Roman, serif">Times New Roman</option></select></label><div className="field-row"><NumberField label="Size (pt)" value={styleValue.fontSizePt} min={6} max={72} step={.5} onChange={value => style({ fontSizePt: value })} /><NumberField label="Line spacing" value={styleValue.lineHeight} min={.8} max={3} step={.05} onChange={value => style({ lineHeight: value })} /></div><Segmented label="Horizontal alignment" value={styleValue.textAlign} onChange={value => style({ textAlign: value })} options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }, { value: 'justify', label: 'Justify' }]} /><Segmented label="Vertical alignment" value={styleValue.verticalAlign} onChange={value => style({ verticalAlign: value })} options={[{ value: 'top', label: 'Top' }, { value: 'middle', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }]} /><div className="field-row"><label>Weight<select value={styleValue.fontWeight} onChange={event => style({ fontWeight: event.target.value as CustomBlockStyle['fontWeight'] })}><option value="normal">Regular</option><option value="bold">Bold</option></select></label><label>Style<select value={styleValue.fontStyle} onChange={event => style({ fontStyle: event.target.value as CustomBlockStyle['fontStyle'] })}><option value="normal">Regular</option><option value="italic">Italic</option></select></label></div><label>Capitalization<select value={styleValue.textTransform} onChange={event => style({ textTransform: event.target.value as CustomBlockStyle['textTransform'] })}><option value="none">Normal</option><option value="uppercase">Uppercase</option><option value="small-caps">Small caps</option></select></label></section>
      <section className="appearance-section"><h3>{block.type === 'copyright' ? 'Fill and rule' : 'Fill and border'}</h3><div className="field-row"><label>Text color<input type="color" value={styleValue.color} onChange={event => style({ color: event.target.value })} /></label><label>Background<input type="color" value={styleValue.backgroundColor ?? '#ffffff'} onChange={event => style({ backgroundColor: event.target.value })} /></label></div><label className="check"><input type="checkbox" checked={!styleValue.backgroundColor} onChange={event => style({ backgroundColor: event.target.checked ? undefined : '#ffffff' })} />Transparent background</label><div className="field-row"><NumberField label={block.type === 'copyright' ? 'Rule above (pt)' : 'Border (pt)'} value={styleValue.borderWidthPt} min={0} max={12} step={.5} onChange={value => style({ borderWidthPt: value })} />{block.type !== 'copyright' && <NumberField label="Corner radius (pt)" value={styleValue.borderRadiusPt} min={0} max={36} step={1} onChange={value => style({ borderRadiusPt: value })} />}</div><label>{block.type === 'copyright' ? 'Rule color' : 'Border color'}<input type="color" value={styleValue.borderColor} onChange={event => style({ borderColor: event.target.value })} /></label></section>
    </main></div>
    <footer><button className="danger-text" onClick={() => onSave(undefined, undefined)}>Reset to template defaults</button><div><button className="secondary" onClick={onClose}>Cancel</button><button className="primary" onClick={() => onSave(styleValue, layout)}>Apply formatting</button></div></footer>
  </section></div>;
}
