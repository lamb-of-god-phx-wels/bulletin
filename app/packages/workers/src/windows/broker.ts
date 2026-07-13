import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
  canonicalStringify,
  hashBytes,
  type Sha256Hash,
} from "@cbb/core";

const HASH = /^sha256:[0-9a-f]{64}$/u;
const THUMBPRINT = /^[0-9a-f]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SESSION = /^wsb:[0-9a-f]{64}$/u;
const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.+:-]{0,127}$/u;
const MAX_HELPER_BYTES = 256 * 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;

export const WINDOWS_SANDBOX_BROKER_PROTOCOL = "cbb-windows-sandbox-v1" as const;

/** Exact policy a signed helper must prove before it receives any capability. */
export const WINDOWS_M3_SANDBOX_POLICY = Object.freeze({
  version: 1 as const,
  kind: "cbbWindowsSandboxPolicy" as const,
  token: Object.freeze({
    restrictedPrimaryToken: true as const,
    adminSidsDenyOnly: true as const,
    allPrivilegesRemoved: true as const,
    integrityLevel: "low" as const,
    childTokenCreationDenied: true as const,
  }),
  job: Object.freeze({
    killOnJobClose: true as const,
    breakawayDenied: true as const,
    activeProcessLimit: 8 as const,
    processMemoryLimitBytes: 1_073_741_824 as const,
    jobMemoryLimitBytes: 2_147_483_648 as const,
    cpuTimeLimitMs: 120_000 as const,
    uiRestrictions: "all" as const,
  }),
  network: Object.freeze({
    mode: "denyAll" as const,
    enforcement: "windowsFilteringPlatform" as const,
    inboundDenied: true as const,
    outboundDenied: true as const,
    loopbackDenied: true as const,
  }),
  handles: Object.freeze({
    explicitAllowlistOnly: true as const,
    inheritAllDenied: true as const,
    requestPathsDenied: true as const,
    reparsePointsDenied: true as const,
  }),
  quotas: Object.freeze({
    wallClockLimitMs: 120_000 as const,
    stdoutBytes: 1_048_576 as const,
    stderrBytes: 1_048_576 as const,
    buildInputBytes: 1_073_741_824 as const,
    buildOutputBytes: 1_073_741_824 as const,
    pdfInspectionInputBytes: 1_073_741_824 as const,
    quarantineInputBytes: 1_073_741_824 as const,
    quarantineEntryBytes: 1_073_741_824 as const,
    quarantineOperationOutputBytes: 1_073_741_824 as const,
    quarantineArchiveAggregateBytes: 4_294_967_296 as const,
    quarantineArchiveScratchBytes: 4_294_967_296 as const,
  }),
});

export type WindowsM3SandboxPolicy = typeof WINDOWS_M3_SANDBOX_POLICY;

export interface WindowsSandboxAllowedTool {
  readonly toolId: string;
  readonly version: string;
  readonly hash: Sha256Hash;
}

export interface PinnedWindowsSandboxBroker {
  readonly path: string;
  readonly hash: Sha256Hash;
  readonly signerSha256Thumbprint: string;
  readonly architecture: "x64" | "arm64";
  readonly version: string;
}

export interface WindowsAuthenticodeVerificationRequest {
  readonly version: 1;
  readonly path: string;
  readonly hash: Sha256Hash;
  readonly signerSha256Thumbprint: string;
}

export interface WindowsAuthenticodeVerifierPort {
  /** Production implementations must use WinVerifyTrust, not a helper subprocess. */
  verify(request: WindowsAuthenticodeVerificationRequest): Promise<unknown>;
}

export interface WindowsSandboxNativeTransport {
  handshake(request: unknown): Promise<unknown>;
  invoke(request: unknown): Promise<unknown>;
  cancel(requestId: string): Promise<void>;
  close(): Promise<void>;
}

export interface WindowsSandboxNativeTransportFactory {
  /**
   * Launch/connect through app-owned native code with an explicit handle list.
   * A raw Node child_process implementation does not satisfy this contract.
   */
  connect(image: {
    readonly path: string;
    readonly hash: Sha256Hash;
    readonly version: string;
  }): Promise<WindowsSandboxNativeTransport>;
}

