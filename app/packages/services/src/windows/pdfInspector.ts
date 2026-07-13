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
import type {
  PdfInspectorIdentity,
  PinnedPdfInspection,
  PinnedPdfInspectorPort,
} from "../artifacts/nodeAdapters.js";
import type { WindowsSandboxCapabilityPort } from "./buildSandbox.js";

const HASH = /^sha256:[0-9a-f]{64}$/u;
const CAPABILITY = /^wcap:[0-9a-f]{64}$/u;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9_.+:-]{0,127}$/u;
const STANDARD = /^[\x21-\x7e]{1,128}$/u;
const MAX_BYTES = 1024 * 1024 * 1024;

export class NodeWindowsPdfInspectorError extends Error {
  readonly code = "CBB-SECURITY-0001" as const;

  constructor() {
    super("Windows broker PDF inspection failed closed");
    this.name = "NodeWindowsPdfInspectorError";
  }
}

function fail(): never {
  throw new NodeWindowsPdfInspectorError();
}

function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail();
  const record = value as Readonly<Record<string, unknown>>;
  const allowed = new Set([...required, ...optional]);
  const keys = Reflect.ownKeys(record);
  if (
    keys.some((key) => typeof key !== "string" || !allowed.has(key)) ||
    required.some((key) => !Object.hasOwn(record, key))
  ) fail();
  return record;
}

export interface NodeWindowsPdfInspectorOptions {
  readonly broker: WindowsSandboxBrokerPort;
  readonly capabilities: WindowsSandboxCapabilityPort;
  readonly identity: PdfInspectorIdentity;
}

export class NodeWindowsPdfInspector implements PinnedPdfInspectorPort {
  readonly identity: PdfInspectorIdentity;

  constructor(private readonly options: NodeWindowsPdfInspectorOptions) {
    if (
      canonicalStringify(options.broker.policy) !== canonicalStringify(WINDOWS_M3_SANDBOX_POLICY) ||
      !SAFE.test(options.identity.toolId) || !SAFE.test(options.identity.version) ||
      !HASH.test(options.identity.hash) ||
      !options.broker.allowedTools.some((tool) =>
        tool.toolId === options.identity.toolId && tool.version === options.identity.version &&
        tool.hash === options.identity.hash
      ) ||
      typeof options.capabilities.createInput !== "function" ||
      typeof options.capabilities.release !== "function"
    ) throw new WindowsSandboxBrokerError("handshakeRejected");
    this.identity = Object.freeze({ ...options.identity });
  }

  async inspect(bytes: Uint8Array): Promise<PinnedPdfInspection> {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 5 || bytes.byteLength > MAX_BYTES) fail();
    const hash = hashBytes(bytes);
    const capabilityRaw = exact(await this.options.capabilities.createInput({
      version: 1,
      purpose: "pdfInspection",
      bytes: new Uint8Array(bytes),
      expectedHash: hash,
      maximumBytes: bytes.byteLength,
    }), ["version", "kind", "handle", "hash", "byteSize"]);
    if (
      capabilityRaw["version"] !== 1 ||
      capabilityRaw["kind"] !== "windowsSandboxInputCapability" ||
      typeof capabilityRaw["handle"] !== "string" || !CAPABILITY.test(capabilityRaw["handle"]) ||
      capabilityRaw["hash"] !== hash || capabilityRaw["byteSize"] !== bytes.byteLength
    ) fail();
    const capability = capabilityRaw["handle"];
    try {
      const result = exact(await this.options.broker.invoke({
        requestId: randomUUID(),
        profile: "pdfInspectV1",
        action: "inspectPdf",
        payload: Object.freeze({
          version: 1,
          input: capability,
          hash,
          byteSize: bytes.byteLength,
          tool: this.identity,
        }),
      }), ["version", "kind", "hash", "byteSize", "pageCount", "pdfVersion", "standards"], [
        "validationReportHash",
      ]);
      if (
        result["version"] !== 1 || result["kind"] !== "windowsPdfInspection" ||
        result["hash"] !== hash || result["byteSize"] !== bytes.byteLength ||
        !Number.isSafeInteger(result["pageCount"]) || Number(result["pageCount"]) < 1 ||
        Number(result["pageCount"]) > 1_000 || typeof result["pdfVersion"] !== "string" ||
        !/^(?:1\.[0-7]|2\.0)$/u.test(result["pdfVersion"]) ||
        !Array.isArray(result["standards"]) || result["standards"].length > 32 ||
        result["standards"].some((standard) => typeof standard !== "string" || !STANDARD.test(standard)) ||
        (result["validationReportHash"] !== undefined &&
          (typeof result["validationReportHash"] !== "string" || !HASH.test(result["validationReportHash"])))
      ) fail();
      const standards = [...result["standards"] as string[]].sort();
      if (new Set(standards).size !== standards.length ||
        canonicalStringify(standards) !== canonicalStringify(result["standards"])) fail();
      return Object.freeze({
        pageCount: Number(result["pageCount"]),
        pdfVersion: result["pdfVersion"],
        standards: Object.freeze(standards),
        ...(result["validationReportHash"] === undefined
          ? {}
          : { validationReportHash: result["validationReportHash"] as Sha256Hash }),
      });
    } finally {
      await this.options.capabilities.release(capability).catch(() => undefined);
    }
  }
}
