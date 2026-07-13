import {
  BUNDLED_NOTO_SANS_FAMILY,
  BUNDLED_NOTO_SANS_FONT_REF,
  BUNDLED_NOTO_SANS_SYMBOLS_2_FAMILY,
  BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF,
  hashBytes,
  hexToSha256Hash,
  parseLocalResourceId,
  type Sha256Hash,
} from "@cbb/core";
import { describe, expect, it } from "vitest";
import {
  BuildOrchestrator,
  IsolatedBuildExecution,
  resourceClosureExecutionHash,
  type BuildOutputHandle,
  type BuildQueueHash,
  type BuildRootHandle,
  type IsolatedTypstSandboxPort,
  type PreparedBuildProjection,
  type VerifiedResourceClosure,
} from "../index.js";
import { ImmutableArtifactStore } from "./store.js";
import type {
  ArtifactOwnedByteLocator,
  ArtifactRecord,
  ArtifactRecordLocator,
  ArtifactStoragePort,
} from "./types.js";
import { createImmutableBuildArtifactBridge } from "./buildBridge.js";

const encoder = new TextEncoder();
const SOURCE = "#text(\"Bridge\")";
const SOURCE_BYTES = encoder.encode(SOURCE);
const PDF = encoder.encode("%PDF-1.7 bridge output");
const SOURCE_HASH = hashBytes(SOURCE_BYTES);
const PDF_HASH = hashBytes(PDF);
const REVISION = hexToSha256Hash("a".repeat(64)) as BuildQueueHash;
const RENDER = hexToSha256Hash("b".repeat(64)) as BuildQueueHash;
const TOOL_HASH = hexToSha256Hash("c".repeat(64));
const FONT_1 = hexToSha256Hash("d".repeat(64));
const FONT_2 = hexToSha256Hash("e".repeat(64));
const LOCAL_ID = "30000000-0000-4000-8000-000000000001";
const ROOT = "root:bridge" as BuildRootHandle;
const OUTPUT = "output:bridge" as BuildOutputHandle;

const CLOSURE: VerifiedResourceClosure = {
  assets: [],
  fonts: [
    {
      fontRef: BUNDLED_NOTO_SANS_FONT_REF,
      familyDigest: hexToSha256Hash("f".repeat(64)),
      selectedFaces: [{ faceId: "regular", faceHash: FONT_1, faceIndex: 0, embedding: "subset" }],
    },
    {
      fontRef: BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF,
      familyDigest: hexToSha256Hash("1".repeat(64)),
      selectedFaces: [{ faceId: "regular", faceHash: FONT_2, faceIndex: 0, embedding: "subset" }],
    },
  ],
  assetBindings: {},
  fontBindings: {
    [BUNDLED_NOTO_SANS_FONT_REF]: { familyName: BUNDLED_NOTO_SANS_FAMILY },
    [BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF]: { familyName: BUNDLED_NOTO_SANS_SYMBOLS_2_FAMILY },
  },
  stagingEntries: [
    {
      kind: "fontFace",
      fontRef: BUNDLED_NOTO_SANS_FONT_REF,
      faceId: "regular",
      locator: {
        kind: "fontFace",
        localId: parseLocalResourceId("10000000-0000-4000-8000-000000000001"),
        faceId: "regular",
      },
      relativePath: "fonts/f0000-0000.ttf",
      hash: FONT_1,
      byteSize: 100,
      format: "ttf",
    },
    {
      kind: "fontFace",
      fontRef: BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF,
      faceId: "regular",
      locator: {
        kind: "fontFace",
        localId: parseLocalResourceId("10000000-0000-4000-8000-000000000002"),
        faceId: "regular",
      },
      relativePath: "fonts/f0001-0000.ttf",
      hash: FONT_2,
      byteSize: 100,
      format: "ttf",
    },
  ],
  warnings: [],
  totals: {
    assetCount: 0,
    assetBytes: 0,
    fontFamilyCount: 2,
    fontFaceCount: 2,
    fontBytes: 200,
  },
};

function key(locator: ArtifactRecordLocator | ArtifactOwnedByteLocator): string {
  return locator.kind === "artifactRecord"
    ? `${locator.bulletinLocalId}/${locator.buildId}.json`
    : `${locator.bulletinLocalId}/${locator.buildId}.${locator.extension}`;
}