export type WindowsSandboxProfile = "quarantineV1" | "typstBuildV1" | "pdfInspectV1";
export type WindowsSandboxAction =
  | "quarantine"
  | "createBuildRoot"
  | "stageBuildSource"
  | "stageBuildResource"
  | "compileTypst"
  | "verifyBuildPdf"
  | "terminateBuild"
  | "cleanupBuild"
  | "inspectPdf";

export interface WindowsSandboxInvocation {
  readonly requestId: string;
  readonly profile: WindowsSandboxProfile;
  readonly action: WindowsSandboxAction;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface WindowsSandboxResponseExpectation {
  readonly sessionId: string;
  readonly request: WindowsSandboxInvocation;
}

export interface WindowsSandboxBrokerPort {
  readonly sessionId: string;
  readonly policy: WindowsM3SandboxPolicy;
  readonly allowedTools: readonly WindowsSandboxAllowedTool[];
  invoke(request: WindowsSandboxInvocation): Promise<unknown>;
  /** Resolves only after Job closure/reaping and duplicated request handles are closed. */
  cancel(requestId: string): Promise<void>;
  close(): Promise<void>;
}

export type WindowsSandboxBrokerErrorKind =
  | "platformUnavailable"
  | "invalidConfiguration"
  | "imageVerificationFailed"
  | "signatureVerificationFailed"
  | "handshakeRejected"
  | "protocolRejected";

export class WindowsSandboxBrokerError extends Error {
  readonly code = "CBB-SECURITY-0001" as const;

  constructor(public readonly kind: WindowsSandboxBrokerErrorKind) {
    super("The signed Windows sandbox broker is unavailable or failed closed");
    this.name = "WindowsSandboxBrokerError";
  }
}

export interface WindowsSandboxHandshakeExpectation {
  readonly challenge: string;
  readonly helper: PinnedWindowsSandboxBroker;
  readonly allowedTools: readonly WindowsSandboxAllowedTool[];
}

export interface WindowsSandboxBrokerAttestation {
  readonly sessionId: string;
  readonly helperHash: Sha256Hash;
  readonly helperVersion: string;
  readonly signerSha256Thumbprint: string;
  readonly allowedTools: readonly WindowsSandboxAllowedTool[];
  readonly policy: WindowsM3SandboxPolicy;
}

interface StableImage {
  readonly path: string;
  readonly hash: Sha256Hash;
  readonly identity: {
    readonly dev: bigint;
    readonly ino: bigint;
    readonly size: bigint;
    readonly mtimeNs: bigint;
    readonly ctimeNs: bigint;
    readonly nlink: bigint;
  };
}

function fail(kind: WindowsSandboxBrokerErrorKind): never {
  throw new WindowsSandboxBrokerError(kind);
}

function exact(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("protocolRejected");
  const record = value as Readonly<Record<string, unknown>>;
  const own = Reflect.ownKeys(record);
  if (
    own.length !== keys.length ||
    own.some((key) => typeof key !== "string" || !keys.includes(key)) ||
    keys.some((key) => !Object.hasOwn(record, key))
  ) fail("protocolRejected");
  return record;
}

function validateInvocation(value: unknown): asserts value is WindowsSandboxInvocation {
  const request = exact(value, ["requestId", "profile", "action", "payload"]);
  const profileActions: Readonly<Record<WindowsSandboxProfile, readonly WindowsSandboxAction[]>> = {
    quarantineV1: ["quarantine"],
    typstBuildV1: [
      "createBuildRoot", "stageBuildSource", "stageBuildResource", "compileTypst",
      "verifyBuildPdf", "terminateBuild", "cleanupBuild",
    ],
    pdfInspectV1: ["inspectPdf"],
  };
  if (
    typeof request["requestId"] !== "string" || !UUID.test(request["requestId"]) ||
    typeof request["profile"] !== "string" ||
    typeof request["action"] !== "string" || !SAFE_TOKEN.test(request["action"]) ||
    request["payload"] === null || typeof request["payload"] !== "object" ||
    Array.isArray(request["payload"]) ||
    !Object.hasOwn(profileActions, request["profile"]) ||
    !profileActions[request["profile"] as WindowsSandboxProfile].includes(
      request["action"] as WindowsSandboxAction,
    )
  ) fail("protocolRejected");
}

function closedTools(value: readonly WindowsSandboxAllowedTool[]): readonly WindowsSandboxAllowedTool[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) fail("invalidConfiguration");
  const tools = value.map((tool) => {
    if (
      !exact(tool, ["toolId", "version", "hash"]) ||
      !SAFE_TOKEN.test(tool.toolId) ||
      !SAFE_TOKEN.test(tool.version) ||
      !HASH.test(tool.hash)
    ) fail("invalidConfiguration");
    return Object.freeze({ toolId: tool.toolId, version: tool.version, hash: tool.hash });
  }).sort((left, right) =>
    left.toolId < right.toolId ? -1 : left.toolId > right.toolId ? 1 :
      left.version < right.version ? -1 : left.version > right.version ? 1 :
        left.hash < right.hash ? -1 : left.hash > right.hash ? 1 : 0
  );
  if (new Set(tools.map((tool) => tool.toolId)).size !== tools.length) {
    fail("invalidConfiguration");
  }
  return Object.freeze(tools);
}

