import type {
  DurableBlob,
  JournaledResourceStep,
  PreparedTransaction,
  StartupRecoveryAction,
  StartupRecoveryProblem,
  StartupRecoveryResult,
  TransactionClockPort,
  TransactionDigest,
  TransactionHashPort,
  TransactionIdPort,
  TransactionJournal,
  TransactionPayload,
  TransactionRequest,
  TransactionState,
  TransactionStoragePort,
} from "./types.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;
const STATES = new Set<TransactionState>([
  "planned", "staged", "committing", "committed", "rollingBack",
  "rolledBack", "failed",
]);

export class TransactionInputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "TransactionInputError";
  }
}

export class TransactionStateError extends Error {
  public constructor(
    public readonly transactionId: string,
    message: string,
  ) {
    super(message);
    this.name = "TransactionStateError";
  }
}

export class TransactionAmbiguityError extends Error {
  public constructor(
    public readonly transactionId: string,
    message: string,
  ) {
    super(message);
    this.name = "TransactionAmbiguityError";
  }
}

interface CoordinatorPorts {
  readonly storage: TransactionStoragePort;
  readonly clock: TransactionClockPort;
  readonly ids: TransactionIdPort;
  readonly hashes: TransactionHashPort;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDigest(value: unknown): value is TransactionDigest {
  return typeof value === "string" && DIGEST.test(value);
}

function requireSafeId(value: unknown, label: string): string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw new TransactionInputError(`${label} must be a nonempty portable identifier.`);
  }
  return value;
}

function requireOpaqueAllocation(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new TransactionInputError(`${label} must be a nonempty opaque identifier.`);
  }
  return value;
}

function cloneBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

function setOwnString(record: Record<string, string>, key: string, value: string): void {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    configurable: false,
    writable: false,
  });
}

function completion(kind: "stage-old" | "stage-new" | "commit" | "rollback", id: string): string {
  return `${kind}:${id}`;
}

function orderedForCommit(steps: readonly JournaledResourceStep[]): JournaledResourceStep[] {
  return [...steps].sort((left, right) =>
    Number(left.commitMarker) - Number(right.commitMarker) || left.order - right.order,
  );
}

function expectedPayloads(
  journal: TransactionJournal,
): ReadonlyMap<string, TransactionDigest> {
  const result = new Map<string, TransactionDigest>();
  for (const step of journal.steps) {
    if (step.oldPayloadId !== undefined && step.expectedOldHash !== null) {
      result.set(step.oldPayloadId, step.expectedOldHash);
    }
    if (step.newPayloadId !== undefined && step.expectedNewHash !== null) {
      result.set(step.newPayloadId, step.expectedNewHash);
    }
  }
  return result;
}

