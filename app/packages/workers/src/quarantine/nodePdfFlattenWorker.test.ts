import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalJsonBytes, hashBytes } from "@cbb/core";
import { runQuarantineRequest, type QuarantineTimerPort, type QuarantineWorkerPort } from "./broker.js";
import { NodeQuarantineHandleStore } from "./nodeHandles.js";
import { NodeLinuxPdfFlattenWorker } from "./nodePdfFlattenWorker.js";
import { RoutedLinuxQuarantineWorker } from "./routedWorker.js";
import {
  QUARANTINE_HARD_LIMITS,
  quarantineHandle,
  type FlattenPdfRequest,
  type SanitizeSvgRequest,
} from "./protocol.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const timer: QuarantineTimerPort = {
  async raceTimeout(work) {
    return { kind: "completed", value: await work };
  },
};

async function fixture(mode: "valid" | "forbiddenAction" | "slowStructure" = "valid") {
  const root = await mkdtemp(join(tmpdir(), "cbb-pdf-flatten-"));
  roots.push(root);
  const closureRoot = join(root, "closure");
  const handlesRoot = join(root, "handles");
  const privateRuntimeRoot = join(root, "runs");
  await Promise.all([
    mkdir(join(closureRoot, "bin"), { recursive: true }),
    mkdir(join(closureRoot, "lib"), { recursive: true }),
    mkdir(handlesRoot),
  ]);
  const values = new Map<string, Uint8Array>([
    ["bin/pdfinfo", new TextEncoder().encode("pdfinfo")],
    ["bin/pdftocairo", new TextEncoder().encode("pdftocairo")],
    ["bin/qpdf", new TextEncoder().encode("qpdf")],
    ["lib/ld-linux", new TextEncoder().encode("loader")],
    ["lib/libpoppler.so", new TextEncoder().encode("poppler")],
  ]);
  for (const [relativePath, bytes] of values) {
    const path = join(closureRoot, ...relativePath.split("/"));
    await writeFile(path, bytes, { mode: relativePath.startsWith("bin/") || relativePath === "lib/ld-linux" ? 0o700 : 0o600 });
    if (relativePath.startsWith("bin/") || relativePath === "lib/ld-linux") await chmod(path, 0o700);
  }
  const manifestBytes = canonicalJsonBytes({
    files: [...values].map(([path, bytes]) => ({ byteSize: bytes.byteLength, hash: hashBytes(bytes), path })),
    kind: "cbbPdfRuntimeClosure",
    libraryDirectories: ["lib"],
    loaderPath: "lib/ld-linux",
    version: 1,
  });
  const manifestPath = join(closureRoot, "cbb-pdf-runtime.json");
  await writeFile(manifestPath, manifestBytes, { mode: 0o600 });

  const brokerPath = join(root, "execution-broker");
  const structural = mode === "forbiddenAction"
    ? { pages: [{ object: 1 }, { object: 2 }], objects: { "1 0 R": { value: { "/OpenAction": {} } } } }
    : { pages: [{ object: 1 }, { object: 2 }], objects: {} };
  await writeFile(brokerPath, [
    `#!${process.execPath}`,
    "const fs = require('node:fs');",
    "const args = process.argv.slice(2);",
    "if (args.length === 1 && args[0] === '--cbb-linux-resource-broker-capabilities-v1') {",
    " fs.writeSync(1, JSON.stringify({kind:'cbbLinuxResourceBrokerCapabilities',version:1,cpuTime:true,addressSpace:true,processCount:true,fileSize:true,openFiles:true,scratchQuota:true,outputQuota:true,mountIsolation:true,networkIsolation:true,processTreeTermination:true,runtimeClosureVerification:true}));",
    "} else {",
    " const marker = args.indexOf('--cbb-sandbox-argv-v1');",
    " if (marker < 0) process.exit(72);",
    " const sandbox = args.slice(marker + 1);",
    " const command = sandbox.slice(sandbox.lastIndexOf('--') + 1);",
    " if (command.includes('-v') || command.includes('--version')) process.exit(0);",
    " const tool = command.find((value) => value.includes('/runtime/bin/'));",
    " if (tool && tool.endsWith('/pdftocairo')) {",
    "   const outputAlias = sandbox.indexOf('/work/output.pdf');",
    "   if (outputAlias < 1) process.exit(73);",
    "   fs.writeFileSync(sandbox[outputAlias - 1], Buffer.from('%PDF-1.7\\nflattened-pages'));",
    " } else if (tool && tool.endsWith('/pdfinfo')) {",
    "   fs.writeSync(1, 'Pages: 2\\nPDF version: 1.7\\nEncrypted: no\\nForm: none\\nJavaScript: no\\n');",
    " } else if (tool && tool.endsWith('/qpdf')) {",
    ...(mode === "slowStructure" ? ["   setTimeout(() => fs.writeSync(1, JSON.stringify(" + JSON.stringify(structural) + ")), 500);"] : [
      `   fs.writeSync(1, ${JSON.stringify(JSON.stringify(structural))});`,
    ]),
    " } else process.exit(74);",
    "}",
    "",
  ].join("\n"), { mode: 0o700 });
  await chmod(brokerPath, 0o700);
  const handles = await NodeQuarantineHandleStore.create(handlesRoot);
  const input = await handles.registerInput(new TextEncoder().encode("%PDF-1.4\nsource-pdf"));
  const output = await handles.prepareOutput("flattenPdf");
  const request: FlattenPdfRequest = {
    version: 1,
    requestId: "11111111-1111-4111-8111-111111111111",
    operation: "flattenPdf",
    input,
    output,
    limits: QUARANTINE_HARD_LIMITS.flattenPdf,
  };
  const identity = (relativePath: string) => ({
    path: join(closureRoot, ...relativePath.split("/")),
    hash: hashBytes(values.get(relativePath)!),
    byteSize: values.get(relativePath)!.byteLength,
    version: "test.1",
  });
  const options = {
    executionBroker: { path: brokerPath, hash: hashBytes(await readFile(brokerPath)) },
    flattener: identity("bin/pdftocairo"),
    inspector: identity("bin/pdfinfo"),
    structuralInspector: identity("bin/qpdf"),
    runtimeManifest: { path: manifestPath, hash: hashBytes(manifestBytes), byteSize: manifestBytes.byteLength },
    privateRuntimeRoot,
    handles,
  };
  return { root, handles, request, options };
}

