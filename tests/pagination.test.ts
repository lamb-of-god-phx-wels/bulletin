import { describe, expect, it } from 'vitest';
import { defaultTemplate } from '../src/shared/defaults';
import { paginate } from '../src/shared/pagination';
import type { BulletinBlock } from '../src/shared/types';

describe('pagination', () => {
  it('puts fixed pages on their own and pads to a four-page signature', () => {
    const blocks: BulletinBlock[] = [
      { id: 'cover', type: 'titlePage' },
      { id: 'heading', type: 'heading', text: 'Invocation' },
      { id: 'page', type: 'fullPageAsset', asset: { path: 'assets/music.pdf', mediaType: 'application/pdf' } }
    ];
    const pages = paginate(blocks, defaultTemplate);
    expect(pages).toHaveLength(4);
    expect(pages.map(page => page.kind)).toEqual(['content', 'content', 'fullPage', 'filler']);
  });

  it('honors an explicit page break', () => {
    const pages = paginate([
      { id: 'one', type: 'heading', text: 'One' },
      { id: 'two', type: 'heading', text: 'Two', layout: { pageBreakBefore: true } }
    ], defaultTemplate);
    expect(pages[0].blocks).toHaveLength(1);
    expect(pages[1].blocks[0].id).toBe('two');
  });
});