function parseJournal(value: unknown, listedId: string): TransactionJournal {
  if (!isRecord(value)) throw new TransactionInputError("Journal is not an object.");
  if (value["journalVersion"] !== 1) {
    throw new TransactionInputError("Journal version is missing or unsupported.");
  }
  const transactionId = requireSafeId(value["transactionId"], "transactionId");
  if (transactionId !== listedId) {
    throw new TransactionInputError("Journal id does not match its durable storage key.");
  }
  const state = value["state"];
  if (typeof state !== "string" || !STATES.has(state as TransactionState)) {
    throw new TransactionInputError(`Unknown transaction state ${String(state)}.`);
  }
  if (!isDigest(value["sourceDigest"])) {
    throw new TransactionInputError("Journal sourceDigest is invalid.");
  }
  if (typeof value["createdAt"] !== "string" || typeof value["updatedAt"] !== "string") {
    throw new TransactionInputError("Journal timestamps are invalid.");
  }
  if (!isRecord(value["allocations"])) {
    throw new TransactionInputError("Journal allocations are invalid.");
  }
  const allocations: Record<string, string> = {};
  for (const [key, allocation] of Object.entries(value["allocations"])) {
    requireOpaqueAllocation(key, "allocation key");
    setOwnString(
      allocations,
      key,
      requireOpaqueAllocation(allocation, `allocation ${key}`),
    );
  }
  if (!Array.isArray(value["steps"]) || value["steps"].length === 0) {
    throw new TransactionInputError("Journal must contain at least one resource step.");
  }
  const stepIds = new Set<string>();
  const resourceKeys = new Set<string>();
  const steps: JournaledResourceStep[] = value["steps"].map((raw, index) => {
    if (!isRecord(raw)) throw new TransactionInputError(`Step ${index} is invalid.`);
    const id = requireSafeId(raw["id"], `step ${index} id`);
    if (stepIds.has(id)) throw new TransactionInputError(`Duplicate step id ${id}.`);
    stepIds.add(id);
    if (raw["order"] !== index) {
      throw new TransactionInputError("Journal step order is not canonical.");
    }
    const resourceKey = raw["resourceKey"];
    if (typeof resourceKey !== "string" || resourceKey.length === 0 || resourceKey.includes("\0")) {
      throw new TransactionInputError(`Step ${id} resource key is invalid.`);
    }
    if (resourceKeys.has(resourceKey)) {
      throw new TransactionInputError(`Resource ${resourceKey} occurs more than once.`);
    }
    resourceKeys.add(resourceKey);
    const operation = raw["operation"];
    if (operation !== "put" && operation !== "delete") {
      throw new TransactionInputError(`Step ${id} operation is invalid.`);
    }
    const oldHash = raw["expectedOldHash"];
    const newHash = raw["expectedNewHash"];
    if (oldHash !== null && !isDigest(oldHash)) {
      throw new TransactionInputError(`Step ${id} old hash is invalid.`);
    }
    if (newHash !== null && !isDigest(newHash)) {
      throw new TransactionInputError(`Step ${id} new hash is invalid.`);
    }
    if (
      typeof raw["idempotent"] !== "boolean" ||
      typeof raw["commitMarker"] !== "boolean" ||
      (operation === "put" && newHash === null) ||
      (operation === "delete" && (oldHash === null || newHash !== null))
    ) {
      throw new TransactionInputError(`Step ${id} hash/operation contract is invalid.`);
    }
    const oldPayloadId = raw["oldPayloadId"];
    const newPayloadId = raw["newPayloadId"];
    if (oldHash === null) {
      if (oldPayloadId !== undefined) {
        throw new TransactionInputError(`Step ${id} has an unexpected old payload.`);
      }
    } else if (oldPayloadId !== `old-${id}`) {
      throw new TransactionInputError(`Step ${id} old payload id is invalid.`);
    }
    if (operation === "put") {
      if (newPayloadId !== `new-${id}`) {
        throw new TransactionInputError(`Step ${id} new payload id is invalid.`);
      }
    } else if (newPayloadId !== undefined) {
      throw new TransactionInputError(`Step ${id} has an unexpected new payload.`);
    }
    return {
      id,
      order: index,
      resourceKey,
      operation,
      expectedOldHash: oldHash as TransactionDigest | null,
      expectedNewHash: newHash as TransactionDigest | null,
      idempotent: raw["idempotent"],
      commitMarker: raw["commitMarker"],
      ...(oldPayloadId === undefined ? {} : { oldPayloadId }),
      ...(newPayloadId === undefined ? {} : { newPayloadId }),
    };
  });
  if (!Array.isArray(value["completedSteps"])) {
    throw new TransactionInputError("Journal completedSteps is invalid.");
  }
  const allowedCompletions = new Set(steps.flatMap((step) => [
    ...(step.oldPayloadId === undefined ? [] : [completion("stage-old", step.id)]),
    ...(step.newPayloadId === undefined ? [] : [completion("stage-new", step.id)]),
    completion("commit", step.id), completion("rollback", step.id),
  ]));
  const completedSteps: string[] = [];
  const completedSet = new Set<string>();
  for (const item of value["completedSteps"]) {
    if (typeof item !== "string" || !allowedCompletions.has(item) || completedSet.has(item)) {
      throw new TransactionInputError("Journal contains an invalid completed step.");
    }
    completedSet.add(item);
    completedSteps.push(item);
  }
  if (typeof value["visibleCommitStarted"] !== "boolean") {
    throw new TransactionInputError("Journal visible-commit evidence is invalid.");
  }
  const visibleCommitStarted = value["visibleCommitStarted"];
  if (
    ((state === "planned" || state === "staged") && visibleCommitStarted) ||
    ((state === "committing" || state === "committed") && !visibleCommitStarted)
  ) {
    throw new TransactionInputError("Journal state contradicts visible-commit evidence.");
  }
  const hasCompletion = (kind: "commit" | "rollback") =>
    steps.some((step) => completedSet.has(completion(kind, step.id)));
  const allStaged = steps.every((step) =>
    (step.oldPayloadId === undefined || completedSet.has(completion("stage-old", step.id))) &&
    (step.newPayloadId === undefined || completedSet.has(completion("stage-new", step.id))),
  );
  const allCommitted = steps.every((step) => completedSet.has(completion("commit", step.id)));
  const allRolledBack = steps.every((step) => completedSet.has(completion("rollback", step.id)));
  if (
    (state === "planned" && (hasCompletion("commit") || hasCompletion("rollback"))) ||
    (state === "staged" && (!allStaged || hasCompletion("commit") || hasCompletion("rollback"))) ||
    (state === "committing" && (!allStaged || hasCompletion("rollback"))) ||
    (state === "committed" && (!allStaged || !allCommitted || hasCompletion("rollback"))) ||
    (state === "rolledBack" && !allRolledBack)
  ) {
    throw new TransactionInputError("Journal state contradicts its completed steps.");
  }
  let failure: TransactionJournal["failure"];
  if (value["failure"] !== undefined) {
    if (
      !isRecord(value["failure"]) ||
      typeof value["failure"]["message"] !== "string" ||
      typeof value["failure"]["rollbackVerified"] !== "boolean"
    ) {
      throw new TransactionInputError("Journal failure record is invalid.");
    }
    failure = {
      message: value["failure"]["message"],
      rollbackVerified: value["failure"]["rollbackVerified"],
    };
  }
  if (state === "failed" && failure === undefined) {
    throw new TransactionInputError("Failed journal lacks failure evidence.");
  }
  return {
    journalVersion: 1,
    transactionId,
    state: state as TransactionState,
    sourceDigest: value["sourceDigest"],
    createdAt: value["createdAt"],
    updatedAt: value["updatedAt"],
    allocations,
    steps,
    completedSteps,
    visibleCommitStarted,
    ...(failure === undefined ? {} : { failure }),
  };
}

