import { MANDATORY_BUNDLED_FONTS, hashBytes } from "@cbb/core";
import type { Sha256Hash } from "@cbb/core";
import type {
  ResourceStagingEntry,
  VerifiedResourceClosure,
} from "../resources/index.js";
import { RESOURCE_CLOSURE_LIMITS } from "../resources/index.js";

declare const buildRootBrand: unique symbol;
declare const buildOutputBrand: unique symbol;

export type BuildRootHandle = string & { readonly [buildRootBrand]: "BuildRootHandle" };
export type BuildOutputHandle = string & {
  readonly [buildOutputBrand]: "BuildOutputHandle";
};

export interface TrustedTypstRequirement {
  readonly toolId: "typst";
  readonly version: string;
  readonly executableHash: Sha256Hash;
}

export interface TypstCompileRequest {
  readonly buildId: string;
  readonly source: string;
  readonly sourceHash: Sha256Hash;
  readonly resources: VerifiedResourceClosure;
  readonly timeoutMs?: number;
}

export interface StagedByteIdentity {
  readonly observedHash: Sha256Hash;
  readonly observedByteSize: number;
}

export type SandboxCompileResult =
  | { readonly kind: "succeeded" }
  | { readonly kind: "failed"; readonly diagnosticCodes: readonly string[] }
  | { readonly kind: "canceled" };

export interface VerifiedPdfOutput {
  readonly handle: BuildOutputHandle;
  readonly hash: Sha256Hash;
  readonly byteSize: number;
  readonly pageCount: number;
  readonly pdfVersion: string;
  readonly magicVerified: true;
}

/**
 * Platform adapter for a signed, OS-isolated, no-network Typst process tree.
 * Implementations own all executable/root paths; requests cannot supply them.
 */
export interface IsolatedTypstSandboxPort {
  readonly isolationProfile: "offlineTypstV1" | "unavailable";
  verifyTrustedTool(requirement: TrustedTypstRequirement): Promise<boolean>;
  createBuildRoot(buildId: string): Promise<BuildRootHandle>;
  stageSource(
    root: BuildRootHandle,
    source: Uint8Array,
    expectedHash: Sha256Hash,
  ): Promise<StagedByteIdentity>;
  stageResource(
    root: BuildRootHandle,
    entry: ResourceStagingEntry,
  ): Promise<StagedByteIdentity>;
  compile(root: BuildRootHandle, signal?: AbortSignal): Promise<SandboxCompileResult>;
  verifyPdf(root: BuildRootHandle): Promise<VerifiedPdfOutput>;
  terminate(root: BuildRootHandle): Promise<void>;
  cleanup(root: BuildRootHandle): Promise<void>;
}

export interface BuildRunnerTimerPort {
  raceTimeout<Result>(
    work: Promise<Result>,
    timeoutMs: number,
  ): Promise<
    | { readonly kind: "completed"; readonly value: Result }
    | { readonly kind: "timedOut" }
  >;
}

export interface PersistCompileEvidence {
  readonly buildId: string;
  readonly source: Uint8Array;
  readonly sourceHash: Sha256Hash;
  readonly pdf: VerifiedPdfOutput;
  readonly tool: TrustedTypstRequirement;
  readonly resources: VerifiedResourceClosure;
}

export interface CompileArtifactSinkPort<Result> {
  /** Must rehash source/PDF while atomically installing immutable evidence. */
  persistCompile(evidence: PersistCompileEvidence): Promise<Result>;
}

export type TypstRunnerFailureKind =
  | "invalidRequest"
  | "isolationUnavailable"
  | "untrustedTool"
  | "stagingFailed"
  | "compileFailed"
  | "timedOut"
  | "canceled"
  | "invalidPdf"
  | "artifactPersistenceFailed";

export type TypstRunnerResult<Result> =
  | { readonly status: "succeeded"; readonly artifact: Result }
  | {
      readonly status: "failed";
      readonly code: "CBB-BUILD-0001" | "CBB-BUILD-0002" | "CBB-SECURITY-0001";
      readonly kind: TypstRunnerFailureKind;
      readonly diagnosticCodes: readonly string[];
    };

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const SAFE_ASSET_ALIAS = /^assets\/a[0-9]{4}\.(?:png|jpg|svg|pdf|bin)$/;
const SAFE_FONT_ALIAS = /^fonts\/f[0-9]{4}-[0-9]{4}\.(?:ttf|otf|woff|woff2)$/;
const MAX_ARTIFACT_BYTES = 1024 * 1024 * 1024;
const MAX_PAGES = 1_000;

