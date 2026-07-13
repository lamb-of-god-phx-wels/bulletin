import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  unlink,
} from "node:fs/promises";
import {
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  canonicalJsonBytes,
  canonicalStringify,
  hashBytes,
  isCanonicalUuid,
  type IdPort,
  type SchemaCatalog,
  type Sha256Hash,
} from "@cbb/core";
import type { BuildOutputHandle } from "../build/runner.js";
import { decodeCanonicalJson } from "../ports/index.js";
import { serviceDiagnostic } from "../workspace/diagnostics.js";
import { ARTIFACT_INSTALL_JOURNAL_DIRECTORY } from "../workspace/paths.js";
import type {
  StartupRecoveryPort,
  StartupRecoveryResult,
  WorkspaceRegistry,
} from "../workspace/types.js";
import type {
  ArtifactInstallJournal,
  ArtifactInstallJournalPort,
  ArtifactPdfValidatorPort,
  ArtifactRecord,
  ArtifactRecordLocator,
  ArtifactRecordValidatorPort,
  ArtifactStoragePort,
  CompileOutputReaderPort,
  ObservedPdfIdentity,
  ArtifactOwnedByteLocator,
} from "./types.js";

export const ARTIFACT_RECORD_SCHEMA_ID =
  "https://church-bulletin-builder.local/schema/v1/artifact-record.schema.json";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const PDF_VERSION = /^(?:1\.[0-7]|2\.0)$/u;
const SAFE_STANDARD = /^[\x21-\x7e]{1,128}$/u;
const OUTPUT_HANDLE = /^artifact-output:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_RECORD_BYTES = 16 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 1024 * 1024 * 1024;
const MAX_PDF_PAGES = 1_000;
const MAX_PDF_STANDARDS = 32;
const MAX_OUTPUT_HANDLES = 4_096;
const MAX_INSTALL_JOURNALS = 200_000;
const MAX_INSTALL_JOURNAL_BYTES = 32 * 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;
const INSTALL_JOURNAL_NAME = /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/u;

export type NodeArtifactAdapterFailureKind =
  | "storageBoundaryRejected"
  | "compileOutputRejected"
  | "pdfValidationRejected";

/** Fixed, path-free failure surfaced by every hostile Node boundary. */
export class NodeArtifactAdapterError extends Error {
  public readonly code = "CBB-SECURITY-0001" as const;

  public constructor(public readonly kind: NodeArtifactAdapterFailureKind) {
    super(
      kind === "storageBoundaryRejected"
        ? "Artifact storage boundary rejected an unsafe or inconsistent entry."
        : kind === "compileOutputRejected"
          ? "Compile output boundary rejected an unknown or inconsistent handle."
          : "PDF validation boundary rejected inconsistent output evidence.",
    );
    this.name = "NodeArtifactAdapterError";
  }
}

function storageFailure(): NodeArtifactAdapterError {
  return new NodeArtifactAdapterError("storageBoundaryRejected");
}

function outputFailure(): NodeArtifactAdapterError {
  return new NodeArtifactAdapterError("compileOutputRejected");
}

function pdfFailure(): NodeArtifactAdapterError {
  return new NodeArtifactAdapterError("pdfValidationRejected");
}

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { readonly code?: unknown }).code
    : undefined;
}

function isMissing(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}

function isAlreadyExists(error: unknown): boolean {
  return errorCode(error) === "EEXIST";
}

interface FileIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
}

interface StableFile {
  readonly bytes: Uint8Array;
  readonly identity: FileIdentity;
}

function sameNode(
  left: Pick<FileIdentity, "dev" | "ino">,
  right: Pick<FileIdentity, "dev" | "ino">,
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameSnapshot(left: FileIdentity, right: FileIdentity): boolean {
  return sameNode(left, right) &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs;
}

function toIdentity(stats: {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
}): FileIdentity {
  return {
    dev: stats.dev,
    ino: stats.ino,
    size: stats.size,
    mtimeNs: stats.mtimeNs,
    ctimeNs: stats.ctimeNs,
  };
}

function isStrictDescendant(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child.length > 0 &&
    child !== ".." &&
    !child.startsWith(`..${sep}`) &&
    !isAbsolute(child);
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] as number) ^ (right[index] as number);
  }
  return difference === 0;
}

function validateUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_V4.test(value);
}

function validateRecordLocator(locator: ArtifactRecordLocator): void {
  if (
    locator === null ||
    typeof locator !== "object" ||
    locator.kind !== "artifactRecord" ||
    !validateUuid(locator.bulletinLocalId) ||
    !validateUuid(locator.buildId) ||
    Reflect.ownKeys(locator).some((key) =>
      !["kind", "bulletinLocalId", "buildId"].includes(String(key)),
    )
  ) throw storageFailure();
}

