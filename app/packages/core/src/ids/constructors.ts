/**
 * Constructor and validator functions for every identity class.
 *
 * Design:
 *   - `is*` functions are type-guards that validate format at runtime.
 *   - `parse*` functions return the branded type or throw a TypeError.
 *   - `mint*` functions create new ids via the injected IdPort.
 *   - `format*` functions render a branded id back to its canonical string form
 *     (primarily useful for the prefixed reference types).
 */

import type { IdPort } from "./port.js";
import { isCanonicalUuid } from "./uuid.js";
import type {
  AiExchangeId,
  BackupHandoffId,
  BundleEntryId,
  BundleId,
  ChurchProfileScheduleId,
  ContentRuleId,
  CustomElementTypeId,
  DocumentElementId,
  FieldContractId,
  HistorySnapshotId,
  LocalResourceId,
  PackDraftId,
  PortableAssetId,
  PortableAssetRef,
  PortableFontId,
  PortableFontRef,
  PortableSongWorkId,
  PortableSongWorkRef,
  RepeatItemId,
  ResourcePackContentId,
  ResourcePackId,
  RightsCreditId,
  RightsCreditRef,
  ScriptureProviderConnectionId,
  ScriptureTranslationId,
  ScriptureTranslationRef,
  SharedLibraryConnectionId,
  WeeklyChecklistItemId,
  WorkspaceId,
} from "./types.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function requireUuid(raw: string, label: string): string {
  if (!isCanonicalUuid(raw)) {
    throw new TypeError(
      `${label}: expected canonical lowercase-hyphenated UUID, got: ${JSON.stringify(raw)}`,
    );
  }
  return raw;
}

function requirePrefixedRef(
  raw: string,
  prefix: string,
  label: string,
): string {
  if (!raw.startsWith(`${prefix}:`)) {
    throw new TypeError(
      `${label}: expected reference starting with "${prefix}:", got: ${JSON.stringify(raw)}`,
    );
  }
  const uuid = raw.slice(prefix.length + 1);
  if (!isCanonicalUuid(uuid)) {
    throw new TypeError(
      `${label}: UUID portion is not canonical: ${JSON.stringify(uuid)}`,
    );
  }
  return raw;
}

function extractUuid(ref: string, prefix: string, label: string): string {
  requirePrefixedRef(ref, prefix, label);
  return ref.slice(prefix.length + 1);
}

// ---------------------------------------------------------------------------
// WorkspaceId
// ---------------------------------------------------------------------------

export function isWorkspaceId(value: string): value is WorkspaceId {
  return isCanonicalUuid(value);
}

export function parseWorkspaceId(raw: string): WorkspaceId {
  return requireUuid(raw, "WorkspaceId") as WorkspaceId;
}

export function mintWorkspaceId(port: IdPort): WorkspaceId {
  return parseWorkspaceId(port.randomUuid());
}

// ---------------------------------------------------------------------------
// LocalResourceId
// ---------------------------------------------------------------------------

export function isLocalResourceId(value: string): value is LocalResourceId {
  return isCanonicalUuid(value);
}

export function parseLocalResourceId(raw: string): LocalResourceId {
  return requireUuid(raw, "LocalResourceId") as LocalResourceId;
}

export function mintLocalResourceId(port: IdPort): LocalResourceId {
  return parseLocalResourceId(port.randomUuid());
}

// ---------------------------------------------------------------------------
// BundleId
// ---------------------------------------------------------------------------

export function isBundleId(value: string): value is BundleId {
  return isCanonicalUuid(value);
}

export function parseBundleId(raw: string): BundleId {
  return requireUuid(raw, "BundleId") as BundleId;
}

export function mintBundleId(port: IdPort): BundleId {
  return parseBundleId(port.randomUuid());
}

// ---------------------------------------------------------------------------
// BundleEntryId
// ---------------------------------------------------------------------------

export function isBundleEntryId(value: string): value is BundleEntryId {
  return isCanonicalUuid(value);
}

export function parseBundleEntryId(raw: string): BundleEntryId {
  return requireUuid(raw, "BundleEntryId") as BundleEntryId;
}

