import type { CbbDocument } from "@cbb/core";
import type {
  RendererImageAssetImportOutcome,
  RendererImageAssetSummary,
} from "./imageAssets.js";

export type RendererResourceKind = "bulletin" | "template";
export type RendererDocumentFilter = RendererResourceKind | "all";
export type RendererJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly RendererJsonValue[]
  | { readonly [key: string]: RendererJsonValue };

export interface RendererDocumentSummary {
  readonly localResourceId: string;
  readonly resourceKind: RendererResourceKind;
  readonly displayName: string;
  readonly modifiedAt: string;
  readonly lastOpenedAt?: string;
  readonly revisionToken: string;
}

export interface RendererLoadedDocument extends RendererDocumentSummary {
  readonly document: CbbDocument;
}

export interface RendererBootstrapState {
  readonly workspaceAccess: "readWrite" | "readOnly";
}

export type RendererWorkspaceLocationOutcome =
  | { readonly status: "canceled" | "restarting" }
  | { readonly status: "unavailable"; readonly message: string };

export type RendererSaveOutcome =
  | { readonly status: "saved"; readonly revisionToken: string }
  | {
      readonly status: "conflicted" | "recoveryRequired" | "failed";
      readonly message: string;
    };

export interface RendererEditBufferValue {
  readonly value: string;
  readonly updatedAt: string;
}

export type RendererDocumentSaveState = "clean" | "dirty" | "saving" | "saveFailed";
export type RendererEditBufferSaveState = "clean" | "pending" | "failed";

/**
 * Workspace-only navigation metadata. These ids must never be copied into a
 * portable bulletin or template document.
 */
export interface RendererSourceTemplateLink {
  readonly bulletinLocalResourceId: string;
  readonly templateLocalResourceId: string;
}

export interface RendererWorkspaceSettings {
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
  readonly sourceTemplateLinks?: readonly RendererSourceTemplateLink[];
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
    readonly preferredOutput?: "fullSheet" | "foldedBooklet" | "other";
    readonly starterId?: "simple-service" | "folded-letter" | "announcements" | "blank-accessible";
    readonly createPracticeBulletin?: boolean;
    readonly tourCompleted?: boolean;
    readonly tourBulletinLocalResourceId?: string;
  };
}

export interface RendererWorkspaceSettingsSnapshot {
  readonly value: RendererWorkspaceSettings;
  readonly revisionToken: string;
}

export type RendererWorkspaceSettingsSaveOutcome =
  | ({ readonly status: "saved" } & RendererWorkspaceSettingsSnapshot)
  | {
      readonly status: "conflicted";
      readonly currentRevisionToken: string | null;
      readonly message: string;
    }
  | { readonly status: "readOnly" | "failed"; readonly message: string };

export interface RendererChurchProfileSchedule {
  readonly id: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly dayOfWeek?: number;
}

export interface RendererChurchProfile {
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
  readonly schedules?: readonly RendererChurchProfileSchedule[];
}

export interface RendererChurchProfileSnapshot {
  readonly value: RendererChurchProfile | null;
  readonly revisionToken: string | null;
}

export type RendererChurchProfileSaveOutcome =
  | {
      readonly status: "saved";
      readonly value: RendererChurchProfile;
      readonly revisionToken: string;
    }
  | {
      readonly status: "conflicted";
      readonly currentRevisionToken: string | null;
      readonly message: string;
    }
  | { readonly status: "readOnly" | "failed"; readonly message: string };

export interface RendererPreviewAdmission {
  readonly status: "enqueued" | "ignored";
  readonly buildId: string;
}

export type RendererPreviewFailure = "couldNotBuild" | "tookTooLong" | "canceled" | "outOfDate";

export interface RendererPreviewNavigationEntry {
  readonly resolvedId: string;
  readonly sourceElementId: string;
  readonly pageNumber: number;
  readonly region: "body" | "page-background" | "page-foreground";
}

export interface RendererPreviewNavigationMap {
  readonly version: 1;
  readonly entries: readonly RendererPreviewNavigationEntry[];
}

