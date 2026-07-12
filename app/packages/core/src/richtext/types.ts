/**
 * Rich-text AST types for @cbb/core.
 *
 * Derived from spec.md §"Text" (lines 2271-2346) and §"Scripture Import And
 * Formatting" (lines 2347-2521). The vocabulary is closed: only these node and
 * mark kinds are valid in v1.
 *
 * Runtime-agnostic — no Node.js or browser globals used here.
 */

import type { RightsRecord } from "../document/types.js";

// ---------------------------------------------------------------------------
// Inline marks
// ---------------------------------------------------------------------------

/** v1 mark kinds — exactly `strong` then `emphasis` in canonical order. */
export type MarkKind = "strong" | "emphasis";

/** Canonical mark order index (lower = earlier in canonical ordering). */
export const MARK_ORDER: Readonly<Record<MarkKind, number>> = {
  strong: 0,
  emphasis: 1,
};

// ---------------------------------------------------------------------------
// Inline nodes
// ---------------------------------------------------------------------------

/**
 * A text leaf. `text` must be a non-empty Unicode string. `marks` is an
 * optional array of unique mark kinds in canonical order.
 */
export interface TextNode {
  readonly type: "text";
  readonly text: string;
  /** Canonical order: strong before emphasis. Absence and [] are equivalent. */
  readonly marks?: readonly MarkKind[];
}

/** An explicit line break within the current block. Carries no attributes. */
export interface LineBreakNode {
  readonly type: "lineBreak";
}

export type InlineNode = TextNode | LineBreakNode;

// ---------------------------------------------------------------------------
// Scripture-specific inline children
//
// Spec: verse.children and paragraph.children use the shared marks (text +
// lineBreak). We reuse InlineNode here.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Scripture block
// ---------------------------------------------------------------------------

/**
 * One verse in a `verseStructured` scripture block.
 *
 * Spec: "Each has a canonical verse id, bounded display label, paragraphStart,
 * and ordered inline text/lineBreak children using the shared marks."
 */
export interface ScriptureVerse {
  /** Canonical verse id (e.g. "John.3.16"). Unique within block, in passage order. */
  readonly verseId: string;
  /** Bounded display label (e.g. "16" or "16–17"). */
  readonly label: string;
  /**
   * True when this verse begins a publisher paragraph. Used by the renderer to
   * honour `paragraphPolicy: "publisher"`.
   */
  readonly paragraphStart: boolean;
  /** Ordered inline children; an empty verse body is schema-valid while editing. */
  readonly children: readonly InlineNode[];
}

/**
 * One paragraph in a `paragraphOnly` scripture block.
 * Children follow the shared inline model.
 */
export interface ScriptureParagraph {
  readonly type: "paragraph";
  /** Ordered inline children; an empty paragraph body is schema-valid while editing. */
  readonly children: readonly InlineNode[];
}

/**
 * Scripture-block formatting override / document-wide presentation shape.
 *
 * Spec: "Optional closed formattingOverride; without it the block uses the
 * top-level scripturePresentation."
 *
 * The shared shape contains all these v1 fields. Defaults (when absent from a
 * document-level setting):
 *   referencePlacement:        "before"
 *   verseNumberStyle:          "superscript"
 *   paragraphPolicy:           "publisher"
 *   paragraphSpacing:          "6pt"
 *   translationLabelPlacement: "withReference"
 *   typographyPresetSnapshot:  absent (inherit surrounding resolved body style)
 */
export interface ScriptureFormatting {
  readonly referencePlacement: "before" | "after";
  readonly verseNumberStyle: "inline" | "superscript" | "hidden";
  readonly paragraphPolicy: "publisher" | "oneVerse";
  /** Non-negative physical length, e.g. "6pt", "0.5in". */
  readonly paragraphSpacing: string;
  readonly translationLabelPlacement:
    | "withReference"
    | "afterPassage"
    | "hidden";
  /** Optional named typography-preset snapshot. */
  readonly typographyPresetSnapshot?: Readonly<Record<string, unknown>>;
}

/** v1 defaults for `ScriptureFormatting` when fields are absent. */
export const SCRIPTURE_FORMATTING_DEFAULTS: Readonly<
  Required<Omit<ScriptureFormatting, "typographyPresetSnapshot">>
