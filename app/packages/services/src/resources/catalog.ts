import {
  isLocalResourceId,
  isPortableAssetRef,
  isPortableFontRef,
} from "@cbb/core";
import type {
  AssetRevisionRecord,
  AssetSanitizerIdentity,
  AssetSourceOriginalIdentity,
  FontRevisionRecord,
  ManagedFontFaceRecord,
  ResourceResolverIndex,
} from "./types.js";
import { ResourceContractError } from "./types.js";
import { computeFontFamilyDigest } from "./familyDigest.js";

const SHA256_RE = /^sha256:[0-9a-f]{64}$/u;
const UTC_RE =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z$/u;
const MEDIA_TYPE_RE = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+/-]*$/u;
const FACE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const AXIS_TAG_RE = /^[ -~]{4}$/u;
const OPAQUE_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/u;
const UNSAFE_TEXT_RE = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

const ASSET_MAX_BYTES = 500 * 1024 * 1024;
const FONT_FACE_MAX_BYTES = 50 * 1024 * 1024;

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function fail(
  message: string,
  subject?: string,
  code: "CBB-ASSET-0001" | "CBB-FONT-0001" = "CBB-ASSET-0001",
): never {
  throw new ResourceContractError("invalidRecord", code, message, subject);
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  subject: string | undefined,
  code: "CBB-ASSET-0001" | "CBB-FONT-0001",
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) fail(`Resource record contains an unknown field: ${key}`, subject, code);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail(`Resource record is missing required field: ${key}`, subject, code);
  }
}

function safeText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    [...value].length <= maximum &&
    !UNSAFE_TEXT_RE.test(value) &&
    value.normalize("NFC") === value
  );
}

function optionalSafeText(
  value: Record<string, unknown>,
  key: string,
  maximum: number,
  subject: string,
  code: "CBB-ASSET-0001" | "CBB-FONT-0001",
): string | undefined {
  const entry = value[key];
  if (entry === undefined) return undefined;
  if (!safeText(entry, maximum)) fail(`Resource field ${key} is not safe bounded NFC text`, subject, code);
  return entry;
}

function positiveInteger(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= maximum;
}

function sha256(value: unknown): boolean {
  return typeof value === "string" && SHA256_RE.test(value);
}

function validateSanitizer(
  raw: unknown,
  subject: string,
): AssetSanitizerIdentity | undefined {
  if (raw === undefined) return undefined;
  if (!plainRecord(raw)) fail("Asset sanitizer identity must be an object", subject);
  exactKeys(raw, ["toolId", "version", "toolHash"], ["toolId", "version", "toolHash"], subject, "CBB-ASSET-0001");
  if (!safeText(raw["toolId"], 128) || !safeText(raw["version"], 128) || !sha256(raw["toolHash"])) {
    fail("Asset sanitizer identity is malformed", subject);
  }
  return Object.freeze({
    toolId: raw["toolId"],
    version: raw["version"],
    toolHash: raw["toolHash"],
  }) as AssetSanitizerIdentity;
}

function validateSourceOriginal(
  raw: unknown,
  subject: string,
): AssetSourceOriginalIdentity | undefined {
  if (raw === undefined) return undefined;
  if (!plainRecord(raw)) fail("Asset source-original identity must be an object", subject);
  exactKeys(raw, ["hash", "byteSize"], ["hash", "byteSize"], subject, "CBB-ASSET-0001");
  if (!sha256(raw["hash"]) || !positiveInteger(raw["byteSize"], ASSET_MAX_BYTES)) {
    fail("Asset source-original identity is malformed", subject);
  }
  return Object.freeze({ hash: raw["hash"], byteSize: raw["byteSize"] }) as AssetSourceOriginalIdentity;
}

