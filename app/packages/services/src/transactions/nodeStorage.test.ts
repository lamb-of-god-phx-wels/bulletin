import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createSchemaCatalog,
  hashBytes,
  type IdPort,
  type SchemaObject,
} from "@cbb/core";
import { createNodeFileSystemPort } from "../ports/index.js";
import {
  MULTI_TRANSACTION_JOURNAL_DIRECTORY,
  MULTI_TRANSACTION_PAYLOAD_DIRECTORY,
  TRANSACTION_QUARANTINE_DIRECTORY,
} from "../workspace/index.js";
import { NodeWorkspaceTransactionStorage } from "./nodeStorage.js";
import type { TransactionDigest, TransactionJournal } from "./types.js";

function catalog() {
  const directory = resolve(process.cwd(), "schemas/v1");
  const schemas = new Map<string, SchemaObject>();
  for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".json"))) {
    const schema = JSON.parse(readFileSync(join(directory, name), "utf8")) as SchemaObject;
    schemas.set(schema.$id, schema);
  }
  return createSchemaCatalog(schemas);
}

function ids(): IdPort {
  let value = 1;
  return {
    randomUuid() {
      return `00000000-0000-4000-8000-${(value++).toString(16).padStart(12, "0")}`;
    },
  };
}

const bytes = (value: string) => new TextEncoder().encode(value);
const digest = (value: Uint8Array) => hashBytes(value) as TransactionDigest;

function journal(hash: TransactionDigest): TransactionJournal {
  return {
    journalVersion: 1,
    transactionId: "tx_1",
    state: "planned",
    sourceDigest: hash,
    createdAt: "2026-07-12T12:00:00.000Z",
    updatedAt: "2026-07-12T12:00:00.000Z",
    allocations: { asset: "opaque-allocation" },
    steps: [
      {
        id: "put_resource",
        order: 0,
        resourceKey: "resource",
        operation: "put",
        expectedOldHash: null,
        expectedNewHash: hash,
        idempotent: true,
        commitMarker: true,
        newPayloadId: "new-put_resource",
      },
    ],
    completedSteps: [],
    visibleCommitStarted: false,
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "cbb-transaction-storage-"));
  await Promise.all([
    mkdir(join(root, MULTI_TRANSACTION_JOURNAL_DIRECTORY), { recursive: true }),
    mkdir(join(root, MULTI_TRANSACTION_PAYLOAD_DIRECTORY), { recursive: true }),
    mkdir(join(root, TRANSACTION_QUARANTINE_DIRECTORY), { recursive: true }),
    mkdir(join(root, "data"), { recursive: true }),
  ]);
  const storage = new NodeWorkspaceTransactionStorage({
    workspaceRoot: root,
    fileSystem: createNodeFileSystemPort(),
    ids: ids(),
    catalog: catalog(),
    resources: {
      resolve(key) {
        return key === "resource" ? "data/resource.bin" : undefined;
      },
    },
  });
  return { root, storage };
}

describe("Node workspace transaction storage", () => {
  it("persists schema-valid journals and rejects unknown residue", async () => {
    const { root, storage } = await fixture();
    const hash = digest(bytes("new"));
    await storage.writeJournal(journal(hash));
    expect(await storage.listJournalIds()).toEqual(["tx_1"]);
    expect(await storage.readJournal("tx_1")).toEqual(journal(hash));
    await writeFile(join(root, MULTI_TRANSACTION_JOURNAL_DIRECTORY, "unexpected.tmp"), "x");
    await expect(storage.listJournalIds()).rejects.toThrow(/unrecognized residue/);
  });

  it("implements durable compare-and-swap resource updates", async () => {
    const { storage } = await fixture();
    const first = bytes("first");
    const second = bytes("second");
    expect(await storage.writeResource("resource", first, null)).toBe(true);
    expect(await storage.writeResource("resource", second, null)).toBe(false);
    expect(await storage.writeResource("resource", second, digest(first))).toBe(true);
    expect(await storage.readResource("resource")).toEqual({
      bytes: second,
      hash: digest(second),
    });
    expect(await storage.deleteResource("resource", digest(first))).toBe(false);
    expect(await storage.deleteResource("resource", digest(second))).toBe(true);
  });

  it("serializes compare-and-swap across independent storage instances", async () => {
    const { root, storage } = await fixture();
    const competing = new NodeWorkspaceTransactionStorage({
      workspaceRoot: `${root}/.`,
      fileSystem: createNodeFileSystemPort(),
      ids: ids(),
      catalog: catalog(),
      resources: {
        resolve(key) {
          return key === "resource" ? "data/resource.bin" : undefined;
        },
      },
    });
    const outcomes = await Promise.all([
      storage.writeResource("resource", bytes("first"), null),
      competing.writeResource("resource", bytes("second"), null),
    ]);
    expect([...outcomes].sort()).toEqual([false, true]);
    const durable = await storage.readResource("resource");
    expect([digest(bytes("first")), digest(bytes("second"))]).toContain(durable?.hash);
  });

  it("persists transaction-owned payloads and deletes only matching bytes", async () => {
    const { storage } = await fixture();
    const value = bytes("payload");
    await storage.writeTransactionPayload("tx_1", "new_step", value);
    expect(await storage.listTransactionPayloads("tx_1")).toEqual([
      {
        transactionId: "tx_1",
        payloadId: "new_step",
        bytes: value,
        hash: digest(value),
      },
    ]);
    expect(
      await storage.deleteTransactionPayload("tx_1", "new_step", digest(bytes("other"))),
    ).toBe(false);
    expect(await storage.deleteTransactionPayload("tx_1", "new_step", digest(value))).toBe(true);
  });

  it("quarantines a failed journal without overwriting prior evidence", async () => {
    const { storage } = await fixture();
    const record = journal(digest(bytes("new")));
    await storage.quarantineJournal("tx_1", record, "verified rollback");
    await expect(
      storage.quarantineJournal("tx_1", record, "second attempt"),
    ).rejects.toThrow(/already exists/);
  });

  it("rejects symlinked resource paths and unknown resource keys", async () => {
    const { root, storage } = await fixture();
    await writeFile(join(root, "outside.bin"), "secret");
    await symlink(join(root, "outside.bin"), join(root, "data", "resource.bin"));
    await expect(storage.readResource("resource")).rejects.toThrow(/symbolic link/);
    await expect(storage.readResource("../../outside")).rejects.toThrow(/Unknown/);
  });
});
