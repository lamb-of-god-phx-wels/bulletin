import type { CbbDocument } from "@cbb/core";

/** One closed invoke channel is the renderer's entire privileged surface. */
export const M4_IPC_CHANNEL = "cbb:m4:invoke" as const;
export const M4_BRIDGE_VERSION = 1 as const;

export const M4_IPC_LIMITS = Object.freeze({
  documentBytes: 50 * 1024 * 1024,
  editBufferBytes: 256 * 1024,
  appSettingsBytes: 1024 * 1024,
  churchProfileBytes: 1024 * 1024,
  pdfBytes: 256 * 1024 * 1024,
  imageAssetBytes: 64 * 1024 * 1024,
  maximumImageAssetRows: 5_000,
  maximumDocumentRows: 20_000,
  maximumEditBuffersPerDocument: 512,
  maximumLoadedDocumentBases: 4,
  maximumTrackedPreviewDocuments: 256,
  maximumPreviewPageCount: 100_000,
  maximumPreviewNavigationEntries: 50_000,
  maximumJsonDepth: 128,
  maximumJsonNodes: 250_000,
  maximumLabelCodePoints: 120,
  maximumBufferKeyCodePoints: 128,
  maximumChurchProfileSchedules: 512,
  maximumChurchProfileDictionaryWords: 4_096,
  maximumSourceTemplateLinks: 20_000,
  maximumSpellingWordCodePoints: 64,
  maximumLanguageCodePoints: 64,
});

export type M4ResourceKind = "bulletin" | "template";
export type M4DocumentFilter = M4ResourceKind | "all";

export interface M4DocumentSummary {
  readonly localResourceId: string;
  readonly resourceKind: M4ResourceKind;
  readonly displayName: string;
  readonly modifiedAt: string;
  readonly lastOpenedAt?: string;
  readonly revisionToken: string;
}

export interface M4LoadedDocument {
  readonly localResourceId: string;
  readonly resourceKind: M4ResourceKind;
  readonly displayName: string;
  readonly modifiedAt: string;
  readonly lastOpenedAt?: string;
  readonly revisionToken: string;
  readonly document: CbbDocument;
}

export type M4SaveDocumentOutcome =
  | { readonly status: "saved"; readonly revisionToken: string }
  | {
      readonly status: "conflicted" | "recoveryRequired" | "failed";
      readonly message: string;
    };

export interface M4EditBufferValue {
  readonly value: string;
  readonly updatedAt: string;
}

export type M4DocumentSaveState = "clean" | "dirty" | "saving" | "saveFailed";
export type M4EditBufferSaveState = "clean" | "pending" | "failed";

/** Closed, non-path-bearing host capabilities required before renderer boot. */
export interface M4BootstrapState {
  readonly workspaceAccess: "readWrite" | "readOnly";
}

/** Path-free result of the host-owned first-launch directory chooser. */
export type M4WorkspaceLocationOutcome =
  | { readonly status: "canceled" | "restarting" }
  | { readonly status: "unavailable"; readonly message: string };

export interface M4ImageAssetSummary {
  readonly localAssetId: string;
  readonly assetRef: string;
  readonly displayName: string;
  readonly mediaType: "image/png" | "image/svg+xml";
  readonly byteSize: number;
  readonly pixelWidth?: number;
  readonly pixelHeight?: number;
  readonly importedAt: string;
}

/** Path-free result of the host-owned native image import flow. */
export type M4ImageAssetImportOutcome =
  | { readonly status: "canceled" }
  | { readonly status: "imported"; readonly asset: M4ImageAssetSummary }
  | { readonly status: "readOnly" | "unavailable"; readonly message: string };

export interface M4WorkspaceSettings {
  readonly version: 1;
  readonly kind: "workspaceSettings";
  readonly scope?: "workspace";
  readonly viewMode?: "page" | "contiguous";
  readonly pagePresentation?: "single" | "facing";
  readonly previewZoom?: "fitPage" | "fitWidth" | number;
  readonly marginGuides?: boolean;
  readonly livePreview?: boolean;
  readonly technicalPdfDetails?: boolean;
  readonly canvasSnap?: boolean;
  readonly defaultExportFormat?: "readerOrder" | "bookletTwoUp";
  readonly snapGridSize?: string;
  readonly exportFilenamePattern?: string;
  readonly offlineSpellcheck?: boolean;
  readonly displayTimeZone?: string;
  readonly previewResolution?: number;
  readonly sourceTemplateLinks?: readonly {
    readonly bulletinLocalResourceId: string;
    readonly templateLocalResourceId: string;
  }[];
  readonly firstRun?: {
    readonly version: 1;
    readonly disposition: "inProgress" | "completed" | "skipped";
    readonly step?: 0 | 1 | 2;
    readonly churchName?: string;
    readonly mailingAddress?: string;
    readonly locationAddress?: string;
    readonly phone?: string;
    readonly email?: string;
    readonly website?: string;
    readonly logo?: string;
    readonly preferredOutput?: "fullSheet" | "foldedBooklet" | "other";
    readonly starterId?: "simple-service" | "folded-letter" | "announcements" | "blank-accessible";
    readonly createPracticeBulletin?: boolean;
    readonly tourCompleted?: boolean;
    readonly tourBulletinLocalResourceId?: string;
  };
}

export interface M4WorkspaceSettingsSnapshot {
  readonly value: M4WorkspaceSettings;
  readonly revisionToken: string;
}

export type M4WorkspaceSettingsSaveOutcome =
  | ({ readonly status: "saved" } & M4WorkspaceSettingsSnapshot)
  | {
      readonly status: "conflicted";
      readonly currentRevisionToken: string | null;
      readonly message: string;
    }
  | { readonly status: "readOnly" | "failed"; readonly message: string };

export interface M4ChurchProfileSchedule {
  readonly id: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly dayOfWeek?: number;
}

/** Closed, workspace-local congregation defaults. No storage locations cross IPC. */
export interface M4ChurchProfile {
  readonly version: 1;
  readonly kind: "churchProfile";
  readonly churchName?: string;
  readonly mailingAddress?: string;
  readonly locationAddress?: string;
  readonly phone?: string;
  readonly email?: string;
  readonly website?: string;
  readonly defaultServiceLabel?: string;
  readonly logo?: string;
  /** Legacy onboarding property; never exposed as a field-contract profileKey. */
  readonly congregationName?: string;
  readonly language?: string;
  readonly defaultPublicationContexts?: readonly (
    | "printedNonsalableChurchBulletin"
    | "digitalNonsalableChurchBulletin"
  )[];
  readonly defaultUnknownRightsPolicy?: "review" | "block";
  readonly spellingDictionary?: readonly string[];
  readonly schedules?: readonly M4ChurchProfileSchedule[];
}

