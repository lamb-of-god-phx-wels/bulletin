import {
  canonicalJsonBytes,
  hashBytes,
  type IdPort,
  type SchemaCatalog,
} from "@cbb/core";
import { basename, dirname, resolve } from "node:path";
import type { DurableFileSystemPort } from "../ports/index.js";
import { decodeCanonicalJson } from "../ports/index.js";
import {
  MULTI_TRANSACTION_JOURNAL_DIRECTORY,
  MULTI_TRANSACTION_PAYLOAD_DIRECTORY,
  TRANSACTION_QUARANTINE_DIRECTORY,
  assertManagedPathHasNoSymlink,
  assertSafeRelativePath,
  resolveWorkspacePath,
  withWorkspaceMutation,
} from "../workspace/index.js";
import type {
  DurableBlob,
  TransactionDigest,
  TransactionJournal,
  TransactionPayload,
  TransactionStoragePort,
} from "./types.js";

export const TRANSACTION_JOURNAL_SCHEMA_ID =
  "https://church-bulletin-builder.local/schema/v1/transaction-journal.schema.json";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const MAX_DURABLE_BLOB_BYTES = 1024 * 1024 * 1024;

export interface TransactionResourcePathPort {
  /** Resolve an app-owned opaque resource key to a workspace-relative path. */
  resolve(resourceKey: string): string | undefined;
}

export interface NodeWorkspaceTransactionStorageOptions {
  readonly workspaceRoot: string;
  readonly fileSystem: DurableFileSystemPort;
  readonly ids: IdPort;
  readonly catalog: SchemaCatalog;
  readonly resources: TransactionResourcePathPort;
}

function safeId(value: string, label: string): string {
  if (!SAFE_ID.test(value) || value.length > 256) {
    throw new TypeError(`${label} is not a safe transaction identifier`);
  }
  return value;
}

function digest(bytes: Uint8Array): TransactionDigest {
  return hashBytes(bytes) as TransactionDigest;
}

function decodeJson(bytes: Uint8Array): unknown {
  if (bytes.byteLength > 100 * 1024 * 1024) {
    throw new RangeError("Transaction journal exceeds the workspace metadata cap");
  }
  return decodeCanonicalJson(bytes);
}

export class NodeWorkspaceTransactionStorage implements TransactionStoragePort {
  private readonly root: string;
  private readonly fileSystem: DurableFileSystemPort;
  private readonly ids: IdPort;
  private readonly catalog: SchemaCatalog;
  private readonly resources: TransactionResourcePathPort;

  constructor(options: NodeWorkspaceTransactionStorageOptions) {
    this.root = resolve(options.workspaceRoot);
    this.fileSystem = options.fileSystem;
    this.ids = options.ids;
    this.catalog = options.catalog;
    this.resources = options.resources;
  }

  private journalRelative(transactionId: string): string {
    return `${MULTI_TRANSACTION_JOURNAL_DIRECTORY}/${safeId(transactionId, "transactionId")}.json`;
  }

  private payloadDirectory(transactionId: string): string {
    return `${MULTI_TRANSACTION_PAYLOAD_DIRECTORY}/${safeId(transactionId, "transactionId")}`;
  }

  private payloadRelative(transactionId: string, payloadId: string): string {
    return `${this.payloadDirectory(transactionId)}/${safeId(payloadId, "payloadId")}.bin`;
  }

  private resourceRelative(resourceKey: string): string {
    const relative = this.resources.resolve(resourceKey);
    if (relative === undefined) throw new TypeError("Unknown transaction resource key");
    return assertSafeRelativePath(relative);
  }

  private async readRelative(relative: string): Promise<Uint8Array | undefined> {
    await assertManagedPathHasNoSymlink(this.fileSystem, this.root, relative);
    const path = resolveWorkspacePath(this.root, relative);
    const info = await this.fileSystem.entryInfo(path);
    if (info === undefined) return undefined;
    if (info.kind !== "file" || info.size > MAX_DURABLE_BLOB_BYTES) {
      throw new TypeError("Durable transaction entry is not a bounded regular file");
    }
    const bytes = await this.fileSystem.readFileNoFollow(path, MAX_DURABLE_BLOB_BYTES);
    if (bytes.byteLength !== info.size || bytes.byteLength > MAX_DURABLE_BLOB_BYTES) {
      throw new TypeError("Durable transaction entry changed while reading");
    }
    return new Uint8Array(bytes);
  }

