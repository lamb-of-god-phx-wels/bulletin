import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, realpath, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { hashBytes, hexToSha256Hash, type Sha256Hash } from "@cbb/core";
import {
  assertLinuxRuntimeClosureCurrent,
  LINUX_RESOURCE_LIMITS,
  linuxRuntimeCommand,
  linuxRuntimeMountArguments,
  linuxResourceBrokerArguments,
  runBoundedLinuxProcess,
  verifyLinuxRuntimeClosure,
  verifyLinuxResourceBroker,
  type PinnedPdfRuntimeComponent,
  type VerifiedLinuxRuntimeClosure,
} from "@cbb/workers";
import type { ArtifactPdfValidatorPort, ObservedPdfIdentity } from "../artifacts/index.js";
import type { ResourceStagingEntry } from "../resources/index.js";
import type {
  BuildOutputHandle,
  BuildRootHandle,
  IsolatedTypstSandboxPort,
  SandboxCompileResult,
  StagedByteIdentity,
  TrustedTypstRequirement,
  VerifiedPdfOutput,
  VerifiedPdfNavigationMap,
} from "./runner.js";

const READ_CHUNK_BYTES = 64 * 1024;
const MAX_PROCESS_OUTPUT_BYTES = 1024 * 1024;
const MAX_NAVIGATION_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_NAVIGATION_ENTRIES = 50_000;
const MAX_COMPONENT_BYTES = 1024 * 1024 * 1024;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HASH = /^sha256:[0-9a-f]{64}$/u;
const ROOT_HANDLE = /^build-root:[0-9a-f-]{36}$/u;
const ASSET_ALIAS = /^assets\/a[0-9]{4}\.(?:png|jpg|svg|pdf|bin)$/u;
const FONT_ALIAS = /^fonts\/f[0-9]{4}-[0-9]{4}\.(?:ttf|otf|woff|woff2)$/u;
const TYPST_RUNTIME_MANIFEST_NAME = "cbb-typst-runtime.json";
const TYPST_RUNTIME_MANIFEST_KIND = "cbbTypstRuntimeClosure";
const SOURCE_ID = /^[A-Za-z][A-Za-z0-9_-]*$/u;
const SOURCE_REGION = new Set(["body", "page-background", "page-foreground"]);

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).length === keys.length &&
    Reflect.ownKeys(value).every((key) => typeof key === "string" && keys.includes(key));
}

function parseNavigationMap(bytes: Uint8Array, pageCount: number): VerifiedPdfNavigationMap {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail("outputVerificationFailed");
  }
  if (!Array.isArray(raw) || raw.length > MAX_NAVIGATION_ENTRIES) {
    fail("outputVerificationFailed");
  }
  const seen = new Set<string>();
  const entries = raw.map((item) => {
    if (!exactRecord(item, ["resolvedId", "sourceElementId", "region", "page"])) {
      fail("outputVerificationFailed");
    }
    const resolvedId = item["resolvedId"];
    const sourceElementId = item["sourceElementId"];
    const region = item["region"];
    const page = item["page"];
    if (
      typeof resolvedId !== "string" || resolvedId.length < 1 || resolvedId.length > 512 ||
      typeof sourceElementId !== "string" || !SOURCE_ID.test(sourceElementId) ||
      typeof region !== "string" || !SOURCE_REGION.has(region) ||
      !Number.isSafeInteger(page) || Number(page) < 1 || Number(page) > pageCount
    ) fail("outputVerificationFailed");
    const key = `${resolvedId}\u0000${sourceElementId}\u0000${region}\u0000${String(page)}`;
    if (seen.has(key)) fail("outputVerificationFailed");
    seen.add(key);
    return Object.freeze({
      resolvedId,
      sourceElementId,
      region: region as "body" | "page-background" | "page-foreground",
      pageNumber: Number(page),
    });
  }).sort((left, right) =>
    left.pageNumber - right.pageNumber ||
    left.region.localeCompare(right.region) ||
    left.resolvedId.localeCompare(right.resolvedId) ||
    left.sourceElementId.localeCompare(right.sourceElementId)
  );
  return Object.freeze({ version: 1, entries: Object.freeze(entries) });
}

