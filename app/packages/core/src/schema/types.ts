/**
 * Shared types for the @cbb/core schema module.
 *
 * All types are plain data — no Ajv internals leak into public API.
 */

// ---------------------------------------------------------------------------
// Schema catalog
// ---------------------------------------------------------------------------

/** A JSON Schema object as a plain record. Must include $id. */
export type SchemaObject = Record<string, unknown> & { readonly $id: string };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** A single structured validation error (schema-validation layer). */
export interface ValidationError {
  /** JSON Pointer path to the failing instance location (e.g. "/title"). */
  readonly instancePath: string;
  /** The failing keyword (e.g. "type", "required", "minLength"). */
  readonly keyword: string;
  /** Human-readable message. */
  readonly message: string;
  /** Schema path of the failing keyword (e.g. "/properties/title/type"). */
  readonly schemaPath: string;
}

/** Structured result from validateAgainst(). Never throws. */
export type ValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly errors: readonly ValidationError[] };

// ---------------------------------------------------------------------------
// Migration engine
// ---------------------------------------------------------------------------

/**
 * A document root with the version fields needed for migration dispatch.
 * Core does not care about other fields; migrations receive and return
 * plain objects.
 */
export interface VersionedDocument {
  readonly version: number;
  readonly [key: string]: unknown;
}

/** A single migration step from one version to the next. */
export interface MigrationStep {
  /** Schema $id this migration applies to (must match exactly). */
  readonly schemaId: string;
  /** Version this step migrates FROM. */
  readonly fromVersion: number;
  /** Version this step migrates TO. Must equal fromVersion + 1. */
  readonly toVersion: number;
  /**
   * Pure transform: receives the document at fromVersion, returns a new
   * document at toVersion. Must not mutate its input.
   */
  readonly up: (doc: Readonly<Record<string, unknown>>) => Record<string, unknown>;
}

/** A record of which migrations ran during applyMigrations(). */
export interface MigrationRecord {
  readonly schemaId: string;
  readonly fromVersion: number;
  readonly toVersion: number;
}

/** Success result from applyMigrations(). */
export interface MigrationSuccess {
  readonly status: "ok";
  readonly document: Record<string, unknown>;
  /** Ordered list of migration steps that were applied (empty if none). */
  readonly migrationsApplied: readonly MigrationRecord[];
}

/**
 * The document's version is newer than the highest registered migration target
 * for this schemaId. The app must open it in read-only / unsupported mode.
 */
export interface MigrationUnsupported {
  readonly status: "unsupported";
  /** The version found in the document. */
  readonly documentVersion: number;
  /** The highest version this build understands (latest migration toVersion). */
  readonly maxSupportedVersion: number;
  readonly schemaId: string;
}

export type MigrationResult = MigrationSuccess | MigrationUnsupported;

// ---------------------------------------------------------------------------
// Field classification
// ---------------------------------------------------------------------------

/**
 * How a persisted field path affects the system:
 * - renderAffecting: changes force Typst re-generation (impacts PDF output).
 * - readinessOnly:   changes affect publication-readiness but not PDF bytes.
 * - inert:           changes affect no rendering or readiness (e.g. editor UI
 *                    state, comments, local labels).
 */
export type FieldClassification = "renderAffecting" | "readinessOnly" | "inert";

/** A registered classification entry for one field path within a schema. */
export interface FieldClassificationEntry {
  /**
   * Dot-notation path within the document (e.g. "elements.0.text",
   * "pageSetup.size"). For array items use "*" as the index segment.
   */
  readonly path: string;
  readonly classification: FieldClassification;
  /** Optional rationale for auditing / documentation. */
  readonly reason?: string;
}

/**
 * Result from checkClassificationExhaustiveness().
 * "unclassified" lists property names not covered by the registered catalog.
 */
export interface ClassificationExhaustivenessReport {
  readonly schemaId: string;
  readonly unclassified: readonly string[];
  readonly classified: readonly string[];
}

// ---------------------------------------------------------------------------
// Semantic validation
// ---------------------------------------------------------------------------

/** Severity levels matching the spec's diagnostic convention. */
export type DiagnosticSeverity = "error" | "warning" | "info";

/**
 * A diagnostic finding from a semantic validator.  Uses a Diagnostic-like
 * shape; the full CBB diagnostic catalog is a separate concern.
 */
export interface SemanticDiagnostic {
  /** Stable diagnostic code (e.g. "CBB-DOC-0001"). */
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  /** Optional JSON Pointer into the validated value. */
  readonly instancePath?: string;
}

/** Result from running the semantic validation registry for a schemaId. */
export type SemanticValidationResult =
  | { readonly valid: true; readonly findings: readonly SemanticDiagnostic[] }
  | { readonly valid: false; readonly findings: readonly SemanticDiagnostic[] };
