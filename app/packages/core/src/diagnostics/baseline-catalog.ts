/**
 * Baseline diagnostic catalog entries.
 *
 * Registers all codes defined in the spec table (lines 4679-4722) into the
 * global catalog.  This module is loaded once at startup via the
 * `diagnostics/index.ts` re-export.
 *
 * Meanings are taken verbatim from the spec table.
 */

import { parseDiagnosticCode } from "./codes.js";
import type { DiagnosticCatalogEntry } from "./catalog.js";
import { globalCatalog } from "./catalog.js";

// ---------------------------------------------------------------------------
// Baseline entries
// ---------------------------------------------------------------------------

const entries: Omit<DiagnosticCatalogEntry, "code">[] = [];
type EntryDef = {
  raw: string;
  meaning: string;
  defaultSeverity: DiagnosticCatalogEntry["defaultSeverity"];
  defaultDisposition: DiagnosticCatalogEntry["defaultDisposition"];
  acknowledgeable: boolean;
  defaultRecoveryActions: DiagnosticCatalogEntry["defaultRecoveryActions"];
  redactionClass: DiagnosticCatalogEntry["redactionClass"];
  retired: boolean;
};

function def(d: EntryDef): void {
  entries.push({
    meaning: d.meaning,
    defaultSeverity: d.defaultSeverity,
    defaultDisposition: d.defaultDisposition,
    acknowledgeable: d.acknowledgeable,
    defaultRecoveryActions: d.defaultRecoveryActions,
    redactionClass: d.redactionClass,
    retired: d.retired,
  });
  globalCatalog.register({
    code: parseDiagnosticCode(d.raw),
    meaning: d.meaning,
    defaultSeverity: d.defaultSeverity,
    defaultDisposition: d.defaultDisposition,
    acknowledgeable: d.acknowledgeable,
    defaultRecoveryActions: d.defaultRecoveryActions,
    redactionClass: d.redactionClass,
    retired: d.retired,
  });
}

// DOC
def({
  raw: "CBB-DOC-0001",
  meaning: "Malformed/unsupported document JSON.",
  defaultSeverity: "error",
  defaultDisposition: "block",
  acknowledgeable: false,
  defaultRecoveryActions: ["export-recovery-copy", "cancel"],
  redactionClass: "redacted-content",
  retired: false,
});
def({
  raw: "CBB-DOC-0002",
  meaning: "Stale-content or unresolved weekly-work review finding.",
  defaultSeverity: "warning",
  defaultDisposition: "acknowledge",
  acknowledgeable: true,
  defaultRecoveryActions: ["open-review", "cancel"],
  redactionClass: "redacted-content",
  retired: false,
});

// SCHEMA
def({
  raw: "CBB-SCHEMA-0001",
  meaning: "Structural or semantic schema failure.",
  defaultSeverity: "error",
  defaultDisposition: "block",
  acknowledgeable: false,
  defaultRecoveryActions: ["export-recovery-copy", "cancel"],
  redactionClass: "public",
  retired: false,
});
def({
  raw: "CBB-SCHEMA-0002",
  meaning: "Internal schema validation invariant violation (semantic validator registry error).",
  defaultSeverity: "error",
  defaultDisposition: "block",
  acknowledgeable: false,
  defaultRecoveryActions: ["export-recovery-copy", "cancel"],
  redactionClass: "public",
  retired: false,
});

// FIELD
def({
  raw: "CBB-FIELD-0001",
  meaning: "Missing/invalid required field-contract value.",
  defaultSeverity: "error",
  defaultDisposition: "block",
  acknowledgeable: false,
  defaultRecoveryActions: ["open-review", "cancel"],
  redactionClass: "redacted-content",
  retired: false,
});
def({
  raw: "CBB-FIELD-0002",
  meaning: "Required rollover decision or confirmation is unresolved.",
  defaultSeverity: "warning",
  defaultDisposition: "acknowledge",
  acknowledgeable: true,
  defaultRecoveryActions: ["open-review", "cancel"],
  redactionClass: "redacted-content",
  retired: false,
});