function validateByteLocator(locator: ArtifactOwnedByteLocator): void {
  if (
    locator === null ||
    typeof locator !== "object" ||
    locator.kind !== "artifactOwnedByte" ||
    !validateUuid(locator.bulletinLocalId) ||
    !validateUuid(locator.buildId) ||
    (locator.extension !== "typ" && locator.extension !== "pdf") ||
    Reflect.ownKeys(locator).some((key) =>
      !["kind", "bulletinLocalId", "buildId", "extension"].includes(String(key)),
    )
  ) throw storageFailure();
}

class FixedRoot {
  private constructor(
    public readonly path: string,
    private readonly identity: Pick<FileIdentity, "dev" | "ino">,
  ) {}

  public static async create(configuredRoot: string): Promise<FixedRoot> {
    if (
      typeof configuredRoot !== "string" ||
      configuredRoot.length === 0 ||
      typeof constants.O_NOFOLLOW !== "number" ||
      constants.O_NOFOLLOW === 0 ||
      typeof constants.O_DIRECTORY !== "number"
    ) throw storageFailure();
    const configured = resolve(configuredRoot);
    const configuredStats = await lstat(configured, { bigint: true });
    if (configuredStats.isSymbolicLink() || !configuredStats.isDirectory()) {
      throw storageFailure();
    }
    const canonical = await realpath(configured);
    if (canonical !== configured) throw storageFailure();
    const stats = await lstat(canonical, { bigint: true });
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw storageFailure();
    return new FixedRoot(canonical, { dev: stats.dev, ino: stats.ino });
  }

  public async assertCurrent(): Promise<void> {
    const stats = await lstat(this.path, { bigint: true });
    if (
      stats.isSymbolicLink() ||
      !stats.isDirectory() ||
      !sameNode(this.identity, stats)
    ) throw storageFailure();
  }

  public resolve(...segments: readonly string[]): string {
    const candidate = resolve(this.path, ...segments);
    if (!isStrictDescendant(this.path, candidate)) throw storageFailure();
    return candidate;
  }

  /** Return false only for an absent chain. Any non-directory residue is hostile. */
  public async assertDirectoryChain(segments: readonly string[]): Promise<boolean> {
    await this.assertCurrent();
    let current = this.path;
    for (const segment of segments) {
      current = join(current, segment);
      let stats;
      try {
        stats = await lstat(current, { bigint: true });
      } catch (error) {
        if (isMissing(error)) return false;
        throw error;
      }
      if (stats.isSymbolicLink() || !stats.isDirectory()) throw storageFailure();
      if (await realpath(current) !== current) throw storageFailure();
    }
    return true;
  }