class MemoryStorage implements ArtifactStoragePort {
  readonly records = new Map<string, ArtifactRecord>();
  readonly bytes = new Map<string, Uint8Array>();

  async readRecord(locator: ArtifactRecordLocator): Promise<unknown | undefined> {
    return structuredClone(this.records.get(key(locator)));
  }

  async installRecordExclusive(locator: ArtifactRecordLocator, record: ArtifactRecord): Promise<boolean> {
    const locatorKey = key(locator);
    if (this.records.has(locatorKey)) return false;
    this.records.set(locatorKey, structuredClone(record));
    return true;
  }

  async deleteRecordIfUnchanged(locator: ArtifactRecordLocator, record: ArtifactRecord): Promise<boolean> {
    const locatorKey = key(locator);
    if (JSON.stringify(this.records.get(locatorKey)) !== JSON.stringify(record)) return false;
    return this.records.delete(locatorKey);
  }

  async readOwnedByte(locator: ArtifactOwnedByteLocator): Promise<Uint8Array | undefined> {
    const value = this.bytes.get(key(locator));
    return value === undefined ? undefined : new Uint8Array(value);
  }

  async installOwnedByteExclusive(locator: ArtifactOwnedByteLocator, value: Uint8Array): Promise<boolean> {
    const locatorKey = key(locator);
    if (this.bytes.has(locatorKey)) return false;
    this.bytes.set(locatorKey, new Uint8Array(value));
    return true;
  }

  async deleteOwnedByteIfHash(locator: ArtifactOwnedByteLocator, expected: Sha256Hash): Promise<boolean> {
    const locatorKey = key(locator);
    const value = this.bytes.get(locatorKey);
    if (value === undefined || hashBytes(value) !== expected) return false;
    return this.bytes.delete(locatorKey);
  }
}

function sandbox(result: "succeeded" | "failed"): IsolatedTypstSandboxPort {
  return {
    isolationProfile: "offlineTypstV1",
    verifyTrustedTool: async () => true,
    createBuildRoot: async () => ROOT,
    stageSource: async (_root, value, expected) => ({ observedHash: expected, observedByteSize: value.byteLength }),
    stageResource: async (_root, entry) => ({ observedHash: entry.hash, observedByteSize: entry.byteSize }),
    compile: async () => result === "succeeded"
      ? { kind: "succeeded" }
      : { kind: "failed", diagnosticCodes: ["CBB-BUILD-0001"] },
    verifyPdf: async () => ({
      handle: OUTPUT,
      hash: PDF_HASH,
      byteSize: PDF.byteLength,
      pageCount: 1,
      pdfVersion: "1.7",
      magicVerified: true,
      navigationMap: { version: 1, entries: [] },
    }),
    terminate: async () => undefined,
    cleanup: async () => undefined,
  };
}

function prepared(localResourceId: string): PreparedBuildProjection {
  return {
    projectionHandle: "projection:bridge",
    localResourceId,
    documentRevision: REVISION,
    renderInputHash: RENDER,
    editGeneration: 1,
    source: SOURCE,
    sourceHash: SOURCE_HASH,
    resourceClosureHash: resourceClosureExecutionHash(CLOSURE),
    artifactMetadata: {
      renderProjectionHash: hexToSha256Hash("2".repeat(64)),
      generatorVersion: "bridge-v1",
      outputForm: "readerOrder",
      readinessProfile: "draft",
      watermark: { kind: "proof", text: "PREVIEW", version: "m3-v1" },
    },
  };
}

