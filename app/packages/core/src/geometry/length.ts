/**
 * Length model for the Church Bulletin Builder.
 *
 * Canonical internal unit: pt (typographic point).
 * All absolute lengths are stored as Rational values in pt.
 *
 * Exact conversion constants (from spec §"Lengths And Units"):
 *   1 in  = 72 pt         (exact)
 *   1 cm  = 72/2.54 pt    (exact rational: 7200/254 = 3600/127 pt)
 *   1 mm  = 72/25.4 pt    (exact rational:  720/254 =  360/127 pt)
 *   1 px  = 0.75 pt       (legacy migration: 3/4 pt, exact)
 *
 * Relative units (%, fr, em) and "auto" are preserved opaquely; they cannot
 * be converted to pt without context.
 *
 * Rounding: only at emission/persistence.  Generated Typst lengths round to
 * 0.001 pt, half away from zero.  Inspector inch values persist with at most
 * 6 fractional digits using the same rule.  Stored values are never mutated
 * by display operations.
 */

import {
  type Rational,
  fromInt,
  fromDecimalString,
  toDecimalString,
  add,
  sub,
  mul,
  div,
  rational,
  cmp,
  neg,
  isZero,
} from "./rational.js";

// ─── Conversion constants (exact) ────────────────────────────────────────────

/** 1 in = 72 pt */
export const IN_TO_PT: Rational = fromInt(72n);

/** 1 cm = 3600/127 pt  (exact: 72/2.54 = 7200/254 = 3600/127) */
export const CM_TO_PT: Rational = rational(3600n, 127n);

/** 1 mm = 360/127 pt   (exact: 72/25.4 = 720/254 = 360/127) */
export const MM_TO_PT: Rational = rational(360n, 127n);

/** 1 px = 3/4 pt  (legacy: 0.75 pt exact) */
export const PX_TO_PT: Rational = rational(3n, 4n);

/** 1 pt = 1 pt */
export const PT_TO_PT: Rational = fromInt(1n);

// ─── Length discriminated union ───────────────────────────────────────────────

/** An absolute length stored in pt with exact rational arithmetic. */
export interface AbsoluteLength {
  readonly kind: "absolute";
  /** Value in typographic points. */
  readonly pt: Rational;
}

/** A percentage length (requires basis to resolve). */
export interface PercentLength {
  readonly kind: "percent";
  /** The percentage value, e.g. 50 means 50%. */
  readonly value: Rational;
}

/** A fractional layout length (e.g., 1fr). */
export interface FrLength {
  readonly kind: "fr";
  readonly value: Rational;
}

/** A font-relative length (em units). */
export interface EmLength {
  readonly kind: "em";
  readonly value: Rational;
}

/** Automatic sizing. */
export interface AutoLength {
  readonly kind: "auto";
}

export type Length =
  | AbsoluteLength
  | PercentLength
  | FrLength
  | EmLength
  | AutoLength;

// ─── Constructors ─────────────────────────────────────────────────────────────

export function absolutePt(pt: Rational): AbsoluteLength {
  return { kind: "absolute", pt };
}

export function absoluteIn(inches: Rational): AbsoluteLength {
  return { kind: "absolute", pt: mul(inches, IN_TO_PT) };
}

export function absoluteCm(cm: Rational): AbsoluteLength {
  return { kind: "absolute", pt: mul(cm, CM_TO_PT) };
}

export function absoluteMm(mm: Rational): AbsoluteLength {
  return { kind: "absolute", pt: mul(mm, MM_TO_PT) };
}

export function absolutePx(px: Rational): AbsoluteLength {
  return { kind: "absolute", pt: mul(px, PX_TO_PT) };
}

export const AUTO_LENGTH: AutoLength = { kind: "auto" };

// ─── Parsing ──────────────────────────────────────────────────────────────────

/** Allowed absolute unit suffixes. */
const ABSOLUTE_UNITS = ["pt", "in", "cm", "mm", "px"] as const;
type AbsoluteUnit = (typeof ABSOLUTE_UNITS)[number];

/**
 * Parse a persisted length string.
 *
 * Accepted forms (case-sensitive, ASCII only, per spec):
 *   "3.5in"   "72pt"   "2.54cm"   "25.4mm"  "0.75px"
 *   "50%"     "1fr"    "1.5em"    "auto"
 *
 * Plain numbers are NOT accepted here — callers that handle "inch-mode plain
 * numbers" or "font-size plain numbers" must convert them before passing.
 */
