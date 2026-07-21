import { useState } from 'react';
import type { BulletinBlock, BulletinDocumentV1, LibraryManifestV1, Paragraph } from '../shared/types';

const paragraphs = (text: string): Paragraph[] => text.split(/\n\s*\n/).map(value => ({ type: 'paragraph', children: [{ type: 'text', text: value.replace(/\n/g, ' ') }] }));
const paragraphText = (content: Paragraph[]) => content.map(p => p.children.map(c => c.type === 'text' ? c.text : '✠').join('')).join('\n\n');

export function WeeklyEditor({ document, library, root, relativePath, onChange, onError }: { document: BulletinDocumentV1; library?: LibraryManifestV1; root?: string; relativePath: string; onChange(document: BulletinDocumentV1): void; onError(message: string): void }) {
  const [expanded, setExpanded] = useState<string>();
  const [lookupStatus, setLookupStatus] = useState<Record<string, { state: 'loading' | 'success' | 'error'; text: string }>>({});
  const songs = [...new Map(library?.items.filter(item => item.kind === 'song').sort((a, b) => a.version - b.version).map(item => [item.id, item])).values()];
  const missingLibraryReference = (block: BulletinBlock) => (block.type === 'song' || block.type === 'libraryText') && Boolean(library) && !library!.items.some(item => item.id === block.libraryItemId && (!block.libraryItemVersion || item.version === block.libraryItemVersion));
  const updateInfo = (key: keyof BulletinDocumentV1['info'], value: string) => onChange({ ...document, info: { ...document.info, [key]: value } });
  const updateBlock = (id: string, next: BulletinBlock) => onChange({ ...document, blocks: document.blocks.map(block => block.id === id ? next : block) });
  const move = (index: number, by: number) => {
    const next = [...document.blocks]; const target = index + by;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]]; onChange({ ...document, blocks: next });
  };
  const addPage = async () => {
    if (!root || !window.bulletin) return;
    try {
      const asset = await window.bulletin.importAsset(root, `${relativePath.replace(/[/\\]bulletin\.json$/, '')}/assets`);
      if (!asset) return;
      onChange({ ...document, blocks: [...document.blocks, { id: `page-${Date.now()}`, type: 'fullPageAsset', asset, weeklyEditable: true }] });
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  };
  const chooseBlockAsset = async (block: Extract<BulletinBlock, { type: 'titlePage' | 'song' }>) => {
    if (!root || !window.bulletin) return;
    try {
      const asset = await window.bulletin.importAsset(root, `${relativePath.replace(/[/\\]bulletin\.json$/, '')}/assets`);
      if (asset) updateBlock(block.id, { ...block, asset });
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
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
    <section className="editor-card essentials"><div className="eyebrow">This Sunday</div><label>Service date<input type="date" value={document.info.date} onChange={e => updateInfo('date', e.target.value)} /></label><label>Church week<input value={document.info.churchWeek} onChange={e => updateInfo('churchWeek', e.target.value)} /></label><label>Series<input value={document.info.series ?? ''} onChange={e => updateInfo('series', e.target.value)} /></label><label>Sermon title<input value={document.info.title} onChange={e => updateInfo('title', e.target.value)} /></label></section>
    <div className="scripture-source-note"><b>Bible Gateway passage import</b><span>No login required. The displayed publisher notice is saved with the passage; verify that your bulletin stays within the translation’s quotation terms.</span></div>
    <div className="editor-section-title"><div><div className="eyebrow">Order of worship</div><h2>Weekly content</h2></div><button className="secondary" onClick={addPage}>＋ One-off page</button></div>
    {document.blocks.map((block, index) => (block.weeklyEditable || missingLibraryReference(block)) && <section className="editor-card block-editor" key={block.id}>
      <header><div><span className="block-type">{block.type}</span><h3>{block.label ?? ('text' in block ? block.text : block.type === 'announcements' ? 'Announcements' : block.type === 'titlePage' ? 'Cover' : block.type)}</h3></div><div className="reorder"><button title="Move up" onClick={() => move(index, -1)}>↑</button><button title="Move down" onClick={() => move(index, 1)}>↓</button></div></header>
      {missingLibraryReference(block) && !block.weeklyEditable && <div className="missing-template-content"><b>Template content needs attention</b><span>This block is normally hidden during weekly editing, but its library item is missing. Choose a replacement below or remove it from this bulletin.</span></div>}
      {(block.type === 'sermonTitle' || block.type === 'heading' || block.type === 'sectionHeading') && <label>Text<input value={block.text} onChange={e => updateBlock(block.id, { ...block, text: e.target.value })} /></label>}
      {block.type === 'scriptureReading' && <><div className="field-row"><label>Reference<input value={block.reference} placeholder="Matthew 9:9-13" onChange={e => updateBlock(block.id, { ...block, reference: e.target.value, resolved: undefined })} /></label><label>Translation code<input value={block.translation} placeholder="NIV" onChange={e => updateBlock(block.id, { ...block, translation: e.target.value, resolved: undefined })} /></label></div><label>Introduction<textarea rows={2} value={block.caption ?? ''} onChange={e => updateBlock(block.id, { ...block, caption: e.target.value })} /></label><div className="scripture-actions"><button className="secondary scripture-fetch" disabled={lookupStatus[block.id]?.state === 'loading' || !block.reference.trim()} onClick={() => lookup(block)}>{lookupStatus[block.id]?.state === 'loading' ? 'Importing…' : 'Import passage'}</button><button className="text-button" onClick={() => openScripture(block)}>Open on Bible Gateway ↗</button></div>{lookupStatus[block.id] && <p className={`lookup-status ${lookupStatus[block.id].state}`} role="status" aria-live="polite">{lookupStatus[block.id].text}</p>}<details><summary>Passage text or manual fallback</summary><textarea rows={8} value={block.resolved ? paragraphText(block.resolved.content) : ''} placeholder="Paste the approved passage text here…" onChange={e => updateBlock(block.id, { ...block, resolved: { content: paragraphs(e.target.value), source: 'manual', retrievedAt: new Date().toISOString(), attribution: `${block.translation.toUpperCase()} — text supplied by user` } })} /></details></>}
      {block.type === 'song' && <><label>Library song<select value={block.libraryItemId} onChange={e => { const item = songs.find(song => song.id === e.target.value); updateBlock(block.id, { ...block, libraryItemId: e.target.value, libraryItemVersion: item?.version }); }}><option value="">Choose a song…</option>{songs.map(item => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label><div className="field-row"><label>Display title<input value={block.title ?? ''} onChange={e => updateBlock(block.id, { ...block, title: e.target.value })} /></label><label>Presentation<select value={block.renderMode} onChange={e => updateBlock(block.id, { ...block, renderMode: e.target.value as 'lyrics' | 'asset' })}><option value="lyrics">Lyrics</option><option value="asset">Music image</option></select></label></div>{block.renderMode === 'asset' && <button className="secondary" onClick={() => chooseBlockAsset(block)}>{block.asset ? `Replace ${block.asset.alt ?? 'asset'}` : 'Choose music image or PDF'}</button>}</>}
      {block.type === 'libraryText' && <label>Library text<select value={block.libraryItemId} onChange={e => { const item = library?.items.filter(item => item.kind === 'liturgy').sort((a, b) => b.version - a.version).find(item => item.id === e.target.value); updateBlock(block.id, { ...block, libraryItemId: e.target.value, libraryItemVersion: item?.version }); }}><option value="">Choose reusable text…</option>{missingLibraryReference(block) && <option value={block.libraryItemId}>Missing: {block.title ?? block.libraryItemId}</option>}{[...new Map(library?.items.filter(item => item.kind === 'liturgy').sort((a, b) => a.version - b.version).map(item => [item.id, item])).values()].map(item => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>}
      {block.type === 'announcements' && <>{block.items.map((item, itemIndex) => <div className="announcement-editor" key={item.id}><label>Title<input value={item.title} onChange={e => updateBlock(block.id, { ...block, items: block.items.map((old, i) => i === itemIndex ? { ...old, title: e.target.value } : old) })} /></label><label>Details<textarea rows={4} value={paragraphText(item.content)} onChange={e => updateBlock(block.id, { ...block, items: block.items.map((old, i) => i === itemIndex ? { ...old, content: paragraphs(e.target.value) } : old) })} /></label></div>)}<button className="secondary" onClick={() => updateBlock(block.id, { ...block, items: [...block.items, { id: `announcement-${Date.now()}`, title: 'New announcement', content: [paragraphs('')[0]] }] })}>＋ Announcement</button></>}
      {block.type === 'titlePage' && <><p className="helper">Use the standard cover or replace it for this week with a complete image/PDF page.</p><button className="secondary" onClick={() => chooseBlockAsset(block)}>{block.asset ? `Replace ${block.asset.alt ?? 'cover'}` : 'Choose custom cover'}</button>{block.asset && <button className="danger-text" onClick={() => { const { asset: _asset, ...standard } = block; updateBlock(block.id, standard); }}>Use standard cover</button>}</>}
      {block.type === 'fullPageAsset' && <><p className="helper">{block.asset.alt ?? block.asset.path}</p><button className="danger-text" onClick={() => onChange({ ...document, blocks: document.blocks.filter(item => item.id !== block.id) })}>Remove page</button></>}
      {missingLibraryReference(block) && !block.weeklyEditable && <button className="danger-text" onClick={() => onChange({ ...document, blocks: document.blocks.filter(item => item.id !== block.id) })}>Remove from this bulletin</button>}
      <button className="adjustments-toggle" onClick={() => setExpanded(expanded === block.id ? undefined : block.id)}>Layout adjustments <span>{expanded === block.id ? '−' : '+'}</span></button>
      {expanded === block.id && <div className="adjustments"><label className="check"><input type="checkbox" checked={block.layout?.pageBreakBefore ?? false} onChange={e => updateBlock(block.id, { ...block, layout: { ...block.layout, pageBreakBefore: e.target.checked } })} />Start on a new page</label><label className="check"><input type="checkbox" checked={block.layout?.keepTogether ?? false} onChange={e => updateBlock(block.id, { ...block, layout: { ...block.layout, keepTogether: e.target.checked } })} />Keep this block together</label><label>Spacing<select value={block.layout?.density ?? 'normal'} onChange={e => updateBlock(block.id, { ...block, layout: { ...block.layout, density: e.target.value as 'normal' | 'compact' } })}><option value="normal">Comfortable</option><option value="compact">Compact</option></select></label></div>}
    </section>)}
  </div>;
}
