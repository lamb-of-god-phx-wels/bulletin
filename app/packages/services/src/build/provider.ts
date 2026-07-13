import {
  canonicalRevisionToken,
  createSanitizedRenderProjection,
  generateTypst,
  hashBytes,
  hashCanonical,
  renderInputHash,
  resolveDocument,
  type CbbDocument,
  type HashJsonObject,
  type PinnedToolIdentity,
  type RenderLocaleIdentity,
  type RenderOutputOptions,
  type Sha256Hash,
} from "@cbb/core";
import {
  materializeMandatoryFontFallbacks,
  resourceClosureExecutionHash,
  type ResourceProjectionReferences,
  type VerifiedResourceClosure,
} from "../resources/index.js";
import type {
  BuildQueueHash,
  BuildQueueRequest,
  CurrentBuildInputs,
} from "./queue.js";
import type {
  BuildResourceClosurePort,
  PreparedBuildProjection,
  TrustedBuildArtifactMetadata,
  TrustedBuildProjectionProviderPort,
  TrustedBuildProjectionRequest,
  TrustedBuildProvenance,
} from "./orchestrator.js";

const MAX_PREPARED_SNAPSHOTS = 128;
const HASH = /^sha256:[0-9a-f]{64}$/u;

export class DeterministicBuildProviderError extends Error {
  readonly code = "CBB-BUILD-0001" as const;

  constructor(
    public readonly kind:
      | "invalidSnapshot"
      | "resolutionFailed"
      | "resourceResolutionFailed"
      | "generationFailed"
      | "projectionChanged"
      | "missingArtifactPolicy"
      | "capacityExceeded",
  ) {
    super("Trusted deterministic build projection failed");
    this.name = "DeterministicBuildProviderError";
  }
}

export interface TrustedDocumentBuildSnapshot {
  readonly document: CbbDocument;
  readonly current: CurrentBuildInputs;
}

export interface TrustedDocumentBuildSnapshotPort {
  /** Load the app-owned saved or in-memory document selected by the closed request. */
  load(request: TrustedBuildProjectionRequest): Promise<TrustedDocumentBuildSnapshot>;
}

export interface TrustedProjectionResourcePort {
  /** Resolve and rehash the exact typed refs in one resolved projection. */
  resolve(projection: ResourceProjectionReferences): Promise<VerifiedResourceClosure>;
}

export interface TrustedBuildArtifactPolicyPort {
  metadata(request: TrustedBuildProjectionRequest): Promise<
    Omit<TrustedBuildArtifactMetadata, "renderProjectionHash" | "generatorVersion">
  > | Omit<TrustedBuildArtifactMetadata, "renderProjectionHash" | "generatorVersion">;
}

export interface DeterministicBuildProviderOptions {
  readonly snapshots: TrustedDocumentBuildSnapshotPort;
  readonly resources: TrustedProjectionResourcePort;
  readonly tools: readonly PinnedToolIdentity[];
  readonly localeIdentity: (languageTag: string) => RenderLocaleIdentity;
  readonly artifactPolicy?: TrustedBuildArtifactPolicyPort;
  /** Test/deployment backpressure may lower, but never raise, the hard cap. */
  readonly maximumPreparedSnapshots?: number;
}

interface PreparedEntry {
  readonly localResourceId: string;
  readonly documentRevision: BuildQueueHash;
  readonly renderInputHash: BuildQueueHash;
  readonly editGeneration: number;
  readonly sourceHash: Sha256Hash;
  readonly resourceClosureHash: Sha256Hash;
  readonly projection: ResourceProjectionReferences;
}

function fail(kind: DeterministicBuildProviderError["kind"]): never {
  throw new DeterministicBuildProviderError(kind);
}

