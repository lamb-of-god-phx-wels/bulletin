import type {
  BulletinBlock,
  BulletinDocumentV1,
  BuiltInTextBinding,
  CanvasTextBinding,
  CustomPropertyBinding,
  CustomPropertyDefinition,
  CustomPropertyType,
  CustomPropertyValue,
  ElementCondition,
  TemplateV1,
  ValidationIssue,
} from './types.js';
import { childBlocks } from './blocks.js';
import { blockDisplayName } from './blockNames.js';

const propertyTypeName = (valueType: CustomPropertyType) => valueType === 'boolean' ? 'Toggle' : valueType === 'string' ? 'Text' : 'Number';

export function isCustomPropertyBinding(value: unknown): value is CustomPropertyBinding {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && (value as CustomPropertyBinding).kind === 'customProperty'
    && typeof (value as CustomPropertyBinding).propertyId === 'string'
    && typeof (value as CustomPropertyBinding).propertyName === 'string'
    && ['string', 'number', 'boolean'].includes((value as CustomPropertyBinding).valueType);
}

export function customPropertyBinding(property: CustomPropertyDefinition): CustomPropertyBinding {
  return { kind: 'customProperty', propertyId: property.id, propertyName: property.name, valueType: property.valueType };
}

export function defaultValueForCustomProperty(type: CustomPropertyType): CustomPropertyValue {
  return type === 'boolean' ? false : type === 'number' ? 0 : '';
}

export function effectiveCustomPropertyDefinitions(
  template?: Pick<TemplateV1, 'customProperties'> & Partial<Pick<TemplateV1, 'starterBlocks'>>,
  document?: Pick<BulletinDocumentV1, 'customProperties'> & Partial<Pick<BulletinDocumentV1, 'blocks'>>,
): CustomPropertyDefinition[] {
  const result = [...(document?.customProperties ?? template?.customProperties ?? [])];
  const seen = new Set(result.map(property => property.id));
  const visit = (blocks: BulletinBlock[]) => blocks.forEach(block => {
    if (block.type === 'templatePage' || block.type === 'templateInstance') {
      for (const property of block.customProperties ?? []) {
        if (!seen.has(property.id)) { result.push(property); seen.add(property.id); }
      }
    }
    childBlocks(block)?.forEach(child => visit([child]));
  });
  visit(document?.blocks ?? template?.starterBlocks ?? []);
  return result;
}

export function effectiveCustomPropertyValue(
  propertyId: string,
  template?: Pick<TemplateV1, 'customProperties'> & Partial<Pick<TemplateV1, 'starterBlocks'>>,
  document?: Pick<BulletinDocumentV1, 'customProperties' | 'customPropertyOverrides'> & Partial<Pick<BulletinDocumentV1, 'blocks'>>,
): CustomPropertyValue | undefined {
  if (document?.customPropertyOverrides && Object.prototype.hasOwnProperty.call(document.customPropertyOverrides, propertyId)) {
    return document.customPropertyOverrides[propertyId];
  }
  return effectiveCustomPropertyDefinitions(template, document).find(property => property.id === propertyId)?.defaultValue;
}

