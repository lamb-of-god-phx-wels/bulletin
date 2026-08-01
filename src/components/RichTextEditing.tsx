import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CustomBlockStyle, InlineTextStyle, Marks, Paragraph } from '../shared/types';

export type RichTextToolbarState = {
  marks: Marks;
  fontFamily?: string;
  fontSizePt?: number;
  textTransform?: NonNullable<InlineTextStyle['textTransform']>;
  align?: NonNullable<Paragraph['align']>;
  lineHeight?: number;
  verticalAlign?: CustomBlockStyle['verticalAlign'];
  canReset?: boolean;
};

export interface RichTextAdapter {
  id: string;
  state(): RichTextToolbarState;
  mark(mark: Extract<Marks[number], 'bold' | 'italic' | 'smallCaps'>): void;
  inlineStyle(style: InlineTextStyle): void;
  paragraph(changes: Pick<Paragraph, 'align' | 'lineHeight'>): void;
  clear(): void;
  verticalAlign?(value: CustomBlockStyle['verticalAlign']): void;
  reset?(): void;
  preserveSelection(): void;
  finish(): void;
  focus(): void;
}

type EditingContextValue = {
  active?: RichTextAdapter;
  toolbar: RichTextToolbarState;
  activate(adapter: RichTextAdapter): void;
  refresh(adapter: RichTextAdapter): void;
  deactivate(adapter: RichTextAdapter): void;
};

const empty: RichTextToolbarState = { marks: [] };
const RichTextEditingContext = createContext<EditingContextValue>({
  toolbar: empty,
  activate() {},
  refresh() {},
  deactivate() {},
});

export function RichTextEditingProvider({ children }: { children: ReactNode }) {
  const activeRef = useRef<RichTextAdapter | undefined>(undefined);
  const [active, setActive] = useState<RichTextAdapter>();
  const [toolbar, setToolbar] = useState<RichTextToolbarState>(empty);
  const value = useMemo<EditingContextValue>(() => ({
    active,
    toolbar,
    activate(adapter) {
      activeRef.current = adapter;
      setActive(adapter);
      setToolbar(adapter.state());
    },
    refresh(adapter) {
      if (activeRef.current !== adapter) return;
      setToolbar(adapter.state());
    },
    deactivate(adapter) {
      if (activeRef.current !== adapter) return;
      activeRef.current = undefined;
      setActive(undefined);
      setToolbar(empty);
    },
  }), [active, toolbar]);
  return <RichTextEditingContext.Provider value={value}>{children}</RichTextEditingContext.Provider>;
}

export const useRichTextEditing = () => useContext(RichTextEditingContext);

const lineHeights = [
  { value: 1, label: 'Tight' },
  { value: 1.15, label: 'Standard' },
  { value: 1.28, label: 'Comfortable' },
  { value: 1.5, label: 'Relaxed' },
  { value: 2, label: 'Double' },
];

export function RichTextToolbar({ className = '' }: { className?: string }) {
  const { active, toolbar, refresh } = useRichTextEditing();
  const disabled = !active;
  const command = (run: (adapter: RichTextAdapter) => void) => {
    if (!active) return;
    run(active);
    refresh(active);
    active.focus();
    window.requestAnimationFrame(() => refresh(active));
  };
  const keepSelection = (event: React.MouseEvent) => event.preventDefault();
  return <div className={`global-rich-text-toolbar ${className}`.trim()} role="toolbar" aria-label="Text formatting" onPointerDownCapture={() => active?.preserveSelection()} onBlurCapture={event => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    window.setTimeout(() => active?.finish());
  }}>
    <label>Font<select disabled={disabled} value={toolbar.fontFamily ?? ''} onChange={event => command(adapter => adapter.inlineStyle({ fontFamily: event.target.value }))}>
      {!toolbar.fontFamily && <option value="">Font</option>}
      <option value="body">Template body</option><option value="display">Template display</option>
      <option value="Arial, sans-serif">Arial</option><option value="Georgia, serif">Georgia</option><option value="Times New Roman, serif">Times New Roman</option>
    </select></label>
    <label>Size<input disabled={disabled} type="number" min="6" max="72" step=".5" value={toolbar.fontSizePt ?? ''} placeholder="Size" onChange={event => { if (Number.isFinite(event.currentTarget.valueAsNumber)) command(adapter => adapter.inlineStyle({ fontSizePt: event.currentTarget.valueAsNumber })); }} /></label>
    <label>Spacing<select disabled={disabled} value={toolbar.lineHeight ?? ''} onChange={event => command(adapter => adapter.paragraph({ lineHeight: Number(event.target.value) }))}>
      {!toolbar.lineHeight && <option value="">Spacing</option>}{lineHeights.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
    </select></label>
    <span className="global-rich-text-group" aria-label="Text style">
      <button disabled={disabled} className={toolbar.marks.includes('bold') ? 'active typography-bold' : 'typography-bold'} aria-label="Bold" aria-pressed={toolbar.marks.includes('bold')} onMouseDown={keepSelection} onClick={() => command(adapter => adapter.mark('bold'))}>B</button>
      <button disabled={disabled} className={toolbar.marks.includes('italic') ? 'active typography-italic' : 'typography-italic'} aria-label="Italic" aria-pressed={toolbar.marks.includes('italic')} onMouseDown={keepSelection} onClick={() => command(adapter => adapter.mark('italic'))}>I</button>
    </span>
    <span className="global-rich-text-group" aria-label="Paragraph alignment">{(['left', 'center', 'right', 'justify'] as const).map(align => <button disabled={disabled} className={toolbar.align === align ? `active align-${align}` : `align-${align}`} aria-label={`Align ${align}`} aria-pressed={toolbar.align === align} onMouseDown={keepSelection} onClick={() => command(adapter => adapter.paragraph({ align }))} key={align}>{align === 'justify' ? '☰' : '≡'}</button>)}</span>
    <span className="global-rich-text-group" aria-label="Capitalization">{([
      ['none', 'Aa', 'Regular capitalization'], ['small-caps', 'Aᴀ', 'Small caps'], ['uppercase', 'AA', 'Uppercase'],
    ] as const).map(([textTransform, label, title]) => <button disabled={disabled} className={toolbar.textTransform === textTransform ? 'active' : ''} aria-label={title} aria-pressed={toolbar.textTransform === textTransform} onMouseDown={keepSelection} onClick={() => command(adapter => adapter.inlineStyle({ textTransform }))} key={textTransform}>{label}</button>)}</span>
    <span className="global-rich-text-group" aria-label="Vertical alignment">{(['top', 'middle', 'bottom'] as const).map(value => <button disabled={!active?.verticalAlign} className={toolbar.verticalAlign === value ? 'active' : ''} aria-label={`Align ${value}`} aria-pressed={toolbar.verticalAlign === value} onMouseDown={keepSelection} onClick={() => command(adapter => adapter.verticalAlign?.(value))} key={value}>{value === 'top' ? 'T↑' : value === 'middle' ? 'T↕' : 'T↓'}</button>)}</span>
    <button disabled={disabled} onMouseDown={keepSelection} onClick={() => command(adapter => adapter.clear())}>Clear</button>
    <button className="text-button rich-text-reset-source" hidden={!toolbar.canReset} disabled={!active?.reset} onMouseDown={keepSelection} onClick={() => command(adapter => adapter.reset?.())}>Reset to source</button>
  </div>;
}
