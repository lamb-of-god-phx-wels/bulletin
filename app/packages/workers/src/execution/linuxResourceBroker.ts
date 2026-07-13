import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { hexToSha256Hash, type Sha256Hash } from "@cbb/core";

const HASH = /^sha256:[0-9a-f]{64}$/u;
const MAX_EXECUTABLE_BYTES = 512 * 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;
const CAPABILITY_TIMEOUT_MS = 5_000;
const TERMINATION_GRACE_MS = 2_000;
const MAX_CAPABILITY_BYTES = 4 * 1024;
const MAX_QUOTA_BYTES = 8 * 1024 * 1024 * 1024;

export const LINUX_RESOURCE_BROKER_CAPABILITY_ARGUMENT =
  "--cbb-linux-resource-broker-capabilities-v1" as const;
export const LINUX_RESOURCE_BROKER_EXECUTION_ARGUMENT =
  "--cbb-linux-resource-broker-execute-v1" as const;
export const LINUX_RESOURCE_BROKER_SANDBOX_ARGUMENT =
  "--cbb-sandbox-argv-v1" as const;

export interface PinnedLinuxResourceBroker {
  readonly path: string;
  readonly hash: Sha256Hash;
}

/** Limits the signed broker must install before it executes the sandboxed process. */
export interface LinuxResourceLimits {
  readonly cpuSeconds: number;
  readonly addressSpaceBytes: number;
  readonly processCount: number;
  readonly fileSizeBytes: number;
  readonly openFileCount: number;
  readonly scratchBytes: number;
  readonly outputBytes: number;
}

export interface LinuxResourceBrokerPaths {
  readonly scratchPath: string;
  /** May name either the fixed output file or its fixed output directory. */
  readonly outputPath: string;
  /** Optional signed exact-tree manifest reverified by the broker before mount. */
  readonly runtimeClosure?: Readonly<{
    manifestPath: string;
    manifestHash: Sha256Hash;
  }>;
}

export const LINUX_RESOURCE_LIMITS = Object.freeze({
  quarantine: Object.freeze({
    cpuSeconds: 120,
    addressSpaceBytes: 1024 * 1024 * 1024,
    processCount: 16,
    fileSizeBytes: 1024 * 1024 * 1024,
    openFileCount: 256,
    scratchBytes: 256 * 1024 * 1024,
    // Archives may contain 4 GiB aggregate output while each regular entry is
    // still capped independently at 1 GiB by the closed worker protocol.
    outputBytes: 4 * 1024 * 1024 * 1024,
  }),
  typst: Object.freeze({
    cpuSeconds: 30,
    addressSpaceBytes: 2 * 1024 * 1024 * 1024,
    processCount: 32,
    fileSizeBytes: 1024 * 1024 * 1024,
    openFileCount: 512,
    // 4 GiB assets + 1 GiB fonts + 1 GiB generated source + 1 GiB PDF,
    // with bounded filesystem overhead, must remain representable.
    scratchBytes: 8 * 1024 * 1024 * 1024,
    outputBytes: 1024 * 1024 * 1024,
  }),
  pdfInspect: Object.freeze({
    cpuSeconds: 30,
    addressSpaceBytes: 1024 * 1024 * 1024,
    processCount: 16,
    fileSizeBytes: 1024 * 1024 * 1024,
    openFileCount: 256,
    scratchBytes: 2 * 1024 * 1024 * 1024,
    outputBytes: 1024 * 1024 * 1024,
  }),
  pdfFlatten: Object.freeze({
    cpuSeconds: 30,
    addressSpaceBytes: 2 * 1024 * 1024 * 1024,
    processCount: 32,
    fileSizeBytes: 500 * 1024 * 1024,
    openFileCount: 512,
    scratchBytes: 1024 * 1024 * 1024,
    outputBytes: 500 * 1024 * 1024,
  }),
  probe: Object.freeze({
    cpuSeconds: 5,
    addressSpaceBytes: 256 * 1024 * 1024,
    processCount: 8,
    fileSizeBytes: 16 * 1024 * 1024,
    openFileCount: 64,
    scratchBytes: 16 * 1024 * 1024,
    outputBytes: 16 * 1024 * 1024,
  }),
} as const satisfies Readonly<Record<string, LinuxResourceLimits>>);

export class LinuxResourceBrokerError extends Error {
  readonly code = "CBB-SECURITY-0001" as const;

  constructor() {
    super("The signed Linux resource broker is unavailable or invalid");
    this.name = "LinuxResourceBrokerError";
  }
}

function failure(): LinuxResourceBrokerError {
  return new LinuxResourceBrokerError();
}

