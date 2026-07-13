import {
  canonicalStringify,
  hashBytes,
  type Sha256Hash,
} from "@cbb/core";
import type {
  BuildArtifactStatusEvent,
  BuildArtifactStatusPort,
  BuildExecutionSinkPort,
  BuildQueueRequest,
  OrchestratedRunnerRequest,
  TrustedBuildProvenance,
} from "../build/index.js";
import {
  resourceClosureExecutionHash,
  type ResourceStagingEntry,
} from "../resources/index.js";
import type {
  ArtifactRecord,
  ArtifactResourceClosure,
  ArtifactSchemaIdentity,
  ArtifactToolIdentity,
  BoundCompileArtifactSink,
  CompileArtifactSinkBinding,
  CompileOutputReaderPort,
  SuccessfulArtifactMetadata,
} from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HASH = /^sha256:[0-9a-f]{64}$/u;
const DIAGNOSTIC = /^CBB-[A-Z]+-[0-9]{4}$/u;
const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.+:/-]{0,255}$/u;
const MAX_ACTIVE_BUILDS = 4_096;

export class BuildArtifactBridgeError extends Error {
  readonly code = "CBB-BUILD-0001" as const;

  constructor(
    public readonly kind:
      | "invalidConfiguration"
      | "invalidEvent"
      | "invalidTransition"
      | "invalidEvidence"
      | "capacityExceeded"
      | "persistenceFailed",
  ) {
    super("Trusted build artifact bridge rejected inconsistent lifecycle evidence");
    this.name = "BuildArtifactBridgeError";
  }
}

export interface BuildArtifactBridgeClockPort {
  now(): Date;
}

/** Structural subset implemented by M3ArtifactServices and ImmutableArtifactStore. */
export interface BuildArtifactPersistencePort {
  readArtifact(
    bulletinLocalId: string,
    buildId: string,
  ): Promise<ArtifactRecord | undefined>;
  persistNonSuccess(record: ArtifactRecord): Promise<ArtifactRecord>;
  bindCompileSink(binding: CompileArtifactSinkBinding): BoundCompileArtifactSink;
}

export interface ImmutableBuildArtifactBridgeOptions {
  readonly artifacts: BuildArtifactPersistencePort;
  readonly clock: BuildArtifactBridgeClockPort;
  readonly outputReader: CompileOutputReaderPort;
  readonly tools: readonly ArtifactToolIdentity[];
  readonly schemas: readonly ArtifactSchemaIdentity[];
  readonly maximumActiveBuilds?: number;
}

export interface ImmutableBuildArtifactBridge {
  readonly executionSinks: BuildExecutionSinkPort;
  readonly artifactStatuses: BuildArtifactStatusPort;
}

type LifecyclePhase = "queued" | "running" | "terminal";

interface LifecycleState {
  readonly request: BuildQueueRequest;
  readonly provenance: TrustedBuildProvenance;
  readonly createdAt: string;
  phase: LifecyclePhase;
  startedAt?: string;
  terminalRecord?: ArtifactRecord;
}

function fail(kind: BuildArtifactBridgeError["kind"]): never {
  throw new BuildArtifactBridgeError(kind);
}

function exactDate(clock: BuildArtifactBridgeClockPort): string {
  const date = clock.now();
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) fail("invalidConfiguration");
  return date.toISOString();
}

function closedTool(tool: ArtifactToolIdentity): ArtifactToolIdentity {
  if (!SAFE_TOKEN.test(tool.toolId) || !SAFE_TOKEN.test(tool.version) || !HASH.test(tool.hash)) {
    fail("invalidConfiguration");
  }
  return Object.freeze({ toolId: tool.toolId, version: tool.version, hash: tool.hash });
}

function closedSchema(schema: ArtifactSchemaIdentity): ArtifactSchemaIdentity {
  if (
    !SAFE_TOKEN.test(schema.schemaId) ||
    !Number.isSafeInteger(schema.version) ||
    schema.version < 1 ||
    !HASH.test(schema.hash)
  ) fail("invalidConfiguration");
  return Object.freeze({ schemaId: schema.schemaId, version: schema.version, hash: schema.hash });
}

