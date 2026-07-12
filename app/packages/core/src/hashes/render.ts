import type { HashPort, Sha256Hash } from "../canonical/index.js";
import { canonicalStringify, hashCanonical } from "../canonical/index.js";
import type {
  BookletImpositionOptions,
  HashJsonObject,
  HashJsonValue,
  PinnedToolIdentity,
  RenderHashInput,
  RenderInputHash,
  RenderLocaleIdentity,
  RenderOutputOptions,
  SanitizedRenderProjection,
  SelectedFontFaceIdentity,
  VerifiedAssetIdentity,
  VerifiedFontIdentity,
} from "./types.js";
import {
  asHashJsonObject,
  assertExactKeys,
  assertHashJson,
  assertNonemptyString,
  assertPlainObject,
  assertSha256,
  cloneHashJson,
  compareUtf16,
  HashInputError,
} from "./validation.js";

const PORTABLE_ASSET_RE =
  /^asset:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PORTABLE_FONT_RE =
  /^font:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Persisted/editor fields that must never leak into an output-only render
 * projection. Rendered values should be materialized under semantic leaf names
 * (for example `text` or `creditLines`) rather than carrying source records.
 */
const FORBIDDEN_RENDER_FIELDS = new Set([
  "id",
  "nodeId",
  "resolvedId",
  "sourceElementId",
  "elementId",
  "wrapperId",
  "ownerInstanceId",
  "definitionNodeId",
  "prototypeNodeId",
  "targetNodeId",
  "itemId",
  "ruleId",
  "bindingId",
  "name",
  "origin",
  "itemIds",
  "provenance",
  "authoringPolicy",
  "weeklyReview",
  "fieldReview",
  "contentReview",
  "fieldContract",
  "fieldValues",
  "bindings",
  "contentRules",
  "sourceTemplate",
  "orphanedFieldValues",
  "sampleFieldValues",
  "rightsPolicy",
  "publicationContexts",
  "printSafeInset",
  "safeInset",
  "finalPageCountRequirement",
  "sourceUrl",
  "retrievalTime",
  "reviewTime",
  "creditKey",
  "sourceSong",
  "sourceCatalog",
  "importSnapshot",
  "importReview",
  "rightsAssociationReview",
]);

interface ProjectionFieldContext {
  readonly objectDepth: number;
  readonly insideTypographyPreset: boolean;
  readonly insideRightsContributions: boolean;
}

function assertSafeProjectionFields(
  value: HashJsonValue,
  path: string,
  context: ProjectionFieldContext = {
    objectDepth: 0,
    insideTypographyPreset: false,
    insideRightsContributions: false,
  },
): void {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      assertSafeProjectionFields(
        value[index] as HashJsonValue,
        `${path}[${index}]`,
        context,
      );
    }
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    // Rights credit identity controls active-credit de-duplication and emitted
    // lines. Permit it only in the top-level resolved contribution projection.
    // Typography snapshots are intentionally opaque schema-owned render data.
    // Track structural ancestry explicitly: string-path substring checks can
    // be spoofed by a JSON key containing dots and trusted segment names.
    const activeRightsField =
      context.insideRightsContributions && key === "creditKey";
    const typographyPresetField = context.insideTypographyPreset;
    if (
      FORBIDDEN_RENDER_FIELDS.has(key) &&
      !activeRightsField &&
      !typographyPresetField
    ) {
      throw new HashInputError(
        `${path}.${key}`,
        "persisted identity, provenance, or readiness state is forbidden in a render projection",
      );
    }
    assertSafeProjectionFields(entry, `${path}.${key}`, {
      objectDepth: context.objectDepth + 1,
      insideTypographyPreset:
        context.insideTypographyPreset || key === "typographyPresetSnapshot",
      insideRightsContributions:
        context.insideRightsContributions ||
        (context.objectDepth === 0 && key === "rightsContributions"),
    });
  }
}

interface ReferencedResources {
  readonly assets: Set<string>;
  readonly fonts: Set<string>;
}

