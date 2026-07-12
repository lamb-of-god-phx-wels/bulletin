import { hashBytes } from "@cbb/core";
import { describe, expect, it } from "vitest";
import { JournaledTransactionCoordinator } from "./journaledTransaction.js";
import type {
  DurableBlob,
  TransactionDigest,
  TransactionHashPort,
  TransactionJournal,
  TransactionPayload,
  TransactionRequest,
  TransactionStoragePort,
} from "./types.js";

const encoder = new TextEncoder();
const bytes = (value: string): Uint8Array => encoder.encode(value);
const digestBytes = (value: Uint8Array): TransactionDigest =>
  hashBytes(value) as TransactionDigest;
const digest = (value: string): TransactionDigest => digestBytes(bytes(value));
const SOURCE = digest("source archive");

function clone<T>(value: T): T {
  return structuredClone(value);
}

class MemoryStorage implements TransactionStoragePort {
  public readonly journals = new Map<string, unknown>();
  public readonly resources = new Map<string, DurableBlob>();
  public readonly payloads = new Map<string, TransactionPayload>();
  public readonly quarantined: Array<{
    transactionId: string;
    journal: TransactionJournal;
    reason: string;
  }> = [];
  public readonly visibleWriteOrder: string[] = [];
  public failNextResourceWriteAfterApply = false;
  public failNextPayloadWriteAfterApply = false;

  private payloadKey(transactionId: string, payloadId: string): string {
    return `${transactionId}\0${payloadId}`;
  }

  public seed(resourceKey: string, value: string): void {
    const data = bytes(value);
    this.resources.set(resourceKey, { bytes: data, hash: digestBytes(data) });
  }

  public resourceText(resourceKey: string): string | undefined {
    const value = this.resources.get(resourceKey);
    return value === undefined ? undefined : new TextDecoder().decode(value.bytes);
  }

  public async listJournalIds(): Promise<readonly string[]> {
    return [...this.journals.keys()];
  }

  public async readJournal(transactionId: string): Promise<unknown | undefined> {
    const journal = this.journals.get(transactionId);
    return journal === undefined ? undefined : clone(journal);
  }

  public async writeJournal(journal: TransactionJournal): Promise<void> {
    this.journals.set(journal.transactionId, clone(journal));
  }

  public async deleteJournal(
    transactionId: string,
    expected: TransactionJournal,
  ): Promise<boolean> {
    const current = this.journals.get(transactionId);
    if (current === undefined || JSON.stringify(current) !== JSON.stringify(expected)) return false;
    this.journals.delete(transactionId);
    return true;
  }

  public async quarantineJournal(
    transactionId: string,
    journal: TransactionJournal,
    reason: string,
  ): Promise<void> {
    this.quarantined.push({ transactionId, journal: clone(journal), reason });
  }

  public async readResource(resourceKey: string): Promise<DurableBlob | undefined> {
    const value = this.resources.get(resourceKey);
    return value === undefined ? undefined : clone(value);
  }

  public async writeResource(
    resourceKey: string,
    value: Uint8Array,
    expectedCurrentHash: TransactionDigest | null,
  ): Promise<boolean> {
    const current = this.resources.get(resourceKey)?.hash ?? null;
    if (current !== expectedCurrentHash) return false;
    const snapshot = clone(value);
    this.resources.set(resourceKey, { bytes: snapshot, hash: digestBytes(snapshot) });
    this.visibleWriteOrder.push(resourceKey);
    if (this.failNextResourceWriteAfterApply) {
      this.failNextResourceWriteAfterApply = false;
      throw new Error("simulated crash after visible write");
    }
    return true;
  }

  public async deleteResource(
    resourceKey: string,
    expectedCurrentHash: TransactionDigest,
  ): Promise<boolean> {
    if (this.resources.get(resourceKey)?.hash !== expectedCurrentHash) return false;
    this.resources.delete(resourceKey);
    this.visibleWriteOrder.push(resourceKey);
    return true;
  }

  public async writeTransactionPayload(
    transactionId: string,
    payloadId: string,
    value: Uint8Array,
  ): Promise<void> {
    const snapshot = clone(value);
    this.payloads.set(this.payloadKey(transactionId, payloadId), {
      transactionId,
      payloadId,
      bytes: snapshot,
      hash: digestBytes(snapshot),
    });
    if (this.failNextPayloadWriteAfterApply) {
      this.failNextPayloadWriteAfterApply = false;
      throw new Error("simulated crash after payload write");
    }
  }

