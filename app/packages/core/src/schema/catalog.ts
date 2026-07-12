/**
 * Schema catalog loader for @cbb/core.
 *
 * Accepts a map of $id -> schema JSON (injected, not read from disk),
 * compiles them with Ajv draft 2020-12, resolves all $refs within the
 * catalog, and throws loudly on any unresolved external ref.
 *
 * No network access; fully offline.
 *
 * Import notes: Ajv and ajv-formats ship CommonJS only. With esModuleInterop
 * disabled (our base tsconfig) we use namespace imports for CJS modules
 * and reach through the module namespace for the default export.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
import * as AjvModule from "ajv/dist/2020.js";
// eslint-disable-next-line @typescript-eslint/no-require-imports
import * as AddFormatsModule from "ajv-formats";
import type { ValidateFunction, AnySchemaObject, ErrorObject } from "ajv";
import type {
  SchemaObject,
  ValidationResult,
  ValidationError,
} from "./types.js";

// CJS default export is exposed as `.default` when the module sets
// __esModule = true, which both ajv and ajv-formats do.
// We check at module load time so type errors surface immediately.
const Ajv2020Ctor = (
  AjvModule as unknown as { default: new (opts: AjvOptions) => AjvInstance }
).default;

const addFormats = (
  AddFormatsModule as unknown as { default: (ajv: AjvInstance) => void }
).default;

// Minimal type aliases so we can type the Ajv instance without pulling in
// all of Ajv's internal types (which cause exactOptionalPropertyTypes issues
// with our base tsconfig).
type AjvOptions = {
  allErrors?: boolean;
  strict?: boolean;
  strictSchema?: boolean;
  strictTypes?: boolean;
  strictRequired?: boolean;
  validateFormats?: boolean;
};

type AjvInstance = {
  addSchema(schema: AnySchemaObject, id?: string): AjvInstance;
  compile(schema: AnySchemaObject): ValidateFunction;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Convert Ajv's ErrorObject array into our stable ValidationError array.
 * Sorted by instancePath then schemaPath for deterministic ordering.
 */
function normalizeErrors(
  ajvErrors: readonly ErrorObject[] | null | undefined
): readonly ValidationError[] {
  if (!ajvErrors || ajvErrors.length === 0) return [];

  const mapped: ValidationError[] = ajvErrors.map((e) => ({
    instancePath: e.instancePath,
    keyword: e.keyword,
    message: e.message ?? `${e.keyword} validation failed`,
    schemaPath: e.schemaPath,
  }));

  // Stable sort: primary by instancePath, secondary by schemaPath.
  // Uses code-unit comparison (not localeCompare) to be locale-independent
  // and deterministic across all machines/ICU configurations.
  mapped.sort((a, b) => {
    if (a.instancePath < b.instancePath) return -1;
    if (a.instancePath > b.instancePath) return 1;
    if (a.schemaPath < b.schemaPath) return -1;
    if (a.schemaPath > b.schemaPath) return 1;
    return 0;
  });

  return mapped;
}

// ---------------------------------------------------------------------------
// SchemaCatalog
// ---------------------------------------------------------------------------

/** Opaque compiled catalog. Use createSchemaCatalog() to construct. */
export interface SchemaCatalog {
  /**
   * Validate a value against the named schema.
   * Returns a structured result — never throws.
   *
   * @param schemaId  The full $id URI of the schema to validate against.
   * @param value     The value to validate (any JSON-compatible value).
   */
  validateAgainst(schemaId: string, value: unknown): ValidationResult;

  /**
   * Returns the list of $id strings registered in this catalog.
   */
  schemaIds(): readonly string[];
}

/**
 * Create and compile a schema catalog from an injected map.
 *
 * @param schemas  Map of $id -> schema object. Every schema must have a
 *                 top-level `$id` field. $refs must resolve within this map.
 *
 * @throws {Error}  If any schema's `$id` does not match its map key, any
 *                  $ref cannot be resolved within the catalog, or Ajv
 *                  compilation fails for any other reason.
 */
export function createSchemaCatalog(
  schemas: ReadonlyMap<string, SchemaObject>
): SchemaCatalog {
  // We use allErrors:true so validation collects all failures, not just first.
  const ajv = new Ajv2020Ctor({
    allErrors: true,
    strict: true,
    strictSchema: true,
    strictTypes: true,
    strictRequired: true,
    // Allow unknown formats — we add the standard set via ajv-formats but
    // app schemas may use additional format annotations for documentation.
    validateFormats: false,
  });
  addFormats(ajv);

  // First pass: add all schemas so $refs can cross-reference within the
  // catalog before any compile call.
  for (const [id, schema] of schemas) {
    if (schema.$id !== id) {
      throw new Error(
        `Schema catalog key "${id}" does not match schema $id "${schema.$id}"`
      );
    }
    ajv.addSchema(schema as AnySchemaObject);
  }

  // Second pass: compile each schema to produce validate functions, and to
  // surface $ref resolution errors eagerly (Ajv throws on unknown $refs).
  const validators = new Map<string, ValidateFunction>();
  for (const [id, schema] of schemas) {
    try {
      const validate = ajv.compile(schema as AnySchemaObject);
      validators.set(id, validate);
    } catch (err) {
      // Wrap with context so callers know which schema failed.
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to compile schema "${id}": ${message}`);
    }
  }

  return {
    validateAgainst(schemaId: string, value: unknown): ValidationResult {
      const validate = validators.get(schemaId);
      if (!validate) {
        return {
          valid: false,
          errors: [
            {
              instancePath: "",
              keyword: "schema",
              message: `No schema registered for id "${schemaId}"`,
              schemaPath: "",
            },
          ],
        };
      }

      const valid = validate(value) as boolean;
      if (valid) {
        return { valid: true };
      }

      return {
        valid: false,
        errors: normalizeErrors(validate.errors),
      };
    },

    schemaIds(): readonly string[] {
      return Array.from(schemas.keys()).sort();
    },
  };
}
