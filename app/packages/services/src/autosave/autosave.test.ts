import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalRevisionToken,
  createSchemaCatalog,
  parseLocalResourceId,
  parseWorkspaceId,
  type CanonicalRevisionToken,
  type CbbDocument,
  type SchemaObject,
} from "@cbb/core";
import {
  AUTOSAVE_RETRY_DELAYS_MS,
  AutosaveController,
  type AutosaveControllerOptions,
  type AutosaveSchedulerPort,
  type CanonicalAutosavePort,
  type CanonicalSaveOutcome,
  type RecoverySnapshotOutcome,
  type RecoverySnapshotPort,
  type RecoverySnapshotPruneOutcome,
  type RecoverySnapshotPruneRequest,
  type RecoverySnapshotRecord,
} from "./index.js";

interface ScheduledTask {
  readonly id: number;
  readonly due: number;
  readonly order: number;
  readonly callback: () => void;
}

class FakeScheduler implements AutosaveSchedulerPort {
  private nextId = 1;
  private order = 1;
  private readonly tasks = new Map<number, ScheduledTask>();

  constructor(private current = Date.parse("2026-07-12T12:00:00.000Z")) {}

  nowMilliseconds(): number { return this.current; }

  schedule(callback: () => void, delayMilliseconds: number): unknown {
    const id = this.nextId++;
    this.tasks.set(id, {
      id,
      due: this.current + delayMilliseconds,
      order: this.order++,
      callback,
    });
    return id;
  }

  cancel(handle: unknown): void {
    if (typeof handle === "number") this.tasks.delete(handle);
  }

  advanceBy(milliseconds: number): void {
    const target = this.current + milliseconds;
    for (;;) {
      const next = [...this.tasks.values()]
        .filter((task) => task.due <= target)
        .sort((left, right) => left.due - right.due || left.order - right.order)[0];
      if (next === undefined) break;
      this.tasks.delete(next.id);
      this.current = next.due;
      next.callback();
    }
    this.current = target;
  }
}

function deferred<T>() {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  return {
    promise,
    resolve(value: T) {
      if (resolvePromise === undefined) throw new Error("Deferred promise is unavailable");
      resolvePromise(value);
    },
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

class PlannedCanonical implements CanonicalAutosavePort {
  readonly requests: Parameters<CanonicalAutosavePort["save"]>[0][] = [];
  readonly plans: (CanonicalSaveOutcome | Promise<CanonicalSaveOutcome>)[] = [];

  async save(request: Parameters<CanonicalAutosavePort["save"]>[0]) {
    this.requests.push(request);
    return await (this.plans.shift() ?? { status: "failed" as const });
  }
}

class PlannedRecovery implements RecoverySnapshotPort {
  readonly snapshots: RecoverySnapshotRecord[] = [];
  readonly plans: (RecoverySnapshotOutcome | Promise<RecoverySnapshotOutcome>)[] = [];
  readonly pruneRequests: RecoverySnapshotPruneRequest[] = [];
  readonly prunePlans: (
    RecoverySnapshotPruneOutcome | Promise<RecoverySnapshotPruneOutcome>
  )[] = [];

  async flush(snapshot: RecoverySnapshotRecord) {
    this.snapshots.push(snapshot);
    return await (this.plans.shift() ?? { status: "saved" as const });
  }

  async pruneCovered(request: RecoverySnapshotPruneRequest) {
    this.pruneRequests.push(request);
    return await (this.prunePlans.shift() ?? {
      status: "pruned" as const,
      deletedSnapshots: 0,
      retainedSnapshots: 0,
    });
  }
}

const INITIAL_HASH = `sha256:${"a".repeat(64)}` as CanonicalRevisionToken;

function fixture(): CbbDocument {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), "test/fixtures/full-featured-bulletin.json"), "utf8"),
  ) as CbbDocument;
}

function changed(document: CbbDocument, suffix: string): CbbDocument {
  return { ...document, name: `${document.name} ${suffix}` };
}

