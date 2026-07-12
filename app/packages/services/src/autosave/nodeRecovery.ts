import {
  canonicalJsonBytes,
  canonicalRevisionToken,
  fromJson,
  hashBytes,
  isCanonicalUuid,
  isLocalResourceId,
  isWorkspaceId,
  validateDocumentSemantics,
  type CanonicalRevisionToken,
  type CbbDocument,
  type IdPort,
  type LocalResourceId,
  type SchemaCatalog,
  type Sha256Hash,
  type WorkspaceId,
} from "@cbb/core";
import { dirname } from "node:path";
import {
  decodeCanonicalJson,
  type DurableFileSystemPort,
} from "../ports/index.js";
import {
  assertManagedPathHasNoSymlink,
  resolveWorkspacePath,
} from "../workspace/index.js";
import type {
  RecoverySnapshotOutcome,
  RecoverySnapshotPort,
  RecoverySnapshotPruneOutcome,
  RecoverySnapshotPruneRequest,
  RecoverySnapshotRecord,
} from "./types.js";

export const RECOVERY_SNAPSHOT_SCHEMA_ID =
  "https://church-bulletin-builder.local/schema/v1/recovery-snapshot.schema.json";
export const RECOVERY_SNAPSHOT_MAX_BYTES = 50 * 1024 * 1024;
const RECOVERY_ROOT = "transactions/recovery";
const CHECKPOINT_NAME = "checkpoint.json";
const CHECKPOINT_MAX_BYTES = 5 * 1024 * 1024;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const CHECKPOINT_TEMP = /^\.checkpoint-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/u;

export class RecoverySnapshotStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecoverySnapshotStorageError";
  }
}

export interface NodeRecoverySnapshotStoreOptions {
  readonly root: string;
  readonly workspaceId: WorkspaceId;
  readonly fileSystem: DurableFileSystemPort;
  readonly ids: IdPort;
  readonly catalog: SchemaCatalog;
}

export interface RecoverySnapshotCandidate {
  readonly relativePath: string;
  readonly byteHash: Sha256Hash;
  readonly byteSize: number;
  readonly record: RecoverySnapshotRecord;
}

export interface CanonicalRecoveryEvidence {
  readonly document: CbbDocument;
  readonly revisionToken: CanonicalRevisionToken;
}

export interface RecoverySnapshotDiscovery {
  /** Every structurally and semantically valid snapshot, oldest generation first. */
  readonly validSnapshots: readonly RecoverySnapshotCandidate[];
  /** Newer, content-different snapshots offered for explicit user choice only. */
  readonly newerCandidates: readonly RecoverySnapshotCandidate[];
}

export interface RecoverySnapshotCleanupRequest {
  readonly localResourceId: LocalResourceId;
  readonly editGeneration: number;
  readonly expectedByteHash: Sha256Hash;
  readonly disposition: "accepted" | "discarded";
}

export type RecoverySnapshotCleanupResult = "deleted" | "missing" | "changed";

interface CoveredSnapshotIdentity {
  readonly relativePath: string;
  readonly byteHash: Sha256Hash;
}

interface RecoveryRevisionAncestor {
  readonly baseRevisionToken: CanonicalRevisionToken;
  readonly coveredThroughEditGeneration: number;
  readonly coveredSnapshots: readonly CoveredSnapshotIdentity[];
}

interface RecoveryRevisionCheckpoint {
  readonly version: 1;
  readonly kind: "recoveryRevisionCheckpoint";
  readonly workspaceId: WorkspaceId;
  readonly localResourceId: LocalResourceId;
  readonly resourceKind: RecoverySnapshotRecord["resourceKind"];
  readonly currentRevisionToken: CanonicalRevisionToken;
  readonly ancestors: readonly RecoveryRevisionAncestor[];
}

class SerializedSnapshotWriter {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    this.tails.set(key, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}

function decodeJson(bytes: Uint8Array): unknown {
  return decodeCanonicalJson(bytes, {
    maximumDepth: 64,
    maximumStringBytes: 1_048_576,
  });
}

function generationFromFilename(name: string): number | undefined {
  if (!/^[1-9][0-9]*\.json$/u.test(name)) return undefined;
  const generation = Number(name.slice(0, -5));
  return Number.isSafeInteger(generation) && generation > 0 ? generation : undefined;
}

function validateGeneration(generation: number): void {
  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw new RecoverySnapshotStorageError("Recovery snapshot generation is invalid");
  }
}

function equalHash(left: string, right: string): boolean {
  return left === right;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function plainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length && keys.every((key) =>
    typeof key === "string" && expected.includes(key) && Object.hasOwn(value, key)
  );
}

export class NodeRecoverySnapshotStore implements RecoverySnapshotPort {
  private readonly writers = new SerializedSnapshotWriter();

