import type { FontFamilyRef, FontReference, LibraryItemV1, LibraryManifestV1, TemplateV1, ThemeFontRoleV1, ThemeV1, ValidationIssue } from './types.js';

export const bundledFontFamilies = [
  { id: 'bundled-calibri', version: 1, title: 'Calibri', cssFamily: 'CalibriLocal, Calibri, sans-serif' },
  { id: 'bundled-eras', version: 1, title: 'Eras Demi ITC', cssFamily: 'ErasLocal, Georgia, serif' },
] as const;

export const bodyFontRole: ThemeFontRoleV1 = {
  id: 'body', name: 'Body', family: { id: 'bundled-calibri', version: 1 },
};

export const displayFontRole: ThemeFontRoleV1 = {
  id: 'display', name: 'Display', family: { id: 'bundled-eras', version: 1 },
};

export function libraryFontItem(library: LibraryManifestV1 | undefined, ref: FontFamilyRef): LibraryItemV1 | undefined {
  return library?.items.find(item => item.kind === 'font' && item.id === ref.id && item.version === ref.version);
}

export function latestFontFamilies(library?: LibraryManifestV1) {
  const latest = new Map<string, LibraryItemV1>();
  for (const item of library?.items ?? []) {
    if (item.kind !== 'font') continue;
    const current = latest.get(item.id);
    if (!current || item.version > current.version) latest.set(item.id, item);
  }
  return [...latest.values()].sort((left, right) => left.title.localeCompare(right.title));
}

function legacyFamilyRef(value: string, library?: LibraryManifestV1): FontFamilyRef | undefined {
  const normalized = value.toLowerCase();
  const bundled = bundledFontFamilies.find(item => normalized.includes(item.title.toLowerCase()));
  if (bundled) return { id: bundled.id, version: bundled.version };
  const item = latestFontFamilies(library).find(candidate => normalized.includes(candidate.title.toLowerCase()));
  return item ? { id: item.id, version: item.version } : undefined;
}

export function effectiveFontRoles(theme: ThemeV1, library?: LibraryManifestV1): ThemeFontRoleV1[] {
  if (theme.fontRoles?.length) {
    const roles = [...theme.fontRoles];
    if (!roles.some(role => role.id === 'body')) roles.unshift({ ...bodyFontRole, family: legacyFamilyRef(theme.bodyFont, library) ?? bodyFontRole.family });
    return roles;
  }
  return [
    { ...bodyFontRole, family: legacyFamilyRef(theme.bodyFont, library) ?? bodyFontRole.family },
    { ...displayFontRole, family: legacyFamilyRef(theme.displayFont, library) ?? displayFontRole.family },
  ];
}

export function familyCssName(ref: FontFamilyRef, library?: LibraryManifestV1): string | undefined {
  const bundled = bundledFontFamilies.find(item => item.id === ref.id && item.version === ref.version);
  if (bundled) return bundled.cssFamily;
  return `BulletinFont-${ref.id.replace(/[^a-zA-Z0-9_-]/g, '-')}-v${ref.version}`;
}

export function fontReferenceCss(ref?: FontReference, legacy?: string): string | undefined {
  if (ref?.kind === 'themeRole') return `var(--font-role-${ref.roleId.replace(/[^a-zA-Z0-9_-]/g, '-')})`;
  if (ref?.kind === 'libraryFont') return familyCssName(ref.family);
  if (ref?.kind === 'legacyCss') return ref.value;
  return legacy === 'body' ? 'var(--font-role-body)' : legacy === 'display' ? 'var(--font-role-display)' : legacy;
}

export function familyLabel(ref: FontFamilyRef, library?: LibraryManifestV1): string {
  return bundledFontFamilies.find(item => item.id === ref.id)?.title
    ?? libraryFontItem(library, ref)?.title
    ?? `${ref.id} v${ref.version}`;
}

export function resolveFontReference(ref: FontReference | undefined, legacy: string | undefined, template: TemplateV1, library?: LibraryManifestV1): string | undefined {
  if (ref?.kind === 'legacyCss') return ref.value;
  if (ref?.kind === 'libraryFont') return familyCssName(ref.family, library);
  const roleId = ref?.kind === 'themeRole' ? ref.roleId : legacy === 'display' ? 'display' : legacy === 'body' || !legacy ? (template.theme.defaultFontRoleId ?? 'body') : undefined;
  if (roleId) {
    const role = effectiveFontRoles(template.theme, library).find(item => item.id === roleId);
    return role ? familyCssName(role.family, library) : undefined;
  }
  return legacy;
}

