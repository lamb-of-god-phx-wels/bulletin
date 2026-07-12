/**
 * @cbb/core/document/resolvedTypes — Downstream contract types.
 *
 * Defines the resolved render tree (post field-substitution / conditional /
 * repeat / custom expansion) and the render projection (the render-affecting
 * subset used for build hashing and Typst emission).
 *
 * These are types + constructors only — logic comes from later agents
 * (resolve, hashes, layout, typstgen).
 *
 * Spec references:
 *   spec.md §Persistence And Build (4126-4260) — renderInputHash semantics
 *   spec.md §Template-Authored Conditional And Repeatable Content (1836-1960)
 *   spec.md §Custom Elements And Bindings (6298-6395)
 */

import type {
  NodeId,
  NativeElement,
  PageLevelWrapper,
  PageSetup,
  StyleObject,
  PortableFontRefString,
  ScripturePresentationSettings,
  PublicationContext,
} from "./types.js";

// ---------------------------------------------------------------------------
// Provenance tracking
// ---------------------------------------------------------------------------

/**
 * Provenance record tracing a resolved node back to its source in the
 * authoritative persisted document tree.
 */
export type ResolvedNodeProvenance =
  | {
      /** Node is directly present in the source tree (no expansion). */
      readonly kind: "direct";
      readonly sourceElementId: NodeId;
    }
  | {
      /**
       * Node is one copy of a repeated prototype, expanded for a specific
       * array item. The sourceElementId is the prototypeNodeId. ruleId is the
       * repeat rule; itemId is the stable per-item UUIDv4.
       */
      readonly kind: "repeatExpansion";
      readonly sourceElementId: NodeId;
      readonly ruleId: string;
      readonly itemId: string;
      /** Zero-based position within the current expansion. */
      readonly itemIndex: number;
    }
  | {
      /**
       * Node is expanded from a custom element definition. ownerInstanceId is
       * the customInstance node in the source tree; definitionNodeId is the
       * definition's own element id within the definition.
       */
      readonly kind: "customExpansion";
      readonly ownerInstanceId: NodeId;
      readonly definitionNodeId: NodeId;
    };

// ---------------------------------------------------------------------------
// Resolved nodes
// ---------------------------------------------------------------------------

/**
 * A node in the resolved render tree. Every native element type is
 * represented; conditional-excluded nodes are absent; repeated nodes are
 * expanded; custom-element instances are replaced by their definition trees
 * with resolved field values.
 *
 * `resolvedId` is a deterministic stable identifier for this node in this
 * resolved expansion:
 *   - Direct node: same as source element id.
 *   - Repeat expansion: "<ruleId>/<itemId>/<sourceElementId>".
 *   - Custom expansion: "<ownerInstanceId>/<definitionNodeId>".
 *
 * `data` carries the resolved element with bound field values materialized
 * into content-bearing leaves (bindings stripped; literal values written).
 */
export interface ResolvedNode {
  readonly resolvedId: string;
  readonly provenance: ResolvedNodeProvenance;
  /**
   * The element after field value substitution. For container elements,
   * `children` contains resolved children (the raw schema children array is
   * replaced with resolvedChildren below).
   */
  readonly element: NativeElement;
  /** Resolved children for container elements (grid/stack/canvas). */
  readonly resolvedChildren?: readonly ResolvedNode[];
}

// ---------------------------------------------------------------------------
// Resolved render tree
// ---------------------------------------------------------------------------

/**
 * The full resolved document tree after:
 *   1. Field value binding / substitution.
 *   2. Conditional rule evaluation (inactive branches removed).
 *   3. Repeat prototype expansion (one node per array item).
 *   4. Custom element instance expansion (definition roots inlined).
 *
 * No bindings or content rules remain. Every node has a stable resolvedId
 * plus provenance back to its source element and, for expansions, its
 * rule/item identity.
 *
 * This type is the input to layout, Typst generation, rights attribution
 * generation, and build hashing. It is never persisted.
 */
export interface ResolvedRenderTree {
  /** Ordered resolved body-flow elements. */
  readonly elements: readonly ResolvedNode[];
  /** Resolved page-level elements. */
  readonly pageElements: readonly ResolvedPageElement[];
  /** Total node count (including nested children). */
  readonly totalNodeCount: number;
}

/**
 * A resolved page-level element (wrapper + resolved inner element).
 */
export interface ResolvedPageElement {
  readonly resolvedId: string;
  readonly wrapper: PageLevelWrapper;
  readonly resolvedElement: ResolvedNode;
}