export type NodeTypstSandboxErrorKind =
  | "invalidConfiguration"
  | "isolationUnavailable"
  | "componentVerificationFailed"
  | "invalidHandle"
  | "processTerminationFailed"
  | "stagingFailed"
  | "outputVerificationFailed";

export class NodeTypstSandboxError extends Error {
  readonly code = "CBB-SECURITY-0001" as const;

  constructor(public readonly kind: NodeTypstSandboxErrorKind) {
    super("Offline Typst sandbox operation failed");
    this.name = "NodeTypstSandboxError";
  }
}

export interface TrustedExecutableIdentity {
  readonly path: string;
  readonly hash: Sha256Hash;
}

export interface ResourceStagingBytePort {
  /** Read exactly the already-verified app-owned locator. No path is supplied. */
  read(entry: ResourceStagingEntry): Promise<Uint8Array>;
}

export interface CompileOutputHandlePort {
  registerVerifiedPdf(
    buildId: string,
    identity: {
      readonly hash: Sha256Hash;
      readonly byteSize: number;
      readonly pageCount: number;
      readonly pdfVersion: string;
    },
  ): Promise<BuildOutputHandle>;
}

export interface NodeOfflineTypstSandboxOptions {
  readonly privateBuildParent: string;
  readonly typst: TrustedExecutableIdentity & {
    readonly toolId: "typst";
    readonly version: string;
    readonly byteSize: number;
  };
  readonly runtimeManifest: PinnedPdfRuntimeComponent;
  /** Signed v1 Linux resource/isolation broker; plain Bubblewrap is rejected. */
  readonly executionBroker: TrustedExecutableIdentity;
  readonly resources: ResourceStagingBytePort;
  readonly pdfs: ArtifactPdfValidatorPort;
  readonly outputHandles: CompileOutputHandlePort;
}

interface StableFileIdentity {
  readonly hash: Sha256Hash;
  readonly byteSize: number;
}

interface BuildEntry {
  readonly buildId: string;
  readonly path: string;
  process: ChildProcess | undefined;
  closed: Promise<void> | undefined;
  terminated: boolean;
}

function fail(kind: NodeTypstSandboxErrorKind): never {
  throw new NodeTypstSandboxError(kind);
}

function strictDescendant(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child.length > 0 && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function sameFile(
  left: { readonly dev: bigint; readonly ino: bigint },
  right: { readonly dev: bigint; readonly ino: bigint },
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

async function stableFileIdentity(path: string, maximumBytes: number): Promise<StableFileIdentity> {
  const before = await lstat(path, { bigint: true });
  if (
    before.isSymbolicLink() ||
    !before.isFile() ||
    before.nlink !== 1n ||
    before.size < 1n ||
    before.size > BigInt(maximumBytes)
  ) fail("componentVerificationFailed");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n || !sameFile(before, opened)) {
      fail("componentVerificationFailed");
    }
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
    let byteSize = 0;
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, position);
      if (bytesRead === 0) break;
      byteSize += bytesRead;
      if (byteSize > maximumBytes) fail("componentVerificationFailed");
      digest.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (after.nlink !== 1n || after.size !== BigInt(byteSize) || !sameFile(opened, after)) {
      fail("componentVerificationFailed");
    }
    return { hash: hexToSha256Hash(digest.digest("hex")), byteSize };
  } finally {
    await handle.close();
  }
}

