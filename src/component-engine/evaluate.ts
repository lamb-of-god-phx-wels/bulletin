import { evaluateBoundValue } from './bindings.js';
import { ComponentRegistry } from './registry.js';
import type {
  BoundValue,
  ComponentDiagnostic,
  ComponentInstanceV2,
  ComponentNodeDescriptor,
  ComponentStyle,
  ComponentStyleOverrides,
  EvaluationContext,
  EvaluationResult,
  JsonValue,
  LayoutNode,
  StructuredText
} from './types.js';

const coreTypes = new Set(['core:stack', 'core:text', 'core:structuredText', 'core:spacer']);

function mergeStyle(...styles: Array<ComponentStyle | undefined>): ComponentStyle | undefined {
  const values = styles.filter((style): style is ComponentStyle => Boolean(style));
  if (!values.length) return undefined;
  return values.reduce<ComponentStyle>((result, style) => ({
    ...result,
    ...style,
    paddingIn: style.paddingIn ? { ...result.paddingIn, ...style.paddingIn } : result.paddingIn,
    marginIn: style.marginIn ? { ...result.marginIn, ...style.marginIn } : result.marginIn
  }), {});
}

function evaluateInputs(values: Record<string, BoundValue> | undefined, context: EvaluationContext) {
  const diagnostics: ComponentDiagnostic[] = [];
  const inputs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values ?? {})) {
    const result = evaluateBoundValue(value, context);
    diagnostics.push(...result.diagnostics);
    if (result.value !== undefined) inputs[key] = result.value;
  }
  return { inputs, diagnostics };
}

function booleanValue(value: BoundValue | undefined, context: EvaluationContext) {
  if (value === undefined) return { value: true, diagnostics: [] as ComponentDiagnostic[] };
  const result = evaluateBoundValue(value, context);
  return { value: Boolean(result.value), diagnostics: result.diagnostics };
}

function source(instanceId: string, componentType: string, part?: string) {
  return { instanceId, componentType, ...(part ? { part } : {}) };
}

function styleFor(
  node: ComponentNodeDescriptor,
  definitionStyles: ComponentStyleOverrides | undefined,
  instanceStyles: ComponentStyleOverrides | undefined
) {
  return mergeStyle(
    node.part ? definitionStyles?.parts?.[node.part] : definitionStyles?.root,
    node.style?.root,
    node.part ? instanceStyles?.parts?.[node.part] : instanceStyles?.root
  );
}

function lengthInPoints(size: unknown, unit: unknown): number | undefined {
  if (typeof size !== 'number' || size < 0) return undefined;
  if (unit === 'pt') return size;
  if (unit === 'in') return size * 72;
  if (unit === 'mm') return size * 72 / 25.4;
  if (unit === 'cm') return size * 72 / 2.54;
  return undefined;
}