export class JournaledTransactionCoordinator {
  private readonly storage: TransactionStoragePort;
  private readonly clock: TransactionClockPort;
  private readonly ids: TransactionIdPort;
  private readonly hashes: TransactionHashPort;

  public constructor(ports: CoordinatorPorts) {
    this.storage = ports.storage;
    this.clock = ports.clock;
    this.ids = ports.ids;
    this.hashes = ports.hashes;
  }

  private async digest(bytes: Uint8Array): Promise<TransactionDigest> {
    const digest = await this.hashes.digest(bytes);
    if (!isDigest(digest)) throw new TransactionInputError("Hash port returned an invalid digest.");
    return digest;
  }

  private async verifiedBlob(
    transactionId: string,
    label: string,
    blob: DurableBlob,
  ): Promise<DurableBlob> {
    const actual = await this.digest(blob.bytes);
    if (actual !== blob.hash) {
      throw new TransactionAmbiguityError(
        transactionId,
        `${label} bytes disagree with their durable hash.`,
      );
    }
    return blob;
  }

  private async readResource(
    transactionId: string,
    resourceKey: string,
  ): Promise<DurableBlob | undefined> {
    const blob = await this.storage.readResource(resourceKey);
    return blob === undefined
      ? undefined
      : this.verifiedBlob(transactionId, `Resource ${resourceKey}`, blob);
  }

  private async readPayload(
    journal: TransactionJournal,
    payloadId: string,
    expectedHash: TransactionDigest,
  ): Promise<TransactionPayload> {
    const payload = await this.storage.readTransactionPayload(
      journal.transactionId,
      payloadId,
    );
    if (
      payload === undefined ||
      payload.transactionId !== journal.transactionId ||
      payload.payloadId !== payloadId ||
      payload.hash !== expectedHash
    ) {
      throw new TransactionAmbiguityError(
        journal.transactionId,
        `Transaction payload ${payloadId} is missing or hash-mismatched.`,
      );
    }
    await this.verifiedBlob(journal.transactionId, `Transaction payload ${payloadId}`, payload);
    return payload;
  }

  private async load(transactionId: string): Promise<TransactionJournal> {
    const raw = await this.storage.readJournal(transactionId);
    if (raw === undefined) {
      throw new TransactionStateError(transactionId, "Transaction journal does not exist.");
    }
    try {
      return parseJournal(raw, transactionId);
    } catch (error) {
      if (error instanceof TransactionInputError) {
        throw new TransactionAmbiguityError(transactionId, error.message);
      }
      throw error;
    }
  }

  private async persist(
    journal: TransactionJournal,
    changes: Partial<Pick<
      TransactionJournal,
      "state" | "completedSteps" | "failure" | "visibleCommitStarted"
    >>,
  ): Promise<TransactionJournal> {
    const next: TransactionJournal = {
      ...journal,
      ...changes,
      updatedAt: this.clock.now(),
    };
    await this.storage.writeJournal(next);
    return next;
  }

  private async mark(
    journal: TransactionJournal,
    completed: string,
  ): Promise<TransactionJournal> {
    if (journal.completedSteps.includes(completed)) return journal;
    return this.persist(journal, {
      completedSteps: [...journal.completedSteps, completed],
    });
  }

