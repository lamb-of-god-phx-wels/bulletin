import type { BulletinDocumentV1, CustomBlock, CustomBlockBinding, CustomBlockDefinitionV1, CustomBlockStyle, CustomBindingSource, Paragraph } from './types.js';

export const defaultCustomBlockStyle: CustomBlockStyle = {
  widthPercent: 100,
  placement: 'left',
  textAlign: 'left',
  paddingIn: { top: 0, right: 0, bottom: 0, left: 0 },
  marginIn: { top: 0, bottom: .12 },
  fontFamily: 'body',
  fontSizePt: 10,
  lineHeight: 1.28,
  fontWeight: 'normal',
  fontStyle: 'normal',
  textTransform: 'none',
  color: '#25302d',
  borderWidthPt: 0,
  borderColor: '#a44d2a',
  borderRadiusPt: 0
};

export function newCustomBlockDefinition(name = 'Custom block'): CustomBlockDefinitionV1 {
  return {
    id: `${bindingKey(name).replace(/([A-Z])/g, '-$1').toLowerCase() || 'custom-block'}-${Date.now()}`,
    name,
    showName: true,
    layoutText: '{{text}}',
    bindings: [{ key: 'text', label: 'Text', source: 'weekly', multiline: true }],
    style: structuredClone(defaultCustomBlockStyle),
    updatedAt: new Date().toISOString()
  };
}

export function customBlockFromDefinition(definition: CustomBlockDefinitionV1): CustomBlock {
  return {
    id: `${definition.id}-${Date.now()}`,
    type: 'custom',
    definitionId: definition.id,
    name: definition.name,
    label: definition.name,
    showName: definition.showName,
    layoutText: definition.layoutText,
    bindings: structuredClone(definition.bindings),
    style: structuredClone(definition.style),
    values: {},
    weeklyEditable: definition.bindings.some(binding => binding.source === 'weekly')
  };
}

export const customBindingSources: Array<{ value: CustomBindingSource; label: string }> = [
  { value: 'weekly', label: 'Weekly input' },
  { value: 'info.title', label: 'Sermon title' },
  { value: 'info.date', label: 'Service date' },
  { value: 'info.churchWeek', label: 'Church week' },
  { value: 'info.series', label: 'Series' },
  { value: 'church.name', label: 'Church name' }
];

export function bindingKey(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_]+(.)/g, (_match, next: string) => next.toUpperCase()).replace(/[^a-zA-Z0-9_]/g, '').replace(/^[A-Z]/, first => first.toLowerCase()).replace(/^([0-9])/, '_$1');
}

export function customLayoutKeys(layoutText: string): string[] {
  return [...layoutText.matchAll(/{{\s*([A-Za-z_][A-Za-z0-9_]*)\s*}}/g)].map(match => match[1]);
}

export function customBlockDefinitionIssues(block: Pick<CustomBlock, 'name' | 'layoutText' | 'bindings'>): string[] {
  const issues: string[] = [];
  if (!block.name.trim()) issues.push('Enter a block name.');
  if (!block.layoutText.trim()) issues.push('Enter a layout for this block.');
  const keys = new Set<string>();
  for (const binding of block.bindings) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(binding.key)) issues.push(`“${binding.label || 'Binding'}” needs a valid placeholder key.`);
    else if (keys.has(binding.key)) issues.push(`Placeholder “${binding.key}” is used by more than one binding.`);
    keys.add(binding.key);
  }
  for (const key of new Set(customLayoutKeys(block.layoutText))) {
    if (!keys.has(key)) issues.push(`Layout placeholder “{{${key}}}” has no data binding.`);
  }
  return issues;
}

export function resolveCustomBinding(binding: CustomBlockBinding, block: CustomBlock, document: BulletinDocumentV1): string {
  if (binding.source === 'weekly') return block.values?.[binding.key] ?? binding.defaultValue ?? '';
  if (binding.source === 'church.name') return document.church.name;
  if (binding.source === 'info.date') {
    const date = new Date(`${document.info.date}T12:00:00`);
    return Number.isNaN(date.valueOf()) ? document.info.date : date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  }
  const value = document.info[binding.source.slice(5) as keyof BulletinDocumentV1['info']];
  return value ?? binding.defaultValue ?? '';
}

export function renderCustomBlockText(block: CustomBlock, document: BulletinDocumentV1): string {
  const bindings = new Map(block.bindings.map(binding => [binding.key, binding]));
  return block.layoutText.replace(/{{\s*([A-Za-z_][A-Za-z0-9_]*)\s*}}/g, (placeholder, key: string) => {
    const binding = bindings.get(key);
    return binding ? resolveCustomBinding(binding, block, document) : placeholder;
  });
}

export function customBlockParagraphs(block: CustomBlock, document: BulletinDocumentV1): Paragraph[] {
  const rendered = renderCustomBlockText(block, document);
  return rendered.split(/\n\s*\n/).filter(value => value.length > 0).map(value => ({
    type: 'paragraph',
    children: [{ type: 'text', text: value.replace(/\n/g, ' ') }]
  }));
}
