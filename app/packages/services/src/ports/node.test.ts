import { link, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createNodeFileSystemPort } from "./node.js";

describe("Node durable filesystem no-follow reads", () => {
  it("enforces byte caps and rejects symbolic and hard links", async () => {
    const root = await mkdtemp(join(tmpdir(), "cbb-node-fs-"));
    const original = join(root, "original.json");
    const symbolic = join(root, "symbolic.json");
    const hard = join(root, "hard.json");
    const bytes = new TextEncoder().encode('{"safe":true}');
    await writeFile(original, bytes);
    const fileSystem = createNodeFileSystemPort();
    await expect(fileSystem.readFileNoFollow(original, bytes.byteLength)).resolves.toEqual(bytes);
    await expect(fileSystem.readFileNoFollow(original, bytes.byteLength - 1)).rejects.toThrow(
      /byte cap/,
    );
    await symlink(original, symbolic);
    await expect(fileSystem.readFileNoFollow(symbolic, bytes.byteLength)).rejects.toThrow();
    await link(original, hard);
    await expect(fileSystem.readFileNoFollow(original, bytes.byteLength)).rejects.toThrow(
      /hard-link/,
    );
    await expect(fileSystem.readFileNoFollow(hard, bytes.byteLength)).rejects.toThrow(
      /hard-link/,
    );
  });

  it("claims a move destination without replacing prior evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "cbb-node-move-"));
    const first = join(root, "first");
    const second = join(root, "second");
    const destination = join(root, "claimed");
    await writeFile(first, "first");
    await writeFile(second, "second");
    const fileSystem = createNodeFileSystemPort();
    await expect(fileSystem.moveFileNoReplace(first, destination)).resolves.toBe(true);
    await expect(fileSystem.moveFileNoReplace(second, destination)).resolves.toBe(false);
    expect(await readFile(destination, "utf8")).toBe("first");
    expect(await readFile(second, "utf8")).toBe("second");
  });
});
