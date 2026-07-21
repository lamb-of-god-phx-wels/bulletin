import { describe, expect, it } from 'vitest';
import { createBulletin, defaultTemplate } from '../src/shared/defaults';
import { validateBulletin } from '../src/shared/validation';

describe('bulletin validation', () => {
  it('reports actionable JSON-pointer paths', () => {
    const document = createBulletin(defaultTemplate);
    document.blocks.push({ id: 'first-reading', type: 'heading', text: 'Duplicate' });
    expect(validateBulletin(document)).toContainEqual({ path: `/blocks/${document.blocks.length - 1}/id`, message: 'Duplicate block ID: first-reading' });
  });
});
