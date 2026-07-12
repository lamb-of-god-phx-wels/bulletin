import { hashBytes } from "@cbb/core";
import type { SchemaCatalog, Sha256Hash } from "@cbb/core";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BuildOutputHandle } from "../build/runner.js";
import {
  ARTIFACT_RECORD_SCHEMA_ID,
  NodeCompileOutputHandleRegistry,
  createArtifactRecordSchemaValidator,
  createNodeArtifactPdfValidator,
  createNodeArtifactStoragePort,
  createNodeCompileOutputReader,
  type PdfInspectorIdentity,
  type PinnedPdfInspectorPort,
} from "./nodeAdapters.js";
import type {
  ArtifactOwnedByteLocator,
  ArtifactRecord,
  ArtifactRecordLocator,
} from "./types.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const bytes = (value: string): Uint8Array => encoder.encode(value);
const hash = (value: Uint8Array | string): Sha256Hash =>
  hashBytes(typeof value === "string" ? bytes(value) : value);

const BULLETIN = "11111111-1111-4111-8111-111111111111";
const BUILD = "22222222-2222-4222-8222-222222222222";
const RECORD_LOCATOR: ArtifactRecordLocator = {
  kind: "artifactRecord",
  bulletinLocalId: BULLETIN,
  buildId: BUILD,
};
const PDF_LOCATOR: ArtifactOwnedByteLocator = {
  kind: "artifactOwnedByte",
  bulletinLocalId: BULLETIN,
  buildId: BUILD,
  extension: "pdf",
};

const temporaryRoots: string[] = [];

async function temporaryRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `cbb-${label}-`));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true }),
  ));
});

function record(): ArtifactRecord {
  return {
    version: 1,
    kind: "artifactRecord",
    buildId: BUILD,
    bulletinLocalId: BULLETIN,
    artifactKind: "finalCandidate",
    status: "failed",
    executionMode: "compile",
    createdAt: "2026-07-12T12:00:00Z",
    completedAt: "2026-07-12T12:00:01Z",
    outputForm: "readerOrder",
    readinessProfile: "printFinal",
    canonicalRevisionToken: hash("revision"),
    renderInputHash: hash("render"),
    readinessInputHash: hash("readiness"),
    toolIdentities: [],
    schemaIdentities: [],
    diagnosticCodes: ["CBB-BUILD-0001"],
  };
}