async function stableRead(path: string, maximumBytes: number): Promise<Uint8Array> {
  const before = await lstat(path, { bigint: true });
  if (
    before.isSymbolicLink() ||
    !before.isFile() ||
    before.nlink !== 1n ||
    before.size < 1n ||
    before.size > BigInt(maximumBytes)
  ) fail("outputVerificationFailed");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n || !sameFile(before, opened)) {
      fail("outputVerificationFailed");
    }
    const byteSize = Number(opened.size);
    const bytes = new Uint8Array(byteSize);
    let position = 0;
    while (position < byteSize) {
      const { bytesRead } = await handle.read(bytes, position, byteSize - position, position);
      if (bytesRead === 0) fail("outputVerificationFailed");
      position += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (after.nlink !== 1n || after.size !== opened.size || !sameFile(opened, after)) {
      fail("outputVerificationFailed");
    }
    return bytes;
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

async function sweepAbandonedBuildRoots(parent: string): Promise<void> {
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

async function installExclusive(path: string, bytes: Uint8Array): Promise<StagedByteIdentity> {
  const parent = dirname(path);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await chmod(parent, 0o700);
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    let position = 0;
    while (position < bytes.byteLength) {
      const { bytesWritten } = await handle.write(bytes, position, bytes.byteLength - position, position);
      if (bytesWritten < 1) fail("stagingFailed");
      position += bytesWritten;
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(parent);
  const observed = await stableFileIdentity(path, bytes.byteLength);
  return { observedHash: observed.hash, observedByteSize: observed.byteSize };
}

async function runProbe(executable: string, arguments_: readonly string[]): Promise<boolean> {
  return new Promise<boolean>((resolveProbe) => {
    let settled = false;
    let rejected = false;
    let outputBytes = 0;
    let reapTimeout: ReturnType<typeof setTimeout> | undefined;
    const child = spawn(executable, [...arguments_], {
      detached: true,
      env: {},
      stdio: ["ignore", "pipe", "pipe"],
    });
    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (reapTimeout !== undefined) clearTimeout(reapTimeout);
      resolveProbe(value);
    };
    const terminate = () => {
      rejected = true;
      try {
        if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        settle(false);
        return;
      }
      if (reapTimeout === undefined) {
        reapTimeout = setTimeout(() => settle(false), 5_000);
        reapTimeout.unref();
      }
    };
    const timeout = setTimeout(() => {
      terminate();
    }, 5_000);
    timeout.unref();
    const observe = (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_PROCESS_OUTPUT_BYTES) {
        terminate();
      }
    };
    child.stdout?.on("data", observe);
    child.stderr?.on("data", observe);
    child.once("error", () => settle(false));
    child.once("close", (code) => settle(!rejected && code === 0 && outputBytes <= MAX_PROCESS_OUTPUT_BYTES));
  });
}

function terminateProcess(entry: BuildEntry): void {
  entry.terminated = true;
  const child = entry.process;
  if (child === undefined || child.pid === undefined || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

async function awaitProcessClosed(entry: BuildEntry): Promise<void> {
  const closed = entry.closed;
  if (closed === undefined) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      closed,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new NodeTypstSandboxError("processTerminationFailed")),
          5_000,
        );
        timer.unref();
      }),
    ]);
    entry.closed = undefined;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function validateObservedPdf(observed: ObservedPdfIdentity): void {
  if (
    !HASH.test(observed.hash) ||
    !Number.isSafeInteger(observed.byteSize) ||
    observed.byteSize < 1 ||
    observed.byteSize > MAX_COMPONENT_BYTES ||
    !Number.isSafeInteger(observed.pageCount) ||
    observed.pageCount < 1 ||
    observed.pageCount > 1_000 ||
    !/^(?:1\.[0-7]|2\.0)$/u.test(observed.pdfVersion)
  ) fail("outputVerificationFailed");
}

/**
 * Linux adapter for app-generated Typst. The signed execution broker owns the
 * namespaces and installs CPU, address-space, process, file and directory
 * quotas before executing the sandbox. Missing limits or isolation rejects.
 */
export class NodeOfflineTypstSandbox implements IsolatedTypstSandboxPort {
  readonly isolationProfile = "offlineTypstV1" as const;
  readonly #entries = new Map<BuildRootHandle, BuildEntry>();

  private constructor(
    private readonly buildParent: string,
    private readonly options: NodeOfflineTypstSandboxOptions,
    private readonly runtime: VerifiedLinuxRuntimeClosure,
  ) {}