  private validateRequest(request: TransactionRequest): void {
    if (!isDigest(request.sourceDigest)) {
      throw new TransactionInputError("sourceDigest must be a SHA-256 digest.");
    }
    if (request.mutations.length === 0) {
      throw new TransactionInputError("A transaction requires at least one mutation.");
    }
    const ids = new Set<string>();
    const resources = new Set<string>();
    for (const [index, mutation] of request.mutations.entries()) {
      requireSafeId(mutation.id, `mutation ${index} id`);
      if (ids.has(mutation.id)) throw new TransactionInputError(`Duplicate mutation id ${mutation.id}.`);
      ids.add(mutation.id);
      if (mutation.resourceKey.length === 0 || mutation.resourceKey.includes("\0")) {
        throw new TransactionInputError(`Mutation ${mutation.id} resource key is invalid.`);
      }
      if (resources.has(mutation.resourceKey)) {
        throw new TransactionInputError(`Resource ${mutation.resourceKey} is mutated twice.`);
      }
      resources.add(mutation.resourceKey);
      if (mutation.expectedOldHash !== null && !isDigest(mutation.expectedOldHash)) {
        throw new TransactionInputError(`Mutation ${mutation.id} old hash is invalid.`);
      }
      if (mutation.operation === "put") {
        if (!isDigest(mutation.expectedNewHash) || !(mutation.newBytes instanceof Uint8Array)) {
          throw new TransactionInputError(`Mutation ${mutation.id} new content is invalid.`);
        }
      } else if (!isDigest(mutation.expectedOldHash) || mutation.expectedNewHash !== null) {
        throw new TransactionInputError(`Delete mutation ${mutation.id} hashes are invalid.`);
      }
    }
    const allocations = request.allocationKeys ?? [];
    const allocationSet = new Set<string>();
    for (const key of allocations) {
      requireOpaqueAllocation(key, "allocation key");
      if (allocationSet.has(key)) throw new TransactionInputError(`Duplicate allocation key ${key}.`);
      allocationSet.add(key);
    }
  }

  private async snapshotNewBytes(
    request: TransactionRequest,
  ): Promise<ReadonlyMap<string, Uint8Array>> {
    const snapshots = new Map<string, Uint8Array>();
    for (const mutation of request.mutations) {
      if (mutation.operation !== "put") continue;
      const snapshot = cloneBytes(mutation.newBytes);
      if (await this.digest(snapshot) !== mutation.expectedNewHash) {
        throw new TransactionInputError(`Mutation ${mutation.id} expectedNewHash does not match newBytes.`);
      }
      snapshots.set(mutation.id, snapshot);
    }
    return snapshots;
  }

  private async stagePlanned(
    initial: TransactionJournal,
    newBytes: ReadonlyMap<string, Uint8Array>,
  ): Promise<TransactionJournal> {
    let journal = initial;
    for (const step of journal.steps) {
      const current = await this.readResource(journal.transactionId, step.resourceKey);
      const currentHash = current?.hash ?? null;
      if (currentHash !== step.expectedOldHash) {
        throw new TransactionAmbiguityError(
          journal.transactionId,
          `Resource ${step.resourceKey} no longer matches expectedOldHash.`,
        );
      }
      if (step.oldPayloadId !== undefined && current !== undefined) {
        const marker = completion("stage-old", step.id);
        if (journal.completedSteps.includes(marker)) {
          await this.readPayload(journal, step.oldPayloadId, step.expectedOldHash as TransactionDigest);
        } else {
          const existing = await this.storage.readTransactionPayload(
            journal.transactionId,
            step.oldPayloadId,
          );
          if (existing === undefined) {
            await this.storage.writeTransactionPayload(
              journal.transactionId,
              step.oldPayloadId,
              cloneBytes(current.bytes),
            );
          }
          await this.readPayload(journal, step.oldPayloadId, step.expectedOldHash as TransactionDigest);
          journal = await this.mark(journal, marker);
        }
      }
      if (step.newPayloadId !== undefined) {
        const value = newBytes.get(step.id);
        if (value === undefined || step.expectedNewHash === null) {
          throw new TransactionInputError(`Mutation ${step.id} lost its staged input.`);
        }
        const marker = completion("stage-new", step.id);
        if (journal.completedSteps.includes(marker)) {
          await this.readPayload(journal, step.newPayloadId, step.expectedNewHash);
        } else {
          const existing = await this.storage.readTransactionPayload(
            journal.transactionId,
            step.newPayloadId,
          );
          if (existing === undefined) {
            await this.storage.writeTransactionPayload(
              journal.transactionId,
              step.newPayloadId,
              cloneBytes(value),
            );
          }
          await this.readPayload(journal, step.newPayloadId, step.expectedNewHash);
          journal = await this.mark(journal, marker);
        }
      }
    }
    return this.persist(journal, { state: "staged" });
  }

