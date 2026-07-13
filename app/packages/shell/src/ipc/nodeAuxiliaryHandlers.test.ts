import { mkdtemp, mkdir, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createNodeFileSystemPort, type DurableFileSystemPort } from "@cbb/services";
import type { M4JsonValue } from "./contract.js";
import { M4_IPC_LIMITS } from "./contract.js";
import { NodeM4AuxiliaryHandlers } from "./nodeAuxiliaryHandlers.js";

const ID = "10000000-0000-4000-8000-000000000001";

function validateSettings(value: unknown): M4JsonValue {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (value as { version?: unknown }).version !== 1 ||
    (value as { kind?: unknown }).kind !== "globalSettings"
  ) throw new Error("invalid app settings");
  return value as M4JsonValue;
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "cbb-m4-aux-"));
  const workspace = join(root, "workspace");
  await mkdir(join(workspace, "transactions"), { recursive: true });
  const settingsPath = join(root, "config", "settings.json");
  return {
    root,
    workspace,
    settingsPath,
    storage: new NodeM4AuxiliaryHandlers({
      workspaceRoot: workspace,
      appSettingsPath: settingsPath,
      defaultAppSettings: { version: 1, kind: "globalSettings", theme: "system" },
      validateAppSettings: validateSettings,
      now: () => new Date("2026-07-12T12:00:00.000Z"),
    }),
  };
}

describe("Node M4 auxiliary storage", () => {
  it("persists bounded application settings atomically behind an internal path", async () => {
    const { storage } = await fixture();
    await expect(storage.readAppSettings()).resolves.toEqual({
      version: 1,
      kind: "globalSettings",
      theme: "system",
    });
    await expect(storage.writeAppSettings({
      version: 1,
      kind: "globalSettings",
      theme: "dark",
    })).resolves.toMatchObject({ theme: "dark" });
    await expect(storage.readAppSettings()).resolves.toMatchObject({ theme: "dark" });
    await expect(storage.writeAppSettings({ theme: "dark" })).rejects.toThrow("invalid app settings");
  });

  it("round-trips exact edit buffers using hashed internal names", async () => {
    const { storage, workspace } = await fixture();
    await expect(storage.readEditBuffer(ID, "inspector.margin.top")).resolves.toBeNull();
    await expect(storage.writeEditBuffer(ID, "inspector.margin.top", "1..2in")).resolves.toEqual({
      value: "1..2in",
      updatedAt: "2026-07-12T12:00:00.000Z",
    });
    await expect(storage.readEditBuffer(ID, "inspector.margin.top")).resolves.toMatchObject({ value: "1..2in" });
    const names = await readdir(join(workspace, "transactions", "edit-buffer", ID));
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^[0-9a-f]{64}\.json$/u);
    expect(names[0]).not.toContain("margin");
    await expect(storage.deleteEditBuffer(ID, "inspector.margin.top")).resolves.toBe(true);
    await expect(storage.deleteEditBuffer(ID, "inspector.margin.top")).resolves.toBe(false);
  });

  it("durably links first-use buffer directories in order and retries a failed parent sync", async () => {
    const { workspace, settingsPath } = await fixture();
    const transactionRoot = join(workspace, "transactions");
    const editRoot = join(transactionRoot, "edit-buffer");
    const resourceRoot = join(editRoot, ID);
    const base = createNodeFileSystemPort();
    const events: Array<{
      readonly operation: "info" | "mkdir" | "sync";
      readonly path: string;
      readonly kind?: string;
    }> = [];
    let failFirstEditRootLinkSync = true;
    const fileSystem: DurableFileSystemPort = {
      ...base,
      async entryInfo(path) {
        const result = await base.entryInfo(path);
        events.push({ operation: "info", path, kind: result?.kind ?? "missing" });
        return result;
      },
      async makeDirectory(path) {
        events.push({ operation: "mkdir", path });
        await base.makeDirectory(path);
      },
      async syncDirectory(path) {
        events.push({ operation: "sync", path });
        if (path === transactionRoot && failFirstEditRootLinkSync) {
          failFirstEditRootLinkSync = false;
          throw new Error("injected parent-directory sync failure");
        }
        await base.syncDirectory(path);
      },
    };
    const storage = new NodeM4AuxiliaryHandlers({
      workspaceRoot: workspace,
      appSettingsPath: settingsPath,
      defaultAppSettings: { version: 1, kind: "globalSettings", theme: "system" },
      validateAppSettings: validateSettings,
      now: () => new Date("2026-07-12T12:00:00.000Z"),
      fileSystem,
    });

    await expect(storage.writeEditBuffer(ID, "cbb.inspector.aaaaaaaaaaaaaaaa", "value"))
      .rejects.toThrow("injected parent-directory sync failure");
    await expect(base.entryInfo(editRoot)).resolves.toMatchObject({ kind: "directory" });
    await expect(base.entryInfo(resourceRoot)).resolves.toBeUndefined();

    await storage.writeEditBuffer(ID, "cbb.inspector.aaaaaaaaaaaaaaaa", "value");
    await storage.writeEditBuffer(ID, "cbb.inspector.manifest.v1", "manifest");

    expect(events.filter((event) => event.operation === "sync").map((event) => event.path)).toEqual([
      transactionRoot,
      transactionRoot,
      editRoot,
      resourceRoot,
      resourceRoot,
    ]);
    for (const [directory, parent] of [
      [editRoot, transactionRoot],
      [resourceRoot, editRoot],
    ] as const) {
      const made = events.findIndex((event) => event.operation === "mkdir" && event.path === directory);
      const verified = events.findIndex((event, index) => index > made && event.operation === "info" &&
        event.path === directory && event.kind === "directory");
      const linked = events.findIndex((event, index) => index > verified && event.operation === "sync" &&
        event.path === parent);
      expect(made).toBeGreaterThanOrEqual(0);
      expect(verified).toBeGreaterThan(made);
      expect(linked).toBeGreaterThan(verified);
    }
  });

  it("rejects oversized buffers and mismatched durable envelopes", async () => {
    const { storage, workspace } = await fixture();
    await expect(storage.writeEditBuffer(
      ID,
      "field",
      "x".repeat(M4_IPC_LIMITS.editBufferBytes + 1),
    )).rejects.toThrow(/too large/i);

    await storage.writeEditBuffer(ID, "field", "draft");
    const directory = join(workspace, "transactions", "edit-buffer", ID);
    const [name] = await readdir(directory);
    if (name === undefined) throw new Error("missing fixture");
    await writeFile(join(directory, name), JSON.stringify({
      version: 1,
      kind: "editBuffer",
      localResourceId: ID,
      bufferKey: "another-field",
      value: "tampered",
      updatedAt: "2026-07-12T12:00:00.000Z",
    }));
    await expect(storage.readEditBuffer(ID, "field")).rejects.toThrow(/could not be recovered safely/i);
  });

  it("does not follow a settings-file symlink", async () => {
    const { storage, root, settingsPath } = await fixture();
    await mkdir(join(root, "config"), { recursive: true });
    const target = join(root, "outside.json");
    await writeFile(target, JSON.stringify({ version: 1, kind: "globalSettings", theme: "dark" }));
    await symlink(target, settingsPath);
    await expect(storage.readAppSettings()).rejects.toThrow();
  });

  it("rejects path-shaped identities even when called without the IPC dispatcher", async () => {
    const { storage } = await fixture();
    await expect(storage.writeEditBuffer("../../outside", "field", "value"))
      .rejects.toThrow(/invalid identity/i);
    await expect(storage.writeEditBuffer(ID, "../../outside", "value"))
      .rejects.toThrow(/invalid identity/i);
  });
});