export interface M4ChurchProfileSnapshot {
  readonly value: M4ChurchProfile | null;
  readonly revisionToken: string | null;
}

export type M4ChurchProfileSaveOutcome =
  | {
      readonly status: "saved";
      readonly value: M4ChurchProfile;
      readonly revisionToken: string;
    }
  | {
      readonly status: "conflicted";
      readonly currentRevisionToken: string | null;
      readonly message: string;
    }
  | { readonly status: "readOnly" | "failed"; readonly message: string };

export interface M4PreviewAdmission {
  readonly status: "enqueued" | "ignored";
  readonly buildId: string;
}

export type M4PreviewFailure = "couldNotBuild" | "tookTooLong" | "canceled" | "outOfDate";

export interface M4PreviewNavigationEntry {
  readonly resolvedId: string;
  readonly sourceElementId: string;
  readonly pageNumber: number;
  readonly region: "body" | "page-background" | "page-foreground";
}

export interface M4PreviewNavigationMap {
  readonly version: 1;
  readonly entries: readonly M4PreviewNavigationEntry[];
}

export interface M4PreviewState {
  readonly status: "unavailable" | "idle" | "queued" | "building" | "current" | "stale" | "failed";
  readonly lastSuccessfulBuildId?: string;
  readonly attemptedBuildId?: string;
  readonly pageCount?: number;
  readonly navigationMap?: M4PreviewNavigationMap;
  readonly failure?: M4PreviewFailure;
  readonly message?: string;
}

export type M4JsonPrimitive = string | number | boolean | null;
export type M4JsonValue =
  | M4JsonPrimitive
  | readonly M4JsonValue[]
  | { readonly [key: string]: M4JsonValue };

export type M4IpcRequest =
  | {
      readonly version: 1;
      readonly operation: "bootstrap.read";
      readonly payload: Record<string, never>;
    }
  | {
      readonly version: 1;
      readonly operation: "workspace.chooseLocation";
      readonly payload: Record<string, never>;
    }
  | {
      readonly version: 1;
      readonly operation: "documents.list";
      readonly payload: { readonly filter: M4DocumentFilter };
    }
  | {
      readonly version: 1;
      readonly operation: "documents.load";
      readonly payload: { readonly localResourceId: string };
    }
  | {
      readonly version: 1;
      readonly operation: "documents.save";
      readonly payload: {
        readonly localResourceId: string;
        readonly resourceKind: M4ResourceKind;
        readonly displayName: string;
        readonly document: CbbDocument;
        readonly baseRevisionToken: string | null;
      };
    }
  | {
      readonly version: 1;
      readonly operation: "documents.saveState";
      readonly payload: {
        readonly localResourceId: string;
        readonly state: M4DocumentSaveState;
      };
    }
  | {
      readonly version: 1;
      readonly operation: "editBuffer.read";
      readonly payload: {
        readonly localResourceId: string;
        readonly bufferKey: string;
      };
    }
  | {
      readonly version: 1;
      readonly operation: "editBuffer.write";
      readonly payload: {
        readonly localResourceId: string;
        readonly bufferKey: string;
        readonly value: string;
      };
    }
  | {
      readonly version: 1;
      readonly operation: "editBuffer.delete";
      readonly payload: {
        readonly localResourceId: string;
        readonly bufferKey: string;
      };
    }
  | {
      readonly version: 1;
      readonly operation: "editBuffer.saveState";
      readonly payload: {
        readonly localResourceId: string;
        readonly state: M4EditBufferSaveState;
      };
    }
  | {
      readonly version: 1;
      readonly operation: "appSettings.read";
      readonly payload: Record<string, never>;
    }
  | {
      readonly version: 1;
      readonly operation: "appSettings.write";
      readonly payload: { readonly value: M4JsonValue };
    }
  | {
      readonly version: 1;
      readonly operation: "workspaceSettings.read";
      readonly payload: Record<string, never>;
    }
  | {
      readonly version: 1;
      readonly operation: "workspaceSettings.write";
      readonly payload: {
        readonly value: M4WorkspaceSettings;
        readonly baseRevisionToken: string;
      };
    }
  | {
      readonly version: 1;
      readonly operation: "churchProfile.read";
      readonly payload: Record<string, never>;
    }
  | {
      readonly version: 1;
      readonly operation: "churchProfile.write";
      readonly payload: {
        readonly value: M4ChurchProfile;
        readonly baseRevisionToken: string | null;
      };
    }
  | {
      readonly version: 1;
      readonly operation: "assets.images.list";
      readonly payload: Record<string, never>;
    }
  | {
      readonly version: 1;
      readonly operation: "assets.image.import";
      readonly payload: Record<string, never>;
    }
  | {
      readonly version: 1;
      readonly operation: "assets.image.read";
      readonly payload: {
        readonly localAssetId: string;
        readonly assetRef: string;
      };
    }
  | {
      readonly version: 1;
      readonly operation: "preview.request";
      readonly payload: {
        readonly localResourceId: string;
        readonly requestSequence: number;
      };
    }
  | {
      readonly version: 1;
      readonly operation: "preview.state";
      readonly payload: { readonly localResourceId: string };
    }
  | {
      readonly version: 1;
      readonly operation: "preview.cancel";
      readonly payload: { readonly buildId: string };
    }
  | {
      readonly version: 1;
      readonly operation: "pdf.read";
      readonly payload: {
        readonly bulletinLocalResourceId: string;
        readonly buildId: string;
      };
    };

export type M4IpcOperation = M4IpcRequest["operation"];

export interface M4BridgeError {
  readonly code: "invalidRequest" | "notAuthorized" | "notFound" | "conflict" | "unavailable" | "failed";
  readonly message: string;
}

export type M4IpcResponse =
  | {
      readonly version: 1;
      readonly ok: true;
      readonly operation: M4IpcOperation;
      readonly value: unknown;
    }
  | {
      readonly version: 1;
      readonly ok: false;
      readonly operation: M4IpcOperation | "invalid";
      readonly error: M4BridgeError;
    };