function collectReferenceValue(
  value: HashJsonValue,
  path: string,
  pattern: RegExp,
  output: Set<string>,
): void {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new HashInputError(path, "invalid portable resource reference in render projection");
  }
  output.add(value);
}

function collectReferenceArray(
  value: HashJsonValue,
  path: string,
  pattern: RegExp,
  output: Set<string>,
): void {
  if (!Array.isArray(value)) {
    throw new HashInputError(path, "expected an array of portable resource references");
  }
  for (let index = 0; index < value.length; index++) {
    collectReferenceValue(value[index] as HashJsonValue, `${path}[${index}]`, pattern, output);
  }
}

function collectReferencedResources(
  value: HashJsonValue,
  path: string,
  output: ReferencedResources,
): void {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      collectReferencedResources(value[index] as HashJsonValue, `${path}[${index}]`, output);
    }
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    const entryPath = `${path}.${key}`;
    if (key === "assetRef") {
      collectReferenceValue(entry, entryPath, PORTABLE_ASSET_RE, output.assets);
    } else if (key === "assetRefs") {
      collectReferenceArray(entry, entryPath, PORTABLE_ASSET_RE, output.assets);
    } else if (key === "fontRef") {
      collectReferenceValue(entry, entryPath, PORTABLE_FONT_RE, output.fonts);
    } else if (
      key === "fontRefs" ||
      key === "fontFallbackRefs" ||
      key === "fontFallbackStack"
    ) {
      collectReferenceArray(entry, entryPath, PORTABLE_FONT_RE, output.fonts);
    }
    collectReferencedResources(entry, entryPath, output);
  }
}

/**
 * Validate and snapshot an output-only render projection.
 */
export function createSanitizedRenderProjection(
  value: HashJsonObject,
): SanitizedRenderProjection {
  const cloned = asHashJsonObject(value, "$renderProjection");
  assertSafeProjectionFields(cloned, "$renderProjection");
  return cloned as SanitizedRenderProjection;
}

function objectRecord(value: unknown, path: string): Record<string, unknown> {
  assertPlainObject(value, path);
  return value;
}

function assertPortableRef(value: unknown, path: string, pattern: RegExp): string {
  assertNonemptyString(value, path);
  if (!pattern.test(value)) {
    throw new HashInputError(path, "invalid portable resource reference");
  }
  return value;
}

function normalizeAssets(
  assets: readonly VerifiedAssetIdentity[],
): readonly HashJsonObject[] {
  if (!Array.isArray(assets)) {
    throw new HashInputError("$render.assets", "expected an array");
  }
  const byRef = new Map<string, HashJsonObject>();
  for (let index = 0; index < assets.length; index++) {
    const path = `$render.assets[${index}]`;
    const asset = objectRecord(assets[index], path);
    assertExactKeys(asset, path, ["assetRef", "binaryHash", "mediaType"], [
      "assetRef",
      "binaryHash",
      "mediaType",
    ]);
    const assetRef = assertPortableRef(asset["assetRef"], `${path}.assetRef`, PORTABLE_ASSET_RE);
    assertSha256(asset["binaryHash"], `${path}.binaryHash`);
    assertNonemptyString(asset["mediaType"], `${path}.mediaType`);
    const normalized: HashJsonObject = {
      assetRef,
      binaryHash: asset["binaryHash"],
      mediaType: asset["mediaType"],
    };
    const prior = byRef.get(assetRef);
    if (prior !== undefined && canonicalStringify(prior) !== canonicalStringify(normalized)) {
      throw new HashInputError(path, `conflicting identities for asset ${assetRef}`);
    }
    byRef.set(assetRef, normalized);
  }
  return [...byRef.values()].sort((a, b) =>
    compareUtf16(a["assetRef"] as string, b["assetRef"] as string),
  );
}

function normalizeVariationAxes(
  value: unknown,
  path: string,
): HashJsonObject | undefined {
  if (value === undefined) return undefined;
  const axes = objectRecord(value, path);
  const result: Record<string, number> = {};
  for (const [tag, axisValue] of Object.entries(axes)) {
    if (!/^[\x20-\x7e]{4}$/.test(tag)) {
      throw new HashInputError(`${path}.${tag}`, "OpenType axis tags must be four printable ASCII characters");
    }
    if (typeof axisValue !== "number" || !Number.isFinite(axisValue)) {
      throw new HashInputError(`${path}.${tag}`, "axis value must be a finite number");
    }
    result[tag] = axisValue;
  }
  return result;
}

