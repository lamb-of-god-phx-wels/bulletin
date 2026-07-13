import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { canonicalJsonBytes, hexToSha256Hash, type Sha256Hash } from "@cbb/core";
import { isSafeArchivePath } from "../quarantine/protocol.js";

const PDF_MANIFEST_NAME = "cbb-pdf-runtime.json";
const HASH = /^sha256:[0-9a-f]{64}$/u;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_FILES = 512;
const MAX_FILE_BYTES = 512 * 1024 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;
const ALLOWED_TOP_LEVEL_DIRECTORIES = new Set(["bin", "lib", "lib64", "usr", "etc", "share"]);

export interface PinnedPdfRuntimeComponent {
  readonly path: string;
  readonly hash: Sha256Hash;
  readonly byteSize: number;
}

export interface VerifiedLinuxRuntimeClosure {
  readonly root: string;
  readonly manifestPath: string;
  readonly manifestHash: Sha256Hash;
  readonly loaderRelativePath: string;
  readonly libraryRelativeDirectories: readonly string[];
}

export type VerifiedPdfRuntimeClosure = VerifiedLinuxRuntimeClosure;

export interface VerifyLinuxRuntimeClosureOptions {
  readonly manifestName: string;
  readonly manifestKind: string;
  readonly manifest: PinnedPdfRuntimeComponent;
  readonly tools: readonly PinnedPdfRuntimeComponent[];
}

interface ClosureState {
  readonly files: ReadonlyMap<string, Readonly<{ hash: Sha256Hash; byteSize: number }>>;
  readonly directories: ReadonlySet<string>;
  readonly authorizedTools: ReadonlySet<string>;
  readonly options: VerifyLinuxRuntimeClosureOptions;
}

const CLOSURES = new WeakMap<object, ClosureState>();

export class PdfRuntimeClosureError extends Error {
  readonly code = "CBB-SECURITY-0001" as const;

  constructor() {
    super("The signed PDF renderer runtime closure is invalid");
    this.name = "PdfRuntimeClosureError";
  }
}

function fail(): never {
  throw new PdfRuntimeClosureError();
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail();
  const raw = value as Record<string, unknown>;
  const actual = Reflect.ownKeys(raw);
  if (
    Object.getPrototypeOf(raw) !== Object.prototype ||
    actual.length !== keys.length ||
    actual.some((key) => typeof key !== "string" || !keys.includes(key)) ||
    keys.some((key) => !Object.hasOwn(raw, key))
  ) fail();
  return raw;
}

function sameFile(
  left: { readonly dev: bigint; readonly ino: bigint },
  right: { readonly dev: bigint; readonly ino: bigint },
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

async function stableBytes(path: string, maximumBytes: number): Promise<Uint8Array> {
  const before = await lstat(path, { bigint: true });
  if (
    before.isSymbolicLink() || !before.isFile() || before.nlink !== 1n ||
    before.size < 1n || before.size > BigInt(maximumBytes)
  ) fail();
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n || !sameFile(before, opened)) fail();
    const bytes = new Uint8Array(Number(opened.size));
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (bytesRead < 1) fail();
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (after.size !== opened.size || after.nlink !== 1n || !sameFile(opened, after)) fail();
    return bytes;
  } finally {
    await handle.close();
  }
}

async function stableIdentity(path: string, maximumBytes: number): Promise<{
  readonly hash: Sha256Hash;
  readonly byteSize: number;
  readonly executable: boolean;
}> {
  const before = await lstat(path, { bigint: true });
  if (
    before.isSymbolicLink() || !before.isFile() || before.nlink !== 1n ||
    before.size < 1n || before.size > BigInt(maximumBytes)
  ) fail();
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n || !sameFile(before, opened)) fail();
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
    let offset = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
      if (offset > maximumBytes) fail();
      digest.update(buffer.subarray(0, bytesRead));
    }
    const after = await handle.stat({ bigint: true });
    if (after.size !== BigInt(offset) || after.nlink !== 1n || !sameFile(opened, after)) fail();
    return {
      hash: hexToSha256Hash(digest.digest("hex")),
      byteSize: offset,
      executable: (Number(after.mode) & 0o111) !== 0,
    };
  } finally {
    await handle.close();
  }
}

function ancestors(path: string): readonly string[] {
  const segments = path.split("/");
  const result: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    result.push(segments.slice(0, index).join("/"));
  }
  return result;
}

function strictDescendant(root: string, candidate: string): string {
  const child = relative(root, candidate);
  if (
    child.length === 0 || child === ".." || child.startsWith(`..${sep}`) ||
    isAbsolute(child) || !isSafeArchivePath(child.split(sep).join("/"))
  ) fail();
  return child.split(sep).join("/");
}

