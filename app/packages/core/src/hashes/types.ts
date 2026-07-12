/**
 * Public contracts for deterministic CBB hashes.
 *
 * These contracts deliberately separate the render projection from the
 * persisted document model.  A render projection is already resolved and
 * stripped of editor identity, review state, and provenance before it reaches
 * this module.
 */

import type { Sha256Hash } from "../canonical/index.js";

export type HashJsonPrimitive = string | number | boolean | null;
export type HashJsonValue =
  | HashJsonPrimitive
  | readonly HashJsonValue[]
  | HashJsonObject;
export interface HashJsonObject {
  readonly [key: string]: HashJsonValue;
}

export type CanonicalRevisionToken = Sha256Hash;
export type FieldContractHash = Sha256Hash;
export type RenderInputHash = Sha256Hash;
export type ReadinessInputHash = Sha256Hash;

declare const sanitizedRenderProjectionBrand: unique symbol;

/**
 * A resolved, output-only projection. Construct it with
 * createSanitizedRenderProjection(); do not cast a persisted/resolved node
 * tree to this type.
 */
export type SanitizedRenderProjection = HashJsonObject & {
  readonly [sanitizedRenderProjectionBrand]: true;
};

export interface VerifiedAssetIdentity {
  readonly assetRef: string;
  readonly binaryHash: Sha256Hash;
  readonly mediaType: string;
}

export type FontEmbeddingMode = "full" | "subset";

export interface SelectedFontFaceIdentity {
  readonly faceId: string;
  readonly faceHash: Sha256Hash;
  readonly faceIndex: number;
  readonly embedding: FontEmbeddingMode;
  /** OpenType variation axis tag -> selected numeric value. */
  readonly variationAxes?: Readonly<Record<string, number>>;
}

export interface VerifiedFontIdentity {
  readonly fontRef: string;
  readonly familyDigest: Sha256Hash;
  readonly selectedFaces: readonly SelectedFontFaceIdentity[];
}

export interface PinnedToolIdentity {
  readonly toolId: string;
  readonly version: string;
  readonly toolHash: Sha256Hash;
}

export interface RenderLocaleIdentity {
  readonly languageTag: string;
  readonly dataVersion: string;
  readonly dataHash: Sha256Hash;
}

export type RenderWatermark =
  | { readonly kind: "none" }
  | {
      readonly kind: "draft" | "proof";
      readonly text: string;
      readonly version: string;
    };

export interface BookletImpositionOptions {
  readonly sheetWidth: string;
  readonly sheetHeight: string;
  readonly binding: "left" | "right";
  readonly duplexFlip: "shortEdge" | "longEdge";
  readonly scale: number;
  readonly logicalInputPdfHash: Sha256Hash;
}

/** Closed options that can change generated PDF bytes. */
export interface RenderOutputOptions {
  readonly outputForm: "readerOrder" | "bookletTwoUp";
  readonly pdfConformance: "standard" | "pdfUa1";
  readonly watermark: RenderWatermark;
  /** Required only for bookletTwoUp; forbidden for readerOrder. */
  readonly imposition?: BookletImpositionOptions;
}

export interface RenderHashInput {
  readonly projection: SanitizedRenderProjection;
  readonly assets: readonly VerifiedAssetIdentity[];
  readonly fonts: readonly VerifiedFontIdentity[];
  readonly tools: readonly PinnedToolIdentity[];
  readonly locale: RenderLocaleIdentity;
  readonly outputOptions: RenderOutputOptions;
}

export interface WeeklyReviewProjection {
  /** Stable active-resolution path; repeat segments use stable item ids. */
  readonly path: string;
  readonly expectation: "everyBulletin" | "whenDuplicated" | "none";
}

export interface RightsRecordReadinessProjection {
  readonly path: string;
  readonly records: readonly HashJsonValue[];
}

export interface RightsAssociationReadinessProjection {
  readonly path: string;
  readonly review: HashJsonValue;
}

export interface ScriptureImportReadinessProjection {
  readonly path: string;
  readonly snapshotEvidence: HashJsonValue;
  readonly review: HashJsonValue;
}

/**
 * Readiness-only portable document state. Missing optional document values are
 * materialized by projectDocumentReadinessState so equivalent documents hash
 * identically.
 */
export interface DocumentReadinessProjection {
  readonly metadataContext: HashJsonValue;
  readonly rightsPolicy: HashJsonValue;
  readonly publicationContexts: readonly string[];
  readonly fieldReview: readonly HashJsonValue[];
  /** Current resolvable target/value plus evaluated active binding/rule uses. */
  readonly fieldReviewContexts: readonly HashJsonValue[];
  readonly contentReview: readonly HashJsonValue[];
  /** Current evaluated conditional context for portable content-review targets. */
  readonly contentReviewContexts: readonly HashJsonValue[];
  readonly pageChecks: HashJsonValue;
  readonly weeklyReviews: readonly WeeklyReviewProjection[];
  readonly rightsRecords: readonly RightsRecordReadinessProjection[];
  readonly rightsAssociations: readonly RightsAssociationReadinessProjection[];
  readonly scriptureImports: readonly ScriptureImportReadinessProjection[];
}

export type ReadinessProfileId =
  | "draft"
  | "printFinal"
  | "accessibleFinal";

export interface ReadinessProfileIdentity {
  readonly profileId: ReadinessProfileId;
  readonly version: string;
  readonly rulesHash: Sha256Hash;
}

export type ReadinessEvidenceKind =
  | "dependencyValidation"
  | "privateWorkAcknowledgement"
  | "scriptureImportReview"
  | "rightsFinding"
  | "rightsAssociationReview"
  | "generatedRightsCoverage"
  | "publicationLicenseEvaluation"
  | "usagePolicyEvaluation"
  | "pageCountEvaluation"
  | "warningAcknowledgement"
  | "accessibilityValidation";

export type ReadinessEvidenceStatus =
  | "pass"
  | "warning"
  | "block"
  | "acknowledged"
  | "notApplicable";

/**
 * One typed readiness result. evidenceHash commits the corresponding closed
 * evaluation projection without embedding raw source text, URLs, or timestamps
 * in the readiness input.
 */
export interface ReadinessEvidenceRecord {
  readonly kind: ReadinessEvidenceKind;
  readonly subject: string;
  readonly status: ReadinessEvidenceStatus;
  readonly evidenceHash: Sha256Hash;
}

export interface ReadinessHashInput {
  readonly renderInputHash: Sha256Hash;
  readonly profile: ReadinessProfileIdentity;
  readonly projection: DocumentReadinessProjection;
  /** Semantically unordered; normalized by kind + subject. */
  readonly evidence: readonly ReadinessEvidenceRecord[];
}