export function fontReferenceValue(ref: FontReference): string {
  if (ref.kind === 'themeRole') return `role:${ref.roleId}`;
  if (ref.kind === 'libraryFont') return `family:${ref.family.id}@${ref.family.version}`;
  return `legacy:${ref.value}`;
}

export function parseFontReference(value: string): FontReference {
  if (value.startsWith('role:')) return { kind: 'themeRole', roleId: value.slice(5) };
  if (value.startsWith('family:')) {
    const [id, rawVersion] = value.slice(7).split('@');
    return { kind: 'libraryFont', family: { id, version: Number(rawVersion) || 1 } };
  }
  if (value.startsWith('legacy:')) return { kind: 'legacyCss', value: value.slice(7) };
  return value === 'body' || value === 'display' ? { kind: 'themeRole', roleId: value } : { kind: 'legacyCss', value };
}

export function fontReferenceIssues(template: TemplateV1, library?: LibraryManifestV1, document?: unknown): ValidationIssue[] {
  const roles = effectiveFontRoles(template.theme, library);
  const roleIds = new Set(roles.map(role => role.id));
  const issues: ValidationIssue[] = [];
  const usedFamilies = new Map<string, FontFamilyRef>();
  const useFamily = (ref: FontFamilyRef) => usedFamilies.set(`${ref.id}@${ref.version}`, ref);
  roles.forEach(role => useFamily(role.family));
  const familyExists = (ref: FontFamilyRef) => bundledFontFamilies.some(item => item.id === ref.id && item.version === ref.version) || Boolean(libraryFontItem(library, ref));
  for (const role of roles) if (!familyExists(role.family)) issues.push({
    path: `/theme/fontRoles/${role.id}`,
    message: `Theme font “${role.name}” references missing font family “${role.family.id}” version ${role.family.version}.`,
    severity: 'error', code: 'missing-font',
  });

  const visit = (value: unknown, path: string) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach((child, index) => visit(child, `${path}/${index}`)); return; }
    const record = value as Record<string, unknown>;
    const ref = record.fontRef as FontReference | undefined;
    const legacy = typeof record.fontFamily === 'string' ? record.fontFamily : undefined;
    if (ref?.kind === 'themeRole' && !roleIds.has(ref.roleId)) issues.push({ path: `${path}/fontRef`, message: `Theme font role “${ref.roleId}” no longer exists.`, severity: 'error', code: 'missing-font-role' });
    if (ref?.kind === 'themeRole') { const role = roles.find(item => item.id === ref.roleId); if (role) useFamily(role.family); }
    if (ref?.kind === 'libraryFont') {
      useFamily(ref.family);
      if (!familyExists(ref.family)) issues.push({ path: `${path}/fontRef`, message: `Font family “${ref.family.id}” version ${ref.family.version} is missing.`, severity: 'error', code: 'missing-font' });
    }
    if (ref?.kind === 'legacyCss' || (!ref && legacy && legacy !== 'body' && legacy !== 'display' && !legacyFamilyRef(legacy, library))) issues.push({ path: `${path}/${ref ? 'fontRef' : 'fontFamily'}`, message: `“${ref?.kind === 'legacyCss' ? ref.value : legacy}” is not stored in this workspace. Import or replace it for a portable export.`, severity: 'error', code: 'legacy-font' });
    Object.entries(record).forEach(([key, child]) => { if (key !== 'fontRef') visit(child, `${path}/${key}`); });
  };
  if (document) visit(document, '');
  for (const ref of usedFamilies.values()) {
    const item = libraryFontItem(library, ref);
    if (!item) continue;
    const faces = item.fontFaces ?? (item.assets ?? []).map(asset => ({ asset, weight: 400, style: 'normal' as const }));
    const missing = [[400, 'normal', 'regular'], [700, 'normal', 'bold'], [400, 'italic', 'italic'], [700, 'italic', 'bold italic']]
      .filter(([weight, style]) => !faces.some(face => face.weight === weight && face.style === style))
      .map(([, , name]) => name);
    if (missing.length) issues.push({ path: `/library/items/${ref.id}@${ref.version}/fontFaces`, message: `${item.title} will synthesize ${missing.join(', ')} because those faces were not imported.`, severity: 'warning', code: 'incomplete-font' });
  }
  return issues;
}

export function remapFontRole<T>(value: T, fromRoleId: string, toRoleId: string): T {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(item => remapFontRole(item, fromRoleId, toRoleId)) as T;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(record).map(([key, child]) => [key,
    key === 'fontRef' && child && typeof child === 'object' && (child as { kind?: string }).kind === 'themeRole' && (child as { roleId?: string }).roleId === fromRoleId
      ? { kind: 'themeRole', roleId: toRoleId }
      : remapFontRole(child, fromRoleId, toRoleId),
  ])) as T;
}
