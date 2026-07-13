import type {
  LocalResourceId,
  PortableAssetRef,
  PortableFontRef,
  Sha256Hash,
  VerifiedAssetIdentity,
  VerifiedFontIdentity,
} from "@cbb/core";

export type AssetSanitizationState = "pending" | "validated" | "failed";
export type AssetAiVisibility = "private" | "approved" | "public";

export interface AssetSanitizerIdentity {
  readonly toolId: string;
  readonly version: string;
  readonly toolHash: Sha256Hash;
}

export interface AssetSourceOriginalIdentity {
  readonly hash: Sha256Hash;
  readonly byteSize: number;
}

/**
 * Runtime service representation of asset-record.schema.json.
 *
 * There is deliberately no storage-path property. The resource store derives
 * its fixed location from localId and the verifier accepts only the opaque
 * locator below.
 */
export interface AssetRevisionRecord {
  readonly version: 1;
  readonly kind: "assetRecord";
  readonly localId: LocalResourceId;
  readonly portableAssetId: PortableAssetRef;
  readonly displayName: string;
  readonly originalFilename?: string;
  readonly mediaType: string;
  readonly canonicalHash: Sha256Hash;
  readonly byteSize: number;
  readonly width?: number;
  readonly height?: number;
  readonly sanitizationState: AssetSanitizationState;
  readonly sanitizer?: AssetSanitizerIdentity;
  readonly sourceOriginal?: AssetSourceOriginalIdentity;
  readonly aiVisibility: AssetAiVisibility;
  readonly importedAt: string;
}

export type FontValidationState = "pending" | "validated" | "failed";
export type ManagedFontFormat = "ttf" | "otf" | "woff" | "woff2";
export type ManagedFontStyle = "normal" | "italic" | "oblique";

export interface ManagedFontFaceRecord {
  readonly faceId: string;
  readonly faceIndex: number;
  readonly format: ManagedFontFormat;
  readonly weight: number;
  readonly style: ManagedFontStyle;
  readonly stretch: number;
  readonly variableAxisCoordinates?: Readonly<Record<string, number>>;
  readonly hash: Sha256Hash;
  readonly byteSize: number;
}

/** Runtime service representation of font-record.schema.json. */
export interface FontRevisionRecord {
  readonly version: 1;
  readonly kind: "fontRecord";
  readonly localId: LocalResourceId;
  readonly portableFontId: PortableFontRef;
  readonly familyDigest: Sha256Hash;
  readonly displayName: string;
  readonly originalName?: string;
  readonly familyName?: string;
  readonly internalName?: string;
  readonly postScriptName?: string;
  readonly typstFamilyName: string;
  readonly licenseId?: string;
  readonly licenseTextRef?: string;
  readonly redistributionAsserted: boolean;
  readonly exportable: boolean;
  readonly pdfEmbeddingPermitted: boolean;
  readonly pdfSubsettingPermitted: boolean;
  readonly validationState: FontValidationState;
  readonly validatingAppVersion?: string;
  readonly validatingTypstVersion?: string;
  readonly unicodeCoverageSummary?: string;
  readonly faces: readonly ManagedFontFaceRecord[];
}

export interface ResourceResolverIndex {
  readonly assetsByRef: ReadonlyMap<PortableAssetRef, AssetRevisionRecord>;
  readonly fontsByRef: ReadonlyMap<PortableFontRef, FontRevisionRecord>;
}

/**
 * Opaque fixed-layout locator understood only by the injected resource store.
 * Neither variant can carry a caller-provided filesystem path.
 */
export type ResourceByteLocator =
  | {
      readonly kind: "assetCanonical";
      readonly localId: LocalResourceId;
    }
  | {
      readonly kind: "fontFace";
      readonly localId: LocalResourceId;
      readonly faceId: string;
    };

export interface ResourceByteVerificationRequest {
  readonly locator: ResourceByteLocator;
  readonly expectedHash: Sha256Hash;
  readonly expectedByteSize: number;
  readonly maximumByteSize: number;
}

export interface ResourceByteVerificationResult {
  readonly observedHash: Sha256Hash;
  readonly observedByteSize: number;
}

