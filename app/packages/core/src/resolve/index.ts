export type {
  ResolveDocumentResult,
  ResolveFinding,
  ResolveFindingKind,
  ResolveOptions,
  ResolvedReadinessFieldTarget,
  ResolvedReadinessFieldUse,
  ResolvedReadinessSource,
} from "./types.js";
export { resolveDocument } from "./resolve.js";
export {
  materializeResolvedStyle,
  projectResolvedElement,
  projectResolvedPageElement,
  projectResolvedTree,
} from "./projection.js";
