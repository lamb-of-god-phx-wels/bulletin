import { canonicalJsonBytes, hashBytes } from "@cbb/core";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NodePdfInfoInspector } from "./artifacts/nodePdfInfoInspector.js";
import { NodeOfflineTypstSandbox } from "./build/nodeSandbox.js";
import { createSignedNodeOfflineTypstSandbox } from "./build/signedRuntime.js";
import {
  NodeClosedTrustedComponentExecutor,
  type TrustedComponentExecutionGrant,
  type TrustedComponentIdentity,
  type TrustedComponentLocator,
  type TrustedComponentRegistry,
} from "./components/index.js";

const roots: string[] = [];
const CAPABILITIES = Object.freeze({
  kind: "cbbLinuxResourceBrokerCapabilities",
  version: 1,
  cpuTime: true,
  addressSpace: true,
  processCount: true,
  fileSize: true,
  openFiles: true,
  scratchQuota: true,
  outputQuota: true,
  mountIsolation: true,
  networkIsolation: true,
  processTreeTermination: true,
  runtimeClosureVerification: true,
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function runtimeFixture(
  manifestName: string,
  manifestKind: string,
  toolName: string,
) {
  const root = await mkdtemp(join(tmpdir(), "cbb-runtime-closure-"));
  roots.push(root);
  await Promise.all([mkdir(join(root, "bin")), mkdir(join(root, "lib"))]);
  const values = new Map<string, Uint8Array>([
    [`bin/${toolName}`, new TextEncoder().encode(`packaged ${toolName}`)],
    ["lib/ld-linux", new TextEncoder().encode("packaged loader")],
    ["lib/libruntime.so", new TextEncoder().encode("packaged dependency")],
  ]);
  for (const [relativePath, bytes] of values) {
    const path = join(root, ...relativePath.split("/"));
    await writeFile(path, bytes, {
      mode: relativePath === `bin/${toolName}` || relativePath === "lib/ld-linux" ? 0o700 : 0o600,
    });
    if (relativePath === `bin/${toolName}` || relativePath === "lib/ld-linux") {
      await chmod(path, 0o700);
    }
  }
  const manifestBytes = canonicalJsonBytes({
    files: [...values].map(([path, bytes]) => ({
      byteSize: bytes.byteLength,
      hash: hashBytes(bytes),
      path,
    })),
    kind: manifestKind,
    libraryDirectories: ["lib"],
    loaderPath: "lib/ld-linux",
    version: 1,
  });
  const manifestPath = join(root, manifestName);
  await writeFile(manifestPath, manifestBytes, { mode: 0o600 });
  const toolPath = join(root, "bin", toolName);
  const toolBytes = values.get(`bin/${toolName}`)!;
  return {
    root,
    dependencyPath: join(root, "lib", "libruntime.so"),
    manifest: {
      path: manifestPath,
      hash: hashBytes(manifestBytes),
      byteSize: manifestBytes.byteLength,
    },
    tool: {
      path: toolPath,
      hash: hashBytes(toolBytes),
      byteSize: toolBytes.byteLength,
    },
  };
}

async function broker() {
  const root = await mkdtemp(join(tmpdir(), "cbb-runtime-broker-"));
  roots.push(root);
  const path = join(root, "broker");
  const log = join(root, "calls.jsonl");
  await writeFile(path, [
    `#!${process.execPath}`,
    "const fs = require('node:fs');",
    "const args = process.argv.slice(2);",
    `if (args.length === 1 && args[0] === '--cbb-linux-resource-broker-capabilities-v1') fs.writeSync(1, ${JSON.stringify(JSON.stringify(CAPABILITIES))});`,
    "else {",
    `  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');`,
    "  if (args.includes('/inspect/input.pdf')) fs.writeSync(1, 'Pages: 1\\nPDF version: 1.7\\nEncrypted: no\\nForm: none\\nJavaScript: no\\n');",
    "}",
  ].join("\n"), { mode: 0o700 });
  await chmod(path, 0o700);
  const bytes = await readFile(path);
  return {
    identity: { path, hash: hashBytes(bytes) },
    async calls(): Promise<readonly string[][]> {
      const value = await readFile(log, "utf8").catch(() => "");
      return value.trim().length === 0
        ? []
        : value.trim().split("\n").map((line) => JSON.parse(line) as string[]);
    },
  };
}

function assertPackagedRuntimeCall(
  call: readonly string[],
  manifest: { readonly path: string; readonly hash: string },
  root: string,
  toolName: string,
): void {
  expect(call).toEqual(expect.arrayContaining([
    "--runtime-manifest-path", manifest.path,
    "--runtime-manifest-hash", manifest.hash,
    "--ro-bind", root, "/runtime",
  ]));
  for (let index = 0; index < call.length; index += 1) {
    if (call[index] !== "--ro-bind") continue;
    expect(["/usr", "/lib", "/lib64"]).not.toContain(call[index + 1]);
  }
  expect(call).toContain("/runtime/lib/ld-linux");
  expect(call).toContain(`/runtime/bin/${toolName}`);
}

describe.runIf(process.platform === "linux")("legacy adapters use only signed runtime closures", () => {
  it("constructs the Typst sandbox with a broker-rehashed packaged runtime and no host mounts", async () => {
    const runtime = await runtimeFixture(
      "cbb-typst-runtime.json",
      "cbbTypstRuntimeClosure",
      "typst",
    );
    const executionBroker = await broker();
    const buildParent = await mkdtemp(join(tmpdir(), "cbb-pinned-typst-"));
    roots.push(buildParent);
    await NodeOfflineTypstSandbox.create({
      privateBuildParent: buildParent,
      typst: {
        ...runtime.tool,
        toolId: "typst",
        version: "0.14.2",
      },
      runtimeManifest: runtime.manifest,
      executionBroker: executionBroker.identity,
      resources: { async read() { throw new Error("not used"); } },
      pdfs: { async verify() { throw new Error("not used"); } },
      outputHandles: { async registerVerifiedPdf() { throw new Error("not used"); } },
    });
    const calls = await executionBroker.calls();
    expect(calls).toHaveLength(1);
    assertPackagedRuntimeCall(calls[0]!, runtime.manifest, runtime.root, "typst");
    expect(calls[0]).toContain("--version");
  });

  it("inspects through the packaged PDF closure and rejects later dependency tampering", async () => {
    const runtime = await runtimeFixture(
      "cbb-pdf-runtime.json",
      "cbbPdfRuntimeClosure",
      "pdfinfo",
    );
    const executionBroker = await broker();
    const inspectionParent = await mkdtemp(join(tmpdir(), "cbb-pinned-pdfinfo-"));
    roots.push(inspectionParent);
    const inspector = await NodePdfInfoInspector.create({
      privateInspectionParent: inspectionParent,
      pdfinfo: {
        ...runtime.tool,
        toolId: "pdf-inspector",
        version: "1.0.0",
      },
      runtimeManifest: runtime.manifest,
      executionBroker: executionBroker.identity,
    });
    await expect(inspector.inspect(new TextEncoder().encode("%PDF-1.7\nbody\n%%EOF\n"))).resolves.toEqual({
      pageCount: 1,
      pdfVersion: "1.7",
      standards: [],
    });
    const calls = await executionBroker.calls();
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      assertPackagedRuntimeCall(call, runtime.manifest, runtime.root, "pdfinfo");
    }

    await writeFile(runtime.dependencyPath, "tampered dependency");
    await expect(inspector.inspect(new TextEncoder().encode("%PDF-1.7\nbody\n%%EOF\n")))
      .rejects.toMatchObject({ code: "CBB-SECURITY-0001" });
    expect(await executionBroker.calls()).toHaveLength(2);
  });

  it("rejects surplus runtime files before invoking the broker", async () => {
    const runtime = await runtimeFixture(
      "cbb-typst-runtime.json",
      "cbbTypstRuntimeClosure",
      "typst",
    );
    await writeFile(join(runtime.root, "lib", "surplus.so"), "surplus");
    const executionBroker = await broker();
    const buildParent = await mkdtemp(join(tmpdir(), "cbb-surplus-typst-"));
    roots.push(buildParent);
    await expect(NodeOfflineTypstSandbox.create({
      privateBuildParent: buildParent,
      typst: { ...runtime.tool, toolId: "typst", version: "0.14.2" },
      runtimeManifest: runtime.manifest,
      executionBroker: executionBroker.identity,
      resources: { async read() { throw new Error("not used"); } },
      pdfs: { async verify() { throw new Error("not used"); } },
      outputHandles: { async registerVerifiedPdf() { throw new Error("not used"); } },
    })).rejects.toMatchObject({ code: "CBB-SECURITY-0001" });
    expect(await executionBroker.calls()).toEqual([]);
  });

  it("rejects an absolute symlink alias for the private runtime parent", async () => {
    const runtime = await runtimeFixture(
      "cbb-typst-runtime.json",
      "cbbTypstRuntimeClosure",
      "typst",
    );
    const executionBroker = await broker();
    const parent = await mkdtemp(join(tmpdir(), "cbb-private-parent-"));
    roots.push(parent);
    const actual = join(parent, "actual");
    const alias = join(parent, "alias");
    await mkdir(actual);
    await symlink(actual, alias);
    await expect(NodeOfflineTypstSandbox.create({
      privateBuildParent: alias,
      typst: { ...runtime.tool, toolId: "typst", version: "0.14.2" },
      runtimeManifest: runtime.manifest,
      executionBroker: executionBroker.identity,
      resources: { async read() { throw new Error("not used"); } },
      pdfs: { async verify() { throw new Error("not used"); } },
      outputHandles: { async registerVerifiedPdf() { throw new Error("not used"); } },
    })).rejects.toMatchObject({ kind: "invalidConfiguration" });
    expect(await executionBroker.calls()).toEqual([]);
  });

  it("constructs only while the runtime and tool registry callbacks are both live", async () => {
    const runtime = await runtimeFixture(
      "cbb-typst-runtime.json",
      "cbbTypstRuntimeClosure",
      "typst",
    );
    const executionBroker = await broker();
    const buildParent = await mkdtemp(join(tmpdir(), "cbb-signed-typst-"));
    roots.push(buildParent);
    const executor = new NodeClosedTrustedComponentExecutor();
    const brokerLocator = Object.freeze({ token: "broker" }) as TrustedComponentLocator;
    const toolLocator = Object.freeze({ token: "typst" }) as TrustedComponentLocator;
    const runtimeLocator = Object.freeze({ token: "runtime" }) as TrustedComponentLocator;
    const brokerBytes = await readFile(executionBroker.identity.path);
    const brokerIdentity: TrustedComponentIdentity = {
      role: "executionBroker",
      id: "broker",
      version: "1",
      platform: "linux",
      arch: "x64",
      hash: executionBroker.identity.hash,
      byteSize: brokerBytes.byteLength,
    };
    const toolIdentity: TrustedComponentIdentity = {
      role: "typstCli",
      id: "typst",
      version: "0.14.2",
      platform: "linux",
      arch: "x64",
      hash: runtime.tool.hash,
      byteSize: runtime.tool.byteSize,
    };
    const runtimeIdentity: TrustedComponentIdentity = {
      role: "typstRuntimeClosure",
      id: "typst-runtime",
      version: "1",
      platform: "linux",
      arch: "x64",
      hash: runtime.manifest.hash,
      byteSize: runtime.manifest.byteSize,
    };
    let runtimeCallbackLive = false;
    let toolObservedRuntimeCallback = false;
    const registry = {
      execution: {
        async authorize(request: { operation: string }) {
          const target = request.operation === "typstCompile" ? toolIdentity : runtimeIdentity;
          return Object.freeze({
            token: `grant:${request.operation}`,
            operation: request.operation,
            broker: brokerIdentity,
            target,
          }) as TrustedComponentExecutionGrant;
        },
        async invoke({ grant, payload }: {
          grant: TrustedComponentExecutionGrant;
          payload: Parameters<NodeClosedTrustedComponentExecutor["ownsPayload"]>[0];
        }) {
          const runtimeGrant = grant.operation === "typstRuntimeBind";
          if (runtimeGrant) runtimeCallbackLive = true;
          else toolObservedRuntimeCallback = runtimeCallbackLive;
          try {
            await executor.invoke({
              operation: grant.operation,
              brokerPath: executionBroker.identity.path,
              targetPath: runtimeGrant ? runtime.manifest.path : runtime.tool.path,
              payload,
            });
          } finally {
            if (runtimeGrant) runtimeCallbackLive = false;
          }
        },
      },
    } as unknown as TrustedComponentRegistry;

    await createSignedNodeOfflineTypstSandbox({
      privateBuildParent: buildParent,
      registry,
      executor,
      executionBroker: brokerLocator,
      typst: toolLocator,
      typstRuntime: runtimeLocator,
      resources: { async read() { throw new Error("not used"); } },
      pdfs: { async verify() { throw new Error("not used"); } },
      outputHandles: { async registerVerifiedPdf() { throw new Error("not used"); } },
    });
    expect(toolObservedRuntimeCallback).toBe(true);
    expect(runtimeCallbackLive).toBe(false);
  });
});