// ---------------------------------------------------------------------------
// Font / asset identity references (render-affecting)
// ---------------------------------------------------------------------------

/**
 * A font face reference captured from the document for hashing purposes.
 * The resolver fills this from the fontRef + fontFallbackRefs on each element
 * that has a style.fontRef.
 */
export interface FontIdentityRef {
  readonly fontRef: PortableFontRefString;
  /**
   * Family digest from the font record (sha256 over canonical face array).
   * Filled by the resolve agent when it has access to the font catalog.
   * May be undefined when font records are not available (partial resolve).
   */
  readonly familyDigest?: string;
}

/**
 * An asset reference captured from the resolved tree.
 */
export interface AssetIdentityRef {
  readonly assetRef: string;
}

// ---------------------------------------------------------------------------
// Render projection
// ---------------------------------------------------------------------------

/**
 * The render-affecting subset of a resolved document, suitable for:
 *   - Computing renderInputHash (build signature).
 *   - Driving Typst source generation.
 *   - Stale-build detection.
 *
 * Per spec §Persistence And Build (4134-4148):
 *   renderInputHash covers: resolved render projection + output-affecting
 *   assets, fonts, tools, locale, and output options. Excludes: authoring
 *   policies, source lineage, orphaned values, template samples, field
 *   origins/field/content review records, stable UI item ids, Scripture
 *   source URL/retrieval/raw-source evidence, rights provenance/Song Library
 *   lineage, and unknown inert preservation data.
 *
 * This type carries the projection without hashing — the hash agent reads it.
 */
export interface RenderProjection {
  /** Canonical document name (appears in build artifacts). */
  readonly documentName: string;

  /** Resolved page setup. */
  readonly pageSetup: PageSetup;

  /** Document-level style (base style used for body flow). */
  readonly documentStyle?: StyleObject;

  /** Effective font fallback stack (fontRef list in resolution order). */
  readonly fontFallbackStack: readonly PortableFontRefString[];

  /** Effective scripture presentation (with v1 defaults applied). */
  readonly scripturePresentation: Required<
    Omit<ScripturePresentationSettings, "typographyPresetSnapshot">
  > &
    Pick<ScripturePresentationSettings, "typographyPresetSnapshot">;

  /** Ordered resolved body elements. */
  readonly elements: readonly ResolvedNode[];

  /** Resolved page-level elements. */
  readonly pageElements: readonly ResolvedPageElement[];

  /** Deduplicated font refs referenced anywhere in the resolved tree. */
  readonly referencedFonts: readonly FontIdentityRef[];

  /** Deduplicated asset refs referenced anywhere in the resolved tree. */
  readonly referencedAssets: readonly AssetIdentityRef[];

  /** Active publication contexts (render-affecting via rights generation). */
  readonly publicationContexts: readonly PublicationContext[];
}

// ---------------------------------------------------------------------------
// Constructor helpers (pure data constructors, no logic)
// ---------------------------------------------------------------------------

/**
 * Construct a direct-provenance resolved node from a native element.
 * No binding substitution is performed here — that belongs to the resolve
 * agent.
 */
export function makeDirectResolvedNode(element: NativeElement): ResolvedNode {
  return {
    resolvedId: element.id,
    provenance: { kind: "direct", sourceElementId: element.id },
    element,
  };
}

/**
 * Construct a repeat-expansion resolved node.
 */
export function makeRepeatResolvedNode(
  ruleId: string,
  itemId: string,
  itemIndex: number,
  element: NativeElement
): ResolvedNode {
  const resolvedId = `${ruleId}/${itemId}/${element.id}`;
  return {
    resolvedId,
    provenance: {
      kind: "repeatExpansion",
      sourceElementId: element.id,
      ruleId,
      itemId,
      itemIndex,
    },
    element,
  };
}

/**
 * Construct a custom-expansion resolved node.
 */
export function makeCustomResolvedNode(
  ownerInstanceId: NodeId,
  element: NativeElement
): ResolvedNode {
  const resolvedId = `${ownerInstanceId}/${element.id}`;
  return {
    resolvedId,
    provenance: {
      kind: "customExpansion",
      ownerInstanceId,
      definitionNodeId: element.id,
    },
    element,
  };
}

/**
 * Construct an empty resolved render tree.
 */
export function makeEmptyResolvedRenderTree(): ResolvedRenderTree {
  return {
    elements: [],
    pageElements: [],
    totalNodeCount: 0,
  };
}
