/**
 * Closed v1 break-matrix classification.
 *
 * This module intentionally accepts structural descriptors rather than
 * document or resolved-render nodes. Adapters at those boundaries can remain
 * small while the pagination semantics stay shared by editor and generator.
 */

export type BreakMatrixSubject =
  | { readonly kind: "text" }
  | { readonly kind: "image" }
  | { readonly kind: "date" }
  | { readonly kind: "music"; readonly hasRichContent: boolean }
  | { readonly kind: "rightsAttribution"; readonly entryCount: number }
  | { readonly kind: "grid"; readonly rowCount: number }
  | {
      readonly kind: "stack";
      readonly direction: "vertical" | "horizontal";
    }
  | { readonly kind: "canvas" }
  | {
      readonly kind: "pageBreak";
      readonly intent: "flowBreak" | "intentionalBlank";
    }
  | { readonly kind: "expandedCustomRoots"; readonly rootCount: number };

export interface BreakSuppressionContext {
  /** An explicit fixed-height outer box suppresses descendant break points. */
  readonly fixedHeight?: boolean;
  /** A matrix-unbreakable ancestor suppresses all descendant break points. */
  readonly unbreakableAncestor?: boolean;
}

export type BreakOpportunity =
  | "textFragment"
  | "musicRichContent"
  | "rightsEntry"
  | "gridRow"
  | "verticalStackChild"
  | "expandedCustomRoot";

export type MatrixUnbreakableReason =
  | "image"
  | "date"
  | "musicWithoutRichContent"
  | "horizontalStack"
  | "canvas";

export type BreakClassification =
  | {
      readonly mode: "breakable";
      readonly breakAt: BreakOpportunity;
      readonly allowsDescendantBreaks: boolean;
      readonly keepRule:
        | "none"
        | "headingWithFollowingContent"
        | "metadataWithFirstContent"
        | "headingWithFirstEntry";
    }
  | {
      readonly mode: "unbreakable";
      readonly reason:
        | MatrixUnbreakableReason
        | "fixedHeight"
        | "unbreakableAncestor";
      /** Records the opportunity hidden by a fixed/unbreakable outer box. */
      readonly suppressedBreakAt?: BreakOpportunity;
    }
  | { readonly mode: "empty"; readonly reason: "emptyRightsAttribution" }
  | {
      readonly mode: "pageBreak";
      readonly intent: "flowBreak" | "intentionalBlank";
    };

/** Classify one structural subject under the closed v1 break matrix. */
export function classifyBreakBehavior(
  subject: BreakMatrixSubject,
  context: BreakSuppressionContext = {},
): BreakClassification {
  const natural = classifyNaturalBehavior(subject);

  if (natural.mode !== "breakable") return natural;

  if (context.unbreakableAncestor === true) {
    return {
      mode: "unbreakable",
      reason: "unbreakableAncestor",
      suppressedBreakAt: natural.breakAt,
    };
  }

  if (context.fixedHeight === true) {
    return {
      mode: "unbreakable",
      reason: "fixedHeight",
      suppressedBreakAt: natural.breakAt,
    };
  }

  return natural;
}

function classifyNaturalBehavior(
  subject: BreakMatrixSubject,
): BreakClassification {
  switch (subject.kind) {
    case "text":
      return {
        mode: "breakable",
        breakAt: "textFragment",
        allowsDescendantBreaks: false,
        keepRule: "headingWithFollowingContent",
      };

    case "image":
      return { mode: "unbreakable", reason: "image" };

    case "date":
      return { mode: "unbreakable", reason: "date" };

    case "music":
      return subject.hasRichContent
        ? {
            mode: "breakable",
            breakAt: "musicRichContent",
            allowsDescendantBreaks: false,
            keepRule: "metadataWithFirstContent",
          }
        : { mode: "unbreakable", reason: "musicWithoutRichContent" };

    case "rightsAttribution":
      assertNonNegativeInteger(subject.entryCount, "entryCount");
      return subject.entryCount === 0
        ? { mode: "empty", reason: "emptyRightsAttribution" }
        : {
            mode: "breakable",
            breakAt: "rightsEntry",
            allowsDescendantBreaks: false,
            keepRule: "headingWithFirstEntry",
          };

    case "grid":
      assertNonNegativeInteger(subject.rowCount, "rowCount");
      return {
        mode: "breakable",
        breakAt: "gridRow",
        allowsDescendantBreaks: false,
        keepRule: "none",
      };

    case "stack":
      return subject.direction === "vertical"
        ? {
            mode: "breakable",
            breakAt: "verticalStackChild",
            allowsDescendantBreaks: true,
            keepRule: "none",
          }
        : { mode: "unbreakable", reason: "horizontalStack" };

    case "canvas":
      return { mode: "unbreakable", reason: "canvas" };

    case "pageBreak":
      return { mode: "pageBreak", intent: subject.intent };

    case "expandedCustomRoots":
      assertNonNegativeInteger(subject.rootCount, "rootCount");
      return {
        mode: "breakable",
        breakAt: "expandedCustomRoot",
        allowsDescendantBreaks: true,
        keepRule: "none",
      };

    default:
      return assertNever(subject);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unknown break-matrix subject: ${String(value)}`);
}