  public async prepare(request: TransactionRequest): Promise<PreparedTransaction> {
    this.validateRequest(request);
    const newBytes = await this.snapshotNewBytes(request);

    const transactionId = requireSafeId(
      this.ids.allocate("transaction"),
      "allocated transaction id",
    );
    if (await this.storage.readJournal(transactionId) !== undefined) {
      throw new TransactionInputError(`Allocated transaction id ${transactionId} already exists.`);
    }
    const allocations: Record<string, string> = {};
    for (const key of [...(request.allocationKeys ?? [])].sort()) {
      setOwnString(
        allocations,
        key,
        requireOpaqueAllocation(
          this.ids.allocate(`transaction:${transactionId}:${key}`),
          `allocated value for ${key}`,
        ),
      );
    }
    const createdAt = this.clock.now();
    let journal: TransactionJournal = {
      journalVersion: 1,
      transactionId,
      state: "planned",
      sourceDigest: request.sourceDigest,
      createdAt,
      updatedAt: createdAt,
      allocations,
      steps: request.mutations.map((mutation, order): JournaledResourceStep => ({
        id: mutation.id,
        order,
        resourceKey: mutation.resourceKey,
        operation: mutation.operation,
        expectedOldHash: mutation.expectedOldHash,
        expectedNewHash: mutation.expectedNewHash,
        idempotent: mutation.idempotent,
        commitMarker: mutation.commitMarker ?? false,
        ...(mutation.expectedOldHash === null ? {} : { oldPayloadId: `old-${mutation.id}` }),
        ...(mutation.operation === "put" ? { newPayloadId: `new-${mutation.id}` } : {}),
      })),
      completedSteps: [],
      visibleCommitStarted: false,
    };
    await this.storage.writeJournal(journal);

    journal = await this.stagePlanned(journal, newBytes);
    return { transactionId, allocations, journal };
  }

  /**
   * Retry staging with the same durable plan. No ids are allocated again; the
   * caller must provide byte-identical intended writes.
   */
  public async resumePrepare(
    transactionId: string,
    request: TransactionRequest,
  ): Promise<PreparedTransaction> {
    this.validateRequest(request);
    const newBytes = await this.snapshotNewBytes(request);
    const journal = await this.load(transactionId);
    if (journal.state !== "planned") {
      throw new TransactionStateError(transactionId, `Cannot resume staging state ${journal.state}.`);
    }
    if (
      journal.sourceDigest !== request.sourceDigest ||
      journal.steps.length !== request.mutations.length ||
      journal.steps.some((step, index) => {
        const mutation = request.mutations[index];
        return mutation === undefined ||
          step.id !== mutation.id ||
          step.resourceKey !== mutation.resourceKey ||
          step.operation !== mutation.operation ||
          step.expectedOldHash !== mutation.expectedOldHash ||
          step.expectedNewHash !== mutation.expectedNewHash ||
          step.idempotent !== mutation.idempotent ||
          step.commitMarker !== (mutation.commitMarker ?? false);
      })
    ) {
      throw new TransactionAmbiguityError(
        transactionId,
        "Retry request does not match the persisted transaction plan.",
      );
    }
    const staged = await this.stagePlanned(journal, newBytes);
    return {
      transactionId,
      allocations: staged.allocations,
      journal: staged,
    };
  }

  private async validateAllPayloads(journal: TransactionJournal): Promise<void> {
    for (const [payloadId, hash] of expectedPayloads(journal)) {
      await this.readPayload(journal, payloadId, hash);
    }
  }

  private async verifyCompletedStepEvidence(
    journal: TransactionJournal,
    kind: "commit" | "rollback",
  ): Promise<void> {
    for (const step of journal.steps) {
      if (!journal.completedSteps.includes(completion(kind, step.id))) continue;
      const resource = await this.readResource(journal.transactionId, step.resourceKey);
      const expected = kind === "commit" ? step.expectedNewHash : step.expectedOldHash;
      if ((resource?.hash ?? null) !== expected) {
        throw new TransactionAmbiguityError(
          journal.transactionId,
          `Completed ${kind} step ${step.id} disagrees with visible bytes.`,
        );
      }
    }
  }