function exactKeys(value: unknown, expected: readonly string[]): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length && keys.every((key) =>
    typeof key === "string" && expected.includes(key)
  );
}

function validateRequest(request: BuildQueueRequest, provenance: TrustedBuildProvenance): void {
  const requestKeys = request.kind === "preview"
    ? ["kind", "buildId", "localResourceId", "documentRevision", "renderInputHash", "editGeneration", "requestSequence"]
    : ["kind", "artifactKind", "buildId", "localResourceId", "documentRevision", "savedRevision", "renderInputHash", "editGeneration", "saveState"];
  if (
    !exactKeys(request, requestKeys) ||
    !UUID.test(request.buildId) ||
    !UUID.test(request.localResourceId) ||
    !HASH.test(request.documentRevision) ||
    !HASH.test(request.renderInputHash) ||
    !Number.isSafeInteger(request.editGeneration) ||
    request.editGeneration < 0 ||
    request.localResourceId !== provenance.localResourceId ||
    request.documentRevision !== provenance.documentRevision ||
    request.renderInputHash !== provenance.renderInputHash ||
    request.editGeneration !== provenance.editGeneration
  ) fail("invalidEvent");
  if (request.kind === "preview") {
    if (!Number.isSafeInteger(request.requestSequence) || request.requestSequence < 1) {
      fail("invalidEvent");
    }
  } else if (
    !["draft", "finalCandidate"].includes(request.artifactKind) ||
    request.savedRevision !== request.documentRevision ||
    request.saveState !== "clean"
  ) fail("invalidEvent");
  const metadata = provenance.artifactMetadata;
  if (
    !HASH.test(provenance.sourceHash) ||
    !HASH.test(provenance.resourceClosureHash) ||
    !HASH.test(metadata.renderProjectionHash) ||
    !SAFE_TOKEN.test(metadata.generatorVersion) ||
    metadata.outputForm !== "readerOrder" ||
    !["draft", "printFinal", "accessibleFinal"].includes(metadata.readinessProfile) ||
    (metadata.readinessInputHash !== undefined && !HASH.test(metadata.readinessInputHash))
  ) fail("invalidEvent");
}

function sameIdentity(
  state: LifecycleState,
  request: BuildQueueRequest,
  provenance: TrustedBuildProvenance,
): boolean {
  try {
    return canonicalStringify(state.request) === canonicalStringify(request) &&
      canonicalStringify({
        projectionHandle: state.provenance.projectionHandle,
        localResourceId: state.provenance.localResourceId,
        documentRevision: state.provenance.documentRevision,
        renderInputHash: state.provenance.renderInputHash,
        editGeneration: state.provenance.editGeneration,
        sourceHash: state.provenance.sourceHash,
        resourceClosureHash: state.provenance.resourceClosureHash,
        artifactMetadata: state.provenance.artifactMetadata,
      }) === canonicalStringify({
        projectionHandle: provenance.projectionHandle,
        localResourceId: provenance.localResourceId,
        documentRevision: provenance.documentRevision,
        renderInputHash: provenance.renderInputHash,
        editGeneration: provenance.editGeneration,
        sourceHash: provenance.sourceHash,
        resourceClosureHash: provenance.resourceClosureHash,
        artifactMetadata: provenance.artifactMetadata,
      });
  } catch {
    return false;
  }
}

function artifactKind(request: BuildQueueRequest): ArtifactRecord["artifactKind"] {
  return request.kind === "preview" ? "preview" : request.artifactKind;
}

function commonMetadata(
  state: LifecycleState,
  tools: readonly ArtifactToolIdentity[],
  schemas: readonly ArtifactSchemaIdentity[],
): Omit<ArtifactRecord, "status" | "executionMode" | "completedAt" | "outputEvidence"> {
  const request = state.request;
  const metadata = state.provenance.artifactMetadata;
  return {
    version: 1,
    kind: "artifactRecord",
    buildId: request.buildId,
    bulletinLocalId: request.localResourceId,
    artifactKind: artifactKind(request),
    createdAt: state.createdAt,
    ...(state.startedAt === undefined ? {} : { startedAt: state.startedAt }),
    outputForm: metadata.outputForm,
    readinessProfile: metadata.readinessProfile,
    canonicalRevisionToken: request.documentRevision as Sha256Hash,
    renderInputHash: request.renderInputHash as Sha256Hash,
    ...(metadata.readinessInputHash === undefined
      ? {}
      : { readinessInputHash: metadata.readinessInputHash }),
    ...(request.kind === "preview"
      ? {
          editGeneration: request.editGeneration,
          requestSequence: request.requestSequence,
        }
      : {}),
    ...(metadata.watermark === undefined ? {} : { watermark: metadata.watermark }),
    toolIdentities: tools,
    schemaIdentities: schemas,
    diagnosticCodes: [],
  };
}

