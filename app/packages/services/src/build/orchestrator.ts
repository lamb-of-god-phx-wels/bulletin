import { hashBytes } from "@cbb/core";
import type { Sha256Hash } from "@cbb/core";
import {
  resourceClosureExecutionHash,
  type VerifiedResourceClosure,
} from "../resources/index.js";
import { initialBuildQueueState, reduceBuildQueue } from "./queue.js";
import type {
  BuildQueueEffect,
  BuildQueueHash,
  BuildQueueRequest,
  BuildQueueState,
  BuildTerminalOutcome,
  CurrentBuildInputs,
  ManualBuildRequest,
  PreviewBuildRequest,
} from "./queue.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const DIAGNOSTIC = /^CBB-[A-Z]+-[0-9]{4}$/u;
const PROJECTION_HANDLE = /^projection:[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;
const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9_.+:-]{0,127}$/u;
const MAX_SOURCE_BYTES = 500 * 1024 * 1024;

/** Caller authority is deliberately limited to selecting a document/sequence. */
export interface PreviewBuildSubmission {
  readonly localResourceId: string;
  readonly requestSequence: number;
}

/** Caller authority is deliberately limited to the document and artifact kind. */
export interface ManualBuildSubmission {
  readonly localResourceId: string;
  readonly artifactKind: "draft" | "finalCandidate";
}

export interface BuildAdmissionResult {
  readonly buildId: string;
  readonly status: "enqueued" | "ignored";
}

export interface TrustedBuildWatermark {
  readonly kind: "draft" | "proof";
  readonly text: string;
  readonly version: string;
}

/** Artifact fields derived by the trusted projection provider, never IPC. */
export interface TrustedBuildArtifactMetadata {
  readonly renderProjectionHash: Sha256Hash;
  readonly generatorVersion: string;
  readonly outputForm: "readerOrder" | "bookletTwoUp";
  readonly readinessProfile: "draft" | "printFinal" | "accessibleFinal";
  readonly readinessInputHash?: Sha256Hash;
  readonly watermark?: TrustedBuildWatermark;
}

export interface PreparedBuildProjection {
  readonly projectionHandle: string;
  readonly localResourceId: string;
  readonly documentRevision: BuildQueueHash;
  readonly renderInputHash: BuildQueueHash;
  readonly editGeneration: number;
  readonly source: string;
  readonly sourceHash: Sha256Hash;
  readonly resourceClosureHash: Sha256Hash;
  readonly artifactMetadata: TrustedBuildArtifactMetadata;
}

declare const trustedBuildProvenanceBrand: unique symbol;

/** Closed, validated projection evidence constructed only inside this service. */
export type TrustedBuildProvenance = Readonly<{
  projectionHandle: string;
  localResourceId: string;
  documentRevision: BuildQueueHash;
  renderInputHash: BuildQueueHash;
  editGeneration: number;
  sourceHash: Sha256Hash;
  resourceClosureHash: Sha256Hash;
  artifactMetadata: TrustedBuildArtifactMetadata;
  [trustedBuildProvenanceBrand]: true;
}>;

export type TrustedBuildProjectionRequest =
  | {
      readonly kind: "preview";
      readonly localResourceId: string;
      readonly requestSequence: number;
    }
  | {
      readonly kind: "manual";
      readonly localResourceId: string;
      readonly artifactKind: "draft" | "finalCandidate";
      readonly savedInputs: CurrentBuildInputs & { readonly saveState: "clean" };
    };

export interface TrustedBuildProjectionProviderPort {
  /** Load the named snapshot, resolve/project/hash it, then generate Typst. */
  prepare(request: TrustedBuildProjectionRequest): Promise<PreparedBuildProjection>;
}

export interface BuildIdPort {
  mintBuildId(): string;
}

export interface ManualBuildSavePort {
  /** Save the authoritative document and return its post-save identity. */
  saveAndReadClean(request: {
    readonly localResourceId: string;
  }): Promise<CurrentBuildInputs>;
}

