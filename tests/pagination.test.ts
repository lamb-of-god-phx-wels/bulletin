import { describe, expect, it } from 'vitest';
import { defaultTemplate } from '../src/shared/defaults';
import { estimateBlockPoints, paginate } from '../src/shared/pagination';
import type { BulletinBlock, LibraryManifestV1 } from '../src/shared/types';

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

  it('splits long library songs at paragraph boundaries without dropping content', () => {
    const content = Array.from({ length: 40 }, (_, index) => ({ type: 'paragraph' as const, children: [{ type: 'text' as const, text: `Verse ${index + 1} ${'lyrics '.repeat(45)}` }] }));
    const library: LibraryManifestV1 = { schemaVersion: 1, name: 'Test', items: [{ id: 'long-song', version: 1, kind: 'song', title: 'Long Song', content }] };
    const pages = paginate([{ id: 'song', type: 'song', songType: 'song', libraryItemId: 'long-song', libraryItemVersion: 1, selection: { mode: 'all' }, renderMode: 'lyrics' }], defaultTemplate, library);
    const fragments = pages.flatMap(page => page.blocks).filter(block => block.type === 'song');
    expect(fragments.length).toBeGreaterThan(1);
    expect(fragments.every(fragment => fragment.sourceBlockId === 'song')).toBe(true);
    expect(fragments.flatMap(fragment => fragment.pageContent ?? []).length).toBe(content.length);
  });

  it('splits a single oversized paragraph and keeps every populated page within its estimated capacity', () => {
    const block: BulletinBlock = { id: 'long-text', type: 'richText', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'A long sentence. '.repeat(1500) }] }] };
    const pages = paginate([block], defaultTemplate);
    const populated = pages.filter(page => page.blocks.length);
    expect(populated.length).toBeGreaterThan(1);
    const usable = (defaultTemplate.page.heightIn - defaultTemplate.theme.marginIn * 2) * 72 - 24;
    expect(populated.every(page => page.blocks.reduce((total, entry) => total + estimateBlockPoints(entry, defaultTemplate), 0) <= usable)).toBe(true);
  });

  it('splits one oversized announcement instead of clipping it', () => {
    const pages = paginate([{ id: 'announcements', type: 'announcements', items: [{ id: 'event', title: 'Large event', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Details '.repeat(2500) }] }] }] }], defaultTemplate);
    const fragments = pages.flatMap(page => page.blocks).filter(block => block.type === 'announcements');
    expect(fragments.length).toBeGreaterThan(1);
    expect(fragments.every(fragment => fragment.items.length === 1)).toBe(true);
  });

  it('accounts for per-block width, type size, and box spacing', () => {
    const plain: BulletinBlock = { id: 'song', type: 'song', songType: 'song', libraryItemId: 'missing', selection: { mode: 'all' }, renderMode: 'lyrics' };
    const formatted: BulletinBlock = { ...plain, presentation: {
      widthPercent: 50, fontSizePt: 14, lineHeight: 1.5,
      paddingIn: { top: .2, right: .1, bottom: .2, left: .1 }, marginIn: { top: .1, bottom: .1 }
    } };
    expect(estimateBlockPoints(formatted, defaultTemplate)).toBeGreaterThan(estimateBlockPoints(plain, defaultTemplate));
  });

  it('paginates a weekly song-text override instead of its library source', () => {
    const library: LibraryManifestV1 = { schemaVersion: 1, name: 'Test', items: [{ id: 'song', version: 1, kind: 'song', title: 'Song', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Short library text' }] }] }] };
    const block: BulletinBlock = { id: 'song', type: 'song', songType: 'song', libraryItemId: 'song', libraryItemVersion: 1, selection: { mode: 'all' }, renderMode: 'lyrics', contentOverride: Array.from({ length: 50 }, () => ({ type: 'paragraph', children: [{ type: 'text', text: 'Weekly lyrics '.repeat(50) }] })) };
    expect(paginate([block], defaultTemplate, library).flatMap(page => page.blocks).filter(item => item.type === 'song').length).toBeGreaterThan(1);
  });
});
