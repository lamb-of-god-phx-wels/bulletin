import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, realpath, rename, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { hexToSha256Hash, type Sha256Hash } from "@cbb/core";
import type {
  PdfInspectorIdentity,
  PinnedPdfInspection,
  PinnedPdfInspectorPort,
} from "./nodeAdapters.js";

const MAX_BYTES = 1024 * 1024 * 1024;
const MAX_OUTPUT = 1024 * 1024;
const HASH = /^sha256:[0-9a-f]{64}$/u;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export type NodePdfInfoInspectorErrorKind =
  | "invalidConfiguration"
  | "isolationUnavailable"
  | "componentVerificationFailed"
  | "invalidPdf"
  | "inspectionFailed";

export class NodePdfInfoInspectorError extends Error {
  readonly code = "CBB-SECURITY-0001" as const;

  constructor(public readonly kind: NodePdfInfoInspectorErrorKind) {
    super("Pinned PDF inspection failed");
    this.name = "NodePdfInfoInspectorError";
  }
}

export interface NodePdfInfoInspectorOptions {
  readonly privateInspectionParent: string;
  readonly pdfinfo: {
    readonly path: string;
    readonly toolId: string;
    readonly version: string;
    readonly hash: Sha256Hash;
  };
  readonly bubblewrap: { readonly path: string; readonly hash: Sha256Hash };
}

interface ProcessResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly overLimit: boolean;
}

function fail(kind: NodePdfInfoInspectorErrorKind): never {
  throw new NodePdfInfoInspectorError(kind);
}

function sameFile(
  left: { readonly dev: bigint; readonly ino: bigint },
  right: { readonly dev: bigint; readonly ino: bigint },
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

async function stableHash(path: string): Promise<Sha256Hash> {
  const before = await lstat(path, { bigint: true });
  if (
    before.isSymbolicLink() || !before.isFile() || before.nlink !== 1n ||
    before.size < 1n || before.size > BigInt(MAX_BYTES)
  ) fail("componentVerificationFailed");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n || !sameFile(before, opened)) {
      fail("componentVerificationFailed");
    }
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let observed = 0;
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, position);
      if (bytesRead === 0) break;
      observed += bytesRead;
      if (observed > MAX_BYTES) fail("componentVerificationFailed");
      digest.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (after.nlink !== 1n || after.size !== BigInt(observed) || !sameFile(opened, after)) {
      fail("componentVerificationFailed");
    }
    return hexToSha256Hash(digest.digest("hex"));
  } finally {
    await handle.close();
  }
}

