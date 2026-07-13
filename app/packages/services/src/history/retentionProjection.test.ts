import { hashBytes, type Sha256Hash } from "@cbb/core";
import { describe, expect, it, vi } from "vitest";
import type { ArtifactRecord } from "../artifacts/index.js";
import type { RecoverySnapshotCandidate } from "../autosave/index.js";
import type { ConflictRecord } from "../persistence/index.js";
import type { TransactionJournal, TransactionPayload } from "../transactions/index.js";
import type { WorkspaceRegistry } from "../workspace/index.js";
import { computeRetentionPlan } from "./retentionGraph.js";
import {
  RetentionCoordinator,
  activeBuildRetentionNodeId,
  artifactRetentionNodeId,
  assetRevisionRetentionNodeId,
  collectActiveBuildRetention,
  collectActiveRegistryRetention,
  collectArtifactRetention,
  collectConflictAndRecoveryRetention,
  collectPendingTransactionRetention,
  documentRevisionRetentionNodeId,
  fontRevisionRetentionNodeId,
  mergeRetentionFragments,
  recoveryRetentionNodeId,
  transactionPayloadRetentionNodeId,
  transactionRetentionNodeId,
} from "./retentionProjection.js";

const bytes = (value: string) => new TextEncoder().encode(value);
const hash = (value: string): Sha256Hash => hashBytes(bytes(value));
const WORKSPACE_ID = "10000000-0000-4000-8000-000000000001";
const BULLETIN_ID = "20000000-0000-4000-8000-000000000001";
const ASSET_ID = "30000000-0000-4000-8000-000000000001";
const BUILD_A = "40000000-0000-4000-8000-000000000001";
const BUILD_B = "40000000-0000-4000-8000-000000000002";
const BUILD_C = "40000000-0000-4000-8000-000000000003";
const BUILD_D = "40000000-0000-4000-8000-000000000004";
const CONFLICT_ID = "50000000-0000-4000-8000-000000000001";
const ASSET_REF = "asset:60000000-0000-4000-8000-000000000001";
const FONT_REF = "font:70000000-0000-4000-8000-000000000001";
const DOCUMENT_HASH = hash("document");
const ASSET_HASH = hash("asset");
const FONT_DIGEST = hash("font-family");

function registry(): WorkspaceRegistry {
  return {
    version: 1,
    kind: "workspace",
    workspaceId: WORKSPACE_ID,
    bulletins: [{
      localId: BULLETIN_ID,
      kind: "bulletin",
      displayName: "Bulletin",
      storagePath: `bulletins/${BULLETIN_ID}/document.json`,
      contentHash: DOCUMENT_HASH,
      createdAt: "2026-07-12T12:00:00Z",
      modifiedAt: "2026-07-12T12:00:00Z",
    }],
    assets: [{
      localId: ASSET_ID,
      kind: "asset",
      displayName: "Logo",
      storagePath: `assets/${ASSET_ID}/asset.json`,
      contentHash: hash("asset-record"),
      createdAt: "2026-07-12T12:00:00Z",
      modifiedAt: "2026-07-12T12:00:00Z",
    }],
  } as unknown as WorkspaceRegistry;
}

function artifact(
  buildId: string,
  evidence: ArtifactRecord["outputEvidence"],
): ArtifactRecord {
  return {
    version: 1,
    kind: "artifactRecord",
    buildId,
    bulletinLocalId: BULLETIN_ID,
    artifactKind: "finalCandidate",
    status: "succeeded",
    executionMode: evidence?.mode ?? "compile",
    createdAt: "2026-07-12T12:00:00Z",
    startedAt: "2026-07-12T12:00:01Z",
    completedAt: "2026-07-12T12:00:02Z",
    outputForm: evidence?.mode === "compose" ? "bookletTwoUp" : "readerOrder",
    readinessProfile: "printFinal",
    canonicalRevisionToken: DOCUMENT_HASH,
    renderInputHash: hash("render"),
    toolIdentities: [],
    schemaIdentities: [],
    diagnosticCodes: [],
    ...(evidence === undefined ? {} : { outputEvidence: evidence }),
  };
}

function resources() {
  return {
    assets: [{
      assetRef: ASSET_REF,
      binaryHash: ASSET_HASH,
      byteSize: 20,
      mediaType: "image/png",
    }],
    fontFaces: [{
      fontRef: FONT_REF,
      familyDigest: FONT_DIGEST,
      faceId: "regular",
      faceHash: hash("font-face"),
      byteSize: 30,
      embeddingPermitted: true,
      subsettingPermitted: true,
    }],
  };
}

