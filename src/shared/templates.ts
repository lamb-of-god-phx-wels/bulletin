import type { BulletinDocumentV1, TemplateV1, WorkspaceSummary } from './types.js';

export type TemplateRecord = WorkspaceSummary['templates'][number];

const byVersion = (left: TemplateRecord, right: TemplateRecord) => right.template.version - left.template.version
  || Number(left.template.status === 'draft') - Number(right.template.status === 'draft')
  || left.path.localeCompare(right.path);

export function sortedTemplateRecords(records: TemplateRecord[]) {
  return [...records].sort((left, right) => left.template.name.localeCompare(right.template.name) || byVersion(left, right));
}

export function templateForReference(records: TemplateRecord[], reference: BulletinDocumentV1['template']) {
  return records.filter(record => record.template.id === reference.id && record.template.version === reference.version).sort(byVersion)[0]
    ?? records.filter(record => record.template.id === reference.id).sort(byVersion)[0];
}

export function templateChoices(records: TemplateRecord[]) {
  const families = new Map<string, TemplateRecord[]>();
  for (const record of records) {
    const family = families.get(record.template.id) ?? [];
    family.push(record);
    families.set(record.template.id, family);
  }
  return [...families.values()].map(family => family.filter(record => record.template.status === 'published').sort(byVersion)[0] ?? family.sort(byVersion)[0])
    .sort((left, right) => left.template.name.localeCompare(right.template.name));
}

export function templateVersions(records: TemplateRecord[], id: string) {
  return records.filter(record => record.template.id === id).sort(byVersion);
}

export function nextTemplateVersion(records: TemplateRecord[], id: string) {
  return Math.max(0, ...records.filter(record => record.template.id === id).map(record => record.template.version)) + 1;
}

export function uniqueTemplateId(name: string, records: TemplateRecord[]) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'template';
  const used = new Set(records.map(record => record.template.id));
  let id = base; let suffix = 2;
  while (used.has(id)) id = `${base}-${suffix++}`;
  return id;
}

export function duplicateTemplate(source: TemplateV1, name: string, records: TemplateRecord[]): TemplateV1 {
  return {
    ...structuredClone(source),
    id: uniqueTemplateId(name, records),
    version: 1,
    name,
    status: 'draft',
    updatedAt: new Date().toISOString()
  };
}
