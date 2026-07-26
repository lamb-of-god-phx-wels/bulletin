import { cloneElement, useEffect, useMemo, useState, type ReactElement } from 'react';
import type { AssetRef, BulletinDocumentV1, CustomBlock, LibraryManifestV1, Paragraph, TemplateV1 } from '../shared/types';
import { customBlockParagraphs, defaultCustomBlockStyle } from '../shared/customBlocks';
import { childBlocks, flattenBlocks } from '../shared/blocks';
import { paginate, type PaginatedBlock } from '../shared/pagination';
import { templateForBulletin } from '../shared/documentLayout';
import { responsiveEntryRole } from '../shared/responsiveReading';
import { scriptureElementBlocks, scriptureElementHasContent } from '../shared/scriptureReading';

const inlineText = (paragraph: Paragraph) => paragraph.children.map((run, index) => run.type === 'lineBreak'
  ? <br key={index} />
  : run.type === 'symbol'
    ? <span className="cross" key={index}>✠</span>
    : <span key={index} className={run.marks?.map(mark => `mark-${mark}`).join(' ')}>{run.text}</span>);

function Paragraphs({ content }: { content: Paragraph[] }) {
  return <>{content.map((paragraph, index) => <p key={index} style={{ textAlign: paragraph.align }}>{inlineText(paragraph)}</p>)}</>;
}

function presentationStyle(block: PaginatedBlock): React.CSSProperties | undefined {
  const base = block.type === 'custom' ? block.style : undefined;
  if (!base && !block.presentation) return undefined;
  const style: NonNullable<CustomBlock['style']> = {
    ...defaultCustomBlockStyle, ...base, ...block.presentation,
    paddingIn: { ...defaultCustomBlockStyle.paddingIn, ...base?.paddingIn, ...block.presentation?.paddingIn },
    marginIn: { ...defaultCustomBlockStyle.marginIn, ...base?.marginIn, ...block.presentation?.marginIn }
  };
  return {
    boxSizing: 'border-box', width: `${style.widthPercent}%`,
    marginTop: `${style.marginIn.top}in`, marginBottom: `${style.marginIn.bottom}in`,
    marginLeft: style.placement === 'left' ? 0 : 'auto', marginRight: style.placement === 'right' ? 0 : 'auto',
    padding: `${style.paddingIn.top}in ${style.paddingIn.right}in ${style.paddingIn.bottom}in ${style.paddingIn.left}in`,
    textAlign: style.textAlign, fontFamily: style.fontFamily === 'body' ? 'var(--body-font)' : style.fontFamily === 'display' ? 'var(--display-font)' : style.fontFamily,
    fontSize: `${style.fontSizePt}pt`, lineHeight: style.lineHeight, fontWeight: style.fontWeight, fontStyle: style.fontStyle,
    fontVariant: style.textTransform === 'small-caps' ? 'small-caps' : undefined,
    textTransform: style.textTransform === 'uppercase' ? 'uppercase' : undefined,
    color: style.color, backgroundColor: style.backgroundColor ?? 'transparent',
    border: style.borderWidthPt ? `${style.borderWidthPt}pt solid ${style.borderColor}` : undefined,
    borderRadius: `${style.borderRadiusPt}pt`
  };
}

function FlowAsset({ asset, source }: { asset: AssetRef; source?: string }) {
  if (!source) return <p className="missing">Asset “{asset.path}” is unavailable.</p>;
  return asset.mediaType === 'application/pdf'
    ? <embed className="flow-pdf" src={`${source}#page=${asset.page ?? 1}&toolbar=0&navpanes=0`} type="application/pdf" />
    : <img src={source} alt={asset.alt ?? ''} />;
}