  public async readTransactionPayload(
    transactionId: string,
    payloadId: string,
  ): Promise<TransactionPayload | undefined> {
    const payload = this.payloads.get(this.payloadKey(transactionId, payloadId));
    return payload === undefined ? undefined : clone(payload);
  }

  public async listTransactionPayloads(transactionId: string): Promise<readonly TransactionPayload[]> {
    return [...this.payloads.values()]
      .filter((payload) => payload.transactionId === transactionId)
      .map(clone);
  }

  public async deleteTransactionPayload(
    transactionId: string,
    payloadId: string,
    expectedHash: TransactionDigest,
  ): Promise<boolean> {
    const key = this.payloadKey(transactionId, payloadId);
    if (this.payloads.get(key)?.hash !== expectedHash) return false;
    this.payloads.delete(key);
    return true;
  }

  public setJournal(journal: TransactionJournal): void {
    this.journals.set(journal.transactionId, clone(journal));
  }

  public corruptPayload(
    transactionId: string,
    payloadId: string,
    value: string,
    claimedHash: TransactionDigest,
  ): void {
    this.payloads.set(this.payloadKey(transactionId, payloadId), {
      transactionId,
      payloadId,
      bytes: bytes(value),
      hash: claimedHash,
    });
  }
}

class TestIds {
  public readonly calls: string[] = [];
  private next = 1;

  public allocate(purpose: string): string {
    this.calls.push(purpose);
    return `id${this.next++}`;
  }
}

function harness(storage = new MemoryStorage(), ids = new TestIds()) {
  let tick = 0;
  const hashes: TransactionHashPort = { digest: digestBytes };
  return {
    storage,
    ids,
    coordinator: new JournaledTransactionCoordinator({
      storage,
      ids,
      hashes,
      clock: { now: () => `2026-07-12T00:00:${String(tick++).padStart(2, "0")}Z` },
    }),
  };
}

function putRequest(
  resourceKey = "resources/document.json",
  oldValue: string | null = "old",
  newValue = "new",
  idempotent = true,
): TransactionRequest {
  return {
    sourceDigest: SOURCE,
    mutations: [{
      id: "document",
      resourceKey,
      operation: "put",
      expectedOldHash: oldValue === null ? null : digest(oldValue),
      expectedNewHash: digest(newValue),
      newBytes: bytes(newValue),
      idempotent,
    }],
  };
}