export interface BuildCurrentInputsPort {
  readCurrent(localResourceId: string): Promise<CurrentBuildInputs>;
}

export interface BuildResourceClosurePort {
  /** Resolve/re-hash exactly the provider-owned projection handle. */
  resolve(request: {
    readonly request: BuildQueueRequest;
    readonly provenance: TrustedBuildProvenance;
  }): Promise<VerifiedResourceClosure>;
}

export interface OrchestratedRunnerRequest {
  readonly request: BuildQueueRequest;
  readonly generatedSource: {
    readonly source: string;
    readonly sourceHash: Sha256Hash;
  };
  readonly provenance: TrustedBuildProvenance;
  readonly resources: VerifiedResourceClosure;
}

export interface OrchestratedRunnerOutcome {
  readonly kind: BuildTerminalOutcome["kind"];
  readonly diagnosticCodes: readonly string[];
}

export interface BuildExecutionPort {
  execute(
    request: OrchestratedRunnerRequest,
    signal: AbortSignal,
  ): Promise<OrchestratedRunnerOutcome>;
  cancelProcessTree(
    buildId: string,
    reason: "previewSuperseded" | "manualPriority" | "requested",
  ): Promise<void>;
}

interface ProvenanceEvent {
  readonly provenance: TrustedBuildProvenance;
}

export type BuildArtifactStatusEvent =
  | (ProvenanceEvent & { readonly type: "queued"; readonly request: BuildQueueRequest })
  | (ProvenanceEvent & { readonly type: "running"; readonly request: BuildQueueRequest })
  | (ProvenanceEvent & {
      readonly type: "terminal";
      readonly request: BuildQueueRequest;
      readonly outcome: OrchestratedRunnerOutcome;
    })
  | (ProvenanceEvent & {
      readonly type: "cancellationRequested";
      readonly buildId: string;
      readonly reason: "previewSuperseded" | "manualPriority" | "requested";
    })
  | (ProvenanceEvent & {
      readonly type: "queuedCanceled";
      readonly buildId: string;
      readonly reason: "previewSuperseded" | "manualPriority" | "requested";
    })
  | (ProvenanceEvent & { readonly type: "enqueueIgnored"; readonly buildId: string })
  | (ProvenanceEvent & {
      readonly type: "previewPublished";
      readonly localResourceId: string;
      readonly buildId: string;
    })
  | (ProvenanceEvent & {
      readonly type: "previewRetainedStale";
      readonly localResourceId: string;
      readonly attemptedBuildId: string;
      readonly retainedBuildId?: string;
      readonly reason: "failed" | "timedOut" | "canceled" | "staleResult";
    })
  | (ProvenanceEvent & {
      readonly type: "previewResultIgnored";
      readonly localResourceId: string;
      readonly buildId: string;
    })
  | (ProvenanceEvent & {
      readonly type: "manualFinished";
      readonly buildId: string;
      readonly current: boolean;
      readonly outcome: BuildTerminalOutcome["kind"];
    });

export interface BuildArtifactStatusPort {
  record(event: BuildArtifactStatusEvent): Promise<void>;
}

export interface BuildOrchestratorPorts {
  readonly ids: BuildIdPort;
  readonly projections: TrustedBuildProjectionProviderPort;
  readonly saves: ManualBuildSavePort;
  readonly currentInputs: BuildCurrentInputsPort;
  readonly resources: BuildResourceClosurePort;
  readonly runner: BuildExecutionPort;
  readonly artifacts: BuildArtifactStatusPort;
}

export type BuildOrchestratorErrorKind =
  | "invalidSubmission"
  | "duplicateBuild"
  | "idAllocationFailed"
  | "projectionFailed"
  | "projectionNotExact"
  | "saveFailed"
  | "saveNotExact"
  | "statusPersistenceFailed";

export class BuildOrchestratorError extends Error {
  readonly code: "CBB-BUILD-0001" | "CBB-SAVE-0002";
  readonly kind: BuildOrchestratorErrorKind;