function PageRulers() {
  const horizontal = Array.from({ length: 29 }, (_, index) => ({ index, position: `${index / 28 * 100}%`, label: index % 4 === 0 ? String(index / 4) : undefined }));
  const vertical = Array.from({ length: 35 }, (_, index) => ({ index, position: `${index / 34 * 100}%`, label: index % 4 === 0 ? String(index / 4) : index === 34 ? '8.5' : undefined }));
  const tickClass = (index: number) => `ruler-tick ${index % 4 === 0 ? 'major' : index % 2 === 0 ? 'half' : 'quarter'}`;
  return <div className="page-rulers" aria-hidden="true"><div className="ruler-corner">in</div><div className="ruler ruler-horizontal">{horizontal.map(tick => <i className={tickClass(tick.index)} style={{ left: tick.position }} key={tick.index}>{tick.label && <span>{tick.label}</span>}</i>)}</div><div className="ruler ruler-vertical">{vertical.map(tick => <i className={tickClass(tick.index)} style={{ top: tick.position }} key={tick.index}>{tick.label && <span>{tick.label}</span>}</i>)}</div></div>;
}

function trackPointer(event: React.PointerEvent<HTMLElement>) {
  const frame = event.currentTarget.parentElement;
  if (!frame) return;
  const bounds = event.currentTarget.getBoundingClientRect();
  frame.style.setProperty('--cursor-x', `${Math.max(0, Math.min(bounds.width, event.clientX - bounds.left))}px`);
  frame.style.setProperty('--cursor-y', `${Math.max(0, Math.min(bounds.height, event.clientY - bounds.top))}px`);
  frame.classList.add('tracking-cursor');
}

function stopTrackingPointer(event: React.PointerEvent<HTMLElement>) {
  event.currentTarget.parentElement?.classList.remove('tracking-cursor');
}