function harness(input: {
  canonical?: PlannedCanonical;
  recovery?: PlannedRecovery;
  scheduler?: FakeScheduler;
  onStateChange?: AutosaveControllerOptions["onStateChange"];
} = {}) {
  const canonical = input.canonical ?? new PlannedCanonical();
  const recovery = input.recovery ?? new PlannedRecovery();
  const scheduler = input.scheduler ?? new FakeScheduler();
  const initialDocument = fixture();
  const controller = new AutosaveController({
    workspaceId: parseWorkspaceId("00000000-0000-4000-8000-000000000001"),
    localResourceId: parseLocalResourceId("00000000-0000-4000-8000-000000000002"),
    resourceKind: "bulletin",
    initialDocument,
    initialRevisionToken: INITIAL_HASH,
    canonical,
    recovery,
    scheduler,
    ...(input.onStateChange === undefined ? {} : { onStateChange: input.onStateChange }),
  });
  return { controller, canonical, recovery, scheduler, initialDocument };
}

describe("AutosaveController", () => {
  it("debounces 500 ms of inactivity but attempts within 2 s of continuous edits", async () => {
    const quiet = harness();
    const firstDeferred = deferred<CanonicalSaveOutcome>();
    quiet.canonical.plans.push(firstDeferred.promise);
    quiet.controller.edit(changed(quiet.initialDocument, "one"));
    quiet.scheduler.advanceBy(400);
    quiet.controller.edit(changed(quiet.initialDocument, "two"));
    quiet.scheduler.advanceBy(499);
    expect(quiet.canonical.requests).toHaveLength(0);
    quiet.scheduler.advanceBy(1);
    expect(quiet.canonical.requests).toHaveLength(1);

    const continuous = harness();
    continuous.canonical.plans.push(deferred<CanonicalSaveOutcome>().promise);
    continuous.controller.edit(changed(continuous.initialDocument, "0"));
    for (let index = 1; index <= 4; index++) {
      continuous.scheduler.advanceBy(400);
      continuous.controller.edit(changed(continuous.initialDocument, String(index)));
    }
    continuous.scheduler.advanceBy(399);
    expect(continuous.canonical.requests).toHaveLength(0);
    continuous.scheduler.advanceBy(1);
    expect(continuous.canonical.requests).toHaveLength(1);
    expect(continuous.canonical.requests[0]?.editGeneration).toBe(5);
    await settle();
  });

  it("keeps edits made during a save dirty and follows with another save", async () => {
    const h = harness();
    const first = deferred<CanonicalSaveOutcome>();
    h.canonical.plans.push(first.promise, {
      status: "saved",
      revisionToken: `sha256:${"c".repeat(64)}` as CanonicalRevisionToken,
    });
    h.controller.edit(changed(h.initialDocument, "first"));
    h.scheduler.advanceBy(500);
    expect(h.controller.state().phase).toBe("saving");
    h.controller.edit(changed(h.initialDocument, "second"));
    first.resolve({
      status: "saved",
      revisionToken: `sha256:${"b".repeat(64)}` as CanonicalRevisionToken,
    });
    await settle();
    expect(h.controller.state()).toMatchObject({ phase: "dirty", durableGeneration: 1, editGeneration: 2 });
    h.scheduler.advanceBy(500);
    await settle();
    expect(h.canonical.requests.map((request) => request.editGeneration)).toEqual([1, 2]);
    expect(h.controller.state()).toMatchObject({ phase: "clean", durableGeneration: 2 });
  });

  it("uses the 1/2/5/10/30 second retry ladder and caps later retries at 30 seconds", async () => {
    const h = harness();
    for (let index = 0; index < 7; index++) h.canonical.plans.push({ status: "failed" });
    h.controller.edit(changed(h.initialDocument, "failure"));
    h.scheduler.advanceBy(500);
    await settle();
    expect(h.canonical.requests).toHaveLength(1);
    expect(h.controller.state().phase).toBe("saveFailed");

    for (const delay of [...AUTOSAVE_RETRY_DELAYS_MS, 30_000]) {
      h.scheduler.advanceBy(delay - 1);
      expect(h.canonical.requests).toHaveLength(h.controller.state().canonicalRetryNumber);
      h.scheduler.advanceBy(1);
      await settle();
    }
    expect(h.canonical.requests).toHaveLength(7);
  });

  it("stops canonical autosave after a conflict while recovery protection continues", async () => {
    const h = harness();
    h.canonical.plans.push({ status: "conflicted" });
    h.controller.edit(changed(h.initialDocument, "conflict"));
    h.scheduler.advanceBy(500);
    await settle();
    expect(h.controller.state().phase).toBe("conflicted");
    expect(h.controller.retryNow()).toBe(false);
    h.controller.edit(changed(h.initialDocument, "after conflict"));
    h.scheduler.advanceBy(60_000);
    await settle();
    expect(h.canonical.requests).toHaveLength(1);
    expect(h.recovery.snapshots.at(-1)?.editGeneration).toBe(2);
  });

  it("flushes recovery independently by 4.5 s during continuous edits and stays protected at 5 s", async () => {
    const h = harness();
    h.canonical.plans.push(deferred<CanonicalSaveOutcome>().promise);
    h.controller.edit(changed(h.initialDocument, "0"));
    for (let index = 1; index <= 10; index++) {
      h.scheduler.advanceBy(400);
      h.controller.edit(changed(h.initialDocument, String(index)));
    }
    expect(h.recovery.snapshots).toHaveLength(0);
    h.scheduler.advanceBy(499);
    expect(h.recovery.snapshots).toHaveLength(0);
    h.scheduler.advanceBy(1);
    await settle();
    expect(h.recovery.snapshots).toHaveLength(1);
    expect(h.recovery.snapshots[0]).toMatchObject({ editGeneration: 11 });
    expect(Date.parse(h.recovery.snapshots[0]?.createdAt ?? "")).toBe(
      Date.parse("2026-07-12T12:00:04.500Z"),
    );
    h.scheduler.advanceBy(500);
    expect(h.controller.state().changesNotProtected).toBe(false);
  });

  it("marks changes unprotected only when both writes fail or the 5 s deadline is missed", async () => {
    const hanging = harness();
    const canonical = deferred<CanonicalSaveOutcome>();
    const recovery = deferred<RecoverySnapshotOutcome>();
    hanging.canonical.plans.push(canonical.promise);
    hanging.recovery.plans.push(recovery.promise);
    hanging.controller.edit(changed(hanging.initialDocument, "hanging"));
    hanging.scheduler.advanceBy(4_999);
    expect(hanging.controller.state().changesNotProtected).toBe(false);
    hanging.scheduler.advanceBy(1);
    expect(hanging.controller.state().changesNotProtected).toBe(true);
    recovery.resolve({ status: "saved" });
    await settle();
    expect(hanging.controller.state().changesNotProtected).toBe(false);

    const failed = harness();
    failed.canonical.plans.push({ status: "failed" });
    failed.recovery.plans.push({ status: "failed" });
    failed.controller.edit(changed(failed.initialDocument, "failed"));
    failed.scheduler.advanceBy(500);
    await settle();
    expect(failed.controller.state()).toMatchObject({
      phase: "saveFailed",
      changesNotProtected: true,
    });
  });

  it("supports an immediate explicit retry and returns to clean on success", async () => {
    const h = harness();
    h.canonical.plans.push(
      { status: "failed" },
      {
        status: "saved",
        revisionToken: `sha256:${"d".repeat(64)}` as CanonicalRevisionToken,
      },
    );
    h.controller.edit(changed(h.initialDocument, "retry"));
    h.scheduler.advanceBy(500);
    await settle();
    expect(h.controller.state().phase).toBe("saveFailed");
    expect(h.controller.retryNow()).toBe(true);
    await settle();
    expect(h.canonical.requests).toHaveLength(2);
    expect(h.controller.state()).toMatchObject({ phase: "clean", changesNotProtected: false });
  });

  it("prunes the exact saved lineage without making cleanup part of canonical durability", async () => {
    const h = harness();
    const savedRevisionToken = `sha256:${"9".repeat(64)}` as CanonicalRevisionToken;
    h.canonical.plans.push({ status: "saved", revisionToken: savedRevisionToken });
    h.recovery.prunePlans.push(Promise.reject(new Error("injected cleanup fault")));
    h.controller.edit(changed(h.initialDocument, "covered"));
    h.scheduler.advanceBy(500);
    await settle();

    expect(h.recovery.pruneRequests).toEqual([{
      workspaceId: parseWorkspaceId("00000000-0000-4000-8000-000000000001"),
      localResourceId: parseLocalResourceId("00000000-0000-4000-8000-000000000002"),
      resourceKind: "bulletin",
      previousRevisionToken: INITIAL_HASH,
      savedRevisionToken,
      coveredThroughEditGeneration: 1,
    }]);
    expect(h.controller.state()).toMatchObject({
      phase: "clean",
      durableGeneration: 1,
      changesNotProtected: false,
    });
  });

  it("returns explicit shutdown blocking actions and requires confirmed discard", async () => {
    const h = harness();
    expect(h.controller.shutdownDisposition()).toEqual({ status: "allow", reason: "clean" });
    const pending = deferred<CanonicalSaveOutcome>();
    h.canonical.plans.push(pending.promise);
    h.controller.edit(changed(h.initialDocument, "shutdown"));
    expect(h.controller.shutdownDisposition()).toMatchObject({ status: "block", reason: "unsaved" });
    h.scheduler.advanceBy(500);
    expect(h.controller.shutdownDisposition()).toMatchObject({ status: "block", reason: "saving" });
    pending.resolve({ status: "failed" });
    await settle();
    expect(h.controller.shutdownDisposition()).toMatchObject({
      status: "block",
      reason: "saveFailed",
      actions: ["retry", "exportRecoveryCopy", "discard", "cancel"],
    });
    expect(h.controller.confirmDiscardForShutdown()).toEqual({
      status: "allow",
      reason: "discardConfirmed",
    });

    const readOnly = harness();
    readOnly.controller.enterReadOnly();
    expect(readOnly.controller.shutdownDisposition()).toEqual({ status: "allow", reason: "readOnly" });
    expect(() => readOnly.controller.edit(changed(readOnly.initialDocument, "forbidden"))).toThrow(
      "Cannot edit a read-only autosave session",
    );
  });

  it("keeps read-only state while safely accounting for writes already in flight", async () => {
    const h = harness();
    const canonical = deferred<CanonicalSaveOutcome>();
    const recovery = deferred<RecoverySnapshotOutcome>();
    h.canonical.plans.push(canonical.promise);
    h.recovery.plans.push(recovery.promise);
    h.controller.edit(changed(h.initialDocument, "in flight"));
    h.scheduler.advanceBy(500);
    expect(h.controller.state().phase).toBe("saving");
    h.controller.enterReadOnly();
    canonical.resolve({
      status: "saved",
      revisionToken: `sha256:${"e".repeat(64)}` as CanonicalRevisionToken,
    });
    recovery.resolve({ status: "saved" });
    await settle();
    expect(h.controller.state()).toMatchObject({
      phase: "readOnly",
      durableGeneration: 1,
      recoveryGeneration: 1,
      changesNotProtected: false,
    });
    expect(h.controller.shutdownDisposition()).toEqual({ status: "allow", reason: "readOnly" });
  });

  it("emits a schema-valid, hash-bound, closed recovery snapshot root", async () => {
    const h = harness();
    h.canonical.plans.push(deferred<CanonicalSaveOutcome>().promise);
    h.controller.edit(changed(h.initialDocument, "snapshot"));
    h.scheduler.advanceBy(500);
    await settle();
    const snapshot = h.recovery.snapshots[0] as RecoverySnapshotRecord;
    expect(snapshot.documentHash).toBe(canonicalRevisionToken(snapshot.document));

    const schemaDirectory = resolve(process.cwd(), "schemas/v1");
    const schemas = new Map<string, SchemaObject>();
    for (const name of [
      "common.schema.json",
      "richText.schema.json",
      "rights.schema.json",
      "element.schema.json",
      "customElement.schema.json",
      "document.schema.json",
      "workspace.schema.json",
      "recovery-snapshot.schema.json",
    ]) {
      const schema = JSON.parse(readFileSync(join(schemaDirectory, name), "utf8")) as SchemaObject;
      schemas.set(schema.$id, schema);
    }
    const catalog = createSchemaCatalog(schemas);
    const schemaId =
      "https://church-bulletin-builder.local/schema/v1/recovery-snapshot.schema.json";
    expect(catalog.validateAgainst(schemaId, snapshot).valid).toBe(true);
    expect(catalog.validateAgainst(schemaId, { ...snapshot, unexpected: true }).valid).toBe(false);
  });
});