export interface RendererPreviewState {
  readonly status: "unavailable" | "idle" | "queued" | "building" | "current" | "stale" | "failed";
  readonly lastSuccessfulBuildId?: string;
  readonly attemptedBuildId?: string;
  readonly pageCount?: number;
  readonly navigationMap?: RendererPreviewNavigationMap;
  readonly failure?: RendererPreviewFailure;
  readonly message?: string;
}

export interface RendererBridge {
  readonly version: 1;
  readBootstrapState(): Promise<RendererBootstrapState>;
  chooseWorkspaceLocation(): Promise<RendererWorkspaceLocationOutcome>;
  listDocuments(filter?: RendererDocumentFilter): Promise<readonly RendererDocumentSummary[]>;
  loadDocument(localResourceId: string): Promise<RendererLoadedDocument>;
  saveDocument(input: {
    readonly localResourceId: string;
    readonly resourceKind: RendererResourceKind;
    readonly displayName: string;
    readonly document: CbbDocument;
    readonly baseRevisionToken: string | null;
  }): Promise<RendererSaveOutcome>;
  setDocumentSaveState(localResourceId: string, state: RendererDocumentSaveState): Promise<void>;
  readEditBuffer(localResourceId: string, bufferKey: string): Promise<RendererEditBufferValue | null>;
  writeEditBuffer(localResourceId: string, bufferKey: string, value: string): Promise<RendererEditBufferValue>;
  deleteEditBuffer(localResourceId: string, bufferKey: string): Promise<boolean>;
  setEditBufferSaveState(localResourceId: string, state: RendererEditBufferSaveState): Promise<void>;
  readAppSettings(): Promise<RendererJsonValue>;
  writeAppSettings(value: RendererJsonValue): Promise<RendererJsonValue>;
  readWorkspaceSettings(): Promise<RendererWorkspaceSettingsSnapshot>;
  writeWorkspaceSettings(
    value: RendererWorkspaceSettings,
    baseRevisionToken: string,
  ): Promise<RendererWorkspaceSettingsSaveOutcome>;
  readChurchProfile(): Promise<RendererChurchProfileSnapshot>;
  writeChurchProfile(
    value: RendererChurchProfile,
    baseRevisionToken: string | null,
  ): Promise<RendererChurchProfileSaveOutcome>;
  listImageAssets(): Promise<readonly RendererImageAssetSummary[]>;
  importImageAsset(): Promise<RendererImageAssetImportOutcome>;
  readImageAssetBytes(localAssetId: string, assetRef: string): Promise<Uint8Array>;
  requestPreview(input: {
    readonly localResourceId: string;
    readonly requestSequence: number;
  }): Promise<RendererPreviewAdmission>;
  getPreviewState(localResourceId: string): Promise<RendererPreviewState>;
  cancelPreview(buildId: string): Promise<boolean>;
  readPdfBytes(bulletinLocalResourceId: string, buildId: string): Promise<Uint8Array>;
}

declare global {
  interface Window {
    readonly churchBulletinBuilder?: RendererBridge;
  }
}

const DEMO_BULLETIN_ID = "d3f5b410-87e2-4f4f-9b24-8cd21c76db31";
const DEMO_PREVIEW_BUILD_ID = "20000000-0000-4000-8000-000000000099";
const DEMO_IMAGE_LOCAL_ID = "30000000-0000-4000-8000-000000000098";
const DEMO_IMAGE_REF = "asset:40000000-0000-4000-8000-000000000097";
const INITIAL_REVISION = `sha256:${"1".repeat(64)}`;

const DEMO_IMAGE_BYTES = new TextEncoder().encode([
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800">',
  '<rect width="1200" height="800" fill="#dfe9e2"/>',
  '<path d="M140 690h920L600 120z" fill="#315c50"/>',
  '<circle cx="600" cy="390" r="105" fill="#fffdf8"/>',
  '<path d="M575 300h50v180h-50zM530 350h140v45H530z" fill="#9a4f00"/>',
  '<text x="600" y="755" text-anchor="middle" font-family="sans-serif" font-size="42" fill="#28241f">Sunday worship</text>',
  "</svg>",
].join(""));