function artifactResources(request: OrchestratedRunnerRequest): ArtifactResourceClosure {
  const assets = [...request.resources.assets].sort((left, right) =>
    left.assetRef < right.assetRef ? -1 : left.assetRef > right.assetRef ? 1 : 0
  );
  const assetStaging = new Map(request.resources.stagingEntries.flatMap((entry) =>
    entry.kind === "asset" ? [[entry.assetRef as string, entry] as const] : []
  ));
  const assetStagingCount = request.resources.stagingEntries.filter(
    (entry) => entry.kind === "asset",
  ).length;
  const artifactAssets = assets.map((asset) => {
    const staged = assetStaging.get(asset.assetRef);
    if (staged === undefined || staged.hash !== asset.binaryHash || staged.mediaType !== asset.mediaType) {
      fail("invalidEvidence");
    }
    return Object.freeze({
      assetRef: asset.assetRef,
      binaryHash: asset.binaryHash,
      byteSize: staged.byteSize,
      mediaType: asset.mediaType,
    });
  });
  const stagedFonts = new Map<string, Extract<ResourceStagingEntry, { readonly kind: "fontFace" }>>(
    request.resources.stagingEntries.flatMap((entry) =>
    entry.kind === "fontFace"
      ? [[`${entry.fontRef}\0${entry.faceId}`, entry] as const]
      : []
    ),
  );
  const fontStagingCount = request.resources.stagingEntries.filter(
    (entry) => entry.kind === "fontFace",
  ).length;
  const artifactFonts = request.resources.fonts.flatMap((font) =>
    font.selectedFaces.map((face) => {
      const staged = stagedFonts.get(`${font.fontRef}\0${face.faceId}`);
      if (staged === undefined || staged.hash !== face.faceHash) fail("invalidEvidence");
      return Object.freeze({
        fontRef: font.fontRef,
        familyDigest: font.familyDigest,
        faceId: face.faceId,
        faceHash: face.faceHash,
        byteSize: staged.byteSize,
        embeddingPermitted: true,
        subsettingPermitted: face.embedding === "subset",
      });
    })
  ).sort((left, right) =>
    (left.fontRef < right.fontRef ? -1 : left.fontRef > right.fontRef ? 1 : 0) ||
    (left.faceId < right.faceId ? -1 : left.faceId > right.faceId ? 1 : 0)
  );
  if (
    artifactAssets.length !== assetStaging.size ||
    artifactAssets.length !== assetStagingCount ||
    artifactFonts.length !== stagedFonts.size ||
    artifactFonts.length !== fontStagingCount
  ) fail("invalidEvidence");
  return Object.freeze({
    assets: Object.freeze(artifactAssets),
    fontFaces: Object.freeze(artifactFonts),
  });
}

class Bridge implements BuildExecutionSinkPort, BuildArtifactStatusPort {
  private readonly tools: readonly ArtifactToolIdentity[];
  private readonly schemas: readonly ArtifactSchemaIdentity[];
  private readonly maximumActiveBuilds: number;
  private readonly states = new Map<string, LifecycleState>();