/**
 * The implementation must open a regular file without following links, hash
 * it while enforcing maximumByteSize, and close the handle before resolving.
 */
export interface NoFollowResourceByteVerifier {
  verify(
    request: ResourceByteVerificationRequest,
  ): Promise<ResourceByteVerificationResult>;
}

export interface ResourceProjectionReferences {
  readonly referencedAssets: readonly { readonly assetRef: string }[];
  readonly referencedFonts: readonly { readonly fontRef: string }[];
  readonly fontFallbackRefs: readonly PortableFontRef[];
}

export interface ResolveResourceClosureRequest {
  readonly projection: ResourceProjectionReferences;
  readonly index: ResourceResolverIndex;
  readonly verifier: NoFollowResourceByteVerifier;
}

export interface AssetStagingEntry {
  readonly kind: "asset";
  readonly assetRef: PortableAssetRef;
  readonly locator: ResourceByteLocator & { readonly kind: "assetCanonical" };
  /** App-generated safe path relative to a future isolated build root. */
  readonly relativePath: string;
  readonly hash: Sha256Hash;
  readonly byteSize: number;
  readonly mediaType: string;
  /** Present only for canonical PNG/JPEG bytes whose dimensions were verified. */
  readonly canonicalRasterDimensions?: {
    readonly pixelWidth: number;
    readonly pixelHeight: number;
  };
}

export interface FontFaceStagingEntry {
  readonly kind: "fontFace";
  readonly fontRef: PortableFontRef;
  readonly faceId: string;
  readonly locator: ResourceByteLocator & { readonly kind: "fontFace" };
  /** App-generated safe path relative to a future isolated build root. */
  readonly relativePath: string;
  readonly hash: Sha256Hash;
  readonly byteSize: number;
  readonly format: ManagedFontFormat;
}

export type ResourceStagingEntry = AssetStagingEntry | FontFaceStagingEntry;

export interface ResourceClosureWarning {
  readonly kind:
    | "assetCount"
    | "assetFileBytes"
    | "assetTotalBytes"
    | "fontFaceCount"
    | "fontFaceBytes"
    | "fontTotalBytes";
  readonly observed: number;
  readonly warningThreshold: number;
  readonly subject?: string;
}

export interface VerifiedResourceClosure {
  readonly assets: readonly VerifiedAssetIdentity[];
  readonly fonts: readonly VerifiedFontIdentity[];
  readonly assetBindings: Readonly<
    Record<string, {
      readonly relativePath: string;
      readonly canonicalRasterDimensions?: {
        readonly pixelWidth: number;
        readonly pixelHeight: number;
      };
    }>
  >;
  readonly fontBindings: Readonly<
    Record<string, { readonly familyName: string }>
  >;
  readonly stagingEntries: readonly ResourceStagingEntry[];
  readonly warnings: readonly ResourceClosureWarning[];
  readonly totals: {
    readonly assetCount: number;
    readonly assetBytes: number;
    readonly fontFamilyCount: number;
    readonly fontFaceCount: number;
    readonly fontBytes: number;
  };
}

export type ResourceContractErrorKind =
  | "invalidRecord"
  | "duplicateLocalId"
  | "duplicatePortableId"
  | "invalidFamilyDigest"
  | "invalidProjectionClosure"
  | "missingAsset"
  | "missingFont"
  | "assetNotValidated"
  | "fontNotValidated"
  | "fontEmbeddingBlocked"
  | "ambiguousFontFamily"
  | "resourceLimitExceeded"
  | "byteVerificationFailed";

export class ResourceContractError extends Error {
  readonly kind: ResourceContractErrorKind;
  readonly code:
    | "CBB-ASSET-0001"
    | "CBB-FONT-0001"
    | "CBB-FONT-0003"
    | "CBB-SECURITY-0001";
  readonly subject?: string;

  constructor(
    kind: ResourceContractErrorKind,
    code: ResourceContractError["code"],
    message: string,
    subject?: string,
  ) {
    super(message);
    this.name = "ResourceContractError";
    this.kind = kind;
    this.code = code;
    if (subject !== undefined) this.subject = subject;
  }
}
