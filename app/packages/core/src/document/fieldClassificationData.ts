/**
 * @cbb/core/document/fieldClassificationData — Field classification catalog
 * for the document, element, and related schemas.
 *
 * Every persisted field path in the document JSON schema is classified as:
 *   - renderAffecting  — change forces Typst re-generation (PDF bytes change)
 *   - readinessOnly    — change affects publication readiness, not PDF bytes
 *   - inert            — change affects neither rendering nor readiness
 *
 * Classification semantics per spec §Persistence And Build (4126-4260):
 *   renderInputHash excludes: authoring policies, source lineage, orphaned
 *   values, template samples, field origins/field/content review records,
 *   stable UI item ids, Scripture source URL/retrieval/raw-source evidence,
 *   rights provenance/Song Library lineage, and unknown inert preservation.
 *
 *   readinessInputHash additionally includes: field/content review, rights
 *   policy, publication contexts, print-safe/booklet insets.
 *
 * This module exports:
 *   - DOCUMENT_FIELD_CLASSIFICATIONS — array of entries for document schema
 *   - registerDocumentClassifications(catalog) — register into a catalog
 */

import type {
  FieldClassificationCatalog,
  FieldClassificationEntry,
} from "../schema/index.js";

export const DOCUMENT_SCHEMA_ID =
  "https://church-bulletin-builder.local/schema/v1/document.schema.json";

export const ELEMENT_SCHEMA_ID =
  "https://church-bulletin-builder.local/schema/v1/element.schema.json";

export const COMMON_SCHEMA_ID =
  "https://church-bulletin-builder.local/schema/v1/common.schema.json";

// ---------------------------------------------------------------------------
// Document root field classifications
// ---------------------------------------------------------------------------

export const DOCUMENT_FIELD_CLASSIFICATIONS: readonly FieldClassificationEntry[] =
  [
    // --- Structural / version ---
    {
      path: "version",
      classification: "inert",
      reason:
        "Schema version number; does not affect rendering or readiness " +
        "directly (format already validated).",
    },
    {
      path: "kind",
      classification: "inert",
      reason:
        "bulletin vs template affects workflow only, not PDF output.",
    },
    {
      path: "name",
      classification: "inert",
      reason:
        "User-facing document label; appears in build artifact filenames but " +
        "does not change PDF bytes.",
    },

    // --- Metadata ---
    {
      path: "metadata",
      classification: "readinessOnly",
      reason:
        "publicationDate / serviceLabel affect field-review readiness and the " +
        "duplicate-date warning, but do not change rendered PDF bytes. The " +
        "publication date that affects rendering is the resolved field value " +
        "behind the binding, not the metadata mirror.",
    },

    // --- Page setup ---
    {
      path: "page",
      classification: "renderAffecting",
      reason:
        "Physical page dimensions, margins, background, and layout intent " +
        "directly control PDF page geometry. printSafeInset is readiness-only " +
        "(review guides) but the page object as a whole is render-affecting; " +
        "finer-grained subfield classification is done at build-hash time.",
    },

    // --- Authoring policy ---
    {
      path: "authoringPolicy",
      classification: "inert",
      reason:
        "Content/layout locks are editorial guardrails; spec explicitly states " +
        "locks never affect PDF bytes.",
    },

    // --- Font stack ---
    {
      path: "fontFallbackRefs",
      classification: "renderAffecting",
      reason:
        "The document font fallback stack determines which face binaries are " +
        "resolved and embedded in the PDF.",
    },

    // --- Scripture presentation ---
    {
      path: "scripturePresentation",
      classification: "renderAffecting",
      reason:
        "Controls reference placement, verse-number style, paragraph policy, " +
        "spacing, and translation label placement for all Scripture blocks.",
    },

    // --- Rights policy ---
    {
      path: "rightsPolicy",
      classification: "readinessOnly",
      reason:
        "Determines readiness-check behavior for unknown rights; does not " +
        "change rendered credit lines by itself.",
    },

    // --- Publication contexts ---
    {
      path: "publicationContexts",
      classification: "readinessOnly",
      reason:
        "Affects which rights-policy snapshots apply and readiness findings; " +
        "changing contexts is readiness-only per spec (only rights-record edits " +
        "may change rendered lines/pagination).",
    },

    // --- Field contract ---
    {
      path: "fieldContract",
      classification: "renderAffecting",
      reason:
        "Contract definition affects which fields are resolvable; a contract " +
        "change that removes a binding target can alter rendered output.",
    },

    // --- Field values ---
    {
      path: "fieldValues",
      classification: "renderAffecting",
      reason:
        "Bound field values are materialized into rendered content. Origin " +
        "sub-field is excluded from renderInputHash (it's readiness metadata) " +
        "but the value itself is render-affecting.",
    },

    // --- Field review ---
    {
      path: "fieldReview",
      classification: "readinessOnly",
      reason:
        "Review records affect publication readiness. Spec explicitly excludes " +
        "field review records from renderInputHash.",
    },

    // --- Content rules ---
    {
      path: "contentRules",
      classification: "renderAffecting",
      reason:
        "Conditional and repeat rules control which elements appear in rendered " +
        "output. Spec: 'A conditional rule is output-affecting portable document " +
        "state and must be included in build signatures.'",
    },

    // --- Content review ---
    {
      path: "contentReview",
      classification: "readinessOnly",
      reason:
        "Content-review records affect readiness only; spec explicitly excludes " +
        "content review records from renderInputHash.",
    },

    // --- Body elements ---
    {
      path: "elements",
      classification: "renderAffecting",
      reason:
        "The body element array is the primary document content; all element " +
        "data, style, and layout fields are render-affecting.",
    },

    // --- Page elements ---
    {
      path: "pageElements",
      classification: "renderAffecting",
      reason:
        "Page-level elements (headers, footers, backgrounds) appear in PDF " +
        "output.",
    },

    // --- Template-only sample values ---
    {
      path: "sampleFieldValues",
      classification: "inert",
      reason:
        "Output-inert sample values for template preview; spec explicitly " +
        "excludes template samples from renderInputHash.",
    },

    // --- Source template lineage ---
    {
      path: "sourceTemplate",
      classification: "inert",
      reason:
        "Portable lineage record; spec explicitly excludes source lineage from " +
        "renderInputHash.",
    },

    // --- Custom element definitions ---
    {
      path: "customElementDefinitions",
      classification: "renderAffecting",
      reason:
        "Pinned custom element definitions are expanded during rendering; their " +
        "elements, field contracts, and content rules are render-affecting.",
    },

    // --- Orphaned field values ---
    {
      path: "orphanedFieldValues",
      classification: "inert",
      reason:
        "Inert map of removed/incompatible field values; renderer ignores this " +
        "map per spec.",
    },
  ];

