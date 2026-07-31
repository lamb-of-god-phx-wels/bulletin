import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BlockFormattingModal } from '../src/components/BlockFormattingModal';
import { NativeBlockPreview } from '../src/components/DocumentView';
import { createLayoutContainer, flattenBlocks } from '../src/shared/blocks';
import { createBulletin, defaultTemplate } from '../src/shared/defaults';
import { estimateBlockPoints } from '../src/shared/pagination';
import type { BulletinBlock } from '../src/shared/types';

describe('builder feature blocks', () => {
  it('creates editable stack, grid, and table containers and estimates parallel rows', () => {
    const stack = createLayoutContainer('stack', 'stack');
    const grid = createLayoutContainer('grid', 'grid');
    const table = createLayoutContainer('table', 'table');
    expect(stack).toMatchObject({ type: 'group', layoutMode: 'stack', columns: 1 });
    expect(grid).toMatchObject({ type: 'group', layoutMode: 'grid', columns: 2 });
    expect(table).toMatchObject({ type: 'group', layoutMode: 'table', columns: 2, gapIn: 0 });
    expect(flattenBlocks([grid])).toHaveLength(5);
    expect(estimateBlockPoints(grid, defaultTemplate)).toBeLessThan(estimateBlockPoints({ ...grid, layoutMode: 'stack' }, defaultTemplate));
  });

  it('shows the actual selected block in the format preview', () => {
    const block: BulletinBlock = { id: 'welcome', type: 'heading', text: 'A real heading' };
    const markup = renderToStaticMarkup(createElement(BlockFormattingModal, {
      block,
      template: defaultTemplate,
      scope: 'weekly',
      onClose: () => undefined,
      onSave: () => undefined,
    }));
    expect(markup).toContain('A real heading');
    expect(markup).not.toContain('Sample block content appears here');
  });

  it('renders rich announcement and copyright marks alongside announcement graphics', () => {
    const document = createBulletin(defaultTemplate);
    const announcements: BulletinBlock = {
      id: 'news', type: 'announcements', items: [{
        id: 'event', title: 'Event',
        content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Important', marks: ['bold', 'italic'] }] }],
        asset: { path: 'event.png', mediaType: 'image/png' }, assetSide: 'left'
      }]
    };
    const copyright: BulletinBlock = {
      id: 'rights', type: 'copyright', suppressGeneratedNotices: true,
      extra: [{ type: 'paragraph', children: [{ type: 'text', text: 'Book Title', marks: ['italic'] }] }]
    };
    const announcementMarkup = renderToStaticMarkup(createElement(NativeBlockPreview, { block: announcements, document, library: undefined, assets: { 'event.png': 'data:image/png;base64,AA==' }, marginIn: .4 }));
    const copyrightMarkup = renderToStaticMarkup(createElement(NativeBlockPreview, { block: copyright, document, library: undefined, assets: {}, marginIn: .4 }));
    expect(announcementMarkup).toContain('mark-bold mark-italic');
    expect(announcementMarkup).toContain('announcement-with-asset asset-left');
    expect(copyrightMarkup).toContain('mark-italic');
  });
});