function defaultMetadata(
  request: TrustedBuildProjectionRequest,
): Omit<TrustedBuildArtifactMetadata, "renderProjectionHash" | "generatorVersion"> {
  if (request.kind === "preview") {
    return {
      outputForm: "readerOrder",
      readinessProfile: "draft",
      watermark: { kind: "proof", text: "PREVIEW", version: "m3-v1" },
    };
  }
  if (request.artifactKind === "draft") {
    return {
      outputForm: "readerOrder",
      readinessProfile: "draft",
      watermark: { kind: "draft", text: "DRAFT", version: "m3-v1" },
    };
  }
  return { outputForm: "readerOrder", readinessProfile: "printFinal" };
}

function closedArtifactPolicy(
  request: TrustedBuildProjectionRequest,
  value: Omit<TrustedBuildArtifactMetadata, "renderProjectionHash" | "generatorVersion">,
): Omit<TrustedBuildArtifactMetadata, "renderProjectionHash" | "generatorVersion"> {
  if (
    value === null || typeof value !== "object" ||
    value.outputForm !== "readerOrder" ||
    !["draft", "printFinal", "accessibleFinal"].includes(value.readinessProfile) ||
    (value.readinessInputHash !== undefined && !HASH.test(value.readinessInputHash))
  ) fail("generationFailed");
  let watermark: TrustedBuildArtifactMetadata["watermark"];
  if (value.watermark !== undefined) {
    if (
      (value.watermark.kind !== "draft" && value.watermark.kind !== "proof") ||
      typeof value.watermark.text !== "string" ||
      value.watermark.text.length < 1 ||
      [...value.watermark.text].length > 128 ||
      /[\u0000-\u001f\u007f-\u009f]/u.test(value.watermark.text) ||
      typeof value.watermark.version !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_.+:-]{0,127}$/u.test(value.watermark.version)
    ) fail("generationFailed");
    watermark = Object.freeze({ ...value.watermark });
  }
  if (request.kind === "manual") {
    if (value.readinessInputHash === undefined) fail("missingArtifactPolicy");
    if (
      (request.artifactKind === "draft" &&
        (value.readinessProfile !== "draft" || watermark?.kind !== "draft")) ||
      (request.artifactKind === "finalCandidate" &&
        (value.readinessProfile === "draft" || watermark !== undefined))
    ) fail("generationFailed");
  }
  return Object.freeze({
    outputForm: "readerOrder" as const,
    readinessProfile: value.readinessProfile,
    ...(value.readinessInputHash === undefined
      ? {}
      : { readinessInputHash: value.readinessInputHash }),
    ...(watermark === undefined ? {} : { watermark }),
  });
}

function outputOptions(metadata: Omit<TrustedBuildArtifactMetadata, "renderProjectionHash" | "generatorVersion">): RenderOutputOptions {
  if (metadata.outputForm !== "readerOrder") {
    fail("generationFailed");
  }
  return {
    outputForm: "readerOrder",
    pdfConformance: metadata.readinessProfile === "accessibleFinal" ? "pdfUa1" : "standard",
    watermark: metadata.watermark === undefined
      ? { kind: "none" }
      : {
          kind: metadata.watermark.kind,
          text: metadata.watermark.text,
          version: metadata.watermark.version,
        },
  };
}

function exactCurrent(value: CurrentBuildInputs): boolean {
  return HASH.test(value.documentRevision) && HASH.test(value.renderInputHash) &&
    Number.isSafeInteger(value.editGeneration) && value.editGeneration >= 0 &&
    ["clean", "dirty", "saving", "saveFailed", "conflicted", "readOnly"].includes(value.saveState);
}

function exactPrepared(
  entry: PreparedEntry,
  request: BuildQueueRequest,
  provenance: TrustedBuildProvenance,
): boolean {
  return entry.localResourceId === request.localResourceId &&
    entry.localResourceId === provenance.localResourceId &&
    entry.documentRevision === request.documentRevision &&
    entry.documentRevision === provenance.documentRevision &&
    entry.renderInputHash === request.renderInputHash &&
    entry.renderInputHash === provenance.renderInputHash &&
    entry.editGeneration === request.editGeneration &&
    entry.editGeneration === provenance.editGeneration &&
    entry.sourceHash === provenance.sourceHash &&
    entry.resourceClosureHash === provenance.resourceClosureHash;
}

