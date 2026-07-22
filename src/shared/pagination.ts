import type { BulletinBlock, Inline, LibraryManifestV1, Paragraph, TemplateV1 } from './types.js';
import { childBlocks } from './blocks.js';

export type PaginatedBlock = BulletinBlock & { pageContent?: Paragraph[]; paginationContinuation?: boolean };
export interface PageModel { number: number; kind: 'content' | 'fullPage' | 'filler'; blocks: PaginatedBlock[] }

const paragraphLength = (paragraph: Paragraph) => paragraph.children.reduce((count, child) => count + (child.type === 'text' ? child.text.length : 1), 0);
const itemFor = (block: PaginatedBlock, library?: LibraryManifestV1) => 'libraryItemId' in block
  ? library?.items.filter(item => item.id === block.libraryItemId && (!block.libraryItemVersion || item.version === block.libraryItemVersion)).sort((a, b) => b.version - a.version)[0]
  : undefined;

function contentFor(block: PaginatedBlock, library?: LibraryManifestV1): Paragraph[] | undefined {
  if (block.pageContent) return block.pageContent;
  if (block.type === 'richText') return block.content;
  if (block.type === 'scriptureReading') return block.resolved?.content;
  if (block.type === 'song' && block.renderMode === 'lyrics') return block.contentOverride ?? itemFor(block, library)?.content;
  if (block.type === 'libraryText') return block.contentOverride ?? itemFor(block, library)?.content;
  if (block.type === 'custom') return block.layoutText.split(/\n\s*\n/).filter(Boolean).map(text => ({ type: 'paragraph', children: [{ type: 'text', text: text.replace(/\n/g, ' ') }] }));
  return undefined;
}

const usablePoints = (template: TemplateV1) => (template.page.heightIn - template.theme.marginIn * 2) * 72 - 24;
const charsPerLine = (template: TemplateV1) => Math.max(42, Math.floor(((template.page.widthIn - template.theme.marginIn * 2) * 72) / (template.theme.bodySizePt * .56)));
const paragraphPoints = (paragraph: Paragraph, template: TemplateV1) => Math.max(1, Math.ceil(paragraphLength(paragraph) / charsPerLine(template))) * template.theme.bodySizePt * template.theme.lineHeight + 8.64;
const contentPoints = (content: Paragraph[] | undefined, template: TemplateV1) => content?.reduce((total, paragraph) => total + paragraphPoints(paragraph, template), 0) ?? 0;

function basePoints(block: PaginatedBlock, template: TemplateV1): number {
  switch (block.type) {
    case 'sectionHeading': return 38;
    case 'heading': case 'sermonTitle': return 28;
    case 'scriptureReading': return 34 + (block.caption ? template.theme.bodySizePt * template.theme.lineHeight + 8.64 : 0);
    case 'song': case 'libraryText': return 30;
    case 'custom': return (block.showName ?? true) ? 30 : 0;
    case 'announcements': return 38;
    case 'copyright': return 34;
    default: return 0;
  }
}

