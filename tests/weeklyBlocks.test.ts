import { describe, expect, it } from 'vitest';
import { insertWeeklyBlock, removeWeeklyBlock, reorderBlocks } from '../src/shared/weeklyBlocks';
import type { BulletinBlock } from '../src/shared/types';

const block = (id: string): BulletinBlock => ({ id, type: 'heading', text: id });

describe('weekly block editing', () => {
  it('inserts at a requested position without changing the existing blocks', () => {
    const original = [block('one'), block('three')];
    expect(insertWeeklyBlock(original, block('two'), 1).map(item => item.id)).toEqual(['one', 'two', 'three']);
    expect(original.map(item => item.id)).toEqual(['one', 'three']);
  });

  it('reorders blocks before or after a drop target', () => {
    const blocks = [block('one'), block('two'), block('three'), block('four')];
    expect(reorderBlocks(blocks, 'one', 'three', 'after').map(item => item.id)).toEqual(['two', 'three', 'one', 'four']);
    expect(reorderBlocks(blocks, 'four', 'two', 'before').map(item => item.id)).toEqual(['one', 'four', 'two', 'three']);
    expect(reorderBlocks(blocks, 'two', 'three', 'before')).toBe(blocks);
    expect(reorderBlocks(blocks, 'missing', 'two', 'before')).toBe(blocks);
  });

  it('removes only the selected weekly block', () => {
    expect(removeWeeklyBlock([block('one'), block('two')], 'one').map(item => item.id)).toEqual(['two']);
  });
});
