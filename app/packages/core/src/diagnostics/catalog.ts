/**
 * Diagnostic catalog registry.
 *
 * The spec requires the app to bundle a versioned `diagnostic-catalog.json`
 * validated by `diagnostic-catalog.schema.json`.  This module provides the
 * in-memory registry API used at runtime:
 *
 *   - `registerDiagnostic` — add a catalog entry, throwing if the code is
 *     already registered (duplicate-code protection).
 *   - `getDiagnostic`      — look up an entry by code.
 *   - `hasDiagnostic`      — existence check.
 *   - `allDiagnostics`     — iterate all registered entries.
 *   - `makeCatalog`        — create an isolated catalog instance (useful in
 *     tests to avoid global state).
 *
 * The global catalog is populated by the baseline catalog loader (separate
 * concern).  This module only defines the registry structure and API.
 */

import type { DiagnosticCode } from "./codes.js";
import type {
  DiagnosticDisposition,
  DiagnosticRedactionClass,
  DiagnosticSeverity,
  RecoveryAction,
} from "./types.js";

// ---------------------------------------------------------------------------
// Catalog entry
// ---------------------------------------------------------------------------

/**
 * An entry in the diagnostic catalog.
 *
 * This is the normative definition of a code: its meaning, default severity,
 * default disposition, acknowledgeability, available recovery actions, and
 * redaction class.  Individual `DiagnosticRecord`s may override severity and
 * disposition at emit time, but may not change the code's meaning or redaction
 * class.
 */
export interface DiagnosticCatalogEntry {
  readonly code: DiagnosticCode;
  readonly meaning: string;
  readonly defaultSeverity: DiagnosticSeverity;
  readonly defaultDisposition: DiagnosticDisposition;
  readonly acknowledgeable: boolean;
  readonly defaultRecoveryActions: readonly RecoveryAction[];
  readonly redactionClass: DiagnosticRedactionClass;
  /**
   * Whether this code has been retired.  Retired codes remain in the catalog
   * so that old records can still be interpreted, but must not be emitted for
   * new conditions.
   */
  readonly retired: boolean;
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export interface DiagnosticCatalog {
  /**
   * Register a new catalog entry.
   *
   * @throws {Error} if the code is already registered (duplicate-code
   *   protection — per spec: "A release may add/retire codes but never reuse
   *   one").
   */
  register(entry: DiagnosticCatalogEntry): void;

  /**
   * Look up a catalog entry by code.
   *
   * @returns the entry, or `undefined` if the code is not registered.
   */
  get(code: DiagnosticCode): DiagnosticCatalogEntry | undefined;

  /**
   * Return `true` iff the code has been registered.
   */
  has(code: DiagnosticCode): boolean;

  /**
   * Return an array of all registered entries, in registration order.
   */
  all(): DiagnosticCatalogEntry[];

  /**
   * Return the number of registered entries.
   */
  size(): number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a new, empty, isolated diagnostic catalog instance.
 *
 * Prefer this over the global catalog in tests and in contexts where multiple
 * isolated catalogs are needed.
 */
export function makeCatalog(): DiagnosticCatalog {
  const entries = new Map<DiagnosticCode, DiagnosticCatalogEntry>();
  const order: DiagnosticCode[] = [];

  return {
    register(entry: DiagnosticCatalogEntry): void {
      if (entries.has(entry.code)) {
        throw new Error(
          `DiagnosticCatalog: code "${entry.code}" is already registered. ` +
            `A code's meaning cannot be repurposed; behavior changes require a new code.`,
        );
      }
      entries.set(entry.code, entry);
      order.push(entry.code);
    },

    get(code: DiagnosticCode): DiagnosticCatalogEntry | undefined {
      return entries.get(code);
    },

    has(code: DiagnosticCode): boolean {
      return entries.has(code);
    },

    all(): DiagnosticCatalogEntry[] {
      // Return entries in stable registration order.
      return order.map((c) => {
        // The entry is guaranteed to be present because order is populated
        // only in register() immediately after the Map.set().
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return entries.get(c)!;
      });
    },

    size(): number {
      return entries.size;
    },
  };
}

// ---------------------------------------------------------------------------
// Global catalog
// ---------------------------------------------------------------------------

/**
 * The global diagnostic catalog.
 *
 * Populated by the baseline catalog loader (`baseline-catalog.ts`).  Do not
 * call `register` directly outside of that loader and tests.
 */
export const globalCatalog: DiagnosticCatalog = makeCatalog();

/**
 * Convenience alias: register an entry in the global catalog.
 */
export function registerDiagnostic(entry: DiagnosticCatalogEntry): void {
  globalCatalog.register(entry);
}

/**
 * Convenience alias: look up an entry in the global catalog.
 */
export function getDiagnostic(
  code: DiagnosticCode,
): DiagnosticCatalogEntry | undefined {
  return globalCatalog.get(code);
}
