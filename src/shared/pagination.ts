import type { BulletinBlock, BulletinDocumentV1, CustomBlockStyle, Inline, LibraryManifestV1, Paragraph, TemplateV1 } from './types.js';
import { childBlocks, groupChildCell } from './blocks.js';
import { scriptureElementBlocks, scriptureElementHasContent } from './scriptureReading.js';
import { paragraphsHaveVisibleContent } from './plainText.js';
import { pageTemplateMargin } from './pageTemplates.js';
import { songHeader } from './songs.js';
import { effectiveResponsiveReadingSettings, isSilentPrayerEntry, responsiveEntryReader } from './responsiveReading.js';
import { conditionVisible, resolveConditionalBlocks } from './customProperties.js';
import { effectiveHeadingLevel } from './headings.js';

export type PaginatedBlock = BulletinBlock & { pageContent?: Paragraph[]; paginationContinuation?: boolean; sourceBlockId?: string };
export interface PageModel { number: number; kind: 'content' | 'fullPage' | 'filler'; blocks: PaginatedBlock[]; marginIn?: number }

const paragraphLength = (paragraph: Paragraph) => paragraph.children.reduce((count, child) => count + (child.type === 'text' ? child.text.length : 1), 0);
const itemFor = (block: PaginatedBlock, library?: LibraryManifestV1) => 'libraryItemId' in block
  ? library?.items.filter(item => item.id === block.libraryItemId && (!block.libraryItemVersion || item.version === block.libraryItemVersion)).sort((a, b) => b.version - a.version)[0]
  : undefined;

function contentFor(block: PaginatedBlock, library?: LibraryManifestV1): Paragraph[] | undefined {
  if (block.pageContent) return block.pageContent;
  if (block.type === 'richText') {
    if (block.bindingOverride) return block.bindingOverride;
    const binding = block.binding;
    if (binding && typeof binding === 'object' && binding.kind === 'libraryItem') {
      return library?.items.filter(item => item.id === binding.itemId && (!binding.version || item.version === binding.version)).sort((left, right) => right.version - left.version)[0]?.content ?? block.content;
    }
    return block.content;
  }
  if (block.type === 'scriptureReading') return block.resolved?.content;
  if (block.type === 'song' && block.renderMode === 'lyrics') return block.contentOverride ?? itemFor(block, library)?.content;
  if (block.type === 'libraryText') return block.contentOverride ?? itemFor(block, library)?.content;
  if (block.type === 'custom') return block.layoutText.split(/\n\s*\n/).filter(Boolean).map(text => ({ type: 'paragraph', children: [{ type: 'text', text: text.replace(/\n/g, ' ') }] }));
  return undefined;
}

const physicalContentPoints = (template: TemplateV1) => (template.page.heightIn - template.theme.marginIn * 2) * 72;
const usablePoints = (template: TemplateV1) => physicalContentPoints(template) - 24;
const charsPerLine = (template: TemplateV1) => Math.max(42, Math.floor(((template.page.widthIn - template.theme.marginIn * 2) * 72) / (template.theme.bodySizePt * .56)));
const paragraphPoints = (paragraph: Paragraph, template: TemplateV1) => {
  const explicitLines = 1 + paragraph.children.reduce((count, child) => count + (child.type === 'lineBreak' ? 1 : child.type === 'text' ? child.text.split('\n').length - 1 : 0), 0);
  const wrappedLines = Math.max(1, Math.ceil(paragraphLength(paragraph) / charsPerLine(template)));
  return Math.max(explicitLines, wrappedLines) * template.theme.bodySizePt * template.theme.lineHeight + 8.64;
};
const contentPoints = (content: Paragraph[] | undefined, template: TemplateV1) => content?.reduce((total, paragraph) => total + paragraphPoints(paragraph, template) - (paragraph.breakBefore === 'line' ? 8.64 : 0), 0) ?? 0;

function basePoints(block: PaginatedBlock, template: TemplateV1): number {
  switch (block.type) {
    case 'sectionHeading': return 38;
    case 'heading': {
      const main = { h1: 44, h2: 38, h3: 28 }[effectiveHeadingLevel(block)];
      const subheading = block.subheading?.trim() ? 16 : 0;
      const captionLines = block.caption?.trim() ? Math.max(1, block.caption.split('\n').length) : 0;
      return main + subheading + captionLines * 14;
    }
    case 'sermonTitle': return 28;
    case 'scriptureReading': return 34 + (block.caption ? template.theme.bodySizePt * template.theme.lineHeight + 8.64 : 0);
    case 'song': case 'libraryText': return 30;
    case 'custom': return (block.showName ?? true) ? 30 : 0;
    case 'announcements': return 38;
    case 'list': return 0;
    case 'copyright': return 34;
    default: return 0;
  }
}

