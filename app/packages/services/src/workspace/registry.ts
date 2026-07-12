import {
  hashCanonical,
  isLocalResourceId,
  isWorkspaceId,
  type CanonicalRevisionToken,
  type SchemaCatalog,
} from "@cbb/core";
import { assertSafeRelativePath, canonicalDocumentPath } from "./paths.js";
import type {
  LocalResourceRecord,
  WorkspaceRegistry,
  WorkspaceResourceKind,
} from "./types.js";

export const WORKSPACE_SCHEMA_ID =
  "https://church-bulletin-builder.local/schema/v1/workspace.schema.json";
export const SETTINGS_SCHEMA_ID =
  "https://church-bulletin-builder.local/schema/v1/settings.schema.json";
export const CHURCH_PROFILE_SCHEMA_ID =
  "https://church-bulletin-builder.local/schema/v1/church-profile.schema.json";

const HASH_RE = /^sha256:[0-9a-f]{64}$/u;
const forbiddenLabel = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

export function normalizeDisplayLabel(value: string): string {
  const normalized = value.normalize("NFC").trim();
  if (
    normalized.length === 0 ||
    forbiddenLabel.test(normalized) ||
    Array.from(normalized).length > 120
  ) {
    throw new Error("Display name violates the bounded Unicode label contract");
  }
  return normalized;
}

function validateResourceArray(
  records: readonly LocalResourceRecord[] | undefined,
  allIds: Set<string>,
  allPaths: Set<string>,
  expectedKind?: WorkspaceResourceKind | "asset" | "font",
): void {
  for (const record of records ?? []) {
    if (!isLocalResourceId(record.localId) || allIds.has(record.localId)) {
      throw new Error("Workspace registry has an invalid or duplicate local resource id");
    }
    allIds.add(record.localId);
    normalizeDisplayLabel(record.displayName);
    if (!HASH_RE.test(record.contentHash)) {
      throw new Error("Workspace registry has an invalid content hash");
    }
    const storagePath = assertSafeRelativePath(record.storagePath);
    const pathAlias = storagePath.normalize("NFC").toLowerCase();
    if (allPaths.has(pathAlias)) {
      throw new Error("Workspace registry contains duplicate or aliased storage paths");
    }
    allPaths.add(pathAlias);
    if (expectedKind !== undefined) {
      if (record.kind !== expectedKind) {
        throw new Error(`Workspace ${expectedKind} record has the wrong kind`);
      }
      const canonical = expectedKind === "bulletin" || expectedKind === "template"
        ? canonicalDocumentPath(expectedKind, record.localId)
        : expectedKind === "asset"
          ? `assets/${record.localId}/asset.json`
          : `fonts/${record.localId}/font.json`;
      if (record.storagePath !== canonical) {
        throw new Error(`Workspace ${expectedKind} record has a non-canonical storage path`);
      }
    }
  }
}

export function parseWorkspaceRegistry(
  value: unknown,
  catalog: SchemaCatalog,
): WorkspaceRegistry {
  const structural = catalog.validateAgainst(WORKSPACE_SCHEMA_ID, value);
  if (!structural.valid) {
    throw new Error(
      `Workspace registry validation failed: ${structural.errors[0]?.message ?? "invalid registry"}`,
    );
  }
  const registry = value as WorkspaceRegistry;
  if (!isWorkspaceId(registry.workspaceId)) {
    throw new Error("Workspace registry contains an invalid workspace id");
  }
  if (registry.displayName !== undefined) normalizeDisplayLabel(registry.displayName);
  const allIds = new Set<string>();
  const allPaths = new Set<string>();
  validateResourceArray(registry.bulletins, allIds, allPaths, "bulletin");
  validateResourceArray(registry.templates, allIds, allPaths, "template");
  validateResourceArray(registry.assets, allIds, allPaths, "asset");
  validateResourceArray(registry.fonts, allIds, allPaths, "font");
  for (const records of [
    registry.songs,
    registry.scriptureCatalog,
    registry.resourcePacks,
    registry.importProvenance,
    registry.installedPackState,
    registry.sharedLibraryConnections,
    registry.scriptureProviderConfig,
    registry.packMaintainerDrafts,
  ]) {
    validateResourceArray(records, allIds, allPaths);
  }
  return registry;
}

export function registryHash(registry: WorkspaceRegistry): CanonicalRevisionToken {
  return hashCanonical(registry) as CanonicalRevisionToken;
}

export function createEmptyRegistry(
  workspaceId: WorkspaceRegistry["workspaceId"],
  displayName?: string,
): WorkspaceRegistry {
  return {
    version: 1,
    kind: "workspace",
    workspaceId,
    ...(displayName === undefined ? {} : { displayName: normalizeDisplayLabel(displayName) }),
    bulletins: [],
    templates: [],
    assets: [],
    fonts: [],
    songs: [],
    scriptureCatalog: [],
    resourcePacks: [],
    importProvenance: [],
    installedPackState: [],
    sharedLibraryConnections: [],
    scriptureProviderConfig: [],
    packMaintainerDrafts: [],
  };
}
