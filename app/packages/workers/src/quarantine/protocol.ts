import { hashBytes } from "@cbb/core";

/** Closed handle-only protocol for isolated untrusted-content workers. */

declare const quarantineHandleBrand: unique symbol;
export type QuarantineHandle = string & {
  readonly [quarantineHandleBrand]: "QuarantineHandle";
};

export type QuarantineOperation =
  | "inspectArchive"
  | "sanitizeSvg"
  | "canonicalizeRaster"
  | "inspectFont"
  | "flattenPdf";

export type QuarantineMediaType =
  | "application/vnd.cbb.quarantine-closure"
  | "image/svg+xml"
  | "image/png"
  | "font/ttf"
  | "font/otf"
  | "font/woff"
  | "font/woff2"
  | "application/pdf";

export interface SvgObservations {
  readonly inputBytes: number;
  readonly xmlNodes: number;
  readonly pathCommands: number;
}

export interface SvgHardLimits extends SvgObservations {
  readonly outputBytes: number;
}

export interface RasterObservations {
  readonly inputBytes: number;
  readonly decodedPixels: number;
  readonly width: number;
  readonly height: number;
}

export interface RasterHardLimits extends RasterObservations {
  readonly outputBytes: number;
}

export interface FontObservations {
  readonly inputBytes: number;
}

export interface FontHardLimits extends FontObservations {
  readonly outputBytes: number;
}

export interface PdfObservations {
  readonly inputBytes: number;
  readonly pages: number;
}

export interface PdfHardLimits extends PdfObservations {
  readonly outputBytes: number;
}

export interface ArchiveHardLimits {
  readonly compressedBytes: number;
  readonly uncompressedBytes: number;
  readonly entries: number;
  readonly entryBytes: number;
  readonly compressionRatio: number;
}

export interface QuarantineHardLimitsByOperation {
  readonly inspectArchive: ArchiveHardLimits;
  readonly sanitizeSvg: SvgHardLimits;
  readonly canonicalizeRaster: RasterHardLimits;
  readonly inspectFont: FontHardLimits;
  readonly flattenPdf: PdfHardLimits;
}

export const QUARANTINE_HARD_LIMITS: QuarantineHardLimitsByOperation = Object.freeze({
  inspectArchive: Object.freeze({
    compressedBytes: 1024 * 1_048_576,
    uncompressedBytes: 4 * 1024 * 1_048_576,
    entries: 20_000,
    entryBytes: 1024 * 1_048_576,
    compressionRatio: 200,
  }),
  sanitizeSvg: Object.freeze({
    inputBytes: 20 * 1_048_576,
    outputBytes: 20 * 1_048_576,
    xmlNodes: 200_000,
    pathCommands: 1_000_000,
  }),
  canonicalizeRaster: Object.freeze({
    inputBytes: 500 * 1_048_576,
    outputBytes: 500 * 1_048_576,
    decodedPixels: 100_000_000,
    width: 32_768,
    height: 32_768,
  }),
  inspectFont: Object.freeze({
    inputBytes: 50 * 1_048_576,
    outputBytes: 50 * 1_048_576,
  }),
  flattenPdf: Object.freeze({
    inputBytes: 500 * 1_048_576,
    pages: 1_000,
    outputBytes: 500 * 1_048_576,
  }),
});

interface QuarantineRequestBase<
  Operation extends QuarantineOperation,
  Limits,
> {
  readonly version: 1;
  readonly requestId: string;
  readonly operation: Operation;
  readonly input: QuarantineHandle;
  readonly output: QuarantineHandle;
  readonly limits: Limits;
}

export type SanitizeSvgRequest = QuarantineRequestBase<"sanitizeSvg", SvgHardLimits>;
export type InspectArchiveRequest = QuarantineRequestBase<
  "inspectArchive",
  ArchiveHardLimits
