import type { BulletinDocumentV1, CustomBlock, CustomBlockBinding, CustomBlockStyle, Paragraph } from './types.js';

export const defaultCustomBlockStyle: CustomBlockStyle = {
  widthPercent: 100,
  placement: 'left',
  textAlign: 'left',
  verticalAlign: 'top',
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

export function customLayoutKeys(layoutText: string): string[] {
  return [...layoutText.matchAll(/{{\s*([A-Za-z_][A-Za-z0-9_]*)\s*}}/g)].map(match => match[1]);
}

export function customBlockIssues(block: Pick<CustomBlock, 'name' | 'layoutText' | 'bindings'>): string[] {
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
  if (binding.source === 'info.churchWeek' || binding.source === 'info.churchEvent') return document.info.churchWeek || binding.defaultValue || '';
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