export interface M4RendererBridge {
  readonly version: 1;
  readBootstrapState(): Promise<M4BootstrapState>;
  chooseWorkspaceLocation(): Promise<M4WorkspaceLocationOutcome>;
  listDocuments(filter?: M4DocumentFilter): Promise<readonly M4DocumentSummary[]>;
  loadDocument(localResourceId: string): Promise<M4LoadedDocument>;
  saveDocument(input: Extract<M4IpcRequest, { operation: "documents.save" }>["payload"]): Promise<M4SaveDocumentOutcome>;
  setDocumentSaveState(localResourceId: string, state: M4DocumentSaveState): Promise<void>;
  readEditBuffer(localResourceId: string, bufferKey: string): Promise<M4EditBufferValue | null>;
  writeEditBuffer(localResourceId: string, bufferKey: string, value: string): Promise<M4EditBufferValue>;
  deleteEditBuffer(localResourceId: string, bufferKey: string): Promise<boolean>;
  setEditBufferSaveState(localResourceId: string, state: M4EditBufferSaveState): Promise<void>;
  readAppSettings(): Promise<M4JsonValue>;
  writeAppSettings(value: M4JsonValue): Promise<M4JsonValue>;
  readWorkspaceSettings(): Promise<M4WorkspaceSettingsSnapshot>;
  writeWorkspaceSettings(value: M4WorkspaceSettings, baseRevisionToken: string): Promise<M4WorkspaceSettingsSaveOutcome>;
  readChurchProfile(): Promise<M4ChurchProfileSnapshot>;
  writeChurchProfile(value: M4ChurchProfile, baseRevisionToken: string | null): Promise<M4ChurchProfileSaveOutcome>;
  listImageAssets(): Promise<readonly M4ImageAssetSummary[]>;
  importImageAsset(): Promise<M4ImageAssetImportOutcome>;
  readImageAssetBytes(localAssetId: string, assetRef: string): Promise<Uint8Array>;
  requestPreview(input: { readonly localResourceId: string; readonly requestSequence: number }): Promise<M4PreviewAdmission>;
  getPreviewState(localResourceId: string): Promise<M4PreviewState>;
  cancelPreview(buildId: string): Promise<boolean>;
  readPdfBytes(bulletinLocalResourceId: string, buildId: string): Promise<Uint8Array>;
}

export class M4ContractError extends Error {
  readonly code = "invalidRequest" as const;

  constructor(message = "The app could not understand that request.") {
    super(message);
    this.name = "M4ContractError";
  }
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const REVISION = /^sha256:[0-9a-f]{64}$/u;
const UTC_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z$/u;
const BUFFER_KEY = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u;
const ASSET_REF = /^asset:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const FORBIDDEN_LABEL = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

function record(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key));
}

function codePoints(value: string): number {
  return Array.from(value).length;
}

function localId(value: unknown): value is string {
  return typeof value === "string" && UUID_V4.test(value);
}

function revision(value: unknown): value is string {
  return typeof value === "string" && REVISION.test(value);
}

function assetRef(value: unknown): value is string {
  return typeof value === "string" && ASSET_REF.test(value);
}

function label(value: unknown): value is string {
  return typeof value === "string" &&
    value.normalize("NFC") === value &&
    value.trim() === value &&
    value.length > 0 &&
    codePoints(value) <= M4_IPC_LIMITS.maximumLabelCodePoints &&
    !FORBIDDEN_LABEL.test(value);
}

function bufferKey(value: unknown): value is string {
  return typeof value === "string" &&
    codePoints(value) <= M4_IPC_LIMITS.maximumBufferKeyCodePoints &&
    BUFFER_KEY.test(value);
}

function resourceKind(value: unknown): value is M4ResourceKind {
  return value === "bulletin" || value === "template";
}

function documentSaveState(value: unknown): value is M4DocumentSaveState {
  return value === "clean" || value === "dirty" || value === "saving" || value === "saveFailed";
}

function editBufferSaveState(value: unknown): value is M4EditBufferSaveState {
  return value === "clean" || value === "pending" || value === "failed";
}

function safeMessage(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 500 &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}

function timeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 128 ||
    !/^[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z][A-Za-z0-9._+-]*)*$/u.test(value)) return false;
  try {
    // Schema validation closes the shape; ICU closes membership against the
    // time-zone data bundled with the desktop runtime.
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function firstRunPreference(value: unknown): boolean {
  if (!record(value) || !exactKeys(value, ["version", "disposition"], [
    "step",
    "churchName",
    "mailingAddress",
    "locationAddress",
    "phone",
    "email",
    "website",
    "logo",
    "preferredOutput",
    "starterId",
    "createPracticeBulletin",
    "tourCompleted",
    "tourBulletinLocalResourceId",
  ])) return false;
  if (value["version"] !== 1 ||
    (value["disposition"] !== "inProgress" && value["disposition"] !== "completed" &&
      value["disposition"] !== "skipped")) return false;
  const inProgress = value["disposition"] === "inProgress";
  const draftOnlyKeys = [
    "step",
    "churchName",
    "mailingAddress",
    "locationAddress",
    "phone",
    "email",
    "website",
    "logo",
    "createPracticeBulletin",
  ] as const;
  if (!inProgress && draftOnlyKeys.some((key) => value[key] !== undefined)) return false;
  if (inProgress && (value["tourCompleted"] !== undefined ||
    value["tourBulletinLocalResourceId"] !== undefined)) return false;
  if (value["logo"] !== undefined && (!inProgress || !assetRef(value["logo"]))) return false;
  if (value["step"] !== undefined && value["step"] !== 0 &&
    value["step"] !== 1 && value["step"] !== 2) return false;
  for (const key of [
    "churchName",
    "mailingAddress",
    "locationAddress",
    "phone",
    "email",
    "website",
  ] as const) {
    if (value[key] !== undefined && !label(value[key])) return false;
  }
  const preferredOutput = value["preferredOutput"];
  if (preferredOutput !== undefined && preferredOutput !== "fullSheet" &&
    preferredOutput !== "foldedBooklet" && preferredOutput !== "other") return false;
  const starterId = value["starterId"];
  if (starterId !== undefined && starterId !== "simple-service" &&
    starterId !== "folded-letter" && starterId !== "announcements" &&
    starterId !== "blank-accessible") return false;
  if (value["createPracticeBulletin"] !== undefined &&
    typeof value["createPracticeBulletin"] !== "boolean") return false;
  return (value["tourCompleted"] === undefined || typeof value["tourCompleted"] === "boolean") &&
    (value["tourBulletinLocalResourceId"] === undefined || localId(value["tourBulletinLocalResourceId"]));
}

function sourceTemplateLinks(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > M4_IPC_LIMITS.maximumSourceTemplateLinks) {
    return false;
  }
  let previousBulletinId: string | undefined;
  for (const link of value) {
    if (!record(link) || !exactKeys(link, [
      "bulletinLocalResourceId",
      "templateLocalResourceId",
    ]) ||
      !localId(link["bulletinLocalResourceId"]) ||
      !localId(link["templateLocalResourceId"]) ||
      link["bulletinLocalResourceId"] === link["templateLocalResourceId"] ||
      (previousBulletinId !== undefined &&
        previousBulletinId.localeCompare(link["bulletinLocalResourceId"] as string, "en-US") >= 0)) {
      return false;
    }
    previousBulletinId = link["bulletinLocalResourceId"] as string;
  }
  return true;
}

