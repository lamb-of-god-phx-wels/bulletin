/**
 * Page model and content-box computation for the Church Bulletin Builder.
 *
 * All arithmetic is exact (Rational).  Rounding occurs only at
 * emission/persistence in the length serialization layer.
 *
 * References:
 *   spec §"Page Model" (lines 1960–2094)
 *   spec §"Lengths And Units" (lines 2095–2160)
 */

import {
  type AbsoluteLength,
  parseLength,
  absoluteIn,
  subLengths,
  cmpLengths,
} from "./length.js";
import { fromDecimalString, rational, div } from "./rational.js";

// ─── Page size presets ────────────────────────────────────────────────────────

/** Built-in folded-panel presets from the spec. */
export const PRESET_FOLDED_5_5_X_8_5: { width: AbsoluteLength; height: AbsoluteLength } = {
  // 5.5in × 8.5in
  width: absoluteIn(fromDecimalString("5.5")),
  height: absoluteIn(fromDecimalString("8.5")),
};

export const PRESET_FOLDED_7_X_8_5: { width: AbsoluteLength; height: AbsoluteLength } = {
  // 7in × 8.5in
  width: absoluteIn(fromDecimalString("7")),
  height: absoluteIn(fromDecimalString("8.5")),
};

/** Legacy migration fallback: 7in × 8.5in (same dimensions as preset). */
export const LEGACY_FALLBACK_PAGE: { width: AbsoluteLength; height: AbsoluteLength } =
  PRESET_FOLDED_7_X_8_5;

// ─── px-per-inch constant ─────────────────────────────────────────────────────

/**
 * Editor dimensions are derived from physical page size at 96 px per inch.
 * (spec: "Editor dimensions are always derived at 96px per inch")
 */
export const EDITOR_PX_PER_INCH = 96n; // bigint — exact, no float

/**
 * Convert an AbsoluteLength to editor pixels using half-away-from-zero
 * rounding.  96px/in, 1in = 72pt, so 1pt = 96/72 = 4/3 px.
 *
 * Example: 0.51in = 0.51 * 96 = 48.96px → rounds to 49px.
 *
 * Rounding rule: for a rational p/q, rounded = floor((|p| * 2 + q) / (2*q))
 * then restore sign.  This is the standard half-away-from-zero formula.
 */
export function lengthToEditorPixels(length: AbsoluteLength): bigint {
  // px_rational = pt * 4/3 = (ptNumerator * 4) / (ptDenominator * 3)
  const pxNum = length.pt.numerator * 4n;
  const pxDen = length.pt.denominator * 3n;
  // Half-away-from-zero: round((|pxNum| / pxDen)) = floor((|pxNum|*2 + pxDen) / (pxDen*2))
  const absNum = pxNum < 0n ? -pxNum : pxNum;
  const roundedAbs = (absNum * 2n + pxDen) / (pxDen * 2n);
  return pxNum < 0n ? -roundedAbs : roundedAbs;
}

// ─── Margin model ─────────────────────────────────────────────────────────────

/** Fixed-margin model (all four sides explicit). */
export interface FixedMargins {
  readonly mode: "fixed";
  readonly top: AbsoluteLength;
  readonly right: AbsoluteLength;
  readonly bottom: AbsoluteLength;
  readonly left: AbsoluteLength;
}

/**
 * Mirrored-margin model.
 * "inner" is the gutter side (toward binding), "outer" is the opposite side.
 * Physical left/right depends on page parity and binding direction.
 */
export interface MirroredMargins {
  readonly mode: "mirrored";
  readonly top: AbsoluteLength;
  readonly bottom: AbsoluteLength;
  readonly inner: AbsoluteLength;
  readonly outer: AbsoluteLength;
}

export type Margins = FixedMargins | MirroredMargins;

// ─── Binding / parity for mirrored-margin resolution ─────────────────────────

export type BindingDirection = "left" | "right";
export type PageParity = "odd" | "even"; // odd = recto, even = verso

/**
 * Resolve mirrored margins to physical left/right for a given page.
 *
 * Binding "left" (default):
 *   odd pages  → inner = left,  outer = right
 *   even pages → inner = right, outer = left
 *
 * Binding "right":
 *   odd pages  → inner = right, outer = left
 *   even pages → inner = left,  outer = right
 */
