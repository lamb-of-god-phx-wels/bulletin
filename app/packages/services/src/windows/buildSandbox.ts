import { randomUUID } from "node:crypto";
import {
  canonicalStringify,
  hashBytes,
  type Sha256Hash,
} from "@cbb/core";
import {
  WINDOWS_M3_SANDBOX_POLICY,
  WindowsSandboxBrokerError,
  type WindowsSandboxBrokerPort,
} from "@cbb/workers";
import type { CompileOutputReaderPort } from "../artifacts/index.js";
import type { ResourceStagingEntry } from "../resources/index.js";
import type {
  BuildOutputHandle,
  BuildRootHandle,
  IsolatedTypstSandboxPort,
  SandboxCompileResult,
  StagedByteIdentity,
  TrustedTypstRequirement,
  VerifiedPdfOutput,
} from "../build/runner.js";
import type { ResourceStagingBytePort } from "../build/nodeSandbox.js";

const HASH = /^sha256:[0-9a-f]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CAPABILITY = /^wcap:[0-9a-f]{64}$/u;
const ROOT = /^wroot:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const OUTPUT = /^artifact-output:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ASSET_ALIAS = /^assets\/a[0-9]{4}\.(?:png|jpg|svg|pdf|bin)$/u;
const FONT_ALIAS = /^fonts\/f[0-9]{4}-[0-9]{4}\.(?:ttf|otf|woff|woff2)$/u;
const DIAGNOSTIC = /^CBB-[A-Z]+-[0-9]{4}$/u;
const MAX_BYTES = 1024 * 1024 * 1024;

export interface WindowsSandboxInputCapabilityRequest {
  readonly version: 1;
  readonly purpose: "typstSource" | "buildResource" | "pdfInspection";
  readonly bytes: Uint8Array;
  readonly expectedHash: Sha256Hash;
  readonly maximumBytes: number;
}

export interface WindowsSandboxOutputCapabilityRequest {
  readonly version: 1;
  readonly handle: BuildOutputHandle;
  readonly maximumBytes: number;
}

/** Native implementation duplicates handles into the broker; it never returns a path. */
export interface WindowsSandboxCapabilityPort {
  createInput(request: WindowsSandboxInputCapabilityRequest): Promise<unknown>;
  readOutput(request: WindowsSandboxOutputCapabilityRequest): Promise<Uint8Array>;
  release(handle: string): Promise<void>;
}

export interface NodeWindowsOfflineTypstSandboxOptions {
  readonly broker: WindowsSandboxBrokerPort;
  readonly capabilities: WindowsSandboxCapabilityPort;
  readonly resources: ResourceStagingBytePort;
  readonly typst: TrustedTypstRequirement;
}

interface BuildEntry {
  readonly buildId: string;
  readonly root: BuildRootHandle;
  compileRequestId?: string;
}

export type NodeWindowsTypstSandboxErrorKind =
  | "invalidConfiguration"
  | "invalidHandle"
  | "capabilityRejected"
  | "brokerRejected"
  | "outputRejected";

export class NodeWindowsTypstSandboxError extends Error {
  readonly code = "CBB-SECURITY-0001" as const;

  constructor(public readonly kind: NodeWindowsTypstSandboxErrorKind) {
    super("Windows offline Typst sandbox failed closed");
    this.name = "NodeWindowsTypstSandboxError";
  }
}

function fail(kind: NodeWindowsTypstSandboxErrorKind): never {
  throw new NodeWindowsTypstSandboxError(kind);
}

function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("brokerRejected");
  const record = value as Readonly<Record<string, unknown>>;
  const allowed = new Set([...required, ...optional]);
  const keys = Reflect.ownKeys(record);
  if (
    keys.some((key) => typeof key !== "string" || !allowed.has(key)) ||
    required.some((key) => !Object.hasOwn(record, key))
  ) fail("brokerRejected");
  return record;
}

