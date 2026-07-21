import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import bulletinSchema from '../schemas/bulletin-v1.schema.json';
import templateSchema from '../schemas/template-v1.schema.json';
import librarySchema from '../schemas/library-v1.schema.json';
import example from '../example_bulletin.json';
import { defaultTemplate } from '../src/shared/defaults';

describe('public JSON contracts', () => {
  const ajv = new Ajv2020({ allErrors: true }); addFormats(ajv);
  it('validates the migrated real bulletin', () => {
    const validate = ajv.compile(bulletinSchema);
    expect(validate(example), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });
  it('validates the default template and an empty library', () => {
    expect(ajv.compile(templateSchema)(defaultTemplate)).toBe(true);
    expect(ajv.compile(librarySchema)({ schemaVersion: 1, name: 'Library', items: [] })).toBe(true);
  });
});
