import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createSchemaCatalog,
  fromJson,
  hashBytes,
  parseLocalResourceId,
  type IdPort,
  type SchemaObject,
} from "@cbb/core";
import {
  MULTI_TRANSACTION_JOURNAL_DIRECTORY,
  assetCanonicalResourceKey,
  canonicalDocumentPath,
  createNodeArtifactStoragePort,
  createNodeFileSystemPort,
  transactionRetentionNodeId,
  type AutosaveSchedulerPort,
  type ArtifactInstallJournal,
  type ArtifactRecord,
  type BuildOrchestratorPorts,
  type ClockPort,
  type ProcessIdentityPort,
  type SchedulerPort,
  type ServicePorts,
  type TransactionDigest,
} from "@cbb/services";
import {
  M3ApplicationServiceRoot,
  createM3BuildArtifactBridge,
} from "./composition.js";

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
  "transaction-journal.schema.json",
  "recovery-snapshot.schema.json",
  "artifact-record.schema.json",
] as const;

function catalog() {
  const directory = resolve(process.cwd(), "schemas/v1");
  const schemas = new Map<string, SchemaObject>();
  for (const name of SCHEMA_NAMES) {
    const schema = JSON.parse(readFileSync(join(directory, name), "utf8")) as SchemaObject;
    schemas.set(schema.$id, schema);
  }
  return createSchemaCatalog(schemas);
}

function ids(): IdPort {
  let next = 1;
  return {
    randomUuid() {
      return `00000000-0000-4000-8000-${(next++).toString(16).padStart(12, "0")}`;
    },
  };
}

const clock: ClockPort = { now: () => new Date("2026-07-12T12:00:00.000Z") };
const scheduler: SchedulerPort = {
  setInterval: () => ({ scheduled: true }),
  clearInterval: () => undefined,
};
const processIdentity: ProcessIdentityPort = {
  current: () => ({
    pid: 42,
    hostUserDiscriminator: `sha256:${"a".repeat(64)}`,
    processStartedAt: "2026-07-12T11:59:00.000Z",
  }),
  check: async () => "liveMatch",
};

function ports(): ServicePorts {
  return {
    fileSystem: createNodeFileSystemPort(),
    clock,
    scheduler,
    ids: ids(),
    processIdentity,
  };
}

function digest(bytes: Uint8Array): TransactionDigest {
  return hashBytes(bytes) as TransactionDigest;
}

interface AutosaveTask {
  readonly id: number;
  readonly due: number;
  readonly callback: () => void;
}

class FakeAutosaveScheduler implements AutosaveSchedulerPort {
  private now = Date.parse("2026-07-12T12:00:00.000Z");
  private nextId = 1;
  private readonly tasks = new Map<number, AutosaveTask>();

  nowMilliseconds(): number { return this.now; }

  schedule(callback: () => void, delayMilliseconds: number): unknown {
    const id = this.nextId++;
    this.tasks.set(id, { id, due: this.now + delayMilliseconds, callback });
    return id;
  }

  cancel(handle: unknown): void {
    if (typeof handle === "number") this.tasks.delete(handle);
  }

  advanceBy(milliseconds: number): void {
    const target = this.now + milliseconds;
    for (;;) {
      const task = [...this.tasks.values()]
        .filter((candidate) => candidate.due <= target)
        .sort((left, right) => left.due - right.due || left.id - right.id)[0];
      if (task === undefined) break;
      this.tasks.delete(task.id);
      this.now = task.due;
      task.callback();
    }
    this.now = target;
  }
}