async function installInput(path: string, bytes: Uint8Array): Promise<void> {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    let position = 0;
    while (position < bytes.byteLength) {
      const { bytesWritten } = await handle.write(bytes, position, bytes.byteLength - position, position);
      if (bytesWritten < 1) fail("inspectionFailed");
      position += bytesWritten;
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function sweepAbandonedInspectionRoots(parent: string): Promise<void> {
  const children = await readdir(parent, { withFileTypes: true });
  for (const child of children) {
    const original = join(parent, child.name);
    const identifier = child.name.startsWith(".sweep-") ? child.name.slice(7) : child.name;
    if (!UUID_V4.test(identifier)) fail("invalidConfiguration");
    const stats = await lstat(original, { bigint: true });
    if (stats.isSymbolicLink() || !stats.isDirectory()) fail("invalidConfiguration");
    const tomb = child.name.startsWith(".sweep-")
      ? original
      : join(parent, `.sweep-${child.name}`);
    if (tomb !== original) await rename(original, tomb);
    const moved = await lstat(tomb, { bigint: true });
    if (moved.isSymbolicLink() || !moved.isDirectory()) fail("invalidConfiguration");
    await rm(tomb, { recursive: true, force: false });
  }
  await syncDirectory(parent);
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

async function runBounded(executable: string, args: readonly string[], timeoutMs = 30_000): Promise<ProcessResult> {
  return new Promise<ProcessResult>((resolveProcess) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let observed = 0;
    let overLimit = false;
    let settled = false;
    let reapTimeout: ReturnType<typeof setTimeout> | undefined;
    const child = spawn(executable, [...args], {
      detached: true,
      env: {},
      stdio: ["ignore", "pipe", "pipe"],
    });
    const settle = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (reapTimeout !== undefined) clearTimeout(reapTimeout);
      resolveProcess({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        overLimit,
      });
    };
    const terminate = () => {
      overLimit = true;
      try {
        killTree(child);
      } catch {
        settle(null);
      } finally {
        if (reapTimeout === undefined) {
          reapTimeout = setTimeout(() => settle(null), 5_000);
          reapTimeout.unref();
        }
      }
    };
    const timeout = setTimeout(() => {
      terminate();
    }, timeoutMs);
    timeout.unref();
    const collect = (target: Buffer[], chunk: Buffer) => {
      observed += chunk.byteLength;
      if (observed > MAX_OUTPUT) {
        terminate();
      } else {
        target.push(Buffer.from(chunk));
      }
    };
    child.stdout?.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr?.on("data", (chunk: Buffer) => collect(stderr, chunk));
    child.once("error", () => settle(null));
    child.once("close", (code) => settle(code));
  });
}

function sandboxArgs(
  options: NodePdfInfoInspectorOptions,
  runRoot?: string,
): string[] {
  const args = [
    "--unshare-all", "--die-with-parent", "--new-session", "--cap-drop", "ALL",
    "--ro-bind", "/usr", "/usr",
    "--ro-bind-try", "/lib", "/lib",
    "--ro-bind-try", "/lib64", "/lib64",
    "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
  ];
  if (runRoot === undefined) return [...args, "--clearenv", "--", "/usr/bin/true"];
  return [
    ...args,
    "--dir", "/tool", "--ro-bind", options.pdfinfo.path, "/tool/pdfinfo",
    "--ro-bind", runRoot, "/inspect", "--chdir", "/inspect",
    "--clearenv", "--setenv", "LANG", "C",
    "--", "/tool/pdfinfo", "/inspect/input.pdf",
  ];
}

function outputField(output: string, name: string): string | undefined {
  const prefix = `${name}:`;
  return output.split(/\r?\n/u).find((line) => line.startsWith(prefix))?.slice(prefix.length).trim();
}

function parseInspection(output: string): PinnedPdfInspection {
  const pageText = outputField(output, "Pages");
  const pdfVersion = outputField(output, "PDF version");
  const encrypted = outputField(output, "Encrypted");
  const form = outputField(output, "Form");
  const javascript = outputField(output, "JavaScript");
  const pageCount = pageText === undefined ? Number.NaN : Number(pageText);
  if (
    !Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > 1_000 ||
    pdfVersion === undefined || !/^(?:1\.[0-7]|2\.0)$/u.test(pdfVersion) ||
    encrypted === undefined || !/^no$/iu.test(encrypted) ||
    form === undefined || !/^none$/iu.test(form) ||
    javascript === undefined || !/^no$/iu.test(javascript)
  ) fail("invalidPdf");
  const standards: string[] = [];
  const subtype = outputField(output, "PDF subtype");
  if (subtype !== undefined && subtype !== "none") {
    if (!/^[A-Za-z0-9][A-Za-z0-9._+:/-]{0,127}$/u.test(subtype)) fail("invalidPdf");
    standards.push(subtype);
  }
  return Object.freeze({ pageCount, pdfVersion, standards: Object.freeze(standards) });
}

/** Hash-pinned Poppler inspection in a no-network, single-input sandbox. */
export class NodePdfInfoInspector implements PinnedPdfInspectorPort {
  readonly identity: PdfInspectorIdentity;

  private constructor(
    private readonly parent: string,
    private readonly options: NodePdfInfoInspectorOptions,
  ) {
    this.identity = Object.freeze({
      toolId: options.pdfinfo.toolId,
      version: options.pdfinfo.version,
      hash: options.pdfinfo.hash,
    });
  }

  static async create(options: NodePdfInfoInspectorOptions): Promise<NodePdfInfoInspector> {
    try {
      if (
        process.platform !== "linux" || !isAbsolute(options.privateInspectionParent) ||
        !isAbsolute(options.pdfinfo.path) || !isAbsolute(options.bubblewrap.path) ||
        !/^[A-Za-z0-9][A-Za-z0-9_.+:-]{0,127}$/u.test(options.pdfinfo.toolId) ||
        !/^[A-Za-z0-9][A-Za-z0-9_.+:-]{0,127}$/u.test(options.pdfinfo.version) ||
        !HASH.test(options.pdfinfo.hash) || !HASH.test(options.bubblewrap.hash)
      ) fail("invalidConfiguration");
      await mkdir(options.privateInspectionParent, { recursive: true, mode: 0o700 });
      await chmod(options.privateInspectionParent, 0o700);
      const parent = await realpath(options.privateInspectionParent);
      const stats = await lstat(parent, { bigint: true });
      if (stats.isSymbolicLink() || !stats.isDirectory()) fail("invalidConfiguration");
      await sweepAbandonedInspectionRoots(parent);
      const [pdfinfoHash, bubblewrapHash] = await Promise.all([
        stableHash(options.pdfinfo.path), stableHash(options.bubblewrap.path),
      ]);
      if (pdfinfoHash !== options.pdfinfo.hash || bubblewrapHash !== options.bubblewrap.hash) {
        fail("componentVerificationFailed");
      }
      const probe = await runBounded(options.bubblewrap.path, sandboxArgs(options), 5_000);
      if (probe.code !== 0 || probe.overLimit) fail("isolationUnavailable");
      return new NodePdfInfoInspector(parent, options);
    } catch (error) {
      if (error instanceof NodePdfInfoInspectorError) throw error;
      fail("isolationUnavailable");
    }
  }

  async inspect(bytes: Uint8Array): Promise<PinnedPdfInspection> {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 13 || bytes.byteLength > MAX_BYTES) {
      fail("invalidPdf");
    }
    const [pdfinfoHash, bubblewrapHash] = await Promise.all([
      stableHash(this.options.pdfinfo.path), stableHash(this.options.bubblewrap.path),
    ]);
    if (pdfinfoHash !== this.options.pdfinfo.hash || bubblewrapHash !== this.options.bubblewrap.hash) {
      fail("componentVerificationFailed");
    }
    const runRoot = join(this.parent, randomUUID());
    await mkdir(runRoot, { recursive: false, mode: 0o700 });
    try {
      await installInput(join(runRoot, "input.pdf"), new Uint8Array(bytes));
      const result = await runBounded(this.options.bubblewrap.path, sandboxArgs(this.options, runRoot));
      if (result.code !== 0 || result.overLimit || result.stderr.length > MAX_OUTPUT) {
        fail("inspectionFailed");
      }
      return parseInspection(result.stdout);
    } finally {
      await rm(runRoot, { recursive: true, force: true });
    }
  }
}