function sameFile(
  left: { readonly dev: bigint; readonly ino: bigint },
  right: { readonly dev: bigint; readonly ino: bigint },
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

/** Rehash the exact signed broker without following a final symlink. */
export async function assertLinuxResourceBrokerCurrent(
  identity: PinnedLinuxResourceBroker,
): Promise<void> {
  try {
    if (
      process.platform !== "linux" ||
      identity === null ||
      typeof identity !== "object" ||
      !isAbsolute(identity.path) ||
      resolve(identity.path) !== identity.path ||
      !HASH.test(identity.hash) ||
      typeof constants.O_NOFOLLOW !== "number" ||
      constants.O_NOFOLLOW === 0
    ) throw failure();
    const before = await lstat(identity.path, { bigint: true });
    if (
      before.isSymbolicLink() ||
      !before.isFile() ||
      before.nlink !== 1n ||
      before.size < 1n ||
      before.size > BigInt(MAX_EXECUTABLE_BYTES) ||
      (Number(before.mode) & 0o111) === 0 ||
      await realpath(identity.path) !== identity.path
    ) throw failure();
    const handle = await open(identity.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat({ bigint: true });
      if (!opened.isFile() || opened.nlink !== 1n || !sameFile(before, opened)) throw failure();
      const digest = createHash("sha256");
      const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
      let byteSize = 0;
      let position = 0;
      while (true) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, position);
        if (bytesRead === 0) break;
        byteSize += bytesRead;
        if (byteSize > MAX_EXECUTABLE_BYTES) throw failure();
        digest.update(buffer.subarray(0, bytesRead));
        position += bytesRead;
      }
      const after = await handle.stat({ bigint: true });
      if (
        after.nlink !== 1n ||
        after.size !== BigInt(byteSize) ||
        !sameFile(opened, after) ||
        hexToSha256Hash(digest.digest("hex")) !== identity.hash
      ) throw failure();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof LinuxResourceBrokerError) throw error;
    throw failure();
  }
}

function killProcessTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // A concurrently reaped child needs no further action.
    }
  }
}

interface BoundedProcessResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
  readonly timedOut: boolean;
  readonly overLimit: boolean;
  readonly terminationFailed: boolean;
}

/**
 * A process deadline includes a bounded SIGKILL/reap grace. The caller never
 * waits indefinitely for a child that fails to emit `close` after termination.
 */
export function runBoundedLinuxProcess(options: {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly timeoutMs: number;
  readonly maximumOutputBytes: number;
  readonly cwd?: string;
}): Promise<BoundedProcessResult> {
  return new Promise((resolveProcess) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let byteSize = 0;
    let timedOut = false;
    let overLimit = false;
    let settled = false;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const child = spawn(options.executable, [...options.arguments], {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      detached: true,
      env: {},
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const settle = (
      code: number | null,
      signal: NodeJS.Signals | null,
      terminationFailed: boolean,
    ): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (grace !== undefined) clearTimeout(grace);
      child.stdout?.removeAllListeners();
      child.stderr?.removeAllListeners();
      resolveProcess({
        code,
        signal,
        stdout: new Uint8Array(Buffer.concat(stdout)),
        stderr: new Uint8Array(Buffer.concat(stderr)),
        timedOut,
        overLimit,
        terminationFailed,
      });
    };
    const terminate = (): void => {
      killProcessTree(child);
      if (grace === undefined) {
        grace = setTimeout(
          () => settle(null, null, true),
          TERMINATION_GRACE_MS,
        );
      }
    };
    const collect = (target: Buffer[], chunk: Buffer): void => {
      byteSize += chunk.byteLength;
      if (byteSize > options.maximumOutputBytes) {
        overLimit = true;
        terminate();
        return;
      }
      target.push(Buffer.from(chunk));
    };
    child.stdout?.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr?.on("data", (chunk: Buffer) => collect(stderr, chunk));
    child.once("error", () => settle(null, null, false));
    child.once("close", (code, signal) => settle(code, signal, false));
    const deadline = setTimeout(() => {
      timedOut = true;
      terminate();
    }, options.timeoutMs);
  });
}

function validCapabilities(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  const expected = [
    "kind", "version", "cpuTime", "addressSpace", "processCount", "fileSize",
    "openFiles", "scratchQuota", "outputQuota", "mountIsolation", "networkIsolation",
    "processTreeTermination", "runtimeClosureVerification",
  ];
  const keys = Reflect.ownKeys(raw);
  return Object.getPrototypeOf(raw) === Object.prototype &&
    keys.length === expected.length &&
    keys.every((key) => typeof key === "string" && expected.includes(key)) &&
    raw["kind"] === "cbbLinuxResourceBrokerCapabilities" &&
    raw["version"] === 1 &&
    expected.slice(2).every((key) => raw[key] === true);
}

