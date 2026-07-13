import { mkdtemp, mkdir, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NodeM4WorkspaceSelection } from "./workspaceSelection.js";

describe("host workspace selection", () => {
  it("durably stores one closed host-only location without exposing it as app settings", async () => {
    const root = await mkdtemp(join(tmpdir(), "cbb-m4-selection-"));
    const selectionPath = join(root, "nested", "workspace-selection.json");
    const chosen = resolve(root, "chosen-library");
    const selection = new NodeM4WorkspaceSelection(selectionPath);

    await expect(selection.read()).resolves.toBeUndefined();
    await selection.write(chosen);
    await expect(selection.read()).resolves.toBe(chosen);
    await expect(readFile(selectionPath, "utf8")).resolves.toBe(
      `{"kind":"workspaceSelection","version":1,"workspaceRoot":${JSON.stringify(chosen)}}`,
    );
  });

  it("rejects relative roots and refuses to follow a redirected selection file", async () => {
    const root = await mkdtemp(join(tmpdir(), "cbb-m4-selection-"));
    const config = join(root, "config");
    await mkdir(config);
    const target = join(root, "outside.json");
    const selectionPath = join(config, "workspace-selection.json");
    await symlink(target, selectionPath);
    const selection = new NodeM4WorkspaceSelection(selectionPath);

    await expect(selection.write("relative/library")).rejects.toThrow(/invalid/u);
    await expect(selection.read()).rejects.toThrow(/unsafe/u);
  });
});
