import type { PortableFontRef, Sha256Hash } from "@cbb/core";

export const TRUSTED_COMPONENT_ROLES = [
  "executionBroker",
  "quarantineWorker",
  "typstCli",
  "typstRuntimeClosure",
  "pdfInspector",
  "pdfStructuralInspector",
  "pdfFlattener",
  "pdfRuntimeClosure",
  "bookletCompositor",
  "pdfUaValidator",
  "bundledFontFace",
  "schemaCatalog",
  "localeData",
  "genericStarterSet",
] as const;

export type TrustedComponentRole = (typeof TRUSTED_COMPONENT_ROLES)[number];
export type TrustedComponentPlatform = "linux" | "win32";
export type TrustedComponentArch = "x64" | "arm64";

/**
 * Signed identity of the application release that owns a component manifest.
 * The sequence is monotonic within one application/profile lineage; runtime
 * verification still requires every field to equal the installed app's
 * independently configured expectation.
 */
export interface TrustedComponentReleaseIdentity {
  readonly applicationId: string;
  readonly releaseId: string;
  readonly releaseSequence: number;
  readonly profile: string;
}

export interface TrustedBundledFontFaceBinding {
  readonly portableFontRef: PortableFontRef;
  readonly familyName: string;
  readonly faceId: string;
  readonly faceIndex: number;
  readonly format: "ttf" | "otf" | "woff" | "woff2";
  readonly weight: number;
  readonly style: "normal" | "italic" | "oblique";
  readonly stretch: number;
}

export interface TrustedComponentManifestEntry {
  readonly role: TrustedComponentRole;
  readonly id: string;
  readonly version: string;
  readonly platform: TrustedComponentPlatform;
  readonly arch: TrustedComponentArch;
  readonly relativePath: string;
  readonly hash: Sha256Hash;
  readonly byteSize: number;
  /** Required only for bundledFontFace; binds signed bytes to the portable catalog. */
  readonly fontFaceBinding?: TrustedBundledFontFaceBinding;
}

export interface TrustedComponentManifestContent {
  readonly version: 1;
  readonly kind: "trustedComponentManifest";
  readonly signingKeyId: string;
  readonly release: TrustedComponentReleaseIdentity;
  readonly components: readonly TrustedComponentManifestEntry[];
}

export interface SignedTrustedComponentManifest
  extends TrustedComponentManifestContent {
  readonly signature: string;
}

/** Injected installation trust anchor; manifests cannot add keys to it. */
export interface TrustedPublicKeyRegistry {
  /** Return an Ed25519 SubjectPublicKeyInfo DER value, or undefined. */
  getEd25519PublicKey(signingKeyId: string): Uint8Array | undefined;
}

declare const verifiedManifestBrand: unique symbol;

/** Constructed only after closed validation and Ed25519 verification. */
export type VerifiedTrustedComponentManifest = TrustedComponentManifestContent & {
  readonly signature: string;
  readonly manifestHash: Sha256Hash;
  readonly [verifiedManifestBrand]: true;
};

declare const componentLocatorBrand: unique symbol;

/** Opaque app-owned locator. It intentionally carries no filesystem path. */
export type TrustedComponentLocator = Readonly<{
  token: string;
  [componentLocatorBrand]: true;
}>;

export interface TrustedComponentIdentity {
  readonly role: TrustedComponentRole;
  readonly id: string;
  readonly version: string;
  readonly platform: TrustedComponentPlatform;
  readonly arch: TrustedComponentArch;
  readonly hash: Sha256Hash;
  readonly byteSize: number;
  readonly fontFaceBinding?: TrustedBundledFontFaceBinding;
}

export interface VerifiedTrustedComponent extends TrustedComponentIdentity {
  readonly locator: TrustedComponentLocator;
}

export interface TrustedComponentSelectionRequest {
  readonly role: TrustedComponentRole;
  readonly id: string;
}

export const TRUSTED_COMPONENT_EXECUTION_OPERATIONS = [
  "quarantineExecute",
  "typstCompile",
  "typstRuntimeBind",
  "pdfInspect",
  "pdfStructuralInspect",
  "pdfFlatten",
  "pdfRuntimeBind",
] as const;

export type TrustedComponentExecutionOperation =
  (typeof TRUSTED_COMPONENT_EXECUTION_OPERATIONS)[number];

