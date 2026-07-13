import { link, mkdir, mkdtemp, rename, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hashBytes, parseLocalResourceId, parsePortableAssetRef } from "@cbb/core";
import type { ResourceStagingEntry } from "../resources/index.js";
import { createNodeResourceStagingBytePort } from "./nodeResourceBytes.js";

const LOCAL_ID = parseLocalResourceId("10000000-0000-4000-8000-000000000001");

function entry(bytes: Uint8Array): ResourceStagingEntry {
  return {
    kind: "asset",
    assetRef: parsePortableAssetRef("asset:20000000-0000-4000-8000-000000000001"),
    locator: { kind: "assetCanonical", localId: LOCAL_ID },
    relativePath: "assets/a0000.bin",
    hash: hashBytes(bytes),
    byteSize: bytes.byteLength,
    mediaType: "application/octet-stream",
  };
}

async function fixture(bytes: Uint8Array): Promise<{ root: string; path: string }> {
  const root = await mkdtemp(join(tmpdir(), "cbb-resource-reader-"));
  const parent = join(root, "assets", LOCAL_ID);
  await mkdir(parent, { recursive: true });
  const path = join(parent, "canonical");
  await writeFile(path, bytes, { mode: 0o600 });
  return { root, path };
}

describe("fixed-layout resource staging byte reader", () => {
  it("returns only stable bytes matching the closure identity", async () => {
    const bytes = new TextEncoder().encode("validated resource bytes");
    const { root } = await fixture(bytes);
    const reader = await createNodeResourceStagingBytePort(root);
    await expect(reader.read(entry(bytes))).resolves.toEqual(bytes);
    await expect(reader.read({ ...entry(bytes), byteSize: bytes.byteLength + 1 })).rejects.toThrow(
      /CBB-SECURITY-0001/u,
    );
  });

  it("rejects symlink and hardlink substitution", async () => {
    const bytes = new TextEncoder().encode("validated resource bytes");
    const linked = await fixture(bytes);
    const reader = await createNodeResourceStagingBytePort(linked.root);
    await rename(linked.path, `${linked.path}.owned`);
    await link(`${linked.path}.owned`, linked.path);
    await expect(reader.read(entry(bytes))).rejects.toThrow(/CBB-SECURITY-0001/u);

    const symbolic = await fixture(bytes);
    const symbolicReader = await createNodeResourceStagingBytePort(symbolic.root);
    await rename(symbolic.path, `${symbolic.path}.owned`);
    await symlink(`${symbolic.path}.owned`, symbolic.path);
    await expect(symbolicReader.read(entry(bytes))).rejects.toThrow(/CBB-SECURITY-0001/u);
  });
});