export function estimateBlockPoints(block: PaginatedBlock, template: TemplateV1, library?: LibraryManifestV1, document?: BulletinDocumentV1): number {
  const presentation = block.type === 'custom' ? { ...block.style, ...block.presentation } : block.presentation;
  const formatPoints = (points: number, style: Partial<CustomBlockStyle> | undefined, singleBorder = false) => {
    if (!style) return points;
    const widthFactor = Math.min(4, 100 / Math.max(10, style.widthPercent ?? 100));
    const padding = style.paddingIn ?? { top: 0, bottom: 0 };
    const margin = style.marginIn ?? { top: 0, bottom: 0 };
    const borderPoints = (style.borderWidthPt ?? 0) * (singleBorder ? 1 : 2);
    const verticalBox = ((padding.top ?? 0) + (padding.bottom ?? 0) + (margin.top ?? 0) + (margin.bottom ?? 0)) * 72 + borderPoints;
    const fontFactor = (style.fontSizePt ?? template.theme.bodySizePt) / template.theme.bodySizePt * ((style.lineHeight ?? template.theme.lineHeight) / template.theme.lineHeight);
    return points * widthFactor * fontFactor + verticalBox;
  };
  const formatted = (points: number) => formatPoints(points, presentation, block.type === 'copyright');
  if (block.type === 'group') {
    const visibleChildren = block.children.map((child, index) => ({ child, index })).filter(({ child }) => conditionVisible(child, template, document));
    const childPoints = visibleChildren.map(({ child }) => estimateBlockPoints(child, template, library, document));
    if (!visibleChildren.length) return formatted(0);
    if ((block.layoutMode ?? 'stack') === 'stack') return formatted(childPoints.reduce((total, points) => total + points, 0) + Math.max(0, childPoints.length - 1) * (block.gapIn ?? 0) * 72);
    const rowCount = Math.max(block.rows ?? 1, ...visibleChildren.map(({ child, index }) => groupChildCell(block, child, index).row));
    const fixedRows = block.gridSizing === 'custom' && block.rowHeightsIn?.length === rowCount && block.rowHeightsIn.every(value => Number.isFinite(value) && value > 0)
      ? block.rowHeightsIn.reduce((total, height) => total + height * 72, 0)
      : undefined;
    if (fixedRows !== undefined) return formatted(fixedRows + Math.max(0, rowCount - 1) * (block.layoutMode === 'table' ? 0 : (block.gapIn ?? .12) * 72));
    const rows = Array.from({ length: rowCount }, (_, row) => Math.max(0, ...visibleChildren.flatMap(({ child, index }, childIndex) => groupChildCell(block, child, index).row === row + 1 ? [childPoints[childIndex]] : [])));
    return formatted(rows.reduce((total, points) => total + points, 0) + Math.max(0, rows.length - 1) * (block.layoutMode === 'table' ? 0 : (block.gapIn ?? .12) * 72));
  }
  if (block.type === 'canvas') return formatted(block.heightIn * 72);
  if (block.type === 'image') return formatted((block.heightIn ?? 2.5) * 72);
  if (block.type === 'paragraph') return formatted(childBlocks(block)!.filter(child => conditionVisible(child, template, document)).reduce((total, child) => total + estimateBlockPoints(child, template, library, document), 0));
  if (block.type === 'titlePage' || block.type === 'canvasCover' || block.type === 'templatePage' || block.type === 'churchInfo' || block.type === 'fullPageAsset') return usablePoints(template);
  if (block.type === 'copyright') {
    const before = block.beforeNotices ?? block.extra;
    return Math.min(formatted(basePoints(block, template) + (paragraphsHaveVisibleContent(before) ? contentPoints(before, template) : 0) + (paragraphsHaveVisibleContent(block.afterNotices) ? contentPoints(block.afterNotices, template) : 0) + (block.suppressGeneratedNotices ? 0 : 110)), usablePoints(template));
  }
  if (block.type === 'spacer') return formatted({ small: 8, medium: 18, large: 36 }[block.size]);
  if (block.type === 'responsiveReading') return formatted(block.entries.reduce((total, entry) => total + contentPoints(entry.content, template), 0) + (block.heading && conditionVisible(block.heading, template, document) ? estimateBlockPoints(block.heading, template, library, document) : 0) + 8);
  if (block.type === 'scriptureReading') {
    const elements = scriptureElementBlocks(block)
      .filter(element => conditionVisible(element, template, document) && (block.paginationContinuation
        ? element.scriptureRole === 'body'
        : element.scriptureRole === 'reference' || element.scriptureRole === 'body' || scriptureElementHasContent(element)));
    return formatted(elements.reduce((total, element) => total + estimateBlockPoints(element, template, library, document), 0) + (block.paginationContinuation ? 0 : 10));
  }
  if (block.type === 'announcements') return formatted(basePoints(block, template) + block.items.reduce((total, item) => total + 18 + contentPoints(item.content, template) + (item.asset ? 54 : 0), 0));
  if (block.type === 'list') return formatted(basePoints(block, template) + block.items.reduce((total, item) => total + 18 + contentPoints(item.titleContent, template) + contentPoints(item.content, template) + (item.asset ? 54 : 0), 0));
  const content = contentFor(block, library);
  if (block.type === 'song') {
    const heading = block.showHeading === false
      ? 0
      : formatPoints(15, block.elements?.header?.presentation) + formatPoints(15, block.elements?.title?.presentation);
    const body = block.renderMode === 'asset'
      ? (block.assetHeightIn ?? 5.6) * 72
      : contentPoints(content, template) + (!content ? 48 : 0);
    return formatted(heading + formatPoints(body, block.elements?.body?.presentation));
  }
  const fallback = block.type === 'libraryText' && !content ? 48 : 0;
  const points = basePoints(block, template) + contentPoints(content, template) + fallback;
  const density = block.layout?.density === 'compact' ? .84 : 1;
  return formatted(points * density);
}

