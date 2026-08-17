import { describe, expect, it } from 'vitest';
import { createBulletin, defaultTemplate } from '../src/shared/defaults';
import { duplicateTemplate, editableTemplateChoices, explodeTemplateInstance, instantiateTemplate, nextTemplateVersion, sortedTemplateRecords, templateChoices, templateForReference, templateFromBulletin, templateVersions, uniqueTemplateId, type TemplateRecord } from '../src/shared/templates';
import { paginate } from '../src/shared/pagination';

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

  it('resumes a draft when choosing a template to edit', () => {
    expect(editableTemplateChoices(records).find(item => item.template.id === 'weekly')?.path).toBe('templates/weekly/v2-draft.json');
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
    const title = canvas.scene.elements.find(element => element.type === 'block' && element.block.type === 'richText' && element.block.binding === 'info.title');
    if (!title || title.type !== 'block' || title.block.type !== 'richText') throw new Error('Expected bound title.');
    title.x = 1.25;
    title.block.bindingOverride = [{ type: 'paragraph', children: [{ type: 'text', text: 'One week only' }] }];
    bulletin.layout = { marginIn: .55 };
    bulletin.responsiveReading = { labels: { leader: 'L', follower: 'P', all: 'All' } };

    const created = templateFromBulletin(bulletin, defaultTemplate, 'Bulletin Layout', records);
    const createdCover = created.starterBlocks.find(block => block.type === 'templatePage');

    expect(created).toMatchObject({ id: 'bulletin-layout', name: 'Bulletin Layout', version: 1, status: 'draft', theme: { marginIn: .55 }, responsiveReading: bulletin.responsiveReading });
    if (!createdCover || createdCover.type !== 'templatePage') throw new Error('Expected promoted page.');
    const createdCanvas = createdCover.blocks.find(block => block.type === 'canvas');
    if (!createdCanvas || createdCanvas.type !== 'canvas') throw new Error('Expected promoted canvas.');
    const createdTitle = createdCanvas.scene.elements.find(element => element.type === 'block' && element.block.type === 'richText' && element.block.binding === 'info.title');
    expect(createdTitle).toMatchObject({ x: 1.25, block: { binding: 'info.title', bindingOverride: [{ children: [{ text: 'One week only' }] }] } });
  });

  it('inserts a pinned template with collision-safe IDs and explodes only its outer wrapper', () => {
    const nested = instantiateTemplate({
      ...defaultTemplate,
      id: 'nested', name: 'Nested', version: 2, status: 'published',
      starterBlocks: [{ id: 'shared', type: 'heading', text: 'Nested heading' }]
    }, 'nested-instance');
    const source = {
      ...defaultTemplate,
      id: 'source', name: 'Reusable service', version: 3, status: 'published' as const,
      starterBlocks: [
        { id: 'shared', type: 'heading' as const, text: 'Opening' },
        nested
      ]
    };
    const instance = instantiateTemplate(source, 'source-instance', defaultTemplate, [
      { id: 'shared', type: 'heading', text: 'Existing' }
    ]);

    expect(instance).toMatchObject({ type: 'templateInstance', source: { id: 'source', version: 3 }, name: 'Reusable service' });
    expect(instance.blocks[0].id).toBe('shared-2');
    const exploded = explodeTemplateInstance([{ id: 'shared', type: 'heading', text: 'Existing' }, instance], instance.id);
    expect(exploded.map(block => block.type)).toEqual(['heading', 'heading', 'templateInstance']);
    expect(exploded[2]).toMatchObject({ type: 'templateInstance', source: { id: 'nested', version: 2 } });
  });

  it('paginates inserted template contents as normal host blocks across pages', () => {
    const source = {
      ...defaultTemplate,
      id: 'source', name: 'Long service', version: 1, status: 'published' as const,
      starterBlocks: Array.from({ length: 20 }, (_, index) => ({
        id: `space-${index}`, type: 'spacer' as const, size: 'large' as const
      }))
    };
    const instance = instantiateTemplate(source, 'instance');
    const pages = paginate([instance], defaultTemplate);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.flatMap(page => page.blocks).every(block => block.type !== 'templateInstance')).toBe(true);
  });

  it('remaps colliding custom properties without changing their bindings', () => {
    const host = {
      ...defaultTemplate,
      customProperties: [{ id: 'featured', name: 'Featured', valueType: 'string' as const, defaultValue: 'Host' }]
    };
    const source = {
      ...defaultTemplate,
      id: 'source', name: 'Source', status: 'published' as const,
      customProperties: [{ id: 'featured', name: 'Featured', valueType: 'boolean' as const, defaultValue: true }],
      starterBlocks: [{
        id: 'conditional', type: 'heading' as const, text: 'Shown',
        condition: { property: { kind: 'customProperty' as const, propertyId: 'featured', propertyName: 'Featured', valueType: 'boolean' as const }, equals: true }
      }]
    };
    const instance = instantiateTemplate(source, 'instance', host);
    expect(instance.customProperties?.[0]).toMatchObject({ id: 'featured-2', name: 'Featured 2', valueType: 'boolean' });
    expect(instance.blocks[0].condition?.property).toMatchObject({ propertyId: 'featured-2', propertyName: 'Featured 2' });
  });
});