  private async applyCommitStep(
    journal: TransactionJournal,
    step: JournaledResourceStep,
  ): Promise<TransactionJournal> {
    const completed = completion("commit", step.id);
    const current = await this.readResource(journal.transactionId, step.resourceKey);
    const currentHash = current?.hash ?? null;
    if (currentHash === step.expectedNewHash) return this.mark(journal, completed);
    if (currentHash !== step.expectedOldHash) {
      throw new TransactionAmbiguityError(
        journal.transactionId,
        `Resource ${step.resourceKey} matches neither recorded old nor new hash.`,
      );
    }
    let applied: boolean;
    if (step.operation === "put") {
      const payload = await this.readPayload(
        journal,
        step.newPayloadId as string,
        step.expectedNewHash as TransactionDigest,
      );
      applied = await this.storage.writeResource(
        step.resourceKey,
        cloneBytes(payload.bytes),
        step.expectedOldHash,
      );
    } else {
      applied = await this.storage.deleteResource(
        step.resourceKey,
        step.expectedOldHash as TransactionDigest,
      );
    }
    if (!applied) {
      throw new TransactionAmbiguityError(
        journal.transactionId,
        `Atomic commit check failed for ${step.resourceKey}.`,
      );
    }
    const after = await this.readResource(journal.transactionId, step.resourceKey);
    if ((after?.hash ?? null) !== step.expectedNewHash) {
      throw new TransactionAmbiguityError(
        journal.transactionId,
        `Committed resource ${step.resourceKey} failed reread verification.`,
      );
    }
    return this.mark(journal, completed);
  }

  public async commit(transactionId: string): Promise<TransactionJournal> {
    let journal = await this.load(transactionId);
    const resuming = journal.state === "committing";
    if (journal.state === "staged") {
      journal = await this.persist(journal, {
        state: "committing",
        visibleCommitStarted: true,
      });
    } else if (!resuming) {
      throw new TransactionStateError(transactionId, `Cannot commit state ${journal.state}.`);
    }
    if (
      resuming &&
      journal.steps.some((step) =>
        !journal.completedSteps.includes(completion("commit", step.id)) && !step.idempotent,
      )
    ) {
      throw new TransactionStateError(
        transactionId,
        "Interrupted transaction has a non-idempotent remaining step.",
      );
    }
    await this.validateAllPayloads(journal);
    await this.verifyCompletedStepEvidence(journal, "commit");
    for (const step of orderedForCommit(journal.steps)) {
      journal = await this.applyCommitStep(journal, step);
    }
    journal = await this.persist(journal, { state: "committed" });
    await this.cleanupCommitted(journal);
    return journal;
  }

  private async restoreStep(
    journal: TransactionJournal,
    step: JournaledResourceStep,
  ): Promise<TransactionJournal> {
    const completed = completion("rollback", step.id);
    const current = await this.readResource(journal.transactionId, step.resourceKey);
    const currentHash = current?.hash ?? null;
    if (currentHash === step.expectedOldHash) return this.mark(journal, completed);
    if (currentHash !== step.expectedNewHash) {
      throw new TransactionAmbiguityError(
        journal.transactionId,
        `Rollback cannot prove ownership of ${step.resourceKey}.`,
      );
    }
    let restored: boolean;
    if (step.expectedOldHash === null) {
      if (currentHash === null) return this.mark(journal, completed);
      restored = await this.storage.deleteResource(step.resourceKey, currentHash);
    } else {
      const payload = await this.readPayload(
        journal,
        step.oldPayloadId as string,
        step.expectedOldHash,
      );
      restored = await this.storage.writeResource(
        step.resourceKey,
        cloneBytes(payload.bytes),
        currentHash,
      );
    }
    if (!restored) {
      throw new TransactionAmbiguityError(
        journal.transactionId,
        `Atomic rollback check failed for ${step.resourceKey}.`,
      );
    }
    const after = await this.readResource(journal.transactionId, step.resourceKey);
    if ((after?.hash ?? null) !== step.expectedOldHash) {
      throw new TransactionAmbiguityError(
        journal.transactionId,
        `Rolled-back resource ${step.resourceKey} failed reread verification.`,
      );
    }
    return this.mark(journal, completed);
  }

  private async rollbackUncommitted(journal: TransactionJournal): Promise<TransactionJournal> {
    let next = journal;
    try {
      // planned/staged transactions never own visible resource bytes. Verify
      // only payloads whose markers claim they were durably staged.
      for (const step of next.steps) {
        if (
          step.oldPayloadId !== undefined &&
          next.completedSteps.includes(completion("stage-old", step.id))
        ) {
          await this.readPayload(next, step.oldPayloadId, step.expectedOldHash as TransactionDigest);
        }
        if (
          step.newPayloadId !== undefined &&
          next.completedSteps.includes(completion("stage-new", step.id))
        ) {
          await this.readPayload(next, step.newPayloadId, step.expectedNewHash as TransactionDigest);
        }
      }
      next = await this.persist(next, { state: "rollingBack" });
      for (const step of next.steps) {
        next = await this.mark(next, completion("rollback", step.id));
      }
      next = await this.persist(next, { state: "rolledBack" });
      await this.cleanupRolledBack(next, false);
      return next;
    } catch (error) {
      try {
        await this.persist(next, {
          state: "failed",
          failure: {
            message: "Uncommitted transaction cleanup could not be verified.",
            rollbackVerified: true,
          },
        });
      } catch {
        // Preserve the original recovery failure. Startup is already read-only.
      }
      throw error;
    }
  }

