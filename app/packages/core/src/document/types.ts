/**
 * @cbb/core/document/types — In-memory document model types.
 *
 * All types mirror the JSON schema (document.schema.json,
 * element.schema.json, common.schema.json, customElement.schema.json)
 * exactly. No runtime logic lives here — pure structural types only.
 *
 * Section references:
 *   spec.md §Document Model (1465-1960)
 *   spec.md §Element Types (2269-3140)
 *   spec.md §Style Model (2161-2269)
 *   spec.md §Custom Elements (6298-6395)
 */

import type { RichTextDocument } from "../richtext/index.js";

// ---------------------------------------------------------------------------
// Primitives (mirror common.schema.json)
// ---------------------------------------------------------------------------

/** Stable document-global visual node id: ^[A-Za-z][A-Za-z0-9_-]*$ */
export type NodeId = string;

/** Field identifier within a field contract (same pattern as NodeId). */
export type FieldId = string;

/** Content-rule identifier. */
export type RuleId = string;

/** Portable UUIDv4 identifying a field contract lineage. */
export type ContractId = string;

/** Repeat-item UUIDv4. */
export type RepeatItemUuid = string;

/** SHA-256 hash in the form sha256:<64 lowercase hex characters>. */
export type Sha256HashString = string;

/** ISO 8601 calendar date string YYYY-MM-DD. */
export type IsoDateString = string;

/** RFC 3339 UTC timestamp with Z suffix. */
export type Rfc3339Timestamp = string;

/** Physical length: number + pt/in/cm/mm. */
export type PhysicalLength = string;

/** Physical or relative length: number + pt/in/cm/mm/em/%. */
export type PhysicalOrRelativeLength = string;

/** Track length: physical/% /fr/auto. */
export type TrackLength = string | "auto";

/** Element width/height: physical/% /auto/legacy number. */
export type ElementSize = string | number | "auto";

/** Spacing length: physical or legacy number. */
export type SpacingLength = string | number;

/** Canvas x/y position: physical or legacy number (nonneg). */
export type CanvasPosition = string | number;

/** Page-element width/height: physical/% /auto. */
export type PageElementSize = string | "auto";

/** CSS hex color or transparent. */
export type ColorValue = string;

/** Portable asset reference: asset:<uuid> */
export type PortableAssetRefString = string;

/** Portable font reference: font:<uuid> */
export type PortableFontRefString = string;

/** Portable song work reference: song:<uuid> */
export type PortableSongWorkRefString = string;

/** Scripture translation reference: translation:<uuid> */
export type ScriptureTranslationRefString = string;

/** Rights credit reference: credit:<uuid> */
export type RightsCreditRefString = string;

// ---------------------------------------------------------------------------
// Style
// ---------------------------------------------------------------------------

export interface StyleObject {
  readonly fontRef?: PortableFontRefString;
  /** Legacy family-name: migration input only. */
  readonly font?: string;
  readonly fontSize?: number | string;
  readonly fontWeight?: "regular" | "medium" | "semibold" | "bold";
  readonly fontStyle?: "normal" | "italic";
  readonly color?: ColorValue;
  readonly background?: ColorValue;
  readonly borderColor?: ColorValue;
  readonly borderWidth?: number | string;
  readonly align?: "left" | "center" | "right" | "justify";
  readonly verticalAlign?: "top" | "center" | "bottom";
}

// ---------------------------------------------------------------------------
// Authoring policy
// ---------------------------------------------------------------------------

export interface AuthoringPolicy {
  readonly contentLocked?: boolean;
  readonly layoutLocked?: boolean;
}

// ---------------------------------------------------------------------------
// Field contracts, values, and bindings
// ---------------------------------------------------------------------------

export type FieldType =
  | "text"
  | "richText"
  | "date"
  | "number"
  | "boolean"
  | "choice"
  | "assetRef"
  | "array"
  | "object";

export type SemanticRole = "publicationDate" | "serviceLabel";
export type RolloverPolicy = "clear" | "keep" | "ask" | "deriveConfirm";
export type ReviewExpectation = "everyBulletin" | "whenCarried" | "none";

