/**
 * Structured diagnostic types for the Church Bulletin Builder.
 *
 * Spec reference: "Diagnostic Codes And Redaction" (lines 4724-4751).
 */

import type { DiagnosticCode } from "./codes.js";

// ---------------------------------------------------------------------------
// Severity
// ---------------------------------------------------------------------------

/**
 * Severity describes the condition, independently of the disposition.
 *
 * - `info`: informational finding; does not block.
 * - `warning`: notable finding; may be acknowledged.
 * - `error`: blocks the current operation.
 * - `fatal`: safe continuation is impossible; triggers bounded recovery or
 *   shutdown.
 */
export type DiagnosticSeverity = "info" | "warning" | "error" | "fatal";

// ---------------------------------------------------------------------------
// Disposition
// ---------------------------------------------------------------------------

/**
 * Disposition describes how the current operation responds to this diagnostic,
 * independently of severity.
 *
 * - `allow`: the operation may continue.
 * - `acknowledge`: the operation may continue after explicit user
 *   acknowledgement.
 * - `block`: the operation is blocked and cannot proceed.
 */
export type DiagnosticDisposition = "allow" | "acknowledge" | "block";

// ---------------------------------------------------------------------------
// Redaction class
// ---------------------------------------------------------------------------

/**
 * Redaction class for a diagnostic record.
 *
 * Spec: "Logs redact credentials/tokens, environment values,
 * home/workspace absolute prefixes, helper inputs/output, document text,
 * and private asset/font names by default."
 *
 * - `public`: no private data; safe to include in any log or bundle.
 * - `redacted-paths`: local filesystem paths are replaced with stable
 *   placeholders before sharing.
 * - `redacted-content`: document text, field values, and user-authored content
 *   are stripped.
 * - `redacted-credentials`: auth tokens, API keys, and other credentials are
 *   stripped.
 * - `redacted-assets`: private asset and font names/paths are stripped.
 * - `redacted-all`: all private categories are stripped before sharing;
 *   requires explicit per-bundle confirmation.
 */
export type DiagnosticRedactionClass =
  | "public"
  | "redacted-paths"
  | "redacted-content"
  | "redacted-credentials"
  | "redacted-assets"
  | "redacted-all";

// ---------------------------------------------------------------------------
// Recovery actions
// ---------------------------------------------------------------------------

/**
 * Schema-defined recovery action identifiers.
 *
 * Spec: "Recovery actions from a schema-defined list, such as retry, relink,
 * substitute, open review, export recovery copy, or cancel."
 */
export type RecoveryAction =
  | "retry"
  | "relink"
  | "substitute"
  | "open-review"
  | "export-recovery-copy"
  | "cancel";

// ---------------------------------------------------------------------------
// Source location (for malformed JSON)
// ---------------------------------------------------------------------------

/**
 * Source location for a diagnostic about malformed JSON.
 *
 * Spec: "For malformed source JSON, one-based line/column and zero-based
 * UTF-8 byte offset when the parser can determine them safely."
 */
export interface SourceLocation {
  /** One-based line number. */
  readonly line: number;
  /** One-based column number. */
  readonly column: number;
  /** Zero-based UTF-8 byte offset. */
  readonly byteOffset: number;
}

// ---------------------------------------------------------------------------
// DiagnosticRecord
// ---------------------------------------------------------------------------

/**
 * A structured diagnostic record.
 *
 * All fields that require free text accept only pre-validated, application-
 * controlled strings.  Imported strings must be escaped before being placed
 * into `userSummary` or `technicalDetail` — diagnostics are structured data
 * and imported strings cannot create codes or actions.
 */
export interface DiagnosticRecord {
  // Core identification
  readonly code: DiagnosticCode;
  readonly severity: DiagnosticSeverity;
  readonly disposition: DiagnosticDisposition;

  /**
   * Correlation id — ties related diagnostics together within one operation.
   * Opaque string; typically a UUID.
   */
  readonly correlationId: string;

  /**
   * The operation that produced this diagnostic (e.g. "build", "import",
   * "save").  Application-controlled; never an imported string.
   */
  readonly operation: string;

  // Human-readable content (application-controlled strings only)
  /** Plain-language summary suitable for display to the user. */
  readonly userSummary: string;
  /** Bounded technical detail for diagnostic bundles / developer logs. */
  readonly technicalDetail?: string;

  // Resource context
  /**
   * Kind of the document or resource involved, e.g. "bulletin", "template",
   * "asset".
   */
  readonly resourceKind?: string;
  /** Safe display label for the resource (display name, not storage path). */
  readonly resourceLabel?: string;

  // Location context (at most one of these per record)
  /** JSON Pointer to the failing location within a document. */
  readonly jsonPointer?: string;
  /** Element, wrapper, or field id within a document. */
  readonly elementId?: string;
  /** Physical page number (one-based) relevant to the diagnostic. */
  readonly page?: number;
  /** Manifest entry id relevant to the diagnostic. */
  readonly manifestEntryId?: string;
  /**
   * Sanitized archive-relative path (no absolute prefix, no workspace path).
   */
  readonly archivePath?: string;
  /** Source location within a malformed JSON file. */
  readonly sourceLocation?: SourceLocation;

  // Recovery
  /** Ordered list of available recovery actions. */
  readonly recoveryActions: readonly RecoveryAction[];

  // Optional cause / tool classification
  /** Code of the lower-level cause, if this diagnostic wraps another. */
  readonly causeCode?: DiagnosticCode;
  /**
   * Tool exit classification, e.g. "typst-error", "timeout".
   * Never an unrestricted stack trace.
   */
  readonly toolExitClass?: string;

  // Redaction
  readonly redactionClass: DiagnosticRedactionClass;
}
