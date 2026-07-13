import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createSchemaCatalog,
  fromJson,
  hashCanonical,
  type SchemaObject,
} from "../packages/core/src/index.js";

const SCHEMA_ROOT = resolve(process.cwd(), "schemas/v1");
const FIXTURE = JSON.parse(
  readFileSync(resolve(process.cwd(), "test/fixtures/full-featured-bulletin.json"), "utf8"),
) as unknown;
const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const NOW = "2026-07-12T12:00:00.000Z";

function catalog() {
  const schemas = new Map<string, SchemaObject>();
  for (const name of readdirSync(SCHEMA_ROOT).filter((entry) => entry.endsWith(".json"))) {
    const schema = JSON.parse(readFileSync(join(SCHEMA_ROOT, name), "utf8")) as SchemaObject;
    schemas.set(schema.$id, schema);
  }
  return createSchemaCatalog(schemas);
}

const ARTIFACT_SCHEMA =
  "https://church-bulletin-builder.local/schema/v1/artifact-record.schema.json";
const TRANSACTION_SCHEMA =
  "https://church-bulletin-builder.local/schema/v1/transaction-journal.schema.json";
const RECOVERY_SCHEMA =
  "https://church-bulletin-builder.local/schema/v1/recovery-snapshot.schema.json";

function queuedPreview() {
  return {
    version: 1,
    kind: "artifactRecord",
    buildId: UUID_A,
    bulletinLocalId: UUID_B,
    artifactKind: "preview",
    status: "queued",
    executionMode: "compile",
    createdAt: NOW,
    outputForm: "readerOrder",
    readinessProfile: "draft",
    canonicalRevisionToken: HASH_A,
    renderInputHash: HASH_B,
    editGeneration: 1,
    requestSequence: 1,
    toolIdentities: [],
    schemaIdentities: [],
    diagnosticCodes: [],
  };
}

function compileEvidence() {
  return {
    mode: "compile",
    renderProjectionHash: HASH_A,
    typstRelativePath: `artifacts/${UUID_B}/${UUID_A}.typ`,
    typstHash: HASH_B,
    generatorVersion: "cbb-typstgen-v1",
    navigationMap: {
      version: 1,
      entries: [{
        resolvedId: "title/repeat/1",
        sourceElementId: "title",
        pageNumber: 1,
        region: "body",
      }],
    },
    pdf: {
      relativePath: `artifacts/${UUID_B}/${UUID_A}.pdf`,
      hash: HASH_A,
      byteSize: 100,
      pageCount: 1,
      pdfVersion: "1.7",
    },
    resources: { assets: [], fontFaces: [] },
  };
}

describe("M3 persisted contracts", () => {
  const schemas = catalog();

  it("forbids output evidence before artifact success", () => {
    expect(schemas.validateAgainst(ARTIFACT_SCHEMA, queuedPreview()).valid).toBe(true);
    expect(
      schemas.validateAgainst(ARTIFACT_SCHEMA, {
        ...queuedPreview(),
        outputEvidence: compileEvidence(),
      }).valid,
    ).toBe(false);
  });

  it("accepts mode-correct successful compile evidence and rejects cross-mode claims", () => {
    const succeeded = {
      ...queuedPreview(),
      status: "succeeded",
      startedAt: NOW,
      completedAt: NOW,
      outputEvidence: compileEvidence(),
    };
    expect(schemas.validateAgainst(ARTIFACT_SCHEMA, succeeded).valid).toBe(true);
    expect(
      schemas.validateAgainst(ARTIFACT_SCHEMA, {
        ...succeeded,
        executionMode: "compose",
        outputForm: "bookletTwoUp",
      }).valid,
    ).toBe(false);
  });

  it("validates closed PDF source-navigation evidence", () => {
    const succeeded = {
      ...queuedPreview(),
      status: "succeeded",
      startedAt: NOW,
      completedAt: NOW,
      outputEvidence: compileEvidence(),
    };
    expect(schemas.validateAgainst(ARTIFACT_SCHEMA, succeeded).valid).toBe(true);
    expect(schemas.validateAgainst(ARTIFACT_SCHEMA, {
      ...succeeded,
      outputEvidence: {
        ...compileEvidence(),
        navigationMap: {
          version: 1,
          entries: [{
            resolvedId: "title",
            sourceElementId: "../title",
            pageNumber: 0,
            region: "host-path",
          }],
        },
      },
    }).valid).toBe(false);
  });

  it("requires final candidates to have final readiness evidence and no watermark", () => {
    const final = {
      ...queuedPreview(),
      artifactKind: "finalCandidate",
      readinessProfile: "printFinal",
      readinessInputHash: HASH_A,
    };
    delete (final as { editGeneration?: number }).editGeneration;
    delete (final as { requestSequence?: number }).requestSequence;
    expect(schemas.validateAgainst(ARTIFACT_SCHEMA, final).valid).toBe(true);
    expect(
      schemas.validateAgainst(ARTIFACT_SCHEMA, {
        ...final,
        watermark: { kind: "draft", text: "DRAFT", version: "1" },
      }).valid,
    ).toBe(false);
  });

  it("validates the closed transaction state/failure envelope", () => {
    const planned = {
      journalVersion: 1,
      transactionId: "tx_1",
      state: "planned",
      sourceDigest: HASH_A,
      createdAt: NOW,
      updatedAt: NOW,
      allocations: {},
      steps: [
        {
          id: "write",
          order: 0,
          resourceKey: "assetRecord:key",
          operation: "put",
          expectedOldHash: null,
          expectedNewHash: HASH_B,
          idempotent: true,
          commitMarker: true,
          newPayloadId: "new-write",
        },
      ],
      completedSteps: [],
      visibleCommitStarted: false,
    };
    expect(schemas.validateAgainst(TRANSACTION_SCHEMA, planned).valid).toBe(true);
    expect(
      schemas.validateAgainst(TRANSACTION_SCHEMA, {
        ...planned,
        state: "failed",
      }).valid,
    ).toBe(false);
    expect(
      schemas.validateAgainst(TRANSACTION_SCHEMA, {
        ...planned,
        state: "failed",
        failure: { message: "rollback complete", rollbackVerified: true },
      }).valid,
    ).toBe(true);
  });

  it("binds recovery snapshots to exact document bytes and edit evidence", () => {
    const document = fromJson(FIXTURE, schemas);
    const snapshot = {
      version: 1,
      kind: "documentRecoverySnapshot",
      workspaceId: UUID_A,
      localResourceId: UUID_B,
      resourceKind: "bulletin",
      editGeneration: 1,
      baseRevisionToken: HASH_A,
      documentHash: hashCanonical(document),
      oldestUnsavedEditAt: NOW,
      createdAt: NOW,
      document,
    };
    expect(schemas.validateAgainst(RECOVERY_SCHEMA, snapshot).valid).toBe(true);
    expect(
      schemas.validateAgainst(RECOVERY_SCHEMA, {
        ...snapshot,
        arbitraryPath: "/home/user/document.json",
      }).valid,
    ).toBe(false);
  });
});
