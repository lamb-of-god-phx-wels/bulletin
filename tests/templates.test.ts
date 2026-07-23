import { describe, expect, it } from 'vitest';
import { defaultTemplate } from '../src/shared/defaults';
import { duplicateTemplate, nextTemplateVersion, sortedTemplateRecords, templateChoices, templateForReference, templateVersions, uniqueTemplateId, type TemplateRecord } from '../src/shared/templates';

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
});