  static async create(options: NodeOfflineTypstSandboxOptions): Promise<NodeOfflineTypstSandbox> {
    try {
      if (
        process.platform !== "linux" ||
        typeof constants.O_NOFOLLOW !== "number" ||
        constants.O_NOFOLLOW === 0 ||
        !isAbsolute(options.privateBuildParent) ||
        resolve(options.privateBuildParent) !== options.privateBuildParent ||
        !isAbsolute(options.typst.path) ||
        !isAbsolute(options.executionBroker.path) ||
        options.typst.toolId !== "typst" ||
        !/^[A-Za-z0-9][A-Za-z0-9_.+:-]{0,127}$/u.test(options.typst.version) ||
        !HASH.test(options.typst.hash) ||
        !Number.isSafeInteger(options.typst.byteSize) || options.typst.byteSize < 1 ||
        !HASH.test(options.executionBroker.hash)
      ) fail("invalidConfiguration");
      await mkdir(options.privateBuildParent, { recursive: true, mode: 0o700 });
      await chmod(options.privateBuildParent, 0o700);
      const buildParent = await realpath(options.privateBuildParent);
      if (buildParent !== options.privateBuildParent) fail("invalidConfiguration");
      const parentStats = await lstat(buildParent, { bigint: true });
      if (parentStats.isSymbolicLink() || !parentStats.isDirectory()) fail("invalidConfiguration");
      await sweepAbandonedBuildRoots(buildParent);
      const [runtime, executionBroker] = await Promise.all([
        verifyLinuxRuntimeClosure({
          manifestName: TYPST_RUNTIME_MANIFEST_NAME,
          manifestKind: TYPST_RUNTIME_MANIFEST_KIND,
          manifest: options.runtimeManifest,
          tools: [{
            path: options.typst.path,
            hash: options.typst.hash,
            byteSize: options.typst.byteSize,
          }],
        }),
        stableFileIdentity(options.executionBroker.path, MAX_COMPONENT_BYTES),
        verifyLinuxResourceBroker(options.executionBroker),
      ]).then(([verifiedRuntime, broker]) => [verifiedRuntime, broker] as const);
      if (executionBroker.hash !== options.executionBroker.hash) fail("componentVerificationFailed");
      const available = await runProbe(options.executionBroker.path, linuxResourceBrokerArguments([
        "--unshare-all", "--die-with-parent", "--new-session", "--cap-drop", "ALL",
        "--tmpfs", "/",
        ...linuxRuntimeMountArguments(runtime),
        "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
        "--clearenv", "--", ...linuxRuntimeCommand(runtime, options.typst.path, ["--version"]),
      ], LINUX_RESOURCE_LIMITS.probe, {
        scratchPath: buildParent,
        outputPath: buildParent,
        runtimeClosure: {
          manifestPath: runtime.manifestPath,
          manifestHash: runtime.manifestHash,
        },
      }));
      if (!available) fail("isolationUnavailable");
      return new NodeOfflineTypstSandbox(buildParent, options, runtime);
    } catch (error) {
      if (error instanceof NodeTypstSandboxError) throw error;
      fail("isolationUnavailable");
    }
  }

  async verifyTrustedTool(requirement: TrustedTypstRequirement): Promise<boolean> {
    try {
      if (
        requirement.toolId !== this.options.typst.toolId ||
        requirement.version !== this.options.typst.version ||
        requirement.executableHash !== this.options.typst.hash
      ) return false;
      const [, executionBroker] = await Promise.all([
        assertLinuxRuntimeClosureCurrent(this.runtime),
        stableFileIdentity(this.options.executionBroker.path, MAX_COMPONENT_BYTES),
      ]);
      return executionBroker.hash === this.options.executionBroker.hash;
    } catch {
      return false;
    }
  }

  async createBuildRoot(buildId: string): Promise<BuildRootHandle> {
    try {
      if (!UUID_V4.test(buildId)) fail("invalidHandle");
      const path = join(this.buildParent, buildId);
      if (!strictDescendant(this.buildParent, path)) fail("invalidHandle");
      await mkdir(path, { recursive: false, mode: 0o700 });
      await syncDirectory(this.buildParent);
      const handle = `build-root:${randomUUID()}` as BuildRootHandle;
      this.#entries.set(handle, { buildId, path, process: undefined, closed: undefined, terminated: false });
      return handle;
    } catch (error) {
      if (error instanceof NodeTypstSandboxError) throw error;
      fail("stagingFailed");
    }
  }

  async stageSource(
    root: BuildRootHandle,
    source: Uint8Array,
    expectedHash: Sha256Hash,
  ): Promise<StagedByteIdentity> {
    const entry = this.entry(root);
    try {
      if (!(source instanceof Uint8Array) || source.byteLength < 1 || hashBytes(source) !== expectedHash) {
        fail("stagingFailed");
      }
      return await installExclusive(join(entry.path, "main.typ"), new Uint8Array(source));
    } catch (error) {
      if (error instanceof NodeTypstSandboxError) throw error;
      fail("stagingFailed");
    }
  }

