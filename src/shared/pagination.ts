import type { BulletinBlock, LibraryManifestV1, Paragraph, TemplateV1 } from './types.js';

export interface PageModel { number: number; kind: 'content' | 'fullPage' | 'filler'; blocks: BulletinBlock[] }

const paragraphLength = (paragraph: Paragraph) => paragraph.children.reduce((n, c) => n + ('text' in c ? c.text.length : 1), 0);
const textLength = (block: BulletinBlock, library?: LibraryManifestV1): number => {
  switch (block.type) {
    case 'heading': case 'sectionHeading': case 'sermonTitle': return block.text.length;
    case 'richText': return block.content.flatMap(p => p.children).reduce((n, c) => n + ('text' in c ? c.text.length : 1), 0);
    case 'responsiveReading': return block.entries.flatMap(e => e.content).flatMap(p => p.children).reduce((n, c) => n + ('text' in c ? c.text.length : 1), 0);
    case 'scriptureReading': return (block.caption?.length ?? 0) + (block.resolved?.content.flatMap(p => p.children).reduce((n, c) => n + ('text' in c ? c.text.length : 1), 0) ?? 160);
    case 'announcements': return block.items.reduce((n, i) => n + i.title.length + i.content.flatMap(p => p.children).reduce((x, c) => x + ('text' in c ? c.text.length : 1), 0), 0);
    case 'song': return block.renderMode === 'asset' ? 900 : library?.items.filter(item => item.id === block.libraryItemId && (!block.libraryItemVersion || item.version === block.libraryItemVersion)).sort((a, b) => b.version - a.version)[0]?.content?.reduce((n, p) => n + paragraphLength(p), 0) ?? 360;
    case 'libraryText': return library?.items.filter(item => item.id === block.libraryItemId && (!block.libraryItemVersion || item.version === block.libraryItemVersion)).sort((a, b) => b.version - a.version)[0]?.content?.reduce((n, p) => n + paragraphLength(p), 0) ?? 450;
    case 'copyright': return 500;
    default: return 0;
  }
};

export function estimateBlockPoints(block: BulletinBlock, template: TemplateV1, library?: LibraryManifestV1): number {
  if (block.type === 'titlePage' || block.type === 'churchInfo' || block.type === 'fullPageAsset') return 540;
  if (block.type === 'sectionHeading') return 38;
  if (block.type === 'heading' || block.type === 'sermonTitle') return 28;
  if (block.type === 'spacer') return { small: 8, medium: 18, large: 36 }[block.size];
  const charsPerLine = Math.max(56, Math.floor(650 / template.theme.bodySizePt));
  const lines = Math.ceil(textLength(block, library) / charsPerLine);
  const base = block.type === 'announcements' ? 36 : 18;
  const density = block.layout?.density === 'compact' ? 0.84 : 1;
  return (base + lines * template.theme.bodySizePt * template.theme.lineHeight) * density;
}

function splitLongBlocks(blocks: BulletinBlock[], template: TemplateV1, library?: LibraryManifestV1): BulletinBlock[] {
  const charsPerPage = Math.floor(((template.page.heightIn - template.theme.marginIn * 2) * 72 / (template.theme.bodySizePt * template.theme.lineHeight)) * Math.max(56, Math.floor(650 / template.theme.bodySizePt)) * .78);
  return blocks.flatMap(block => {
    if (block.layout?.keepTogether || estimateBlockPoints(block, template, library) < (template.page.heightIn - template.theme.marginIn * 2) * 72) return [block];
    if (block.type === 'scriptureReading' && block.resolved?.content.length) {
      const groups: Paragraph[][] = []; let group: Paragraph[] = []; let used = 0;
      for (const paragraph of block.resolved.content) { const length = paragraphLength(paragraph); if (group.length && used + length > charsPerPage) { groups.push(group); group = []; used = 0; } group.push(paragraph); used += length; }
      if (group.length) groups.push(group);
      return groups.map((content, index) => ({ ...block, id: `${block.id}-part-${index + 1}`, label: index ? `${block.label ?? 'Reading'} (continued)` : block.label, caption: index ? undefined : block.caption, resolved: { ...block.resolved!, content }, layout: { ...block.layout, pageBreakBefore: index ? true : block.layout?.pageBreakBefore } }));
    }
    if (block.type === 'responsiveReading' && block.entries.length > 1) {
      const groups: typeof block.entries[] = []; let group: typeof block.entries = []; let used = 0;
      for (const entry of block.entries) { const length = entry.content.reduce((n, p) => n + paragraphLength(p), 0); if (group.length && used + length > charsPerPage) { groups.push(group); group = []; used = 0; } group.push(entry); used += length; }
      if (group.length) groups.push(group);
      return groups.map((entries, index) => ({ ...block, id: `${block.id}-part-${index + 1}`, entries, layout: { ...block.layout, pageBreakBefore: index ? true : block.layout?.pageBreakBefore } }));
    }
    if (block.type === 'announcements' && block.items.length > 1) {
      const groups: typeof block.items[] = []; let group: typeof block.items = []; let used = 0;
      for (const item of block.items) { const length = item.title.length + item.content.reduce((n, p) => n + paragraphLength(p), 0); if (group.length && used + length > charsPerPage) { groups.push(group); group = []; used = 0; } group.push(item); used += length; }
      if (group.length) groups.push(group);
      return groups.map((items, index) => ({ ...block, id: `${block.id}-part-${index + 1}`, items, label: index ? 'Announcements (continued)' : block.label, layout: { ...block.layout, pageBreakBefore: index ? true : block.layout?.pageBreakBefore } }));
    }
    return [block];
  });
}

export function paginate(blocks: BulletinBlock[], template: TemplateV1, library?: LibraryManifestV1): PageModel[] {
  const usable = (template.page.heightIn - template.theme.marginIn * 2) * 72 - 30;
  const pages: PageModel[] = [];
  let current: BulletinBlock[] = [];
  let used = 0;
  const flush = () => {
    if (current.length) pages.push({ number: pages.length + 1, kind: 'content', blocks: current });
    current = []; used = 0;
  };
  for (const block of splitLongBlocks(blocks, template, library)) {
    if (block.type === 'titlePage' || block.type === 'churchInfo' || block.type === 'fullPageAsset') {
      flush();
      pages.push({ number: pages.length + 1, kind: block.type === 'fullPageAsset' ? 'fullPage' : 'content', blocks: [block] });
      continue;
    }
    const height = estimateBlockPoints(block, template, library);
    if (block.layout?.pageBreakBefore || (current.length && used + height > usable)) flush();
    current.push(block); used += Math.min(height, usable);
  }
  flush();
  const multiple = template.page.pageMultiple;
  while (pages.length % multiple) pages.push({ number: pages.length + 1, kind: 'filler', blocks: [] });
  return pages;
}
