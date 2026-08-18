import { cloneElement, createContext, useContext, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { AssetRef, BulletinBlock, BulletinDocumentV1, CustomBlock, CustomBlockStyle, FontReference, GroupBlock, LibraryManifestV1, Paragraph, ResponsiveReadingBlock, ResponsiveReadingSettings, TemplateV1 } from '../shared/types';
import { customBlockParagraphs, defaultCustomBlockStyle } from '../shared/customBlocks';
import { conditionVisible } from '../shared/customProperties';
import { childBlocks, findBlock, flattenBlocks, groupChildCell, updateBlockTree } from '../shared/blocks';
import { paginate, type PaginatedBlock } from '../shared/pagination';
import { templateForBulletin } from '../shared/documentLayout';
import { defaultResponsiveReadingSettings, effectiveResponsiveReadingSettings, responsiveEntryReader, responsiveEntryRole, responsiveReadingEditorContent, safeParseResponsiveReadingContent } from '../shared/responsiveReading';
import { songHeader, songTitle } from '../shared/songs';
import { scriptureElementBlocks, scriptureElementHasContent } from '../shared/scriptureReading';
import { useLibraryFontsReady } from './LibraryFonts';
import { effectiveFontRoles, familyCssName, fontReferenceCss } from '../shared/fonts';
import { boundRichTextParagraphs, canvasAssetRefs, canvasNativeBlocks, resetBoundRichTextContent } from '../shared/canvas';
import { bookletPrinterSpreads, bookletReadingSpreads } from '../shared/booklet';
import { CanvasSceneView } from './CanvasSceneView';
import { RichTextEditor } from './RichTextEditor';
import { paragraphsHaveVisibleContent } from '../shared/plainText';

const inlineText = (paragraph: Paragraph) => paragraph.children.map((run, index) => run.type === 'lineBreak'
  ? <br key={index} />
  : run.type === 'symbol'
    ? <span className="cross" key={index}>✠</span>
    : <span key={index} className={run.marks?.map(mark => `mark-${mark}`).join(' ')} style={{
      fontFamily: fontReferenceCss(run.style?.fontRef, run.style?.fontFamily),
      fontSize: run.style?.fontSizePt ? `${run.style.fontSizePt}pt` : undefined,
      textTransform: run.style?.textTransform === 'uppercase' ? 'uppercase' : undefined,
      fontVariant: run.style?.textTransform === 'small-caps' ? 'small-caps' : undefined,
    }}>{run.text}</span>);

function Paragraphs({ content }: { content: Paragraph[] }) {
  return <>{content.map((paragraph, index) => <p key={index} className={`${paragraph.breakBefore === 'line' ? 'structured-line-continuation' : ''} ${content[index + 1]?.breakBefore === 'line' ? 'before-structured-line-continuation' : ''}`.trim() || undefined} style={{ textAlign: paragraph.align, lineHeight: paragraph.lineHeight }}>{inlineText(paragraph)}</p>)}</>;
}

const textParagraphs = (value: string): Paragraph[] => [{ type: 'paragraph', children: [{ type: 'text', text: value }] }];
const plainText = (content: Paragraph[]) => content.map(paragraph => paragraph.children.map(run => run.type === 'text' ? run.text : run.type === 'lineBreak' ? '\n' : '✠').join('')).join('\n\n');
const CanvasTextBoxContext = createContext<{ verticalAlign?: CustomBlockStyle['verticalAlign']; onVerticalAlignChange?(value: CustomBlockStyle['verticalAlign']): void }>({});
const BlockFontContext = createContext<{ fontRef?: FontReference; fontFamily?: string }>({ fontFamily: 'body' });

function EditableParagraphs({ content, label, onChange, onReset, className, inline = false }: { content: Paragraph[]; label: string; onChange?(content: Paragraph[]): void; onReset?(): void; className?: string; inline?: boolean }) {
  const textBox = useContext(CanvasTextBoxContext);
  const inheritedFont = useContext(BlockFontContext);
  return onChange
    ? <RichTextEditor content={content} label={label} onChange={onChange} onReset={onReset} variant={textBox.onVerticalAlignChange ? 'canvas' : 'preview'} className={`${inline ? 'inline-rich-text' : ''} ${className ?? ''}`.trim()} inheritedFontRef={inheritedFont.fontRef} inheritedFontFamily={inheritedFont.fontFamily} verticalAlign={textBox.verticalAlign} onVerticalAlignChange={textBox.onVerticalAlignChange} />
    : inline ? <>{content.map((paragraph, index) => <span key={index}>{index > 0 && <br />}{inlineText(paragraph)}</span>)}</> : <Paragraphs content={content} />;
}

function annotateResponsiveEditor(editor: HTMLElement | null, settings: ResponsiveReadingSettings, entries: ResponsiveReadingBlock['entries']) {
  if (!editor) return;
  const aliases = [
    ...Object.entries(settings.labels).map(([role, label]) => ({ label, role })),
    ...entries.map(entry => ({ label: responsiveEntryReader(entry, settings), role: responsiveEntryRole(entry) })),
  ].filter((alias, index, all) => alias.label.trim() && all.findIndex(candidate => candidate.label.trim().toLocaleLowerCase() === alias.label.trim().toLocaleLowerCase()) === index)
    .sort((left, right) => right.label.length - left.label.length);
  let role = 'leader';
  Array.from(editor.querySelectorAll<HTMLElement>(':scope > [data-scripture-paragraph]')).forEach(paragraph => {
    const text = paragraph.textContent ?? '';
    const alias = aliases.find(candidate => text.slice(0, candidate.label.length + 1).toLocaleLowerCase() === `${candidate.label}:`.toLocaleLowerCase());
    if (alias) role = alias.role;
    paragraph.dataset.responseRole = role;
    paragraph.dataset.readerStart = String(Boolean(alias));
  });
}

function ResponsiveReadingPreview({ block, settings, onChange }: { block: ResponsiveReadingBlock; settings: ResponsiveReadingSettings; onChange?(block: ResponsiveReadingBlock): void }) {
  const [draft, setDraft] = useState(() => responsiveReadingEditorContent(block.entries, settings));
  const [parseError, setParseError] = useState('');
  const [editingPreview, setEditingPreview] = useState(false);
  const editorHost = useRef<HTMLDivElement>(null);
  const pendingBlock = useRef<ResponsiveReadingBlock | undefined>(undefined);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const signature = JSON.stringify(block.entries);
  useEffect(() => {
    if (!editingPreview) setDraft(responsiveReadingEditorContent(block.entries, settings));
  }, [signature, settings, editingPreview]);
  useEffect(() => () => {
    if (pendingBlock.current) onChangeRef.current?.(pendingBlock.current);
  }, []);
  const renderedRows = block.entries.map((entry, index) => {
    const role = responsiveEntryRole(entry);
    return <div className={`response-row response-${role}`} data-response-role={role} key={index}><span className="response-reader">{responsiveEntryReader(entry, settings)}:</span><div><Paragraphs content={entry.content} /></div></div>;
  });
  if (!onChange || !editingPreview) return <div className={`responsive ${onChange ? 'responsive-reading-direct-target' : ''}`} onClick={onChange ? event => {
    event.stopPropagation();
    setEditingPreview(true);
    window.setTimeout(() => editorHost.current?.querySelector<HTMLElement>('.responsive-reading-preview-editor')?.focus());
  } : undefined}>{renderedRows}</div>;
  return <div className="responsive responsive-reading-preview-editable" ref={editorHost}><RichTextEditor content={draft} label="Responsive reading" className="responsive-reading-editor responsive-reading-preview-editor" enterMode="responsiveLines" variant="preview" commitDelayMs={0} onRender={editor => annotateResponsiveEditor(editor, settings, block.entries)} onEditingBlur={() => {
    const next = pendingBlock.current;
    pendingBlock.current = undefined;
    if (next) onChange(next);
    setEditingPreview(false);
  }} onChange={content => {
    setDraft(content);
    const result = safeParseResponsiveReadingContent(content, settings, block.entries);
    if (result.entries) {
      setParseError('');
      pendingBlock.current = { ...block, entries: result.entries };
    }
    else setParseError(result.error);
  }} />{parseError && <span className="responsive-reading-preview-error" role="alert">{parseError}</span>}</div>;
}

function replaceSlice<T>(source: T[], previous: T[], next: T[]) {
  if (!previous.length) return next;
  const signatures = source.map(item => JSON.stringify(item));
  const target = previous.map(item => JSON.stringify(item));
  const start = signatures.findIndex((_, index) => target.every((value, offset) => signatures[index + offset] === value));
  return start < 0 ? source : [...source.slice(0, start), ...next, ...source.slice(start + previous.length)];
}

function mergePaginatedEdit(source: BulletinBlock, fragment: PaginatedBlock, changed: BulletinBlock, library?: LibraryManifestV1): BulletinBlock {
  if (source.type === 'richText' && fragment.type === 'richText' && changed.type === 'richText') {
    if (!source.binding) return { ...source, content: replaceSlice(source.content, fragment.content, changed.content) };
    const binding = source.binding;
    const original = source.bindingOverride ?? (typeof binding === 'object' && binding.kind === 'libraryItem'
      ? library?.items.filter(item => item.id === binding.itemId && (!binding.version || item.version === binding.version)).sort((left, right) => right.version - left.version)[0]?.content
      : undefined) ?? source.content;
    const previous = fragment.bindingOverride ?? fragment.content;
    const next = changed.bindingOverride ?? previous;
    return { ...source, ...changed, id: source.id, bindingOverride: replaceSlice(original, previous, next) };
  }
  if (source.type === 'song' && fragment.type === 'song' && changed.type === 'song') {
    const original = source.contentOverride ?? library?.items.filter(item => item.id === source.libraryItemId && (!source.libraryItemVersion || item.version === source.libraryItemVersion)).sort((a, b) => b.version - a.version)[0]?.content ?? [];
    const previous = fragment.pageContent ?? fragment.contentOverride ?? [];
    const next = changed.contentOverride ?? previous;
    return { ...source, ...changed, id: source.id, contentOverride: original.length ? replaceSlice(original, previous, next) : next };
  }
  if (source.type === 'libraryText' && fragment.type === 'libraryText' && changed.type === 'libraryText') {
    const original = source.contentOverride ?? library?.items.filter(item => item.id === source.libraryItemId && (!source.libraryItemVersion || item.version === source.libraryItemVersion)).sort((a, b) => b.version - a.version)[0]?.content ?? [];
    const previous = fragment.pageContent ?? fragment.contentOverride ?? [];
    const next = changed.contentOverride ?? previous;
    return { ...source, ...changed, id: source.id, contentOverride: original.length ? replaceSlice(original, previous, next) : next };
  }
  if (source.type === 'scriptureReading' && fragment.type === 'scriptureReading' && changed.type === 'scriptureReading' && source.resolved && fragment.resolved && changed.resolved) return { ...source, ...changed, id: source.id, resolved: { ...source.resolved, content: replaceSlice(source.resolved.content, fragment.resolved.content, changed.resolved.content) } };
  if (source.type === 'responsiveReading' && fragment.type === 'responsiveReading' && changed.type === 'responsiveReading') return { ...source, ...changed, id: source.id, entries: replaceSlice(source.entries, fragment.entries, changed.entries) };
  if (source.type === 'announcements' && fragment.type === 'announcements' && changed.type === 'announcements') return { ...source, ...changed, id: source.id, items: replaceSlice(source.items, fragment.items, changed.items) };
  if (source.type === 'list' && fragment.type === 'list' && changed.type === 'list') return { ...source, ...changed, id: source.id, items: replaceSlice(source.items, fragment.items, changed.items) };
  return { ...changed, id: source.id } as BulletinBlock;
}

function presentationStyle(block: PaginatedBlock): React.CSSProperties | undefined {
  const base = block.type === 'custom' ? block.style : undefined;
  if (!base && !block.presentation) return undefined;
  const style: NonNullable<CustomBlock['style']> = {
    ...defaultCustomBlockStyle, ...base, ...block.presentation,
    paddingIn: { ...defaultCustomBlockStyle.paddingIn, ...base?.paddingIn, ...block.presentation?.paddingIn },
    marginIn: { ...defaultCustomBlockStyle.marginIn, ...base?.marginIn, ...block.presentation?.marginIn }
  };
  const border = style.borderWidthPt ? `${style.borderWidthPt}pt solid ${style.borderColor}` : undefined;
  return {
    boxSizing: 'border-box', width: `${style.widthPercent}%`,
    marginTop: `${style.marginIn.top}in`, marginBottom: `${style.marginIn.bottom}in`,
    marginLeft: style.placement === 'left' ? 0 : 'auto', marginRight: style.placement === 'right' ? 0 : 'auto',
    padding: `${style.paddingIn.top}in ${style.paddingIn.right}in ${style.paddingIn.bottom}in ${style.paddingIn.left}in`,
    textAlign: style.textAlign, fontFamily: fontReferenceCss(style.fontRef, style.fontFamily),
    fontSize: `${style.fontSizePt}pt`, lineHeight: style.lineHeight, fontWeight: style.fontWeight, fontStyle: style.fontStyle,
    fontVariant: style.textTransform === 'small-caps' ? 'small-caps' : undefined,
    textTransform: style.textTransform === 'uppercase' ? 'uppercase' : 'none',
    color: style.color, backgroundColor: style.backgroundColor ?? 'transparent',
    border: block.type === 'copyright' ? undefined : border,
    borderTop: block.type === 'copyright' ? border : undefined,
    borderRadius: block.type === 'copyright' ? undefined : `${style.borderRadiusPt}pt`
  };
}

function songPartStyle(
  presentation: Partial<CustomBlockStyle> | undefined,
  inline = false,
): React.CSSProperties | undefined {
  if (!presentation) return undefined;
  const style = presentationStyle({
    id: 'song-part',
    type: 'richText',
    content: [],
    presentation,
  });
  if (!style || !inline) return style;
  const { width: _width, marginLeft: _marginLeft, marginRight: _marginRight, ...inlineStyle } = style;
  return inlineStyle;
}

function FlowAsset({ asset, source }: { asset: AssetRef; source?: string }) {
  if (!source) return <p className="missing">Asset “{asset.path}” is unavailable.</p>;
  return asset.mediaType === 'application/pdf'
    ? <embed className="flow-pdf" src={`${source}#page=${asset.page ?? 1}&toolbar=0&navpanes=0`} type="application/pdf" />
    : <img src={source} alt={asset.alt ?? ''} />;
}

function rulerTicks(lengthIn: number) {
  const ticks = Array.from({ length: Math.floor(lengthIn * 4 + .0001) + 1 }, (_, index) => index / 4);
  if (Math.abs(ticks.at(-1)! - lengthIn) > .001) ticks.push(lengthIn);
  return ticks.map((value, index) => ({
    value,
    position: `${value / lengthIn * 100}%`,
    label: Number.isInteger(value) || index === ticks.length - 1 ? String(value) : undefined,
    kind: Number.isInteger(value) ? 'major' : Number.isInteger(value * 2) ? 'half' : 'quarter'
  }));
}

export function PageRulers({ widthIn = 7, heightIn = 8.5 }: { widthIn?: number; heightIn?: number }) {
  const horizontal = rulerTicks(widthIn);
  const vertical = rulerTicks(heightIn);
  return <div className="page-rulers" aria-hidden="true"><div className="ruler-corner">in</div><div className="ruler ruler-horizontal">{horizontal.map(tick => <i className={`ruler-tick ${tick.kind}`} style={{ left: tick.position }} key={tick.value}>{tick.label && <span>{tick.label}</span>}</i>)}</div><div className="ruler ruler-vertical">{vertical.map(tick => <i className={`ruler-tick ${tick.kind}`} style={{ top: tick.position }} key={tick.value}>{tick.label && <span>{tick.label}</span>}</i>)}</div></div>;
}

export function trackPointer(event: React.PointerEvent<HTMLElement>) {
  const frame = event.currentTarget.parentElement;
  if (!frame) return;
  const bounds = event.currentTarget.getBoundingClientRect();
  frame.style.setProperty('--cursor-x', `${Math.max(0, Math.min(bounds.width, event.clientX - bounds.left))}px`);
  frame.style.setProperty('--cursor-y', `${Math.max(0, Math.min(bounds.height, event.clientY - bounds.top))}px`);
  frame.classList.add('tracking-cursor');
}

export function stopTrackingPointer(event: React.PointerEvent<HTMLElement>) {
  event.currentTarget.parentElement?.classList.remove('tracking-cursor');
}

function validTrackSizes(values: number[] | undefined, count: number) {
  return values?.length === count && values.every(value => Number.isFinite(value) && value > 0) ? values : undefined;
}

function GridGroupView({ block, library, assets, document, template, marginIn, onBlockChange }: { block: GroupBlock; library?: LibraryManifestV1; assets: Record<string, string>; document: BulletinDocumentV1; template?: TemplateV1; marginIn: number; onBlockChange?(block: BulletinBlock): void }) {
  const gridRef = useRef<HTMLElement>(null);
  const resize = useRef<{ axis: 'column' | 'row'; index: number; outerEdge: boolean; start: number; sizes: number[]; current: number[]; pixelsPerInch: number; move(event: PointerEvent): void; finish(event: PointerEvent): void } | undefined>(undefined);
  const [draftColumns, setDraftColumns] = useState<number[] | undefined>();
  const [draftRows, setDraftRows] = useState<number[] | undefined>();
  const rows = Math.max(1, Math.min(12, block.rows ?? Math.max(1, Math.ceil(block.children.length / Math.max(1, block.columns ?? 2)))));
  const columns = Math.max(1, Math.min(12, block.columns ?? 2));
  const sizing = block.gridSizing ?? 'equal';
  const savedColumns = validTrackSizes(block.columnWidths, columns);
  const savedRows = validTrackSizes(block.rowHeightsIn, rows);
  const columnSizes = draftColumns ?? savedColumns;
  const rowSizes = draftRows ?? savedRows;
  const positioned = new Map(block.children.map((child, index) => { const cell = groupChildCell(block, child, index); return [`${cell.row}:${cell.column}`, child] as const; }));
  const changeChild = onBlockChange ? (changed: BulletinBlock) => onBlockChange({ ...block, children: updateBlockTree(block.children, changed.id, changed) }) : undefined;
  const style = {
    '--layout-gap': `${block.layoutMode === 'table' ? 0 : block.gapIn ?? 0}in`,
    '--layout-columns': columns,
    '--layout-rows': rows,
    gridTemplateColumns: columnSizes ? columnSizes.map(value => `${value}fr`).join(' ') : sizing === 'auto' ? `repeat(${columns}, auto)` : `repeat(${columns}, minmax(0, 1fr))`,
    gridTemplateRows: rowSizes ? rowSizes.map(value => `${value}in`).join(' ') : sizing === 'auto' ? `repeat(${rows}, auto)` : `repeat(${rows}, minmax(0, 1fr))`
  } as React.CSSProperties;
  const beginResize = (axis: 'column' | 'row', index: number, event: React.PointerEvent<HTMLSpanElement>, outerEdge = false) => {
    const grid = gridRef.current;
    if (!grid) return;
    event.preventDefault();
    event.stopPropagation();
    const cells = Array.from(grid.querySelectorAll<HTMLElement>(':scope > .layout-cell-content'));
    const sizes = Array.from({ length: axis === 'column' ? columns : rows }, (_, track) => {
      const cell = cells.find(candidate => Number(candidate.dataset[axis === 'column' ? 'layoutColumn' : 'layoutRow']) === track + 1);
      return Math.max(12, axis === 'column' ? cell?.getBoundingClientRect().width ?? 0 : cell?.getBoundingClientRect().height ?? 0);
    });
    const pageWidth = grid.closest<HTMLElement>('.document-page')?.getBoundingClientRect().width ?? 672;
    const move = (pointer: PointerEvent) => moveResize(pointer);
    const finish = (pointer: PointerEvent) => finishResize(pointer);
    resize.current = { axis, index, outerEdge, start: axis === 'column' ? event.clientX : event.clientY, sizes, current: sizes, pixelsPerInch: pageWidth / 7, move, finish };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
  };
  const moveResize = (event: { clientX: number; clientY: number }) => {
    const active = resize.current;
    if (!active) return;
    const pointer = active.axis === 'column' ? event.clientX : event.clientY;
    const delta = pointer - active.start;
    const pairTotal = active.outerEdge ? 0 : active.sizes[active.index] + active.sizes[active.index + 1];
    const first = active.outerEdge
      ? Math.max(12, active.sizes[active.index] + delta)
      : Math.max(12, Math.min(pairTotal - 12, active.sizes[active.index] + delta));
    const current = active.sizes.map((value, index) => index === active.index ? first : !active.outerEdge && index === active.index + 1 ? pairTotal - first : value);
    active.current = current;
    if (active.axis === 'column') {
      const total = current.reduce((sum, value) => sum + value, 0);
      setDraftColumns(current.map(value => value / total));
    } else setDraftRows(current.map(value => value / active.pixelsPerInch));
  };
  const finishResize = (event: { clientX: number; clientY: number }) => {
    const active = resize.current;
    if (!active) return;
    moveResize(event);
    const current = resize.current!.current;
    const nextColumns = active.axis === 'column' ? (() => { const total = current.reduce((sum, value) => sum + value, 0); return current.map(value => value / total); })() : draftColumns ?? savedColumns;
    const nextRows = active.axis === 'row' ? current.map(value => value / active.pixelsPerInch) : draftRows ?? savedRows;
    window.removeEventListener('pointermove', active.move);
    window.removeEventListener('pointerup', active.finish);
    window.removeEventListener('pointercancel', active.finish);
    resize.current = undefined;
    setDraftColumns(undefined);
    setDraftRows(undefined);
    onBlockChange?.({ ...block, gridSizing: 'custom', columnWidths: nextColumns, rowHeightsIn: nextRows });
  };
  const setSizing = (next: 'equal' | 'auto') => {
    setDraftColumns(undefined);
    setDraftRows(undefined);
    onBlockChange?.({ ...block, gridSizing: next, columnWidths: undefined, rowHeightsIn: undefined });
  };
  return <section ref={gridRef} className={`block-group layout-${block.layoutMode ?? 'grid'} ${block.layoutMode === 'table' && block.tableHeaderRow ? 'has-table-header' : ''} ${block.layoutMode === 'table' && block.tableShowLines === false ? 'table-lines-hidden' : ''} ${onBlockChange ? 'resizable-layout-preview' : ''}`} style={style}>
    {Array.from({ length: (block.layoutMode === 'table' || block.children.length || onBlockChange ? rows * columns : 0) }, (_, index) => {
      const row = Math.floor(index / columns) + 1;
      const column = index % columns + 1;
      const child = positioned.get(`${row}:${column}`);
      return <div className="layout-cell-content" data-layout-row={row} data-layout-column={column} style={{ gridRow: row, gridColumn: column }} key={`${row}:${column}`}>{child && <RenderedBlock block={child as PaginatedBlock} library={library} assets={assets} document={document} template={template} marginIn={marginIn} onBlockChange={changeChild} />}</div>;
    })}
    {onBlockChange && <><div className="grid-sizing-controls" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}><button type="button" className={sizing === 'equal' ? 'active' : ''} onClick={() => setSizing('equal')}>Reset</button><button type="button" className={sizing === 'auto' ? 'active' : ''} onClick={() => setSizing('auto')}>Auto</button></div>
      <div className="grid-resize-overlay" style={{ gridTemplateColumns: style.gridTemplateColumns, gridTemplateRows: style.gridTemplateRows, gap: block.layoutMode === 'table' ? 0 : `${block.gapIn ?? 0}in` }}>
        {Array.from({ length: columns - 1 }, (_, index) => <span className="grid-resize-separator column" role="separator" aria-label={`Resize columns ${index + 1} and ${index + 2}`} aria-orientation="vertical" style={{ gridColumn: index + 1, gridRow: '1 / -1' }} onPointerDown={event => beginResize('column', index, event)} key={`column-${index}`} />)}
        {Array.from({ length: rows }, (_, index) => <span className={`grid-resize-separator row ${index === rows - 1 ? 'outer-edge' : ''}`} role="separator" aria-label={index === rows - 1 ? `Resize bottom of row ${rows}` : `Resize rows ${index + 1} and ${index + 2}`} aria-orientation="horizontal" style={{ gridRow: index + 1, gridColumn: '1 / -1' }} onPointerDown={event => beginResize('row', index, event, index === rows - 1)} key={`row-${index}`} />)}
      </div>
    </>}
  </section>;
}

