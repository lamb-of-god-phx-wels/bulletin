import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BlockFormattingModal } from '../src/components/BlockFormattingModal';
import { NativeBlockPreview } from '../src/components/DocumentView';
import { createLayoutContainer, createTableCell, flattenBlocks, groupAcceptsChild, groupChildCell, moveGroupChildToCell, moveGroupChildToRoot, placeGroupChild } from '../src/shared/blocks';
import { createBulletin, defaultTemplate } from '../src/shared/defaults';
import { estimateBlockPoints } from '../src/shared/pagination';
import type { BulletinBlock } from '../src/shared/types';

describe('builder feature blocks', () => {
  it('creates editable stack, grid, and table containers and estimates parallel rows', () => {
    const stack = createLayoutContainer('stack', 'stack');
    const grid = createLayoutContainer('grid', 'grid');
    const table = createLayoutContainer('table', 'table');
    expect(stack).toMatchObject({ type: 'group', layoutMode: 'stack', columns: 1 });
    expect(grid).toMatchObject({ type: 'group', layoutMode: 'grid', columns: 2, rows: 2 });
    expect(table).toMatchObject({ type: 'group', layoutMode: 'table', columns: 2, rows: 2, gapIn: 0 });
    expect(stack.children).toEqual([]);
    expect(grid.children).toEqual([]);
    expect(table.children).toHaveLength(4);
    expect(table.children.every(child => child.type === 'richText')).toBe(true);
    const populatedGrid: BulletinBlock = { ...grid, children: [
      { id: 'first', type: 'heading', text: 'First' },
      { id: 'second', type: 'heading', text: 'Second' }
    ] };
    expect(flattenBlocks([grid])).toHaveLength(1);
    expect(estimateBlockPoints(populatedGrid, defaultTemplate)).toBeLessThan(estimateBlockPoints({ ...populatedGrid, layoutMode: 'stack' }, defaultTemplate));
  });

  it('places and moves grid children in explicit cells', () => {
    const empty = createLayoutContainer('grid', 'grid');
    const withHeading = placeGroupChild(empty, { id: 'heading', type: 'heading', text: 'Heading' }, { row: 2, column: 2 });
    const withImage = placeGroupChild(withHeading, { id: 'image', type: 'image', asset: { path: 'image.png', mediaType: 'image/png' } });
    expect(groupChildCell(withImage, withImage.children[0], 0)).toEqual({ row: 2, column: 2 });
    expect(groupChildCell(withImage, withImage.children[1], 1)).toEqual({ row: 1, column: 1 });
    const moved = moveGroupChildToCell(withImage, 'image', { row: 2, column: 2 });
    expect(moved.children.find(child => child.id === 'image')?.gridPosition).toEqual({ row: 2, column: 2 });
    expect(moved.children.find(child => child.id === 'heading')?.gridPosition).toEqual({ row: 1, column: 1 });
  });

  it('keeps tables specialized to rich-text cells', () => {
    const table = createLayoutContainer('table', 'table');
    const text = createTableCell('cell');
    expect(groupAcceptsChild(table, text)).toBe(true);
    expect(groupAcceptsChild(table, { id: 'image', type: 'image', asset: { path: 'x.png', mediaType: 'image/png' } })).toBe(false);
    expect(table.children.map(child => child.gridPosition)).toEqual([
      { row: 1, column: 1 }, { row: 1, column: 2 }, { row: 2, column: 1 }, { row: 2, column: 2 }
    ]);
    expect(placeGroupChild(table, { id: 'heading', type: 'heading', text: 'No' }, { row: 1, column: 2 })).toBe(table);
  });

  it('renders saved grid sizing and preview resize controls', () => {
    const document = createBulletin(defaultTemplate);
    const grid: BulletinBlock = {
      ...createLayoutContainer('grid', 'sized-grid'),
      gridSizing: 'custom', columnWidths: [1, 2], rowHeightsIn: [.5, .75],
      children: [{ id: 'text', type: 'richText', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Cell' }] }], gridPosition: { row: 1, column: 1 } }]
    };
    const markup = renderToStaticMarkup(createElement(NativeBlockPreview, { block: grid, document, library: undefined, assets: {}, marginIn: .4, onBlockChange: () => undefined }));
    expect(markup).toContain('grid-template-columns:1fr 2fr');
    expect(markup).toContain('grid-template-rows:0.5in 0.75in');
    expect(markup).toContain('Resize columns 1 and 2');
    expect(markup).toContain('>Auto</button>');
    expect(markup).toContain('>Reset</button>');
  });

  it('renders optional table headers and hidden lines', () => {
    const document = createBulletin(defaultTemplate);
    const table: BulletinBlock = { ...createLayoutContainer('table', 'table'), tableHeaderRow: true, tableShowLines: false };
    const markup = renderToStaticMarkup(createElement(NativeBlockPreview, { block: table, document, library: undefined, assets: {}, marginIn: .4, onBlockChange: () => undefined }));
    expect(markup).toContain('has-table-header');
    expect(markup).toContain('table-lines-hidden');
    expect(markup.match(/contentEditable="true"/g)).toHaveLength(4);
    expect(markup).not.toContain('Add element');
  });

  it('moves a nested layout child back into the root flow', () => {
    const stack = placeGroupChild(createLayoutContainer('stack', 'stack'), { id: 'nested', type: 'heading', text: 'Nested' });
    const roots: BulletinBlock[] = [{ id: 'before', type: 'spacer', size: 'small' }, stack, { id: 'after', type: 'spacer', size: 'large' }];
    const moved = moveGroupChildToRoot(roots, 'stack', 'nested', 'after', 'before');
    expect(moved.map(block => block.id)).toEqual(['before', 'stack', 'nested', 'after']);
    expect((moved.find(block => block.id === 'stack') as Extract<BulletinBlock, { type: 'group' }>).children).toEqual([]);
    expect(moved.find(block => block.id === 'nested')?.gridPosition).toBeUndefined();
  });

  it('renders arbitrary native elements inside layout containers', () => {
    const document = createBulletin(defaultTemplate);
    const group: BulletinBlock = {
      id: 'mixed-layout', type: 'group', layoutMode: 'grid', columns: 2, children: [
        { id: 'heading', type: 'heading', text: 'Nested heading' },
        { id: 'image', type: 'image', asset: { path: 'nested.png', mediaType: 'image/png' }, heightIn: 1 },
        { id: 'spacer', type: 'spacer', size: 'small' }
      ]
    };
    const markup = renderToStaticMarkup(createElement(NativeBlockPreview, { block: group, document, library: undefined, assets: { 'nested.png': 'data:image/png;base64,AA==' }, marginIn: .4 }));
    expect(flattenBlocks([group]).map(block => block.type)).toEqual(['group', 'heading', 'image', 'spacer']);
    expect(markup).toContain('Nested heading');
    expect(markup).toContain('native-image-block');
    expect(markup).toContain('spacer-small');
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

  it('renders manual copyright entries before and after generated notices', () => {
    const copyright: BulletinBlock = {
      id: 'rights', type: 'copyright',
      beforeNotices: [{ type: 'paragraph', children: [{ type: 'text', text: 'Manual preface', marks: ['italic'] }] }],
      afterNotices: [{ type: 'paragraph', children: [{ type: 'text', text: 'OneLicense.net account notice', marks: ['bold'] }] }]
    };
    const scripture: BulletinBlock = {
      id: 'reading', type: 'scriptureReading', reference: 'John 1:1', translation: 'NIV',
      resolved: { source: 'manual', retrievedAt: '2026-08-03T00:00:00.000Z', attribution: 'Generated Scripture attribution', content: [] }
    };
    const document = { ...createBulletin(defaultTemplate), blocks: [scripture, copyright] };
    const markup = renderToStaticMarkup(createElement(NativeBlockPreview, { block: copyright, document, library: undefined, assets: {}, marginIn: .4 }));
    expect(markup.indexOf('Manual preface')).toBeLessThan(markup.indexOf('Generated Scripture attribution'));
    expect(markup.indexOf('Generated Scripture attribution')).toBeLessThan(markup.indexOf('OneLicense.net account notice'));
    expect(markup).toContain('copyright-section copyright-before');
    expect(markup).toContain('copyright-section copyright-generated');
    expect(markup).toContain('copyright-section copyright-after');
    expect(markup).toContain('mark-italic');
    expect(markup).toContain('mark-bold');
  });

  it('renders rich-text copyright notices from library entries', () => {
    const song: BulletinBlock = { id: 'song', type: 'song', libraryItemId: 'anthem', songType: 'song', selection: { mode: 'all' }, renderMode: 'lyrics' };
    const copyright: BulletinBlock = { id: 'rights', type: 'copyright' };
    const document = { ...createBulletin(defaultTemplate), blocks: [song, copyright] };
    const library = {
      schemaVersion: 1 as const,
      name: 'Test library',
      items: [{
        id: 'anthem', version: 1, kind: 'song' as const, title: 'Anthem',
        license: { notice: [{ type: 'paragraph' as const, align: 'right' as const, children: [{ type: 'text' as const, text: 'Formatted license', marks: ['italic' as const] }] }] }
      }]
    };
    const markup = renderToStaticMarkup(createElement(NativeBlockPreview, { block: copyright, document, library, assets: {}, marginIn: .4 }));
    expect(markup).toContain('Formatted license');
    expect(markup).toContain('mark-italic');
    expect(markup).toContain('text-align:right');
  });

  it('keeps legacy additional copyright text before generated notices', () => {
    const copyright: BulletinBlock = { id: 'rights', type: 'copyright', suppressGeneratedNotices: true, extra: [{ type: 'paragraph', children: [{ type: 'text', text: 'Legacy manual notice' }] }] };
    const document = createBulletin(defaultTemplate);
    const markup = renderToStaticMarkup(createElement(NativeBlockPreview, { block: copyright, document, library: undefined, assets: {}, marginIn: .4 }));
    expect(markup).toContain('Legacy manual notice');
  });

  it('omits blank manual copyright sections and their spacing hooks', () => {
    const copyright: BulletinBlock = {
      id: 'rights', type: 'copyright',
      beforeNotices: [{ type: 'paragraph', children: [{ type: 'text', text: '   ' }] }],
      afterNotices: [{ type: 'paragraph', children: [{ type: 'lineBreak' }] }]
    };
    const document = createBulletin(defaultTemplate);
    const markup = renderToStaticMarkup(createElement(NativeBlockPreview, { block: copyright, document, library: undefined, assets: {}, marginIn: .4, onBlockChange: () => undefined }));
    expect(markup).not.toContain('copyright-before');
    expect(markup).not.toContain('copyright-after');
  });

  it('renders generalized plain, bulleted, and numbered lists with rich content and graphics', () => {
    const document = createBulletin(defaultTemplate);
    const list: BulletinBlock = {
      id: 'list', type: 'list', style: 'bulleted',
      items: [{ id: 'one', title: 'First', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Details', marks: ['italic'] }] }], asset: { path: 'item.png', mediaType: 'image/png' } }]
    };
    const markup = renderToStaticMarkup(createElement(NativeBlockPreview, { block: list, document, library: undefined, assets: { 'item.png': 'data:image/png;base64,AA==' }, marginIn: .4 }));
    expect(markup).toContain('list-block list-bulleted');
    expect(markup).not.toContain('<h2');
    expect(markup).toContain('mark-italic');
    expect(markup).toContain('<img');
  });
});