  private async rollbackVisible(journal: TransactionJournal): Promise<TransactionJournal> {
    let next = journal.state === "rollingBack"
      ? journal
      : await this.persist(journal, { state: "rollingBack" });
    let rollbackVerified = false;
    try {
      await this.validateAllPayloads(next);
      await this.verifyCompletedStepEvidence(next, "rollback");
      for (const step of orderedForCommit(next.steps).reverse()) {
        next = await this.restoreStep(next, step);
      }
      next = await this.persist(next, { state: "rolledBack" });
      rollbackVerified = true;
      await this.cleanupRolledBack(next, true);
      return next;
    } catch (error) {
      try {
        await this.persist(next, {
          state: "failed",
          failure: {
            message: "Visible transaction rollback could not be verified.",
            rollbackVerified,
          },
        });
      } catch {
        // Preserve the original recovery failure. Startup is already read-only.
      }
      throw error;
    }
  }

  public async rollback(transactionId: string): Promise<TransactionJournal> {
    const journal = await this.load(transactionId);
    if (journal.state === "planned" || journal.state === "staged") {
      return this.rollbackUncommitted(journal);
    }
    if (journal.state === "committing" || journal.state === "rollingBack") {
      return this.rollbackVisible(journal);
    }
    throw new TransactionStateError(transactionId, `Cannot roll back state ${journal.state}.`);
  }

  private async verifyResourceTarget(
    journal: TransactionJournal,
    target: "old" | "new",
  ): Promise<void> {
    for (const step of journal.steps) {
      const resource = await this.readResource(journal.transactionId, step.resourceKey);
      const expected = target === "old" ? step.expectedOldHash : step.expectedNewHash;
      if ((resource?.hash ?? null) !== expected) {
        throw new TransactionAmbiguityError(
          journal.transactionId,
          `${target === "old" ? "Rolled-back" : "Committed"} resource ${step.resourceKey} disagrees with its journal.`,
        );
      }
    }
  }

  private async cleanupPayloads(journal: TransactionJournal): Promise<void> {
    const expected = expectedPayloads(journal);
    const payloads = [...await this.storage.listTransactionPayloads(journal.transactionId)]
      .sort((left, right) =>
        left.payloadId < right.payloadId ? -1 : left.payloadId > right.payloadId ? 1 : 0,
      );
    for (const payload of payloads) {
      const expectedHash = expected.get(payload.payloadId);
      if (
        payload.transactionId !== journal.transactionId ||
        expectedHash === undefined ||
        payload.hash !== expectedHash
      ) {
        throw new TransactionAmbiguityError(
          journal.transactionId,
          `Refusing to remove unverified transaction residue ${payload.payloadId}.`,
        );
      }
      await this.verifiedBlob(
        journal.transactionId,
        `Transaction residue ${payload.payloadId}`,
        payload,
      );
    }
    for (const payload of payloads) {
      const removed = await this.storage.deleteTransactionPayload(
        journal.transactionId,
        payload.payloadId,
        payload.hash,
      );
      if (!removed) {
        throw new TransactionAmbiguityError(
          journal.transactionId,
          `Transaction residue ${payload.payloadId} changed during cleanup.`,
        );
      }
    }
  }

  private async cleanupCommitted(journal: TransactionJournal): Promise<void> {
    await this.verifyResourceTarget(journal, "new");
    await this.cleanupPayloads(journal);
    if (!await this.storage.deleteJournal(journal.transactionId, journal)) {
      throw new TransactionAmbiguityError(journal.transactionId, "Transaction journal changed during cleanup.");
    }
  }

  private async cleanupRolledBack(
    journal: TransactionJournal,
    verifyVisibleResources: boolean,
  ): Promise<void> {
    if (verifyVisibleResources) await this.verifyResourceTarget(journal, "old");
    await this.cleanupPayloads(journal);
    if (!await this.storage.deleteJournal(journal.transactionId, journal)) {
      throw new TransactionAmbiguityError(journal.transactionId, "Transaction journal changed during cleanup.");
    }
  }

