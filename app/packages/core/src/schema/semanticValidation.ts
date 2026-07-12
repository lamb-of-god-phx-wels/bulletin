/**
 * Semantic validation registry for @cbb/core.
 *
 * Semantic validators enforce cross-record and cross-tree rules that JSON
 * Schema alone cannot express (e.g. document-global element id uniqueness,
 * valid bindings, asset-reference resolution). They run after structural
 * (Ajv) validation and return Diagnostic-like findings.
 *
 * Multiple semantic validators can be registered per schemaId; they all
 * run and their findings are merged. Validators are pure functions.
 */

import type {
  SemanticDiagnostic,
  SemanticValidationResult,
} from "./types.js";

// Re-export for convenience.
export type { SemanticDiagnostic, SemanticValidationResult };

// ---------------------------------------------------------------------------
// Validator function type
// ---------------------------------------------------------------------------

/**
 * A named semantic validator for one schema.
 *
 * @param value  The value that passed structural validation.
 * @returns      Array of findings (empty = no issues). Must not throw.
 */
export type SemanticValidatorFn = (
  value: unknown
) => readonly SemanticDiagnostic[];

/** Registration entry for one semantic validator. */
export interface SemanticValidatorEntry {
  /** Human-readable name for debugging / logging. */
  readonly name: string;
  readonly validate: SemanticValidatorFn;
}

// ---------------------------------------------------------------------------
// SemanticValidationRegistry
// ---------------------------------------------------------------------------

/** Opaque registry. Use createSemanticValidationRegistry() to construct. */
export interface SemanticValidationRegistry {
  /**
   * Register a named semantic validator for the given schemaId.
   * Multiple validators per schemaId are allowed and all will run.
   *
   * @throws if a validator with the same (schemaId, name) is already
   *         registered (prevents accidental double-registration).
   */
  register(schemaId: string, entry: SemanticValidatorEntry): void;

  /**
   * Run all semantic validators registered for schemaId against value.
   *
   * Findings from all validators are merged and returned.  If any finding
   * has severity "error" the result is invalid, otherwise valid.
   *
   * If no validators are registered for schemaId, returns valid with no
   * findings.
   *
   * This method never throws; validator exceptions are caught and converted
   * to an error-severity finding with code "CBB-SEMANTIC-INTERNAL".
   *
   * @param schemaId  The schema $id to run validators for.
   * @param value     The value to validate.
   */
  runValidators(
    schemaId: string,
    value: unknown
  ): SemanticValidationResult;

  /**
   * List all validator names registered for a schemaId.
   */
  validatorNamesFor(schemaId: string): readonly string[];

  /**
   * List all schemaIds with at least one registered validator.
   */
  registeredSchemaIds(): readonly string[];
}

function registryKey(schemaId: string, name: string): string {
  return `${schemaId}::${name}`;
}

/**
 * Create a new, empty semantic validation registry.
 */
export function createSemanticValidationRegistry(): SemanticValidationRegistry {
  // Map from registryKey -> entry
  const validators = new Map<string, SemanticValidatorEntry>();
  // Map from schemaId -> ordered list of validator names (insertion order)
  const schemaIndex = new Map<string, string[]>();

  return {
    register(schemaId: string, entry: SemanticValidatorEntry): void {
      const key = registryKey(schemaId, entry.name);
      if (validators.has(key)) {
        throw new Error(
          `A semantic validator named "${entry.name}" is already registered ` +
            `for schema "${schemaId}". Duplicate registrations are not allowed.`
        );
      }

      validators.set(key, entry);

      const names = schemaIndex.get(schemaId);
      if (names !== undefined) {
        names.push(entry.name);
      } else {
        schemaIndex.set(schemaId, [entry.name]);
      }
    },

    runValidators(
      schemaId: string,
      value: unknown
    ): SemanticValidationResult {
      const names = schemaIndex.get(schemaId);
      if (!names || names.length === 0) {
        return { valid: true, findings: [] };
      }

      const allFindings: SemanticDiagnostic[] = [];

      for (const name of names) {
        const entry = validators.get(registryKey(schemaId, name));
        if (entry === undefined) {
          // Internal invariant violation — should never happen.
          allFindings.push({
            code: "CBB-SCHEMA-0002",
            severity: "error",
            message: `Internal registry error: validator "${name}" missing for schema "${schemaId}"`,
          });
          continue;
        }

        try {
          const findings = entry.validate(value);
          allFindings.push(...findings);
        } catch (err) {
          const message =
            err instanceof Error ? err.message : String(err);
          allFindings.push({
            code: "CBB-SCHEMA-0002",
            severity: "error",
            message: `Semantic validator "${name}" threw an unexpected error: ${message}`,
          });
        }
      }

      const hasError = allFindings.some((f) => f.severity === "error");

      return {
        valid: !hasError,
        findings: allFindings,
      };
    },

    validatorNamesFor(schemaId: string): readonly string[] {
      return schemaIndex.get(schemaId) ?? [];
    },

    registeredSchemaIds(): readonly string[] {
      return Array.from(schemaIndex.keys()).sort();
    },
  };
}
