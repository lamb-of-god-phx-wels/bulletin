import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import bulletinSchema from '../schemas/bulletin-v1.schema.json';
import templateSchema from '../schemas/template-v1.schema.json';
import librarySchema from '../schemas/library-v1.schema.json';
import pageTemplateSchema from '../schemas/page-template-v1.schema.json';
import example from '../example_bulletin.json';
import { defaultPageTemplate, defaultTemplate } from '../src/shared/defaults';
import { prepackagedComponentDefinitions } from '../src/componentDefinitions';
import { welsCalendarPreset } from '../src/shared/churchCalendar';

describe('public JSON contracts', () => {
  const ajv = new Ajv2020({ allErrors: true }); addFormats(ajv);
  it('rejects a historical bulletin containing a removed cover type', () => {
    const validate = ajv.compile(bulletinSchema);
    expect(validate(example)).toBe(false);
    expect(validate.errors?.[0].instancePath).toBe('/blocks/0/type');
  });
  it('validates the default template and an empty library', () => {
    expect(ajv.compile(templateSchema)(defaultTemplate)).toBe(true);
    expect(ajv.compile(pageTemplateSchema)(defaultPageTemplate)).toBe(true);
    expect(ajv.compile(librarySchema)({ schemaVersion: 1, name: 'Library', items: [] })).toBe(true);
    expect(ajv.compile(librarySchema)({ schemaVersion: 1, name: 'Library', items: [{ id: 'banner', version: 1, kind: 'image', title: 'Banner' }], imageFolders: [{ id: 'seasonal', name: 'Seasonal' }, { id: 'advent', name: 'Advent', parentId: 'seasonal' }], imageCatalog: [{ imageId: 'banner', folderId: 'advent', displayName: 'Advent banner' }] })).toBe(true);
    expect(ajv.compile(librarySchema)({ schemaVersion: 1, name: 'Library', items: [], churchWeekNames: [{ sourceName: 'Epiphany 2', displayName: 'Second Sunday after Epiphany' }] })).toBe(true);
    expect(ajv.compile(librarySchema)({ schemaVersion: 1, name: 'Library', items: [], calendarEvents: [{ id: 'easter', name: 'Easter', enabled: true, priority: 100, rules: [{ kind: 'easter' }] }] })).toBe(true);
    expect(ajv.compile(librarySchema)({ schemaVersion: 1, name: 'Library', items: [], calendarEvents: welsCalendarPreset() })).toBe(true);
    expect(ajv.compile(librarySchema)({ schemaVersion: 1, name: 'Library', items: [], componentDefinitions: [prepackagedComponentDefinitions[0]] })).toBe(true);
  });
});
