import { hashBytes } from "@cbb/core";
import type { Sha256Hash } from "@cbb/core";
import { describe, expect, it } from "vitest";
import type { BuildOutputHandle } from "../build/runner.js";
import type { VerifiedResourceClosure } from "../resources/index.js";
import {
  ImmutableArtifactStore,
  queryArtifactCurrency,
} from "./store.js";
import type {
  ArtifactOwnedByteLocator,
  ArtifactPdfValidatorPort,
  ArtifactRecord,
  ArtifactRecordLocator,
  ArtifactResourceClosure,
  ArtifactStoragePort,
  SuccessfulArtifactMetadata,
} from "./types.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const bytes = (value: string): Uint8Array => encoder.encode(value);
const hash = (value: Uint8Array | string): Sha256Hash =>
  hashBytes(typeof value === "string" ? bytes(value) : value);

const BULLETIN = "11111111-1111-4111-8111-111111111111";
const BUILD_A = "22222222-2222-4222-8222-222222222222";
const BUILD_B = "33333333-3333-4333-8333-333333333333";
const BUILD_C = "44444444-4444-4444-8444-444444444444";
const H_REVISION = hash("revision");
const H_RENDER = hash("render");
const H_READINESS_A = hash("readiness-a");
const H_READINESS_B = hash("readiness-b");
const SOURCE = bytes("#text(\"Bulletin\")");
const PDF = bytes("%PDF-1.7 deterministic pdf");
const COMPOSED_PDF = bytes("%PDF-1.7 imposed booklet");

function clone<T>(value: T): T {
  return structuredClone(value);
}

function locatorKey(locator: ArtifactRecordLocator | ArtifactOwnedByteLocator): string {
  return locator.kind === "artifactRecord"
    ? `${locator.bulletinLocalId}/${locator.buildId}.json`
    : `${locator.bulletinLocalId}/${locator.buildId}.${locator.extension}`;
}

class MemoryArtifactStorage implements ArtifactStoragePort {
  public readonly records = new Map<string, unknown>();
  public readonly ownedBytes = new Map<string, Uint8Array>();
  public readonly events: string[] = [];
  public failByteExtension: "typ" | "pdf" | undefined;
  public failRecordInstall = false;
  public failRecordAfterInstall = false;
  public failRecordDelete = false;

  public async readRecord(locator: ArtifactRecordLocator): Promise<unknown | undefined> {
    const value = this.records.get(locatorKey(locator));
    return value === undefined ? undefined : clone(value);
  }

  public async installRecordExclusive(
    locator: ArtifactRecordLocator,
    record: ArtifactRecord,
  ): Promise<boolean> {
    const key = locatorKey(locator);
    if (this.records.has(key)) return false;
    if (this.failRecordInstall) throw new Error("simulated record install failure");
    this.records.set(key, clone(record));
    this.events.push("install:record");
    if (this.failRecordAfterInstall) throw new Error("simulated failure after record install");
    return true;
  }

  public async deleteRecordIfUnchanged(
    locator: ArtifactRecordLocator,
    record: ArtifactRecord,
  ): Promise<boolean> {
    if (this.failRecordDelete) return false;
    const key = locatorKey(locator);
    const current = this.records.get(key);
    if (current === undefined || JSON.stringify(current) !== JSON.stringify(record)) return false;
    this.records.delete(key);
    this.events.push("delete:record");
    return true;
  }

  public async readOwnedByte(locator: ArtifactOwnedByteLocator): Promise<Uint8Array | undefined> {
    const value = this.ownedBytes.get(locatorKey(locator));
    return value === undefined ? undefined : clone(value);
  }

  public async installOwnedByteExclusive(
    locator: ArtifactOwnedByteLocator,
    value: Uint8Array,
  ): Promise<boolean> {
    const key = locatorKey(locator);
    if (this.ownedBytes.has(key)) return false;
    if (this.failByteExtension === locator.extension) {
      throw new Error(`simulated ${locator.extension} install failure`);
    }
    this.ownedBytes.set(key, clone(value));
    this.events.push(`install:${locator.extension}`);
    return true;
  }

