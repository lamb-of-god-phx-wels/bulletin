import type {
  CanonicalRevisionToken,
  CbbDocument,
  LocalResourceId,
  WorkspaceId,
} from "@cbb/core";
import type { WorkspaceResourceKind } from "../workspace/index.js";

export type AutosavePhase =
  | "clean"
  | "dirty"
  | "saving"
  | "saveFailed"
  | "conflicted"
  | "readOnly";

export interface AutosaveState {
  readonly phase: AutosavePhase;
  readonly editGeneration: number;
  readonly durableGeneration: number;
  readonly recoveryGeneration: number;
  readonly savingGeneration?: number;
  readonly baseRevisionToken: CanonicalRevisionToken;
  readonly oldestUnsavedEditAt?: string;
  readonly changesNotProtected: boolean;
  readonly canonicalRetryNumber: number;
}

export interface CanonicalSaveRequest {
  readonly document: CbbDocument;
  readonly editGeneration: number;
  readonly baseRevisionToken: CanonicalRevisionToken;
}

export type CanonicalSaveOutcome =
  | {
      readonly status: "saved";
      readonly revisionToken: CanonicalRevisionToken;
    }
  | { readonly status: "failed"; readonly detail?: string }
  | { readonly status: "conflicted"; readonly detail?: string };

export interface CanonicalAutosavePort {
  save(request: CanonicalSaveRequest): Promise<CanonicalSaveOutcome>;
}

export interface RecoverySnapshotRecord {
  readonly version: 1;
  readonly kind: "documentRecoverySnapshot";
  readonly workspaceId: WorkspaceId;
  readonly localResourceId: LocalResourceId;
  readonly resourceKind: WorkspaceResourceKind;
  readonly editGeneration: number;
  readonly baseRevisionToken: CanonicalRevisionToken;
  readonly documentHash: CanonicalRevisionToken;
  readonly oldestUnsavedEditAt: string;
  readonly createdAt: string;
  readonly document: CbbDocument;
}

export type RecoverySnapshotOutcome =
  | { readonly status: "saved" }
  | { readonly status: "failed"; readonly detail?: string };

export interface RecoverySnapshotPruneRequest {
  readonly workspaceId: WorkspaceId;
  readonly localResourceId: LocalResourceId;
  readonly resourceKind: WorkspaceResourceKind;
  /** Durable revision from which the covered edit lineage started. */
  readonly previousRevisionToken: CanonicalRevisionToken;
  /** Exact canonical revision made durable by the successful save. */
  readonly savedRevisionToken: CanonicalRevisionToken;
  /** Only snapshots at or below this save boundary are covered. */
  readonly coveredThroughEditGeneration: number;
}

export type RecoverySnapshotPruneOutcome =
  | {
      readonly status: "pruned";
      readonly deletedSnapshots: number;
      readonly retainedSnapshots: number;
    }
  | { readonly status: "failed"; readonly detail?: string };

export interface RecoverySnapshotPort {
  flush(snapshot: RecoverySnapshotRecord): Promise<RecoverySnapshotOutcome>;
  /**
   * Durably record canonical revision coverage, then delete only exact observed
   * snapshot bytes covered by that save. Canonical durability never depends on
   * cleanup succeeding.
   */
  pruneCovered(
    request: RecoverySnapshotPruneRequest,
  ): Promise<RecoverySnapshotPruneOutcome>;
}

export interface AutosaveSchedulerPort {
  nowMilliseconds(): number;
  schedule(callback: () => void, delayMilliseconds: number): unknown;
  cancel(handle: unknown): void;
}

export interface AutosaveControllerOptions {
  readonly workspaceId: WorkspaceId;
  readonly localResourceId: LocalResourceId;
  readonly resourceKind: WorkspaceResourceKind;
  readonly initialDocument: CbbDocument;
  readonly initialRevisionToken: CanonicalRevisionToken;
  readonly canonical: CanonicalAutosavePort;
  readonly recovery: RecoverySnapshotPort;
  readonly scheduler: AutosaveSchedulerPort;
  readonly onStateChange?: (state: AutosaveState) => void;
}

export type ShutdownDisposition =
  | { readonly status: "allow"; readonly reason: "clean" | "readOnly" | "discardConfirmed" }
  | {
      readonly status: "block";
      readonly reason: "unsaved" | "saving" | "saveFailed" | "conflicted";
      readonly actions: readonly ("retry" | "exportRecoveryCopy" | "discard" | "cancel")[];
    };
