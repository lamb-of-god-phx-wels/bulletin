import type {
  CanonicalRevisionToken,
  CbbDocument,
  DiagnosticRecord,
  LocalResourceId,
  WorkspaceId,
} from "@cbb/core";
import type {
  EditableWorkspaceSession,
  LocalResourceRecord,
  WorkspaceRegistry,
  WorkspaceResourceKind,
} from "../workspace/index.js";

export type SaveJournalState =
  | "prepared"
  | "documentReplaced"
  | "committed"
  | "rolledBack";

export interface DocumentSaveJournal {
  readonly version: 1;
  readonly kind: "documentSaveJournal";
  readonly transactionId: string;
  readonly workspaceId: WorkspaceId;
  readonly resourceKind: WorkspaceResourceKind;
  readonly localResourceId: LocalResourceId;
  readonly documentPath: string;
  readonly state: SaveJournalState;
  readonly baseDocumentHash: CanonicalRevisionToken | null;
  readonly newDocumentHash: CanonicalRevisionToken;
  readonly baseRegistryHash: CanonicalRevisionToken;
  readonly newRegistryHash: CanonicalRevisionToken;
  readonly beforeResource: LocalResourceRecord | null;
  readonly afterResource: LocalResourceRecord;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SaveDocumentRequest {
  readonly session: EditableWorkspaceSession;
  readonly resourceKind: WorkspaceResourceKind;
  readonly localResourceId: LocalResourceId;
  readonly displayName: string;
  readonly document: CbbDocument;
  /** Exact document snapshot loaded with baseRevisionToken; null for creation. */
  readonly baseDocument: CbbDocument | null;
  readonly baseRevisionToken: CanonicalRevisionToken | null;
}

export type SaveDocumentResult =
  | {
      readonly status: "saved";
      readonly revisionToken: CanonicalRevisionToken;
      readonly registry: WorkspaceRegistry;
    }
  | {
      readonly status: "conflicted";
      readonly conflictPath: string;
      readonly diagnostics: readonly DiagnosticRecord[];
    }
  | {
      readonly status: "recoveryRequired";
      readonly diagnostics: readonly DiagnosticRecord[];
    }
  | {
      readonly status: "failed";
      readonly diagnostics: readonly DiagnosticRecord[];
    };

export interface ConflictRecord {
  readonly version: 1;
  readonly kind: "documentConflict";
  readonly conflictId: string;
  readonly workspaceId: WorkspaceId;
  readonly localResourceId: LocalResourceId;
  readonly resourceKind: WorkspaceResourceKind;
  readonly createdAt: string;
  readonly baseHash: CanonicalRevisionToken | null;
  readonly diskHash: CanonicalRevisionToken | null;
  readonly oursHash: CanonicalRevisionToken;
  readonly diskValidation: "valid" | "invalid" | "missing";
}
