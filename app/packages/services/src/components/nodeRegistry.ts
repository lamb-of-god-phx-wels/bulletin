import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { hexToSha256Hash } from "@cbb/core";
import {
  trustedComponentPathSegments,
  verifyTrustedComponentManifest,
} from "./manifest.js";
import {
  TRUSTED_COMPONENT_ROLES,
  TrustedComponentError,
} from "./types.js";
import type {
  TrustedComponentArch,
  TrustedComponentIdentity,
  TrustedComponentLocator,
  TrustedComponentManifestEntry,
  TrustedComponentPlatform,
  TrustedComponentRegistry,
  TrustedComponentRole,
  TrustedComponentSelectionRequest,
  TrustedPublicKeyRegistry,
  VerifiedTrustedComponent,
} from "./types.js";

const READ_CHUNK_BYTES = 64 * 1024;
const TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;

function fail(
  kind: ConstructorParameters<typeof TrustedComponentError>[0],
  subject?: string,
): never {
  throw new TrustedComponentError(kind, undefined, subject);
}

function safeSubject(entry: TrustedComponentManifestEntry): string {
  return `${entry.role}:${entry.id}`;
}

function isStrictDescendant(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return (
    child.length > 0 &&
    child !== ".." &&
    !child.startsWith(`..${sep}`) &&
    !isAbsolute(child)
  );
}

async function assertDirectoryChain(
  root: string,
  segments: readonly string[],
): Promise<void> {
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    current = join(current, segment);
    const stats = await lstat(current, { bigint: true });
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      fail("componentVerificationFailed");
    }
  }
}

function sameFileIdentity(
  left: { readonly dev: bigint; readonly ino: bigint },
  right: { readonly dev: bigint; readonly ino: bigint },
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

async function verifyComponentBytes(
  root: string,
  entry: TrustedComponentManifestEntry,
): Promise<void> {
  const subject = safeSubject(entry);
  const segments = trustedComponentPathSegments(entry.relativePath);
  const candidate = resolve(root, ...segments);
  if (!isStrictDescendant(root, candidate)) fail("componentVerificationFailed", subject);

  await assertDirectoryChain(root, segments);
  const before = await lstat(candidate, { bigint: true });
  if (
    before.isSymbolicLink() ||
    !before.isFile() ||
    before.nlink !== 1n ||
    before.size < 1n ||
    before.size !== BigInt(entry.byteSize)
  ) {
    fail("componentVerificationFailed", subject);
  }
  const canonicalCandidate = await realpath(candidate);
  if (!isStrictDescendant(root, canonicalCandidate)) {
    fail("componentVerificationFailed", subject);
  }

  const handle = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    if (
      !opened.isFile() ||
      opened.nlink !== 1n ||
      opened.size !== before.size ||
      !sameFileIdentity(before, opened)
    ) {
      fail("componentVerificationFailed", subject);
    }

    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
    let observedBytes = 0;
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, position);
      if (bytesRead === 0) break;
      observedBytes += bytesRead;
      if (observedBytes > entry.byteSize) fail("componentVerificationFailed", subject);
      digest.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }

    const after = await handle.stat({ bigint: true });
    const observedHash = hexToSha256Hash(digest.digest("hex"));
    if (
      observedBytes !== entry.byteSize ||
      observedHash !== entry.hash ||
      after.nlink !== 1n ||
      after.size !== BigInt(observedBytes) ||
      !sameFileIdentity(opened, after)
    ) {
      fail("componentVerificationFailed", subject);
    }
  } finally {
    await handle.close();
  }
}

function currentPlatform(): TrustedComponentPlatform {
  if (process.platform === "linux" || process.platform === "win32") {
    return process.platform;
  }
  fail("platformMismatch");
}

function currentArch(): TrustedComponentArch {
  if (process.arch === "x64" || process.arch === "arm64") return process.arch;
  fail("platformMismatch");
}

function identity(entry: TrustedComponentManifestEntry): TrustedComponentIdentity {
  return Object.freeze({
    role: entry.role,
    id: entry.id,
    version: entry.version,
    platform: entry.platform,
    arch: entry.arch,
    hash: entry.hash,
    byteSize: entry.byteSize,
  });
}