export interface WeeklyBehaviorDerivation {
  readonly kind: "nextScheduledServiceDate";
  readonly serviceLabelHint?: string;
}

export interface WeeklyBehavior {
  readonly rolloverPolicy: RolloverPolicy;
  readonly reviewExpectation: ReviewExpectation;
  readonly derivation?: WeeklyBehaviorDerivation;
}

export interface FieldChoiceEntry {
  readonly id: string;
  readonly label: string;
}

export interface FieldConstraints {
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly choices?: readonly FieldChoiceEntry[];
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly mediaType?: string;
}

export interface FieldDefinition {
  readonly id: FieldId;
  readonly label: string;
  readonly type: FieldType;
  readonly required: boolean;
  readonly description?: string;
  readonly groupId?: FieldId;
  readonly nullable?: boolean;
  readonly default?: unknown;
  readonly examples?: readonly unknown[];
  readonly constraints?: FieldConstraints;
  readonly semanticRole?: SemanticRole;
  readonly weeklyBehavior?: WeeklyBehavior;
  readonly profileKey?: string;
  readonly aiInstructions?: string;
  /** Required when type is "array". */
  readonly itemField?: FieldDefinition;
  /** Required when type is "object". */
  readonly childFields?: readonly FieldDefinition[];
}

export interface FieldContractGroup {
  readonly id: FieldId;
  readonly label: string;
  readonly description?: string;
  /** Top-level conditional rule id for group visibility. */
  readonly conditionalRuleId?: RuleId;
}

export interface FieldContract {
  readonly id: ContractId;
  readonly version: number;
  readonly name: string;
  readonly description?: string;
  readonly groups?: readonly FieldContractGroup[];
  readonly fields: readonly FieldDefinition[];
  readonly contractHash?: Sha256HashString;
}

export type FieldValueOrigin =
  | "manual"
  | "ai"
  | "imported"
  | "materializedDefault"
  | "carriedForward"
  | "profile"
  | "derived";

export interface FieldValueEntry {
  readonly value: unknown;
  readonly origin: FieldValueOrigin;
  /** For array fields used by a repeat rule: UUIDv4 ids parallel to array. */
  readonly itemIds?: readonly RepeatItemUuid[];
}

/** Object keyed by FieldId from the corresponding contract. */
export type FieldValues = Readonly<Record<FieldId, FieldValueEntry>>;

export interface Binding {
  readonly id: string;
  readonly scope: "document" | "local";
  readonly fieldId: FieldId;
  /** RFC 6901 JSON Pointer relative to the owning element. */
  readonly target: string;
  readonly fallback?: unknown;
  readonly format?: Readonly<Record<string, never>>;
}

export interface ItemBinding {
  readonly id: string;
  /** RFC 6901 JSON Pointer relative to one array item. */
  readonly itemPath: string;
  readonly targetNodeId: NodeId;
  /** RFC 6901 JSON Pointer relative to targetNodeId. */
  readonly target: string;
  readonly fallback?: unknown;
  readonly format?: Readonly<Record<string, never>>;
}

// ---------------------------------------------------------------------------
// Content rules
// ---------------------------------------------------------------------------

export type ConditionKind =
  | { readonly kind: "booleanEquals"; readonly value: boolean }
  | { readonly kind: "choiceEquals"; readonly choiceId: string }
  | { readonly kind: "choiceNotEquals"; readonly choiceId: string };

export interface ConditionalRule {
  readonly kind: "conditional";
  readonly id: RuleId;
  readonly targetNodeId: NodeId;
  readonly scope: "document" | "item";
  readonly fieldId: FieldId | string;
  readonly condition: ConditionKind;
  readonly activateLabel: string;
  readonly inactiveLabel: string;
}

export type EmptyState =
  | { readonly mode: "collapse" }
  | { readonly mode: "show"; readonly nodeId: NodeId };

