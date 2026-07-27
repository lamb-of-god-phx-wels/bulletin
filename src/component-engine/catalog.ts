import { ComponentRegistry } from './registry.js';
import type { ComponentDiagnostic, DeclarativeComponentDefinition } from './types.js';

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function definitionIssues(value: unknown): Array<{ path: string; message: string }> {
  if (!record(value)) return [{ path: '/', message: 'must be an object' }];
  const issues: Array<{ path: string; message: string }> = [];
  const required = ['schemaVersion', 'kind', 'type', 'version', 'name', 'description', 'inputSchema', 'template'];
  for (const key of required) if (!(key in value)) issues.push({ path: `/${key}`, message: 'is required' });
  if (value.schemaVersion !== 2) issues.push({ path: '/schemaVersion', message: 'must be 2' });
  if (value.kind !== 'component') issues.push({ path: '/kind', message: 'must be component' });
  if (typeof value.type !== 'string' || !/^[a-z][a-z0-9-]*:[a-z][A-Za-z0-9-]*$/.test(value.type)) issues.push({ path: '/type', message: 'must be a namespaced component type' });
  if (!Number.isInteger(value.version) || Number(value.version) < 1) issues.push({ path: '/version', message: 'must be a positive integer' });
  for (const key of ['name', 'description']) if (typeof value[key] !== 'string' || !String(value[key]).trim()) issues.push({ path: `/${key}`, message: 'must be a non-empty string' });
  if (!record(value.inputSchema)) issues.push({ path: '/inputSchema', message: 'must be an object' });
  const inspectNode = (node: unknown, path: string) => {
    if (!record(node)) { issues.push({ path, message: 'must be an object' }); return; }
    if (typeof node.type !== 'string' || !node.type) issues.push({ path: `${path}/type`, message: 'must be a non-empty string' });
    if (node.children !== undefined) {
      if (!Array.isArray(node.children)) issues.push({ path: `${path}/children`, message: 'must be an array' });
      else node.children.forEach((child, index) => inspectNode(child, `${path}/children/${index}`));
    }
  };
  inspectNode(value.template, '/template');
  if (value.editor !== undefined) {
    if (!record(value.editor) || !Array.isArray(value.editor.fields)) issues.push({ path: '/editor/fields', message: 'must be an array' });
    else value.editor.fields.forEach((field, index) => {
      if (!record(field) || typeof field.input !== 'string' || typeof field.label !== 'string' || typeof field.control !== 'string') {
        issues.push({ path: `/editor/fields/${index}`, message: 'must declare input, label, and control' });
      } else if (!['text', 'textarea', 'structuredText', 'number', 'checkbox', 'select', 'asset', 'collection'].includes(field.control)) {
        issues.push({ path: `/editor/fields/${index}/control`, message: 'uses an unsupported editor control' });
      }
    });
  }
  return issues;
}

export interface ComponentCatalog {
  registry: ComponentRegistry;
  diagnostics: ComponentDiagnostic[];
}

export function parseComponentDefinition(raw: string, sourceId = 'imported JSON'): {
  definition?: DeclarativeComponentDefinition;
  diagnostics: ComponentDiagnostic[];
} {
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch (error) {
    return {
      diagnostics: [{
        severity: 'error',
        code: 'COMPONENT_JSON_INVALID',
        message: error instanceof Error ? error.message : String(error),
        sourceId
      }]
    };
  }
  const issues = definitionIssues(value);
  if (!issues.length) return { definition: value as unknown as DeclarativeComponentDefinition, diagnostics: [] };
  return {
    diagnostics: issues.map(error => ({
      severity: 'error',
      code: 'COMPONENT_DEFINITION_INVALID',
      message: error.message,
      jsonPointer: error.path,
      sourceId
    }))
  };
}

export function loadComponentCatalog(files: Record<string, string>): ComponentCatalog {
  const registry = new ComponentRegistry();
  const diagnostics: ComponentDiagnostic[] = [];
  const sources = new Map<string, string>();
  for (const [sourceId, raw] of Object.entries(files).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    const parsed = parseComponentDefinition(raw, sourceId);
    diagnostics.push(...parsed.diagnostics);
    if (parsed.definition) {
      const registration = registry.register(parsed.definition, sourceId);
      diagnostics.push(...registration);
      if (!registration.length) sources.set(`${parsed.definition.type}@${parsed.definition.version}`, sourceId);
    }
  }
  const coreTypes = new Set(['core:stack', 'core:row', 'core:repeat', 'core:text', 'core:structuredText', 'core:spacer', 'core:image', 'core:canvas']);
  const inspect = (definition: DeclarativeComponentDefinition, node: DeclarativeComponentDefinition['template'], pointer: string) => {
    if (!coreTypes.has(node.type) && !registry.latest(node.type)) diagnostics.push({
      severity: 'error',
      code: 'COMPONENT_DEPENDENCY_MISSING',
      message: `Component ${definition.type}@${definition.version} requires unavailable component ${node.type}.`,
      componentType: definition.type,
      jsonPointer: pointer,
      sourceId: sources.get(`${definition.type}@${definition.version}`)
    });
    node.children?.forEach((child, index) => inspect(definition, child, `${pointer}/children/${index}`));
  };
  for (const definition of registry.list()) {
    inspect(definition, definition.template, '/template');
  }
  const definitions = registry.list();
  const latestKeys = new Map<string, string>();
  for (const definition of definitions) {
    const previous = latestKeys.get(definition.type);
    const previousVersion = previous ? Number(previous.split('@').at(-1)) : 0;
    if (definition.version > previousVersion) latestKeys.set(definition.type, `${definition.type}@${definition.version}`);
  }
  const dependencies = new Map<string, string[]>();
  const collect = (node: DeclarativeComponentDefinition['template'], result: string[]) => {
    const dependency = latestKeys.get(node.type);
    if (dependency) result.push(dependency);
    node.children?.forEach(child => collect(child, result));
  };
  for (const definition of definitions) {
    const key = `${definition.type}@${definition.version}`;
    const result: string[] = [];
    collect(definition.template, result);
    dependencies.set(key, [...new Set(result)]);
  }
  const state = new Map<string, 'visiting' | 'visited'>();
  const reported = new Set<string>();
  const visit = (key: string, path: string[]) => {
    if (state.get(key) === 'visiting') {
      const cycle = [...path.slice(path.indexOf(key)), key];
      const signature = cycle.slice().sort().join('|');
      if (!reported.has(signature)) {
        reported.add(signature);
        diagnostics.push({
          severity: 'error',
          code: 'COMPONENT_DEPENDENCY_CYCLE',
          message: `Component dependency cycle: ${cycle.join(' → ')}.`,
          componentType: key.slice(0, key.lastIndexOf('@')),
          sourceId: sources.get(key)
        });
      }
      return;
    }
    if (state.get(key) === 'visited') return;
    state.set(key, 'visiting');
    for (const dependency of dependencies.get(key) ?? []) visit(dependency, [...path, key]);
    state.set(key, 'visited');
  };
  for (const key of dependencies.keys()) visit(key, []);
  return { registry, diagnostics };
}

const packagedFiles = import.meta.glob<string>('../../component-definitions/prepackaged/*.json', {
  eager: true,
  query: '?raw',
  import: 'default'
});

export const prepackagedComponentCatalog = loadComponentCatalog(packagedFiles);
