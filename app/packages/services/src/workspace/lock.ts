import { canonicalJsonBytes, isCanonicalUuid, type SchemaCatalog } from "@cbb/core";
import { dirname } from "node:path";
import type { ServicePorts } from "../ports/index.js";
import { decodeCanonicalJson } from "../ports/index.js";
import {
  WORKSPACE_LOCK_PATH,
  WORKSPACE_LOCK_HEARTBEAT_PATH,
  assertManagedPathHasNoSymlink,
  resolveWorkspacePath,
} from "./paths.js";
import type {
  ConfirmedStaleLock,
  WorkspaceLease,
  WorkspaceLockRecord,
  WorkspaceReadOnlyReason,
  WorkspaceRegistry,
} from "./types.js";

export const WORKSPACE_LOCK_SCHEMA_ID =
  "https://church-bulletin-builder.local/schema/v1/workspace-lock.schema.json";
const HEARTBEAT_INTERVAL_MS = 5_000;
const STALE_AFTER_MS = 30_000;
const MAX_LOCK_BYTES = 64 * 1024;
const LOCK_TRANSITION_RESIDUE = /^\.workspace\.lock\.(?:release|recovery)-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

type LockDecision =
  | { readonly status: "acquired"; readonly lease: WorkspaceLease }
  | {
      readonly status: "readOnly";
      readonly reason: WorkspaceReadOnlyReason;
      readonly observedLock?: WorkspaceLockRecord;
      readonly detail: string;
    };

function parseJson(bytes: Uint8Array): unknown {
  return decodeCanonicalJson(bytes, { maximumDepth: 32, maximumStringBytes: 4_096 });
}

function parseLock(bytes: Uint8Array, catalog: SchemaCatalog): WorkspaceLockRecord {
  const value = parseJson(bytes);
  const validation = catalog.validateAgainst(WORKSPACE_LOCK_SCHEMA_ID, value);
  if (!validation.valid) throw new Error("Workspace lock has an invalid persisted shape");
  const lock = value as WorkspaceLockRecord;
  if (!isCanonicalUuid(lock.instanceId)) throw new Error("Workspace lock instance id is invalid");
  return lock;
}

function sameObservation(lock: WorkspaceLockRecord, confirmation: ConfirmedStaleLock): boolean {
  return lock.instanceId === confirmation.instanceId &&
    lock.heartbeatAt === confirmation.heartbeatAt;
}

function sameOwner(left: WorkspaceLockRecord, right: WorkspaceLockRecord): boolean {
  return left.workspaceId === right.workspaceId &&
    left.instanceId === right.instanceId &&
    left.pid === right.pid &&
    left.hostUserDiscriminator === right.hostUserDiscriminator &&
    left.appVersion === right.appVersion &&
    left.processStartedAt === right.processStartedAt &&
    left.acquiredAt === right.acquiredAt;
}

async function readLockFile(
  path: string,
  ports: ServicePorts,
  catalog: SchemaCatalog,
): Promise<{ readonly bytes: Uint8Array; readonly record: WorkspaceLockRecord }> {
  const bytes = await ports.fileSystem.readFileNoFollow(path, MAX_LOCK_BYTES);
  return { bytes, record: parseLock(bytes, catalog) };
}

async function readObservedLock(
  root: string,
  ports: ServicePorts,
  catalog: SchemaCatalog,
): Promise<WorkspaceLockRecord> {
  const lockPath = resolveWorkspacePath(root, WORKSPACE_LOCK_PATH);
  const owner = (await readLockFile(lockPath, ports, catalog)).record;
  const heartbeatPath = resolveWorkspacePath(root, WORKSPACE_LOCK_HEARTBEAT_PATH);
  try {
    const heartbeat = (await readLockFile(heartbeatPath, ports, catalog)).record;
    return sameOwner(owner, heartbeat) ? heartbeat : owner;
  } catch {
    // A heartbeat is an optional atomic freshness hint. A malformed, missing,
    // or previous-owner sidecar can never invalidate the immutable owner lock.
    return owner;
  }
}

async function hasLockTransitionResidue(root: string, ports: ServicePorts): Promise<boolean> {
  const names = await ports.fileSystem.readDirectory(root);
  return names.some((name) => LOCK_TRANSITION_RESIDUE.test(name));
}

