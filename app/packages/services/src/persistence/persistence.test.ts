import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canonicalStringify,
  createSchemaCatalog,
  parseLocalResourceId,
  type CbbDocument,
  type IdPort,
  type SchemaObject,
} from "@cbb/core";
import {
  createNodeFileSystemPort,
  type ClockPort,
  type DurableFileSystemPort,
  type ProcessIdentityPort,
  type SchedulerPort,
  type ServicePorts,
} from "../ports/index.js";
import {
  WORKSPACE_LOCK_PATH,
  WORKSPACE_LOCK_HEARTBEAT_PATH,
  WORKSPACE_REGISTRY_PATH,
  WorkspaceService,
  type EditableWorkspaceSession,
} from "../workspace/index.js";
import { DocumentPersistenceService } from "./save.js";
import { SaveJournalRecoveryService } from "./recovery.js";

const SCHEMA_NAMES = [
  "common.schema.json",
  "richText.schema.json",
  "rights.schema.json",
  "element.schema.json",
  "customElement.schema.json",
  "document.schema.json",
  "workspace.schema.json",
  "settings.schema.json",
  "workspace-lock.schema.json",
  "save-journal.schema.json",
  "conflict-record.schema.json",
] as const;

function schemaCatalog() {
  const directory = resolve(process.cwd(), "schemas/v1");
  const schemas = new Map<string, SchemaObject>();
  for (const name of SCHEMA_NAMES) {
    const raw = JSON.parse(readFileSync(join(directory, name), "utf8")) as SchemaObject;
    schemas.set(raw.$id, raw);
  }
  return createSchemaCatalog(schemas);
}

function idPort(start = 1): IdPort {
  let next = start;
  return {
    randomUuid() {
      const suffix = (next++).toString(16).padStart(12, "0");
      return `00000000-0000-4000-8000-${suffix}`;
    },
  };
}

class MutableClock implements ClockPort {
  constructor(public value: Date) {}
  now(): Date { return new Date(this.value); }
}

const scheduler: SchedulerPort = {
  setInterval: () => ({ handle: true }),
  clearInterval: () => undefined,
};

function processPort(status: "liveMatch" | "notLive" | "unknown"): ProcessIdentityPort {
  return {
    current: () => ({
      pid: 1234,
      hostUserDiscriminator: `sha256:${"a".repeat(64)}`,
      processStartedAt: "2026-07-12T10:00:00.000Z",
    }),
    check: async () => status,
  };
}

function ports(input: {
  readonly ids?: IdPort;
  readonly clock?: ClockPort;
  readonly fileSystem?: DurableFileSystemPort;
  readonly processStatus?: "liveMatch" | "notLive" | "unknown";
} = {}): ServicePorts {
  return {
    fileSystem: input.fileSystem ?? createNodeFileSystemPort(),
    clock: input.clock ?? new MutableClock(new Date("2026-07-12T12:00:00.000Z")),
    scheduler,
    ids: input.ids ?? idPort(),
    processIdentity: processPort(input.processStatus ?? "liveMatch"),
  };
}

function fixture(): CbbDocument {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), "test/fixtures/full-featured-bulletin.json"), "utf8"),
  ) as CbbDocument;
}

async function createEditable(input?: { clock?: ClockPort; ids?: IdPort }) {
  const rootParent = await mkdtemp(join(tmpdir(), "cbb-services-"));
  const root = join(rootParent, "workspace");
  const servicePorts = ports({
    ...(input?.clock === undefined ? {} : { clock: input.clock }),
    ...(input?.ids === undefined ? {} : { ids: input.ids }),
  });
  const catalog = schemaCatalog();
  const recovery = new SaveJournalRecoveryService(servicePorts, catalog);
  const service = new WorkspaceService(servicePorts, catalog, recovery, "0.0.0-test");
  const result = await service.create({ root, displayName: "Test Church" });
  expect(result.status).toBe("editable");
  return {
    root,
    servicePorts,
    catalog,
    service,
    session: (result as { status: "editable"; session: EditableWorkspaceSession }).session,
  };
}

