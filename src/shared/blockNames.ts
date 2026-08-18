import { childBlocks } from './blocks.js';
import { scriptureElementNames } from './scriptureReading.js';
import { songHeader } from './songs.js';
import type { BulletinBlock, Paragraph } from './types.js';

const text = (content?: Paragraph[]) => (content ?? [])
  .flatMap(paragraph => paragraph.children)
  .map(run => run.type === 'text' ? run.text : run.type === 'lineBreak' ? ' ' : '✠')
  .join(' ')
  .replace(/\s+/g, ' ')
  .trim();

const concise = (value: string, fallback: string) => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return fallback;
  return normalized.length > 64 ? `${normalized.slice(0, 61).trimEnd()}…` : normalized;
};

export function blockDisplayName(block: BulletinBlock): string {
  if (block.displayName?.trim()) return concise(block.displayName, 'Element');
  if (block.type === 'paragraph') {
    const heading = childBlocks(block)?.find(child => child.type === 'richText' && child.role === 'header');
    return concise(heading?.type === 'richText' ? text(heading.content) : '', 'Paragraph');
  }
  if (block.type === 'custom' || block.type === 'templatePage' || block.type === 'templateInstance') return concise(block.name, block.type === 'custom' ? 'Custom element' : block.type === 'templatePage' ? 'Template page' : 'Sub-template');
  if (block.type === 'song') return concise(songHeader(block), 'Song');
  if (block.type === 'scriptureReading') return concise(block.label || block.reference, 'Scripture reading');
  if (block.type === 'responsiveReading') return concise(block.label || text(block.heading?.content) || block.heading?.text || '', 'Responsive reading');
  if (block.type === 'libraryText') return concise(block.label || block.title || '', 'Reusable text');
  if (block.type === 'richText') {
    if (block.scriptureRole) return scriptureElementNames[block.scriptureRole];
    return concise(text(block.content), block.role === 'header' ? 'Header text' : 'Paragraph text');
  }
  if (block.type === 'heading' || block.type === 'sectionHeading' || block.type === 'sermonTitle') return concise(text(block.content) || block.text, block.type === 'sermonTitle' ? 'Sermon title' : 'Heading');
  if (block.type === 'image') return concise(block.alt || block.asset.alt || '', 'Image');
  if (block.type === 'fullPageAsset') return concise(block.asset.alt || '', 'Full-page asset');
  if (block.type === 'group') return concise(block.label || '', block.layoutMode === 'table' ? 'Table' : block.layoutMode === 'grid' ? 'Grid' : 'Stack');
  if (block.type === 'canvas') return concise(block.label || '', 'Canvas');
  if (block.type === 'announcements') return concise(block.label || '', 'Announcements');
  if (block.type === 'list') return concise(block.label || '', 'List');
  if (block.type === 'copyright') return concise(block.label || '', 'Copyright');
  if (block.type === 'spacer') return `${block.size[0].toUpperCase()}${block.size.slice(1)} spacer`;
  return concise(block.label || '', block.type.replace(/([a-z])([A-Z])/g, '$1 $2'));
}
