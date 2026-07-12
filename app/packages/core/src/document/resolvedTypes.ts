/**
 * Render-only document contracts.
 *
 * The persisted document model deliberately contains authoring state.  These
 * types are the boundary after resolution: a consumer cannot observe field
 * stores, bindings, locks, review records, source names, custom instances, or
 * raw container children through a ResolvedElement.
 */

import type {
  CanvasPosition,
  ColorValue,
  DateElementData,
  ElementSize,
  FocalPoint,
  GridElementData,
  ImageElementData,
  NodeId,
  PageElementSize,
  PagePlacementSemantics,
  PageTargetMode,
  PhysicalLength,
  PhysicalOrRelativeLength,
  PortableAssetRefString,
  PortableFontRefString,
  RightsAttributionElementData,
  Sha256HashString,
  SpacingLength,
  StackElementData,
  StyleObject,
  TableSemantics,
  TextContent,
} from "./types.js";

// ---------------------------------------------------------------------------
// Provenance and stable transient identity
// ---------------------------------------------------------------------------

export type ResolvedExpansion =
  | {
      readonly kind: "repeat";
      readonly ruleId: string;
      readonly prototypeNodeId: NodeId;
      readonly itemId: string;
      readonly itemIndex: number;
    }
  | {
      readonly kind: "custom";
      readonly ownerInstanceId: NodeId;
      readonly definitionId: NodeId;
      readonly definitionNodeId: NodeId;
    };

/**
 * `expansions` is outermost-to-innermost.  It is intentionally composable: a
 * custom definition inside a repeated prototype (or the reverse) retains both
 * steps instead of losing one in a discriminated union.
 *
 * The legacy discriminator fields remain for the small constructor helpers;
 * downstream code should use `expansions`.
 */
export type ResolvedNodeProvenance =
  | {
      readonly kind: "direct";
      readonly sourceElementId: NodeId;
      readonly expansions: readonly ResolvedExpansion[];
    }
  | {
      readonly kind: "repeatExpansion";
      readonly sourceElementId: NodeId;
      readonly ruleId: string;
      readonly itemId: string;
      readonly itemIndex: number;
      readonly expansions: readonly ResolvedExpansion[];
    }
  | {
      readonly kind: "customExpansion";
      readonly sourceElementId: NodeId;
      readonly ownerInstanceId: NodeId;
      readonly definitionNodeId: NodeId;
      readonly expansions: readonly ResolvedExpansion[];
    };

// ---------------------------------------------------------------------------
// Render-only rich text and rights contributions
// ---------------------------------------------------------------------------

export type ResolvedInline =
  | {
      readonly type: "text";
      readonly text: string;
      readonly marks?: readonly ("strong" | "emphasis")[];
    }
  | { readonly type: "lineBreak" };

export interface EffectiveScripturePresentation {
  readonly referencePlacement: "before" | "after";
  readonly verseNumberStyle: "inline" | "superscript" | "hidden";
  readonly paragraphPolicy: "publisher" | "oneVerse";
  readonly paragraphSpacing: PhysicalLength;
  readonly translationLabelPlacement:
    | "withReference"
    | "afterPassage"
    | "hidden";
  readonly typographyPresetSnapshot?: Readonly<Record<string, unknown>>;
}

export interface ResolvedScriptureVerse {
  readonly verseId: string;
  readonly label: string;
  readonly paragraphStart: boolean;
  readonly children: readonly ResolvedInline[];
}

export interface ResolvedScriptureParagraph {
  readonly type: "paragraph";
  readonly children: readonly ResolvedInline[];
}

export type ResolvedScriptureBlock =
  | {
      readonly type: "scripture";
      readonly structureKind: "verseStructured";
      readonly reference: string;
      readonly canonicalReference: string;
      readonly translationLabel: string;
      readonly verses: readonly ResolvedScriptureVerse[];
      readonly presentation: EffectiveScripturePresentation;
    }
  | {
      readonly type: "scripture";
      readonly structureKind: "paragraphOnly";
      readonly reference: string;
      readonly canonicalReference?: string;
      readonly translationLabel: string;
      readonly paragraphs: readonly ResolvedScriptureParagraph[];
      readonly presentation: EffectiveScripturePresentation;
    };

