import { describe, expect, it, vi } from "vitest";
import { hashBytes } from "@cbb/core";
import {
  resourceClosureExecutionHash,
  type VerifiedResourceClosure,
} from "../resources/index.js";
import {
  BuildOrchestrator,
  type BuildArtifactStatusEvent,
  type BuildArtifactStatusPort,
  type BuildExecutionPort,
  type BuildQueueHash,
  type BuildResourceClosurePort,
  type CurrentBuildInputs,
  type ManualBuildSavePort,
  type ManualBuildSubmission,
  type OrchestratedRunnerOutcome,
  type OrchestratedRunnerRequest,
  type PreparedBuildProjection,
  type PreviewBuildSubmission,
  type TrustedBuildProjectionProviderPort,
  type TrustedBuildProjectionRequest,
} from "./index.js";

const SOURCE = "#text(\"trusted projection\")";
const SOURCE_HASH = hashBytes(new TextEncoder().encode(SOURCE));
const REVISION = hashBytes(new TextEncoder().encode("revision")) as BuildQueueHash;
const RENDER = hashBytes(new TextEncoder().encode("render")) as BuildQueueHash;
const OTHER_RENDER = hashBytes(new TextEncoder().encode("other-render")) as BuildQueueHash;
const PROJECTION_HASH = hashBytes(new TextEncoder().encode("projection"));
const READINESS_HASH = hashBytes(new TextEncoder().encode("readiness"));
const RESOURCE = "11111111-1111-4111-8111-111111111111";

const EMPTY_RESOURCES: VerifiedResourceClosure = Object.freeze({
  assets: [],
  fonts: [],
  assetBindings: {},
  fontBindings: {},
  stagingEntries: [],
  warnings: [],
  totals: {
    assetCount: 0,
    assetBytes: 0,
    fontFamilyCount: 0,
    fontFaceCount: 0,
    fontBytes: 0,
  },
});