describe("Node artifact storage adapter", () => {
  it("derives the fixed path, creates durably and never overwrites", async () => {
    const root = await temporaryRoot("artifact-storage");
    const storage = await createNodeArtifactStoragePort(root);
    const first = bytes("%PDF-1.7\nfirst\n%%EOF\n");
    const second = bytes("%PDF-1.7\nreplacement\n%%EOF\n");

    expect(await storage.installOwnedByteExclusive(PDF_LOCATOR, first)).toBe(true);
    expect(await storage.installOwnedByteExclusive(PDF_LOCATOR, second)).toBe(false);
    expect(decoder.decode(await storage.readOwnedByte(PDF_LOCATOR))).toBe(decoder.decode(first));
    expect(decoder.decode(await readFile(
      join(root, "artifacts", BULLETIN, `${BUILD}.pdf`),
    ))).toBe(decoder.decode(first));

    expect(await storage.installRecordExclusive(RECORD_LOCATOR, record())).toBe(true);
    expect(await storage.installRecordExclusive(RECORD_LOCATOR, {
      ...record(), diagnosticCodes: ["CBB-SECURITY-0001"],
    })).toBe(false);
    expect(await storage.readRecord(RECORD_LOCATOR)).toEqual(record());
  });

  it("rereads and compares exact bytes or hashes before deletion", async () => {
    const root = await temporaryRoot("artifact-delete");
    const storage = await createNodeArtifactStoragePort(root);
    const pdf = bytes("%PDF-1.7\nowned\n%%EOF\n");
    const originalRecord = record();
    await storage.installOwnedByteExclusive(PDF_LOCATOR, pdf);
    await storage.installRecordExclusive(RECORD_LOCATOR, originalRecord);

    expect(await storage.deleteOwnedByteIfHash(PDF_LOCATOR, hash("not owned"))).toBe(false);
    expect(await storage.readOwnedByte(PDF_LOCATOR)).toEqual(pdf);
    expect(await storage.deleteRecordIfUnchanged(RECORD_LOCATOR, {
      ...originalRecord, diagnosticCodes: [],
    })).toBe(false);
    expect(await storage.readRecord(RECORD_LOCATOR)).toEqual(originalRecord);

    expect(await storage.deleteOwnedByteIfHash(PDF_LOCATOR, hash(pdf))).toBe(true);
    expect(await storage.deleteRecordIfUnchanged(RECORD_LOCATOR, originalRecord)).toBe(true);
    expect(await storage.readOwnedByte(PDF_LOCATOR)).toBeUndefined();
    expect(await storage.readRecord(RECORD_LOCATOR)).toBeUndefined();
  });

  it("rejects symlink path components and redacts the underlying paths", async () => {
    const root = await temporaryRoot("artifact-symlink");
    const outside = await temporaryRoot("artifact-outside");
    await symlink(outside, join(root, "artifacts"));
    const storage = await createNodeArtifactStoragePort(root);

    let failure: unknown;
    try {
      await storage.readOwnedByte(PDF_LOCATOR);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      code: "CBB-SECURITY-0001",
      kind: "storageBoundaryRejected",
    });
    expect((failure as Error).message).not.toContain(root);
    expect((failure as Error).message).not.toContain(outside);
  });

  it("rejects hard-linked files and refuses symlink collisions without touching their target", async () => {
    const root = await temporaryRoot("artifact-links");
    const storage = await createNodeArtifactStoragePort(root);
    const pdf = bytes("%PDF-1.7\nowned\n%%EOF\n");
    await storage.installOwnedByteExclusive(PDF_LOCATOR, pdf);
    const installed = join(root, "artifacts", BULLETIN, `${BUILD}.pdf`);
    await link(installed, join(root, "second-link.pdf"));
    await expect(storage.readOwnedByte(PDF_LOCATOR)).rejects.toMatchObject({
      kind: "storageBoundaryRejected",
    });

    const otherBuild = "33333333-3333-4333-8333-333333333333";
    const victim = join(root, "victim.pdf");
    await writeFile(victim, "do not replace");
    await symlink(victim, join(root, "artifacts", BULLETIN, `${otherBuild}.pdf`));
    await expect(storage.installOwnedByteExclusive({
      ...PDF_LOCATOR,
      buildId: otherBuild,
    }, pdf)).rejects.toMatchObject({ kind: "storageBoundaryRejected" });
    expect(await readFile(victim, "utf8")).toBe("do not replace");
  });

  it("rejects forged locator properties and traversal identities", async () => {
    const root = await temporaryRoot("artifact-locator");
    const storage = await createNodeArtifactStoragePort(root);
    await expect(storage.readOwnedByte({
      ...PDF_LOCATOR,
      buildId: "../../victim",
    } as ArtifactOwnedByteLocator)).rejects.toMatchObject({
      kind: "storageBoundaryRejected",
    });
    await expect(storage.readRecord({
      ...RECORD_LOCATOR,
      unexpected: "path",
    } as ArtifactRecordLocator)).rejects.toMatchObject({
      kind: "storageBoundaryRejected",
    });
  });
});

describe("artifact schema and compile output adapters", () => {
  it("binds validation to only the closed artifact record schema", () => {
    const calls: string[] = [];
    const catalog: SchemaCatalog = {
      validateAgainst(schemaId, value) {
        calls.push(schemaId);
        return value === "valid" ? { valid: true } : {
          valid: false,
          errors: [{ instancePath: "", keyword: "test", message: "invalid", schemaPath: "" }],
        };
      },
      schemaIds: () => [ARTIFACT_RECORD_SCHEMA_ID],
    };
    const validator = createArtifactRecordSchemaValidator(catalog);
    expect(validator.validate("valid")).toBe(true);
    expect(validator.validate("invalid")).toBe(false);
    expect(calls).toEqual([ARTIFACT_RECORD_SCHEMA_ID, ARTIFACT_RECORD_SCHEMA_ID]);
  });

  it("reads only registered fixed-layout output handles and detects later tampering", async () => {
    const root = await temporaryRoot("compile-outputs");
    await mkdir(join(root, BUILD));
    const pdf = bytes("%PDF-1.7\ncompile output\n%%EOF\n");
    const path = join(root, BUILD, "output.pdf");
    await writeFile(path, pdf);
    const registry = await NodeCompileOutputHandleRegistry.create(root);
    const handle = await registry.registerVerifiedPdf(BUILD, {
      hash: hash(pdf),
      byteSize: pdf.byteLength,
    });
    const reader = createNodeCompileOutputReader(registry);

    expect(await reader.readVerifiedPdf(handle)).toEqual(pdf);
    await expect(reader.readVerifiedPdf(
      "artifact-output:33333333-3333-4333-8333-333333333333" as BuildOutputHandle,
    )).rejects.toMatchObject({ kind: "compileOutputRejected" });

    await writeFile(path, bytes("same location, changed bytes"));
    await expect(reader.readVerifiedPdf(handle)).rejects.toMatchObject({
      code: "CBB-SECURITY-0001",
      kind: "compileOutputRejected",
    });
    expect(registry.revoke(handle)).toBe(true);
  });

  it("rejects hard-linked compile output during handle registration", async () => {
    const root = await temporaryRoot("compile-hardlink");
    await mkdir(join(root, BUILD));
    const pdf = bytes("%PDF-1.7\ncompile output\n%%EOF\n");
    const path = join(root, BUILD, "output.pdf");
    await writeFile(path, pdf);
    await link(path, join(root, "other.pdf"));
    const registry = await NodeCompileOutputHandleRegistry.create(root);
    await expect(registry.registerVerifiedPdf(BUILD, {
      hash: hash(pdf),
      byteSize: pdf.byteLength,
    })).rejects.toMatchObject({ kind: "compileOutputRejected" });
  });
});

