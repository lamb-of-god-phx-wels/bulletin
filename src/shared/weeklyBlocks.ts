import type { BulletinBlock } from './types.js';

export function insertWeeklyBlock(blocks: BulletinBlock[], block: BulletinBlock, index = blocks.length): BulletinBlock[] {
  const target = Math.max(0, Math.min(blocks.length, index));
  return [...blocks.slice(0, target), block, ...blocks.slice(target)];
}

export function reorderBlocks<T extends { id: string }>(blocks: T[], draggedId: string, targetId: string, position: 'before' | 'after'): T[] {
  const sourceIndex = blocks.findIndex(block => block.id === draggedId);
  if (sourceIndex < 0 || draggedId === targetId || !blocks.some(block => block.id === targetId)) return blocks;
  const next = [...blocks];
  const [dragged] = next.splice(sourceIndex, 1);
  const targetIndex = next.findIndex(block => block.id === targetId);
  next.splice(targetIndex + (position === 'after' ? 1 : 0), 0, dragged);
  return next.every((block, index) => block === blocks[index]) ? blocks : next;
}

export function removeWeeklyBlock(blocks: BulletinBlock[], id: string): BulletinBlock[] {
  return blocks.filter(block => block.id !== id);
}
