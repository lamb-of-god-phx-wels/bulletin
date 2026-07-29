import { describe, expect, it } from 'vitest';
import { bookletPrinterSpreads, bookletReadingSpreads } from '../src/shared/booklet';

describe('booklet preview ordering', () => {
  it('shows covers and facing pages in reading order', () => {
    expect(bookletReadingSpreads(8).map(spread => [spread.leftPage, spread.rightPage])).toEqual([
      [null, 1],
      [2, 3],
      [4, 5],
      [6, 7],
      [8, null]
    ]);
  });

  it('imposes pages on printer sheet fronts and backs', () => {
    expect(bookletPrinterSpreads(12)).toEqual([
      { sheet: 1, side: 'front', leftPage: 12, rightPage: 1 },
      { sheet: 1, side: 'back', leftPage: 2, rightPage: 11 },
      { sheet: 2, side: 'front', leftPage: 10, rightPage: 3 },
      { sheet: 2, side: 'back', leftPage: 4, rightPage: 9 },
      { sheet: 3, side: 'front', leftPage: 8, rightPage: 5 },
      { sheet: 3, side: 'back', leftPage: 6, rightPage: 7 }
    ]);
  });

  it('pads incomplete booklets to a four-page signature', () => {
    expect(bookletPrinterSpreads(6).at(0)).toMatchObject({ leftPage: 8, rightPage: 1 });
  });
});
