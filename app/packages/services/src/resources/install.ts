import {
  canonicalJsonBytes,
  hashBytes,
  type Sha256Hash,
} from "@cbb/core";
import {
  readVerifiedQuarantineReceipt,
  type QuarantineOperation,
  type VerifiedQuarantineOutputEvidence,
  type VerifiedQuarantineReceipt,
} from "@cbb/workers";
import {
  WORKSPACE_REGISTRY_PATH,
  registryHash,
  type LocalResourceRecord,
  type WorkspaceRegistry,
} from "../workspace/index.js";
import type {
  PutResourceMutation,
  TransactionDigest,
  TransactionRequest,
} from "../transactions/index.js";
import { createResourceResolverIndex } from "./catalog.js";
import type {
  AssetRevisionRecord,
  FontRevisionRecord,
} from "./types.js";

export const WORKSPACE_REGISTRY_RESOURCE_KEY = "workspaceRegistry";

export function assetRecordResourceKey(localId: string): string {
  return `assetRecord:${localId}`;
}

export function assetCanonicalResourceKey(localId: string): string {
  return `assetCanonical:${localId}`;
}

export function fontRecordResourceKey(localId: string): string {
  return `fontRecord:${localId}`;
}

export function fontFaceResourceKey(localId: string, faceId: string): string {
  return `fontFace:${localId}:${faceId}`;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FACE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** Closed mapping consumed by NodeWorkspaceTransactionStorage. */
export const workspaceResourceTransactionPaths = {
  resolve(resourceKey: string): string | undefined {
    if (resourceKey === WORKSPACE_REGISTRY_RESOURCE_KEY) return WORKSPACE_REGISTRY_PATH;
    const assetRecord = /^assetRecord:([0-9a-f-]{36})$/.exec(resourceKey);
    if (assetRecord?.[1] !== undefined && UUID_V4.test(assetRecord[1])) {
      return `assets/${assetRecord[1]}/asset.json`;
    }
    const assetCanonical = /^assetCanonical:([0-9a-f-]{36})$/.exec(resourceKey);
    if (assetCanonical?.[1] !== undefined && UUID_V4.test(assetCanonical[1])) {
      return `assets/${assetCanonical[1]}/canonical`;
    }
    const fontRecord = /^fontRecord:([0-9a-f-]{36})$/.exec(resourceKey);
    if (fontRecord?.[1] !== undefined && UUID_V4.test(fontRecord[1])) {
      return `fonts/${fontRecord[1]}/font.json`;
    }
    const fontFace = /^fontFace:([0-9a-f-]{36}):(.+)$/.exec(resourceKey);
    if (
      fontFace?.[1] !== undefined &&
      fontFace[2] !== undefined &&
      UUID_V4.test(fontFace[1]) &&
      FACE_ID.test(fontFace[2])
    ) {
      return `fonts/${fontFace[1]}/faces/${fontFace[2]}`;
    }
    return undefined;
  },
};

export interface PlannedResourceInstall {
  readonly request: TransactionRequest;
  readonly updatedRegistry: WorkspaceRegistry;
}

export interface PlanAssetInstallInput {
  readonly sourceDigest: TransactionDigest;
  readonly registry: WorkspaceRegistry;
  readonly record: unknown;
  readonly canonicalBytes: Uint8Array;
  /** Broker-minted after an independent privileged rehash of canonicalBytes. */
  readonly validationReceipt: VerifiedQuarantineReceipt;
}

export interface FontFaceInstallBytes {
  readonly faceId: string;
  readonly bytes: Uint8Array;
  /** Broker-minted after isolated inspection and privileged byte rehash. */
  readonly validationReceipt: VerifiedQuarantineReceipt;
}

export interface PlanFontInstallInput {
  readonly sourceDigest: TransactionDigest;
  readonly registry: WorkspaceRegistry;
  readonly record: unknown;
  readonly faces: readonly FontFaceInstallBytes[];
  readonly installedAt: string;
}

function allRegistryResources(registry: WorkspaceRegistry): readonly LocalResourceRecord[] {
  return [
    ...(registry.bulletins ?? []),
    ...(registry.templates ?? []),
    ...(registry.assets ?? []),
    ...(registry.fonts ?? []),
    ...(registry.songs ?? []),
    ...(registry.scriptureCatalog ?? []),
    ...(registry.resourcePacks ?? []),
    ...(registry.importProvenance ?? []),
    ...(registry.installedPackState ?? []),
    ...(registry.sharedLibraryConnections ?? []),
    ...(registry.scriptureProviderConfig ?? []),
    ...(registry.packMaintainerDrafts ?? []),
  ];
}

function ensureNewLocalId(registry: WorkspaceRegistry, localId: string): void {
  if (allRegistryResources(registry).some((resource) => resource.localId === localId)) {
    throw new TypeError("Immutable resource installation requires a new local id");
  }
}

function digest(bytes: Uint8Array): TransactionDigest {
  return hashBytes(bytes) as TransactionDigest;
}

function verifyBytes(bytes: Uint8Array, expectedHash: Sha256Hash, expectedSize: number): void {
  if (bytes.byteLength !== expectedSize || hashBytes(bytes) !== expectedHash) {
    throw new TypeError("Validated resource bytes do not match their immutable record");
  }
}

function verifiedEvidence(
  receipt: VerifiedQuarantineReceipt,
  operation: QuarantineOperation,
  mediaType: string,
  expectedHash: Sha256Hash,
  expectedSize: number,
): VerifiedQuarantineOutputEvidence {
  const evidence = readVerifiedQuarantineReceipt(receipt);
  if (
    evidence.operation !== operation ||
    evidence.mediaType !== mediaType ||
    evidence.outputHash !== expectedHash ||
    evidence.outputBytes !== expectedSize
  ) {
    throw new TypeError("Quarantine receipt does not bind the installed resource bytes");
  }
  return evidence;
}

function assetValidationOperation(mediaType: string): QuarantineOperation {
  switch (mediaType) {
    case "image/svg+xml": return "sanitizeSvg";
    case "image/png": return "canonicalizeRaster";
    case "application/pdf": return "flattenPdf";
    default:
      throw new TypeError("Asset media type has no closed quarantine canonicalization operation");
  }
}

function fontMediaType(format: FontRevisionRecord["faces"][number]["format"]): string {
  return `font/${format}`;
}

function sameAxes(
  left: Readonly<Record<string, number>> | undefined,
  right: Readonly<Record<string, number>> | undefined,
): boolean {
  const leftEntries = Object.entries(left ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const rightEntries = Object.entries(right ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return leftEntries.length === rightEntries.length && leftEntries.every(
    ([key, value], index) => rightEntries[index]?.[0] === key && rightEntries[index]?.[1] === value,
  );
}

function recordMutation(
  id: string,
  resourceKey: string,
  bytes: Uint8Array,
): PutResourceMutation {
  return {
    id,
    resourceKey,
    operation: "put",
    expectedOldHash: null,
    expectedNewHash: digest(bytes),
    newBytes: new Uint8Array(bytes),
    idempotent: true,
  };
}

function registryMutation(
  before: WorkspaceRegistry,
  after: WorkspaceRegistry,
): PutResourceMutation {
  return {
    id: "advance_registry",
    resourceKey: WORKSPACE_REGISTRY_RESOURCE_KEY,
    operation: "put",
    expectedOldHash: registryHash(before) as TransactionDigest,
    expectedNewHash: registryHash(after) as TransactionDigest,
    newBytes: canonicalJsonBytes(after),
    idempotent: true,
    commitMarker: true,
  };
}

function addRegistryRecord(
  registry: WorkspaceRegistry,
  collection: "assets" | "fonts",
  resource: LocalResourceRecord,
): WorkspaceRegistry {
  return {
    ...registry,
    [collection]: [...(registry[collection] ?? []), resource].sort((left, right) =>
      left.localId < right.localId ? -1 : left.localId > right.localId ? 1 : 0,
    ),
  };
}

function registryRecord(
  kind: "asset" | "font",
  localId: AssetRevisionRecord["localId"] | FontRevisionRecord["localId"],
  displayName: string,
  storagePath: string,
  recordBytes: Uint8Array,
  timestamp: string,
): LocalResourceRecord {
  if (
    !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z$/.test(
      timestamp,
    )
  ) {
    throw new TypeError("Resource installation timestamp must be canonical UTC");
  }
  return {
    localId,
    kind,
    displayName,
    storagePath,
    contentHash: hashBytes(recordBytes),
    createdAt: timestamp,
    modifiedAt: timestamp,
  };
}

export function planAssetRevisionInstall(
  input: PlanAssetInstallInput,
): PlannedResourceInstall {
  const index = createResourceResolverIndex({ assets: [input.record], fonts: [] });
  const record = [...index.assetsByRef.values()][0];
  if (record === undefined || record.sanitizationState !== "validated") {
    throw new TypeError("Only validated canonical asset revisions may be installed");
  }
  ensureNewLocalId(input.registry, record.localId);
  const assetEvidence = verifiedEvidence(
    input.validationReceipt,
    assetValidationOperation(record.mediaType),
    record.mediaType,
    record.canonicalHash,
    record.byteSize,
  );
  if (assetEvidence.result.operation !== assetEvidence.operation) {
    throw new TypeError("Quarantine receipt metadata is operation-mismatched");
  }
  if (assetEvidence.result.operation === "canonicalizeRaster") {
    if (
      record.width === undefined ||
      record.height === undefined ||
      record.width !== assetEvidence.result.observed.width ||
      record.height !== assetEvidence.result.observed.height
    ) {
      throw new TypeError("Asset dimensions disagree with validated raster metadata");
    }
  }
  verifyBytes(input.canonicalBytes, record.canonicalHash, record.byteSize);
  const recordBytes = canonicalJsonBytes(record);
  const resource = registryRecord(
    "asset",
    record.localId,
    record.displayName,
    `assets/${record.localId}/asset.json`,
    recordBytes,
    record.importedAt,
  );
  const updatedRegistry = addRegistryRecord(input.registry, "assets", resource);
  return {
    updatedRegistry,
    request: {
      sourceDigest: input.sourceDigest,
      mutations: [
        recordMutation(
          "write_asset_canonical",
          assetCanonicalResourceKey(record.localId),
          input.canonicalBytes,
        ),
        recordMutation(
          "write_asset_record",
          assetRecordResourceKey(record.localId),
          recordBytes,
        ),
        registryMutation(input.registry, updatedRegistry),
      ],
    },
  };
}

export function planFontRevisionInstall(
  input: PlanFontInstallInput,
): PlannedResourceInstall {
  const index = createResourceResolverIndex({ assets: [], fonts: [input.record] });
  const record = [...index.fontsByRef.values()][0];
  if (record === undefined || record.validationState !== "validated") {
    throw new TypeError("Only isolated-validated font revisions may be installed");
  }
  if (record.unicodeCoverageSummary === undefined) {
    throw new TypeError("Validated font installation requires isolated Unicode coverage evidence");
  }
  ensureNewLocalId(input.registry, record.localId);
  const provided = new Map<string, FontFaceInstallBytes>();
  for (const face of input.faces) {
    if (provided.has(face.faceId)) throw new TypeError("Duplicate font face payload");
    provided.set(face.faceId, face);
  }
  if (provided.size < record.faces.length) {
    throw new TypeError("Font face payload closure is incomplete");
  }
  if (provided.size > record.faces.length) {
    throw new TypeError("Font face payload closure has surplus entries");
  }
  const faceMutations: PutResourceMutation[] = [];
  const sortedFaces = [...record.faces].sort((left, right) =>
    left.faceId < right.faceId ? -1 : left.faceId > right.faceId ? 1 : 0,
  );
  for (const face of sortedFaces) {
    const payload = provided.get(face.faceId);
    if (payload === undefined) throw new TypeError(`Missing font face payload ${face.faceId}`);
    const evidence = verifiedEvidence(
      payload.validationReceipt,
      "inspectFont",
      fontMediaType(face.format),
      face.hash,
      face.byteSize,
    );
    if (evidence.result.operation !== "inspectFont") {
      throw new TypeError("Font receipt does not contain validated font metadata");
    }
    const inspected = evidence.result.faces.find(
      (candidate) => candidate.faceIndex === face.faceIndex,
    );
    if (
      inspected === undefined ||
      inspected.weight !== face.weight ||
      inspected.style !== face.style ||
      inspected.stretch !== face.stretch ||
      !sameAxes(inspected.variableAxisCoordinates, face.variableAxisCoordinates) ||
      inspected.familyName !== record.typstFamilyName ||
      evidence.result.unicodeCoverageSummary !== record.unicodeCoverageSummary ||
      inspected.pdfEmbeddingPermitted !== record.pdfEmbeddingPermitted ||
      inspected.pdfSubsettingPermitted !== record.pdfSubsettingPermitted ||
      (record.familyName !== undefined && inspected.familyName !== record.familyName) ||
      (record.postScriptName !== undefined && inspected.postScriptName !== record.postScriptName)
    ) {
      throw new TypeError("Font record disagrees with isolated inspection metadata");
    }
    verifyBytes(payload.bytes, face.hash, face.byteSize);
    faceMutations.push(
      recordMutation(
        `write_font_face_${face.faceId}`,
        fontFaceResourceKey(record.localId, face.faceId),
        payload.bytes,
      ),
    );
    provided.delete(face.faceId);
  }
  if (provided.size !== 0) throw new TypeError("Font face payload closure has surplus entries");
  const recordBytes = canonicalJsonBytes(record);
  const resource = registryRecord(
    "font",
    record.localId,
    record.displayName,
    `fonts/${record.localId}/font.json`,
    recordBytes,
    input.installedAt,
  );
  const updatedRegistry = addRegistryRecord(input.registry, "fonts", resource);
  return {
    updatedRegistry,
    request: {
      sourceDigest: input.sourceDigest,
      mutations: [
        ...faceMutations,
        recordMutation(
          "write_font_record",
          fontRecordResourceKey(record.localId),
          recordBytes,
        ),
        registryMutation(input.registry, updatedRegistry),
      ],
    },
  };
}