function validateAssetRecord(raw: unknown): AssetRevisionRecord {
  if (!plainRecord(raw)) fail("Asset record must be an object");
  const subject = typeof raw["portableAssetId"] === "string" ? raw["portableAssetId"] : undefined;
  exactKeys(
    raw,
    [
      "version", "kind", "localId", "portableAssetId", "displayName",
      "originalFilename", "mediaType", "canonicalHash", "byteSize", "width",
      "height", "sanitizationState", "sanitizer", "sourceOriginal",
      "aiVisibility", "importedAt",
    ],
    [
      "version", "kind", "localId", "portableAssetId", "displayName",
      "mediaType", "canonicalHash", "byteSize", "sanitizationState",
      "aiVisibility", "importedAt",
    ],
    subject,
    "CBB-ASSET-0001",
  );
  if (raw["version"] !== 1 || raw["kind"] !== "assetRecord") fail("Unsupported asset record version or kind", subject);
  if (typeof raw["localId"] !== "string" || !isLocalResourceId(raw["localId"])) fail("Asset local id is invalid", subject);
  if (typeof raw["portableAssetId"] !== "string" || !isPortableAssetRef(raw["portableAssetId"])) fail("Portable asset id is invalid", subject);
  const verifiedSubject = raw["portableAssetId"];
  if (!safeText(raw["displayName"], 512)) fail("Asset display name is invalid", subject);
  if (typeof raw["mediaType"] !== "string" || raw["mediaType"].length > 255 || !MEDIA_TYPE_RE.test(raw["mediaType"])) fail("Asset media type is invalid", subject);
  if (!sha256(raw["canonicalHash"])) fail("Asset canonical hash is invalid", subject);
  if (!positiveInteger(raw["byteSize"], ASSET_MAX_BYTES)) fail("Asset byte size is invalid", subject);
  if (!["pending", "validated", "failed"].includes(String(raw["sanitizationState"]))) fail("Asset sanitization state is invalid", subject);
  if (!["private", "approved", "public"].includes(String(raw["aiVisibility"]))) fail("Asset AI visibility is invalid", subject);
  if (typeof raw["importedAt"] !== "string" || !UTC_RE.test(raw["importedAt"])) fail("Asset import timestamp is invalid", subject);
  for (const dimension of ["width", "height"] as const) {
    if (raw[dimension] !== undefined && !positiveInteger(raw[dimension], 32768)) fail(`Asset ${dimension} is invalid`, subject);
  }

  const originalFilename = optionalSafeText(raw, "originalFilename", 512, verifiedSubject, "CBB-ASSET-0001");
  const sanitizer = validateSanitizer(raw["sanitizer"], verifiedSubject);
  const sourceOriginal = validateSourceOriginal(raw["sourceOriginal"], verifiedSubject);
  return Object.freeze({
    version: 1,
    kind: "assetRecord",
    localId: raw["localId"],
    portableAssetId: raw["portableAssetId"],
    displayName: raw["displayName"],
    ...(originalFilename !== undefined ? { originalFilename } : {}),
    mediaType: raw["mediaType"],
    canonicalHash: raw["canonicalHash"],
    byteSize: raw["byteSize"],
    ...(raw["width"] !== undefined ? { width: raw["width"] } : {}),
    ...(raw["height"] !== undefined ? { height: raw["height"] } : {}),
    sanitizationState: raw["sanitizationState"],
    ...(sanitizer !== undefined ? { sanitizer } : {}),
    ...(sourceOriginal !== undefined ? { sourceOriginal } : {}),
    aiVisibility: raw["aiVisibility"],
    importedAt: raw["importedAt"],
  }) as AssetRevisionRecord;
}

function validateAxes(
  raw: unknown,
  subject: string,
): Readonly<Record<string, number>> | undefined {
  if (raw === undefined) return undefined;
  if (!plainRecord(raw)) fail("Font variation-axis coordinates must be an object", subject, "CBB-FONT-0001");
  const result: Record<string, number> = {};
  for (const key of Object.keys(raw).sort(compareText)) {
    const value = raw[key];
    if (!AXIS_TAG_RE.test(key) || typeof value !== "number" || !Number.isFinite(value)) {
      fail("Font variation-axis coordinates are malformed", subject, "CBB-FONT-0001");
    }
    result[key] = value;
  }
  return Object.freeze(result);
}

