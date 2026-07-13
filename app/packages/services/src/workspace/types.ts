import type {
  CanonicalRevisionToken,
  DiagnosticRecord,
  LocalResourceId,
  WorkspaceId,
} from "@cbb/core";

export type WorkspaceResourceKind = "bulletin" | "template";

export interface LocalResourceRecord {
  readonly localId: LocalResourceId;
  readonly kind: string;
  readonly displayName: string;
  readonly storagePath: string;
  readonly contentHash: CanonicalRevisionToken;
  readonly createdAt: string;
  readonly modifiedAt: string;
  readonly lastOpenedAt?: string;
}

export interface WorkspaceRegistry {
  readonly version: 1;
  readonly kind: "workspace";
  readonly workspaceId: WorkspaceId;
  readonly displayName?: string;
  readonly bulletins?: readonly LocalResourceRecord[];
  readonly templates?: readonly LocalResourceRecord[];
  readonly assets?: readonly LocalResourceRecord[];
  readonly fonts?: readonly LocalResourceRecord[];
  readonly songs?: readonly LocalResourceRecord[];
  readonly scriptureCatalog?: readonly LocalResourceRecord[];
  readonly resourcePacks?: readonly LocalResourceRecord[];
  readonly importProvenance?: readonly LocalResourceRecord[];
  readonly installedPackState?: readonly LocalResourceRecord[];
  readonly workspaceLocks?: Readonly<Record<string, unknown>>;
  readonly sharedLibraryConnections?: readonly LocalResourceRecord[];
  readonly scriptureProviderConfig?: readonly LocalResourceRecord[];
  readonly packMaintainerDrafts?: readonly LocalResourceRecord[];
}

export interface WorkspaceLockRecord {
  readonly version: 1;
  readonly kind: "workspaceLock";
  readonly workspaceId: WorkspaceId;
  readonly instanceId: string;
  readonly pid: number;
  readonly hostUserDiscriminator: string;
  readonly appVersion: string;
  readonly processStartedAt: string;
  readonly acquiredAt: string;
  readonly heartbeatAt: string;
}

export type WorkspaceReadOnlyReason =
  | "requested"
  | "liveLock"
  | "uncertainLock"
  | "staleLockNeedsConfirmation"
  | "ambiguousRecovery"
  | "unsupportedOrInvalid";

export interface WorkspaceLease {
  readonly record: WorkspaceLockRecord;
  heartbeat(): Promise<void>;
  release(): Promise<void>;
}

export interface EditableWorkspaceSession {
  readonly mode: "editable";
  readonly root: string;
  readonly registry: WorkspaceRegistry;
  readonly lease: WorkspaceLease;
  readonly recoveryDiagnostics: readonly DiagnosticRecord[];
}

export interface ReadOnlyWorkspaceSession {
  readonly mode: "readOnly";
  readonly root: string;
  readonly registry: WorkspaceRegistry;
  readonly reason: WorkspaceReadOnlyReason;
  readonly observedLock?: WorkspaceLockRecord;
  readonly diagnostics: readonly DiagnosticRecord[];
}

export type OpenWorkspaceResult =
  | { readonly status: "editable"; readonly session: EditableWorkspaceSession }
  | { readonly status: "readOnly"; readonly session: ReadOnlyWorkspaceSession }
  | { readonly status: "failed"; readonly diagnostics: readonly DiagnosticRecord[] };

export interface ConfirmedStaleLock {
  readonly instanceId: string;
  readonly heartbeatAt: string;
}

export interface OpenWorkspaceOptions {
  readonly mode?: "edit" | "readOnly";
  /** Exact observation shown to the user; acts as a stale-recovery CAS token. */
  readonly confirmedStaleLock?: ConfirmedStaleLock;
}

export interface CreateWorkspaceInput {
  readonly root: string;
  readonly displayName?: string;
  readonly settings?: WorkspaceSettings;
  readonly churchProfile?: ChurchProfile;
}

export type ApplicationTheme = "system" | "light" | "dark";
export type EditorViewMode = "page" | "contiguous";
export type PageViewPresentation = "single" | "facing";
export type PreviewZoomDefault = "fitPage" | "fitWidth" | number;

/**
 * Output-inert editor, preview, export-name, and local-time preferences shared
 * by application defaults and optional workspace overrides.
 *
 * Every member is optional: absence is the inheritance signal and must never
 * be materialized into portable document JSON merely because it was read.
 */
export interface UserPreferenceDefaults {
  readonly viewMode?: EditorViewMode;
  readonly pagePresentation?: PageViewPresentation;
  readonly previewZoom?: PreviewZoomDefault;
  readonly marginGuides?: boolean;
  readonly livePreview?: boolean;
  readonly technicalPdfDetails?: boolean;
  readonly canvasSnap?: boolean;
  /** Positive physical length. This legacy M3 name is canonical for v1. */
  readonly snapGridSize?: string;
  readonly exportFilenamePattern?: string;
  readonly offlineSpellcheck?: boolean;
  readonly displayTimeZone?: string;
}

/** Application-global settings and defaults stored outside the workspace. */
export interface GlobalSettings extends UserPreferenceDefaults {
  readonly version: 1;
  readonly kind: "globalSettings";
  /** Optional for compatibility with settings written before the M4 contract. */
  readonly scope?: "application";
  /** Application UI locale; the legacy M3 property name remains canonical. */
  readonly defaultLanguage?: string;
  readonly theme?: ApplicationTheme;
  /** Legacy application preference retained without changing its semantics. */
  readonly telemetryEnabled?: boolean;
}

/** Workspace-local optional overrides plus the existing M3 build preferences. */
export interface WorkspaceSettings extends UserPreferenceDefaults {
  readonly version: 1;
  readonly kind: "workspaceSettings";
  /** Optional for compatibility with settings written before the M4 contract. */
  readonly scope?: "workspace";
  readonly defaultExportFormat?: "readerOrder" | "bookletTwoUp";
  /** Legacy M3 preview raster resolution, distinct from previewZoom. */
  readonly previewResolution?: number;
  /**
   * Output-inert local navigation metadata. Local resource ids are forbidden
   * from portable bulletin/template JSON and live only in workspace state.
   */
  readonly sourceTemplateLinks?: readonly {
    readonly bulletinLocalResourceId: string;
    readonly templateLocalResourceId: string;
  }[];
  /** Output-inert resumable state for this bulletin library's optional setup. */
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
    readonly starterId?:
      | "simple-service"
      | "folded-letter"
      | "announcements"
      | "blank-accessible";
    readonly createPracticeBulletin?: boolean;
    readonly tourCompleted?: boolean;
    readonly tourBulletinLocalResourceId?: string;
  };
}

export interface ChurchProfileSchedule {
  readonly id: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly dayOfWeek?: number;
}

export interface ChurchProfile {
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
  /** Sorted, unique NFC lowercase words accepted by offline spellcheck. */
  readonly spellingDictionary?: readonly string[];
  readonly schedules?: readonly ChurchProfileSchedule[];
}

export type StartupRecoveryResult =
  | {
      readonly status: "ok";
      readonly registry: WorkspaceRegistry;
      readonly diagnostics: readonly DiagnosticRecord[];
    }
  | {
      readonly status: "readOnly";
      readonly registry: WorkspaceRegistry;
      readonly diagnostics: readonly DiagnosticRecord[];
    };

export interface StartupRecoveryPort {
  recover(root: string, registry: WorkspaceRegistry): Promise<StartupRecoveryResult>;
}