describe("Node artifact PDF validator", () => {
  const identity: PdfInspectorIdentity = {
    toolId: "pdf-inspector",
    version: "4.2.0",
    hash: hash("pinned pdf inspector"),
  };

  function inspector(
    inspect: PinnedPdfInspectorPort["inspect"] = async () => ({
      pageCount: 2,
      pdfVersion: "1.7",
      standards: ["PDF/A-2b", "PDF/UA-1"],
      validationReportHash: hash("report"),
    }),
  ): PinnedPdfInspectorPort {
    return { identity: { ...identity }, inspect };
  }

  it("owns magic, EOF, hash and bounds while requiring pinned structural evidence", async () => {
    const pdf = bytes("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
    const validator = createNodeArtifactPdfValidator({
      inspector: inspector(),
      pinnedIdentity: identity,
      maximumByteSize: 1_024,
      maximumPageCount: 10,
    });
    await expect(validator.verify(pdf)).resolves.toEqual({
      hash: hash(pdf),
      byteSize: pdf.byteLength,
      pageCount: 2,
      pdfVersion: "1.7",
      standards: ["PDF/A-2b", "PDF/UA-1"],
      validationReportHash: hash("report"),
    });
  });

  it("rejects bad magic or missing terminal EOF before trusting the inspector", async () => {
    let calls = 0;
    const validator = createNodeArtifactPdfValidator({
      inspector: inspector(async () => {
        calls += 1;
        return { pageCount: 1, pdfVersion: "1.7", standards: [] };
      }),
      pinnedIdentity: identity,
    });
    await expect(validator.verify(bytes("not-pdf\n%%EOF\n"))).rejects.toMatchObject({
      kind: "pdfValidationRejected",
    });
    await expect(validator.verify(bytes("%PDF-1.7\nno eof marker"))).rejects.toMatchObject({
      kind: "pdfValidationRejected",
    });
    expect(calls).toBe(0);
  });

  it("rejects missing inspector standards, invalid page evidence, and pin changes", async () => {
    const pdf = bytes("%PDF-1.7\n1 0 obj\n%%EOF\n");
    const missingStandards = createNodeArtifactPdfValidator({
      inspector: inspector(async () => ({
        pageCount: 1,
        pdfVersion: "1.7",
      } as never)),
      pinnedIdentity: identity,
    });
    await expect(missingStandards.verify(pdf)).rejects.toMatchObject({
      kind: "pdfValidationRejected",
    });

    const badPages = createNodeArtifactPdfValidator({
      inspector: inspector(async () => ({
        pageCount: 0,
        pdfVersion: "1.7",
        standards: [],
      })),
      pinnedIdentity: identity,
    });
    await expect(badPages.verify(pdf)).rejects.toMatchObject({ kind: "pdfValidationRejected" });

    const changingInspector = inspector();
    const changedPin = createNodeArtifactPdfValidator({
      inspector: changingInspector,
      pinnedIdentity: identity,
    });
    (changingInspector.identity as { version: string }).version = "untrusted";
    await expect(changedPin.verify(pdf)).rejects.toMatchObject({ kind: "pdfValidationRejected" });
  });
});