  public async ensureDirectoryChain(segments: readonly string[]): Promise<void> {
    await this.assertCurrent();
    let current = this.path;
    for (const segment of segments) {
      const parent = current;
      current = join(current, segment);
      let created = false;
      try {
        await mkdir(current, { mode: 0o700 });
        created = true;
      } catch (error) {
        if (!isAlreadyExists(error)) throw error;
      }
      const stats = await lstat(current, { bigint: true });
      if (stats.isSymbolicLink() || !stats.isDirectory()) throw storageFailure();
      if (await realpath(current) !== current) throw storageFailure();
      if (created) await syncDirectory(parent);
    }
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const stats = await handle.stat({ bigint: true });
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw storageFailure();
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function assertSafeExistingFile(path: string, maximumBytes: number): Promise<void> {
  const stats = await lstat(path, { bigint: true });
  if (
    stats.isSymbolicLink() ||
    !stats.isFile() ||
    stats.nlink !== 1n ||
    stats.size < 0n ||
    stats.size > BigInt(maximumBytes)
  ) throw storageFailure();
}

async function readStableFile(
  path: string,
  maximumBytes: number,
): Promise<StableFile | undefined> {
  let before;
  try {
    before = await lstat(path, { bigint: true });
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
  if (
    before.isSymbolicLink() ||
    !before.isFile() ||
    before.nlink !== 1n ||
    before.size < 0n ||
    before.size > BigInt(maximumBytes)
  ) throw storageFailure();
  const beforeIdentity = toIdentity(before);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    const openedIdentity = toIdentity(opened);
    if (
      !opened.isFile() ||
      opened.isSymbolicLink() ||
      opened.nlink !== 1n ||
      !sameSnapshot(beforeIdentity, openedIdentity)
    ) throw storageFailure();

    const chunks: Buffer[] = [];
    let total = 0;
    let position = 0;
    while (true) {
      const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, position);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maximumBytes || total > Number(opened.size)) throw storageFailure();
      chunks.push(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const afterIdentity = toIdentity(after);
    const namedAfter = await lstat(path, { bigint: true });
    if (
      total !== Number(opened.size) ||
      after.nlink !== 1n ||
      !sameSnapshot(openedIdentity, afterIdentity) ||
      namedAfter.isSymbolicLink() ||
      !namedAfter.isFile() ||
      namedAfter.nlink !== 1n ||
      !sameSnapshot(afterIdentity, toIdentity(namedAfter))
    ) throw storageFailure();
    return {
      bytes: new Uint8Array(Buffer.concat(chunks, total)),
      identity: afterIdentity,
    };
  } finally {
    await handle.close();
  }
}

async function removeExactFile(
  path: string,
  parent: string,
  identity: FileIdentity,
): Promise<boolean> {
  let current;
  try {
    current = await lstat(path, { bigint: true });
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
  if (
    current.isSymbolicLink() ||
    !current.isFile() ||
    current.nlink !== 1n ||
    !sameSnapshot(identity, toIdentity(current))
  ) return false;
  await unlink(path);
  await syncDirectory(parent);
  return true;
}

async function durableCreateExclusive(
  path: string,
  parent: string,
  bytes: Uint8Array,
  maximumBytes: number,
): Promise<boolean> {
  if (bytes.byteLength > maximumBytes) throw storageFailure();
  let handle;
  try {
    handle = await open(
      path,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    await assertSafeExistingFile(path, maximumBytes);
    return false;
  }

  let createdIdentity: FileIdentity | undefined;
  try {
    const created = await handle.stat({ bigint: true });
    if (!created.isFile() || created.nlink !== 1n || created.size !== 0n) {
      throw storageFailure();
    }
    createdIdentity = toIdentity(created);
    await handle.writeFile(bytes);
    await handle.sync();
    const written = await handle.stat({ bigint: true });
    if (
      !written.isFile() ||
      written.nlink !== 1n ||
      !sameNode(createdIdentity, written) ||
      written.size !== BigInt(bytes.byteLength)
    ) throw storageFailure();
    createdIdentity = toIdentity(written);
    await handle.close();
    handle = undefined;
    await syncDirectory(parent);
    return true;
  } catch (error) {
    if (handle !== undefined) await handle.close().catch(() => undefined);
    if (createdIdentity !== undefined) {
      await removeExactFile(path, parent, createdIdentity).catch(() => false);
    }
    throw error;
  }
}

function artifactSegments(
  locator: ArtifactRecordLocator | ArtifactOwnedByteLocator,
): readonly [string, string, string] {
  const extension = locator.kind === "artifactRecord" ? "json" : locator.extension;
  return ["artifacts", locator.bulletinLocalId, `${locator.buildId}.${extension}`];
}

function journalName(
  record: Pick<ArtifactRecord, "bulletinLocalId" | "buildId">,
): string {
  if (!validateUuid(record.bulletinLocalId) || !validateUuid(record.buildId)) {
    throw storageFailure();
  }
  return `${record.bulletinLocalId}-${record.buildId}.json`;
}

function journalSegments(
  record: Pick<ArtifactRecord, "bulletinLocalId" | "buildId">,
): readonly string[] {
  return [...ARTIFACT_INSTALL_JOURNAL_DIRECTORY.split("/"), journalName(record)];
}

function expectedOwnedBytes(record: ArtifactRecord): ReadonlyMap<"typ" | "pdf", Sha256Hash> {
  const expected = new Map<"typ" | "pdf", Sha256Hash>();
  const evidence = record.outputEvidence;
  if (record.status !== "succeeded" || evidence === undefined) return expected;
  if (evidence.mode === "compile") {
    expected.set("typ", evidence.typstHash);
    expected.set("pdf", evidence.pdf.hash);
  } else if (evidence.mode === "compose") {
    expected.set("pdf", evidence.pdf.hash);
  }
  return expected;
}

async function validateInstallJournal(
  value: unknown,
  records: ArtifactRecordValidatorPort,
): Promise<ArtifactInstallJournal> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw storageFailure();
  const raw = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(raw);
  if (
    keys.length !== 4 ||
    keys.some((key) => typeof key !== "string" || !["version", "kind", "record", "ownedBytes"].includes(key)) ||
    raw["version"] !== 1 ||
    raw["kind"] !== "artifactInstallJournal" ||
    !Array.isArray(raw["ownedBytes"]) ||
    raw["ownedBytes"].length > 2 ||
    !await records.validate(raw["record"])
  ) throw storageFailure();
  const record = raw["record"] as ArtifactRecord;
  validateRecordLocator({
    kind: "artifactRecord",
    bulletinLocalId: record.bulletinLocalId,
    buildId: record.buildId,
  });
  const expected = expectedOwnedBytes(record);
  const observed = new Map<"typ" | "pdf", { readonly hash: Sha256Hash; readonly byteSize: number }>();
  let previous = "";
  for (const item of raw["ownedBytes"] as unknown[]) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) throw storageFailure();
    const entry = item as Record<string, unknown>;
    if (
      Reflect.ownKeys(entry).length !== 3 ||
      Reflect.ownKeys(entry).some((key) => typeof key !== "string" || !["extension", "hash", "byteSize"].includes(key)) ||
      (entry["extension"] !== "typ" && entry["extension"] !== "pdf") ||
      entry["extension"] <= previous ||
      typeof entry["hash"] !== "string" ||
      !SHA256.test(entry["hash"]) ||
      !Number.isSafeInteger(entry["byteSize"]) ||
      (entry["byteSize"] as number) < 1 ||
      (entry["byteSize"] as number) > MAX_ARTIFACT_BYTES
    ) throw storageFailure();
    previous = entry["extension"];
    observed.set(entry["extension"], {
      hash: entry["hash"] as Sha256Hash,
      byteSize: entry["byteSize"] as number,
    });
  }
  if (
    observed.size !== expected.size ||
    [...expected].some(([extension, hash]) => observed.get(extension)?.hash !== hash)
  ) throw storageFailure();
  return value as ArtifactInstallJournal;
}

class NodeArtifactInstallJournalStorage implements ArtifactInstallJournalPort {
  public constructor(private readonly root: FixedRoot) {}

