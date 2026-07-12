/**
 * @cbb/core — schema module public API.
 *
 * Exports the schema catalog loader, migration engine, field classification
 * catalog, and semantic validation registry.
 */

export type {
  SchemaObject,
  ValidationError,
  ValidationResult,
  VersionedDocument,
  MigrationStep,
  MigrationRecord,
  MigrationSuccess,
  MigrationUnsupported,
  MigrationResult,
  FieldClassification,
  FieldClassificationEntry,
  ClassificationExhaustivenessReport,
  DiagnosticSeverity,
  SemanticDiagnostic,
  SemanticValidationResult,
} from "./types.js";

export type { SchemaCatalog } from "./catalog.js";
export { createSchemaCatalog } from "./catalog.js";

export type { MigrationRegistry } from "./migration.js";
export { createMigrationRegistry, isVersionedDocument } from "./migration.js";

export type { FieldClassificationCatalog } from "./fieldClassification.js";
export { createFieldClassificationCatalog } from "./fieldClassification.js";

export type {
  SemanticValidatorFn,
  SemanticValidatorEntry,
  SemanticValidationRegistry,
} from "./semanticValidation.js";
export { createSemanticValidationRegistry } from "./semanticValidation.js";