function languageTag(value: unknown): value is string {
  return typeof value === "string" &&
    value.normalize("NFC") === value &&
    value.length <= M4_IPC_LIMITS.maximumLanguageCodePoints &&
    /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u.test(value);
}

export function assertM4ChurchProfile(value: unknown): asserts value is M4ChurchProfile {
  if (!record(value) ||
    !exactKeys(value, ["version", "kind"], [
      "churchName",
      "mailingAddress",
      "locationAddress",
      "phone",
      "email",
      "website",
      "defaultServiceLabel",
      "logo",
      "congregationName",
      "language",
      "defaultPublicationContexts",
      "defaultUnknownRightsPolicy",
      "spellingDictionary",
      "schedules",
    ]) ||
    value["version"] !== 1 || value["kind"] !== "churchProfile" ||
    (value["churchName"] !== undefined && !label(value["churchName"])) ||
    (value["mailingAddress"] !== undefined && !label(value["mailingAddress"])) ||
    (value["locationAddress"] !== undefined && !label(value["locationAddress"])) ||
    (value["phone"] !== undefined && !label(value["phone"])) ||
    (value["email"] !== undefined && !label(value["email"])) ||
    (value["website"] !== undefined && !label(value["website"])) ||
    (value["defaultServiceLabel"] !== undefined && !label(value["defaultServiceLabel"])) ||
    (value["logo"] !== undefined && !assetRef(value["logo"])) ||
    (value["congregationName"] !== undefined && !label(value["congregationName"])) ||
    (value["language"] !== undefined && !languageTag(value["language"])) ||
    (value["defaultUnknownRightsPolicy"] !== undefined &&
      value["defaultUnknownRightsPolicy"] !== "review" &&
      value["defaultUnknownRightsPolicy"] !== "block")) {
    throw new M4ContractError();
  }

  const publicationContexts = value["defaultPublicationContexts"];
  if (publicationContexts !== undefined) {
    if (!Array.isArray(publicationContexts) || publicationContexts.length > 2) {
      throw new M4ContractError();
    }
    const seen = new Set<string>();
    for (const context of publicationContexts) {
      if (context !== "printedNonsalableChurchBulletin" &&
        context !== "digitalNonsalableChurchBulletin") throw new M4ContractError();
      if (seen.has(context)) throw new M4ContractError();
      seen.add(context);
    }
  }

  const schedules = value["schedules"];
  if (schedules !== undefined) {
    if (!Array.isArray(schedules) || schedules.length > M4_IPC_LIMITS.maximumChurchProfileSchedules) {
      throw new M4ContractError();
    }
    const seen = new Set<string>();
    for (const schedule of schedules) {
      if (!record(schedule) ||
        !exactKeys(schedule, ["id", "label", "enabled"], ["dayOfWeek"]) ||
        !localId(schedule["id"]) || !label(schedule["label"]) ||
        typeof schedule["enabled"] !== "boolean" ||
        (schedule["dayOfWeek"] !== undefined &&
          (!Number.isSafeInteger(schedule["dayOfWeek"]) ||
            (schedule["dayOfWeek"] as number) < 0 ||
            (schedule["dayOfWeek"] as number) > 6)) ||
        seen.has(schedule["id"])) {
        throw new M4ContractError();
      }
      seen.add(schedule["id"]);
    }
  }

  const spellingDictionary = value["spellingDictionary"];
  if (spellingDictionary !== undefined) {
    if (!Array.isArray(spellingDictionary) ||
      spellingDictionary.length > M4_IPC_LIMITS.maximumChurchProfileDictionaryWords) {
      throw new M4ContractError();
    }
    let previous: string | undefined;
    for (const word of spellingDictionary) {
      if (typeof word !== "string" || word.length === 0 ||
        [...word].length > M4_IPC_LIMITS.maximumSpellingWordCodePoints ||
        word.normalize("NFC") !== word || word.toLocaleLowerCase("en-US") !== word ||
        !/^[\p{L}\p{M}]+(?:['’\u2010-\u2015-][\p{L}\p{M}]+)*$/u.test(word) ||
        (previous !== undefined && previous.localeCompare(word, "en-US") >= 0)) {
        throw new M4ContractError();
      }
      previous = word;
    }
  }
  assertBoundedJson(value, M4_IPC_LIMITS.churchProfileBytes);
}

export function assertM4WorkspaceSettings(value: unknown): asserts value is M4WorkspaceSettings {
  if (!record(value) ||
    !exactKeys(value, ["version", "kind"], [
      "scope",
      "viewMode",
      "pagePresentation",
      "previewZoom",
      "marginGuides",
      "livePreview",
      "technicalPdfDetails",
      "canvasSnap",
      "defaultExportFormat",
      "snapGridSize",
      "exportFilenamePattern",
      "offlineSpellcheck",
      "displayTimeZone",
      "previewResolution",
      "sourceTemplateLinks",
      "firstRun",
    ]) ||
    value["version"] !== 1 || value["kind"] !== "workspaceSettings" ||
    (value["scope"] !== undefined && value["scope"] !== "workspace") ||
    (value["viewMode"] !== undefined &&
      value["viewMode"] !== "page" && value["viewMode"] !== "contiguous") ||
    (value["pagePresentation"] !== undefined &&
      value["pagePresentation"] !== "single" && value["pagePresentation"] !== "facing") ||
    (value["previewZoom"] !== undefined &&
      value["previewZoom"] !== "fitPage" && value["previewZoom"] !== "fitWidth" &&
      (!Number.isSafeInteger(value["previewZoom"]) ||
        (value["previewZoom"] as number) < 25 || (value["previewZoom"] as number) > 200)) ||
    (value["marginGuides"] !== undefined && typeof value["marginGuides"] !== "boolean") ||
    (value["livePreview"] !== undefined && typeof value["livePreview"] !== "boolean") ||
    (value["technicalPdfDetails"] !== undefined && typeof value["technicalPdfDetails"] !== "boolean") ||
    (value["canvasSnap"] !== undefined && typeof value["canvasSnap"] !== "boolean") ||
    (value["defaultExportFormat"] !== undefined &&
      value["defaultExportFormat"] !== "readerOrder" && value["defaultExportFormat"] !== "bookletTwoUp") ||
    (value["snapGridSize"] !== undefined &&
      (typeof value["snapGridSize"] !== "string" ||
        !/^(?:(?:0*[1-9][0-9]*)(?:\.[0-9]+)?|0+\.0*[1-9][0-9]*)(?:pt|in|cm|mm)$/u.test(value["snapGridSize"]))) ||
    (value["exportFilenamePattern"] !== undefined &&
      (typeof value["exportFilenamePattern"] !== "string" ||
        value["exportFilenamePattern"].length < 1 || value["exportFilenamePattern"].length > 240 ||
        /[\u0000-\u001f\u007f/\\]/u.test(value["exportFilenamePattern"]))) ||
    (value["offlineSpellcheck"] !== undefined && typeof value["offlineSpellcheck"] !== "boolean") ||
    (value["displayTimeZone"] !== undefined && !timeZone(value["displayTimeZone"])) ||
    (value["previewResolution"] !== undefined &&
      (!Number.isSafeInteger(value["previewResolution"]) ||
        (value["previewResolution"] as number) < 72 ||
        (value["previewResolution"] as number) > 1_000_000)) ||
    (value["sourceTemplateLinks"] !== undefined &&
      !sourceTemplateLinks(value["sourceTemplateLinks"])) ||
    (value["firstRun"] !== undefined && !firstRunPreference(value["firstRun"]))) {
    throw new M4ContractError();
  }
  assertBoundedJson(value, M4_IPC_LIMITS.appSettingsBytes);
}

function jsonSize(value: unknown, maximumBytes: number): number {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new M4ContractError();
  }
  if (serialized === undefined) throw new M4ContractError();
  const size = new TextEncoder().encode(serialized).byteLength;
  if (size > maximumBytes) throw new M4ContractError();
  return size;
}

/** Reject prototypes, cycles, non-JSON values, pathological depth, and huge graphs. */
export function assertBoundedJson(value: unknown, maximumBytes: number): asserts value is M4JsonValue {
  const stack: Array<{ readonly value: unknown; readonly depth: number }> = [{ value, depth: 0 }];
  const seen = new Set<object>();
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    nodes += 1;
    if (nodes > M4_IPC_LIMITS.maximumJsonNodes || current.depth > M4_IPC_LIMITS.maximumJsonDepth) {
      throw new M4ContractError();
    }
    const item = current.value;
    if (item === null || typeof item === "string" || typeof item === "boolean") continue;
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new M4ContractError();
      continue;
    }
    if (typeof item !== "object") throw new M4ContractError();
    if (seen.has(item)) throw new M4ContractError();
    seen.add(item);
    if (Array.isArray(item)) {
      for (const child of item) stack.push({ value: child, depth: current.depth + 1 });
      continue;
    }
    if (!record(item)) throw new M4ContractError();
    for (const [key, child] of Object.entries(item)) {
      if (key.length === 0 || key.length > 512) throw new M4ContractError();
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }
  jsonSize(value, maximumBytes);
}