// ASSET
def({
  raw: "CBB-ASSET-0001",
  meaning: "Unresolved required portable asset.",
  defaultSeverity: "error",
  defaultDisposition: "block",
  acknowledgeable: false,
  defaultRecoveryActions: ["relink", "substitute", "cancel"],
  redactionClass: "redacted-assets",
  retired: false,
});
def({
  raw: "CBB-ASSET-0002",
  meaning: "Raster image has low effective print resolution.",
  defaultSeverity: "warning",
  defaultDisposition: "acknowledge",
  acknowledgeable: true,
  defaultRecoveryActions: ["relink", "substitute", "cancel"],
  redactionClass: "redacted-assets",
  retired: false,
});

// FONT
def({
  raw: "CBB-FONT-0001",
  meaning: "Missing/invalid font revision.",
  defaultSeverity: "error",
  defaultDisposition: "block",
  acknowledgeable: false,
  defaultRecoveryActions: ["substitute", "cancel"],
  redactionClass: "redacted-assets",
  retired: false,
});
def({
  raw: "CBB-FONT-0002",
  meaning: "Missing glyph after explicit fallback closure.",
  defaultSeverity: "warning",
  defaultDisposition: "acknowledge",
  acknowledgeable: true,
  defaultRecoveryActions: ["substitute", "cancel"],
  redactionClass: "redacted-assets",
  retired: false,
});
def({
  raw: "CBB-FONT-0003",
  meaning: "Redistribution/embedding permission blocks output.",
  defaultSeverity: "error",
  defaultDisposition: "block",
  acknowledgeable: false,
  defaultRecoveryActions: ["substitute", "cancel"],
  redactionClass: "redacted-assets",
  retired: false,
});
def({
  raw: "CBB-FONT-0004",
  meaning: "Requested face uses a deterministic managed substitute.",
  defaultSeverity: "info",
  defaultDisposition: "allow",
  acknowledgeable: false,
  defaultRecoveryActions: [],
  redactionClass: "public",
  retired: false,
});

// LAYOUT
def({
  raw: "CBB-LAYOUT-0001",
  meaning: "Horizontal or physical-page overflow.",
  defaultSeverity: "error",
  defaultDisposition: "block",
  acknowledgeable: false,
  defaultRecoveryActions: ["open-review", "cancel"],
  redactionClass: "public",
  retired: false,
});
def({
  raw: "CBB-LAYOUT-0002",
  meaning: "Oversized unbreakable fragment.",
  defaultSeverity: "error",
  defaultDisposition: "block",
  acknowledgeable: false,
  defaultRecoveryActions: ["open-review", "cancel"],
  redactionClass: "public",
  retired: false,
});
def({
  raw: "CBB-LAYOUT-0003",
  meaning: "Clipped semantic content or no-progress pagination.",
  defaultSeverity: "error",
  defaultDisposition: "block",
  acknowledgeable: false,
  defaultRecoveryActions: ["open-review", "cancel"],
  redactionClass: "public",
  retired: false,
});
def({
  raw: "CBB-LAYOUT-0004",
  meaning: "Final PDF page count violates the document requirement.",
  defaultSeverity: "error",
  defaultDisposition: "block",
  acknowledgeable: false,
  defaultRecoveryActions: ["open-review", "cancel"],
  redactionClass: "public",
  retired: false,
});
def({
  raw: "CBB-LAYOUT-0005",
  meaning: "Folded document count cannot produce a two-up booklet.",
  defaultSeverity: "error",
  defaultDisposition: "block",
  acknowledgeable: false,
  defaultRecoveryActions: ["open-review", "cancel"],
  redactionClass: "public",
  retired: false,
});
def({
  raw: "CBB-LAYOUT-0006",
  meaning: "Content enters a configured printer-safe inset or fold band.",
  defaultSeverity: "warning",
  defaultDisposition: "acknowledge",
  acknowledgeable: true,
  defaultRecoveryActions: ["open-review", "cancel"],
  redactionClass: "public",
  retired: false,
});
def({
  raw: "CBB-LAYOUT-0007",
  meaning: "Booklet-print setup is missing or geometrically invalid.",
  defaultSeverity: "error",
  defaultDisposition: "block",
  acknowledgeable: false,
  defaultRecoveryActions: ["open-review", "cancel"],
  redactionClass: "public",
  retired: false,
});