export interface RepeatRule {
  readonly kind: "repeat";
  readonly id: RuleId;
  readonly fieldId: FieldId;
  readonly prototypeNodeId: NodeId;
  readonly itemBindings?: readonly ItemBinding[];
  readonly emptyState: EmptyState;
  readonly maxItems: number;
  readonly userReorderable: boolean;
  readonly nullIsEmpty?: boolean;
  readonly itemLabel: string;
  readonly addLabel: string;
}

export type ContentRule = ConditionalRule | RepeatRule;

// ---------------------------------------------------------------------------
// Review records
// ---------------------------------------------------------------------------

export type FieldReviewDisposition =
  | "kept"
  | "clearedPrior"
  | "edited"
  | "derivedConfirmed"
  | "profileAccepted"
  | "confirmedUnchanged"
  | "notApplicable";

export interface FieldReviewTargetDocument {
  readonly scope: "document";
  readonly fieldId: FieldId;
}

export interface FieldReviewTargetLocal {
  readonly scope: "local";
  readonly ownerNodeId: NodeId;
  readonly fieldId: FieldId;
}

export type FieldReviewTarget =
  | FieldReviewTargetDocument
  | FieldReviewTargetLocal;

export interface DerivationEvidence {
  readonly kind: "nextScheduledServiceDate";
  readonly selectedScheduleId: string;
  readonly selectedScheduleLabel: string;
  readonly churchProfileRevisionHash: Sha256HashString;
  readonly baseDateRuleDescription: string;
  readonly resultingDate: IsoDateString;
}

export interface FieldReviewEntry {
  readonly target: FieldReviewTarget;
  readonly disposition: FieldReviewDisposition;
  readonly reviewHash: Sha256HashString;
  readonly sourcePublicationDate?: IsoDateString;
  readonly sourceValueHash?: Sha256HashString;
  readonly derivationEvidence?: DerivationEvidence;
}

export type ContentReviewDisposition =
  | "pending"
  | "confirmedUnchanged"
  | "edited"
  | "notApplicable";

export interface ContentReviewTargetDocument {
  readonly scope: "document";
  readonly targetNodeId: NodeId;
}

export interface ContentReviewTargetCustom {
  readonly scope: "custom";
  readonly ownerNodeId: NodeId;
  readonly definitionNodeId: NodeId;
}

export type ContentReviewTarget =
  | ContentReviewTargetDocument
  | ContentReviewTargetCustom;

export interface ContentReviewSourceEvidence {
  readonly sourceKind: "template" | "bulletinDuplicate";
  readonly sourceDocumentHash: Sha256HashString;
  readonly sourceContentProjectionHash: Sha256HashString;
  readonly sourcePublicationDate?: IsoDateString;
  readonly sourceTarget?: ContentReviewTarget;
}

export interface ContentReviewEntry {
  readonly target: ContentReviewTarget;
  readonly disposition: ContentReviewDisposition;
  readonly reviewHash: Sha256HashString;
  readonly sourceEvidence?: ContentReviewSourceEvidence;
}

// ---------------------------------------------------------------------------
// Source template lineage
// ---------------------------------------------------------------------------

export interface SourceTemplate {
  readonly contractId: ContractId;
  readonly contractVersion?: number;
  readonly contractHash?: Sha256HashString;
  readonly sourceDocumentHash?: Sha256HashString;
  readonly sourceDisplayName?: string;
  readonly packId?: string;
  readonly contentId?: string;
  readonly packVersion?: string;
}

// ---------------------------------------------------------------------------
// Document metadata and page setup
// ---------------------------------------------------------------------------

export interface DocumentMetadata {
  readonly title?: string;
  readonly language?: string;
  readonly publicationDate?: IsoDateString;
  readonly serviceLabel?: string;
}

export interface PageMargins {
  readonly top?: PhysicalLength;
  readonly right?: PhysicalLength;
  readonly bottom?: PhysicalLength;
  readonly left?: PhysicalLength;
  readonly inner?: PhysicalLength;
  readonly outer?: PhysicalLength;
}

export interface PrintSafeInset {
  readonly top: PhysicalLength;
  readonly right: PhysicalLength;
  readonly bottom: PhysicalLength;
  readonly left: PhysicalLength;
}

