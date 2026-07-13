import { readFileSync, readdirSync } from "node:fs";
import { mkdir, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { mkdtemp } from "node:fs/promises";
import {
  canonicalJsonBytes,
  canonicalRevisionToken,
  createSchemaCatalog,
  fromJson,
  hashBytes,
  parseLocalResourceId,
  type IdPort,
  type SchemaObject,
} from "@cbb/core";
import { describe, expect, it } from "vitest";
import type { ArtifactRecord } from "../artifacts/index.js";
import { NodeRecoverySnapshotStore } from "../autosave/index.js";
import { DocumentPersistenceService, SaveJournalRecoveryService } from "../persistence/index.js";
import { createNodeFileSystemPort, type ClockPort, type ProcessIdentityPort, type SchedulerPort, type ServicePorts } from "../ports/index.js";
import { workspaceResourceTransactionPaths } from "../resources/index.js";
import { JournaledTransactionCoordinator, NodeWorkspaceTransactionStorage, type TransactionDigest } from "../transactions/index.js";
import { WorkspaceService } from "../workspace/index.js";
import { computeRetentionPlan } from "./retentionGraph.js";
import { artifactRetentionNodeId, documentRevisionRetentionNodeId, transactionRetentionNodeId } from "./retentionProjection.js";
import { NodeWorkspaceRetentionSource } from "./nodeRetention.js";

function catalog() {
  const directory = resolve(process.cwd(), "schemas/v1");
  const schemas = new Map<string, SchemaObject>();
  for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".json"))) {
    const schema = JSON.parse(readFileSync(join(directory, name), "utf8")) as SchemaObject;
    schemas.set(schema.$id, schema);
  }
  return createSchemaCatalog(schemas);
}

function ids(): IdPort {
  let next = 1;
  return {
    randomUuid() {
      return `90000000-0000-4000-8000-${(next++).toString(16).padStart(12, "0")}`;
    },
  };
}

const clock: ClockPort = { now: () => new Date("2026-07-12T12:00:00.000Z") };
const scheduler: SchedulerPort = {
  setInterval: () => ({ timer: true }),
  clearInterval: () => undefined,
};
const processIdentity: ProcessIdentityPort = {
  current: () => ({
    pid: 10,
    hostUserDiscriminator: `sha256:${"a".repeat(64)}`,
    processStartedAt: "2026-07-12T11:59:00.000Z",
  }),
  check: async () => "liveMatch",
};

