import {
  canonicalRevisionToken,
  canonicalStringify,
  type CanonicalRevisionToken,
  type CbbDocument,
} from "@cbb/core";
import type {
  AutosaveControllerOptions,
  AutosaveState,
  CanonicalSaveOutcome,
  RecoverySnapshotOutcome,
  RecoverySnapshotPruneRequest,
  RecoverySnapshotRecord,
  ShutdownDisposition,
} from "./types.js";

export const AUTOSAVE_DEBOUNCE_MS = 500;
export const AUTOSAVE_HARD_ATTEMPT_MS = 2_000;
export const RECOVERY_HARD_ATTEMPT_MS = 4_500;
export const CRASH_LOSS_BOUND_MS = 5_000;
export const AUTOSAVE_RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;

interface EditRecord {
  readonly generation: number;
  readonly atMilliseconds: number;
}

function cloneDocument(document: CbbDocument): CbbDocument {
  return JSON.parse(canonicalStringify(document)) as CbbDocument;
}

function asIso(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}

export class AutosaveController {
  private document: CbbDocument;
  private phase: AutosaveState["phase"] = "clean";
  private generation = 0;
  private durableGeneration = 0;
  private recoveryGeneration = 0;
  private baseRevisionToken: CanonicalRevisionToken;
  private readonly edits: EditRecord[] = [];
  private lastAttemptedGeneration = 0;
  private lastRecoveryAttemptedGeneration = 0;
  private savingGeneration: number | undefined;
  private recoverySavingGeneration: number | undefined;
  private canonicalFailedThrough = 0;
  private recoveryFailedThrough = 0;
  private retryIndex = 0;
  private recoveryRetryIndex = 0;
  private retryDue: number | undefined;
  private recoveryRetryDue: number | undefined;
  private canonicalTimer: unknown;
  private recoveryTimer: unknown;
  private protectionTimer: unknown;
  private changesNotProtected = false;
  private discardConfirmed = false;

  constructor(private readonly options: AutosaveControllerOptions) {
    this.document = cloneDocument(options.initialDocument);
    this.baseRevisionToken = options.initialRevisionToken;
    if (this.document.kind !== options.resourceKind) {
      throw new Error("Initial document kind does not match the autosave resource kind");
    }
  }

  state(): AutosaveState {
    const oldest = this.oldestCanonicalUnsaved();
    return {
      phase: this.phase,
      editGeneration: this.generation,
      durableGeneration: this.durableGeneration,
      recoveryGeneration: this.recoveryGeneration,
      ...(this.savingGeneration === undefined ? {} : { savingGeneration: this.savingGeneration }),
      baseRevisionToken: this.baseRevisionToken,
      ...(oldest === undefined ? {} : { oldestUnsavedEditAt: asIso(oldest.atMilliseconds) }),
      changesNotProtected: this.changesNotProtected,
      canonicalRetryNumber: this.retryIndex,
    };
  }

  edit(document: CbbDocument): AutosaveState {
    if (this.phase === "readOnly") throw new Error("Cannot edit a read-only autosave session");
    if (document.kind !== this.options.resourceKind) {
      throw new Error("Edited document kind does not match the autosave resource kind");
    }
    this.document = cloneDocument(document);
    this.generation++;
    this.edits.push({
      generation: this.generation,
      atMilliseconds: this.options.scheduler.nowMilliseconds(),
    });
    this.discardConfirmed = false;
    if (this.phase === "clean") this.phase = "dirty";
    this.recomputeProtection();
    this.scheduleAll();
    this.emit();
    return this.state();
  }

  retryNow(): boolean {
    if (
      this.phase === "saving" ||
      this.phase === "conflicted" ||
      this.phase === "readOnly" ||
      this.generation === this.durableGeneration
    ) {
      return false;
    }
    this.cancelCanonicalTimer();
    this.retryDue = undefined;
    this.startCanonicalSave();
    return true;
  }

  enterReadOnly(): void {
    this.phase = "readOnly";
    this.cancelCanonicalTimer();
    this.cancelRecoveryTimer();
    this.cancelProtectionTimer();
    this.emit();
  }

  confirmDiscardForShutdown(): ShutdownDisposition {
    this.discardConfirmed = true;
    return this.shutdownDisposition();
  }