export interface BookletSafeInset {
  readonly top: PhysicalLength;
  readonly right: PhysicalLength;
  readonly bottom: PhysicalLength;
  readonly left: PhysicalLength;
  readonly fold: PhysicalLength;
}

export interface BookletPrintSetup {
  readonly sheetWidth: PhysicalLength;
  readonly sheetHeight: PhysicalLength;
  readonly duplexFlip: "shortEdge" | "longEdge";
  readonly scale: number;
  readonly safeInset: BookletSafeInset;
}

export type FinalPageCountRequirement =
  | { readonly exact: number }
  | {
      readonly minimum?: number;
      readonly maximum?: number;
      readonly multipleOf?: number;
    };

export interface PageSetup {
  readonly typstWidth: PhysicalLength;
  readonly typstHeight: PhysicalLength;
  readonly width?: number;
  readonly height?: number;
  readonly layoutIntent?: "singlePage" | "foldedBooklet";
  readonly background?: ColorValue;
  readonly marginMode?: "fixed" | "mirrored";
  readonly binding?: "left" | "right";
  readonly margins?: PageMargins;
  readonly printSafeInset?: PrintSafeInset;
  readonly bookletPrintSetup?: BookletPrintSetup;
  readonly finalPageCountRequirement?: FinalPageCountRequirement;
}

export interface ScripturePresentationSettings {
  readonly referencePlacement?: "before" | "after";
  readonly verseNumberStyle?: "inline" | "superscript" | "hidden";
  readonly paragraphPolicy?: "publisher" | "oneVerse";
  readonly paragraphSpacing?: string;
  readonly translationLabelPlacement?:
    | "withReference"
    | "afterPassage"
    | "hidden";
  readonly typographyPresetSnapshot?: Readonly<Record<string, unknown>>;
}

export interface RightsPolicy {
  readonly unknownRightsPolicy: "review" | "block";
}

export type PublicationContext =
  | "printedNonsalableChurchBulletin"
  | "digitalNonsalableChurchBulletin";

// ---------------------------------------------------------------------------
// Element base fields
// ---------------------------------------------------------------------------

export interface BaseElementFields {
  readonly id: NodeId;
  readonly type: string;
  readonly name: string;
  readonly width?: ElementSize;
  readonly height?: ElementSize;
  readonly breakPolicy?: "auto" | "avoid";
  readonly margin?: SpacingLength;
  readonly padding?: SpacingLength;
  readonly style?: StyleObject;
  readonly fieldContract?: FieldContract;
  readonly fieldValues?: FieldValues;
  readonly bindings?: readonly Binding[];
  readonly authoringPolicy?: AuthoringPolicy;
  readonly weeklyReview?: "everyBulletin" | "whenDuplicated" | "none";
}

// ---------------------------------------------------------------------------
// Text element
// ---------------------------------------------------------------------------

export type TextContent =
  | { readonly kind: "plain"; readonly text: string }
  | { readonly kind: "richText"; readonly document: RichTextDocument };

export interface TextElementData {
  readonly content: TextContent;
}

export interface TextElement extends BaseElementFields {
  readonly type: "text";
  readonly data: TextElementData;
}

// ---------------------------------------------------------------------------
// Image element
// ---------------------------------------------------------------------------

export interface FocalPoint {
  readonly x: number;
  readonly y: number;
}

export interface ImageElementData {
  readonly assetRef: PortableAssetRefString;
  readonly fit: "contain" | "cover";
  readonly focalPoint?: FocalPoint;
  readonly alt?: string;
  readonly decorative?: boolean;
}

export interface ImageElement extends BaseElementFields {
  readonly type: "image";
  readonly data: ImageElementData;
}

// ---------------------------------------------------------------------------
// Date element
// ---------------------------------------------------------------------------

export interface DateElementData {
  readonly value: IsoDateString;
  readonly format?: string;
  readonly locale?: string;
  readonly prefix?: string;
  readonly suffix?: string;
}

export interface DateElement extends BaseElementFields {
  readonly type: "date";
  readonly data: DateElementData;
}

// ---------------------------------------------------------------------------
// Music / Hymn element
// ---------------------------------------------------------------------------