export const TRUSTED_COMPONENT_EXECUTION_LIMITS = Object.freeze({
  quarantineExecute: Object.freeze({ maximumRuntimeMs: 120_000 }),
  typstCompile: Object.freeze({ maximumRuntimeMs: 120_000 }),
  typstRuntimeBind: Object.freeze({ maximumRuntimeMs: 30_000 }),
  pdfInspect: Object.freeze({ maximumRuntimeMs: 30_000 }),
  pdfStructuralInspect: Object.freeze({ maximumRuntimeMs: 30_000 }),
  pdfFlatten: Object.freeze({ maximumRuntimeMs: 120_000 }),
  pdfRuntimeBind: Object.freeze({ maximumRuntimeMs: 30_000 }),
} as const satisfies Readonly<
  Record<TrustedComponentExecutionOperation, { readonly maximumRuntimeMs: number }>
>);

export interface TrustedComponentExecutionRequest {
  readonly operation: TrustedComponentExecutionOperation;
  readonly broker: TrustedComponentLocator;
  readonly target: TrustedComponentLocator;
}

declare const componentOperationPayloadBrand: unique symbol;

/**
 * An operation-specific handle minted by the privileged native adapter.
 * It contains no argv, environment, executable path, build root, or output
 * destination. The adapter performs the runtime ownership check.
 */
export type TrustedComponentOperationPayload = Readonly<{
  readonly token: string;
  readonly operation: TrustedComponentExecutionOperation;
  readonly timeoutMs: number;
  readonly [componentOperationPayloadBrand]: true;
}>;

declare const componentExecutionGrantBrand: unique symbol;

/** Runtime-minted, path-free authorization for one closed native operation. */
export type TrustedComponentExecutionGrant = Readonly<{
  readonly token: string;
  readonly operation: TrustedComponentExecutionOperation;
  readonly broker: TrustedComponentIdentity;
  readonly target: TrustedComponentIdentity;
  readonly [componentExecutionGrantBrand]: true;
}>;

export interface TrustedComponentExecutionInvocation {
  readonly grant: TrustedComponentExecutionGrant;
  readonly payload: TrustedComponentOperationPayload;
}

export interface TrustedComponentExecutionAuthority {
  /** Re-verifies broker and target bytes and rejects forged/role-confused locators. */
  authorize(
    request: TrustedComponentExecutionRequest,
  ): Promise<TrustedComponentExecutionGrant>;
  /**
   * Consume a runtime-owned grant exactly once. Component bytes are verified
   * again immediately before the privileged closed-operation adapter runs.
   */
  invoke(request: TrustedComponentExecutionInvocation): Promise<void>;
}

export interface TrustedComponentRegistry {
  readonly manifestHash: Sha256Hash;
  readonly signingKeyId: string;
  readonly release: TrustedComponentReleaseIdentity;
  readonly components: readonly TrustedComponentIdentity[];
  readonly execution: TrustedComponentExecutionAuthority;
  /** Re-verifies bytes immediately before returning an opaque locator. */
  resolve(
    request: TrustedComponentSelectionRequest,
  ): Promise<VerifiedTrustedComponent>;
}

export type TrustedComponentErrorKind =
  | "invalidManifest"
  | "unknownSigningKey"
  | "invalidSigningKey"
  | "invalidSignature"
  | "releaseMismatch"
  | "platformMismatch"
  | "duplicateComponent"
  | "duplicatePath"
  | "nonCanonicalOrder"
  | "resourceLimitExceeded"
  | "requiredReleaseSet"
  | "invalidFontBinding"
  | "invalidAppRoot"
  | "componentVerificationFailed"
  | "unknownComponent"
  | "invalidSelection"
  | "invalidExecutionGrant"
  | "executionUnavailable"
  | "executionFailed";

export class TrustedComponentError extends Error {
  readonly code = "CBB-PACKAGE-0001" as const;
  readonly kind: TrustedComponentErrorKind;
  readonly subject?: string;

  constructor(
    kind: TrustedComponentErrorKind,
    message = "Trusted application component verification failed",
    subject?: string,
  ) {
    super(message);
    this.name = "TrustedComponentError";
    this.kind = kind;
    if (subject !== undefined) this.subject = subject;
  }
}
