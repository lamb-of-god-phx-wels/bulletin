import type { BulletinBlock, CustomPropertyBinding, PageMarginSetting, PageTemplateV1, TemplatePageBlock, TemplateV1, WorkspaceSummary } from './types.js';
import { flattenBlocks } from './blocks.js';
import { randomId } from './id.js';
import { effectiveCustomPropertyDefinitions, isCustomPropertyBinding } from './customProperties.js';

export type PageTemplateRecord = WorkspaceSummary['pageTemplates'][number];

export const pageTemplateDigest = (page: Pick<PageTemplateV1, 'layout' | 'margin' | 'customProperties' | 'blocks'>) => {
  const input = JSON.stringify({ layout: pageTemplateLayout(page), margin: page.margin, customProperties: page.customProperties, blocks: page.blocks });
  let hash = 2166136261;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export const pageTemplateVersions = (records: PageTemplateRecord[], id: string) =>
  records.filter(record => record.pageTemplate.id === id)
    .sort((left, right) => right.pageTemplate.version - left.pageTemplate.version || Number(left.pageTemplate.status === 'draft') - Number(right.pageTemplate.status === 'draft'));

export const pageTemplateChoices = (records: PageTemplateRecord[]) => {
  const ids = [...new Set(records.map(record => record.pageTemplate.id))];
  return ids.map(id => pageTemplateVersions(records, id).find(record => record.pageTemplate.status === 'published') ?? pageTemplateVersions(records, id)[0])
    .filter(Boolean)
    .sort((left, right) => left.pageTemplate.name.localeCompare(right.pageTemplate.name));
};

export const nextPageTemplateVersion = (records: PageTemplateRecord[], id: string) =>
  Math.max(0, ...records.filter(record => record.pageTemplate.id === id).map(record => record.pageTemplate.version)) + 1;

export const uniquePageTemplateId = (name: string, records: PageTemplateRecord[]) => {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'page';
  const used = new Set(records.map(record => record.pageTemplate.id));
  let id = base;
  let suffix = 2;
  while (used.has(id)) id = `${base}-${suffix++}`;
  return id;
};

export function pageTemplateLayout(page: Pick<PageTemplateV1, 'layout' | 'blocks'>): NonNullable<PageTemplateV1['layout']> {
  return page.layout ?? (page.blocks.length === 1 && page.blocks[0].type === 'canvas' ? 'canvas' : 'regular');
}

export function createPageTemplate(
  name: string,
  records: PageTemplateRecord[],
  blocks: BulletinBlock[] = [],
  margin: PageMarginSetting = { mode: 'inherit', referenceMarginIn: .4 },
  layout: NonNullable<PageTemplateV1['layout']> = blocks.length === 1 && blocks[0].type === 'canvas' ? 'canvas' : 'regular'
): PageTemplateV1 {
  return {
    schemaVersion: 1,
    id: uniquePageTemplateId(name, records),
    version: 1,
    name,
    status: 'draft',
    layout,
    margin: structuredClone(margin),
    customProperties: [],
    blocks: structuredClone(blocks),
    updatedAt: new Date().toISOString()
  };
}

export function duplicatePageTemplate(source: PageTemplateV1, name: string, records: PageTemplateRecord[]) {
  return {
    ...structuredClone(source),
    id: uniquePageTemplateId(name, records),
    version: 1,
    name,
    status: 'draft' as const,
    updatedAt: new Date().toISOString()
  };
}

export function propertyForBinding(binding: CustomPropertyBinding, template?: TemplateV1) {
  if (!template) return binding;
  const properties = effectiveCustomPropertyDefinitions(template);
  const exact = properties.find(property => property.id === binding.propertyId && property.valueType === binding.valueType);
  const matches = properties.filter(property => property.valueType === binding.valueType && property.name.trim().toLocaleLowerCase() === binding.propertyName.trim().toLocaleLowerCase());
  const property = exact ?? (matches.length === 1 ? matches[0] : undefined);
  return property ? { kind: 'customProperty' as const, propertyId: property.id, propertyName: property.name, valueType: property.valueType } : binding;
}

export function remapProperties(block: BulletinBlock, template?: TemplateV1): BulletinBlock {
  const next = structuredClone(block);
  if (next.condition) next.condition.property = propertyForBinding(next.condition.property, template);
  if (next.type === 'richText' && isCustomPropertyBinding(next.binding)) next.binding = propertyForBinding(next.binding, template);
  if (next.type === 'custom') next.bindings = next.bindings.map(binding => isCustomPropertyBinding(binding.source) ? { ...binding, source: propertyForBinding(binding.source, template) } : binding);
  if (next.type === 'group' || next.type === 'churchInfo') next.children = next.children?.map(child => remapProperties(child, template)) ?? [];
  if (next.type === 'paragraph') next.children = next.children.map(child => remapProperties(child, template) as typeof child);
  if (next.type === 'scriptureReading' && next.elements) next.elements = Object.fromEntries(Object.entries(next.elements).map(([role, settings]) => [role, settings?.condition ? { ...settings, condition: { ...settings.condition, property: propertyForBinding(settings.condition.property, template) } } : settings]));
  if (next.type === 'templatePage') next.blocks = next.blocks.map(child => remapProperties(child, template));
  if (next.type === 'templateInstance') next.blocks = next.blocks.map(child => remapProperties(child, template));
  if (next.type === 'canvas') next.scene.elements = next.scene.elements.map(element => {
    const mapped = structuredClone(element);
    if (mapped.condition) mapped.condition.property = propertyForBinding(mapped.condition.property, template);
    return mapped.type === 'block' ? { ...mapped, block: remapProperties(mapped.block, template) } : mapped;
  });
  return next;
}

export function instantiatePageTemplate(source: PageTemplateV1, id: string = randomId(), template?: TemplateV1): TemplatePageBlock {
  return {
    id,
    type: 'templatePage',
    name: source.name,
    source: { id: source.id, version: source.version },
    sourceDigest: pageTemplateDigest(source),
    pageLayout: pageTemplateLayout(source),
    margin: structuredClone(source.margin),
    customProperties: source.customProperties?.map(property => {
      const binding = propertyForBinding({ kind: 'customProperty', propertyId: property.id, propertyName: property.name, valueType: property.valueType }, template);
      return binding.propertyId === property.id ? structuredClone(property) : effectiveCustomPropertyDefinitions(template).find(candidate => candidate.id === binding.propertyId) ?? structuredClone(property);
    }),
    blocks: source.blocks.map(block => remapProperties(block, template))
  };
}

function freshId(id: string, used: Set<string>) {
  if (!used.has(id)) { used.add(id); return id; }
  let suffix = 2;
  while (used.has(`${id}-${suffix}`)) suffix++;
  const next = `${id}-${suffix}`;
  used.add(next);
  return next;
}

export function remapBlock(block: BulletinBlock, used: Set<string>): BulletinBlock {
  const next = { ...structuredClone(block), id: freshId(block.id, used) } as BulletinBlock;
  if (next.type === 'group' || next.type === 'churchInfo') next.children = next.children?.map(child => remapBlock(child, used));
  if (next.type === 'paragraph') next.children = next.children.map(child => remapBlock(child, used) as typeof child);
  if (next.type === 'templatePage') next.blocks = next.blocks.map(child => remapBlock(child, used));
  if (next.type === 'templateInstance') next.blocks = next.blocks.map(child => remapBlock(child, used));
  if (next.type === 'canvas') next.scene.elements = next.scene.elements.map(element => element.type === 'block' ? { ...element, block: remapBlock(element.block, used) } : element);
  return next;
}

export function explodeTemplatePage(host: BulletinBlock[], instanceId: string): BulletinBlock[] {
  const used = new Set(flattenBlocks(host.filter(block => block.id !== instanceId)).map(block => block.id));
  return host.flatMap(block => {
    if (block.id !== instanceId || block.type !== 'templatePage') return [block];
    return block.blocks.map((child, index) => {
      const next = remapBlock(child, used);
      return index === 0 ? { ...next, layout: { ...next.layout, pageBreakBefore: true } } as BulletinBlock : next;
    });
  });
}

export function pageTemplateMargin(margin: PageMarginSetting, hostMarginIn: number) {
  return margin.mode === 'fixed' ? margin.marginIn : hostMarginIn;
}

export function pageTemplateIssues(page: Pick<PageTemplateV1, 'blocks' | 'margin' | 'layout'>) {
  const issues: string[] = [];
  const layout = pageTemplateLayout(page);
  if (layout === 'canvas' && (page.blocks.length !== 1 || page.blocks[0].type !== 'canvas')) {
    issues.push('Canvas page templates must contain exactly one canvas.');
  }
  if (layout === 'regular' && page.blocks.some(block => block.type === 'canvas')) {
    issues.push('Regular page templates cannot contain canvas blocks.');
  }
  if (page.blocks.some(block => block.type === 'templatePage')) issues.push('Page templates cannot contain another template page.');
  if (page.blocks.some(block => block.type === 'templateInstance')) issues.push('Page templates cannot contain a sub-template.');
  if (page.blocks.some(block => block.type === 'titlePage' || block.type === 'canvasCover')) issues.push('Legacy cover blocks are not supported.');
  const margin = page.margin.mode === 'fixed' ? page.margin.marginIn : page.margin.referenceMarginIn;
  if (!Number.isFinite(margin) || margin < 0 || margin >= 3.5) issues.push('Choose a valid page margin.');
  return issues;
}