  public async begin(journal: ArtifactInstallJournal): Promise<void> {
    try {
      const bytes = canonicalJsonBytes(journal);
      if (bytes.byteLength > MAX_INSTALL_JOURNAL_BYTES) throw storageFailure();
      const segments = journalSegments(journal.record);
      await this.root.ensureDirectoryChain(segments.slice(0, -1));
      const created = await durableCreateExclusive(
        this.root.resolve(...segments),
        this.root.resolve(...segments.slice(0, -1)),
        bytes,
        MAX_INSTALL_JOURNAL_BYTES,
      );
      if (!created) throw storageFailure();
    } catch {
      throw storageFailure();
    }
  }

  public async finish(journal: ArtifactInstallJournal): Promise<void> {
    try {
      const expected = canonicalJsonBytes(journal);
      const segments = journalSegments(journal.record);
      if (!await this.root.assertDirectoryChain(segments.slice(0, -1))) return;
      const path = this.root.resolve(...segments);
      const observed = await readStableFile(path, MAX_INSTALL_JOURNAL_BYTES);
      if (observed === undefined) return;
      if (!equalBytes(observed.bytes, expected)) throw storageFailure();
      if (!await removeExactFile(
        path,
        this.root.resolve(...segments.slice(0, -1)),
        observed.identity,
      )) throw storageFailure();
    } catch {
      throw storageFailure();
    }
  }
}

class NodeArtifactStorage implements ArtifactStoragePort {
  public readonly installJournal: ArtifactInstallJournalPort;

  public constructor(private readonly root: FixedRoot) {
    this.installJournal = new NodeArtifactInstallJournalStorage(root);
  }

  private async read(
    locator: ArtifactRecordLocator | ArtifactOwnedByteLocator,
    maximumBytes: number,
  ): Promise<Uint8Array | undefined> {
    const segments = artifactSegments(locator);
    const directorySegments = segments.slice(0, -1);
    if (!await this.root.assertDirectoryChain(directorySegments)) return undefined;
    const observed = await readStableFile(this.root.resolve(...segments), maximumBytes);
    if (!await this.root.assertDirectoryChain(directorySegments)) throw storageFailure();
    return observed?.bytes;
  }

  private async install(
    locator: ArtifactRecordLocator | ArtifactOwnedByteLocator,
    bytes: Uint8Array,
    maximumBytes: number,
  ): Promise<boolean> {
    const segments = artifactSegments(locator);
    await this.root.ensureDirectoryChain(segments.slice(0, -1));
    const path = this.root.resolve(...segments);
    return durableCreateExclusive(path, this.root.resolve(...segments.slice(0, -1)), bytes, maximumBytes);
  }

  public async readRecord(locator: ArtifactRecordLocator): Promise<unknown | undefined> {
    try {
      validateRecordLocator(locator);
      const bytes = await this.read(locator, MAX_RECORD_BYTES);
      if (bytes === undefined) return undefined;
      return decodeCanonicalJson(bytes);
    } catch {
      throw storageFailure();
    }
  }

  public async installRecordExclusive(
    locator: ArtifactRecordLocator,
    record: ArtifactRecord,
  ): Promise<boolean> {
    try {
      validateRecordLocator(locator);
      const bytes = canonicalJsonBytes(record);
      return await this.install(locator, bytes, MAX_RECORD_BYTES);
    } catch {
      throw storageFailure();
    }
  }

  public async deleteRecordIfUnchanged(
    locator: ArtifactRecordLocator,
    record: ArtifactRecord,
  ): Promise<boolean> {
    try {
      validateRecordLocator(locator);
      const expected = canonicalJsonBytes(record);
      if (expected.byteLength > MAX_RECORD_BYTES) throw storageFailure();
      const segments = artifactSegments(locator);
      if (!await this.root.assertDirectoryChain(segments.slice(0, -1))) return false;
      const path = this.root.resolve(...segments);
      const observed = await readStableFile(path, MAX_RECORD_BYTES);
      if (
        observed === undefined ||
        hashBytes(observed.bytes) !== hashBytes(expected) ||
        !equalBytes(observed.bytes, expected)
      ) return false;
      if (!await this.root.assertDirectoryChain(segments.slice(0, -1))) throw storageFailure();
      return await removeExactFile(
        path,
        this.root.resolve(...segments.slice(0, -1)),
        observed.identity,
      );
    } catch {
      throw storageFailure();
    }
  }

