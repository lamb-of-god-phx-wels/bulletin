export type TransactionState =
  | "planned"
  | "staged"
  | "committing"
  | "committed"
  | "rollingBack"
  | "rolledBack"
  | "failed";

export type TransactionDigest = `sha256:${string}`;

export interface DurableBlob {
  /** Bytes returned by storage are snapshots and must not alias mutable storage. */
  readonly bytes: Uint8Array;
  /** Digest computed by the storage adapter from the durable bytes. */
  readonly hash: TransactionDigest;
}

export interface TransactionPayload extends DurableBlob {
  readonly transactionId: string;
  readonly payloadId: string;
}

/**
 * Minimal durable storage surface required by the generic transaction engine.
 * Adapters must fsync/durably replace journals and implement resource mutations
 * as atomic compare-and-swap operations.
 */
export interface TransactionStoragePort {
  listJournalIds(): Promise<readonly string[]>;
  readJournal(transactionId: string): Promise<unknown | undefined>;
  writeJournal(journal: TransactionJournal): Promise<void>;
  deleteJournal(transactionId: string, expected: TransactionJournal): Promise<boolean>;
  quarantineJournal(
    transactionId: string,
    journal: TransactionJournal,
    reason: string,
  ): Promise<void>;

  readResource(resourceKey: string): Promise<DurableBlob | undefined>;
  writeResource(
    resourceKey: string,
    bytes: Uint8Array,
    expectedCurrentHash: TransactionDigest | null,
  ): Promise<boolean>;
  deleteResource(
    resourceKey: string,
    expectedCurrentHash: TransactionDigest,
  ): Promise<boolean>;

  writeTransactionPayload(
    transactionId: string,
    payloadId: string,
    bytes: Uint8Array,
  ): Promise<void>;
  readTransactionPayload(
    transactionId: string,
    payloadId: string,
  ): Promise<TransactionPayload | undefined>;
  listTransactionPayloads(transactionId: string): Promise<readonly TransactionPayload[]>;
  deleteTransactionPayload(
    transactionId: string,
    payloadId: string,
    expectedHash: TransactionDigest,
  ): Promise<boolean>;
}

export interface TransactionClockPort {
  now(): string;
}

export interface TransactionIdPort {
  allocate(purpose: string): string;
}

export interface TransactionHashPort {
  digest(bytes: Uint8Array): TransactionDigest | Promise<TransactionDigest>;
}

export interface PutResourceMutation {
  readonly id: string;
  readonly resourceKey: string;
  readonly operation: "put";
  readonly expectedOldHash: TransactionDigest | null;
  readonly expectedNewHash: TransactionDigest;
  readonly newBytes: Uint8Array;
  /** False means interrupted recovery must roll back instead of retrying it. */
  readonly idempotent: boolean;
  /** Commit markers and registry/version pointers are always applied last. */
  readonly commitMarker?: boolean;
}

export interface DeleteResourceMutation {
  readonly id: string;
  readonly resourceKey: string;
  readonly operation: "delete";
  readonly expectedOldHash: TransactionDigest;
  readonly expectedNewHash: null;
  readonly idempotent: boolean;
  readonly commitMarker?: boolean;
}

export type ResourceMutation = PutResourceMutation | DeleteResourceMutation;

export interface TransactionRequest {
  readonly sourceDigest: TransactionDigest;
  /** Stable allocation slots; values are minted once and persisted in planned. */
  readonly allocationKeys?: readonly string[];
  readonly mutations: readonly ResourceMutation[];
}

export interface JournaledResourceStep {
  readonly id: string;
  readonly order: number;
  readonly resourceKey: string;
  readonly operation: "put" | "delete";
  readonly expectedOldHash: TransactionDigest | null;
  readonly expectedNewHash: TransactionDigest | null;
  readonly idempotent: boolean;
  readonly commitMarker: boolean;
  readonly oldPayloadId?: string;
  readonly newPayloadId?: string;
}

export interface TransactionFailure {
  readonly message: string;
  /** True only after every visible resource was verified at its old hash. */
  readonly rollbackVerified: boolean;
}

export interface TransactionJournal {
  readonly journalVersion: 1;
  readonly transactionId: string;
  readonly state: TransactionState;
  readonly sourceDigest: TransactionDigest;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly allocations: Readonly<Record<string, string>>;
  readonly steps: readonly JournaledResourceStep[];
  readonly completedSteps: readonly string[];
  /** Durable evidence that visible commit processing was entered. */
  readonly visibleCommitStarted: boolean;
  readonly failure?: TransactionFailure;
}

export interface PreparedTransaction {
  readonly transactionId: string;
  readonly allocations: Readonly<Record<string, string>>;
  readonly journal: TransactionJournal;
}

export interface StartupRecoveryAction {
  readonly transactionId: string;
  readonly action: "rolledBack" | "committed" | "cleaned" | "quarantined";
}

export interface StartupRecoveryProblem {
  readonly transactionId: string;
  readonly message: string;
}

export type StartupRecoveryResult =
  | {
      readonly mode: "readWrite";
      readonly actions: readonly StartupRecoveryAction[];
      readonly problems: readonly [];
    }
  | {
      readonly mode: "readOnly";
      readonly actions: readonly StartupRecoveryAction[];
      readonly problems: readonly StartupRecoveryProblem[];
    };
