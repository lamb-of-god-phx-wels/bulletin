import type { RendererImageAssetSummary } from "../bridge/imageAssets.js";

export const RENDERER_IMAGE_CACHE_LIMITS = Object.freeze({
  entryBytes: 64 * 1024 * 1024,
  totalBytes: 256 * 1024 * 1024,
  entries: 256,
});

export interface ImageAssetObjectUrlPort {
  create(bytes: Uint8Array, mediaType: RendererImageAssetSummary["mediaType"]): string;
  revoke(url: string): void;
}

function browserObjectUrls(): ImageAssetObjectUrlPort {
  return {
    create(bytes, mediaType) {
      // Copy into an ArrayBuffer-owned view before crossing the Blob boundary;
      // this avoids retaining a potentially larger IPC backing allocation.
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      return URL.createObjectURL(new Blob([copy.buffer], { type: mediaType }));
    },
    revoke(url) {
      URL.revokeObjectURL(url);
    },
  };
}

/** Owns a bounded set of renderer-only blob URLs; no path or network URL enters it. */
export class ImageAssetObjectUrlStore {
  private readonly urls = new Map<string, { readonly url: string; readonly byteSize: number }>();
  private readonly loading = new Map<string, Promise<string>>();
  private totalBytes = 0;
  private pendingBytes = 0;
  private disposed = false;

  constructor(private readonly port: ImageAssetObjectUrlPort = browserObjectUrls()) {}

  url(assetRef: string): string | undefined {
    return this.urls.get(assetRef)?.url;
  }

  async ensure(
    asset: RendererImageAssetSummary,
    read: (localAssetId: string, assetRef: string) => Promise<Uint8Array>,
  ): Promise<string> {
    if (this.disposed) throw new Error("The image preview cache is closed.");
    const existing = this.urls.get(asset.assetRef);
    if (existing !== undefined) return existing.url;
    const pending = this.loading.get(asset.assetRef);
    if (pending !== undefined) return pending;
    if (!Number.isSafeInteger(asset.byteSize) || asset.byteSize < 1 ||
      asset.byteSize > RENDERER_IMAGE_CACHE_LIMITS.entryBytes ||
      this.urls.size + this.loading.size >= RENDERER_IMAGE_CACHE_LIMITS.entries ||
      this.totalBytes + this.pendingBytes + asset.byteSize > RENDERER_IMAGE_CACHE_LIMITS.totalBytes) {
      throw new Error("The renderer image preview cache has reached its safe limit.");
    }
    this.pendingBytes += asset.byteSize;
    const operation = (async () => {
      const bytes = await read(asset.localAssetId, asset.assetRef);
      if (this.disposed) throw new Error("The image preview cache is closed.");
      if (!(bytes instanceof Uint8Array) || bytes.byteLength !== asset.byteSize) {
        throw new Error("The image preview bytes do not match their immutable metadata.");
      }
      const url = this.port.create(bytes, asset.mediaType);
      this.urls.set(asset.assetRef, { url, byteSize: bytes.byteLength });
      this.totalBytes += bytes.byteLength;
      return url;
    })().finally(() => {
      this.pendingBytes -= asset.byteSize;
      this.loading.delete(asset.assetRef);
    });
    this.loading.set(asset.assetRef, operation);
    return operation;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.urls.values()) this.port.revoke(entry.url);
    this.urls.clear();
    this.totalBytes = 0;
  }
}