function expandNode(
  node: ComponentNodeDescriptor,
  context: EvaluationContext,
  registry: ComponentRegistry,
  instanceId: string,
  ownerType: string,
  definitionStyles?: ComponentStyleOverrides,
  instanceStyles?: ComponentStyleOverrides,
  path = '/template'
): EvaluationResult {
  const visible = booleanValue(node.when, context);
  if (visible.diagnostics.length || !visible.value) return { diagnostics: visible.diagnostics };
  const evaluated = evaluateInputs(node.inputs, context);
  const diagnostics = [...evaluated.diagnostics];
  const id = node.id ? `${instanceId}-${node.id}` : `${instanceId}-${path.replace(/[^A-Za-z0-9]+/g, '-')}`;
  const style = styleFor(node, definitionStyles, instanceStyles);
  const nodeSource = source(instanceId, ownerType, node.part);

  if (node.type === 'core:stack') {
    const children: LayoutNode[] = [];
    for (const [index, child] of (node.children ?? []).entries()) {
      const result = expandNode(child, context, registry, instanceId, ownerType, definitionStyles, instanceStyles, `${path}/children/${index}`);
      diagnostics.push(...result.diagnostics);
      if (result.node) children.push(result.node);
    }
    return { node: { id, type: 'stack', children, style, source: nodeSource }, diagnostics };
  }

  if (node.type === 'core:text') {
    const value = evaluated.inputs.text;
    if (typeof value !== 'string') diagnostics.push({
      severity: 'error',
      code: 'LAYOUT_TEXT_INVALID',
      message: 'core:text requires a string input named text.',
      componentType: ownerType,
      instanceId,
      jsonPointer: `${path}/inputs/text`
    });
    return typeof value === 'string'
      ? { node: { id, type: 'text', text: value, style, source: nodeSource }, diagnostics }
      : { diagnostics };
  }

  if (node.type === 'core:structuredText') {
    const value = evaluated.inputs.content as StructuredText | undefined;
    if (!value || !Array.isArray(value.blocks)) diagnostics.push({
      severity: 'error',
      code: 'LAYOUT_STRUCTURED_TEXT_INVALID',
      message: 'core:structuredText requires structured content with a blocks array.',
      componentType: ownerType,
      instanceId,
      jsonPointer: `${path}/inputs/content`
    });
    return value && Array.isArray(value.blocks)
      ? { node: { id, type: 'structuredText', content: value, style, source: nodeSource }, diagnostics }
      : { diagnostics };
  }

  if (node.type === 'core:spacer') {
    const sizePt = lengthInPoints(evaluated.inputs.size, evaluated.inputs.unit);
    if (sizePt === undefined) diagnostics.push({
      severity: 'error',
      code: 'LAYOUT_LENGTH_INVALID',
      message: 'core:spacer requires a non-negative size and a pt, in, mm, or cm unit.',
      componentType: ownerType,
      instanceId,
      jsonPointer: `${path}/inputs`
    });
    return sizePt !== undefined
      ? { node: { id, type: 'spacer', sizePt, style, source: nodeSource }, diagnostics }
      : { diagnostics };
  }

  if (!coreTypes.has(node.type)) {
    const definition = registry.latest(node.type);
    if (!definition) return {
      diagnostics: [...diagnostics, {
        severity: 'error',
        code: 'COMPONENT_NOT_FOUND',
        message: `Nested component ${node.type} is unavailable.`,
        componentType: node.type,
        instanceId,
        jsonPointer: path
      }]
    };
    const nested: ComponentInstanceV2 = {
      component: { type: definition.type, version: definition.version },
      id,
      inputs: Object.fromEntries(Object.entries(evaluated.inputs).map(([key, value]) => [key, value as JsonValue])),
      style: node.style
    };
    const result = evaluateComponent(nested, registry, context);
    return { node: result.node, diagnostics: [...diagnostics, ...result.diagnostics] };
  }

  return { diagnostics };
}

export function evaluateComponent(
  instance: ComponentInstanceV2,
  registry: ComponentRegistry,
  parentContext: EvaluationContext
): EvaluationResult {
  const definition = registry.get(instance.component);
  const instanceId = instance.id ?? `${instance.component.type.replace(':', '-')}-preview`;
  if (!definition) return {
    diagnostics: [{
      severity: 'error',
      code: 'COMPONENT_NOT_FOUND',
      message: `Component ${instance.component.type}@${instance.component.version} is unavailable.`,
      componentType: instance.component.type,
      instanceId
    }]
  };
  const evaluated = evaluateInputs(instance.inputs, parentContext);
  const diagnostics = [...evaluated.diagnostics];
  diagnostics.push(...registry.validateInputs(instance.component, evaluated.inputs).map(item => ({ ...item, instanceId })));
  if (diagnostics.some(item => item.severity === 'error')) return { diagnostics };

  const context: EvaluationContext = {
    ...parentContext,
    inputs: Object.freeze(structuredClone(evaluated.inputs))
  };
  const expanded = expandNode(
    definition.template,
    context,
    registry,
    instanceId,
    definition.type,
    definition.defaultStyles,
    instance.style
  );
  return { node: expanded.node, diagnostics: [...diagnostics, ...expanded.diagnostics] };
}

export function rootEvaluationContext(data: Record<string, unknown>, environment: Record<string, unknown> = {}): EvaluationContext {
  return {
    data: Object.freeze(structuredClone(data)),
    inputs: Object.freeze({}),
    locals: Object.freeze({}),
    computed: Object.freeze({}),
    environment: Object.freeze(structuredClone(environment))
  };
}