export function mintBundleEntryId(port: IdPort): BundleEntryId {
  return parseBundleEntryId(port.randomUuid());
}

// ---------------------------------------------------------------------------
// ResourcePackId
// ---------------------------------------------------------------------------

export function isResourcePackId(value: string): value is ResourcePackId {
  return isCanonicalUuid(value);
}

export function parseResourcePackId(raw: string): ResourcePackId {
  return requireUuid(raw, "ResourcePackId") as ResourcePackId;
}

// ResourcePackId is publisher-stable; no mint function (publishers generate it
// outside this runtime).

// ---------------------------------------------------------------------------
// ResourcePackContentId
// ---------------------------------------------------------------------------

export function isResourcePackContentId(
  value: string,
): value is ResourcePackContentId {
  return isCanonicalUuid(value);
}

export function parseResourcePackContentId(
  raw: string,
): ResourcePackContentId {
  return requireUuid(raw, "ResourcePackContentId") as ResourcePackContentId;
}

// ---------------------------------------------------------------------------
// PackDraftId
// ---------------------------------------------------------------------------

export function isPackDraftId(value: string): value is PackDraftId {
  return isCanonicalUuid(value);
}

export function parsePackDraftId(raw: string): PackDraftId {
  return requireUuid(raw, "PackDraftId") as PackDraftId;
}

export function mintPackDraftId(port: IdPort): PackDraftId {
  return parsePackDraftId(port.randomUuid());
}

// ---------------------------------------------------------------------------
// SharedLibraryConnectionId
// ---------------------------------------------------------------------------

export function isSharedLibraryConnectionId(
  value: string,
): value is SharedLibraryConnectionId {
  return isCanonicalUuid(value);
}

export function parseSharedLibraryConnectionId(
  raw: string,
): SharedLibraryConnectionId {
  return requireUuid(
    raw,
    "SharedLibraryConnectionId",
  ) as SharedLibraryConnectionId;
}

export function mintSharedLibraryConnectionId(
  port: IdPort,
): SharedLibraryConnectionId {
  return parseSharedLibraryConnectionId(port.randomUuid());
}

// ---------------------------------------------------------------------------
// ScriptureProviderConnectionId
// ---------------------------------------------------------------------------

export function isScriptureProviderConnectionId(
  value: string,
): value is ScriptureProviderConnectionId {
  return isCanonicalUuid(value);
}

export function parseScriptureProviderConnectionId(
  raw: string,
): ScriptureProviderConnectionId {
  return requireUuid(
    raw,
    "ScriptureProviderConnectionId",
  ) as ScriptureProviderConnectionId;
}

export function mintScriptureProviderConnectionId(
  port: IdPort,
): ScriptureProviderConnectionId {
  return parseScriptureProviderConnectionId(port.randomUuid());
}

// ---------------------------------------------------------------------------
// FieldContractId
// ---------------------------------------------------------------------------

export function isFieldContractId(value: string): value is FieldContractId {
  return isCanonicalUuid(value);
}

export function parseFieldContractId(raw: string): FieldContractId {
  return requireUuid(raw, "FieldContractId") as FieldContractId;
}

export function mintFieldContractId(port: IdPort): FieldContractId {
  return parseFieldContractId(port.randomUuid());
}

// ---------------------------------------------------------------------------
// DocumentElementId
// ---------------------------------------------------------------------------

// The spec says element ids are "portable and scoped to one document" but does
// not mandate UUID format.  We accept any non-empty string (implementations
// typically use UUIDs, but validation allows any non-empty opaque string).
export function isDocumentElementId(
  value: string,
): value is DocumentElementId {
  return value.length > 0;
}

export function parseDocumentElementId(raw: string): DocumentElementId {
  if (raw.length === 0) {
    throw new TypeError("DocumentElementId must be a non-empty string");
  }
  return raw as DocumentElementId;
}

export function mintDocumentElementId(port: IdPort): DocumentElementId {
  return parseDocumentElementId(port.randomUuid());
}