describe("JournaledTransactionCoordinator", () => {
  it("persists allocations once, expected hashes, completed steps, and commits markers last", async () => {
    const { coordinator, storage, ids } = harness();
    storage.seed("registry.json", "old registry");
    storage.seed("resources/document.json", "old document");
    const prepared = await coordinator.prepare({
      sourceDigest: SOURCE,
      allocationKeys: ["resource", "asset"],
      mutations: [
        {
          id: "registry",
          resourceKey: "registry.json",
          operation: "put",
          expectedOldHash: digest("old registry"),
          expectedNewHash: digest("new registry"),
          newBytes: bytes("new registry"),
          idempotent: true,
          commitMarker: true,
        },
        {
          id: "document",
          resourceKey: "resources/document.json",
          operation: "put",
          expectedOldHash: digest("old document"),
          expectedNewHash: digest("new document"),
          newBytes: bytes("new document"),
          idempotent: true,
        },
      ],
    });

    expect(prepared.journal.state).toBe("staged");
    expect(prepared.journal.allocations).toEqual({ asset: "id2", resource: "id3" });
    expect(prepared.journal.steps[0]).toMatchObject({
      expectedOldHash: digest("old registry"),
      expectedNewHash: digest("new registry"),
    });
    expect(prepared.journal.completedSteps).toEqual([
      "stage-old:registry", "stage-new:registry",
      "stage-old:document", "stage-new:document",
    ]);

    await coordinator.commit(prepared.transactionId);
    expect(storage.resourceText("resources/document.json")).toBe("new document");
    expect(storage.resourceText("registry.json")).toBe("new registry");
    expect(storage.visibleWriteOrder).toEqual(["resources/document.json", "registry.json"]);
    expect(storage.journals.size).toBe(0);
    expect(storage.payloads.size).toBe(0);
    expect(ids.calls).toEqual([
      "transaction",
      `transaction:${prepared.transactionId}:asset`,
      `transaction:${prepared.transactionId}:resource`,
    ]);
  });

  it("rolls back planned/staged work at startup without touching visible resources", async () => {
    const { coordinator, storage } = harness();
    const prepared = await coordinator.prepare(putRequest("new.json", null, "staged"));
    // Even identical bytes created by somebody else are not transaction-owned
    // while the journal is only staged.
    storage.seed("new.json", "staged");

    const result = await coordinator.recoverStartup();

    expect(result).toMatchObject({
      mode: "readWrite",
      actions: [{ transactionId: prepared.transactionId, action: "rolledBack" }],
    });
    expect(storage.resourceText("new.json")).toBe("staged");
    expect(storage.journals.size).toBe(0);
    expect(storage.payloads.size).toBe(0);
  });

  it("recovers partial planned and staging-only rollingBack journals without visible rollback", async () => {
    const { coordinator, storage } = harness();
    storage.failNextPayloadWriteAfterApply = true;
    await expect(
      coordinator.prepare(putRequest("planned.json", null, "planned payload")),
    ).rejects.toThrow("simulated crash");

    const rolling = await coordinator.prepare(
      putRequest("external.json", null, "same external bytes"),
    );
    storage.setJournal({ ...rolling.journal, state: "rollingBack" });
    storage.seed("external.json", "same external bytes");

    const result = await coordinator.recoverStartup();

    expect(result).toEqual({
      mode: "readWrite",
      actions: [
        { transactionId: "id1", action: "rolledBack" },
        { transactionId: rolling.transactionId, action: "rolledBack" },
      ],
      problems: [],
    });
    expect(storage.resourceText("planned.json")).toBeUndefined();
    expect(storage.resourceText("external.json")).toBe("same external bytes");
    expect(storage.journals.size).toBe(0);
    expect(storage.payloads.size).toBe(0);
  });

  it("finishes an idempotent committing write after a crash and reuses persisted allocations", async () => {
    const storage = new MemoryStorage();
    const ids = new TestIds();
    storage.seed("resources/document.json", "old");
    const first = harness(storage, ids);
    const prepared = await first.coordinator.prepare({
      ...putRequest(),
      allocationKeys: ["portableId"],
    });
    const allocation = prepared.allocations["portableId"];
    storage.failNextResourceWriteAfterApply = true;
    await expect(first.coordinator.commit(prepared.transactionId)).rejects.toThrow(
      "simulated crash",
    );
    expect(storage.resourceText("resources/document.json")).toBe("new");
    expect((await storage.readJournal(prepared.transactionId) as TransactionJournal).state)
      .toBe("committing");
    const allocationCalls = ids.calls.length;

    const recovered = await harness(storage, ids).coordinator.recoverStartup();

    expect(recovered.mode).toBe("readWrite");
    expect(recovered.actions).toEqual([
      { transactionId: prepared.transactionId, action: "committed" },
    ]);
    expect(prepared.allocations["portableId"]).toBe(allocation);
    expect(ids.calls).toHaveLength(allocationCalls);
    expect(storage.resourceText("resources/document.json")).toBe("new");
  });

  it("resumes a partial planned stage without reallocating ids", async () => {
    const storage = new MemoryStorage();
    const ids = new TestIds();
    const { coordinator } = harness(storage, ids);
    const request: TransactionRequest = {
      ...putRequest("new.json", null, "new"),
      allocationKeys: ["portableId"],
    };
    storage.failNextPayloadWriteAfterApply = true;
    await expect(coordinator.prepare(request)).rejects.toThrow("simulated crash");
    const journal = await storage.readJournal("id1") as TransactionJournal;
    expect(journal.state).toBe("planned");
    expect(journal.allocations).toEqual({ portableId: "id2" });
    const allocationCalls = ids.calls.length;

    const resumed = await coordinator.resumePrepare("id1", request);

    expect(resumed.journal.state).toBe("staged");
    expect(resumed.allocations).toEqual({ portableId: "id2" });
    expect(ids.calls).toHaveLength(allocationCalls);
    await coordinator.commit("id1");
    expect(storage.resourceText("new.json")).toBe("new");
  });

  it("rolls back completed writes when an interrupted remaining step is non-idempotent", async () => {
    const { coordinator, storage } = harness();
    storage.seed("first.json", "old first");
    storage.seed("second.json", "old second");
    const prepared = await coordinator.prepare({
      sourceDigest: SOURCE,
      mutations: [
        {
          id: "first",
          resourceKey: "first.json",
          operation: "put",
          expectedOldHash: digest("old first"),
          expectedNewHash: digest("new first"),
          newBytes: bytes("new first"),
          idempotent: true,
        },
        {
          id: "second",
          resourceKey: "second.json",
          operation: "put",
          expectedOldHash: digest("old second"),
          expectedNewHash: digest("new second"),
          newBytes: bytes("new second"),
          idempotent: false,
        },
      ],
    });
    await storage.writeResource("first.json", bytes("new first"), digest("old first"));
    storage.setJournal({
      ...prepared.journal,
      state: "committing",
      visibleCommitStarted: true,
      completedSteps: [...prepared.journal.completedSteps, "commit:first"],
    });

    const result = await coordinator.recoverStartup();

    expect(result).toMatchObject({ mode: "readWrite" });
    expect(result.actions).toEqual([
      { transactionId: prepared.transactionId, action: "rolledBack" },
    ]);
    expect(storage.resourceText("first.json")).toBe("old first");
    expect(storage.resourceText("second.json")).toBe("old second");
  });

  it("opens read-only on contradictory visible bytes and never removes them", async () => {
    const { coordinator, storage } = harness();
    const prepared = await coordinator.prepare(putRequest("new.json", null, "owned"));
    storage.setJournal({
      ...prepared.journal,
      state: "committing",
      visibleCommitStarted: true,
    });
    storage.seed("new.json", "somebody else's bytes");

    const result = await coordinator.recoverStartup();

    expect(result.mode).toBe("readOnly");
    expect(result.problems[0]?.message).toContain("cannot prove ownership");
    expect(storage.resourceText("new.json")).toBe("somebody else's bytes");
    expect(storage.journals.has(prepared.transactionId)).toBe(true);
  });

  it("opens read-only when staged payload bytes disagree with the journal", async () => {
    const { coordinator, storage } = harness();
    const prepared = await coordinator.prepare(putRequest("new.json", null, "owned"));
    storage.corruptPayload(
      prepared.transactionId,
      "new-document",
      "corrupt",
      digest("owned"),
    );

    const result = await coordinator.recoverStartup();

    expect(result.mode).toBe("readOnly");
    expect(result.problems[0]?.message).toContain("bytes disagree");
    expect(storage.payloads.size).toBe(1);
  });

  it("supports verified deletes", async () => {
    const { coordinator, storage } = harness();
    storage.seed("obsolete.json", "old");
    const prepared = await coordinator.prepare({
      sourceDigest: SOURCE,
      mutations: [{
        id: "obsolete",
        resourceKey: "obsolete.json",
        operation: "delete",
        expectedOldHash: digest("old"),
        expectedNewHash: null,
        idempotent: true,
      }],
    });

    await coordinator.commit(prepared.transactionId);

    expect(storage.resourceText("obsolete.json")).toBeUndefined();
    expect(storage.journals.size).toBe(0);
  });

  it("deterministically resumes committed, rollingBack, and rolledBack journals", async () => {
    const { coordinator, storage } = harness();
    storage.seed("committed.json", "old committed");
    const committed = await coordinator.prepare(
      putRequest("committed.json", "old committed", "new committed"),
    );
    await storage.writeResource(
      "committed.json",
      bytes("new committed"),
      digest("old committed"),
    );
    storage.setJournal({
      ...committed.journal,
      state: "committed",
      visibleCommitStarted: true,
      completedSteps: [...committed.journal.completedSteps, "commit:document"],
    });

    const rollingBack = await coordinator.prepare(
      putRequest("rolling.json", null, "transaction residue"),
    );
    await storage.writeResource("rolling.json", bytes("transaction residue"), null);
    storage.setJournal({
      ...rollingBack.journal,
      state: "rollingBack",
      visibleCommitStarted: true,
      completedSteps: [...rollingBack.journal.completedSteps, "commit:document"],
    });

    storage.seed("rolled.json", "old rolled");
    const rolledBack = await coordinator.prepare(
      putRequest("rolled.json", "old rolled", "unused new"),
    );
    storage.setJournal({
      ...rolledBack.journal,
      state: "rolledBack",
      completedSteps: [...rolledBack.journal.completedSteps, "rollback:document"],
    });

    const result = await coordinator.recoverStartup();

    expect(result).toEqual({
      mode: "readWrite",
      actions: [
        { transactionId: committed.transactionId, action: "cleaned" },
        { transactionId: rollingBack.transactionId, action: "rolledBack" },
        { transactionId: rolledBack.transactionId, action: "cleaned" },
      ],
      problems: [],
    });
    expect(storage.resourceText("committed.json")).toBe("new committed");
    expect(storage.resourceText("rolling.json")).toBeUndefined();
    expect(storage.resourceText("rolled.json")).toBe("old rolled");
    expect(storage.journals.size).toBe(0);
    expect(storage.payloads.size).toBe(0);
  });

  it("opens read-only when a completed-step marker contradicts visible bytes", async () => {
    const { coordinator, storage } = harness();
    storage.seed("resource.json", "old");
    const prepared = await coordinator.prepare(putRequest("resource.json"));
    storage.setJournal({
      ...prepared.journal,
      state: "committing",
      visibleCommitStarted: true,
      completedSteps: [...prepared.journal.completedSteps, "commit:document"],
    });

    const result = await coordinator.recoverStartup();

    expect(result.mode).toBe("readOnly");
    expect(result.problems[0]?.message).toContain("disagrees with visible bytes");
    expect(storage.resourceText("resource.json")).toBe("old");
  });

  it("quarantines failed journals only with verified complete rollback", async () => {
    const proven = harness();
    proven.storage.seed("resource.json", "old");
    const prepared = await proven.coordinator.prepare(putRequest("resource.json"));
    proven.storage.setJournal({
      ...prepared.journal,
      state: "failed",
      failure: { message: "diagnostic evidence", rollbackVerified: true },
    });

    const result = await proven.coordinator.recoverStartup();
    expect(result.mode).toBe("readWrite");
    expect(proven.storage.quarantined).toHaveLength(1);
    expect(proven.storage.quarantined[0]?.reason).toBe("diagnostic evidence");
    expect(proven.storage.journals.size).toBe(0);

    const ambiguous = harness();
    ambiguous.storage.seed("resource.json", "old");
    const ambiguousPrepared = await ambiguous.coordinator.prepare(putRequest("resource.json"));
    ambiguous.storage.setJournal({
      ...ambiguousPrepared.journal,
      state: "failed",
      failure: { message: "unknown rollback", rollbackVerified: false },
    });
    const blocked = await ambiguous.coordinator.recoverStartup();
    expect(blocked.mode).toBe("readOnly");
    expect(ambiguous.storage.quarantined).toEqual([]);
  });

  it("opens read-only for unknown states before mutating any transaction", async () => {
    const { coordinator, storage } = harness();
    storage.journals.set("id1", {
      journalVersion: 1,
      transactionId: "id1",
      state: "futureState",
    });

    const result = await coordinator.recoverStartup();

    expect(result.mode).toBe("readOnly");
    expect(result.actions).toEqual([]);
    expect(result.problems[0]?.message).toContain("Unknown transaction state");
    expect(storage.journals.has("id1")).toBe(true);
  });

  it("refuses cleanup of unrecognized transaction residue", async () => {
    const { coordinator, storage } = harness();
    const prepared = await coordinator.prepare(putRequest("new.json", null, "owned"));
    await storage.writeTransactionPayload(
      prepared.transactionId,
      "unrecorded-residue",
      bytes("not in journal"),
    );

    const result = await coordinator.recoverStartup();

    expect(result.mode).toBe("readOnly");
    expect(result.problems[0]?.message).toContain("unverified transaction residue");
    expect(storage.payloads.size).toBeGreaterThan(0);
  });
});
