import { randomUUID } from "node:crypto";
import {
  hashBytes,
  parseLocalResourceId,
  parsePortableAssetRef,
  type Sha256Hash,
} from "@cbb/core";
import {
  WORKSPACE_REGISTRY_PATH,
  assertManagedPathHasNoSymlink,
  createNodeFileSystemPort,
  decodeCanonicalJson,
  parseWorkspaceRegistry,
  planAssetRevisionInstall,
  resolveWorkspacePath,
  type AssetRevisionRecord,
  type DurableFileSystemPort,
  type TransactionDigest,
  type WorkspaceRegistry,
} from "@cbb/services";
import type { VerifiedQuarantineReceipt } from "@cbb/workers";
import type { M3EditableWorkspace } from "../composition.js";
import type {
  M4ImageAssetImportOutcome,
  M4ImageAssetSummary,
} from "./contract.js";
import { M4_IMAGE_ASSET_LIMITS } from "./nodeImageAssetCatalog.js";

const MAX_WORKSPACE_REGISTRY_BYTES = 100 * 1024 * 1024;
const UNSAFE_FILENAME = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;

export interface M4SelectedImageInput {
  readonly bytes: Uint8Array;
  readonly originalFilename: string;
  readonly operation: "canonicalizeRaster" | "sanitizeSvg";
}

export type M4SelectedImageOutcome =
  | { readonly status: "selected"; readonly input: M4SelectedImageInput }
  | { readonly status: "canceled" };

export interface M4CanonicalizedImage {
  readonly bytes: Uint8Array;
  readonly mediaType: "image/png" | "image/svg+xml";
  readonly canonicalHash: Sha256Hash;
  readonly receipt: VerifiedQuarantineReceipt;
  readonly sanitizer: {
    readonly toolId: string;
    readonly version: string;
    readonly toolHash: Sha256Hash;
  };
  readonly pixelWidth?: number;
  readonly pixelHeight?: number;
}

/** Release-owned, isolated canonicalization capability. There is no fallback. */
export interface M4ManagedImageCanonicalizer {
  canonicalize(input: M4SelectedImageInput): Promise<M4CanonicalizedImage>;
}

export interface NodeM4ManagedImageImporterOptions {
  readonly workspace: M3EditableWorkspace;
  readonly catalog: Parameters<typeof parseWorkspaceRegistry>[1];
  readonly chooseImage: () => Promise<M4SelectedImageOutcome>;
  readonly canonicalizer: M4ManagedImageCanonicalizer;
  readonly fileSystem?: DurableFileSystemPort;
  readonly ids?: { readonly randomUuid: () => string };
  readonly clock?: { readonly now: () => Date };
}

function safeFilename(value: string): string {
  const leaf = value.split(/[\\/]/u).at(-1) ?? "";
  const cleaned = leaf.normalize("NFC").replace(UNSAFE_FILENAME, " ").trim();
  const bounded = [...cleaned].slice(0, 255).join("").trim();
  return bounded.length === 0 ? "Imported image" : bounded;
}

function displayName(filename: string): string {
  const withoutExtension = filename.replace(/\.(?:png|jpe?g|svg)$/iu, "").trim();
  const bounded = [...withoutExtension].slice(0, 120).join("").trim();
  return bounded.length === 0 ? "Imported image" : bounded;
}

function summary(record: AssetRevisionRecord): M4ImageAssetSummary {
  return {
    localAssetId: record.localId,
    assetRef: record.portableAssetId,
    displayName: record.displayName,
    mediaType: record.mediaType as M4ImageAssetSummary["mediaType"],
    byteSize: record.byteSize,
    ...(record.width === undefined ? {} : { pixelWidth: record.width }),
    ...(record.height === undefined ? {} : { pixelHeight: record.height }),
    importedAt: record.importedAt,
  };
}

/**
 * Installs one immutable image revision through the owned journaled transaction
 * service. Imports are serialized so every registry commit is planned from the
 * latest durable registry, never from the startup snapshot.
 */