// ---------------------------------------------------------------------------
// ContentRuleId
// ---------------------------------------------------------------------------

export function isContentRuleId(value: string): value is ContentRuleId {
  return value.length > 0;
}

export function parseContentRuleId(raw: string): ContentRuleId {
  if (raw.length === 0) {
    throw new TypeError("ContentRuleId must be a non-empty string");
  }
  return raw as ContentRuleId;
}

export function mintContentRuleId(port: IdPort): ContentRuleId {
  return parseContentRuleId(port.randomUuid());
}

// ---------------------------------------------------------------------------
// RepeatItemId
// ---------------------------------------------------------------------------

export function isRepeatItemId(value: string): value is RepeatItemId {
  return isCanonicalUuid(value);
}

export function parseRepeatItemId(raw: string): RepeatItemId {
  return requireUuid(raw, "RepeatItemId") as RepeatItemId;
}

export function mintRepeatItemId(port: IdPort): RepeatItemId {
  return parseRepeatItemId(port.randomUuid());
}

// ---------------------------------------------------------------------------
// ChurchProfileScheduleId
// ---------------------------------------------------------------------------

export function isChurchProfileScheduleId(
  value: string,
): value is ChurchProfileScheduleId {
  return isCanonicalUuid(value);
}

export function parseChurchProfileScheduleId(
  raw: string,
): ChurchProfileScheduleId {
  return requireUuid(raw, "ChurchProfileScheduleId") as ChurchProfileScheduleId;
}

export function mintChurchProfileScheduleId(
  port: IdPort,
): ChurchProfileScheduleId {
  return parseChurchProfileScheduleId(port.randomUuid());
}

// ---------------------------------------------------------------------------
// WeeklyChecklistItemId
// ---------------------------------------------------------------------------

export function isWeeklyChecklistItemId(
  value: string,
): value is WeeklyChecklistItemId {
  return isCanonicalUuid(value);
}

export function parseWeeklyChecklistItemId(
  raw: string,
): WeeklyChecklistItemId {
  return requireUuid(raw, "WeeklyChecklistItemId") as WeeklyChecklistItemId;
}

export function mintWeeklyChecklistItemId(
  port: IdPort,
): WeeklyChecklistItemId {
  return parseWeeklyChecklistItemId(port.randomUuid());
}

// ---------------------------------------------------------------------------
// HistorySnapshotId
// ---------------------------------------------------------------------------

export function isHistorySnapshotId(
  value: string,
): value is HistorySnapshotId {
  return isCanonicalUuid(value);
}

export function parseHistorySnapshotId(raw: string): HistorySnapshotId {
  return requireUuid(raw, "HistorySnapshotId") as HistorySnapshotId;
}

export function mintHistorySnapshotId(port: IdPort): HistorySnapshotId {
  return parseHistorySnapshotId(port.randomUuid());
}

// ---------------------------------------------------------------------------
// BackupHandoffId
// ---------------------------------------------------------------------------

export function isBackupHandoffId(value: string): value is BackupHandoffId {
  return isCanonicalUuid(value);
}

export function parseBackupHandoffId(raw: string): BackupHandoffId {
  return requireUuid(raw, "BackupHandoffId") as BackupHandoffId;
}

export function mintBackupHandoffId(port: IdPort): BackupHandoffId {
  return parseBackupHandoffId(port.randomUuid());
}

// ---------------------------------------------------------------------------
// AiExchangeId
// ---------------------------------------------------------------------------

export function isAiExchangeId(value: string): value is AiExchangeId {
  return isCanonicalUuid(value);
}

export function parseAiExchangeId(raw: string): AiExchangeId {
  return requireUuid(raw, "AiExchangeId") as AiExchangeId;
}

export function mintAiExchangeId(port: IdPort): AiExchangeId {
  return parseAiExchangeId(port.randomUuid());
}

// ---------------------------------------------------------------------------
// CustomElementTypeId
// ---------------------------------------------------------------------------

export function isCustomElementTypeId(
  value: string,
): value is CustomElementTypeId {
  return value.length > 0;
}

