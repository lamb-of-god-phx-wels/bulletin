import {
  canonicalRevisionToken,
  fromJson,
  hashBytes,
  isPortableAssetRef,
  isPortableFontRef,
  type IdPort,
  type SchemaCatalog,
} from "@cbb/core";
import {
  ARTIFACT_RECORD_SCHEMA_ID,
  type ArtifactRecord,
} from "../artifacts/index.js";
import {
  NodeRecoverySnapshotStore,
} from "../autosave/index.js";
import {
  CONFLICT_RECORD_SCHEMA_ID,
  type ConflictRecord,
} from "../persistence/index.js";
import {
  decodeCanonicalJson,
  type DurableFileSystemPort,
} from "../ports/index.js";
import {
  createResourceResolverIndex,
  type AssetRevisionRecord,
  type FontRevisionRecord,
} from "../resources/index.js";
import type {
  TransactionJournal,
  TransactionStoragePort,
} from "../transactions/index.js";
import {
  CONFLICT_DIRECTORY,
  MULTI_TRANSACTION_JOURNAL_DIRECTORY,
  WORKSPACE_REGISTRY_PATH,
  assertManagedPathHasNoSymlink,
  parseWorkspaceRegistry,
  resolveWorkspacePath,
  type LocalResourceRecord,
} from "../workspace/index.js";
import type {
  RetentionFragment,
  RetentionProjectionSource,
} from "./retentionProjection.js";
import {
  assetRevisionRetentionNodeId,
  collectActiveRegistryRetention,
  collectArtifactRetention,
  collectConflictAndRecoveryRetention,
  collectPendingTransactionRetention,
  documentRevisionRetentionNodeId,
  fontRevisionRetentionNodeId,
  mergeRetentionFragments,
} from "./retentionProjection.js";
import type {
  RetentionGraphInput,
  RetentionNode,
  RetentionNodeKind,
  RetentionReference,
} from "./retentionGraph.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ARTIFACT_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(json|pdf|typ|log)$/u;
const CONFLICT_INSTANCE = /^[0-9]{8}T[0-9]{6}[0-9]{3}Z-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_JSON_BYTES = 100 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const MAX_ARTIFACT_RECORD_BYTES = 16 * 1024 * 1024;
const MAX_ARTIFACT_OWNED_BYTES = 1024 * 1024 * 1024;
const MAX_DIRECTORY_ENTRIES = 200_000;
const RECOVERY_DIRECTORY = "transactions/recovery";

interface PortableDependencies {
  readonly assets: ReadonlySet<string>;
  readonly fonts: ReadonlySet<string>;
}

interface ResourceInventory {
  readonly fragment: RetentionFragment;
  readonly descriptors: readonly {
    readonly localId: string;
    readonly contentHash: string;
    readonly node: RetentionNode;
  }[];
  readonly activeAssets: ReadonlyMap<string, string>;
  readonly activeFonts: ReadonlyMap<string, string>;
  readonly nodesByLocalId: ReadonlyMap<string, string>;
}

export interface NodeWorkspaceRetentionSourceOptions {
  readonly root: string;
  readonly fileSystem: DurableFileSystemPort;
  readonly catalog: SchemaCatalog;
  readonly ids: IdPort;
  readonly transactions: TransactionStoragePort;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function plainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function otherNodeId(record: LocalResourceRecord): string {
  return `workspace:${encodeURIComponent(record.kind)}:${record.localId}:${record.contentHash}`;
}

function otherKind(record: LocalResourceRecord): RetentionNodeKind {
  switch (record.kind) {
    case "song": return "songRevision";
    case "scripture": return "scriptureRevision";
    case "resourcePack": return "resourcePack";
    case "packDraft": return "packDraft";
    case "weeklyWork": return "weeklyWork";
    default: return "other";
  }
}

function dependencies(value: unknown): PortableDependencies {
  const assets = new Set<string>();
  const fonts = new Set<string>();
  const pending: unknown[] = [value];
  let visited = 0;
  while (pending.length > 0) {
    if (++visited > 1_000_000) throw new RangeError("Retention dependency scan exceeds its node cap");
    const current = pending.pop();
    if (typeof current === "string") {
      if (isPortableAssetRef(current)) assets.add(current);
      else if (isPortableFontRef(current)) fonts.add(current);
    } else if (Array.isArray(current)) {
      pending.push(...current);
    } else if (plainRecord(current)) {
      pending.push(...Object.values(current));
    }
  }
  return { assets, fonts };
}

/** Fixed-layout, bounded, no-follow inventory for one trusted workspace root. */
export class NodeWorkspaceRetentionSource implements RetentionProjectionSource {
  private readonly root: string;