// BUILD
def({
  raw: "CBB-BUILD-0001",
  meaning: "Typst compile failure.",
  defaultSeverity: "error",
  defaultDisposition: "block",
  acknowledgeable: false,
  defaultRecoveryActions: ["retry", "cancel"],
  redactionClass: "public",
  retired: false,
});
def({
  raw: "CBB-BUILD-0002",
  meaning: "Build timeout/cancellation.",
  defaultSeverity: "error",
  defaultDisposition: "block",
  acknowledgeable: false,
  defaultRecoveryActions: ["retry", "cancel"],
  redactionClass: "public",
  retired: false,
});
def({
  raw: "CBB-BUILD-0003",
  meaning: "PDF/output hash or parse verification failure.",
  defaultSeverity: "error",
  defaultDisposition: "block",
  acknowledgeable: false,
  defaultRecoveryActions: ["retry", "cancel"],
  redactionClass: "public",
  retired: false,
});
def({
  raw: "CBB-BUILD-0004",
  meaning: "Requested artifact is stale for the current input signature.",
  defaultSeverity: "warning",
  defaultDisposition: "allow",
  acknowledgeable: false,
  defaultRecoveryActions: ["retry"],
  redactionClass: "public",
  retired: false,
});

// PDF
def({
  raw: "CBB-PDF-0001",
  meaning: "Requested PDF/UA validation failure.",
  defaultSeverity: "error",
  defaultDisposition: "block",
  acknowledgeable: false,
  defaultRecoveryActions: ["open-review", "cancel"],
  redactionClass: "public",
  retired: false,
});
def({
  raw: "CBB-PDF-0002",
  meaning:
    "Missing required accessible metadata, semantics, order, or alt text.",
  defaultSeverity: "error",
  defaultDisposition: "block",
  acknowledgeable: false,
  defaultRecoveryActions: ["open-review", "cancel"],
  redactionClass: "redacted-content",
  retired: false,
});

// SAVE
def({
  raw: "CBB-SAVE-0001",
  meaning: "Canonical/recovery autosave failed.",
  defaultSeverity: "error",
  defaultDisposition: "block",
  acknowledgeable: false,
  defaultRecoveryActions: ["retry", "export-recovery-copy", "cancel"],
  redactionClass: "public",
  retired: false,
});
def({
  raw: "CBB-SAVE-0002",
  meaning: "Operation requires a current durably saved revision.",
  defaultSeverity: "error",
  defaultDisposition: "block",
  acknowledgeable: false,
  defaultRecoveryActions: ["retry", "cancel"],
  redactionClass: "public",
  retired: false,
});

// CONFLICT
def({
  raw: "CBB-CONFLICT-0001",
  meaning: "Optimistic revision conflict.",
  defaultSeverity: "error",
  defaultDisposition: "block",
  acknowledgeable: false,
  defaultRecoveryActions: ["open-review", "cancel"],
  redactionClass: "public",
  retired: false,
});

// IMPORT
def({
  raw: "CBB-IMPORT-0001",
  meaning: "Invalid/unsafe/incompatible archive or manifest.",
  defaultSeverity: "error",
  defaultDisposition: "block",
  acknowledgeable: false,
  defaultRecoveryActions: ["cancel"],
  redactionClass: "redacted-paths",
  retired: false,
});

// PACK
def({
  raw: "CBB-PACK-0001",
  meaning: "Pack signature/signer/release continuity failure.",
  defaultSeverity: "error",
  defaultDisposition: "block",
  acknowledgeable: false,
  defaultRecoveryActions: ["cancel"],
  redactionClass: "public",
  retired: false,
});
def({
  raw: "CBB-PACK-0002",
  meaning:
    "Pack export/publish redistribution decision is missing, prohibited, outside its effective dates, or narrower than the selected closure.",
  defaultSeverity: "error",
  defaultDisposition: "block",
  acknowledgeable: false,
  defaultRecoveryActions: ["open-review", "cancel"],
  redactionClass: "public",
  retired: false,
});