function parseIdAndKeyPayload(value: unknown): { readonly localResourceId: string; readonly bufferKey: string } {
  if (!record(value) || !exactKeys(value, ["localResourceId", "bufferKey"]) ||
    !localId(value["localResourceId"]) || !bufferKey(value["bufferKey"])) {
    throw new M4ContractError();
  }
  return { localResourceId: value["localResourceId"], bufferKey: value["bufferKey"] };
}

export function parseM4IpcRequest(value: unknown): M4IpcRequest {
  if (!record(value) || !exactKeys(value, ["version", "operation", "payload"]) || value["version"] !== 1 || typeof value["operation"] !== "string") {
    throw new M4ContractError();
  }
  const payload = value["payload"];
  switch (value["operation"]) {
    case "bootstrap.read": {
      if (!record(payload) || !exactKeys(payload, [])) throw new M4ContractError();
      return { version: 1, operation: "bootstrap.read", payload: {} };
    }
    case "workspace.chooseLocation": {
      if (!record(payload) || !exactKeys(payload, [])) throw new M4ContractError();
      return { version: 1, operation: "workspace.chooseLocation", payload: {} };
    }
    case "documents.list": {
      if (!record(payload) || !exactKeys(payload, ["filter"]) ||
        (payload["filter"] !== "all" && !resourceKind(payload["filter"]))) throw new M4ContractError();
      return { version: 1, operation: "documents.list", payload: { filter: payload["filter"] } };
    }
    case "documents.load": {
      if (!record(payload) || !exactKeys(payload, ["localResourceId"]) || !localId(payload["localResourceId"])) throw new M4ContractError();
      return { version: 1, operation: "documents.load", payload: { localResourceId: payload["localResourceId"] } };
    }
    case "documents.save": {
      if (!record(payload) || !exactKeys(payload, ["localResourceId", "resourceKind", "displayName", "document", "baseRevisionToken"]) ||
        !localId(payload["localResourceId"]) || !resourceKind(payload["resourceKind"]) || !label(payload["displayName"]) ||
        (payload["baseRevisionToken"] !== null && !revision(payload["baseRevisionToken"]))) throw new M4ContractError();
      assertBoundedJson(payload["document"], M4_IPC_LIMITS.documentBytes);
      if (!record(payload["document"]) || payload["document"]["kind"] !== payload["resourceKind"]) throw new M4ContractError();
      return {
        version: 1,
        operation: "documents.save",
        payload: {
          localResourceId: payload["localResourceId"],
          resourceKind: payload["resourceKind"],
          displayName: payload["displayName"],
          document: payload["document"] as unknown as CbbDocument,
          baseRevisionToken: payload["baseRevisionToken"] as string | null,
        },
      };
    }
    case "documents.saveState": {
      if (!record(payload) || !exactKeys(payload, ["localResourceId", "state"]) ||
        !localId(payload["localResourceId"]) || !documentSaveState(payload["state"])) {
        throw new M4ContractError();
      }
      return {
        version: 1,
        operation: "documents.saveState",
        payload: { localResourceId: payload["localResourceId"], state: payload["state"] },
      };
    }
    case "editBuffer.read":
    case "editBuffer.delete": {
      const parsed = parseIdAndKeyPayload(payload);
      return { version: 1, operation: value["operation"], payload: parsed };
    }
    case "editBuffer.write": {
      if (!record(payload) || !exactKeys(payload, ["localResourceId", "bufferKey", "value"]) ||
        !localId(payload["localResourceId"]) || !bufferKey(payload["bufferKey"]) || typeof payload["value"] !== "string" ||
        new TextEncoder().encode(payload["value"]).byteLength > M4_IPC_LIMITS.editBufferBytes) throw new M4ContractError();
      return {
        version: 1,
        operation: "editBuffer.write",
        payload: {
          localResourceId: payload["localResourceId"],
          bufferKey: payload["bufferKey"],
          value: payload["value"],
        },
      };
    }
    case "editBuffer.saveState": {
      if (!record(payload) || !exactKeys(payload, ["localResourceId", "state"]) ||
        !localId(payload["localResourceId"]) || !editBufferSaveState(payload["state"])) {
        throw new M4ContractError();
      }
      return {
        version: 1,
        operation: "editBuffer.saveState",
        payload: { localResourceId: payload["localResourceId"], state: payload["state"] },
      };
    }
    case "appSettings.read": {
      if (!record(payload) || !exactKeys(payload, [])) throw new M4ContractError();
      return { version: 1, operation: "appSettings.read", payload: {} };
    }
    case "appSettings.write": {
      if (!record(payload) || !exactKeys(payload, ["value"])) throw new M4ContractError();
      assertBoundedJson(payload["value"], M4_IPC_LIMITS.appSettingsBytes);
      return { version: 1, operation: "appSettings.write", payload: { value: payload["value"] } };
    }
    case "workspaceSettings.read": {
      if (!record(payload) || !exactKeys(payload, [])) throw new M4ContractError();
      return { version: 1, operation: "workspaceSettings.read", payload: {} };
    }
    case "workspaceSettings.write": {
      if (!record(payload) || !exactKeys(payload, ["value", "baseRevisionToken"]) ||
        !revision(payload["baseRevisionToken"])) throw new M4ContractError();
      assertM4WorkspaceSettings(payload["value"]);
      return {
        version: 1,
        operation: "workspaceSettings.write",
        payload: { value: payload["value"], baseRevisionToken: payload["baseRevisionToken"] },
      };
    }
    case "churchProfile.read": {
      if (!record(payload) || !exactKeys(payload, [])) throw new M4ContractError();
      return { version: 1, operation: "churchProfile.read", payload: {} };
    }
    case "churchProfile.write": {
      if (!record(payload) || !exactKeys(payload, ["value", "baseRevisionToken"]) ||
        (payload["baseRevisionToken"] !== null && !revision(payload["baseRevisionToken"]))) {
        throw new M4ContractError();
      }
      assertM4ChurchProfile(payload["value"]);
      return {
        version: 1,
        operation: "churchProfile.write",
        payload: {
          value: payload["value"],
          baseRevisionToken: payload["baseRevisionToken"] as string | null,
        },
      };
    }
    case "assets.images.list": {
      if (!record(payload) || !exactKeys(payload, [])) throw new M4ContractError();
      return { version: 1, operation: "assets.images.list", payload: {} };
    }
    case "assets.image.import": {
      if (!record(payload) || !exactKeys(payload, [])) throw new M4ContractError();
      return { version: 1, operation: "assets.image.import", payload: {} };
    }
    case "assets.image.read": {
      if (!record(payload) || !exactKeys(payload, ["localAssetId", "assetRef"]) ||
        !localId(payload["localAssetId"]) || !assetRef(payload["assetRef"])) {
        throw new M4ContractError();
      }
      return {
        version: 1,
        operation: "assets.image.read",
        payload: {
          localAssetId: payload["localAssetId"],
          assetRef: payload["assetRef"],
        },
      };
    }
    case "preview.request": {
      if (!record(payload) || !exactKeys(payload, ["localResourceId", "requestSequence"]) ||
        !localId(payload["localResourceId"]) || !Number.isSafeInteger(payload["requestSequence"]) ||
        (payload["requestSequence"] as number) < 1) throw new M4ContractError();
      return {
        version: 1,
        operation: "preview.request",
        payload: {
          localResourceId: payload["localResourceId"],
          requestSequence: payload["requestSequence"] as number,
        },
      };
    }
    case "preview.state": {
      if (!record(payload) || !exactKeys(payload, ["localResourceId"]) ||
        !localId(payload["localResourceId"])) throw new M4ContractError();
      return {
        version: 1,
        operation: "preview.state",
        payload: { localResourceId: payload["localResourceId"] },
      };
    }
    case "preview.cancel": {
      if (!record(payload) || !exactKeys(payload, ["buildId"]) || !localId(payload["buildId"])) {
        throw new M4ContractError();
      }
      return { version: 1, operation: "preview.cancel", payload: { buildId: payload["buildId"] } };
    }
    case "pdf.read": {
      if (!record(payload) || !exactKeys(payload, ["bulletinLocalResourceId", "buildId"]) ||
        !localId(payload["bulletinLocalResourceId"]) || !localId(payload["buildId"])) throw new M4ContractError();
      return {
        version: 1,
        operation: "pdf.read",
        payload: {
          bulletinLocalResourceId: payload["bulletinLocalResourceId"],
          buildId: payload["buildId"],
        },
      };
    }
    default:
      throw new M4ContractError();
  }
}