  public async readOwnedByte(locator: ArtifactOwnedByteLocator): Promise<Uint8Array | undefined> {
    try {
      validateByteLocator(locator);
      return await this.read(locator, MAX_ARTIFACT_BYTES);
    } catch {
      throw storageFailure();
    }
  }

  public async installOwnedByteExclusive(
    locator: ArtifactOwnedByteLocator,
    bytes: Uint8Array,
  ): Promise<boolean> {
    try {
      validateByteLocator(locator);
      if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw storageFailure();
      return await this.install(locator, new Uint8Array(bytes), MAX_ARTIFACT_BYTES);
    } catch {
      throw storageFailure();
    }
  }

  public async deleteOwnedByteIfHash(
    locator: ArtifactOwnedByteLocator,
    expectedHash: Sha256Hash,
  ): Promise<boolean> {
    try {
      validateByteLocator(locator);
      if (!SHA256.test(expectedHash)) throw storageFailure();
      const segments = artifactSegments(locator);
      if (!await this.root.assertDirectoryChain(segments.slice(0, -1))) return false;
      const path = this.root.resolve(...segments);
      const observed = await readStableFile(path, MAX_ARTIFACT_BYTES);
      if (observed === undefined || hashBytes(observed.bytes) !== expectedHash) return false;
      if (!await this.root.assertDirectoryChain(segments.slice(0, -1))) throw storageFailure();
      return await removeExactFile(
        path,
        this.root.resolve(...segments.slice(0, -1)),
        observed.identity,
      );
    } catch {
      throw storageFailure();
    }
  }
}

export interface NodeArtifactInstallRecoveryResult {
  readonly finalized: number;
  readonly rolledBack: number;
  readonly discardedIncompleteIntents: number;
}

async function hasArtifactResidue(
  storage: ArtifactStoragePort,
  bulletinLocalId: string,
  buildId: string,
): Promise<boolean> {
  if (await storage.readRecord({ kind: "artifactRecord", bulletinLocalId, buildId }) !== undefined) {
    return true;
  }
  for (const extension of ["typ", "pdf"] as const) {
    if (await storage.readOwnedByte({
      kind: "artifactOwnedByte",
      bulletinLocalId,
      buildId,
      extension,
    }) !== undefined) return true;
  }
  return false;
}

async function assertOwnedBytes(
  storage: ArtifactStoragePort,
  journal: ArtifactInstallJournal,
  remove: boolean,
): Promise<void> {
  const expected = new Map(journal.ownedBytes.map((entry) => [entry.extension, entry]));
  for (const extension of ["typ", "pdf"] as const) {
    const locator: ArtifactOwnedByteLocator = {
      kind: "artifactOwnedByte",
      bulletinLocalId: journal.record.bulletinLocalId,
      buildId: journal.record.buildId,
      extension,
    };
    const bytes = await storage.readOwnedByte(locator);
    const identity = expected.get(extension);
    if (identity === undefined) {
      if (bytes !== undefined) throw storageFailure();
      continue;
    }
    if (bytes === undefined) {
      if (remove) continue;
      throw storageFailure();
    }
    if (
      bytes.byteLength !== identity.byteSize ||
      hashBytes(bytes) !== identity.hash
    ) throw storageFailure();
    if (remove && !await storage.deleteOwnedByteIfHash(locator, identity.hash)) {
      throw storageFailure();
    }
  }
}

/**
 * Resolve every write-ahead artifact intent before workspace services become
 * available. An exact record commits its exact bytes; without the record only
 * exact journal-owned bytes may be removed. Contradictory evidence is preserved
 * and rejected rather than guessed at.
 */
export async function recoverNodeArtifactInstalls(
  workspaceRoot: string,
  records: ArtifactRecordValidatorPort,
): Promise<NodeArtifactInstallRecoveryResult> {
  const root = await FixedRoot.create(workspaceRoot);
  const storage = new NodeArtifactStorage(root);
  const journalStorage = storage.installJournal;
  const directorySegments = ARTIFACT_INSTALL_JOURNAL_DIRECTORY.split("/");
  if (!await root.assertDirectoryChain(directorySegments)) {
    return { finalized: 0, rolledBack: 0, discardedIncompleteIntents: 0 };
  }
  const directory = root.resolve(...directorySegments);
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.length > MAX_INSTALL_JOURNALS) throw storageFailure();
  entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  let finalized = 0;
  let rolledBack = 0;
  let discardedIncompleteIntents = 0;

