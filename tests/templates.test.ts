import { describe, expect, it } from 'vitest';
import { createBulletin, defaultTemplate } from '../src/shared/defaults';
import { duplicateTemplate, nextTemplateVersion, sortedTemplateRecords, templateChoices, templateForReference, templateFromBulletin, templateVersions, uniqueTemplateId, type TemplateRecord } from '../src/shared/templates';

const record = (id: string, name: string, version: number, status: 'draft' | 'published'): TemplateRecord => ({
  path: `templates/${id}/v${version}${status === 'draft' ? '-draft' : ''}.json`,
  template: { ...defaultTemplate, id, name, version, status }
});

describe('multiple templates', () => {
  const records = [record('weekly', 'Weekly', 1, 'published'), record('weekly', 'Weekly', 2, 'draft'), record('festival', 'Festival', 1, 'published')];

  it('sorts records and offers one usable version per template family', () => {
    expect(sortedTemplateRecords(records).map(item => item.path)).toEqual([
      'templates/festival/v1.json', 'templates/weekly/v2-draft.json', 'templates/weekly/v1.json'
    ]);
    expect(templateChoices(records).map(item => item.template.id)).toEqual(['festival', 'weekly']);
    expect(templateChoices(records).find(item => item.template.id === 'weekly')?.template.version).toBe(1);
    expect(templateVersions(records, 'weekly').map(item => item.template.version)).toEqual([2, 1]);
  });

  it('resolves a bulletin reference to its exact published version', () => {
    const sameVersion = [...records, record('weekly', 'Weekly', 1, 'draft')];
    expect(templateForReference(sameVersion, { id: 'weekly', version: 1 })?.path).toBe('templates/weekly/v1.json');
    expect(templateForReference(records, { id: 'weekly', version: 99 })?.template.version).toBe(2);
  });

  it('creates unique template identities and versions', () => {
    expect(nextTemplateVersion(records, 'weekly')).toBe(3);
    expect(uniqueTemplateId('Weekly!', records)).toBe('weekly-2');
    expect(duplicateTemplate(defaultTemplate, 'Festival', records)).toMatchObject({ id: 'festival-2', name: 'Festival', version: 1, status: 'draft' });
  });

  it('promotes a locally overridden template page into a reusable bulletin template', () => {
    const bulletin = createBulletin(defaultTemplate, '2026-08-02');
    const cover = bulletin.blocks.find(block => block.type === 'templatePage');
    if (!cover || cover.type !== 'templatePage') throw new Error('Expected template page.');
    const canvas = cover.blocks.find(block => block.type === 'canvas');
    if (!canvas || canvas.type !== 'canvas') throw new Error('Expected canvas.');
    const title = canvas.scene.elements.find(element => element.type === 'text' && element.source.binding === 'info.title');
    if (!title || title.type !== 'text') throw new Error('Expected bound title.');
    title.x = 1.25;
    title.source.override = [{ type: 'paragraph', children: [{ type: 'text', text: 'One week only' }] }];
    bulletin.layout = { marginIn: .55 };

    const created = templateFromBulletin(bulletin, defaultTemplate, 'Bulletin Layout', records);
    const createdCover = created.starterBlocks.find(block => block.type === 'templatePage');

    expect(created).toMatchObject({ id: 'bulletin-layout', name: 'Bulletin Layout', version: 1, status: 'draft', theme: { marginIn: .55 } });
    if (!createdCover || createdCover.type !== 'templatePage') throw new Error('Expected promoted page.');
    const createdCanvas = createdCover.blocks.find(block => block.type === 'canvas');
    if (!createdCanvas || createdCanvas.type !== 'canvas') throw new Error('Expected promoted canvas.');
    const createdTitle = createdCanvas.scene.elements.find(element => element.type === 'text' && element.source.binding === 'info.title');
    expect(createdTitle).toMatchObject({ x: 1.25, source: { binding: 'info.title', override: [{ children: [{ text: 'One week only' }] }] } });
  });
});