export interface SourceSong {
  readonly songRef: PortableSongWorkRefString;
  readonly sourceRevision: number;
  readonly sourceHash: Sha256HashString;
  readonly displayTitle?: string;
  readonly displayNumber?: string;
}

export interface RightsContributor {
  readonly name: string;
  readonly role:
    | "author"
    | "composer"
    | "arranger"
    | "translator"
    | "adapter"
    | "publisher"
    | "other";
}

export interface PublicationLicenseDisplay {
  readonly providerLabel: string;
  readonly displayLine: string;
  readonly sourceDisplayRevisionHash: Sha256HashString;
  readonly effectiveFrom?: IsoDateString;
  readonly effectiveThrough?: IsoDateString;
}

export interface UsagePolicyConstraint {
  readonly metric: "verses" | "words" | "passages" | "portionBasisPoints";
  readonly scope: "passage" | "bulletin" | "translation";
  readonly limit: number;
  readonly basisMetric?: "verses" | "words";
  readonly basisUnitCount?: number;
}

export interface UsagePolicySnapshot {
  readonly providerRuleId: string;
  readonly providerRuleVersion: string;
  readonly applicablePublicationContexts: readonly PublicationContext[];
  readonly constraints?: readonly UsagePolicyConstraint[];
  readonly requiredPublicationDisclosureLine?: string;
  readonly policySourceHash: Sha256HashString;
  readonly counterId: string;
  readonly counterVersion: string;
}

export interface RightsRecord {
  readonly creditKey: RightsCreditRefString;
  readonly creditProjectionHash: Sha256HashString;
  readonly component:
    | "text"
    | "tune"
    | "arrangement"
    | "translation"
    | "setting"
    | "recording"
    | "scriptureTranslation"
    | "other";
  readonly status: "copyrighted" | "publicDomain" | "unknown";
  readonly workTitle?: string;
  readonly edition?: string;
  readonly arrangement?: string;
  readonly tuneTitle?: string;
  readonly contributors?: readonly RightsContributor[];
  readonly copyrightYear?: number;
  readonly copyrightHolder?: string;
  readonly administrator?: string;
  readonly licenseProvider?: string;
  readonly songCatalogId?: string;
  readonly creditRequiredWhen: "always" | "renderedText" | "never";
  readonly requiredCreditLine?: string;
  readonly publicationLicenseDisplay?: PublicationLicenseDisplay;
  readonly usagePolicySnapshot?: UsagePolicySnapshot;
}

export interface RightsAssociationReview {
  readonly reviewedSongContentHash: Sha256HashString;
  readonly reviewedRightsProjectionHash: Sha256HashString;
  readonly reviewTime: Rfc3339Timestamp;
}

export interface MusicElementData {
  readonly number?: string;
  readonly title: string;
  readonly instructions?: string;
  readonly source?: string;
  readonly richContent?: RichTextDocument;
  readonly sourceSong?: SourceSong;
  readonly rightsAssociationReview: RightsAssociationReview;
  readonly rights: readonly RightsRecord[];
}

export interface MusicElement extends BaseElementFields {
  readonly type: "music";
  readonly data: MusicElementData;
}

// ---------------------------------------------------------------------------
// Copyrights & Permissions element
// ---------------------------------------------------------------------------

export interface RightsAttributionElementData {
  readonly heading?: string;
  readonly introText?: string;
  readonly groupOrder: readonly ["scripture" | "music" | "other", "scripture" | "music" | "other", "scripture" | "music" | "other"];
  readonly sortPolicy?: "firstAppearance";
  readonly includePublicDomainLines?: boolean;
}

export interface RightsAttributionElement extends BaseElementFields {
  readonly type: "rightsAttribution";
  readonly data: RightsAttributionElementData;
}

// ---------------------------------------------------------------------------
// Page break element
// ---------------------------------------------------------------------------

export interface PageBreakElementData {
  readonly intent?: "flowBreak" | "intentionalBlank";
}

export interface PageBreakElement extends BaseElementFields {
  readonly type: "pageBreak";
  readonly data: PageBreakElementData;
}

