/**
 * Pure single-lane build scheduler.
 *
 * The scheduler owns ordering and supersession only. Persistence, process
 * execution, and artifact installation are effects handled by privileged
 * adapters. Keeping this reducer pure makes every enqueue/cancel/complete
 * interleaving model-testable.
 */

export type BuildQueueHash = `sha256:${string}`;

export interface BuildRequestIdentity {
  readonly buildId: string;
  readonly localResourceId: string;
  readonly documentRevision: BuildQueueHash;
  readonly renderInputHash: BuildQueueHash;
  readonly editGeneration: number;
}

export interface PreviewBuildRequest extends BuildRequestIdentity {
  readonly kind: "preview";
  readonly requestSequence: number;
}

export interface ManualBuildRequest extends BuildRequestIdentity {
  readonly kind: "manual";
  readonly artifactKind: "draft" | "finalCandidate";
  /** Admission proof captured after the authoritative save completes. */
  readonly savedRevision: BuildQueueHash;
  readonly saveState: "clean";
}

export type BuildQueueRequest = PreviewBuildRequest | ManualBuildRequest;

interface QueuedEntry {
  readonly request: BuildQueueRequest;
  readonly ordinal: number;
}

export interface RunningBuild {
  readonly request: BuildQueueRequest;
  readonly cancelRequested: boolean;
}

export interface PreviewPublicationState {
  readonly latestRequestSequence: number;
  readonly current: boolean;
  readonly lastSuccessfulBuildId?: string;
  readonly lastSuccessfulRenderInputHash?: BuildQueueHash;
  readonly failure?: "failed" | "timedOut" | "canceled" | "staleResult";
}

export interface BuildQueueState {
  readonly nextOrdinal: number;
  readonly queued: readonly QueuedEntry[];
  readonly running?: RunningBuild | undefined;
  readonly latestPreviewSequence: Readonly<Record<string, number>>;
  readonly previewPublication: Readonly<Record<string, PreviewPublicationState>>;
  readonly dragActiveResources: readonly string[];
}

export interface CurrentBuildInputs {
  readonly documentRevision: BuildQueueHash;
  readonly renderInputHash: BuildQueueHash;
  readonly editGeneration: number;
  readonly saveState: "clean" | "dirty" | "saving" | "saveFailed" | "conflicted" | "readOnly";
}

export type BuildTerminalOutcome =
  | { readonly kind: "succeeded" }
  | { readonly kind: "failed" }
  | { readonly kind: "timedOut" }
  | { readonly kind: "canceled" };

export type BuildQueueEvent =
  | { readonly type: "enqueue"; readonly request: BuildQueueRequest }
  | {
      readonly type: "complete";
      readonly buildId: string;
      readonly outcome: BuildTerminalOutcome;
      readonly currentInputs: CurrentBuildInputs;
    }
  | { readonly type: "cancel"; readonly buildId: string }
  | { readonly type: "setDragActive"; readonly localResourceId: string; readonly active: boolean };

export type BuildQueueEffect =
  | { readonly type: "start"; readonly request: BuildQueueRequest }
  | { readonly type: "cancelRunning"; readonly buildId: string; readonly reason: "previewSuperseded" | "manualPriority" | "requested" }
  | { readonly type: "queuedBuildCanceled"; readonly buildId: string; readonly reason: "previewSuperseded" | "manualPriority" | "requested" }
  | { readonly type: "enqueueIgnored"; readonly buildId: string; readonly reason: "stalePreviewSequence" }
  | { readonly type: "previewPublished"; readonly localResourceId: string; readonly buildId: string }
  | {
      readonly type: "previewRetainedStale";
      readonly localResourceId: string;
      readonly attemptedBuildId: string;
      readonly retainedBuildId?: string;
      readonly reason: "failed" | "timedOut" | "canceled" | "staleResult";
    }
  | { readonly type: "previewResultIgnored"; readonly localResourceId: string; readonly buildId: string }
  | { readonly type: "manualBuildFinished"; readonly buildId: string; readonly current: boolean; readonly outcome: BuildTerminalOutcome["kind"] };

