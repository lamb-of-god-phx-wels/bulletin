import type { BulletinBlock, BulletinDocumentV1, CustomPropertyBinding, TemplateInstanceBlock, TemplateV1, WorkspaceSummary } from './types.js';
import { effectiveCustomPropertyDefinitions, effectiveCustomPropertyValue, isCustomPropertyBinding } from './customProperties.js';
import { flattenBlocks } from './blocks.js';
import { randomId } from './id.js';
import { propertyForBinding, remapBlock, remapProperties } from './pageTemplates.js';

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

export const templateDigest = (template: Pick<TemplateV1, 'customProperties' | 'starterBlocks'>) => {
  const input = JSON.stringify({ customProperties: template.customProperties, starterBlocks: template.starterBlocks });
  let hash = 2166136261;
  for (let index = 0; index < input.length; index++) { hash ^= input.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export function instantiateTemplate(source: TemplateV1, id = randomId(), host?: TemplateV1, hostBlocks: BulletinBlock[] = []): TemplateInstanceBlock {
  const used = new Set(flattenBlocks(hostBlocks).map(block => block.id));
  used.add(id);
  const hostProperties = effectiveCustomPropertyDefinitions(host);
  const propertyIds = new Set(hostProperties.map(property => property.id));
  const propertyNames = new Set(hostProperties.map(property => property.name.trim().toLocaleLowerCase()));
  const bindings = new Map<string, CustomPropertyBinding>();
  const properties = source.customProperties?.map(property => {
    const requested = { kind: 'customProperty', propertyId: property.id, propertyName: property.name, valueType: property.valueType } satisfies CustomPropertyBinding;
    const matched = propertyForBinding(requested, host);
    const hostProperty = hostProperties.find(candidate => candidate.id === matched.propertyId && candidate.valueType === matched.valueType);
    if (hostProperty) {
      const binding = { kind: 'customProperty', propertyId: hostProperty.id, propertyName: hostProperty.name, valueType: hostProperty.valueType } satisfies CustomPropertyBinding;
      bindings.set(property.id, binding);
      return structuredClone(hostProperty);
    }
    let propertyId = property.id;
    for (let suffix = 2; propertyIds.has(propertyId); suffix++) propertyId = `${property.id}-${suffix}`;
    propertyIds.add(propertyId);
    let name = property.name;
    for (let suffix = 2; propertyNames.has(name.trim().toLocaleLowerCase()); suffix++) name = `${property.name} ${suffix}`;
    propertyNames.add(name.trim().toLocaleLowerCase());
    const copied = { ...structuredClone(property), id: propertyId, name };
    bindings.set(property.id, { kind: 'customProperty', propertyId, propertyName: name, valueType: property.valueType });
    return copied;
  });
  const mapBindings = (value: unknown): unknown => {
    if (isCustomPropertyBinding(value)) return bindings.get(value.propertyId) ?? value;
    if (Array.isArray(value)) return value.map(mapBindings);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, mapBindings(nested)]));
    return value;
  };
  return {
    id, type: 'templateInstance', name: source.name,
    source: { id: source.id, version: source.version }, sourceDigest: templateDigest(source),
    customProperties: properties,
    blocks: source.starterBlocks.map(block => remapBlock(mapBindings(remapProperties(block, host)) as BulletinBlock, used))
  };
}

export function explodeTemplateInstance(host: BulletinBlock[], instanceId: string): BulletinBlock[] {
  const used = new Set(flattenBlocks(host.filter(block => block.id !== instanceId)).map(block => block.id));
  return host.flatMap(block => block.id === instanceId && block.type === 'templateInstance'
    ? block.blocks.map(child => remapBlock(child, used))
    : [block]);
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

function reusableBlock(source: BulletinBlock): BulletinBlock {
  const block = structuredClone(source);
  if (block.type === 'churchInfo' || block.type === 'group') block.children = block.children?.map(reusableBlock);
  if (block.type === 'paragraph') block.children = block.children.map(child => reusableBlock(child) as typeof child);
  if (block.type === 'templatePage') block.blocks = block.blocks.map(reusableBlock);
  if (block.type === 'templateInstance') block.blocks = block.blocks.map(reusableBlock);
  if (block.type === 'canvas') block.scene.elements = block.scene.elements.map(element => element.type === 'block' ? { ...element, block: reusableBlock(element.block) } : element);
  return block;
}

export function templateFromBulletin(source: BulletinDocumentV1, foundation: TemplateV1, name: string, records: TemplateRecord[]): TemplateV1 {
  const template = duplicateTemplate(foundation, name, records);
  return {
    ...template,
    theme: {
      ...template.theme,
      ...(source.layout?.marginIn !== undefined ? { marginIn: source.layout.marginIn } : {})
    },
    responsiveReading: source.responsiveReading ?? foundation.responsiveReading,
    customProperties: (source.customProperties ?? foundation.customProperties)?.map(property => ({ ...property, defaultValue: effectiveCustomPropertyValue(property.id, foundation, source) ?? property.defaultValue })),
    starterBlocks: source.blocks.map(reusableBlock)
  };
}