/** Verify a signed manifest and its exact nofollow tree; surplus is corruption. */
export async function verifyLinuxRuntimeClosure(
  options: VerifyLinuxRuntimeClosureOptions,
): Promise<VerifiedLinuxRuntimeClosure> {
  try {
    if (
      process.platform !== "linux" || basename(options.manifest.path) !== options.manifestName ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(options.manifestName) ||
      !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u.test(options.manifestKind) ||
      !Array.isArray(options.tools) || options.tools.length < 1 || options.tools.length > 16 ||
      !isAbsolute(options.manifest.path) || resolve(options.manifest.path) !== options.manifest.path ||
      !HASH.test(options.manifest.hash) ||
      !Number.isSafeInteger(options.manifest.byteSize) || options.manifest.byteSize < 1 ||
      options.manifest.byteSize > MAX_MANIFEST_BYTES
    ) fail();
    const root = dirname(options.manifest.path);
    const rootStats = await lstat(root, { bigint: true });
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory() || await realpath(root) !== root) fail();
    const manifestBytes = await stableBytes(options.manifest.path, MAX_MANIFEST_BYTES);
    if (
      manifestBytes.byteLength !== options.manifest.byteSize ||
      hexToSha256Hash(createHash("sha256").update(manifestBytes).digest("hex")) !== options.manifest.hash
    ) fail();
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes);
    const parsed: unknown = JSON.parse(decoded);
    if (!Buffer.from(canonicalJsonBytes(parsed)).equals(Buffer.from(manifestBytes))) fail();
    const manifest = exactRecord(parsed, [
      "version", "kind", "loaderPath", "libraryDirectories", "files",
    ]);
    if (
      manifest["version"] !== 1 || manifest["kind"] !== options.manifestKind ||
      typeof manifest["loaderPath"] !== "string" ||
      !isSafeArchivePath(manifest["loaderPath"]) ||
      !Array.isArray(manifest["libraryDirectories"]) ||
      !Array.isArray(manifest["files"]) || manifest["files"].length < 3 ||
      manifest["files"].length > MAX_FILES
    ) fail();

    const libraryDirectories = manifest["libraryDirectories"] as unknown[];
    if (
      libraryDirectories.length < 1 || libraryDirectories.length > 32 ||
      libraryDirectories.some((value) => typeof value !== "string" || !isSafeArchivePath(value)) ||
      libraryDirectories.some((value, index) => index > 0 &&
        (libraryDirectories[index - 1] as string) >= (value as string))
    ) fail();

    const files = new Map<string, Readonly<{ hash: Sha256Hash; byteSize: number }>>();
    let declaredTotal = 0;
    for (const value of manifest["files"] as unknown[]) {
      const entry = exactRecord(value, ["path", "hash", "byteSize"]);
      if (
        typeof entry["path"] !== "string" || !isSafeArchivePath(entry["path"]) ||
        !ALLOWED_TOP_LEVEL_DIRECTORIES.has((entry["path"] as string).split("/")[0]!) ||
        typeof entry["hash"] !== "string" || !HASH.test(entry["hash"]) ||
        !Number.isSafeInteger(entry["byteSize"]) || (entry["byteSize"] as number) < 1 ||
        (entry["byteSize"] as number) > MAX_FILE_BYTES || files.has(entry["path"])
      ) fail();
      const previous = [...files.keys()].at(-1);
      if (previous !== undefined && previous >= entry["path"]) fail();
      declaredTotal += entry["byteSize"] as number;
      if (!Number.isSafeInteger(declaredTotal) || declaredTotal > MAX_TOTAL_BYTES) fail();
      files.set(entry["path"], Object.freeze({
        hash: entry["hash"] as Sha256Hash,
        byteSize: entry["byteSize"] as number,
      }));
    }
    if (!files.has(manifest["loaderPath"])) fail();

    const expectedFiles = new Set<string>([options.manifestName, ...files.keys()]);
    const expectedDirectories = new Set<string>();
    for (const path of expectedFiles) for (const parent of ancestors(path)) expectedDirectories.add(parent);
    for (const directory of libraryDirectories as string[]) {
      if (!expectedDirectories.has(directory)) fail();
    }
    const observedFiles = new Set<string>();
    const observedDirectories = new Set<string>();
    const walk = async (directory: string, relativeDirectory: string): Promise<void> => {
      const children = await readdir(directory, { withFileTypes: true });
      for (const child of children) {
        const relativePath = relativeDirectory.length === 0
          ? child.name
          : `${relativeDirectory}/${child.name}`;
        if (!isSafeArchivePath(relativePath)) fail();
        const path = resolve(root, ...relativePath.split("/"));
        const stats = await lstat(path, { bigint: true });
        if (stats.isSymbolicLink()) fail();
        if (stats.isDirectory()) {
          observedDirectories.add(relativePath);
          await walk(path, relativePath);
        } else if (stats.isFile()) {
          observedFiles.add(relativePath);
        } else fail();
      }
    };
    await walk(root, "");
    if (
      observedFiles.size !== expectedFiles.size ||
      [...observedFiles].some((path) => !expectedFiles.has(path)) ||
      observedDirectories.size !== expectedDirectories.size ||
      [...observedDirectories].some((path) => !expectedDirectories.has(path))
    ) fail();

    let observedTotal = 0;
    for (const [relativePath, identity] of files) {
      const observed = await stableIdentity(
        resolve(root, ...relativePath.split("/")),
        identity.byteSize,
      );
      if (observed.hash !== identity.hash || observed.byteSize !== identity.byteSize) fail();
      observedTotal += observed.byteSize;
    }
    if (observedTotal !== declaredTotal) fail();

    const loader = await stableIdentity(
      resolve(root, ...(manifest["loaderPath"] as string).split("/")),
      files.get(manifest["loaderPath"] as string)?.byteSize ?? 0,
    );
    if (!loader.executable) fail();
    const authorizedTools = new Set<string>();
    for (const tool of options.tools) {
      if (!HASH.test(tool.hash) || !Number.isSafeInteger(tool.byteSize) || tool.byteSize < 1) fail();
      const relativePath = strictDescendant(root, tool.path);
      const declared = files.get(relativePath);
      if (declared === undefined || declared.hash !== tool.hash || declared.byteSize !== tool.byteSize) fail();
      const observed = await stableIdentity(tool.path, tool.byteSize);
      if (observed.hash !== tool.hash || observed.byteSize !== tool.byteSize || !observed.executable) fail();
      authorizedTools.add(relativePath);
    }
    const closure = Object.freeze({
      root,
      manifestPath: options.manifest.path,
      manifestHash: options.manifest.hash,
      loaderRelativePath: manifest["loaderPath"] as string,
      libraryRelativeDirectories: Object.freeze([...(libraryDirectories as string[])]),
    });
    CLOSURES.set(closure, {
      files,
      directories: expectedDirectories,
      authorizedTools,
      options: Object.freeze({
        manifestName: options.manifestName,
        manifestKind: options.manifestKind,
        manifest: Object.freeze({ ...options.manifest }),
        tools: Object.freeze(options.tools.map((tool) => Object.freeze({ ...tool }))),
      }),
    });
    return closure;
  } catch (error) {
    if (error instanceof PdfRuntimeClosureError) throw error;
    fail();
  }
}

