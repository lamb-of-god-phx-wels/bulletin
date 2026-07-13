import { hashBytes, type Sha256Hash } from "@cbb/core";
import {
  WINDOWS_M3_SANDBOX_POLICY,
  type WindowsSandboxAllowedTool,
  type WindowsSandboxBrokerPort,
  type WindowsSandboxInvocation,
} from "@cbb/workers";
import { describe, expect, it } from "vitest";
import type { BuildOutputHandle } from "../build/runner.js";
import type { ResourceStagingEntry } from "../resources/index.js";
import {
  NodeWindowsOfflineTypstSandbox,
  createWindowsBrokerCompileOutputReader,
  type WindowsSandboxCapabilityPort,
  type WindowsSandboxInputCapabilityRequest,
  type WindowsSandboxOutputCapabilityRequest,
} from "./buildSandbox.js";
import { NodeWindowsPdfInspector } from "./pdfInspector.js";

const ROOT = "wroot:11111111-1111-4111-8111-111111111111";
const OUTPUT = "artifact-output:22222222-2222-4222-8222-222222222222" as BuildOutputHandle;
const PDF = new TextEncoder().encode("%PDF-1.7\n%%EOF\n");
const PDF_HASH = hashBytes(PDF);
const TYPST_HASH = hashBytes(new TextEncoder().encode("typst.exe"));
const INSPECTOR_HASH = hashBytes(new TextEncoder().encode("pdf-inspector.exe"));

const TOOLS: readonly WindowsSandboxAllowedTool[] = Object.freeze([
  Object.freeze({ toolId: "pdf-inspector", version: "4.2.0", hash: INSPECTOR_HASH }),
  Object.freeze({ toolId: "typst", version: "0.14.2", hash: TYPST_HASH }),
]);

class FakeCapabilities implements WindowsSandboxCapabilityPort {
  readonly created: WindowsSandboxInputCapabilityRequest[] = [];
  readonly reads: WindowsSandboxOutputCapabilityRequest[] = [];
  readonly released: string[] = [];

  async createInput(request: WindowsSandboxInputCapabilityRequest): Promise<unknown> {
    this.created.push(request);
    return {
      version: 1,
      kind: "windowsSandboxInputCapability",
      handle: `wcap:${request.expectedHash.slice("sha256:".length)}`,
      hash: request.expectedHash,
      byteSize: request.bytes.byteLength,
    };
  }

  async readOutput(request: WindowsSandboxOutputCapabilityRequest): Promise<Uint8Array> {
    this.reads.push(request);
    return new Uint8Array(PDF);
  }

  async release(handle: string): Promise<void> {
    this.released.push(handle);
  }
}

class FakeBroker implements WindowsSandboxBrokerPort {
  readonly sessionId = `wsb:${"3".repeat(64)}`;
  readonly policy = WINDOWS_M3_SANDBOX_POLICY;
  readonly allowedTools = TOOLS;
  readonly invocations: WindowsSandboxInvocation[] = [];
  readonly canceled: string[] = [];
  override?: (request: WindowsSandboxInvocation) => unknown | Promise<unknown>;

  async invoke(request: WindowsSandboxInvocation): Promise<unknown> {
    this.invocations.push(request);
    if (this.override !== undefined) return this.override(request);
    const payload = request.payload;
    switch (request.action) {
      case "createBuildRoot":
        return { version: 1, kind: "windowsBuildRoot", buildId: payload["buildId"], root: ROOT };
      case "stageBuildSource":
      case "stageBuildResource":
        return {
          version: 1,
          kind: "windowsStagedBuildBytes",
          root: payload["root"],
          hash: payload["hash"],
          byteSize: payload["byteSize"],
        };
      case "compileTypst":
        return { version: 1, kind: "windowsTypstCompileResult", status: "succeeded", diagnosticCodes: [] };
      case "verifyBuildPdf":
        return {
          version: 1,
          kind: "windowsVerifiedBuildPdf",
          root: payload["root"],
          output: OUTPUT,
          hash: PDF_HASH,
          byteSize: PDF.byteLength,
          pageCount: 1,
          pdfVersion: "1.7",
          magicVerified: true,
        };
      case "terminateBuild":
        return { version: 1, kind: "windowsBuildTerminated", root: payload["root"] };
      case "cleanupBuild":
        return { version: 1, kind: "windowsBuildCleaned", root: payload["root"] };
      case "inspectPdf":
        return {
          version: 1,
          kind: "windowsPdfInspection",
          hash: payload["hash"],
          byteSize: payload["byteSize"],
          pageCount: 1,
          pdfVersion: "1.7",
          standards: ["PDF/A-2b", "PDF/UA-1"],
          validationReportHash: hashBytes(new TextEncoder().encode("report")),
        };
      default:
        throw new Error("unexpected fake broker action");
    }
  }