export interface BuildQueueTransition {
  readonly state: BuildQueueState;
  readonly effects: readonly BuildQueueEffect[];
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA_256 = /^sha256:[0-9a-f]{64}$/;

export function initialBuildQueueState(): BuildQueueState {
  return {
    nextOrdinal: 0,
    queued: [],
    latestPreviewSequence: {},
    previewPublication: {},
    dragActiveResources: [],
  };
}

function validateIdentity(request: BuildQueueRequest): void {
  if (!UUID_V4.test(request.buildId)) {
    throw new TypeError("buildId must be a canonical UUIDv4");
  }
  if (!UUID_V4.test(request.localResourceId)) {
    throw new TypeError("localResourceId must be a canonical UUIDv4");
  }
  if (!SHA_256.test(request.documentRevision) || !SHA_256.test(request.renderInputHash)) {
    throw new TypeError("build request hashes must be lowercase sha256 identities");
  }
  if (!Number.isSafeInteger(request.editGeneration) || request.editGeneration < 0) {
    throw new TypeError("editGeneration must be a nonnegative safe integer");
  }
  if (request.kind === "preview") {
    if (!Number.isSafeInteger(request.requestSequence) || request.requestSequence < 1) {
      throw new TypeError("requestSequence must be a positive safe integer");
    }
  } else if (request.savedRevision !== request.documentRevision) {
    throw new TypeError("manual builds require the exact clean saved revision");
  }
}

function sameInputs(request: BuildQueueRequest, current: CurrentBuildInputs): boolean {
  return (
    request.documentRevision === current.documentRevision &&
    request.renderInputHash === current.renderInputHash &&
    request.editGeneration === current.editGeneration
  );
}

function chooseNext(
  state: BuildQueueState,
  effects: BuildQueueEffect[],
): BuildQueueState {
  if (state.running !== undefined) return state;
  let selectedIndex = -1;
  for (let index = 0; index < state.queued.length; index++) {
    const entry = state.queued[index];
    if (entry?.request.kind === "manual") {
      selectedIndex = index;
      break;
    }
  }
  if (selectedIndex < 0) {
    for (let index = 0; index < state.queued.length; index++) {
      const entry = state.queued[index];
      if (
        entry !== undefined &&
        entry.request.kind === "preview" &&
        !state.dragActiveResources.includes(entry.request.localResourceId)
      ) {
        selectedIndex = index;
        break;
      }
    }
  }
  if (selectedIndex < 0) return state;
  const selected = state.queued[selectedIndex];
  if (selected === undefined) return state;
  const queued = state.queued.filter((_, index) => index !== selectedIndex);
  effects.push({ type: "start", request: selected.request });
  return {
    ...state,
    queued,
    running: { request: selected.request, cancelRequested: false },
  };
}

function markRunningCanceled(
  state: BuildQueueState,
  effects: BuildQueueEffect[],
  reason: Extract<BuildQueueEffect, { type: "cancelRunning" }>["reason"],
): BuildQueueState {
  const running = state.running;
  if (running === undefined || running.cancelRequested) return state;
  effects.push({ type: "cancelRunning", buildId: running.request.buildId, reason });
  return { ...state, running: { ...running, cancelRequested: true } };
}

function enqueue(
  state: BuildQueueState,
  request: BuildQueueRequest,
  effects: BuildQueueEffect[],
): BuildQueueState {
  validateIdentity(request);
  if (
    state.running?.request.buildId === request.buildId ||
    state.queued.some((entry) => entry.request.buildId === request.buildId)
  ) {
    throw new TypeError(`Duplicate build id ${request.buildId}`);
  }

  let next = state;
  if (request.kind === "preview") {
    const latest = state.latestPreviewSequence[request.localResourceId] ?? 0;
    if (request.requestSequence <= latest) {
      effects.push({
        type: "enqueueIgnored",
        buildId: request.buildId,
        reason: "stalePreviewSequence",
      });
      return state;
    }
    const retained: QueuedEntry[] = [];
    for (const entry of state.queued) {
      if (
        entry.request.kind === "preview" &&
        entry.request.localResourceId === request.localResourceId
      ) {
        effects.push({
          type: "queuedBuildCanceled",
          buildId: entry.request.buildId,
          reason: "previewSuperseded",
        });
      } else {
        retained.push(entry);
      }
    }
    next = {
      ...state,
      queued: retained,
      latestPreviewSequence: {
        ...state.latestPreviewSequence,
        [request.localResourceId]: request.requestSequence,
      },
      previewPublication: {
        ...state.previewPublication,
        [request.localResourceId]: {
          ...(state.previewPublication[request.localResourceId] ?? {
            latestRequestSequence: request.requestSequence,
            current: false,
          }),
          latestRequestSequence: request.requestSequence,
          current: false,
        },
      },
    };
    if (
      next.running?.request.kind === "preview" &&
      next.running.request.localResourceId === request.localResourceId
    ) {
      next = markRunningCanceled(next, effects, "previewSuperseded");
    }
  } else {
    const retained: QueuedEntry[] = [];
    for (const entry of state.queued) {
      if (entry.request.kind === "preview") {
        effects.push({
          type: "queuedBuildCanceled",
          buildId: entry.request.buildId,
          reason: "manualPriority",
        });
      } else {
        retained.push(entry);
      }
    }
    next = { ...state, queued: retained };
    if (next.running?.request.kind === "preview") {
      next = markRunningCanceled(next, effects, "manualPriority");
    }
  }

  next = {
    ...next,
    nextOrdinal: next.nextOrdinal + 1,
    queued: [...next.queued, { request, ordinal: next.nextOrdinal }],
  };
  return chooseNext(next, effects);
}

function completionFailureKind(
  outcome: Exclude<BuildTerminalOutcome["kind"], "succeeded">,
): "failed" | "timedOut" | "canceled" {
  return outcome;
}

function complete(
  state: BuildQueueState,
  buildId: string,
  outcome: BuildTerminalOutcome,
  currentInputs: CurrentBuildInputs,
  effects: BuildQueueEffect[],
): BuildQueueState {
  const running = state.running;
  if (running === undefined || running.request.buildId !== buildId) {
    throw new TypeError(`Completion does not match the running build ${buildId}`);
  }
  const request = running.request;
  let next: BuildQueueState = { ...state, running: undefined };
  if (request.kind === "manual") {
    const current =
      outcome.kind === "succeeded" &&
      currentInputs.saveState === "clean" &&
      sameInputs(request, currentInputs);
    effects.push({
      type: "manualBuildFinished",
      buildId,
      current,
      outcome: outcome.kind,
    });
    return chooseNext(next, effects);
  }

  const latest = state.latestPreviewSequence[request.localResourceId] ?? 0;
  if (request.requestSequence !== latest) {
    effects.push({
      type: "previewResultIgnored",
      localResourceId: request.localResourceId,
      buildId,
    });
    return chooseNext(next, effects);
  }
  const previous = state.previewPublication[request.localResourceId];
  if (outcome.kind === "succeeded" && sameInputs(request, currentInputs)) {
    next = {
      ...next,
      previewPublication: {
        ...state.previewPublication,
        [request.localResourceId]: {
          latestRequestSequence: request.requestSequence,
          current: true,
          lastSuccessfulBuildId: buildId,
          lastSuccessfulRenderInputHash: request.renderInputHash,
        },
      },
    };
    effects.push({
      type: "previewPublished",
      localResourceId: request.localResourceId,
      buildId,
    });
  } else {
    const reason =
      outcome.kind === "succeeded"
        ? "staleResult"
        : completionFailureKind(outcome.kind);
    next = {
      ...next,
      previewPublication: {
        ...state.previewPublication,
        [request.localResourceId]: {
          latestRequestSequence: request.requestSequence,
          current: false,
          ...(previous?.lastSuccessfulBuildId !== undefined
            ? { lastSuccessfulBuildId: previous.lastSuccessfulBuildId }
            : {}),
          ...(previous?.lastSuccessfulRenderInputHash !== undefined
            ? { lastSuccessfulRenderInputHash: previous.lastSuccessfulRenderInputHash }
            : {}),
          failure: reason,
        },
      },
    };
    effects.push({
      type: "previewRetainedStale",
      localResourceId: request.localResourceId,
      attemptedBuildId: buildId,
      ...(previous?.lastSuccessfulBuildId !== undefined
        ? { retainedBuildId: previous.lastSuccessfulBuildId }
        : {}),
      reason,
    });
  }
  return chooseNext(next, effects);
}

function cancel(
  state: BuildQueueState,
  buildId: string,
  effects: BuildQueueEffect[],
): BuildQueueState {
  if (state.running?.request.buildId === buildId) {
    return markRunningCanceled(state, effects, "requested");
  }
  const entry = state.queued.find((candidate) => candidate.request.buildId === buildId);
  if (entry === undefined) return state;
  effects.push({ type: "queuedBuildCanceled", buildId, reason: "requested" });
  return chooseNext(
    { ...state, queued: state.queued.filter((candidate) => candidate !== entry) },
    effects,
  );
}

function setDragActive(
  state: BuildQueueState,
  localResourceId: string,
  active: boolean,
  effects: BuildQueueEffect[],
): BuildQueueState {
  if (!UUID_V4.test(localResourceId)) {
    throw new TypeError("localResourceId must be a canonical UUIDv4");
  }
  const set = new Set(state.dragActiveResources);
  if (active) set.add(localResourceId);
  else set.delete(localResourceId);
  return chooseNext(
    { ...state, dragActiveResources: [...set].sort() },
    effects,
  );
}

export function reduceBuildQueue(
  state: BuildQueueState,
  event: BuildQueueEvent,
): BuildQueueTransition {
  const effects: BuildQueueEffect[] = [];
  let next: BuildQueueState;
  switch (event.type) {
    case "enqueue":
      next = enqueue(state, event.request, effects);
      break;
    case "complete":
      next = complete(state, event.buildId, event.outcome, event.currentInputs, effects);
      break;
    case "cancel":
      next = cancel(state, event.buildId, effects);
      break;
    case "setDragActive":
      next = setDragActive(state, event.localResourceId, event.active, effects);
      break;
  }
  return { state: next, effects };
}
