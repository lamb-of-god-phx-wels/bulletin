export type {
  AppliedCommandResult,
  CapabilityAllowance,
  CapabilityDecision,
  CapabilityDenial,
  CapabilityDenialCode,
  CapabilityRequirement,
  CapabilityRequirements,
  CapabilityTarget,
  DeniedCommandResult,
  DocumentChangeEvent,
  DocumentPatch,
  EditorCapability,
  EditorCommand,
  EditorCommandContext,
  EditorMode,
  EditorSelection,
  EditorStoreSnapshot,
  ExecuteCommandResult,
  NoChangeCommandResult,
  SelectionTransitionContext,
} from "./types.js";

export {
  EDITOR_CAPABILITY_CATALOG,
  checkEditorCapabilities,
  checkEditorCapability,
  effectiveAuthoringPolicy,
} from "./capabilities.js";
export type {
  EditorCapabilityDefinition,
  EffectiveAuthoringPolicy,
} from "./capabilities.js";

export {
  DocumentPatchError,
  applyDocumentPatches,
  documentValueAt,
  documentValuesEqual,
  immutableDocument,
} from "./patches.js";
export type { DocumentPatchApplication } from "./patches.js";

export { EditorCommandDefinitionError, EditorStore } from "./editorStore.js";
export type {
  DocumentChangeListener,
  EditorStoreListener,
  EditorStoreOptions,
  EditorStoreSubscriberFailure,
} from "./editorStore.js";

export {
  EditorDocumentValidationError,
  assertEditorDocumentValid,
} from "./documentValidation.js";

export { semanticRoleMetadataMirrorPatches } from "./semanticRoleMirrors.js";
export type { SemanticMetadataRole } from "./semanticRoleMirrors.js";

export * from "./commands/index.js";
