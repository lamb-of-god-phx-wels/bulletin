import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { hashBytes } from "@cbb/core";
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { runQuarantineRequest } from "./broker.js";
import { NodeQuarantineHandleStore } from "./nodeHandles.js";
import { NodeBubblewrapQuarantineWorker } from "./nodeBubblewrapWorker.js";
import { QUARANTINE_HARD_LIMITS } from "./protocol.js";

const executeFile = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

it.skipIf(process.env["CBB_RUN_NATIVE_M3"] !== "1")(
  "sanitizes and rehashes through the pinned Rust worker inside real Bubblewrap",
  async () => {
    expect(process.platform).toBe("linux");
    const root = await mkdtemp(join(tmpdir(), "cbb-native-quarantine-"));
    roots.push(root);
    const nativeRoot = resolve(import.meta.dirname, "../../../../native/quarantine-worker");
    const builtWorkerPath = join(
      nativeRoot,
      "target/x86_64-unknown-linux-gnu/release/cbb-quarantine-worker",
    );
    const workerPath = join(root, "quarantine-worker");
    const brokerPath = join(root, "execution-broker");
    await executeFile("cargo", ["build", "--release", "--offline", "--locked"], {
      cwd: nativeRoot,
      env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin" },
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    });
    // Cargo may hard-link target artifacts; the privileged executable verifier
    // deliberately requires a single-link packaged component.
    await copyFile(builtWorkerPath, workerPath);
    await chmod(workerPath, 0o700);

    const bubblewrapPath = await realpath(process.env["CBB_BWRAP_PATH"] ?? "/usr/bin/bwrap");
    await writeFile(brokerPath, [
      `#!${process.execPath}`,
      "const fs = require('node:fs');",
      "const { spawnSync } = require('node:child_process');",
      "const args = process.argv.slice(2);",
      "if (args.length === 1 && args[0] === '--cbb-linux-resource-broker-capabilities-v1') {",
      "  fs.writeSync(1, JSON.stringify({kind:'cbbLinuxResourceBrokerCapabilities',version:1,cpuTime:true,addressSpace:true,processCount:true,fileSize:true,openFiles:true,scratchQuota:true,outputQuota:true,mountIsolation:true,networkIsolation:true,processTreeTermination:true,runtimeClosureVerification:true}));",
      "} else {",
      "  const marker = args.indexOf('--cbb-sandbox-argv-v1');",
      "  if (marker < 0) process.exit(72);",
      `  const result = spawnSync(${JSON.stringify(bubblewrapPath)}, args.slice(marker + 1), { stdio: 'inherit', env: {} });`,
      "  process.exit(result.status === null ? 73 : result.status);",
      "}",
      "",
    ].join("\n"), { mode: 0o700 });
    const [brokerBytes, workerBytes] = await Promise.all([
      readFile(brokerPath),
      readFile(workerPath),
    ]);
    const handlesRoot = join(root, "handles");
    const runtimeRoot = join(root, "runtime");
    await Promise.all([
      mkdir(handlesRoot, { mode: 0o700 }),
      mkdir(runtimeRoot, { mode: 0o700 }),
    ]);
    const handles = await NodeQuarantineHandleStore.create(handlesRoot);
    const transport = await NodeBubblewrapQuarantineWorker.create({
      executionBroker: { path: brokerPath, hash: hashBytes(brokerBytes) },
      worker: {
        path: workerPath,
        hash: hashBytes(workerBytes),
        staticallyLinked: true,
      },
      runtimeRoot,
      handles,
    });
    expect(transport.isolationAvailable).toBe(true);

    const svg = new TextEncoder().encode(
      "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'><!--removed--><path fill='red' d='M0 0L1 1Z'/></svg>",
    );
    const svgInput = await handles.registerInput(svg);
    const svgOutput = await handles.prepareOutput("sanitizeSvg");
    const svgRequest = {
      version: 1 as const,
      requestId: "44444444-4444-4444-8444-444444444444",
      operation: "sanitizeSvg" as const,
      input: svgInput,
      output: svgOutput,
      limits: QUARANTINE_HARD_LIMITS.sanitizeSvg,
    };
    const timer = {
      async raceTimeout<Result>(work: Promise<Result>) {
        return { kind: "completed" as const, value: await work };
      },
    };
    const svgResult = await runQuarantineRequest(svgRequest, transport, timer, handles);
    if (svgResult.status === "failed") throw new Error(svgResult.reason);
    expect(svgResult.result).toMatchObject({
      operation: "sanitizeSvg",
      status: "succeeded",
      mediaType: "image/svg+xml",
      observed: { inputBytes: svg.byteLength, xmlNodes: 2, pathCommands: 3 },
    });
    const consumed = await handles.consumeVerifiedOutput(svgResult.receipt);
    expect(consumed).toMatchObject({
      kind: "file",
      hash: svgResult.result.outputHash,
      mediaType: "image/svg+xml",
    });
    if (consumed.kind !== "file") throw new Error("expected file output");
    expect(new TextDecoder().decode(consumed.bytes)).toBe(
      "<svg viewBox=\"0 0 10 10\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M0 0L1 1Z\" fill=\"red\"/></svg>",
    );

    const pdfInput = await handles.registerInput(new TextEncoder().encode("%PDF-1.7\n"));
    const pdfOutput = await handles.prepareOutput("flattenPdf");
    const pdfResult = await runQuarantineRequest({
      version: 1,
      requestId: "55555555-5555-4555-8555-555555555555",
      operation: "flattenPdf",
      input: pdfInput,
      output: pdfOutput,
      limits: QUARANTINE_HARD_LIMITS.flattenPdf,
    }, transport, timer, handles);
    expect(pdfResult).toMatchObject({ status: "failed", reason: "isolationUnavailable" });
  },
  150_000,
);
