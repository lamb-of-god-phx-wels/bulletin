import {
  MANDATORY_BUNDLED_FONTS,
  assertMaterializedMandatoryBundledFonts,
  isPortableAssetRef,
  isPortableFontRef,
} from "@cbb/core";
import type {
  PortableAssetRef,
  PortableFontRef,
  SelectedFontFaceIdentity,
  VerifiedAssetIdentity,
  VerifiedFontIdentity,
} from "@cbb/core";
import type {
  AssetRevisionRecord,
  AssetStagingEntry,
  FontFaceStagingEntry,
  FontRevisionRecord,
  ResolveResourceClosureRequest,
  ResourceByteVerificationRequest,
  ResourceClosureWarning,
  ResourceStagingEntry,
  VerifiedResourceClosure,
} from "./types.js";
import { ResourceContractError } from "./types.js";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

export const RESOURCE_CLOSURE_LIMITS = Object.freeze({
  assetCountWarning: 1_000,
  assetCountHard: 5_000,
  assetFileBytesWarning: 100 * MIB,
  assetFileBytesHard: 500 * MIB,
  assetTotalBytesWarning: 1 * GIB,
  assetTotalBytesHard: 4 * GIB,
  fontFaceCountWarning: 64,
  fontFaceCountHard: 256,
  fontFaceBytesWarning: 20 * MIB,
  fontFaceBytesHard: 50 * MIB,
  fontTotalBytesWarning: 250 * MIB,
  fontTotalBytesHard: 1 * GIB,
});

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function assertHardLimit(
  observed: number,
  maximum: number,
  subject: string,
  code: "CBB-ASSET-0001" | "CBB-FONT-0001",
): void {
  if (!Number.isSafeInteger(observed) || observed < 0 || observed > maximum) {
    throw new ResourceContractError(
      "resourceLimitExceeded",
      code,
      `Resolved resource closure exceeds its deterministic hard cap (${observed} > ${maximum})`,
      subject,
    );
  }
}

function warning(
  warnings: ResourceClosureWarning[],
  kind: ResourceClosureWarning["kind"],
  observed: number,
  threshold: number,
  subject?: string,
): void {
  if (observed <= threshold) return;
  warnings.push({
    kind,
    observed,
    warningThreshold: threshold,
    ...(subject !== undefined ? { subject } : {}),
  });
}

function uniqueProjectionAssets(
  values: readonly { readonly assetRef: string }[],
): PortableAssetRef[] {
  if (!Array.isArray(values)) {
    throw new ResourceContractError(
      "invalidProjectionClosure",
      "CBB-ASSET-0001",
      "Render projection asset references must be an array",
    );
  }
  const seen = new Set<string>();
  const result: PortableAssetRef[] = [];
  for (const entry of values) {
    const value = entry?.assetRef;
    if (typeof value !== "string" || !isPortableAssetRef(value)) {
      throw new ResourceContractError(
        "invalidProjectionClosure",
        "CBB-ASSET-0001",
        "Render projection contains an invalid portable asset reference",
      );
    }
    if (seen.has(value)) {
      throw new ResourceContractError(
        "invalidProjectionClosure",
        "CBB-ASSET-0001",
        "Render projection contains a duplicate portable asset reference",
        value,
      );
    }
    seen.add(value);
    result.push(value);
  }
  return result.sort(compareText);
}

function uniqueProjectionFonts(
  values: readonly { readonly fontRef: string }[],
): PortableFontRef[] {
  if (!Array.isArray(values)) {
    throw new ResourceContractError(
      "invalidProjectionClosure",
      "CBB-FONT-0001",
      "Render projection font references must be arrays",
    );
  }
  const seenProjection = new Set<string>();
  const result: PortableFontRef[] = [];
  for (const entry of values) {
    const value = entry?.fontRef;
    if (typeof value !== "string" || !isPortableFontRef(value)) {
      throw new ResourceContractError(
        "invalidProjectionClosure",
        "CBB-FONT-0001",
        "Render projection contains an invalid portable font reference",
      );
    }
    if (seenProjection.has(value)) {
      throw new ResourceContractError(
        "invalidProjectionClosure",
        "CBB-FONT-0001",
        "Render projection contains a duplicate portable font reference",
        value,
      );
    }
    seenProjection.add(value);
    result.push(value);
  }
  return result.sort(compareText);
}

