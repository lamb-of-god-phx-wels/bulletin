import { describe, expect, it, vi } from "vitest";
import { ImageAssetObjectUrlStore } from "./imageAssetObjectUrls.js";

const asset = {
  localAssetId: "10000000-0000-4000-8000-000000000001",
  assetRef: "asset:20000000-0000-4000-8000-000000000002",
  displayName: "Sanctuary",
  mediaType: "image/png" as const,
  byteSize: 4,
  importedAt: "2026-07-13T01:02:03.000Z",
};

describe("ImageAssetObjectUrlStore", () => {
  it("deduplicates bounded immutable reads and revokes its renderer URL", async () => {
    const create = vi.fn(() => "blob:cbb-image");
    const revoke = vi.fn();
    const read = vi.fn(async () => new Uint8Array([1, 2, 3, 4]));
    const store = new ImageAssetObjectUrlStore({ create, revoke });
    await expect(Promise.all([store.ensure(asset, read), store.ensure(asset, read)]))
      .resolves.toEqual(["blob:cbb-image", "blob:cbb-image"]);
    expect(read).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith(asset.localAssetId, asset.assetRef);
    expect(store.url(asset.assetRef)).toBe("blob:cbb-image");
    store.dispose();
    expect(revoke).toHaveBeenCalledWith("blob:cbb-image");
  });

  it("rejects bytes that disagree with the immutable summary", async () => {
    const store = new ImageAssetObjectUrlStore({ create: vi.fn(), revoke: vi.fn() });
    await expect(store.ensure(asset, async () => new Uint8Array([1, 2, 3])))
      .rejects.toThrow(/immutable metadata/u);
    expect(store.url(asset.assetRef)).toBeUndefined();
  });
});