// ---------------------------------------------------------------------------
// Element schema field classifications (top-level element fields)
// ---------------------------------------------------------------------------

export const ELEMENT_FIELD_CLASSIFICATIONS: readonly FieldClassificationEntry[] =
  [
    { path: "id", classification: "inert", reason: "Stable node identifier; not rendered." },
    { path: "type", classification: "renderAffecting", reason: "Element type determines rendering branch." },
    { path: "name", classification: "inert", reason: "Inspector label only." },
    { path: "width", classification: "renderAffecting", reason: "Controls element layout geometry." },
    { path: "height", classification: "renderAffecting", reason: "Controls element layout geometry." },
    { path: "breakPolicy", classification: "renderAffecting", reason: "Controls page fragmentation." },
    { path: "margin", classification: "renderAffecting", reason: "Vertical flow spacing affects layout." },
    { path: "padding", classification: "renderAffecting", reason: "Inset affects content box." },
    { path: "style", classification: "renderAffecting", reason: "Visual style (font, color, etc.) is render-affecting." },
    {
      path: "fieldContract",
      classification: "renderAffecting",
      reason: "Element-scoped contract; binding resolution depends on it.",
    },
    {
      path: "fieldValues",
      classification: "renderAffecting",
      reason: "Bound values materialized into content.",
    },
    {
      path: "bindings",
      classification: "renderAffecting",
      reason: "Bindings wire field values to content leaves.",
    },
    {
      path: "authoringPolicy",
      classification: "inert",
      reason: "Content/layout locks never affect PDF bytes.",
    },
    {
      path: "weeklyReview",
      classification: "readinessOnly",
      reason: "Authoring hint for stale-content review; not PDF bytes.",
    },
    {
      path: "data",
      classification: "renderAffecting",
      reason: "Type-specific content data drives rendering.",
    },
    {
      path: "children",
      classification: "renderAffecting",
      reason: "Container children are rendered recursively.",
    },
  ];

// ---------------------------------------------------------------------------
// Registration helper
// ---------------------------------------------------------------------------

/**
 * Register all document-module field classifications into the given catalog.
 * Safe to call multiple times on different catalog instances (each is
 * independent). Throws if called twice on the same catalog instance.
 */
export function registerDocumentClassifications(
  catalog: FieldClassificationCatalog
): void {
  catalog.register(DOCUMENT_SCHEMA_ID, DOCUMENT_FIELD_CLASSIFICATIONS);
  catalog.register(ELEMENT_SCHEMA_ID, ELEMENT_FIELD_CLASSIFICATIONS);
}