  constructor(private readonly options: NodeWorkspaceRetentionSourceOptions) {
    this.root = options.root;
  }

  async collect(): Promise<RetentionGraphInput> {
    const registryRead = await this.readJson(WORKSPACE_REGISTRY_PATH, MAX_JSON_BYTES);
    const registry = parseWorkspaceRegistry(registryRead.value, this.options.catalog);
    const resources = await this.collectResources(registry);
    const activeRegistry = collectActiveRegistryRetention(registry, resources.descriptors);
    const transactions = await this.collectTransactions(resources.nodesByLocalId);
    const conflictAndRecovery = await this.collectConflictAndRecovery(
      registry.workspaceId,
      resources.activeAssets,
      resources.activeFonts,
    );
    const artifacts = await this.collectArtifacts();
    const combined = mergeRetentionFragments([
      resources.fragment,
      activeRegistry,
      transactions,
      conflictAndRecovery,
      artifacts,
    ]);

    // Bundled components can appear in artifact evidence but are not workspace
    // cleanup targets. Represent only those absent exact resource identities as
    // external zero-byte endpoints; missing artifact parents remain fatal.
    const known = new Set(combined.nodes.map((node) => node.id));
    const external: RetentionNode[] = [];
    for (const reference of combined.references) {
      if (
        !known.has(reference.to) &&
        (reference.to.startsWith("asset:") || reference.to.startsWith("font:"))
      ) {
        known.add(reference.to);
        external.push({ id: reference.to, kind: "other", byteSize: 0 });
      }
    }
    return mergeRetentionFragments([combined, { nodes: external, references: [], roots: [] }]);
  }

