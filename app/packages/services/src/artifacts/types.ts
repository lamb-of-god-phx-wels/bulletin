import type { Sha256Hash } from "@cbb/core";
import type {
  BuildOutputHandle,
  CompileArtifactSinkPort,
} from "../build/runner.js";

export type ArtifactKind = "preview" | "draft" | "finalCandidate" | "importedDiagnostic";
export type ArtifactStatus = "queued" | "running" | "succeeded" | "failed" | "canceled" | "timedOut";
export type ArtifactExecutionMode = "compile" | "compose" | "revalidate";
export type ArtifactOutputForm = "readerOrder" | "bookletTwoUp";
export type ArtifactReadinessProfile = "draft" | "printFinal" | "accessibleFinal";

export interface ArtifactToolIdentity {
  readonly toolId: string;
  readonly version: string;
  readonly hash: Sha256Hash;
}

export interface ArtifactSchemaIdentity {
  readonly schemaId: string;
  readonly version: number;
  readonly hash: Sha256Hash;
}

export interface ArtifactWatermark {
  readonly kind: "draft" | "proof";
  readonly text: string;
  readonly version: string;
}

export interface ArtifactVerifiedAsset {
  readonly assetRef: string;
  readonly binaryHash: Sha256Hash;
  readonly byteSize: number;
  readonly mediaType: string;
}

export interface ArtifactVerifiedFontFace {
  readonly fontRef: string;
  readonly familyDigest: Sha256Hash;
  readonly faceId: string;
  readonly faceHash: Sha256Hash;
  readonly byteSize: number;
  readonly embeddingPermitted: boolean;
  readonly subsettingPermitted: boolean;
}

export interface ArtifactResourceClosure {
  readonly assets: readonly ArtifactVerifiedAsset[];
  readonly fontFaces: readonly ArtifactVerifiedFontFace[];
}

export interface ArtifactPdfEvidence {
  readonly relativePath: string;
  readonly hash: Sha256Hash;
  readonly byteSize: number;
  readonly pageCount: number;
  readonly pdfVersion: string;
  readonly standards?: readonly string[];
  readonly validationReportHash?: Sha256Hash;
}

export interface ArtifactCompileEvidence {
  readonly mode: "compile";
  readonly renderProjectionHash: Sha256Hash;
  readonly typstRelativePath: string;
  readonly typstHash: Sha256Hash;
  readonly generatorVersion: string;
  readonly pdf: ArtifactPdfEvidence;
  readonly resources: ArtifactResourceClosure;
}

export interface ArtifactComposeEvidence {
  readonly mode: "compose";
  readonly parentReaderBuildId: string;
  readonly parentReaderPdfHash: Sha256Hash;
  readonly parentRenderInputHash: Sha256Hash;
  readonly logicalPageCount: number;
  readonly imposedSideCount: number;
  readonly compositor: ArtifactToolIdentity;
  readonly pdf: ArtifactPdfEvidence;
  readonly resources: ArtifactResourceClosure;
}

export interface ArtifactRevalidateEvidence {
  readonly mode: "revalidate";
  readonly sourceRenderBuildId: string;
  readonly sourcePdfHash: Sha256Hash;
  readonly sourceRenderInputHash: Sha256Hash;
  readonly sourceTypstHash?: Sha256Hash;
  readonly pdf: ArtifactPdfEvidence;
  readonly resources: ArtifactResourceClosure;
}

export type ArtifactOutputEvidence =
  | ArtifactCompileEvidence
  | ArtifactComposeEvidence
  | ArtifactRevalidateEvidence;

export interface ArtifactRecord {
  readonly version: 1;
  readonly kind: "artifactRecord";
  readonly buildId: string;
  readonly bulletinLocalId: string;
  readonly artifactKind: ArtifactKind;
  readonly status: ArtifactStatus;
  readonly executionMode: ArtifactExecutionMode;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly outputForm: ArtifactOutputForm;
  readonly readinessProfile: ArtifactReadinessProfile;
  readonly canonicalRevisionToken: Sha256Hash;
  readonly renderInputHash: Sha256Hash;
  readonly readinessInputHash?: Sha256Hash;
  readonly editGeneration?: number;
  readonly requestSequence?: number;
  readonly watermark?: ArtifactWatermark;
  readonly toolIdentities: readonly ArtifactToolIdentity[];
  readonly schemaIdentities: readonly ArtifactSchemaIdentity[];
  readonly diagnosticCodes: readonly string[];
  readonly boundedLogRef?: string;
  readonly outputEvidence?: ArtifactOutputEvidence;
}

/** Caller-provided metadata shared by successful mode-specific installs. */
export type SuccessfulArtifactMetadata = Omit<
  ArtifactRecord,
  "version" | "kind" | "status" | "executionMode" | "outputEvidence"
> & {
  readonly startedAt: string;
  readonly completedAt: string;
};