function sameIdentity(left: StableImage["identity"], right: StableImage["identity"]): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs &&
    left.nlink === right.nlink;
}

function readU16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.byteLength) fail("imageVerificationFailed");
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
}

function readU32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.byteLength) fail("imageVerificationFailed");
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

/** Validate a real PE32+ executable image, not merely an MZ-prefixed blob. */
export function validateWindowsPeImage(
  bytes: Uint8Array,
  architecture: "x64" | "arm64",
): void {
  if (bytes.byteLength < 512 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
    fail("imageVerificationFailed");
  }
  const pe = readU32(bytes, 0x3c);
  if (
    pe < 0x40 || pe + 24 > bytes.byteLength ||
    bytes[pe] !== 0x50 || bytes[pe + 1] !== 0x45 ||
    bytes[pe + 2] !== 0 || bytes[pe + 3] !== 0
  ) fail("imageVerificationFailed");
  const machine = readU16(bytes, pe + 4);
  const sections = readU16(bytes, pe + 6);
  const optionalBytes = readU16(bytes, pe + 20);
  const characteristics = readU16(bytes, pe + 22);
  const expectedMachine = architecture === "x64" ? 0x8664 : 0xaa64;
  if (
    machine !== expectedMachine || sections < 1 || sections > 96 ||
    optionalBytes < 112 || pe + 24 + optionalBytes + sections * 40 > bytes.byteLength ||
    (characteristics & 0x0002) === 0 || (characteristics & 0x2000) !== 0 ||
    readU16(bytes, pe + 24) !== 0x020b
  ) fail("imageVerificationFailed");
  let executableSection = false;
  const sectionTable = pe + 24 + optionalBytes;
  for (let index = 0; index < sections; index += 1) {
    const section = sectionTable + index * 40;
    const rawSize = readU32(bytes, section + 16);
    const rawOffset = readU32(bytes, section + 20);
    const flags = readU32(bytes, section + 36);
    if (rawSize > 0 && (rawOffset < 1 || rawOffset + rawSize > bytes.byteLength)) {
      fail("imageVerificationFailed");
    }
    if ((flags & 0x20000000) !== 0 && rawSize > 0) executableSection = true;
  }
  if (!executableSection) fail("imageVerificationFailed");
}