export function verifyPdfRuntimeClosure(options: {
  readonly manifest: PinnedPdfRuntimeComponent;
  readonly flattener: PinnedPdfRuntimeComponent;
  readonly inspector: PinnedPdfRuntimeComponent;
  readonly structuralInspector: PinnedPdfRuntimeComponent;
}): Promise<VerifiedPdfRuntimeClosure> {
  return verifyLinuxRuntimeClosure({
    manifestName: PDF_MANIFEST_NAME,
    manifestKind: "cbbPdfRuntimeClosure",
    manifest: options.manifest,
    tools: [options.flattener, options.inspector, options.structuralInspector],
  });
}

/** Build the fixed dynamic-loader argv inside the read-only `/runtime` mount. */
export function linuxRuntimeCommand(
  closure: VerifiedLinuxRuntimeClosure,
  toolPath: string,
  arguments_: readonly string[],
): readonly string[] {
  const state = CLOSURES.get(closure);
  if (state === undefined) fail();
  const relativeTool = strictDescendant(closure.root, toolPath);
  if (!state.authorizedTools.has(relativeTool)) fail();
  return Object.freeze([
    `/runtime/${closure.loaderRelativePath}`,
    "--library-path",
    closure.libraryRelativeDirectories.map((path) => `/runtime/${path}`).join(":"),
    `/runtime/${relativeTool}`,
    ...arguments_,
  ]);
}

export const pdfRuntimeCommand = linuxRuntimeCommand;

/** Reverify the complete signed tree immediately before asking the broker to mount it. */
export async function assertLinuxRuntimeClosureCurrent(
  closure: VerifiedLinuxRuntimeClosure,
): Promise<void> {
  const state = CLOSURES.get(closure);
  if (state === undefined) fail();
  await verifyLinuxRuntimeClosure(state.options);
}

export const assertPdfRuntimeClosureCurrent = assertLinuxRuntimeClosureCurrent;

/** Explicit aliases for app-packaged data paths; no host runtime tree is mounted. */
export function linuxRuntimeMountArguments(
  closure: VerifiedLinuxRuntimeClosure,
): readonly string[] {
  const state = CLOSURES.get(closure);
  if (state === undefined) fail();
  const arguments_: string[] = ["--dir", "/runtime", "--ro-bind", closure.root, "/runtime"];
  for (const directory of ["usr", "etc", "lib", "lib64", "share"] as const) {
    if (!state.directories.has(directory)) continue;
    arguments_.push("--dir", `/${directory}`, "--ro-bind", resolve(closure.root, directory), `/${directory}`);
  }
  return Object.freeze(arguments_);
}

export const pdfRuntimeMountArguments = linuxRuntimeMountArguments;