// SYNC
def({
  raw: "CBB-SYNC-0001",
  meaning:
    "Shared-library check or transfer could not complete; installed local content is unchanged.",
  defaultSeverity: "error",
  defaultDisposition: "block",
  acknowledgeable: false,
  defaultRecoveryActions: ["retry", "cancel"],
  redactionClass: "public",
  retired: false,
});
def({
  raw: "CBB-SYNC-0002",
  meaning:
    "Shared-library authentication or authorization must be renewed.",
  defaultSeverity: "error",
  defaultDisposition: "block",
  acknowledgeable: false,
  defaultRecoveryActions: ["retry", "cancel"],
  redactionClass: "redacted-credentials",
  retired: false,
});
def({
  raw: "CBB-SYNC-0003",
  meaning:
    "Hosted head changed before publish; local and incoming work require review.",
  defaultSeverity: "error",
  defaultDisposition: "block",
  acknowledgeable: false,
  defaultRecoveryActions: ["open-review", "cancel"],
  redactionClass: "public",
  retired: false,
});
def({
  raw: "CBB-SYNC-0004",
  meaning:
    "Hosted feed/release identity, length, digest, signature, or compatibility validation failed.",
  defaultSeverity: "error",
  defaultDisposition: "block",
  acknowledgeable: false,
  defaultRecoveryActions: ["retry", "cancel"],
  redactionClass: "public",
  retired: false,
});
def({
  raw: "CBB-SYNC-0005",
  meaning:
    "Published bytes could not be verified as the visible hosted head.",
  defaultSeverity: "error",
  defaultDisposition: "block",
  acknowledgeable: false,
  defaultRecoveryActions: ["retry", "cancel"],
  redactionClass: "public",
  retired: false,
});

// SCRIPTURE
def({
  raw: "CBB-SCRIPTURE-0001",
  meaning:
    "Scripture parsing, source-fidelity, reference, translation, or required-attribution finding.",
  defaultSeverity: "warning",
  defaultDisposition: "acknowledge",
  acknowledgeable: true,
  defaultRecoveryActions: ["open-review", "cancel"],
  redactionClass: "redacted-content",
  retired: false,
});

// RIGHTS
def({
  raw: "CBB-RIGHTS-0001",
  meaning: "Required, missing, unknown, or undisplayed rights metadata.",
  defaultSeverity: "error",
  defaultDisposition: "block",
  acknowledgeable: false,
  defaultRecoveryActions: ["open-review", "cancel"],
  redactionClass: "public",
  retired: false,
});
def({
  raw: "CBB-RIGHTS-0002",
  meaning:
    "Conflicting rights identity or invalid Copyrights & Permissions aggregation.",
  defaultSeverity: "error",
  defaultDisposition: "block",
  acknowledgeable: false,
  defaultRecoveryActions: ["open-review", "cancel"],
  redactionClass: "public",
  retired: false,
});

// BACKUP
def({
  raw: "CBB-BACKUP-0001",
  meaning:
    "Backup, restore, history, Trash, or handoff verification failed.",
  defaultSeverity: "error",
  defaultDisposition: "block",
  acknowledgeable: false,
  defaultRecoveryActions: ["retry", "export-recovery-copy", "cancel"],
  redactionClass: "redacted-paths",
  retired: false,
});

// SECURITY
def({
  raw: "CBB-SECURITY-0001",
  meaning: "Required security validation/isolation failed.",
  defaultSeverity: "fatal",
  defaultDisposition: "block",
  acknowledgeable: false,
  defaultRecoveryActions: ["cancel"],
  redactionClass: "public",
  retired: false,
});

// AI
def({
  raw: "CBB-AI-0001",
  meaning: "Invalid/incompatible AI exchange or helper result.",
  defaultSeverity: "error",
  defaultDisposition: "block",
  acknowledgeable: false,
  defaultRecoveryActions: ["retry", "cancel"],
  redactionClass: "redacted-content",
  retired: false,
});

// PACKAGE
def({
  raw: "CBB-PACKAGE-0001",
  meaning: "Installed/bundled component verification failed.",
  defaultSeverity: "fatal",
  defaultDisposition: "block",
  acknowledgeable: false,
  defaultRecoveryActions: ["cancel"],
  redactionClass: "public",
  retired: false,
});

// Silence unused variable warning — entries is populated as a side effect
// of building the global catalog and is retained here for structural
// documentation purposes.
void entries;
