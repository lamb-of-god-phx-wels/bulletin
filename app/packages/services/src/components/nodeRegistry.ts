import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { hexToSha256Hash } from "@cbb/core";
import {
  trustedComponentPathSegments,
  verifyTrustedComponentManifest,
} from "./manifest.js";
import { assertRequiredM3ReleaseSet } from "./releaseSet.js";
import {
  TRUSTED_COMPONENT_EXECUTION_LIMITS,
  TRUSTED_COMPONENT_ROLES,
  TrustedComponentError,
} from "./types.js";
import type {
  TrustedComponentArch,
  TrustedComponentExecutionInvocation,
  TrustedComponentExecutionOperation,
  TrustedComponentExecutionRequest,
  TrustedComponentExecutionGrant,
  TrustedComponentIdentity,
  TrustedComponentLocator,
  TrustedComponentManifestEntry,
  TrustedComponentOperationPayload,
  TrustedComponentPlatform,
  TrustedComponentReleaseIdentity,
  TrustedComponentRegistry,
  TrustedComponentRole,
  TrustedComponentSelectionRequest,
  TrustedPublicKeyRegistry,
  VerifiedTrustedComponent,
} from "./types.js";

const READ_CHUNK_BYTES = 64 * 1024;
const TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;
const PAYLOAD_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/u;

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
    ...(entry.fontFaceBinding !== undefined
      ? { fontFaceBinding: Object.freeze({ ...entry.fontFaceBinding }) }
      : {}),
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

const EXECUTION_TARGET_ROLES: Readonly<Record<TrustedComponentExecutionOperation, TrustedComponentRole>> =
  Object.freeze({
    quarantineExecute: "quarantineWorker",
    typstCompile: "typstCli",
    typstRuntimeBind: "typstRuntimeClosure",
    pdfInspect: "pdfInspector",
    pdfStructuralInspect: "pdfStructuralInspector",
    pdfFlatten: "pdfFlattener",
    pdfRuntimeBind: "pdfRuntimeClosure",
  });

function isExecutionOperation(value: unknown): value is TrustedComponentExecutionOperation {
  return typeof value === "string" && Object.hasOwn(EXECUTION_TARGET_ROLES, value);
}

function validateExecutionRequest(value: unknown): TrustedComponentExecutionRequest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("invalidSelection");
  const raw = value as Record<string, unknown>;
  const prototype = Object.getPrototypeOf(raw) as unknown;
  const keys = Reflect.ownKeys(raw);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    keys.length !== 3 ||
    keys.some((key) => typeof key !== "string" || !["operation", "broker", "target"].includes(key)) ||
    !Object.hasOwn(raw, "operation") ||
    !Object.hasOwn(raw, "broker") ||
    !Object.hasOwn(raw, "target") ||
    !isExecutionOperation(raw["operation"]) ||
    raw["broker"] === null ||
    typeof raw["broker"] !== "object" ||
    raw["target"] === null ||
    typeof raw["target"] !== "object"
  ) fail("invalidSelection");
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      fail("invalidSelection");
    }
  }
  return raw as unknown as TrustedComponentExecutionRequest;
}

function validateOperationPayload(value: unknown): TrustedComponentOperationPayload {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("invalidSelection");
  }
  const raw = value as Record<string, unknown>;
  const prototype = Object.getPrototypeOf(raw) as unknown;
  const keys = Reflect.ownKeys(raw);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    !Object.isFrozen(raw) ||
    keys.length !== 3 ||
    keys.some((key) =>
      typeof key !== "string" || !["token", "operation", "timeoutMs"].includes(key)
    ) ||
    !Object.hasOwn(raw, "token") ||
    !Object.hasOwn(raw, "operation") ||
    !Object.hasOwn(raw, "timeoutMs") ||
    typeof raw["token"] !== "string" ||
    !PAYLOAD_TOKEN_RE.test(raw["token"]) ||
    !isExecutionOperation(raw["operation"]) ||
    !Number.isSafeInteger(raw["timeoutMs"]) ||
    (raw["timeoutMs"] as number) < 1 ||
    (raw["timeoutMs"] as number) >
      TRUSTED_COMPONENT_EXECUTION_LIMITS[
        raw["operation"] as TrustedComponentExecutionOperation
      ].maximumRuntimeMs
  ) fail("invalidSelection");
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      fail("invalidSelection");
    }
  }
  return raw as unknown as TrustedComponentOperationPayload;
}