export function customPropertyText(value: CustomPropertyValue | undefined): string {
  if (value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  return String(value);
}

export function textBindingValue(
  binding: CanvasTextBinding,
  document: BulletinDocumentV1,
  template?: TemplateV1,
  dateFormat: 'long' | 'medium' | 'short' | 'iso' = 'long',
): string {
  if (isCustomPropertyBinding(binding)) return customPropertyText(effectiveCustomPropertyValue(binding.propertyId, template, document));
  if (binding === 'church.name') return document.church.name;
  if (binding === 'info.title') return document.info.title;
  if (binding === 'info.series') return document.info.series ?? '';
  if (binding === 'info.churchWeek' || binding === 'info.churchEvent') return document.info.churchWeek;
  const date = new Date(`${document.info.date}T12:00:00Z`);
  if (dateFormat === 'iso') return document.info.date;
  return new Intl.DateTimeFormat('en-US', dateFormat === 'short'
    ? { month: 'numeric', day: 'numeric', year: '2-digit', timeZone: 'UTC' }
    : { month: dateFormat === 'medium' ? 'short' : 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date);
}

export function conditionVisible(subject: { condition?: ElementCondition }, template?: TemplateV1, document?: BulletinDocumentV1) {
  return !subject.condition || (isCustomPropertyBinding(subject.condition.property)
    && typeof subject.condition.equals === 'boolean'
    && effectiveCustomPropertyValue(subject.condition.property.propertyId, template, document) === subject.condition.equals);
}

export function resolveConditionalBlocks(
  blocks: BulletinBlock[],
  template?: TemplateV1,
  document?: BulletinDocumentV1,
): BulletinBlock[] {
  return blocks.flatMap<BulletinBlock>(block => {
    if (!conditionVisible(block, template, document)) return [];
    if (block.type === 'group') return [{ ...block, children: resolveConditionalBlocks(block.children, template, document) }];
    if (block.type === 'paragraph') return [{ ...block, children: resolveConditionalBlocks(block.children, template, document).filter(child => child.type === 'richText') }];
    if (block.type === 'templatePage' || block.type === 'templateInstance') return [{ ...block, blocks: resolveConditionalBlocks(block.blocks, template, document) }];
    return [block];
  });
}

export function customPropertyUsages(blocks: BulletinBlock[], propertyId: string): Array<{ blockId: string; label: string }> {
  const result: Array<{ blockId: string; label: string }> = [];
  const visit = (block: BulletinBlock) => {
    const used = (block.type === 'richText' && isCustomPropertyBinding(block.binding) && block.binding.propertyId === propertyId)
      || (block.type === 'custom' && block.bindings.some(binding => isCustomPropertyBinding(binding.source) && binding.source.propertyId === propertyId))
      || (block.condition?.property.propertyId === propertyId)
      || (block.type === 'canvas' && block.scene.elements.some(element => element.condition?.property.propertyId === propertyId || (element.type === 'block' && (() => {
        const native = element.block;
        return (native.type === 'richText' && isCustomPropertyBinding(native.binding) && native.binding.propertyId === propertyId)
          || customPropertyUsages([native], propertyId).length > 0;
      })())));
    if (used) result.push({ blockId: block.id, label: blockDisplayName(block) });
    childBlocks(block)?.forEach(visit);
  };
  blocks.forEach(visit);
  return result;
}

export function synchronizeCustomPropertyBindings(blocks: BulletinBlock[], properties: CustomPropertyDefinition[]): BulletinBlock[] {
  const sync = (binding: CustomPropertyBinding) => {
    const property = properties.find(candidate => candidate.id === binding.propertyId);
    return property ? customPropertyBinding(property) : binding;
  };
  return blocks.map(source => {
    const block = structuredClone(source);
    if (block.condition) block.condition.property = sync(block.condition.property);
    if (block.type === 'richText' && isCustomPropertyBinding(block.binding)) block.binding = sync(block.binding);
    if (block.type === 'custom') block.bindings = block.bindings.map(binding => isCustomPropertyBinding(binding.source) ? { ...binding, source: sync(binding.source) } : binding);
    if (block.type === 'group') block.children = synchronizeCustomPropertyBindings(block.children, properties);
    if (block.type === 'paragraph') block.children = synchronizeCustomPropertyBindings(block.children, properties) as typeof block.children;
    if (block.type === 'scriptureReading' && block.elements) block.elements = Object.fromEntries(Object.entries(block.elements).map(([role, settings]) => [role, settings?.condition ? { ...settings, condition: { ...settings.condition, property: sync(settings.condition.property) } } : settings]));
    if (block.type === 'templatePage' || block.type === 'templateInstance') block.blocks = synchronizeCustomPropertyBindings(block.blocks, properties);
    if (block.type === 'canvas') block.scene.elements = block.scene.elements.map(element => {
      const next = structuredClone(element);
      if (next.condition) next.condition.property = sync(next.condition.property);
      return next.type === 'block' ? { ...next, block: synchronizeCustomPropertyBindings([next.block], properties)[0] } : next;
    });
    return block;
  });
}

export function customPropertyIssues(template: Pick<TemplateV1, 'customProperties' | 'starterBlocks'>, document?: Pick<BulletinDocumentV1, 'customProperties' | 'customPropertyOverrides'>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const properties = effectiveCustomPropertyDefinitions(template, document);
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const [index, property] of properties.entries()) {
    const path = `/customProperties/${index}`;
    const name = property.name.trim().toLocaleLowerCase();
    if (!property.id.trim()) issues.push({ path: `${path}/id`, message: 'Custom properties require a stable ID.' });
    else if (ids.has(property.id)) issues.push({ path: `${path}/id`, message: `Duplicate custom property ID: ${property.id}` });
    if (!name) issues.push({ path: `${path}/name`, message: 'Custom properties require a name.' });
    else if (names.has(name)) issues.push({ path: `${path}/name`, message: `Custom property names must be unique: ${property.name}` });
    if (!['string', 'number', 'boolean'].includes(property.valueType)) issues.push({ path: `${path}/valueType`, message: `Unsupported custom property type: ${String(property.valueType)}` });
    const validType = typeof property.defaultValue === property.valueType && (property.valueType !== 'number' || Number.isFinite(property.defaultValue));
    if (!validType) issues.push({ path: `${path}/defaultValue`, message: `Default value must be valid for a ${propertyTypeName(property.valueType)} property.` });
    ids.add(property.id); names.add(name);
  }
  for (const [id, value] of Object.entries(document?.customPropertyOverrides ?? {})) {
    const definition = properties.find(property => property.id === id);
    if (!definition) issues.push({ path: `/customPropertyOverrides/${id}`, message: `Override references missing custom property “${id}”.` });
    else if (typeof value !== definition.valueType || (typeof value === 'number' && !Number.isFinite(value))) issues.push({ path: `/customPropertyOverrides/${id}`, message: `Override for “${definition.name}” must be valid for a ${propertyTypeName(definition.valueType)} property.` });
  }
  const inspect = (block: BulletinBlock, path: string) => {
    const bindings: CustomPropertyBinding[] = [];
    const inspectCondition = (condition: unknown, conditionPath: string) => {
      if (!condition || typeof condition !== 'object') return;
      const candidate = condition as { property?: unknown; equals?: unknown };
      if (isCustomPropertyBinding(candidate.property)) bindings.push(candidate.property);
      else issues.push({ path: `${conditionPath}/property`, message: 'Conditions require a custom property binding.' });
      if (typeof candidate.equals !== 'boolean') issues.push({ path: `${conditionPath}/equals`, message: 'Conditional comparison must be on or off.' });
    };
    inspectCondition(block.condition, `${path}/condition`);
    if (block.type === 'richText' && isCustomPropertyBinding(block.binding)) bindings.push(block.binding);
    if (block.type === 'custom') bindings.push(...block.bindings.map(binding => binding.source).filter(isCustomPropertyBinding));
    for (const binding of bindings) {
      const definition = properties.find(property => property.id === binding.propertyId);
      if (!definition) issues.push({ path, message: `Binding references missing custom property “${binding.propertyName}”.` });
      else if (definition.valueType !== binding.valueType) issues.push({ path, message: `Binding for “${definition.name}” expects ${propertyTypeName(binding.valueType)}, not ${propertyTypeName(definition.valueType)}.` });
      if (block.condition?.property?.propertyId === binding.propertyId && definition?.valueType !== 'boolean') issues.push({ path, message: 'Conditions require a Toggle property.' });
    }
    if (block.type === 'canvas') block.scene.elements.forEach((element, index) => {
      const canvasBindings: CustomPropertyBinding[] = [];
      const condition = element.condition as { property?: unknown; equals?: unknown } | undefined;
      if (condition) {
        if (isCustomPropertyBinding(condition.property)) canvasBindings.push(condition.property);
        else issues.push({ path: `${path}/scene/elements/${index}/condition/property`, message: 'Conditions require a custom property binding.' });
        if (typeof condition.equals !== 'boolean') issues.push({ path: `${path}/scene/elements/${index}/condition/equals`, message: 'Conditional comparison must be on or off.' });
      }
      for (const binding of canvasBindings) {
        const definition = properties.find(property => property.id === binding.propertyId);
        if (!definition) issues.push({ path, message: `Binding references missing custom property “${binding.propertyName}”.` });
        else if (definition.valueType !== 'boolean') issues.push({ path, message: 'Conditions require a Toggle property.' });
      }
      if (element.type === 'block') inspect(element.block, `${path}/scene/elements/${index}/block`);
    });
    childBlocks(block)?.forEach((child, index) => inspect(child, `${path}/children/${index}`));
  };
  template.starterBlocks.forEach((block, index) => inspect(block, `/starterBlocks/${index}`));
  return issues;
}

export const builtInTextBindings: Array<{ value: BuiltInTextBinding; label: string }> = [
  { value: 'info.title', label: 'Sermon title' },
  { value: 'info.date', label: 'Service date' },
  { value: 'info.churchEvent', label: 'Church event' },
  { value: 'info.series', label: 'Series' },
  { value: 'church.name', label: 'Church name' },
];