export function resolveMirroredMargins(
  margins: MirroredMargins,
  binding: BindingDirection,
  parity: PageParity,
): FixedMargins {
  const innerIsLeft =
    (binding === "left" && parity === "odd") ||
    (binding === "right" && parity === "even");

  const left = innerIsLeft ? margins.inner : margins.outer;
  const right = innerIsLeft ? margins.outer : margins.inner;

  return {
    mode: "fixed",
    top: margins.top,
    right,
    bottom: margins.bottom,
    left,
  };
}

// ─── Content box ──────────────────────────────────────────────────────────────

/** The resolved content area for a page. */
export interface ContentBox {
  readonly width: AbsoluteLength;
  readonly height: AbsoluteLength;
}

/**
 * Compute the content box from page dimensions and fixed margins.
 *
 * From spec:
 *   content width  = page width  - resolved physical left margin
 *                                - resolved physical right margin
 *   content height = page height - top margin - bottom margin
 *
 * Throws if any content dimension would be non-positive.
 */
export function computeContentBox(
  pageWidth: AbsoluteLength,
  pageHeight: AbsoluteLength,
  margins: FixedMargins,
): ContentBox {
  const width = subLengths(subLengths(pageWidth, margins.left), margins.right);
  const height = subLengths(subLengths(pageHeight, margins.top), margins.bottom);

  if (cmpLengths(width, { kind: "absolute", pt: { numerator: 0n, denominator: 1n } }) <= 0) {
    throw new RangeError(
      "computeContentBox: content width must be positive (margins exceed page width)",
    );
  }
  if (cmpLengths(height, { kind: "absolute", pt: { numerator: 0n, denominator: 1n } }) <= 0) {
    throw new RangeError(
      "computeContentBox: content height must be positive (margins exceed page height)",
    );
  }

  return { width, height };
}

/**
 * Compute the content box for a mirrored-margin document.
 * Uses the given parity/binding to resolve physical left/right.
 */
export function computeContentBoxMirrored(
  pageWidth: AbsoluteLength,
  pageHeight: AbsoluteLength,
  margins: MirroredMargins,
  binding: BindingDirection,
  parity: PageParity,
): ContentBox {
  const fixed = resolveMirroredMargins(margins, binding, parity);
  return computeContentBox(pageWidth, pageHeight, fixed);
}

// ─── PageSize ─────────────────────────────────────────────────────────────────

export interface PageSize {
  readonly width: AbsoluteLength;
  readonly height: AbsoluteLength;
}

/**
 * Parse a PageSize from persisted string fields (e.g. "8.5in", "612pt").
 * Both fields must be absolute length strings.
 */
export function parsePageSize(widthStr: string, heightStr: string): PageSize {
  const width = parseLength(widthStr);
  const height = parseLength(heightStr);
  if (width.kind !== "absolute") {
    throw new TypeError(
      `parsePageSize: width must be an absolute length, got kind "${width.kind}"`,
    );
  }
  if (height.kind !== "absolute") {
    throw new TypeError(
      `parsePageSize: height must be an absolute length, got kind "${height.kind}"`,
    );
  }
  return { width, height };
}

// ─── BookletPrintSetup validation ─────────────────────────────────────────────

export interface SafeInset {
  readonly top: AbsoluteLength;
  readonly right: AbsoluteLength;
  readonly bottom: AbsoluteLength;
  readonly left: AbsoluteLength;
  readonly fold: AbsoluteLength;
}

export interface BookletPrintSetup {
  readonly sheetWidth: AbsoluteLength;
  readonly sheetHeight: AbsoluteLength;
  readonly duplexFlip: "shortEdge" | "longEdge";
  /** Decimal 0 < scale ≤ 1 */
  readonly scale: import("./rational.js").Rational;
  readonly safeInset: SafeInset;
}

const ZERO_LENGTH: AbsoluteLength = { kind: "absolute", pt: { numerator: 0n, denominator: 1n } };

function isPositive(l: AbsoluteLength): boolean {
  return cmpLengths(l, ZERO_LENGTH) > 0;
}

/**
 * Validate booklet print setup geometry per spec §"Page Model".
 *
 * Rules (all must hold):
 *   1. sheetWidth > sheetHeight  (landscape orientation)
 *   2. 0 < scale ≤ 1
 *   3. sheetHeight - safeInset.top - safeInset.bottom > 0
 *   4. slotWidth - safeInset.left - safeInset.fold > 0
 *   5. slotWidth - safeInset.right - safeInset.fold > 0
 *
 * Returns null if valid, or a string describing the first violation found.
 */
