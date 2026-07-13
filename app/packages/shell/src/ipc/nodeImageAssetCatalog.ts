import { hashBytes, isPortableAssetRef } from "@cbb/core";
import {
  assertManagedPathHasNoSymlink,
  createNodeFileSystemPort,
  createResourceResolverIndex,
  decodeCanonicalJson,
  resolveWorkspacePath,
  type AssetRevisionRecord,
  type DurableFileSystemPort,
  type WorkspaceRegistry,
} from "@cbb/services";

export const M4_IMAGE_ASSET_LIMITS = Object.freeze({
  recordBytes: 1024 * 1024,
  canonicalBytes: 64 * 1024 * 1024,
  rows: 5_000,
  concurrentReads: 2,
});

export interface M4InstalledImageAsset {
  readonly localAssetId: string;
  readonly assetRef: string;
  readonly displayName: string;
  readonly mediaType: "image/png" | "image/svg+xml";
  readonly byteSize: number;
  readonly pixelWidth?: number;
  readonly pixelHeight?: number;
  readonly importedAt: string;
}

export interface NodeM4ImageAssetCatalogOptions {
  /** Trusted main-process path; it is never returned to or accepted from the renderer. */
  readonly workspaceRoot: string;
  readonly fileSystem?: DurableFileSystemPort;
}

function visibleImageType(value: string): value is M4InstalledImageAsset["mediaType"] {
  return value === "image/png" || value === "image/svg+xml";
}

export class NodeM4ImageAssetCatalog {
  private readonly fileSystem: DurableFileSystemPort;
  private activeReads = 0;

  constructor(private readonly options: NodeM4ImageAssetCatalogOptions) {
    this.fileSystem = options.fileSystem ?? createNodeFileSystemPort();
  }

  private async record(
    registry: WorkspaceRegistry,
    localId: string,
  ): Promise<AssetRevisionRecord> {
    const resource = registry.assets?.find((candidate) => candidate.localId === localId);
    if (resource === undefined || resource.kind !== "asset") {
      throw new Error("The installed image is no longer in this library.");
    }
    const expectedRecordPath = `assets/${localId}/asset.json`;
    if (resource.storagePath !== expectedRecordPath) {
      throw new Error("The installed image has unsafe library metadata.");
    }
    await assertManagedPathHasNoSymlink(
      this.fileSystem,
      this.options.workspaceRoot,
      expectedRecordPath,
    );
    const bytes = await this.fileSystem.readFileNoFollow(
      resolveWorkspacePath(this.options.workspaceRoot, expectedRecordPath),
      M4_IMAGE_ASSET_LIMITS.recordBytes,
    );
    if (hashBytes(bytes) !== resource.contentHash) {
      throw new Error("The installed image metadata failed its integrity check.");
    }
    const index = createResourceResolverIndex({
      assets: [decodeCanonicalJson(bytes)],
      fonts: [],
    });
    const record = [...index.assetsByRef.values()][0];
    if (record === undefined || record.localId !== localId ||
      record.sanitizationState !== "validated") {
      throw new Error("The installed asset is not a validated immutable resource.");
    }
    return record;
  }

  async list(registry: WorkspaceRegistry): Promise<readonly M4InstalledImageAsset[]> {
    const resources = registry.assets ?? [];
    if (resources.length > M4_IMAGE_ASSET_LIMITS.rows) {
      throw new Error("The installed image library is too large to display safely.");
    }
    const rows: M4InstalledImageAsset[] = [];
    const seenRefs = new Set<string>();
    for (const resource of resources) {
      const record = await this.record(registry, resource.localId);
      if (!visibleImageType(record.mediaType) ||
        record.byteSize > M4_IMAGE_ASSET_LIMITS.canonicalBytes) continue;
      if (seenRefs.has(record.portableAssetId)) {
        throw new Error("The installed image library contains a duplicate immutable identity.");
      }
      seenRefs.add(record.portableAssetId);
      rows.push({
        localAssetId: record.localId,
        assetRef: record.portableAssetId,
        displayName: resource.displayName,
        mediaType: record.mediaType as M4InstalledImageAsset["mediaType"],
        byteSize: record.byteSize,
        ...(record.width === undefined ? {} : { pixelWidth: record.width }),
        ...(record.height === undefined ? {} : { pixelHeight: record.height }),
        importedAt: record.importedAt,
      });
    }
    return rows.sort((left, right) =>
      left.displayName.localeCompare(right.displayName) || left.assetRef.localeCompare(right.assetRef),
    );
  }

  async read(
    registry: WorkspaceRegistry,
    localAssetId: string,
    assetRef: string,
  ): Promise<Uint8Array> {
    if (this.activeReads >= M4_IMAGE_ASSET_LIMITS.concurrentReads) {
      throw new Error("Too many image previews are being opened at once.");
    }
    this.activeReads += 1;
    try {
      if (!isPortableAssetRef(assetRef)) {
        throw new Error("The image identity is invalid.");
      }
      const record = await this.record(registry, localAssetId);
      if (record.portableAssetId !== assetRef || !visibleImageType(record.mediaType) ||
        record.byteSize > M4_IMAGE_ASSET_LIMITS.canonicalBytes) {
        throw new Error("That image is no longer installed in this library.");
      }
      const canonicalPath = `assets/${record.localId}/canonical`;
      await assertManagedPathHasNoSymlink(
        this.fileSystem,
        this.options.workspaceRoot,
        canonicalPath,
      );
      const bytes = await this.fileSystem.readFileNoFollow(
        resolveWorkspacePath(this.options.workspaceRoot, canonicalPath),
        M4_IMAGE_ASSET_LIMITS.canonicalBytes,
      );
      if (bytes.byteLength !== record.byteSize || hashBytes(bytes) !== record.canonicalHash) {
        throw new Error("The installed image failed its integrity check.");
      }
      return bytes;
    } finally {
      this.activeReads -= 1;
    }
  }
}