  shutdownDisposition(): ShutdownDisposition {
    if (this.discardConfirmed) {
      return { status: "allow", reason: "discardConfirmed" };
    }
    if (this.phase === "clean") return { status: "allow", reason: "clean" };
    if (this.phase === "readOnly" && this.generation === this.durableGeneration) {
      return { status: "allow", reason: "readOnly" };
    }
    if (this.phase === "saving") {
      return {
        status: "block",
        reason: "saving",
        actions: ["retry", "exportRecoveryCopy", "discard", "cancel"],
      };
    }
    if (this.phase === "conflicted") {
      return {
        status: "block",
        reason: "conflicted",
        actions: ["exportRecoveryCopy", "discard", "cancel"],
      };
    }
    return {
      status: "block",
      reason: this.phase === "saveFailed" ? "saveFailed" : "unsaved",
      actions: ["retry", "exportRecoveryCopy", "discard", "cancel"],
    };
  }

  private emit(): void {
    this.options.onStateChange?.(this.state());
  }

  private oldestCanonicalUnsaved(): EditRecord | undefined {
    return this.edits.find((edit) => edit.generation > this.durableGeneration);
  }

  private oldestUnprotected(): EditRecord | undefined {
    const protectedThrough = Math.max(this.durableGeneration, this.recoveryGeneration);
    return this.edits.find((edit) => edit.generation > protectedThrough);
  }

  private latestEdit(): EditRecord | undefined {
    return this.edits[this.edits.length - 1];
  }

  private firstUnattemptedCanonical(): EditRecord | undefined {
    return this.edits.find((edit) => edit.generation > this.lastAttemptedGeneration);
  }

  private firstUnattemptedRecovery(): EditRecord | undefined {
    return this.edits.find((edit) => edit.generation > this.lastRecoveryAttemptedGeneration);
  }

  private scheduleAll(): void {
    this.scheduleCanonical();
    this.scheduleRecovery();
    this.scheduleProtectionDeadline();
  }

  private scheduleCanonical(): void {
    this.cancelCanonicalTimer();
    if (
      this.phase === "saving" ||
      this.phase === "conflicted" ||
      this.phase === "readOnly" ||
      this.generation === this.durableGeneration
    ) return;

    const candidates: number[] = [];
    if (this.retryDue !== undefined) candidates.push(this.retryDue);
    const first = this.firstUnattemptedCanonical();
    const latest = this.latestEdit();
    if (first !== undefined && latest !== undefined) {
      candidates.push(
        Math.min(
          latest.atMilliseconds + AUTOSAVE_DEBOUNCE_MS,
          first.atMilliseconds + AUTOSAVE_HARD_ATTEMPT_MS,
        ),
      );
    }
    if (candidates.length === 0) return;
    const due = Math.min(...candidates);
    const delay = Math.max(0, due - this.options.scheduler.nowMilliseconds());
    this.canonicalTimer = this.options.scheduler.schedule(() => {
      this.canonicalTimer = undefined;
      this.startCanonicalSave();
    }, delay);
  }

  private startCanonicalSave(): void {
    if (
      this.savingGeneration !== undefined ||
      this.phase === "conflicted" ||
      this.phase === "readOnly" ||
      this.generation === this.durableGeneration
    ) return;
    const generation = this.generation;
    const document = cloneDocument(this.document);
    this.savingGeneration = generation;
    this.lastAttemptedGeneration = Math.max(this.lastAttemptedGeneration, generation);
    this.retryDue = undefined;
    this.phase = "saving";
    this.emit();
    void this.options.canonical.save({
      document,
      editGeneration: generation,
      baseRevisionToken: this.baseRevisionToken,
    }).then(
      (outcome) => { this.finishCanonicalSave(generation, outcome); },
      () => { this.finishCanonicalSave(generation, { status: "failed" }); },
    );
  }