function normalizeFace(
  value: SelectedFontFaceIdentity,
  path: string,
): HashJsonObject {
  const face = objectRecord(value, path);
  assertExactKeys(
    face,
    path,
    ["faceId", "faceHash", "faceIndex", "embedding", "variationAxes"],
    ["faceId", "faceHash", "faceIndex", "embedding"],
  );
  assertNonemptyString(face["faceId"], `${path}.faceId`);
  assertSha256(face["faceHash"], `${path}.faceHash`);
  if (!Number.isInteger(face["faceIndex"]) || (face["faceIndex"] as number) < 0) {
    throw new HashInputError(`${path}.faceIndex`, "expected a nonnegative integer");
  }
  if (face["embedding"] !== "full" && face["embedding"] !== "subset") {
    throw new HashInputError(`${path}.embedding`, 'expected "full" or "subset"');
  }
  const result: Record<string, HashJsonValue> = {
    faceId: face["faceId"],
    faceHash: face["faceHash"],
    faceIndex: face["faceIndex"] as number,
    embedding: face["embedding"],
  };
  const axes = normalizeVariationAxes(face["variationAxes"], `${path}.variationAxes`);
  if (axes !== undefined) result["variationAxes"] = axes;
  return result;
}

function normalizeFonts(
  fonts: readonly VerifiedFontIdentity[],
): readonly HashJsonObject[] {
  if (!Array.isArray(fonts)) {
    throw new HashInputError("$render.fonts", "expected an array");
  }
  const byRef = new Map<string, HashJsonObject>();
  for (let index = 0; index < fonts.length; index++) {
    const path = `$render.fonts[${index}]`;
    const font = objectRecord(fonts[index], path);
    assertExactKeys(font, path, ["fontRef", "familyDigest", "selectedFaces"], [
      "fontRef",
      "familyDigest",
      "selectedFaces",
    ]);
    const fontRef = assertPortableRef(font["fontRef"], `${path}.fontRef`, PORTABLE_FONT_RE);
    assertSha256(font["familyDigest"], `${path}.familyDigest`);
    if (!Array.isArray(font["selectedFaces"]) || font["selectedFaces"].length === 0) {
      throw new HashInputError(`${path}.selectedFaces`, "expected at least one selected face");
    }
    const facesById = new Map<string, HashJsonObject>();
    for (let faceIndex = 0; faceIndex < font["selectedFaces"].length; faceIndex++) {
      const facePath = `${path}.selectedFaces[${faceIndex}]`;
      const face = normalizeFace(
        font["selectedFaces"][faceIndex] as SelectedFontFaceIdentity,
        facePath,
      );
      const faceId = face["faceId"] as string;
      const priorFace = facesById.get(faceId);
      if (priorFace !== undefined && canonicalStringify(priorFace) !== canonicalStringify(face)) {
        throw new HashInputError(facePath, `conflicting selected face identity ${faceId}`);
      }
      facesById.set(faceId, face);
    }
    const selectedFaces = [...facesById.values()].sort((a, b) => {
      const idOrder = compareUtf16(a["faceId"] as string, b["faceId"] as string);
      if (idOrder !== 0) return idOrder;
      return (a["faceIndex"] as number) - (b["faceIndex"] as number);
    });
    const normalized: HashJsonObject = {
      fontRef,
      familyDigest: font["familyDigest"] as Sha256Hash,
      selectedFaces,
    };
    const prior = byRef.get(fontRef);
    if (prior !== undefined && canonicalStringify(prior) !== canonicalStringify(normalized)) {
      throw new HashInputError(path, `conflicting identities for font ${fontRef}`);
    }
    byRef.set(fontRef, normalized);
  }
  return [...byRef.values()].sort((a, b) =>
    compareUtf16(a["fontRef"] as string, b["fontRef"] as string),
  );
}

