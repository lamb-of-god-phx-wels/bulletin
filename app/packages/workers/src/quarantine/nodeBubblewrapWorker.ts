import { Buffer } from "node:buffer";
import { constants } from "node:fs";
import { lstat, mkdtemp, open, readdir, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import { hashBytes, type Sha256Hash } from "@cbb/core";
import type { QuarantineWorkerPort } from "./broker.js";
import type { NodeQuarantineHandleStore } from "./nodeHandles.js";
import { validateQuarantineRequest, type QuarantineRequest } from "./protocol.js";

const DEFAULT_MAXIMUM_MESSAGE_BYTES = 1024 * 1024;
const MAXIMUM_MESSAGE_BYTES = 8 * 1024 * 1024;
const TERMINATE_GRACE_MS = 5_000;
const PROBE_TIMEOUT_MS = 5_000;
const MAXIMUM_PROBE_OUTPUT_BYTES = 256 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;
const UTF8 = new TextDecoder("utf-8", { fatal: true });
const RUNTIME_RESIDUE = /^(?:probe-|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-)[A-Za-z0-9]{6}$/u;

export interface PinnedLinuxExecutable {
  readonly path: string;
  readonly hash: Sha256Hash;
}

export interface PinnedStaticQuarantineWorker extends PinnedLinuxExecutable {
  /** The sandbox intentionally mounts no dynamic loader or shared libraries. */
  readonly staticallyLinked: true;
}

export interface NodeBubblewrapQuarantineWorkerOptions {
  readonly bubblewrap: PinnedLinuxExecutable;
  readonly worker: PinnedStaticQuarantineWorker;
  readonly runtimeRoot: string;
  readonly handles: NodeQuarantineHandleStore;
  readonly maximumMessageBytes?: number;
}

interface VerifiedExecutable {
  readonly path: string;
  readonly identity: FileIdentity;
}

interface FileIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
  readonly nlink: bigint;
}

interface ActiveProcess {
  readonly child: ChildProcessWithoutNullStreams;
  readonly runtimeRoot: string;
  readonly closed: Promise<void>;
}

interface StartingRequest {
  canceled: boolean;
  readonly settled: Promise<void>;
  readonly settle: () => void;
}

export class NodeBubblewrapQuarantineWorkerError extends Error {
  public readonly code = "CBB-SECURITY-0001" as const;

  public constructor() {
    super("The required isolated quarantine worker is unavailable or failed closed.");
    this.name = "NodeBubblewrapQuarantineWorkerError";
  }
}

function failure(): NodeBubblewrapQuarantineWorkerError {
  return new NodeBubblewrapQuarantineWorkerError();
}

