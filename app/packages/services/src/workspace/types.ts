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

export interface WorkspaceSettings {
  readonly version: 1;
  readonly kind: "workspaceSettings";
  readonly defaultExportFormat?: "readerOrder" | "bookletTwoUp";
  readonly snapGridSize?: string;
  readonly previewResolution?: number;
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
  readonly congregationName?: string;
  readonly language?: string;
  readonly defaultPublicationContexts?: readonly (
    | "printedNonsalableChurchBulletin"
    | "digitalNonsalableChurchBulletin"
  )[];
  readonly defaultUnknownRightsPolicy?: "review" | "block";
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