  constructor(
    kind: BuildOrchestratorErrorKind,
    code: BuildOrchestratorError["code"],
    message: string,
  ) {
    super(message);
    this.name = "BuildOrchestratorError";
    this.kind = kind;
    this.code = code;
  }
}

interface SubmissionPayload {
  readonly source: string;
  readonly provenance: TrustedBuildProvenance;
}

interface ActiveExecution {
  readonly controller: AbortController;
}

function closedObject(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[] = allowed,
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return false;
  const allowedSet = new Set(allowed);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowedSet.has(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) return false;
  }
  return required.every((key) => Object.hasOwn(value, key));
}

function validatePreviewSubmission(raw: unknown): PreviewBuildSubmission {
  if (!closedObject(raw, ["localResourceId", "requestSequence"])) {
    throw new BuildOrchestratorError("invalidSubmission", "CBB-BUILD-0001", "Preview submission is not closed");
  }
  if (
    typeof raw["localResourceId"] !== "string" ||
    !UUID_V4.test(raw["localResourceId"]) ||
    !Number.isSafeInteger(raw["requestSequence"]) ||
    (raw["requestSequence"] as number) < 1
  ) {
    throw new BuildOrchestratorError("invalidSubmission", "CBB-BUILD-0001", "Preview submission is malformed");
  }
  return Object.freeze({
    localResourceId: raw["localResourceId"],
    requestSequence: raw["requestSequence"] as number,
  });
}

function validateManualSubmission(raw: unknown): ManualBuildSubmission {
  if (!closedObject(raw, ["localResourceId", "artifactKind"])) {
    throw new BuildOrchestratorError("invalidSubmission", "CBB-BUILD-0001", "Manual submission is not closed");
  }
  if (
    typeof raw["localResourceId"] !== "string" ||
    !UUID_V4.test(raw["localResourceId"]) ||
    (raw["artifactKind"] !== "draft" && raw["artifactKind"] !== "finalCandidate")
  ) {
    throw new BuildOrchestratorError("invalidSubmission", "CBB-BUILD-0001", "Manual submission is malformed");
  }
  return Object.freeze({
    localResourceId: raw["localResourceId"],
    artifactKind: raw["artifactKind"],
  });
}

function validCurrentInputs(value: unknown): value is CurrentBuildInputs {
  if (!closedObject(
    value,
    ["documentRevision", "renderInputHash", "editGeneration", "saveState"],
  )) return false;
  return (
    typeof value["documentRevision"] === "string" && SHA256.test(value["documentRevision"]) &&
    typeof value["renderInputHash"] === "string" && SHA256.test(value["renderInputHash"]) &&
    Number.isSafeInteger(value["editGeneration"]) && Number(value["editGeneration"]) >= 0 &&
    ["clean", "dirty", "saving", "saveFailed", "conflicted", "readOnly"].includes(String(value["saveState"]))
  );
}

