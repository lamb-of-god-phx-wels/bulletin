import type { Sha256Hash } from "@cbb/core";
import type { ArtifactRecord } from "../artifacts/index.js";
import type { RecoverySnapshotCandidate } from "../autosave/index.js";
import type { ConflictRecord } from "../persistence/index.js";
import type {
  TransactionJournal,
  TransactionPayload,
} from "../transactions/index.js";
import type {
  LocalResourceRecord,
  WorkspaceRegistry,
} from "../workspace/index.js";
import {
  computeRetentionPlan,
  deletionBlocker,
  type RetentionExplanation,
  type RetentionGraphInput,
  type RetentionNode,
  type RetentionNodeKind,
  type RetentionPlan,
  type RetentionReference,
  type RetentionRoot,
} from "./retentionGraph.js";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;

export interface RetentionFragment {
  readonly nodes: readonly RetentionNode[];
  readonly references: readonly RetentionReference[];
  readonly roots: readonly RetentionRoot[];
}

export interface RegistryRetentionResource {
  readonly localId: string;
  readonly contentHash: string;
  /** Exact revision identity used by resource/artifact cleanup. */
  readonly node: RetentionNode;
}

export interface PendingTransactionRetention {
  readonly journal: TransactionJournal;
  readonly journalByteSize: number;
  readonly payloads: readonly TransactionPayload[];
  /** Resource/artifact revisions whose old/new bytes the journal may restore or publish. */
  readonly pinnedNodeIds: readonly string[];
}

export interface ConflictRetention {
  readonly record: ConflictRecord;
  /** Conflict metadata plus owned base/disk/ours copies. */
  readonly byteSize: number;
  readonly dependencyNodeIds: readonly string[];
}

export interface RecoveryRetention {
  readonly candidate: RecoverySnapshotCandidate;
  readonly dependencyNodeIds: readonly string[];
}

export interface ArtifactRetention {
  readonly record: ArtifactRecord;
  /** Record plus any .typ/.pdf bytes owned by this build. */
  readonly byteSize: number;
  readonly retained: boolean;
}

export interface ActiveBuildRetentionPin {
  readonly buildId: string;
  readonly localResourceId: string;
  readonly documentRevision: string;
  readonly resourceClosureHash: Sha256Hash;
  /** Exact immutable resource revision node ids captured by the trusted projection. */
  readonly resourceNodeIds: readonly string[];
}

export interface RetentionProjectionSource {
  /** Must be captured under the same workspace mutation lane used by cleanup. */
  collect(): Promise<RetentionGraphInput>;
}

export interface RetentionPinLease {
  release(): Promise<void>;
}

export interface ResolvedActiveBuildPin<Result> {
  readonly result: Result;
  readonly pin: ActiveBuildRetentionPin;
}

export interface PublishedActiveBuildPin<Result> {
  readonly result: Result;
  readonly lease: RetentionPinLease;
}

export type RetentionCleanupResult<Result> =
  | { readonly status: "cleaned"; readonly result: Result }
  | {
      readonly status: "blocked";
      readonly reason: "retained" | "unknownNode" | "wrongKind";
      readonly explanation?: RetentionExplanation;
    };

function assertText(value: string, label: string): void {
  if (value.length === 0 || value.length > 2_048 || CONTROL.test(value)) {
    throw new TypeError(`${label} must be a bounded control-free identity`);
  }
}