function splitParagraph(paragraph: Paragraph, maximumCharacters: number): Paragraph[] {
  if (paragraphLength(paragraph) <= maximumCharacters) return [paragraph];
  const groups: Inline[][] = [[]]; let used = 0;
  const nextGroup = () => { groups.push([]); used = 0; };
  for (const child of paragraph.children) {
    if (child.type === 'lineBreak') {
      groups.at(-1)!.push(child);
      continue;
    }
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
  const common = { id: `${block.id}-part-${index + 1}`, sourceBlockId: block.sourceBlockId ?? block.id, paginationContinuation: index > 0, layout: { ...block.layout, pageBreakBefore: index ? true : block.layout?.pageBreakBefore } };
  if (block.type === 'richText') return block.binding ? { ...block, ...common, bindingOverride: content } : { ...block, ...common, content };
  if (block.type === 'scriptureReading') return { ...block, ...common, caption: index ? undefined : block.caption, resolved: { ...block.resolved!, content } };
  if (block.type === 'song') return { ...block, ...common, label: index ? `${songHeader(block)} (continued)` : block.label, pageContent: content };
  if (block.type === 'libraryText') return { ...block, ...common, title: index ? `${block.title ?? 'Reusable text'} (continued)` : block.title, pageContent: content };
  return block;
}

function splitLongBlocks(blocks: BulletinBlock[], template: TemplateV1, library?: LibraryManifestV1, document?: BulletinDocumentV1): PaginatedBlock[] {
  const usable = usablePoints(template);
  return blocks.flatMap(original => {
    const block = original as PaginatedBlock;
    if (estimateBlockPoints(block, template, library, document) <= usable) return [block];
    const content = contentFor(block, library);
    if (content?.length && (block.type === 'richText' || block.type === 'song' || block.type === 'libraryText')) {
      return groupParagraphs(content, Math.max(72, usable - basePoints(block, template)), template).map((group, index) => contentFragment(block, group, index));
    }
    if (block.type === 'responsiveReading' && block.entries.length) {
      const settings = effectiveResponsiveReadingSettings(template);
      const entries = block.entries.flatMap(entry => {
        const chunks = groupParagraphs(entry.content, usable, template);
        return (chunks.length ? chunks : [entry.content]).map((content, index) => index && !isSilentPrayerEntry(entry)
          ? { ...entry, reader: `${responsiveEntryReader(entry, settings)} (cont.)`, readerMode: 'custom' as const, content }
          : { ...entry, content });
      });
      const groups: typeof block.entries[] = []; let group: typeof block.entries = []; let used = 0;
      for (const entry of entries) {
        const height = contentPoints(entry.content, template);
        if (group.length && used + height > usable) { groups.push(group); group = []; used = 0; }
        group.push(entry); used += height;
      }
      if (group.length) groups.push(group);
      return groups.map((entries, index) => ({ ...block, heading: index ? undefined : block.heading, id: `${block.id}-part-${index + 1}`, sourceBlockId: block.sourceBlockId ?? block.id, entries, paginationContinuation: index > 0, layout: { ...block.layout, pageBreakBefore: index ? true : block.layout?.pageBreakBefore } }));
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
      return groups.map((items, index) => ({ ...block, id: `${block.id}-part-${index + 1}`, sourceBlockId: block.sourceBlockId ?? block.id, items, paginationContinuation: index > 0, layout: { ...block.layout, pageBreakBefore: index ? true : block.layout?.pageBreakBefore } }));
    }
    if (block.type === 'list' && block.items.length) {
      const capacity = usable - basePoints(block, template);
      const items = block.items.flatMap(item => {
        const chunks = groupParagraphs(item.content, Math.max(72, capacity - 18), template);
        return (chunks.length ? chunks : [item.content]).map((content, index) => ({ ...item, id: index ? `${item.id}-part-${index + 1}` : item.id, title: index && item.title ? `${item.title} (continued)` : item.title, titleContent: index ? undefined : item.titleContent, content }));
      });
      const groups: typeof block.items[] = []; let group: typeof block.items = []; let used = 0;
      for (const item of items) {
        const height = 18 + contentPoints(item.titleContent, template) + contentPoints(item.content, template);
        if (group.length && used + height > capacity) { groups.push(group); group = []; used = 0; }
        group.push(item); used += height;
      }
      if (group.length) groups.push(group);
      return groups.map((items, index) => ({ ...block, id: `${block.id}-part-${index + 1}`, sourceBlockId: block.sourceBlockId ?? block.id, items, paginationContinuation: index > 0, layout: { ...block.layout, pageBreakBefore: index ? true : block.layout?.pageBreakBefore } }));
    }
    return [block];
  });
}

export function paginate(blocks: BulletinBlock[], template: TemplateV1, library?: LibraryManifestV1, document?: BulletinDocumentV1): PageModel[] {
  const usable = usablePoints(template);
  const scriptureUsable = physicalContentPoints(template);
  const pages: PageModel[] = [];
  let current: PaginatedBlock[] = []; let used = 0;
  const flush = () => { if (current.length) pages.push({ number: pages.length + 1, kind: 'content', blocks: current }); current = []; used = 0; };
  const flattenInstances = (items: BulletinBlock[]): BulletinBlock[] => items.flatMap(block => block.type === 'templateInstance' ? flattenInstances(block.blocks) : [block]);
  const renderBlocks = flattenInstances(resolveConditionalBlocks(blocks, template, document));
  for (const block of splitLongBlocks(renderBlocks, template, library, document)) {
    if (block.type === 'titlePage' || block.type === 'canvasCover' || block.type === 'templatePage' || block.type === 'churchInfo' || block.type === 'fullPageAsset') {
      flush(); pages.push({
        number: pages.length + 1,
        kind: block.type === 'fullPageAsset' ? 'fullPage' : 'content',
        blocks: [block],
        ...(block.type === 'templatePage' ? { marginIn: pageTemplateMargin(block.margin, template.theme.marginIn) } : {})
      }); continue;
    }
    if (block.type === 'scriptureReading' && block.resolved?.content.length && !block.layout?.keepTogether) {
      if (block.layout?.pageBreakBefore) flush();
      const empty = { ...block, resolved: { ...block.resolved, content: [] } };
      const chrome = estimateBlockPoints(empty, template, library, document);
      const minimumBody = 2 * (template.theme.bodySizePt * template.theme.lineHeight + 8.64);
      if (current.length && scriptureUsable - used < chrome + minimumBody) flush();
      const firstCapacity = Math.max(minimumBody, scriptureUsable - used - chrome);
      const initialGroups = groupParagraphs(block.resolved.content, firstCapacity, template);
      const first = initialGroups[0] ?? block.resolved.content;
      const remaining = initialGroups.slice(1).flat();
      const groups = [first, ...(remaining.length ? groupParagraphs(remaining, scriptureUsable, template) : [])];
      groups.forEach((content, index) => {
        if (index) flush();
        const fragment = groups.length === 1 ? block : contentFragment(block, content, index);
        if (index) fragment.layout = { ...fragment.layout, pageBreakBefore: false };
        const height = estimateBlockPoints(fragment, template, library, document);
        current.push(fragment); used += Math.min(height, scriptureUsable);
        if (index < groups.length - 1) flush();
      });
      continue;
    }
    const height = estimateBlockPoints(block, template, library, document);
    if (block.layout?.pageBreakBefore || (current.length && used + height > usable)) flush();
    current.push(block); used += Math.min(height, usable);
  }
  flush();
  while (pages.length % template.page.pageMultiple) pages.push({ number: pages.length + 1, kind: 'filler', blocks: [] });
  return pages;
}
