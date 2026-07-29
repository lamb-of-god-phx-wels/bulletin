export interface BookletSpread {
  sheet?: number;
  side?: 'front' | 'back';
  leftPage: number | null;
  rightPage: number | null;
}

const paddedPageCount = (pageCount: number) =>
  Math.max(0, Math.ceil(pageCount / 4) * 4);

export function bookletReadingSpreads(pageCount: number): BookletSpread[] {
  const count = paddedPageCount(pageCount);
  if (!count) return [];
  const spreads: BookletSpread[] = [{ leftPage: null, rightPage: 1 }];
  for (let leftPage = 2; leftPage < count; leftPage += 2) {
    spreads.push({ leftPage, rightPage: leftPage + 1 });
  }
  spreads.push({ leftPage: count, rightPage: null });
  return spreads;
}

export function bookletPrinterSpreads(pageCount: number): BookletSpread[] {
  const count = paddedPageCount(pageCount);
  if (!count) return [];
  const spreads: BookletSpread[] = [];
  for (let sheet = 1; sheet <= count / 4; sheet++) {
    const offset = (sheet - 1) * 2;
    spreads.push({
      sheet,
      side: 'front',
      leftPage: count - offset,
      rightPage: 1 + offset
    });
    spreads.push({
      sheet,
      side: 'back',
      leftPage: 2 + offset,
      rightPage: count - 1 - offset
    });
  }
  return spreads;
}
