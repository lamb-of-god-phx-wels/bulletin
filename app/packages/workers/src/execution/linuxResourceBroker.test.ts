import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hashBytes } from "@cbb/core";
import {
  LINUX_RESOURCE_BROKER_EXECUTION_ARGUMENT,
  LINUX_RESOURCE_BROKER_SANDBOX_ARGUMENT,
  LINUX_RESOURCE_LIMITS,
  linuxResourceBrokerArguments,
  runBoundedLinuxProcess,
  verifyLinuxResourceBroker,
} from "./linuxResourceBroker.js";

const roots: string[] = [];
const CAPABILITIES = {
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
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function executable(program: string): Promise<{ readonly path: string; readonly hash: ReturnType<typeof hashBytes> }> {
  const root = await mkdtemp(join(tmpdir(), "cbb-linux-broker-"));
  roots.push(root);
  const path = join(root, "broker");
  await writeFile(path, `#!${process.execPath}\n${program}\n`, { mode: 0o700 });
  await chmod(path, 0o700);
  return { path, hash: hashBytes(await readFile(path)) };
}

describe.runIf(process.platform === "linux")("signed Linux resource broker contract", () => {
  it("accepts only the complete exact v1 capability handshake", async () => {
    const valid = await executable(
      `require('node:fs').writeSync(1, ${JSON.stringify(JSON.stringify(CAPABILITIES))});`,
    );
    await expect(verifyLinuxResourceBroker(valid)).resolves.toBeUndefined();

    const incomplete = await executable(
      `require('node:fs').writeSync(1, ${JSON.stringify(JSON.stringify({ ...CAPABILITIES, outputQuota: false }))});`,
    );
    await expect(verifyLinuxResourceBroker(incomplete)).rejects.toMatchObject({
      code: "CBB-SECURITY-0001",
    });

    const plainBubblewrapLike = await executable("process.exit(0);");
    await expect(verifyLinuxResourceBroker(plainBubblewrapLike)).rejects.toMatchObject({
      code: "CBB-SECURITY-0001",
    });
  });

  it("places every mandatory quota before the closed sandbox argv", () => {
    const scratchPath = "/tmp/cbb-scratch";
    const outputPath = "/tmp/cbb-output";
    const args = linuxResourceBrokerArguments(
      ["--unshare-all", "--", "/tool/worker"],
      LINUX_RESOURCE_LIMITS.quarantine,
      { scratchPath, outputPath },
    );
    const marker = args.indexOf(LINUX_RESOURCE_BROKER_SANDBOX_ARGUMENT);
    expect(args[0]).toBe(LINUX_RESOURCE_BROKER_EXECUTION_ARGUMENT);
    expect(marker).toBeGreaterThan(0);
    expect(args.slice(0, marker)).toEqual(expect.arrayContaining([
      "--cpu-seconds", "120",
      "--address-space-bytes", (1024 * 1024 * 1024).toString(10),
      "--process-count", "16",
      "--file-size-bytes", (1024 * 1024 * 1024).toString(10),
      "--open-file-count", "256",
      "--scratch-path", scratchPath,
      "--scratch-bytes", (256 * 1024 * 1024).toString(10),
      "--output-path", outputPath,
      "--output-bytes", (4 * 1024 * 1024 * 1024).toString(10),
    ]));
    expect(args.slice(marker + 1)).toEqual(["--unshare-all", "--", "/tool/worker"]);
  });

  it("hard-settles a process deadline after killing the complete process group", async () => {
    const hanging = await executable("setInterval(() => undefined, 1000);");
    const result = await runBoundedLinuxProcess({
      executable: hanging.path,
      arguments: [],
      timeoutMs: 10,
      maximumOutputBytes: 1024,
    });
    expect(result).toMatchObject({ timedOut: true, overLimit: false });
  });
});
