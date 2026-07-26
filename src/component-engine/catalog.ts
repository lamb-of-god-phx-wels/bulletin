import Ajv2020 from 'ajv/dist/2020';
import definitionSchema from '../../schemas/component-definition-v1.schema.json';
import { ComponentRegistry } from './registry.js';
import type { ComponentDiagnostic, DeclarativeComponentDefinition } from './types.js';

const validateDefinition = new Ajv2020({ allErrors: true, strict: true }).compile(definitionSchema);

export interface ComponentCatalog {
  registry: ComponentRegistry;
  diagnostics: ComponentDiagnostic[];
}

function parseDefinition(raw: string, sourceId: string): {
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
  if (validateDefinition(value)) return { definition: value as unknown as DeclarativeComponentDefinition, diagnostics: [] };
  return {
    diagnostics: (validateDefinition.errors ?? []).map(error => ({
      severity: 'error',
      code: 'COMPONENT_DEFINITION_INVALID',
      message: error.message ?? 'Component definition is invalid.',
      jsonPointer: error.instancePath || '/',
      sourceId
    }))
  };
}

export function loadComponentCatalog(files: Record<string, string>): ComponentCatalog {
  const registry = new ComponentRegistry();
  const diagnostics: ComponentDiagnostic[] = [];
  for (const [sourceId, raw] of Object.entries(files).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    const parsed = parseDefinition(raw, sourceId);
    diagnostics.push(...parsed.diagnostics);
    if (parsed.definition) diagnostics.push(...registry.register(parsed.definition, sourceId));
  }
  return { registry, diagnostics };
}

const packagedFiles = import.meta.glob<string>('../../component-definitions/prepackaged/*.json', {
  eager: true,
  query: '?raw',
  import: 'default'
});

export const prepackagedComponentCatalog = loadComponentCatalog(packagedFiles);