function failure<Result>(
  kind: TypstRunnerFailureKind,
  code: "CBB-BUILD-0001" | "CBB-BUILD-0002" | "CBB-SECURITY-0001",
  diagnosticCodes: readonly string[] = [code],
): TypstRunnerResult<Result> {
  return { status: "failed", code, kind, diagnosticCodes: [...diagnosticCodes].slice(0, 1000) };
}

function validateRequest(request: TypstCompileRequest): Uint8Array {
  if (!UUID_V4.test(request.buildId)) throw new TypeError("Invalid build id");
  if (!SHA256.test(request.sourceHash)) throw new TypeError("Invalid source hash");
  const bytes = new TextEncoder().encode(request.source);
  if (bytes.length === 0 || bytes.length > MAX_ARTIFACT_BYTES) {
    throw new RangeError("Generated Typst source exceeds its deterministic bounds");
  }
  if (hashBytes(bytes) !== request.sourceHash) throw new TypeError("Generated source hash mismatch");
  const aliases = new Set<string>();
  for (const entry of request.resources.stagingEntries) {
    const safe = entry.kind === "asset"
      ? SAFE_ASSET_ALIAS.test(entry.relativePath)
      : SAFE_FONT_ALIAS.test(entry.relativePath);
    if (!safe || aliases.has(entry.relativePath)) {
      throw new TypeError("Resource closure contains an unsafe or duplicate staging alias");
    }
    aliases.add(entry.relativePath);
    if (!SHA256.test(entry.hash) || !Number.isSafeInteger(entry.byteSize) || entry.byteSize < 1) {
      throw new TypeError("Resource staging identity is malformed");
    }
  }
  validateResourceClosure(request.resources);
  return bytes;
}

function validateResourceClosure(resources: VerifiedResourceClosure): void {
  const assetEntries = resources.stagingEntries.filter((entry) => entry.kind === "asset");
  const fontEntries = resources.stagingEntries.filter((entry) => entry.kind === "fontFace");
  const assetBytes = assetEntries.reduce((total, entry) => total + entry.byteSize, 0);
  const fontBytes = fontEntries.reduce((total, entry) => total + entry.byteSize, 0);
  if (
    assetEntries.length !== resources.totals.assetCount ||
    assetBytes !== resources.totals.assetBytes ||
    resources.fonts.length !== resources.totals.fontFamilyCount ||
    fontEntries.length !== resources.totals.fontFaceCount ||
    fontBytes !== resources.totals.fontBytes ||
    assetEntries.length > RESOURCE_CLOSURE_LIMITS.assetCountHard ||
    assetBytes > RESOURCE_CLOSURE_LIMITS.assetTotalBytesHard ||
    fontEntries.length > RESOURCE_CLOSURE_LIMITS.fontFaceCountHard ||
    fontBytes > RESOURCE_CLOSURE_LIMITS.fontTotalBytesHard
  ) {
    throw new TypeError("Resource closure totals are inconsistent or over limit");
  }
  if (
    Object.keys(resources.assetBindings).length !== resources.assets.length ||
    Object.keys(resources.fontBindings).length !== resources.fonts.length
  ) {
    throw new TypeError("Resource closure bindings are incomplete or surplus");
  }
  for (const asset of resources.assets) {
    const entries = assetEntries.filter((entry) =>
      entry.assetRef === asset.assetRef &&
      entry.hash === asset.binaryHash &&
      entry.mediaType === asset.mediaType
    );
    const binding = resources.assetBindings[asset.assetRef];
    if (entries.length !== 1 || binding?.relativePath !== entries[0]?.relativePath) {
      throw new TypeError("Asset identity is not bound to exactly one staged resource");
    }
  }
  if (assetEntries.length !== resources.assets.length) {
    throw new TypeError("Resource closure contains surplus staged assets");
  }
  let selectedFaceCount = 0;
  for (const font of resources.fonts) {
    const binding = resources.fontBindings[font.fontRef];
    if (binding === undefined || font.selectedFaces.length === 0) {
      throw new TypeError("Font identity has no verified binding or selected face");
    }
    selectedFaceCount += font.selectedFaces.length;
    for (const face of font.selectedFaces) {
      const matches = fontEntries.filter((entry) =>
        entry.fontRef === font.fontRef &&
        entry.faceId === face.faceId &&
        entry.hash === face.faceHash
      );
      if (matches.length !== 1) {
        throw new TypeError("Font face identity is not bound to exactly one staged resource");
      }
    }
  }
  if (fontEntries.length !== selectedFaceCount) {
    throw new TypeError("Resource closure contains surplus staged font faces");
  }
  for (const mandatory of MANDATORY_BUNDLED_FONTS) {
    const identities = resources.fonts.filter((font) => font.fontRef === mandatory.fontRef);
    if (
      identities.length !== 1 ||
      resources.fontBindings[mandatory.fontRef]?.familyName !== mandatory.familyName
    ) {
      throw new TypeError("Resource closure is missing a release-owned bundled font revision");
    }
  }
}