/** Fixed-layout locators contain identities only; callers cannot supply paths. */
export interface ArtifactRecordLocator {
  readonly kind: "artifactRecord";
  readonly bulletinLocalId: string;
  readonly buildId: string;
}

export interface ArtifactOwnedByteLocator {
  readonly kind: "artifactOwnedByte";
  readonly bulletinLocalId: string;
  readonly buildId: string;
  readonly extension: "typ" | "pdf";
}

export type ArtifactLocator = ArtifactRecordLocator | ArtifactOwnedByteLocator;

export interface ArtifactStoragePort {
  readRecord(locator: ArtifactRecordLocator): Promise<unknown | undefined>;
  /** Atomic durable create; false means the immutable locator already exists. */
  installRecordExclusive(locator: ArtifactRecordLocator, record: ArtifactRecord): Promise<boolean>;
  deleteRecordIfUnchanged(locator: ArtifactRecordLocator, record: ArtifactRecord): Promise<boolean>;

  readOwnedByte(locator: ArtifactOwnedByteLocator): Promise<Uint8Array | undefined>;
  /** Atomic durable create; false means the immutable locator already exists. */
  installOwnedByteExclusive(locator: ArtifactOwnedByteLocator, bytes: Uint8Array): Promise<boolean>;
  deleteOwnedByteIfHash(locator: ArtifactOwnedByteLocator, hash: Sha256Hash): Promise<boolean>;
}

export interface ArtifactRecordValidatorPort {
  /** Validate against the closed v1 artifact-record schema. */
  validate(record: unknown): Promise<boolean> | boolean;
}

export interface ArtifactHashPort {
  digest(bytes: Uint8Array): Promise<Sha256Hash> | Sha256Hash;
}

export interface ObservedPdfIdentity {
  readonly hash: Sha256Hash;
  readonly byteSize: number;
  readonly pageCount: number;
  readonly pdfVersion: string;
  readonly standards?: readonly string[];
  readonly validationReportHash?: Sha256Hash;
}

export interface ArtifactPdfValidatorPort {
  /** Parse, bound, magic-check, and hash the exact supplied PDF bytes. */
  verify(bytes: Uint8Array): Promise<ObservedPdfIdentity>;
}

export interface CompileOutputReaderPort {
  readVerifiedPdf(handle: BuildOutputHandle): Promise<Uint8Array>;
}

export interface CompileArtifactInstallRequest {
  readonly metadata: SuccessfulArtifactMetadata;
  readonly source: Uint8Array;
  readonly sourceHash: Sha256Hash;
  readonly pdfBytes: Uint8Array;
  readonly expectedPdf: Omit<ArtifactPdfEvidence, "relativePath">;
  readonly renderProjectionHash: Sha256Hash;
  readonly generatorVersion: string;
  readonly resources: ArtifactResourceClosure;
}

export interface ComposeArtifactInstallRequest {
  readonly metadata: SuccessfulArtifactMetadata;
  readonly pdfBytes: Uint8Array;
  readonly expectedPdf: Omit<ArtifactPdfEvidence, "relativePath">;
  readonly parentReaderBuildId: string;
  readonly parentRenderInputHash: Sha256Hash;
  readonly logicalPageCount: number;
  readonly imposedSideCount: number;
  readonly compositor: ArtifactToolIdentity;
  readonly resources: ArtifactResourceClosure;
}

export interface RevalidateArtifactInstallRequest {
  readonly metadata: SuccessfulArtifactMetadata;
  readonly sourceRenderBuildId: string;
}

export interface CompileArtifactSinkBinding {
  readonly metadata: SuccessfulArtifactMetadata;
  readonly renderProjectionHash: Sha256Hash;
  readonly generatorVersion: string;
  readonly resources: ArtifactResourceClosure;
  readonly outputReader: CompileOutputReaderPort;
}

export type BoundCompileArtifactSink = CompileArtifactSinkPort<ArtifactRecord>;

export interface ArtifactCurrencyInputs {
  readonly renderInputHash: Sha256Hash;
  readonly readinessInputHash?: Sha256Hash;
  readonly outputForm: ArtifactOutputForm;
  readonly readinessProfile: ArtifactReadinessProfile;
}

export interface ArtifactCurrencyResult {
  readonly visualCurrent: boolean;
  readonly readinessCurrent: boolean;
  readonly current: boolean;
  readonly reasons: readonly (
    | "notSucceeded"
    | "notPublishableKind"
    | "renderInputChanged"
    | "readinessInputChanged"
    | "outputFormChanged"
    | "readinessProfileChanged"
  )[];
}

export interface ArtifactStorePorts {
  readonly storage: ArtifactStoragePort;
  readonly records: ArtifactRecordValidatorPort;
  readonly hashes: ArtifactHashPort;
  readonly pdfs: ArtifactPdfValidatorPort;
}