function validateFace(raw: unknown, fontSubject: string): ManagedFontFaceRecord {
  if (!plainRecord(raw)) fail("Font face record must be an object", fontSubject, "CBB-FONT-0001");
  exactKeys(
    raw,
    ["faceId", "faceIndex", "format", "weight", "style", "stretch", "variableAxisCoordinates", "hash", "byteSize"],
    ["faceId", "faceIndex", "format", "weight", "style", "stretch", "hash", "byteSize"],
    fontSubject,
    "CBB-FONT-0001",
  );
  if (typeof raw["faceId"] !== "string" || !FACE_ID_RE.test(raw["faceId"])) fail("Font face id is invalid", fontSubject, "CBB-FONT-0001");
  if (!Number.isSafeInteger(raw["faceIndex"]) || (raw["faceIndex"] as number) < 0) fail("Font face index is invalid", fontSubject, "CBB-FONT-0001");
  if (!["ttf", "otf", "woff", "woff2"].includes(String(raw["format"]))) fail("Font face format is invalid", fontSubject, "CBB-FONT-0001");
  if (!Number.isInteger(raw["weight"]) || (raw["weight"] as number) < 100 || (raw["weight"] as number) > 900) fail("Font face weight is invalid", fontSubject, "CBB-FONT-0001");
  if (!["normal", "italic", "oblique"].includes(String(raw["style"]))) fail("Font face style is invalid", fontSubject, "CBB-FONT-0001");
  if (typeof raw["stretch"] !== "number" || !Number.isFinite(raw["stretch"]) || raw["stretch"] <= 0) fail("Font face stretch is invalid", fontSubject, "CBB-FONT-0001");
  if (!sha256(raw["hash"]) || !positiveInteger(raw["byteSize"], FONT_FACE_MAX_BYTES)) fail("Font face binary identity is invalid", fontSubject, "CBB-FONT-0001");
  const axes = validateAxes(raw["variableAxisCoordinates"], fontSubject);
  return Object.freeze({
    faceId: raw["faceId"],
    faceIndex: raw["faceIndex"],
    format: raw["format"],
    weight: raw["weight"],
    style: raw["style"],
    stretch: raw["stretch"],
    ...(axes !== undefined ? { variableAxisCoordinates: axes } : {}),
    hash: raw["hash"],
    byteSize: raw["byteSize"],
  }) as ManagedFontFaceRecord;
}

function validateFontRecord(raw: unknown): FontRevisionRecord {
  if (!plainRecord(raw)) fail("Font record must be an object", undefined, "CBB-FONT-0001");
  const subject = typeof raw["portableFontId"] === "string" ? raw["portableFontId"] : undefined;
  exactKeys(
    raw,
    [
      "version", "kind", "localId", "portableFontId", "familyDigest",
      "displayName", "originalName", "familyName", "internalName",
      "postScriptName", "typstFamilyName", "licenseId", "licenseTextRef",
      "redistributionAsserted", "exportable", "pdfEmbeddingPermitted",
      "pdfSubsettingPermitted", "validationState", "validatingAppVersion",
      "validatingTypstVersion", "unicodeCoverageSummary", "faces",
    ],
    [
      "version", "kind", "localId", "portableFontId", "familyDigest",
      "displayName", "typstFamilyName", "redistributionAsserted", "exportable",
      "pdfEmbeddingPermitted", "pdfSubsettingPermitted", "validationState", "faces",
    ],
    subject,
    "CBB-FONT-0001",
  );
  if (raw["version"] !== 1 || raw["kind"] !== "fontRecord") fail("Unsupported font record version or kind", subject, "CBB-FONT-0001");
  if (typeof raw["localId"] !== "string" || !isLocalResourceId(raw["localId"])) fail("Font local id is invalid", subject, "CBB-FONT-0001");
  if (typeof raw["portableFontId"] !== "string" || !isPortableFontRef(raw["portableFontId"])) fail("Portable font id is invalid", subject, "CBB-FONT-0001");
  const verifiedSubject = raw["portableFontId"];
  if (!sha256(raw["familyDigest"])) fail("Font family digest is invalid", subject, "CBB-FONT-0001");
  if (!safeText(raw["displayName"], 512) || !safeText(raw["typstFamilyName"], 512)) fail("Font names are invalid", subject, "CBB-FONT-0001");
  for (const key of ["redistributionAsserted", "exportable", "pdfEmbeddingPermitted", "pdfSubsettingPermitted"] as const) {
    if (typeof raw[key] !== "boolean") fail(`Font field ${key} must be boolean`, subject, "CBB-FONT-0001");
  }
  if (!["pending", "validated", "failed"].includes(String(raw["validationState"]))) fail("Font validation state is invalid", subject, "CBB-FONT-0001");
  if (!Array.isArray(raw["faces"]) || raw["faces"].length < 1 || raw["faces"].length > 256) fail("Font family must contain 1 to 256 faces", subject, "CBB-FONT-0001");

  const faces = raw["faces"].map((face) => validateFace(face, verifiedSubject));
  const faceIds = new Set<string>();
  for (const face of faces) {
    if (faceIds.has(face.faceId)) fail("Font family contains a duplicate face id", subject, "CBB-FONT-0001");
    faceIds.add(face.faceId);
  }
  const actualDigest = computeFontFamilyDigest(faces);
  if (actualDigest !== raw["familyDigest"]) {
    throw new ResourceContractError(
      "invalidFamilyDigest",
      "CBB-FONT-0001",
      "Font family digest does not match its immutable face projection",
      subject,
    );
  }

  const optionalNames: Record<string, string | undefined> = {};
  for (const key of ["originalName", "familyName", "internalName", "postScriptName"] as const) {
    optionalNames[key] = optionalSafeText(raw, key, 512, verifiedSubject, "CBB-FONT-0001");
  }
  for (const key of ["licenseId", "licenseTextRef", "validatingAppVersion", "validatingTypstVersion"] as const) {
    optionalNames[key] = optionalSafeText(raw, key, 256, verifiedSubject, "CBB-FONT-0001");
  }
  for (const key of ["licenseId", "licenseTextRef"] as const) {
    const value = optionalNames[key];
    if (value !== undefined && !OPAQUE_TOKEN_RE.test(value)) {
      fail(`Font field ${key} must be an opaque token, not a path`, verifiedSubject, "CBB-FONT-0001");
    }
  }
  const coverage = raw["unicodeCoverageSummary"];
  if (coverage !== undefined && (typeof coverage !== "string" || [...coverage].length > 4096 || UNSAFE_TEXT_RE.test(coverage))) {
    fail("Font Unicode coverage summary is invalid", subject, "CBB-FONT-0001");
  }

  return Object.freeze({
    version: 1,
    kind: "fontRecord",
    localId: raw["localId"],
    portableFontId: raw["portableFontId"],
    familyDigest: raw["familyDigest"],
    displayName: raw["displayName"],
    ...(optionalNames["originalName"] !== undefined ? { originalName: optionalNames["originalName"] } : {}),
    ...(optionalNames["familyName"] !== undefined ? { familyName: optionalNames["familyName"] } : {}),
    ...(optionalNames["internalName"] !== undefined ? { internalName: optionalNames["internalName"] } : {}),
    ...(optionalNames["postScriptName"] !== undefined ? { postScriptName: optionalNames["postScriptName"] } : {}),
    typstFamilyName: raw["typstFamilyName"],
    ...(optionalNames["licenseId"] !== undefined ? { licenseId: optionalNames["licenseId"] } : {}),
    ...(optionalNames["licenseTextRef"] !== undefined ? { licenseTextRef: optionalNames["licenseTextRef"] } : {}),
    redistributionAsserted: raw["redistributionAsserted"],
    exportable: raw["exportable"],
    pdfEmbeddingPermitted: raw["pdfEmbeddingPermitted"],
    pdfSubsettingPermitted: raw["pdfSubsettingPermitted"],
    validationState: raw["validationState"],
    ...(optionalNames["validatingAppVersion"] !== undefined ? { validatingAppVersion: optionalNames["validatingAppVersion"] } : {}),
    ...(optionalNames["validatingTypstVersion"] !== undefined ? { validatingTypstVersion: optionalNames["validatingTypstVersion"] } : {}),
    ...(coverage !== undefined ? { unicodeCoverageSummary: coverage } : {}),
    faces: Object.freeze(faces),
  }) as FontRevisionRecord;
}

