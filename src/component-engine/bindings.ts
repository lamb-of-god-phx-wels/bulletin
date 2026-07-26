import type {
  BoundValue,
  ComponentDiagnostic,
  EvaluationContext,
  ExpressionBinding,
  JsonValue,
  PathBinding
} from './types.js';

const safeSegment = /^[A-Za-z_][A-Za-z0-9_]*$/;
const forbiddenSegments = new Set(['__proto__', 'prototype', 'constructor']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isPathBinding(value: unknown): value is PathBinding {
  return isRecord(value) && typeof value.$bind === 'string';
}

export function isExpressionBinding(value: unknown): value is ExpressionBinding {
  return isRecord(value) && isRecord(value.$expr) && typeof value.$expr.op === 'string' && Array.isArray(value.$expr.args);
}

function diagnostic(binding: string, message: string): ComponentDiagnostic {
  return { severity: 'error', code: 'BINDING_INVALID', message, binding };
}

function pathValue(path: string, context: EvaluationContext): { value?: unknown; diagnostic?: ComponentDiagnostic } {
  const segments = path.split('.');
  const namespace = segments.shift();
  if (!namespace || !['data', 'inputs', 'locals', 'computed', 'environment'].includes(namespace)) {
    return { diagnostic: diagnostic(path, 'Bindings must begin with data, inputs, locals, computed, or environment.') };
  }
  if (segments.some(segment => !safeSegment.test(segment) || forbiddenSegments.has(segment))) {
    return { diagnostic: diagnostic(path, 'Binding paths may contain only safe named properties.') };
  }
  let current: unknown = context[namespace as keyof EvaluationContext];
  for (const segment of segments) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) return {};
    current = current[segment];
  }
  return { value: current };
}

function isEmpty(value: unknown) {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

export function evaluateBoundValue(value: BoundValue, context: EvaluationContext): {
  value?: unknown;
  diagnostics: ComponentDiagnostic[];
} {
  if (isPathBinding(value)) {
    const resolved = pathValue(value.$bind, context);
    if (resolved.diagnostic) return { diagnostics: [resolved.diagnostic] };
    if (resolved.value === undefined) {
      if (value.default !== undefined) return { value: value.default, diagnostics: [] };
      if (value.required) return {
        diagnostics: [{
          severity: 'error',
          code: 'BINDING_REQUIRED',
          message: `Required binding “${value.$bind}” did not resolve to a value.`,
          binding: value.$bind
        }]
      };
    }
    return { value: resolved.value, diagnostics: [] };
  }

  if (isExpressionBinding(value)) {
    const evaluated = value.$expr.args.map(argument => evaluateBoundValue(argument, context));
    const diagnostics = evaluated.flatMap(result => result.diagnostics);
    if (diagnostics.some(item => item.severity === 'error')) return { diagnostics };
    const args = evaluated.map(result => result.value);
    switch (value.$expr.op) {
      case 'notEmpty': return { value: !isEmpty(args[0]), diagnostics };
      case 'equals': return { value: args[0] === args[1], diagnostics };
      case 'and': return { value: args.every(Boolean), diagnostics };
      case 'or': return { value: args.some(Boolean), diagnostics };
      case 'not': return { value: !args[0], diagnostics };
      default: return {
        diagnostics: [{
          severity: 'error',
          code: 'EXPRESSION_UNSUPPORTED',
          message: `Expression operator “${String(value.$expr.op)}” is not supported.`
        }]
      };
    }
  }

  return { value: value as JsonValue, diagnostics: [] };
}
