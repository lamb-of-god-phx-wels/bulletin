import { describe, expect, it } from "vitest";

import {
  initialBuildQueueState,
  reduceBuildQueue,
  type BuildQueueRequest,
  type BuildQueueState,
  type CurrentBuildInputs,
} from "./queue.js";

const RESOURCE_A = "11111111-1111-4111-8111-111111111111";
const RESOURCE_B = "22222222-2222-4222-8222-222222222222";
const REVISION = `sha256:${"a".repeat(64)}` as const;
const RENDER = `sha256:${"b".repeat(64)}` as const;

function preview(
  buildDigit: string,
  requestSequence: number,
  localResourceId = RESOURCE_A,
): BuildQueueRequest {
  return {
    kind: "preview",
    buildId: `${buildDigit.repeat(8)}-${buildDigit.repeat(4)}-4${buildDigit.repeat(3)}-8${buildDigit.repeat(3)}-${buildDigit.repeat(12)}`,
    localResourceId,
    documentRevision: REVISION,
    renderInputHash: RENDER,
    editGeneration: requestSequence,
    requestSequence,
  };
}

function manual(buildDigit: string, localResourceId = RESOURCE_A): BuildQueueRequest {
  return {
    kind: "manual",
    artifactKind: "draft",
    buildId: `${buildDigit.repeat(8)}-${buildDigit.repeat(4)}-4${buildDigit.repeat(3)}-8${buildDigit.repeat(3)}-${buildDigit.repeat(12)}`,
    localResourceId,
    documentRevision: REVISION,
    savedRevision: REVISION,
    renderInputHash: RENDER,
    editGeneration: 7,
    saveState: "clean",
  };
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

function transition(
  state: BuildQueueState,
  event: Parameters<typeof reduceBuildQueue>[1],
): ReturnType<typeof reduceBuildQueue> {
  return reduceBuildQueue(state, event);
}

describe("build queue", () => {
  it("runs one build at a time and supersedes queued/running previews", () => {
    const first = preview("1", 1);
    const second = preview("2", 2);
    let result = transition(initialBuildQueueState(), { type: "enqueue", request: first });
    expect(result.effects).toEqual([{ type: "start", request: first }]);

    result = transition(result.state, { type: "enqueue", request: second });
    expect(result.effects).toContainEqual({
      type: "cancelRunning",
      buildId: first.buildId,
      reason: "previewSuperseded",
    });
    expect(result.state.queued.map((entry) => entry.request.buildId)).toEqual([
      second.buildId,
    ]);

    result = transition(result.state, {
      type: "complete",
      buildId: first.buildId,
      outcome: { kind: "canceled" },
      currentInputs: current({ editGeneration: 2 }),
    });
    expect(result.effects).toContainEqual({ type: "start", request: second });
    expect(result.effects).toContainEqual({
      type: "previewResultIgnored",
      localResourceId: RESOURCE_A,
      buildId: first.buildId,
    });
  });

  it("preempts preview work and removes queued previews when manual work arrives", () => {
    const running = preview("1", 1, RESOURCE_A);
    const queued = preview("2", 1, RESOURCE_B);
    const urgent = manual("3");
    let state = transition(initialBuildQueueState(), {
      type: "enqueue",
      request: running,
    }).state;
    state = transition(state, { type: "enqueue", request: queued }).state;
    const result = transition(state, { type: "enqueue", request: urgent });
    expect(result.effects).toContainEqual({
      type: "cancelRunning",
      buildId: running.buildId,
      reason: "manualPriority",
    });
    expect(result.effects).toContainEqual({
      type: "queuedBuildCanceled",
      buildId: queued.buildId,
      reason: "manualPriority",
    });
    expect(result.state.queued.map((entry) => entry.request.buildId)).toEqual([
      urgent.buildId,
    ]);
  });

  it("retains the last successful preview as stale after the newest failure", () => {
    const first = preview("1", 1);
    let result = transition(initialBuildQueueState(), { type: "enqueue", request: first });
    result = transition(result.state, {
      type: "complete",
      buildId: first.buildId,
      outcome: { kind: "succeeded" },
      currentInputs: current(),
    });
    expect(result.effects).toContainEqual({
      type: "previewPublished",
      localResourceId: RESOURCE_A,
      buildId: first.buildId,
    });

    const second = preview("2", 2);
    result = transition(result.state, { type: "enqueue", request: second });
    result = transition(result.state, {
      type: "complete",
      buildId: second.buildId,
      outcome: { kind: "failed" },
      currentInputs: current({ editGeneration: 2 }),
    });
    expect(result.state.previewPublication[RESOURCE_A]).toMatchObject({
      current: false,
      lastSuccessfulBuildId: first.buildId,
      failure: "failed",
    });
    expect(result.effects).toContainEqual({
      type: "previewRetainedStale",
      localResourceId: RESOURCE_A,
      attemptedBuildId: second.buildId,
      retainedBuildId: first.buildId,
      reason: "failed",
    });
  });

  it("does not publish a successful result whose captured inputs became stale", () => {
    const request = preview("1", 1);
    let result = transition(initialBuildQueueState(), { type: "enqueue", request });
    result = transition(result.state, {
      type: "complete",
      buildId: request.buildId,
      outcome: { kind: "succeeded" },
      currentInputs: current({ renderInputHash: `sha256:${"c".repeat(64)}` }),
    });
    expect(result.effects).toContainEqual(
      expect.objectContaining({
        type: "previewRetainedStale",
        attemptedBuildId: request.buildId,
        reason: "staleResult",
      }),
    );
  });

  it("reports whether a completed manual build still matches clean saved input", () => {
    const request = manual("1");
    let result = transition(initialBuildQueueState(), { type: "enqueue", request });
    result = transition(result.state, {
      type: "complete",
      buildId: request.buildId,
      outcome: { kind: "succeeded" },
      currentInputs: current({ editGeneration: 8, saveState: "dirty" }),
    });
    expect(result.effects).toContainEqual({
      type: "manualBuildFinished",
      buildId: request.buildId,
      current: false,
      outcome: "succeeded",
    });
  });

  it("defers preview work during a drag and starts the newest request afterward", () => {
    let result = transition(initialBuildQueueState(), {
      type: "setDragActive",
      localResourceId: RESOURCE_A,
      active: true,
    });
    const first = preview("1", 1);
    const second = preview("2", 2);
    result = transition(result.state, { type: "enqueue", request: first });
    expect(result.effects).toEqual([]);
    result = transition(result.state, { type: "enqueue", request: second });
    expect(result.state.queued).toHaveLength(1);
    result = transition(result.state, {
      type: "setDragActive",
      localResourceId: RESOURCE_A,
      active: false,
    });
    expect(result.effects).toEqual([{ type: "start", request: second }]);
  });

  it("ignores stale sequences and rejects dirty manual admission proofs", () => {
    const latest = preview("2", 2);
    let result = transition(initialBuildQueueState(), { type: "enqueue", request: latest });
    const stale = preview("1", 1);
    result = transition(result.state, { type: "enqueue", request: stale });
    expect(result.effects).toEqual([
      {
        type: "enqueueIgnored",
        buildId: stale.buildId,
        reason: "stalePreviewSequence",
      },
    ]);

    const invalid = {
      ...manual("3"),
      savedRevision: `sha256:${"c".repeat(64)}` as const,
    };
    expect(() => transition(initialBuildQueueState(), { type: "enqueue", request: invalid })).toThrow(
      /exact clean saved revision/,
    );
  });
});