> = {
  referencePlacement: "before",
  verseNumberStyle: "superscript",
  paragraphPolicy: "publisher",
  paragraphSpacing: "6pt",
  translationLabelPlacement: "withReference",
};

/**
 * Closed `sourceCatalog` record inside a scripture block.
 */
export interface ScriptureSourceCatalog {
  /** Must match the block's `translationId`. */
  readonly translationId: string;
  /** Positive catalog revision integer. */
  readonly catalogRevision: number;
  /** SHA-256 hex digest of the catalog entry at `catalogRevision`. */
  readonly revisionHash: string;
  /** Copied display label from the catalog record. */
  readonly displayLabel?: string;
  /** Copied source label from the catalog record. */
  readonly sourceLabel?: string;
}

/** @deprecated Scripture rights use the shared persisted RightsRecord shape. */
export type ScriptureTranslationRecord = RightsRecord;

/** Disposition of a block import review. */
export type ImportReviewDisposition = "changesConfirmed";

/** Closed `importReview` record attached to a scripture block. */
export interface ScriptureImportReview {
  readonly disposition: ImportReviewDisposition;
  /** SHA-256 hex digest of the reviewed passage-fidelity projection. */
  readonly reviewedFidelityHash: string;
  /**
   * SHA-256 hex digest of ordered (creditKey, creditProjectionHash) pairs at
   * time of review.
   */
  readonly reviewedRightsProjectionHash: string;
  /** ISO-8601 review timestamp. */
  readonly reviewTime: string;
}

export interface ScriptureVerseBoundary {
  readonly verseId: string;
  readonly label: string;
}

export interface ScriptureParagraphBoundary {
  readonly paragraphIndex: number;
  readonly content?: string;
}

interface ImportSnapshotCommon {
  readonly displayReference: string;
  readonly translationId: string;
  readonly translationLabel: string;
  /** Normalizer/importer identifier. */
  readonly normalizerId: string;
  readonly normalizerVersion: string;
  /** Exact sanitized source text captured at import. */
  readonly sourceText: string;
  /** SHA-256 hex digest of `sourceText`. */
  readonly sourceTextHash: string;
  /** SHA-256 hex digest of the passage-fidelity projection at import. */
  readonly importedFidelityHash: string;
  /**
   * SHA-256 hex digest of ordered (creditKey, creditProjectionHash) pairs plus
   * source evidence captured at import.
   */
  readonly rightsProjectionHash: string;
  readonly verseBoundaries?: readonly ScriptureVerseBoundary[];
  readonly paragraphBoundaries?: readonly ScriptureParagraphBoundary[];
  /** Optional validated canonical HTTPS source URL (never auto-fetched). */
  readonly sourceUrl?: string;
}

interface VerseStructuredImportFields {
  readonly structureKind: "verseStructured";
  readonly canonicalReference: string;
  readonly verseBoundaries: readonly ScriptureVerseBoundary[];
  readonly paragraphBoundaries?: readonly ScriptureParagraphBoundary[];
}

interface ParagraphOnlyImportFields {
  readonly structureKind: "paragraphOnly";
  readonly canonicalReference?: string;
  readonly paragraphBoundaries: readonly ScriptureParagraphBoundary[];
  readonly verseBoundaries?: readonly ScriptureVerseBoundary[];
}

type ImportStructureFields =
  | VerseStructuredImportFields
  | ParagraphOnlyImportFields;

/** Discriminated import snapshot — `paste` arm. */
export type PasteImportSnapshot = ImportSnapshotCommon & ImportStructureFields & {
  readonly sourceKind: "paste";
  /** Optional user-supplied source label (inert). */
  readonly sourceLabel?: string;
};

/** Discriminated import snapshot — `provider` arm. */
export type ProviderImportSnapshot = ImportSnapshotCommon & ImportStructureFields & {
  readonly sourceKind: "provider";
  readonly providerId: string;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly requestedReference: string;
  readonly requestedTranslationId: string;
  /** ISO-8601 retrieval timestamp. */
  readonly retrievalTime: string;
};

export type ScriptureImportSnapshot =
  | PasteImportSnapshot
  | ProviderImportSnapshot;

export type VerseStructuredImportSnapshot = Extract<
  ScriptureImportSnapshot,
  { readonly structureKind: "verseStructured" }
>;
export type ParagraphOnlyImportSnapshot = Extract<
  ScriptureImportSnapshot,
  { readonly structureKind: "paragraphOnly" }