>;
export type CanonicalizeRasterRequest = QuarantineRequestBase<
  "canonicalizeRaster",
  RasterHardLimits
>;
export type InspectFontRequest = QuarantineRequestBase<"inspectFont", FontHardLimits>;
export type FlattenPdfRequest = QuarantineRequestBase<"flattenPdf", PdfHardLimits>;

export type QuarantineRequest =
  | InspectArchiveRequest
  | SanitizeSvgRequest
  | CanonicalizeRasterRequest
  | InspectFontRequest
  | FlattenPdfRequest;

interface SuccessBase<Operation extends QuarantineOperation> {
  readonly version: 1;
  readonly requestId: string;
  readonly operation: Operation;
  readonly status: "succeeded";
  readonly output: QuarantineHandle;
  /** Untrusted claim. The broker independently rehashes before minting a receipt. */
  readonly outputHash: `sha256:${string}`;
  /** Untrusted claim. The privileged output verifier independently measures it. */
  readonly outputBytes: number;
}

export interface SvgSuccess extends SuccessBase<"sanitizeSvg"> {
  readonly mediaType: "image/svg+xml";
  readonly observed: SvgObservations;
}

export interface RasterSuccess extends SuccessBase<"canonicalizeRaster"> {
  readonly mediaType: "image/png";
  readonly observed: RasterObservations;
}

export interface FontFaceInspection {
  readonly faceIndex: number;
  readonly familyName: string;
  readonly postScriptName: string;
  readonly weight: number;
  readonly style: "normal" | "italic" | "oblique";
  readonly stretch: number;
  readonly variableAxisCoordinates?: Readonly<Record<string, number>>;
  readonly pdfEmbeddingPermitted: boolean;
  readonly pdfSubsettingPermitted: boolean;
}

export interface FontSuccess extends SuccessBase<"inspectFont"> {
  readonly mediaType: "font/ttf" | "font/otf" | "font/woff" | "font/woff2";
  readonly observed: FontObservations;
  readonly faces: readonly FontFaceInspection[];
  readonly typstLoadable: true;
  readonly unicodeCoverageSummary: string;
}

export interface PdfSuccess extends SuccessBase<"flattenPdf"> {
  readonly mediaType: "application/pdf";
  readonly observed: PdfObservations;
  readonly flattenedPages: number;
}

export interface ArchiveEntryInspection {
  readonly path: string;
  readonly kind: "file";
  readonly compressedBytes: number;
  readonly uncompressedBytes: number;
  readonly hash: `sha256:${string}`;
}

export interface ArchiveClosureEntry {
  readonly path: string;
  readonly hash: `sha256:${string}`;
  readonly byteSize: number;
}

/**
 * Digest the sorted extracted-file manifest. Unlike a ZIP hash, this identity
 * binds the actual regular-file closure that may later be installed.
 */
export function quarantineArchiveClosureHash(
  entries: readonly ArchiveClosureEntry[],
): `sha256:${string}` {
  const canonical = [...entries]
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
    .map((entry) => ({
      path: entry.path,
      hash: entry.hash,
      byteSize: entry.byteSize,
    }));
  return hashBytes(new TextEncoder().encode(JSON.stringify(canonical))) as `sha256:${string}`;
}

export interface ArchiveSuccess extends SuccessBase<"inspectArchive"> {
  /** Digest and byte count cover the sorted extracted regular-file closure. */
  readonly mediaType: "application/vnd.cbb.quarantine-closure";
  readonly observed: ArchiveHardLimits;
  readonly entries: readonly ArchiveEntryInspection[];
}

export type QuarantineSuccess =
  | ArchiveSuccess
  | SvgSuccess
  | RasterSuccess
  | FontSuccess
  | PdfSuccess;

export type QuarantineFailureReason =
  | "isolationUnavailable"
  | "workerCrash"
  | "timeout"
  | "canceled"
  | "limitExceeded"
  | "invalidContent"
  | "malformedResult"
  | "outputVerificationFailed"
  | "inputVerificationFailed"
  | "cleanupFailed";

