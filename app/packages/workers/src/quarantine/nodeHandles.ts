import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { hashBytes, type Sha256Hash } from "@cbb/core";
import {
  readVerifiedQuarantineReceipt,
  type PrivilegedQuarantineHandlePort,
  type QuarantineInputVerificationRequest,
  type QuarantineOutputVerificationRequest,
  type RehashedQuarantineInput,
  type RehashedQuarantineOutput,
  type VerifiedQuarantineReceipt,
} from "./broker.js";
import {
  isSafeArchivePath,
  quarantineArchiveClosureHash,
  quarantineHandle,
  type ArchiveClosureEntry,
  type QuarantineHandle,
  type QuarantineMediaType,
  type QuarantineOperation,
  type QuarantineRequest,
} from "./protocol.js";

const READ_CHUNK_BYTES = 64 * 1024;
const MAX_HANDLES = 4_096;
const MAX_QUARANTINE_INPUT_BYTES = 1024 * 1024 * 1024;
const MAX_ARCHIVE_DEPTH = 64;
const SVG_DECODER = new TextDecoder("utf-8", { fatal: true });

export type NodeQuarantineHandleFailureKind =
  | "rootRejected"
  | "unknownHandle"
  | "inputRejected"
  | "outputRejected"
  | "cleanupRejected";

/** Fixed, path-free security failure for hostile filesystem boundaries. */
export class NodeQuarantineHandleError extends Error {
  public readonly code = "CBB-SECURITY-0001" as const;

  public constructor(public readonly kind: NodeQuarantineHandleFailureKind) {
    super("The quarantine handle boundary rejected an unsafe or inconsistent entry.");
    this.name = "NodeQuarantineHandleError";
  }
}

interface FileIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
  readonly nlink: bigint;
}

interface DirectoryIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
}

interface InputEntry {
  readonly path: string;
  readonly identity: FileIdentity;
  readonly hash: Sha256Hash;
  readonly byteSize: number;
}

interface OutputEntry {
  readonly path: string;
  readonly operation: QuarantineOperation;
  state: "prepared" | "reserved" | "verified" | "consuming";
  requestId?: string;
  verification?: RehashedQuarantineOutput;
  verificationRequest?: QuarantineOutputVerificationRequest;
  readonly directoryIdentity?: DirectoryIdentity;
  readonly fileIdentity?: DirectoryIdentity;
}

export interface QuarantineWorkerHandleBinding {
  readonly inputPath: string;
  readonly outputPath: string;
  readonly outputKind: "file" | "directory";
}

function security(kind: NodeQuarantineHandleFailureKind): NodeQuarantineHandleError {
  return new NodeQuarantineHandleError(kind);
}

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { readonly code?: unknown }).code
    : undefined;
}

function isMissing(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}

function toFileIdentity(stats: {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
  readonly nlink: bigint;
}): FileIdentity {
  return {
    dev: stats.dev,
    ino: stats.ino,
    size: stats.size,
    mtimeNs: stats.mtimeNs,
    ctimeNs: stats.ctimeNs,
    nlink: stats.nlink,
  };
}