describe("production retention projection", () => {
  it("requires an exact descriptor for every active registry resource", () => {
    const documentNodeId = documentRevisionRetentionNodeId(BULLETIN_ID, DOCUMENT_HASH);
    const assetNodeId = assetRevisionRetentionNodeId(ASSET_REF, ASSET_HASH);
    const projected = collectActiveRegistryRetention(registry(), [
      {
        localId: BULLETIN_ID,
        contentHash: DOCUMENT_HASH,
        node: { id: documentNodeId, kind: "document", byteSize: 100 },
      },
      {
        localId: ASSET_ID,
        contentHash: hash("asset-record"),
        node: { id: assetNodeId, kind: "assetRevision", byteSize: 20 },
      },
    ]);
    expect(projected.roots).toEqual([
      { nodeId: documentNodeId, reason: "activeWorkspaceResource" },
      { nodeId: assetNodeId, reason: "activeWorkspaceResource" },
    ]);
    expect(() => collectActiveRegistryRetention(registry(), [])).toThrow(
      /Missing retention descriptor/,
    );
  });

  it("collects transaction, conflict, recovery, artifact-chain, and active-build roots", () => {
    const documentNodeId = documentRevisionRetentionNodeId(BULLETIN_ID, DOCUMENT_HASH);
    const assetNodeId = assetRevisionRetentionNodeId(ASSET_REF, ASSET_HASH);
    const fontNodeId = fontRevisionRetentionNodeId(FONT_REF, FONT_DIGEST);
    const transactionResource = "asset:transaction-owned";
    const buildOnlyResource = "asset:active-build-only";
    const orphan = "asset:orphan";
    const journal = {
      journalVersion: 1,
      transactionId: "tx_1",
      state: "staged",
      sourceDigest: hash("source") as TransactionJournal["sourceDigest"],
      createdAt: "2026-07-12T12:00:00Z",
      updatedAt: "2026-07-12T12:00:00Z",
      allocations: {},
      steps: [],
      completedSteps: [],
      visibleCommitStarted: false,
    } as TransactionJournal;
    const payload: TransactionPayload = {
      transactionId: "tx_1",
      payloadId: "new_asset",
      bytes: bytes("staged"),
      hash: hash("staged") as TransactionPayload["hash"],
    };
    const recovery = {
      relativePath: `transactions/recovery/${BULLETIN_ID}/2.json`,
      byteHash: hash("recovery-bytes"),
      byteSize: 80,
      record: {
        localResourceId: BULLETIN_ID,
        editGeneration: 2,
      },
    } as RecoverySnapshotCandidate;
    const conflict = {
      conflictId: CONFLICT_ID,
    } as ConflictRecord;

    const compile = artifact(BUILD_A, {
      mode: "compile",
      renderProjectionHash: hash("projection"),
      typstRelativePath: `artifacts/${BULLETIN_ID}/${BUILD_A}.typ`,
      typstHash: hash("typst"),
      generatorVersion: "test",
      pdf: {
        relativePath: `artifacts/${BULLETIN_ID}/${BUILD_A}.pdf`,
        hash: hash("pdf-a"),
        byteSize: 100,
        pageCount: 1,
        pdfVersion: "1.7",
      },
      resources: resources(),
    });
    const composed = artifact(BUILD_B, {
      mode: "compose",
      parentReaderBuildId: BUILD_A,
      parentReaderPdfHash: hash("pdf-a"),
      parentRenderInputHash: hash("render"),
      logicalPageCount: 1,
      imposedSideCount: 2,
      compositor: { toolId: "compositor", version: "1", hash: hash("compositor") },
      pdf: {
        relativePath: `artifacts/${BULLETIN_ID}/${BUILD_B}.pdf`,
        hash: hash("pdf-b"),
        byteSize: 100,
        pageCount: 2,
        pdfVersion: "1.7",
      },
      resources: resources(),
    });
    const revalidated = artifact(BUILD_C, {
      mode: "revalidate",
      sourceRenderBuildId: BUILD_B,
      sourcePdfHash: hash("pdf-b"),
      sourceRenderInputHash: hash("render"),
      pdf: {
        relativePath: `artifacts/${BULLETIN_ID}/${BUILD_B}.pdf`,
        hash: hash("pdf-b"),
        byteSize: 100,
        pageCount: 2,
        pdfVersion: "1.7",
      },
      resources: resources(),
    });

    const plan = computeRetentionPlan(mergeRetentionFragments([
      {
        nodes: [
          { id: documentNodeId, kind: "document", byteSize: 100 },
          { id: assetNodeId, kind: "assetRevision", byteSize: 20 },
          { id: fontNodeId, kind: "fontRevision", byteSize: 30 },
          { id: transactionResource, kind: "assetRevision", byteSize: 5 },
          { id: buildOnlyResource, kind: "assetRevision", byteSize: 6 },
          { id: orphan, kind: "assetRevision", byteSize: 7 },
        ],
        references: [],
        roots: [{ nodeId: documentNodeId, reason: "activeWorkspaceResource" }],
      },
      collectPendingTransactionRetention([{
        journal,
        journalByteSize: 40,
        payloads: [payload],
        pinnedNodeIds: [transactionResource],
      }]),
      collectConflictAndRecoveryRetention({
        conflicts: [{ record: conflict, byteSize: 70, dependencyNodeIds: [fontNodeId] }],
        recoverySnapshots: [{ candidate: recovery, dependencyNodeIds: [assetNodeId] }],
      }),
      collectArtifactRetention([
        { record: compile, byteSize: 120, retained: false },
        { record: composed, byteSize: 110, retained: false },
        { record: revalidated, byteSize: 10, retained: true },
      ]),
      collectActiveBuildRetention([{
        buildId: BUILD_D,
        localResourceId: BULLETIN_ID,
        documentRevision: DOCUMENT_HASH,
        resourceClosureHash: hash("active-closure"),
        resourceNodeIds: [buildOnlyResource],
      }]),
    ]));

    expect(plan.deletable.map((node) => node.id)).toEqual([orphan]);
    expect(plan.retained.map((node) => node.id)).toEqual(expect.arrayContaining([
      transactionRetentionNodeId("tx_1"),
      transactionPayloadRetentionNodeId("tx_1", "new_asset", hash("staged")),
      recoveryRetentionNodeId(recovery),
      artifactRetentionNodeId(BULLETIN_ID, BUILD_A),
      artifactRetentionNodeId(BULLETIN_ID, BUILD_B),
      artifactRetentionNodeId(BULLETIN_ID, BUILD_C),
      activeBuildRetentionNodeId(BUILD_D),
      assetNodeId,
      fontNodeId,
      transactionResource,
      buildOnlyResource,
    ]));
  });

  it("gates resource and artifact cleanup through a serialized live projection", async () => {
    const candidate = "asset:candidate";
    const artifactNode = artifactRetentionNodeId(BULLETIN_ID, BUILD_A);
    const documentNode = documentRevisionRetentionNodeId(BULLETIN_ID, DOCUMENT_HASH);
    const source = {
      async collect() {
        return {
          nodes: [
            { id: candidate, kind: "assetRevision" as const, byteSize: 5 },
            { id: artifactNode, kind: "artifact" as const, byteSize: 10 },
            { id: documentNode, kind: "document" as const, byteSize: 20 },
          ],
          references: [],
          roots: [{ nodeId: artifactNode, reason: "retainedArtifact" as const }],
        };
      },
    };
    const coordinator = new RetentionCoordinator(source);
    const cleanup = vi.fn(async () => "deleted" as const);

    await expect(coordinator.cleanupResourceRevision("missing", cleanup)).resolves.toEqual({
      status: "blocked",
      reason: "unknownNode",
    });
    await expect(coordinator.cleanupResourceRevision(documentNode, cleanup)).resolves.toEqual({
      status: "blocked",
      reason: "wrongKind",
    });
    await expect(coordinator.cleanupArtifact(artifactNode, cleanup)).resolves.toMatchObject({
      status: "blocked",
      reason: "retained",
    });

    const lease = await coordinator.pinActiveBuild({
      buildId: BUILD_D,
      localResourceId: BULLETIN_ID,
      documentRevision: DOCUMENT_HASH,
      resourceClosureHash: hash("cleanup-race-closure"),
      resourceNodeIds: [candidate],
    });
    await expect(coordinator.cleanupResourceRevision(candidate, cleanup)).resolves.toMatchObject({
      status: "blocked",
      reason: "retained",
      explanation: { root: { reason: "activeBuild" } },
    });
    expect(cleanup).not.toHaveBeenCalled();

    await lease.release();
    await expect(coordinator.cleanupResourceRevision(candidate, cleanup)).resolves.toEqual({
      status: "cleaned",
      result: "deleted",
    });
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("holds the cleanup lane across closure resolution and pin publication", async () => {
    const candidate = "asset:resolve-then-pin-candidate";
    const coordinator = new RetentionCoordinator({
      async collect() {
        return {
          nodes: [{ id: candidate, kind: "assetRevision", byteSize: 5 }],
          references: [],
          roots: [],
        };
      },
    });
    let publishResolution: ((value: string) => void) | undefined;
    const resolved = new Promise<string>((resolve) => { publishResolution = resolve; });
    const resolution = coordinator.resolveAndPinActiveBuild(async () => ({
      result: await resolved,
      pin: {
        buildId: BUILD_D,
        localResourceId: BULLETIN_ID,
        documentRevision: DOCUMENT_HASH,
        resourceClosureHash: hash("atomic-closure"),
        resourceNodeIds: [candidate],
      },
    }));
    await Promise.resolve();

    const cleanup = vi.fn(async () => "deleted" as const);
    const cleanupAttempt = coordinator.cleanupResourceRevision(candidate, cleanup);
    await Promise.resolve();
    await Promise.resolve();
    expect(cleanup).not.toHaveBeenCalled();

    if (publishResolution === undefined) throw new Error("Resolution deferred was not initialized");
    publishResolution("verified closure");
    const published = await resolution;
    expect(published.result).toBe("verified closure");
    await expect(cleanupAttempt).resolves.toMatchObject({
      status: "blocked",
      reason: "retained",
      explanation: { root: { reason: "activeBuild" } },
    });
    expect(cleanup).not.toHaveBeenCalled();

    await published.lease.release();
    await expect(coordinator.cleanupResourceRevision(candidate, cleanup)).resolves.toEqual({
      status: "cleaned",
      result: "deleted",
    });
  });
});
