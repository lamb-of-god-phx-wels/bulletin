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
  readonly navigationMap: VerifiedPdfNavigationMap;
}

export type VerifiedPdfSourceRegion = "body" | "page-background" | "page-foreground";

export interface VerifiedPdfNavigationEntry {
  readonly resolvedId: string;
  readonly sourceElementId: string;
  readonly pageNumber: number;
  readonly region: VerifiedPdfSourceRegion;
}

export interface VerifiedPdfNavigationMap {
  readonly version: 1;
  readonly entries: readonly VerifiedPdfNavigationEntry[];
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
  | "artifactPersistenceFailed"
  | "cleanupFailed";

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
const MAX_NAVIGATION_ENTRIES = 50_000;
const ABANDON_GRACE_MS = 1_000;

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
    const entry = entries[0];
    const bindingDimensions = binding?.canonicalRasterDimensions;
    const stagedDimensions = entry?.canonicalRasterDimensions;
    const dimensionsValid = bindingDimensions === undefined
      ? stagedDimensions === undefined
      : stagedDimensions !== undefined &&
        Number.isSafeInteger(bindingDimensions.pixelWidth) &&
        bindingDimensions.pixelWidth >= 1 && bindingDimensions.pixelWidth <= 32_768 &&
        Number.isSafeInteger(bindingDimensions.pixelHeight) &&
        bindingDimensions.pixelHeight >= 1 && bindingDimensions.pixelHeight <= 32_768 &&
        bindingDimensions.pixelWidth === stagedDimensions.pixelWidth &&
        bindingDimensions.pixelHeight === stagedDimensions.pixelHeight &&
        (entry?.mediaType === "image/png" || entry?.mediaType === "image/jpeg");
    if (entries.length !== 1 || binding?.relativePath !== entry?.relativePath || !dimensionsValid) {
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
  const navigation = output.navigationMap;
  const navigationValid = navigation !== null &&
    typeof navigation === "object" &&
    navigation.version === 1 &&
    Array.isArray(navigation.entries) &&
    navigation.entries.length <= MAX_NAVIGATION_ENTRIES &&
    navigation.entries.every((entry) =>
      entry !== null && typeof entry === "object" &&
      typeof entry.resolvedId === "string" && entry.resolvedId.length > 0 && entry.resolvedId.length <= 512 &&
      typeof entry.sourceElementId === "string" && /^[A-Za-z][A-Za-z0-9_-]*$/u.test(entry.sourceElementId) &&
      Number.isSafeInteger(entry.pageNumber) && entry.pageNumber >= 1 && entry.pageNumber <= output.pageCount &&
      ["body", "page-background", "page-foreground"].includes(entry.region)
    );
  return (
    output.magicVerified === true &&
    SHA256.test(output.hash) &&
    Number.isSafeInteger(output.byteSize) &&
    output.byteSize > 0 &&
    output.byteSize <= MAX_ARTIFACT_BYTES &&
    Number.isSafeInteger(output.pageCount) &&
    output.pageCount > 0 &&
    output.pageCount <= MAX_PAGES &&
    /^[0-9]+\.[0-9]+$/.test(output.pdfVersion) &&
    navigationValid
  );
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

async function settlesWithin(work: Promise<unknown>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.then(() => true, () => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), ABANDON_GRACE_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Compile generated source through the trusted isolation adapter and install
 * evidence before the temporary root is removed. The execution deadline covers
 * staging, compilation, and PDF verification. Immutable artifact installation
 * begins only after that timed work completes and is then awaited as an
 * authoritative durability commit; a timeout can never race a success record.
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

  let root: BuildRootHandle;
  try {
    root = await sandbox.createBuildRoot(request.buildId);
  } catch {
    return failure("stagingFailed", "CBB-SECURITY-0001");
  }

  const deadline = new AbortController();
  const executionAborted = (): boolean => isAborted(signal) || deadline.signal.aborted;
  let abortListener: (() => void) | undefined;
  if (signal !== undefined) {
    abortListener = () => {
      deadline.abort("buildCanceled");
      void sandbox.terminate(root).catch(() => undefined);
    };
    signal.addEventListener("abort", abortListener, { once: true });
  }

  type TimedExecutionResult =
    | { readonly kind: "failed"; readonly result: TypstRunnerResult<Result> }
    | { readonly kind: "verified"; readonly pdf: VerifiedPdfOutput };
  const failed = (result: TypstRunnerResult<Result>): TimedExecutionResult => ({
    kind: "failed",
    result,
  });
  const execute = async (): Promise<TimedExecutionResult> => {
    try {
      if (executionAborted()) {
        await sandbox.terminate(root).catch(() => undefined);
        return failed(failure("canceled", "CBB-BUILD-0002"));
      }
      const stagedSource = await sandbox.stageSource(root, source, request.sourceHash);
      if (executionAborted()) return failed(failure("canceled", "CBB-BUILD-0002"));
      if (
        stagedSource.observedHash !== request.sourceHash ||
        stagedSource.observedByteSize !== source.byteLength
      ) return failed(failure("stagingFailed", "CBB-SECURITY-0001"));

      for (const entry of request.resources.stagingEntries) {
        const staged = await sandbox.stageResource(root, entry);
        if (executionAborted()) return failed(failure("canceled", "CBB-BUILD-0002"));
        if (staged.observedHash !== entry.hash || staged.observedByteSize !== entry.byteSize) {
          return failed(failure("stagingFailed", "CBB-SECURITY-0001"));
        }
      }

      const compiled = await sandbox.compile(root, deadline.signal);
      if (compiled.kind === "canceled" || executionAborted()) {
        return failed(failure("canceled", "CBB-BUILD-0002"));
      }
      if (compiled.kind === "failed") {
        return failed(failure("compileFailed", "CBB-BUILD-0001", compiled.diagnosticCodes));
      }

      let pdf: VerifiedPdfOutput;
      try {
        pdf = await sandbox.verifyPdf(root);
      } catch {
        return failed(failure("invalidPdf", "CBB-SECURITY-0001"));
      }
      if (executionAborted()) return failed(failure("canceled", "CBB-BUILD-0002"));
      if (!validPdf(pdf)) return failed(failure("invalidPdf", "CBB-SECURITY-0001"));
      return { kind: "verified", pdf };
    } catch {
      return failed(failure("stagingFailed", "CBB-SECURITY-0001"));
    }
  };

  const work = execute();
  let raced:
    | { readonly kind: "completed"; readonly value: TimedExecutionResult }
    | { readonly kind: "timedOut" };
  let timerFailed = false;
  try {
    raced = await timer.raceTimeout(work, timeoutMs);
  } catch {
    timerFailed = true;
    raced = { kind: "timedOut" };
  }
  let result: TypstRunnerResult<Result>;
  let cleanupNow = true;
  if (raced.kind === "timedOut") {
    deadline.abort(timerFailed ? "buildTimerFailed" : "buildTimedOut");
    const termination = sandbox.terminate(root).catch(() => undefined);
    const [workSettled, terminationSettled] = await Promise.all([
      settlesWithin(work),
      settlesWithin(termination),
    ]);
    cleanupNow = workSettled && terminationSettled;
    if (!cleanupNow) {
      // The timed phase cannot persist. Keep its root owned until every user
      // has actually settled, then clean asynchronously; a never-settling port
      // leaves bounded residue for the sandbox startup sweep instead of racing
      // root deletion or defeating the caller's deadline indefinitely.
      void Promise.allSettled([work, termination])
        .then(() => sandbox.cleanup(root))
        .catch(() => undefined);
    }
    result = failure("timedOut", "CBB-BUILD-0002");
  } else if (raced.value.kind === "failed") {
    result = raced.value.result;
  } else {
    if (signal !== undefined && abortListener !== undefined) {
      signal.removeEventListener("abort", abortListener);
      abortListener = undefined;
    }
    if (executionAborted()) {
      result = failure("canceled", "CBB-BUILD-0002");
    } else {
      // Immutable installation is a durability commit, not killable execution.
      // Once it starts we await its authoritative success/failure and never
      // publish a contradictory timeout for the same build id.
      try {
        const artifact = await sink.persistCompile({
          buildId: request.buildId,
          source,
          sourceHash: request.sourceHash,
          pdf: raced.value.pdf,
          tool: trustedTool,
          resources: request.resources,
        });
        result = { status: "succeeded", artifact };
      } catch {
        result = failure("artifactPersistenceFailed", "CBB-BUILD-0001");
      }
    }
  }
  if (signal !== undefined && abortListener !== undefined) {
    signal.removeEventListener("abort", abortListener);
  }
  if (cleanupNow) {
    try {
      await sandbox.cleanup(root);
    } catch {
      return failure("cleanupFailed", "CBB-SECURITY-0001");
    }
  }
  return result;
}
