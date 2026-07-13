import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import { M4_IPC_CHANNEL } from "./contract.js";

describe("sandboxed preload bundle", () => {
  it("bundles to one CommonJS file with only Electron as an external capability", async () => {
    const result = await build({
      entryPoints: [resolve(process.cwd(), "packages/shell/src/preload.ts")],
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node22",
      external: ["electron"],
      write: false,
    });
    const output = result.outputFiles[0]?.text;
    expect(output).toBeDefined();
    if (output === undefined) return;
    expect(output).not.toMatch(/^import\s/mu);
    expect(output).not.toContain("node:fs");
    expect(output).not.toContain("node:path");

    let exposedName: string | undefined;
    let exposedValue: unknown;
    const invoke = vi.fn();
    const electron = {
      contextBridge: {
        exposeInMainWorld(name: string, value: unknown) {
          exposedName = name;
          exposedValue = value;
        },
      },
      ipcRenderer: { invoke },
    };
    runInNewContext(output, {
      require(specifier: string) {
        if (specifier !== "electron") throw new Error(`unexpected preload capability: ${specifier}`);
        return electron;
      },
      module: { exports: {} },
      exports: {},
      TextEncoder,
      Uint8Array,
    });
    expect(exposedName).toBe("churchBulletinBuilder");
    expect(exposedValue).toMatchObject({ version: 1 });
    expect(Object.isFrozen(exposedValue)).toBe(true);
    const bridge = exposedValue as { listDocuments: () => Promise<unknown> };
    invoke.mockResolvedValue({
      version: 1,
      ok: true,
      operation: "documents.list",
      value: [],
    });
    await expect(bridge.listDocuments()).resolves.toEqual([]);
    expect(invoke).toHaveBeenCalledWith(
      M4_IPC_CHANNEL,
      { version: 1, operation: "documents.list", payload: { filter: "all" } },
    );
  });
});
