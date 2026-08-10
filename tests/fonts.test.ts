import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { defaultTemplate } from '../src/shared/defaults';
import { effectiveFontRoles, familyCssName, fontReferenceIssues, parseFontReference, remapFontRole } from '../src/shared/fonts';
import type { LibraryManifestV1, TemplateV1 } from '../src/shared/types';
import { detectFontFace } from '../src/shared/fontMetadata';

const library: LibraryManifestV1 = {
  schemaVersion: 1,
  name: 'Fonts',
  items: [{
    id: 'source-sans', version: 2, kind: 'font', title: 'Source Sans',
    fontFaces: [{ asset: { path: 'assets/source-regular.woff2', mediaType: 'font/woff2' }, weight: 400, style: 'normal' }],
  }],
};

describe('portable fonts', () => {
  it('reads family and face metadata from an imported font file', async () => {
    const bytes = await readFile(new URL('../assets/fonts/Calibri.ttf', import.meta.url));
    const face = detectFontFace(bytes, { path: 'calibri.ttf', mediaType: 'font/ttf' });
    expect(face.familyName?.toLowerCase()).toContain('calibri');
    expect(face.weight).toBeGreaterThanOrEqual(100);
    expect(face.style).toBe('normal');
  });

  it('normalizes legacy themes to required Body and Display roles', () => {
    const legacy = { ...defaultTemplate.theme, fontRoles: undefined, defaultFontRoleId: undefined };
    expect(effectiveFontRoles(legacy, library).map(role => role.id)).toEqual(['body', 'display']);
  });

  it('uses stable family IDs and exact pinned versions for CSS registration', () => {
    expect(familyCssName({ id: 'source sans', version: 2 }, library)).toBe('BulletinFont-source-sans-v2');
    expect(parseFontReference('family:source-sans@2')).toEqual({ kind: 'libraryFont', family: { id: 'source-sans', version: 2 } });
  });

  it('remaps nested role references atomically', () => {
    const value = { blocks: [{ presentation: { fontRef: { kind: 'themeRole', roleId: 'caption' } } }], untouched: 'caption' };
    expect(remapFontRole(value, 'caption', 'body')).toEqual({ blocks: [{ presentation: { fontRef: { kind: 'themeRole', roleId: 'body' } } }], untouched: 'caption' });
  });

  it('blocks unresolved legacy and missing pinned fonts', () => {
    const template: TemplateV1 = {
      ...defaultTemplate,
      theme: { ...defaultTemplate.theme, fontRoles: [{ id: 'body', name: 'Body', family: { id: 'missing', version: 4 } }] },
    };
    const issues = fontReferenceIssues(template, library, { blocks: [{ presentation: { fontFamily: 'Georgia, serif' } }] });
    expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['missing-font', 'legacy-font']));
    expect(issues.every(issue => issue.severity === 'error')).toBe(true);
  });
});
