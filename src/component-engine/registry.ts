import { schemaDefinitionIssues, validateSchemaValue } from './schemaValidation.js';
import type { ComponentDiagnostic, ComponentReference, DeclarativeComponentDefinition } from './types.js';

interface RegisteredDefinition {
  definition: DeclarativeComponentDefinition;
  sourceId?: string;
}

const componentTypePattern = /^[a-z][a-z0-9-]*:[a-z][A-Za-z0-9-]*$/;

export class ComponentRegistry {
  readonly #definitions = new Map<string, RegisteredDefinition>();
  readonly #diagnostics: ComponentDiagnostic[] = [];

  register(definition: DeclarativeComponentDefinition, sourceId?: string): ComponentDiagnostic[] {
    const diagnostics: ComponentDiagnostic[] = [];
    const key = `${definition.type}@${definition.version}`;
    if (!componentTypePattern.test(definition.type)) diagnostics.push({
      severity: 'error',
      code: 'COMPONENT_TYPE_INVALID',
      message: `Component type “${definition.type}” must use a namespace such as bulletin:scriptureReading.`,
      componentType: definition.type,
      sourceId
    });
    if (!Number.isInteger(definition.version) || definition.version < 1) diagnostics.push({
      severity: 'error',
      code: 'COMPONENT_VERSION_INVALID',
      message: 'Component versions must be positive integers.',
      componentType: definition.type,
      sourceId
    });
    if (this.#definitions.has(key)) diagnostics.push({
      severity: 'error',
      code: 'COMPONENT_DUPLICATE',
      message: `Component ${key} is already registered. The duplicate was quarantined.`,
      componentType: definition.type,
      sourceId
    });

    diagnostics.push(...schemaDefinitionIssues(definition.inputSchema).map(issue => ({
      severity: 'error' as const,
      code: 'COMPONENT_SCHEMA_INVALID',
      message: issue.message,
      componentType: definition.type,
      jsonPointer: issue.path,
      sourceId
    })));

    if (diagnostics.length) {
      this.#diagnostics.push(...diagnostics);
      return diagnostics;
    }
    this.#definitions.set(key, { definition: structuredClone(definition), sourceId });
    return [];
  }

  get(reference: ComponentReference): DeclarativeComponentDefinition | undefined {
    const found = this.#definitions.get(`${reference.type}@${reference.version}`);
    return found ? structuredClone(found.definition) : undefined;
  }

  latest(type: string): DeclarativeComponentDefinition | undefined {
    return this.list()
      .filter(definition => definition.type === type)
      .sort((left, right) => right.version - left.version)[0];
  }

  validateInputs(reference: ComponentReference, inputs: Record<string, unknown>): ComponentDiagnostic[] {
    const registered = this.#definitions.get(`${reference.type}@${reference.version}`);
    if (!registered) return [{
      severity: 'error',
      code: 'COMPONENT_NOT_FOUND',
      message: `Component ${reference.type}@${reference.version} is unavailable.`,
      componentType: reference.type
    }];
    return validateSchemaValue(registered.definition.inputSchema, inputs).map(issue => ({
      severity: 'error',
      code: 'COMPONENT_INPUT_INVALID',
      message: issue.message,
      componentType: reference.type,
      jsonPointer: issue.path
    }));
  }

  list(): DeclarativeComponentDefinition[] {
    return [...this.#definitions.values()].map(item => structuredClone(item.definition));
  }

  diagnostics(): ComponentDiagnostic[] {
    return structuredClone(this.#diagnostics);
  }
}