function BlockView({ block, library, assets, document, template, marginIn, onBlockChange }: { block: PaginatedBlock; library?: LibraryManifestV1; assets: Record<string, string>; document: BulletinDocumentV1; template?: TemplateV1; marginIn: number; onBlockChange?(block: BulletinBlock): void }) {
  const item = 'libraryItemId' in block ? library?.items.filter(entry => entry.id === block.libraryItemId && (!block.libraryItemVersion || entry.version === block.libraryItemVersion)).sort((a, b) => b.version - a.version)[0] : undefined;
  switch (block.type) {
    case 'titlePage': case 'canvasCover': return <div className="missing">This document contains an unsupported legacy cover. Insert a reusable page design instead.</div>;
    case 'canvas': {
      const fullPage = (block.widthMode ?? 'contentBox') === 'fullPage';
      const widthIn = fullPage ? 7 : 7 - marginIn * 2;
      return <div className={`canvas-block ${fullPage ? 'canvas-block-full-page' : ''}`} style={{
        height: `${block.heightIn}in`,
        ...(fullPage ? { width: '7in', marginLeft: `${-marginIn}in` } : {})
      }}><CanvasSceneView scene={block.scene} document={document} template={template} assets={assets} marginIn={0} widthIn={widthIn} heightIn={block.heightIn} renderNativeBlock={native => <NativeBlockPreview block={native} library={library} assets={assets} document={document} template={template} marginIn={marginIn} />} /></div>;
    }
    case 'templatePage': return <section className="template-page-instance" data-template-page-id={`${block.source.id}@${block.source.version}`}>{block.blocks.map(child =>
      <RenderedBlock block={child as PaginatedBlock} library={library} assets={assets} document={document} template={template} marginIn={marginIn} onBlockChange={onBlockChange} key={child.id} />
    )}</section>;
    case 'templateInstance': return <section className="template-instance" data-template-id={`${block.source.id}@${block.source.version}`}>{block.blocks.map(child =>
      <RenderedBlock key={child.id} block={child} library={library} assets={assets} document={document} template={template} marginIn={marginIn} onBlockChange={onBlockChange} />
    )}</section>;
    case 'churchInfo': return <div className="church-info">{block.heroAsset && assets[block.heroAsset.path] && <img className="church-info-image" src={assets[block.heroAsset.path]} alt="Lamb of God church building" />}<h1>{document.church.name}</h1>{childBlocks(block)!.map(child => <RenderedBlock block={child as PaginatedBlock} library={library} assets={assets} document={document} template={template} marginIn={marginIn} onBlockChange={onBlockChange} key={child.id} />)}</div>;
    case 'group': {
      const mode = block.layoutMode ?? 'stack';
      const changeChild = onBlockChange ? (changed: BulletinBlock) => onBlockChange({ ...block, children: updateBlockTree(block.children, changed.id, changed) }) : undefined;
      return mode === 'stack' ? <section className="block-group layout-stack" style={{ '--layout-gap': `${block.gapIn ?? 0}in` } as React.CSSProperties}>{block.children.map(child =>
        <RenderedBlock block={child as PaginatedBlock} library={library} assets={assets} document={document} template={template} marginIn={marginIn} onBlockChange={changeChild} key={child.id} />
      )}</section> : <GridGroupView block={block} library={library} assets={assets} document={document} template={template} marginIn={marginIn} onBlockChange={onBlockChange} />;
    }
    case 'sermonTitle': return <h1 className="sermon-title"><EditableParagraphs inline content={block.content ?? textParagraphs(block.text)} label="Sermon title" onChange={onBlockChange ? content => onBlockChange({ ...block, text: plainText(content), content }) : undefined} /></h1>;
    case 'sectionHeading': return <h2 className="section-heading"><span aria-hidden="true">✠ </span><EditableParagraphs inline content={block.content ?? textParagraphs(block.text)} label="Section heading" onChange={onBlockChange ? content => onBlockChange({ ...block, text: plainText(content), content }) : undefined} /><span aria-hidden="true"> ✠</span></h2>;
    case 'heading': return <h3 className="block-heading"><EditableParagraphs inline content={block.content ?? textParagraphs(block.text)} label="Heading" onChange={onBlockChange ? content => onBlockChange({ ...block, text: plainText(content), content }) : undefined} /></h3>;
    case 'paragraph': return <section className="paragraph-block">{childBlocks(block)!.map(child => <RenderedBlock block={child as PaginatedBlock} library={library} assets={assets} document={document} template={template} marginIn={marginIn} onBlockChange={onBlockChange} key={child.id} />)}</section>;
    case 'richText': { const content = boundRichTextParagraphs(block, document, template, library); return <div className={`rich-text ${block.role ? `paragraph-${block.role}` : ''} ${block.scriptureRole ? `scripture-${block.scriptureRole}` : ''}`}><EditableParagraphs content={content} label={block.scriptureRole ?? block.role ?? 'Text'} onChange={onBlockChange ? next => onBlockChange(block.binding ? { ...block, bindingOverride: next } : { ...block, content: next }) : undefined} onReset={block.bindingOverride && onBlockChange ? () => onBlockChange(resetBoundRichTextContent(block)) : undefined} /></div>; }
    case 'custom': return <section className="custom-block">{(block.showName ?? true) && <h3 className="custom-block-heading">{block.name}</h3>}<Paragraphs content={customBlockParagraphs(block, document, template)} /></section>;
    case 'responsiveReading': return <div className="responsive">{block.heading && conditionVisible(block.heading, template, document) && <RenderedBlock block={block.heading as PaginatedBlock} library={library} assets={assets} document={document} template={template} marginIn={marginIn} onBlockChange={onBlockChange} />}<ResponsiveReadingPreview block={block} settings={document.responsiveReading ?? defaultResponsiveReadingSettings} onChange={onBlockChange} /></div>;
    case 'scriptureReading': {
      const elements = scriptureElementBlocks(block);
      const visible = elements.filter(element => conditionVisible(element, template, document) && (block.paginationContinuation
        ? element.scriptureRole === 'body'
        : element.scriptureRole === 'reference' || element.scriptureRole === 'body' || scriptureElementHasContent(element)));
      const renderElement = (element: typeof elements[number]) =>
        element.scriptureRole === 'body' && !block.resolved
          ? <div className="missing preview-block" data-block-id={element.id} key={element.id}>Passage text has not been resolved. Add it before export.</div>
          : <RenderedBlock block={element as PaginatedBlock} library={library} assets={assets} document={document} template={template} marginIn={marginIn} onBlockChange={onBlockChange} key={element.id} />;
      const heading = visible.find(element => element.scriptureRole === 'heading');
      const reference = visible.find(element => element.scriptureRole === 'reference');
      const inlineHeading = (block.headingReferenceLayout ?? 'inline') === 'inline' && heading && reference;
      return <section className="scripture">
        {inlineHeading && <div className="scripture-heading-line" style={{ '--scripture-heading-gap': `${Math.max(0, block.headingReferenceGapIn ?? 0.12)}in` } as React.CSSProperties}>{renderElement(heading)}{renderElement(reference)}</div>}
        {visible.filter(element => !inlineHeading || (element !== heading && element !== reference)).map(renderElement)}
        {!block.paginationContinuation && <div className="translation">{block.translation}</div>}
      </section>;
    }
    case 'song': {
      const asset = block.asset ?? item?.assets?.[0];
      const content = block.pageContent ?? block.contentOverride ?? item?.content;
      const bodyStyle = songPartStyle(block.elements?.body?.presentation);
      return <section className="song">
        {block.showHeading !== false && <h3>
          <span className="song-header" style={songPartStyle(block.elements?.header?.presentation, true)}><EditableParagraphs inline content={block.headerContent ?? textParagraphs(songHeader(block))} label="Song header" onChange={onBlockChange ? next => onBlockChange({ ...block, label: plainText(next) || 'Song', headerContent: next }) : undefined} />:</span>{' '}
          <span className="song-title" style={songPartStyle(block.elements?.title?.presentation, true)}><EditableParagraphs inline content={block.titleContent ?? textParagraphs(songTitle(block, item))} label="Song title" onChange={onBlockChange ? next => onBlockChange({ ...block, title: plainText(next), titleContent: next }) : undefined} onReset={(block.titleContent || block.title) && item && onBlockChange ? () => { const { title: _title, titleContent: _content, ...next } = block; onBlockChange(next); } : undefined} /></span>
        </h3>}
        <div className="song-body" style={bodyStyle}>
          {block.renderMode === 'asset' && asset
            ? <div className="song-asset" style={block.assetHeightIn ? { '--song-asset-height': `${block.assetHeightIn}in` } as React.CSSProperties : undefined}><FlowAsset asset={asset} source={assets[asset.path]} /></div>
            : content
              ? <EditableParagraphs content={content} label="Song lyrics" onChange={onBlockChange ? next => onBlockChange({ ...block, contentOverride: next }) : undefined} onReset={block.contentOverride && onBlockChange ? () => { const { contentOverride: _override, ...next } = block; onBlockChange(next); } : undefined} />
              : <p className="missing">Choose or add “{block.libraryItemId || 'song'}” in the shared library.</p>}
        </div>
      </section>;
    }
    case 'libraryText': { const content = block.pageContent ?? block.contentOverride ?? item?.content; return <section><h3 className="block-heading"><EditableParagraphs content={block.titleContent ?? textParagraphs(block.label ?? block.title ?? item?.title ?? '')} label="Reusable text title" onChange={onBlockChange ? next => onBlockChange({ ...block, title: plainText(next), titleContent: next }) : undefined} onReset={(block.titleContent || block.title) && item && onBlockChange ? () => { const { title: _title, titleContent: _content, ...next } = block; onBlockChange(next); } : undefined} /></h3>{content ? <EditableParagraphs content={content} label="Reusable text" onChange={onBlockChange ? next => onBlockChange({ ...block, contentOverride: next }) : undefined} onReset={block.contentOverride && onBlockChange ? () => { const { contentOverride: _override, ...next } = block; onBlockChange(next); } : undefined} /> : <p className="missing">Library text “{block.libraryItemId}” is unavailable.</p>}</section>; }
    case 'announcements': return <section className="announcements"><h2>Announcements</h2>{block.items.map((item, itemIndex) => <article className={item.asset ? `announcement-with-asset asset-${item.assetSide ?? 'right'}` : undefined} key={item.id}>{item.asset && <FlowAsset asset={item.asset} source={assets[item.asset.path]} />}<div><h3><EditableParagraphs content={item.titleContent ?? textParagraphs(item.title)} label="Announcement title" onChange={onBlockChange ? next => onBlockChange({ ...block, items: block.items.map((candidate, index) => index === itemIndex ? { ...candidate, title: plainText(next), titleContent: next } : candidate) }) : undefined} /></h3><EditableParagraphs content={item.content} label="Announcement details" onChange={onBlockChange ? next => onBlockChange({ ...block, items: block.items.map((candidate, index) => index === itemIndex ? { ...candidate, content: next } : candidate) }) : undefined} /></div></article>)}</section>;
    case 'list': {
      const items = block.items.map((item, itemIndex) => <li className={item.asset ? `announcement-with-asset asset-${item.assetSide ?? 'right'}` : undefined} key={item.id}>{item.asset && <FlowAsset asset={item.asset} source={assets[item.asset.path]} />}<div>{(item.title || item.titleContent?.length) && <h3><EditableParagraphs content={item.titleContent ?? textParagraphs(item.title ?? '')} label="List item heading" onChange={onBlockChange ? next => onBlockChange({ ...block, items: block.items.map((candidate, index) => index === itemIndex ? { ...candidate, title: plainText(next), titleContent: next } : candidate) }) : undefined} /></h3>}<EditableParagraphs content={item.content} label="List item" onChange={onBlockChange ? next => onBlockChange({ ...block, items: block.items.map((candidate, index) => index === itemIndex ? { ...candidate, content: next } : candidate) }) : undefined} /></div></li>);
      return <section className={`list-block list-${block.style ?? 'plain'}`}>{block.style === 'numbered' ? <ol>{items}</ol> : <ul>{items}</ul>}</section>;
    }
    case 'copyright': {
      const bulletinBlocks = flattenBlocks(document.blocks);
      const notices = block.suppressGeneratedNotices ? [] : bulletinBlocks.flatMap(candidate => 'libraryItemId' in candidate ? [library?.items.find(entry => entry.id === candidate.libraryItemId)?.license?.notice] : []).filter((notice): notice is string => Boolean(notice));
      const scripture = block.suppressGeneratedNotices ? [] : bulletinBlocks.flatMap(candidate => candidate.type === 'scriptureReading' && candidate.resolved ? [candidate.resolved.attribution] : []);
      const generated = [...new Set([...notices, ...scripture])];
      const before = block.beforeNotices ?? block.extra ?? [];
      const changeBefore = onBlockChange ? (beforeNotices: Paragraph[]) => { const { extra: _legacy, ...current } = block; onBlockChange({ ...current, beforeNotices: paragraphsHaveVisibleContent(beforeNotices) ? beforeNotices : undefined }); } : undefined;
      const after = block.afterNotices ?? [];
      return <section className="copyright">
        {paragraphsHaveVisibleContent(before) && <div className="copyright-section copyright-before"><EditableParagraphs content={before} label="Copyright text before generated notices" onChange={changeBefore} /></div>}
        {generated.length > 0 && <div className="copyright-section copyright-generated">{generated.map((notice, index) => <p key={index}>{notice}</p>)}</div>}
        {paragraphsHaveVisibleContent(after) && <div className="copyright-section copyright-after"><EditableParagraphs content={after} label="Copyright text after generated notices" onChange={onBlockChange ? afterNotices => onBlockChange({ ...block, afterNotices: paragraphsHaveVisibleContent(afterNotices) ? afterNotices : undefined }) : undefined} /></div>}
      </section>;
    }
    case 'image': return <div className="native-image-block" style={{ height: `${block.heightIn ?? 2.5}in` }}>{assets[block.asset.path] ? <img src={assets[block.asset.path]} alt={block.alt ?? block.asset.alt ?? ''} style={{ objectFit: block.fit ?? 'contain' }} /> : <p className="missing">Image “{block.asset.path}” is unavailable.</p>}</div>;
    case 'fullPageAsset': return <div className="full-page-asset">{block.asset.mediaType === 'application/pdf' ? <div className="pdf-placeholder"><b>{block.asset.alt ?? 'PDF page'}</b><span>Original PDF page inserted during export</span></div> : <img src={assets[block.asset.path]} alt={block.asset.alt ?? ''} />}</div>;
    case 'spacer': return <div className={`spacer spacer-${block.size}`} />;
  }
}