export function assertM4DocumentSummary(value: unknown): asserts value is M4DocumentSummary {
  if (!record(value) || !exactKeys(value, ["localResourceId", "resourceKind", "displayName", "modifiedAt", "revisionToken"], ["lastOpenedAt"]) ||
    !localId(value["localResourceId"]) || !resourceKind(value["resourceKind"]) || !label(value["displayName"]) ||
    typeof value["modifiedAt"] !== "string" || !UTC_TIMESTAMP.test(value["modifiedAt"]) || !revision(value["revisionToken"]) ||
    (value["lastOpenedAt"] !== undefined && (typeof value["lastOpenedAt"] !== "string" || !UTC_TIMESTAMP.test(value["lastOpenedAt"])))) {
    throw new M4ContractError();
  }
}

export function assertM4BootstrapState(value: unknown): asserts value is M4BootstrapState {
  if (!record(value) || !exactKeys(value, ["workspaceAccess"]) ||
    (value["workspaceAccess"] !== "readWrite" && value["workspaceAccess"] !== "readOnly")) {
    throw new M4ContractError();
  }
}

export function assertM4WorkspaceLocationOutcome(
  value: unknown,
): asserts value is M4WorkspaceLocationOutcome {
  if (!record(value) || typeof value["status"] !== "string") throw new M4ContractError();
  if (value["status"] === "canceled" || value["status"] === "restarting") {
    if (!exactKeys(value, ["status"])) throw new M4ContractError();
    return;
  }
  if (value["status"] !== "unavailable" || !exactKeys(value, ["status", "message"]) ||
    !safeMessage(value["message"]) ||
    /(?:file:\/\/|\/(?:home|users|tmp|var|etc)\/|[a-z]:\\)/iu.test(value["message"] as string)) {
    throw new M4ContractError();
  }
}

