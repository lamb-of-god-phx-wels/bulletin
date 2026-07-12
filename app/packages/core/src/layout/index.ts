/** Shared editor/generator layout semantics. */

export type {
  BreakClassification,
  BreakMatrixSubject,
  BreakOpportunity,
  BreakSuppressionContext,
  MatrixUnbreakableReason,
} from "./breakMatrix.js";
export { classifyBreakBehavior } from "./breakMatrix.js";

export type {
  FragmentPlacement,
  MeasuredFlowBlock,
  MeasuredFlowItem,
  MeasuredFragment,
  MeasuredFragmentRole,
  PageBreakItem,
  PaginatedPage,
  PaginationFinding,
  PaginationOptions,
  PaginationResult,
} from "./paginator.js";
export {
  DEFAULT_PAGE_CAP,
  paginateMeasuredFlow,
} from "./paginator.js";
