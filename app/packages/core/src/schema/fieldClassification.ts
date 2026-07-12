/**
 * Field classification catalog for @cbb/core.
 *
 * Each persisted field path in a schema is classified as one of:
 *   - renderAffecting  — change forces Typst re-generation (PDF bytes change)
 *   - readinessOnly    — change affects publication readiness, not PDF bytes
 *   - inert            — change affects neither rendering nor readiness
 *
 * The catalog structure defined here holds the type system and registry.
 * Actual per-field data for each document schema arrives with the document
 * model (a later milestone).
 *
 * The exhaustiveness-check helper reports unclassified top-level property
 * names given a JSON Schema's `properties` map, enabling CI-time coverage
 * assertions.
 */

import type {
  FieldClassification,
  FieldClassificationEntry,
  ClassificationExhaustivenessReport,
} from "./types.js";

// Re-export FieldClassification so callers can import it from this module.
export type { FieldClassification, FieldClassificationEntry };

// ---------------------------------------------------------------------------
// FieldClassificationCatalog
// ---------------------------------------------------------------------------

/** Opaque registry. Use createFieldClassificationCatalog() to construct. */
export interface FieldClassificationCatalog {
  /**
   * Register one or more classification entries for a schema.
   * Duplicate path registrations for the same schemaId are rejected.
   *
   * @throws if an entry with the same (schemaId, path) is already registered.
   */
  register(schemaId: string, entries: readonly FieldClassificationEntry[]): void;

  /**
   * Retrieve all entries registered for a schemaId.
   * Returns an empty array if the schemaId has no registrations.
   */
  entriesFor(schemaId: string): readonly FieldClassificationEntry[];

  /**
   * Retrieve the classification for a specific (schemaId, path) pair.
   * Returns undefined if no entry is registered for that combination.
   */
  classificationFor(
    schemaId: string,
    path: string
  ): FieldClassification | undefined;

  /**
   * Check exhaustiveness of field classifications against a set of property
   * names declared in a schema.
   *
   * The check is shallow: it only examines the top-level property names you
   * pass in. Deep/nested path exhaustiveness is performed by higher-level
   * tooling that walks the schema tree.
   *
   * @param schemaId        The schema $id to check.
   * @param propertyNames   Top-level property names from the schema's
   *                        `properties` object (use Object.keys()).
   *
   * @returns A report listing which property names are classified and which
   *          are not yet covered by any registered entry.
   */
  checkExhaustiveness(
    schemaId: string,
    propertyNames: readonly string[]
  ): ClassificationExhaustivenessReport;

  /**
   * List all schemaIds that have at least one registered classification.
   */
  registeredSchemaIds(): readonly string[];
}

// Internal storage key: `${schemaId}::${path}`
function entryKey(schemaId: string, path: string): string {
  return `${schemaId}::${path}`;
}

/**
 * Create a new, empty field classification catalog.
 */
export function createFieldClassificationCatalog(): FieldClassificationCatalog {
  // Map from entryKey -> FieldClassificationEntry
  const entries = new Map<string, FieldClassificationEntry>();
  // Map from schemaId -> ordered list of paths (insertion order)
  const schemaIndex = new Map<string, string[]>();

  return {
    register(
      schemaId: string,
      newEntries: readonly FieldClassificationEntry[]
    ): void {
      // Phase 1: validate the entire batch — no mutations yet.
      for (const entry of newEntries) {
        const key = entryKey(schemaId, entry.path);
        if (entries.has(key)) {
          throw new Error(
            `Field classification for path "${entry.path}" in schema ` +
              `"${schemaId}" is already registered. ` +
              `Duplicate registrations are not allowed.`
          );
        }
      }
      // Also check for intra-batch duplicates.
      const batchKeys = new Set<string>();
      for (const entry of newEntries) {
        const key = entryKey(schemaId, entry.path);
        if (batchKeys.has(key)) {
          throw new Error(
            `Field classification for path "${entry.path}" in schema ` +
              `"${schemaId}" appears more than once in the same batch. ` +
              `Duplicate registrations are not allowed.`
          );
        }
        batchKeys.add(key);
      }
      // Phase 2: apply all mutations atomically.
      for (const entry of newEntries) {
        const key = entryKey(schemaId, entry.path);
        entries.set(key, entry);

        const paths = schemaIndex.get(schemaId);
        if (paths !== undefined) {
          paths.push(entry.path);
        } else {
          schemaIndex.set(schemaId, [entry.path]);
        }
      }
    },

    entriesFor(schemaId: string): readonly FieldClassificationEntry[] {
      const paths = schemaIndex.get(schemaId);
      if (!paths || paths.length === 0) return [];

      return paths.map((path) => {
        // Key is guaranteed to exist because we always write both maps together.
        const entry = entries.get(entryKey(schemaId, path));
        // Safe: the internal invariant guarantees this is populated.
        if (entry === undefined) {
          throw new Error(
            `Internal catalog invariant violated: entry missing for ` +
              `schemaId="${schemaId}" path="${path}"`
          );
        }
        return entry;
      });
    },

    classificationFor(
      schemaId: string,
      path: string
    ): FieldClassification | undefined {
      return entries.get(entryKey(schemaId, path))?.classification;
    },

    checkExhaustiveness(
      schemaId: string,
      propertyNames: readonly string[]
    ): ClassificationExhaustivenessReport {
      const classifiedPaths = new Set(schemaIndex.get(schemaId) ?? []);

      const classified: string[] = [];
      const unclassified: string[] = [];

      for (const name of propertyNames) {
        if (classifiedPaths.has(name)) {
          classified.push(name);
        } else {
          unclassified.push(name);
        }
      }

      return {
        schemaId,
        classified,
        unclassified,
      };
    },

    registeredSchemaIds(): readonly string[] {
      return Array.from(schemaIndex.keys()).sort();
    },
  };
}