function validateIdentity(hash: unknown, byteSize: unknown): StagedByteIdentity {
  if (
    typeof hash !== "string" || !HASH.test(hash) ||
    !Number.isSafeInteger(byteSize) || Number(byteSize) < 1 || Number(byteSize) > MAX_BYTES
  ) fail("brokerRejected");
  return { observedHash: hash as Sha256Hash, observedByteSize: Number(byteSize) };
}

function validateCapability(raw: unknown, expectedHash: Sha256Hash, expectedBytes: number): string {
  const value = exact(raw, ["version", "kind", "handle", "hash", "byteSize"]);
  if (
    value["version"] !== 1 || value["kind"] !== "windowsSandboxInputCapability" ||
    typeof value["handle"] !== "string" || !CAPABILITY.test(value["handle"]) ||
    value["hash"] !== expectedHash || value["byteSize"] !== expectedBytes
  ) fail("capabilityRejected");
  return value["handle"];
}

function allowedTool(broker: WindowsSandboxBrokerPort, tool: TrustedTypstRequirement): boolean {
  return broker.allowedTools.some((candidate) =>
    candidate.toolId === tool.toolId && candidate.version === tool.version &&
    candidate.hash === tool.executableHash
  );
}

export class NodeWindowsOfflineTypstSandbox implements IsolatedTypstSandboxPort {
  readonly isolationProfile = "offlineTypstV1" as const;
  private readonly builds = new Map<BuildRootHandle, BuildEntry>();

  constructor(private readonly options: NodeWindowsOfflineTypstSandboxOptions) {
    if (
      canonicalStringify(options.broker.policy) !== canonicalStringify(WINDOWS_M3_SANDBOX_POLICY) ||
      options.typst.toolId !== "typst" || !HASH.test(options.typst.executableHash) ||
      options.typst.version.length < 1 || !allowedTool(options.broker, options.typst) ||
      typeof options.capabilities.createInput !== "function" ||
      typeof options.capabilities.readOutput !== "function" ||
      typeof options.capabilities.release !== "function" ||
      typeof options.resources.read !== "function"
    ) throw new WindowsSandboxBrokerError("handshakeRejected");
  }

  async verifyTrustedTool(requirement: TrustedTypstRequirement): Promise<boolean> {
    return requirement.toolId === this.options.typst.toolId &&
      requirement.version === this.options.typst.version &&
      requirement.executableHash === this.options.typst.executableHash &&
      allowedTool(this.options.broker, requirement);
  }

  async createBuildRoot(buildId: string): Promise<BuildRootHandle> {
    if (!UUID.test(buildId) || [...this.builds.values()].some((entry) => entry.buildId === buildId)) {
      fail("invalidHandle");
    }
    const requestId = randomUUID();
    const result = exact(await this.options.broker.invoke({
      requestId,
      profile: "typstBuildV1",
      action: "createBuildRoot",
      payload: Object.freeze({ version: 1, buildId }),
    }), ["version", "kind", "buildId", "root"]);
    if (
      result["version"] !== 1 || result["kind"] !== "windowsBuildRoot" ||
      result["buildId"] !== buildId || typeof result["root"] !== "string" ||
      !ROOT.test(result["root"])
    ) fail("brokerRejected");
    const root = result["root"] as BuildRootHandle;
    if (this.builds.has(root)) fail("brokerRejected");
    this.builds.set(root, { buildId, root });
    return root;
  }

  stageSource(
    root: BuildRootHandle,
    source: Uint8Array,
    expectedHash: Sha256Hash,
  ): Promise<StagedByteIdentity> {
    return this.stage(root, source, expectedHash, "typstSource", {
      version: 1,
      kind: "source",
      relativePath: "main.typ",
    });
  }