  private finishCanonicalSave(
    generation: number,
    outcome: CanonicalSaveOutcome,
  ): void {
    if (this.savingGeneration !== generation) return;
    this.savingGeneration = undefined;
    if (this.phase === "readOnly") {
      if (outcome.status === "saved") {
        const previousRevisionToken = this.baseRevisionToken;
        this.durableGeneration = Math.max(this.durableGeneration, generation);
        this.baseRevisionToken = outcome.revisionToken;
        this.pruneEdits();
        this.pruneCoveredRecoverySnapshots({
          workspaceId: this.options.workspaceId,
          localResourceId: this.options.localResourceId,
          resourceKind: this.options.resourceKind,
          previousRevisionToken,
          savedRevisionToken: outcome.revisionToken,
          coveredThroughEditGeneration: generation,
        });
      } else {
        this.canonicalFailedThrough = Math.max(this.canonicalFailedThrough, generation);
      }
      this.recomputeProtection();
      this.emit();
      return;
    }
    if (outcome.status === "saved") {
      const previousRevisionToken = this.baseRevisionToken;
      this.durableGeneration = Math.max(this.durableGeneration, generation);
      this.baseRevisionToken = outcome.revisionToken;
      this.retryIndex = 0;
      this.retryDue = undefined;
      this.canonicalFailedThrough = 0;
      this.phase = this.generation === this.durableGeneration ? "clean" : "dirty";
      this.pruneEdits();
      this.pruneCoveredRecoverySnapshots({
        workspaceId: this.options.workspaceId,
        localResourceId: this.options.localResourceId,
        resourceKind: this.options.resourceKind,
        previousRevisionToken,
        savedRevisionToken: outcome.revisionToken,
        coveredThroughEditGeneration: generation,
      });
    } else if (outcome.status === "conflicted") {
      this.canonicalFailedThrough = Math.max(this.canonicalFailedThrough, generation);
      this.phase = "conflicted";
      this.retryDue = undefined;
      this.cancelCanonicalTimer();
    } else {
      this.canonicalFailedThrough = Math.max(this.canonicalFailedThrough, generation);
      this.phase = "saveFailed";
      const delay = AUTOSAVE_RETRY_DELAYS_MS[
        Math.min(this.retryIndex, AUTOSAVE_RETRY_DELAYS_MS.length - 1)
      ] as number;
      this.retryIndex++;
      this.retryDue = this.options.scheduler.nowMilliseconds() + delay;
    }
    this.recomputeProtection();
    this.scheduleAll();
    this.emit();
  }

  private pruneCoveredRecoverySnapshots(request: RecoverySnapshotPruneRequest): void {
    // The canonical save already protects every edit through the save boundary.
    // Snapshot checkpointing/pruning is therefore best-effort maintenance: a
    // failure must retain bytes and must never turn a successful save into a
    // failed or unprotected one.
    void this.options.recovery.pruneCovered(request).catch(() => undefined);
  }

  private scheduleRecovery(): void {
    this.cancelRecoveryTimer();
    if (
      this.recoverySavingGeneration !== undefined ||
      this.phase === "readOnly" ||
      this.generation <= Math.max(this.durableGeneration, this.recoveryGeneration)
    ) return;
    const candidates: number[] = [];
    if (this.recoveryRetryDue !== undefined) candidates.push(this.recoveryRetryDue);
    const first = this.firstUnattemptedRecovery();
    const latest = this.latestEdit();
    const oldestUnprotected = this.oldestUnprotected();
    if (first !== undefined && latest !== undefined && oldestUnprotected !== undefined) {
      candidates.push(
        Math.min(
          latest.atMilliseconds + AUTOSAVE_DEBOUNCE_MS,
          oldestUnprotected.atMilliseconds + RECOVERY_HARD_ATTEMPT_MS,
        ),
      );
    }
    if (candidates.length === 0) return;
    const due = Math.min(...candidates);
    this.recoveryTimer = this.options.scheduler.schedule(() => {
      this.recoveryTimer = undefined;
      this.startRecoverySave();
    }, Math.max(0, due - this.options.scheduler.nowMilliseconds()));
  }

