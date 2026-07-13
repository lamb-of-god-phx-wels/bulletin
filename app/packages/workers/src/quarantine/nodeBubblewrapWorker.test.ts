import { hashBytes, type Sha256Hash } from "@cbb/core";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NodeBubblewrapQuarantineWorker } from "./nodeBubblewrapWorker.js";
import { NodeQuarantineHandleStore } from "./nodeHandles.js";
import { QUARANTINE_HARD_LIMITS, type SanitizeSvgRequest } from "./protocol.js";

const roots: string[] = [];
const encoder = new TextEncoder();

async function root(label: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), `cbb-bwrap-${label}-`));
  roots.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function staticElfFixture(options: {
  readonly machine?: number;
  readonly executableLoad?: boolean;
} = {}): Uint8Array {
  const bytes = new Uint8Array(120);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
  const view = new DataView(bytes.buffer);
  view.setUint16(16, 2, true);
  view.setUint16(18, options.machine ?? (process.arch === "arm64" ? 183 : 62), true);
  view.setUint32(20, 1, true);
  view.setBigUint64(32, 64n, true);
  view.setUint16(52, 64, true);
  view.setUint16(54, 56, true);
  view.setUint16(56, 1, true);
  view.setUint32(64, 1, true);
  view.setUint32(68, options.executableLoad === false ? 4 : 5, true);
  view.setBigUint64(96, BigInt(bytes.byteLength), true);
  view.setBigUint64(104, BigInt(bytes.byteLength), true);
  view.setBigUint64(112, 4096n, true);
  return bytes;
}

async function executable(path: string, contents: Uint8Array | string): Promise<Sha256Hash> {
  await writeFile(path, contents, { mode: 0o700 });
  await chmod(path, 0o700);
  return hashBytes(await readFile(path));
}

async function harness(
  launcherProgram = "require('node:fs').writeSync(1, JSON.stringify({argv:process.argv.slice(2),env:process.env}));",
  maximumMessageBytes?: number,
): Promise<{
  readonly worker: NodeBubblewrapQuarantineWorker;
  readonly request: SanitizeSvgRequest;
  readonly launcherPath: string;
}> {
  const fixtureRoot = await root("transport");
  const handleRoot = await root("handles");
  const runtimeRoot = await root("runtime");
  const launcherPath = join(fixtureRoot, "pinned-bwrap");
  const workerPath = join(fixtureRoot, "pinned-static-worker");
  const launcherHash = await executable(launcherPath, [
    `#!${process.execPath}`,
    launcherProgram,
    "",
  ].join("\n"));
  const workerHash = await executable(workerPath, staticElfFixture());
  const handles = await NodeQuarantineHandleStore.create(handleRoot);
  const input = await handles.registerInput(encoder.encode("<svg/>"));
  const output = await handles.prepareOutput("sanitizeSvg");
  const request: SanitizeSvgRequest = {
    version: 1,
    requestId: "11111111-1111-4111-8111-111111111111",
    operation: "sanitizeSvg",
    input,
    output,
    limits: QUARANTINE_HARD_LIMITS.sanitizeSvg,
  };
  return {
    worker: await NodeBubblewrapQuarantineWorker.create({
      bubblewrap: { path: launcherPath, hash: launcherHash },
      worker: { path: workerPath, hash: workerHash, staticallyLinked: true },
      runtimeRoot,
      handles,
      ...(maximumMessageBytes === undefined ? {} : { maximumMessageBytes }),
    }),
    request,
    launcherPath,
  };
}