function closedResourceProjection(
  projection: ResourceProjectionReferences,
): ResourceProjectionReferences {
  return Object.freeze({
    referencedAssets: Object.freeze(projection.referencedAssets.map((entry) =>
      Object.freeze({ assetRef: entry.assetRef })
    )),
    referencedFonts: Object.freeze(projection.referencedFonts.map((entry) =>
      Object.freeze({ fontRef: entry.fontRef })
    )),
    fontFallbackRefs: Object.freeze([...projection.fontFallbackRefs]),
  });
}

/**
 * Concrete deterministic projection/resource provider shared by preview and
 * manual builds. It owns prepared snapshot handles, performs the core pipeline,
 * and re-resolves the exact resource closure immediately before execution.
 */
export class DeterministicBuildProvider
implements TrustedBuildProjectionProviderPort, BuildResourceClosurePort {
  private nextHandle = 1;
  private readonly prepared = new Map<string, PreparedEntry>();
  private readonly tools: readonly PinnedToolIdentity[];
  private readonly maximumPreparedSnapshots: number;
  private inFlightPreparations = 0;

  constructor(private readonly options: DeterministicBuildProviderOptions) {
    if (
      !Array.isArray(options.tools) || options.tools.length < 1 || options.tools.length > 32 ||
      options.tools.some((tool) =>
        typeof tool.toolId !== "string" || tool.toolId.length < 1 ||
        typeof tool.version !== "string" || tool.version.length < 1 ||
        !HASH.test(tool.toolHash)
      )
    ) fail("invalidSnapshot");
    const maximumPreparedSnapshots = options.maximumPreparedSnapshots ?? MAX_PREPARED_SNAPSHOTS;
    if (
      !Number.isSafeInteger(maximumPreparedSnapshots) || maximumPreparedSnapshots < 1 ||
      maximumPreparedSnapshots > MAX_PREPARED_SNAPSHOTS
    ) fail("invalidSnapshot");
    this.maximumPreparedSnapshots = maximumPreparedSnapshots;
    this.tools = Object.freeze(options.tools.map((tool) => Object.freeze({ ...tool })));
  }

  async prepare(request: TrustedBuildProjectionRequest): Promise<PreparedBuildProjection> {
    if (
      this.prepared.size + this.inFlightPreparations >=
      this.maximumPreparedSnapshots
    ) fail("capacityExceeded");
    this.inFlightPreparations += 1;
    try {
      let document: CbbDocument;
      let current: CurrentBuildInputs;
      try {
        const loaded = await this.options.snapshots.load(request);
        document = structuredClone(loaded.document);
        current = Object.freeze({ ...loaded.current });
        if (!exactCurrent(current)) fail("invalidSnapshot");
        const revision = canonicalRevisionToken(document) as BuildQueueHash;
        if (revision !== current.documentRevision) fail("invalidSnapshot");
        if (request.kind === "manual") {
          const expected = request.savedInputs;
          if (
            expected.saveState !== "clean" || current.saveState !== "clean" ||
            expected.documentRevision !== current.documentRevision ||
            expected.renderInputHash !== current.renderInputHash ||
            expected.editGeneration !== current.editGeneration
          ) fail("invalidSnapshot");
        }
      } catch (error) {
        if (error instanceof DeterministicBuildProviderError) throw error;
        fail("invalidSnapshot");
      }

      let resolved: ReturnType<typeof resolveDocument>;
      let effectiveProjection: ReturnType<typeof materializeMandatoryFontFallbacks>;
      let resourceProjection: ResourceProjectionReferences;
      try {
        resolved = resolveDocument(document);
        if (resolved.findings.some((finding) => finding.severity === "error")) {
          fail("resolutionFailed");
        }
        effectiveProjection = materializeMandatoryFontFallbacks(resolved.projection);
        resourceProjection = closedResourceProjection(
          effectiveProjection as unknown as ResourceProjectionReferences,
        );
      } catch (error) {
        if (error instanceof DeterministicBuildProviderError) throw error;
        fail("resolutionFailed");
      }

      let closure: VerifiedResourceClosure;
      try {
        closure = await this.options.resources.resolve(resourceProjection);
      } catch {
        fail("resourceResolutionFailed");
      }

      try {
        const generated = generateTypst(
          { tree: resolved.tree, projection: effectiveProjection },
          { assets: closure.assetBindings, fonts: closure.fontBindings },
        );
        if (generated.findings.some((finding) => finding.severity === "error")) {
          fail("generationFailed");
        }
        const sanitized = createSanitizedRenderProjection(
          effectiveProjection as unknown as HashJsonObject,
        );
        if (request.kind === "manual" && this.options.artifactPolicy === undefined) {
          fail("missingArtifactPolicy");
        }
        const rawPolicy = this.options.artifactPolicy === undefined
          ? defaultMetadata(request)
          : await this.options.artifactPolicy.metadata(request);
        const policy = closedArtifactPolicy(request, rawPolicy);
        const computedRenderHash = renderInputHash({
          projection: sanitized,
          assets: closure.assets,
          fonts: closure.fonts,
          tools: this.tools,
          locale: this.options.localeIdentity(effectiveProjection.locale),
          outputOptions: outputOptions(policy),
        }) as BuildQueueHash;
        if (computedRenderHash !== current.renderInputHash) fail("invalidSnapshot");
        const sourceHash = hashBytes(new TextEncoder().encode(generated.source));
        const closureHash = resourceClosureExecutionHash(closure);
        const projectionHandle = `projection:m3-${this.nextHandle.toString(10).padStart(8, "0")}`;
        this.nextHandle += 1;
        this.prepared.set(projectionHandle, Object.freeze({
          localResourceId: request.localResourceId,
          documentRevision: current.documentRevision,
          renderInputHash: computedRenderHash,
          editGeneration: current.editGeneration,
          sourceHash,
          resourceClosureHash: closureHash,
          projection: resourceProjection,
        }));
        return Object.freeze({
          projectionHandle,
          localResourceId: request.localResourceId,
          documentRevision: current.documentRevision,
          renderInputHash: computedRenderHash,
          editGeneration: current.editGeneration,
          source: generated.source,
          sourceHash,
          resourceClosureHash: closureHash,
          artifactMetadata: Object.freeze({
            ...policy,
            renderProjectionHash: hashCanonical(sanitized),
            generatorVersion: generated.generatorVersion,
          }),
        });
      } catch (error) {
        if (error instanceof DeterministicBuildProviderError) throw error;
        fail("generationFailed");
      }
    } finally {
      this.inFlightPreparations -= 1;
    }
  }

  /** Idempotently discard an unconsumed opaque handle; it can never be revived. */
  release(projectionHandle: string): void {
    if (typeof projectionHandle !== "string" || !/^projection:[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u.test(projectionHandle)) {
      return;
    }
    this.prepared.delete(projectionHandle);
  }

  async resolve(request: {
    readonly request: BuildQueueRequest;
    readonly provenance: TrustedBuildProvenance;
  }): Promise<VerifiedResourceClosure> {
    const entry = this.prepared.get(request.provenance.projectionHandle);
    if (entry === undefined || !exactPrepared(entry, request.request, request.provenance)) {
      fail("projectionChanged");
    }
    this.prepared.delete(request.provenance.projectionHandle);
    try {
      const closure = await this.options.resources.resolve(entry.projection);
      if (resourceClosureExecutionHash(closure) !== entry.resourceClosureHash) {
        fail("projectionChanged");
      }
      return closure;
    } catch (error) {
      if (error instanceof DeterministicBuildProviderError) throw error;
      fail("resourceResolutionFailed");
    }
  }
}