  async cancel(requestId: string): Promise<void> {
    this.canceled.push(requestId);
  }

  async close(): Promise<void> {}
}

function buildSandbox(broker = new FakeBroker(), capabilities = new FakeCapabilities()) {
  return {
    broker,
    capabilities,
    sandbox: new NodeWindowsOfflineTypstSandbox({
      broker,
      capabilities,
      resources: { async read(entry) { return new Uint8Array((entry as unknown as { bytes: Uint8Array }).bytes); } },
      typst: { toolId: "typst", version: "0.14.2", executableHash: TYPST_HASH },
    }),
  };
}

function asset(bytes: Uint8Array): ResourceStagingEntry {
  return {
    kind: "asset",
    assetRef: "asset:11111111-1111-4111-8111-111111111111@1",
    locator: { kind: "assetCanonical" },
    relativePath: "assets/a0001.png",
    hash: hashBytes(bytes),
    byteSize: bytes.byteLength,
    mediaType: "image/png",
    bytes,
  } as unknown as ResourceStagingEntry;
}

describe("Windows broker-backed build sandbox", () => {
  it("uses only opaque capabilities, roots, outputs, and app-generated aliases", async () => {
    const fixture = buildSandbox();
    const source = new TextEncoder().encode("= Bulletin");
    const resource = new Uint8Array([1, 2, 3, 4]);
    const buildId = "44444444-4444-4444-8444-444444444444";

    await expect(fixture.sandbox.verifyTrustedTool({
      toolId: "typst",
      version: "0.14.2",
      executableHash: TYPST_HASH,
    })).resolves.toBe(true);
    const root = await fixture.sandbox.createBuildRoot(buildId);
    await expect(fixture.sandbox.stageSource(root, source, hashBytes(source))).resolves.toEqual({
      observedHash: hashBytes(source),
      observedByteSize: source.byteLength,
    });
    await fixture.sandbox.stageResource(root, asset(resource));
    await expect(fixture.sandbox.compile(root)).resolves.toEqual({ kind: "succeeded" });
    await expect(fixture.sandbox.verifyPdf(root)).resolves.toMatchObject({
      handle: OUTPUT,
      hash: PDF_HASH,
      magicVerified: true,
    });
    await fixture.sandbox.terminate(root);
    await fixture.sandbox.cleanup(root);

    expect(fixture.capabilities.created).toHaveLength(2);
    expect(fixture.capabilities.released).toHaveLength(2);
    const wire = JSON.stringify(fixture.broker.invocations);
    expect(wire).not.toContain("C:\\");
    expect(wire).not.toContain("/tmp/");
    expect(wire).not.toContain("locator");
    expect(wire).toContain("wcap:");
    expect(wire).toContain("wroot:");
  });

  it("rejects response smuggling and releases the input capability", async () => {
    const fixture = buildSandbox();
    const source = new TextEncoder().encode("= Bulletin");
    const root = await fixture.sandbox.createBuildRoot("55555555-5555-4555-8555-555555555555");
    fixture.broker.override = (request) => request.action === "stageBuildSource"
      ? {
          version: 1,
          kind: "windowsStagedBuildBytes",
          root,
          hash: hashBytes(source),
          byteSize: source.byteLength,
          path: "C:\\smuggled\\main.typ",
        }
      : undefined;
    await expect(fixture.sandbox.stageSource(root, source, hashBytes(source))).rejects.toThrow();
    expect(fixture.capabilities.released).toHaveLength(1);
  });

  it("rejects an unsupported resource kind before reading or minting a capability", async () => {
    const fixture = buildSandbox();
    const root = await fixture.sandbox.createBuildRoot("77777777-7777-4777-8777-777777777777");
    await expect(fixture.sandbox.stageResource(root, {
      ...asset(new Uint8Array([1])),
      kind: "hostPath",
      relativePath: "fonts/f0001-0000.ttf",
    } as unknown as ResourceStagingEntry)).rejects.toThrow();
    expect(fixture.capabilities.created).toHaveLength(0);
  });

  it("cancels an in-flight compile through the broker when aborted", async () => {
    const fixture = buildSandbox();
    const root = await fixture.sandbox.createBuildRoot("66666666-6666-4666-8666-666666666666");
    let finish: ((value: unknown) => void) | undefined;
    fixture.broker.override = (request) => request.action === "compileTypst"
      ? new Promise((resolve) => { finish = resolve; })
      : undefined;
    const controller = new AbortController();
    const pending = fixture.sandbox.compile(root, controller.signal);
    controller.abort();
    await Promise.resolve();
    expect(fixture.broker.canceled).toHaveLength(1);
    finish?.({
      version: 1,
      kind: "windowsTypstCompileResult",
      status: "canceled",
      diagnosticCodes: [],
    });
    await expect(pending).resolves.toEqual({ kind: "canceled" });
  });

  it("does not start broker work for an already-aborted compile", async () => {
    const fixture = buildSandbox();
    const root = await fixture.sandbox.createBuildRoot("88888888-8888-4888-8888-888888888888");
    const controller = new AbortController();
    controller.abort();
    await expect(fixture.sandbox.compile(root, controller.signal)).resolves.toEqual({
      kind: "canceled",
    });
    expect(fixture.broker.invocations.map((request) => request.action)).toEqual([
      "createBuildRoot",
    ]);
    expect(fixture.broker.canceled).toHaveLength(0);
  });

  it("reads and releases only a valid opaque build output handle", async () => {
    const capabilities = new FakeCapabilities();
    const reader = createWindowsBrokerCompileOutputReader(capabilities);
    await expect(reader.readVerifiedPdf(OUTPUT)).resolves.toEqual(PDF);
    expect(capabilities.reads).toEqual([{ version: 1, handle: OUTPUT, maximumBytes: 1_073_741_824 }]);
    expect(capabilities.released).toEqual([OUTPUT]);
    await expect(reader.readVerifiedPdf("C:\\build\\output.pdf" as BuildOutputHandle)).rejects.toThrow();
  });
});