export function parseLength(s: string): Length {
  const trimmed = s.trim();

  if (trimmed === "auto") {
    return AUTO_LENGTH;
  }

  // Try unit suffixes longest-first to avoid ambiguous prefix matching
  const unitMatches: { suffix: string; kind: string }[] = [
    { suffix: "pt", kind: "pt" },
    { suffix: "in", kind: "in" },
    { suffix: "cm", kind: "cm" },
    { suffix: "mm", kind: "mm" },
    { suffix: "px", kind: "px" },
    { suffix: "%", kind: "%" },
    { suffix: "fr", kind: "fr" },
    { suffix: "em", kind: "em" },
  ];

  for (const { suffix, kind } of unitMatches) {
    if (trimmed.endsWith(suffix)) {
      const numStr = trimmed.slice(0, trimmed.length - suffix.length);
      const value = parseDecimalNumber(numStr, s);
      switch (kind as AbsoluteUnit | "%" | "fr" | "em") {
        case "pt":
          return { kind: "absolute", pt: value };
        case "in":
          return { kind: "absolute", pt: mul(value, IN_TO_PT) };
        case "cm":
          return { kind: "absolute", pt: mul(value, CM_TO_PT) };
        case "mm":
          return { kind: "absolute", pt: mul(value, MM_TO_PT) };
        case "px":
          return { kind: "absolute", pt: mul(value, PX_TO_PT) };
        case "%":
          return { kind: "percent", value };
        case "fr":
          return { kind: "fr", value };
        case "em":
          return { kind: "em", value };
      }
    }
  }

  throw new SyntaxError(`parseLength: unrecognized length string "${s}"`);
}

/** Parse a plain decimal number string for use with a known unit. */
function parseDecimalNumber(numStr: string, original: string): Rational {
  try {
    return fromDecimalString(numStr);
  } catch {
    throw new SyntaxError(
      `parseLength: invalid numeric part in length string "${original}"`,
    );
  }
}

// ─── Serialization ────────────────────────────────────────────────────────────

/**
 * Serialize an AbsoluteLength to a Typst-compatible pt string.
 * Rounds to 0.001 pt, half away from zero, strips trailing zeros,
 * normalizes negative zero to "0pt".
 *
 * Per spec: "Generated absolute Typst lengths round once to 0.001pt,
 * half away from zero, strip trailing zeros, and normalize negative
 * zero to zero."
 */
export function toTypstPt(length: AbsoluteLength): string {
  // Round to 3 decimal places in pt
  const rounded = toDecimalString(length.pt, 3);
  const stripped = stripTrailingFractionalZeros(rounded);
  return stripped + "pt";
}

/**
 * Serialize an AbsoluteLength as an inch string with at most 6 fractional
 * digits, half away from zero, stripping trailing zeros.
 * Per spec: "Inspector-created inch values persist with at most six
 * fractional digits using the same rule."
 */
export function toInchString(length: AbsoluteLength): string {
  const inchValue = div(length.pt, IN_TO_PT);
  const rounded = toDecimalString(inchValue, 6);
  const stripped = stripTrailingFractionalZeros(rounded);
  return stripped + "in";
}

/**
 * Round an absolute length to the Typst emission precision (0.001 pt),
 * returning a new AbsoluteLength.  This is ONLY for emission/persistence —
 * internal computations stay exact.
 */
export function roundToTypstPrecision(length: AbsoluteLength): AbsoluteLength {
  // Round to 3 decimal places in pt using the same algorithm as toDecimalString
  const s = toDecimalString(length.pt, 3);
  const rounded = fromDecimalString(s);
  return { kind: "absolute", pt: rounded };
}

// ─── Absolute length arithmetic ───────────────────────────────────────────────

export function addLengths(
  a: AbsoluteLength,
  b: AbsoluteLength,
): AbsoluteLength {
  return { kind: "absolute", pt: add(a.pt, b.pt) };
}

export function subLengths(
  a: AbsoluteLength,
  b: AbsoluteLength,
): AbsoluteLength {
  return { kind: "absolute", pt: sub(a.pt, b.pt) };
}

export function negLength(a: AbsoluteLength): AbsoluteLength {
  return { kind: "absolute", pt: neg(a.pt) };
}

export function cmpLengths(a: AbsoluteLength, b: AbsoluteLength): -1 | 0 | 1 {
  return cmp(a.pt, b.pt);
}

export function isZeroLength(a: AbsoluteLength): boolean {
  return isZero(a.pt);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Strip trailing zeros after a decimal point (and the point itself if all
 * fractional digits are zero).  Handles negative-zero by returning "0".
 */
function stripTrailingFractionalZeros(s: string): string {
  if (!s.includes(".")) {
    return s;
  }
  let end = s.length;
  while (end > 0 && s[end - 1] === "0") {
    end--;
  }
  if (s[end - 1] === ".") {
    end--; // strip the decimal point itself
  }
  const result = s.slice(0, end);
  // Normalize negative zero edge case (should not happen after toDecimalString
  // but be defensive)
  return result === "-0" ? "0" : result;
}

/**
 * Check whether two lengths are the same kind and value.
 * For AbsoluteLength, compares exact rational pt values.
 */
export function lengthEquals(a: Length, b: Length): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "absolute":
      return cmp(a.pt, (b as AbsoluteLength).pt) === 0;
    case "percent":
      return cmp(a.value, (b as PercentLength).value) === 0;
    case "fr":
      return cmp(a.value, (b as FrLength).value) === 0;
    case "em":
      return cmp(a.value, (b as EmLength).value) === 0;
    case "auto":
      return true;
  }
}