export function assertM4ImageAssetSummary(value: unknown): asserts value is M4ImageAssetSummary {
  if (!record(value) ||
    !exactKeys(value, [
      "localAssetId",
      "assetRef",
      "displayName",
      "mediaType",
      "byteSize",
      "importedAt",
    ], ["pixelWidth", "pixelHeight"]) ||
    !localId(value["localAssetId"]) || !assetRef(value["assetRef"]) ||
    !label(value["displayName"]) ||
    (value["mediaType"] !== "image/png" && value["mediaType"] !== "image/svg+xml") ||
    !Number.isSafeInteger(value["byteSize"]) || (value["byteSize"] as number) < 1 ||
    (value["byteSize"] as number) > M4_IPC_LIMITS.imageAssetBytes ||
    (value["pixelWidth"] !== undefined &&
      (!Number.isSafeInteger(value["pixelWidth"]) || (value["pixelWidth"] as number) < 1 ||
        (value["pixelWidth"] as number) > 32_768)) ||
    (value["pixelHeight"] !== undefined &&
      (!Number.isSafeInteger(value["pixelHeight"]) || (value["pixelHeight"] as number) < 1 ||
        (value["pixelHeight"] as number) > 32_768)) ||
    typeof value["importedAt"] !== "string" || !UTC_TIMESTAMP.test(value["importedAt"])) {
    throw new M4ContractError();
  }
  if ((value["pixelWidth"] === undefined) !== (value["pixelHeight"] === undefined)) {
    throw new M4ContractError();
  }
}

export function assertM4ImageAssetImportOutcome(
  value: unknown,
): asserts value is M4ImageAssetImportOutcome {
  if (!record(value) || typeof value["status"] !== "string") throw new M4ContractError();
  if (value["status"] === "canceled") {
    if (!exactKeys(value, ["status"])) throw new M4ContractError();
    return;
  }
  if (value["status"] === "imported") {
    if (!exactKeys(value, ["status", "asset"])) throw new M4ContractError();
    assertM4ImageAssetSummary(value["asset"]);
    return;
  }
  if ((value["status"] !== "readOnly" && value["status"] !== "unavailable") ||
    !exactKeys(value, ["status", "message"]) || !safeMessage(value["message"]) ||
    /(?:file:\/\/|\/(?:home|users|tmp|var|etc)\/|[a-z]:\\)/iu.test(value["message"] as string)) {
    throw new M4ContractError();
  }
}

export function assertM4LoadedDocument(value: unknown): asserts value is M4LoadedDocument {
  if (!record(value) || !exactKeys(value, ["localResourceId", "resourceKind", "displayName", "modifiedAt", "revisionToken", "document"], ["lastOpenedAt"]) ||
    !localId(value["localResourceId"]) || !resourceKind(value["resourceKind"]) || !label(value["displayName"]) ||
    typeof value["modifiedAt"] !== "string" || !UTC_TIMESTAMP.test(value["modifiedAt"]) ||
    (value["lastOpenedAt"] !== undefined && (typeof value["lastOpenedAt"] !== "string" || !UTC_TIMESTAMP.test(value["lastOpenedAt"]))) ||
    !revision(value["revisionToken"])) {
    throw new M4ContractError();
  }
  assertBoundedJson(value["document"], M4_IPC_LIMITS.documentBytes);
  if (!record(value["document"]) || value["document"]["kind"] !== value["resourceKind"]) throw new M4ContractError();
}

export function assertM4SaveOutcome(value: unknown): asserts value is M4SaveDocumentOutcome {
  if (!record(value) || typeof value["status"] !== "string") throw new M4ContractError();
  if (value["status"] === "saved") {
    if (!exactKeys(value, ["status", "revisionToken"]) || !revision(value["revisionToken"])) throw new M4ContractError();
    return;
  }
  if (value["status"] !== "conflicted" && value["status"] !== "recoveryRequired" && value["status"] !== "failed") throw new M4ContractError();
  if (!exactKeys(value, ["status", "message"]) || typeof value["message"] !== "string" || value["message"].length === 0 || value["message"].length > 500) throw new M4ContractError();
}

export function assertM4EditBuffer(value: unknown): asserts value is M4EditBufferValue {
  if (!record(value) || !exactKeys(value, ["value", "updatedAt"]) || typeof value["value"] !== "string" ||
    new TextEncoder().encode(value["value"]).byteLength > M4_IPC_LIMITS.editBufferBytes ||
    typeof value["updatedAt"] !== "string" || !UTC_TIMESTAMP.test(value["updatedAt"])) throw new M4ContractError();
}

export function assertM4WorkspaceSettingsSnapshot(
  value: unknown,
): asserts value is M4WorkspaceSettingsSnapshot {
  if (!record(value) || !exactKeys(value, ["value", "revisionToken"]) ||
    !revision(value["revisionToken"])) throw new M4ContractError();
  assertM4WorkspaceSettings(value["value"]);
}