describe("Linux bubblewrap quarantine transport", () => {
  it("constructs the closed no-network mount contract and clears the host environment", async () => {
    const { worker, request } = await harness();
    expect(worker.isolationAvailable).toBe(process.platform === "linux");
    if (!worker.isolationAvailable) return;
    const result = await worker.execute(request) as {
      readonly argv: readonly string[];
      readonly env: Readonly<Record<string, string>>;
    };
    expect(result.argv).toEqual(expect.arrayContaining([
      "--unshare-all",
      "--die-with-parent",
      "--new-session",
      "--clearenv",
      "--tmpfs",
      "/",
      "--ro-bind",
      "/app/quarantine-worker",
      "--chdir",
      "/work",
    ]));
    expect(result.argv.filter((value) => value === "--ro-bind")).toHaveLength(2);
    expect(result.argv.filter((value) => value === "--bind")).toHaveLength(1);
    expect(result.argv).not.toContain("--setenv");
    expect(result.argv).not.toContain("--proc");
    expect(result.argv).not.toContain("--dev");
    expect(result.env).toEqual({});
    await expect(worker.terminate(request.requestId)).resolves.toBeUndefined();
  });

  it("rechecks pinned executables immediately before every launch", async () => {
    const { worker, request, launcherPath } = await harness();
    if (!worker.isolationAvailable) return;
    await writeFile(launcherPath, `#!${process.execPath}\nprocess.exit(0);\n`, { mode: 0o700 });
    await expect(worker.execute(request)).rejects.toMatchObject({
      code: "CBB-SECURITY-0001",
    });
  });

  it("kills and rejects a launcher that exceeds the bounded IPC channel", async () => {
    const { worker, request } = await harness(
      "require('node:fs').writeSync(1, 'x'.repeat(4096));",
      1024,
    );
    if (!worker.isolationAvailable) return;
    await expect(worker.execute(request)).rejects.toMatchObject({
      code: "CBB-SECURITY-0001",
    });
    await expect(worker.terminate(request.requestId)).resolves.toBeUndefined();
  });

  it("proves namespace launch during creation and stays unavailable if the probe fails", async () => {
    const { worker } = await harness(
      "process.exit(process.argv.includes('--probe') ? 17 : 0);",
    );
    expect(worker.isolationAvailable).toBe(false);
  });

  it("reserves a request identity before asynchronous verification", async () => {
    const { worker, request } = await harness();
    if (!worker.isolationAvailable) return;
    const first = worker.execute(request);
    await expect(worker.execute(request)).rejects.toMatchObject({
      code: "CBB-SECURITY-0001",
    });
    await expect(first).resolves.toBeDefined();
  });

  it("validates the request before using its identity in an app-owned path", async () => {
    const { worker, request } = await harness();
    if (!worker.isolationAvailable) return;
    await expect(worker.execute({
      ...request,
      requestId: "../../outside",
    } as SanitizeSvgRequest)).rejects.toMatchObject({
      code: "CBB-SECURITY-0001",
    });
  });

  it("rejects non-UTF-8 worker results instead of replacement-decoding them", async () => {
    const { worker, request } = await harness(
      "require('node:fs').writeSync(1, Buffer.from([0x7b,0x22,0x78,0x22,0x3a,0x22,0xff,0x22,0x7d]));",
    );
    if (!worker.isolationAvailable) return;
    await expect(worker.execute(request)).rejects.toMatchObject({
      code: "CBB-SECURITY-0001",
    });
    await expect(worker.terminate(request.requestId)).resolves.toBeUndefined();
  });

  it("rejects dynamically linked workers instead of widening the mounted closure", async () => {
    const fixtureRoot = await root("dynamic");
    const handleRoot = await root("dynamic-handles");
    const runtimeRoot = await root("dynamic-runtime");
    const launcherPath = join(fixtureRoot, "launcher");
    const workerPath = join(fixtureRoot, "worker");
    const launcherHash = await executable(launcherPath, "#!/bin/sh\nexit 0\n");
    const workerHash = await executable(workerPath, "#!/bin/sh\nexit 0\n");
    const handles = await NodeQuarantineHandleStore.create(handleRoot);
    const worker = await NodeBubblewrapQuarantineWorker.create({
      bubblewrap: { path: launcherPath, hash: launcherHash },
      worker: { path: workerPath, hash: workerHash, staticallyLinked: true },
      runtimeRoot,
      handles,
    });
    expect(worker.isolationAvailable).toBe(false);
  });

  it("rejects wrong-architecture and non-executable ELF lookalikes", async () => {
    for (const contents of [
      staticElfFixture({ machine: process.arch === "arm64" ? 62 : 183 }),
      staticElfFixture({ executableLoad: false }),
    ]) {
      const fixtureRoot = await root("elf-lookalike");
      const handleRoot = await root("elf-lookalike-handles");
      const runtimeRoot = await root("elf-lookalike-runtime");
      const launcherPath = join(fixtureRoot, "launcher");
      const workerPath = join(fixtureRoot, "worker");
      const launcherHash = await executable(launcherPath, `#!${process.execPath}\nprocess.exit(0);\n`);
      const workerHash = await executable(workerPath, contents);
      const handles = await NodeQuarantineHandleStore.create(handleRoot);
      const worker = await NodeBubblewrapQuarantineWorker.create({
        bubblewrap: { path: launcherPath, hash: launcherHash },
        worker: { path: workerPath, hash: workerHash, staticallyLinked: true },
        runtimeRoot,
        handles,
      });
      expect(worker.isolationAvailable).toBe(false);
    }
  });
});