export function estimateBlockPoints(block: PaginatedBlock, template: TemplateV1, library?: LibraryManifestV1): number {
  const presentation = block.type === 'custom' ? { ...block.style, ...block.presentation } : block.presentation;
  const formatted = (points: number) => {
    if (!presentation) return points;
    const widthFactor = Math.min(4, 100 / Math.max(10, presentation.widthPercent ?? 100));
    const padding = presentation.paddingIn ?? { top: 0, bottom: 0 };
    const margin = presentation.marginIn ?? { top: 0, bottom: 0 };
    const verticalBox = ((padding.top ?? 0) + (padding.bottom ?? 0) + (margin.top ?? 0) + (margin.bottom ?? 0)) * 72 + (presentation.borderWidthPt ?? 0) * 2;
    const fontFactor = (presentation.fontSizePt ?? template.theme.bodySizePt) / template.theme.bodySizePt * ((presentation.lineHeight ?? template.theme.lineHeight) / template.theme.lineHeight);
    return points * widthFactor * fontFactor + verticalBox;
  };
  if (block.type === 'group') return formatted(block.children.reduce((total, child) => total + estimateBlockPoints(child, template, library), 0));
  if (block.type === 'paragraph') return formatted(childBlocks(block)!.reduce((total, child) => total + estimateBlockPoints(child, template, library), 0));
  if (block.type === 'titlePage' || block.type === 'churchInfo' || block.type === 'fullPageAsset') return usablePoints(template);
  if (block.type === 'copyright') return Math.min(formatted(500), usablePoints(template));
  if (block.type === 'spacer') return formatted({ small: 8, medium: 18, large: 36 }[block.size]);
  if (block.type === 'responsiveReading') return formatted(block.entries.reduce((total, entry) => total + contentPoints(entry.content, template), 0) + 8);
  if (block.type === 'announcements') return formatted(basePoints(block, template) + block.items.reduce((total, item) => total + 18 + contentPoints(item.content, template), 0));
  if (block.type === 'song' && block.renderMode === 'asset') return formatted(438);
  const content = contentFor(block, library);
  const fallback = (block.type === 'song' || block.type === 'libraryText') && !content ? 48 : 0;
  const points = basePoints(block, template) + contentPoints(content, template) + fallback;
  const density = block.layout?.density === 'compact' ? .84 : 1;
  return formatted(points * density);
}

function splitParagraph(paragraph: Paragraph, maximumCharacters: number): Paragraph[] {
  if (paragraphLength(paragraph) <= maximumCharacters) return [paragraph];
  const groups: Inline[][] = [[]]; let used = 0;
  const nextGroup = () => { groups.push([]); used = 0; };
  for (const child of paragraph.children) {
    if (child.type === 'symbol') {
      if (used >= maximumCharacters) nextGroup();
      groups.at(-1)!.push(child); used += 1; continue;
    }
    let remaining = child.text;
    while (remaining.length) {
      if (used >= maximumCharacters) nextGroup();
      const available = maximumCharacters - used;
      if (remaining.length <= available) { groups.at(-1)!.push({ ...child, text: remaining }); used += remaining.length; break; }
      const candidate = remaining.slice(0, available);
      const whitespace = candidate.lastIndexOf(' ');
      const cut = whitespace > available * .55 ? whitespace + 1 : available;
      groups.at(-1)!.push({ ...child, text: remaining.slice(0, cut).trimEnd() });
      remaining = remaining.slice(cut).trimStart(); nextGroup();
    }
  }
  return groups.filter(group => group.length).map(children => ({ ...paragraph, children }));
}

function groupParagraphs(content: Paragraph[], capacity: number, template: TemplateV1): Paragraph[][] {
  const lines = Math.max(1, Math.floor(capacity / (template.theme.bodySizePt * template.theme.lineHeight + 8.64)));
  const expanded = content.flatMap(paragraph => splitParagraph(paragraph, charsPerLine(template) * lines));
  const groups: Paragraph[][] = []; let group: Paragraph[] = []; let used = 0;
  for (const paragraph of expanded) {
    const height = paragraphPoints(paragraph, template);
    if (group.length && used + height > capacity) { groups.push(group); group = []; used = 0; }
    group.push(paragraph); used += height;
  }
  if (group.length) groups.push(group);
  return groups;
}

function contentFragment(block: PaginatedBlock, content: Paragraph[], index: number): PaginatedBlock {
  const common = { id: `${block.id}-part-${index + 1}`, paginationContinuation: index > 0, layout: { ...block.layout, pageBreakBefore: index ? true : block.layout?.pageBreakBefore } };
  if (block.type === 'richText') return { ...block, ...common, content };
  if (block.type === 'scriptureReading') return { ...block, ...common, label: index ? `${block.label ?? 'Reading'} (continued)` : block.label, caption: index ? undefined : block.caption, resolved: { ...block.resolved!, content } };
  if (block.type === 'song') return { ...block, ...common, label: index ? `${block.label ?? block.songType} (continued)` : block.label, pageContent: content };
  if (block.type === 'libraryText') return { ...block, ...common, title: index ? `${block.title ?? 'Reusable text'} (continued)` : block.title, pageContent: content };
  return block;
}