export interface ResourceResolverIndexInput {
  readonly assets: readonly unknown[];
  readonly fonts: readonly unknown[];
}

/** Validate and snapshot immutable resolver records into portable-id indexes. */
export function createResourceResolverIndex(
  input: ResourceResolverIndexInput,
): ResourceResolverIndex {
  const assets = input.assets.map(validateAssetRecord).sort((left, right) =>
    compareText(left.portableAssetId, right.portableAssetId),
  );
  const fonts = input.fonts.map(validateFontRecord).sort((left, right) =>
    compareText(left.portableFontId, right.portableFontId),
  );
  const assetsByRef = new Map();
  const fontsByRef = new Map();
  const localIds = new Set<string>();

  for (const asset of assets) {
    if (localIds.has(asset.localId)) {
      throw new ResourceContractError("duplicateLocalId", "CBB-ASSET-0001", "Duplicate local resource id in resolver catalog", asset.localId);
    }
    if (assetsByRef.has(asset.portableAssetId)) {
      throw new ResourceContractError("duplicatePortableId", "CBB-ASSET-0001", "Duplicate portable asset id in resolver catalog", asset.portableAssetId);
    }
    localIds.add(asset.localId);
    assetsByRef.set(asset.portableAssetId, asset);
  }
  for (const font of fonts) {
    if (localIds.has(font.localId)) {
      throw new ResourceContractError("duplicateLocalId", "CBB-FONT-0001", "Duplicate local resource id in resolver catalog", font.localId);
    }
    if (fontsByRef.has(font.portableFontId)) {
      throw new ResourceContractError("duplicatePortableId", "CBB-FONT-0001", "Duplicate portable font id in resolver catalog", font.portableFontId);
    }
    localIds.add(font.localId);
    fontsByRef.set(font.portableFontId, font);
  }

  return Object.freeze({ assetsByRef, fontsByRef }) as ResourceResolverIndex;
}