function BlockView({ block, library, assets, document }: { block: PaginatedBlock; library?: LibraryManifestV1; assets: Record<string, string>; document: BulletinDocumentV1 }) {
  const item = 'libraryItemId' in block ? library?.items.filter(entry => entry.id === block.libraryItemId && (!block.libraryItemVersion || entry.version === block.libraryItemVersion)).sort((a, b) => b.version - a.version)[0] : undefined;
  switch (block.type) {
    case 'titlePage': return <div className="cover">
      {block.asset && block.asset.mediaType !== 'application/pdf' && <img src={assets[block.asset.path]} alt={block.asset.alt ?? ''} />}
      {block.asset?.mediaType === 'application/pdf' && <div className="pdf-placeholder"><b>{block.asset.alt ?? 'Custom cover PDF'}</b><span>Original PDF page inserted during export</span></div>}
      {!block.asset && <>{block.seriesAsset && assets[block.seriesAsset.path] ? <img className="cover-series-image" src={assets[block.seriesAsset.path]} alt={document.info.series ?? ''} /> : <div className="cover-series">{document.info.series ?? 'Worship'}</div>}<h1>{document.info.title}</h1></>}
      {!block.asset && <><div className="cover-date"><strong>{document.info.churchWeek}</strong><span>{new Date(`${document.info.date}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</span></div>{block.churchLogoAsset && assets[block.churchLogoAsset.path] ? <img className="cover-church-logo" src={assets[block.churchLogoAsset.path]} alt={document.church.name} /> : <div className="cover-church">{document.church.name}</div>}</>}
    </div>;
    case 'churchInfo': return <div className="church-info">{block.heroAsset && assets[block.heroAsset.path] && <img className="church-info-image" src={assets[block.heroAsset.path]} alt="Lamb of God church building" />}<h1>{document.church.name}</h1>{childBlocks(block)!.map(child => <RenderedBlock block={child as PaginatedBlock} library={library} assets={assets} document={document} key={child.id} />)}</div>;
    case 'group': return <section className="block-group">{block.children.map(child => <RenderedBlock block={child as PaginatedBlock} library={library} assets={assets} document={document} key={child.id} />)}</section>;
    case 'sermonTitle': return <h1 className="sermon-title">{block.text}</h1>;
    case 'sectionHeading': return <h2 className="section-heading">✠ {block.text} ✠</h2>;
    case 'heading': return <h3 className="block-heading">{block.text}</h3>;
    case 'paragraph': return <section className="paragraph-block">{childBlocks(block)!.map(child => <RenderedBlock block={child as PaginatedBlock} library={library} assets={assets} document={document} key={child.id} />)}</section>;
    case 'richText': return <div className={`rich-text ${block.role ? `paragraph-${block.role}` : ''} ${block.scriptureRole ? `scripture-${block.scriptureRole}` : ''}`}><Paragraphs content={block.content} /></div>;
    case 'custom': return <section className="custom-block">{(block.showName ?? true) && <h3 className="custom-block-heading">{block.name}</h3>}<Paragraphs content={customBlockParagraphs(block, document)} /></section>;
    case 'responsiveReading': return <div className="responsive">{block.entries.map((entry, index) => {
      const role = responsiveEntryRole(entry);
      return <div className={`response-row response-${role}`} data-response-role={role} key={index}><span className="response-reader">{entry.reader}:</span><div><Paragraphs content={entry.content} /></div></div>;
    })}</div>;
    case 'scriptureReading': {
      const elements = scriptureElementBlocks(block);
      return <section className="scripture">
        {elements.filter(element => element.scriptureRole === 'reference' || element.scriptureRole === 'body' || scriptureElementHasContent(element)).map(element =>
          element.scriptureRole === 'body' && !block.resolved
            ? <div className="missing preview-block" data-block-id={element.id} key={element.id}>Passage text has not been resolved. Add it before export.</div>
            : <RenderedBlock block={element as PaginatedBlock} library={library} assets={assets} document={document} key={element.id} />
        )}
        <div className="translation">{block.translation}</div>
      </section>;
    }
    case 'song': { const asset = block.asset ?? item?.assets?.[0]; const content = block.pageContent ?? block.contentOverride ?? item?.content; return <section className="song">{block.showHeading !== false && <h3>{block.label ?? block.songType}: <span>{block.title ?? item?.title ?? block.libraryItemId}</span></h3>}{block.renderMode === 'asset' && asset ? <div className="song-asset" style={block.assetHeightIn ? { '--song-asset-height': `${block.assetHeightIn}in` } as React.CSSProperties : undefined}><FlowAsset asset={asset} source={assets[asset.path]} /></div> : content ? <Paragraphs content={content} /> : <p className="missing">Choose or add “{block.libraryItemId || 'song'}” in the shared library.</p>}</section>; }
    case 'libraryText': { const content = block.pageContent ?? block.contentOverride ?? item?.content; return <section><h3 className="block-heading">{block.label ?? block.title ?? item?.title}</h3>{content ? <Paragraphs content={content} /> : <p className="missing">Library text “{block.libraryItemId}” is unavailable.</p>}</section>; }
    case 'announcements': return <section className="announcements"><h2>Announcements</h2>{block.items.map(item => <article className={item.asset ? `announcement-with-asset asset-${item.assetSide ?? 'right'}` : undefined} key={item.id}>{item.asset && <FlowAsset asset={item.asset} source={assets[item.asset.path]} />}<div><h3>{item.title}</h3><Paragraphs content={item.content} /></div></article>)}</section>;
    case 'copyright': {
      const notices = block.suppressGeneratedNotices ? [] : document.blocks.flatMap(candidate => 'libraryItemId' in candidate ? [library?.items.find(entry => entry.id === candidate.libraryItemId)?.license?.notice] : []).filter(Boolean);
      const scripture = block.suppressGeneratedNotices ? [] : document.blocks.flatMap(candidate => candidate.type === 'scriptureReading' && candidate.resolved ? [candidate.resolved.attribution] : []);
      return <section className="copyright"><Paragraphs content={block.extra ?? []} />{[...new Set([...notices, ...scripture])].map((notice, index) => <p key={index}>{notice}</p>)}</section>;
    }
    case 'fullPageAsset': return <div className="full-page-asset">{block.asset.mediaType === 'application/pdf' ? <div className="pdf-placeholder"><b>{block.asset.alt ?? 'PDF page'}</b><span>Original PDF page inserted during export</span></div> : <img src={assets[block.asset.path]} alt={block.asset.alt ?? ''} />}</div>;
    case 'spacer': return <div className={`spacer spacer-${block.size}`} />;
  }
}

function RenderedBlock({ block, library, assets, document }: { block: PaginatedBlock; library?: LibraryManifestV1; assets: Record<string, string>; document: BulletinDocumentV1 }) {
  const style = presentationStyle(block);
  const editorBlockId = block.sourceBlockId ?? block.id;
  if (style) return <div className={`block-presentation has-presentation preview-block ${block.type === 'titlePage' || block.type === 'churchInfo' || block.type === 'fullPageAsset' ? 'full-height-presentation' : ''}`} data-block-id={editorBlockId} style={style}><BlockView block={block} library={library} assets={assets} document={document} /></div>;
  const view = BlockView({ block, library, assets, document }) as ReactElement<{ className?: string; 'data-block-id'?: string }>;
  return cloneElement(view, { className: `${view.props.className ?? ''} preview-block`.trim(), 'data-block-id': editorBlockId });
}

export function DocumentView({ document: bulletin, template, library, root, print = false, rulers = true, guides = false, zoom = .72, onBlockSelect, onReady }: { document: BulletinDocumentV1; template: TemplateV1; library?: LibraryManifestV1; root?: string; print?: boolean; rulers?: boolean; guides?: boolean; zoom?: number; onBlockSelect?(blockId: string): void; onReady?(): void }) {
  const effectiveTemplate = templateForBulletin(template, bulletin);
  const [assets, setAssets] = useState<Record<string, string>>({});
  const refs = useMemo(() => [...new Map(flattenBlocks(bulletin.blocks).flatMap(block => {
    const result: AssetRef[] = [];
    if ('asset' in block && block.asset) result.push(block.asset);
    if (block.type === 'titlePage') result.push(...[block.seriesAsset, block.churchLogoAsset].filter((asset): asset is AssetRef => Boolean(asset)));
    if (block.type === 'churchInfo' && block.heroAsset) result.push(block.heroAsset);
    if (block.type === 'announcements') result.push(...block.items.flatMap(item => item.asset ? [item.asset] : []));
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
    if (!onReady || Object.keys(assets).length < expected) return;
    void window.document.fonts.ready.then(() => new Promise<void>(resolve => setTimeout(resolve, 500))).then(onReady);
  }, [assets, refs, onReady]);
  const pages = paginate(bulletin.blocks, effectiveTemplate, library);
  return <div className={`document-stack ${print ? 'is-print' : ''} ${onBlockSelect && !print ? 'is-interactive' : ''}`} onClick={onBlockSelect && !print ? event => {
    const block = (event.target as Element).closest<HTMLElement>('[data-block-id]');
    if (block && event.currentTarget.contains(block) && block.dataset.blockId) onBlockSelect(block.dataset.blockId);
  } : undefined} style={{
    '--body-font': effectiveTemplate.theme.bodyFont, '--display-font': effectiveTemplate.theme.displayFont,
    '--ink': effectiveTemplate.theme.ink, '--accent': effectiveTemplate.theme.accent,
    '--body-size': `${effectiveTemplate.theme.bodySizePt}pt`, '--line-height': effectiveTemplate.theme.lineHeight,
    '--page-margin': `${effectiveTemplate.theme.marginIn}in`,
    '--preview-scale': zoom,
    '--preview-page-width': `${672 * zoom}px`,
    '--preview-page-height': `${816 * zoom}px`
  } as React.CSSProperties}>
    {pages.map(page => <div className={`page-frame ${rulers && !print ? 'with-rulers' : ''}`} key={page.number}>{rulers && !print && <><PageRulers /><div className="page-crosshairs" aria-hidden="true"><i className="crosshair-vertical" /><i className="crosshair-horizontal" /></div></>}<article className={`document-page page-kind-${page.kind}`} onPointerMove={rulers && !print ? trackPointer : undefined} onPointerLeave={rulers && !print ? stopTrackingPointer : undefined}>
      {guides && !print && <div className="page-guides" aria-hidden="true" />}
      <div className="page-content">{page.blocks.map(block => <RenderedBlock key={block.id} block={block} library={library} assets={assets} document={bulletin} />)}</div>
      {page.kind === 'content' && page.number > 1 && <div className="page-number">{page.number}</div>}
    </article></div>)}
  </div>;
}
