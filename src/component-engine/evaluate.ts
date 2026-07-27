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
import { validateCanvasScene } from '../shared/canvas.js';
import type { CanvasScene } from '../shared/types.js';

const coreTypes = new Set(['core:stack', 'core:row', 'core:repeat', 'core:text', 'core:structuredText', 'core:spacer', 'core:image', 'core:canvas']);

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

  if (node.type === 'core:stack' || node.type === 'core:row') {
    const children: LayoutNode[] = [];
    for (const [index, child] of (node.children ?? []).entries()) {
      const result = expandNode(child, context, registry, instanceId, ownerType, definitionStyles, instanceStyles, `${path}/children/${index}`);
      diagnostics.push(...result.diagnostics);
      if (result.node) children.push(result.node);
    }
    const containerStyle = node.type === 'core:row' && typeof evaluated.inputs.gapIn === 'number' && evaluated.inputs.gapIn >= 0
      ? mergeStyle(style, { gapIn: evaluated.inputs.gapIn })
      : style;
    return { node: { id, type: node.type === 'core:row' ? 'row' : 'stack', children, style: containerStyle, source: nodeSource }, diagnostics };
  }

  if (node.type === 'core:repeat') {
    const items = evaluated.inputs.items;
    const alias = typeof node.metadata?.as === 'string' ? node.metadata.as : 'item';
    const keyField = typeof node.metadata?.key === 'string' ? node.metadata.key : undefined;
    if (!Array.isArray(items)) return {
      diagnostics: [...diagnostics, {
        severity: 'error',
        code: 'REPEAT_ITEMS_INVALID',
        message: 'core:repeat requires an array input named items.',
        componentType: ownerType,
        instanceId,
        jsonPointer: `${path}/inputs/items`
      }]
    };
    const children: LayoutNode[] = [];
    for (const [index, item] of items.entries()) {
      const stableKey = keyField && item && typeof item === 'object' && keyField in item
        ? String((item as Record<string, unknown>)[keyField])
        : String(index);
      const itemContext: EvaluationContext = {
        ...context,
        locals: Object.freeze({ ...context.locals, [alias]: structuredClone(item) })
      };
      for (const [childIndex, child] of (node.children ?? []).entries()) {
        const result = expandNode(child, itemContext, registry, instanceId, ownerType, definitionStyles, instanceStyles, `${path}/items/${stableKey}/${childIndex}`);
        diagnostics.push(...result.diagnostics);
        if (result.node) children.push(result.node);
      }
    }
    return { node: { id, type: 'stack', children, style, source: nodeSource }, diagnostics };
  }

  if (node.type === 'core:text') {
    const value = evaluated.inputs.text;
    if (typeof value !== 'string' && typeof value !== 'number') diagnostics.push({
      severity: 'error',
      code: 'LAYOUT_TEXT_INVALID',
      message: 'core:text requires a string input named text.',
      componentType: ownerType,
      instanceId,
      jsonPointer: `${path}/inputs/text`
    });
    return typeof value === 'string' || typeof value === 'number'
      ? { node: { id, type: 'text', text: String(value), style, source: nodeSource }, diagnostics }
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

  if (node.type === 'core:image') {
    const value = evaluated.inputs.source;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {
      diagnostics: [...diagnostics, {
        severity: 'error',
        code: 'LAYOUT_IMAGE_INVALID',
        message: 'core:image requires an image source object.',
        componentType: ownerType,
        instanceId,
        jsonPointer: `${path}/inputs/source`
      }]
    };
    const image = value as Record<string, unknown>;
    return {
      node: {
        id,
        type: 'image',
        source: nodeSource,
        image: {
          ...(typeof image.assetId === 'string' ? { assetId: image.assetId } : {}),
          ...(typeof image.path === 'string' ? { path: image.path } : {}),
          ...(typeof image.mediaType === 'string' ? { mediaType: image.mediaType } : {}),
          ...(typeof evaluated.inputs.altText === 'string' ? { altText: evaluated.inputs.altText } : {})
        },
        fit: ['contain', 'cover', 'fill', 'scale-down'].includes(String(evaluated.inputs.fit))
          ? evaluated.inputs.fit as 'contain' | 'cover' | 'fill' | 'scale-down'
          : undefined,
        style
      },
      diagnostics
    };
  }

  if (node.type === 'core:canvas') {
    const value = evaluated.inputs.scene;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {
      diagnostics: [...diagnostics, {
        severity: 'error',
        code: 'LAYOUT_CANVAS_INVALID',
        message: 'core:canvas requires a scene object.',
        componentType: ownerType,
        instanceId,
        jsonPointer: `${path}/inputs/scene`
      }]
    };
    const scene = value as unknown as CanvasScene;
    diagnostics.push(...validateCanvasScene(scene, .4, `${path}/inputs/scene`).map(issue => ({
      severity: issue.severity,
      code: issue.severity === 'error' ? 'LAYOUT_CANVAS_INVALID' : 'LAYOUT_CANVAS_BOUNDS',
      message: issue.message,
      componentType: ownerType,
      instanceId,
      jsonPointer: issue.path
    } satisfies ComponentDiagnostic)));
    return diagnostics.some(item => item.severity === 'error')
      ? { diagnostics }
      : { node: { id, type: 'canvas', scene, style, source: nodeSource }, diagnostics };
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
