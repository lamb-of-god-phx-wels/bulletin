/**
 * @cbb/core/document/parse — fromJson / toJson for CbbDocument.
 *
 * fromJson(value, catalog):
 *   1. Validates value against the document schema via the injected catalog.
 *   2. On failure, throws DocumentValidationError with structured errors.
 *   3. On success, casts the validated plain object to CbbDocument (identity
 *      cast — the schema validation already guarantees structural correctness).
 *
 * toJson(doc):
 *   Returns a plain JSON-compatible object produced by the identity coercion.
 *   Byte-stable round-trip is guaranteed when the result is serialized with
 *   canonicalStringify because the in-memory structure exactly mirrors the
 *   persisted shape (no derived fields are added).
 *
 * Neither function performs deep cloning beyond what TypeScript readonly
 * provides; callers must not mutate returned objects.
 */

import type { SchemaCatalog, ValidationError } from "../schema/index.js";
import type { CbbDocument } from "./types.js";

// The document schema $id.
export const DOCUMENT_SCHEMA_ID =
  "https://church-bulletin-builder.local/schema/v1/document.schema.json";

// ---------------------------------------------------------------------------
// DocumentValidationError
// ---------------------------------------------------------------------------

/**
 * Thrown by fromJson() when schema validation fails.
 */
export class DocumentValidationError extends Error {
  readonly errors: readonly ValidationError[];

  constructor(errors: readonly ValidationError[]) {
    const summary = errors
      .slice(0, 3)
      .map((e) => `[${e.instancePath}] ${e.message}`)
      .join("; ");
    super(`Document schema validation failed: ${summary}`);
    this.name = "DocumentValidationError";
    this.errors = errors;
  }
}

// ---------------------------------------------------------------------------
// fromJson
// ---------------------------------------------------------------------------

/**
 * Parse and validate an unknown value as a CbbDocument.
 *
 * @param value   Any JSON-parsed value (typically from JSON.parse).
 * @param catalog A compiled SchemaCatalog that includes the document schema.
 *
 * @returns The validated CbbDocument (same reference, narrow-cast).
 * @throws  DocumentValidationError if schema validation fails.
 */
export function fromJson(
  value: unknown,
  catalog: SchemaCatalog
): CbbDocument {
  const result = catalog.validateAgainst(DOCUMENT_SCHEMA_ID, value);

  if (!result.valid) {
    throw new DocumentValidationError(result.errors);
  }

  // The schema validation guarantees the structural invariants.
  // We use an identity cast — no deep transformation needed.
  return value as CbbDocument;
}

// ---------------------------------------------------------------------------
// toJson
// ---------------------------------------------------------------------------

/**
 * Convert a CbbDocument back to a plain JSON-compatible object.
 *
 * The returned value is the document itself (readonly coercion stripped).
 * To produce a canonical byte-stable serialization, pass the result to
 * canonicalStringify() from @cbb/core/canonical.
 *
 * This is an identity operation because CbbDocument's in-memory
 * representation exactly mirrors the persisted JSON shape.
 */
export function toJson(doc: CbbDocument): Record<string, unknown> {
  // CbbDocument uses only JSON-serializable types; the readonly wrapper
  // is a compile-time guarantee — the runtime value is identical.
  return doc as unknown as Record<string, unknown>;
}