export type ResolvedRichTextBlock =
  | { readonly type: "paragraph"; readonly children: readonly ResolvedInline[] }
  | {
      readonly type: "heading";
      readonly level: 1 | 2 | 3 | 4 | 5 | 6;
      readonly children: readonly ResolvedInline[];
    }
  | {
      readonly type: "bulletList" | "orderedList" | "blockquote" | "listItem";
      readonly start?: number;
      readonly children: readonly ResolvedRichTextBlock[];
    }
  | ResolvedScriptureBlock;

export interface ResolvedRichTextDocument {
  readonly type: "document";
  readonly blocks: readonly ResolvedRichTextBlock[];
}

export type ResolvedTextContent =
  | { readonly kind: "plain"; readonly text: string }
  | { readonly kind: "richText"; readonly document: ResolvedRichTextDocument };

/** Sanitized, active contribution input for the later rights generator. */
export interface ResolvedRightsContribution {
  /** Shared by every rights record collected from one rendered source node. */
  readonly firstAppearance: number;
  readonly creditKey: string;
  /** Exact revision identity used for de-duplication and equivocation checks. */
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
  /** Retained only for the app-owned optional public-domain status line. */
  readonly workTitle?: string;
  readonly creditRequiredWhen: "always" | "renderedText" | "never";
  /**
   * Resolved applicability of requiredCreditLine for this rendered occurrence.
   * `always` is true, `never` is false, and `renderedText` reflects whether the
   * governed source contains rendered text after binding/rule expansion.
   */
  readonly requiredCreditLineApplies: boolean;
  readonly requiredCreditLine?: string | undefined;
  readonly usagePolicyDisclosureLine?: string;
  readonly publicationLicenseDisplay?: {
    readonly displayLine: string;
    readonly sourceDisplayRevisionHash: Sha256HashString;
  };
}

// ---------------------------------------------------------------------------
// Closed resolved element union
// ---------------------------------------------------------------------------

export interface ResolvedFlowProperties {
  readonly width?: ElementSize;
  readonly height?: ElementSize;
  readonly breakPolicy?: "auto" | "avoid";
  readonly margin?: SpacingLength;
  readonly padding?: SpacingLength;
  /** Output-affecting style only; the legacy family-name migration input is removed. */
  readonly style?: Omit<StyleObject, "font">;
}

export interface ResolvedTextElement extends ResolvedFlowProperties {
  readonly type: "text";
  readonly data: { readonly content: ResolvedTextContent };
}

export interface ResolvedImageElement extends ResolvedFlowProperties {
  readonly type: "image";
  readonly data: ImageElementData;
}

export interface ResolvedDateElement extends ResolvedFlowProperties {
  readonly type: "date";
  readonly data: DateElementData;
}

export interface ResolvedMusicElement extends ResolvedFlowProperties {
  readonly type: "music";
  readonly data: {
    readonly number?: string;
    readonly title: string;
    readonly instructions?: string;
    readonly source?: string;
    readonly richContent?: ResolvedRichTextDocument;
  };
}

export interface ResolvedRightsAttributionElement extends ResolvedFlowProperties {
  readonly type: "rightsAttribution";
  readonly data: RightsAttributionElementData;
}

export interface ResolvedPageBreakElement extends ResolvedFlowProperties {
  readonly type: "pageBreak";
  readonly data: { readonly intent?: "flowBreak" | "intentionalBlank" };
}

export interface ResolvedGridChild {
  readonly resolvedId: string;
  readonly provenance: ResolvedNodeProvenance;
  readonly row: number;
  readonly column: number;
  readonly element: ResolvedNode;
}

export interface ResolvedGridElement extends ResolvedFlowProperties {
  readonly type: "grid";
  readonly data: GridElementData;
  readonly children: readonly ResolvedGridChild[];
}

export interface ResolvedStackChild {
  readonly resolvedId: string;
  readonly provenance: ResolvedNodeProvenance;
  readonly index: number;
  readonly element: ResolvedNode;
}

export interface ResolvedStackElement extends ResolvedFlowProperties {
  readonly type: "stack";
  readonly data: StackElementData;
  readonly children: readonly ResolvedStackChild[];
}

export interface ResolvedCanvasChild {
  readonly resolvedId: string;
  readonly provenance: ResolvedNodeProvenance;
  readonly x: CanvasPosition;
  readonly y: CanvasPosition;
  readonly semanticOrder?: number;
  readonly element: ResolvedNode;
}