function RenderedBlock({ block, library, assets, document, template, marginIn, onBlockChange }: { block: PaginatedBlock; library?: LibraryManifestV1; assets: Record<string, string>; document: BulletinDocumentV1; template?: TemplateV1; marginIn: number; onBlockChange?(block: BulletinBlock): void }) {
  const style = presentationStyle(block);
  const baseFont = block.type === 'custom' ? block.style : undefined;
  const inheritedFont = {
    fontRef: block.presentation?.fontRef ?? baseFont?.fontRef,
    fontFamily: block.presentation?.fontRef || baseFont?.fontRef ? undefined : block.presentation?.fontFamily ?? baseFont?.fontFamily ?? 'body',
  };
  const editorBlockId = block.sourceBlockId ?? block.id;
  if (style) return <BlockFontContext.Provider value={inheritedFont}><div className={`block-presentation has-presentation preview-block ${block.type === 'titlePage' || block.type === 'canvasCover' || block.type === 'templatePage' || block.type === 'churchInfo' || block.type === 'fullPageAsset' ? 'full-height-presentation' : ''}`} data-block-id={editorBlockId} style={style}><BlockView block={block} library={library} assets={assets} document={document} template={template} marginIn={marginIn} onBlockChange={onBlockChange} /></div></BlockFontContext.Provider>;
  const view = BlockView({ block, library, assets, document, template, marginIn, onBlockChange }) as ReactElement<{ className?: string; 'data-block-id'?: string }>;
  return <BlockFontContext.Provider value={inheritedFont}>{cloneElement(view, { className: `${view.props.className ?? ''} preview-block`.trim(), 'data-block-id': editorBlockId })}</BlockFontContext.Provider>;
}