export function parseCustomElementTypeId(raw: string): CustomElementTypeId {
  if (raw.length === 0) {
    throw new TypeError("CustomElementTypeId must be a non-empty string");
  }
  return raw as CustomElementTypeId;
}

export function mintCustomElementTypeId(port: IdPort): CustomElementTypeId {
  return parseCustomElementTypeId(port.randomUuid());
}

// ---------------------------------------------------------------------------
// PortableAssetRef / PortableAssetId
// ---------------------------------------------------------------------------

export function isPortableAssetRef(value: string): value is PortableAssetRef {
  if (!value.startsWith("asset:")) return false;
  return isCanonicalUuid(value.slice(6));
}

export function parsePortableAssetRef(raw: string): PortableAssetRef {
  return requirePrefixedRef(raw, "asset", "PortableAssetRef") as PortableAssetRef;
}

export function mintPortableAssetRef(port: IdPort): PortableAssetRef {
  return parsePortableAssetRef(`asset:${parsePortableAssetId(port.randomUuid())}`);
}

/** Format a bare `PortableAssetId` UUID as its canonical reference string. */
export function formatAssetRef(id: PortableAssetId): PortableAssetRef {
  return `asset:${id}` as PortableAssetRef;
}

/** Extract the bare UUID from a `PortableAssetRef`. */
export function extractAssetId(ref: PortableAssetRef): PortableAssetId {
  return extractUuid(ref, "asset", "PortableAssetRef") as PortableAssetId;
}

export function isPortableAssetId(value: string): value is PortableAssetId {
  return isCanonicalUuid(value);
}

export function parsePortableAssetId(raw: string): PortableAssetId {
  return requireUuid(raw, "PortableAssetId") as PortableAssetId;
}

export function mintPortableAssetId(port: IdPort): PortableAssetId {
  return parsePortableAssetId(port.randomUuid());
}

// ---------------------------------------------------------------------------
// PortableFontRef / PortableFontId
// ---------------------------------------------------------------------------

export function isPortableFontRef(value: string): value is PortableFontRef {
  if (!value.startsWith("font:")) return false;
  return isCanonicalUuid(value.slice(5));
}

export function parsePortableFontRef(raw: string): PortableFontRef {
  return requirePrefixedRef(raw, "font", "PortableFontRef") as PortableFontRef;
}

export function mintPortableFontRef(port: IdPort): PortableFontRef {
  return parsePortableFontRef(`font:${parsePortableFontId(port.randomUuid())}`);
}

/** Format a bare `PortableFontId` UUID as its canonical reference string. */
export function formatFontRef(id: PortableFontId): PortableFontRef {
  return `font:${id}` as PortableFontRef;
}

/** Extract the bare UUID from a `PortableFontRef`. */
export function extractFontId(ref: PortableFontRef): PortableFontId {
  return extractUuid(ref, "font", "PortableFontRef") as PortableFontId;
}

export function isPortableFontId(value: string): value is PortableFontId {
  return isCanonicalUuid(value);
}

export function parsePortableFontId(raw: string): PortableFontId {
  return requireUuid(raw, "PortableFontId") as PortableFontId;
}

export function mintPortableFontId(port: IdPort): PortableFontId {
  return port.randomUuid() as PortableFontId;
}

// ---------------------------------------------------------------------------
// PortableSongWorkRef / PortableSongWorkId
// ---------------------------------------------------------------------------

export function isPortableSongWorkRef(
  value: string,
): value is PortableSongWorkRef {
  if (!value.startsWith("song:")) return false;
  return isCanonicalUuid(value.slice(5));
}

export function parsePortableSongWorkRef(raw: string): PortableSongWorkRef {
  return requirePrefixedRef(
    raw,
    "song",
    "PortableSongWorkRef",
  ) as PortableSongWorkRef;
}

export function mintPortableSongWorkRef(port: IdPort): PortableSongWorkRef {
  return `song:${port.randomUuid()}` as PortableSongWorkRef;
}

/** Format a bare `PortableSongWorkId` UUID as its canonical reference string. */
export function formatSongWorkRef(id: PortableSongWorkId): PortableSongWorkRef {
  return `song:${id}` as PortableSongWorkRef;
}

