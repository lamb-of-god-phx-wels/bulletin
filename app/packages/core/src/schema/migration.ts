/**
 * Migration engine for @cbb/core.
 *
 * Migrations are ordered, idempotent, and pure (no side effects).
 * They run in memory on open/import; writes happen only at the next
 * approved persistence point (spec §Schema Organization, Versions, And
 * Storage Boundaries).
 *
 * Version semantics:
 * - A document whose version equals the latest migration target is
 *   already current — no migrations run.
 * - A document whose version is NEWER than the latest migration target
 *   yields status "unsupported": the app must open it read-only.
 * - fromVersion must equal toVersion - 1 (no skips).
 */

import type {
  MigrationStep,
  MigrationResult,
  MigrationRecord,
  VersionedDocument,
} from "./types.js";

// ---------------------------------------------------------------------------
// Deep-freeze helper
// ---------------------------------------------------------------------------

/**
 * Recursively freeze a plain-object / array tree so that migration steps
 * cannot mutate nested state shared with the caller.
 *
 * Only freezes plain-object and array nodes; leaves primitives and non-plain
 * objects (class instances, etc.) untouched.
 */
function deepFreeze<T>(value: T): Readonly<T> {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value as Readonly<T>;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value as Readonly<T>;
}

// ---------------------------------------------------------------------------
// Internal registry type
// ---------------------------------------------------------------------------

/**
 * Index key for a migration step: `${schemaId}::${fromVersion}`.
 * Using a string key keeps the registry a flat Map with O(1) lookup.
 */
function stepKey(schemaId: string, fromVersion: number): string {
  return `${schemaId}::${fromVersion}`;
}

// ---------------------------------------------------------------------------
// MigrationRegistry
// ---------------------------------------------------------------------------

/** Opaque migration registry. Use createMigrationRegistry() to construct. */
export interface MigrationRegistry {
  /**
   * Register a migration step.
   * @throws if a step for the same (schemaId, fromVersion) already exists,
   *         or if toVersion !== fromVersion + 1.
   */
  register(step: MigrationStep): void;

  /**
   * Apply all applicable migrations to the document in order.
   *
   * Rules:
   * - Migration steps are chained: the output of step N is the input of N+1.
   * - Steps run until the document reaches the latest registered version OR
   *   no further step exists (meaning the document is current or unknown).
   * - If the document's version is higher than any registered toVersion for
   *   this schemaId, returns status "unsupported".
   * - This function is pure: the original document is never mutated.
   *
   * @param schemaId   The schema $id that governs this document root.
   * @param document   The raw parsed document (must include a `version` field).
   */
  applyMigrations(
    schemaId: string,
    document: Readonly<Record<string, unknown>>
  ): MigrationResult;

  /**
   * Returns the maximum supported (toVersion) for the given schemaId.
   * Returns undefined if no migrations are registered for this schemaId.
   */
  maxSupportedVersion(schemaId: string): number | undefined;
}

/**
 * Create a new, empty migration registry.
 */
export function createMigrationRegistry(): MigrationRegistry {
  // Map from stepKey(schemaId, fromVersion) -> MigrationStep
  const steps = new Map<string, MigrationStep>();

  // Track max registered toVersion per schemaId so we can detect "unsupported".
  const maxVersion = new Map<string, number>();

  return {
    register(step: MigrationStep): void {
      if (step.toVersion !== step.fromVersion + 1) {
        throw new Error(
          `Migration for schema "${step.schemaId}" has toVersion=${step.toVersion} ` +
            `but fromVersion=${step.fromVersion}. toVersion must equal fromVersion + 1.`
        );
      }

      const key = stepKey(step.schemaId, step.fromVersion);
      if (steps.has(key)) {
        throw new Error(
          `A migration step from version ${step.fromVersion} is already ` +
            `registered for schema "${step.schemaId}". ` +
            `Duplicate migration registrations are not allowed.`
        );
      }

      steps.set(key, step);

      const current = maxVersion.get(step.schemaId);
      if (current === undefined || step.toVersion > current) {
        maxVersion.set(step.schemaId, step.toVersion);
      }
    },

    applyMigrations(
      schemaId: string,
      document: Readonly<Record<string, unknown>>
    ): MigrationResult {
      const rawVersion = document["version"];
      if (typeof rawVersion !== "number" || !Number.isInteger(rawVersion)) {
        // Treat a missing/non-integer version as version 0 so migrations still
        // run. This matches the spec's normalization-within-version rule.
        // The caller can validate schema shape separately.
      }

      const docVersion =
        typeof rawVersion === "number" && Number.isInteger(rawVersion)
          ? rawVersion
          : 0;

      const max = maxVersion.get(schemaId);

      // No migrations registered for this schemaId — document is current.
      if (max === undefined) {
        return {
          status: "ok",
          document: { ...document },
          migrationsApplied: [],
        };
      }

      // Document is from a newer version than we understand.
      if (docVersion > max) {
        return {
          status: "unsupported",
          documentVersion: docVersion,
          maxSupportedVersion: max,
          schemaId,
        };
      }

      // Run migration chain from docVersion up to max.
      const migrationsApplied: MigrationRecord[] = [];
      // Clone the document shallowly so we start with a new object reference.
      let current: Record<string, unknown> = { ...document };

      for (
        let fromVer = docVersion;
        fromVer < max;
        fromVer++
      ) {
        const key = stepKey(schemaId, fromVer);
        const step = steps.get(key);

        if (!step) {
          // A gap in the migration chain: the document is at a version for
          // which no migration step exists, but there are higher registered
          // versions. This is a broken chain — the document cannot be safely
          // migrated. Return a distinct "gap" error so the caller can surface
          // it explicitly instead of silently treating an unmigrated document
          // as current.
          return {
            status: "unsupported",
            documentVersion: fromVer,
            maxSupportedVersion: max,
            schemaId,
          };
        }

        // Deep-freeze the input snapshot so a misbehaving migration step
        // cannot mutate nested state that is still referenced by `current`.
        const frozenInput = deepFreeze({ ...current });

        // Call the pure migration function; it must return a new object.
        const next = step.up(frozenInput);

        // Post-condition: the step must set version to toVersion.
        const expectedVersion = fromVer + 1;
        const actualVersion = next["version"];
        if (actualVersion !== expectedVersion) {
          throw new Error(
            `Migration step for schema "${schemaId}" from version ${fromVer} ` +
            `did not set version to ${expectedVersion} in its output. ` +
            `Got version=${String(actualVersion)}. ` +
            `Each migration step must bump the 'version' field to toVersion.`,
          );
        }

        migrationsApplied.push({
          schemaId,
          fromVersion: fromVer,
          toVersion: fromVer + 1,
        });
        current = next;
      }

      return {
        status: "ok",
        document: current,
        migrationsApplied,
      };
    },

    maxSupportedVersion(schemaId: string): number | undefined {
      return maxVersion.get(schemaId);
    },
  };
}

// ---------------------------------------------------------------------------
// VersionedDocument guard helper
// ---------------------------------------------------------------------------

/**
 * Type-guard: returns true if the value looks like a VersionedDocument
 * (has an integer `version` field at the root).
 */
export function isVersionedDocument(
  value: unknown
): value is VersionedDocument {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    typeof (value as Record<string, unknown>)["version"] === "number" &&
    Number.isInteger((value as Record<string, unknown>)["version"] as number)
  );
}