  public async deleteOwnedByteIfHash(
    locator: ArtifactOwnedByteLocator,
    expectedHash: Sha256Hash,
  ): Promise<boolean> {
    const key = locatorKey(locator);
    const current = this.ownedBytes.get(key);
    if (current === undefined || hash(current) !== expectedHash) return false;
    this.ownedBytes.delete(key);
    this.events.push(`delete:${locator.extension}`);
    return true;
  }

  public text(buildId: string, extension: "typ" | "pdf"): string | undefined {
    const value = this.ownedBytes.get(`${BULLETIN}/${buildId}.${extension}`);
    return value === undefined ? undefined : decoder.decode(value);
  }
}

class JournaledMemoryArtifactStorage extends MemoryArtifactStorage {
  public readonly installJournal = {
    begin: async () => { this.events.push("journal:begin"); },
    finish: async () => { this.events.push("journal:finish"); },
  };
}

class PdfValidator implements ArtifactPdfValidatorPort {
  public calls = 0;
  public failAtCall: number | undefined;

  public async verify(value: Uint8Array) {
    this.calls += 1;
    if (this.failAtCall === this.calls) throw new Error("simulated PDF verifier failure");
    if (!decoder.decode(value).startsWith("%PDF-")) throw new Error("not a PDF");
    return {
      hash: hash(value),
      byteSize: value.byteLength,
      pageCount: decoder.decode(value).includes("booklet") ? 2 : 1,
      pdfVersion: "1.7",
    };
  }
}

const EMPTY_RESOURCES: ArtifactResourceClosure = { assets: [], fontFaces: [] };

function metadata(
  buildId: string,
  overrides: Partial<SuccessfulArtifactMetadata> = {},
): SuccessfulArtifactMetadata {
  return {
    buildId,
    bulletinLocalId: BULLETIN,
    artifactKind: "finalCandidate",
    createdAt: "2026-07-12T12:00:00Z",
    startedAt: "2026-07-12T12:00:01Z",
    completedAt: "2026-07-12T12:00:02Z",
    outputForm: "readerOrder",
    readinessProfile: "printFinal",
    canonicalRevisionToken: H_REVISION,
    renderInputHash: H_RENDER,
    readinessInputHash: H_READINESS_A,
    toolIdentities: [{ toolId: "typst", version: "0.13.1", hash: hash("typst") }],
    schemaIdentities: [{ schemaId: "document", version: 1, hash: hash("schema") }],
    diagnosticCodes: [],
    ...overrides,
  };
}

function expectedPdf(value = PDF) {
  return {
    hash: hash(value),
    byteSize: value.byteLength,
    pageCount: decoder.decode(value).includes("booklet") ? 2 : 1,
    pdfVersion: "1.7",
  };
}

function harness() {
  const storage = new MemoryArtifactStorage();
  const pdfs = new PdfValidator();
  return {
    storage,
    pdfs,
    store: new ImmutableArtifactStore({
      storage,
      pdfs,
      hashes: { digest: (value) => hash(value) },
      records: { validate: () => true },
    }),
  };
}

async function compile(
  store: ImmutableArtifactStore,
  buildId = BUILD_A,
  overrides: Partial<SuccessfulArtifactMetadata> = {},
): Promise<ArtifactRecord> {
  return store.persistCompile({
    metadata: metadata(buildId, overrides),
    source: SOURCE,
    sourceHash: hash(SOURCE),
    pdfBytes: PDF,
    expectedPdf: expectedPdf(),
    renderProjectionHash: hash("projection"),
    generatorVersion: "cbb-typstgen-v1",
    resources: EMPTY_RESOURCES,
  });
}

