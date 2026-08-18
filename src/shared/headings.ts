import type { BulletinBlock, HeadingBlock, HeadingLevel, LegacySectionHeadingBlock } from './types.js';

export type HeadingLikeBlock = HeadingBlock | LegacySectionHeadingBlock;

export function effectiveHeadingLevel(block: HeadingLikeBlock): HeadingLevel {
  return block.type === 'sectionHeading' ? 'h2' : block.level ?? 'h3';
}

export function normalizeHeadingBlock(block: BulletinBlock): BulletinBlock {
  if (block.type === 'sectionHeading') {
    const { type: _legacyType, ...rest } = block;
    return { ...rest, type: 'heading', level: 'h2' };
  }
  return block.type === 'heading' && !block.level ? { ...block, level: 'h3' } : block;
}