describe("Node workspace retention inventory", () => {
  it("loads roots nofollow and retains only the latest successful preview per bulletin", async () => {
    const parent = await mkdtemp(join(tmpdir(), "cbb-node-retention-"));
    const root = join(parent, "workspace");
    const schemas = catalog();
    const idPort = ids();
    const fileSystem = createNodeFileSystemPort();
    const ports: ServicePorts = { fileSystem, clock, scheduler, ids: idPort, processIdentity };
    const workspace = new WorkspaceService(
      ports,
      schemas,
      new SaveJournalRecoveryService(ports, schemas),
      "node-retention-test",
    );
    const opened = await workspace.create({ root });
    expect(opened.status).toBe("editable");
    if (opened.status !== "editable") return;

    const document = fromJson(
      JSON.parse(readFileSync(resolve(process.cwd(), "test/fixtures/full-featured-bulletin.json"), "utf8")),
      schemas,
    );
    const localResourceId = parseLocalResourceId("20000000-0000-4000-8000-000000000001");
    const saved = await new DocumentPersistenceService(ports, schemas).save({
      session: opened.session,
      resourceKind: "bulletin",
      localResourceId,
      displayName: "Bulletin",
      document,
      baseDocument: null,
      baseRevisionToken: null,
    });
    expect(saved.status).toBe("saved");
    if (saved.status !== "saved") return;

    const storage = new NodeWorkspaceTransactionStorage({
      workspaceRoot: root,
      fileSystem,
      ids: idPort,
      catalog: schemas,
      resources: workspaceResourceTransactionPaths,
    });
    const coordinator = new JournaledTransactionCoordinator({
      storage,
      clock: { now: () => clock.now().toISOString() },
      ids: { allocate: () => idPort.randomUuid() },
      hashes: { digest: (value) => hashBytes(value) as TransactionDigest },
    });
    const registryBytes = await fileSystem.readFileNoFollow(join(root, "workspace.json"), 100 * 1024 * 1024);
    const registryDigest = hashBytes(registryBytes) as TransactionDigest;
    const prepared = await coordinator.prepare({
      sourceDigest: registryDigest,
      mutations: [{
        id: "rewrite_registry",
        resourceKey: "workspaceRegistry",
        operation: "put",
        expectedOldHash: registryDigest,
        expectedNewHash: registryDigest,
        newBytes: registryBytes,
        idempotent: true,
        commitMarker: true,
      }],
    });

    const changed = { ...document, name: "Recovery copy" };
    const recoveryStore = new NodeRecoverySnapshotStore({
      root,
      workspaceId: opened.session.registry.workspaceId,
      fileSystem,
      ids: idPort,
      catalog: schemas,
    });
    expect(await recoveryStore.flush({
      version: 1,
      kind: "documentRecoverySnapshot",
      workspaceId: opened.session.registry.workspaceId,
      localResourceId,
      resourceKind: "bulletin",
      editGeneration: 1,
      baseRevisionToken: saved.revisionToken,
      documentHash: canonicalRevisionToken(changed),
      oldestUnsavedEditAt: "2026-07-12T12:00:00.000Z",
      createdAt: "2026-07-12T12:00:01.000Z",
      document: changed,
    })).toEqual({ status: "saved" });

    const conflictId = "50000000-0000-4000-8000-000000000001";
    const conflictDirectory = join(
      root,
      "conflicts",
      localResourceId,
      `20260712T120000000Z-${conflictId}`,
    );
    await mkdir(conflictDirectory, { recursive: true });
    const conflict = {
      version: 1,
      kind: "documentConflict",
      conflictId,
      workspaceId: opened.session.registry.workspaceId,
      localResourceId,
      resourceKind: "bulletin",
      createdAt: "2026-07-12T12:00:00.000Z",
      baseHash: saved.revisionToken,
      diskHash: saved.revisionToken,
      oursHash: canonicalRevisionToken(changed),
      diskValidation: "valid",
    } as const;
    for (const [name, value] of [
      ["base.json", document],
      ["disk.json", document],
      ["ours.json", changed],
      ["conflict.json", conflict],
    ] as const) await writeFile(join(conflictDirectory, name), canonicalJsonBytes(value));

    const buildId = "40000000-0000-4000-8000-000000000001";
    const artifact: ArtifactRecord = {
      version: 1,
      kind: "artifactRecord",
      buildId,
      bulletinLocalId: localResourceId,
      artifactKind: "preview",
      status: "failed",
      executionMode: "compile",
      createdAt: "2026-07-12T12:00:00.000Z",
      completedAt: "2026-07-12T12:00:01.000Z",
      outputForm: "readerOrder",
      readinessProfile: "draft",
      canonicalRevisionToken: saved.revisionToken,
      renderInputHash: hashBytes(new TextEncoder().encode("render")),
      editGeneration: 1,
      requestSequence: 1,
      toolIdentities: [],
      schemaIdentities: [],
      diagnosticCodes: ["CBB-BUILD-0001"],
    };
    const artifactDirectory = join(root, "artifacts", localResourceId);
    await mkdir(artifactDirectory, { recursive: true });
    const artifactPath = join(artifactDirectory, `${buildId}.json`);
    await writeFile(artifactPath, canonicalJsonBytes(artifact));

    const successfulPreview = async (
      successfulBuildId: string,
      requestSequence: number,
    ): Promise<void> => {
      const typst = new TextEncoder().encode(`#text("preview ${requestSequence}")`);
      const pdf = new TextEncoder().encode(`%PDF-1.7 preview ${requestSequence}`);
      const record: ArtifactRecord = {
        ...artifact,
        buildId: successfulBuildId,
        status: "succeeded",
        startedAt: `2026-07-12T12:00:0${requestSequence}.000Z`,
        completedAt: `2026-07-12T12:00:1${requestSequence}.000Z`,
        requestSequence,
        diagnosticCodes: [],
        outputEvidence: {
          mode: "compile",
          renderProjectionHash: hashBytes(new TextEncoder().encode(`projection ${requestSequence}`)),
          typstRelativePath: `artifacts/${localResourceId}/${successfulBuildId}.typ`,
          typstHash: hashBytes(typst),
          generatorVersion: "node-retention-test",
          pdf: {
            relativePath: `artifacts/${localResourceId}/${successfulBuildId}.pdf`,
            hash: hashBytes(pdf),
            byteSize: pdf.byteLength,
            pageCount: 1,
            pdfVersion: "1.7",
          },
          resources: { assets: [], fontFaces: [] },
        },
      };
      await writeFile(join(artifactDirectory, `${successfulBuildId}.typ`), typst);
      await writeFile(join(artifactDirectory, `${successfulBuildId}.pdf`), pdf);
      await writeFile(
        join(artifactDirectory, `${successfulBuildId}.json`),
        canonicalJsonBytes(record),
      );
    };
    const olderSuccessfulBuildId = "40000000-0000-4000-8000-000000000002";
    const latestSuccessfulBuildId = "40000000-0000-4000-8000-000000000003";
    await successfulPreview(olderSuccessfulBuildId, 2);
    await successfulPreview(latestSuccessfulBuildId, 3);

    const source = new NodeWorkspaceRetentionSource({
      root,
      fileSystem,
      catalog: schemas,
      ids: idPort,
      transactions: storage,
    });
    const plan = computeRetentionPlan(await source.collect());
    expect(plan.retained.map((node) => node.id)).toEqual(expect.arrayContaining([
      documentRevisionRetentionNodeId(localResourceId, saved.revisionToken),
      transactionRetentionNodeId(prepared.transactionId),
    ]));
    expect(plan.retained.some((node) => node.kind === "transactionPayload")).toBe(true);
    expect(plan.retained.some((node) => node.kind === "conflict")).toBe(true);
    expect(plan.retained.some((node) => node.kind === "recoverySnapshot")).toBe(true);
    expect(plan.deletable.map((node) => node.id)).toContain(
      artifactRetentionNodeId(localResourceId, buildId),
    );
    expect(plan.deletable.map((node) => node.id)).toContain(
      artifactRetentionNodeId(localResourceId, olderSuccessfulBuildId),
    );
    expect(plan.retained.map((node) => node.id)).toContain(
      artifactRetentionNodeId(localResourceId, latestSuccessfulBuildId),
    );

    await unlink(artifactPath);
    await symlink("/etc/passwd", artifactPath);
    await expect(source.collect()).rejects.toThrow(/unsafe|symbolic/i);
    await opened.session.lease.release();
  });
});