  private startRecoverySave(): void {
    if (
      this.recoverySavingGeneration !== undefined ||
      this.phase === "readOnly" ||
      this.generation <= Math.max(this.durableGeneration, this.recoveryGeneration)
    ) return;
    const oldest = this.oldestUnprotected();
    if (oldest === undefined) return;
    const generation = this.generation;
    const document = cloneDocument(this.document);
    this.recoverySavingGeneration = generation;
    this.lastRecoveryAttemptedGeneration = Math.max(
      this.lastRecoveryAttemptedGeneration,
      generation,
    );
    this.recoveryRetryDue = undefined;
    const record: RecoverySnapshotRecord = {
      version: 1,
      kind: "documentRecoverySnapshot",
      workspaceId: this.options.workspaceId,
      localResourceId: this.options.localResourceId,
      resourceKind: this.options.resourceKind,
      editGeneration: generation,
      baseRevisionToken: this.baseRevisionToken,
      documentHash: canonicalRevisionToken(document),
      oldestUnsavedEditAt: asIso(oldest.atMilliseconds),
      createdAt: asIso(this.options.scheduler.nowMilliseconds()),
      document,
    };
    void this.options.recovery.flush(record).then(
      (outcome) => { this.finishRecoverySave(generation, outcome); },
      () => { this.finishRecoverySave(generation, { status: "failed" }); },
    );
  }

  private finishRecoverySave(
    generation: number,
    outcome: RecoverySnapshotOutcome,
  ): void {
    if (this.recoverySavingGeneration !== generation) return;
    this.recoverySavingGeneration = undefined;
    if (this.phase === "readOnly") {
      if (outcome.status === "saved") {
        this.recoveryGeneration = Math.max(this.recoveryGeneration, generation);
      } else {
        this.recoveryFailedThrough = Math.max(this.recoveryFailedThrough, generation);
      }
      this.recomputeProtection();
      this.emit();
      return;
    }
    if (outcome.status === "saved") {
      this.recoveryGeneration = Math.max(this.recoveryGeneration, generation);
      this.recoveryRetryIndex = 0;
      this.recoveryRetryDue = undefined;
      this.recoveryFailedThrough = 0;
    } else {
      this.recoveryFailedThrough = Math.max(this.recoveryFailedThrough, generation);
      const delay = AUTOSAVE_RETRY_DELAYS_MS[
        Math.min(this.recoveryRetryIndex, AUTOSAVE_RETRY_DELAYS_MS.length - 1)
      ] as number;
      this.recoveryRetryIndex++;
      this.recoveryRetryDue = this.options.scheduler.nowMilliseconds() + delay;
    }
    this.recomputeProtection();
    this.scheduleRecovery();
    this.scheduleProtectionDeadline();
    this.emit();
  }

  private recomputeProtection(): void {
    const oldest = this.oldestUnprotected();
    if (oldest === undefined) {
      this.changesNotProtected = false;
      return;
    }
    const bothFailed =
      this.canonicalFailedThrough >= oldest.generation &&
      this.recoveryFailedThrough >= oldest.generation;
    const deadlineMissed =
      this.options.scheduler.nowMilliseconds() - oldest.atMilliseconds >= CRASH_LOSS_BOUND_MS;
    this.changesNotProtected = bothFailed || deadlineMissed;
  }

  private scheduleProtectionDeadline(): void {
    this.cancelProtectionTimer();
    const oldest = this.oldestUnprotected();
    if (oldest === undefined || this.phase === "readOnly") return;
    const due = oldest.atMilliseconds + CRASH_LOSS_BOUND_MS;
    this.protectionTimer = this.options.scheduler.schedule(() => {
      this.protectionTimer = undefined;
      this.recomputeProtection();
      this.emit();
    }, Math.max(0, due - this.options.scheduler.nowMilliseconds()));
  }

  private pruneEdits(): void {
    while (
      this.edits.length > 0 &&
      (this.edits[0] as EditRecord).generation <= this.durableGeneration
    ) {
      this.edits.shift();
    }
    this.recoveryGeneration = Math.max(this.recoveryGeneration, this.durableGeneration);
  }

  private cancelCanonicalTimer(): void {
    if (this.canonicalTimer !== undefined) {
      this.options.scheduler.cancel(this.canonicalTimer);
      this.canonicalTimer = undefined;
    }
  }

  private cancelRecoveryTimer(): void {
    if (this.recoveryTimer !== undefined) {
      this.options.scheduler.cancel(this.recoveryTimer);
      this.recoveryTimer = undefined;
    }
  }

  private cancelProtectionTimer(): void {
    if (this.protectionTimer !== undefined) {
      this.options.scheduler.cancel(this.protectionTimer);
      this.protectionTimer = undefined;
    }
  }
}
