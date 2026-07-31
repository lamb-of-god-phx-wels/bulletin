import { cloneElement, useEffect, useMemo, useState, type ReactElement } from 'react';
import type { AssetRef, BulletinDocumentV1, CustomBlock, CustomBlockStyle, LibraryManifestV1, Paragraph, TemplateV1 } from '../shared/types';
import { customBlockParagraphs, defaultCustomBlockStyle } from '../shared/customBlocks';
import { childBlocks, flattenBlocks } from '../shared/blocks';
import { paginate, type PaginatedBlock } from '../shared/pagination';
import { templateForBulletin } from '../shared/documentLayout';
import { defaultResponsiveReadingSettings, effectiveResponsiveReadingSettings, responsiveEntryReader, responsiveEntryRole } from '../shared/responsiveReading';
import { songHeader, songTitle } from '../shared/songs';
import { scriptureElementBlocks, scriptureElementHasContent } from '../shared/scriptureReading';
import { boundRichTextParagraphs, canvasAssetRefs, canvasNativeBlocks } from '../shared/canvas';
import { bookletPrinterSpreads, bookletReadingSpreads } from '../shared/booklet';
import { CanvasSceneView } from './CanvasSceneView';

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
  const border = style.borderWidthPt ? `${style.borderWidthPt}pt solid ${style.borderColor}` : undefined;
  return {
    boxSizing: 'border-box', width: `${style.widthPercent}%`,
    marginTop: `${style.marginIn.top}in`, marginBottom: `${style.marginIn.bottom}in`,
    marginLeft: style.placement === 'left' ? 0 : 'auto', marginRight: style.placement === 'right' ? 0 : 'auto',
    padding: `${style.paddingIn.top}in ${style.paddingIn.right}in ${style.paddingIn.bottom}in ${style.paddingIn.left}in`,
    textAlign: style.textAlign, fontFamily: style.fontFamily === 'body' ? 'var(--body-font)' : style.fontFamily === 'display' ? 'var(--display-font)' : style.fontFamily,
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

function BlockView({ block, library, assets, document, marginIn }: { block: PaginatedBlock; library?: LibraryManifestV1; assets: Record<string, string>; document: BulletinDocumentV1; marginIn: number }) {
  const item = 'libraryItemId' in block ? library?.items.filter(entry => entry.id === block.libraryItemId && (!block.libraryItemVersion || entry.version === block.libraryItemVersion)).sort((a, b) => b.version - a.version)[0] : undefined;
  switch (block.type) {
    case 'titlePage': case 'canvasCover': return <div className="missing">This document contains an unsupported legacy cover. Insert a reusable page template instead.</div>;
    case 'canvas': {
      const fullPage = (block.widthMode ?? 'contentBox') === 'fullPage';
      const widthIn = fullPage ? 7 : 7 - marginIn * 2;
      return <div className={`canvas-block ${fullPage ? 'canvas-block-full-page' : ''}`} style={{
        height: `${block.heightIn}in`,
        ...(fullPage ? { width: '7in', marginLeft: `${-marginIn}in` } : {})
      }}><CanvasSceneView scene={block.scene} document={document} assets={assets} marginIn={0} widthIn={widthIn} heightIn={block.heightIn} renderNativeBlock={native =>
        <RenderedBlock block={native as PaginatedBlock} library={library} assets={assets} document={document} marginIn={marginIn} />
      } /></div>;
    }
    case 'templatePage': return <section className="template-page-instance" data-template-page-id={`${block.source.id}@${block.source.version}`}>{block.blocks.map(child =>
      <RenderedBlock block={child as PaginatedBlock} library={library} assets={assets} document={document} marginIn={marginIn} key={child.id} />
    )}</section>;
    case 'churchInfo': return <div className="church-info">{block.heroAsset && assets[block.heroAsset.path] && <img className="church-info-image" src={assets[block.heroAsset.path]} alt="Lamb of God church building" />}<h1>{document.church.name}</h1>{childBlocks(block)!.map(child => <RenderedBlock block={child as PaginatedBlock} library={library} assets={assets} document={document} marginIn={marginIn} key={child.id} />)}</div>;
    case 'group': {
      const mode = block.layoutMode ?? 'stack';
      return <section className={`block-group layout-${mode}`} style={{
        '--layout-gap': `${mode === 'table' ? 0 : block.gapIn ?? 0}in`,
        '--layout-columns': Math.max(1, Math.min(12, block.columns ?? (mode === 'stack' ? 1 : 2)))
      } as React.CSSProperties}>{block.children.map(child => <RenderedBlock block={child as PaginatedBlock} library={library} assets={assets} document={document} marginIn={marginIn} key={child.id} />)}</section>;
    }
    case 'sermonTitle': return <h1 className="sermon-title">{block.text}</h1>;
    case 'sectionHeading': return <h2 className="section-heading">✠ {block.text} ✠</h2>;
    case 'heading': return <h3 className="block-heading">{block.text}</h3>;
    case 'paragraph': return <section className="paragraph-block">{childBlocks(block)!.map(child => <RenderedBlock block={child as PaginatedBlock} library={library} assets={assets} document={document} marginIn={marginIn} key={child.id} />)}</section>;
    case 'richText': return <div className={`rich-text ${block.role ? `paragraph-${block.role}` : ''} ${block.scriptureRole ? `scripture-${block.scriptureRole}` : ''}`}><Paragraphs content={boundRichTextParagraphs(block, document)} /></div>;
    case 'custom': return <section className="custom-block">{(block.showName ?? true) && <h3 className="custom-block-heading">{block.name}</h3>}<Paragraphs content={customBlockParagraphs(block, document)} /></section>;
    case 'responsiveReading': return <div className="responsive">{block.heading && <RenderedBlock block={block.heading as PaginatedBlock} library={library} assets={assets} document={document} marginIn={marginIn} />}{block.entries.map((entry, index) => {
      const role = responsiveEntryRole(entry);
      return <div className={`response-row response-${role}`} data-response-role={role} key={index}><span className="response-reader">{responsiveEntryReader(entry, document.responsiveReading ?? defaultResponsiveReadingSettings)}:</span><div><Paragraphs content={entry.content} /></div></div>;
    })}</div>;
    case 'scriptureReading': {
      const elements = scriptureElementBlocks(block);
      const visible = elements.filter(element => element.scriptureRole === 'reference' || element.scriptureRole === 'body' || scriptureElementHasContent(element));
      const renderElement = (element: typeof elements[number]) =>
        element.scriptureRole === 'body' && !block.resolved
          ? <div className="missing preview-block" data-block-id={element.id} key={element.id}>Passage text has not been resolved. Add it before export.</div>
          : <RenderedBlock block={element as PaginatedBlock} library={library} assets={assets} document={document} marginIn={marginIn} key={element.id} />;
      const heading = visible.find(element => element.scriptureRole === 'heading');
      const reference = visible.find(element => element.scriptureRole === 'reference');
      const inlineHeading = (block.headingReferenceLayout ?? 'inline') === 'inline' && heading && reference;
      return <section className="scripture">
        {inlineHeading && <div className="scripture-heading-line" style={{ '--scripture-heading-gap': `${Math.max(0, block.headingReferenceGapIn ?? 0.12)}in` } as React.CSSProperties}>{renderElement(heading)}{renderElement(reference)}</div>}
        {visible.filter(element => !inlineHeading || (element !== heading && element !== reference)).map(renderElement)}
        <div className="translation">{block.translation}</div>
      </section>;
    }
    case 'song': {
      const asset = block.asset ?? item?.assets?.[0];
      const content = block.pageContent ?? block.contentOverride ?? item?.content;
      const bodyStyle = songPartStyle(block.elements?.body?.presentation);
      return <section className="song">
        {block.showHeading !== false && <h3>
          <span className="song-header" style={songPartStyle(block.elements?.header?.presentation, true)}>{songHeader(block)}:</span>{' '}
          <span className="song-title" style={songPartStyle(block.elements?.title?.presentation, true)}>{songTitle(block, item)}</span>
        </h3>}
        <div className="song-body" style={bodyStyle}>
          {block.renderMode === 'asset' && asset
            ? <div className="song-asset" style={block.assetHeightIn ? { '--song-asset-height': `${block.assetHeightIn}in` } as React.CSSProperties : undefined}><FlowAsset asset={asset} source={assets[asset.path]} /></div>
            : content
              ? <Paragraphs content={content} />
              : <p className="missing">Choose or add “{block.libraryItemId || 'song'}” in the shared library.</p>}
        </div>
      </section>;
    }
    case 'libraryText': { const content = block.pageContent ?? block.contentOverride ?? item?.content; return <section><h3 className="block-heading">{block.label ?? block.title ?? item?.title}</h3>{content ? <Paragraphs content={content} /> : <p className="missing">Library text “{block.libraryItemId}” is unavailable.</p>}</section>; }
    case 'announcements': return <section className="announcements"><h2>Announcements</h2>{block.items.map(item => <article className={item.asset ? `announcement-with-asset asset-${item.assetSide ?? 'right'}` : undefined} key={item.id}>{item.asset && <FlowAsset asset={item.asset} source={assets[item.asset.path]} />}<div><h3>{item.title}</h3><Paragraphs content={item.content} /></div></article>)}</section>;
    case 'copyright': {
      const notices = block.suppressGeneratedNotices ? [] : document.blocks.flatMap(candidate => 'libraryItemId' in candidate ? [library?.items.find(entry => entry.id === candidate.libraryItemId)?.license?.notice] : []).filter(Boolean);
      const scripture = block.suppressGeneratedNotices ? [] : document.blocks.flatMap(candidate => candidate.type === 'scriptureReading' && candidate.resolved ? [candidate.resolved.attribution] : []);
      return <section className="copyright"><Paragraphs content={block.extra ?? []} />{[...new Set([...notices, ...scripture])].map((notice, index) => <p key={index}>{notice}</p>)}</section>;
    }
    case 'image': return <div className="native-image-block" style={{ height: `${block.heightIn ?? 2.5}in` }}>{assets[block.asset.path] ? <img src={assets[block.asset.path]} alt={block.alt ?? block.asset.alt ?? ''} style={{ objectFit: block.fit ?? 'contain' }} /> : <p className="missing">Image “{block.asset.path}” is unavailable.</p>}</div>;
    case 'fullPageAsset': return <div className="full-page-asset">{block.asset.mediaType === 'application/pdf' ? <div className="pdf-placeholder"><b>{block.asset.alt ?? 'PDF page'}</b><span>Original PDF page inserted during export</span></div> : <img src={assets[block.asset.path]} alt={block.asset.alt ?? ''} />}</div>;
    case 'spacer': return <div className={`spacer spacer-${block.size}`} />;
  }
}

function RenderedBlock({ block, library, assets, document, marginIn }: { block: PaginatedBlock; library?: LibraryManifestV1; assets: Record<string, string>; document: BulletinDocumentV1; marginIn: number }) {
  const style = presentationStyle(block);
  const editorBlockId = block.sourceBlockId ?? block.id;
  if (style) return <div className={`block-presentation has-presentation preview-block ${block.type === 'titlePage' || block.type === 'canvasCover' || block.type === 'templatePage' || block.type === 'churchInfo' || block.type === 'fullPageAsset' ? 'full-height-presentation' : ''}`} data-block-id={editorBlockId} style={style}><BlockView block={block} library={library} assets={assets} document={document} marginIn={marginIn} /></div>;
  const view = BlockView({ block, library, assets, document, marginIn }) as ReactElement<{ className?: string; 'data-block-id'?: string }>;
  return cloneElement(view, { className: `${view.props.className ?? ''} preview-block`.trim(), 'data-block-id': editorBlockId });
}

export function NativeBlockPreview({ block, library, assets, document, marginIn }: { block: BulletinDocumentV1['blocks'][number]; library?: LibraryManifestV1; assets: Record<string, string>; document: BulletinDocumentV1; marginIn: number }) {
  return <RenderedBlock block={block as PaginatedBlock} library={library} assets={assets} document={document} marginIn={marginIn} />;
}

export function DocumentView({ document: bulletin, template, library, root, print = false, rulers = true, guides = false, zoom = .72, singlePage = false, bookletMode, onBlockSelect, onReady }: {
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
  onReady?(): void;
}) {
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
  const allPages = paginate(bulletin.blocks, effectiveTemplate, library);
  const pages = singlePage
    ? allPages.length ? allPages.slice(0, 1) : [{ number: 1, kind: 'content' as const, blocks: [] }]
    : allPages;
  const stackProps = {
    className: `document-stack ${print ? 'is-print' : ''} ${bookletMode ? 'is-booklet' : ''} ${onBlockSelect && !print ? 'is-interactive' : ''}`,
    onClick: onBlockSelect && !print ? (event: React.MouseEvent<HTMLDivElement>) => {
    const block = (event.target as Element).closest<HTMLElement>('[data-block-id]');
    if (block && event.currentTarget.contains(block) && block.dataset.blockId) onBlockSelect(block.dataset.blockId);
    } : undefined,
    style: {
    '--body-font': effectiveTemplate.theme.bodyFont, '--display-font': effectiveTemplate.theme.displayFont,
    '--ink': effectiveTemplate.theme.ink, '--accent': effectiveTemplate.theme.accent,
    '--body-size': `${effectiveTemplate.theme.bodySizePt}pt`, '--line-height': effectiveTemplate.theme.lineHeight,
    '--page-margin': `${effectiveTemplate.theme.marginIn}in`,
    '--preview-scale': zoom,
    '--preview-page-width': `${672 * zoom}px`,
    '--preview-page-height': `${816 * zoom}px`
    } as React.CSSProperties
  };
  const renderPage = (page: typeof pages[number], key: React.Key) => <div className={`page-frame ${rulers && !print ? 'with-rulers' : ''}`} key={key} style={page.marginIn !== undefined ? { '--page-margin': `${page.marginIn}in` } as React.CSSProperties : undefined}>{rulers && !print && <><PageRulers /><div className="page-crosshairs" aria-hidden="true"><i className="crosshair-vertical" /><i className="crosshair-horizontal" /></div></>}<article className={`document-page page-kind-${page.kind}`} onPointerMove={rulers && !print ? trackPointer : undefined} onPointerLeave={rulers && !print ? stopTrackingPointer : undefined}>
      {guides && !print && <div className="page-guides" aria-hidden="true" />}
      <div className="page-content">{page.blocks.map(block => <RenderedBlock key={block.id} block={block} library={library} assets={assets} document={renderDocument} marginIn={page.marginIn ?? effectiveTemplate.theme.marginIn} />)}</div>
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