  private async collectResources(
    registry: ReturnType<typeof parseWorkspaceRegistry>,
  ): Promise<ResourceInventory> {
    const nodes: RetentionNode[] = [];
    const references: RetentionReference[] = [];
    const descriptors: ResourceInventory["descriptors"][number][] = [];
    const nodesByLocalId = new Map<string, string>();
    const assetRecordHashes = new Map<string, string>();
    const fontRecordHashes = new Map<string, string>();

    for (const localId of await this.uuidDirectories("assets")) {
      const relative = `assets/${localId}/asset.json`;
      const read = await this.readJson(relative, MAX_JSON_BYTES);
      const record = [...createResourceResolverIndex({ assets: [read.value], fonts: [] }).assetsByRef.values()][0];
      if (record === undefined || record.localId !== localId) {
        throw new TypeError("Asset record identity disagrees with its fixed directory");
      }
      const canonical = await this.readBytes(`assets/${localId}/canonical`, record.byteSize);
      if (canonical.bytes.byteLength !== record.byteSize || hashBytes(canonical.bytes) !== record.canonicalHash) {
        throw new TypeError("Asset canonical bytes disagree with their immutable record");
      }
      const nodeId = assetRevisionRetentionNodeId(record.portableAssetId, record.canonicalHash);
      nodes.push({ id: nodeId, kind: "assetRevision", byteSize: read.byteSize + canonical.byteSize });
      nodesByLocalId.set(localId, nodeId);
      assetRecordHashes.set(localId, hashBytes(read.bytes));
    }

    for (const localId of await this.uuidDirectories("fonts")) {
      const relative = `fonts/${localId}/font.json`;
      const read = await this.readJson(relative, MAX_JSON_BYTES);
      const record = [...createResourceResolverIndex({ assets: [], fonts: [read.value] }).fontsByRef.values()][0];
      if (record === undefined || record.localId !== localId) {
        throw new TypeError("Font record identity disagrees with its fixed directory");
      }
      let byteSize = read.byteSize;
      for (const face of record.faces) {
        const faceBytes = await this.readBytes(`fonts/${localId}/faces/${face.faceId}`, face.byteSize);
        if (faceBytes.bytes.byteLength !== face.byteSize || hashBytes(faceBytes.bytes) !== face.hash) {
          throw new TypeError("Font face bytes disagree with their immutable record");
        }
        byteSize += faceBytes.byteSize;
        if (!Number.isSafeInteger(byteSize)) throw new RangeError("Font revision size exceeds safe integer range");
      }
      const nodeId = fontRevisionRetentionNodeId(record.portableFontId, record.familyDigest);
      nodes.push({ id: nodeId, kind: "fontRevision", byteSize });
      nodesByLocalId.set(localId, nodeId);
      fontRecordHashes.set(localId, hashBytes(read.bytes));
    }

    const activeAssets = new Map<string, string>();
    const activeFonts = new Map<string, string>();
    for (const record of registry.assets ?? []) {
      const nodeId = nodesByLocalId.get(record.localId);
      if (nodeId === undefined || assetRecordHashes.get(record.localId) !== record.contentHash) {
        throw new TypeError("Active asset registry entry does not match an exact immutable revision");
      }
      descriptors.push({ localId: record.localId, contentHash: record.contentHash, node: this.requireNode(nodes, nodeId) });
      const raw = await this.readJson(record.storagePath, MAX_JSON_BYTES);
      const asset = [...createResourceResolverIndex({ assets: [raw.value], fonts: [] }).assetsByRef.values()][0] as AssetRevisionRecord;
      activeAssets.set(asset.portableAssetId, nodeId);
    }
    for (const record of registry.fonts ?? []) {
      const nodeId = nodesByLocalId.get(record.localId);
      if (nodeId === undefined || fontRecordHashes.get(record.localId) !== record.contentHash) {
        throw new TypeError("Active font registry entry does not match an exact immutable revision");
      }
      descriptors.push({ localId: record.localId, contentHash: record.contentHash, node: this.requireNode(nodes, nodeId) });
      const raw = await this.readJson(record.storagePath, MAX_JSON_BYTES);
      const font = [...createResourceResolverIndex({ assets: [], fonts: [raw.value] }).fontsByRef.values()][0] as FontRevisionRecord;
      activeFonts.set(font.portableFontId, nodeId);
    }

    for (const record of [...(registry.bulletins ?? []), ...(registry.templates ?? [])]) {
      const read = await this.readJson(record.storagePath, MAX_DOCUMENT_BYTES);
      const document = fromJson(read.value, this.options.catalog);
      if (canonicalRevisionToken(document) !== record.contentHash) {
        throw new TypeError("Active document bytes disagree with the workspace registry");
      }
      const nodeId = documentRevisionRetentionNodeId(record.localId, record.contentHash);
      const node: RetentionNode = { id: nodeId, kind: "document", byteSize: read.byteSize };
      nodes.push(node);
      nodesByLocalId.set(record.localId, nodeId);
      descriptors.push({ localId: record.localId, contentHash: record.contentHash, node });
      this.addPortableReferences(references, nodeId, dependencies(document), activeAssets, activeFonts, "documentDependency");
    }

    const handled = new Set([...(registry.assets ?? []), ...(registry.fonts ?? []), ...(registry.bulletins ?? []), ...(registry.templates ?? [])].map((record) => record.localId));
    for (const record of this.registryRecords(registry)) {
      if (handled.has(record.localId)) continue;
      const read = await this.readBytes(record.storagePath, MAX_JSON_BYTES);
      if (hashBytes(read.bytes) !== record.contentHash) {
        throw new TypeError("Active workspace resource bytes disagree with the registry");
      }
      const node: RetentionNode = {
        id: otherNodeId(record),
        kind: otherKind(record),
        byteSize: read.byteSize,
      };
      nodes.push(node);
      nodesByLocalId.set(record.localId, node.id);
      descriptors.push({ localId: record.localId, contentHash: record.contentHash, node });
    }

    return {
      fragment: { nodes, references, roots: [] },
      descriptors,
      activeAssets,
      activeFonts,
      nodesByLocalId,
    };
  }