export function validateBookletPrintSetup(
  setup: BookletPrintSetup,
): string | null {
  // 1. Landscape
  if (cmpLengths(setup.sheetWidth, setup.sheetHeight) <= 0) {
    return "sheetWidth must be greater than sheetHeight (landscape)";
  }

  // 2. Scale
  const { scale } = setup;
  if (scale.numerator <= 0n) {
    return "scale must be greater than 0";
  }
  // scale ≤ 1 means numerator ≤ denominator
  if (scale.numerator > scale.denominator) {
    return "scale must be at most 1";
  }

  // 3. Vertical safe zone
  const vertRemain = subLengths(
    subLengths(setup.sheetHeight, setup.safeInset.top),
    setup.safeInset.bottom,
  );
  if (!isPositive(vertRemain)) {
    return "sheetHeight - safeInset.top - safeInset.bottom must be positive";
  }

  // slotWidth = sheetWidth / 2  (exact rational, gcd-reduced via div())
  const slotWidth: AbsoluteLength = {
    kind: "absolute",
    pt: div(setup.sheetWidth.pt, rational(2n, 1n)),
  };

  // 4. Left slot
  const leftRemain = subLengths(
    subLengths(slotWidth, setup.safeInset.left),
    setup.safeInset.fold,
  );
  if (!isPositive(leftRemain)) {
    return "slotWidth - safeInset.left - safeInset.fold must be positive";
  }

  // 5. Right slot
  const rightRemain = subLengths(
    subLengths(slotWidth, setup.safeInset.right),
    setup.safeInset.fold,
  );
  if (!isPositive(rightRemain)) {
    return "slotWidth - safeInset.right - safeInset.fold must be positive";
  }

  return null;
}

// ─── FinalPageCountRequirement validation ─────────────────────────────────────

export type FinalPageCountRequirement =
  | { readonly exact: number }
  | {
      readonly minimum?: number;
      readonly maximum?: number;
      readonly multipleOf?: number;
    };

/** Hard cap on generated-PDF page count. */
export const PDF_PAGE_HARD_CAP = 9999;

/**
 * Validate a FinalPageCountRequirement per spec rules.
 * Returns null if valid, or a descriptive error string.
 */
export function validateFinalPageCountRequirement(
  req: FinalPageCountRequirement,
): string | null {
  if ("exact" in req) {
    if (!Number.isInteger(req.exact) || req.exact < 1) {
      return "exact must be a positive integer";
    }
    if (req.exact > PDF_PAGE_HARD_CAP) {
      return `exact must not exceed PDF page hard cap (${PDF_PAGE_HARD_CAP})`;
    }
    return null;
  }

  const { minimum, maximum, multipleOf } = req;

  if (minimum !== undefined) {
    if (!Number.isInteger(minimum) || minimum < 1) {
      return "minimum must be a positive integer";
    }
    if (minimum > PDF_PAGE_HARD_CAP) {
      return `minimum must not exceed PDF page hard cap (${PDF_PAGE_HARD_CAP})`;
    }
  }

  if (maximum !== undefined) {
    if (!Number.isInteger(maximum) || maximum < 1) {
      return "maximum must be a positive integer";
    }
    if (maximum > PDF_PAGE_HARD_CAP) {
      return `maximum must not exceed PDF page hard cap (${PDF_PAGE_HARD_CAP})`;
    }
  }

  if (minimum !== undefined && maximum !== undefined) {
    if (minimum > maximum) {
      return "minimum must not exceed maximum";
    }
  }

  if (multipleOf !== undefined) {
    if (!Number.isInteger(multipleOf) || multipleOf < 2) {
      return "multipleOf must be an integer >= 2";
    }
    if (multipleOf > PDF_PAGE_HARD_CAP) {
      return `multipleOf must not exceed PDF page hard cap (${PDF_PAGE_HARD_CAP})`;
    }
  }

  // The combined conditions must admit at least one valid count from 1 through hard cap
  const lo = minimum ?? 1;
  const hi = maximum ?? PDF_PAGE_HARD_CAP;
  if (lo > hi) {
    return "no valid page count exists between minimum and maximum";
  }
  if (multipleOf !== undefined) {
    // Check at least one multiple of multipleOf in [lo, hi]
    const firstMultiple = Math.ceil(lo / multipleOf) * multipleOf;
    if (firstMultiple > hi) {
      return `no multiple of ${multipleOf} exists between ${lo} and ${hi}`;
    }
  }

  return null;
}
