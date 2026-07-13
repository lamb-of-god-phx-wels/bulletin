/**
 * @cbb/core/document — In-memory document model.
 *
 * Public surface for the document module.
 *
 * Exports:
 *   Types       — CbbDocument, NativeElement subtypes, page/style/contract
 *                 primitives, and downstream resolved/render types.
 *   Parse       — fromJson, toJson, DocumentValidationError
 *   Tree ops    — findById, buildParentMap, collectAllNodeIds, countNodes,
 *                 insertElement, removeElement, moveElement, remintIds,
 *                 maxContainerDepth, findDuplicateNodeId, checkNodeLimit,
 *                 checkContainerDepth
 *   Resolved    — constructor helpers + ResolvedRenderTree / RenderProjection
 *   Field class — DOCUMENT_FIELD_CLASSIFICATIONS, ELEMENT_FIELD_CLASSIFICATIONS,
 *                 registerDocumentClassifications, schema IDs
 *   Limits      — DOCUMENT_LIMITS
 */

// ---- types ----------------------------------------------------------------
export type {
  // Primitives
  NodeId,
  FieldId,
  RuleId,
  ContractId,
  RepeatItemUuid,
  Sha256HashString,
  IsoDateString,
  Rfc3339Timestamp,
  PhysicalLength,
  PhysicalOrRelativeLength,
  TrackLength,
  ElementSize,
  SpacingLength,
  CanvasPosition,
  PageElementSize,
  ColorValue,
  PortableAssetRefString,
  PortableFontRefString,
  PortableSongWorkRefString,
  ScriptureTranslationRefString,
  RightsCreditRefString,
  // Style
  StyleObject,
  AuthoringPolicy,
  // Field contracts
  FieldType,
  ChurchProfileTextFieldKey,
  ChurchProfileAssetFieldKey,
  ChurchProfileFieldKey,
  SemanticRole,
  RolloverPolicy,
  ReviewExpectation,
  WeeklyBehaviorDerivation,
  WeeklyBehavior,
  FieldChoiceEntry,
  FieldConstraints,
  FieldDefinition,
  FieldContractGroup,
  FieldContract,
  FieldValueOrigin,
  FieldValueEntry,
  FieldValues,
  Binding,
  ItemBinding,
  // Content rules
  ConditionKind,
  ConditionalRule,
  EmptyState,
  RepeatRule,
  ContentRule,
  // Review records
  FieldReviewDisposition,
  FieldReviewTargetDocument,
  FieldReviewTargetLocal,
  FieldReviewTarget,
  DerivationEvidence,
  FieldReviewEntry,
  ContentReviewDisposition,
  ContentReviewTargetDocument,
  ContentReviewTargetCustom,
  ContentReviewTarget,
  ContentReviewSourceEvidence,
  ContentReviewEntry,
  // Source template
  SourceTemplate,
  // Document metadata & page
  DocumentMetadata,
  PageMargins,
  PrintSafeInset,
  BookletSafeInset,
  BookletPrintSetup,
  FinalPageCountRequirement,
  PageSetup,
  ScripturePresentationSettings,
  RightsPolicy,
  PublicationContext,
  // Base element fields
  BaseElementFields,
  // Text element
  TextContent,
  TextElementData,
  TextElement,
  // Image element
  FocalPoint,
  ImageElementData,
  ImageElement,
  // Date element
  DateElementData,
  DateElement,
  // Music element
  SourceSong,
  RightsContributor,
  PublicationLicenseDisplay,
  UsagePolicyConstraint,
  UsagePolicySnapshot,
  RightsRecord,
  RightsAssociationReview,
  MusicElementData,
  MusicElement,
  // Copyrights element
  RightsAttributionElementData,
  RightsAttributionElement,
  // Page break element
  PageBreakElementData,
  PageBreakElement,
  // Grid element
  TableSemantics,
  GridElementData,
  GridChildWrapper,
  GridElement,
  // Stack element
  StackElementData,
  StackChildWrapper,
  StackElement,
  // Canvas element
  CanvasChildWrapper,
  CanvasElement,
  // Custom element instance
  CustomElementInstance,
  // Union
  NativeElement,
  // Page-level elements
  PagePlacementSemantics,
  PageTargetMode,
  PageContentElement,
  PageLevelWrapper,
  // Custom element definition
  CustomElementDefinition,
  // Document root
  CbbDocument,
} from "./types.js";