  private async collectTransactions(
    nodesByLocalId: ReadonlyMap<string, string>,
  ): Promise<RetentionFragment> {
    const transactions = [];
    for (const transactionId of await this.options.transactions.listJournalIds()) {
      const raw = await this.options.transactions.readJournal(transactionId);
      if (!plainRecord(raw) || raw["transactionId"] !== transactionId) {
        throw new TypeError("Pending transaction journal identity is invalid");
      }
      const journal = raw as unknown as TransactionJournal;
      const payloads = await this.options.transactions.listTransactionPayloads(transactionId);
      const pinnedNodeIds = new Set<string>();
      for (const step of journal.steps) {
        const match = /^(?:assetRecord|assetCanonical|fontRecord|fontFace):([0-9a-f-]{36})(?::|$)/u.exec(step.resourceKey);
        if (match?.[1] !== undefined) {
          const nodeId = nodesByLocalId.get(match[1]);
          if (nodeId !== undefined) pinnedNodeIds.add(nodeId);
        }
      }
      const journalRead = await this.readBytes(
        `${MULTI_TRANSACTION_JOURNAL_DIRECTORY}/${transactionId}.json`,
        MAX_JSON_BYTES,
      );
      transactions.push({
        journal,
        journalByteSize: journalRead.byteSize,
        payloads,
        pinnedNodeIds: [...pinnedNodeIds],
      });
    }
    return collectPendingTransactionRetention(transactions);
  }

  private async collectConflictAndRecovery(
    workspaceId: ReturnType<typeof parseWorkspaceRegistry>["workspaceId"],
    activeAssets: ReadonlyMap<string, string>,
    activeFonts: ReadonlyMap<string, string>,
  ): Promise<RetentionFragment> {
    const conflicts = [];
    for (const localId of await this.uuidDirectories(CONFLICT_DIRECTORY)) {
      for (const instance of await this.directoryNames(`${CONFLICT_DIRECTORY}/${localId}`)) {
        if (!CONFLICT_INSTANCE.test(instance)) throw new TypeError("Conflict directory contains unrecognized residue");
        const directory = `${CONFLICT_DIRECTORY}/${localId}/${instance}`;
        const names = await this.directoryNames(directory);
        if (names.join("\0") !== ["base.json", "conflict.json", "disk.json", "ours.json"].join("\0")) {
          throw new TypeError("Conflict directory is not a closed fixed-layout record");
        }
        const recordRead = await this.readJson(`${directory}/conflict.json`, MAX_JSON_BYTES);
        if (!this.options.catalog.validateAgainst(CONFLICT_RECORD_SCHEMA_ID, recordRead.value).valid) {
          throw new TypeError("Conflict record fails schema validation");
        }
        const record = recordRead.value as ConflictRecord;
        if (record.localResourceId !== localId || record.workspaceId !== workspaceId) {
          throw new TypeError("Conflict record identity disagrees with its fixed directory");
        }
        let byteSize = recordRead.byteSize;
        const dependencyNodeIds = new Set<string>();
        for (const name of ["base.json", "disk.json", "ours.json"] as const) {
          const read = await this.readJson(`${directory}/${name}`, MAX_DOCUMENT_BYTES);
          byteSize += read.byteSize;
          if (!Number.isSafeInteger(byteSize)) throw new RangeError("Conflict size exceeds safe integer range");
          this.addPortableIds(dependencyNodeIds, dependencies(read.value), activeAssets, activeFonts);
        }
        conflicts.push({ record, byteSize, dependencyNodeIds: [...dependencyNodeIds] });
      }
    }

    const recoverySnapshots = [];
    const store = new NodeRecoverySnapshotStore({
      root: this.root,
      workspaceId,
      fileSystem: this.options.fileSystem,
      ids: this.options.ids,
      catalog: this.options.catalog,
    });
    for (const localId of await this.uuidDirectories(RECOVERY_DIRECTORY)) {
      for (const candidate of await store.listValidSnapshots(localId as never)) {
        const dependencyNodeIds = new Set<string>();
        this.addPortableIds(
          dependencyNodeIds,
          dependencies(candidate.record.document),
          activeAssets,
          activeFonts,
        );
        recoverySnapshots.push({ candidate, dependencyNodeIds: [...dependencyNodeIds] });
      }
    }
    return collectConflictAndRecoveryRetention({ conflicts, recoverySnapshots });
  }