/** Require the exact v1 capability handshake; plain Bubblewrap fails closed. */
export async function verifyLinuxResourceBroker(
  identity: PinnedLinuxResourceBroker,
): Promise<void> {
  await assertLinuxResourceBrokerCurrent(identity);
  const result = await runBoundedLinuxProcess({
    executable: identity.path,
    arguments: [LINUX_RESOURCE_BROKER_CAPABILITY_ARGUMENT],
    timeoutMs: CAPABILITY_TIMEOUT_MS,
    maximumOutputBytes: MAX_CAPABILITY_BYTES,
  });
  if (
    result.code !== 0 ||
    result.signal !== null ||
    result.timedOut ||
    result.overLimit ||
    result.terminationFailed ||
    result.stderr.byteLength !== 0
  ) throw failure();
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(result.stdout);
    if (!validCapabilities(JSON.parse(text) as unknown)) throw failure();
  } catch (error) {
    if (error instanceof LinuxResourceBrokerError) throw error;
    throw failure();
  }
}

function positiveInteger(value: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= maximum;
}

/**
 * Construct the only accepted v1 broker invocation. The signed helper contract
 * requires it to validate this exact prefix, install RLIMIT_CPU, RLIMIT_AS,
 * RLIMIT_NPROC, RLIMIT_FSIZE and RLIMIT_NOFILE (or stricter cgroup equivalents),
 * activate scratch/output byte accounting, reverify any supplied signed runtime
 * closure immediately before mounting it, and create mount/network isolation
 * before interpreting `--cbb-sandbox-argv-v1` or executing any child. Failure
 * to install any control must exit nonzero; degradation to plain Bubblewrap is
 * forbidden. No caller command text is evaluated by this adapter.
 */
export function linuxResourceBrokerArguments(
  sandboxArguments: readonly string[],
  limits: LinuxResourceLimits,
  paths: LinuxResourceBrokerPaths,
): readonly string[] {
  if (
    !Array.isArray(sandboxArguments) ||
    sandboxArguments.length < 1 ||
    sandboxArguments.length > 4_096 ||
    sandboxArguments.some((value) => typeof value !== "string" || value.includes("\0")) ||
    !positiveInteger(limits.cpuSeconds, 15 * 60) ||
    !positiveInteger(limits.addressSpaceBytes, MAX_QUOTA_BYTES) ||
    !positiveInteger(limits.processCount, 1_024) ||
    !positiveInteger(limits.fileSizeBytes, MAX_QUOTA_BYTES) ||
    !positiveInteger(limits.openFileCount, 4_096) ||
    !positiveInteger(limits.scratchBytes, MAX_QUOTA_BYTES) ||
    !positiveInteger(limits.outputBytes, MAX_QUOTA_BYTES) ||
    !isAbsolute(paths.scratchPath) ||
    resolve(paths.scratchPath) !== paths.scratchPath ||
    !isAbsolute(paths.outputPath) ||
    resolve(paths.outputPath) !== paths.outputPath ||
    (paths.runtimeClosure !== undefined && (
      !isAbsolute(paths.runtimeClosure.manifestPath) ||
      resolve(paths.runtimeClosure.manifestPath) !== paths.runtimeClosure.manifestPath ||
      !HASH.test(paths.runtimeClosure.manifestHash)
    ))
  ) throw failure();
  return Object.freeze([
    LINUX_RESOURCE_BROKER_EXECUTION_ARGUMENT,
    "--cpu-seconds", limits.cpuSeconds.toString(10),
    "--address-space-bytes", limits.addressSpaceBytes.toString(10),
    "--process-count", limits.processCount.toString(10),
    "--file-size-bytes", limits.fileSizeBytes.toString(10),
    "--open-file-count", limits.openFileCount.toString(10),
    "--scratch-path", paths.scratchPath,
    "--scratch-bytes", limits.scratchBytes.toString(10),
    "--output-path", paths.outputPath,
    "--output-bytes", limits.outputBytes.toString(10),
    ...(paths.runtimeClosure === undefined
      ? []
      : [
          "--runtime-manifest-path", paths.runtimeClosure.manifestPath,
          "--runtime-manifest-hash", paths.runtimeClosure.manifestHash,
        ]),
    LINUX_RESOURCE_BROKER_SANDBOX_ARGUMENT,
    ...sandboxArguments,
  ]);
}
