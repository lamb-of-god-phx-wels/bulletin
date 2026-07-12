/**
 * @cbb/core/diagnostics — diagnostic codes, types, and catalog for the
 * Church Bulletin Builder.
 *
 * Importing this module registers all baseline catalog entries as a side
 * effect.  Subsequent `getDiagnostic` / `globalCatalog.get` calls will find
 * all spec-defined codes.
 */

// Load baseline entries into the global catalog on first import.
import "./baseline-catalog.js";

export {
  BASELINE_CODES,
  DIAGNOSTIC_DOMAINS,
  extractCodeNumber,
  extractDomain,
  isDiagnosticCode,
  parseDiagnosticCode,
} from "./codes.js";

export type { BaselineCode, DiagnosticCode, DiagnosticDomain } from "./codes.js";

export {
  getDiagnostic,
  globalCatalog,
  makeCatalog,
  registerDiagnostic,
} from "./catalog.js";

export type { DiagnosticCatalog, DiagnosticCatalogEntry } from "./catalog.js";

export type {
  DiagnosticDisposition,
  DiagnosticRecord,
  DiagnosticRedactionClass,
  DiagnosticSeverity,
  RecoveryAction,
  SourceLocation,
} from "./types.js";