export interface ResolvedCanvasElement extends ResolvedFlowProperties {
  readonly type: "canvas";
  readonly data?: Readonly<Record<never, never>>;
  readonly children: readonly ResolvedCanvasChild[];
}

export type ResolvedElement =
  | ResolvedTextElement
  | ResolvedImageElement
  | ResolvedDateElement
  | ResolvedMusicElement
  | ResolvedRightsAttributionElement
  | ResolvedPageBreakElement
  | ResolvedGridElement
  | ResolvedStackElement
  | ResolvedCanvasElement;

export interface ResolvedNode {
  readonly resolvedId: string;
  readonly provenance: ResolvedNodeProvenance;
  readonly element: ResolvedElement;
}

export interface ResolvedPageElement {
  readonly resolvedId: string;
  readonly provenance: ResolvedNodeProvenance;
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
  readonly element: ResolvedNode;
}

export interface ResolvedRenderTree {
  readonly elements: readonly ResolvedNode[];
  readonly pageElements: readonly ResolvedPageElement[];
  /** Elements and placement wrappers, including nested container wrappers. */
  readonly totalNodeCount: number;
}

// ---------------------------------------------------------------------------
// ID-free render projection
// ---------------------------------------------------------------------------

export type ProjectedGridChild = Pick<ResolvedGridChild, "row" | "column"> & {
  readonly element: ProjectedElement;
};
export type ProjectedStackChild = Pick<ResolvedStackChild, "index"> & {
  readonly element: ProjectedElement;
};
export type ProjectedCanvasChild = Pick<
  ResolvedCanvasChild,
  "x" | "y" | "semanticOrder"
> & { readonly element: ProjectedElement };

export type ProjectedElement =
  | ResolvedTextElement
  | ResolvedImageElement
  | ResolvedDateElement
  | ResolvedMusicElement
  | ResolvedRightsAttributionElement
  | ResolvedPageBreakElement
  | (Omit<ResolvedGridElement, "children"> & {
      readonly children: readonly ProjectedGridChild[];
    })
  | (Omit<ResolvedStackElement, "children"> & {
      readonly children: readonly ProjectedStackChild[];
    })
  | (Omit<ResolvedCanvasElement, "children"> & {
      readonly children: readonly ProjectedCanvasChild[];
    });

export type ProjectedPageElement = Omit<
  ResolvedPageElement,
  "resolvedId" | "provenance" | "element"
> & { readonly element: ProjectedElement };

export interface RenderPageProjection {
  readonly typstWidth: PhysicalLength;
  readonly typstHeight: PhysicalLength;
  readonly background?: ColorValue;
  readonly marginMode?: "fixed" | "mirrored";
  readonly binding?: "left" | "right";
  readonly margins?: {
    readonly top?: PhysicalLength;
    readonly right?: PhysicalLength;
    readonly bottom?: PhysicalLength;
    readonly left?: PhysicalLength;
    readonly inner?: PhysicalLength;
    readonly outer?: PhysicalLength;
  };
}

/** A portable ref observed during resolution; no byte digest is asserted. */
export interface FontIdentityRef {
  readonly fontRef: PortableFontRefString;
}

/** A portable ref observed during resolution; no byte digest is asserted. */
export interface AssetIdentityRef {
  readonly assetRef: PortableAssetRefString;
}

export interface RenderProjection {
  readonly version: 1;
  /** Effective machine-readable PDF title; metadata.title falls back to document.name. */
  readonly title: string;
  readonly locale: string;
  readonly page: RenderPageProjection;
  readonly scripturePresentation: EffectiveScripturePresentation;
  readonly fontFallbackRefs: readonly PortableFontRefString[];
  readonly elements: readonly ProjectedElement[];
  readonly pageElements: readonly ProjectedPageElement[];
  readonly rightsContributions: readonly ResolvedRightsContribution[];
  readonly referencedFonts: readonly FontIdentityRef[];
  readonly referencedAssets: readonly AssetIdentityRef[];
}

// Re-export data types useful to layout/Typst consumers without reopening the
// persisted union.
export type {
  FocalPoint,
  TableSemantics,
  TextContent,
};