  constructor(private readonly options: NodeRecoverySnapshotStoreOptions) {}

  flush(snapshot: RecoverySnapshotRecord): Promise<RecoverySnapshotOutcome> {
    return this.writers.run(
      snapshot.localResourceId,
      () => this.flushSerialized(snapshot),
    );
  }

  pruneCovered(
    request: RecoverySnapshotPruneRequest,
  ): Promise<RecoverySnapshotPruneOutcome> {
    return this.writers.run(
      request.localResourceId,
      () => this.pruneCoveredSerialized(request),
    );
  }

  async listValidSnapshots(
    localResourceId: LocalResourceId,
  ): Promise<readonly RecoverySnapshotCandidate[]> {
    this.validateLocalId(localResourceId);
    await this.assertRecoveryRootSafe(false);
    const directoryRelative = `${RECOVERY_ROOT}/${localResourceId}`;
    const directoryPath = resolveWorkspacePath(this.options.root, directoryRelative);
    const directoryInfo = await this.options.fileSystem.entryInfo(directoryPath);
    if (directoryInfo === undefined) return [];
    if (directoryInfo.kind !== "directory") {
      throw new RecoverySnapshotStorageError("Recovery snapshot resource path is not a directory");
    }
    await assertManagedPathHasNoSymlink(
      this.options.fileSystem,
      this.options.root,
      directoryRelative,
    );

    const candidates: RecoverySnapshotCandidate[] = [];
    const names = [...await this.options.fileSystem.readDirectory(directoryPath)].sort();
    for (const name of names) {
      if (name === CHECKPOINT_NAME || CHECKPOINT_TEMP.test(name)) continue;
      const generation = generationFromFilename(name);
      if (generation === undefined) {
        throw new RecoverySnapshotStorageError(
          `Recovery snapshot directory contains unrecognized residue: ${name}`,
        );
      }
      const relativePath = `${directoryRelative}/${name}`;
      candidates.push(await this.readCandidate(relativePath, localResourceId, generation));
    }
    candidates.sort((left, right) =>
      left.record.editGeneration - right.record.editGeneration ||
      (left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0)
    );
    return candidates;
  }

  async discoverNewerSnapshots(
    localResourceId: LocalResourceId,
    evidence: CanonicalRecoveryEvidence,
  ): Promise<RecoverySnapshotDiscovery> {
    this.validateEvidence(evidence);
    const validSnapshots = await this.listValidSnapshots(localResourceId);
    if (validSnapshots.some(
      (candidate) => candidate.record.resourceKind !== evidence.document.kind,
    )) {
      throw new RecoverySnapshotStorageError(
        "Canonical document kind does not match the recovery snapshot resource",
      );
    }
    const checkpoint = await this.readCheckpoint(localResourceId);
    const usableCheckpoint = checkpoint?.currentRevisionToken === evidence.revisionToken &&
      checkpoint.resourceKind === evidence.document.kind
      ? checkpoint
      : undefined;
    const ancestors = new Map(
      usableCheckpoint?.ancestors.map((ancestor) => [
        ancestor.baseRevisionToken,
        ancestor,
      ] as const) ?? [],
    );
    const newerCandidates = validSnapshots.filter((candidate) => {
      if (candidate.record.documentHash === evidence.revisionToken) return false;
      const ancestor = ancestors.get(candidate.record.baseRevisionToken);
      if (ancestor?.coveredSnapshots.some((covered) =>
        covered.relativePath === candidate.relativePath &&
        covered.byteHash === candidate.byteHash
      )) return false;
      if (candidate.record.baseRevisionToken === evidence.revisionToken) return true;
      if (usableCheckpoint === undefined) {
        // A save may have become durable just before checkpoint persistence.
        // Preserve data by offering an unclassified, content-different snapshot.
        return true;
      }
      if (ancestor === undefined) return false;
      if (candidate.record.editGeneration > ancestor.coveredThroughEditGeneration) {
        return true;
      }
      return true;
    });
    return { validSnapshots, newerCandidates };
  }

  cleanupExact(
    request: RecoverySnapshotCleanupRequest,
  ): Promise<RecoverySnapshotCleanupResult> {
    return this.writers.run(
      request.localResourceId,
      () => this.cleanupExactSerialized(request),
    );
  }

