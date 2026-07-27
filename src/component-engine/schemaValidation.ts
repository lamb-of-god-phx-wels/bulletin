function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function typeMatches(type: string, value: unknown) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return record(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

export interface SchemaIssue {
  path: string;
  message: string;
}

function localReference(root: unknown, reference: string): unknown {
  if (!reference.startsWith('#/')) return undefined;
  return reference.slice(2).split('/').reduce<unknown>((current, segment) => {
    if (!record(current)) return undefined;
    return current[segment.replaceAll('~1', '/').replaceAll('~0', '~')];
  }, root);
}

export function validateSchemaValue(schema: unknown, value: unknown, path = '/', root: unknown = schema): SchemaIssue[] {
  if (!record(schema)) return [{ path, message: 'schema must be an object' }];
  const issues: SchemaIssue[] = [];
  if (typeof schema.$ref === 'string') {
    const referenced = localReference(root, schema.$ref);
    return referenced ? validateSchemaValue(referenced, value, path, root) : [{ path, message: `uses unsupported or missing reference ${schema.$ref}` }];
  }
  if ('const' in schema && !Object.is(schema.const, value)) issues.push({ path, message: `must equal ${String(schema.const)}` });
  if (Array.isArray(schema.allOf)) for (const child of schema.allOf) issues.push(...validateSchemaValue(child, value, path, root));
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some(child => validateSchemaValue(child, value, path, root).length === 0)) issues.push({ path, message: 'must match at least one allowed schema' });
  if (Array.isArray(schema.oneOf) && schema.oneOf.filter(child => validateSchemaValue(child, value, path, root).length === 0).length !== 1) issues.push({ path, message: 'must match exactly one allowed schema' });
  if (schema.not && validateSchemaValue(schema.not, value, path, root).length === 0) issues.push({ path, message: 'matches a disallowed schema' });
  const allowedTypes = typeof schema.type === 'string'
    ? [schema.type]
    : Array.isArray(schema.type) ? schema.type.filter((item): item is string => typeof item === 'string') : [];
  if (allowedTypes.length && !allowedTypes.some(type => typeMatches(type, value))) {
    return [{ path, message: `must be ${allowedTypes.join(' or ')}` }];
  }
  if (Array.isArray(schema.enum) && !schema.enum.some(item => Object.is(item, value))) {
    issues.push({ path, message: `must be one of ${schema.enum.map(String).join(', ')}` });
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) issues.push({ path, message: `must be at least ${schema.minimum}` });
    if (typeof schema.maximum === 'number' && value > schema.maximum) issues.push({ path, message: `must be at most ${schema.maximum}` });
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) issues.push({ path, message: `must contain at least ${schema.minLength} characters` });
    if (typeof schema.pattern === 'string') {
      try { if (!new RegExp(schema.pattern).test(value)) issues.push({ path, message: `must match ${schema.pattern}` }); }
      catch { issues.push({ path, message: 'uses an invalid pattern in its schema' }); }
    }
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) issues.push({ path, message: `must contain at least ${schema.minItems} items` });
    if (schema.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length) issues.push({ path, message: 'must contain unique items' });
    if (schema.items) value.forEach((item, index) => issues.push(...validateSchemaValue(schema.items, item, `${path === '/' ? '' : path}/${index}`, root)));
  }
  if (record(value)) {
    const properties = record(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === 'string') : [];
    for (const key of required) if (!(key in value)) issues.push({ path: `${path === '/' ? '' : path}/${key}`, message: 'is required' });
    for (const [key, item] of Object.entries(value)) {
      if (key in properties) issues.push(...validateSchemaValue(properties[key], item, `${path === '/' ? '' : path}/${key}`, root));
      else if (schema.additionalProperties === false) issues.push({ path: `${path === '/' ? '' : path}/${key}`, message: 'is not allowed' });
      else if (record(schema.additionalProperties)) issues.push(...validateSchemaValue(schema.additionalProperties, item, `${path === '/' ? '' : path}/${key}`, root));
    }
  }
  return issues;
}

export function schemaDefinitionIssues(schema: unknown, path = '/inputSchema'): SchemaIssue[] {
  if (!record(schema)) return [{ path, message: 'must be an object' }];
  const issues: SchemaIssue[] = [];
  if (schema.type !== undefined && typeof schema.type !== 'string' && !Array.isArray(schema.type)) {
    issues.push({ path: `${path}/type`, message: 'must be a string or array of strings' });
  }
  if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some(item => typeof item !== 'string'))) {
    issues.push({ path: `${path}/required`, message: 'must be an array of property names' });
  }
  if (schema.properties !== undefined && !record(schema.properties)) {
    issues.push({ path: `${path}/properties`, message: 'must be an object' });
  } else if (record(schema.properties)) {
    for (const [key, child] of Object.entries(schema.properties)) issues.push(...schemaDefinitionIssues(child, `${path}/properties/${key}`));
  }
  if (schema.items !== undefined) issues.push(...schemaDefinitionIssues(schema.items, `${path}/items`));
  for (const keyword of ['allOf', 'anyOf', 'oneOf'] as const) {
    if (schema[keyword] !== undefined) {
      if (!Array.isArray(schema[keyword])) issues.push({ path: `${path}/${keyword}`, message: 'must be an array of schemas' });
      else schema[keyword].forEach((child, index) => issues.push(...schemaDefinitionIssues(child, `${path}/${keyword}/${index}`)));
    }
  }
  if (schema.not !== undefined) issues.push(...schemaDefinitionIssues(schema.not, `${path}/not`));
  if (schema.$defs !== undefined) {
    if (!record(schema.$defs)) issues.push({ path: `${path}/$defs`, message: 'must be an object' });
    else for (const [key, child] of Object.entries(schema.$defs)) issues.push(...schemaDefinitionIssues(child, `${path}/$defs/${key}`));
  }
  return issues;
}
