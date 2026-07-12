/**
 * RFC 8785 (JCS — JSON Canonicalization Scheme) implementation.
 *
 * Produces a deterministic UTF-8 byte sequence for a JSON-compatible value
 * by sorting object members lexicographically by their UTF-16 code unit
 * sequence (as required by §3.2.3 of the RFC), and using the ECMAScript
 * Number-to-string algorithm for numeric values (which JSON.stringify already
 * provides for finite numbers).
 *
 * Restrictions matching the RFC:
 *   - Non-finite numbers (Infinity, -Infinity, NaN) → throw
 *   - undefined → throw (undefined is not a JSON value)
 *   - BigInt → throw (not representable in JSON)
 *   - -0 is serialized as "0" (per ECMAScript spec; JSON.stringify does this)
 *
 * @module
 */

/** The set of JSON-serializable primitive types. */
type JsonPrimitive = string | number | boolean | null;

/** A JSON-serializable value (no undefined, BigInt, or Function). */
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

const encoder = new TextEncoder();

/**
 * Escape a string according to RFC 8785 §3.2.2.2, which follows the same
 * rules as JSON string encoding:
 *   - U+0022 ("), U+005C (\) → escaped
 *   - U+0000–U+001F (C0 controls) → \uXXXX
 *   - All other code points → literal UTF-8 (no escaping)
 *
 * JSON.stringify already does exactly this. The result includes the surrounding
 * double-quote delimiters, which is the correct JSON serialization for a string.
 */
function escapeString(value: string): string {
  // JSON.stringify produces `"<escaped>"` including the surrounding quotes.
  // This relies on JSON.stringify being spec-compliant, which all conformant
  // JS engines guarantee.
  const serialized = JSON.stringify(value);
  // serialized is always a string starting and ending with `"` for string input
  return serialized;
}

/**
 * Serialize a number according to RFC 8785 §3.2.2.3.
 *
 * The RFC mandates the ECMAScript Number-to-string algorithm (ES2020 §7.1.12.1).
 * JSON.stringify produces exactly that for finite numbers, including:
 *   - -0  → "0"
 *   - 1e30 → "1e+30"
 *   - 1e-7 → "1e-7"
 *   - 0.000001 → "0.000001"
 *   - Large integers like 10000000000000000000 → "10000000000000000000"
 *
 * Non-finite values (NaN, Infinity) are not valid JSON and must be rejected.
 */
function serializeNumber(value: number): string {
  if (!isFinite(value)) {
    throw new TypeError(
      `canonicalStringify: non-finite number is not valid JSON: ${String(value)}`,
    );
  }
  // JSON.stringify(number) applies the ES Number-to-string algorithm for
  // finite values and returns `"null"` only for non-finite, which we already
  // rejected above. The result is always a plain numeric string with no quotes.
  // We assert the return is a string (non-null) because we validated finiteness.
  const result = JSON.stringify(value);
  // result is guaranteed non-null for a finite number
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return result!;
}

/**
 * Compare two strings by their UTF-16 code unit sequences, as required by
 * RFC 8785 §3.2.3. This is equivalent to JavaScript's default string
 * comparison (< / >), which operates on UTF-16 code units.
 */
function compareUtf16(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Recursively build the canonical JSON string for a value.
 *
 * @throws {TypeError} if the value contains non-finite numbers, undefined,
 *   BigInt, or functions.
 */
function serializeValue(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (value === undefined) {
    throw new TypeError(
      "canonicalStringify: undefined is not a valid JSON value",
    );
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    return serializeNumber(value);
  }

  if (typeof value === "string") {
    return escapeString(value);
  }

  if (typeof value === "bigint") {
    throw new TypeError(
      "canonicalStringify: BigInt is not a valid JSON value",
    );
  }

  if (typeof value === "function" || typeof value === "symbol") {
    throw new TypeError(
      `canonicalStringify: ${typeof value} is not a valid JSON value`,
    );
  }

  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      parts.push(serializeValue(item));
    }
    return "[" + parts.join(",") + "]";
  }

  if (typeof value === "object") {
    // Only plain objects (prototype is Object.prototype or null) are valid
    // JSON-compatible objects. Non-plain objects such as Date, Map, Set,
    // RegExp, or class instances would serialize silently as '{}' (since
    // Object.keys ignores their internal state), producing a plausible but
    // wrong hash. Reject them so upstream bugs surface immediately.
    const proto = Object.getPrototypeOf(value) as unknown;
    if (proto !== Object.prototype && proto !== null) {
      // Honor toJSON() if present (e.g. Date.prototype.toJSON) before rejecting,
      // since JSON.stringify itself honors it.
      const toJSON = (value as { toJSON?: unknown })["toJSON"];
      if (typeof toJSON === "function") {
        // Call toJSON() and recurse on its result.
        const coerced: unknown = (toJSON as () => unknown).call(value);
        return serializeValue(coerced);
      }
      throw new TypeError(
        `canonicalStringify: non-plain object is not a valid JSON-serializable ` +
        `value. Got ${String(value)} (constructor: ${
          (value as object).constructor?.name ?? "unknown"
        }). Only plain objects (Object.prototype or null prototype), arrays, ` +
        `and JSON primitives are accepted.`,
      );
    }
    // Sort keys by UTF-16 code unit order (RFC 8785 §3.2.3).
    const keys = Object.keys(value as Record<string, unknown>).sort(
      compareUtf16,
    );
    const parts: string[] = [];
    for (const key of keys) {
      const v = (value as Record<string, unknown>)[key];
      // Per JSON spec, keys whose value is undefined are omitted.
      // We follow JSON.stringify behaviour: skip undefined-valued keys.
      if (v === undefined) continue;
      parts.push(escapeString(key) + ":" + serializeValue(v));
    }
    return "{" + parts.join(",") + "}";
  }

  // Should never reach here under TypeScript strict mode, but keep as a guard.
  throw new TypeError(
    `canonicalStringify: unexpected value type: ${typeof value}`,
  );
}

/**
 * Produce the RFC 8785 canonical JSON string for any JSON-compatible value.
 *
 * Object keys are sorted lexicographically by UTF-16 code unit sequence.
 * Numbers use the ECMAScript Number-to-string algorithm. String characters
 * are escaped per JSON rules (control chars → \uXXXX, ", \ → escaped).
 *
 * @throws {TypeError} for non-finite numbers, undefined, BigInt, or functions.
 */
export function canonicalStringify(value: unknown): string {
  return serializeValue(value);
}

/**
 * Produce the RFC 8785 canonical JSON as a UTF-8 Uint8Array.
 * This is the byte sequence that should be fed to SHA-256 for hashing.
 */
export function canonicalJsonBytes(value: unknown): Uint8Array {
  return encoder.encode(canonicalStringify(value));
}