describe("ImmutableArtifactStore", () => {
  it("publishes write-ahead intent before bytes and removes it after the record commit marker", async () => {
    const storage = new JournaledMemoryArtifactStorage();
    const store = new ImmutableArtifactStore({
      storage,
      pdfs: new PdfValidator(),
      hashes: { digest: (value) => hash(value) },
      records: { validate: () => true },
    });

    await compile(store);

    expect(storage.events).toEqual([
      "journal:begin",
      "install:typ",
      "install:pdf",
      "install:record",
      "journal:finish",
    ]);
  });

  it("removes write-ahead intent only after exact partial-output rollback", async () => {
    const storage = new JournaledMemoryArtifactStorage();
    storage.failByteExtension = "pdf";
    const store = new ImmutableArtifactStore({
      storage,
      pdfs: new PdfValidator(),
      hashes: { digest: (value) => hash(value) },
      records: { validate: () => true },
    });

    await expect(compile(store)).rejects.toThrow("simulated pdf install failure");

    expect(storage.events).toEqual([
      "journal:begin",
      "install:typ",
      "delete:typ",
      "journal:finish",
    ]);
  });

  it("installs compile .typ and .pdf immutably, verifies them, and writes the record last", async () => {
    const { store, storage } = harness();
    const record = await compile(store);

    expect(storage.events).toEqual(["install:typ", "install:pdf", "install:record"]);
    expect(storage.text(BUILD_A, "typ")).toBe(decoder.decode(SOURCE));
    expect(storage.text(BUILD_A, "pdf")).toBe(decoder.decode(PDF));
    expect(record.outputEvidence).toMatchObject({
      mode: "compile",
      typstRelativePath: `artifacts/${BULLETIN}/${BUILD_A}.typ`,
      typstHash: hash(SOURCE),
      pdf: { relativePath: `artifacts/${BULLETIN}/${BUILD_A}.pdf`, hash: hash(PDF) },
    });
    expect(await store.readArtifact(BULLETIN, BUILD_A)).toEqual(record);

    await expect(compile(store)).rejects.toMatchObject({ kind: "immutableCollision" });
    expect(storage.text(BUILD_A, "typ")).toBe(decoder.decode(SOURCE));
    expect(storage.text(BUILD_A, "pdf")).toBe(decoder.decode(PDF));
  });

  it("persists non-success lifecycle records with no owned outputs", async () => {
    const { store, storage } = harness();
    const record: ArtifactRecord = {
      version: 1,
      kind: "artifactRecord",
      ...metadata(BUILD_A),
      status: "failed",
      executionMode: "compile",
      completedAt: "2026-07-12T12:00:02Z",
      diagnosticCodes: ["CBB-BUILD-0001"],
    };
    await store.persistNonSuccess(record);

    expect(storage.events).toEqual(["install:record"]);
    expect(storage.ownedBytes.size).toBe(0);

    await expect(store.persistNonSuccess({
      ...record,
      buildId: BUILD_B,
      status: "succeeded",
    })).rejects.toMatchObject({ kind: "invalidRecord" });
  });

  it("cleans verified partial compile bytes when PDF install fails", async () => {
    const { store, storage } = harness();
    storage.failByteExtension = "pdf";

    await expect(compile(store)).rejects.toThrow("simulated pdf install failure");

    expect(storage.records.size).toBe(0);
    expect(storage.ownedBytes.size).toBe(0);
    expect(storage.events).toEqual(["install:typ", "delete:typ"]);
  });

  it("cleans both outputs when post-install PDF reverification fails", async () => {
    const { store, storage, pdfs } = harness();
    pdfs.failAtCall = 2;

    await expect(compile(store)).rejects.toThrow("simulated PDF verifier failure");

    expect(storage.records.size).toBe(0);
    expect(storage.ownedBytes.size).toBe(0);
    expect(storage.events).toEqual([
      "install:typ", "install:pdf", "delete:pdf", "delete:typ",
    ]);
  });

  it("cleans both outputs when record installation fails", async () => {
    const { store, storage } = harness();
    storage.failRecordInstall = true;

    await expect(compile(store)).rejects.toThrow("simulated record install failure");

    expect(storage.records.size).toBe(0);
    expect(storage.ownedBytes.size).toBe(0);
    expect(storage.events).toEqual([
      "install:typ", "install:pdf", "delete:pdf", "delete:typ",
    ]);
  });

  it("removes an exact record and outputs when storage fails after the final record write", async () => {
    const { store, storage } = harness();
    storage.failRecordAfterInstall = true;

    await expect(compile(store)).rejects.toThrow("simulated failure after record install");

    expect(storage.records.size).toBe(0);
    expect(storage.ownedBytes.size).toBe(0);
    expect(storage.events).toEqual([
      "install:typ", "install:pdf", "install:record",
      "delete:record", "delete:pdf", "delete:typ",
    ]);
  });

  it("composes a PDF from verified reader evidence without inventing Typst", async () => {
    const { store, storage } = harness();
    const parent = await compile(store, BUILD_A, {
      artifactKind: "draft",
      readinessProfile: "draft",
      watermark: { kind: "draft", text: "DRAFT", version: "1" },
    });
    const composed = await store.persistCompose({
      metadata: metadata(BUILD_B, {
        artifactKind: "draft",
        outputForm: "bookletTwoUp",
        readinessProfile: "draft",
        watermark: { kind: "draft", text: "DRAFT", version: "1" },
      }),
      pdfBytes: COMPOSED_PDF,
      expectedPdf: expectedPdf(COMPOSED_PDF),
      parentReaderBuildId: BUILD_A,
      parentRenderInputHash: parent.renderInputHash,
      logicalPageCount: 1,
      imposedSideCount: 2,
      compositor: { toolId: "booklet", version: "1", hash: hash("compositor") },
      resources: EMPTY_RESOURCES,
    });

    expect(storage.text(BUILD_B, "typ")).toBeUndefined();
    expect(storage.text(BUILD_B, "pdf")).toBe(decoder.decode(COMPOSED_PDF));
    expect(composed.outputEvidence).toMatchObject({
      mode: "compose",
      parentReaderBuildId: BUILD_A,
      parentReaderPdfHash: hash(PDF),
      logicalPageCount: 1,
      imposedSideCount: 2,
    });

    const revalidated = await store.persistRevalidation({
      metadata: metadata(BUILD_C, {
        artifactKind: "draft",
        outputForm: "bookletTwoUp",
        readinessProfile: "draft",
        watermark: { kind: "draft", text: "DRAFT", version: "1" },
        renderInputHash: composed.renderInputHash,
        readinessInputHash: H_READINESS_B,
      }),
      sourceRenderBuildId: BUILD_B,
    });
    expect(storage.text(BUILD_C, "typ")).toBeUndefined();
    expect(storage.text(BUILD_C, "pdf")).toBeUndefined();
    expect(revalidated.outputEvidence).toMatchObject({
      mode: "revalidate",
      sourceRenderBuildId: BUILD_B,
      sourcePdfHash: hash(COMPOSED_PDF),
    });
    expect(revalidated.outputEvidence).not.toHaveProperty("sourceTypstHash");
  });

  it("revalidates verified reader bytes by reference and rejects source tampering", async () => {
    const { store, storage } = harness();
    await compile(store);
    const revalidated = await store.persistRevalidation({
      metadata: metadata(BUILD_B, {
        canonicalRevisionToken: hash("new canonical revision"),
        readinessInputHash: H_READINESS_B,
      }),
      sourceRenderBuildId: BUILD_A,
    });

    expect(storage.text(BUILD_B, "typ")).toBeUndefined();
    expect(storage.text(BUILD_B, "pdf")).toBeUndefined();
    expect(revalidated.outputEvidence).toMatchObject({
      mode: "revalidate",
      sourceRenderBuildId: BUILD_A,
      sourcePdfHash: hash(PDF),
      sourceTypstHash: hash(SOURCE),
      pdf: { relativePath: `artifacts/${BULLETIN}/${BUILD_A}.pdf` },
    });

    storage.ownedBytes.set(`${BULLETIN}/${BUILD_A}.pdf`, bytes("%PDF-1.7 tampered"));
    await expect(store.persistRevalidation({
      metadata: metadata(BUILD_C, { readinessInputHash: hash("third readiness") }),
      sourceRenderBuildId: BUILD_A,
    })).rejects.toMatchObject({ kind: "byteVerificationFailed" });
    expect(storage.records.has(`${BULLETIN}/${BUILD_C}.json`)).toBe(false);
  });

  it("rejects revalidation across render/output/watermark identity", async () => {
    const { store } = harness();
    await compile(store, BUILD_A, {
      artifactKind: "draft",
      readinessProfile: "draft",
      watermark: { kind: "draft", text: "DRAFT", version: "1" },
    });

    await expect(store.persistRevalidation({
      metadata: metadata(BUILD_B),
      sourceRenderBuildId: BUILD_A,
    })).rejects.toMatchObject({ kind: "sourceMismatch" });
  });

  it("rejects reader revalidation when the owning Typst bytes changed", async () => {
    const { store, storage } = harness();
    await compile(store);
    storage.ownedBytes.set(
      `${BULLETIN}/${BUILD_A}.typ`,
      bytes("#text(\"tampered source\")"),
    );

    await expect(store.persistRevalidation({
      metadata: metadata(BUILD_B, { readinessInputHash: H_READINESS_B }),
      sourceRenderBuildId: BUILD_A,
    })).rejects.toMatchObject({ kind: "sourceMismatch" });
    expect(storage.records.has(`${BULLETIN}/${BUILD_B}.json`)).toBe(false);
  });

  it("binds directly to the isolated compile runner evidence contract", async () => {
    const { store, storage } = harness();
    const resources: VerifiedResourceClosure = {
      assets: [],
      fonts: [],
      assetBindings: {},
      fontBindings: {},
      stagingEntries: [],
      warnings: [],
      totals: {
        assetCount: 0,
        assetBytes: 0,
        fontFamilyCount: 0,
        fontFaceCount: 0,
        fontBytes: 0,
      },
    };
    const sink = store.bindCompileSink({
      metadata: metadata(BUILD_A),
      renderProjectionHash: hash("projection"),
      generatorVersion: "cbb-typstgen-v1",
      resources: EMPTY_RESOURCES,
      outputReader: { readVerifiedPdf: async () => PDF },
    });

    const artifact = await sink.persistCompile({
      buildId: BUILD_A,
      source: SOURCE,
      sourceHash: hash(SOURCE),
      pdf: {
        handle: "opaque-output" as BuildOutputHandle,
        hash: hash(PDF),
        byteSize: PDF.byteLength,
        pageCount: 1,
        pdfVersion: "1.7",
        magicVerified: true,
      },
      tool: {
        toolId: "typst",
        version: "0.13.1",
        executableHash: hash("typst"),
      },
      resources,
    });

    expect(artifact.status).toBe("succeeded");
    expect(storage.events.at(-1)).toBe("install:record");
  });

  it("computes current/stale state without mutating historical records", async () => {
    const { store } = harness();
    const record = await compile(store);
    const before = JSON.stringify(record);

    expect(queryArtifactCurrency(record, {
      renderInputHash: H_RENDER,
      readinessInputHash: H_READINESS_A,
      outputForm: "readerOrder",
      readinessProfile: "printFinal",
    })).toMatchObject({ visualCurrent: true, readinessCurrent: true, current: true });
    expect(queryArtifactCurrency(record, {
      renderInputHash: H_RENDER,
      readinessInputHash: H_READINESS_B,
      outputForm: "readerOrder",
      readinessProfile: "printFinal",
    })).toEqual({
      visualCurrent: true,
      readinessCurrent: false,
      current: false,
      reasons: ["readinessInputChanged"],
    });
    expect(JSON.stringify(record)).toBe(before);
  });

  it("refuses to clean bytes whose hash changed after a failed install", async () => {
    const { store, storage, pdfs } = harness();
    const originalDelete = storage.deleteOwnedByteIfHash.bind(storage);
    pdfs.failAtCall = 2;
    storage.deleteOwnedByteIfHash = async (locator, expectedHash) => {
      if (locator.extension === "pdf") {
        storage.ownedBytes.set(locatorKey(locator), bytes("changed after verification failure"));
      }
      return originalDelete(locator, expectedHash);
    };

    await expect(compile(store)).rejects.toMatchObject({ kind: "cleanupFailed" });

    expect(storage.text(BUILD_A, "pdf")).toBe("changed after verification failure");
    expect(storage.text(BUILD_A, "typ")).toBe(decoder.decode(SOURCE));
    expect(storage.records.size).toBe(0);
  });
});
