import type { Sha256Hash } from "../canonical/index.js";
import type { HashJsonObject, HashJsonValue } from "./types.js";

const SHA256_RE = /^sha256:[0-9a-f]{64}$/;

export class HashInputError extends TypeError {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`Invalid hash input at ${path}: ${message}`);
    this.name = "HashInputError";
    this.path = path;
  }
}

export function compareUtf16(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function assertNonemptyString(
  value: unknown,
  path: string,
): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new HashInputError(path, "expected a nonempty string");
  }
}

export function assertSha256(
  value: unknown,
  path: string,
): asserts value is Sha256Hash {
  if (typeof value !== "string" || !SHA256_RE.test(value)) {
    throw new HashInputError(
      path,
      'expected "sha256:" followed by 64 lowercase hexadecimal characters',
    );
  }
}

export function assertPlainObject(
  value: unknown,
  path: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new HashInputError(path, "expected a plain object");
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new HashInputError(path, "expected a plain object prototype");
  }
}

export function assertExactKeys(
  value: Record<string, unknown>,
  path: string,
  allowed: readonly string[],
  required: readonly string[],
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      throw new HashInputError(`${path}.${key}`, "unknown field in closed input");
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      throw new HashInputError(`${path}.${key}`, "required field is missing");
    }
  }
}

function assertArrayShape(value: readonly unknown[], path: string): void {
  const ownKeys = Reflect.ownKeys(value);
  for (const key of ownKeys) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key)) {
      throw new HashInputError(path, "arrays may not have custom properties");
    }
  }
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index)) {
      throw new HashInputError(`${path}[${index}]`, "sparse arrays are not valid JSON");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new HashInputError(`${path}[${index}]`, "accessor properties are not allowed");
    }
  }
}

/**
 * Strict JSON validation used before every hash. Unlike JSON.stringify and the
 * base JCS helper, this rejects undefined object members rather than silently
 * omitting them. It also rejects cycles, accessors, hidden fields, and custom
 * object prototypes.
 */
export function assertHashJson(
  value: unknown,
  path = "$",
  ancestors: Set<object> = new Set<object>(),
): asserts value is HashJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new HashInputError(path, "non-finite numbers are not valid JSON");
    }
    return;
  }
  if (value === undefined) {
    throw new HashInputError(path, "undefined is not valid JSON");
  }
  if (typeof value !== "object") {
    throw new HashInputError(path, `${typeof value} is not valid JSON`);
  }
  if (ancestors.has(value)) {
    throw new HashInputError(path, "cyclic object graph is not valid JSON");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      assertArrayShape(value, path);
      for (let index = 0; index < value.length; index++) {
        assertHashJson(value[index], `${path}[${index}]`, ancestors);
      }
      return;
    }

    assertPlainObject(value, path);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") {
        throw new HashInputError(path, "symbol-keyed properties are not valid JSON");
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable) {
        throw new HashInputError(`${path}.${key}`, "hidden properties are not valid JSON");
      }
      if (!("value" in descriptor)) {
        throw new HashInputError(`${path}.${key}`, "accessor properties are not allowed");
      }
      assertHashJson(descriptor.value, `${path}.${key}`, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}

export function cloneHashJson(value: unknown, path = "$", validate = true): HashJsonValue {
  if (validate) assertHashJson(value, path);
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      cloneHashJson(entry, `${path}[${index}]`, false),
    );
  }
  const result: Record<string, HashJsonValue> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    result[key] = cloneHashJson(
      (value as Record<string, unknown>)[key],
      `${path}.${key}`,
      false,
    );
  }
  return result;
}

export function asHashJsonObject(value: unknown, path: string): HashJsonObject {
  assertHashJson(value, path);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new HashInputError(path, "expected a JSON object");
  }
  return cloneHashJson(value, path, false) as HashJsonObject;
}

export function assertNamedHashes(value: unknown, path = "$readiness"): void {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      assertNamedHashes(value[index], `${path}[${index}]`);
    }
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (/(?:Hash|Digest|Token)$/.test(key)) {
      assertSha256(entry, `${path}.${key}`);
    }
    assertNamedHashes(entry, `${path}.${key}`);
  }
}

export function escapeJsonPointerSegment(value: string): string {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}