describe("durable workspace and persistence vertical slice", () => {
  it("creates the closed workspace layout and holds an exclusive live lease", async () => {
    const created = await createEditable();
    expect(JSON.parse(await readFile(join(created.root, WORKSPACE_REGISTRY_PATH), "utf8"))).toMatchObject({
      version: 1,
      kind: "workspace",
      displayName: "Test Church",
    });
    expect(JSON.parse(await readFile(join(created.root, WORKSPACE_LOCK_PATH), "utf8"))).toMatchObject({
      version: 1,
      kind: "workspaceLock",
    });
    const immutableOwner = await readFile(join(created.root, WORKSPACE_LOCK_PATH), "utf8");
    await created.session.lease.heartbeat();
    expect(await readFile(join(created.root, WORKSPACE_LOCK_PATH), "utf8")).toBe(immutableOwner);
    expect(JSON.parse(
      await readFile(join(created.root, WORKSPACE_LOCK_HEARTBEAT_PATH), "utf8"),
    )).toMatchObject({
      instanceId: created.session.lease.record.instanceId,
      kind: "workspaceLock",
    });

    const contender = new WorkspaceService(
      ports({ ids: idPort(100), processStatus: "liveMatch" }),
      created.catalog,
      new SaveJournalRecoveryService(ports({ ids: idPort(200) }), created.catalog),
      "0.0.0-test",
    );
    const second = await contender.open(created.root);
    expect(second.status).toBe("readOnly");
    if (second.status === "readOnly") expect(second.session.reason).toBe("liveLock");
    await created.session.lease.release();
    await expect(readFile(join(created.root, WORKSPACE_LOCK_PATH), "utf8")).rejects.toThrow();
  });
  it("requires an exact user-confirmed observation before replacing a stale lock", async () => {
    const oldClock = new MutableClock(new Date("2026-07-12T12:00:00.000Z"));
    const created = await createEditable({ clock: oldClock });
    const newClock = new MutableClock(new Date("2026-07-12T12:00:31.000Z"));
    const stalePorts = ports({ ids: idPort(100), clock: newClock, processStatus: "notLive" });
    const service = new WorkspaceService(
      stalePorts,
      created.catalog,
      new SaveJournalRecoveryService(stalePorts, created.catalog),
      "0.0.0-test",
    );
    const observed = await service.open(created.root);
    expect(observed.status).toBe("readOnly");
    if (observed.status !== "readOnly" || observed.session.observedLock === undefined) return;
    expect(observed.session.reason).toBe("staleLockNeedsConfirmation");

    const wrong = await service.open(created.root, {
      confirmedStaleLock: { instanceId: observed.session.observedLock.instanceId, heartbeatAt: "2026-01-01T00:00:00.000Z" },
    });
    expect(wrong.status).toBe("readOnly");
    const recovered = await service.open(created.root, {
      confirmedStaleLock: {
        instanceId: observed.session.observedLock.instanceId,
        heartbeatAt: observed.session.observedLock.heartbeatAt,
      },
    });
    expect(recovered.status).toBe("editable");
    if (recovered.status === "editable") await recovered.session.lease.release();
  });

  it("release never deletes a contender that acquires the live lock name", async () => {
    const rootParent = await mkdtemp(join(tmpdir(), "cbb-lock-release-race-"));
    const root = join(rootParent, "workspace");
    const base = createNodeFileSystemPort();
    const contenderId = "80000000-0000-4000-8000-000000000001";
    let injected = false;
    const racing: DurableFileSystemPort = {
      ...base,
      async replaceFile(source, destination) {
        await base.replaceFile(source, destination);
        if (!injected && destination.includes(".workspace.lock.release-")) {
          injected = true;
          const moved = JSON.parse(new TextDecoder().decode(
            await base.readFileNoFollow(destination, 64 * 1024),
          )) as {
            instanceId: string;
          } & Record<string, unknown>;
          await base.writeFileExclusive(
            source,
            new TextEncoder().encode(JSON.stringify({ ...moved, instanceId: contenderId })),
          );
        }
      },
    };
    const servicePorts = ports({ fileSystem: racing });
    const catalog = schemaCatalog();
    const created = await new WorkspaceService(
      servicePorts,
      catalog,
      new SaveJournalRecoveryService(servicePorts, catalog),
      "0.0.0-test",
    ).create({ root });
    expect(created.status).toBe("editable");
    if (created.status !== "editable") return;
    await created.session.lease.release();
    expect(JSON.parse(await readFile(join(root, WORKSPACE_LOCK_PATH), "utf8"))).toMatchObject({
      instanceId: contenderId,
    });
  });

  it("does not acquire an empty live lock name while transition evidence remains", async () => {
    const created = await createEditable();
    const owner = JSON.parse(
      await readFile(join(created.root, WORKSPACE_LOCK_PATH), "utf8"),
    ) as { instanceId: string };
    const recoveryName = `.workspace.lock.recovery-${owner.instanceId}`;
    await created.servicePorts.fileSystem.replaceFile(
      join(created.root, WORKSPACE_LOCK_PATH),
      join(created.root, recoveryName),
    );
    await created.servicePorts.fileSystem.syncDirectory(created.root);

    const contenderPorts = ports({ ids: idPort(850), processStatus: "notLive" });
    const opened = await new WorkspaceService(
      contenderPorts,
      created.catalog,
      new SaveJournalRecoveryService(contenderPorts, created.catalog),
      "0.0.0-test",
    ).open(created.root);
    expect(opened.status).toBe("readOnly");
    if (opened.status === "readOnly") expect(opened.session.reason).toBe("uncertainLock");
    await expect(readFile(join(created.root, WORKSPACE_LOCK_PATH), "utf8")).rejects.toThrow();
    expect(await readFile(join(created.root, recoveryName), "utf8")).toContain(owner.instanceId);
  });

  it("rechecks transition evidence after observing an empty live lock name", async () => {
    const created = await createEditable();
    await created.session.lease.release();
    const base = created.servicePorts.fileSystem;
    const recoveryName =
      ".workspace.lock.recovery-81000000-0000-4000-8000-000000000001";
    let lockInfoReads = 0;
    const racing: DurableFileSystemPort = {
      ...base,
      async entryInfo(path) {
        const info = await base.entryInfo(path);
        if (path.endsWith(WORKSPACE_LOCK_PATH) && ++lockInfoReads === 2 && info === undefined) {
          await base.writeFileExclusive(
            join(created.root, recoveryName),
            new TextEncoder().encode("preserved transition evidence"),
          );
        }
        return info;
      },
    };
    const contenderPorts = ports({ fileSystem: racing, ids: idPort(875), processStatus: "notLive" });
    const opened = await new WorkspaceService(
      contenderPorts,
      created.catalog,
      new SaveJournalRecoveryService(contenderPorts, created.catalog),
      "0.0.0-test",
    ).open(created.root);
    expect(opened.status).toBe("readOnly");
    if (opened.status === "readOnly") expect(opened.session.reason).toBe("uncertainLock");
    await expect(readFile(join(created.root, WORKSPACE_LOCK_PATH), "utf8")).rejects.toThrow();
  });

  it("journal-saves a new bulletin and atomically advances registry metadata", async () => {
    const created = await createEditable();
    const persistence = new DocumentPersistenceService(created.servicePorts, created.catalog);
    const localId = parseLocalResourceId("10000000-0000-4000-8000-000000000001");
    const document = fixture();
    const saved = await persistence.save({
      session: created.session,
      resourceKind: "bulletin",
      localResourceId: localId,
      displayName: "Sunday Bulletin",
      document,
      baseDocument: null,
      baseRevisionToken: null,
    });
    expect(saved.status).toBe("saved");
    if (saved.status !== "saved") return;
    const disk = JSON.parse(
      await readFile(join(created.root, "bulletins", localId, "document.json"), "utf8"),
    );
    expect(canonicalStringify(disk)).toBe(canonicalStringify(document));
    expect(saved.registry.bulletins?.[0]).toMatchObject({
      localId,
      contentHash: saved.revisionToken,
      storagePath: `bulletins/${localId}/document.json`,
    });
    expect(readdirSync(join(created.root, "transactions", "save"))).toEqual([]);
    await created.session.lease.release();
  });

  it("captures base, disk, and ours without overwriting an external edit", async () => {
    const created = await createEditable();
    const persistence = new DocumentPersistenceService(created.servicePorts, created.catalog);
    const localId = parseLocalResourceId("10000000-0000-4000-8000-000000000002");
    const base = fixture();
    const first = await persistence.save({
      session: created.session,
      resourceKind: "bulletin",
      localResourceId: localId,
      displayName: "Sunday Bulletin",
      document: base,
      baseDocument: null,
      baseRevisionToken: null,
    });
    expect(first.status).toBe("saved");
    if (first.status !== "saved") return;
    const external = { ...base, name: "External version" };
    const path = join(created.root, "bulletins", localId, "document.json");
    await writeFile(path, canonicalStringify(external), "utf8");
    const ours = { ...base, name: "Our version" };
    const result = await persistence.save({
      session: created.session,
      resourceKind: "bulletin",
      localResourceId: localId,
      displayName: "Sunday Bulletin",
      document: ours,
      baseDocument: base,
      baseRevisionToken: first.revisionToken,
    });
    expect(result.status).toBe("conflicted");
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ name: "External version" });
    if (result.status === "conflicted") {
      const conflict = join(created.root, result.conflictPath);
      expect(JSON.parse(await readFile(join(conflict, "base.json"), "utf8"))).toMatchObject({ name: base.name });
      expect(JSON.parse(await readFile(join(conflict, "disk.json"), "utf8"))).toMatchObject({ name: "External version" });
      expect(JSON.parse(await readFile(join(conflict, "ours.json"), "utf8"))).toMatchObject({ name: "Our version" });
      expect(JSON.parse(await readFile(join(conflict, "conflict.json"), "utf8"))).toMatchObject({ kind: "documentConflict" });
    }
    await created.session.lease.release();
  });

  it("completes an interrupted document-replaced/registry-old save on startup", async () => {
    const created = await createEditable();
    const baseFs = created.servicePorts.fileSystem;
    let failRegistryReplace = true;
    const faultFs: DurableFileSystemPort = {
      ...baseFs,
      async replaceFile(source, destination) {
        if (failRegistryReplace && destination.endsWith(WORKSPACE_REGISTRY_PATH)) {
          failRegistryReplace = false;
          throw new Error("injected registry replace failure");
        }
        await baseFs.replaceFile(source, destination);
      },
    };
    const faultPorts = ports({ fileSystem: faultFs, ids: idPort(300) });
    const persistence = new DocumentPersistenceService(faultPorts, created.catalog);
    const localId = parseLocalResourceId("10000000-0000-4000-8000-000000000003");
    const result = await persistence.save({
      session: created.session,
      resourceKind: "bulletin",
      localResourceId: localId,
      displayName: "Interrupted Save",
      document: fixture(),
      baseDocument: null,
      baseRevisionToken: null,
    });
    expect(result.status).toBe("recoveryRequired");
    const before = JSON.parse(await readFile(join(created.root, WORKSPACE_REGISTRY_PATH), "utf8"));
    expect(before.bulletins).toEqual([]);
    await created.session.lease.release();

    const recoveryPorts = ports({ ids: idPort(400), processStatus: "notLive" });
    const service = new WorkspaceService(
      recoveryPorts,
      created.catalog,
      new SaveJournalRecoveryService(recoveryPorts, created.catalog),
      "0.0.0-test",
    );
    const reopened = await service.open(created.root);
    expect(reopened.status).toBe("editable");
    if (reopened.status === "editable") {
      expect(reopened.session.registry.bulletins?.[0]?.localId).toBe(localId);
      expect(readdirSync(join(created.root, "transactions", "save"))).toEqual([]);
      await reopened.session.lease.release();
    }
  });

  it("preserves recovery evidence when directory fsync fails after document rename", async () => {
    const created = await createEditable();
    const baseFs = created.servicePorts.fileSystem;
    const localId = parseLocalResourceId("10000000-0000-4000-8000-000000000013");
    let failDocumentDirectorySync = true;
    const faultFs: DurableFileSystemPort = {
      ...baseFs,
      async syncDirectory(path) {
        if (failDocumentDirectorySync && path.endsWith(`/bulletins/${localId}`)) {
          failDocumentDirectorySync = false;
          throw new Error("injected post-rename fsync failure");
        }
        await baseFs.syncDirectory(path);
      },
    };
    const faultPorts = ports({ fileSystem: faultFs, ids: idPort(430) });
    const interrupted = await new DocumentPersistenceService(faultPorts, created.catalog).save({
      session: created.session,
      resourceKind: "bulletin",
      localResourceId: localId,
      displayName: "Post Rename Failure",
      document: fixture(),
      baseDocument: null,
      baseRevisionToken: null,
    });
    expect(interrupted.status).toBe("recoveryRequired");
    expect(readdirSync(join(created.root, "transactions", "save"))).toHaveLength(1);
    expect(JSON.parse(
      await readFile(join(created.root, "bulletins", localId, "document.json"), "utf8"),
    )).toMatchObject({ kind: "bulletin" });
    await created.session.lease.release();

    const recoveryPorts = ports({ ids: idPort(440), processStatus: "notLive" });
    const reopened = await new WorkspaceService(
      recoveryPorts,
      created.catalog,
      new SaveJournalRecoveryService(recoveryPorts, created.catalog),
      "0.0.0-test",
    ).open(created.root);
    expect(reopened.status).toBe("editable");
    if (reopened.status === "editable") {
      expect(reopened.session.registry.bulletins?.[0]?.localId).toBe(localId);
      await reopened.session.lease.release();
    }
  });

  it("cleans an owned prepared journal so a failed pre-replacement save can retry", async () => {
    const created = await createEditable();
    const baseFs = created.servicePorts.fileSystem;
    const faultFs: DurableFileSystemPort = {
      ...baseFs,
      async replaceFile(source, destination) {
        if (destination.endsWith("/document.json")) {
          throw new Error("injected failure at /home/private/church/document.json");
        }
        await baseFs.replaceFile(source, destination);
      },
    };
    const faultPorts = ports({ fileSystem: faultFs, ids: idPort(450) });
    const localId = parseLocalResourceId("10000000-0000-4000-8000-000000000005");
    const interrupted = await new DocumentPersistenceService(faultPorts, created.catalog).save({
      session: created.session,
      resourceKind: "bulletin",
      localResourceId: localId,
      displayName: "Prepared Save",
      document: fixture(),
      baseDocument: null,
      baseRevisionToken: null,
    });
    expect(interrupted.status).toBe("failed");
    if (interrupted.status === "failed") {
      expect(interrupted.diagnostics[0]?.technicalDetail).toContain("<redacted-path>");
      expect(interrupted.diagnostics[0]?.technicalDetail).not.toContain("/home/private");
    }
    expect(readdirSync(join(created.root, "transactions", "save"))).toEqual([]);
    const retried = await new DocumentPersistenceService(
      created.servicePorts,
      created.catalog,
    ).save({
      session: created.session,
      resourceKind: "bulletin",
      localResourceId: localId,
      displayName: "Prepared Save",
      document: fixture(),
      baseDocument: null,
      baseRevisionToken: null,
    });
    expect(retried.status).toBe("saved");
    await created.session.lease.release();
  });

  it("rolls registry metadata back when recovery finds the old authoritative document", async () => {
    const created = await createEditable();
    const localId = parseLocalResourceId("10000000-0000-4000-8000-000000000006");
    const base = fixture();
    const first = await new DocumentPersistenceService(created.servicePorts, created.catalog).save({
      session: created.session,
      resourceKind: "bulletin",
      localResourceId: localId,
      displayName: "Rollback Save",
      document: base,
      baseDocument: null,
      baseRevisionToken: null,
    });
    expect(first.status).toBe("saved");
    if (first.status !== "saved") return;

    const baseFs = created.servicePorts.fileSystem;
    let registryWasReplaced = false;
    const faultFs: DurableFileSystemPort = {
      ...baseFs,
      async replaceFile(source, destination) {
        if (
          registryWasReplaced &&
          destination.includes("/transactions/save/") &&
          destination.endsWith(".json")
        ) {
          throw new Error("injected final journal update failure");
        }
        await baseFs.replaceFile(source, destination);
        if (destination.endsWith(WORKSPACE_REGISTRY_PATH)) registryWasReplaced = true;
      },
    };
    const updated = { ...base, name: "Updated before rollback" };
    const interrupted = await new DocumentPersistenceService(
      ports({ fileSystem: faultFs, ids: idPort(470) }),
      created.catalog,
    ).save({
      session: created.session,
      resourceKind: "bulletin",
      localResourceId: localId,
      displayName: "Rollback Save",
      document: updated,
      baseDocument: base,
      baseRevisionToken: first.revisionToken,
    });
    expect(interrupted.status).toBe("recoveryRequired");
    // Simulate storage presenting the recorded old document while registry has
    // already advanced. Recovery must trust the document and roll metadata back.
    await writeFile(
      join(created.root, "bulletins", localId, "document.json"),
      canonicalStringify(base),
      "utf8",
    );
    await created.session.lease.release();

    const recoveryPorts = ports({ ids: idPort(480), processStatus: "notLive" });
    const reopened = await new WorkspaceService(
      recoveryPorts,
      created.catalog,
      new SaveJournalRecoveryService(recoveryPorts, created.catalog),
      "0.0.0-test",
    ).open(created.root);
    expect(reopened.status).toBe("editable");
    if (reopened.status === "editable") {
      expect(reopened.session.registry.bulletins?.[0]?.contentHash).toBe(first.revisionToken);
      await reopened.session.lease.release();
    }
  });

  it("opens read-only when an interrupted save has a third document hash", async () => {
    const created = await createEditable();
    const baseFs = created.servicePorts.fileSystem;
    const faultFs: DurableFileSystemPort = {
      ...baseFs,
      async replaceFile(source, destination) {
        if (destination.endsWith(WORKSPACE_REGISTRY_PATH)) {
          throw new Error("injected registry replace failure");
        }
        await baseFs.replaceFile(source, destination);
      },
    };
    const faultPorts = ports({ fileSystem: faultFs, ids: idPort(500) });
    const localId = parseLocalResourceId("10000000-0000-4000-8000-000000000004");
    const interrupted = await new DocumentPersistenceService(faultPorts, created.catalog).save({
      session: created.session,
      resourceKind: "bulletin",
      localResourceId: localId,
      displayName: "Interrupted Save",
      document: fixture(),
      baseDocument: null,
      baseRevisionToken: null,
    });
    expect(interrupted.status).toBe("recoveryRequired");
    const third = { ...fixture(), name: "Unrecorded third version" };
    await writeFile(
      join(created.root, "bulletins", localId, "document.json"),
      canonicalStringify(third),
      "utf8",
    );
    await created.session.lease.release();
    const recoveryPorts = ports({ ids: idPort(600), processStatus: "notLive" });
    const reopened = await new WorkspaceService(
      recoveryPorts,
      created.catalog,
      new SaveJournalRecoveryService(recoveryPorts, created.catalog),
      "0.0.0-test",
    ).open(created.root);
    expect(reopened.status).toBe("readOnly");
    if (reopened.status === "readOnly") expect(reopened.session.reason).toBe("ambiguousRecovery");
  });

  it("rejects unknown properties in every new persisted service root", () => {
    const catalog = schemaCatalog();
    for (const [schema, value] of [
      ["workspace-lock.schema.json", {
        version: 1, kind: "workspaceLock", workspaceId: "00000000-0000-4000-8000-000000000001",
        instanceId: "00000000-0000-4000-8000-000000000002", pid: 1,
        hostUserDiscriminator: `sha256:${"a".repeat(64)}`, appVersion: "1",
        processStartedAt: "2026-07-12T00:00:00.000Z", acquiredAt: "2026-07-12T00:00:00.000Z",
        heartbeatAt: "2026-07-12T00:00:00.000Z", unexpected: true,
      }],
      ["conflict-record.schema.json", {
        version: 1, kind: "documentConflict", conflictId: "00000000-0000-4000-8000-000000000002",
        workspaceId: "00000000-0000-4000-8000-000000000001",
        localResourceId: "00000000-0000-4000-8000-000000000003", resourceKind: "bulletin",
        createdAt: "2026-07-12T00:00:00.000Z", baseHash: null, diskHash: null,
        oursHash: `sha256:${"b".repeat(64)}`, diskValidation: "missing", unexpected: true,
      }],
    ] as const) {
      const id = `https://church-bulletin-builder.local/schema/v1/${schema}`;
      expect(catalog.validateAgainst(id, value).valid).toBe(false);
    }
  });
});
  it("releases an acquired lease when startup recovery throws", async () => {
    const created = await createEditable();
    await created.session.lease.release();

    const faultPorts = ports({ ids: idPort(700), processStatus: "liveMatch" });
    const failed = await new WorkspaceService(
      faultPorts,
      created.catalog,
      { async recover() { throw new Error("injected startup recovery failure"); } },
      "0.0.0-test",
    ).open(created.root);
    expect(failed.status).toBe("failed");

    const reopenPorts = ports({ ids: idPort(800), processStatus: "liveMatch" });
    const reopened = await new WorkspaceService(
      reopenPorts,
      created.catalog,
      new SaveJournalRecoveryService(reopenPorts, created.catalog),
      "0.0.0-test",
    ).open(created.root);
    expect(reopened.status).toBe("editable");
    if (reopened.status === "editable") await reopened.session.lease.release();
  });
