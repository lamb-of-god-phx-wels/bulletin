/**
 * @cbb/core — runtime-agnostic domain logic for the Church Bulletin Builder.
 *
 * This package must never import from electron, react, or any node: built-in.
 * All I/O and environment capabilities are injected via interfaces defined here.
 */

export const CORE_PACKAGE_NAME = "@cbb/core" as const;

export * from "./canonical/index.js";
export * from "./geometry/index.js";

// Schema module: catalog loader, migration engine, field classification,
// and semantic validation registry.
export * from "./schema/index.js";

// Rich-text AST, normalization, plain-text derivation, and clipboard
// sanitization.
export * from "./richtext/index.js";

// Identity types and helpers for all resource/document id classes.
export * from "./ids/index.js";

// Diagnostic codes, structured record type, and catalog registry.
// Note: DiagnosticSeverity exported from diagnostics is the spec-complete
// version (info | warning | error | fatal). The schema module exports a
// narrower DiagnosticSeverity (info | warning | error) under the same name
// for its local semantic-validation use. To avoid the ambiguous re-export
// conflict at the package level, we re-export the diagnostics module members
// explicitly, omitting the name clash — consumers who need both should import
// directly from the sub-module paths.
export type {
  BaselineCode,
  DiagnosticCode,
  DiagnosticDomain,
} from "./diagnostics/index.js";
export {
  BASELINE_CODES,
  DIAGNOSTIC_DOMAINS,
  extractCodeNumber,
  extractDomain,
  getDiagnostic,
  globalCatalog,
  isDiagnosticCode,
  makeCatalog,
  parseDiagnosticCode,
  registerDiagnostic,
} from "./diagnostics/index.js";
export type {
  DiagnosticCatalog,
  DiagnosticCatalogEntry,
  DiagnosticDisposition,
  DiagnosticRecord,
  DiagnosticRedactionClass,
  RecoveryAction,
  SourceLocation,
} from "./diagnostics/index.js";
// DiagnosticSeverity is intentionally NOT re-exported here at the package
// root to avoid the ambiguous-export conflict with schema/types.ts.
// Import it directly:
//   import type { DiagnosticSeverity } from "@cbb/core/src/diagnostics/index.js";