function harness(compile: "succeeded" | "failed", buildId: string) {
  const storage = new MemoryStorage();
  const store = new ImmutableArtifactStore({
    storage,
    records: { validate: () => true },
    hashes: { digest: hashBytes },
    pdfs: {
      async verify(value) {
        if (hashBytes(value) !== PDF_HASH) throw new Error("unexpected PDF");
        return {
          hash: PDF_HASH,
          byteSize: PDF.byteLength,
          pageCount: 1,
          pdfVersion: "1.7",
        };
      },
    },
  });
  let tick = 0;
  const bridge = createImmutableBuildArtifactBridge({
    artifacts: store,
    clock: { now: () => new Date(Date.parse("2026-07-12T12:00:00.000Z") + tick++ * 1_000) },
    outputReader: { readVerifiedPdf: async () => new Uint8Array(PDF) },
    tools: [{ toolId: "typst", version: "0.14.2", hash: TOOL_HASH }],
    schemas: [{ schemaId: "document", version: 1, hash: hexToSha256Hash("3".repeat(64)) }],
  });
  const runner = new IsolatedBuildExecution({
    sandbox: sandbox(compile),
    timer: { raceTimeout: async (work) => ({ kind: "completed", value: await work }) },
    tool: { toolId: "typst", version: "0.14.2", executableHash: TOOL_HASH },
    sinks: bridge.executionSinks,
  });
  const projection = prepared(LOCAL_ID);
  const orchestrator = new BuildOrchestrator({
    ids: { mintBuildId: () => buildId },
    projections: {
      prepare: async () => projection,
      release: async () => undefined,
    },
    saves: {
      saveAndReadClean: async () => ({
        documentRevision: REVISION,
        renderInputHash: RENDER,
        editGeneration: 1,
        saveState: "clean",
      }),
    },
    currentInputs: {
      readCurrent: async () => ({
        documentRevision: REVISION,
        renderInputHash: RENDER,
        editGeneration: 1,
        saveState: "clean",
      }),
    },
    resources: { resolve: async () => CLOSURE },
    runner,
    artifacts: bridge.artifactStatuses,
  });
  return { orchestrator, store, storage };
}

describe("immutable build artifact bridge", () => {
  it("rejects non-closed tool/schema configuration before lifecycle admission", () => {
    const h = harness("succeeded", "40000000-0000-4000-8000-000000000004");
    expect(() => createImmutableBuildArtifactBridge({
      artifacts: h.store,
      clock: { now: () => new Date("2026-07-12T12:00:00.000Z") },
      outputReader: { readVerifiedPdf: async () => PDF },
      tools: [
        { toolId: "typst", version: "0.14.2", hash: TOOL_HASH },
        { toolId: "typst", version: "0.14.2", hash: TOOL_HASH },
      ],
      schemas: [{ schemaId: "document", version: 1, hash: hexToSha256Hash("3".repeat(64)) }],
    })).toThrow(/artifact bridge rejected/i);
  });

  it("persists a successful isolated build through the bound compile sink", async () => {
    const buildId = "40000000-0000-4000-8000-000000000001";
    const h = harness("succeeded", buildId);
    await expect(h.orchestrator.submitPreview({
      localResourceId: LOCAL_ID,
      requestSequence: 1,
    })).resolves.toEqual({ buildId, status: "enqueued" });
    await h.orchestrator.whenIdle();

    const record = await h.store.readArtifact(LOCAL_ID, buildId);
    expect(record).toMatchObject({
      status: "succeeded",
      artifactKind: "preview",
      requestSequence: 1,
      outputEvidence: {
        mode: "compile",
        typstHash: SOURCE_HASH,
        pdf: { hash: PDF_HASH },
      },
    });
    expect(h.storage.bytes.size).toBe(2);
  });

  it("persists exactly one immutable terminal failure when compilation fails", async () => {
    const buildId = "40000000-0000-4000-8000-000000000002";
    const h = harness("failed", buildId);
    await h.orchestrator.submitPreview({ localResourceId: LOCAL_ID, requestSequence: 1 });
    await h.orchestrator.whenIdle();

    const failed = await h.store.readArtifact(LOCAL_ID, buildId);
    expect(failed).toMatchObject({
      status: "failed",
      diagnosticCodes: ["CBB-BUILD-0001"],
    });
    expect(failed).not.toHaveProperty("outputEvidence");
    expect(h.storage.records.size).toBe(1);
    expect(h.storage.bytes.size).toBe(0);
  });

  it("turns a canceled queued preview into one terminal record without running", async () => {
    const buildId = "40000000-0000-4000-8000-000000000003";
    const h = harness("succeeded", buildId);
    await h.orchestrator.setDragActive(LOCAL_ID, true);
    await h.orchestrator.submitPreview({ localResourceId: LOCAL_ID, requestSequence: 1 });
    await h.orchestrator.cancel(buildId);
    await h.orchestrator.whenIdle();

    const canceled = await h.store.readArtifact(LOCAL_ID, buildId);
    expect(canceled).toMatchObject({
      status: "canceled",
      diagnosticCodes: ["CBB-BUILD-0002"],
    });
    expect(canceled).not.toHaveProperty("startedAt");
    expect(h.storage.records.size).toBe(1);
    expect(h.storage.bytes.size).toBe(0);
  });
});