export class NodeM4ManagedImageImporter {
  private readonly fileSystem: DurableFileSystemPort;
  private readonly ids: { readonly randomUuid: () => string };
  private readonly clock: { readonly now: () => Date };
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly options: NodeM4ManagedImageImporterOptions) {
    this.fileSystem = options.fileSystem ?? createNodeFileSystemPort();
    this.ids = options.ids ?? { randomUuid: () => randomUUID() };
    this.clock = options.clock ?? { now: () => new Date() };
  }

  import(): Promise<M4ImageAssetImportOutcome> {
    const work = this.tail.then(() => this.importOwned());
    this.tail = work.then(() => undefined, () => undefined);
    return work;
  }

  private async currentRegistry(): Promise<WorkspaceRegistry> {
    await assertManagedPathHasNoSymlink(
      this.fileSystem,
      this.options.workspace.root,
      WORKSPACE_REGISTRY_PATH,
    );
    const bytes = await this.fileSystem.readFileNoFollow(
      resolveWorkspacePath(this.options.workspace.root, WORKSPACE_REGISTRY_PATH),
      MAX_WORKSPACE_REGISTRY_BYTES,
    );
    const registry = parseWorkspaceRegistry(decodeCanonicalJson(bytes), this.options.catalog);
    if (registry.workspaceId !== this.options.workspace.registry.workspaceId) {
      throw new Error("The bulletin library changed while the image was being imported.");
    }
    return registry;
  }

  private async importOwned(): Promise<M4ImageAssetImportOutcome> {
    const selected = await this.options.chooseImage();
    if (selected.status === "canceled") return { status: "canceled" };
    if (!(selected.input.bytes instanceof Uint8Array) || selected.input.bytes.byteLength < 1) {
      throw new TypeError("The selected image did not contain stable bytes.");
    }
    const canonical = await this.options.canonicalizer.canonicalize(selected.input);
    if (
      canonical.bytes.byteLength < 1 ||
      canonical.bytes.byteLength > M4_IMAGE_ASSET_LIMITS.canonicalBytes ||
      hashBytes(canonical.bytes) !== canonical.canonicalHash ||
      (canonical.mediaType === "image/png") !== (canonical.pixelWidth !== undefined) ||
      (canonical.pixelWidth === undefined) !== (canonical.pixelHeight === undefined)
    ) {
      throw new TypeError("The isolated image result was inconsistent.");
    }

    const originalFilename = safeFilename(selected.input.originalFilename);
    const importedAt = this.clock.now().toISOString();
    const localId = parseLocalResourceId(this.ids.randomUuid());
    const portableAssetId = parsePortableAssetRef(`asset:${this.ids.randomUuid()}`);
    const record: AssetRevisionRecord = {
      version: 1,
      kind: "assetRecord",
      localId,
      portableAssetId,
      displayName: displayName(originalFilename),
      originalFilename,
      mediaType: canonical.mediaType,
      canonicalHash: canonical.canonicalHash,
      byteSize: canonical.bytes.byteLength,
      ...(canonical.pixelWidth === undefined ? {} : { width: canonical.pixelWidth }),
      ...(canonical.pixelHeight === undefined ? {} : { height: canonical.pixelHeight }),
      sanitizationState: "validated",
      sanitizer: canonical.sanitizer,
      sourceOriginal: {
        hash: hashBytes(selected.input.bytes),
        byteSize: selected.input.bytes.byteLength,
      },
      aiVisibility: "private",
      importedAt,
    };
    const registry = await this.currentRegistry();
    if ((registry.assets?.length ?? 0) >= M4_IMAGE_ASSET_LIMITS.rows) {
      throw new Error("This bulletin library has reached its supported image limit.");
    }
    const plan = planAssetRevisionInstall({
      sourceDigest: hashBytes(selected.input.bytes) as TransactionDigest,
      registry,
      record,
      canonicalBytes: canonical.bytes,
      validationReceipt: canonical.receipt,
    });

    let transactionId: string | undefined;
    try {
      const prepared = await this.options.workspace.transactions.prepare(plan.request);
      transactionId = prepared.transactionId;
      await this.options.workspace.transactions.commit(transactionId);
    } catch (error) {
      if (transactionId !== undefined) {
        await this.options.workspace.transactions.rollback(transactionId).catch(() => undefined);
      }
      throw error;
    }
    return { status: "imported", asset: summary(record) };
  }
}