function validateArtifactMetadata(raw: unknown): TrustedBuildArtifactMetadata {
  if (!closedObject(
    raw,
    [
      "renderProjectionHash", "generatorVersion", "outputForm",
      "readinessProfile", "readinessInputHash", "watermark",
    ],
    ["renderProjectionHash", "generatorVersion", "outputForm", "readinessProfile"],
  )) {
    throw new BuildOrchestratorError("projectionNotExact", "CBB-BUILD-0001", "Projection artifact metadata is not closed");
  }
  if (
    typeof raw["renderProjectionHash"] !== "string" ||
    !SHA256.test(raw["renderProjectionHash"]) ||
    typeof raw["generatorVersion"] !== "string" ||
    !SAFE_VERSION.test(raw["generatorVersion"]) ||
    (raw["outputForm"] !== "readerOrder" && raw["outputForm"] !== "bookletTwoUp") ||
    !["draft", "printFinal", "accessibleFinal"].includes(String(raw["readinessProfile"])) ||
    (raw["readinessInputHash"] !== undefined &&
      (typeof raw["readinessInputHash"] !== "string" || !SHA256.test(raw["readinessInputHash"])))
  ) {
    throw new BuildOrchestratorError("projectionNotExact", "CBB-BUILD-0001", "Projection artifact metadata is malformed");
  }
  let watermark: TrustedBuildWatermark | undefined;
  if (raw["watermark"] !== undefined) {
    const entry = raw["watermark"];
    if (
      !closedObject(entry, ["kind", "text", "version"]) ||
      (entry["kind"] !== "draft" && entry["kind"] !== "proof") ||
      typeof entry["text"] !== "string" ||
      entry["text"].length < 1 ||
      [...entry["text"]].length > 128 ||
      /[\u0000-\u001f\u007f-\u009f]/u.test(entry["text"]) ||
      typeof entry["version"] !== "string" ||
      !SAFE_VERSION.test(entry["version"])
    ) {
      throw new BuildOrchestratorError("projectionNotExact", "CBB-BUILD-0001", "Projection watermark metadata is malformed");
    }
    watermark = Object.freeze({
      kind: entry["kind"],
      text: entry["text"],
      version: entry["version"],
    });
  }
  return Object.freeze({
    renderProjectionHash: raw["renderProjectionHash"] as Sha256Hash,
    generatorVersion: raw["generatorVersion"],
    outputForm: raw["outputForm"],
    readinessProfile: raw["readinessProfile"] as TrustedBuildArtifactMetadata["readinessProfile"],
    ...(raw["readinessInputHash"] !== undefined
      ? { readinessInputHash: raw["readinessInputHash"] as Sha256Hash }
      : {}),
    ...(watermark !== undefined ? { watermark } : {}),
  });
}

function validatePreparedProjection(
  raw: unknown,
  localResourceId: string,
): { readonly source: string; readonly provenance: TrustedBuildProvenance } {
  if (!closedObject(raw, [
    "projectionHandle", "localResourceId", "documentRevision", "renderInputHash",
    "editGeneration", "source", "sourceHash", "resourceClosureHash", "artifactMetadata",
  ])) {
    throw new BuildOrchestratorError("projectionNotExact", "CBB-BUILD-0001", "Prepared projection is not closed");
  }
  if (
    typeof raw["projectionHandle"] !== "string" ||
    !PROJECTION_HANDLE.test(raw["projectionHandle"]) ||
    raw["localResourceId"] !== localResourceId ||
    typeof raw["documentRevision"] !== "string" ||
    !SHA256.test(raw["documentRevision"]) ||
    typeof raw["renderInputHash"] !== "string" ||
    !SHA256.test(raw["renderInputHash"]) ||
    !Number.isSafeInteger(raw["editGeneration"]) ||
    (raw["editGeneration"] as number) < 0 ||
    typeof raw["source"] !== "string" ||
    raw["source"].length < 1 ||
    raw["source"].length > MAX_SOURCE_BYTES ||
    raw["source"].includes("\u0000") ||
    typeof raw["sourceHash"] !== "string" ||
    !SHA256.test(raw["sourceHash"]) ||
    typeof raw["resourceClosureHash"] !== "string" ||
    !SHA256.test(raw["resourceClosureHash"])
  ) {
    throw new BuildOrchestratorError("projectionNotExact", "CBB-BUILD-0001", "Prepared projection identity is malformed");
  }
  const sourceBytes = new TextEncoder().encode(raw["source"]);
  if (sourceBytes.byteLength > MAX_SOURCE_BYTES || hashBytes(sourceBytes) !== raw["sourceHash"]) {
    throw new BuildOrchestratorError("projectionNotExact", "CBB-BUILD-0001", "Prepared projection source identity is invalid");
  }
  const artifactMetadata = validateArtifactMetadata(raw["artifactMetadata"]);
  const provenance = Object.freeze({
    projectionHandle: raw["projectionHandle"],
    localResourceId,
    documentRevision: raw["documentRevision"] as BuildQueueHash,
    renderInputHash: raw["renderInputHash"] as BuildQueueHash,
    editGeneration: raw["editGeneration"] as number,
    sourceHash: raw["sourceHash"] as Sha256Hash,
    resourceClosureHash: raw["resourceClosureHash"] as Sha256Hash,
    artifactMetadata,
  }) as TrustedBuildProvenance;
  return Object.freeze({ source: raw["source"], provenance });
}

