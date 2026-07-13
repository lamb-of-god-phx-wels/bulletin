import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJsonBytes, hashBytes } from "@cbb/core";
import type { WorkspaceRegistry } from "@cbb/services";
import { describe, expect, it } from "vitest";
import { NodeM4ImageAssetCatalog } from "./nodeImageAssetCatalog.js";

const LOCAL_ID = "10000000-0000-4000-8000-000000000001";
const ASSET_REF = "asset:20000000-0000-4000-8000-000000000002";
const IMPORTED_AT = "2026-07-13T01:02:03.000Z";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "cbb-m4-image-assets-"));
  const directory = join(root, "assets", LOCAL_ID);
  await mkdir(directory, { recursive: true });
  const canonical = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const record = {
    version: 1,
    kind: "assetRecord",
    localId: LOCAL_ID,
    portableAssetId: ASSET_REF,
    displayName: "Sanctuary",
    mediaType: "image/png",
    canonicalHash: hashBytes(canonical),
    byteSize: canonical.byteLength,
    width: 1200,
    height: 800,
    sanitizationState: "validated",
    aiVisibility: "private",
    importedAt: IMPORTED_AT,
  } as const;
  const recordBytes = canonicalJsonBytes(record);
  await writeFile(join(directory, "asset.json"), recordBytes);
  await writeFile(join(directory, "canonical"), canonical);
  const registry: WorkspaceRegistry = {
    version: 1,
    kind: "workspace",
    workspaceId: "30000000-0000-4000-8000-000000000003" as WorkspaceRegistry["workspaceId"],
    assets: [{
      localId: LOCAL_ID as WorkspaceRegistry["assets"] extends readonly (infer Entry)[] | undefined
        ? Entry extends { readonly localId: infer Id } ? Id : never
        : never,
      kind: "asset",
      displayName: "Sanctuary photo",
      storagePath: `assets/${LOCAL_ID}/asset.json`,
      contentHash: hashBytes(recordBytes),
      createdAt: IMPORTED_AT,
      modifiedAt: IMPORTED_AT,
    }],
  };
  return { root, registry, canonical, directory };
}

describe("NodeM4ImageAssetCatalog", () => {
  it("lists bounded metadata and returns only hash-bound canonical bytes", async () => {
    const value = await fixture();
    const catalog = new NodeM4ImageAssetCatalog({ workspaceRoot: value.root });
    await expect(catalog.list(value.registry)).resolves.toEqual([{
      localAssetId: LOCAL_ID,
      assetRef: ASSET_REF,
      displayName: "Sanctuary photo",
      mediaType: "image/png",
      byteSize: value.canonical.byteLength,
      pixelWidth: 1200,
      pixelHeight: 800,
      importedAt: IMPORTED_AT,
    }]);
    await expect(catalog.read(value.registry, LOCAL_ID, ASSET_REF)).resolves.toEqual(value.canonical);
  });

  it("fails closed for tampered bytes and path redirection", async () => {
    const tampered = await fixture();
    const catalog = new NodeM4ImageAssetCatalog({ workspaceRoot: tampered.root });
    await writeFile(join(tampered.directory, "canonical"), new Uint8Array([1, 2, 3]));
    await expect(catalog.read(tampered.registry, LOCAL_ID, ASSET_REF)).rejects.toThrow(/integrity/u);

    const redirected = await fixture();
    await writeFile(join(redirected.root, "outside"), redirected.canonical);
    const canonicalPath = join(redirected.directory, "canonical");
    await writeFile(canonicalPath, new Uint8Array([]));
    // A distinct fixture path is enough to exercise the managed no-symlink
    // check without accepting any renderer-provided path.
    const fs = await import("node:fs/promises");
    await fs.rm(canonicalPath);
    await symlink(join(redirected.root, "outside"), canonicalPath);
    await expect(new NodeM4ImageAssetCatalog({ workspaceRoot: redirected.root })
      .read(redirected.registry, LOCAL_ID, ASSET_REF)).rejects.toThrow();
  });

  it("rejects unknown portable identities", async () => {
    const value = await fixture();
    await expect(new NodeM4ImageAssetCatalog({ workspaceRoot: value.root })
      .read(value.registry, LOCAL_ID, "asset:not-valid")).rejects.toThrow(/identity/u);
  });
});
