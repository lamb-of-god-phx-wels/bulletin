import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { hexToSha256Hash, type Sha256Hash } from "@cbb/core";
import {
  LINUX_RESOURCE_LIMITS,
  linuxResourceBrokerArguments,
  runBoundedLinuxProcess,
  verifyLinuxResourceBroker,
  type PinnedLinuxResourceBroker,
} from "../execution/linuxResourceBroker.js";
import {
  assertPdfRuntimeClosureCurrent,
  pdfRuntimeCommand,
  pdfRuntimeMountArguments,
  verifyPdfRuntimeClosure,
  type PinnedPdfRuntimeComponent,
  type VerifiedPdfRuntimeClosure,
} from "../execution/pdfRuntimeClosure.js";
import type { QuarantineWorkerPort } from "./broker.js";
import type { NodeQuarantineHandleStore } from "./nodeHandles.js";
import {
  validateQuarantineRequest,
  type FlattenPdfRequest,
  type QuarantineRequest,
} from "./protocol.js";

const HASH = /^sha256:[0-9a-f]{64}$/u;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAXIMUM_RUNTIME_MS = 120_000;
const DEFAULT_RUNTIME_MS = 30_000;
const MAXIMUM_IPC_BYTES = 1024 * 1024;
const TERMINATION_GRACE_MS = 5_000;
const READ_CHUNK_BYTES = 64 * 1024;

export interface PinnedPdfTool extends PinnedPdfRuntimeComponent {
  readonly version: string;
}

export interface NodeLinuxPdfFlattenWorkerOptions {
  readonly executionBroker: PinnedLinuxResourceBroker;
  readonly flattener: PinnedPdfTool;
  readonly inspector: PinnedPdfTool;
  readonly structuralInspector: PinnedPdfTool;
  readonly runtimeManifest: PinnedPdfRuntimeComponent;
  readonly privateRuntimeRoot: string;
  readonly handles: NodeQuarantineHandleStore;
  readonly maximumRuntimeMs?: number;
}

interface CurrentProcess {
  readonly child: ChildProcess;
  readonly closed: Promise<void>;
}

interface RequestEntry {
  canceled: boolean;
  current?: CurrentProcess;
}

interface ProcessResult {
  readonly stdout: string;
  readonly stderr: string;
}

interface StableInputIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
}

export class NodeLinuxPdfFlattenWorkerError extends Error {
  readonly code = "CBB-SECURITY-0001" as const;

  constructor() {
    super("The isolated PDF flattening worker failed closed");
    this.name = "NodeLinuxPdfFlattenWorkerError";
  }
}

function fail(): never {
  throw new NodeLinuxPdfFlattenWorkerError();
}

function sameInput(left: StableInputIdentity, right: StableInputIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

async function inputIdentity(path: string, maximumBytes: number): Promise<StableInputIdentity> {
  const stats = await lstat(path, { bigint: true });
  if (
    stats.isSymbolicLink() || !stats.isFile() || stats.nlink !== 1n ||
    stats.size < 13n || stats.size > BigInt(maximumBytes) || await realpath(path) !== path
  ) fail();
  return {
    dev: stats.dev,
    ino: stats.ino,
    size: stats.size,
    mtimeNs: stats.mtimeNs,
    ctimeNs: stats.ctimeNs,
  };
}

async function stablePdf(path: string, maximumBytes: number): Promise<{
  readonly hash: Sha256Hash;
  readonly byteSize: number;
}> {
  const before = await lstat(path, { bigint: true });
  if (
    before.isSymbolicLink() || !before.isFile() || before.nlink !== 1n ||
    before.size < 13n || before.size > BigInt(maximumBytes)
  ) fail();
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n || opened.dev !== before.dev || opened.ino !== before.ino) fail();
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
    let position = 0;
    let magic = Buffer.alloc(0);
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, position);
      if (bytesRead === 0) break;
      if (position === 0) magic = Buffer.from(buffer.subarray(0, Math.min(bytesRead, 8)));
      position += bytesRead;
      if (position > maximumBytes) fail();
      digest.update(buffer.subarray(0, bytesRead));
    }
    const after = await handle.stat({ bigint: true });
    if (
      after.dev !== opened.dev || after.ino !== opened.ino || after.nlink !== 1n ||
      after.size !== BigInt(position) || !magic.subarray(0, 5).equals(Buffer.from("%PDF-"))
    ) fail();
    return { hash: hexToSha256Hash(digest.digest("hex")), byteSize: position };
  } finally {
    await handle.close();
  }
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try { child.kill("SIGKILL"); } catch { /* already reaped */ }
  }
}