export interface QuarantineFailure {
  readonly version: 1;
  readonly requestId: string;
  readonly operation: QuarantineOperation;
  readonly status: "failed";
  readonly code: "CBB-SECURITY-0001";
  readonly reason: QuarantineFailureReason;
  /** Bounded explanation. Broker-returned failures always use app-owned text. */
  readonly message: string;
}

export type QuarantineResult = QuarantineSuccess | QuarantineFailure;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HANDLE = /^qh:[0-9a-f]{64}$/u;
const HASH = /^sha256:[0-9a-f]{64}$/u;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;
const OPERATIONS = new Set<QuarantineOperation>([
  "inspectArchive",
  "sanitizeSvg",
  "canonicalizeRaster",
  "inspectFont",
  "flattenPdf",
]);
const FAILURE_REASONS = new Set<QuarantineFailureReason>([
  "isolationUnavailable",
  "workerCrash",
  "timeout",
  "canceled",
  "limitExceeded",
  "invalidContent",
  "malformedResult",
  "outputVerificationFailed",
  "inputVerificationFailed",
  "cleanupFailed",
]);
const MEDIA_TYPES: Readonly<Record<QuarantineOperation, readonly QuarantineMediaType[]>> =
  Object.freeze({
    inspectArchive: ["application/vnd.cbb.quarantine-closure"] as const,
    sanitizeSvg: ["image/svg+xml"] as const,
    canonicalizeRaster: ["image/png"] as const,
    inspectFont: ["font/ttf", "font/otf", "font/woff", "font/woff2"] as const,
    flattenPdf: ["application/pdf"] as const,
  });

export function quarantineHandle(value: string): QuarantineHandle {
  if (typeof value !== "string" || !HANDLE.test(value)) {
    throw new TypeError("Quarantine handles must be opaque qh: tokens");
  }
  return value as QuarantineHandle;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactRecord(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
): Record<string, unknown> {
  const candidate = record(value, label);
  const keys = Reflect.ownKeys(candidate);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key)) ||
    expectedKeys.some((key) => !Object.prototype.hasOwnProperty.call(candidate, key))
  ) {
    throw new TypeError(`${label} contains missing or unknown fields`);
  }
  return candidate;
}