function makeLease(
  root: string,
  initial: WorkspaceLockRecord,
  ports: ServicePorts,
  catalog: SchemaCatalog,
): WorkspaceLease {
  let current = initial;
  let released = false;
  let lostError: Error | undefined;
  let heartbeatTail: Promise<void> = Promise.resolve();
  const lockPath = resolveWorkspacePath(root, WORKSPACE_LOCK_PATH);
  const heartbeatPath = resolveWorkspacePath(root, WORKSPACE_LOCK_HEARTBEAT_PATH);

  const performHeartbeat = async (): Promise<void> => {
    if (released) throw new Error("Workspace lease has been released");
    if (lostError !== undefined) throw lostError;
    const observed = (await readLockFile(lockPath, ports, catalog)).record;
    if (!sameOwner(observed, current)) {
      lostError = new Error("Workspace lease ownership changed");
      throw lostError;
    }
    const updated = { ...current, heartbeatAt: ports.clock.now().toISOString() };
    const heartbeatId = ports.ids.randomUuid();
    if (!isCanonicalUuid(heartbeatId)) throw new Error("Id port returned an invalid heartbeat id");
    const tempPath = resolveWorkspacePath(
      root,
      `.workspace.lock.heartbeat-${current.instanceId}-${heartbeatId}.tmp`,
    );
    await ports.fileSystem.writeFileExclusive(tempPath, canonicalJsonBytes(updated));
    try {
      const latest = (await readLockFile(lockPath, ports, catalog)).record;
      if (!sameOwner(latest, current)) {
        lostError = new Error("Workspace lease changed during heartbeat");
        throw lostError;
      }
      await ports.fileSystem.replaceFile(tempPath, heartbeatPath);
      await ports.fileSystem.syncDirectory(dirname(lockPath));
    } catch (error) {
      await ports.fileSystem.removeFile(tempPath).catch(() => undefined);
      throw error;
    }
    current = updated;
  };

  const heartbeat = (): Promise<void> => {
    if (released) return Promise.reject(new Error("Workspace lease has been released"));
    const scheduled = heartbeatTail.then(performHeartbeat);
    heartbeatTail = scheduled.catch(() => undefined);
    return scheduled;
  };

  const timer = ports.scheduler.setInterval(() => {
    void heartbeat().catch((error: unknown) => {
      lostError = error instanceof Error ? error : new Error(String(error));
    });
  }, HEARTBEAT_INTERVAL_MS);

  return {
    record: initial,
    heartbeat,
    async release() {
      if (released) return;
      released = true;
      ports.scheduler.clearInterval(timer);
      await heartbeatTail.catch(() => undefined);
      try {
        const releasePath = resolveWorkspacePath(
          root,
          `.workspace.lock.release-${current.instanceId}`,
        );
        if (await ports.fileSystem.entryInfo(releasePath) !== undefined) return;
        await ports.fileSystem.replaceFile(lockPath, releasePath);
        await ports.fileSystem.syncDirectory(dirname(lockPath));
        const moved = await readLockFile(releasePath, ports, catalog);
        if (sameOwner(moved.record, current)) {
          await ports.fileSystem.removeFile(releasePath);
          await ports.fileSystem.syncDirectory(dirname(lockPath));
        } else {
          // The atomic move captured somebody else's lock. Restore only into an
          // empty live name; never delete or overwrite a later contender.
          await ports.fileSystem.writeFileExclusive(lockPath, moved.bytes);
          await ports.fileSystem.syncDirectory(dirname(lockPath));
          await ports.fileSystem.removeFile(releasePath);
        }
      } catch {
        // Release is idempotent. Ambiguous evidence is preserved and a
        // missing/replaced/invalid live lock is never unlinked by name.
      }
    },
  };
}

async function createLease(
  root: string,
  registry: WorkspaceRegistry,
  appVersion: string,
  ports: ServicePorts,
  catalog: SchemaCatalog,
): Promise<WorkspaceLease> {
  const now = ports.clock.now().toISOString();
  const processIdentity = ports.processIdentity.current();
  const instanceId = ports.ids.randomUuid();
  if (!isCanonicalUuid(instanceId)) throw new Error("Id port returned an invalid instance id");
  const record: WorkspaceLockRecord = {
    version: 1,
    kind: "workspaceLock",
    workspaceId: registry.workspaceId,
    instanceId,
    pid: processIdentity.pid,
    hostUserDiscriminator: processIdentity.hostUserDiscriminator,
    appVersion,
    processStartedAt: processIdentity.processStartedAt,
    acquiredAt: now,
    heartbeatAt: now,
  };
  const validation = catalog.validateAgainst(WORKSPACE_LOCK_SCHEMA_ID, record);
  if (!validation.valid) throw new Error("Generated workspace lock failed schema validation");
  const path = resolveWorkspacePath(root, WORKSPACE_LOCK_PATH);
  await ports.fileSystem.writeFileExclusive(path, canonicalJsonBytes(record));
  await ports.fileSystem.syncDirectory(dirname(path));
  return makeLease(root, record, ports, catalog);
}