async function boundedWait(work: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new NodeLinuxPdfFlattenWorkerError()), TERMINATION_GRACE_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function field(output: string, name: string): string | undefined {
  const prefix = `${name}:`;
  return output.split(/\r?\n/u).find((line) => line.startsWith(prefix))?.slice(prefix.length).trim();
}

function inspectPdfInfo(
  output: string,
  pageLimit: number,
  requireFlattened: boolean,
): { readonly pages: number; readonly version: string } {
  const pages = Number(field(output, "Pages"));
  const version = field(output, "PDF version");
  const encrypted = field(output, "Encrypted");
  if (
    !Number.isSafeInteger(pages) || pages < 1 || pages > pageLimit ||
    version === undefined || !/^(?:1\.[0-7]|2\.0)$/u.test(version) ||
    encrypted === undefined || !/^no$/iu.test(encrypted)
  ) fail();
  if (requireFlattened) {
    const form = field(output, "Form");
    const javascript = field(output, "JavaScript");
    if (form === undefined || !/^none$/iu.test(form) || javascript === undefined || !/^no$/iu.test(javascript)) {
      fail();
    }
  }
  return { pages, version };
}

const FORBIDDEN_DERIVATIVE_NAMES = new Set([
  "/A", "/AA", "/OpenAction", "/AcroForm", "/XFA", "/Widget", "/Annots",
  "/JS", "/JavaScript", "/Launch", "/URI", "/GoToR", "/SubmitForm",
  "/ImportData", "/EmbeddedFiles", "/EmbeddedFile", "/Filespec", "/EF",
  "/RichMedia", "/Sound", "/Movie", "/Screen", "/3D",
]);

function inspectStructuralJson(output: string, expectedPages: number): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output) as unknown;
  } catch {
    fail();
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) fail();
  const pages = (parsed as Record<string, unknown>)["pages"];
  if (!Array.isArray(pages) || pages.length !== expectedPages) fail();
  let nodes = 0;
  const visit = (value: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > 200_000 || depth > 128) fail();
    if (typeof value === "string") {
      if (FORBIDDEN_DERIVATIVE_NAMES.has(value)) fail();
      return;
    }
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) fail();
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_DERIVATIVE_NAMES.has(key)) fail();
      visit(item, depth + 1);
    }
  };
  visit(parsed, 0);
}

function sandboxArguments(
  closure: VerifiedPdfRuntimeClosure,
  tool: PinnedPdfTool,
  toolArguments: readonly string[],
  inputPath?: string,
  outputPath?: string,
): readonly string[] {
  return Object.freeze([
    "--unshare-all", "--die-with-parent", "--new-session", "--cap-drop", "ALL",
    "--clearenv", "--tmpfs", "/",
    ...pdfRuntimeMountArguments(closure),
    "--dir", "/work", "--tmpfs", "/tmp", "--proc", "/proc", "--dev", "/dev",
    ...(inputPath === undefined ? [] : ["--ro-bind", inputPath, "/work/input.pdf"]),
    ...(outputPath === undefined ? [] : ["--bind", outputPath, "/work/output.pdf"]),
    "--chdir", "/work",
    "--setenv", "HOME", "/tmp",
    "--setenv", "TMPDIR", "/tmp",
    "--setenv", "XDG_CACHE_HOME", "/tmp/cache",
    "--setenv", "FONTCONFIG_PATH", "/runtime/etc/fonts",
    "--setenv", "LANG", "C",
    "--",
    ...pdfRuntimeCommand(closure, tool.path, toolArguments),
  ]);
}