function toIdentity(stats: {
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

function sameFile(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev &&
    left.ino === right.ino &&
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

async function readStableExecutable(pathValue: string): Promise<{
  readonly bytes: Uint8Array;
  readonly identity: FileIdentity;
}> {
  const path = resolve(pathValue);
  if (!isAbsolute(pathValue) || path !== pathValue || typeof constants.O_NOFOLLOW !== "number") {
    throw failure();
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => {
    throw failure();
  });
  try {
    const opened = await handle.stat({ bigint: true });
    const identity = toIdentity(opened);
    if (
      !opened.isFile() ||
      opened.nlink !== 1n ||
      (opened.mode & 0o111n) === 0n ||
      opened.size < 1n ||
      opened.size > 256n * 1024n * 1024n
    ) throw failure();
    const bytes = new Uint8Array(Number(opened.size));
    let position = 0;
    while (position < bytes.byteLength) {
      const length = Math.min(READ_CHUNK_BYTES, bytes.byteLength - position);
      const { bytesRead } = await handle.read(bytes, position, length, position);
      if (bytesRead < 1) throw failure();
      position += bytesRead;
    }
    const after = toIdentity(await handle.stat({ bigint: true }));
    if (!sameFile(identity, after)) throw failure();
    return { bytes, identity };
  } finally {
    await handle.close();
  }
}

function unsigned(bytes: Uint8Array, offset: number, width: 2 | 4 | 8, little: boolean): number {
  if (offset < 0 || offset + width > bytes.byteLength) throw failure();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const value = width === 2
    ? BigInt(view.getUint16(offset, little))
    : width === 4
      ? BigInt(view.getUint32(offset, little))
      : view.getBigUint64(offset, little);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw failure();
  return Number(value);
}

function currentElfMachine(): number {
  if (process.arch === "x64") return 62; // EM_X86_64
  if (process.arch === "arm64") return 183; // EM_AARCH64
  throw failure();
}

/**
 * Reject scripts, wrong-architecture objects and ELF binaries with PT_INTERP.
 * A runnable executable PT_LOAD segment is required: the closure is one file,
 * not an arbitrary blob that merely begins with an ELF identification header.
 */
function assertStaticElf(bytes: Uint8Array): void {
  if (
    bytes.byteLength < 64 ||
    bytes[0] !== 0x7f || bytes[1] !== 0x45 || bytes[2] !== 0x4c || bytes[3] !== 0x46
  ) throw failure();
  const elfClass = bytes[4];
  const encoding = bytes[5];
  if (elfClass !== 2 || encoding !== 1 || bytes[6] !== 1) throw failure();
  const objectType = unsigned(bytes, 16, 2, true);
  const machine = unsigned(bytes, 18, 2, true);
  const objectVersion = unsigned(bytes, 20, 4, true);
  const headerBytes = unsigned(bytes, 52, 2, true);
  const programOffset = unsigned(bytes, 32, 8, true);
  const entryBytes = unsigned(bytes, 54, 2, true);
  const entries = unsigned(bytes, 56, 2, true);
  if (
    (objectType !== 2 && objectType !== 3) ||
    machine !== currentElfMachine() ||
    objectVersion !== 1 ||
    headerBytes !== 64 ||
    programOffset < 64 ||
    entries < 1 ||
    entries > 4096 ||
    entryBytes < 56
  ) throw failure();
  let executableLoad = false;
  for (let index = 0; index < entries; index += 1) {
    const offset = programOffset + index * entryBytes;
    const type = unsigned(bytes, offset, 4, true);
    if (type === 3) throw failure(); // PT_INTERP
    if (type === 1 && (unsigned(bytes, offset + 4, 4, true) & 1) !== 0) {
      executableLoad = true;
    }
  }
  if (!executableLoad) throw failure();
}

async function verifyExecutable(
  pinned: PinnedLinuxExecutable,
  requireStatic: boolean,
): Promise<VerifiedExecutable> {
  const observed = await readStableExecutable(pinned.path);
  if (hashBytes(observed.bytes) !== pinned.hash) throw failure();
  if (requireStatic) assertStaticElf(observed.bytes);
  return { path: pinned.path, identity: observed.identity };
}

async function assertExecutableCurrent(
  pinned: PinnedLinuxExecutable,
  expected: VerifiedExecutable,
  requireStatic: boolean,
): Promise<void> {
  const observed = await verifyExecutable(pinned, requireStatic);
  if (observed.path !== expected.path || !sameFile(observed.identity, expected.identity)) {
    throw failure();
  }
}

async function fixedRuntimeRoot(pathValue: string): Promise<string> {
  if (!isAbsolute(pathValue) || resolve(pathValue) !== pathValue) throw failure();
  const stats = await lstat(pathValue, { bigint: true }).catch(() => {
    throw failure();
  });
  if (
    stats.isSymbolicLink() ||
    !stats.isDirectory() ||
    await realpath(pathValue) !== pathValue
  ) throw failure();
  return pathValue;
}

async function sweepRuntimeResidue(runtimeRoot: string): Promise<void> {
  const children = await readdir(runtimeRoot, { withFileTypes: true });
  for (const child of children) {
    if (!RUNTIME_RESIDUE.test(child.name)) throw failure();
    const path = join(runtimeRoot, child.name);
    const stats = await lstat(path, { bigint: true });
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw failure();
    await rm(path, { recursive: true, force: false });
  }
  const handle = await open(runtimeRoot, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function killProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      (error as { readonly code?: unknown }).code !== "ESRCH"
    ) throw error;
  }
}

async function boundedWait(work: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(failure()), TERMINATE_GRACE_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function sandboxArguments(
  workerPath: string,
  binding?: { readonly inputPath: string; readonly outputPath: string },
  probe = false,
): string[] {
  return [
    "--unshare-all",
    "--die-with-parent",
    "--new-session",
    "--cap-drop", "ALL",
    "--clearenv",
    "--tmpfs", "/",
    "--dir", "/app",
    "--dir", "/work",
    "--dir", "/tmp",
    "--ro-bind", workerPath, "/app/quarantine-worker",
    ...(binding === undefined
      ? []
      : [
          "--ro-bind", binding.inputPath, "/work/input",
          "--bind", binding.outputPath, "/work/output",
        ]),
    "--chdir", binding === undefined ? "/tmp" : "/work",
    "--",
    "/app/quarantine-worker",
    ...(probe ? ["--probe"] : []),
  ];
}

/** Prove that this exact pinned launcher can create the required namespace. */
async function probeIsolation(
  bubblewrap: VerifiedExecutable,
  worker: VerifiedExecutable,
  runtimeRoot: string,
): Promise<void> {
  const probeRoot = await mkdtemp(join(runtimeRoot, "probe-"));
  if (!strictDescendant(runtimeRoot, probeRoot)) {
    await rm(probeRoot, { recursive: true, force: true }).catch(() => undefined);
    throw failure();
  }
  try {
    await new Promise<void>((resolveProbe, rejectProbe) => {
      const child = spawn(bubblewrap.path, sandboxArguments(worker.path, undefined, true), {
        cwd: probeRoot,
        detached: true,
        env: {},
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let outputBytes = 0;
      let exceeded = false;
      let spawnFailed = false;
      let timedOut = false;
      let reapTimer: ReturnType<typeof setTimeout> | undefined;
      const terminateProbe = (): void => {
        try { killProcessTree(child); } catch { spawnFailed = true; }
        if (reapTimer === undefined) {
          reapTimer = setTimeout(() => rejectProbe(failure()), TERMINATE_GRACE_MS);
          reapTimer.unref();
        }
      };
      const observe = (chunk: Buffer): void => {
        outputBytes += chunk.byteLength;
        if (outputBytes > MAXIMUM_PROBE_OUTPUT_BYTES) {
          exceeded = true;
          terminateProbe();
        }
      };
      const timer = setTimeout(() => {
        timedOut = true;
        terminateProbe();
      }, PROBE_TIMEOUT_MS);
      child.stdout.on("data", observe);
      child.stderr.on("data", observe);
      child.once("error", () => { spawnFailed = true; });
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        if (reapTimer !== undefined) clearTimeout(reapTimer);
        if (
          !spawnFailed &&
          !timedOut &&
          !exceeded &&
          code === 0 &&
          signal === null
        ) resolveProbe();
        else rejectProbe(failure());
      });
    });
  } finally {
    await rm(probeRoot, { recursive: true, force: false });
  }
}

/**
 * Linux quarantine transport using a pinned bubblewrap and a single-file,
 * statically linked worker. No host root, network namespace, environment, or
 * caller path is exposed inside the sandbox.
 */
export class NodeBubblewrapQuarantineWorker implements QuarantineWorkerPort {
  public readonly isolationAvailable: boolean;
  readonly #options: NodeBubblewrapQuarantineWorkerOptions;
  readonly #runtimeRoot: string | undefined;
  readonly #bubblewrap: VerifiedExecutable | undefined;
  readonly #worker: VerifiedExecutable | undefined;
  readonly #maximumMessageBytes: number;
  readonly #active = new Map<string, ActiveProcess>();
  readonly #starting = new Map<string, StartingRequest>();

  private constructor(
    options: NodeBubblewrapQuarantineWorkerOptions,
    verified: {
      readonly runtimeRoot?: string;
      readonly bubblewrap?: VerifiedExecutable;
      readonly worker?: VerifiedExecutable;
    },
  ) {
    this.#options = options;
    this.#runtimeRoot = verified.runtimeRoot;
    this.#bubblewrap = verified.bubblewrap;
    this.#worker = verified.worker;
    this.isolationAvailable = process.platform === "linux" &&
      this.#runtimeRoot !== undefined &&
      this.#bubblewrap !== undefined &&
      this.#worker !== undefined;
    this.#maximumMessageBytes = options.maximumMessageBytes ?? DEFAULT_MAXIMUM_MESSAGE_BYTES;
  }

  /** Invalid or unsupported configuration yields a fail-closed unavailable port. */
  public static async create(
    options: NodeBubblewrapQuarantineWorkerOptions,
  ): Promise<NodeBubblewrapQuarantineWorker> {
    if (
      options.maximumMessageBytes !== undefined &&
      (!Number.isSafeInteger(options.maximumMessageBytes) ||
        options.maximumMessageBytes < 1 ||
        options.maximumMessageBytes > MAXIMUM_MESSAGE_BYTES)
    ) return new NodeBubblewrapQuarantineWorker(options, {});
    if (process.platform !== "linux" || options.worker.staticallyLinked !== true) {
      return new NodeBubblewrapQuarantineWorker(options, {});
    }
    try {
      const [runtimeRoot, bubblewrap, worker] = await Promise.all([
        fixedRuntimeRoot(options.runtimeRoot),
        verifyExecutable(options.bubblewrap, false),
        verifyExecutable(options.worker, true),
      ]);
      await sweepRuntimeResidue(runtimeRoot);
      await probeIsolation(bubblewrap, worker, runtimeRoot);
      return new NodeBubblewrapQuarantineWorker(options, { runtimeRoot, bubblewrap, worker });
    } catch {
      return new NodeBubblewrapQuarantineWorker(options, {});
    }
  }

  public async execute(request: QuarantineRequest): Promise<unknown> {
    try {
      validateQuarantineRequest(request);
    } catch {
      throw failure();
    }
    if (
      !this.isolationAvailable ||
      this.#runtimeRoot === undefined ||
      this.#bubblewrap === undefined ||
      this.#worker === undefined ||
      this.#active.has(request.requestId) ||
      this.#starting.has(request.requestId)
    ) throw failure();
    let settleStarting: (() => void) | undefined;
    const starting: StartingRequest = {
      canceled: false,
      settled: new Promise<void>((resolve) => { settleStarting = resolve; }),
      settle: () => settleStarting?.(),
    };
    this.#starting.set(request.requestId, starting);
    let runtimeRoot: string | undefined;
    let child: ChildProcessWithoutNullStreams | undefined;
    try {
      await Promise.all([
        assertExecutableCurrent(this.#options.bubblewrap, this.#bubblewrap, false),
        assertExecutableCurrent(this.#options.worker, this.#worker, true),
      ]);
      if (starting.canceled) throw failure();
      const binding = await this.#options.handles.bindForWorker(request);
      if (starting.canceled) throw failure();
      runtimeRoot = await mkdtemp(join(this.#runtimeRoot, `${request.requestId}-`));
      if (!strictDescendant(this.#runtimeRoot, runtimeRoot)) {
        await rm(runtimeRoot, { recursive: true, force: true }).catch(() => undefined);
        runtimeRoot = undefined;
        throw failure();
      }
      if (starting.canceled) {
        await rm(runtimeRoot, { recursive: true, force: false });
        runtimeRoot = undefined;
        throw failure();
      }
      const spawned = spawn(this.#bubblewrap.path, sandboxArguments(this.#worker.path, binding), {
        cwd: runtimeRoot,
        detached: true,
        env: {},
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      child = spawned;
      let closeResolve: (() => void) | undefined;
      const closed = new Promise<void>((resolve) => { closeResolve = resolve; });
      const active: ActiveProcess = { child: spawned, runtimeRoot, closed };
      this.#active.set(request.requestId, active);
      this.#starting.delete(request.requestId);
      starting.settle();

      const response = await new Promise<unknown>((resolveResponse, rejectResponse) => {
        const stdout: Buffer[] = [];
        let outputBytes = 0;
        let exceeded = false;
        let reapTimer: ReturnType<typeof setTimeout> | undefined;
        const terminateForLimit = (): void => {
          try { killProcessTree(spawned); } catch { /* close/reap rejects below */ }
          if (reapTimer === undefined) {
            reapTimer = setTimeout(() => rejectResponse(failure()), TERMINATE_GRACE_MS);
            reapTimer.unref();
          }
        };
        const accept = (chunk: Buffer): void => {
          outputBytes += chunk.byteLength;
          if (outputBytes > this.#maximumMessageBytes) {
            exceeded = true;
            terminateForLimit();
          } else {
            stdout.push(Buffer.from(chunk));
          }
        };
        spawned.stdout.on("data", accept);
        spawned.stderr.on("data", (chunk: Buffer) => {
          outputBytes += chunk.byteLength;
          if (outputBytes > this.#maximumMessageBytes) {
            exceeded = true;
            terminateForLimit();
          }
        });
        spawned.once("error", () => rejectResponse(failure()));
        spawned.once("close", (code, signal) => {
          if (reapTimer !== undefined) clearTimeout(reapTimer);
          closeResolve?.();
          if (exceeded || code !== 0 || signal !== null) {
            rejectResponse(failure());
            return;
          }
          try {
            const text = UTF8.decode(Buffer.concat(stdout));
            resolveResponse(JSON.parse(text) as unknown);
          } catch {
            rejectResponse(failure());
          }
        });
        const message = Buffer.from(JSON.stringify(request), "utf8");
        if (message.byteLength > this.#maximumMessageBytes) {
          terminateForLimit();
          rejectResponse(failure());
          return;
        }
        spawned.stdin.once("error", () => undefined);
        spawned.stdin.end(message);
      });
      await rm(runtimeRoot, { recursive: true, force: false });
      this.#active.delete(request.requestId);
      return response;
    } catch (error) {
      if (child !== undefined) {
        try { killProcessTree(child); } catch { /* terminate repeats and reports */ }
      } else if (runtimeRoot !== undefined) {
        await rm(runtimeRoot, { recursive: true, force: false }).catch(() => undefined);
      }
      throw error;
    } finally {
      if (this.#starting.get(request.requestId) === starting) {
        this.#starting.delete(request.requestId);
        starting.settle();
      }
    }
  }

  public async terminate(requestId: string): Promise<void> {
    const starting = this.#starting.get(requestId);
    if (starting !== undefined) {
      starting.canceled = true;
      await boundedWait(starting.settled);
    }
    const active = this.#active.get(requestId);
    if (active === undefined) return;
    killProcessTree(active.child);
    await boundedWait(active.closed);
    await rm(active.runtimeRoot, { recursive: true, force: false });
    this.#active.delete(requestId);
  }
}
