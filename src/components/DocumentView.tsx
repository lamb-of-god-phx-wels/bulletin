import { useEffect, useMemo, useState } from 'react';
import type { AssetRef, BulletinBlock, BulletinDocumentV1, LibraryManifestV1, Paragraph, TemplateV1 } from '../shared/types';
import { paginate } from '../shared/pagination';

const inlineText = (paragraph: Paragraph) => paragraph.children.map((run, index) => run.type === 'symbol'
  ? <span className="cross" key={index}>✠</span>
  : <span key={index} className={run.marks?.map(mark => `mark-${mark}`).join(' ')}>{run.text}</span>);

function Paragraphs({ content }: { content: Paragraph[] }) {
  return <>{content.map((paragraph, index) => <p key={index} style={{ textAlign: paragraph.align }}>{inlineText(paragraph)}</p>)}</>;
}

function FlowAsset({ asset, source }: { asset: AssetRef; source?: string }) {
  if (!source) return <p className="missing">Asset “{asset.path}” is unavailable.</p>;
  return asset.mediaType === 'application/pdf'
    ? <embed className="flow-pdf" src={`${source}#page=${asset.page ?? 1}&toolbar=0&navpanes=0`} type="application/pdf" />
    : <img src={source} alt={asset.alt ?? ''} />;
}

function BlockView({ block, library, assets, document }: { block: BulletinBlock; library?: LibraryManifestV1; assets: Record<string, string>; document: BulletinDocumentV1 }) {
  const item = 'libraryItemId' in block ? library?.items.filter(entry => entry.id === block.libraryItemId && (!block.libraryItemVersion || entry.version === block.libraryItemVersion)).sort((a, b) => b.version - a.version)[0] : undefined;
  switch (block.type) {
    case 'titlePage': return <div className="cover">
      {block.asset && block.asset.mediaType !== 'application/pdf' && <img src={assets[block.asset.path]} alt={block.asset.alt ?? ''} />}
      {block.asset?.mediaType === 'application/pdf' && <div className="pdf-placeholder"><b>{block.asset.alt ?? 'Custom cover PDF'}</b><span>Original PDF page inserted during export</span></div>}
      {!block.asset && <><div className="cover-series">{document.info.series ?? 'Worship'}</div><h1>{document.info.title}</h1></>}
      {!block.asset && <><div className="cover-date"><strong>{document.info.churchWeek}</strong><span>{new Date(`${document.info.date}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</span></div><div className="cover-church">{document.church.name}</div></>}
    </div>;
    case 'churchInfo': return <div className="church-info"><h1>{document.church.name}</h1><div className="tagline">Reaching Up. Reaching Out. Reaching Across.</div><hr /><h2>Welcome</h2><p>Thank you for joining us for worship. We gather before our almighty God to offer him our worship and praise and to strengthen ourselves through his holy and powerful Word.</p><h2>Children’s Room</h2><p>Children are always welcome in worship. A children’s room is available for families who need it.</p><div className="contact-card">Church information is maintained in the shared content library.</div></div>;
    case 'sermonTitle': return <h1 className="sermon-title">{block.text}</h1>;
    case 'sectionHeading': return <h2 className="section-heading">✠ {block.text} ✠</h2>;
    case 'heading': return <h3 className="block-heading">{block.text}</h3>;
    case 'richText': return <div className="rich-text"><Paragraphs content={block.content} /></div>;
    case 'responsiveReading': return <div className="responsive">{block.entries.map((entry, index) => <div className="response-row" key={index}><b>{entry.reader}:</b><div><Paragraphs content={entry.content} /></div></div>)}</div>;
    case 'scriptureReading': return <section className="scripture"><h3>{block.label ?? 'Reading'}: <span>{block.reference}</span></h3>{block.caption && <p className="caption">{block.caption}</p>}{block.resolved ? <Paragraphs content={block.resolved.content} /> : <p className="missing">Passage text has not been resolved. Add it before export.</p>}<div className="translation">{block.translation}</div></section>;
    case 'song': { const asset = block.asset ?? item?.assets?.[0]; return <section className="song"><h3>{block.label ?? block.songType}: <span>{item?.title ?? block.title ?? block.libraryItemId}</span></h3>{block.renderMode === 'asset' && asset ? <FlowAsset asset={asset} source={assets[asset.path]} /> : item?.content ? <Paragraphs content={item.content} /> : <p className="missing">Choose or add “{block.libraryItemId || 'song'}” in the shared library.</p>}</section>; }
    case 'libraryText': return <section><h3 className="block-heading">{block.label ?? block.title ?? item?.title}</h3>{item?.content ? <Paragraphs content={item.content} /> : <p className="missing">Library text “{block.libraryItemId}” is unavailable.</p>}</section>;
    case 'announcements': return <section className="announcements"><h2>Announcements</h2>{block.items.map(item => <article key={item.id}><h3>{item.title}</h3><Paragraphs content={item.content} /></article>)}</section>;
    case 'copyright': {
      const notices = document.blocks.flatMap(candidate => 'libraryItemId' in candidate ? [library?.items.find(entry => entry.id === candidate.libraryItemId)?.license?.notice] : []).filter(Boolean);
      const scripture = document.blocks.flatMap(candidate => candidate.type === 'scriptureReading' && candidate.resolved ? [candidate.resolved.attribution] : []);
      return <section className="copyright"><Paragraphs content={block.extra ?? []} />{[...new Set([...notices, ...scripture])].map((notice, index) => <p key={index}>{notice}</p>)}</section>;
    }
    case 'fullPageAsset': return <div className="full-page-asset">{block.asset.mediaType === 'application/pdf' ? <div className="pdf-placeholder"><b>{block.asset.alt ?? 'PDF page'}</b><span>Original PDF page inserted during export</span></div> : <img src={assets[block.asset.path]} alt={block.asset.alt ?? ''} />}</div>;
    case 'spacer': return <div className={`spacer spacer-${block.size}`} />;
  }
}

export function DocumentView({ document: bulletin, template, library, root, print = false, onReady }: { document: BulletinDocumentV1; template: TemplateV1; library?: LibraryManifestV1; root?: string; print?: boolean; onReady?(): void }) {
  const [assets, setAssets] = useState<Record<string, string>>({});
  const refs = useMemo(() => [...new Map(bulletin.blocks.flatMap(block => {
    const result: AssetRef[] = [];
    if ('asset' in block && block.asset) result.push(block.asset);
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
  const pages = paginate(bulletin.blocks, template, library);
  return <div className={`document-stack ${print ? 'is-print' : ''}`} style={{
    '--body-font': template.theme.bodyFont, '--display-font': template.theme.displayFont,
    '--ink': template.theme.ink, '--accent': template.theme.accent,
    '--body-size': `${template.theme.bodySizePt}pt`, '--line-height': template.theme.lineHeight,
    '--page-margin': `${template.theme.marginIn}in`
  } as React.CSSProperties}>
    {pages.map(page => <article className={`document-page page-${page.kind}`} key={page.number}>
      <div className="page-content">{page.blocks.map(block => <BlockView key={block.id} block={block} library={library} assets={assets} document={bulletin} />)}</div>
      {page.kind === 'content' && page.number > 1 && <div className="page-number">{page.number}</div>}
    </article>)}
  </div>;
}
