import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { hashBytes } from "@cbb/core";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { NodeQuarantineHandleStore } from "./nodeHandles.js";
import { NodeBubblewrapQuarantineWorker } from "./nodeBubblewrapWorker.js";

const executeFile = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

it.skipIf(process.env["CBB_RUN_NATIVE_M3"] !== "1")(
  "proves the pinned static quarantine worker starts inside real Bubblewrap",
  async () => {
    expect(process.platform).toBe("linux");
    const root = await mkdtemp(join(tmpdir(), "cbb-native-quarantine-"));
    roots.push(root);
    const sourcePath = join(root, "probe.c");
    const workerPath = join(root, "quarantine-worker");
    await writeFile(sourcePath, [
      "#include <string.h>",
      "int main(int argc, char **argv) {",
      "  return argc == 2 && strcmp(argv[1], \"--probe\") == 0 ? 0 : 64;",
      "}",
      "",
    ].join("\n"));
    await executeFile(process.env["CC"] ?? "/usr/bin/cc", [
      "-static", "-O2", "-s", "-o", workerPath, sourcePath,
    ], {
      env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin" },
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });

    const bubblewrapPath = await realpath(process.env["CBB_BWRAP_PATH"] ?? "/usr/bin/bwrap");
    const [bubblewrapBytes, workerBytes] = await Promise.all([
      readFile(bubblewrapPath),
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
      bubblewrap: { path: bubblewrapPath, hash: hashBytes(bubblewrapBytes) },
      worker: {
        path: workerPath,
        hash: hashBytes(workerBytes),
        staticallyLinked: true,
      },
      runtimeRoot,
      handles,
    });
    expect(transport.isolationAvailable).toBe(true);
  },
  60_000,
);