function assetExtension(mediaType: string): string {
  switch (mediaType.toLowerCase()) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/svg+xml":
      return "svg";
    case "application/pdf":
      return "pdf";
    default:
      return "bin";
  }
}

function padded(value: number): string {
  return value.toString(10).padStart(4, "0");
}

async function verifyBytes(
  request: ResourceByteVerificationRequest,
  verifier: ResolveResourceClosureRequest["verifier"],
  subject: string,
): Promise<void> {
  let result;
  try {
    result = await verifier.verify(request);
  } catch {
    // The verifier may have access to private paths/tool errors. Do not let a
    // thrown implementation detail escape this service boundary.
    throw new ResourceContractError(
      "byteVerificationFailed",
      "CBB-SECURITY-0001",
      "No-follow resource byte verification failed",
      subject,
    );
  }
  if (
    result.observedHash !== request.expectedHash ||
    result.observedByteSize !== request.expectedByteSize ||
    result.observedByteSize > request.maximumByteSize
  ) {
    throw new ResourceContractError(
      "byteVerificationFailed",
      "CBB-SECURITY-0001",
      "Resource bytes do not match the immutable resolver identity",
      subject,
    );
  }
}

function resolveAssetRecords(
  refs: readonly PortableAssetRef[],
  request: ResolveResourceClosureRequest,
): AssetRevisionRecord[] {
  return refs.map((ref) => {
    const record = request.index.assetsByRef.get(ref);
    if (record === undefined) {
      throw new ResourceContractError(
        "missingAsset",
        "CBB-ASSET-0001",
        "A required portable asset revision is not installed",
        ref,
      );
    }
    if (record.sanitizationState !== "validated") {
      throw new ResourceContractError(
        "assetNotValidated",
        "CBB-ASSET-0001",
        "A required asset revision has not passed canonical-byte validation",
        ref,
      );
    }
    return record;
  });
}

function resolveFontRecords(
  refs: readonly PortableFontRef[],
  request: ResolveResourceClosureRequest,
): FontRevisionRecord[] {
  const selectorOwners = new Map<string, PortableFontRef>();
  return refs.map((ref) => {
    const record = request.index.fontsByRef.get(ref);
    if (record === undefined) {
      throw new ResourceContractError(
        "missingFont",
        "CBB-FONT-0001",
        "A required portable font revision is not installed",
        ref,
      );
    }
    if (record.validationState !== "validated") {
      throw new ResourceContractError(
        "fontNotValidated",
        "CBB-FONT-0001",
        "A required font revision has not passed isolated validation",
        ref,
      );
    }
    if (!record.pdfEmbeddingPermitted) {
      throw new ResourceContractError(
        "fontEmbeddingBlocked",
        "CBB-FONT-0003",
        "A required font revision does not permit PDF embedding",
        ref,
      );
    }
    const mandatory = MANDATORY_BUNDLED_FONTS.find(
      (font) => font.fontRef === ref,
    );
    if (mandatory !== undefined && record.typstFamilyName !== mandatory.familyName) {
      throw new ResourceContractError(
        "invalidRecord",
        "CBB-FONT-0001",
        `The release-owned bundled font record must expose ${mandatory.familyName}`,
        ref,
      );
    }
    const selector = record.typstFamilyName.normalize("NFC").toLowerCase();
    const owner = selectorOwners.get(selector);
    if (owner !== undefined && owner !== ref) {
      throw new ResourceContractError(
        "ambiguousFontFamily",
        "CBB-FONT-0001",
        "Two required font revisions have an ambiguous Typst family selector",
        ref,
      );
    }
    selectorOwners.set(selector, ref);
    return record;
  });
}

