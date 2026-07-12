/**
 * Branded identity types for every identity class named in the spec
 * (Resource Identity section, lines 1270-1315).
 *
 * Each branded type is a distinct nominal type that cannot be accidentally
 * substituted for another at compile-time, even though they are all `string`
 * at runtime.
 *
 * Canonical reference forms (per spec):
 *   PortableAssetId    → stored/referenced as "asset:<uuid>"
 *   PortableFontId     → stored/referenced as "font:<uuid>"
 *   PortableSongWorkId → stored/referenced as "song:<uuid>"
 *   ScriptureTranslationId → stored/referenced as "translation:<uuid>"
 *   RightsCreditId     → stored/referenced as "credit:<uuid>"
 *
 * All other id types are plain UUIDs (no prefix) in canonical lowercase-
 * hyphenated form.
 */

import type { Brand } from "./brand.js";

// ---------------------------------------------------------------------------
// Plain-UUID identity classes
// ---------------------------------------------------------------------------

/** UUIDv4 identifying one workspace. */
export type WorkspaceId = Brand<string, "WorkspaceId">;

/**
 * UUIDv4 unique within one workspace.  Identifies a bulletin, template, asset
 * record, installed pack, or other managed local resource.  Lives in workspace
 * metadata only — never inside portable document JSON.
 */
export type LocalResourceId = Brand<string, "LocalResourceId">;

/** UUIDv4 identifying one exported project/template bundle instance. */
export type BundleId = Brand<string, "BundleId">;

/** UUIDv4 unique within one bundle manifest. */
export type BundleEntryId = Brand<string, "BundleEntryId">;

/** Publisher-stable UUIDv4 identifying a resource pack across versions. */
export type ResourcePackId = Brand<string, "ResourcePackId">;

/** Publisher-stable UUIDv4 unique within one resource pack. */
export type ResourcePackContentId = Brand<string, "ResourcePackContentId">;

/** App-generated UUIDv4 identifying one workspace-local pack maintainer draft. */
export type PackDraftId = Brand<string, "PackDraftId">;

/** App-generated UUIDv4 identifying one shared-library connection. */
export type SharedLibraryConnectionId = Brand<
  string,
  "SharedLibraryConnectionId"
>;

/** App-generated UUIDv4 identifying one Scripture-provider adapter relationship. */
export type ScriptureProviderConnectionId = Brand<
  string,
  "ScriptureProviderConnectionId"
>;

/** Portable UUIDv4 identifying one field-contract lineage across versions. */
export type FieldContractId = Brand<string, "FieldContractId">;

/**
 * Identifier for one visual element instance, scoped to a single document.
 * The spec does not require UUID format; it is an opaque string scoped to the
 * document.
 */
export type DocumentElementId = Brand<string, "DocumentElementId">;

/**
 * Identifier for one conditional/repeatable content rule, scoped to a
 * document.
 */
export type ContentRuleId = Brand<string, "ContentRuleId">;

/** UUIDv4 identifying one item in a repeat-bound array within a document. */
export type RepeatItemId = Brand<string, "RepeatItemId">;

/** UUIDv4 identifying one stable schedule within a workspace Church Profile. */
export type ChurchProfileScheduleId = Brand<string, "ChurchProfileScheduleId">;

/** UUIDv4 identifying one private weekly-checklist task. */
export type WeeklyChecklistItemId = Brand<string, "WeeklyChecklistItemId">;

/** UUIDv4 identifying one immutable workspace-local document snapshot. */
export type HistorySnapshotId = Brand<string, "HistorySnapshotId">;

/** UUIDv4 identifying one backup or handoff archive instance. */
export type BackupHandoffId = Brand<string, "BackupHandoffId">;

/** UUIDv4 identifying one exported AI contract/import exchange. */
export type AiExchangeId = Brand<string, "AiExchangeId">;

// ---------------------------------------------------------------------------
// Prefixed reference string identity classes
// ---------------------------------------------------------------------------

/**
 * Portable asset reference in the form `"asset:<uuid>"`.
 *
 * The UUID portion is a portable asset id identifying one immutable canonical
 * build-safe binary revision.  This is NOT the same as a `LocalResourceId`.
 */
export type PortableAssetRef = Brand<string, "PortableAssetRef">;

/**
 * Portable font reference in the form `"font:<uuid>"`.
 *
 * Identifies one immutable managed font-family revision.
 */
export type PortableFontRef = Brand<string, "PortableFontRef">;

/**
 * Portable song-work reference in the form `"song:<uuid>"`.
 *
 * Identifies one logical song/work lineage across immutable content/rights
 * revisions.
 */
export type PortableSongWorkRef = Brand<string, "PortableSongWorkRef">;

/**
 * Scripture translation reference in the form `"translation:<uuid>"`.
 *
 * Identifies one reviewed translation identity; never derived from a
 * label/acronym.
 */
export type ScriptureTranslationRef = Brand<string, "ScriptureTranslationRef">;

/**
 * Rights credit reference in the form `"credit:<uuid>"`.
 *
 * Identifies one exact rights component/credit lineage; identity never derives
 * from title text.
 */
export type RightsCreditRef = Brand<string, "RightsCreditRef">;

// ---------------------------------------------------------------------------
// Convenience: the UUID-only portion of a prefixed reference
// ---------------------------------------------------------------------------

/**
 * The bare UUID extracted from a `PortableAssetRef` (`"asset:<uuid>"`).
 * Use this when you need to index by the UUID portion alone (e.g., in the
 * workspace asset resolver map).
 */
export type PortableAssetId = Brand<string, "PortableAssetId">;

/** The bare UUID extracted from a `PortableFontRef` (`"font:<uuid>"`). */
export type PortableFontId = Brand<string, "PortableFontId">;

/** The bare UUID extracted from a `PortableSongWorkRef` (`"song:<uuid>"`). */
export type PortableSongWorkId = Brand<string, "PortableSongWorkId">;

/** The bare UUID extracted from a `ScriptureTranslationRef` (`"translation:<uuid>"`). */
export type ScriptureTranslationId = Brand<string, "ScriptureTranslationId">;

/** The bare UUID extracted from a `RightsCreditRef` (`"credit:<uuid>"`). */
export type RightsCreditId = Brand<string, "RightsCreditId">;

// ---------------------------------------------------------------------------
// Custom-element identity
// ---------------------------------------------------------------------------

/**
 * Identifier for a custom element type definition (schema).  Scoped to the
 * workspace or pack that defines it.
 */
export type CustomElementTypeId = Brand<string, "CustomElementTypeId">;