function validPdf(output: VerifiedPdfOutput): boolean {
  return (
    output.magicVerified === true &&
    SHA256.test(output.hash) &&
    Number.isSafeInteger(output.byteSize) &&
    output.byteSize > 0 &&
    output.byteSize <= MAX_ARTIFACT_BYTES &&
    Number.isSafeInteger(output.pageCount) &&
    output.pageCount > 0 &&
    output.pageCount <= MAX_PAGES &&
    /^[0-9]+\.[0-9]+$/.test(output.pdfVersion)
  );
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

/**
 * Compile generated source through the trusted isolation adapter and install
 * evidence before the temporary root is removed. All failures clean the root;
 * no partial output is returned or persisted.
 */
export async function runIsolatedTypstCompile<Result>(
  request: TypstCompileRequest,
  trustedTool: TrustedTypstRequirement,
  sandbox: IsolatedTypstSandboxPort,
  timer: BuildRunnerTimerPort,
  sink: CompileArtifactSinkPort<Result>,
  signal?: AbortSignal,
): Promise<TypstRunnerResult<Result>> {
  let source: Uint8Array;
  try {
    source = validateRequest(request);
  } catch {
    return failure("invalidRequest", "CBB-BUILD-0001");
  }
  const timeoutMs = request.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    return failure("invalidRequest", "CBB-BUILD-0001");
  }
  if (
    trustedTool.toolId !== "typst" ||
    trustedTool.version.length === 0 ||
    !SHA256.test(trustedTool.executableHash)
  ) {
    return failure("untrustedTool", "CBB-SECURITY-0001");
  }
  if (sandbox.isolationProfile !== "offlineTypstV1") {
    return failure("isolationUnavailable", "CBB-SECURITY-0001");
  }
  let trusted = false;
  try {
    trusted = await sandbox.verifyTrustedTool(trustedTool);
  } catch {
    trusted = false;
  }
  if (!trusted) return failure("untrustedTool", "CBB-SECURITY-0001");

  let root: BuildRootHandle | undefined;
  let abortListener: (() => void) | undefined;
  try {
    root = await sandbox.createBuildRoot(request.buildId);
    if (isAborted(signal)) {
      await sandbox.terminate(root).catch(() => undefined);
      return failure("canceled", "CBB-BUILD-0002");
    }
    if (signal !== undefined) {
      const capturedRoot = root;
      abortListener = () => {
        void sandbox.terminate(capturedRoot).catch(() => undefined);
      };
      signal.addEventListener("abort", abortListener, { once: true });
    }

    const stagedSource = await sandbox.stageSource(root, source, request.sourceHash);
    if (
      stagedSource.observedHash !== request.sourceHash ||
      stagedSource.observedByteSize !== source.byteLength
    ) {
      return failure("stagingFailed", "CBB-SECURITY-0001");
    }
    for (const entry of request.resources.stagingEntries) {
      const staged = await sandbox.stageResource(root, entry);
      if (staged.observedHash !== entry.hash || staged.observedByteSize !== entry.byteSize) {
        return failure("stagingFailed", "CBB-SECURITY-0001");
      }
    }

    const raced = await timer.raceTimeout(sandbox.compile(root, signal), timeoutMs);
    if (raced.kind === "timedOut") {
      await sandbox.terminate(root).catch(() => undefined);
      return failure("timedOut", "CBB-BUILD-0002");
    }
    if (raced.value.kind === "canceled" || isAborted(signal)) {
      await sandbox.terminate(root).catch(() => undefined);
      return failure("canceled", "CBB-BUILD-0002");
    }
    if (raced.value.kind === "failed") {
      return failure("compileFailed", "CBB-BUILD-0001", raced.value.diagnosticCodes);
    }

    let pdf: VerifiedPdfOutput;
    try {
      pdf = await sandbox.verifyPdf(root);
    } catch {
      return failure("invalidPdf", "CBB-SECURITY-0001");
    }
    if (!validPdf(pdf)) return failure("invalidPdf", "CBB-SECURITY-0001");
    try {
      const artifact = await sink.persistCompile({
        buildId: request.buildId,
        source,
        sourceHash: request.sourceHash,
        pdf,
        tool: trustedTool,
        resources: request.resources,
      });
      return { status: "succeeded", artifact };
    } catch {
      return failure("artifactPersistenceFailed", "CBB-BUILD-0001");
    }
  } catch {
    return failure("stagingFailed", "CBB-SECURITY-0001");
  } finally {
    if (signal !== undefined && abortListener !== undefined) {
      signal.removeEventListener("abort", abortListener);
    }
    if (root !== undefined) await sandbox.cleanup(root).catch(() => undefined);
  }
}