  constructor(private readonly options: ImmutableBuildArtifactBridgeOptions) {
    if (
      options.artifacts === null || typeof options.artifacts !== "object" ||
      options.outputReader === null || typeof options.outputReader !== "object" ||
      typeof options.artifacts.readArtifact !== "function" ||
      typeof options.artifacts.persistNonSuccess !== "function" ||
      typeof options.artifacts.bindCompileSink !== "function" ||
      typeof options.outputReader.readVerifiedPdf !== "function" ||
      options.clock === null || typeof options.clock !== "object" ||
      typeof options.clock.now !== "function" ||
      !Array.isArray(options.tools) || options.tools.length < 1 || options.tools.length > 32 ||
      !Array.isArray(options.schemas) || options.schemas.length < 1 || options.schemas.length > 32
    ) fail("invalidConfiguration");
    this.tools = Object.freeze(options.tools.map(closedTool));
    this.schemas = Object.freeze(options.schemas.map(closedSchema));
    if (
      this.tools.filter((tool) => tool.toolId === "typst").length !== 1 ||
      new Set(this.tools.map((tool) => tool.toolId)).size !== this.tools.length ||
      new Set(this.schemas.map((schema) => schema.schemaId)).size !== this.schemas.length
    ) fail("invalidConfiguration");
    const maximum = options.maximumActiveBuilds ?? MAX_ACTIVE_BUILDS;
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > MAX_ACTIVE_BUILDS) {
      fail("invalidConfiguration");
    }
    this.maximumActiveBuilds = maximum;
    exactDate(options.clock);
  }

  bind(request: OrchestratedRunnerRequest): BoundCompileArtifactSink {
    const state = this.requireState(request.request, request.provenance);
    if (state.phase !== "running" || state.startedAt === undefined) fail("invalidTransition");
    if (
      hashBytes(new TextEncoder().encode(request.generatedSource.source)) !== request.generatedSource.sourceHash ||
      request.generatedSource.sourceHash !== request.provenance.sourceHash ||
      resourceClosureExecutionHash(request.resources) !== request.provenance.resourceClosureHash
    ) fail("invalidEvidence");
    const resources = artifactResources(request);
    let persisted = false;
    return {
      persistCompile: async (evidence) => {
        if (persisted) fail("invalidTransition");
        const current = this.requireState(request.request, request.provenance);
        if (current.phase !== "running" || current.startedAt === undefined) fail("invalidTransition");
        const completedAt = this.nextTimestamp(current.startedAt);
        const metadata: SuccessfulArtifactMetadata = {
          ...commonMetadata(current, this.tools, this.schemas),
          startedAt: current.startedAt,
          completedAt,
        };
        const binding: CompileArtifactSinkBinding = {
          metadata,
          renderProjectionHash: request.provenance.artifactMetadata.renderProjectionHash,
          generatorVersion: request.provenance.artifactMetadata.generatorVersion,
          resources,
          outputReader: this.options.outputReader,
        };
        try {
          const record = await this.options.artifacts.bindCompileSink(binding).persistCompile(evidence);
          persisted = true;
          current.terminalRecord = record;
          return record;
        } catch (error) {
          throw error instanceof BuildArtifactBridgeError
            ? error
            : new BuildArtifactBridgeError("persistenceFailed");
        }
      },
    };
  }

  async record(event: BuildArtifactStatusEvent): Promise<void> {
    switch (event.type) {
      case "queued": {
        validateRequest(event.request, event.provenance);
        const existing = this.states.get(event.request.buildId);
        if (existing !== undefined) {
          if (!sameIdentity(existing, event.request, event.provenance)) fail("invalidEvent");
          return;
        }
        if (this.states.size >= this.maximumActiveBuilds) fail("capacityExceeded");
        this.states.set(event.request.buildId, {
          request: structuredClone(event.request),
          provenance: event.provenance,
          createdAt: exactDate(this.options.clock),
          phase: "queued",
        });
        return;
      }
      case "running": {
        const state = this.requireState(event.request, event.provenance);
        if (state.phase === "running") return;
        if (state.phase !== "queued") fail("invalidTransition");
        state.startedAt = this.nextTimestamp(state.createdAt);
        state.phase = "running";
        return;
      }
      case "terminal": {
        const state = this.requireState(event.request, event.provenance);
        if (state.phase === "terminal") return;
        if (state.phase !== "running") fail("invalidTransition");
        await this.persistTerminal(state, event.outcome.kind, event.outcome.diagnosticCodes);
        return;
      }
      case "queuedCanceled":
      case "enqueueIgnored": {
        const state = this.requireBuildId(event.buildId, event.provenance);
        if (state.phase === "terminal") return;
        if (state.phase !== "queued") fail("invalidTransition");
        await this.persistTerminal(state, "canceled", ["CBB-BUILD-0002"]);
        this.states.delete(event.buildId);
        return;
      }
      case "cancellationRequested": {
        const state = this.requireBuildId(event.buildId, event.provenance);
        if (state.phase !== "running" && state.phase !== "terminal") fail("invalidTransition");
        return;
      }
      case "previewPublished":
        this.finishStatusOnly(event.buildId, event.provenance, event.localResourceId);
        return;
      case "previewRetainedStale":
        this.finishStatusOnly(event.attemptedBuildId, event.provenance, event.localResourceId);
        return;
      case "previewResultIgnored":
        this.finishStatusOnly(event.buildId, event.provenance, event.localResourceId);
        return;
      case "manualFinished":
        this.finishStatusOnly(event.buildId, event.provenance);
        return;
    }
  }

  private requireState(
    request: BuildQueueRequest,
    provenance: TrustedBuildProvenance,
  ): LifecycleState {
    validateRequest(request, provenance);
    const state = this.states.get(request.buildId);
    if (state === undefined || !sameIdentity(state, request, provenance)) fail("invalidEvent");
    return state;
  }

  private requireBuildId(buildId: string, provenance: TrustedBuildProvenance): LifecycleState {
    if (!UUID.test(buildId)) fail("invalidEvent");
    const state = this.states.get(buildId);
    if (state === undefined || !sameIdentity(state, state.request, provenance)) fail("invalidEvent");
    return state;
  }

  private finishStatusOnly(
    buildId: string,
    provenance: TrustedBuildProvenance,
    localResourceId?: string,
  ): void {
    const state = this.requireBuildId(buildId, provenance);
    if (
      state.phase !== "terminal" ||
      (localResourceId !== undefined && state.request.localResourceId !== localResourceId)
    ) fail("invalidTransition");
    this.states.delete(buildId);
  }

  private nextTimestamp(notBefore: string): string {
    const timestamp = exactDate(this.options.clock);
    if (timestamp < notBefore) fail("invalidEvent");
    return timestamp;
  }

  private async persistTerminal(
    state: LifecycleState,
    outcome: "succeeded" | "failed" | "timedOut" | "canceled",
    diagnosticCodes: readonly string[],
  ): Promise<void> {
    if (
      !Array.isArray(diagnosticCodes) ||
      diagnosticCodes.length > 1_000 ||
      diagnosticCodes.some((code) => typeof code !== "string" || !DIAGNOSTIC.test(code))
    ) fail("invalidEvent");
    const existing = await this.options.artifacts.readArtifact(
      state.request.localResourceId,
      state.request.buildId,
    );
    if (outcome === "succeeded") {
      if (existing?.status !== "succeeded" || state.terminalRecord?.status !== "succeeded") {
        fail("persistenceFailed");
      }
      state.phase = "terminal";
      state.terminalRecord = existing;
      return;
    }
    // A compile commit is immutable and authoritative. Cancellation observed
    // immediately after that commit may suppress publication, but cannot turn
    // the same build id into a contradictory non-success record.
    if (existing?.status === "succeeded") {
      state.phase = "terminal";
      state.terminalRecord = existing;
      return;
    }
    const completedAt = this.nextTimestamp(state.startedAt ?? state.createdAt);
    const record: ArtifactRecord = {
      ...commonMetadata(state, this.tools, this.schemas),
      status: outcome,
      executionMode: "compile",
      completedAt,
      diagnosticCodes: [...diagnosticCodes],
    };
    if (existing !== undefined) {
      if (canonicalStringify(existing) !== canonicalStringify(record)) fail("persistenceFailed");
      state.phase = "terminal";
      state.terminalRecord = existing;
      return;
    }
    try {
      state.terminalRecord = await this.options.artifacts.persistNonSuccess(record);
      state.phase = "terminal";
    } catch {
      fail("persistenceFailed");
    }
  }
}

export function createImmutableBuildArtifactBridge(
  options: ImmutableBuildArtifactBridgeOptions,
): ImmutableBuildArtifactBridge {
  const bridge = new Bridge(options);
  return Object.freeze({ executionSinks: bridge, artifactStatuses: bridge });
}
