import { describe, expect, it } from 'vitest';
import { insertWeeklyBlock, moveWeeklyBlock, removeWeeklyBlock } from '../src/shared/weeklyBlocks';
import type { BulletinBlock } from '../src/shared/types';

const block = (id: string): BulletinBlock => ({ id, type: 'heading', text: id });

describe('weekly block editing', () => {
  it('inserts at a requested position without changing the existing blocks', () => {
    const original = [block('one'), block('three')];
    expect(insertWeeklyBlock(original, block('two'), 1).map(item => item.id)).toEqual(['one', 'two', 'three']);
    expect(original.map(item => item.id)).toEqual(['one', 'three']);
  });

  it('moves blocks while treating page boundaries as a no-op', () => {
    const blocks = [block('one'), block('two'), block('three')];
    expect(moveWeeklyBlock(blocks, 1, -1).map(item => item.id)).toEqual(['two', 'one', 'three']);
    expect(moveWeeklyBlock(blocks, 0, -1)).toBe(blocks);
  });

  it('removes only the selected weekly block', () => {
    expect(removeWeeklyBlock([block('one'), block('two')], 'one').map(item => item.id)).toEqual(['two']);
  });
});