function exactInputs(
  provenance: TrustedBuildProvenance,
  current: CurrentBuildInputs,
): boolean {
  return (
    provenance.documentRevision === current.documentRevision &&
    provenance.renderInputHash === current.renderInputHash &&
    provenance.editGeneration === current.editGeneration
  );
}

function validateRunnerOutcome(value: unknown): OrchestratedRunnerOutcome {
  if (
    !closedObject(value, ["kind", "diagnosticCodes"]) ||
    !["succeeded", "failed", "timedOut", "canceled"].includes(String(value["kind"])) ||
    !Array.isArray(value["diagnosticCodes"]) ||
    value["diagnosticCodes"].length > 1_000 ||
    value["diagnosticCodes"].some((code) => typeof code !== "string" || !DIAGNOSTIC.test(code))
  ) return failedOutcome();
  return Object.freeze({
    kind: value["kind"] as BuildTerminalOutcome["kind"],
    diagnosticCodes: Object.freeze([...(value["diagnosticCodes"] as string[])]),
  });
}

function failedOutcome(): OrchestratedRunnerOutcome {
  return { kind: "failed", diagnosticCodes: ["CBB-BUILD-0001"] };
}

export class BuildOrchestrator {
  private state: BuildQueueState = initialBuildQueueState();
  private readonly payloads = new Map<string, SubmissionPayload>();
  private readonly executions = new Map<string, ActiveExecution>();
  private readonly seenBuildIds = new Set<string>();
  private pendingAdmissions = 0;
  private dispatchTail: Promise<void> = Promise.resolve();
  private readonly idleWaiters: Array<() => void> = [];

  constructor(private readonly ports: BuildOrchestratorPorts) {}

  getState(): BuildQueueState {
    return structuredClone(this.state);
  }

  async submitPreview(raw: PreviewBuildSubmission): Promise<BuildAdmissionResult> {
    this.pendingAdmissions += 1;
    try {
      return await this.serialize(async () => {
        const submission = validatePreviewSubmission(raw);
        const buildId = this.mintBuildId();
        const prepared = await this.prepareProjection({
          kind: "preview",
          localResourceId: submission.localResourceId,
          requestSequence: submission.requestSequence,
        });
        const request: PreviewBuildRequest = {
          kind: "preview",
          buildId,
          localResourceId: prepared.provenance.localResourceId,
          documentRevision: prepared.provenance.documentRevision,
          renderInputHash: prepared.provenance.renderInputHash,
          editGeneration: prepared.provenance.editGeneration,
          requestSequence: submission.requestSequence,
        };
        return this.admit(request, prepared);
      });
    } finally {
      this.pendingAdmissions -= 1;
      this.resolveIdleWaiters();
    }
  }

  async submitManual(raw: ManualBuildSubmission): Promise<BuildAdmissionResult> {
    this.pendingAdmissions += 1;
    try {
      return await this.serialize(async () => {
        const submission = validateManualSubmission(raw);
        let saved: CurrentBuildInputs;
        try {
          saved = await this.ports.saves.saveAndReadClean({
            localResourceId: submission.localResourceId,
          });
        } catch {
          throw new BuildOrchestratorError("saveFailed", "CBB-SAVE-0002", "Manual build requires a durable clean save");
        }
        if (!validCurrentInputs(saved) || saved.saveState !== "clean") {
          throw new BuildOrchestratorError("saveNotExact", "CBB-SAVE-0002", "Manual build save did not return a clean revision");
        }
        const buildId = this.mintBuildId();
        const prepared = await this.prepareProjection({
          kind: "manual",
          localResourceId: submission.localResourceId,
          artifactKind: submission.artifactKind,
          savedInputs: { ...saved, saveState: "clean" },
        });
        if (!exactInputs(prepared.provenance, saved)) {
          throw new BuildOrchestratorError("projectionNotExact", "CBB-SAVE-0002", "Manual projection does not match the exact clean save");
        }
        const request: ManualBuildRequest = {
          kind: "manual",
          artifactKind: submission.artifactKind,
          buildId,
          localResourceId: prepared.provenance.localResourceId,
          documentRevision: prepared.provenance.documentRevision,
          savedRevision: saved.documentRevision,
          renderInputHash: prepared.provenance.renderInputHash,
          editGeneration: prepared.provenance.editGeneration,
          saveState: "clean",
        };
        return this.admit(request, prepared);
      });
    } finally {
      this.pendingAdmissions -= 1;
      this.resolveIdleWaiters();
    }
  }