async function readStableImage(helper: PinnedWindowsSandboxBroker): Promise<StableImage> {
  if (
    !isAbsolute(helper.path) || resolve(helper.path) !== helper.path ||
    !/\.exe$/iu.test(helper.path) || !HASH.test(helper.hash) ||
    !THUMBPRINT.test(helper.signerSha256Thumbprint) || !SAFE_TOKEN.test(helper.version)
  ) fail("invalidConfiguration");
  const before = await lstat(helper.path, { bigint: true }).catch(() => fail("imageVerificationFailed"));
  if (
    before.isSymbolicLink() || !before.isFile() || before.nlink !== 1n ||
    before.size < 512n || before.size > BigInt(MAX_HELPER_BYTES) ||
    await realpath(helper.path) !== helper.path
  ) fail("imageVerificationFailed");
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  const handle = await open(helper.path, constants.O_RDONLY | noFollow).catch(() => fail("imageVerificationFailed"));
  try {
    const opened = await handle.stat({ bigint: true });
    const identity = {
      dev: opened.dev, ino: opened.ino, size: opened.size,
      mtimeNs: opened.mtimeNs, ctimeNs: opened.ctimeNs, nlink: opened.nlink,
    };
    if (!opened.isFile() || !sameIdentity(identity, {
      dev: before.dev, ino: before.ino, size: before.size,
      mtimeNs: before.mtimeNs, ctimeNs: before.ctimeNs, nlink: before.nlink,
    })) fail("imageVerificationFailed");
    const bytes = new Uint8Array(Number(opened.size));
    let position = 0;
    while (position < bytes.byteLength) {
      const length = Math.min(READ_CHUNK_BYTES, bytes.byteLength - position);
      const read = await handle.read(bytes, position, length, position);
      if (read.bytesRead < 1) fail("imageVerificationFailed");
      position += read.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (!sameIdentity(identity, {
      dev: after.dev, ino: after.ino, size: after.size,
      mtimeNs: after.mtimeNs, ctimeNs: after.ctimeNs, nlink: after.nlink,
    })) fail("imageVerificationFailed");
    validateWindowsPeImage(bytes, helper.architecture);
    const hash = hashBytes(bytes);
    if (hash !== helper.hash) fail("imageVerificationFailed");
    return { path: helper.path, hash, identity };
  } finally {
    await handle.close();
  }
}

/** Linux-runnable PE/hash verifier used before the Windows native trust seam. */
export async function verifyPinnedWindowsSandboxBroker(
  helper: PinnedWindowsSandboxBroker,
): Promise<{ readonly path: string; readonly hash: Sha256Hash }> {
  const image = await readStableImage(helper);
  return Object.freeze({ path: image.path, hash: image.hash });
}

export function validateWindowsSandboxBrokerHandshake(
  value: unknown,
  expected: WindowsSandboxHandshakeExpectation,
): WindowsSandboxBrokerAttestation {
  const response = exact(value, [
    "version", "kind", "protocol", "challenge", "sessionId", "helperHash",
    "helperVersion", "signerSha256Thumbprint", "authenticodeVerified",
    "appOwnedImage", "policy", "allowedTools",
  ]);
  const expectedTools = closedTools(expected.allowedTools);
  if (
    response["version"] !== 1 || response["kind"] !== "cbbWindowsSandboxHandshake" ||
    response["protocol"] !== WINDOWS_SANDBOX_BROKER_PROTOCOL ||
    response["challenge"] !== expected.challenge ||
    typeof response["sessionId"] !== "string" || !SESSION.test(response["sessionId"]) ||
    response["helperHash"] !== expected.helper.hash ||
    response["helperVersion"] !== expected.helper.version ||
    response["signerSha256Thumbprint"] !== expected.helper.signerSha256Thumbprint ||
    response["authenticodeVerified"] !== true || response["appOwnedImage"] !== true ||
    canonicalStringify(response["policy"]) !== canonicalStringify(WINDOWS_M3_SANDBOX_POLICY) ||
    canonicalStringify(response["allowedTools"]) !== canonicalStringify(expectedTools)
  ) fail("handshakeRejected");
  return Object.freeze({
    sessionId: response["sessionId"],
    helperHash: expected.helper.hash,
    helperVersion: expected.helper.version,
    signerSha256Thumbprint: expected.helper.signerSha256Thumbprint,
    allowedTools: expectedTools,
    policy: WINDOWS_M3_SANDBOX_POLICY,
  });
}

/** Validate the closed response envelope independently of the native transport. */
export function validateWindowsSandboxBrokerResponse(
  value: unknown,
  expected: WindowsSandboxResponseExpectation,
): unknown {
  validateInvocation(expected.request);
  if (!SESSION.test(expected.sessionId)) fail("protocolRejected");
  const response = exact(value, [
    "version", "kind", "protocol", "sessionId", "requestId", "profile",
    "action", "status", "result",
  ]);
  if (
    response["version"] !== 1 || response["kind"] !== "cbbWindowsSandboxResponse" ||
    response["protocol"] !== WINDOWS_SANDBOX_BROKER_PROTOCOL ||
    response["sessionId"] !== expected.sessionId ||
    response["requestId"] !== expected.request.requestId ||
    response["profile"] !== expected.request.profile ||
    response["action"] !== expected.request.action || response["status"] !== "succeeded"
  ) fail("protocolRejected");
  return response["result"];
}

class NodeWindowsSandboxBroker implements WindowsSandboxBrokerPort {
  readonly sessionId: string;
  readonly policy = WINDOWS_M3_SANDBOX_POLICY;
  readonly allowedTools: readonly WindowsSandboxAllowedTool[];

  constructor(
    attestation: WindowsSandboxBrokerAttestation,
    private readonly transport: WindowsSandboxNativeTransport,
  ) {
    this.sessionId = attestation.sessionId;
    this.allowedTools = attestation.allowedTools;
  }

  async invoke(request: WindowsSandboxInvocation): Promise<unknown> {
    validateInvocation(request);
    const raw = await this.transport.invoke({
      version: 1,
      kind: "cbbWindowsSandboxRequest",
      protocol: WINDOWS_SANDBOX_BROKER_PROTOCOL,
      sessionId: this.sessionId,
      requestId: request.requestId,
      profile: request.profile,
      action: request.action,
      payload: request.payload,
    });
    return validateWindowsSandboxBrokerResponse(raw, { sessionId: this.sessionId, request });
  }

  cancel(requestId: string): Promise<void> {
    if (!UUID.test(requestId)) return Promise.reject(new WindowsSandboxBrokerError("protocolRejected"));
    return this.transport.cancel(requestId);
  }

  close(): Promise<void> {
    return this.transport.close();
  }
}

export interface CreateNodeWindowsSandboxBrokerOptions {
  readonly helper: PinnedWindowsSandboxBroker;
  readonly allowedTools: readonly WindowsSandboxAllowedTool[];
  readonly authenticode: WindowsAuthenticodeVerifierPort;
  readonly transports: WindowsSandboxNativeTransportFactory;
}

/**
 * Native acceptance seam. On non-Windows platforms it is unconditionally
 * unavailable; on Windows every image/signature/policy proof is mandatory.
 */
export async function createNodeWindowsSandboxBroker(
  options: CreateNodeWindowsSandboxBrokerOptions,
): Promise<WindowsSandboxBrokerPort> {
  if (process.platform !== "win32") fail("platformUnavailable");
  const tools = closedTools(options.allowedTools);
  const before = await readStableImage(options.helper);
  const signature = exact(await options.authenticode.verify({
    version: 1,
    path: before.path,
    hash: before.hash,
    signerSha256Thumbprint: options.helper.signerSha256Thumbprint,
  }), [
    "version", "kind", "path", "hash", "signerSha256Thumbprint",
    "signatureValid", "appOwnedImage",
  ]);
  if (
    signature["version"] !== 1 || signature["kind"] !== "windowsAuthenticodeEvidence" ||
    signature["path"] !== before.path || signature["hash"] !== before.hash ||
    signature["signerSha256Thumbprint"] !== options.helper.signerSha256Thumbprint ||
    signature["signatureValid"] !== true || signature["appOwnedImage"] !== true
  ) fail("signatureVerificationFailed");
  const afterSignature = await readStableImage(options.helper);
  if (!sameIdentity(before.identity, afterSignature.identity)) fail("imageVerificationFailed");
  const transport = await options.transports.connect({
    path: before.path,
    hash: before.hash,
    version: options.helper.version,
  });
  try {
    const afterConnect = await readStableImage(options.helper);
    if (!sameIdentity(before.identity, afterConnect.identity)) fail("imageVerificationFailed");
    const challenge = randomUUID();
    const raw = await transport.handshake({
      version: 1,
      kind: "cbbWindowsSandboxHandshakeRequest",
      protocol: WINDOWS_SANDBOX_BROKER_PROTOCOL,
      challenge,
      helperHash: options.helper.hash,
      helperVersion: options.helper.version,
      signerSha256Thumbprint: options.helper.signerSha256Thumbprint,
      requiredPolicy: WINDOWS_M3_SANDBOX_POLICY,
      allowedTools: tools,
    });
    const attestation = validateWindowsSandboxBrokerHandshake(raw, {
      challenge,
      helper: options.helper,
      allowedTools: tools,
    });
    return new NodeWindowsSandboxBroker(attestation, transport);
  } catch (error) {
    await transport.close().catch(() => undefined);
    throw error;
  }
}