const DEMO_IMAGE: RendererImageAssetSummary = Object.freeze({
  localAssetId: DEMO_IMAGE_LOCAL_ID,
  assetRef: DEMO_IMAGE_REF,
  displayName: "Worship cross illustration",
  mediaType: "image/svg+xml",
  byteSize: DEMO_IMAGE_BYTES.byteLength,
  importedAt: "2026-07-12T12:00:00.000Z",
});

function createDemoPdfBytes(): Uint8Array {
  const encoder = new TextEncoder();
  const content = [
    "BT",
    "/F1 22 Tf",
    "72 728 Td",
    "(Church Bulletin Builder) Tj",
    "0 -34 Td",
    "/F1 13 Tf",
    "(Browser demo - live PDF preview) Tj",
    "ET",
    "",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${encoder.encode(content).byteLength} >>\nstream\n${content}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const offsets = [0];
  let source = "%PDF-1.4\n% CBB demo\n";
  objects.forEach((object, index) => {
    offsets.push(encoder.encode(source).byteLength);
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = encoder.encode(source).byteLength;
  source += `xref\n0 ${objects.length + 1}\n`;
  source += "0000000000 65535 f \n";
  source += offsets.slice(1)
    .map((offset) => `${offset.toString().padStart(10, "0")} 00000 n \n`)
    .join("");
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  source += `startxref\n${xrefOffset}\n%%EOF\n`;
  return encoder.encode(source);
}

const DEMO_PDF_BYTES = createDemoPdfBytes();

interface DemoRecord {
  document: CbbDocument;
  summary: RendererDocumentSummary;
}

function cloned<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isLoopbackDemoPage(): boolean {
  if (typeof window === "undefined") return false;
  return (window.location.protocol === "http:" || window.location.protocol === "https:") &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" || window.location.hostname === "[::1]");
}

function isElectronRenderer(): boolean {
  return typeof navigator !== "undefined" && /(?:^|\s)Electron\//u.test(navigator.userAgent);
}

function isRendererBridge(value: unknown): value is RendererBridge {
  if (typeof value !== "object" || value === null) return false;
  const bridge = value as Partial<Record<keyof RendererBridge, unknown>>;
  return bridge.version === 1 &&
    typeof bridge.readBootstrapState === "function" &&
    typeof bridge.chooseWorkspaceLocation === "function" &&
    typeof bridge.listDocuments === "function" &&
    typeof bridge.loadDocument === "function" &&
    typeof bridge.saveDocument === "function" &&
    typeof bridge.setDocumentSaveState === "function" &&
    typeof bridge.readEditBuffer === "function" &&
    typeof bridge.writeEditBuffer === "function" &&
    typeof bridge.deleteEditBuffer === "function" &&
    typeof bridge.setEditBufferSaveState === "function" &&
    typeof bridge.readAppSettings === "function" &&
    typeof bridge.writeAppSettings === "function" &&
    typeof bridge.readWorkspaceSettings === "function" &&
    typeof bridge.writeWorkspaceSettings === "function" &&
    typeof bridge.readChurchProfile === "function" &&
    typeof bridge.writeChurchProfile === "function" &&
    typeof bridge.listImageAssets === "function" &&
    typeof bridge.importImageAsset === "function" &&
    typeof bridge.readImageAssetBytes === "function" &&
    typeof bridge.requestPreview === "function" &&
    typeof bridge.getPreviewState === "function" &&
    typeof bridge.cancelPreview === "function" &&
    typeof bridge.readPdfBytes === "function";
}

/**
 * Browser-only demo capability. It has no filesystem/network/process access and
 * is deliberately unavailable from packaged file: pages.
 */
export function createDemoRendererBridge(): RendererBridge {
  let sequence = 1;
  let settings: RendererJsonValue = {
    version: 1,
    kind: "globalSettings",
    theme: "system",
  };
  let workspaceSettings: RendererWorkspaceSettings = {
    version: 1,
    kind: "workspaceSettings",
    defaultExportFormat: "readerOrder",
    snapGridSize: "0.125in",
    previewResolution: 144,
  };
  let workspaceSettingsRevision = `sha256:${"2".repeat(64)}`;
  let churchProfile: RendererChurchProfile | null = null;
  let churchProfileRevision: string | null = null;
  const buffers = new Map<string, RendererEditBufferValue>();
  const saveStates = new Map<string, RendererDocumentSaveState>();
  const editBufferSaveStates = new Map<string, RendererEditBufferSaveState>();
  const records = new Map<string, DemoRecord>();
  const initialDocument = {
    version: 2,
    kind: "bulletin",
    name: "Sunday Worship — Practice Bulletin",
    page: {
      typstWidth: "8.5in",
      typstHeight: "11in",
      margins: { top: "0.65in", right: "0.7in", bottom: "0.65in", left: "0.7in" },
    },
    elements: [],
  } as CbbDocument;
  records.set(DEMO_BULLETIN_ID, {
    document: initialDocument,
    summary: {
      localResourceId: DEMO_BULLETIN_ID,
      resourceKind: "bulletin",
      displayName: initialDocument.name,
      modifiedAt: "2026-07-12T12:00:00.000Z",
      lastOpenedAt: "2026-07-12T12:00:00.000Z",
      revisionToken: INITIAL_REVISION,
    },
  });

  const bridge: RendererBridge = {
    version: 1,
    async readBootstrapState() {
      return { workspaceAccess: "readWrite" };
    },
    async chooseWorkspaceLocation() {
      return {
        status: "unavailable",
        message: "Choose another bulletin-library location in the desktop app.",
      };
    },
    async listDocuments(filter = "all") {
      return [...records.values()]
        .map((entry) => entry.summary)
        .filter((entry) => filter === "all" || entry.resourceKind === filter)
        .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt))
        .map(cloned);
    },
    async loadDocument(localResourceId) {
      const entry = records.get(localResourceId);
      if (entry === undefined) throw new Error("That bulletin is not available in the demo.");
      return cloned({ ...entry.summary, document: entry.document });
    },
    async saveDocument(input) {
      const current = records.get(input.localResourceId);
      if (current !== undefined && current.summary.revisionToken !== input.baseRevisionToken) {
        return { status: "conflicted", message: "The demo bulletin changed after it was opened." };
      }
      if (current === undefined && input.baseRevisionToken !== null) {
        return { status: "conflicted", message: "The demo bulletin no longer exists." };
      }
      const revisionToken = `sha256:${(sequence++).toString(16).padStart(64, "0")}`;
      const modifiedAt = new Date().toISOString();
      records.set(input.localResourceId, {
        document: cloned(input.document),
        summary: {
          localResourceId: input.localResourceId,
          resourceKind: input.resourceKind,
          displayName: input.displayName,
          modifiedAt,
          revisionToken,
        },
      });
      return { status: "saved", revisionToken };
    },
    async setDocumentSaveState(localResourceId, state) {
      if (!records.has(localResourceId)) throw new Error("That bulletin is not available in the demo.");
      if (state === "clean") saveStates.delete(localResourceId);
      else saveStates.set(localResourceId, state);
    },
    async readEditBuffer(localResourceId, bufferKey) {
      return cloned(buffers.get(`${localResourceId}\u0000${bufferKey}`) ?? null);
    },
    async writeEditBuffer(localResourceId, bufferKey, value) {
      const record = { value, updatedAt: new Date().toISOString() };
      buffers.set(`${localResourceId}\u0000${bufferKey}`, record);
      return cloned(record);
    },
    async deleteEditBuffer(localResourceId, bufferKey) {
      return buffers.delete(`${localResourceId}\u0000${bufferKey}`);
    },
    async setEditBufferSaveState(localResourceId, state) {
      if (!records.has(localResourceId)) throw new Error("That bulletin is not available in the demo.");
      if (state === "clean") editBufferSaveStates.delete(localResourceId);
      else editBufferSaveStates.set(localResourceId, state);
    },
    async readAppSettings() {
      return cloned(settings);
    },
    async writeAppSettings(value) {
      settings = cloned(value);
      return cloned(settings);
    },
    async readWorkspaceSettings() {
      return cloned({ value: workspaceSettings, revisionToken: workspaceSettingsRevision });
    },
    async writeWorkspaceSettings(value, baseRevisionToken) {
      if (baseRevisionToken !== workspaceSettingsRevision) {
        return {
          status: "conflicted",
          currentRevisionToken: workspaceSettingsRevision,
          message: "The demo workspace settings changed after they were opened.",
        };
      }
      workspaceSettings = cloned(value);
      workspaceSettingsRevision = `sha256:${(sequence++).toString(16).padStart(64, "0")}`;
      return cloned({
        status: "saved",
        value: workspaceSettings,
        revisionToken: workspaceSettingsRevision,
      });
    },
    async readChurchProfile() {
      return cloned({ value: churchProfile, revisionToken: churchProfileRevision });
    },
    async writeChurchProfile(value, baseRevisionToken) {
      if (baseRevisionToken !== churchProfileRevision) {
        return {
          status: "conflicted",
          currentRevisionToken: churchProfileRevision,
          message: "The demo Church Profile changed after it was opened.",
        };
      }
      churchProfile = cloned(value);
      churchProfileRevision = `sha256:${(sequence++).toString(16).padStart(64, "0")}`;
      return cloned({
        status: "saved",
        value: churchProfile,
        revisionToken: churchProfileRevision,
      });
    },
    async listImageAssets() {
      return [cloned(DEMO_IMAGE)];
    },
    async importImageAsset() {
      return {
        status: "unavailable",
        message: "Image import is available in the packaged desktop app.",
      };
    },
    async readImageAssetBytes(localAssetId, assetRef) {
      if (localAssetId !== DEMO_IMAGE_LOCAL_ID || assetRef !== DEMO_IMAGE_REF) {
        throw new Error("That image is unavailable in the browser demo.");
      }
      return DEMO_IMAGE_BYTES.slice();
    },
    async requestPreview(input) {
      if (!records.has(input.localResourceId)) {
        throw new Error("That bulletin is not available in the demo.");
      }
      return { status: "ignored", buildId: DEMO_PREVIEW_BUILD_ID };
    },
    async getPreviewState(localResourceId) {
      const entry = records.get(localResourceId);
      if (entry === undefined) throw new Error("That bulletin is not available in the demo.");
      const sourceElementId = entry.document.elements[0]?.id;
      return {
        status: "current",
        lastSuccessfulBuildId: DEMO_PREVIEW_BUILD_ID,
        pageCount: 1,
        navigationMap: {
          version: 1,
          entries: sourceElementId === undefined
            ? []
            : [{ resolvedId: sourceElementId, sourceElementId, pageNumber: 1, region: "body" }],
        },
        message: "The browser demo uses a bundled one-page sample PDF.",
      };
    },
    async cancelPreview() {
      return false;
    },
    async readPdfBytes(bulletinLocalResourceId, buildId) {
      if (!records.has(bulletinLocalResourceId) || buildId !== DEMO_PREVIEW_BUILD_ID) {
        throw new Error("The requested PDF is unavailable in the browser demo.");
      }
      return DEMO_PDF_BYTES.slice();
    },
  };
  return Object.freeze(bridge);
}

let demoBridge: RendererBridge | undefined;

/** Resolve the frozen preload bridge, with a capability-free fallback only on a loopback Vite page. */
export function getRendererBridge(): RendererBridge {
  if (typeof window !== "undefined" && isRendererBridge(window.churchBulletinBuilder)) {
    return window.churchBulletinBuilder;
  }
  // A missing preload bridge inside Electron is a security/startup failure. It
  // must never silently turn the desktop app into the capability-free demo.
  if (isElectronRenderer()) {
    throw new Error("The secure Church Bulletin Builder desktop bridge is unavailable.");
  }
  if (isLoopbackDemoPage()) {
    demoBridge ??= createDemoRendererBridge();
    return demoBridge;
  }
  throw new Error("The secure Church Bulletin Builder desktop bridge is unavailable.");
}