function validateExecutionInvocation(value: unknown): TrustedComponentExecutionInvocation {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("invalidSelection");
  }
  const raw = value as Record<string, unknown>;
  const prototype = Object.getPrototypeOf(raw) as unknown;
  const keys = Reflect.ownKeys(raw);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    keys.length !== 2 ||
    keys.some((key) => typeof key !== "string" || !["grant", "payload"].includes(key)) ||
    !Object.hasOwn(raw, "grant") ||
    !Object.hasOwn(raw, "payload") ||
    raw["grant"] === null ||
    typeof raw["grant"] !== "object"
  ) fail("invalidSelection");
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      fail("invalidSelection");
    }
  }
  return {
    grant: raw["grant"] as TrustedComponentExecutionGrant,
    payload: validateOperationPayload(raw["payload"]),
  };
}

/**
 * Main-process-only bridge for closed native operations. This is the sole
 * boundary that receives verified component paths. It must validate ownership
 * of the opaque payload and must never accept argv, environment, or paths from
 * the payload/caller.
 */
export interface PrivilegedNodeTrustedComponentExecutorPort {
  /** Runtime ownership check, normally backed by the adapter's private WeakMap. */
  ownsPayload(
    payload: TrustedComponentOperationPayload,
    operation: TrustedComponentExecutionOperation,
  ): boolean;
  invoke(request: {
    readonly operation: TrustedComponentExecutionOperation;
    readonly brokerPath: string;
    readonly targetPath: string;
    readonly payload: TrustedComponentOperationPayload;
  }): Promise<void>;
}

export interface CreateNodeTrustedComponentRegistryOptions {
  readonly appRoot: string;
  readonly manifest: unknown;
  readonly trustedKeys: TrustedPublicKeyRegistry;
  /** Exact release identity compiled/configured independently of the signed manifest. */
  readonly expectedRelease: TrustedComponentReleaseIdentity;
  readonly expectedPlatform?: TrustedComponentPlatform;
  readonly expectedArch?: TrustedComponentArch;
  /** Omit for signature/package diagnostics; invocation then fails closed. */
  readonly nativeExecutor?: PrivilegedNodeTrustedComponentExecutorPort;
}

export type CreateNodeM3TrustedComponentRegistryOptions =
  Omit<CreateNodeTrustedComponentRegistryOptions, "nativeExecutor"> & {
    readonly nativeExecutor: PrivilegedNodeTrustedComponentExecutorPort;
  };

interface ExecutionGrantEntry {
  readonly operation: TrustedComponentExecutionOperation;
  readonly broker: TrustedComponentManifestEntry;
  readonly target: TrustedComponentManifestEntry;
  consumed: boolean;
}

/**
 * Verify the signed installed-component manifest and every named file.
 * Selection later re-verifies the chosen bytes and returns no executable path.
 */