function sameNode(left: DirectoryIdentity, right: DirectoryIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameFile(left: FileIdentity, right: FileIdentity): boolean {
  return sameNode(left, right) &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs &&
    left.nlink === right.nlink;
}

function strictDescendant(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child.length > 0 &&
    child !== ".." &&
    !child.startsWith(`..${sep}`) &&
    !isAbsolute(child);
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

class FixedDirectory {
  private constructor(
    public readonly path: string,
    private readonly identity: DirectoryIdentity,
  ) {}

  public static async open(pathValue: string): Promise<FixedDirectory> {
    if (
      typeof pathValue !== "string" ||
      pathValue.length === 0 ||
      typeof constants.O_NOFOLLOW !== "number" ||
      constants.O_NOFOLLOW === 0 ||
      typeof constants.O_DIRECTORY !== "number"
    ) throw security("rootRejected");
    const configured = resolve(pathValue);
    const stats = await lstat(configured, { bigint: true }).catch(() => {
      throw security("rootRejected");
    });
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw security("rootRejected");
    const canonical = await realpath(configured);
    if (canonical !== configured) throw security("rootRejected");
    return new FixedDirectory(canonical, { dev: stats.dev, ino: stats.ino });
  }

  public async assertCurrent(): Promise<void> {
    const stats = await lstat(this.path, { bigint: true }).catch(() => {
      throw security("rootRejected");
    });
    if (stats.isSymbolicLink() || !stats.isDirectory() || !sameNode(this.identity, stats)) {
      throw security("rootRejected");
    }
  }

  public child(name: string): string {
    const candidate = resolve(this.path, name);
    if (!strictDescendant(this.path, candidate)) throw security("rootRejected");
    return candidate;
  }
}

async function ensurePrivateChild(root: FixedDirectory, name: string): Promise<FixedDirectory> {
  await root.assertCurrent();
  const path = root.child(name);
  try {
    await mkdir(path, { mode: 0o700 });
    await syncDirectory(root.path);
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
  }
  return FixedDirectory.open(path);
}

async function writeExclusive(path: string, bytes: Uint8Array): Promise<FileIdentity> {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    let position = 0;
    while (position < bytes.byteLength) {
      const { bytesWritten } = await handle.write(bytes, position, bytes.byteLength - position, position);
      if (bytesWritten < 1) throw security("inputRejected");
      position += bytesWritten;
    }
    await handle.sync();
    const stats = await handle.stat({ bigint: true });
    if (!stats.isFile() || stats.nlink !== 1n) throw security("inputRejected");
    return toFileIdentity(stats);
  } finally {
    await handle.close();
  }
}

async function readStableFile(
  path: string,
  maximumBytes: number,
  expected?: FileIdentity,
): Promise<{ readonly bytes: Uint8Array; readonly identity: FileIdentity }> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw security("outputRejected");
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => {
    throw security("outputRejected");
  });
  try {
    const opened = await handle.stat({ bigint: true });
    const identity = toFileIdentity(opened);
    if (
      !opened.isFile() ||
      opened.nlink !== 1n ||
      opened.size < 0n ||
      opened.size > BigInt(maximumBytes) ||
      opened.size > BigInt(Number.MAX_SAFE_INTEGER) ||
      (expected !== undefined && !sameFile(expected, identity))
    ) throw security("outputRejected");
    const size = Number(opened.size);
    const bytes = new Uint8Array(size);
    let position = 0;
    while (position < size) {
      const length = Math.min(READ_CHUNK_BYTES, size - position);
      const { bytesRead } = await handle.read(bytes, position, length, position);
      if (bytesRead < 1) throw security("outputRejected");
      position += bytesRead;
    }
    const after = toFileIdentity(await handle.stat({ bigint: true }));
    if (!sameFile(identity, after)) throw security("outputRejected");
    return { bytes, identity };
  } finally {
    await handle.close();
  }
}

function startsWith(bytes: Uint8Array, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[index] === value);
}