function assertSize(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a nonnegative safe integer`);
  }
}

function assertHash(value: string, label: string): void {
  if (!SHA256.test(value)) throw new TypeError(`${label} is not a lowercase SHA-256 identity`);
}

function encode(value: string): string {
  assertText(value, "retention identity component");
  return encodeURIComponent(value);
}

export function documentRevisionRetentionNodeId(
  localResourceId: string,
  revision: string,
): string {
  if (!UUID.test(localResourceId)) throw new TypeError("Document local id is invalid");
  assertHash(revision, "document revision");
  return `document:${localResourceId}:${revision}`;
}

export function assetRevisionRetentionNodeId(assetRef: string, binaryHash: string): string {
  assertHash(binaryHash, "asset revision hash");
  return `asset:${encode(assetRef)}:${binaryHash}`;
}

export function fontRevisionRetentionNodeId(fontRef: string, familyDigest: string): string {
  assertHash(familyDigest, "font family digest");
  return `font:${encode(fontRef)}:${familyDigest}`;
}

export function artifactRetentionNodeId(
  bulletinLocalId: string,
  buildId: string,
): string {
  if (!UUID.test(bulletinLocalId) || !UUID.test(buildId)) {
    throw new TypeError("Artifact retention identity is invalid");
  }
  return `artifact:${bulletinLocalId}:${buildId}`;
}

export function transactionRetentionNodeId(transactionId: string): string {
  assertText(transactionId, "transaction id");
  return `transaction:${encode(transactionId)}`;
}

export function transactionPayloadRetentionNodeId(
  transactionId: string,
  payloadId: string,
  hash: string,
): string {
  assertHash(hash, "transaction payload hash");
  return `transaction-payload:${encode(transactionId)}:${encode(payloadId)}:${hash}`;
}

export function conflictRetentionNodeId(conflictId: string): string {
  if (!UUID.test(conflictId)) throw new TypeError("Conflict id is invalid");
  return `conflict:${conflictId}`;
}

export function recoveryRetentionNodeId(candidate: RecoverySnapshotCandidate): string {
  return `recovery:${candidate.record.localResourceId}:${candidate.record.editGeneration}:${candidate.byteHash}`;
}

export function activeBuildRetentionNodeId(buildId: string): string {
  if (!UUID.test(buildId)) throw new TypeError("Active build id is invalid");
  return `active-build:${buildId}`;
}

export function resourceClosureRetentionNodeId(hash: string): string {
  assertHash(hash, "resource closure hash");
  return `resource-closure:${hash}`;
}

const REGISTRY_COLLECTIONS = [
  "bulletins",
  "templates",
  "assets",
  "fonts",
  "songs",
  "scriptureCatalog",
  "resourcePacks",
  "importProvenance",
  "installedPackState",
  "sharedLibraryConnections",
  "scriptureProviderConfig",
  "packMaintainerDrafts",
] as const satisfies readonly (keyof WorkspaceRegistry)[];

function registryRecords(registry: WorkspaceRegistry): LocalResourceRecord[] {
  const records: LocalResourceRecord[] = [];
  for (const key of REGISTRY_COLLECTIONS) {
    const value = registry[key];
    if (Array.isArray(value)) records.push(...value as readonly LocalResourceRecord[]);
  }
  return records;
}

/** Root every registry-visible resource at its exact cleanup revision identity. */
export function collectActiveRegistryRetention(
  registry: WorkspaceRegistry,
  resources: readonly RegistryRetentionResource[],
): RetentionFragment {
  const records = registryRecords(registry);
  const descriptors = new Map<string, RegistryRetentionResource>();
  for (const resource of resources) {
    const key = `${resource.localId}\0${resource.contentHash}`;
    if (descriptors.has(key)) throw new TypeError("Duplicate registry retention descriptor");
    descriptors.set(key, resource);
  }
  const nodes: RetentionNode[] = [];
  const roots: RetentionRoot[] = [];
  for (const record of records) {
    const key = `${record.localId}\0${record.contentHash}`;
    const descriptor = descriptors.get(key);
    if (descriptor === undefined) {
      throw new TypeError(`Missing retention descriptor for active registry resource ${record.localId}`);
    }
    descriptors.delete(key);
    nodes.push(descriptor.node);
    roots.push({ nodeId: descriptor.node.id, reason: "activeWorkspaceResource" });
  }
  if (descriptors.size !== 0) {
    throw new TypeError("Registry retention descriptors contain resources outside the active registry");
  }
  return { nodes, references: [], roots };
}

/** Root every durable journal and every payload it can still replay. */
export function collectPendingTransactionRetention(
  transactions: readonly PendingTransactionRetention[],
): RetentionFragment {
  const nodes: RetentionNode[] = [];
  const references: RetentionReference[] = [];
  const roots: RetentionRoot[] = [];
  for (const transaction of transactions) {
    assertSize(transaction.journalByteSize, "transaction journal byte size");
    const transactionId = transaction.journal.transactionId;
    const transactionNodeId = transactionRetentionNodeId(transactionId);
    nodes.push({ id: transactionNodeId, kind: "transaction", byteSize: transaction.journalByteSize });
    roots.push({ nodeId: transactionNodeId, reason: "pendingTransaction" });
    for (const payload of transaction.payloads) {
      if (payload.transactionId !== transactionId) {
        throw new TypeError("Transaction payload belongs to a different journal");
      }
      assertHash(payload.hash, "transaction payload hash");
      const payloadNodeId = transactionPayloadRetentionNodeId(
        transactionId,
        payload.payloadId,
        payload.hash,
      );
      nodes.push({ id: payloadNodeId, kind: "transactionPayload", byteSize: payload.bytes.byteLength });
      references.push({ from: transactionNodeId, to: payloadNodeId, kind: "transactionPin" });
    }
    for (const nodeId of [...new Set(transaction.pinnedNodeIds)].sort()) {
      assertText(nodeId, "transaction resource pin");
      references.push({ from: transactionNodeId, to: nodeId, kind: "transactionPin" });
    }
  }
  return { nodes, references, roots };
}

export function collectConflictAndRecoveryRetention(input: {
  readonly conflicts: readonly ConflictRetention[];
  readonly recoverySnapshots: readonly RecoveryRetention[];
}): RetentionFragment {
  const nodes: RetentionNode[] = [];
  const references: RetentionReference[] = [];
  const roots: RetentionRoot[] = [];
  for (const conflict of input.conflicts) {
    assertSize(conflict.byteSize, "conflict byte size");
    const nodeId = conflictRetentionNodeId(conflict.record.conflictId);
    nodes.push({ id: nodeId, kind: "conflict", byteSize: conflict.byteSize });
    roots.push({ nodeId, reason: "conflictOrRecovery" });
    for (const dependency of [...new Set(conflict.dependencyNodeIds)].sort()) {
      references.push({ from: nodeId, to: dependency, kind: "conflictEvidence" });
    }
  }
  for (const recovery of input.recoverySnapshots) {
    const nodeId = recoveryRetentionNodeId(recovery.candidate);
    nodes.push({
      id: nodeId,
      kind: "recoverySnapshot",
      byteSize: recovery.candidate.byteSize,
    });
    roots.push({ nodeId, reason: "conflictOrRecovery" });
    for (const dependency of [...new Set(recovery.dependencyNodeIds)].sort()) {
      references.push({ from: nodeId, to: dependency, kind: "snapshotDependency" });
    }
  }
  return { nodes, references, roots };
}

/** Collect artifact-owned bytes, resource evidence, and compose/revalidate ancestry. */
export function collectArtifactRetention(
  artifacts: readonly ArtifactRetention[],
): RetentionFragment {
  const nodes: RetentionNode[] = [];
  const references: RetentionReference[] = [];
  const roots: RetentionRoot[] = [];
  for (const artifact of artifacts) {
    assertSize(artifact.byteSize, "artifact byte size");
    const record = artifact.record;
    const nodeId = artifactRetentionNodeId(record.bulletinLocalId, record.buildId);
    nodes.push({ id: nodeId, kind: "artifact", byteSize: artifact.byteSize });
    if (artifact.retained) roots.push({ nodeId, reason: "retainedArtifact" });
    const evidence = record.outputEvidence;
    if (evidence === undefined) continue;
    if (evidence.mode === "compose") {
      references.push({
        from: nodeId,
        to: artifactRetentionNodeId(record.bulletinLocalId, evidence.parentReaderBuildId),
        kind: "artifactParent",
      });
    } else if (evidence.mode === "revalidate") {
      references.push({
        from: nodeId,
        to: artifactRetentionNodeId(record.bulletinLocalId, evidence.sourceRenderBuildId),
        kind: "artifactEvidence",
      });
    }
    for (const asset of evidence.resources.assets) {
      references.push({
        from: nodeId,
        to: assetRevisionRetentionNodeId(asset.assetRef, asset.binaryHash),
        kind: "artifactEvidence",
      });
    }
    for (const font of evidence.resources.fontFaces) {
      references.push({
        from: nodeId,
        to: fontRevisionRetentionNodeId(font.fontRef, font.familyDigest),
        kind: "artifactEvidence",
      });
    }
  }
  return { nodes, references, roots };
}

/** Convert a trusted build projection into an atomic temporary retention root. */
export function collectActiveBuildRetention(
  builds: readonly ActiveBuildRetentionPin[],
): RetentionFragment {
  const nodes: RetentionNode[] = [];
  const references: RetentionReference[] = [];
  const roots: RetentionRoot[] = [];
  for (const build of builds) {
    if (!UUID.test(build.localResourceId)) throw new TypeError("Active build local resource id is invalid");
    assertHash(build.documentRevision, "active build document revision");
    const buildNodeId = activeBuildRetentionNodeId(build.buildId);
    const closureNodeId = resourceClosureRetentionNodeId(build.resourceClosureHash);
    nodes.push({ id: buildNodeId, kind: "activeBuild", byteSize: 0 });
    nodes.push({ id: closureNodeId, kind: "resourceClosure", byteSize: 0 });
    roots.push({ nodeId: buildNodeId, reason: "activeBuild" });
    references.push({ from: buildNodeId, to: closureNodeId, kind: "buildDependency" });
    for (const resourceNodeId of [...new Set(build.resourceNodeIds)].sort()) {
      assertText(resourceNodeId, "active build resource pin");
      references.push({ from: closureNodeId, to: resourceNodeId, kind: "buildDependency" });
    }
  }
  return { nodes, references, roots };
}

function sameNode(left: RetentionNode, right: RetentionNode): boolean {
  return left.id === right.id && left.kind === right.kind && left.byteSize === right.byteSize;
}

/** Merge independent collectors, deduplicating exact shared nodes/edges/roots. */
export function mergeRetentionFragments(
  fragments: readonly RetentionFragment[],
): RetentionGraphInput {
  const nodes = new Map<string, RetentionNode>();
  const references = new Map<string, RetentionReference>();
  const roots = new Map<string, RetentionRoot>();
  for (const fragment of fragments) {
    for (const node of fragment.nodes) {
      const existing = nodes.get(node.id);
      if (existing !== undefined && !sameNode(existing, node)) {
        throw new TypeError(`Conflicting retention node descriptions for ${node.id}`);
      }
      nodes.set(node.id, node);
    }
    for (const reference of fragment.references) {
      references.set(`${reference.from}\0${reference.to}\0${reference.kind}`, reference);
    }
    for (const root of fragment.roots) {
      roots.set(`${root.nodeId}\0${root.reason}`, root);
    }
  }
  return {
    nodes: [...nodes.values()],
    references: [...references.values()],
    roots: [...roots.values()],
  };
}

/**
 * Single cleanup/pin lane. Production collectors must use the same external
 * workspace mutation lane as durable writers; this class additionally prevents
 * an active-build pin from racing the projection-to-delete decision.
 */
export class RetentionCoordinator {
  private readonly pins = new Map<string, RetentionFragment>();
  private operationTail: Promise<void> = Promise.resolve();

  constructor(private readonly source: RetentionProjectionSource) {}

  pinActiveBuild(pin: ActiveBuildRetentionPin): Promise<RetentionPinLease> {
    return this.serialize(async () => this.publishActiveBuildPinOwned(pin));
  }

  /**
   * Resolve/re-hash an exact closure and publish its active pin without ever
   * releasing the cleanup lane between those operations.
   */
  resolveAndPinActiveBuild<Result>(
    resolve: () => Promise<ResolvedActiveBuildPin<Result>>,
  ): Promise<PublishedActiveBuildPin<Result>> {
    return this.serialize(async () => {
      const resolved = await resolve();
      return {
        result: resolved.result,
        lease: this.publishActiveBuildPinOwned(resolved.pin),
      };
    });
  }

  project(): Promise<RetentionPlan> {
    return this.serialize(() => this.projectOwned());
  }

  /** Serialize any durable mutation that can add or remove graph edges. */
  mutate<Result>(operation: () => Promise<Result>): Promise<Result> {
    return this.serialize(operation);
  }

  cleanupResourceRevision<Result>(
    nodeId: string,
    cleanupExact: () => Promise<Result>,
  ): Promise<RetentionCleanupResult<Result>> {
    return this.cleanup(
      nodeId,
      new Set<RetentionNodeKind>([
        "assetRevision",
        "fontRevision",
        "songRevision",
        "scriptureRevision",
        "resourcePack",
      ]),
      cleanupExact,
    );
  }

  cleanupArtifact<Result>(
    nodeId: string,
    cleanupExact: () => Promise<Result>,
  ): Promise<RetentionCleanupResult<Result>> {
    return this.cleanup(nodeId, new Set<RetentionNodeKind>(["artifact"]), cleanupExact);
  }

  private cleanup<Result>(
    nodeId: string,
    allowedKinds: ReadonlySet<RetentionNodeKind>,
    cleanupExact: () => Promise<Result>,
  ): Promise<RetentionCleanupResult<Result>> {
    return this.serialize(async () => {
      const plan = await this.projectOwned();
      const node = [...plan.retained, ...plan.deletable].find((candidate) => candidate.id === nodeId);
      if (node === undefined) return { status: "blocked", reason: "unknownNode" };
      if (!allowedKinds.has(node.kind)) return { status: "blocked", reason: "wrongKind" };
      const explanation = deletionBlocker(plan, nodeId);
      if (explanation !== undefined) {
        return { status: "blocked", reason: "retained", explanation };
      }
      return { status: "cleaned", result: await cleanupExact() };
    });
  }

  private async projectOwned(): Promise<RetentionPlan> {
    const durable = await this.source.collect();
    return computeRetentionPlan(mergeRetentionFragments([
      durable,
      ...this.pins.values(),
    ]));
  }

  private publishActiveBuildPinOwned(pin: ActiveBuildRetentionPin): RetentionPinLease {
    const key = activeBuildRetentionNodeId(pin.buildId);
    if (this.pins.has(key)) throw new TypeError("Active build retention pin already exists");
    this.pins.set(key, collectActiveBuildRetention([pin]));
    let released = false;
    return Object.freeze({
      release: async () => {
        if (released) return;
        await this.serialize(async () => {
          if (released) return;
          this.pins.delete(key);
          released = true;
        });
      },
    });
  }

  private serialize<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(() => undefined, () => undefined);
    return result;
  }
}