  private async atomicWrite(relative: string, bytes: Uint8Array): Promise<void> {
    if (bytes.byteLength > MAX_DURABLE_BLOB_BYTES) {
      throw new RangeError("Transaction write exceeds the durable blob cap");
    }
    await assertManagedPathHasNoSymlink(this.fileSystem, this.root, relative);
    const path = resolveWorkspacePath(this.root, relative);
    const directory = dirname(path);
    await this.fileSystem.makeDirectory(directory);
    const relativeDirectory = dirname(relative);
    if (relativeDirectory !== ".") {
      await assertManagedPathHasNoSymlink(
        this.fileSystem,
        this.root,
        assertSafeRelativePath(relativeDirectory),
      );
    }
    const temporaryId = safeId(this.ids.randomUuid(), "temporary id");
    const temporaryRelative = relativeDirectory === "."
      ? `.${basename(relative)}.${temporaryId}.tmp`
      : `${relativeDirectory}/.${basename(relative)}.${temporaryId}.tmp`;
    const temporary = resolveWorkspacePath(
      this.root,
      temporaryRelative,
    );
    await this.fileSystem.writeFileExclusive(temporary, bytes);
    try {
      await this.fileSystem.replaceFile(temporary, path);
      await this.fileSystem.syncDirectory(directory);
    } catch (error) {
      await this.fileSystem.removeFile(temporary).catch(() => undefined);
      throw error;
    }
  }

  async listJournalIds(): Promise<readonly string[]> {
    const directory = resolveWorkspacePath(this.root, MULTI_TRANSACTION_JOURNAL_DIRECTORY);
    const names = await this.fileSystem.readDirectory(directory);
    return names.map((name) => {
      const match = /^([A-Za-z0-9][A-Za-z0-9_-]*)\.json$/.exec(name);
      if (match?.[1] === undefined) {
        throw new TypeError("Transaction journal directory contains unrecognized residue");
      }
      return safeId(match[1], "journal id");
    }).sort();
  }

  async readJournal(transactionId: string): Promise<unknown | undefined> {
    const bytes = await this.readRelative(this.journalRelative(transactionId));
    if (bytes === undefined) return undefined;
    const value = decodeJson(bytes);
    const validation = this.catalog.validateAgainst(TRANSACTION_JOURNAL_SCHEMA_ID, value);
    if (!validation.valid) throw new TypeError("Transaction journal fails schema validation");
    return value;
  }

  async writeJournal(journal: TransactionJournal): Promise<void> {
    const validation = this.catalog.validateAgainst(TRANSACTION_JOURNAL_SCHEMA_ID, journal);
    if (!validation.valid) throw new TypeError("Transaction journal fails schema validation");
    await this.atomicWrite(this.journalRelative(journal.transactionId), canonicalJsonBytes(journal));
  }

  async deleteJournal(
    transactionId: string,
    expected: TransactionJournal,
  ): Promise<boolean> {
    const relative = this.journalRelative(transactionId);
    await assertManagedPathHasNoSymlink(this.fileSystem, this.root, relative);
    const current = await this.readRelative(relative);
    const expectedBytes = canonicalJsonBytes(expected);
    if (current === undefined || digest(current) !== digest(expectedBytes)) return false;
    const path = resolveWorkspacePath(this.root, relative);
    const cleanupId = safeId(this.ids.randomUuid(), "journal cleanup id");
    const movedRelative = `${MULTI_TRANSACTION_JOURNAL_DIRECTORY}/.${safeId(transactionId, "transactionId")}.cleanup-${cleanupId}`;
    const moved = resolveWorkspacePath(this.root, movedRelative);
    if (!await this.fileSystem.moveFileNoReplace(path, moved)) return false;
    await this.fileSystem.syncDirectory(
      resolveWorkspacePath(this.root, MULTI_TRANSACTION_JOURNAL_DIRECTORY),
    );
    const movedBytes = await this.fileSystem.readFileNoFollow(moved, MAX_DURABLE_BLOB_BYTES);
    if (digest(movedBytes) !== digest(expectedBytes)) {
      await this.fileSystem.moveFileNoReplace(moved, path).catch(() => false);
      await this.fileSystem.syncDirectory(dirname(path));
      return false;
    }
    await this.fileSystem.removeFile(moved);
    await this.fileSystem.syncDirectory(dirname(path));
    return true;
  }