  async cancel(buildId: string): Promise<void> {
    if (!UUID_V4.test(buildId)) {
      throw new BuildOrchestratorError("invalidSubmission", "CBB-BUILD-0001", "Build id is invalid");
    }
    await this.serialize(async () => {
      await this.transition({ type: "cancel", buildId });
    });
  }

  async setDragActive(localResourceId: string, active: boolean): Promise<void> {
    if (!UUID_V4.test(localResourceId) || typeof active !== "boolean") {
      throw new BuildOrchestratorError("invalidSubmission", "CBB-BUILD-0001", "Drag state is invalid");
    }
    await this.serialize(async () => {
      await this.transition({ type: "setDragActive", localResourceId, active });
    });
  }

  whenIdle(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((resolveIdle) => this.idleWaiters.push(resolveIdle));
  }

  private mintBuildId(): string {
    let buildId: string;
    try {
      buildId = this.ports.ids.mintBuildId();
    } catch {
      throw new BuildOrchestratorError("idAllocationFailed", "CBB-BUILD-0001", "Build identity allocation failed");
    }
    if (!UUID_V4.test(buildId) || this.seenBuildIds.has(buildId)) {
      throw new BuildOrchestratorError("idAllocationFailed", "CBB-BUILD-0001", "Build identity allocation returned an invalid or reused id");
    }
    return buildId;
  }

  private async prepareProjection(
    request: TrustedBuildProjectionRequest,
  ): Promise<{ readonly source: string; readonly provenance: TrustedBuildProvenance }> {
    let raw: PreparedBuildProjection;
    try {
      raw = await this.ports.projections.prepare(request);
    } catch {
      throw new BuildOrchestratorError("projectionFailed", "CBB-BUILD-0001", "Trusted build projection preparation failed");
    }
    const prepared = validatePreparedProjection(raw, request.localResourceId);
    if (request.kind === "manual") {
      const metadata = prepared.provenance.artifactMetadata;
      const invalidDraft = request.artifactKind === "draft" &&
        (metadata.readinessInputHash === undefined || metadata.watermark === undefined);
      const invalidFinal = request.artifactKind === "finalCandidate" &&
        (
          metadata.readinessInputHash === undefined ||
          metadata.watermark !== undefined ||
          metadata.readinessProfile === "draft"
        );
      if (invalidDraft || invalidFinal) {
        throw new BuildOrchestratorError(
          "projectionNotExact",
          "CBB-BUILD-0001",
          "Trusted projection metadata is incompatible with the requested artifact kind",
        );
      }
    }
    return prepared;
  }

  private async admit(
    request: BuildQueueRequest,
    payload: SubmissionPayload,
  ): Promise<BuildAdmissionResult> {
    if (this.seenBuildIds.has(request.buildId)) {
      throw new BuildOrchestratorError("duplicateBuild", "CBB-BUILD-0001", "Build id was already used");
    }
    try {
      await this.ports.artifacts.record({ type: "queued", request, provenance: payload.provenance });
    } catch {
      throw new BuildOrchestratorError("statusPersistenceFailed", "CBB-BUILD-0001", "Build queued status could not be recorded");
    }
    this.seenBuildIds.add(request.buildId);
    this.payloads.set(request.buildId, payload);
    let effects: readonly BuildQueueEffect[];
    try {
      effects = await this.transition({ type: "enqueue", request });
    } catch (error) {
      this.payloads.delete(request.buildId);
      throw error;
    }
    return {
      buildId: request.buildId,
      status: effects.some((effect) =>
        effect.type === "enqueueIgnored" && effect.buildId === request.buildId,
      ) ? "ignored" : "enqueued",
    };
  }

