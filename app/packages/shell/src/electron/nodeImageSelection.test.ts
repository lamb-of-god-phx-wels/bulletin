import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readStableSelectedImage } from "./nodeImageSelection.js";

const roots: string[] = [];

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "cbb-m4-image-selection-"));
  roots.push(value);
  return value;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true })));
});

describe("main-process image selection", () => {
  it.each([
    ["logo.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "canonicalizeRaster"],
    ["photo.jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xdb]), "canonicalizeRaster"],
    ["mark.svg", new TextEncoder().encode("<svg xmlns=\"http://www.w3.org/2000/svg\"/>") , "sanitizeSvg"],
  ] as const)("reads stable %s bytes without returning a path", async (name, bytes, operation) => {
    const directory = await root();
    const path = join(directory, name);
    await writeFile(path, bytes);
    const selected = await readStableSelectedImage(path);
    expect(selected).toEqual({ bytes, originalFilename: name, operation });
    expect(JSON.stringify(selected)).not.toContain(directory);
  });

  it("rejects symlinks, path-like ambiguity, and raster extension/content mismatch", async () => {
    const directory = await root();
    const target = join(directory, "target.png");
    const link = join(directory, "link.png");
    await writeFile(target, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    await symlink(target, link);
    await expect(readStableSelectedImage(link)).rejects.toThrow(/stable local file/u);
    await expect(readStableSelectedImage("relative.png")).rejects.toThrow(/stable local file/u);

    const disguised = join(directory, "not-really.png");
    await writeFile(disguised, new TextEncoder().encode("<svg/>") );
    await expect(readStableSelectedImage(disguised)).rejects.toThrow(/stable local file/u);
  });
});