  private async collectArtifacts(): Promise<RetentionFragment> {
    const artifacts = [];
    for (const bulletinLocalId of await this.uuidDirectories("artifacts")) {
      const bulletinArtifacts: Array<{
        readonly record: ArtifactRecord;
        readonly byteSize: number;
      }> = [];
      const names = await this.directoryNames(`artifacts/${bulletinLocalId}`);
      const byBuild = new Map<string, Map<string, string>>();
      for (const name of names) {
        const match = ARTIFACT_FILE.exec(name);
        if (match?.[1] === undefined || match[2] === undefined) {
          throw new TypeError("Artifact directory contains unrecognized residue");
        }
        const files = byBuild.get(match[1]) ?? new Map<string, string>();
        files.set(match[2], name);
        byBuild.set(match[1], files);
      }
      for (const [buildId, files] of [...byBuild].sort(([left], [right]) => compareText(left, right))) {
        const recordName = files.get("json");
        if (recordName === undefined) throw new TypeError("Artifact owned bytes have no immutable record");
        const recordRead = await this.readJson(
          `artifacts/${bulletinLocalId}/${recordName}`,
          MAX_ARTIFACT_RECORD_BYTES,
        );
        if (!this.options.catalog.validateAgainst(ARTIFACT_RECORD_SCHEMA_ID, recordRead.value).valid) {
          throw new TypeError("Artifact record fails schema validation");
        }
        const record = recordRead.value as ArtifactRecord;
        if (record.bulletinLocalId !== bulletinLocalId || record.buildId !== buildId) {
          throw new TypeError("Artifact record identity disagrees with its fixed directory");
        }
        let byteSize = recordRead.byteSize;
        for (const extension of ["pdf", "typ", "log"] as const) {
          const name = files.get(extension);
          if (name === undefined) continue;
          const read = await this.readBytes(
            `artifacts/${bulletinLocalId}/${name}`,
            MAX_ARTIFACT_OWNED_BYTES,
          );
          byteSize += read.byteSize;
          if (!Number.isSafeInteger(byteSize)) throw new RangeError("Artifact size exceeds safe integer range");
        }
        bulletinArtifacts.push({ record, byteSize });
      }
      const latestSuccessfulPreview = bulletinArtifacts
        .filter(({ record }) => record.artifactKind === "preview" && record.status === "succeeded")
        .sort((left, right) =>
          (left.record.requestSequence ?? 0) - (right.record.requestSequence ?? 0) ||
          compareText(left.record.completedAt ?? "", right.record.completedAt ?? "") ||
          compareText(left.record.buildId, right.record.buildId)
        )
        .at(-1)?.record.buildId;
      for (const artifact of bulletinArtifacts) {
        artifacts.push({
          ...artifact,
          retained: artifact.record.artifactKind !== "preview" ||
            artifact.record.status === "queued" ||
            artifact.record.status === "running" ||
            artifact.record.buildId === latestSuccessfulPreview,
        });
      }
    }
    return collectArtifactRetention(artifacts);
  }

