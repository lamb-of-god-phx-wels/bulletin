import { describe, expect, it } from 'vitest';
import { customBlockParagraphs, customLayoutKeys, renderCustomBlockText } from '../src/shared/customBlocks';
import { createBulletin, defaultTemplate } from '../src/shared/defaults';
import type { CustomBlock } from '../src/shared/types';

const block: CustomBlock = {
  id: 'welcome-note',
  type: 'custom',
  name: 'Welcome note',
  layoutText: '{{greeting}}\n\nSermon: {{sermonTitle}} on {{serviceDate}} at {{churchName}}',
  bindings: [
    { key: 'greeting', label: 'Greeting', source: 'weekly', defaultValue: 'Welcome!' },
    { key: 'sermonTitle', label: 'Sermon title', source: 'info.title' },
    { key: 'serviceDate', label: 'Service date', source: 'info.date' },
    { key: 'churchEvent', label: 'Church event', source: 'info.churchEvent' },
    { key: 'churchName', label: 'Church name', source: 'church.name' }
  ]
};

describe('custom bulletin blocks', () => {
  it('resolves weekly and bulletin bindings in the layout', () => {
    const document = createBulletin(defaultTemplate);
    document.info.date = '2026-06-07';
    document.info.title = 'God Loves Sinners';
    document.info.churchWeek = 'Second Sunday after Pentecost';
    document.church.name = 'Lamb of God';
    expect(renderCustomBlockText({ ...block, values: { greeting: 'Please join us.' } }, document))
      .toContain('Please join us.\n\nSermon: God Loves Sinners on June 7, 2026 at Lamb of God');
    expect(renderCustomBlockText({ ...block, layoutText: '{{churchEvent}}' }, document))
      .toBe('Second Sunday after Pentecost');
  });

  it('keeps unknown placeholders visible and creates structured paragraphs', () => {
    const document = createBulletin(defaultTemplate);
    const withUnknown = { ...block, layoutText: '{{greeting}}\n\n{{missing}}' };
    expect(customLayoutKeys(withUnknown.layoutText)).toEqual(['greeting', 'missing']);
    expect(customBlockParagraphs(withUnknown, document)).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: 'Welcome!' }] },
      { type: 'paragraph', children: [{ type: 'text', text: '{{missing}}' }] }
    ]);
  });
});