  private async canCompleteInterrupted(journal: TransactionJournal): Promise<boolean> {
    if (journal.steps.some((step) =>
      !journal.completedSteps.includes(completion("commit", step.id)) && !step.idempotent,
    )) return false;
    await this.validateAllPayloads(journal);
    await this.verifyCompletedStepEvidence(journal, "commit");
    for (const step of journal.steps) {
      const resource = await this.readResource(journal.transactionId, step.resourceKey);
      const hash = resource?.hash ?? null;
      if (hash !== step.expectedOldHash && hash !== step.expectedNewHash) return false;
    }
    return true;
  }

  public async recoverStartup(): Promise<StartupRecoveryResult> {
    const actions: StartupRecoveryAction[] = [];
    const problems: StartupRecoveryProblem[] = [];
    const journals: TransactionJournal[] = [];
    let journalIds: string[];
    try {
      journalIds = [...await this.storage.listJournalIds()].sort();
    } catch (error) {
      return {
        mode: "readOnly",
        actions,
        problems: [{
          transactionId: "journal-store",
          message: error instanceof Error ? error.message : "Transaction journal listing failed.",
        }],
      };
    }
    for (const transactionId of journalIds) {
      try {
        const raw = await this.storage.readJournal(transactionId);
        if (raw === undefined) throw new TransactionInputError("Listed journal is missing.");
        journals.push(parseJournal(raw, transactionId));
      } catch (error) {
        problems.push({
          transactionId,
          message: error instanceof Error ? error.message : "Journal validation failed.",
        });
        return { mode: "readOnly", actions, problems };
      }
    }

    const visibleOwners = new Map<string, string>();
    for (const journal of journals) {
      if (
        !journal.visibleCommitStarted ||
        (journal.state !== "committing" &&
          journal.state !== "rollingBack" &&
          !(journal.state === "failed" && journal.failure?.rollbackVerified !== true))
      ) continue;
      for (const step of journal.steps) {
        const owner = visibleOwners.get(step.resourceKey);
        if (owner !== undefined) {
          problems.push({
            transactionId: journal.transactionId,
            message: `Resource ${step.resourceKey} is claimed by both ${owner} and ${journal.transactionId}.`,
          });
          return { mode: "readOnly", actions, problems };
        }
        visibleOwners.set(step.resourceKey, journal.transactionId);
      }
    }

    for (const journal of journals) {
      try {
        switch (journal.state) {
          case "planned":
          case "staged":
            await this.rollbackUncommitted(journal);
            actions.push({ transactionId: journal.transactionId, action: "rolledBack" });
            break;
          case "committing":
            if (await this.canCompleteInterrupted(journal)) {
              await this.commit(journal.transactionId);
              actions.push({ transactionId: journal.transactionId, action: "committed" });
            } else {
              await this.rollbackVisible(journal);
              actions.push({ transactionId: journal.transactionId, action: "rolledBack" });
            }
            break;
          case "committed":
            await this.cleanupCommitted(journal);
            actions.push({ transactionId: journal.transactionId, action: "cleaned" });
            break;
          case "rollingBack":
            if (journal.visibleCommitStarted) {
              await this.rollbackVisible(journal);
            } else {
              await this.rollbackUncommitted(journal);
            }
            actions.push({ transactionId: journal.transactionId, action: "rolledBack" });
            break;
          case "rolledBack":
            await this.cleanupRolledBack(journal, journal.visibleCommitStarted);
            actions.push({ transactionId: journal.transactionId, action: "cleaned" });
            break;
          case "failed":
            if (journal.failure?.rollbackVerified !== true) {
              throw new TransactionAmbiguityError(
                journal.transactionId,
                "Failed transaction lacks proof of complete rollback.",
              );
            }
            if (journal.visibleCommitStarted) {
              await this.verifyResourceTarget(journal, "old");
            }
            await this.cleanupPayloads(journal);
            await this.storage.quarantineJournal(
              journal.transactionId,
              journal,
              journal.failure.message,
            );
            if (!await this.storage.deleteJournal(journal.transactionId, journal)) {
              throw new TransactionAmbiguityError(
                journal.transactionId,
                "Transaction journal changed during quarantine cleanup.",
              );
            }
            actions.push({ transactionId: journal.transactionId, action: "quarantined" });
            break;
        }
      } catch (error) {
        problems.push({
          transactionId: journal.transactionId,
          message: error instanceof Error ? error.message : "Transaction recovery failed.",
        });
        return { mode: "readOnly", actions, problems };
      }
    }
    return { mode: "readWrite", actions, problems: [] };
  }
}