/**
 * Resolve, verify, and snapshot the exact output resource closure.
 *
 * Catalog resources not named by the materialized projection are never
 * returned, hashed, or staged.
 */
export async function resolveVerifiedResourceClosure(
  request: ResolveResourceClosureRequest,
): Promise<VerifiedResourceClosure> {
  try {
    assertMaterializedMandatoryBundledFonts(
      request.projection,
      "resolveVerifiedResourceClosure",
    );
  } catch {
    throw new ResourceContractError(
      "invalidProjectionClosure",
      "CBB-FONT-0001",
      "Render projection is missing the exact release-owned bundled font fallback closure",
    );
  }
  const assetRefs = uniqueProjectionAssets(request.projection.referencedAssets);
  const fontRefs = uniqueProjectionFonts(
    request.projection.referencedFonts,
  );
  assertHardLimit(assetRefs.length, RESOURCE_CLOSURE_LIMITS.assetCountHard, "assets", "CBB-ASSET-0001");

  const assetRecords = resolveAssetRecords(assetRefs, request);
  const fontRecords = resolveFontRecords(fontRefs, request);
  const fontFaces = fontRecords.flatMap((font) => font.faces.map((face) => ({ font, face })));
  assertHardLimit(fontFaces.length, RESOURCE_CLOSURE_LIMITS.fontFaceCountHard, "font faces", "CBB-FONT-0001");

  let assetBytes = 0;
  for (const record of assetRecords) {
    assertHardLimit(record.byteSize, RESOURCE_CLOSURE_LIMITS.assetFileBytesHard, record.portableAssetId, "CBB-ASSET-0001");
    assetBytes += record.byteSize;
    assertHardLimit(assetBytes, RESOURCE_CLOSURE_LIMITS.assetTotalBytesHard, "asset bytes", "CBB-ASSET-0001");
  }
  let fontBytes = 0;
  for (const { font, face } of fontFaces) {
    assertHardLimit(face.byteSize, RESOURCE_CLOSURE_LIMITS.fontFaceBytesHard, `${font.portableFontId}:${face.faceId}`, "CBB-FONT-0001");
    fontBytes += face.byteSize;
    assertHardLimit(fontBytes, RESOURCE_CLOSURE_LIMITS.fontTotalBytesHard, "font bytes", "CBB-FONT-0001");
  }

  const assets: VerifiedAssetIdentity[] = [];
  const fonts: VerifiedFontIdentity[] = [];
  const stagingEntries: ResourceStagingEntry[] = [];
  const assetBindings: Record<string, { readonly relativePath: string }> = {};
  const fontBindings: Record<string, { readonly familyName: string }> = {};
  const warnings: ResourceClosureWarning[] = [];

  warning(warnings, "assetCount", assetRecords.length, RESOURCE_CLOSURE_LIMITS.assetCountWarning);
  warning(warnings, "assetTotalBytes", assetBytes, RESOURCE_CLOSURE_LIMITS.assetTotalBytesWarning);
  warning(warnings, "fontFaceCount", fontFaces.length, RESOURCE_CLOSURE_LIMITS.fontFaceCountWarning);
  warning(warnings, "fontTotalBytes", fontBytes, RESOURCE_CLOSURE_LIMITS.fontTotalBytesWarning);

  for (let assetIndex = 0; assetIndex < assetRecords.length; assetIndex++) {
    const record = assetRecords[assetIndex];
    if (record === undefined) continue;
    const locator = Object.freeze({ kind: "assetCanonical" as const, localId: record.localId });
    await verifyBytes(
      {
        locator,
        expectedHash: record.canonicalHash,
        expectedByteSize: record.byteSize,
        maximumByteSize: RESOURCE_CLOSURE_LIMITS.assetFileBytesHard,
      },
      request.verifier,
      record.portableAssetId,
    );
    const relativePath = `assets/a${padded(assetIndex)}.${assetExtension(record.mediaType)}`;
    assets.push(Object.freeze({
      assetRef: record.portableAssetId,
      binaryHash: record.canonicalHash,
      mediaType: record.mediaType,
    }));
    const stagingEntry: AssetStagingEntry = Object.freeze({
      kind: "asset",
      assetRef: record.portableAssetId,
      locator,
      relativePath,
      hash: record.canonicalHash,
      byteSize: record.byteSize,
      mediaType: record.mediaType,
    });
    stagingEntries.push(stagingEntry);
    assetBindings[record.portableAssetId] = Object.freeze({ relativePath });
    warning(warnings, "assetFileBytes", record.byteSize, RESOURCE_CLOSURE_LIMITS.assetFileBytesWarning, record.portableAssetId);
  }

  for (let fontIndex = 0; fontIndex < fontRecords.length; fontIndex++) {
    const record = fontRecords[fontIndex];
    if (record === undefined) continue;
    const selectedFaces: SelectedFontFaceIdentity[] = [];
    const sortedFaces = [...record.faces].sort((left, right) => compareText(left.faceId, right.faceId));
    for (let faceIndex = 0; faceIndex < sortedFaces.length; faceIndex++) {
      const face = sortedFaces[faceIndex];
      if (face === undefined) continue;
      const locator = Object.freeze({
        kind: "fontFace" as const,
        localId: record.localId,
        faceId: face.faceId,
      });
      await verifyBytes(
        {
          locator,
          expectedHash: face.hash,
          expectedByteSize: face.byteSize,
          maximumByteSize: RESOURCE_CLOSURE_LIMITS.fontFaceBytesHard,
        },
        request.verifier,
        `${record.portableFontId}:${face.faceId}`,
      );
      const relativePath = `fonts/f${padded(fontIndex)}-${padded(faceIndex)}.${face.format}`;
      const axes = face.variableAxisCoordinates;
      selectedFaces.push(Object.freeze({
        faceId: face.faceId,
        faceHash: face.hash,
        faceIndex: face.faceIndex,
        embedding: record.pdfSubsettingPermitted ? "subset" : "full",
        ...(axes !== undefined && Object.keys(axes).length > 0
          ? { variationAxes: Object.freeze({ ...axes }) }
          : {}),
      }));
      const stagingEntry: FontFaceStagingEntry = Object.freeze({
        kind: "fontFace",
        fontRef: record.portableFontId,
        faceId: face.faceId,
        locator,
        relativePath,
        hash: face.hash,
        byteSize: face.byteSize,
        format: face.format,
      });
      stagingEntries.push(stagingEntry);
      warning(warnings, "fontFaceBytes", face.byteSize, RESOURCE_CLOSURE_LIMITS.fontFaceBytesWarning, `${record.portableFontId}:${face.faceId}`);
    }
    fonts.push(Object.freeze({
      fontRef: record.portableFontId,
      familyDigest: record.familyDigest,
      selectedFaces: Object.freeze(selectedFaces),
    }));
    fontBindings[record.portableFontId] = Object.freeze({ familyName: record.typstFamilyName });
  }

  warnings.sort((left, right) =>
    compareText(left.kind, right.kind) ||
    compareText(left.subject ?? "", right.subject ?? "") ||
    left.observed - right.observed,
  );

  return Object.freeze({
    assets: Object.freeze(assets),
    fonts: Object.freeze(fonts),
    assetBindings: Object.freeze(assetBindings),
    fontBindings: Object.freeze(fontBindings),
    stagingEntries: Object.freeze(stagingEntries),
    warnings: Object.freeze(warnings),
    totals: Object.freeze({
      assetCount: assetRecords.length,
      assetBytes,
      fontFamilyCount: fontRecords.length,
      fontFaceCount: fontFaces.length,
      fontBytes,
    }),
  });
}
