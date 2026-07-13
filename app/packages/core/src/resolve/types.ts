import type {
  RenderProjection,
  ResolvedNodeProvenance,
  ResolvedRenderTree,
  ResolvedRightsContribution,
} from "../document/resolvedTypes.js";
import type {
  ConditionalRule,
  NativeElement,
  RepeatRule,
} from "../document/types.js";

/**
 * One source element after output-activity rules and all applicable bindings
 * have been resolved. Containers intentionally retain their persisted child
 * arrays for source fidelity; consumers must treat each entry as one element
 * boundary and must not recursively visit `children` because active children
 * have their own entries.
 */
export interface ResolvedReadinessSource {
  /** Stable source/provenance path; repeat segments use stable item ids. */
  readonly path: string;
  readonly resolvedId: string;
  readonly provenance: ResolvedNodeProvenance;
  readonly element: NativeElement;
}

export type ResolvedReadinessFieldTarget =
  | { readonly scope: "document"; readonly fieldId: string }
  | {
      readonly scope: "local";
      readonly ownerNodeId: string;
      readonly fieldId: string;
    };

/**
 * Minimal active field-use context needed to invalidate portable review
 * decisions. Labels, origins, item ids, source paths, and other editor state
 * are deliberately absent.
 */
export type ResolvedReadinessFieldUse =
  | {
      readonly kind: "binding";
      readonly target: ResolvedReadinessFieldTarget;
      readonly bindingId: string;
      /** Present only when this target-local fallback actually supplied output. */
      readonly fallbackUsed?: unknown;
    }
  | {
      readonly kind: "conditionalRule";
      readonly target: ResolvedReadinessFieldTarget;
      readonly ruleId: string;
      readonly targetNodeId: string;
      readonly condition: ConditionalRule["condition"];
      readonly activation: "active" | "inactive" | "unresolved";
      readonly contentScope:
        | { readonly scope: "document" }
        | {
            readonly scope: "custom";
            readonly ownerNodeId: string;
            readonly definitionId: string;
          };
    }
  | {
      readonly kind: "repeatRule";
      readonly target: ResolvedReadinessFieldTarget;
      readonly ruleId: string;
      readonly prototypeNodeId: string;
      readonly emptyState: RepeatRule["emptyState"];
      readonly maxItems: number;
      readonly nullIsEmpty: boolean;
    };

export type ResolveFindingKind =
  | "fieldDefinitionMissing"
  | "fieldValueInvalid"
  | "fieldValueMissing"
  | "bindingTargetInvalid"
  | "bindingValueIncompatible"
  | "conditionalRuleInvalid"
  | "conditionalUnresolved"
  | "repeatRuleInvalid"
  | "repeatUnresolved"
  | "repeatItemIdsInvalid"
  | "expandedNodeLimitExceeded"
  | "customDefinitionMissing"
  | "customDefinitionPinMissing"
  | "customDefinitionVersionMismatch"
  | "customDefinitionHashMismatch"
  | "customDefinitionCycle"
  | "customDefinitionDepthExceeded";

export interface ResolveFinding {
  readonly code: "CBB-DOC-0001" | "CBB-FIELD-0001";
  readonly severity: "error";
  readonly kind: ResolveFindingKind;
  /** Stable source path, never a transient expanded array index alone. */
  readonly path: string;
  readonly message: string;
  readonly nodeId?: string;
  readonly ruleId?: string;
  readonly fieldId?: string;
}

export interface ResolveOptions {
  /** Explicit build locale. Falls back to metadata.language, then en-US. */
  readonly locale?: string;
  /** Test/lower deployment bound; it can never raise the v1 50,000 cap. */
  readonly maxExpandedNodes?: number;
  /** Nested custom-definition expansion bound. Defaults to 32. */
  readonly maxCustomDepth?: number;
  /** @deprecated Current definition pins are always enforced fail closed. */
  readonly verifyDefinitionHashes?: boolean;
}

export interface ResolveDocumentResult {
  readonly tree: ResolvedRenderTree;
  readonly projection: RenderProjection;
  readonly rightsContributions: readonly ResolvedRightsContribution[];
  /** Active, binding-materialized source boundaries for readiness projection. */
  readonly readinessSources: readonly ResolvedReadinessSource[];
  /** Evaluated active binding/rule context for readiness-review invalidation. */
  readonly readinessFieldUses: readonly ResolvedReadinessFieldUse[];
  readonly findings: readonly ResolveFinding[];
}