function normalizeTools(
  tools: readonly PinnedToolIdentity[],
): readonly HashJsonObject[] {
  if (!Array.isArray(tools) || tools.length === 0) {
    throw new HashInputError("$render.tools", "at least one pinned tool identity is required");
  }
  const byId = new Map<string, HashJsonObject>();
  for (let index = 0; index < tools.length; index++) {
    const path = `$render.tools[${index}]`;
    const tool = objectRecord(tools[index], path);
    assertExactKeys(tool, path, ["toolId", "version", "toolHash"], [
      "toolId",
      "version",
      "toolHash",
    ]);
    assertNonemptyString(tool["toolId"], `${path}.toolId`);
    assertNonemptyString(tool["version"], `${path}.version`);
    assertSha256(tool["toolHash"], `${path}.toolHash`);
    const normalized: HashJsonObject = {
      toolId: tool["toolId"],
      version: tool["version"],
      toolHash: tool["toolHash"],
    };
    const toolId = tool["toolId"];
    const prior = byId.get(toolId);
    if (prior !== undefined && canonicalStringify(prior) !== canonicalStringify(normalized)) {
      throw new HashInputError(path, `conflicting identities for tool ${toolId}`);
    }
    byId.set(toolId, normalized);
  }
  return [...byId.values()].sort((a, b) =>
    compareUtf16(a["toolId"] as string, b["toolId"] as string),
  );
}

function normalizeLocale(localeValue: RenderLocaleIdentity): HashJsonObject {
  const locale = objectRecord(localeValue, "$render.locale");
  assertExactKeys(locale, "$render.locale", ["languageTag", "dataVersion", "dataHash"], [
    "languageTag",
    "dataVersion",
    "dataHash",
  ]);
  assertNonemptyString(locale["languageTag"], "$render.locale.languageTag");
  assertNonemptyString(locale["dataVersion"], "$render.locale.dataVersion");
  assertSha256(locale["dataHash"], "$render.locale.dataHash");
  return {
    languageTag: locale["languageTag"],
    dataVersion: locale["dataVersion"],
    dataHash: locale["dataHash"],
  };
}

function normalizeImposition(value: unknown): HashJsonObject {
  const path = "$render.outputOptions.imposition";
  const imposition = objectRecord(value, path);
  const keys = [
    "sheetWidth",
    "sheetHeight",
    "binding",
    "duplexFlip",
    "scale",
    "logicalInputPdfHash",
  ] as const;
  assertExactKeys(imposition, path, keys, keys);
  assertNonemptyString(imposition["sheetWidth"], `${path}.sheetWidth`);
  assertNonemptyString(imposition["sheetHeight"], `${path}.sheetHeight`);
  if (imposition["binding"] !== "left" && imposition["binding"] !== "right") {
    throw new HashInputError(`${path}.binding`, 'expected "left" or "right"');
  }
  if (imposition["duplexFlip"] !== "shortEdge" && imposition["duplexFlip"] !== "longEdge") {
    throw new HashInputError(`${path}.duplexFlip`, "invalid duplex flip mode");
  }
  if (
    typeof imposition["scale"] !== "number" ||
    !Number.isFinite(imposition["scale"]) ||
    imposition["scale"] <= 0
  ) {
    throw new HashInputError(`${path}.scale`, "expected a finite positive scale");
  }
  assertSha256(imposition["logicalInputPdfHash"], `${path}.logicalInputPdfHash`);
  return cloneHashJson(imposition, path, false) as HashJsonObject;
}