describe("headless M3 application composition", () => {
  it("recovers a journal-owned partial artifact before returning an editable workspace", async () => {
    const parent = await mkdtemp(join(tmpdir(), "cbb-shell-artifact-recovery-"));
    const rootPath = join(parent, "workspace");
    const schemaCatalog = catalog();
    const servicePorts = ports();
    const first = new M3ApplicationServiceRoot({
      catalog: schemaCatalog,
      appVersion: "m3-composition-test",
      ports: servicePorts,
    });
    const created = await first.createWorkspace({ root: rootPath });
    expect(created.status).toBe("editable");
    if (created.status !== "editable") return;
    await first.close();

    const bulletinLocalId = "10000000-0000-4000-8000-000000000001";
    const buildId = "20000000-0000-4000-8000-000000000001";
    const source = new TextEncoder().encode("#text(\"interrupted\")");
    const pdf = new TextEncoder().encode("%PDF-1.7\ninterrupted\n%%EOF\n");
    const record: ArtifactRecord = {
      version: 1,
      kind: "artifactRecord",
      buildId,
      bulletinLocalId,
      artifactKind: "finalCandidate",
      status: "succeeded",
      executionMode: "compile",
      createdAt: "2026-07-12T12:00:00Z",
      startedAt: "2026-07-12T12:00:01Z",
      completedAt: "2026-07-12T12:00:02Z",
      outputForm: "readerOrder",
      readinessProfile: "printFinal",
      canonicalRevisionToken: hashBytes(new TextEncoder().encode("revision")),
      renderInputHash: hashBytes(new TextEncoder().encode("render")),
      readinessInputHash: hashBytes(new TextEncoder().encode("readiness")),
      toolIdentities: [],
      schemaIdentities: [],
      diagnosticCodes: [],
      outputEvidence: {
        mode: "compile",
        renderProjectionHash: hashBytes(new TextEncoder().encode("projection")),
        typstRelativePath: `artifacts/${bulletinLocalId}/${buildId}.typ`,
        typstHash: hashBytes(source),
        generatorVersion: "cbb-typstgen-v1",
        pdf: {
          relativePath: `artifacts/${bulletinLocalId}/${buildId}.pdf`,
          hash: hashBytes(pdf),
          byteSize: pdf.byteLength,
          pageCount: 1,
          pdfVersion: "1.7",
        },
        resources: { assets: [], fontFaces: [] },
      },
    };
    const journal: ArtifactInstallJournal = {
      version: 1,
      kind: "artifactInstallJournal",
      record,
      ownedBytes: [
        { extension: "pdf", hash: hashBytes(pdf), byteSize: pdf.byteLength },
        { extension: "typ", hash: hashBytes(source), byteSize: source.byteLength },
      ],
    };
    const storage = await createNodeArtifactStoragePort(rootPath);
    await storage.installJournal!.begin(journal);
    await storage.installOwnedByteExclusive({
      kind: "artifactOwnedByte",
      bulletinLocalId,
      buildId,
      extension: "typ",
    }, source);

    const reopenedRoot = new M3ApplicationServiceRoot({
      catalog: schemaCatalog,
      appVersion: "m3-composition-test",
      ports: servicePorts,
    });
    const reopened = await reopenedRoot.openWorkspace(rootPath);
    expect(reopened.status).toBe("editable");
    expect(await storage.readOwnedByte({
      kind: "artifactOwnedByte",
      bulletinLocalId,
      buildId,
      extension: "typ",
    })).toBeUndefined();
    expect(await servicePorts.fileSystem.readDirectory(
      join(rootPath, "transactions", "artifacts"),
    )).toEqual([]);
    await reopenedRoot.close();
  });

  it("runs generic transaction recovery before returning a reopened editable workspace", async () => {
    const parent = await mkdtemp(join(tmpdir(), "cbb-shell-composition-"));
    const rootPath = join(parent, "workspace");
    const schemaCatalog = catalog();
    const servicePorts = ports();
    const firstRoot = new M3ApplicationServiceRoot({
      catalog: schemaCatalog,
      appVersion: "m3-composition-test",
      ports: servicePorts,
    });
    const created = await firstRoot.createWorkspace({ root: rootPath, displayName: "Test" });
    expect(created.status).toBe("editable");
    if (created.status !== "editable") return;
    expect(created.workspace.documents).toBeDefined();
    expect(created.workspace.preferences).toBeDefined();
    expect(created.workspace.recoverySnapshots).toBeDefined();
    expect(created.workspace.resourceVerifier).toBeDefined();
    expect(created.workspace.retention).toBeDefined();

    const bytes = new TextEncoder().encode("staged asset bytes");
    const prepared = await created.workspace.transactions.prepare({
      sourceDigest: digest(bytes),
      mutations: [{
        id: "write_asset",
        resourceKey: assetCanonicalResourceKey(
          "10000000-0000-4000-8000-000000000001",
        ),
        operation: "put",
        expectedOldHash: null,
        expectedNewHash: digest(bytes),
        newBytes: bytes,
        idempotent: true,
      }],
    });
    expect(
      await servicePorts.fileSystem.readDirectory(
        join(rootPath, MULTI_TRANSACTION_JOURNAL_DIRECTORY),
      ),
    ).toEqual([`${prepared.transactionId}.json`]);
    expect((await created.workspace.retention.project()).retained.map((node) => node.id))
      .toContain(transactionRetentionNodeId(prepared.transactionId));

    const closedTransactions = created.workspace.transactions;
    const closedRetention = created.workspace.retention;
    await created.workspace.close();
    await expect(closedTransactions.prepare({
      sourceDigest: digest(bytes),
      mutations: [],
    })).rejects.toThrow(/closed/);
    await expect(closedRetention.project()).rejects.toThrow(/closed/);

    const secondRoot = new M3ApplicationServiceRoot({
      catalog: schemaCatalog,
      appVersion: "m3-composition-test",
      ports: servicePorts,
    });
    const reopened = await secondRoot.openWorkspace(rootPath);
    expect(reopened.status).toBe("editable");
    expect(
      await servicePorts.fileSystem.readDirectory(
        join(rootPath, MULTI_TRANSACTION_JOURNAL_DIRECTORY),
      ),
    ).toEqual([]);
    if (reopened.status === "editable") await reopened.workspace.close();
    await firstRoot.close();
    await secondRoot.close();
  });

  it("composes optional artifact and build services only from trusted injected adapters", async () => {
    const parent = await mkdtemp(join(tmpdir(), "cbb-shell-build-composition-"));
    const createBuildPorts = vi.fn((context): BuildOrchestratorPorts => {
      expect(context.artifacts).toBeDefined();
      const bridge = createM3BuildArtifactBridge(context, {
        clock: { now: () => new Date("2026-07-12T12:00:00.000Z") },
        outputReader: { async readVerifiedPdf() { return new Uint8Array([1]); } },
        tools: [{ toolId: "typst", version: "0.14.2", hash: hashBytes(new Uint8Array([2])) }],
        schemas: [{ schemaId: "document", version: 1, hash: hashBytes(new Uint8Array([3])) }],
      });
      return {
        ids: {
          mintBuildId: () => "20000000-0000-4000-8000-000000000001",
        },
        projections: {
          async prepare() { throw new Error("not exercised"); },
          async release() {},
        },
        saves: {
          async saveAndReadClean() { throw new Error("not exercised"); },
        },
        currentInputs: {
          async readCurrent() { throw new Error("not exercised"); },
        },
        resources: {
          async resolve() { throw new Error("not exercised"); },
        },
        runner: {
          async execute() { throw new Error("not exercised"); },
          async cancelProcessTree() {},
        },
        artifacts: bridge.artifactStatuses,
      };
    });
    const root = new M3ApplicationServiceRoot({
      catalog: catalog(),
      appVersion: "m3-composition-test",
      ports: ports(),
      trustedRuntime: { async verify() {} },
      artifactPdfValidator: {
        async verify(bytes) {
          return {
            hash: hashBytes(bytes),
            byteSize: bytes.byteLength,
            pageCount: 1,
            pdfVersion: "1.7",
          };
        },
      },
      createBuildPorts,
    });
    const opened = await root.createWorkspace({ root: join(parent, "workspace") });
    expect(opened.status).toBe("editable");
    if (opened.status !== "editable") return;
    expect(createBuildPorts).toHaveBeenCalledOnce();
    expect(opened.workspace.artifacts).toBeDefined();
    expect(opened.workspace.build?.getState()).toMatchObject({ queued: [] });
    await root.close();
    expect(() => opened.workspace.build?.getState()).toThrow(/closed/);
  });

  it("fails closed on trusted runtime verification and caches only success", async () => {
    const parent = await mkdtemp(join(tmpdir(), "cbb-shell-runtime-gate-"));
    const rootPath = join(parent, "workspace");
    const schemaCatalog = catalog();
    const servicePorts = ports();
    const artifactPdfValidator = {
      async verify(bytes: Uint8Array) {
        return {
          hash: hashBytes(bytes),
          byteSize: bytes.byteLength,
          pageCount: 1,
          pdfVersion: "1.7",
        };
      },
    };
    expect(() => new M3ApplicationServiceRoot({
      catalog: schemaCatalog,
      appVersion: "m3-composition-test",
      ports: servicePorts,
      artifactPdfValidator,
    })).toThrow(/trusted runtime verification gate/i);

    const verify = vi.fn()
      .mockRejectedValueOnce(new Error("signed component self-check failed"))
      .mockResolvedValue(undefined);
    const root = new M3ApplicationServiceRoot({
      catalog: schemaCatalog,
      appVersion: "m3-composition-test",
      ports: servicePorts,
      trustedRuntime: { verify },
      artifactPdfValidator,
    });
    await expect(root.createWorkspace({ root: rootPath })).rejects.toThrow(
      "signed component self-check failed",
    );
    expect(await servicePorts.fileSystem.entryInfo(rootPath)).toBeUndefined();

    const created = await root.createWorkspace({ root: rootPath });
    expect(created.status).toBe("editable");
    await root.close();
    const reopened = await root.openWorkspace(rootPath);
    expect(reopened.status).toBe("editable");
    expect(verify).toHaveBeenCalledTimes(2);
    await root.close();
  });

  it("releases the edit lease when workspace service composition fails", async () => {
    const parent = await mkdtemp(join(tmpdir(), "cbb-shell-compose-failure-"));
    const rootPath = join(parent, "workspace");
    const schemaCatalog = catalog();
    const servicePorts = ports();
    const failing = new M3ApplicationServiceRoot({
      catalog: schemaCatalog,
      appVersion: "m3-composition-test",
      ports: servicePorts,
      trustedRuntime: { async verify() {} },
      createBuildPorts: async () => { throw new Error("build adapter initialization failed"); },
    });
    await expect(failing.createWorkspace({ root: rootPath })).rejects.toThrow(
      "build adapter initialization failed",
    );

    const fallback = new M3ApplicationServiceRoot({
      catalog: schemaCatalog,
      appVersion: "m3-composition-test",
      ports: servicePorts,
    });
    const reopened = await fallback.openWorkspace(rootPath);
    expect(reopened.status).toBe("editable");
    await fallback.close();
  });

  it("binds autosave to durable document saves and blocks implicit dirty shutdown", async () => {
    const parent = await mkdtemp(join(tmpdir(), "cbb-shell-autosave-composition-"));
    const rootPath = join(parent, "workspace");
    const schemaCatalog = catalog();
    const servicePorts = ports();
    const root = new M3ApplicationServiceRoot({
      catalog: schemaCatalog,
      appVersion: "m3-composition-test",
      ports: servicePorts,
    });
    const opened = await root.createWorkspace({ root: rootPath });
    expect(opened.status).toBe("editable");
    if (opened.status !== "editable") return;

    const localResourceId = parseLocalResourceId(
      "10000000-0000-4000-8000-000000000001",
    );
    const initial = fromJson(
      JSON.parse(readFileSync(resolve(process.cwd(), "test/fixtures/full-featured-bulletin.json"), "utf8")),
      schemaCatalog,
    );
    const saved = await opened.workspace.documents.save({
      resourceKind: "bulletin",
      localResourceId,
      displayName: "Sunday Bulletin",
      document: initial,
      baseDocument: null,
      baseRevisionToken: null,
    });
    expect(saved.status).toBe("saved");
    if (saved.status !== "saved") return;

    const autosaveScheduler = new FakeAutosaveScheduler();
    const autosave = opened.workspace.createDocumentAutosave({
      localResourceId,
      resourceKind: "bulletin",
      displayName: "Sunday Bulletin",
      initialDocument: initial,
      initialRevisionToken: saved.revisionToken,
      scheduler: autosaveScheduler,
    });
    autosave.edit({ ...initial, name: "Autosaved bulletin" });
    autosaveScheduler.advanceBy(500);
    await vi.waitFor(() => expect(autosave.state().phase).toBe("clean"));
    const persisted = JSON.parse(readFileSync(
      join(rootPath, canonicalDocumentPath("bulletin", localResourceId)),
      "utf8",
    )) as { readonly name: string };
    expect(persisted.name).toBe("Autosaved bulletin");

    autosave.edit({ ...initial, name: "Dirty and not discarded" });
    await expect(root.close()).resolves.toMatchObject({
      status: "blocked",
      blockers: [{ localResourceId, disposition: { reason: "unsaved" } }],
    });

    const contender = new M3ApplicationServiceRoot({
      catalog: schemaCatalog,
      appVersion: "m3-composition-test",
      ports: servicePorts,
    });
    await expect(contender.openWorkspace(rootPath)).resolves.toMatchObject({
      status: "readOnly",
      session: { reason: "liveLock" },
    });
    await expect(root.close({ discardUnsaved: true })).resolves.toEqual({ status: "closed" });
    const reopened = await contender.openWorkspace(rootPath);
    expect(reopened.status).toBe("editable");
    await contender.close();
  });
});