// ---------------------------------------------------------------------------
// Grid element
// ---------------------------------------------------------------------------

export interface TableSemantics {
  readonly summary: string;
  readonly headerRows: number;
  readonly headerColumns: number;
}

export interface GridElementData {
  readonly rows: number;
  readonly columns: number;
  readonly cellPadding?: SpacingLength;
  readonly rowGap?: SpacingLength;
  readonly columnGap?: SpacingLength;
  readonly rowTracks?: readonly TrackLength[];
  readonly columnTracks?: readonly TrackLength[];
  readonly semanticRole?: "layout" | "table";
  readonly tableSemantics?: TableSemantics;
}

export interface GridChildWrapper {
  readonly id: NodeId;
  readonly row: number;
  readonly column: number;
  readonly authoringPolicy?: AuthoringPolicy;
  readonly element: NativeElement;
}

export interface GridElement extends BaseElementFields {
  readonly type: "grid";
  readonly data: GridElementData;
  readonly children: readonly GridChildWrapper[];
}

// ---------------------------------------------------------------------------
// Stack element
// ---------------------------------------------------------------------------

export interface StackElementData {
  readonly direction: "vertical" | "horizontal";
  readonly gap: SpacingLength;
}

export interface StackChildWrapper {
  readonly id: NodeId;
  readonly index: number;
  readonly authoringPolicy?: AuthoringPolicy;
  readonly element: NativeElement;
}

export interface StackElement extends BaseElementFields {
  readonly type: "stack";
  readonly data: StackElementData;
  readonly children: readonly StackChildWrapper[];
}

// ---------------------------------------------------------------------------
// Canvas element
// ---------------------------------------------------------------------------

export interface CanvasChildWrapper {
  readonly id: NodeId;
  readonly x: CanvasPosition;
  readonly y: CanvasPosition;
  readonly semanticOrder?: number;
  readonly authoringPolicy?: AuthoringPolicy;
  readonly element: NativeElement;
}

export interface CanvasElement extends BaseElementFields {
  readonly type: "canvas";
  readonly data?: Readonly<Record<never, never>>;
  readonly children: readonly CanvasChildWrapper[];
}

// ---------------------------------------------------------------------------
// Custom element instance
// ---------------------------------------------------------------------------

export interface CustomElementInstance {
  readonly id: NodeId;
  readonly type: "customInstance";
  readonly name: string;
  readonly definitionId: NodeId;
  readonly definitionHash?: Sha256HashString;
  readonly width?: ElementSize;
  readonly height?: ElementSize;
  readonly breakPolicy?: "auto" | "avoid";
  readonly margin?: SpacingLength;
  readonly padding?: SpacingLength;
  readonly style?: StyleObject;
  readonly fieldValues?: FieldValues;
  readonly authoringPolicy?: AuthoringPolicy;
  readonly weeklyReview?: "everyBulletin" | "whenDuplicated" | "none";
}

// ---------------------------------------------------------------------------
// Discriminated native element union
// ---------------------------------------------------------------------------

export type NativeElement =
  | TextElement
  | ImageElement
  | DateElement
  | MusicElement
  | RightsAttributionElement
  | PageBreakElement
  | GridElement
  | StackElement
  | CanvasElement
  | CustomElementInstance;

// ---------------------------------------------------------------------------
// Page-level elements
// ---------------------------------------------------------------------------

/**
 * Semantic metadata for a page-level placement wrapper.
 */
export type PagePlacementSemantics =
  | { readonly mode: "artifact" }
  | {
      readonly mode: "content";
      readonly readingOrder: "beforeBody" | "afterBody";
      readonly order: number;
    };

/**
 * Page targeting mode.
 */
export type PageTargetMode =
  | { readonly mode: "all" | "first" | "last" | "odd" | "even" }
  | { readonly mode: "range"; readonly start: number; readonly end: number }
  | { readonly mode: "pages"; readonly pages: readonly number[] };

/**
 * Page content element variant — no flow-only width/height/margin/breakPolicy.
 */
