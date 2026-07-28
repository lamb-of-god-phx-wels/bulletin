import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { BlockFormattingModal } from './BlockFormattingModal';
import { BlockLibraryModal } from './BlockLibraryModal';
import { ScriptureEditor } from './ScriptureEditor';
import { CanvasCoverDesigner } from './CanvasCoverDesigner';
import { SortableHandle, SortableItem, SortableList } from './SortableList';
import { instantiateComponentDefinition } from '../componentDefinitions';
import { childBlocks, findBlock, flattenBlocks, updateBlockTree } from '../shared/blocks';
import { libraryFamilies } from '../shared/library';
import { paragraphsFromPlainText } from '../shared/plainText';
import { defaultReaderForRole, responsiveEntryRole } from '../shared/responsiveReading';
import { scriptureElementNames } from '../shared/scriptureReading';
import { insertWeeklyBlock, removeWeeklyBlock } from '../shared/weeklyBlocks';
import type { BulletinBlock, BulletinDocumentV1, LibraryManifestV1, Paragraph, TemplateV1 } from '../shared/types';

const paragraphs = (text: string): Paragraph[] => paragraphsFromPlainText(text);
const paragraphText = (content: Paragraph[]) => content.map(p => p.children.map(c => c.type === 'text' ? c.text : c.type === 'lineBreak' ? '\n' : '✠').join('')).join('\n\n');
export function WeeklyEditor({ document, template, library, root, relativePath, onChange, onLibraryChange, onError }: { document: BulletinDocumentV1; template: TemplateV1; library?: LibraryManifestV1; root?: string; relativePath: string; onChange(document: BulletinDocumentV1): void; onLibraryChange(library: LibraryManifestV1): Promise<void>; onError(message: string): void }) {
  const [formattingBlockId, setFormattingBlockId] = useState<string>();
  const [canvasBlockId, setCanvasBlockId] = useState<string>();
  const [formatPickerOpen, setFormatPickerOpen] = useState(false);
  const [blockLibraryIndex, setBlockLibraryIndex] = useState<number>();
  const [pendingAddedBlockId, setPendingAddedBlockId] = useState<string>();
  const [lookupStatus, setLookupStatus] = useState<Record<string, { state: 'loading' | 'success' | 'error'; text: string }>>({});
  const songFamilies = libraryFamilies(library?.items.filter(item => item.kind === 'song') ?? []);
  const liturgyFamilies = libraryFamilies(library?.items.filter(item => item.kind === 'liturgy') ?? []);
  const missingLibraryReference = (block: BulletinBlock) => (block.type === 'song' || block.type === 'libraryText') && Boolean(library) && !library!.items.some(item => item.id === block.libraryItemId && (!block.libraryItemVersion || item.version === block.libraryItemVersion));
  const hasWeeklyCustomBindings = (block: BulletinBlock) => block.type === 'custom' && block.bindings.some(binding => binding.source === 'weekly');
  const updateInfo = (key: keyof BulletinDocumentV1['info'], value: string) => onChange({ ...document, info: { ...document.info, [key]: value } });
  const updateChurchName = (name: string) => onChange({ ...document, church: { ...document.church, name } });
  const updatePageMargin = (marginIn: number) => onChange({ ...document, layout: { ...document.layout, marginIn: Math.max(0, Math.min(1.25, marginIn)) } });
  const resetPageMargin = () => { const layout = { ...document.layout }; delete layout.marginIn; onChange({ ...document, layout: Object.keys(layout).length ? layout : undefined }); };
  const updateBlock = (id: string, next: BulletinBlock) => onChange({ ...document, blocks: updateBlockTree(document.blocks, id, next) });
  const paragraphHeader = (block: BulletinBlock) => { const header = block.type === 'paragraph' ? childBlocks(block)?.find(child => child.type === 'richText' && child.role === 'header') : undefined; return header?.type === 'richText' ? paragraphText(header.content) : ''; };
  const blockName = (block: BulletinBlock) => block.type === 'custom' ? block.name : block.type === 'paragraph' ? paragraphHeader(block) || 'Paragraph' : block.type === 'richText' && block.scriptureRole ? scriptureElementNames[block.scriptureRole] : block.type === 'richText' && block.role ? (block.role === 'header' ? 'Header text' : 'Paragraph text') : block.label ?? ('text' in block ? block.text : block.type === 'announcements' ? 'Announcements' : block.type === 'titlePage' || block.type === 'canvasCover' ? 'Cover' : block.type);
  const updateChildren = (parent: BulletinBlock, children: BulletinBlock[]) => {
    if (parent.type === 'churchInfo' || parent.type === 'group') updateBlock(parent.id, { ...parent, children });
    if (parent.type === 'paragraph') updateBlock(parent.id, { ...parent, children: children.filter(child => child.type === 'richText') });
  };
  const nestedEditors = (parent: BulletinBlock): ReactNode => {
    const children = childBlocks(parent) ?? [];
    const isParagraph = parent.type === 'paragraph';
    const isScripture = parent.type === 'scriptureReading';
    const reorderable = !isParagraph && !isScripture;
    const editors = children.map(child => {
      const editor = <details className="nested-block-editor collapsible-editor" data-editor-block-id={child.id} tabIndex={-1}>
        <summary><div><span className="block-type">{child.type}{child.presentation ? ' · formatted' : ''}</span><b>{blockName(child)}</b></div><div className="reorder" onClick={event => event.preventDefault()}>
          <button className="format-block-button" onClick={() => setFormattingBlockId(child.id)}>Format</button>
          {!isScripture && (!isParagraph || child.role === 'header') && <button className="danger-text" title="Remove element" onClick={() => updateChildren(parent, children.filter(item => item.id !== child.id))}>×</button>}
          {reorderable && <SortableHandle label={`Drag ${blockName(child)} to reorder`} />}
        </div></summary>
        <div className="collapsible-editor-fields">{isScripture
          ? <p className="helper">Edit this element’s content above. Use Format for its width, placement, spacing, typography, fill, and border.</p>
          : <>{(child.type === 'heading' || child.type === 'sectionHeading' || child.type === 'sermonTitle') && <label>Heading<input value={child.text} onChange={event => updateBlock(child.id, { ...child, text: event.target.value })} /></label>}{child.type === 'richText' && <label>{child.role === 'header' ? 'Header text' : child.role === 'body' ? 'Paragraph text' : 'Text'}<textarea rows={child.role === 'header' ? 2 : 4} value={paragraphText(child.content)} onChange={event => updateBlock(child.id, { ...child, content: paragraphs(event.target.value) })} /></label>}{childBlocks(child) && nestedEditors(child)}</>}
        </div>
      </details>;
      return reorderable ? <SortableItem id={child.id} key={child.id}>{editor}</SortableItem> : <Fragment key={child.id}>{editor}</Fragment>;
    });
    return <div className="nested-blocks">
      <div className="nested-blocks-heading"><b>{isScripture ? 'Element layout' : isParagraph ? 'Text blocks' : 'Paragraphs'}</b><span>{isScripture ? 'Heading, reference, caption, and body can be positioned and formatted independently.' : isParagraph ? 'Header and body formatting are completely independent.' : 'Each paragraph keeps its header and body together.'}</span></div>
      {reorderable ? <SortableList items={children} onChange={next => updateChildren(parent, next)}>{editors}</SortableList> : editors}
      {!isScripture && <div className="nested-add-actions">{isParagraph ? !children.some(child => child.type === 'richText' && child.role === 'header') && <button className="secondary" onClick={() => updateChildren(parent, [{ id: `${parent.id}-header`, type: 'richText', role: 'header', content: paragraphs('New heading'), presentation: { fontWeight: 'bold', marginIn: { top: 0, bottom: 0 }, paddingIn: { top: 0, right: 0, bottom: 0, left: 0 } } }, ...children])}>＋ Header</button> : <button className="secondary" onClick={() => updateChildren(parent, [...children, { id: `paragraph-${Date.now()}`, type: 'paragraph', children: [{ id: `paragraph-body-${Date.now()}`, type: 'richText', role: 'body', content: paragraphs('New text'), presentation: { marginIn: { top: 0, bottom: 0 }, paddingIn: { top: 0, right: 0, bottom: 0, left: 0 } } }] }])}>＋ Paragraph</button>}</div>}
    </div>;
  };
  const addBlock = (definition: Parameters<typeof instantiateComponentDefinition>[0]) => {
    const block = { ...instantiateComponentDefinition(definition), weeklyEditable: true } as BulletinBlock;
    onChange({ ...document, blocks: insertWeeklyBlock(document.blocks, block, blockLibraryIndex) });
    setPendingAddedBlockId(block.id);
    setBlockLibraryIndex(undefined);
  };
  useEffect(() => {
    if (!pendingAddedBlockId) return;
    const target = window.document.querySelector<HTMLElement>(`[data-editor-block-id="${CSS.escape(pendingAddedBlockId)}"]`);
    if (!target) return;
    if (target instanceof HTMLDetailsElement) target.open = true;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('editor-block-focus');
    const timer = window.setTimeout(() => target.classList.remove('editor-block-focus'), 1800);
    setPendingAddedBlockId(undefined);
    return () => window.clearTimeout(timer);
  }, [document.blocks, pendingAddedBlockId]);
  const addPage = async () => {
    if (!root || !window.bulletin) return;
    try {
      const asset = await window.bulletin.importAsset(root, `${relativePath.replace(/[/\\]bulletin\.json$/, '')}/assets`);
      if (!asset) return;
      onChange({ ...document, blocks: [...document.blocks, { id: `page-${Date.now()}`, type: 'fullPageAsset', asset, weeklyEditable: true }] });
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  };
  const chooseBlockAsset = async (block: Extract<BulletinBlock, { type: 'titlePage' | 'song' | 'fullPageAsset' }>) => {
    if (!root || !window.bulletin) return;
    try {
      const asset = await window.bulletin.importAsset(root, `${relativePath.replace(/[/\\]bulletin\.json$/, '')}/assets`);
      if (asset) updateBlock(block.id, { ...block, asset });
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  };
  const chooseCanvasAsset = async () => {
    if (!root || !window.bulletin) return null;
    try { return await window.bulletin.importAsset(root, `${relativePath.replace(/[/\\]bulletin\.json$/, '')}/assets`); }
    catch (error) { onError(error instanceof Error ? error.message : String(error)); return null; }
  };
  const lookup = async (block: Extract<BulletinBlock, { type: 'scriptureReading' }>) => {
    if (!window.bulletin) {
      setLookupStatus(current => ({ ...current, [block.id]: { state: 'error', text: 'Passage import is unavailable. Open the passage and paste the approved text manually.' } }));
      return;
    }
    setLookupStatus(current => ({ ...current, [block.id]: { state: 'loading', text: 'Loading the public Bible Gateway passage…' } }));
    try {
      const resolved = await window.bulletin.lookupScripture({ reference: block.reference, translation: block.translation });
      updateBlock(block.id, { ...block, resolved });
      setLookupStatus(current => ({ ...current, [block.id]: { state: 'success', text: `Added ${block.reference} (${block.translation.toUpperCase()}).` } }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLookupStatus(current => ({ ...current, [block.id]: { state: 'error', text: message } }));
      onError(message);
    }
  };
  const openScripture = async (block: Extract<BulletinBlock, { type: 'scriptureReading' }>) => {
    try {
      if (window.bulletin) await window.bulletin.openScripture(block.reference, block.translation);
      else window.open(`https://www.biblegateway.com/passage/?search=${encodeURIComponent(block.reference)}&version=${encodeURIComponent(block.translation)}`, '_blank', 'noopener,noreferrer');
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  };
  return <div className="editor-scroll">
    <section className="editor-card essentials"><div className="eyebrow">This Sunday</div><label>Service date<input type="date" value={document.info.date} onChange={e => updateInfo('date', e.target.value)} /></label><label>Church week<input value={document.info.churchWeek} onChange={e => updateInfo('churchWeek', e.target.value)} /></label><label>Series<input value={document.info.series ?? ''} onChange={e => updateInfo('series', e.target.value)} /></label><label>Sermon title<input value={document.info.title} onChange={e => updateInfo('title', e.target.value)} /></label><label>Church name<input value={document.church.name} onChange={e => updateChurchName(e.target.value)} /></label><div className="page-margin-control"><label>Page margin (inches)<input type="number" min="0" max="1.25" step="0.05" value={document.layout?.marginIn ?? template.theme.marginIn} onChange={event => { if (Number.isFinite(event.currentTarget.valueAsNumber)) updatePageMargin(event.currentTarget.valueAsNumber); }} /><small className="field-help">Applies to this bulletin only. Template default: {template.theme.marginIn} in.</small></label><button type="button" className="text-button" disabled={document.layout?.marginIn === undefined} onClick={resetPageMargin}>Use template margin</button></div></section>
    <div className="scripture-source-note"><b>Bible Gateway passage import</b><span>No login required. The displayed publisher notice is saved with the passage; verify that your bulletin stays within the translation’s quotation terms.</span></div>
    <div className="editor-section-title"><div><div className="eyebrow">Order of worship</div><h2>Weekly content</h2><small>{document.blocks.length} blocks · changes apply only to this bulletin</small></div><div className="weekly-content-actions"><button className="primary" onClick={() => setBlockLibraryIndex(document.blocks.length)}>＋ Add block</button><button className="secondary" onClick={() => setFormatPickerOpen(true)}>Fine-tune layout</button><button className="secondary" onClick={addPage}>＋ One-off page</button></div></div>
    <SortableList items={document.blocks} onChange={blocks => onChange({ ...document, blocks })}>{document.blocks.map((block, index) => <SortableItem id={block.id} key={block.id}><details className="editor-card block-editor collapsible-editor" data-editor-block-id={block.id} tabIndex={-1}>
      <summary><div><span className="block-type">{block.type}{block.presentation ? ' · formatted' : ''}</span><h3>{blockName(block)}</h3></div><div className="reorder" onClick={event => event.preventDefault()}><button className="format-block-button" title="Format block" onClick={() => setFormattingBlockId(block.id)}>Format</button><button title={`Add block after ${blockName(block)}`} aria-label={`Add block after ${blockName(block)}`} onClick={() => setBlockLibraryIndex(index + 1)}>＋</button><button className="danger-text" title={`Remove ${blockName(block)}`} aria-label={`Remove ${blockName(block)}`} onClick={() => onChange({ ...document, blocks: removeWeeklyBlock(document.blocks, block.id) })}>×</button><SortableHandle label={`Drag ${blockName(block)} to reorder`} /></div></summary><div className="collapsible-editor-fields">
      {missingLibraryReference(block) && !block.weeklyEditable && <div className="missing-template-content"><b>Template content needs attention</b><span>This block is normally hidden during weekly editing, but its library item is missing. Choose a replacement below or remove it from this bulletin.</span></div>}
      {(block.type === 'sermonTitle' || block.type === 'heading' || block.type === 'sectionHeading') && <label>Text<input value={block.text} onChange={e => updateBlock(block.id, { ...block, text: e.target.value })} /></label>}
      {block.type === 'richText' && <label>Text<textarea rows={6} value={paragraphText(block.content)} onChange={event => updateBlock(block.id, { ...block, content: paragraphs(event.target.value) })} /></label>}
      {block.type === 'paragraph' && nestedEditors(block)}
      {block.type === 'responsiveReading' && <>
        {block.entries.map((entry, entryIndex) => {
          const role = responsiveEntryRole(entry);
          const updateEntry = (changes: Partial<typeof entry>) => updateBlock(block.id, { ...block, entries: block.entries.map((item, index) => index === entryIndex ? { ...item, ...changes } : item) });
          return <div className={`response-editor response-editor-${role}`} key={entryIndex}>
            <div className="field-row">
              <label>Role<select value={role} onChange={event => {
                const nextRole = event.target.value as 'leader' | 'follower';
                updateEntry({ role: nextRole, reader: /^[MC]$/i.test(entry.reader.trim()) ? defaultReaderForRole(nextRole) : entry.reader });
              }}><option value="leader">Leader</option><option value="follower">Follower / congregation</option></select></label>
              <label>Speaker label<input value={entry.reader} onChange={event => updateEntry({ reader: event.target.value })} /></label>
            </div>
            <label>{role === 'follower' ? 'Follower response' : 'Leader response'}<textarea rows={4} value={paragraphText(entry.content)} onChange={event => updateEntry({ content: paragraphs(event.target.value) })} /></label>
            <button className="danger-text" onClick={() => updateBlock(block.id, { ...block, entries: block.entries.filter((_item, index) => index !== entryIndex) })}>Remove response</button>
          </div>;
        })}
        <div className="response-add-actions">
          <button className="secondary" onClick={() => updateBlock(block.id, { ...block, entries: [...block.entries, { role: 'leader', reader: 'M', content: paragraphs('New leader response') }] })}>＋ Leader</button>
          <button className="secondary" onClick={() => updateBlock(block.id, { ...block, entries: [...block.entries, { role: 'follower', reader: 'C', content: paragraphs('New follower response') }] })}>＋ Follower</button>
        </div>
      </>}
      {block.type === 'scriptureReading' && <>
        <div className="field-row">
          <label>Heading (optional)<input value={block.label ?? ''} placeholder="First Reading" onChange={e => updateBlock(block.id, { ...block, label: e.target.value || undefined })} /></label>
          <label>Scripture reference<input value={block.reference} placeholder="Matthew 9:9-13" onChange={e => updateBlock(block.id, { ...block, reference: e.target.value, resolved: undefined })} /></label>
        </div>
        <div className="field-row">
          <label>Heading and reference<select value={block.headingReferenceLayout ?? 'inline'} onChange={event => updateBlock(block.id, { ...block, headingReferenceLayout: event.target.value as 'inline' | 'stacked' })}><option value="inline">Same line</option><option value="stacked">Stacked</option></select></label>
          <label>Space between (inches)<input type="number" min="0" max="2" step="0.01" disabled={(block.headingReferenceLayout ?? 'inline') !== 'inline'} value={block.headingReferenceGapIn ?? 0.12} onChange={event => { if (Number.isFinite(event.currentTarget.valueAsNumber)) updateBlock(block.id, { ...block, headingReferenceGapIn: Math.max(0, event.currentTarget.valueAsNumber) }); }} /></label>
        </div>
        <div className="field-row">
          <label>Caption (optional)<textarea rows={2} value={block.caption ?? ''} onChange={e => updateBlock(block.id, { ...block, caption: e.target.value || undefined })} /></label>
          <label>Translation code<input value={block.translation} placeholder="NIV" onChange={e => updateBlock(block.id, { ...block, translation: e.target.value, resolved: undefined })} /></label>
        </div>
        <div className="scripture-actions"><button className="secondary scripture-fetch" disabled={lookupStatus[block.id]?.state === 'loading' || !block.reference.trim()} onClick={() => lookup(block)}>{lookupStatus[block.id]?.state === 'loading' ? 'Importing…' : 'Import passage'}</button><button className="text-button" onClick={() => openScripture(block)}>Open on Bible Gateway ↗</button></div>
        {lookupStatus[block.id] && <p className={`lookup-status ${lookupStatus[block.id].state}`} role="status" aria-live="polite">{lookupStatus[block.id].text}</p>}
        <details><summary>Body — passage text or manual fallback</summary><ScriptureEditor content={block.resolved?.content ?? [{ type: 'paragraph', children: [{ type: 'text', text: '' }] }]} onChange={content => updateBlock(block.id, { ...block, resolved: block.resolved ? { ...block.resolved, content } : { content, source: 'manual', retrievedAt: new Date().toISOString(), attribution: `${block.translation.toUpperCase()} — text supplied by user` } })} /></details>
        {nestedEditors(block)}
      </>}
      {block.type === 'song' && (() => { const family = songFamilies.find(item => item.id === block.libraryItemId); const selected = family?.versions.find(item => item.version === block.libraryItemVersion) ?? family?.versions[0]; return <><div className="field-row"><label>Library song<select value={block.libraryItemId} onChange={e => { const nextFamily = songFamilies.find(item => item.id === e.target.value); updateBlock(block.id, { ...block, libraryItemId: e.target.value, libraryItemVersion: nextFamily?.versions[0]?.version, contentOverride: undefined }); }}><option value="">Choose a song…</option>{songFamilies.map(item => <option value={item.id} key={item.id}>{item.versions[0].title}</option>)}</select></label><label>Version<select aria-label={`Version for ${block.id}`} disabled={!family} value={selected?.version ?? ''} onChange={event => updateBlock(block.id, { ...block, libraryItemVersion: Number(event.target.value), contentOverride: undefined })}><option value="">Choose a song first</option>{family?.versions.map(item => <option value={item.version} key={item.version}>v{item.version}{item.title !== family.versions[0].title ? ` · ${item.title}` : ''}</option>)}</select></label></div><div className="field-row"><label>Display title<input value={block.title ?? ''} onChange={e => updateBlock(block.id, { ...block, title: e.target.value })} /></label><label>Presentation<select value={block.renderMode} onChange={e => updateBlock(block.id, { ...block, renderMode: e.target.value as 'lyrics' | 'asset' })}><option value="lyrics">Lyrics</option><option value="asset">Music image</option></select></label></div>{block.renderMode === 'lyrics' && <details><summary>Edit lyrics for this bulletin</summary><textarea rows={10} value={paragraphText(block.contentOverride ?? selected?.content ?? [])} placeholder="Enter song lyrics…" onChange={event => updateBlock(block.id, { ...block, contentOverride: paragraphsFromPlainText(event.target.value, { preserveLineBreaks: true }) })} />{block.contentOverride && <button className="danger-text content-reset" onClick={() => updateBlock(block.id, { ...block, contentOverride: undefined })}>Restore library lyrics</button>}</details>}{block.renderMode === 'asset' && <button className="secondary" onClick={() => chooseBlockAsset(block)}>{block.asset ? `Replace ${block.asset.alt ?? 'asset'}` : 'Choose music image or PDF'}</button>}</>; })()}
      {block.type === 'libraryText' && (() => { const family = liturgyFamilies.find(item => item.id === block.libraryItemId); const selected = family?.versions.find(item => item.version === block.libraryItemVersion) ?? family?.versions[0]; return <><div className="field-row"><label>Library text<select value={block.libraryItemId} onChange={e => { const nextFamily = liturgyFamilies.find(item => item.id === e.target.value); updateBlock(block.id, { ...block, libraryItemId: e.target.value, libraryItemVersion: nextFamily?.versions[0]?.version, contentOverride: undefined }); }}><option value="">Choose reusable text…</option>{missingLibraryReference(block) && <option value={block.libraryItemId}>Missing: {block.title ?? block.libraryItemId}</option>}{liturgyFamilies.map(item => <option value={item.id} key={item.id}>{item.versions[0].title}</option>)}</select></label><label>Version<select aria-label={`Version for ${block.id}`} disabled={!family} value={selected?.version ?? ''} onChange={event => updateBlock(block.id, { ...block, libraryItemVersion: Number(event.target.value), contentOverride: undefined })}><option value="">Choose text first</option>{family?.versions.map(item => <option value={item.version} key={item.version}>v{item.version}{item.title !== family.versions[0].title ? ` · ${item.title}` : ''}</option>)}</select></label></div><details><summary>Edit reusable text for this bulletin</summary><textarea rows={8} value={paragraphText(block.contentOverride ?? selected?.content ?? [])} onChange={event => updateBlock(block.id, { ...block, contentOverride: paragraphs(event.target.value) })} />{block.contentOverride && <button className="danger-text content-reset" onClick={() => updateBlock(block.id, { ...block, contentOverride: undefined })}>Restore library text</button>}</details></>; })()}
      {block.type === 'announcements' && <>{block.items.map((item, itemIndex) => <div className="announcement-editor" key={item.id}><label>Title<input value={item.title} onChange={e => updateBlock(block.id, { ...block, items: block.items.map((old, i) => i === itemIndex ? { ...old, title: e.target.value } : old) })} /></label><label>Details<textarea rows={4} value={paragraphText(item.content)} onChange={e => updateBlock(block.id, { ...block, items: block.items.map((old, i) => i === itemIndex ? { ...old, content: paragraphs(e.target.value) } : old) })} /></label></div>)}<button className="secondary" onClick={() => updateBlock(block.id, { ...block, items: [...block.items, { id: `announcement-${Date.now()}`, title: 'New announcement', content: [paragraphs('')[0]] }] })}>＋ Announcement</button></>}
      {block.type === 'custom' && <div className="custom-weekly-fields"><div className="field-row"><label>Block heading<input value={block.name} onChange={event => updateBlock(block.id, { ...block, name: event.target.value, label: event.target.value })} /></label><label>Content layout<textarea rows={3} value={block.layoutText} onChange={event => updateBlock(block.id, { ...block, layoutText: event.target.value })} /></label></div>{block.bindings.filter(binding => binding.source === 'weekly').map(binding => <label key={binding.key}>{binding.label}{binding.multiline
        ? <textarea rows={4} value={block.values?.[binding.key] ?? binding.defaultValue ?? ''} onChange={event => updateBlock(block.id, { ...block, values: { ...block.values, [binding.key]: event.target.value } })} />
        : <input value={block.values?.[binding.key] ?? binding.defaultValue ?? ''} onChange={event => updateBlock(block.id, { ...block, values: { ...block.values, [binding.key]: event.target.value } })} />}</label>)}{!hasWeeklyCustomBindings(block) && <p className="helper">This block is filled automatically from bulletin details.</p>}</div>}
      {block.type === 'titlePage' && <><p className="helper">Use the standard cover or replace it for this week with a complete image/PDF page.</p><button className="secondary" onClick={() => chooseBlockAsset(block)}>{block.asset ? `Replace ${block.asset.alt ?? 'cover'}` : 'Choose custom cover'}</button>{block.asset && <button className="danger-text" onClick={() => { const { asset: _asset, ...standard } = block; updateBlock(block.id, standard); }}>Use standard cover</button>}</>}
      {block.type === 'canvasCover' && <><p className="helper">Position cover text, artwork, shapes, and bound bulletin fields on a precise inch-based canvas.</p><button className="primary" onClick={() => setCanvasBlockId(block.id)}>Open cover designer</button>{block.weeklyScene && <button className="danger-text" onClick={() => { const { weeklyScene: _weeklyScene, weeklyUnlockedElementIds: _unlocked, ...templateCover } = block; updateBlock(block.id, templateCover); }}>Reset all weekly cover changes</button>}</>}
      {(block.type === 'churchInfo' || block.type === 'group') && nestedEditors(block)}
      {block.type === 'copyright' && <label>Additional copyright text<textarea rows={5} value={paragraphText(block.extra ?? [])} placeholder="Library and Scripture notices are generated automatically." onChange={event => {
        const text = event.target.value;
        const next = { ...block };
        if (text.trim()) next.extra = paragraphs(text);
        else delete next.extra;
        updateBlock(block.id, next);
      }} /></label>}
      {block.type === 'spacer' && <label>Spacer size<select value={block.size} onChange={event => updateBlock(block.id, { ...block, size: event.target.value as 'small' | 'medium' | 'large' })}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>}
      {block.type === 'fullPageAsset' && <><p className="helper">{block.asset.alt ?? block.asset.path}</p><div className="builder-actions"><button className="secondary" onClick={() => chooseBlockAsset(block)}>Replace page asset</button><button className="danger-text" onClick={() => onChange({ ...document, blocks: removeWeeklyBlock(document.blocks, block.id) })}>Remove page</button></div></>}
      {missingLibraryReference(block) && !block.weeklyEditable && <button className="danger-text" onClick={() => onChange({ ...document, blocks: document.blocks.filter(item => item.id !== block.id) })}>Remove from this bulletin</button>}
      </div>
    </details></SortableItem>)}</SortableList>
    {blockLibraryIndex !== undefined && <BlockLibraryModal workspaceDefinitions={library?.componentDefinitions ?? []} template={template} library={library} root={root} onClose={() => setBlockLibraryIndex(undefined)} onUsePrepackaged={addBlock} onUseDefinition={addBlock} onSaveDefinition={async definition => onLibraryChange({ ...(library ?? { schemaVersion: 1, name: 'Shared Library', items: [] }), componentDefinitions: [...(library?.componentDefinitions ?? []), definition] })} onDeleteDefinition={async definition => onLibraryChange({ ...(library ?? { schemaVersion: 1, name: 'Shared Library', items: [] }), componentDefinitions: (library?.componentDefinitions ?? []).filter(item => item.type !== definition.type || item.version !== definition.version) })} />}
    {formatPickerOpen && <div className="modal-backdrop block-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setFormatPickerOpen(false); }}><section className="weekly-block-picker" role="dialog" aria-modal="true" aria-labelledby="weekly-format-title"><header><div><div className="eyebrow">This bulletin only</div><h2 id="weekly-format-title">Choose a block to fine-tune</h2><p>Every block and nested element can have its own weekly layout override.</p></div><button aria-label="Close block picker" onClick={() => setFormatPickerOpen(false)}>×</button></header><div>{flattenBlocks(document.blocks).map((block, index) => <button key={block.id} onClick={() => { setFormattingBlockId(block.id); setFormatPickerOpen(false); }}><span>{index + 1}</span><div><b>{blockName(block)}</b><small>{block.type}{block.presentation ? ' · Formatted' : ''}</small></div><strong>Format</strong></button>)}</div></section></div>}
    {formattingBlockId && (() => { const block = findBlock(document.blocks, formattingBlockId); return block ? <BlockFormattingModal block={block} template={template} scope="weekly" onClose={() => setFormattingBlockId(undefined)} onSave={(presentation, layout) => { updateBlock(block.id, { ...block, presentation, layout }); setFormattingBlockId(undefined); }} /> : null; })()}
    {canvasBlockId && (() => { const block = findBlock(document.blocks, canvasBlockId); return block?.type === 'canvasCover' ? <CanvasCoverDesigner block={block} document={document} mode="weekly" marginIn={document.layout?.marginIn ?? template.theme.marginIn} assets={{}} root={root} onChooseAsset={chooseCanvasAsset} onChange={next => updateBlock(next.id, next)} onClose={() => setCanvasBlockId(undefined)} /> : null; })()}
  </div>;
}