  for (const entry of entries) {
    const match = INSTALL_JOURNAL_NAME.exec(entry.name);
    if (match?.[1] === undefined || match[2] === undefined || !entry.isFile() || entry.isSymbolicLink()) {
      throw storageFailure();
    }
    const path = root.resolve(...directorySegments, entry.name);
    const read = await readStableFile(path, MAX_INSTALL_JOURNAL_BYTES);
    if (read === undefined) throw storageFailure();
    let journal: ArtifactInstallJournal;
    try {
      journal = await validateInstallJournal(decodeCanonicalJson(read.bytes), records);
    } catch {
      if (await hasArtifactResidue(storage, match[1], match[2])) throw storageFailure();
      if (!await removeExactFile(path, directory, read.identity)) throw storageFailure();
      discardedIncompleteIntents += 1;
      continue;
    }
    if (
      journal.record.bulletinLocalId !== match[1] ||
      journal.record.buildId !== match[2]
    ) throw storageFailure();

    const locator: ArtifactRecordLocator = {
      kind: "artifactRecord",
      bulletinLocalId: journal.record.bulletinLocalId,
      buildId: journal.record.buildId,
    };
    const recordSegments = artifactSegments(locator);
    const recordDirectorySegments = recordSegments.slice(0, -1);
    const durableRecord = await root.assertDirectoryChain(recordDirectorySegments)
      ? await readStableFile(root.resolve(...recordSegments), MAX_RECORD_BYTES)
      : undefined;
    if (durableRecord === undefined) {
      await assertOwnedBytes(storage, journal, true);
      await journalStorage.finish(journal);
      rolledBack += 1;
      continue;
    }
    const expectedRecord = canonicalJsonBytes(journal.record);
    if (!equalBytes(durableRecord.bytes, expectedRecord)) {
      const exactInterruptedPrefix = durableRecord.bytes.byteLength < expectedRecord.byteLength &&
        equalBytes(durableRecord.bytes, expectedRecord.subarray(0, durableRecord.bytes.byteLength));
      if (!exactInterruptedPrefix || !await removeExactFile(
        root.resolve(...recordSegments),
        root.resolve(...recordDirectorySegments),
        durableRecord.identity,
      )) throw storageFailure();
      await assertOwnedBytes(storage, journal, true);
      await journalStorage.finish(journal);
      rolledBack += 1;
      continue;
    }
    const parsedRecord = decodeCanonicalJson(durableRecord.bytes);
    if (!await records.validate(parsedRecord) || canonicalStringify(parsedRecord) !== canonicalStringify(journal.record)) {
      throw storageFailure();
    }
    await assertOwnedBytes(storage, journal, false);
    await journalStorage.finish(journal);
    finalized += 1;
  }
  if (!await root.assertDirectoryChain(directorySegments)) throw storageFailure();
  return { finalized, rolledBack, discardedIncompleteIntents };
}

/** Workspace startup adapter that turns artifact ambiguity into read-only mode. */
export class NodeArtifactStartupRecovery implements StartupRecoveryPort {
  public constructor(
    private readonly records: ArtifactRecordValidatorPort,
    private readonly ids: IdPort,
  ) {}

  public async recover(
    root: string,
    registry: WorkspaceRegistry,
  ): Promise<StartupRecoveryResult> {
    try {
      await recoverNodeArtifactInstalls(root, this.records);
      return { status: "ok", registry, diagnostics: [] };
    } catch {
      const correlationId = this.ids.randomUuid();
      if (!isCanonicalUuid(correlationId)) {
        throw new TypeError("Id port returned an invalid artifact recovery correlation id");
      }
      return {
        status: "readOnly",
        registry,
        diagnostics: [serviceDiagnostic({
          code: "CBB-SAVE-0001",
          correlationId,
          operation: "recover-artifact-install",
          userSummary: "An interrupted PDF build could not be recovered safely.",
          recoveryActions: ["cancel"],
        })],
      };
    }
  }
}

/** Construct a fixed-layout, immutable artifact store rooted at one trusted workspace. */
export async function createNodeArtifactStoragePort(
  workspaceRoot: string,
): Promise<ArtifactStoragePort> {
  try {
    return new NodeArtifactStorage(await FixedRoot.create(workspaceRoot));
  } catch {
    throw storageFailure();
  }
}

/** Bind the closed v1 artifact schema in an already-offline compiled catalog. */
export function createArtifactRecordSchemaValidator(
  catalog: SchemaCatalog,
): ArtifactRecordValidatorPort {
  return Object.freeze({
    validate(record: unknown): boolean {
      try {
        return catalog.validateAgainst(ARTIFACT_RECORD_SCHEMA_ID, record).valid;
      } catch {
        return false;
      }
    },
  });
}