async function prepareRuntimeRoot(path: string): Promise<string> {
  if (!isAbsolute(path) || resolve(path) !== path) fail();
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
  const root = await realpath(path);
  if (root !== path) fail();
  const stats = await lstat(root, { bigint: true });
  if (stats.isSymbolicLink() || !stats.isDirectory()) fail();
  for (const child of await readdir(root, { withFileTypes: true })) {
    if (!UUID_V4.test(child.name) || child.isSymbolicLink() || !child.isDirectory()) fail();
    const candidate = join(root, child.name);
    const observed = await lstat(candidate, { bigint: true });
    if (observed.isSymbolicLink() || !observed.isDirectory()) fail();
    await rm(candidate, { recursive: true, force: false });
  }
  return root;
}

/** External pdftocairo renderer plus independent pdfinfo inspection. */
export class NodeLinuxPdfFlattenWorker implements QuarantineWorkerPort {
  readonly isolationAvailable = true;
  readonly #active = new Map<string, RequestEntry>();

  private constructor(
    private readonly options: NodeLinuxPdfFlattenWorkerOptions,
    private readonly runtimeRoot: string,
    private readonly closure: VerifiedPdfRuntimeClosure,
    private readonly maximumRuntimeMs: number,
  ) {}

  static async create(options: NodeLinuxPdfFlattenWorkerOptions): Promise<NodeLinuxPdfFlattenWorker> {
    try {
      const maximumRuntimeMs = options.maximumRuntimeMs ?? DEFAULT_RUNTIME_MS;
      if (
        process.platform !== "linux" || !Number.isSafeInteger(maximumRuntimeMs) ||
        maximumRuntimeMs < 1 || maximumRuntimeMs > MAXIMUM_RUNTIME_MS ||
        !HASH.test(options.flattener.hash) || !HASH.test(options.inspector.hash) ||
        !HASH.test(options.structuralInspector.hash) ||
        typeof options.flattener.version !== "string" || options.flattener.version.length < 1 ||
        typeof options.inspector.version !== "string" || options.inspector.version.length < 1 ||
        typeof options.structuralInspector.version !== "string" ||
        options.structuralInspector.version.length < 1
      ) fail();
      const [runtimeRoot, closure] = await Promise.all([
        prepareRuntimeRoot(options.privateRuntimeRoot),
        verifyPdfRuntimeClosure({
          manifest: options.runtimeManifest,
          flattener: options.flattener,
          inspector: options.inspector,
          structuralInspector: options.structuralInspector,
        }),
        verifyLinuxResourceBroker(options.executionBroker),
      ]).then(([root, verified]) => [root, verified] as const);
      const probes = [
        { tool: options.flattener, arguments: ["-v"] as const },
        { tool: options.inspector, arguments: ["-v"] as const },
        { tool: options.structuralInspector, arguments: ["--version"] as const },
      ];
      for (const probeRequest of probes) {
        await assertPdfRuntimeClosureCurrent(closure);
        const probeRoot = join(runtimeRoot, randomUUID());
        await mkdir(probeRoot, { mode: 0o700 });
        try {
          const probe = await runBoundedLinuxProcess({
            executable: options.executionBroker.path,
            arguments: linuxResourceBrokerArguments(
              sandboxArguments(closure, probeRequest.tool, probeRequest.arguments),
              LINUX_RESOURCE_LIMITS.probe,
              {
                scratchPath: probeRoot,
                outputPath: probeRoot,
                runtimeClosure: {
                  manifestPath: closure.manifestPath,
                  manifestHash: closure.manifestHash,
                },
              },
            ),
            timeoutMs: 5_000,
            maximumOutputBytes: MAXIMUM_IPC_BYTES,
            cwd: probeRoot,
          });
          if (probe.code !== 0 || probe.timedOut || probe.overLimit || probe.terminationFailed) fail();
        } finally {
          await rm(probeRoot, { recursive: true, force: false });
        }
      }
      return new NodeLinuxPdfFlattenWorker(options, runtimeRoot, closure, maximumRuntimeMs);
    } catch (error) {
      if (error instanceof NodeLinuxPdfFlattenWorkerError) throw error;
      fail();
    }
  }

