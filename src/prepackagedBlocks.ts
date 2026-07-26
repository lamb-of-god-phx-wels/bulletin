import type { BlockDescriptorV1, BulletinBlock } from './shared/types';

const blockTypes = new Set<BulletinBlock['type']>([
  'titlePage', 'churchInfo', 'heading', 'paragraph', 'richText', 'sermonTitle',
  'responsiveReading', 'scriptureReading', 'song', 'libraryText',
  'announcements', 'copyright', 'fullPageAsset', 'spacer', 'group', 'custom',
  'sectionHeading'
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function blockIssues(value: unknown, path = '/block'): string[] {
  if (!isRecord(value)) return [`${path}: must be an object.`];
  const issues: string[] = [];
  if (typeof value.id !== 'string' || !value.id) issues.push(`${path}/id: must be a non-empty string.`);
  if (typeof value.type !== 'string' || !blockTypes.has(value.type as BulletinBlock['type'])) return [...issues, `${path}/type: is not a supported block type.`];
  const requireString = (key: string) => { if (typeof value[key] !== 'string') issues.push(`${path}/${key}: must be a string.`); };
  const requireArray = (key: string) => { if (!Array.isArray(value[key])) issues.push(`${path}/${key}: must be an array.`); };
  if (value.type === 'heading' || value.type === 'sectionHeading' || value.type === 'sermonTitle') requireString('text');
  if (value.type === 'richText') requireArray('content');
  if (value.type === 'paragraph' || value.type === 'group') requireArray('children');
  if (value.type === 'scriptureReading') {
    requireString('reference'); requireString('translation');
    if (value.elements !== undefined) {
      if (!isRecord(value.elements)) issues.push(`${path}/elements: must be an object.`);
      else {
        const roles = new Set(['heading', 'reference', 'caption', 'body']);
        for (const [role, formatting] of Object.entries(value.elements)) {
          if (!roles.has(role)) { issues.push(`${path}/elements/${role}: is not a supported Scripture element.`); continue; }
          if (!isRecord(formatting)) { issues.push(`${path}/elements/${role}: must be an object.`); continue; }
          for (const key of Object.keys(formatting)) if (!['presentation', 'layout'].includes(key)) issues.push(`${path}/elements/${role}/${key}: is not a recognized formatting property.`);
          issues.push(...blockIssues({
            id: role,
            type: 'heading',
            text: '',
            presentation: formatting.presentation,
            layout: formatting.layout
          }, `${path}/elements/${role}`).filter(issue => !issue.endsWith('/text: must be a string.')));
        }
      }
    }
  }
  if (value.type === 'responsiveReading') requireArray('entries');
  if (value.type === 'song') {
    requireString('libraryItemId');
    if (!['hymn', 'psalm', 'song'].includes(String(value.songType))) issues.push(`${path}/songType: must be hymn, psalm, or song.`);
    if (!['lyrics', 'asset'].includes(String(value.renderMode))) issues.push(`${path}/renderMode: must be lyrics or asset.`);
    if (!isRecord(value.selection) || !['all', 'verses'].includes(String(value.selection.mode))) issues.push(`${path}/selection: must select all or specific verses.`);
  }
  if (value.type === 'libraryText') requireString('libraryItemId');
  if (value.type === 'announcements') requireArray('items');
  if (value.type === 'fullPageAsset' && !isRecord(value.asset)) issues.push(`${path}/asset: must be an asset reference.`);
  if (value.type === 'spacer' && !['small', 'medium', 'large'].includes(String(value.size))) issues.push(`${path}/size: must be small, medium, or large.`);
  if (value.type === 'custom') {
    requireString('name'); requireString('layoutText'); requireArray('bindings');
    if (Array.isArray(value.bindings)) value.bindings.forEach((binding, index) => {
      if (!isRecord(binding)) { issues.push(`${path}/bindings/${index}: must be an object.`); return; }
      if (typeof binding.key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(binding.key)) issues.push(`${path}/bindings/${index}/key: must be a valid binding key.`);
      if (typeof binding.label !== 'string' || !binding.label) issues.push(`${path}/bindings/${index}/label: must be a non-empty string.`);
      if (!['weekly', 'info.title', 'info.date', 'info.churchWeek', 'info.series', 'church.name'].includes(String(binding.source))) issues.push(`${path}/bindings/${index}/source: is not supported.`);
    });
  }
  if (value.presentation !== undefined) {
    if (!isRecord(value.presentation)) issues.push(`${path}/presentation: must be an object.`);
    else {
      const numeric = ['widthPercent', 'fontSizePt', 'lineHeight', 'borderWidthPt', 'borderRadiusPt'];
      for (const key of numeric) if (value.presentation[key] !== undefined && typeof value.presentation[key] !== 'number') issues.push(`${path}/presentation/${key}: must be a number.`);
      const enums: Record<string, string[]> = {
        placement: ['left', 'center', 'right'],
        textAlign: ['left', 'center', 'right', 'justify'],
        fontWeight: ['normal', 'bold'],
        fontStyle: ['normal', 'italic'],
        textTransform: ['none', 'uppercase', 'small-caps']
      };
      for (const [key, values] of Object.entries(enums)) if (value.presentation[key] !== undefined && !values.includes(String(value.presentation[key]))) issues.push(`${path}/presentation/${key}: has an unsupported value.`);
      for (const [key, sides] of [['paddingIn', ['top', 'right', 'bottom', 'left']], ['marginIn', ['top', 'bottom']]] as const) {
        const box = value.presentation[key];
        if (box === undefined) continue;
        if (!isRecord(box)) issues.push(`${path}/presentation/${key}: must be an object.`);
        else for (const side of sides) if (box[side] !== undefined && typeof box[side] !== 'number') issues.push(`${path}/presentation/${key}/${side}: must be a number.`);
      }
    }
  }
  if (value.layout !== undefined) {
    if (!isRecord(value.layout)) issues.push(`${path}/layout: must be an object.`);
    else {
      for (const key of ['pageBreakBefore', 'keepTogether']) if (value.layout[key] !== undefined && typeof value.layout[key] !== 'boolean') issues.push(`${path}/layout/${key}: must be true or false.`);
      if (value.layout.density !== undefined && !['normal', 'compact'].includes(String(value.layout.density))) issues.push(`${path}/layout/density: must be normal or compact.`);
      if (value.layout.fit !== undefined && !['contain', 'cover'].includes(String(value.layout.fit))) issues.push(`${path}/layout/fit: must be contain or cover.`);
    }
  }
  if (value.children !== undefined) {
    if (!Array.isArray(value.children)) issues.push(`${path}/children: must be an array.`);
    else value.children.forEach((child, index) => issues.push(...blockIssues(child, `${path}/children/${index}`)));
  }
  return issues;
}

export function validateBlockDescriptor(value: unknown): { descriptor?: BlockDescriptorV1; issues: string[] } {
  if (!isRecord(value)) return { issues: ['/: must be a JSON object.'] };
  const issues: string[] = [];
  const allowed = new Set(['schemaVersion', 'id', 'version', 'name', 'description', 'icon', 'order', 'block']);
  for (const key of Object.keys(value)) if (!allowed.has(key)) issues.push(`/${key}: is not a recognized descriptor property.`);
  if (value.schemaVersion !== 1) issues.push('/schemaVersion: must be 1.');
  if (typeof value.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id)) issues.push('/id: must use lowercase letters, numbers, and single hyphens.');
  if (!Number.isInteger(value.version) || Number(value.version) < 1) issues.push('/version: must be a positive integer.');
  if (typeof value.name !== 'string' || !value.name.trim()) issues.push('/name: must be a non-empty string.');
  if (typeof value.description !== 'string' || !value.description.trim()) issues.push('/description: must be a non-empty string.');
  if (value.icon !== undefined && (typeof value.icon !== 'string' || !value.icon || [...value.icon].length > 4)) issues.push('/icon: must contain one to four characters.');
  if (!Number.isInteger(value.order) || Number(value.order) < 0) issues.push('/order: must be a non-negative integer.');
  issues.push(...blockIssues(value.block));
  return issues.length ? { issues: [...new Set(issues)] } : { descriptor: value as unknown as BlockDescriptorV1, issues: [] };
}

export function parseBlockDescriptor(raw: string): { descriptor?: BlockDescriptorV1; issues: string[] } {
  try { return validateBlockDescriptor(JSON.parse(raw)); }
  catch (error) { return { issues: [`JSON: ${error instanceof Error ? error.message : String(error)}`] }; }
}

export interface BlockDescriptorCatalogDiagnostic {
  source: string;
  key?: string;
  message: string;
}

export function loadBlockDescriptorCatalog(files: Record<string, string>): {
  descriptors: BlockDescriptorV1[];
  diagnostics: BlockDescriptorCatalogDiagnostic[];
} {
  const diagnostics: BlockDescriptorCatalogDiagnostic[] = [];
  const descriptors: BlockDescriptorV1[] = [];
  const descriptorKeys = new Set<string>();

  for (const [source, raw] of Object.entries(files).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    const result = parseBlockDescriptor(raw);
    if (!result.descriptor) {
      diagnostics.push(...result.issues.map(message => ({ source, message })));
      continue;
    }
    const key = `${result.descriptor.id}@${result.descriptor.version}`;
    if (descriptorKeys.has(key)) {
      diagnostics.push({ source, key, message: `Duplicate pre-packaged block descriptor ${key}. The duplicate was not loaded.` });
      continue;
    }
    descriptorKeys.add(key);
    descriptors.push(result.descriptor);
  }

  return {
    descriptors: descriptors.sort((left, right) => left.order - right.order || left.name.localeCompare(right.name)),
    diagnostics
  };
}

const descriptorFiles = import.meta.glob<string>('../block-descriptors/prepackaged/*.json', {
  eager: true,
  query: '?raw',
  import: 'default'
});

const prepackagedCatalog = loadBlockDescriptorCatalog(descriptorFiles);
export const prepackagedBlockDescriptors = prepackagedCatalog.descriptors;
export const prepackagedBlockDiagnostics = prepackagedCatalog.diagnostics;

function instantiatePrototype(block: BulletinBlock, parentId: string): BulletinBlock {
  const clone = structuredClone(block) as BulletinBlock & { children?: BulletinBlock[] };
  const id = `${parentId}-${block.id}`;
  if (Array.isArray(clone.children)) clone.children = clone.children.map(child => instantiatePrototype(child, id));
  return { ...clone, id };
}

export function instantiateBlockDescriptor(descriptor: BlockDescriptorV1): BulletinBlock {
  const instanceId = `${descriptor.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const prototype = structuredClone(descriptor.block) as BulletinBlock & { children?: BulletinBlock[] };
  if (Array.isArray(prototype.children)) prototype.children = prototype.children.map(child => instantiatePrototype(child, instanceId));
  return { ...prototype, id: instanceId };
}
