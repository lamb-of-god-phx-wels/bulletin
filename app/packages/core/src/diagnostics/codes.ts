/**
 * Diagnostic code type and domain definitions.
 *
 * Spec reference: "Diagnostic Codes And Redaction" (lines 4664-4751).
 *
 * Format: CBB-<DOMAIN>-<NNNN>
 *
 * A code's meaning and default severity cannot be repurposed; behavior changes
 * require a new code.  The app bundles a versioned diagnostic-catalog that is
 * normative for code meaning, default severity, per-operation disposition,
 * acknowledgeability, recovery actions, and redaction class.
 */

/** All defined diagnostic domains. */
export const DIAGNOSTIC_DOMAINS = [
  "DOC",
  "SCHEMA",
  "FIELD",
  "ASSET",
  "FONT",
  "LAYOUT",
  "BUILD",
  "PDF",
  "SAVE",
  "CONFLICT",
  "IMPORT",
  "PACK",
  "SYNC",
  "SCRIPTURE",
  "RIGHTS",
  "BACKUP",
  "SECURITY",
  "AI",
  "PACKAGE",
] as const;

/** Union type of all defined diagnostic domains. */
export type DiagnosticDomain = (typeof DIAGNOSTIC_DOMAINS)[number];

/**
 * Branded diagnostic code string of the form `CBB-<DOMAIN>-<NNNN>`.
 *
 * Use `parseDiagnosticCode` / `isDiagnosticCode` to validate at runtime.
 * Never construct one by concatenation outside this module.
 */
export type DiagnosticCode = `CBB-${DiagnosticDomain}-${string}`;

/**
 * Regex that matches a well-formed diagnostic code.
 *
 * The domain segment must be one of the defined domains (validated separately
 * by `isDiagnosticCode`), and the number segment must be exactly four decimal
 * digits.
 */
const CODE_RE = /^CBB-([A-Z]+)-(\d{4})$/;

/**
 * Return `true` iff `value` is a syntactically valid diagnostic code with a
 * defined domain.
 */
export function isDiagnosticCode(value: string): value is DiagnosticCode {
  const match = CODE_RE.exec(value);
  if (!match) return false;
  const domain = match[1] as string;
  return (DIAGNOSTIC_DOMAINS as readonly string[]).includes(domain);
}

/**
 * Parse and return a `DiagnosticCode`, or throw a `TypeError` if the value
 * is not well-formed or its domain is not in the defined set.
 */
export function parseDiagnosticCode(raw: string): DiagnosticCode {
  const match = CODE_RE.exec(raw);
  if (!match) {
    throw new TypeError(
      `DiagnosticCode: expected "CBB-<DOMAIN>-<NNNN>" format, got: ${JSON.stringify(raw)}`,
    );
  }
  const domain = match[1] as string;
  if (!(DIAGNOSTIC_DOMAINS as readonly string[]).includes(domain)) {
    throw new TypeError(
      `DiagnosticCode: unknown domain "${domain}" in: ${JSON.stringify(raw)}. ` +
        `Defined domains: ${DIAGNOSTIC_DOMAINS.join(", ")}`,
    );
  }
  // At this point the domain is valid, so the cast is correct.
  return raw as DiagnosticCode;
}

/**
 * Extract the domain segment from a valid `DiagnosticCode`.
 */
export function extractDomain(code: DiagnosticCode): DiagnosticDomain {
  // We know the format is correct because DiagnosticCode is validated on
  // construction.  The split is safe: CODE_RE guarantees the structure.
  const parts = code.split("-");
  // parts[0] = "CBB", parts[1] = domain, parts[2] = number
  return parts[1] as DiagnosticDomain;
}

/**
 * Extract the four-digit number segment from a valid `DiagnosticCode`.
 */
export function extractCodeNumber(code: DiagnosticCode): number {
  const parts = code.split("-");
  // parts[2] is guaranteed to be four decimal digits by CODE_RE.
  // The non-null assertion is safe: CODE_RE match guarantees 3 parts.
  return parseInt(parts[2] as string, 10);
}

// ---------------------------------------------------------------------------
// Baseline catalog codes (spec table, lines 4679-4722)
// ---------------------------------------------------------------------------

/**
 * All baseline diagnostic codes as a tuple type, ensuring exhaustiveness can
 * be checked at compile-time when needed.
 */
export const BASELINE_CODES = [
  "CBB-DOC-0001",
  "CBB-DOC-0002",
  "CBB-SCHEMA-0001",
  "CBB-SCHEMA-0002",
  "CBB-FIELD-0001",
  "CBB-FIELD-0002",
  "CBB-ASSET-0001",
  "CBB-ASSET-0002",
  "CBB-FONT-0001",
  "CBB-FONT-0002",
  "CBB-FONT-0003",
  "CBB-FONT-0004",
  "CBB-LAYOUT-0001",
  "CBB-LAYOUT-0002",
  "CBB-LAYOUT-0003",
  "CBB-LAYOUT-0004",
  "CBB-LAYOUT-0005",
  "CBB-LAYOUT-0006",
  "CBB-LAYOUT-0007",
  "CBB-BUILD-0001",
  "CBB-BUILD-0002",
  "CBB-BUILD-0003",
  "CBB-BUILD-0004",
  "CBB-PDF-0001",
  "CBB-PDF-0002",
  "CBB-SAVE-0001",
  "CBB-SAVE-0002",
  "CBB-CONFLICT-0001",
  "CBB-IMPORT-0001",
  "CBB-PACK-0001",
  "CBB-PACK-0002",
  "CBB-SYNC-0001",
  "CBB-SYNC-0002",
  "CBB-SYNC-0003",
  "CBB-SYNC-0004",
  "CBB-SYNC-0005",
  "CBB-SCRIPTURE-0001",
  "CBB-RIGHTS-0001",
  "CBB-RIGHTS-0002",
  "CBB-BACKUP-0001",
  "CBB-SECURITY-0001",
  "CBB-AI-0001",
  "CBB-PACKAGE-0001",
] as const satisfies DiagnosticCode[];

export type BaselineCode = (typeof BASELINE_CODES)[number];