function selectionKey(role: TrustedComponentRole, id: string): string {
  return `${role}\u0000${id}`;
}

function validateSelectionRequest(request: unknown): TrustedComponentSelectionRequest {
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    fail("invalidSelection");
  }
  const value = request as Record<string, unknown>;
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) fail("invalidSelection");
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 2 ||
    keys.some((key) => typeof key !== "string" || !["role", "id"].includes(key)) ||
    !Object.hasOwn(value, "role") ||
    !Object.hasOwn(value, "id") ||
    typeof value["role"] !== "string" ||
    !(TRUSTED_COMPONENT_ROLES as readonly string[]).includes(value["role"]) ||
    typeof value["id"] !== "string" ||
    !TOKEN_RE.test(value["id"])
  ) {
    fail("invalidSelection");
  }
  return { role: value["role"] as TrustedComponentRole, id: value["id"] };
}

export interface CreateNodeTrustedComponentRegistryOptions {
  readonly appRoot: string;
  readonly manifest: unknown;
  readonly trustedKeys: TrustedPublicKeyRegistry;
  readonly expectedPlatform?: TrustedComponentPlatform;
  readonly expectedArch?: TrustedComponentArch;
}

/**
 * Verify the signed installed-component manifest and every named file.
 * Selection later re-verifies the chosen bytes and returns no executable path.
 */
export async function createNodeTrustedComponentRegistry(
  options: CreateNodeTrustedComponentRegistryOptions,
): Promise<TrustedComponentRegistry> {
  const verifiedManifest = verifyTrustedComponentManifest({
    manifest: options.manifest,
    trustedKeys: options.trustedKeys,
    expectedPlatform: options.expectedPlatform ?? currentPlatform(),
    expectedArch: options.expectedArch ?? currentArch(),
  });

  let root: string;
  try {
    if (
      typeof options.appRoot !== "string" ||
      options.appRoot.length === 0 ||
      typeof constants.O_NOFOLLOW !== "number" ||
      constants.O_NOFOLLOW === 0
    ) {
      fail("invalidAppRoot");
    }
    root = await realpath(options.appRoot);
    const rootStats = await lstat(root, { bigint: true });
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) fail("invalidAppRoot");
  } catch (error) {
    if (error instanceof TrustedComponentError) throw error;
    fail("invalidAppRoot");
  }

  for (const entry of verifiedManifest.components) {
    try {
      await verifyComponentBytes(root, entry);
    } catch {
      // Filesystem errors may contain installation paths; collapse them.
      fail("componentVerificationFailed", safeSubject(entry));
    }
  }

  const entries = new Map<string, TrustedComponentManifestEntry>();
  const locators = new Map<string, TrustedComponentLocator>();
  const identities: TrustedComponentIdentity[] = [];
  for (let index = 0; index < verifiedManifest.components.length; index++) {
    const entry = verifiedManifest.components[index];
    if (entry === undefined) continue;
    const key = selectionKey(entry.role, entry.id);
    entries.set(key, entry);
    locators.set(key, Object.freeze({
      token: `trusted-component:${index.toString(10).padStart(4, "0")}`,
    }) as TrustedComponentLocator);
    identities.push(identity(entry));
  }

  return Object.freeze({
    manifestHash: verifiedManifest.manifestHash,
    signingKeyId: verifiedManifest.signingKeyId,
    components: Object.freeze(identities),
    async resolve(rawRequest: TrustedComponentSelectionRequest) {
      const request = validateSelectionRequest(rawRequest);
      const key = selectionKey(request.role, request.id);
      const entry = entries.get(key);
      const locator = locators.get(key);
      if (entry === undefined || locator === undefined) {
        fail("unknownComponent", `${request.role}:${request.id}`);
      }
      try {
        await verifyComponentBytes(root, entry);
      } catch {
        fail("componentVerificationFailed", safeSubject(entry));
      }
      return Object.freeze({ ...identity(entry), locator }) as VerifiedTrustedComponent;
    },
  });
}
