import type { BulletinBlock } from './types.js';

export function insertWeeklyBlock(blocks: BulletinBlock[], block: BulletinBlock, index = blocks.length): BulletinBlock[] {
  const target = Math.max(0, Math.min(blocks.length, index));
  return [...blocks.slice(0, target), block, ...blocks.slice(target)];
}

export function moveWeeklyBlock(blocks: BulletinBlock[], index: number, by: number): BulletinBlock[] {
  const target = index + by;
  if (index < 0 || index >= blocks.length || target < 0 || target >= blocks.length) return blocks;
  const next = [...blocks];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function removeWeeklyBlock(blocks: BulletinBlock[], id: string): BulletinBlock[] {
  return blocks.filter(block => block.id !== id);
}