describe.runIf(process.platform === "linux")("external signed PDF flatten worker", () => {
  it("re-renders, independently inspects, and returns broker-verifiable protocol evidence", async () => {
    const value = await fixture();
    const worker = await NodeLinuxPdfFlattenWorker.create(value.options);
    const result = await runQuarantineRequest(value.request, worker, timer, value.handles);
    expect(result).toMatchObject({
      status: "succeeded",
      result: {
        operation: "flattenPdf",
        mediaType: "application/pdf",
        observed: { inputBytes: 19, pages: 2 },
        flattenedPages: 2,
      },
    });
  });

  it("rejects a derivative whose structural inspection contains an action", async () => {
    const value = await fixture("forbiddenAction");
    const worker = await NodeLinuxPdfFlattenWorker.create(value.options);
    await expect(runQuarantineRequest(value.request, worker, timer, value.handles))
      .resolves.toMatchObject({ status: "failed", reason: "workerCrash" });
  });

  it("kills a late structural inspection and never returns success after cancellation", async () => {
    const value = await fixture("slowStructure");
    const worker = await NodeLinuxPdfFlattenWorker.create(value.options);
    const pending = worker.execute(value.request);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await worker.terminate(value.request.requestId);
    await expect(pending).rejects.toMatchObject({ code: "CBB-SECURITY-0001" });
  });

  it("rejects a symlinked private runtime root", async () => {
    const value = await fixture();
    const target = join(value.root, "real-runs");
    const alias = join(value.root, "aliased-runs");
    await mkdir(target);
    await symlink(target, alias);
    await expect(NodeLinuxPdfFlattenWorker.create({
      ...value.options,
      privateRuntimeRoot: alias,
    })).rejects.toMatchObject({ code: "CBB-SECURITY-0001" });
  });
});

describe("closed quarantine operation router", () => {
  it("routes only flattenPdf to the external renderer", async () => {
    const staticWorker: QuarantineWorkerPort = {
      isolationAvailable: true,
      execute: vi.fn(async () => "static"),
      terminate: vi.fn(async () => undefined),
    };
    const pdfWorker: QuarantineWorkerPort = {
      isolationAvailable: true,
      execute: vi.fn(async () => "pdf"),
      terminate: vi.fn(async () => undefined),
    };
    const router = new RoutedLinuxQuarantineWorker(staticWorker, pdfWorker);
    const input = quarantineHandle(`qh:${"1".repeat(64)}`);
    const output = quarantineHandle(`qh:${"2".repeat(64)}`);
    const pdfRequest: FlattenPdfRequest = {
      version: 1,
      operation: "flattenPdf",
      requestId: "11111111-1111-4111-8111-111111111111",
      input,
      output,
      limits: QUARANTINE_HARD_LIMITS.flattenPdf,
    };
    const svgRequest: SanitizeSvgRequest = {
      version: 1,
      operation: "sanitizeSvg",
      requestId: "22222222-2222-4222-8222-222222222222",
      input,
      output,
      limits: QUARANTINE_HARD_LIMITS.sanitizeSvg,
    };
    await expect(router.execute(pdfRequest)).resolves.toBe("pdf");
    await expect(router.execute(svgRequest)).resolves.toBe("static");
    expect(pdfWorker.execute).toHaveBeenCalledOnce();
    expect(staticWorker.execute).toHaveBeenCalledOnce();
    await expect(router.execute({ operation: "flattenPdf", requestId: "../../bad" } as never))
      .rejects.toThrow(TypeError);
    expect(pdfWorker.execute).toHaveBeenCalledOnce();
  });
});