  private registryRecords(
    registry: ReturnType<typeof parseWorkspaceRegistry>,
  ): readonly LocalResourceRecord[] {
    return [
      ...(registry.bulletins ?? []),
      ...(registry.templates ?? []),
      ...(registry.assets ?? []),
      ...(registry.fonts ?? []),
      ...(registry.songs ?? []),
      ...(registry.scriptureCatalog ?? []),
      ...(registry.resourcePacks ?? []),
      ...(registry.importProvenance ?? []),
      ...(registry.installedPackState ?? []),
      ...(registry.sharedLibraryConnections ?? []),
      ...(registry.scriptureProviderConfig ?? []),
      ...(registry.packMaintainerDrafts ?? []),
    ];
  }

  private addPortableReferences(
    references: RetentionReference[],
    from: string,
    found: PortableDependencies,
    activeAssets: ReadonlyMap<string, string>,
    activeFonts: ReadonlyMap<string, string>,
    kind: RetentionReference["kind"],
  ): void {
    const ids = new Set<string>();
    this.addPortableIds(ids, found, activeAssets, activeFonts);
    for (const to of [...ids].sort()) references.push({ from, to, kind });
  }

  private addPortableIds(
    target: Set<string>,
    found: PortableDependencies,
    activeAssets: ReadonlyMap<string, string>,
    activeFonts: ReadonlyMap<string, string>,
  ): void {
    for (const ref of found.assets) {
      const nodeId = activeAssets.get(ref);
      if (nodeId !== undefined) target.add(nodeId);
    }
    for (const ref of found.fonts) {
      const nodeId = activeFonts.get(ref);
      if (nodeId !== undefined) target.add(nodeId);
    }
  }

  private requireNode(nodes: readonly RetentionNode[], nodeId: string): RetentionNode {
    const node = nodes.find((candidate) => candidate.id === nodeId);
    if (node === undefined) throw new TypeError("Retention resource node disappeared during collection");
    return node;
  }

  private async uuidDirectories(relative: string): Promise<readonly string[]> {
    const names = await this.directoryNames(relative);
    for (const name of names) {
      if (!UUID.test(name)) throw new TypeError(`${relative} contains a non-UUID entry`);
      const info = await this.options.fileSystem.entryInfo(resolveWorkspacePath(this.root, `${relative}/${name}`));
      if (info?.kind !== "directory") throw new TypeError(`${relative} contains a non-directory entry`);
    }
    return names;
  }

  private async directoryNames(relative: string): Promise<readonly string[]> {
    await assertManagedPathHasNoSymlink(this.options.fileSystem, this.root, relative);
    const path = resolveWorkspacePath(this.root, relative);
    const info = await this.options.fileSystem.entryInfo(path);
    if (info?.kind !== "directory") throw new TypeError(`Retention inventory directory is missing or unsafe: ${relative}`);
    const names = [...await this.options.fileSystem.readDirectory(path)].sort(compareText);
    if (names.length > MAX_DIRECTORY_ENTRIES) throw new RangeError("Retention inventory directory exceeds its entry cap");
    return names;
  }

  private async readJson(
    relative: string,
    maximumBytes: number,
  ): Promise<{ readonly value: unknown; readonly bytes: Uint8Array; readonly byteSize: number }> {
    const read = await this.readBytes(relative, maximumBytes);
    return { ...read, value: decodeCanonicalJson(read.bytes) };
  }

  private async readBytes(
    relative: string,
    maximumBytes: number,
  ): Promise<{ readonly bytes: Uint8Array; readonly byteSize: number }> {
    await assertManagedPathHasNoSymlink(this.options.fileSystem, this.root, relative);
    const path = resolveWorkspacePath(this.root, relative);
    const info = await this.options.fileSystem.entryInfo(path);
    if (
      info?.kind !== "file" ||
      !Number.isSafeInteger(info.size) ||
      info.size < 0 ||
      info.size > maximumBytes
    ) throw new TypeError(`Retention inventory file is missing, unbounded, or unsafe: ${relative}`);
    const bytes = await this.options.fileSystem.readFileNoFollow(path, maximumBytes);
    if (bytes.byteLength !== info.size) throw new TypeError("Retention inventory file changed while reading");
    return { bytes, byteSize: bytes.byteLength };
  }
}