/** Extract the bare UUID from a `PortableSongWorkRef`. */
export function extractSongWorkId(
  ref: PortableSongWorkRef,
): PortableSongWorkId {
  return extractUuid(ref, "song", "PortableSongWorkRef") as PortableSongWorkId;
}

export function isPortableSongWorkId(
  value: string,
): value is PortableSongWorkId {
  return isCanonicalUuid(value);
}

export function parsePortableSongWorkId(raw: string): PortableSongWorkId {
  return requireUuid(raw, "PortableSongWorkId") as PortableSongWorkId;
}

export function mintPortableSongWorkId(port: IdPort): PortableSongWorkId {
  return port.randomUuid() as PortableSongWorkId;
}

// ---------------------------------------------------------------------------
// ScriptureTranslationRef / ScriptureTranslationId
// ---------------------------------------------------------------------------

export function isScriptureTranslationRef(
  value: string,
): value is ScriptureTranslationRef {
  if (!value.startsWith("translation:")) return false;
  return isCanonicalUuid(value.slice(12));
}

export function parseScriptureTranslationRef(
  raw: string,
): ScriptureTranslationRef {
  return requirePrefixedRef(
    raw,
    "translation",
    "ScriptureTranslationRef",
  ) as ScriptureTranslationRef;
}

export function mintScriptureTranslationRef(
  port: IdPort,
): ScriptureTranslationRef {
  return `translation:${port.randomUuid()}` as ScriptureTranslationRef;
}

/** Format a bare `ScriptureTranslationId` UUID as its canonical reference string. */
export function formatTranslationRef(
  id: ScriptureTranslationId,
): ScriptureTranslationRef {
  return `translation:${id}` as ScriptureTranslationRef;
}

/** Extract the bare UUID from a `ScriptureTranslationRef`. */
export function extractTranslationId(
  ref: ScriptureTranslationRef,
): ScriptureTranslationId {
  return extractUuid(
    ref,
    "translation",
    "ScriptureTranslationRef",
  ) as ScriptureTranslationId;
}

export function isScriptureTranslationId(
  value: string,
): value is ScriptureTranslationId {
  return isCanonicalUuid(value);
}

export function parseScriptureTranslationId(
  raw: string,
): ScriptureTranslationId {
  return requireUuid(raw, "ScriptureTranslationId") as ScriptureTranslationId;
}

export function mintScriptureTranslationId(
  port: IdPort,
): ScriptureTranslationId {
  return port.randomUuid() as ScriptureTranslationId;
}

// ---------------------------------------------------------------------------
// RightsCreditRef / RightsCreditId
// ---------------------------------------------------------------------------

export function isRightsCreditRef(value: string): value is RightsCreditRef {
  if (!value.startsWith("credit:")) return false;
  return isCanonicalUuid(value.slice(7));
}

export function parseRightsCreditRef(raw: string): RightsCreditRef {
  return requirePrefixedRef(
    raw,
    "credit",
    "RightsCreditRef",
  ) as RightsCreditRef;
}

export function mintRightsCreditRef(port: IdPort): RightsCreditRef {
  return `credit:${port.randomUuid()}` as RightsCreditRef;
}

/** Format a bare `RightsCreditId` UUID as its canonical reference string. */
export function formatCreditRef(id: RightsCreditId): RightsCreditRef {
  return `credit:${id}` as RightsCreditRef;
}

/** Extract the bare UUID from a `RightsCreditRef`. */
export function extractCreditId(ref: RightsCreditRef): RightsCreditId {
  return extractUuid(ref, "credit", "RightsCreditRef") as RightsCreditId;
}

export function isRightsCreditId(value: string): value is RightsCreditId {
  return isCanonicalUuid(value);
}

export function parseRightsCreditId(raw: string): RightsCreditId {
  return requireUuid(raw, "RightsCreditId") as RightsCreditId;
}

export function mintRightsCreditId(port: IdPort): RightsCreditId {
  return port.randomUuid() as RightsCreditId;
}