export function assertM4WorkspaceSettingsSaveOutcome(
  value: unknown,
): asserts value is M4WorkspaceSettingsSaveOutcome {
  if (!record(value) || typeof value["status"] !== "string") throw new M4ContractError();
  if (value["status"] === "saved") {
    if (!exactKeys(value, ["status", "value", "revisionToken"]) ||
      !revision(value["revisionToken"])) throw new M4ContractError();
    assertM4WorkspaceSettings(value["value"]);
    return;
  }
  if (value["status"] === "conflicted") {
    if (!exactKeys(value, ["status", "currentRevisionToken", "message"]) ||
      (value["currentRevisionToken"] !== null && !revision(value["currentRevisionToken"])) ||
      !safeMessage(value["message"])) throw new M4ContractError();
    return;
  }
  if ((value["status"] !== "readOnly" && value["status"] !== "failed") ||
    !exactKeys(value, ["status", "message"]) || !safeMessage(value["message"])) {
    throw new M4ContractError();
  }
}

export function assertM4ChurchProfileSnapshot(
  value: unknown,
): asserts value is M4ChurchProfileSnapshot {
  if (!record(value) || !exactKeys(value, ["value", "revisionToken"]) ||
    (value["revisionToken"] !== null && !revision(value["revisionToken"])) ||
    ((value["value"] === null) !== (value["revisionToken"] === null))) {
    throw new M4ContractError();
  }
  if (value["value"] !== null) assertM4ChurchProfile(value["value"]);
}

export function assertM4ChurchProfileSaveOutcome(
  value: unknown,
): asserts value is M4ChurchProfileSaveOutcome {
  if (!record(value) || typeof value["status"] !== "string") throw new M4ContractError();
  if (value["status"] === "saved") {
    if (!exactKeys(value, ["status", "value", "revisionToken"]) ||
      !revision(value["revisionToken"])) throw new M4ContractError();
    assertM4ChurchProfile(value["value"]);
    return;
  }
  if (value["status"] === "conflicted") {
    if (!exactKeys(value, ["status", "currentRevisionToken", "message"]) ||
      (value["currentRevisionToken"] !== null && !revision(value["currentRevisionToken"])) ||
      !safeMessage(value["message"])) throw new M4ContractError();
    return;
  }
  if ((value["status"] !== "readOnly" && value["status"] !== "failed") ||
    !exactKeys(value, ["status", "message"]) || !safeMessage(value["message"])) {
    throw new M4ContractError();
  }
}

export function assertM4PreviewAdmission(value: unknown): asserts value is M4PreviewAdmission {
  if (!record(value) || !exactKeys(value, ["status", "buildId"]) ||
    (value["status"] !== "enqueued" && value["status"] !== "ignored") ||
    !localId(value["buildId"])) throw new M4ContractError();
}

export function assertM4PreviewNavigationMap(
  value: unknown,
  pageCount: number = M4_IPC_LIMITS.maximumPreviewPageCount,
): asserts value is M4PreviewNavigationMap {
  if (!record(value) || !exactKeys(value, ["version", "entries"]) || value["version"] !== 1 ||
    !Array.isArray(value["entries"]) ||
    value["entries"].length > M4_IPC_LIMITS.maximumPreviewNavigationEntries ||
    !Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > M4_IPC_LIMITS.maximumPreviewPageCount) {
    throw new M4ContractError();
  }
  const seen = new Set<string>();
  for (const entry of value["entries"]) {
    if (!record(entry) ||
      !exactKeys(entry, ["resolvedId", "sourceElementId", "pageNumber", "region"]) ||
      typeof entry["resolvedId"] !== "string" || entry["resolvedId"].length < 1 ||
      entry["resolvedId"].length > 512 || /[\u0000-\u001f\u007f-\u009f]/u.test(entry["resolvedId"]) ||
      typeof entry["sourceElementId"] !== "string" ||
      !/^[A-Za-z][A-Za-z0-9_-]*$/u.test(entry["sourceElementId"]) ||
      !Number.isSafeInteger(entry["pageNumber"]) || (entry["pageNumber"] as number) < 1 ||
      (entry["pageNumber"] as number) > pageCount ||
      (entry["region"] !== "body" && entry["region"] !== "page-background" &&
        entry["region"] !== "page-foreground")) throw new M4ContractError();
    const key = `${entry["resolvedId"]}\u0000${entry["sourceElementId"]}\u0000${entry["pageNumber"]}\u0000${entry["region"]}`;
    if (seen.has(key)) throw new M4ContractError();
    seen.add(key);
  }
}

export function assertM4PreviewState(value: unknown): asserts value is M4PreviewState {
  const statuses = ["unavailable", "idle", "queued", "building", "current", "stale", "failed"];
  const failures = ["couldNotBuild", "tookTooLong", "canceled", "outOfDate"];
  if (!record(value) ||
    !exactKeys(value, ["status"], ["lastSuccessfulBuildId", "attemptedBuildId", "pageCount", "navigationMap", "failure", "message"]) ||
    !statuses.includes(String(value["status"])) ||
    (value["lastSuccessfulBuildId"] !== undefined && !localId(value["lastSuccessfulBuildId"])) ||
    (value["attemptedBuildId"] !== undefined && !localId(value["attemptedBuildId"])) ||
    (value["pageCount"] !== undefined &&
      (!Number.isSafeInteger(value["pageCount"]) || (value["pageCount"] as number) < 1 ||
        (value["pageCount"] as number) > M4_IPC_LIMITS.maximumPreviewPageCount)) ||
    (value["failure"] !== undefined && !failures.includes(String(value["failure"]))) ||
    (value["message"] !== undefined && !safeMessage(value["message"]))) {
    throw new M4ContractError();
  }
  if ((value["status"] === "queued" || value["status"] === "building") &&
    value["attemptedBuildId"] === undefined) throw new M4ContractError();
  if (value["status"] === "current" && value["lastSuccessfulBuildId"] === undefined) {
    throw new M4ContractError();
  }
  if (value["pageCount"] !== undefined && value["lastSuccessfulBuildId"] === undefined) {
    throw new M4ContractError();
  }
  if (value["navigationMap"] !== undefined) {
    if (value["lastSuccessfulBuildId"] === undefined || value["pageCount"] === undefined) {
      throw new M4ContractError();
    }
    assertM4PreviewNavigationMap(value["navigationMap"], value["pageCount"] as number);
  }
  if (value["status"] === "unavailable" && value["message"] === undefined) {
    throw new M4ContractError();
  }
}