export {
  CHURCH_PROFILE_TEXT_FIELD_KEYS,
  CHURCH_PROFILE_ASSET_FIELD_KEYS,
  CHURCH_PROFILE_FIELD_KEYS,
  churchProfileKeyAcceptsFieldType,
  isChurchProfileFieldKey,
  DOCUMENT_LIMITS,
} from "./types.js";

// ---- parse ----------------------------------------------------------------
export type { } from "./parse.js";
export {
  DOCUMENT_SCHEMA_ID,
  DocumentValidationError,
  DocumentMigrationError,
  fromJson,
  normalizeDocumentForCurrentUse,
  toJson,
} from "./parse.js";

// ---- custom-definition revisions ----------------------------------------
export type { CustomDefinitionRevisionSet } from "./customDefinitions.js";
export {
  customElementDefinitionHash,
  finalizeCustomDefinitionRevisions,
} from "./customDefinitions.js";

// ---- semantic validation -------------------------------------------------
export { validateDocumentSemantics } from "./semantic.js";
export {
  isSafeFieldPattern,
  matchesSafeFieldPattern,
} from "./safePattern.js";

// ---- treeOps --------------------------------------------------------------
export type { NodeLocation, NodeRef } from "./treeOps.js";
export {
  findById,
  buildParentMap,
  collectAllNodeIds,
  countNodes,
  checkNodeLimit,
  insertElement,
  removeElement,
  moveElement,
  remintIds,
  maxContainerDepth,
  findDuplicateNodeId,
  checkContainerDepth,
} from "./treeOps.js";

// ---- resolvedTypes --------------------------------------------------------
export type {
  ResolvedExpansion,
  ResolvedNodeProvenance,
  ResolvedInline,
  EffectiveScripturePresentation,
  ResolvedScriptureVerse,
  ResolvedScriptureParagraph,
  ResolvedScriptureBlock,
  ResolvedRichTextBlock,
  ResolvedRichTextDocument,
  ResolvedTextContent,
  ResolvedRightsContribution,
  ResolvedFlowProperties,
  ResolvedTextElement,
  ResolvedImageElement,
  ResolvedDateElement,
  ResolvedMusicElement,
  ResolvedRightsAttributionElement,
  ResolvedPageBreakElement,
  ResolvedGridChild,
  ResolvedGridElement,
  ResolvedStackChild,
  ResolvedStackElement,
  ResolvedCanvasChild,
  ResolvedCanvasElement,
  ResolvedElement,
  ResolvedNode,
  ResolvedRenderTree,
  ResolvedPageElement,
  ProjectedGridChild,
  ProjectedStackChild,
  ProjectedCanvasChild,
  ProjectedElement,
  ProjectedPageElement,
  RenderPageProjection,
  FontIdentityRef,
  AssetIdentityRef,
  RenderProjection,
} from "./resolvedTypes.js";
// ---- fieldClassificationData ----------------------------------------------
export {
  DOCUMENT_FIELD_CLASSIFICATIONS,
  ELEMENT_FIELD_CLASSIFICATIONS,
  registerDocumentClassifications,
  DOCUMENT_SCHEMA_ID as DOCUMENT_CLASSIFICATION_SCHEMA_ID,
  ELEMENT_SCHEMA_ID as ELEMENT_CLASSIFICATION_SCHEMA_ID,
  COMMON_SCHEMA_ID,
} from "./fieldClassificationData.js";