/** Node-integration naming alias for the catalog-bound schema adapter. */
export const createNodeArtifactRecordValidator = createArtifactRecordSchemaValidator;

export interface RegisteredCompilePdfIdentity {
  readonly hash: Sha256Hash;
  readonly byteSize: number;
}

interface RegisteredCompileOutput extends RegisteredCompilePdfIdentity {
  readonly buildId: string;
  readonly path: string;
}

/**
 * Trusted sandbox-side handle registry. Output locations are fixed to
 * `<outputRoot>/<buildId>/output.pdf`; only the opaque token leaves this class.
 */
export class NodeCompileOutputHandleRegistry {
  readonly #entries = new Map<BuildOutputHandle, RegisteredCompileOutput>();

  private constructor(private readonly root: FixedRoot) {}

  public static async create(outputRoot: string): Promise<NodeCompileOutputHandleRegistry> {
    try {
      return new NodeCompileOutputHandleRegistry(await FixedRoot.create(outputRoot));
    } catch {
      throw outputFailure();
    }
  }

  public async registerVerifiedPdf(
    buildId: string,
    identity: RegisteredCompilePdfIdentity,
  ): Promise<BuildOutputHandle> {
    try {
      if (
        !validateUuid(buildId) ||
        !SHA256.test(identity.hash) ||
        !Number.isSafeInteger(identity.byteSize) ||
        identity.byteSize < 1 ||
        identity.byteSize > MAX_ARTIFACT_BYTES ||
        this.#entries.size >= MAX_OUTPUT_HANDLES
      ) throw outputFailure();
      if (!await this.root.assertDirectoryChain([buildId])) throw outputFailure();
      const path = this.root.resolve(buildId, "output.pdf");
      const observed = await readStableFile(path, identity.byteSize);
      if (
        observed === undefined ||
        observed.bytes.byteLength !== identity.byteSize ||
        hashBytes(observed.bytes) !== identity.hash
      ) throw outputFailure();
      let handle: BuildOutputHandle;
      do {
        handle = `artifact-output:${randomUUID()}` as BuildOutputHandle;
      } while (this.#entries.has(handle));
      this.#entries.set(handle, { buildId, path, ...identity });
      return handle;
    } catch {
      throw outputFailure();
    }
  }

  public revoke(handle: BuildOutputHandle): boolean {
    if (typeof handle !== "string" || !OUTPUT_HANDLE.test(handle)) return false;
    return this.#entries.delete(handle);
  }

  public clear(): void {
    this.#entries.clear();
  }

  async read(handle: BuildOutputHandle): Promise<Uint8Array> {
    try {
      if (typeof handle !== "string" || !OUTPUT_HANDLE.test(handle)) throw outputFailure();
      const entry = this.#entries.get(handle);
      if (entry === undefined) throw outputFailure();
      this.#entries.delete(handle);
      if (!await this.root.assertDirectoryChain([entry.buildId])) throw outputFailure();
      const observed = await readStableFile(entry.path, entry.byteSize);
      if (
        observed === undefined ||
        observed.bytes.byteLength !== entry.byteSize ||
        hashBytes(observed.bytes) !== entry.hash
      ) throw outputFailure();
      if (!await this.root.assertDirectoryChain([entry.buildId])) throw outputFailure();
      return observed.bytes;
    } catch {
      throw outputFailure();
    }
  }
}

export function createNodeCompileOutputReader(
  registry: NodeCompileOutputHandleRegistry,
): CompileOutputReaderPort {
  if (!(registry instanceof NodeCompileOutputHandleRegistry)) throw outputFailure();
  return Object.freeze({
    async readVerifiedPdf(handle: BuildOutputHandle): Promise<Uint8Array> {
      try {
        return await registry.read(handle);
      } catch {
        throw outputFailure();
      }
    },
  });
}

export interface PdfInspectorIdentity {
  readonly toolId: string;
  readonly version: string;
  readonly hash: Sha256Hash;
}

export interface PinnedPdfInspection {
  readonly pageCount: number;
  readonly pdfVersion: string;
  /** Deterministic, canonical standard identifiers; an empty array means none detected. */
  readonly standards: readonly string[];
  readonly validationReportHash?: Sha256Hash;
}

export interface PinnedPdfInspectorPort {
  readonly identity: PdfInspectorIdentity;
  inspect(bytes: Uint8Array): Promise<PinnedPdfInspection>;
}

export interface NodeArtifactPdfValidatorOptions {
  readonly inspector: PinnedPdfInspectorPort;
  /** Configuration pin; verification stops if the injected tool identity changes. */
  readonly pinnedIdentity: PdfInspectorIdentity;
  readonly maximumByteSize?: number;
  readonly maximumPageCount?: number;
}

function sameInspectorIdentity(
  left: PdfInspectorIdentity,
  right: PdfInspectorIdentity,
): boolean {
  return left.toolId === right.toolId &&
    left.version === right.version &&
    left.hash === right.hash;
}

function validInspectorIdentity(identity: PdfInspectorIdentity): boolean {
  return identity !== null &&
    typeof identity === "object" &&
    typeof identity.toolId === "string" &&
    identity.toolId.length >= 1 &&
    identity.toolId.length <= 128 &&
    typeof identity.version === "string" &&
    identity.version.length >= 1 &&
    identity.version.length <= 128 &&
    typeof identity.hash === "string" &&
    SHA256.test(identity.hash) &&
    Reflect.ownKeys(identity).every((key) =>
      ["toolId", "version", "hash"].includes(String(key)),
    );
}

function pdfHeaderVersion(bytes: Uint8Array): string | undefined {
  if (bytes.byteLength < 8) return undefined;
  const prefix = String.fromCharCode(...bytes.subarray(0, 8));
  const match = /^%PDF-((?:1\.[0-7])|(?:2\.0))$/u.exec(prefix);
  return match?.[1];
}

function hasTerminalPdfEof(bytes: Uint8Array): boolean {
  let end = bytes.byteLength;
  while (end > 0) {
    const value = bytes[end - 1] as number;
    if (value === 0 || value === 9 || value === 10 || value === 12 || value === 13 || value === 32) {
      end -= 1;
    } else {
      break;
    }
  }
  if (end < 5) return false;
  return String.fromCharCode(...bytes.subarray(end - 5, end)) === "%%EOF";
}

/**
 * Validate exact PDF bytes locally before trusting the pinned inspector's
 * structural report. Magic, EOF, hash, and byte bounds are never delegated.
 */
export function createNodeArtifactPdfValidator(
  options: NodeArtifactPdfValidatorOptions,
): ArtifactPdfValidatorPort {
  let maximumByteSize: number;
  let maximumPageCount: number;
  let pinnedIdentity: Readonly<PdfInspectorIdentity>;
  try {
    maximumByteSize = options.maximumByteSize ?? MAX_ARTIFACT_BYTES;
    maximumPageCount = options.maximumPageCount ?? MAX_PDF_PAGES;
    if (
      !validInspectorIdentity(options.pinnedIdentity) ||
      !validInspectorIdentity(options.inspector.identity) ||
      !sameInspectorIdentity(options.inspector.identity, options.pinnedIdentity) ||
      !Number.isSafeInteger(maximumByteSize) ||
      maximumByteSize < 1 ||
      maximumByteSize > MAX_ARTIFACT_BYTES ||
      !Number.isSafeInteger(maximumPageCount) ||
      maximumPageCount < 1 ||
      maximumPageCount > MAX_PDF_PAGES
    ) throw pdfFailure();
    pinnedIdentity = Object.freeze({ ...options.pinnedIdentity });
  } catch {
    throw pdfFailure();
  }

  return Object.freeze({
    async verify(bytes: Uint8Array): Promise<ObservedPdfIdentity> {
      try {
        if (
          !(bytes instanceof Uint8Array) ||
          bytes.byteLength < 13 ||
          bytes.byteLength > maximumByteSize ||
          !sameInspectorIdentity(options.inspector.identity, pinnedIdentity)
        ) throw pdfFailure();
        const exactBytes = new Uint8Array(bytes);
        const headerVersion = pdfHeaderVersion(exactBytes);
        if (headerVersion === undefined || !hasTerminalPdfEof(exactBytes)) throw pdfFailure();
        const hash = hashBytes(exactBytes);
        const inspection = await options.inspector.inspect(new Uint8Array(exactBytes));
        if (
          !sameInspectorIdentity(options.inspector.identity, pinnedIdentity) ||
          inspection === null ||
          typeof inspection !== "object" ||
          !Number.isSafeInteger(inspection.pageCount) ||
          inspection.pageCount < 1 ||
          inspection.pageCount > maximumPageCount ||
          typeof inspection.pdfVersion !== "string" ||
          !PDF_VERSION.test(inspection.pdfVersion) ||
          inspection.pdfVersion !== headerVersion ||
          !Array.isArray(inspection.standards) ||
          inspection.standards.length > MAX_PDF_STANDARDS ||
          inspection.standards.some((standard) =>
            typeof standard !== "string" || !SAFE_STANDARD.test(standard),
          ) ||
          new Set(inspection.standards).size !== inspection.standards.length ||
          (inspection.validationReportHash !== undefined &&
            (typeof inspection.validationReportHash !== "string" ||
              !SHA256.test(inspection.validationReportHash)))
        ) throw pdfFailure();
        return {
          hash,
          byteSize: exactBytes.byteLength,
          pageCount: inspection.pageCount,
          pdfVersion: inspection.pdfVersion,
          standards: [...inspection.standards],
          ...(inspection.validationReportHash === undefined
            ? {}
            : { validationReportHash: inspection.validationReportHash }),
        };
      } catch {
        throw pdfFailure();
      }
    },
  });
}