function normalizeOutputOptions(optionsValue: RenderOutputOptions): HashJsonObject {
  const path = "$render.outputOptions";
  const options = objectRecord(optionsValue, path);
  assertExactKeys(
    options,
    path,
    ["outputForm", "pdfConformance", "watermark", "imposition"],
    ["outputForm", "pdfConformance", "watermark"],
  );
  if (options["outputForm"] !== "readerOrder" && options["outputForm"] !== "bookletTwoUp") {
    throw new HashInputError(`${path}.outputForm`, "invalid output form");
  }
  if (options["pdfConformance"] !== "standard" && options["pdfConformance"] !== "pdfUa1") {
    throw new HashInputError(`${path}.pdfConformance`, "invalid PDF conformance mode");
  }
  const watermark = objectRecord(options["watermark"], `${path}.watermark`);
  if (watermark["kind"] === "none") {
    assertExactKeys(watermark, `${path}.watermark`, ["kind"], ["kind"]);
  } else if (watermark["kind"] === "draft" || watermark["kind"] === "proof") {
    assertExactKeys(watermark, `${path}.watermark`, ["kind", "text", "version"], [
      "kind",
      "text",
      "version",
    ]);
    assertNonemptyString(watermark["text"], `${path}.watermark.text`);
    assertNonemptyString(watermark["version"], `${path}.watermark.version`);
  } else {
    throw new HashInputError(`${path}.watermark.kind`, "invalid watermark kind");
  }

  const result: Record<string, HashJsonValue> = {
    outputForm: options["outputForm"],
    pdfConformance: options["pdfConformance"],
    watermark: cloneHashJson(watermark, `${path}.watermark`, false),
  };
  if (options["outputForm"] === "bookletTwoUp") {
    if (options["pdfConformance"] === "pdfUa1") {
      throw new HashInputError(
        `${path}.pdfConformance`,
        "bookletTwoUp is a print artifact and cannot claim PDF/UA-1 conformance",
      );
    }
    if (!Object.hasOwn(options, "imposition")) {
      throw new HashInputError(`${path}.imposition`, "required for bookletTwoUp output");
    }
    result["imposition"] = normalizeImposition(
      options["imposition"] as BookletImpositionOptions,
    );
  } else if (Object.hasOwn(options, "imposition")) {
    throw new HashInputError(`${path}.imposition`, "forbidden for readerOrder output");
  }
  return result;
}

/** Hash deterministic output inputs after normalizing unordered identities. */
export function renderInputHash(
  input: RenderHashInput,
  hashPort?: HashPort,
): RenderInputHash {
  assertHashJson(input, "$render");
  const record = objectRecord(input, "$render");
  assertExactKeys(
    record,
    "$render",
    ["projection", "assets", "fonts", "tools", "locale", "outputOptions"],
    ["projection", "assets", "fonts", "tools", "locale", "outputOptions"],
  );
  const projection = asHashJsonObject(record["projection"], "$render.projection");
  assertSafeProjectionFields(projection, "$render.projection");

  const assets = normalizeAssets(input.assets);
  const fonts = normalizeFonts(input.fonts);
  const references: ReferencedResources = { assets: new Set(), fonts: new Set() };
  collectReferencedResources(projection, "$render.projection", references);
  const verifiedAssetRefs = new Set(assets.map((asset) => asset["assetRef"] as string));
  const verifiedFontRefs = new Set(fonts.map((font) => font["fontRef"] as string));
  for (const assetRef of references.assets) {
    if (!verifiedAssetRefs.has(assetRef)) {
      throw new HashInputError(
        "$render.assets",
        `missing verified binary identity for referenced asset ${assetRef}`,
      );
    }
  }
  for (const fontRef of references.fonts) {
    if (!verifiedFontRefs.has(fontRef)) {
      throw new HashInputError(
        "$render.fonts",
        `missing verified family/face identity for referenced font ${fontRef}`,
      );
    }
  }
  for (const assetRef of verifiedAssetRefs) {
    if (!references.assets.has(assetRef)) {
      throw new HashInputError(
        "$render.assets",
        `verified asset ${assetRef} is outside the resolved reference closure`,
      );
    }
  }
  for (const fontRef of verifiedFontRefs) {
    if (!references.fonts.has(fontRef)) {
      throw new HashInputError(
        "$render.fonts",
        `verified font ${fontRef} is outside the resolved reference closure`,
      );
    }
  }

  const envelope = {
    format: "cbb-render-input-v1",
    projection,
    assets,
    fonts,
    tools: normalizeTools(input.tools),
    locale: normalizeLocale(input.locale),
    outputOptions: normalizeOutputOptions(input.outputOptions),
  };
  return hashCanonical(envelope, hashPort);
}
