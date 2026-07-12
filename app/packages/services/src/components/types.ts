import type { Sha256Hash } from "@cbb/core";

export const TRUSTED_COMPONENT_ROLES = [
  "typstCli",
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

export interface TrustedComponentManifestEntry {
  readonly role: TrustedComponentRole;
  readonly id: string;
  readonly version: string;
  readonly platform: TrustedComponentPlatform;
  readonly arch: TrustedComponentArch;
  readonly relativePath: string;
  readonly hash: Sha256Hash;
  readonly byteSize: number;
}

export interface TrustedComponentManifestContent {
  readonly version: 1;
  readonly kind: "trustedComponentManifest";
  readonly signingKeyId: string;
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
}

export interface VerifiedTrustedComponent extends TrustedComponentIdentity {
  readonly locator: TrustedComponentLocator;
}

export interface TrustedComponentSelectionRequest {
  readonly role: TrustedComponentRole;
  readonly id: string;
}

export interface TrustedComponentRegistry {
  readonly manifestHash: Sha256Hash;
  readonly signingKeyId: string;
  readonly components: readonly TrustedComponentIdentity[];
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
  | "platformMismatch"
  | "duplicateComponent"
  | "duplicatePath"
  | "nonCanonicalOrder"
  | "resourceLimitExceeded"
  | "invalidAppRoot"
  | "componentVerificationFailed"
  | "unknownComponent"
  | "invalidSelection";

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