describe("Windows broker-backed PDF inspector", () => {
  function inspector(broker = new FakeBroker(), capabilities = new FakeCapabilities()) {
    return {
      broker,
      capabilities,
      adapter: new NodeWindowsPdfInspector({
        broker,
        capabilities,
        identity: { toolId: "pdf-inspector", version: "4.2.0", hash: INSPECTOR_HASH },
      }),
    };
  }

  it("inspects an opaque input capability and releases it", async () => {
    const fixture = inspector();
    await expect(fixture.adapter.inspect(PDF)).resolves.toMatchObject({
      pageCount: 1,
      pdfVersion: "1.7",
      standards: ["PDF/A-2b", "PDF/UA-1"],
    });
    expect(fixture.capabilities.released).toEqual([
      `wcap:${PDF_HASH.slice("sha256:".length)}`,
    ]);
    expect(fixture.broker.invocations[0]?.payload).toMatchObject({
      input: `wcap:${PDF_HASH.slice("sha256:".length)}`,
      hash: PDF_HASH,
      byteSize: PDF.byteLength,
    });
    expect(JSON.stringify(fixture.broker.invocations[0])).not.toContain("path");
  });

  it("rejects unsorted or path-smuggling broker evidence and still releases the capability", async () => {
    const fixture = inspector();
    fixture.broker.override = (request) => ({
      version: 1,
      kind: "windowsPdfInspection",
      hash: request.payload["hash"] as Sha256Hash,
      byteSize: request.payload["byteSize"],
      pageCount: 1,
      pdfVersion: "1.7",
      standards: ["PDF/UA-1", "PDF/A-2b"],
      path: "C:\\smuggled\\document.pdf",
    });
    await expect(fixture.adapter.inspect(PDF)).rejects.toThrow();
    expect(fixture.capabilities.released).toHaveLength(1);
  });

  it("refuses construction when the mandatory no-network policy is weakened", () => {
    const broker = new FakeBroker();
    const weakened = Object.assign(broker, {
      policy: {
        ...WINDOWS_M3_SANDBOX_POLICY,
        network: { ...WINDOWS_M3_SANDBOX_POLICY.network, outboundDenied: false },
      },
    }) as unknown as WindowsSandboxBrokerPort;
    expect(() => new NodeWindowsPdfInspector({
      broker: weakened,
      capabilities: new FakeCapabilities(),
      identity: { toolId: "pdf-inspector", version: "4.2.0", hash: INSPECTOR_HASH },
    })).toThrow();
  });
});