  async stageResource(
    root: BuildRootHandle,
    resource: ResourceStagingEntry,
  ): Promise<StagedByteIdentity> {
    const entry = this.entry(root);
    try {
      const validAlias = resource.kind === "asset"
        ? ASSET_ALIAS.test(resource.relativePath)
        : FONT_ALIAS.test(resource.relativePath);
      if (!validAlias || !HASH.test(resource.hash) || resource.byteSize < 1) fail("stagingFailed");
      const path = resolve(entry.path, ...resource.relativePath.split("/"));
      if (!strictDescendant(entry.path, path)) fail("stagingFailed");
      const bytes = await this.options.resources.read(resource);
      if (
        !(bytes instanceof Uint8Array) ||
        bytes.byteLength !== resource.byteSize ||
        hashBytes(bytes) !== resource.hash
      ) fail("stagingFailed");
      return await installExclusive(path, new Uint8Array(bytes));
    } catch (error) {
      if (error instanceof NodeTypstSandboxError) throw error;
      fail("stagingFailed");
    }
  }

  async compile(root: BuildRootHandle, signal?: AbortSignal): Promise<SandboxCompileResult> {
    const entry = this.entry(root);
    if (entry.terminated || signal?.aborted === true) return { kind: "canceled" };
    const [, executionBroker] = await Promise.all([
      assertLinuxRuntimeClosureCurrent(this.runtime),
      stableFileIdentity(this.options.executionBroker.path, MAX_COMPONENT_BYTES),
    ]);
    if (executionBroker.hash !== this.options.executionBroker.hash) {
      fail("componentVerificationFailed");
    }
    if (entry.process !== undefined) fail("invalidHandle");
    const args = [
      "--unshare-all", "--die-with-parent", "--new-session", "--cap-drop", "ALL",
      "--tmpfs", "/",
      ...linuxRuntimeMountArguments(this.runtime),
      "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
      "--bind", entry.path, "/build",
      "--tmpfs", "/packages", "--tmpfs", "/cache", "--chdir", "/build",
      "--clearenv",
      "--setenv", "SOURCE_DATE_EPOCH", "0",
      "--setenv", "TZ", "UTC",
      "--setenv", "LANG", "C.UTF-8",
      "--",
      ...linuxRuntimeCommand(this.runtime, this.options.typst.path, [
        "compile",
        "--root", "/build",
        "--font-path", "/build/fonts",
        "--ignore-system-fonts",
        "--ignore-embedded-fonts",
        "--package-path", "/packages",
        "--package-cache-path", "/cache",
        "--creation-timestamp", "0",
        "--jobs", "1",
        "--diagnostic-format", "short",
        "/build/main.typ", "/build/output.pdf",
      ]),
    ];
    return new Promise<SandboxCompileResult>((resolveCompile) => {
      let settled = false;
      let outputBytes = 0;
      const child = spawn(this.options.executionBroker.path, linuxResourceBrokerArguments(
        args,
        LINUX_RESOURCE_LIMITS.typst,
        {
          scratchPath: entry.path,
          outputPath: join(entry.path, "output.pdf"),
          runtimeClosure: {
            manifestPath: this.runtime.manifestPath,
            manifestHash: this.runtime.manifestHash,
          },
        },
      ), {
        detached: true,
        env: {},
        stdio: ["ignore", "pipe", "pipe"],
      });
      entry.process = child;
      entry.closed = new Promise<void>((resolveClosed) => { child.once("close", () => resolveClosed()); });
      const settle = (result: SandboxCompileResult) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", abort);
        entry.process = undefined;
        resolveCompile(result);
      };
      const abort = () => {
        terminateProcess(entry);
      };
      const observe = (chunk: Buffer) => {
        outputBytes += chunk.byteLength;
        if (outputBytes > MAX_PROCESS_OUTPUT_BYTES) {
          terminateProcess(entry);
        }
      };
      child.stdout?.on("data", observe);
      child.stderr?.on("data", observe);
      child.once("error", () => settle({ kind: "failed", diagnosticCodes: ["CBB-BUILD-0001"] }));
      child.once("close", (code) => {
        if (entry.terminated || signal?.aborted === true) settle({ kind: "canceled" });
        else if (code === 0 && outputBytes <= MAX_PROCESS_OUTPUT_BYTES) settle({ kind: "succeeded" });
        else settle({ kind: "failed", diagnosticCodes: ["CBB-BUILD-0001"] });
      });
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted === true) abort();
    });
  }

  async verifyPdf(root: BuildRootHandle): Promise<VerifiedPdfOutput> {
    const entry = this.entry(root);
    try {
      const [, executionBroker] = await Promise.all([
        assertLinuxRuntimeClosureCurrent(this.runtime),
        stableFileIdentity(this.options.executionBroker.path, MAX_COMPONENT_BYTES),
      ]);
      if (executionBroker.hash !== this.options.executionBroker.hash) {
        fail("componentVerificationFailed");
      }
      const bytes = await stableRead(join(entry.path, "output.pdf"), MAX_COMPONENT_BYTES);
      const observed = await this.options.pdfs.verify(new Uint8Array(bytes));
      validateObservedPdf(observed);
      if (observed.byteSize !== bytes.byteLength || observed.hash !== hashBytes(bytes)) {
        fail("outputVerificationFailed");
      }
      const queryArguments = [
        "--unshare-all", "--die-with-parent", "--new-session", "--cap-drop", "ALL",
        "--tmpfs", "/",
        ...linuxRuntimeMountArguments(this.runtime),
        "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
        "--bind", entry.path, "/build",
        "--tmpfs", "/packages", "--tmpfs", "/cache", "--chdir", "/build",
        "--clearenv",
        "--setenv", "SOURCE_DATE_EPOCH", "0",
        "--setenv", "TZ", "UTC",
        "--setenv", "LANG", "C.UTF-8",
        "--",
        ...linuxRuntimeCommand(this.runtime, this.options.typst.path, [
          "query",
          "--root", "/build",
          "--font-path", "/build/fonts",
          "--ignore-system-fonts",
          "--ignore-embedded-fonts",
          "--package-path", "/packages",
          "--package-cache-path", "/cache",
          "--creation-timestamp", "0",
          "--jobs", "1",
          "--diagnostic-format", "short",
          "/build/main.typ",
          "<cbb-located>",
          "--field", "value",
          "--format", "json",
        ]),
      ];
      const query = await runBoundedLinuxProcess({
        executable: this.options.executionBroker.path,
        arguments: linuxResourceBrokerArguments(
          queryArguments,
          LINUX_RESOURCE_LIMITS.typst,
          {
            scratchPath: entry.path,
            outputPath: entry.path,
            runtimeClosure: {
              manifestPath: this.runtime.manifestPath,
              manifestHash: this.runtime.manifestHash,
            },
          },
        ),
        timeoutMs: LINUX_RESOURCE_LIMITS.typst.cpuSeconds * 1_000 + 5_000,
        maximumOutputBytes: MAX_NAVIGATION_OUTPUT_BYTES,
      });
      if (
        query.code !== 0 || query.signal !== null || query.timedOut ||
        query.overLimit || query.terminationFailed
      ) fail("outputVerificationFailed");
      const navigationMap = parseNavigationMap(query.stdout, observed.pageCount);
      const handle = await this.options.outputHandles.registerVerifiedPdf(entry.buildId, {
        hash: observed.hash,
        byteSize: observed.byteSize,
        pageCount: observed.pageCount,
        pdfVersion: observed.pdfVersion,
      });
      return {
        handle,
        hash: observed.hash,
        byteSize: observed.byteSize,
        pageCount: observed.pageCount,
        pdfVersion: observed.pdfVersion,
        magicVerified: true,
        navigationMap,
      };
    } catch (error) {
      if (error instanceof NodeTypstSandboxError) throw error;
      fail("outputVerificationFailed");
    }
  }

  async terminate(root: BuildRootHandle): Promise<void> {
    const entry = this.entry(root);
    terminateProcess(entry);
    await awaitProcessClosed(entry);
  }

  async cleanup(root: BuildRootHandle): Promise<void> {
    const entry = this.entry(root);
    await this.terminate(root);
    await rm(entry.path, { recursive: true, force: false });
    await syncDirectory(this.buildParent);
    this.#entries.delete(root);
  }

  private entry(root: BuildRootHandle): BuildEntry {
    if (typeof root !== "string" || !ROOT_HANDLE.test(root)) fail("invalidHandle");
    const entry = this.#entries.get(root);
    if (entry === undefined || !strictDescendant(this.buildParent, entry.path)) fail("invalidHandle");
    return entry;
  }
}