function buildId(digit: string): string {
  return `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
}

function current(overrides: Partial<CurrentBuildInputs> = {}): CurrentBuildInputs {
  return {
    documentRevision: REVISION,
    renderInputHash: RENDER,
    editGeneration: 1,
    saveState: "clean",
    ...overrides,
  };
}

function prepared(
  inputs: CurrentBuildInputs,
  overrides: Partial<PreparedBuildProjection> = {},
): PreparedBuildProjection {
  return {
    projectionHandle: "projection:trusted-snapshot-1",
    localResourceId: RESOURCE,
    documentRevision: inputs.documentRevision,
    renderInputHash: inputs.renderInputHash,
    editGeneration: inputs.editGeneration,
    source: SOURCE,
    sourceHash: SOURCE_HASH,
    resourceClosureHash: resourceClosureExecutionHash(EMPTY_RESOURCES),
    artifactMetadata: {
      renderProjectionHash: PROJECTION_HASH,
      generatorVersion: "cbb-typstgen-v1",
      outputForm: "readerOrder",
      readinessProfile: "draft",
      readinessInputHash: READINESS_HASH,
      watermark: { kind: "draft", text: "DRAFT", version: "v1" },
    },
    ...overrides,
  };
}

function preview(requestSequence: number): PreviewBuildSubmission {
  return { localResourceId: RESOURCE, requestSequence };
}

function manual(): ManualBuildSubmission {
  return { localResourceId: RESOURCE, artifactKind: "draft" };
}

class ArtifactEvents implements BuildArtifactStatusPort {
  readonly events: BuildArtifactStatusEvent[] = [];
  failNextType: BuildArtifactStatusEvent["type"] | undefined;

  async record(event: BuildArtifactStatusEvent): Promise<void> {
    this.events.push(event);
    if (this.failNextType === event.type) {
      this.failNextType = undefined;
      throw new Error("simulated status fault with /private/workspace/path");
    }
  }
}

interface PendingRun {
  readonly request: OrchestratedRunnerRequest;
  readonly signal: AbortSignal;
  readonly resolve: (outcome: OrchestratedRunnerOutcome) => void;
}

class ControlledRunner implements BuildExecutionPort {
  readonly runs: OrchestratedRunnerRequest[] = [];
  readonly pending = new Map<string, PendingRun>();
  readonly cancellations: Array<{ buildId: string; reason: string }> = [];

  async execute(request: OrchestratedRunnerRequest, signal: AbortSignal) {
    this.runs.push(request);
    return new Promise<OrchestratedRunnerOutcome>((resolve) => {
      this.pending.set(request.request.buildId, { request, signal, resolve });
    });
  }

  async cancelProcessTree(
    buildIdValue: string,
    reason: "previewSuperseded" | "manualPriority" | "requested",
  ) {
    this.cancellations.push({ buildId: buildIdValue, reason });
  }

  complete(buildIdValue: string, kind: OrchestratedRunnerOutcome["kind"]): void {
    const run = this.pending.get(buildIdValue);
    if (run === undefined) throw new Error(`No pending build ${buildIdValue}`);
    this.pending.delete(buildIdValue);
    run.resolve({
      kind,
      diagnosticCodes: kind === "succeeded"
        ? []
        : [kind === "timedOut" || kind === "canceled" ? "CBB-BUILD-0002" : "CBB-BUILD-0001"],
    });
  }
}

interface Harness {
  orchestrator: BuildOrchestrator;
  readonly runner: ControlledRunner;
  readonly artifacts: ArtifactEvents;
  readonly projectionCalls: TrustedBuildProjectionRequest[];
  readonly resourceCalls: Array<Parameters<BuildResourceClosurePort["resolve"]>[0]>;
  readonly releasedProjectionHandles: string[];
  readonly save: ReturnType<typeof vi.fn<ManualBuildSavePort["saveAndReadClean"]>>;
  currentValue: CurrentBuildInputs;
  preparedOverride: Partial<PreparedBuildProjection>;
  failProjection: boolean;
  failResources: boolean;
}

function harness(): Harness {
  const runner = new ControlledRunner();
  const artifacts = new ArtifactEvents();
  const projectionCalls: TrustedBuildProjectionRequest[] = [];
  const resourceCalls: Array<Parameters<BuildResourceClosurePort["resolve"]>[0]> = [];
  const releasedProjectionHandles: string[] = [];
  const activeProjectionHandles = new Set<string>();
  const ids = Array.from({ length: 256 }, (_, index) =>
    `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`
  );
  let idIndex = 0;
  const state: Harness = {
    orchestrator: undefined as unknown as BuildOrchestrator,
    runner,
    artifacts,
    projectionCalls,
    resourceCalls,
    releasedProjectionHandles,
    save: vi.fn(async () => state.currentValue),
    currentValue: current(),
    preparedOverride: {},
    failProjection: false,
    failResources: false,
  };
  const projections: TrustedBuildProjectionProviderPort = {
    async prepare(request) {
      projectionCalls.push(request);
      if (state.failProjection) throw new Error("private provider detail");
      if (activeProjectionHandles.size >= 128) throw new Error("provider capacity exhausted");
      const inputs = request.kind === "manual" ? request.savedInputs : state.currentValue;
      const projectionHandle = `projection:trusted-snapshot-${projectionCalls.length}`;
      activeProjectionHandles.add(projectionHandle);
      return prepared(inputs, { projectionHandle, ...state.preparedOverride });
    },
    release(projectionHandle) {
      releasedProjectionHandles.push(projectionHandle);
      activeProjectionHandles.delete(projectionHandle);
    },
  };
  state.orchestrator = new BuildOrchestrator({
    ids: {
      mintBuildId() {
        const value = ids[idIndex++];
        if (value === undefined) throw new Error("fixture id exhaustion");
        return value;
      },
    },
    projections,
    runner,
    artifacts,
    resources: {
      async resolve(request) {
        resourceCalls.push(request);
        activeProjectionHandles.delete(request.provenance.projectionHandle);
        if (state.failResources) throw new Error("simulated resolver failure");
        return EMPTY_RESOURCES;
      },
    },
    saves: { saveAndReadClean: state.save },
    currentInputs: { async readCurrent() { return state.currentValue; } },
  });
  return state;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("Timed out waiting for orchestrator condition");
}

function eventsOf<Type extends BuildArtifactStatusEvent["type"]>(
  events: readonly BuildArtifactStatusEvent[],
  type: Type,
): Array<Extract<BuildArtifactStatusEvent, { type: Type }>> {
  return events.filter((event): event is Extract<BuildArtifactStatusEvent, { type: Type }> =>
    event.type === type,
  );
}

describe("BuildOrchestrator trusted projection boundary", () => {
  it("rejects caller-supplied source, hashes, projection metadata, ids, or paths", async () => {
    const test = harness();
    const hostile = {
      ...preview(1),
      buildId: buildId("8"),
      source: "#import \"/etc/passwd\"",
      sourceHash: hashBytes(new TextEncoder().encode("caller source")),
      renderInputHash: OTHER_RENDER,
      renderProjectionHash: hashBytes(new TextEncoder().encode("invented")),
      executablePath: "/usr/bin/typst",
    } as unknown as PreviewBuildSubmission;
    await expect(test.orchestrator.submitPreview(hostile)).rejects.toMatchObject({
      kind: "invalidSubmission",
    });
    expect(test.projectionCalls).toEqual([]);
    expect(test.artifacts.events).toEqual([]);
  });

  it("derives runner and artifact provenance only from the trusted provider", async () => {
    const test = harness();
    const admission = await test.orchestrator.submitPreview(preview(1));
    await waitFor(() => test.runner.pending.has(admission.buildId));

    const run = test.runner.runs[0];
    expect(run?.generatedSource).toEqual({ source: SOURCE, sourceHash: SOURCE_HASH });
    expect(run?.provenance).toMatchObject({
      projectionHandle: "projection:trusted-snapshot-1",
      renderInputHash: RENDER,
      artifactMetadata: {
        renderProjectionHash: PROJECTION_HASH,
        generatorVersion: "cbb-typstgen-v1",
        outputForm: "readerOrder",
      },
    });
    expect(test.resourceCalls[0]?.provenance).toBe(run?.provenance);
    expect(eventsOf(test.artifacts.events, "queued")[0]?.provenance).toBe(run?.provenance);
    expect(JSON.stringify(run)).not.toContain("workspacePath");
    expect(JSON.stringify(run)).not.toContain("executablePath");

    test.runner.complete(admission.buildId, "succeeded");
    await test.orchestrator.whenIdle();
    expect(eventsOf(test.artifacts.events, "terminal")[0]?.provenance).toBe(run?.provenance);
  });

  it("fails closed when provider output is malformed, changed, or path-bearing", async () => {
    const test = harness();
    test.preparedOverride = { sourceHash: hashBytes(new TextEncoder().encode("wrong")) };
    await expect(test.orchestrator.submitPreview(preview(1))).rejects.toMatchObject({
      kind: "projectionNotExact",
    });
    expect(test.releasedProjectionHandles).toEqual(["projection:trusted-snapshot-1"]);

    const pathBearing = harness();
    pathBearing.preparedOverride = {
      relativePath: "/private/projection.typ",
    } as unknown as Partial<PreparedBuildProjection>;
    await expect(pathBearing.orchestrator.submitPreview(preview(1))).rejects.toMatchObject({
      kind: "projectionNotExact",
    });
    expect(pathBearing.releasedProjectionHandles).toEqual(["projection:trusted-snapshot-1"]);
  });

  it("requires a clean save and an exact provider projection for manual admission", async () => {
    const test = harness();
    test.currentValue = current({ saveState: "dirty" });
    await expect(test.orchestrator.submitManual(manual())).rejects.toMatchObject({
      kind: "saveNotExact",
      code: "CBB-SAVE-0002",
    });
    expect(test.projectionCalls).toEqual([]);

    test.currentValue = current();
    test.preparedOverride = { renderInputHash: OTHER_RENDER };
    await expect(test.orchestrator.submitManual(manual())).rejects.toMatchObject({
      kind: "projectionNotExact",
      code: "CBB-SAVE-0002",
    });
    expect(test.releasedProjectionHandles).toEqual(["projection:trusted-snapshot-1"]);

    test.preparedOverride = {};
    const admission = await test.orchestrator.submitManual(manual());
    await waitFor(() => test.runner.pending.has(admission.buildId));
    expect(test.save).toHaveBeenCalledWith({ localResourceId: RESOURCE });
    expect(test.projectionCalls.at(-1)).toMatchObject({
      kind: "manual",
      localResourceId: RESOURCE,
      savedInputs: current(),
    });
    test.runner.complete(admission.buildId, "succeeded");
    await test.orchestrator.whenIdle();
    expect(eventsOf(test.artifacts.events, "manualFinished")).toContainEqual(
      expect.objectContaining({ buildId: admission.buildId, current: true }),
    );
  });
});

describe("BuildOrchestrator queue and fault behavior", () => {
  it("releases more than 128 superseded queued previews without exhausting provider capacity", async () => {
    const test = harness();
    await test.orchestrator.setDragActive(RESOURCE, true);
    let lastBuildId = "";
    for (let sequence = 1; sequence <= 129; sequence++) {
      lastBuildId = (await test.orchestrator.submitPreview(preview(sequence))).buildId;
    }

    expect(test.projectionCalls).toHaveLength(129);
    expect(test.releasedProjectionHandles).toHaveLength(128);
    expect(new Set(test.releasedProjectionHandles).size).toBe(128);
    await test.orchestrator.cancel(lastBuildId);
    expect(test.releasedProjectionHandles).toHaveLength(129);
    await test.orchestrator.whenIdle();
  });

  it("releases a prepared projection when durable queued status admission fails", async () => {
    const test = harness();
    test.artifacts.failNextType = "queued";
    await expect(test.orchestrator.submitPreview(preview(1))).rejects.toMatchObject({
      kind: "statusPersistenceFailed",
    });
    expect(test.releasedProjectionHandles).toEqual(["projection:trusted-snapshot-1"]);
    expect(test.runner.runs).toEqual([]);
  });

  it("cancels a process tree when a newer trusted preview supersedes running work", async () => {
    const test = harness();
    const first = await test.orchestrator.submitPreview(preview(1));
    await waitFor(() => test.runner.pending.has(first.buildId));
    const firstSignal = test.runner.pending.get(first.buildId)?.signal;

    test.currentValue = current({ editGeneration: 2 });
    const second = await test.orchestrator.submitPreview(preview(2));
    expect(firstSignal?.aborted).toBe(true);
    expect(test.runner.cancellations).toContainEqual({
      buildId: first.buildId,
      reason: "previewSuperseded",
    });
    test.runner.complete(first.buildId, "canceled");
    await waitFor(() => test.runner.pending.has(second.buildId));
    test.runner.complete(second.buildId, "succeeded");
    await test.orchestrator.whenIdle();
    expect(eventsOf(test.artifacts.events, "previewPublished")).toContainEqual(
      expect.objectContaining({ buildId: second.buildId }),
    );
  });

  it("retains the last successful preview stale on a newer failure", async () => {
    const test = harness();
    const first = await test.orchestrator.submitPreview(preview(1));
    await waitFor(() => test.runner.pending.has(first.buildId));
    test.runner.complete(first.buildId, "succeeded");
    await test.orchestrator.whenIdle();

    test.currentValue = current({ editGeneration: 2 });
    const second = await test.orchestrator.submitPreview(preview(2));
    await waitFor(() => test.runner.pending.has(second.buildId));
    test.runner.complete(second.buildId, "failed");
    await test.orchestrator.whenIdle();
    expect(eventsOf(test.artifacts.events, "previewRetainedStale")).toContainEqual(
      expect.objectContaining({
        attemptedBuildId: second.buildId,
        retainedBuildId: first.buildId,
        reason: "failed",
      }),
    );
  });

  it("rechecks trusted revision/render/edit inputs before publication", async () => {
    const test = harness();
    const admission = await test.orchestrator.submitPreview(preview(1));
    await waitFor(() => test.runner.pending.has(admission.buildId));
    test.currentValue = current({ renderInputHash: OTHER_RENDER });
    test.runner.complete(admission.buildId, "succeeded");
    await test.orchestrator.whenIdle();
    expect(eventsOf(test.artifacts.events, "previewPublished")).toEqual([]);
    expect(eventsOf(test.artifacts.events, "previewRetainedStale")).toContainEqual(
      expect.objectContaining({ reason: "staleResult" }),
    );
  });

  it("fails before execution on resolver faults and converts terminal status faults", async () => {
    const resolverFault = harness();
    resolverFault.failResources = true;
    const failedAdmission = await resolverFault.orchestrator.submitPreview(preview(1));
    await resolverFault.orchestrator.whenIdle();
    expect(resolverFault.runner.runs).toEqual([]);
    expect(eventsOf(resolverFault.artifacts.events, "terminal")).toContainEqual(
      expect.objectContaining({
        request: expect.objectContaining({ buildId: failedAdmission.buildId }),
        outcome: { kind: "failed", diagnosticCodes: ["CBB-BUILD-0001"] },
      }),
    );

    const identityMismatch = harness();
    identityMismatch.preparedOverride = { resourceClosureHash: PROJECTION_HASH };
    const mismatchedAdmission = await identityMismatch.orchestrator.submitPreview(preview(1));
    await identityMismatch.orchestrator.whenIdle();
    expect(identityMismatch.runner.runs).toEqual([]);
    expect(eventsOf(identityMismatch.artifacts.events, "terminal")).toContainEqual(
      expect.objectContaining({
        request: expect.objectContaining({ buildId: mismatchedAdmission.buildId }),
        outcome: { kind: "failed", diagnosticCodes: ["CBB-BUILD-0001"] },
      }),
    );

    const statusFault = harness();
    const admission = await statusFault.orchestrator.submitPreview(preview(1));
    await waitFor(() => statusFault.runner.pending.has(admission.buildId));
    statusFault.artifacts.failNextType = "terminal";
    statusFault.runner.complete(admission.buildId, "succeeded");
    await statusFault.orchestrator.whenIdle();
    expect(eventsOf(statusFault.artifacts.events, "previewPublished")).toEqual([]);
    expect(eventsOf(statusFault.artifacts.events, "previewRetainedStale")).toContainEqual(
      expect.objectContaining({ reason: "failed" }),
    );
  });

  it("matches the publication model across terminal and current/stale states", async () => {
    const outcomes: OrchestratedRunnerOutcome["kind"][] = [
      "succeeded", "failed", "timedOut", "canceled",
    ];
    for (const outcome of outcomes) {
      for (const stillCurrent of [true, false]) {
        const test = harness();
        const admission = await test.orchestrator.submitPreview(preview(1));
        await waitFor(() => test.runner.pending.has(admission.buildId));
        if (!stillCurrent) test.currentValue = current({ renderInputHash: OTHER_RENDER });
        test.runner.complete(admission.buildId, outcome);
        await test.orchestrator.whenIdle();
        const published = eventsOf(test.artifacts.events, "previewPublished");
        expect(published.length).toBe(outcome === "succeeded" && stillCurrent ? 1 : 0);
        if (published.length === 0) {
          expect(eventsOf(test.artifacts.events, "previewRetainedStale")[0]?.reason).toBe(
            outcome === "succeeded" ? "staleResult" : outcome,
          );
        }
      }
    }
  });
});