function detectMediaType(bytes: Uint8Array): QuarantineMediaType {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (startsWith(bytes, [0x4f, 0x54, 0x54, 0x4f])) return "font/otf";
  if (startsWith(bytes, [0x00, 0x01, 0x00, 0x00]) || startsWith(bytes, [0x74, 0x72, 0x75, 0x65])) {
    return "font/ttf";
  }
  if (startsWith(bytes, [0x77, 0x4f, 0x46, 0x46])) return "font/woff";
  if (startsWith(bytes, [0x77, 0x4f, 0x46, 0x32])) return "font/woff2";
  try {
    const text = SVG_DECODER.decode(bytes);
    const normalized = text.replace(/^\uFEFF/u, "").trimStart();
    if (/^(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/u.test(normalized)) return "image/svg+xml";
  } catch {
    // The closed media test below rejects invalid UTF-8.
  }
  throw security("outputRejected");
}

function newHandle(): QuarantineHandle {
  return quarantineHandle(`qh:${randomBytes(32).toString("hex")}`);
}

function validateVerificationIdentity(
  actual: { readonly requestId: string; readonly operation: QuarantineOperation },
): void {
  if (
    typeof actual.requestId !== "string" ||
    actual.requestId.length === 0 ||
    typeof actual.operation !== "string"
  ) throw security("unknownHandle");
}

/**
 * App-owned opaque quarantine handle store. Inputs are copied into a private
 * fixed root; output paths are allocated by the app and are never accepted
 * from a worker message.
 */
async function sweepOwnedResidue(
  root: FixedDirectory,
  allowDirectories: boolean,
): Promise<void> {
  await root.assertCurrent();
  const children = await readdir(root.path, { withFileTypes: true });
  for (const child of children) {
    const path = root.child(child.name);
    const stats = await lstat(path, { bigint: true });
    if (stats.isDirectory() && !stats.isSymbolicLink()) {
      if (!allowDirectories) throw security("cleanupRejected");
      const tomb = root.child(`.startup-${randomBytes(16).toString("hex")}`);
      await rename(path, tomb);
      const moved = await lstat(tomb, { bigint: true });
      if (!moved.isDirectory() || moved.isSymbolicLink()) throw security("cleanupRejected");
      await rm(tomb, { recursive: true, force: false });
      continue;
    }
    await unlink(path);
  }
  await syncDirectory(root.path);
}

export class NodeQuarantineHandleStore implements PrivilegedQuarantineHandlePort {
  readonly #inputsRoot: FixedDirectory;
  readonly #outputsRoot: FixedDirectory;
  readonly #inputs = new Map<QuarantineHandle, InputEntry>();
  readonly #outputs = new Map<QuarantineHandle, OutputEntry>();

  private constructor(inputsRoot: FixedDirectory, outputsRoot: FixedDirectory) {
    this.#inputsRoot = inputsRoot;
    this.#outputsRoot = outputsRoot;
  }

  public static async create(rootPath: string): Promise<NodeQuarantineHandleStore> {
    const root = await FixedDirectory.open(rootPath);
    const inputs = await ensurePrivateChild(root, "inputs");
    const outputs = await ensurePrivateChild(root, "outputs");
    await sweepOwnedResidue(inputs, false);
    await sweepOwnedResidue(outputs, true);
    return new NodeQuarantineHandleStore(inputs, outputs);
  }

  /** Copy trusted caller bytes into an immutable, app-owned input slot. */
  public async registerInput(bytes: Uint8Array): Promise<QuarantineHandle> {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_QUARANTINE_INPUT_BYTES || this.#inputs.size >= MAX_HANDLES) {
      throw security("inputRejected");
    }
    await this.#inputsRoot.assertCurrent();
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const handle = newHandle();
      const path = this.#inputsRoot.child(handle.slice(3));
      try {
        const identity = await writeExclusive(path, bytes);
        await syncDirectory(this.#inputsRoot.path);
        this.#inputs.set(handle, {
          path,
          identity,
          hash: hashBytes(bytes),
          byteSize: bytes.byteLength,
        });
        return handle;
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
      }
    }
    throw security("inputRejected");
  }

  /** Allocate an empty app-owned output slot with operation-bound shape. */
  public async prepareOutput(operation: QuarantineOperation): Promise<QuarantineHandle> {
    if (this.#outputs.size >= MAX_HANDLES) throw security("outputRejected");
    await this.#outputsRoot.assertCurrent();
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const handle = newHandle();
      const path = this.#outputsRoot.child(handle.slice(3));
      if (operation === "inspectArchive") {
        try {
          await mkdir(path, { mode: 0o700 });
        } catch (error) {
          if (errorCode(error) === "EEXIST") continue;
          throw error;
        }
        const stats = await lstat(path, { bigint: true });
        if (stats.isSymbolicLink() || !stats.isDirectory()) throw security("outputRejected");
        await syncDirectory(this.#outputsRoot.path);
        this.#outputs.set(handle, {
          path,
          operation,
          state: "prepared",
          directoryIdentity: { dev: stats.dev, ino: stats.ino },
        });
        return handle;
      }
      try {
        const identity = await writeExclusive(path, new Uint8Array());
        await syncDirectory(this.#outputsRoot.path);
        this.#outputs.set(handle, {
          path,
          operation,
          state: "prepared",
          fileIdentity: { dev: identity.dev, ino: identity.ino },
        });
        return handle;
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
      }
    }
    throw security("outputRejected");
  }

  /** Resolve only for the trusted OS-sandbox launcher, never from worker data. */
  public async bindForWorker(request: QuarantineRequest): Promise<QuarantineWorkerHandleBinding> {
    const input = this.#inputs.get(request.input);
    const output = this.#outputs.get(request.output);
    if (input === undefined || output === undefined || output.operation !== request.operation || output.state !== "prepared") {
      throw security("unknownHandle");
    }
    output.state = "reserved";
    output.requestId = request.requestId;
    await this.#inputsRoot.assertCurrent();
    await this.#outputsRoot.assertCurrent();
    await readStableFile(input.path, request.operation === "inspectArchive"
      ? request.limits.compressedBytes
      : request.limits.inputBytes, input.identity);
    return Object.freeze({
      inputPath: input.path,
      outputPath: output.path,
      outputKind: request.operation === "inspectArchive" ? "directory" : "file",
    });
  }

  public async verifyAndRehashInput(
    request: QuarantineInputVerificationRequest,
  ): Promise<RehashedQuarantineInput> {
    validateVerificationIdentity(request);
    const entry = this.#inputs.get(request.input);
    if (entry === undefined) throw security("unknownHandle");
    await this.#inputsRoot.assertCurrent();
    const observed = await readStableFile(entry.path, request.maximumBytes, entry.identity);
    const hash = hashBytes(observed.bytes);
    if (hash !== entry.hash || observed.bytes.byteLength !== entry.byteSize) {
      throw security("inputRejected");
    }
    return Object.freeze({
      version: 1,
      requestId: request.requestId,
      operation: request.operation,
      input: request.input,
      hash: hash as `sha256:${string}`,
      byteSize: observed.bytes.byteLength,
    });
  }

  public async verifyAndRehash(
    request: QuarantineOutputVerificationRequest,
  ): Promise<RehashedQuarantineOutput> {
    validateVerificationIdentity(request);
    const entry = this.#outputs.get(request.output);
    if (entry === undefined || entry.operation !== request.operation || entry.state !== "reserved" || entry.requestId !== request.requestId) {
      throw security("unknownHandle");
    }
    await this.#outputsRoot.assertCurrent();
    if (request.operation === "inspectArchive") {
      const closure = await this.#readArchiveClosure(entry, request);
      const verification = Object.freeze({
        version: 1 as const,
        requestId: request.requestId,
        operation: request.operation,
        output: request.output,
        hash: quarantineArchiveClosureHash(closure.entries),
        byteSize: closure.byteSize,
        mediaType: "application/vnd.cbb.quarantine-closure" as const,
      });
      entry.state = "verified";
      entry.verification = verification;
      entry.verificationRequest = request;
      return verification;
    }
    const observed = await readStableFile(entry.path, request.maximumBytes);
    if (entry.fileIdentity === undefined || !sameNode(entry.fileIdentity, observed.identity)) {
      throw security("outputRejected");
    }
    const mediaType = detectMediaType(observed.bytes);
    if (!request.allowedMediaTypes.includes(mediaType)) throw security("outputRejected");
    const verification = Object.freeze({
      version: 1 as const,
      requestId: request.requestId,
      operation: request.operation,
      output: request.output,
      hash: hashBytes(observed.bytes) as `sha256:${string}`,
      byteSize: observed.bytes.byteLength,
      mediaType,
    });
    entry.state = "verified";
    entry.verification = verification;
    entry.verificationRequest = request;
    return verification;
  }

  async #readArchiveClosure(
    entry: OutputEntry,
    request: QuarantineOutputVerificationRequest,
  ): Promise<{ readonly entries: readonly ArchiveClosureEntry[]; readonly byteSize: number }> {
    if (entry.directoryIdentity === undefined) throw security("outputRejected");
    const rootStats = await lstat(entry.path, { bigint: true }).catch(() => {
      throw security("outputRejected");
    });
    if (
      rootStats.isSymbolicLink() ||
      !rootStats.isDirectory() ||
      !sameNode(entry.directoryIdentity, rootStats) ||
      await realpath(entry.path) !== entry.path
    ) throw security("outputRejected");

    const closure: ArchiveClosureEntry[] = [];
    const aliases = new Set<string>();
    let total = 0;
    const walk = async (directory: string, relativeDirectory: string, depth: number): Promise<void> => {
      if (depth > MAX_ARCHIVE_DEPTH) throw security("outputRejected");
      const before = await lstat(directory, { bigint: true });
      if (before.isSymbolicLink() || !before.isDirectory()) throw security("outputRejected");
      const children = await readdir(directory, { withFileTypes: true });
      children.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
      for (const child of children) {
        const relativePath = relativeDirectory.length === 0
          ? child.name
          : `${relativeDirectory}/${child.name}`;
        if (!isSafeArchivePath(relativePath)) throw security("outputRejected");
        const path = join(directory, child.name);
        const stats = await lstat(path, { bigint: true });
        if (stats.isSymbolicLink()) throw security("outputRejected");
        if (stats.isDirectory()) {
          await walk(path, relativePath, depth + 1);
          continue;
        }
        if (!stats.isFile() || closure.length >= request.maximumEntries) {
          throw security("outputRejected");
        }
        const alias = relativePath.toLowerCase();
        if (aliases.has(alias)) throw security("outputRejected");
        aliases.add(alias);
        const observed = await readStableFile(path, request.maximumEntryBytes);
        total += observed.bytes.byteLength;
        if (!Number.isSafeInteger(total) || total > request.maximumBytes) {
          throw security("outputRejected");
        }
        closure.push({
          path: relativePath,
          hash: hashBytes(observed.bytes) as `sha256:${string}`,
          byteSize: observed.bytes.byteLength,
        });
      }
      const after = await lstat(directory, { bigint: true });
      if (!sameNode(before, after) || !after.isDirectory()) throw security("outputRejected");
    };
    await walk(entry.path, "", 0);
    return { entries: closure, byteSize: total };
  }

  /**
   * Consume a broker-verified derivative exactly once, rechecking the receipt
   * against the reserved request and stable bytes before deleting its handle.
   */
  public async consumeVerifiedOutput(
    receipt: VerifiedQuarantineReceipt,
  ): Promise<ConsumedQuarantineOutput> {
    let evidence;
    try {
      evidence = readVerifiedQuarantineReceipt(receipt);
    } catch {
      throw security("unknownHandle");
    }
    const entry = this.#outputs.get(evidence.output);
    const verification = entry?.verification;
    const verificationRequest = entry?.verificationRequest;
    if (
      entry === undefined ||
      entry.state !== "verified" ||
      entry.operation !== evidence.operation ||
      entry.requestId !== evidence.requestId ||
      verification === undefined ||
      verificationRequest === undefined ||
      verification.hash !== evidence.outputHash ||
      verification.byteSize !== evidence.outputBytes ||
      verification.mediaType !== evidence.mediaType
    ) throw security("unknownHandle");
    entry.state = "consuming";
    try {
      if (entry.operation === "inspectArchive") {
        const closure = await this.#readArchiveClosure(entry, verificationRequest);
        if (
          quarantineArchiveClosureHash(closure.entries) !== evidence.outputHash ||
          closure.byteSize !== evidence.outputBytes
        ) throw security("outputRejected");
        const entries: Array<{
          readonly path: string;
          readonly hash: Sha256Hash;
          readonly bytes: Uint8Array;
        }> = [];
        for (const item of closure.entries) {
          const observed = await readStableFile(
            resolve(entry.path, ...item.path.split("/")),
            item.byteSize,
          );
          if (
            observed.bytes.byteLength !== item.byteSize ||
            hashBytes(observed.bytes) !== item.hash
          ) throw security("outputRejected");
          entries.push(Object.freeze({
            path: item.path,
            hash: item.hash as Sha256Hash,
            bytes: new Uint8Array(observed.bytes),
          }));
        }
        await this.discardOutput(evidence.output);
        return Object.freeze({
          kind: "archiveClosure" as const,
          hash: evidence.outputHash as Sha256Hash,
          entries: Object.freeze(entries),
        });
      }

      const observed = await readStableFile(entry.path, evidence.outputBytes);
      const mediaType = detectMediaType(observed.bytes);
      if (
        observed.bytes.byteLength !== evidence.outputBytes ||
        hashBytes(observed.bytes) !== evidence.outputHash ||
        mediaType !== evidence.mediaType ||
        mediaType === "application/vnd.cbb.quarantine-closure"
      ) throw security("outputRejected");
      const result: ConsumedQuarantineOutput = Object.freeze({
        kind: "file",
        bytes: new Uint8Array(observed.bytes),
        hash: evidence.outputHash as Sha256Hash,
        mediaType,
      });
      await this.discardOutput(evidence.output);
      return result;
    } catch {
      await this.discardOutput(evidence.output).catch(() => undefined);
      throw security("outputRejected");
    }
  }

  public async cleanupInput(handle: QuarantineHandle): Promise<void> {
    const entry = this.#inputs.get(handle);
    if (entry === undefined) return;
    try {
      await this.#inputsRoot.assertCurrent();
      const stats = toFileIdentity(await lstat(entry.path, { bigint: true }));
      if (!sameFile(entry.identity, stats)) throw security("cleanupRejected");
      await unlink(entry.path);
      await syncDirectory(this.#inputsRoot.path);
      this.#inputs.delete(handle);
    } catch (error) {
      if (isMissing(error)) {
        this.#inputs.delete(handle);
        return;
      }
      throw security("cleanupRejected");
    }
  }

  public async discardOutput(handle: QuarantineHandle): Promise<void> {
    const entry = this.#outputs.get(handle);
    if (entry === undefined) return;
    try {
      await this.#outputsRoot.assertCurrent();
      let stats;
      try {
        stats = await lstat(entry.path, { bigint: true });
      } catch (error) {
        if (isMissing(error)) {
          this.#outputs.delete(handle);
          return;
        }
        throw error;
      }
      if (
        entry.directoryIdentity !== undefined &&
        (!stats.isDirectory() || stats.isSymbolicLink() || !sameNode(entry.directoryIdentity, stats))
      ) throw security("cleanupRejected");
      if (stats.isDirectory() && entry.directoryIdentity === undefined) {
        throw security("cleanupRejected");
      }
      if (entry.directoryIdentity !== undefined) {
        const tomb = this.#outputsRoot.child(`.discard-${randomBytes(16).toString("hex")}`);
        await rename(entry.path, tomb);
        const moved = await lstat(tomb, { bigint: true });
        if (!moved.isDirectory() || !sameNode(entry.directoryIdentity, moved)) {
          throw security("cleanupRejected");
        }
        await rm(tomb, { recursive: true, force: false });
      } else {
        await unlink(entry.path);
      }
      await syncDirectory(this.#outputsRoot.path);
      this.#outputs.delete(handle);
    } catch {
      throw security("cleanupRejected");
    }
  }
}

export type ConsumedQuarantineOutput =
  | {
      readonly kind: "file";
      readonly bytes: Uint8Array;
      readonly hash: Sha256Hash;
      readonly mediaType: Exclude<QuarantineMediaType, "application/vnd.cbb.quarantine-closure">;
    }
  | {
      readonly kind: "archiveClosure";
      readonly hash: Sha256Hash;
      readonly entries: readonly {
        readonly path: string;
        readonly hash: Sha256Hash;
        readonly bytes: Uint8Array;
      }[];
    };