  async stageResource(
    root: BuildRootHandle,
    entry: ResourceStagingEntry,
  ): Promise<StagedByteIdentity> {
    const supportedKind = entry.kind === "asset" || entry.kind === "fontFace";
    const safe = supportedKind && typeof entry.relativePath === "string" && (
      entry.kind === "asset"
        ? ASSET_ALIAS.test(entry.relativePath)
        : FONT_ALIAS.test(entry.relativePath)
    );
    if (
      !supportedKind || typeof entry.relativePath !== "string" || !safe ||
      typeof entry.hash !== "string" || !HASH.test(entry.hash) ||
      !Number.isSafeInteger(entry.byteSize) || entry.byteSize < 1 || entry.byteSize > MAX_BYTES
    ) {
      fail("invalidHandle");
    }
    const bytes = await this.options.resources.read(entry);
    if (bytes.byteLength !== entry.byteSize || hashBytes(bytes) !== entry.hash) {
      fail("capabilityRejected");
    }
    return this.stage(root, bytes, entry.hash, "buildResource", {
      version: 1,
      kind: entry.kind,
      relativePath: entry.relativePath,
    });
  }

  async compile(root: BuildRootHandle, signal?: AbortSignal): Promise<SandboxCompileResult> {
    const build = this.requireBuild(root);
    if (build.compileRequestId !== undefined) fail("invalidHandle");
    if (signal?.aborted) return { kind: "canceled" };
    const requestId = randomUUID();
    build.compileRequestId = requestId;
    const abort = () => { void this.options.broker.cancel(requestId).catch(() => undefined); };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const result = exact(await this.options.broker.invoke({
        requestId,
        profile: "typstBuildV1",
        action: "compileTypst",
        payload: Object.freeze({
          version: 1,
          root,
          tool: Object.freeze({
            toolId: this.options.typst.toolId,
            version: this.options.typst.version,
            hash: this.options.typst.executableHash,
          }),
        }),
      }), ["version", "kind", "status", "diagnosticCodes"]);
      if (
        result["version"] !== 1 || result["kind"] !== "windowsTypstCompileResult" ||
        !["succeeded", "failed", "canceled"].includes(String(result["status"])) ||
        !Array.isArray(result["diagnosticCodes"]) || result["diagnosticCodes"].length > 1_000 ||
        result["diagnosticCodes"].some((code) => typeof code !== "string" || !DIAGNOSTIC.test(code))
      ) fail("brokerRejected");
      if (result["status"] === "succeeded") return { kind: "succeeded" };
      if (result["status"] === "canceled") return { kind: "canceled" };
      return { kind: "failed", diagnosticCodes: result["diagnosticCodes"] as string[] };
    } finally {
      signal?.removeEventListener("abort", abort);
      delete build.compileRequestId;
    }
  }

  async verifyPdf(root: BuildRootHandle): Promise<VerifiedPdfOutput> {
    this.requireBuild(root);
    const result = exact(await this.options.broker.invoke({
      requestId: randomUUID(),
      profile: "typstBuildV1",
      action: "verifyBuildPdf",
      payload: Object.freeze({ version: 1, root }),
    }), [
      "version", "kind", "root", "output", "hash", "byteSize", "pageCount",
      "pdfVersion", "magicVerified",
    ]);
    if (
      result["version"] !== 1 || result["kind"] !== "windowsVerifiedBuildPdf" ||
      result["root"] !== root || typeof result["output"] !== "string" ||
      !OUTPUT.test(result["output"]) || result["magicVerified"] !== true ||
      !HASH.test(String(result["hash"])) || !Number.isSafeInteger(result["byteSize"]) ||
      Number(result["byteSize"]) < 1 || Number(result["byteSize"]) > MAX_BYTES ||
      !Number.isSafeInteger(result["pageCount"]) || Number(result["pageCount"]) < 1 ||
      Number(result["pageCount"]) > 1_000 ||
      typeof result["pdfVersion"] !== "string" || !/^(?:1\.[0-7]|2\.0)$/u.test(result["pdfVersion"])
    ) fail("outputRejected");
    return {
      handle: result["output"] as BuildOutputHandle,
      hash: result["hash"] as Sha256Hash,
      byteSize: Number(result["byteSize"]),
      pageCount: Number(result["pageCount"]),
      pdfVersion: result["pdfVersion"],
      magicVerified: true,
    };
  }

  async terminate(root: BuildRootHandle): Promise<void> {
    const build = this.requireBuild(root);
    if (build.compileRequestId !== undefined) {
      await this.options.broker.cancel(build.compileRequestId).catch(() => undefined);
    }
    this.validateAck(await this.options.broker.invoke({
      requestId: randomUUID(),
      profile: "typstBuildV1",
      action: "terminateBuild",
      payload: Object.freeze({ version: 1, root }),
    }), "windowsBuildTerminated", root);
  }

  async cleanup(root: BuildRootHandle): Promise<void> {
    this.requireBuild(root);
    this.validateAck(await this.options.broker.invoke({
      requestId: randomUUID(),
      profile: "typstBuildV1",
      action: "cleanupBuild",
      payload: Object.freeze({ version: 1, root }),
    }), "windowsBuildCleaned", root);
    this.builds.delete(root);
  }

  private async stage(
    root: BuildRootHandle,
    bytes: Uint8Array,
    expectedHash: Sha256Hash,
    purpose: WindowsSandboxInputCapabilityRequest["purpose"],
    descriptor: Readonly<Record<string, unknown>>,
  ): Promise<StagedByteIdentity> {
    this.requireBuild(root);
    if (
      !(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > MAX_BYTES ||
      !HASH.test(expectedHash) || hashBytes(bytes) !== expectedHash
    ) fail("capabilityRejected");
    const capability = validateCapability(await this.options.capabilities.createInput({
      version: 1,
      purpose,
      bytes: new Uint8Array(bytes),
      expectedHash,
      maximumBytes: bytes.byteLength,
    }), expectedHash, bytes.byteLength);
    try {
      const result = exact(await this.options.broker.invoke({
        requestId: randomUUID(),
        profile: "typstBuildV1",
        action: purpose === "typstSource" ? "stageBuildSource" : "stageBuildResource",
        payload: Object.freeze({
          ...descriptor,
          root,
          input: capability,
          hash: expectedHash,
          byteSize: bytes.byteLength,
        }),
      }), ["version", "kind", "root", "hash", "byteSize"]);
      if (
        result["version"] !== 1 || result["kind"] !== "windowsStagedBuildBytes" ||
        result["root"] !== root
      ) fail("brokerRejected");
      const identity = validateIdentity(result["hash"], result["byteSize"]);
      if (
        identity.observedHash !== expectedHash ||
        identity.observedByteSize !== bytes.byteLength
      ) fail("brokerRejected");
      return identity;
    } finally {
      await this.options.capabilities.release(capability).catch(() => undefined);
    }
  }

  private requireBuild(root: BuildRootHandle): BuildEntry {
    if (typeof root !== "string" || !ROOT.test(root)) fail("invalidHandle");
    const build = this.builds.get(root);
    if (build === undefined) fail("invalidHandle");
    return build;
  }

  private validateAck(raw: unknown, kind: string, root: BuildRootHandle): void {
    const result = exact(raw, ["version", "kind", "root"]);
    if (result["version"] !== 1 || result["kind"] !== kind || result["root"] !== root) {
      fail("brokerRejected");
    }
  }
}

export function createWindowsBrokerCompileOutputReader(
  capabilities: WindowsSandboxCapabilityPort,
): CompileOutputReaderPort {
  return Object.freeze({
    async readVerifiedPdf(handle: BuildOutputHandle): Promise<Uint8Array> {
      if (typeof handle !== "string" || !OUTPUT.test(handle)) fail("outputRejected");
      // Hash/size are re-bound by ImmutableArtifactStore against runner evidence;
      // this port requires the native capability owner to cap the read itself.
      try {
        const bytes = await capabilities.readOutput({
          version: 1,
          handle,
          maximumBytes: MAX_BYTES,
        });
        if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > MAX_BYTES) {
          fail("outputRejected");
        }
        return new Uint8Array(bytes);
      } finally {
        await capabilities.release(handle).catch(() => undefined);
      }
    },
  });
}
