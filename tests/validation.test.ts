import { describe, expect, it } from 'vitest';
import { createBulletin, defaultTemplate } from '../src/shared/defaults';
import { validateBulletin } from '../src/shared/validation';

describe('bulletin validation', () => {
  it('reports actionable JSON-pointer paths', () => {
    const document = createBulletin(defaultTemplate);
    document.blocks.push({ id: 'first-reading', type: 'heading', text: 'Duplicate' });
    expect(validateBulletin(document)).toContainEqual({ path: `/blocks/${document.blocks.length - 1}/id`, message: 'Duplicate block ID: first-reading' });
  });

  it('identifies hidden template-managed library content and gives a repair action', () => {
    const document = createBulletin(defaultTemplate);
    document.blocks.push({ id: 'fixed-prayer', type: 'libraryText', libraryItemId: 'lord-s-prayer', title: "Lord's Prayer" });
    expect(validateBulletin(document, { schemaVersion: 1, name: 'Test library', items: [] })).toContainEqual({
      path: `/blocks/${document.blocks.length - 1}/libraryItemId`,
      message: 'The template-managed block “Lord\'s Prayer” references missing library item “lord-s-prayer”. Choose a replacement or remove the block from this bulletin.'
    });
  });

  it('accepts a bulletin snapshot with embedded library content', () => {
    const document = createBulletin(defaultTemplate, '2026-06-07');
    document.blocks.push({
      id: 'snapshotted-prayer',
      type: 'libraryText',
      libraryItemId: 'archived-prayer',
      title: 'Archived Prayer',
      contentOverride: [{ type: 'paragraph', children: [{ type: 'text', text: 'Saved with this bulletin.' }] }]
    });
    expect(validateBulletin(document, { schemaVersion: 1, name: 'Empty', items: [] }).some(issue => issue.path === `/blocks/${document.blocks.length - 1}/libraryItemId`)).toBe(false);
  });

  it('reports invalid custom-block definitions', () => {
    const document = createBulletin(defaultTemplate);
    document.blocks.push({ id: 'custom-welcome', type: 'custom', name: 'Welcome', layoutText: '{{serviceTime}} {{missing}}', bindings: [
      { key: 'serviceTime', label: 'Service time', source: 'weekly' },
      { key: 'serviceTime', label: 'Duplicate', source: 'weekly' }
    ] });
    expect(validateBulletin(document)).toEqual(expect.arrayContaining([
      { path: `/blocks/${document.blocks.length - 1}`, message: 'Placeholder “serviceTime” is used by more than one binding.' },
      { path: `/blocks/${document.blocks.length - 1}`, message: 'Layout placeholder “{{missing}}” has no data binding.' }
    ]));
  });
});