async function createRegistry(
  options: CreateNodeTrustedComponentRegistryOptions,
  requireM3ReleaseSet: boolean,
): Promise<TrustedComponentRegistry> {
  const verifiedManifest = verifyTrustedComponentManifest({
    manifest: options.manifest,
    trustedKeys: options.trustedKeys,
    expectedRelease: options.expectedRelease,
    expectedPlatform: options.expectedPlatform ?? currentPlatform(),
    expectedArch: options.expectedArch ?? currentArch(),
  });
  if (requireM3ReleaseSet) assertRequiredM3ReleaseSet(verifiedManifest);
  const configuredExecutor = options.nativeExecutor;
  if (
    configuredExecutor !== undefined &&
    (typeof configuredExecutor !== "object" ||
      typeof configuredExecutor.ownsPayload !== "function" ||
      typeof configuredExecutor.invoke !== "function")
  ) fail("executionUnavailable");
  if (requireM3ReleaseSet && configuredExecutor === undefined) fail("executionUnavailable");
  const nativeExecutor = configuredExecutor === undefined
    ? undefined
    : Object.freeze({
        ownsPayload: configuredExecutor.ownsPayload.bind(configuredExecutor),
        invoke: configuredExecutor.invoke.bind(configuredExecutor),
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
  const locatorEntries = new WeakMap<object, TrustedComponentManifestEntry>();
  const executionGrants = new WeakMap<object, ExecutionGrantEntry>();
  const identities: TrustedComponentIdentity[] = [];
  for (let index = 0; index < verifiedManifest.components.length; index++) {
    const entry = verifiedManifest.components[index];
    if (entry === undefined) continue;
    const key = selectionKey(entry.role, entry.id);
    entries.set(key, entry);
    const locator = Object.freeze({
      token: "trusted-component:" + index.toString(10).padStart(4, "0"),
    }) as TrustedComponentLocator;
    locators.set(key, locator);
    locatorEntries.set(locator, entry);
    identities.push(identity(entry));
  }

  const execution = Object.freeze({
    async authorize(rawRequest: TrustedComponentExecutionRequest): Promise<TrustedComponentExecutionGrant> {
      const request = validateExecutionRequest(rawRequest);
      const broker = locatorEntries.get(request.broker);
      const target = locatorEntries.get(request.target);
      const expectedTargetRole = EXECUTION_TARGET_ROLES[request.operation];
      if (
        broker === undefined ||
        target === undefined ||
        broker.role !== "executionBroker" ||
        target.role !== expectedTargetRole ||
        broker.platform !== target.platform ||
        broker.arch !== target.arch
      ) fail("invalidSelection");
      try {
        await verifyComponentBytes(root, broker);
      } catch {
        fail("componentVerificationFailed", safeSubject(broker));
      }
      try {
        await verifyComponentBytes(root, target);
      } catch {
        fail("componentVerificationFailed", safeSubject(target));
      }
      const grant = Object.freeze({
        token: "trusted-execution:" + randomUUID(),
        operation: request.operation,
        broker: identity(broker),
        target: identity(target),
      }) as TrustedComponentExecutionGrant;
      executionGrants.set(grant, {
        operation: request.operation,
        broker,
        target,
        consumed: false,
      });
      return grant;
    },
    async invoke(rawInvocation: TrustedComponentExecutionInvocation): Promise<void> {
      const invocation = validateExecutionInvocation(rawInvocation);
      const grantEntry = executionGrants.get(invocation.grant);
      if (grantEntry === undefined || grantEntry.consumed) fail("invalidExecutionGrant");
      if (invocation.payload.operation !== grantEntry.operation) fail("invalidExecutionGrant");
      const executor = nativeExecutor;
      if (executor === undefined) fail("executionUnavailable");
      let ownsPayload = false;
      try {
        ownsPayload = executor.ownsPayload(invocation.payload, grantEntry.operation);
      } catch {
        fail("invalidSelection");
      }
      if (!ownsPayload) fail("invalidSelection");

      // Make concurrent/replayed use impossible before crossing an await point.
      grantEntry.consumed = true;
      try {
        await verifyComponentBytes(root, grantEntry.broker);
        await verifyComponentBytes(root, grantEntry.target);
      } catch {
        fail("componentVerificationFailed", safeSubject(grantEntry.target));
      }
      try {
        await executor.invoke(Object.freeze({
          operation: grantEntry.operation,
          brokerPath: resolve(
            root,
            ...trustedComponentPathSegments(grantEntry.broker.relativePath),
          ),
          targetPath: resolve(
            root,
            ...trustedComponentPathSegments(grantEntry.target.relativePath),
          ),
          payload: invocation.payload,
        }));
      } catch {
        fail("executionFailed");
      }
    },
  });

  return Object.freeze({
    manifestHash: verifiedManifest.manifestHash,
    signingKeyId: verifiedManifest.signingKeyId,
    release: verifiedManifest.release,
    components: Object.freeze(identities),
    execution,
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

/** Create a registry for partial component tooling and signature diagnostics. */
export function createNodeTrustedComponentRegistry(
  options: CreateNodeTrustedComponentRegistryOptions,
): Promise<TrustedComponentRegistry> {
  return createRegistry(options, false);
}

/** Production M3 constructor: rejects any incomplete signed release set. */
export function createNodeM3TrustedComponentRegistry(
  options: CreateNodeM3TrustedComponentRegistryOptions,
): Promise<TrustedComponentRegistry> {
  return createRegistry(options, true);
}