export async function acquireWorkspaceLease(
  root: string,
  registry: WorkspaceRegistry,
  appVersion: string,
  ports: ServicePorts,
  catalog: SchemaCatalog,
  confirmation?: ConfirmedStaleLock,
): Promise<LockDecision> {
  await assertManagedPathHasNoSymlink(ports.fileSystem, root, WORKSPACE_LOCK_PATH);
  if (await hasLockTransitionResidue(root, ports)) {
    return {
      status: "readOnly",
      reason: "uncertainLock",
      detail: "An interrupted lock transition requires inspection before editing",
    };
  }
  const lockPath = resolveWorkspacePath(root, WORKSPACE_LOCK_PATH);
  const info = await ports.fileSystem.entryInfo(lockPath);
  if (info === undefined) {
    // The live name can be momentarily absent only while an owner is being
    // atomically moved to a transition residue. Recheck after observing the
    // absence so a contender that passed the earlier check cannot acquire in
    // that window.
    if (await hasLockTransitionResidue(root, ports)) {
      return {
        status: "readOnly",
        reason: "uncertainLock",
        detail: "A lock transition is in progress; editing remains disabled",
      };
    }
    try {
      return { status: "acquired", lease: await createLease(root, registry, appVersion, ports, catalog) };
    } catch {
      // Another instance may have won the exclusive-create race; inspect it.
    }
  } else if (info.kind !== "file") {
    return { status: "readOnly", reason: "uncertainLock", detail: "Workspace lock is not a regular file" };
  }

  let observed: WorkspaceLockRecord;
  try {
    observed = await readObservedLock(root, ports, catalog);
  } catch {
    return { status: "readOnly", reason: "uncertainLock", detail: "Workspace lock cannot be validated" };
  }
  if (observed.workspaceId !== registry.workspaceId) {
    return {
      status: "readOnly",
      reason: "uncertainLock",
      observedLock: observed,
      detail: "Workspace lock belongs to a different workspace identity",
    };
  }

  const heartbeatTime = Date.parse(observed.heartbeatAt);
  const age = ports.clock.now().getTime() - heartbeatTime;
  const identity = await ports.processIdentity.check({
    instanceId: observed.instanceId,
    pid: observed.pid,
    hostUserDiscriminator: observed.hostUserDiscriminator,
    processStartedAt: observed.processStartedAt,
  });
  if (identity === "liveMatch" || age <= STALE_AFTER_MS) {
    return { status: "readOnly", reason: "liveLock", observedLock: observed, detail: "Another live instance holds the workspace lock" };
  }
  if (identity === "unknown" || !Number.isFinite(age) || age < 0) {
    return { status: "readOnly", reason: "uncertainLock", observedLock: observed, detail: "The workspace lock cannot be proven stale" };
  }
  if (confirmation === undefined || !sameObservation(observed, confirmation)) {
    return {
      status: "readOnly",
      reason: "staleLockNeedsConfirmation",
      observedLock: observed,
      detail: "A stale lock candidate requires explicit confirmation",
    };
  }

  // Atomically move the observed lock out of the live lock name before taking
  // ownership. A concurrent heartbeat can then update only the moved inode and
  // can never overwrite the newly acquired lock.
  const recoveryPath = resolveWorkspacePath(
    root,
    `.workspace.lock.recovery-${confirmation.instanceId}`,
  );
  if (await ports.fileSystem.entryInfo(recoveryPath) !== undefined) {
    return { status: "readOnly", reason: "uncertainLock", observedLock: observed, detail: "A previous stale-lock recovery needs inspection" };
  }
  if (!await ports.fileSystem.moveFileNoReplace(lockPath, recoveryPath)) {
    return {
      status: "readOnly",
      reason: "uncertainLock",
      observedLock: observed,
      detail: "The stale-lock claim changed before it could be acquired",
    };
  }
  await ports.fileSystem.syncDirectory(dirname(lockPath));
  const moved = await readLockFile(recoveryPath, ports, catalog);
  let latest = moved.record;
  try {
    const heartbeat = await readObservedLock(root, ports, catalog);
    if (sameOwner(moved.record, heartbeat)) latest = heartbeat;
  } catch {
    // The live owner name was moved. Read the atomic heartbeat sidecar directly.
    try {
      const heartbeat = (await readLockFile(
        resolveWorkspacePath(root, WORKSPACE_LOCK_HEARTBEAT_PATH),
        ports,
        catalog,
      )).record;
      if (sameOwner(moved.record, heartbeat)) latest = heartbeat;
    } catch { /* immutable owner observation remains authoritative */ }
  }
  if (!sameOwner(moved.record, observed) || !sameObservation(latest, confirmation)) {
    try {
      await ports.fileSystem.writeFileExclusive(lockPath, moved.bytes);
      await ports.fileSystem.syncDirectory(dirname(lockPath));
      await ports.fileSystem.removeFile(recoveryPath);
    } catch {
      // Never overwrite a lock acquired by another contender while restoring.
    }
    return { status: "readOnly", reason: "uncertainLock", observedLock: latest, detail: "Workspace lock changed after confirmation" };
  }
  try {
    const acquired = await createLease(root, registry, appVersion, ports, catalog);
    try {
      await ports.fileSystem.removeFile(recoveryPath);
      await ports.fileSystem.syncDirectory(dirname(lockPath));
      return { status: "acquired", lease: acquired };
    } catch {
      await acquired.release().catch(() => undefined);
      return {
        status: "readOnly",
        reason: "uncertainLock",
        detail: "The stale-lock claim could not be finalized safely",
      };
    }
  } catch {
    return { status: "readOnly", reason: "uncertainLock", detail: "Another instance acquired the workspace during stale-lock recovery" };
  }
}