export function NativeBlockPreview({ block, library, assets, document, template, marginIn, onBlockChange, verticalAlign, onVerticalAlignChange }: { block: BulletinDocumentV1['blocks'][number]; library?: LibraryManifestV1; assets: Record<string, string>; document: BulletinDocumentV1; template?: TemplateV1; marginIn: number; onBlockChange?(block: BulletinBlock): void; verticalAlign?: CustomBlockStyle['verticalAlign']; onVerticalAlignChange?(value: CustomBlockStyle['verticalAlign']): void }) {
  return <CanvasTextBoxContext.Provider value={{ verticalAlign, onVerticalAlignChange }}><RenderedBlock block={block as PaginatedBlock} library={library} assets={assets} document={document} template={template} marginIn={marginIn} onBlockChange={onBlockChange} /></CanvasTextBoxContext.Provider>;
}

export function DocumentView({ document: bulletin, template, library, root, print = false, rulers = true, guides = false, zoom = .72, singlePage = false, bookletMode, onBlockSelect, onBlockChange, onReady }: {
  document: BulletinDocumentV1;
  template: TemplateV1;
  library?: LibraryManifestV1;
  root?: string;
  print?: boolean;
  rulers?: boolean;
  guides?: boolean;
  zoom?: number;
  singlePage?: boolean;
  bookletMode?: 'reading' | 'printer';
  onBlockSelect?(blockId: string): void;
  onBlockChange?(block: BulletinBlock): void;
  onReady?(): void;
}) {
  const fontsReady = useLibraryFontsReady();
  const effectiveTemplate = templateForBulletin(template, bulletin);
  const renderDocument = useMemo(() => ({ ...bulletin, responsiveReading: effectiveResponsiveReadingSettings(effectiveTemplate, bulletin) }), [bulletin, effectiveTemplate]);
  const [assets, setAssets] = useState<Record<string, string>>({});
  const refs = useMemo(() => [...new Map(flattenBlocks(bulletin.blocks).flatMap(block => {
    const result: AssetRef[] = [];
    if ('asset' in block && block.asset) result.push(block.asset);
    if (block.type === 'canvas') {
      result.push(...canvasAssetRefs(block.scene));
      for (const native of canvasNativeBlocks(block.scene)) {
        if ('libraryItemId' in native) result.push(...(library?.items.filter(item => item.id === native.libraryItemId && (!native.libraryItemVersion || item.version === native.libraryItemVersion)).sort((a, b) => b.version - a.version)[0]?.assets ?? []));
      }
    }
    if (block.type === 'churchInfo' && block.heroAsset) result.push(block.heroAsset);
    if (block.type === 'announcements') result.push(...block.items.flatMap(item => item.asset ? [item.asset] : []));
    if (block.type === 'list') result.push(...block.items.flatMap(item => item.asset ? [item.asset] : []));
    if ('libraryItemId' in block) result.push(...(library?.items.filter(item => item.id === block.libraryItemId && (!block.libraryItemVersion || item.version === block.libraryItemVersion)).sort((a, b) => b.version - a.version)[0]?.assets ?? []));
    return result;
  }).map(ref => [ref.path, ref])).values()], [bulletin.blocks, library]);
  useEffect(() => {
    if (!root || !window.bulletin) return;
    let active = true;
    void Promise.all(refs.map(async ref => [ref.path, await window.bulletin!.readAsset(root, ref.path)] as const)).then(entries => { if (active) setAssets(Object.fromEntries(entries)); });
    return () => { active = false; };
  }, [root, refs]);
  useEffect(() => {
    const expected = refs.length;
    if (!onReady || !fontsReady || Object.keys(assets).length < expected) return;
    void window.document.fonts.ready.then(() => new Promise<void>(resolve => setTimeout(resolve, 500))).then(onReady);
  }, [assets, refs, fontsReady, onReady]);
  const allPages = paginate(bulletin.blocks, effectiveTemplate, library, renderDocument);
  const pages = singlePage
    ? allPages.length ? allPages.slice(0, 1) : [{ number: 1, kind: 'content' as const, blocks: [] }]
    : allPages;
  const roleVariables = Object.fromEntries(effectiveFontRoles(effectiveTemplate.theme, library).map(role => [`--font-role-${role.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`, familyCssName(role.family, library) ?? 'sans-serif']));
  const stackProps = {
    className: `document-stack ${print ? 'is-print' : ''} ${bookletMode ? 'is-booklet' : ''} ${onBlockSelect && !print ? 'is-interactive' : ''}`,
    onClickCapture: onBlockSelect && !print ? (event: React.MouseEvent<HTMLDivElement>) => {
    const block = (event.target as Element).closest<HTMLElement>('[data-block-id]');
    if (block && event.currentTarget.contains(block) && block.dataset.blockId) onBlockSelect(block.dataset.blockId);
    } : undefined,
    style: {
    ...roleVariables,
    '--body-font': 'var(--font-role-body)', '--display-font': 'var(--font-role-display, var(--font-role-body))',
    '--ink': effectiveTemplate.theme.ink, '--accent': effectiveTemplate.theme.accent,
    '--body-size': `${effectiveTemplate.theme.bodySizePt}pt`, '--line-height': effectiveTemplate.theme.lineHeight,
    '--page-margin': `${effectiveTemplate.theme.marginIn}in`,
    '--preview-scale': zoom,
    '--preview-inverse-scale': 1 / zoom,
    '--preview-page-width': `${672 * zoom}px`,
    '--preview-page-height': `${816 * zoom}px`
    } as React.CSSProperties
  };
  const renderPage = (page: typeof pages[number], key: React.Key) => <div className={`page-frame ${rulers && !print ? 'with-rulers' : ''}`} key={key} style={page.marginIn !== undefined ? { '--page-margin': `${page.marginIn}in` } as React.CSSProperties : undefined}>{rulers && !print && <><PageRulers /><div className="page-crosshairs" aria-hidden="true"><i className="crosshair-vertical" /><i className="crosshair-horizontal" /></div></>}<article className={`document-page page-kind-${page.kind}`} onPointerMove={rulers && !print ? trackPointer : undefined} onPointerLeave={rulers && !print ? stopTrackingPointer : undefined}>
      {guides && !print && <div className="page-guides" aria-hidden="true" />}
      <div className="page-content">{page.blocks.map(block => <RenderedBlock key={block.id} block={block} library={library} assets={assets} document={renderDocument} template={effectiveTemplate} marginIn={page.marginIn ?? effectiveTemplate.theme.marginIn} onBlockChange={!print && onBlockChange ? changed => {
        if (!block.sourceBlockId) { onBlockChange(changed); return; }
        const source = findBlock(bulletin.blocks, block.sourceBlockId);
        if (source) onBlockChange(mergePaginatedEdit(source, block, changed, library));
      } : undefined} />)}</div>
      {page.kind === 'content' && page.number > 1 && page.blocks[0]?.type !== 'templatePage' && <div className="page-number">{page.number}</div>}
    </article></div>;
  if (bookletMode) {
    const spreads = bookletMode === 'printer' ? bookletPrinterSpreads(pages.length) : bookletReadingSpreads(pages.length);
    return <div {...stackProps}>{spreads.map((spread, index) => <section className="booklet-spread" key={`${bookletMode}-${index}`}>
      <header><b>{bookletMode === 'printer' ? `Sheet ${spread.sheet} · ${spread.side}` : index === 0 ? 'Front cover' : index === spreads.length - 1 ? 'Back cover' : `Pages ${spread.leftPage}–${spread.rightPage}`}</b><span>{bookletMode === 'printer' ? `${spread.leftPage} | ${spread.rightPage}` : 'Booklet open view'}</span></header>
      <div className="booklet-spread-pages">
        {[spread.leftPage, spread.rightPage].map((pageNumber, sideIndex) => <div className="booklet-page-slot" key={`${index}-${sideIndex}`}>
          {pageNumber && pages[pageNumber - 1] ? renderPage(pages[pageNumber - 1], `${index}-${sideIndex}-${pageNumber}`) : <div className="booklet-blank-page"><span>Blank</span></div>}
          <small>{pageNumber ? `Page ${pageNumber}` : 'Outside cover'}</small>
        </div>)}
      </div>
    </section>)}</div>;
  }
  return <div {...stackProps}>{pages.map(page => renderPage(page, page.number))}</div>;
}