function splitLongBlocks(blocks: BulletinBlock[], template: TemplateV1, library?: LibraryManifestV1): PaginatedBlock[] {
  const usable = usablePoints(template);
  return blocks.flatMap(original => {
    const block = original as PaginatedBlock;
    if (estimateBlockPoints(block, template, library) <= usable) return [block];
    const content = contentFor(block, library);
    if (content?.length && (block.type === 'richText' || block.type === 'scriptureReading' || block.type === 'song' || block.type === 'libraryText')) {
      return groupParagraphs(content, Math.max(72, usable - basePoints(block, template)), template).map((group, index) => contentFragment(block, group, index));
    }
    if (block.type === 'responsiveReading' && block.entries.length) {
      const entries = block.entries.flatMap(entry => {
        const chunks = groupParagraphs(entry.content, usable, template);
        return (chunks.length ? chunks : [entry.content]).map((content, index) => ({ ...entry, reader: index ? `${entry.reader} (cont.)` : entry.reader, content }));
      });
      const groups: typeof block.entries[] = []; let group: typeof block.entries = []; let used = 0;
      for (const entry of entries) {
        const height = contentPoints(entry.content, template);
        if (group.length && used + height > usable) { groups.push(group); group = []; used = 0; }
        group.push(entry); used += height;
      }
      if (group.length) groups.push(group);
      return groups.map((entries, index) => ({ ...block, id: `${block.id}-part-${index + 1}`, entries, paginationContinuation: index > 0, layout: { ...block.layout, pageBreakBefore: index ? true : block.layout?.pageBreakBefore } }));
    }
    if (block.type === 'announcements' && block.items.length) {
      const capacity = usable - basePoints(block, template);
      const items = block.items.flatMap(item => {
        const chunks = groupParagraphs(item.content, Math.max(72, capacity - 18), template);
        return (chunks.length ? chunks : [item.content]).map((content, index) => ({ ...item, id: index ? `${item.id}-part-${index + 1}` : item.id, title: index ? `${item.title} (continued)` : item.title, content }));
      });
      const groups: typeof block.items[] = []; let group: typeof block.items = []; let used = 0;
      for (const item of items) {
        const height = 18 + contentPoints(item.content, template);
        if (group.length && used + height > capacity) { groups.push(group); group = []; used = 0; }
        group.push(item); used += height;
      }
      if (group.length) groups.push(group);
      return groups.map((items, index) => ({ ...block, id: `${block.id}-part-${index + 1}`, items, paginationContinuation: index > 0, layout: { ...block.layout, pageBreakBefore: index ? true : block.layout?.pageBreakBefore } }));
    }
    return [block];
  });
}

export function paginate(blocks: BulletinBlock[], template: TemplateV1, library?: LibraryManifestV1): PageModel[] {
  const usable = usablePoints(template);
  const pages: PageModel[] = [];
  let current: PaginatedBlock[] = []; let used = 0;
  const flush = () => { if (current.length) pages.push({ number: pages.length + 1, kind: 'content', blocks: current }); current = []; used = 0; };
  for (const block of splitLongBlocks(blocks, template, library)) {
    if (block.type === 'titlePage' || block.type === 'churchInfo' || block.type === 'fullPageAsset') {
      flush(); pages.push({ number: pages.length + 1, kind: block.type === 'fullPageAsset' ? 'fullPage' : 'content', blocks: [block] }); continue;
    }
    const height = estimateBlockPoints(block, template, library);
    if (block.layout?.pageBreakBefore || (current.length && used + height > usable)) flush();
    current.push(block); used += Math.min(height, usable);
  }
  flush();
  while (pages.length % template.page.pageMultiple) pages.push({ number: pages.length + 1, kind: 'filler', blocks: [] });
  return pages;
}
