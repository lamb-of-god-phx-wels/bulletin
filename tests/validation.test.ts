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
});