function positiveSafe(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} must be a nonnegative safe integer`);
  }
}

function bounded(value: unknown, hard: number, label: string): asserts value is number {
  positiveSafe(value, label);
  if (value > hard) throw new RangeError(`${label} exceeds its hard cap`);
}

function validateRequestId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !UUID_V4.test(value)) {
    throw new TypeError("requestId must be a canonical UUIDv4");
  }
}

function validateOperation(value: unknown): asserts value is QuarantineOperation {
  if (typeof value !== "string" || !OPERATIONS.has(value as QuarantineOperation)) {
    throw new TypeError("Unsupported quarantine operation");
  }
}

function validateLimits(operation: QuarantineOperation, value: unknown): void {
  switch (operation) {
    case "inspectArchive": {
      const limits = exactRecord(value, [
        "compressedBytes", "uncompressedBytes", "entries", "entryBytes", "compressionRatio",
      ], "archive limits");
      const hard = QUARANTINE_HARD_LIMITS.inspectArchive;
      bounded(limits["compressedBytes"], hard.compressedBytes, "archive compressedBytes");
      bounded(limits["uncompressedBytes"], hard.uncompressedBytes, "archive uncompressedBytes");
      bounded(limits["entries"], hard.entries, "archive entries");
      bounded(limits["entryBytes"], hard.entryBytes, "archive entryBytes");
      bounded(limits["compressionRatio"], hard.compressionRatio, "archive compressionRatio");
      if ((limits["compressionRatio"] as number) < 1) {
        throw new RangeError("archive compressionRatio must be at least one");
      }
      return;
    }
    case "sanitizeSvg": {
      const limits = exactRecord(
        value,
        ["inputBytes", "outputBytes", "xmlNodes", "pathCommands"],
        "SVG limits",
      );
      const hard = QUARANTINE_HARD_LIMITS.sanitizeSvg;
      bounded(limits["inputBytes"], hard.inputBytes, "SVG inputBytes");
      bounded(limits["outputBytes"], hard.outputBytes, "SVG outputBytes");
      bounded(limits["xmlNodes"], hard.xmlNodes, "SVG xmlNodes");
      bounded(limits["pathCommands"], hard.pathCommands, "SVG pathCommands");
      return;
    }
    case "canonicalizeRaster": {
      const limits = exactRecord(
        value,
        ["inputBytes", "outputBytes", "decodedPixels", "width", "height"],
        "raster limits",
      );
      const hard = QUARANTINE_HARD_LIMITS.canonicalizeRaster;
      bounded(limits["inputBytes"], hard.inputBytes, "raster inputBytes");
      bounded(limits["outputBytes"], hard.outputBytes, "raster outputBytes");
      bounded(limits["decodedPixels"], hard.decodedPixels, "raster decodedPixels");
      bounded(limits["width"], hard.width, "raster width");
      bounded(limits["height"], hard.height, "raster height");
      return;
    }
    case "inspectFont": {
      const limits = exactRecord(value, ["inputBytes", "outputBytes"], "font limits");
      bounded(
        limits["inputBytes"],
        QUARANTINE_HARD_LIMITS.inspectFont.inputBytes,
        "font inputBytes",
      );
      bounded(
        limits["outputBytes"],
        QUARANTINE_HARD_LIMITS.inspectFont.outputBytes,
        "font outputBytes",
      );
      return;
    }
    case "flattenPdf": {
      const limits = exactRecord(value, ["inputBytes", "outputBytes", "pages"], "PDF limits");
      const hard = QUARANTINE_HARD_LIMITS.flattenPdf;
      bounded(limits["inputBytes"], hard.inputBytes, "PDF inputBytes");
      bounded(limits["outputBytes"], hard.outputBytes, "PDF outputBytes");
      bounded(limits["pages"], hard.pages, "PDF pages");
    }
  }
}

/** Validate a request at the privileged boundary before it reaches a worker. */
export function validateQuarantineRequest(
  value: unknown,
): asserts value is QuarantineRequest {
  const request = exactRecord(
    value,
    ["version", "requestId", "operation", "input", "output", "limits"],
    "quarantine request",
  );
  if (request["version"] !== 1) throw new TypeError("Unsupported quarantine request version");
  validateRequestId(request["requestId"]);
  validateOperation(request["operation"]);
  quarantineHandle(request["input"] as string);
  quarantineHandle(request["output"] as string);
  if (request["input"] === request["output"]) {
    throw new TypeError("Quarantine input and output handles must differ");
  }
  validateLimits(request["operation"], request["limits"]);
}

const WINDOWS_DEVICE_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\\.|$)/iu;

export function isSafeArchivePath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 1024 ||
    value !== value.normalize("NFC") ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.includes(":") ||
    value.startsWith("/") ||
    /^[A-Za-z]:/u.test(value)
  ) return false;
  return value.split("/").every((segment) =>
    segment.length > 0 &&
    segment !== "." &&
    segment !== ".." &&
    !/[. ]$/u.test(segment) &&
    !CONTROL.test(segment) &&
    !WINDOWS_DEVICE_SEGMENT.test(segment),
  );
}

function validateObserved(
  operation: QuarantineOperation,
  value: unknown,
  request: QuarantineRequest,
): void {
  const keys: Readonly<Record<QuarantineOperation, readonly string[]>> = {
    inspectArchive: [
      "compressedBytes", "uncompressedBytes", "entries", "entryBytes", "compressionRatio",
    ],
    sanitizeSvg: ["inputBytes", "xmlNodes", "pathCommands"],
    canonicalizeRaster: ["inputBytes", "decodedPixels", "width", "height"],
    inspectFont: ["inputBytes"],
    flattenPdf: ["inputBytes", "pages"],
  };
  const observed = exactRecord(value, keys[operation], `${operation} observations`);
  const limits = request.limits as unknown as Readonly<Record<string, number>>;
  for (const key of keys[operation]) {
    const count = observed[key];
    positiveSafe(count, `observed.${key}`);
    const limit = limits[key];
    if (limit === undefined || count > limit) {
      throw new RangeError(`Worker observation ${key} exceeds the authorized limit`);
    }
  }
}

function ceilingRatio(uncompressed: number, compressed: number): number {
  if (uncompressed === 0) return 1;
  if (compressed === 0) return Number.MAX_SAFE_INTEGER;
  return Number(
    (BigInt(uncompressed) + BigInt(compressed) - 1n) / BigInt(compressed),
  );
}

function validateArchiveResult(
  result: Record<string, unknown>,
  request: InspectArchiveRequest,
): void {
  if (!Array.isArray(result["entries"])) throw new TypeError("Archive entries must be an array");
  const entries = result["entries"];
  if (entries.length > request.limits.entries) throw new RangeError("Archive has too many entries");
  const observed = result["observed"] as unknown as ArchiveHardLimits;
  if (entries.length !== observed.entries || result["outputBytes"] !== observed.uncompressedBytes) {
    throw new TypeError("Archive entry totals do not match observations");
  }
  let compressedTotal = 0;
  let uncompressedTotal = 0;
  let maximumEntryBytes = 0;
  let maximumRatio = 1;
  const paths = new Set<string>();
  const closure: ArchiveClosureEntry[] = [];
  for (const value of entries) {
    const entry = exactRecord(
      value,
      ["kind", "path", "compressedBytes", "uncompressedBytes", "hash"],
      "archive entry",
    );
    if (
      entry["kind"] !== "file" ||
      !isSafeArchivePath(entry["path"]) ||
      typeof entry["hash"] !== "string" ||
      !HASH.test(entry["hash"])
    ) throw new TypeError("Archive worker returned an unsafe entry");
    const alias = entry["path"].toLowerCase();
    if (paths.has(alias)) throw new TypeError("Archive contains an aliased entry path");
    paths.add(alias);
    bounded(entry["compressedBytes"], request.limits.compressedBytes, "entry compressedBytes");
    bounded(entry["uncompressedBytes"], request.limits.entryBytes, "entry uncompressedBytes");
    const compressed = entry["compressedBytes"] as number;
    const uncompressed = entry["uncompressedBytes"] as number;
    const ratio = ceilingRatio(uncompressed, compressed);
    if (ratio > request.limits.compressionRatio) {
      throw new RangeError("Archive entry exceeds the authorized compression ratio");
    }
    compressedTotal += compressed;
    uncompressedTotal += uncompressed;
    maximumEntryBytes = Math.max(maximumEntryBytes, uncompressed);
    maximumRatio = Math.max(maximumRatio, ratio);
    closure.push({
      path: entry["path"],
      hash: entry["hash"] as `sha256:${string}`,
      byteSize: uncompressed,
    });
    if (!Number.isSafeInteger(compressedTotal) || !Number.isSafeInteger(uncompressedTotal)) {
      throw new RangeError("Archive totals exceed the safe integer range");
    }
  }
  maximumRatio = Math.max(maximumRatio, ceilingRatio(uncompressedTotal, compressedTotal));
  if (
    compressedTotal > observed.compressedBytes ||
    uncompressedTotal !== observed.uncompressedBytes ||
    maximumEntryBytes !== observed.entryBytes ||
    maximumRatio !== observed.compressionRatio ||
    uncompressedTotal > request.limits.uncompressedBytes ||
    maximumRatio > request.limits.compressionRatio ||
    result["outputHash"] !== quarantineArchiveClosureHash(closure)
  ) throw new RangeError("Archive closure observations are inconsistent or over limit");
}

function validateFontFaces(value: unknown): void {
  if (!Array.isArray(value) || value.length === 0 || value.length > 256) {
    throw new RangeError("Font inspection returned an invalid face count");
  }
  const indexes = new Set<number>();
  for (const item of value) {
    const rawFace = record(item, "font face");
    const hasAxes = Object.hasOwn(rawFace, "variableAxisCoordinates");
    const face = exactRecord(item, [
      "faceIndex", "familyName", "postScriptName", "weight", "style",
      "stretch", "pdfEmbeddingPermitted", "pdfSubsettingPermitted",
      ...(hasAxes ? ["variableAxisCoordinates"] : []),
    ], "font face");
    positiveSafe(face["faceIndex"], "faceIndex");
    if (indexes.has(face["faceIndex"] as number)) throw new TypeError("Duplicate font faceIndex");
    indexes.add(face["faceIndex"] as number);
    if (
      typeof face["familyName"] !== "string" ||
      typeof face["postScriptName"] !== "string" ||
      face["familyName"].length === 0 ||
      face["postScriptName"].length === 0 ||
      face["familyName"].length > 512 ||
      face["postScriptName"].length > 512 ||
      CONTROL.test(face["familyName"] + face["postScriptName"])
    ) throw new TypeError("Worker returned unsafe font names");
    if (!Number.isInteger(face["weight"]) || (face["weight"] as number) < 100 || (face["weight"] as number) > 900) {
      throw new TypeError("Worker returned an invalid font weight");
    }
    if (face["style"] !== "normal" && face["style"] !== "italic" && face["style"] !== "oblique") {
      throw new TypeError("Worker returned an invalid font style");
    }
    if (
      typeof face["stretch"] !== "number" ||
      !Number.isFinite(face["stretch"]) ||
      face["stretch"] <= 0
    ) throw new TypeError("Worker returned an invalid font stretch");
    if (hasAxes) {
      if (!plainAxisRecord(face["variableAxisCoordinates"])) {
        throw new TypeError("Worker returned invalid font variation axes");
      }
    }
    if (
      typeof face["pdfEmbeddingPermitted"] !== "boolean" ||
      typeof face["pdfSubsettingPermitted"] !== "boolean"
    ) throw new TypeError("Worker returned invalid font permissions");
  }
}

function plainAxisRecord(value: unknown): value is Readonly<Record<string, number>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length <= 64 && entries.every(([key, axis]) =>
    /^[ -~]{4}$/u.test(key) && typeof axis === "number" && Number.isFinite(axis)
  );
}

function validateFailure(result: Record<string, unknown>): void {
  exactRecord(result, [
    "version", "requestId", "operation", "status", "code", "reason", "message",
  ], "quarantine failure");
  if (
    result["code"] !== "CBB-SECURITY-0001" ||
    typeof result["reason"] !== "string" ||
    !FAILURE_REASONS.has(result["reason"] as QuarantineFailureReason) ||
    typeof result["message"] !== "string" ||
    result["message"].length === 0 ||
    result["message"].length > 2048 ||
    CONTROL.test(result["message"])
  ) throw new TypeError("Worker returned a malformed failure");
}

function validateSuccess(result: Record<string, unknown>, request: QuarantineRequest): void {
  const operation = request.operation;
  const extraKeys: Readonly<Record<QuarantineOperation, readonly string[]>> = {
    inspectArchive: ["entries"],
    sanitizeSvg: [],
    canonicalizeRaster: [],
    inspectFont: ["faces", "typstLoadable", "unicodeCoverageSummary"],
    flattenPdf: ["flattenedPages"],
  };
  exactRecord(result, [
    "version", "requestId", "operation", "status", "output", "outputHash",
    "outputBytes", "mediaType", "observed", ...extraKeys[operation],
  ], `${operation} success`);
  if (result["output"] !== request.output) {
    throw new TypeError("Worker result changed the app-owned output handle");
  }
  if (typeof result["outputHash"] !== "string" || !HASH.test(result["outputHash"])) {
    throw new TypeError("Worker returned an invalid hash claim");
  }
  positiveSafe(result["outputBytes"], "outputBytes");
  if ((result["outputBytes"] as number) > quarantineOutputByteLimit(request)) {
    throw new RangeError("Worker output exceeds the authorized output bound");
  }
  if (
    typeof result["mediaType"] !== "string" ||
    !MEDIA_TYPES[operation].includes(result["mediaType"] as QuarantineMediaType)
  ) throw new TypeError("Worker returned an invalid operation media type");
  validateObserved(operation, result["observed"], request);

  if (operation === "inspectArchive") {
    validateArchiveResult(result, request as InspectArchiveRequest);
  } else if (operation === "canonicalizeRaster") {
    const observed = result["observed"] as unknown as RasterObservations;
    if (observed.width * observed.height !== observed.decodedPixels) {
      throw new TypeError("Raster dimensions do not match decodedPixels");
    }
  } else if (operation === "inspectFont") {
    if (result["typstLoadable"] !== true) throw new TypeError("Font is not Typst-loadable");
    if (
      typeof result["unicodeCoverageSummary"] !== "string" ||
      result["unicodeCoverageSummary"].length === 0 ||
      result["unicodeCoverageSummary"].length > 4096 ||
      CONTROL.test(result["unicodeCoverageSummary"])
    ) throw new TypeError("Font Unicode coverage summary is invalid");
    validateFontFaces(result["faces"]);
  } else if (operation === "flattenPdf") {
    const observed = result["observed"] as unknown as PdfObservations;
    positiveSafe(result["flattenedPages"], "flattenedPages");
    if (result["flattenedPages"] !== observed.pages) {
      throw new TypeError("Flattened PDF page count does not match observation");
    }
  }
}

/**
 * Validate correlated worker output. This validates claims only; it never
 * promotes `outputHash` or `outputBytes` to trusted evidence.
 */
export function validateQuarantineResult(
  value: unknown,
  request: QuarantineRequest,
): asserts value is QuarantineResult {
  const result = record(value, "quarantine result");
  if (
    result["version"] !== 1 ||
    result["requestId"] !== request.requestId ||
    result["operation"] !== request.operation
  ) throw new TypeError("Worker result does not correlate to its request");
  if (result["status"] === "failed") {
    validateFailure(result);
    return;
  }
  if (result["status"] !== "succeeded") {
    throw new TypeError("Worker returned an unsupported result status");
  }
  validateSuccess(result, request);
}

/** Operation-bound media types used by the privileged broker verifier. */
export function quarantineMediaTypesFor(
  operation: QuarantineOperation,
): readonly QuarantineMediaType[] {
  return MEDIA_TYPES[operation];
}

/** Exact input bound supplied to the privileged opaque-handle verifier. */
export function quarantineInputByteLimit(request: QuarantineRequest): number {
  return request.operation === "inspectArchive"
    ? request.limits.compressedBytes
    : request.limits.inputBytes;
}

/** Worker-observed input size that must agree with privileged input evidence. */
export function quarantineObservedInputBytes(result: QuarantineSuccess): number {
  return result.operation === "inspectArchive"
    ? result.observed.compressedBytes
    : result.observed.inputBytes;
}

/** Explicit output/closure bound supplied to the privileged verifier. */
export function quarantineOutputByteLimit(request: QuarantineRequest): number {
  return request.operation === "inspectArchive"
    ? request.limits.uncompressedBytes
    : request.limits.outputBytes;
}