  private async transition(
    event: Parameters<typeof reduceBuildQueue>[1],
  ): Promise<readonly BuildQueueEffect[]> {
    const result = reduceBuildQueue(this.state, event);
    this.state = result.state;
    for (const effect of result.effects) await this.applyEffect(effect);
    this.resolveIdleWaiters();
    return result.effects;
  }

  private provenanceFor(buildId: string): TrustedBuildProvenance | undefined {
    return this.payloads.get(buildId)?.provenance;
  }

  private async applyEffect(effect: BuildQueueEffect): Promise<void> {
    switch (effect.type) {
      case "start":
        this.launch(effect.request);
        return;
      case "cancelRunning": {
        this.executions.get(effect.buildId)?.controller.abort();
        const provenance = this.provenanceFor(effect.buildId);
        if (provenance !== undefined) {
          await this.safeStatus({
            type: "cancellationRequested",
            buildId: effect.buildId,
            reason: effect.reason,
            provenance,
          });
        }
        try {
          await this.ports.runner.cancelProcessTree(effect.buildId, effect.reason);
        } catch {
          // AbortSignal remains the mandatory second cancellation mechanism.
        }
        return;
      }
      case "queuedBuildCanceled": {
        const provenance = this.provenanceFor(effect.buildId);
        if (provenance !== undefined) {
          await this.safeStatus({
            type: "queuedCanceled",
            buildId: effect.buildId,
            reason: effect.reason,
            provenance,
          });
        }
        this.payloads.delete(effect.buildId);
        return;
      }
      case "enqueueIgnored": {
        const provenance = this.provenanceFor(effect.buildId);
        if (provenance !== undefined) {
          await this.safeStatus({ type: "enqueueIgnored", buildId: effect.buildId, provenance });
        }
        this.payloads.delete(effect.buildId);
        return;
      }
      case "previewPublished": {
        const provenance = this.provenanceFor(effect.buildId);
        if (provenance !== undefined) {
          await this.safeStatus({
            type: "previewPublished",
            localResourceId: effect.localResourceId,
            buildId: effect.buildId,
            provenance,
          });
        }
        return;
      }
      case "previewRetainedStale": {
        const provenance = this.provenanceFor(effect.attemptedBuildId);
        if (provenance !== undefined) {
          await this.safeStatus({
            type: "previewRetainedStale",
            localResourceId: effect.localResourceId,
            attemptedBuildId: effect.attemptedBuildId,
            ...(effect.retainedBuildId !== undefined ? { retainedBuildId: effect.retainedBuildId } : {}),
            reason: effect.reason,
            provenance,
          });
        }
        return;
      }
      case "previewResultIgnored": {
        const provenance = this.provenanceFor(effect.buildId);
        if (provenance !== undefined) {
          await this.safeStatus({
            type: "previewResultIgnored",
            localResourceId: effect.localResourceId,
            buildId: effect.buildId,
            provenance,
          });
        }
        return;
      }
      case "manualBuildFinished": {
        const provenance = this.provenanceFor(effect.buildId);
        if (provenance !== undefined) {
          await this.safeStatus({
            type: "manualFinished",
            buildId: effect.buildId,
            current: effect.current,
            outcome: effect.outcome,
            provenance,
          });
        }
        return;
      }
    }
  }