export interface PageContentElement {
  readonly id: NodeId;
  readonly type: string;
  readonly name: string;
  readonly padding?: SpacingLength;
  readonly style?: StyleObject;
  readonly authoringPolicy?: AuthoringPolicy;
  readonly weeklyReview?: "everyBulletin" | "whenDuplicated" | "none";
  readonly fieldContract?: FieldContract;
  readonly fieldValues?: FieldValues;
  readonly bindings?: readonly Binding[];
  readonly data?: unknown;
  readonly children?: unknown;
}

/**
 * Page-level placement wrapper. Lives in document.pageElements.
 */
export interface PageLevelWrapper {
  readonly id: NodeId;
  readonly purpose:
    | "background"
    | "header"
    | "footer"
    | "pageNumber"
    | "decoration";
  readonly target: PageTargetMode;
  readonly layer: "background" | "underlay" | "overlay";
  readonly region:
    | "page"
    | "content"
    | "topMargin"
    | "bottomMargin"
    | "leftMargin"
    | "rightMargin";
  readonly anchor:
    | "topLeft"
    | "topCenter"
    | "topRight"
    | "centerLeft"
    | "center"
    | "centerRight"
    | "bottomLeft"
    | "bottomCenter"
    | "bottomRight";
  readonly x: PhysicalOrRelativeLength;
  readonly y: PhysicalOrRelativeLength;
  readonly width: PageElementSize;
  readonly height: PageElementSize;
  readonly zIndex: number;
  readonly clipToRegion: boolean;
  readonly semantic: PagePlacementSemantics;
  readonly element: PageContentElement;
  readonly authoringPolicy?: AuthoringPolicy;
}

// ---------------------------------------------------------------------------
// Custom element definition
// ---------------------------------------------------------------------------

export interface CustomElementDefinition {
  readonly version: 1;
  readonly kind: "customElementDefinition";
  readonly id: NodeId;
  readonly name: string;
  readonly description?: string;
  readonly category?: string;
  readonly fieldContract: FieldContract;
  readonly elements: readonly NativeElement[];
  readonly contentRules?: readonly ContentRule[];
  readonly sampleFieldValues?: FieldValues;
  readonly authoringPolicy?: AuthoringPolicy;
}

// ---------------------------------------------------------------------------
// Document root
// ---------------------------------------------------------------------------

export interface CbbDocument {
  readonly version: 1;
  readonly kind: "bulletin" | "template";
  readonly name: string;
  readonly metadata?: DocumentMetadata;
  readonly page: PageSetup;
  readonly authoringPolicy?: AuthoringPolicy;
  readonly fontFallbackRefs?: readonly PortableFontRefString[];
  readonly scripturePresentation?: ScripturePresentationSettings;
  readonly rightsPolicy?: RightsPolicy;
  readonly publicationContexts?: readonly PublicationContext[];
  readonly fieldContract?: FieldContract;
  readonly fieldValues?: FieldValues;
  readonly fieldReview?: readonly FieldReviewEntry[];
  readonly contentRules?: readonly ContentRule[];
  readonly contentReview?: readonly ContentReviewEntry[];
  readonly elements: readonly NativeElement[];
  readonly pageElements?: readonly PageLevelWrapper[];
  readonly sampleFieldValues?: FieldValues;
  readonly sourceTemplate?: SourceTemplate;
  readonly customElementDefinitions?: readonly CustomElementDefinition[];
  readonly orphanedFieldValues?: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Limits (spec §Size, Performance, And Resource Limits — lines 6017-6107)
// ---------------------------------------------------------------------------

export const DOCUMENT_LIMITS = {
  /** Warning at 5,000; hard cap at 20,000. */
  PERSISTED_VISUAL_NODES_WARN: 5_000,
  PERSISTED_VISUAL_NODES_CAP: 20_000,
  /** Warning at 10,000; hard cap at 50,000. */
  EXPANDED_RENDER_NODES_WARN: 10_000,
  EXPANDED_RENDER_NODES_CAP: 50_000,
  /** Warning at 16; hard cap at 32. */
  CONTAINER_NESTING_DEPTH_WARN: 16,
  CONTAINER_NESTING_DEPTH_CAP: 32,
} as const;
