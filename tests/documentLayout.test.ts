import { describe, expect, it } from 'vitest';
import { createBulletin, defaultTemplate } from '../src/shared/defaults';
import { templateForBulletin } from '../src/shared/documentLayout';

describe('bulletin page layout', () => {
  it('inherits the template margin until the bulletin overrides it', () => {
    const document = createBulletin(defaultTemplate, '2026-06-07');
    expect(templateForBulletin(defaultTemplate, document)).toBe(defaultTemplate);

    document.layout = { marginIn: 0.65 };
    const effective = templateForBulletin(defaultTemplate, document);
    expect(effective.theme.marginIn).toBe(0.65);
    expect(defaultTemplate.theme.marginIn).toBe(0.4);
  });

  it('reuses the template when an explicit margin matches its default', () => {
    const document = createBulletin(defaultTemplate);
    document.layout = { marginIn: defaultTemplate.theme.marginIn };
    expect(templateForBulletin(defaultTemplate, document)).toBe(defaultTemplate);
  });
});
