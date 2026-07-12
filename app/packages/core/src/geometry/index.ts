/**
 * @cbb/core/geometry — exact-arithmetic length model and page math.
 *
 * Re-exports all public geometry types and functions.
 */

export type { Rational } from "./rational.js";
export {
  rational,
  fromInt,
  fromDecimalString,
  toDecimalString,
  add,
  sub,
  mul,
  div,
  neg,
  abs,
  cmp,
  eq,
  lt,
  lte,
  gt,
  gte,
  min,
  max,
  isZero,
  isPositive,
  isNegative,
} from "./rational.js";

export type {
  Length,
  AbsoluteLength,
  PercentLength,
  FrLength,
  EmLength,
  AutoLength,
} from "./length.js";
export {
  IN_TO_PT,
  CM_TO_PT,
  MM_TO_PT,
  PX_TO_PT,
  PT_TO_PT,
  absolutePt,
  absoluteIn,
  absoluteCm,
  absoluteMm,
  absolutePx,
  AUTO_LENGTH,
  parseLength,
  toTypstPt,
  toInchString,
  roundToTypstPrecision,
  addLengths,
  subLengths,
  negLength,
  cmpLengths,
  isZeroLength,
  lengthEquals,
} from "./length.js";

export type {
  FixedMargins,
  MirroredMargins,
  Margins,
  BindingDirection,
  PageParity,
  ContentBox,
  PageSize,
  SafeInset,
  BookletPrintSetup,
  FinalPageCountRequirement,
} from "./page.js";
export {
  PRESET_FOLDED_5_5_X_8_5,
  PRESET_FOLDED_7_X_8_5,
  LEGACY_FALLBACK_PAGE,
  EDITOR_PX_PER_INCH,
  lengthToEditorPixels,
  resolveMirroredMargins,
  computeContentBox,
  computeContentBoxMirrored,
  parsePageSize,
  validateBookletPrintSetup,
  validateFinalPageCountRequirement,
  PDF_PAGE_HARD_CAP,
} from "./page.js";
