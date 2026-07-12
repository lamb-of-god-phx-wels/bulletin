import { describe, expect, it } from "vitest";
import {
  hashBytes,
  parseLocalResourceId,
  parsePortableAssetRef,
  parsePortableFontRef,
  parseWorkspaceId,
} from "@cbb/core";
import {
  QUARANTINE_HARD_LIMITS,
  quarantineHandle,
  runQuarantineRequest,
  type QuarantineRequest,
  type QuarantineSuccess,
  type VerifiedQuarantineReceipt,
} from "@cbb/workers";
import type { TransactionDigest } from "../transactions/index.js";
import type { WorkspaceRegistry } from "../workspace/index.js";
import {
  computeFontFamilyDigest,
  planAssetRevisionInstall,
  planFontRevisionInstall,
  workspaceResourceTransactionPaths,
  type AssetRevisionRecord,
  type FontRevisionRecord,
  type ManagedFontFaceRecord,
} from "./index.js";

const uuid = (digit: string) =>
  `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const sourceDigest = hashBytes(new TextEncoder().encode("source")) as TransactionDigest;
const registry: WorkspaceRegistry = {
  version: 1,
  kind: "workspace",
  workspaceId: parseWorkspaceId(uuid("9")),
  assets: [],
  fonts: [],
};

let receiptSequence = 0;

async function verifiedReceipt(
  operation: "canonicalizeRaster" | "inspectFont",
  value: Uint8Array,
  mediaType: "image/png" | "font/ttf",
  fontStyle: "normal" | "italic" = "normal",
): Promise<VerifiedQuarantineReceipt> {
  const sequence = (++receiptSequence).toString(16).padStart(2, "0");
  const input = quarantineHandle(`qh:${"a".repeat(62)}${sequence}`);
  const output = quarantineHandle(`qh:${"b".repeat(62)}${sequence}`);
  const requestId = `00000000-0000-4000-8000-${receiptSequence.toString(16).padStart(12, "0")}`;
  const request: QuarantineRequest = operation === "canonicalizeRaster"
    ? {
        version: 1,
        requestId,
        operation,
        input,
        output,
        limits: QUARANTINE_HARD_LIMITS.canonicalizeRaster,
      }
    : {
        version: 1,
        requestId,
        operation,
        input,
        output,
        limits: QUARANTINE_HARD_LIMITS.inspectFont,
      };
  const common = {
    version: 1 as const,
    requestId,
    status: "succeeded" as const,
    output,
    outputHash: hashBytes(value) as `sha256:${string}`,
    outputBytes: value.byteLength,
  };
  const result: QuarantineSuccess = operation === "canonicalizeRaster"
    ? {
        ...common,
        operation,
        mediaType: "image/png",
        observed: { inputBytes: value.byteLength, decodedPixels: 1, width: 1, height: 1 },
      }
    : {
        ...common,
        operation,
        mediaType: "font/ttf",
        observed: { inputBytes: value.byteLength },
        faces: [{
          faceIndex: 0,
          familyName: "Managed Font",
          postScriptName: fontStyle === "italic" ? "ManagedFont-Italic" : "ManagedFont-Regular",
          weight: 400,
          style: fontStyle,
          stretch: 1,
          pdfEmbeddingPermitted: true,
          pdfSubsettingPermitted: true,
        }],
        typstLoadable: true,
        unicodeCoverageSummary: "U+0000-10FFFF test coverage",
      };
  const broker = await runQuarantineRequest(
    request,
    {
      isolationAvailable: true,
      execute: async () => result,
      terminate: async () => undefined,
    },
    { raceTimeout: async (work) => ({ kind: "completed", value: await work }) },
    {
      verifyAndRehash: async (verification) => ({
        version: 1,
        requestId: verification.requestId,
        operation: verification.operation,
        output: verification.output,
        hash: hashBytes(value),
        byteSize: value.byteLength,
        mediaType,
      }),
    },
  );
  if (broker.status !== "succeeded") throw new Error("Test quarantine receipt failed");
  return broker.receipt;
}

function assetBytes(): Uint8Array {
  return new TextEncoder().encode("canonical image bytes");
}

function assetRecord(): AssetRevisionRecord {
  const bytes = assetBytes();
  return {
    version: 1,
    kind: "assetRecord",
    localId: parseLocalResourceId(uuid("1")),
    portableAssetId: parsePortableAssetRef(`asset:${uuid("2")}`),
    displayName: "Logo",
    mediaType: "image/png",
    canonicalHash: hashBytes(bytes),
    byteSize: bytes.byteLength,
    width: 1,
    height: 1,
    sanitizationState: "validated",
    aiVisibility: "private",
    importedAt: "2026-07-12T12:00:00.000Z",
  };
}

function fontFixture() {
  const regularBytes = new TextEncoder().encode("regular font");
  const italicBytes = new TextEncoder().encode("italic font");
  const faces: ManagedFontFaceRecord[] = [
    {
      faceId: "regular",
      faceIndex: 0,
      format: "ttf",
      weight: 400,
      style: "normal",
      stretch: 1,
      hash: hashBytes(regularBytes),
      byteSize: regularBytes.byteLength,
    },
    {
      faceId: "italic",
      faceIndex: 0,
      format: "ttf",
      weight: 400,
      style: "italic",
      stretch: 1,
      hash: hashBytes(italicBytes),
      byteSize: italicBytes.byteLength,
    },
  ];
  const record: FontRevisionRecord = {
    version: 1,
    kind: "fontRecord",
    localId: parseLocalResourceId(uuid("3")),
    portableFontId: parsePortableFontRef(`font:${uuid("4")}`),
    familyDigest: computeFontFamilyDigest(faces),
    displayName: "Managed Font",
    typstFamilyName: "Managed Font",
    redistributionAsserted: true,
    exportable: true,
    pdfEmbeddingPermitted: true,
    pdfSubsettingPermitted: true,
    validationState: "validated",
    unicodeCoverageSummary: "U+0000-10FFFF test coverage",
    faces,
  };
  return { record, regularBytes, italicBytes };
}

describe("immutable resource transaction planning", () => {
  it("plans canonical asset bytes and metadata before the registry commit marker", async () => {
    const record = assetRecord();
    const validationReceipt = await verifiedReceipt(
      "canonicalizeRaster",
      assetBytes(),
      "image/png",
    );
    const plan = planAssetRevisionInstall({
      sourceDigest,
      registry,
      record,
      canonicalBytes: assetBytes(),
      validationReceipt,
    });
    expect(plan.request.mutations.map((step) => [step.resourceKey, step.commitMarker ?? false])).toEqual([
      [`assetCanonical:${record.localId}`, false],
      [`assetRecord:${record.localId}`, false],
      ["workspaceRegistry", true],
    ]);
    expect(plan.updatedRegistry.assets?.[0]).toMatchObject({
      localId: record.localId,
      storagePath: `assets/${record.localId}/asset.json`,
    });
  });

  it("rejects changed canonical bytes, forged receipts, and local-id reuse", async () => {
    const record = assetRecord();
    const validationReceipt = await verifiedReceipt(
      "canonicalizeRaster",
      assetBytes(),
      "image/png",
    );
    expect(() =>
      planAssetRevisionInstall({
        sourceDigest,
        registry,
        record,
        canonicalBytes: new TextEncoder().encode("changed"),
        validationReceipt,
      }),
    ).toThrow(/do not match/);
    expect(() =>
      planAssetRevisionInstall({
        sourceDigest,
        registry: {
          ...registry,
          assets: [
            {
              localId: record.localId,
              kind: "asset",
              displayName: "Existing",
              storagePath: `assets/${record.localId}/asset.json`,
              contentHash: hashBytes(assetBytes()),
              createdAt: record.importedAt,
              modifiedAt: record.importedAt,
            },
          ],
        },
        record,
        canonicalBytes: assetBytes(),
        validationReceipt,
      }),
    ).toThrow(/new local id/);
    expect(() =>
      planAssetRevisionInstall({
        sourceDigest,
        registry,
        record,
        canonicalBytes: assetBytes(),
        validationReceipt: Object.freeze({}) as VerifiedQuarantineReceipt,
      }),
    ).toThrow(/broker-verified/);
  });

  it("plans the exact validated font-face closure and rejects missing/surplus faces", async () => {
    const { record, regularBytes, italicBytes } = fontFixture();
    const regularReceipt = await verifiedReceipt("inspectFont", regularBytes, "font/ttf");
    const italicReceipt = await verifiedReceipt("inspectFont", italicBytes, "font/ttf", "italic");
    const plan = planFontRevisionInstall({
      sourceDigest,
      registry,
      record,
      installedAt: "2026-07-12T12:00:00.000Z",
      faces: [
        { faceId: "italic", bytes: italicBytes, validationReceipt: italicReceipt },
        { faceId: "regular", bytes: regularBytes, validationReceipt: regularReceipt },
      ],
    });
    expect(plan.request.mutations.map((step) => step.resourceKey)).toEqual([
      `fontFace:${record.localId}:italic`,
      `fontFace:${record.localId}:regular`,
      `fontRecord:${record.localId}`,
      "workspaceRegistry",
    ]);
    expect(() =>
      planFontRevisionInstall({
        sourceDigest,
        registry,
        record,
        installedAt: "2026-07-12T12:00:00.000Z",
        faces: [{ faceId: "regular", bytes: regularBytes, validationReceipt: regularReceipt }],
      }),
    ).toThrow(/incomplete/);
    expect(() =>
      planFontRevisionInstall({
        sourceDigest,
        registry,
        record,
        installedAt: "2026-07-12T12:00:00.000Z",
        faces: [
          { faceId: "regular", bytes: regularBytes, validationReceipt: regularReceipt },
          { faceId: "italic", bytes: italicBytes, validationReceipt: italicReceipt },
          { faceId: "surplus", bytes: new Uint8Array([1]), validationReceipt: regularReceipt },
        ],
      }),
    ).toThrow(/surplus/);
    expect(() =>
      planFontRevisionInstall({
        sourceDigest,
        registry,
        record: { ...record, pdfEmbeddingPermitted: false },
        installedAt: "2026-07-12T12:00:00.000Z",
        faces: [
          { faceId: "regular", bytes: regularBytes, validationReceipt: regularReceipt },
          { faceId: "italic", bytes: italicBytes, validationReceipt: italicReceipt },
        ],
      }),
    ).toThrow(/inspection metadata/);
  });

  it("maps only closed resource keys to fixed workspace-relative locations", () => {
    const record = assetRecord();
    expect(workspaceResourceTransactionPaths.resolve("workspaceRegistry")).toBe("workspace.json");
    expect(
      workspaceResourceTransactionPaths.resolve(`assetCanonical:${record.localId}`),
    ).toBe(`assets/${record.localId}/canonical`);
    expect(workspaceResourceTransactionPaths.resolve("assetCanonical:../../etc/passwd")).toBeUndefined();
    expect(workspaceResourceTransactionPaths.resolve("/absolute/path")).toBeUndefined();
  });

  it("rejects invalid install timestamps before producing registry metadata", async () => {
    const { record, regularBytes, italicBytes } = fontFixture();
    const regularReceipt = await verifiedReceipt("inspectFont", regularBytes, "font/ttf");
    const italicReceipt = await verifiedReceipt("inspectFont", italicBytes, "font/ttf", "italic");
    expect(() =>
      planFontRevisionInstall({
        sourceDigest,
        registry,
        record,
        installedAt: "not-a-time",
        faces: [
          { faceId: "regular", bytes: regularBytes, validationReceipt: regularReceipt },
          { faceId: "italic", bytes: italicBytes, validationReceipt: italicReceipt },
        ],
      }),
    ).toThrow(/canonical UTC/);
  });
});