  async quarantineJournal(
    transactionId: string,
    journal: TransactionJournal,
    reason: string,
  ): Promise<void> {
    if (reason.length === 0 || reason.length > 2048) {
      throw new TypeError("Quarantine reason must be bounded");
    }
    const relative = `${TRANSACTION_QUARANTINE_DIRECTORY}/${safeId(transactionId, "transactionId")}.json`;
    const existing = await this.readRelative(relative);
    if (existing !== undefined) throw new TypeError("Transaction quarantine record already exists");
    await this.atomicWrite(relative, canonicalJsonBytes({
      version: 1,
      kind: "quarantinedTransaction",
      transactionId,
      reason,
      journal,
    }));
  }

  async readResource(resourceKey: string): Promise<DurableBlob | undefined> {
    const bytes = await this.readRelative(this.resourceRelative(resourceKey));
    return bytes === undefined ? undefined : { bytes, hash: digest(bytes) };
  }

  async writeResource(
    resourceKey: string,
    bytes: Uint8Array,
    expectedCurrentHash: TransactionDigest | null,
  ): Promise<boolean> {
    return withWorkspaceMutation(this.root, async () => {
      const relative = this.resourceRelative(resourceKey);
      const current = await this.readRelative(relative);
      if ((current === undefined ? null : digest(current)) !== expectedCurrentHash) return false;
      await this.atomicWrite(relative, new Uint8Array(bytes));
      return true;
    });
  }

  async deleteResource(
    resourceKey: string,
    expectedCurrentHash: TransactionDigest,
  ): Promise<boolean> {
    return withWorkspaceMutation(this.root, async () => {
      const relative = this.resourceRelative(resourceKey);
      const current = await this.readRelative(relative);
      if (current === undefined || digest(current) !== expectedCurrentHash) return false;
      const path = resolveWorkspacePath(this.root, relative);
      await this.fileSystem.removeFile(path);
      await this.fileSystem.syncDirectory(dirname(path));
      return true;
    });
  }

  async writeTransactionPayload(
    transactionId: string,
    payloadId: string,
    bytes: Uint8Array,
  ): Promise<void> {
    const relative = this.payloadRelative(transactionId, payloadId);
    if (await this.readRelative(relative) !== undefined) {
      throw new TypeError("Transaction payload already exists");
    }
    await this.atomicWrite(relative, new Uint8Array(bytes));
  }

  async readTransactionPayload(
    transactionId: string,
    payloadId: string,
  ): Promise<TransactionPayload | undefined> {
    const bytes = await this.readRelative(this.payloadRelative(transactionId, payloadId));
    return bytes === undefined
      ? undefined
      : { transactionId, payloadId, bytes, hash: digest(bytes) };
  }

  async listTransactionPayloads(
    transactionId: string,
  ): Promise<readonly TransactionPayload[]> {
    const relativeDirectory = this.payloadDirectory(transactionId);
    await assertManagedPathHasNoSymlink(this.fileSystem, this.root, relativeDirectory);
    const directory = resolveWorkspacePath(this.root, relativeDirectory);
    const names = await this.fileSystem.readDirectory(directory);
    const payloads: TransactionPayload[] = [];
    for (const name of [...names].sort()) {
      const match = /^([A-Za-z0-9][A-Za-z0-9_-]*)\.bin$/.exec(name);
      if (match?.[1] === undefined) {
        throw new TypeError("Transaction payload directory contains unrecognized residue");
      }
      const payload = await this.readTransactionPayload(transactionId, match[1]);
      if (payload === undefined) throw new TypeError("Listed transaction payload disappeared");
      payloads.push(payload);
    }
    return payloads;
  }

  async deleteTransactionPayload(
    transactionId: string,
    payloadId: string,
    expectedHash: TransactionDigest,
  ): Promise<boolean> {
    const relative = this.payloadRelative(transactionId, payloadId);
    const bytes = await this.readRelative(relative);
    if (bytes === undefined || digest(bytes) !== expectedHash) return false;
    const path = resolveWorkspacePath(this.root, relative);
    await this.fileSystem.removeFile(path);
    await this.fileSystem.syncDirectory(dirname(path));
    return true;
  }
}