>;

/**
 * `verseStructured` scripture block.
 *
 * Spec: "A verseStructured block has ordered nonempty verses."
 */
export interface VerseStructuredScriptureBlock {
  readonly type: "scripture";
  readonly structureKind: "verseStructured";
  /** Non-empty display reference. */
  readonly reference: string;
  /**
   * Canonical reference in the app's documented OSIS-compatible subset.
   * Required for `verseStructured`.
   */
  readonly canonicalReference: string;
  /** `translation:<uuid>` form. */
  readonly translationId: string;
  readonly translationLabel: string;
  readonly sourceCatalog?: ScriptureSourceCatalog;
  /** Ordered non-empty verses with unique ids in canonical passage order. */
  readonly verses: readonly ScriptureVerse[];
  /** If absent, uses the document-level `scripturePresentation`. */
  readonly formattingOverride?: ScriptureFormatting;
  readonly importSnapshot?: VerseStructuredImportSnapshot;
  /** At least one `scriptureTranslation` record required. */
  readonly rights: readonly ScriptureTranslationRecord[];
  readonly importReview?: ScriptureImportReview;
}

/**
 * `paragraphOnly` scripture block.
 *
 * Spec: "A paragraphOnly block has ordered nonempty paragraphs."
 */
export interface ParagraphOnlyScriptureBlock {
  readonly type: "scripture";
  readonly structureKind: "paragraphOnly";
  /**
   * Spec: "paragraphOnly without import evidence may retain an empty legacy/
   * incomplete draft reference".
   */
  readonly reference?: string;
  readonly canonicalReference?: string;
  readonly translationId: string;
  readonly translationLabel?: string;
  readonly sourceCatalog?: ScriptureSourceCatalog;
  /** Ordered non-empty paragraphs. */
  readonly paragraphs: readonly ScriptureParagraph[];
  readonly formattingOverride?: ScriptureFormatting;
  readonly importSnapshot?: ParagraphOnlyImportSnapshot;
  readonly rights: readonly ScriptureTranslationRecord[];
  readonly importReview?: ScriptureImportReview;
}

export type ScriptureBlock =
  | VerseStructuredScriptureBlock
  | ParagraphOnlyScriptureBlock;

// ---------------------------------------------------------------------------
// Block nodes
// ---------------------------------------------------------------------------

export interface ParagraphBlock {
  readonly type: "paragraph";
  readonly children: readonly InlineNode[];
}

/**
 * Heading block. `level` must be 1–6 (inclusive).
 * Spec: "invalid heading levels … are not [valid]."
 */
export interface HeadingBlock {
  readonly type: "heading";
  /** 1–6 inclusive. */
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
  readonly children: readonly InlineNode[];
}

export interface ListItemBlock {
  readonly type: "listItem";
  /** One or more paragraph or nested-list blocks. */
  readonly children: readonly (ParagraphBlock | BulletListBlock | OrderedListBlock)[];
}

/**
 * Bullet list. Spec: lists may nest at most four levels.
 */
export interface BulletListBlock {
  readonly type: "bulletList";
  readonly children: readonly ListItemBlock[];
}

/**
 * Ordered list. Spec: optional positive `start`.
 */
export interface OrderedListBlock {
  readonly type: "orderedList";
  /** Optional positive integer start value. */
  readonly start?: number;
  readonly children: readonly ListItemBlock[];
}

/**
 * Blockquote. Contains one or more paragraph or list blocks.
 * Spec: "blockquote: one or more paragraph/list blocks."
 */
export interface BlockquoteBlock {
  readonly type: "blockquote";
  readonly children: readonly (
    | ParagraphBlock
    | BulletListBlock
    | OrderedListBlock
  )[];
}

export type BlockNode =
  | ParagraphBlock
  | HeadingBlock
  | BulletListBlock
  | OrderedListBlock
  | BlockquoteBlock
  | ScriptureBlock;

// ---------------------------------------------------------------------------
// Document root
// ---------------------------------------------------------------------------

/**
 * The v1 rich-text AST root.
 * Spec: `{ "type": "document", "blocks": [...] }`
 * "Empty documents are valid while editing."
 */
export interface RichTextDocument {
  readonly type: "document";
  readonly blocks: readonly BlockNode[];
}