  private async pruneCoveredSerialized(
    request: RecoverySnapshotPruneRequest,
  ): Promise<RecoverySnapshotPruneOutcome> {
    try {
      this.validatePruneRequest(request);
      await this.assertRecoveryRootSafe(true);
      const resourceRelative = `${RECOVERY_ROOT}/${request.localResourceId}`;
      const resourcePath = resolveWorkspacePath(this.options.root, resourceRelative);
      const resourceInfo = await this.options.fileSystem.entryInfo(resourcePath);
      if (resourceInfo === undefined) {
        await this.options.fileSystem.makeDirectory(resourcePath);
        await this.options.fileSystem.syncDirectory(dirname(resourcePath));
      } else if (resourceInfo.kind !== "directory") {
        throw new RecoverySnapshotStorageError("Recovery resource path is not a directory");
      }
      await assertManagedPathHasNoSymlink(
        this.options.fileSystem,
        this.options.root,
        resourceRelative,
      );
      const candidates = await this.listValidSnapshots(request.localResourceId);
      const existing = await this.readCheckpoint(request.localResourceId);
      if (
        existing !== undefined &&
        existing.currentRevisionToken !== request.previousRevisionToken &&
        existing.currentRevisionToken !== request.savedRevisionToken
      ) {
        throw new RecoverySnapshotStorageError(
          "Recovery checkpoint does not continue the durable revision lineage",
        );
      }

      const ancestors = new Map<string, {
        coveredThroughEditGeneration: number;
        coveredSnapshots: Map<string, CoveredSnapshotIdentity>;
      }>();
      for (const ancestor of existing?.ancestors ?? []) {
        ancestors.set(ancestor.baseRevisionToken, {
          coveredThroughEditGeneration: ancestor.coveredThroughEditGeneration,
          coveredSnapshots: new Map(ancestor.coveredSnapshots.map((snapshot) => [
            snapshot.relativePath,
            snapshot,
          ])),
        });
      }
      const prior = ancestors.get(request.previousRevisionToken);
      ancestors.set(request.previousRevisionToken, {
        coveredThroughEditGeneration: Math.max(
          prior?.coveredThroughEditGeneration ?? 0,
          request.coveredThroughEditGeneration,
        ),
        coveredSnapshots: prior?.coveredSnapshots ?? new Map(),
      });

      const covered: RecoverySnapshotCandidate[] = [];
      for (const candidate of candidates) {
        const priorAncestor = ancestors.get(candidate.record.baseRevisionToken);
        const previouslyCovered = priorAncestor?.coveredSnapshots.get(candidate.relativePath);
        const exactPreviouslyCovered = previouslyCovered?.byteHash === candidate.byteHash;
        const coveredByThisSave =
          candidate.record.documentHash === request.savedRevisionToken ||
          (candidate.record.baseRevisionToken === request.previousRevisionToken &&
            candidate.record.editGeneration <= request.coveredThroughEditGeneration);
        if (!coveredByThisSave && !exactPreviouslyCovered) continue;

        const ancestor = priorAncestor ?? {
          coveredThroughEditGeneration: 0,
          coveredSnapshots: new Map<string, CoveredSnapshotIdentity>(),
        };
        ancestor.coveredSnapshots.set(candidate.relativePath, {
          relativePath: candidate.relativePath,
          byteHash: candidate.byteHash,
        });
        ancestors.set(candidate.record.baseRevisionToken, ancestor);
        covered.push(candidate);
      }

      const checkpoint = this.checkpointFrom(
        request,
        ancestors,
      );
      await this.writeCheckpoint(checkpoint);

      let deletedSnapshots = 0;
      for (const candidate of covered) {
        const result = await this.cleanupExactSerialized({
          localResourceId: request.localResourceId,
          editGeneration: candidate.record.editGeneration,
          expectedByteHash: candidate.byteHash,
          disposition: "accepted",
        });
        if (result === "changed") {
          throw new RecoverySnapshotStorageError(
            "Covered recovery snapshot changed during exact pruning",
          );
        }
        if (result === "deleted") deletedSnapshots++;
      }

      const retained = await this.listValidSnapshots(request.localResourceId);
      const retainedByBase = new Map<string, RecoverySnapshotCandidate[]>();
      for (const candidate of retained) {
        const values = retainedByBase.get(candidate.record.baseRevisionToken) ?? [];
        values.push(candidate);
        retainedByBase.set(candidate.record.baseRevisionToken, values);
      }
      const compact = new Map<string, {
        coveredThroughEditGeneration: number;
        coveredSnapshots: Map<string, CoveredSnapshotIdentity>;
      }>();
      for (const [baseRevisionToken, ancestor] of ancestors) {
        const remaining = retainedByBase.get(baseRevisionToken);
        if (remaining === undefined || remaining.length === 0) continue;
        const remainingByPath = new Map(remaining.map((candidate) => [
          candidate.relativePath,
          candidate,
        ]));
        compact.set(baseRevisionToken, {
          coveredThroughEditGeneration: ancestor.coveredThroughEditGeneration,
          coveredSnapshots: new Map(
            [...ancestor.coveredSnapshots].filter(([path, identity]) =>
              remainingByPath.get(path)?.byteHash === identity.byteHash
            ),
          ),
        });
      }
      await this.writeCheckpoint(this.checkpointFrom(request, compact));
      return {
        status: "pruned",
        deletedSnapshots,
        retainedSnapshots: retained.length,
      };
    } catch (error) {
      return {
        status: "failed",
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async cleanupExactSerialized(
    request: RecoverySnapshotCleanupRequest,
  ): Promise<RecoverySnapshotCleanupResult> {
    this.validateLocalId(request.localResourceId);
    validateGeneration(request.editGeneration);
    await this.assertRecoveryRootSafe(false);
    if (request.disposition !== "accepted" && request.disposition !== "discarded") {
      throw new RecoverySnapshotStorageError("Recovery cleanup disposition is invalid");
    }
    const relativePath = this.snapshotRelativePath(
      request.localResourceId,
      request.editGeneration,
    );
    await assertManagedPathHasNoSymlink(
      this.options.fileSystem,
      this.options.root,
      relativePath,
    );
    const path = resolveWorkspacePath(this.options.root, relativePath);
    const info = await this.options.fileSystem.entryInfo(path);
    if (info === undefined) return "missing";
    if (info.kind !== "file") {
      throw new RecoverySnapshotStorageError("Recovery cleanup target is not a regular file");
    }
    const observed = await this.readBoundedNoFollow(path, info.size);
    if (!equalHash(hashBytes(observed), request.expectedByteHash)) return "changed";

    const cleanupId = this.options.ids.randomUuid();
    if (!isCanonicalUuid(cleanupId)) {
      throw new RecoverySnapshotStorageError("Id port returned an invalid cleanup id");
    }
    const movedRelative =
      `${RECOVERY_ROOT}/${request.localResourceId}/.${request.editGeneration}.cleanup-${cleanupId}.tmp`;
    const movedPath = resolveWorkspacePath(this.options.root, movedRelative);
    if (await this.options.fileSystem.entryInfo(movedPath) !== undefined) {
      throw new RecoverySnapshotStorageError("Recovery cleanup staging path already exists");
    }
    await this.options.fileSystem.replaceFile(path, movedPath);
    await this.options.fileSystem.syncDirectory(dirname(path));
    const movedInfo = await this.options.fileSystem.entryInfo(movedPath);
    if (movedInfo?.kind !== "file") {
      throw new RecoverySnapshotStorageError("Moved recovery cleanup target is invalid");
    }
    const movedBytes = await this.readBoundedNoFollow(movedPath, movedInfo.size);
    if (!equalHash(hashBytes(movedBytes), request.expectedByteHash)) {
      // The selected candidate changed during cleanup. Restore bytes only when
      // the original name is still absent; never overwrite a newly created file.
      try {
        await this.options.fileSystem.writeFileExclusive(path, movedBytes);
        await this.options.fileSystem.syncDirectory(dirname(path));
        await this.options.fileSystem.removeFile(movedPath);
      } catch {
        // Preserve the moved bytes as residue for explicit recovery.
      }
      return "changed";
    }
    try {
      await this.options.fileSystem.removeFile(movedPath);
      await this.options.fileSystem.syncDirectory(dirname(path));
      return "deleted";
    } catch {
      // A failed unlink must not turn pruning into data loss. Restore the exact
      // verified bytes at the canonical name before reporting that cleanup did
      // not complete. A remaining duplicate temp is treated as hostile residue.
      try {
        await this.options.fileSystem.writeFileExclusive(path, movedBytes);
        await this.options.fileSystem.syncDirectory(dirname(path));
        await this.options.fileSystem.removeFile(movedPath);
        await this.options.fileSystem.syncDirectory(dirname(path));
      } catch {
        throw new RecoverySnapshotStorageError(
          "Recovery snapshot cleanup failed and requires read-only recovery",
        );
      }
      return "changed";
    }
  }

  private async flushSerialized(
    snapshot: RecoverySnapshotRecord,
  ): Promise<RecoverySnapshotOutcome> {
    let tempPath: string | undefined;
    try {
      this.validateRecord(snapshot);
      const bytes = canonicalJsonBytes(snapshot);
      if (bytes.byteLength > RECOVERY_SNAPSHOT_MAX_BYTES) {
        throw new RecoverySnapshotStorageError("Recovery snapshot exceeds the 50 MiB cap");
      }
      await this.assertRecoveryRootSafe(true);
      const directoryRelative = `${RECOVERY_ROOT}/${snapshot.localResourceId}`;
      const directoryPath = resolveWorkspacePath(this.options.root, directoryRelative);
      const directoryInfo = await this.options.fileSystem.entryInfo(directoryPath);
      if (directoryInfo === undefined) {
        await this.options.fileSystem.makeDirectory(directoryPath);
        await this.options.fileSystem.syncDirectory(dirname(directoryPath));
      } else if (directoryInfo.kind !== "directory") {
        throw new RecoverySnapshotStorageError("Recovery resource path is not a directory");
      }
      await assertManagedPathHasNoSymlink(
        this.options.fileSystem,
        this.options.root,
        directoryRelative,
      );

      const relativePath = this.snapshotRelativePath(
        snapshot.localResourceId,
        snapshot.editGeneration,
      );
      const targetPath = resolveWorkspacePath(this.options.root, relativePath);
      const existingInfo = await this.options.fileSystem.entryInfo(targetPath);
      if (existingInfo !== undefined) {
        const existing = await this.readCandidate(
          relativePath,
          snapshot.localResourceId,
          snapshot.editGeneration,
        );
        if (canonicalRevisionToken(existing.record) === canonicalRevisionToken(snapshot)) {
          return { status: "saved" };
        }
        throw new RecoverySnapshotStorageError(
          "A different recovery snapshot already owns this edit generation",
        );
      }

      const transactionId = this.options.ids.randomUuid();
      if (!isCanonicalUuid(transactionId)) {
        throw new RecoverySnapshotStorageError("Id port returned an invalid snapshot id");
      }
      const tempRelative =
        `${directoryRelative}/.${snapshot.editGeneration}.${transactionId}.tmp`;
      tempPath = resolveWorkspacePath(this.options.root, tempRelative);
      await this.options.fileSystem.writeFileExclusive(tempPath, bytes);
      const tempInfo = await this.options.fileSystem.entryInfo(tempPath);
      if (tempInfo?.kind !== "file") {
        throw new RecoverySnapshotStorageError("Recovery snapshot staging file is invalid");
      }
      const stagedBytes = await this.readBoundedNoFollow(tempPath, tempInfo.size);
      const staged = this.validateRecord(decodeJson(stagedBytes));
      if (canonicalRevisionToken(staged) !== canonicalRevisionToken(snapshot)) {
        throw new RecoverySnapshotStorageError("Staged recovery snapshot hash mismatch");
      }

      const racedInfo = await this.options.fileSystem.entryInfo(targetPath);
      if (racedInfo !== undefined) {
        const raced = await this.readCandidate(
          relativePath,
          snapshot.localResourceId,
          snapshot.editGeneration,
        );
        await this.options.fileSystem.removeFile(tempPath);
        tempPath = undefined;
        if (canonicalRevisionToken(raced.record) === canonicalRevisionToken(snapshot)) {
          return { status: "saved" };
        }
        throw new RecoverySnapshotStorageError(
          "Recovery snapshot generation changed during staging",
        );
      }
      await this.options.fileSystem.replaceFile(tempPath, targetPath);
      tempPath = undefined;
      await this.options.fileSystem.syncDirectory(directoryPath);
      const durable = await this.readCandidate(
        relativePath,
        snapshot.localResourceId,
        snapshot.editGeneration,
      );
      if (canonicalRevisionToken(durable.record) !== canonicalRevisionToken(snapshot)) {
        throw new RecoverySnapshotStorageError("Durable recovery snapshot hash mismatch");
      }
      return { status: "saved" };
    } catch (error) {
      if (tempPath !== undefined) {
        try { await this.options.fileSystem.removeFile(tempPath); } catch { /* owned temp only */ }
      }
      return {
        status: "failed",
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private validatePruneRequest(request: RecoverySnapshotPruneRequest): void {
    this.validateLocalId(request.localResourceId);
    if (
      request.workspaceId !== this.options.workspaceId ||
      (request.resourceKind !== "bulletin" && request.resourceKind !== "template") ||
      !SHA256.test(request.previousRevisionToken) ||
      !SHA256.test(request.savedRevisionToken) ||
      !Number.isSafeInteger(request.coveredThroughEditGeneration) ||
      request.coveredThroughEditGeneration < 1
    ) {
      throw new RecoverySnapshotStorageError("Canonical recovery-prune evidence is invalid");
    }
  }

  private checkpointFrom(
    request: RecoverySnapshotPruneRequest,
    values: ReadonlyMap<string, {
      readonly coveredThroughEditGeneration: number;
      readonly coveredSnapshots: ReadonlyMap<string, CoveredSnapshotIdentity>;
    }>,
  ): RecoveryRevisionCheckpoint {
    const ancestors = [...values.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([baseRevisionToken, value]) => ({
        baseRevisionToken: baseRevisionToken as CanonicalRevisionToken,
        coveredThroughEditGeneration: value.coveredThroughEditGeneration,
        coveredSnapshots: [...value.coveredSnapshots.values()].sort((left, right) =>
          compareText(left.relativePath, right.relativePath) ||
          compareText(left.byteHash, right.byteHash)
        ),
      }));
    return {
      version: 1,
      kind: "recoveryRevisionCheckpoint",
      workspaceId: request.workspaceId,
      localResourceId: request.localResourceId,
      resourceKind: request.resourceKind,
      currentRevisionToken: request.savedRevisionToken,
      ancestors,
    };
  }

  private async readCheckpoint(
    localResourceId: LocalResourceId,
  ): Promise<RecoveryRevisionCheckpoint | undefined> {
    this.validateLocalId(localResourceId);
    const relativePath = `${RECOVERY_ROOT}/${localResourceId}/${CHECKPOINT_NAME}`;
    await assertManagedPathHasNoSymlink(
      this.options.fileSystem,
      this.options.root,
      relativePath,
    );
    const path = resolveWorkspacePath(this.options.root, relativePath);
    const info = await this.options.fileSystem.entryInfo(path);
    if (info === undefined) return undefined;
    if (
      info.kind !== "file" ||
      !Number.isSafeInteger(info.size) ||
      info.size < 1 ||
      info.size > CHECKPOINT_MAX_BYTES
    ) {
      throw new RecoverySnapshotStorageError("Recovery checkpoint is not a bounded regular file");
    }
    const bytes = await this.options.fileSystem.readFileNoFollow(path, CHECKPOINT_MAX_BYTES);
    if (bytes.byteLength < 1 || bytes.byteLength > CHECKPOINT_MAX_BYTES) {
      throw new RecoverySnapshotStorageError("Recovery checkpoint exceeds its metadata cap");
    }
    return this.validateCheckpoint(decodeJson(bytes), localResourceId);
  }

  private async writeCheckpoint(checkpoint: RecoveryRevisionCheckpoint): Promise<void> {
    const validated = this.validateCheckpoint(checkpoint, checkpoint.localResourceId);
    const bytes = canonicalJsonBytes(validated);
    if (bytes.byteLength > CHECKPOINT_MAX_BYTES) {
      throw new RecoverySnapshotStorageError("Recovery checkpoint exceeds its metadata cap");
    }
    const directoryRelative = `${RECOVERY_ROOT}/${checkpoint.localResourceId}`;
    const directoryPath = resolveWorkspacePath(this.options.root, directoryRelative);
    const directoryInfo = await this.options.fileSystem.entryInfo(directoryPath);
    if (directoryInfo?.kind !== "directory") {
      throw new RecoverySnapshotStorageError("Recovery checkpoint directory is unavailable");
    }
    await assertManagedPathHasNoSymlink(
      this.options.fileSystem,
      this.options.root,
      directoryRelative,
    );
    const checkpointRelative = `${directoryRelative}/${CHECKPOINT_NAME}`;
    const checkpointPath = resolveWorkspacePath(this.options.root, checkpointRelative);
    await assertManagedPathHasNoSymlink(
      this.options.fileSystem,
      this.options.root,
      checkpointRelative,
    );
    const transactionId = this.options.ids.randomUuid();
    if (!isCanonicalUuid(transactionId)) {
      throw new RecoverySnapshotStorageError("Id port returned an invalid checkpoint id");
    }
    const temporaryRelative = `${directoryRelative}/.checkpoint-${transactionId}.tmp`;
    const temporaryPath = resolveWorkspacePath(this.options.root, temporaryRelative);
    if (await this.options.fileSystem.entryInfo(temporaryPath) !== undefined) {
      throw new RecoverySnapshotStorageError("Recovery checkpoint staging path already exists");
    }
    try {
      await this.options.fileSystem.writeFileExclusive(temporaryPath, bytes);
      const temporaryInfo = await this.options.fileSystem.entryInfo(temporaryPath);
      if (temporaryInfo?.kind !== "file" || temporaryInfo.size > CHECKPOINT_MAX_BYTES) {
        throw new RecoverySnapshotStorageError("Staged recovery checkpoint is invalid");
      }
      const stagedBytes = await this.options.fileSystem.readFileNoFollow(
        temporaryPath,
        CHECKPOINT_MAX_BYTES,
      );
      const staged = this.validateCheckpoint(
        decodeJson(stagedBytes),
        checkpoint.localResourceId,
      );
      if (canonicalRevisionToken(staged) !== canonicalRevisionToken(validated)) {
        throw new RecoverySnapshotStorageError("Staged recovery checkpoint hash mismatch");
      }
      await this.options.fileSystem.replaceFile(temporaryPath, checkpointPath);
      await this.options.fileSystem.syncDirectory(directoryPath);
      const durable = await this.readCheckpoint(checkpoint.localResourceId);
      if (
        durable === undefined ||
        canonicalRevisionToken(durable) !== canonicalRevisionToken(validated)
      ) {
        throw new RecoverySnapshotStorageError("Durable recovery checkpoint hash mismatch");
      }
    } catch (error) {
      await this.options.fileSystem.removeFile(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  private validateCheckpoint(
    value: unknown,
    expectedLocalResourceId: LocalResourceId,
  ): RecoveryRevisionCheckpoint {
    if (
      !plainRecord(value) ||
      !hasExactKeys(value, [
        "version",
        "kind",
        "workspaceId",
        "localResourceId",
        "resourceKind",
        "currentRevisionToken",
        "ancestors",
      ]) ||
      value["version"] !== 1 ||
      value["kind"] !== "recoveryRevisionCheckpoint" ||
      value["workspaceId"] !== this.options.workspaceId ||
      value["localResourceId"] !== expectedLocalResourceId ||
      (value["resourceKind"] !== "bulletin" && value["resourceKind"] !== "template") ||
      typeof value["currentRevisionToken"] !== "string" ||
      !SHA256.test(value["currentRevisionToken"]) ||
      !Array.isArray(value["ancestors"]) ||
      value["ancestors"].length > 10_000
    ) {
      throw new RecoverySnapshotStorageError("Recovery checkpoint has an invalid closed shape");
    }
    const ancestors: RecoveryRevisionAncestor[] = [];
    let priorBase = "";
    for (const rawAncestor of value["ancestors"]) {
      if (
        !plainRecord(rawAncestor) ||
        !hasExactKeys(rawAncestor, [
          "baseRevisionToken",
          "coveredThroughEditGeneration",
          "coveredSnapshots",
        ]) ||
        typeof rawAncestor["baseRevisionToken"] !== "string" ||
        !SHA256.test(rawAncestor["baseRevisionToken"]) ||
        rawAncestor["baseRevisionToken"] <= priorBase ||
        !Number.isSafeInteger(rawAncestor["coveredThroughEditGeneration"]) ||
        Number(rawAncestor["coveredThroughEditGeneration"]) < 0 ||
        !Array.isArray(rawAncestor["coveredSnapshots"]) ||
        rawAncestor["coveredSnapshots"].length > 10_000
      ) {
        throw new RecoverySnapshotStorageError("Recovery checkpoint ancestry is invalid");
      }
      priorBase = rawAncestor["baseRevisionToken"];
      const coveredSnapshots: CoveredSnapshotIdentity[] = [];
      let priorPath = "";
      for (const rawSnapshot of rawAncestor["coveredSnapshots"]) {
        if (
          !plainRecord(rawSnapshot) ||
          !hasExactKeys(rawSnapshot, ["relativePath", "byteHash"]) ||
          typeof rawSnapshot["relativePath"] !== "string" ||
          rawSnapshot["relativePath"] <= priorPath ||
          typeof rawSnapshot["byteHash"] !== "string" ||
          !SHA256.test(rawSnapshot["byteHash"])
        ) {
          throw new RecoverySnapshotStorageError("Recovery checkpoint snapshot identity is invalid");
        }
        const prefix = `${RECOVERY_ROOT}/${expectedLocalResourceId}/`;
        if (!rawSnapshot["relativePath"].startsWith(prefix)) {
          throw new RecoverySnapshotStorageError("Recovery checkpoint snapshot path is invalid");
        }
        const generation = generationFromFilename(rawSnapshot["relativePath"].slice(prefix.length));
        if (
          generation === undefined ||
          rawSnapshot["relativePath"] !== this.snapshotRelativePath(
            expectedLocalResourceId,
            generation,
          )
        ) {
          throw new RecoverySnapshotStorageError("Recovery checkpoint snapshot path is invalid");
        }
        priorPath = rawSnapshot["relativePath"];
        coveredSnapshots.push({
          relativePath: rawSnapshot["relativePath"],
          byteHash: rawSnapshot["byteHash"] as Sha256Hash,
        });
      }
      ancestors.push({
        baseRevisionToken: rawAncestor["baseRevisionToken"] as CanonicalRevisionToken,
        coveredThroughEditGeneration: Number(rawAncestor["coveredThroughEditGeneration"]),
        coveredSnapshots,
      });
    }
    return {
      version: 1,
      kind: "recoveryRevisionCheckpoint",
      workspaceId: value["workspaceId"] as WorkspaceId,
      localResourceId: value["localResourceId"] as LocalResourceId,
      resourceKind: value["resourceKind"],
      currentRevisionToken: value["currentRevisionToken"] as CanonicalRevisionToken,
      ancestors,
    };
  }

  private async assertRecoveryRootSafe(create: boolean): Promise<void> {
    if (!isWorkspaceId(this.options.workspaceId)) {
      throw new RecoverySnapshotStorageError("Configured workspace id is invalid");
    }
    const rootInfo = await this.options.fileSystem.entryInfo(this.options.root);
    if (rootInfo?.kind !== "directory") {
      throw new RecoverySnapshotStorageError(
        "Recovery workspace root is missing, invalid, or a symbolic link",
      );
    }
    await assertManagedPathHasNoSymlink(
      this.options.fileSystem,
      this.options.root,
      RECOVERY_ROOT,
    );
    const path = resolveWorkspacePath(this.options.root, RECOVERY_ROOT);
    const info = await this.options.fileSystem.entryInfo(path);
    if (info === undefined && create) {
      await this.options.fileSystem.makeDirectory(path);
      await this.options.fileSystem.syncDirectory(dirname(path));
      return;
    }
    if (info !== undefined && info.kind !== "directory") {
      throw new RecoverySnapshotStorageError("Recovery root is not a directory");
    }
  }

  private async readCandidate(
    relativePath: string,
    expectedLocalId: LocalResourceId,
    expectedGeneration: number,
  ): Promise<RecoverySnapshotCandidate> {
    await assertManagedPathHasNoSymlink(
      this.options.fileSystem,
      this.options.root,
      relativePath,
    );
    const path = resolveWorkspacePath(this.options.root, relativePath);
    const info = await this.options.fileSystem.entryInfo(path);
    if (info?.kind !== "file") {
      throw new RecoverySnapshotStorageError("Recovery snapshot is not a regular file");
    }
    const bytes = await this.readBoundedNoFollow(path, info.size);
    const record = this.validateRecord(decodeJson(bytes));
    if (
      record.localResourceId !== expectedLocalId ||
      record.editGeneration !== expectedGeneration
    ) {
      throw new RecoverySnapshotStorageError(
        "Recovery snapshot identity does not match its fixed storage path",
      );
    }
    return {
      relativePath,
      byteHash: hashBytes(bytes),
      byteSize: bytes.byteLength,
      record,
    };
  }

  private async readBoundedNoFollow(path: string, reportedSize: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(reportedSize) || reportedSize < 0) {
      throw new RecoverySnapshotStorageError("Recovery snapshot has an invalid file size");
    }
    if (reportedSize > RECOVERY_SNAPSHOT_MAX_BYTES) {
      throw new RecoverySnapshotStorageError("Recovery snapshot exceeds the 50 MiB cap");
    }
    const bytes = await this.options.fileSystem.readFileNoFollow(
      path,
      RECOVERY_SNAPSHOT_MAX_BYTES,
    );
    if (bytes.byteLength > RECOVERY_SNAPSHOT_MAX_BYTES) {
      throw new RecoverySnapshotStorageError("Recovery snapshot exceeds the 50 MiB cap");
    }
    return bytes;
  }

  private validateRecord(value: unknown): RecoverySnapshotRecord {
    const structural = this.options.catalog.validateAgainst(
      RECOVERY_SNAPSHOT_SCHEMA_ID,
      value,
    );
    if (!structural.valid) {
      throw new RecoverySnapshotStorageError(
        `Recovery snapshot schema validation failed: ${structural.errors[0]?.message ?? "invalid snapshot"}`,
      );
    }
    const record = value as RecoverySnapshotRecord;
    this.validateLocalId(record.localResourceId);
    validateGeneration(record.editGeneration);
    if (record.workspaceId !== this.options.workspaceId) {
      throw new RecoverySnapshotStorageError("Recovery snapshot belongs to another workspace");
    }
    const document = fromJson(record.document, this.options.catalog);
    const semantic = validateDocumentSemantics(document);
    if (!semantic.valid) {
      throw new RecoverySnapshotStorageError(
        `Recovery document semantic validation failed: ${semantic.findings[0]?.message ?? "invalid document"}`,
      );
    }
    if (document.kind !== record.resourceKind) {
      throw new RecoverySnapshotStorageError("Recovery document kind does not match its record");
    }
    if (canonicalRevisionToken(document) !== record.documentHash) {
      throw new RecoverySnapshotStorageError("Recovery document hash binding is invalid");
    }
    return record;
  }

  private validateEvidence(evidence: CanonicalRecoveryEvidence): void {
    const document = fromJson(evidence.document, this.options.catalog);
    const semantic = validateDocumentSemantics(document);
    if (!semantic.valid) {
      throw new RecoverySnapshotStorageError("Canonical document evidence is semantically invalid");
    }
    if (canonicalRevisionToken(document) !== evidence.revisionToken) {
      throw new RecoverySnapshotStorageError("Canonical revision evidence is hash-mismatched");
    }
  }

  private validateLocalId(localResourceId: LocalResourceId): void {
    if (!isLocalResourceId(localResourceId)) {
      throw new RecoverySnapshotStorageError("Recovery local resource id is invalid");
    }
  }

  private snapshotRelativePath(
    localResourceId: LocalResourceId,
    generation: number,
  ): string {
    this.validateLocalId(localResourceId);
    validateGeneration(generation);
    return `${RECOVERY_ROOT}/${localResourceId}/${generation}.json`;
  }
}