  async execute(requestValue: QuarantineRequest): Promise<unknown> {
    validateQuarantineRequest(requestValue);
    if (requestValue.operation !== "flattenPdf" || this.#active.has(requestValue.requestId)) fail();
    const request = requestValue as FlattenPdfRequest;
    const entry: RequestEntry = { canceled: false };
    this.#active.set(request.requestId, entry);
    const runRoot = join(this.runtimeRoot, request.requestId);
    const deadline = Date.now() + this.maximumRuntimeMs;
    try {
      await mkdir(runRoot, { mode: 0o700 });
      const binding = await this.options.handles.bindForWorker(request);
      if (binding.outputKind !== "file" || entry.canceled) fail();
      const original = await inputIdentity(binding.inputPath, request.limits.inputBytes);

      const sourceInspection = await this.#inspect(
        entry,
        request,
        binding.inputPath,
        runRoot,
        deadline,
        false,
      );
      if (entry.canceled) fail();

      await assertPdfRuntimeClosureCurrent(this.closure);
      const render = await this.#run(entry, linuxResourceBrokerArguments(
        sandboxArguments(
          this.closure,
          this.options.flattener,
          [
            "-pdf", "-origpagesizes",
            "-f", "1", "-l", sourceInspection.pages.toString(10),
            "/work/input.pdf", "/work/output.pdf",
          ],
          binding.inputPath,
          binding.outputPath,
        ),
        {
          ...LINUX_RESOURCE_LIMITS.pdfFlatten,
          fileSizeBytes: request.limits.outputBytes,
          outputBytes: request.limits.outputBytes,
        },
        {
          scratchPath: runRoot,
          outputPath: binding.outputPath,
          runtimeClosure: {
            manifestPath: this.closure.manifestPath,
            manifestHash: this.closure.manifestHash,
          },
        },
      ), this.#remaining(deadline), runRoot);
      if (render.stdout.length !== 0 || render.stderr.length > MAXIMUM_IPC_BYTES || entry.canceled) fail();

      const derivativeInspection = await this.#inspect(
        entry,
        request,
        binding.outputPath,
        runRoot,
        deadline,
        true,
      );
      if (derivativeInspection.pages !== sourceInspection.pages || entry.canceled) fail();
      await this.#inspectStructure(
        entry,
        request,
        binding.outputPath,
        runRoot,
        deadline,
        derivativeInspection.pages,
      );
      if (entry.canceled) fail();
      const afterInput = await inputIdentity(binding.inputPath, request.limits.inputBytes);
      if (!sameInput(original, afterInput)) fail();
      const output = await stablePdf(binding.outputPath, request.limits.outputBytes);
      if (entry.canceled) fail();
      return Object.freeze({
        version: 1 as const,
        requestId: request.requestId,
        operation: "flattenPdf" as const,
        status: "succeeded" as const,
        output: request.output,
        outputHash: output.hash,
        outputBytes: output.byteSize,
        mediaType: "application/pdf" as const,
        observed: Object.freeze({
          inputBytes: Number(original.size),
          pages: sourceInspection.pages,
        }),
        flattenedPages: derivativeInspection.pages,
      });
    } finally {
      const current = entry.current;
      if (current !== undefined) {
        killTree(current.child);
        await boundedWait(current.closed).catch(() => undefined);
      }
      await rm(runRoot, { recursive: true, force: true }).catch(() => undefined);
      this.#active.delete(request.requestId);
    }
  }

  async terminate(requestId: string): Promise<void> {
    const entry = this.#active.get(requestId);
    if (entry === undefined) return;
    entry.canceled = true;
    if (entry.current === undefined) return;
    killTree(entry.current.child);
    await boundedWait(entry.current.closed);
  }

  async #inspect(
    entry: RequestEntry,
    request: FlattenPdfRequest,
    inputPath: string,
    runRoot: string,
    deadline: number,
    flattened: boolean,
  ): Promise<{ readonly pages: number; readonly version: string }> {
    await assertPdfRuntimeClosureCurrent(this.closure);
    const result = await this.#run(entry, linuxResourceBrokerArguments(
      sandboxArguments(
        this.closure,
        this.options.inspector,
        ["/work/input.pdf"],
        inputPath,
      ),
      LINUX_RESOURCE_LIMITS.pdfInspect,
      {
        scratchPath: runRoot,
        outputPath: runRoot,
        runtimeClosure: {
          manifestPath: this.closure.manifestPath,
          manifestHash: this.closure.manifestHash,
        },
      },
    ), this.#remaining(deadline), runRoot);
    return inspectPdfInfo(result.stdout, request.limits.pages, flattened);
  }

  async #inspectStructure(
    entry: RequestEntry,
    request: FlattenPdfRequest,
    inputPath: string,
    runRoot: string,
    deadline: number,
    expectedPages: number,
  ): Promise<void> {
    await assertPdfRuntimeClosureCurrent(this.closure);
    const result = await this.#run(entry, linuxResourceBrokerArguments(
      sandboxArguments(
        this.closure,
        this.options.structuralInspector,
        ["--json=2", "--json-stream-data=none", "/work/input.pdf"],
        inputPath,
      ),
      LINUX_RESOURCE_LIMITS.pdfInspect,
      {
        scratchPath: runRoot,
        outputPath: runRoot,
        runtimeClosure: {
          manifestPath: this.closure.manifestPath,
          manifestHash: this.closure.manifestHash,
        },
      },
    ), this.#remaining(deadline), runRoot);
    if (entry.canceled) fail();
    inspectStructuralJson(result.stdout, Math.min(expectedPages, request.limits.pages));
  }

  #remaining(deadline: number): number {
    const remaining = deadline - Date.now();
    if (!Number.isSafeInteger(remaining) || remaining < 1) fail();
    return remaining;
  }

  #run(
    entry: RequestEntry,
    arguments_: readonly string[],
    timeoutMs: number,
    cwd: string,
  ): Promise<ProcessResult> {
    if (entry.canceled || entry.current !== undefined) return Promise.reject(new NodeLinuxPdfFlattenWorkerError());
    return new Promise<ProcessResult>((resolveProcess, rejectProcess) => {
      let settled = false;
      let outputBytes = 0;
      let timedOut = false;
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      const child = spawn(this.options.executionBroker.path, [...arguments_], {
        cwd,
        detached: true,
        env: {},
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let closeResolve: (() => void) | undefined;
      const closed = new Promise<void>((resolveClosed) => { closeResolve = resolveClosed; });
      entry.current = { child, closed };
      let grace: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (grace !== undefined) clearTimeout(grace);
        if (entry.current?.child === child) delete entry.current;
        if (error === undefined) {
          resolveProcess({
            stdout: Buffer.concat(stdout).toString("utf8"),
            stderr: Buffer.concat(stderr).toString("utf8"),
          });
        } else rejectProcess(error);
      };
      const terminate = (): void => {
        killTree(child);
        if (grace === undefined) {
          grace = setTimeout(() => finish(new NodeLinuxPdfFlattenWorkerError()), TERMINATION_GRACE_MS);
        }
      };
      const collect = (target: Buffer[], chunk: Buffer): void => {
        outputBytes += chunk.byteLength;
        if (outputBytes > MAXIMUM_IPC_BYTES) terminate();
        else target.push(Buffer.from(chunk));
      };
      child.stdout?.on("data", (chunk: Buffer) => collect(stdout, chunk));
      child.stderr?.on("data", (chunk: Buffer) => collect(stderr, chunk));
      child.once("error", () => {
        closeResolve?.();
        finish(new NodeLinuxPdfFlattenWorkerError());
      });
      child.once("close", (code, signal) => {
        closeResolve?.();
        if (
          code === 0 && signal === null && !timedOut && !entry.canceled &&
          outputBytes <= MAXIMUM_IPC_BYTES
        ) finish();
        else finish(new NodeLinuxPdfFlattenWorkerError());
      });
      const timer = setTimeout(() => {
        timedOut = true;
        terminate();
      }, timeoutMs);
    });
  }
}
