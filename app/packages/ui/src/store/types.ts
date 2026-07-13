import type { CbbDocument, FieldId, NodeId } from "@cbb/core";

/** The two authoring experiences operate on the same document value. */
export type EditorMode = "weeklyContent" | "customizeLayout";

/**
 * Selection is renderer state, never document state.  The single-selection
 * model is intentional for v1; multi-selection is outside committed delivery.
 */
export type EditorSelection =
  | { readonly kind: "document" }
  | {
      readonly kind: "node";
      readonly nodeId: NodeId;
      readonly surface?: "editor" | "structure" | "inspector";
    }
  | {
      readonly kind: "field";
      readonly fieldId: FieldId;
      readonly ownerNodeId?: NodeId;
      readonly controlId?: string;
    };

/** A deliberately small RFC 6902 subset with unambiguous inverses. */
export type DocumentPatch =
  | { readonly op: "add"; readonly path: string; readonly value: unknown }
  | { readonly op: "remove"; readonly path: string }
  | { readonly op: "replace"; readonly path: string; readonly value: unknown };

/** Commands use task-oriented capabilities rather than checking modes inline. */
export type EditorCapability =
  | "content.edit"
  | "content.replaceImage"
  | "content.adjustImageCrop"
  | "content.manageConditionalSection"
  | "content.manageRepeatItems"
  | "content.editAccessibility"
  | "layout.edit"
  | "layout.editStructure"
  | "layout.editPageSetup"
  | "layout.editPlacement"
  | "layout.resize"
  | "template.editBindings"
  | "template.editFieldContract"
  | "template.editRules"
  | "template.editLifecycle"
  | "authoringPolicy.edit";

export type CapabilityTarget =
  | { readonly kind: "document" }
  | { readonly kind: "node"; readonly nodeId: NodeId };

export interface CapabilityRequirement {
  readonly capability: EditorCapability;
  readonly target?: CapabilityTarget;
}

export type CapabilityDenialCode =
  | "readOnly"
  | "requiresCustomizeLayout"
  | "contentLocked"
  | "layoutLocked"
  | "targetNotFound";

export interface CapabilityDenial {
  readonly allowed: false;
  readonly code: CapabilityDenialCode;
  /** Stable task-language explanation suitable for a disabled control. */
  readonly reason: string;
  readonly requirement: CapabilityRequirement;
  readonly lockSource?: CapabilityTarget;
}

export interface CapabilityAllowance {
  readonly allowed: true;
}

export type CapabilityDecision = CapabilityAllowance | CapabilityDenial;

export interface EditorCommandContext {
  readonly document: CbbDocument;
  readonly mode: EditorMode;
  readonly selection: EditorSelection;
}

export type CapabilityRequirements =
  | readonly CapabilityRequirement[]
  | ((context: EditorCommandContext) => readonly CapabilityRequirement[]);

export interface SelectionTransitionContext extends EditorCommandContext {
  readonly nextDocument: CbbDocument;
}

/**
 * A command describes intent and produces patches without mutating its input.
 * `historyGroup` is a session token, not merely a field id: reuse it only for
 * adjacent edits that should undo as one continuous action.
 */
export interface EditorCommand {
  readonly id: string;
  readonly label: string;
  readonly capabilities: CapabilityRequirements;
  readonly createPatches:
    | readonly DocumentPatch[]
    | ((context: EditorCommandContext) => readonly DocumentPatch[]);
  readonly historyGroup?: string;
  readonly selectAfter?:
    | EditorSelection
    | ((context: SelectionTransitionContext) => EditorSelection);
}

export interface EditorStoreSnapshot {
  readonly document: CbbDocument;
  readonly mode: EditorMode;
  readonly selection: EditorSelection;
  readonly documentRevision: number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel?: string;
  readonly redoLabel?: string;
}

export interface DocumentChangeEvent {
  readonly kind: "execute" | "undo" | "redo";
  readonly commandId: string;
  readonly label: string;
  readonly document: CbbDocument;
  /** Patches from the previous visible document to `document`. */
  readonly patches: readonly DocumentPatch[];
  /** Patches that restore the previous visible document. */
  readonly inversePatches: readonly DocumentPatch[];
  readonly documentRevision: number;
}

export interface AppliedCommandResult {
  readonly status: "applied";
  readonly event: DocumentChangeEvent;
}

export interface NoChangeCommandResult {
  readonly status: "noChange";
}

export interface DeniedCommandResult {
  readonly status: "denied";
  readonly denial: CapabilityDenial;
}

export type ExecuteCommandResult =
  | AppliedCommandResult
  | NoChangeCommandResult
  | DeniedCommandResult;