  private launch(request: BuildQueueRequest): void {
    const controller = new AbortController();
    this.executions.set(request.buildId, { controller });
    void this.execute(request, controller).catch(() => {
      void this.serialize(async () => {
        if (this.state.running?.request.buildId !== request.buildId) return;
        this.executions.delete(request.buildId);
        await this.transition({
          type: "complete",
          buildId: request.buildId,
          outcome: { kind: "failed" },
          currentInputs: {
            documentRevision: request.documentRevision,
            renderInputHash: request.renderInputHash,
            editGeneration: request.editGeneration,
            saveState: "saveFailed",
          },
        });
        this.payloads.delete(request.buildId);
      });
    });
  }

  private async execute(
    request: BuildQueueRequest,
    controller: AbortController,
  ): Promise<void> {
    const payload = this.payloads.get(request.buildId);
    let outcome = failedOutcome();
    if (payload !== undefined) {
      try {
        await this.ports.artifacts.record({
          type: "running",
          request,
          provenance: payload.provenance,
        });
        const resources = await this.ports.resources.resolve({
          request,
          provenance: payload.provenance,
        });
        if (resourceClosureExecutionHash(resources) !== payload.provenance.resourceClosureHash) {
          throw new BuildOrchestratorError(
            "projectionNotExact",
            "CBB-BUILD-0001",
            "Resolved resources do not match trusted projection provenance",
          );
        }
        if (controller.signal.aborted) {
          outcome = { kind: "canceled", diagnosticCodes: ["CBB-BUILD-0002"] };
        } else {
          outcome = validateRunnerOutcome(await this.ports.runner.execute({
            request,
            generatedSource: {
              source: payload.source,
              sourceHash: payload.provenance.sourceHash,
            },
            provenance: payload.provenance,
            resources,
          }, controller.signal));
          if (controller.signal.aborted && outcome.kind === "succeeded") {
            outcome = { kind: "canceled", diagnosticCodes: ["CBB-BUILD-0002"] };
          }
        }
      } catch {
        outcome = failedOutcome();
      }
    }

    if (payload !== undefined) {
      try {
        await this.ports.artifacts.record({
          type: "terminal",
          request,
          outcome,
          provenance: payload.provenance,
        });
      } catch {
        outcome = failedOutcome();
        await this.safeStatus({
          type: "terminal",
          request,
          outcome,
          provenance: payload.provenance,
        });
      }
    }

    let current: CurrentBuildInputs;
    try {
      current = await this.ports.currentInputs.readCurrent(request.localResourceId);
      if (!validCurrentInputs(current)) throw new TypeError("invalid current inputs");
    } catch {
      const staleRenderInputHash = (
        request.renderInputHash === `sha256:${"0".repeat(64)}`
          ? `sha256:${"1".repeat(64)}`
          : `sha256:${"0".repeat(64)}`
      ) as BuildQueueHash;
      current = {
        documentRevision: request.documentRevision,
        renderInputHash: staleRenderInputHash,
        editGeneration: request.editGeneration,
        saveState: "saveFailed",
      };
    }

    await this.serialize(async () => {
      this.executions.delete(request.buildId);
      await this.transition({
        type: "complete",
        buildId: request.buildId,
        outcome: { kind: outcome.kind },
        currentInputs: current,
      });
      this.payloads.delete(request.buildId);
    });
  }

  private async safeStatus(event: BuildArtifactStatusEvent): Promise<void> {
    try {
      await this.ports.artifacts.record(event);
    } catch {
      // Queue ownership and cancellation continue. A terminal status failure is
      // converted to a failed outcome before completion above.
    }
  }

  private serialize<Result>(operation: () => Promise<Result>): Promise<Result> {
    const run = this.dispatchTail.then(operation, operation);
    this.dispatchTail = run.then(() => undefined, () => undefined);
    return run;
  }

  private isIdle(): boolean {
    return this.state.running === undefined &&
      this.state.queued.length === 0 &&
      this.executions.size === 0 &&
      this.pendingAdmissions === 0;
  }

  private resolveIdleWaiters(): void {
    if (!this.isIdle()) return;
    for (const waiter of this.idleWaiters.splice(0)) waiter();
  }
}
