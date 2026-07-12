/**
 * Exact rational arithmetic using bigint numerator/denominator.
 *
 * Invariants (always maintained after construction):
 *   - denominator > 0n
 *   - gcd(|numerator|, denominator) = 1n  (fully reduced)
 *   - zero is represented as 0n/1n
 *
 * No floating-point arithmetic is used anywhere in this module.
 */

/** Compute greatest common divisor (always non-negative). */
function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

export interface Rational {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

/** Normalize a raw numerator/denominator pair into canonical form. */
function normalize(n: bigint, d: bigint): Rational {
  if (d === 0n) {
    throw new RangeError("Rational: denominator must not be zero");
  }
  if (n === 0n) {
    return { numerator: 0n, denominator: 1n };
  }
  // Ensure denominator is positive
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n < 0n ? -n : n, d);
  return { numerator: n / g, denominator: d / g };
}

/** Create a Rational from two bigint values (numerator and denominator). */
export function rational(numerator: bigint, denominator: bigint): Rational {
  return normalize(numerator, denominator);
}

/** Create a Rational from an integer (bigint or number). */
export function fromInt(value: bigint | number): Rational {
  const n = typeof value === "number" ? BigInt(Math.trunc(value)) : value;
  return { numerator: n, denominator: 1n };
}

/**
 * Parse an exact decimal string such as "3.14159" or "-0.001" into a Rational.
 * No floating-point parsing is involved — the string is parsed digit-by-digit.
 *
 * Grammar (per spec.md line ~2148):
 *   decimal = [sign] integer ['.' fraction]
 *   sign     = '+' | '-'
 *   integer  = DIGIT+          (at least one digit before the decimal point)
 *   fraction = DIGIT+          (at least one digit after the decimal point)
 *
 * Trailing-dot forms like "1." and leading-dot forms like ".5" are rejected.
 * Scientific notation is not accepted.
 */
export function fromDecimalString(s: string): Rational {
  const trimmed = s.trim();
  // Require at least one digit on each side when '.' is present.
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (match === null) {
    throw new SyntaxError(
      `Rational.fromDecimalString: invalid decimal string "${s}"`,
    );
  }
  const sign = match[1] === "-" ? -1n : 1n;
  const intPart = match[2] ?? "";
  const fracPart = match[3] ?? "";

  const digits = intPart + fracPart;
  const numerator = sign * BigInt(digits);
  const denominator = 10n ** BigInt(fracPart.length);
  return normalize(numerator, denominator);
}

/**
 * Serialize a Rational to a decimal string with exactly `fractionDigits`
 * decimal places, using half-away-from-zero rounding.
 *
 * Negative-zero is normalized to "0" (or "0.000..." with fraction digits).
 */
export function toDecimalString(
  r: Rational,
  fractionDigits: number,
): string {
  if (!Number.isInteger(fractionDigits) || fractionDigits < 0) {
    throw new RangeError(
      `toDecimalString: fractionDigits must be a non-negative integer, got ${fractionDigits}`,
    );
  }
  const fd = BigInt(fractionDigits);
  const scale = 10n ** fd;

  // Work with absolute value; track sign separately.
  const isNeg = r.numerator < 0n;
  const absNum = isNeg ? -r.numerator : r.numerator;
  const den = r.denominator; // always > 0

  // scaled = floor(absNum / den * scale)  with half-away-from-zero rounding
  // = floor((absNum * scale * 2 + den) / (den * 2))
  const doubled = absNum * scale * 2n;
  const roundedAbs = (doubled + den) / (den * 2n); // integer division truncates toward zero

  if (roundedAbs === 0n) {
    // Normalize negative zero
    const zeros = fractionDigits > 0 ? "." + "0".repeat(fractionDigits) : "";
    return "0" + zeros;
  }

  const integerPart = roundedAbs / scale;
  const fracPart = roundedAbs % scale;

  const intStr = integerPart.toString();
  const sign = isNeg ? "-" : "";

  if (fractionDigits === 0) {
    return sign + intStr;
  }

  const fracStr = fracPart.toString().padStart(fractionDigits, "0");
  return sign + intStr + "." + fracStr;
}

// ─── Arithmetic ──────────────────────────────────────────────────────────────

export function add(a: Rational, b: Rational): Rational {
  return normalize(
    a.numerator * b.denominator + b.numerator * a.denominator,
    a.denominator * b.denominator,
  );
}

export function sub(a: Rational, b: Rational): Rational {
  return normalize(
    a.numerator * b.denominator - b.numerator * a.denominator,
    a.denominator * b.denominator,
  );
}

export function mul(a: Rational, b: Rational): Rational {
  return normalize(a.numerator * b.numerator, a.denominator * b.denominator);
}

export function div(a: Rational, b: Rational): Rational {
  if (b.numerator === 0n) {
    throw new RangeError("Rational.div: division by zero");
  }
  return normalize(a.numerator * b.denominator, a.denominator * b.numerator);
}

export function neg(r: Rational): Rational {
  return { numerator: -r.numerator, denominator: r.denominator };
}

// ─── Comparison ──────────────────────────────────────────────────────────────

/**
 * Compare two Rationals.
 * Returns -1 if a < b, 0 if a === b, 1 if a > b.
 */
export function cmp(a: Rational, b: Rational): -1 | 0 | 1 {
  // a/b_d  vs  c/d  → a*d vs c*b_d  (denominators always positive)
  const lhs = a.numerator * b.denominator;
  const rhs = b.numerator * a.denominator;
  if (lhs < rhs) return -1;
  if (lhs > rhs) return 1;
  return 0;
}

export function eq(a: Rational, b: Rational): boolean {
  return cmp(a, b) === 0;
}

export function lt(a: Rational, b: Rational): boolean {
  return cmp(a, b) === -1;
}

export function lte(a: Rational, b: Rational): boolean {
  return cmp(a, b) !== 1;
}

export function gt(a: Rational, b: Rational): boolean {
  return cmp(a, b) === 1;
}

export function gte(a: Rational, b: Rational): boolean {
  return cmp(a, b) !== -1;
}

export function min(a: Rational, b: Rational): Rational {
  return lte(a, b) ? a : b;
}

export function max(a: Rational, b: Rational): Rational {
  return gte(a, b) ? a : b;
}

export function isZero(r: Rational): boolean {
  return r.numerator === 0n;
}

export function isPositive(r: Rational): boolean {
  return r.numerator > 0n;
}

export function isNegative(r: Rational): boolean {
  return r.numerator < 0n;
}

/** Absolute value. */
export function abs(r: Rational): Rational {
  return r.numerator < 0n ? { numerator: -r.numerator, denominator: r.denominator } : r;
}
