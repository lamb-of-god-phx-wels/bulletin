import { describe, expect, it } from "vitest";
import {
  type Rational,
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Assert a Rational is in fully-reduced canonical form. */
function assertCanonical(r: Rational, label: string): void {
  expect(r.denominator, `${label}: denominator must be > 0`).toBeGreaterThan(0n);
  if (r.numerator === 0n) {
    expect(r.denominator, `${label}: zero must have denominator 1`).toBe(1n);
    return;
  }
  // GCD of |numerator| and denominator must be 1
  const a = r.numerator < 0n ? -r.numerator : r.numerator;
  let x = a;
  let y = r.denominator;
  while (y !== 0n) {
    const t = y;
    y = x % y;
    x = t;
  }
  expect(x, `${label}: numerator/denominator must be coprime`).toBe(1n);
}

function r(n: bigint, d: bigint): Rational {
  return rational(n, d);
}

// ─── Construction / normalization ─────────────────────────────────────────────

describe("rational() constructor", () => {
  it("reduces 6/4 to 3/2", () => {
    const v = r(6n, 4n);
    expect(v.numerator).toBe(3n);
    expect(v.denominator).toBe(2n);
    assertCanonical(v, "6/4");
  });

  it("keeps 3/2 as-is", () => {
    const v = r(3n, 2n);
    expect(v.numerator).toBe(3n);
    expect(v.denominator).toBe(2n);
  });

  it("normalizes zero to 0/1 regardless of denominator", () => {
    const v = r(0n, 99n);
    expect(v.numerator).toBe(0n);
    expect(v.denominator).toBe(1n);
  });

  it("normalizes negative denominator: -3/-2 → 3/2", () => {
    const v = r(-3n, -2n);
    expect(v.numerator).toBe(3n);
    expect(v.denominator).toBe(2n);
  });

  it("normalizes 3/-2 → -3/2", () => {
    const v = r(3n, -2n);
    expect(v.numerator).toBe(-3n);
    expect(v.denominator).toBe(2n);
  });

  it("throws on zero denominator", () => {
    expect(() => r(1n, 0n)).toThrow(RangeError);
  });

  it("produces canonical forms for various inputs", () => {
    const cases: [bigint, bigint][] = [
      [12n, 8n],
      [-12n, 8n],
      [12n, -8n],
      [-12n, -8n],
      [100n, 25n],
      [1n, 1000000n],
      [7200n, 254n], // in→pt cm conversion
      [360n, 127n],  // mm→pt
    ];
    for (const [n, d] of cases) {
      assertCanonical(r(n, d), `${n}/${d}`);
    }
  });
});

describe("fromInt()", () => {
  it("wraps an integer as n/1", () => {
    const v = fromInt(5n);
    expect(v.numerator).toBe(5n);
    expect(v.denominator).toBe(1n);
  });

  it("handles zero", () => {
    expect(fromInt(0n)).toEqual({ numerator: 0n, denominator: 1n });
  });

  it("accepts JS number (integer)", () => {
    const v = fromInt(42);
    expect(v.numerator).toBe(42n);
    expect(v.denominator).toBe(1n);
  });

  it("accepts negative", () => {
    const v = fromInt(-7n);
    expect(v.numerator).toBe(-7n);
    expect(v.denominator).toBe(1n);
  });
});

// ─── fromDecimalString ────────────────────────────────────────────────────────

describe("fromDecimalString()", () => {
  it("parses '3'", () => {
    expect(fromDecimalString("3")).toEqual({ numerator: 3n, denominator: 1n });
  });

  it("parses '3.14'", () => {
    const v = fromDecimalString("3.14");
    expect(v.numerator).toBe(157n);   // 314/100 = 157/50
    expect(v.denominator).toBe(50n);
    assertCanonical(v, "3.14");
  });

  it("parses '-0.001'", () => {
    const v = fromDecimalString("-0.001");
    expect(v.numerator).toBe(-1n);
    expect(v.denominator).toBe(1000n);
    assertCanonical(v, "-0.001");
  });

  it("parses '0'", () => {
    expect(fromDecimalString("0")).toEqual({ numerator: 0n, denominator: 1n });
  });

  it("parses '0.0'", () => {
    expect(fromDecimalString("0.0")).toEqual({ numerator: 0n, denominator: 1n });
  });

  it("parses '+1.5'", () => {
    const v = fromDecimalString("+1.5");
    expect(v.numerator).toBe(3n);
    expect(v.denominator).toBe(2n);
  });

  it("parses '5.5' exactly (used in page presets)", () => {
    const v = fromDecimalString("5.5");
    expect(v.numerator).toBe(11n);
    expect(v.denominator).toBe(2n);
    assertCanonical(v, "5.5");
  });

  it("parses '8.5' exactly", () => {
    const v = fromDecimalString("8.5");
    expect(v.numerator).toBe(17n);
    expect(v.denominator).toBe(2n);
  });

  it("parses '2.54' exactly (cm-to-inch denominator)", () => {
    const v = fromDecimalString("2.54");
    expect(v.numerator).toBe(127n);
    expect(v.denominator).toBe(50n);
    assertCanonical(v, "2.54");
  });

  it("parses '25.4' exactly (mm-to-inch denominator)", () => {
    const v = fromDecimalString("25.4");
    expect(v.numerator).toBe(127n);
    expect(v.denominator).toBe(5n);
    assertCanonical(v, "25.4");
  });

  it("handles leading/trailing whitespace", () => {
    expect(fromDecimalString("  3.14  ")).toEqual(fromDecimalString("3.14"));
  });

  it("throws on empty string", () => {
    expect(() => fromDecimalString("")).toThrow(SyntaxError);
  });

  it("throws on '1e5' (no scientific notation)", () => {
    expect(() => fromDecimalString("1e5")).toThrow(SyntaxError);
  });

  it("throws on '1.2.3'", () => {
    expect(() => fromDecimalString("1.2.3")).toThrow(SyntaxError);
  });

  it("throws on 'abc'", () => {
    expect(() => fromDecimalString("abc")).toThrow(SyntaxError);
  });

  it("throws on trailing-dot form '1.' (no digits after decimal point)", () => {
    // Grammar requires at least one digit on both sides when '.' is present.
    expect(() => fromDecimalString("1.")).toThrow(SyntaxError);
  });

  it("throws on leading-dot form '.5' (no digits before decimal point)", () => {
    // Grammar requires at least one digit before the decimal point.
    expect(() => fromDecimalString(".5")).toThrow(SyntaxError);
  });

  it("throws on '-.5' (leading-dot with sign)", () => {
    expect(() => fromDecimalString("-.5")).toThrow(SyntaxError);
  });

  it("throws on '+.' (sign and dot only)", () => {
    expect(() => fromDecimalString("+.")).toThrow(SyntaxError);
  });
});

// ─── toDecimalString ──────────────────────────────────────────────────────────

describe("toDecimalString()", () => {
  it("formats an integer with 0 fractionDigits", () => {
    expect(toDecimalString(fromInt(5n), 0)).toBe("5");
  });

  it("formats 1/3 to 2 decimal places (rounds down: 0.33)", () => {
    expect(toDecimalString(r(1n, 3n), 2)).toBe("0.33");
  });

  it("formats 2/3 to 2 decimal places (rounds up: 0.67)", () => {
    expect(toDecimalString(r(2n, 3n), 2)).toBe("0.67");
  });

  it("rounds half away from zero: 0.5 → 1 (0 digits)", () => {
    expect(toDecimalString(r(1n, 2n), 0)).toBe("1");
  });

  it("rounds half away from zero: -0.5 → -1 (0 digits)", () => {
    expect(toDecimalString(r(-1n, 2n), 0)).toBe("-1");
  });

  it("rounds 0.005 to 2 decimal places → '0.01' (half away from zero)", () => {
    expect(toDecimalString(fromDecimalString("0.005"), 2)).toBe("0.01");
  });

  it("rounds -0.005 to 2 decimal places → '-0.01' (half away from zero)", () => {
    expect(toDecimalString(fromDecimalString("-0.005"), 2)).toBe("-0.01");
  });

  it("formats zero as '0'", () => {
    expect(toDecimalString(fromInt(0n), 0)).toBe("0");
  });

  it("formats zero with fraction digits as '0.000'", () => {
    expect(toDecimalString(fromInt(0n), 3)).toBe("0.000");
  });

  it("formats 1/1000 to 3 decimal places as '0.001'", () => {
    expect(toDecimalString(r(1n, 1000n), 3)).toBe("0.001");
  });

  it("formats 1/2000 to 3 decimal places → '0.001' (tie rounds up)", () => {
    // 1/2000 = 0.0005, which at 3 dp is at the half-point between 0.000 and 0.001
    // half-away-from-zero rounds up
    expect(toDecimalString(r(1n, 2000n), 3)).toBe("0.001");
  });

  it("formats -1/2000 to 3 decimal places → '-0.001' (tie rounds away from zero)", () => {
    expect(toDecimalString(r(-1n, 2000n), 3)).toBe("-0.001");
  });

  it("does not produce negative zero (-0/1)", () => {
    // If something rounds to zero from the negative side, must output '0.000'
    // not '-0.000'. toDecimalString always produces exactly fractionDigits digits;
    // trailing-zero stripping happens at the length-emission layer.
    expect(toDecimalString(r(-1n, 100000n), 3)).toBe("0.000");
  });

  it("round-trips 3.14 at 2 decimal places", () => {
    expect(toDecimalString(fromDecimalString("3.14"), 2)).toBe("3.14");
  });

  it("round-trips exact negative values", () => {
    expect(toDecimalString(fromDecimalString("-2.5"), 1)).toBe("-2.5");
  });

  it("throws on negative fractionDigits", () => {
    expect(() => toDecimalString(fromInt(1n), -1)).toThrow(RangeError);
  });

  it("throws on non-integer fractionDigits", () => {
    expect(() => toDecimalString(fromInt(1n), 1.5)).toThrow(RangeError);
  });

  it("formats large values", () => {
    expect(toDecimalString(fromInt(1000000n), 0)).toBe("1000000");
  });

  it("output always round-trips through fromDecimalString (no trailing-dot form emitted)", () => {
    // toDecimalString must never produce '1.' or '.5' forms.
    // Test several values with fractionDigits>0 to confirm trailing zeros are kept.
    const cases: [bigint, bigint, number][] = [
      [1n, 1n, 2],       // "1.00"
      [1n, 2n, 1],       // "0.5"
      [1n, 3n, 3],       // "0.333"
      [100n, 1n, 0],     // "100"
      [0n, 1n, 2],       // "0.00"
    ];
    for (const [n, d, fd] of cases) {
      const r = rational(n, d);
      const s = toDecimalString(r, fd);
      // Must parse without throwing.
      expect(() => fromDecimalString(s), `round-trip failed for ${n}/${d} at ${fd} digits, got "${s}"`).not.toThrow();
    }
  });
});

// ─── Arithmetic ───────────────────────────────────────────────────────────────

describe("add()", () => {
  it("1/2 + 1/3 = 5/6", () => {
    const v = add(r(1n, 2n), r(1n, 3n));
    expect(v).toEqual(r(5n, 6n));
    assertCanonical(v, "1/2+1/3");
  });

  it("1/3 + 2/3 = 1", () => {
    expect(add(r(1n, 3n), r(2n, 3n))).toEqual(fromInt(1n));
  });

  it("negative + positive", () => {
    expect(add(r(-3n, 4n), r(1n, 4n))).toEqual(r(-1n, 2n));
  });

  it("commutative", () => {
    const a = r(3n, 7n);
    const b = r(5n, 11n);
    expect(add(a, b)).toEqual(add(b, a));
  });
});

describe("sub()", () => {
  it("3/4 - 1/4 = 1/2", () => {
    expect(sub(r(3n, 4n), r(1n, 4n))).toEqual(r(1n, 2n));
  });

  it("1/3 - 1/3 = 0", () => {
    expect(sub(r(1n, 3n), r(1n, 3n))).toEqual(fromInt(0n));
  });

  it("a - b = -(b - a)", () => {
    const a = r(2n, 5n);
    const b = r(3n, 7n);
    expect(sub(a, b)).toEqual(neg(sub(b, a)));
  });
});

describe("mul()", () => {
  it("2/3 * 3/4 = 1/2", () => {
    expect(mul(r(2n, 3n), r(3n, 4n))).toEqual(r(1n, 2n));
    assertCanonical(mul(r(2n, 3n), r(3n, 4n)), "2/3*3/4");
  });

  it("product with zero is zero", () => {
    expect(mul(r(99n, 100n), fromInt(0n))).toEqual(fromInt(0n));
  });

  it("product with 1 is identity", () => {
    const v = r(7n, 13n);
    expect(mul(v, fromInt(1n))).toEqual(v);
  });
});

describe("div()", () => {
  it("3/4 ÷ 3/2 = 1/2", () => {
    expect(div(r(3n, 4n), r(3n, 2n))).toEqual(r(1n, 2n));
  });

  it("throws on division by zero", () => {
    expect(() => div(r(1n, 2n), fromInt(0n))).toThrow(RangeError);
  });

  it("a / 1 = a", () => {
    const v = r(7n, 13n);
    expect(div(v, fromInt(1n))).toEqual(v);
  });
});

describe("neg()", () => {
  it("negates positive", () => {
    expect(neg(r(3n, 4n))).toEqual(r(-3n, 4n));
  });

  it("negates negative", () => {
    expect(neg(r(-3n, 4n))).toEqual(r(3n, 4n));
  });

  it("double negation is identity", () => {
    const v = r(5n, 7n);
    expect(neg(neg(v))).toEqual(v);
  });

  it("negation of zero is zero", () => {
    expect(neg(fromInt(0n))).toEqual(fromInt(0n));
  });
});

describe("abs()", () => {
  it("absolute value of positive is identity", () => {
    const v = r(3n, 4n);
    expect(abs(v)).toEqual(v);
  });

  it("absolute value of negative is positive", () => {
    expect(abs(r(-3n, 4n))).toEqual(r(3n, 4n));
  });

  it("absolute value of zero is zero", () => {
    expect(abs(fromInt(0n))).toEqual(fromInt(0n));
  });
});

// ─── Comparison ───────────────────────────────────────────────────────────────

describe("cmp()", () => {
  it("1/2 < 2/3", () => {
    expect(cmp(r(1n, 2n), r(2n, 3n))).toBe(-1);
  });

  it("2/3 > 1/2", () => {
    expect(cmp(r(2n, 3n), r(1n, 2n))).toBe(1);
  });

  it("equal values return 0", () => {
    expect(cmp(r(2n, 4n), r(1n, 2n))).toBe(0);
  });

  it("negative vs positive", () => {
    expect(cmp(r(-1n, 2n), r(1n, 2n))).toBe(-1);
  });

  it("negative vs negative", () => {
    expect(cmp(r(-3n, 4n), r(-1n, 2n))).toBe(-1); // -3/4 < -1/2
  });
});

describe("eq/lt/lte/gt/gte", () => {
  const a = r(1n, 3n);
  const b = r(2n, 6n); // same as a
  const c = r(2n, 3n);

  it("eq", () => {
    expect(eq(a, b)).toBe(true);
    expect(eq(a, c)).toBe(false);
  });

  it("lt", () => {
    expect(lt(a, c)).toBe(true);
    expect(lt(c, a)).toBe(false);
    expect(lt(a, b)).toBe(false);
  });

  it("lte", () => {
    expect(lte(a, c)).toBe(true);
    expect(lte(a, b)).toBe(true);
    expect(lte(c, a)).toBe(false);
  });

  it("gt", () => {
    expect(gt(c, a)).toBe(true);
    expect(gt(a, c)).toBe(false);
  });

  it("gte", () => {
    expect(gte(c, a)).toBe(true);
    expect(gte(b, a)).toBe(true);
    expect(gte(a, c)).toBe(false);
  });
});

describe("min() / max()", () => {
  it("min returns smaller", () => {
    expect(min(r(1n, 3n), r(2n, 3n))).toEqual(r(1n, 3n));
  });

  it("max returns larger", () => {
    expect(max(r(1n, 3n), r(2n, 3n))).toEqual(r(2n, 3n));
  });

  it("min of equal returns first", () => {
    const a = r(1n, 2n);
    const b = r(2n, 4n);
    expect(min(a, b)).toBe(a);
  });
});

describe("isZero / isPositive / isNegative", () => {
  it("isZero", () => {
    expect(isZero(fromInt(0n))).toBe(true);
    expect(isZero(fromInt(1n))).toBe(false);
  });

  it("isPositive", () => {
    expect(isPositive(r(1n, 2n))).toBe(true);
    expect(isPositive(fromInt(0n))).toBe(false);
    expect(isPositive(r(-1n, 2n))).toBe(false);
  });

  it("isNegative", () => {
    expect(isNegative(r(-1n, 2n))).toBe(true);
    expect(isNegative(fromInt(0n))).toBe(false);
    expect(isNegative(r(1n, 2n))).toBe(false);
  });
});

// ─── Algebraic properties ─────────────────────────────────────────────────────

describe("algebraic properties", () => {
  const a = r(3n, 7n);
  const b = r(5n, 11n);
  const c = r(2n, 13n);

  it("addition is associative: (a+b)+c === a+(b+c)", () => {
    expect(add(add(a, b), c)).toEqual(add(a, add(b, c)));
  });

  it("multiplication is associative", () => {
    expect(mul(mul(a, b), c)).toEqual(mul(a, mul(b, c)));
  });

  it("distributive law: a*(b+c) = a*b + a*c", () => {
    expect(mul(a, add(b, c))).toEqual(add(mul(a, b), mul(a, c)));
  });

  it("a - b = a + (-b)", () => {
    expect(sub(a, b)).toEqual(add(a, neg(b)));
  });

  it("a / b = a * (1/b)", () => {
    expect(div(a, b)).toEqual(mul(a, div(fromInt(1n), b)));
  });
});

// ─── No floating point ────────────────────────────────────────────────────────

describe("no floating-point arithmetic", () => {
  it("1/3 is represented exactly without loss", () => {
    const v = r(1n, 3n);
    // If we multiply by 3, we should get exactly 1
    expect(mul(v, fromInt(3n))).toEqual(fromInt(1n));
  });

  it("72/25.4 = 360/127 exactly (mm to pt conversion)", () => {
    // 72 / 25.4 = 72 / (127/5) = 72*5/127 = 360/127
    const mmToPt = div(fromInt(72n), fromDecimalString("25.4"));
    expect(mmToPt.numerator).toBe(360n);
    expect(mmToPt.denominator).toBe(127n);
  });

  it("72/2.54 = 3600/127 exactly (cm to pt conversion)", () => {
    const cmToPt = div(fromInt(72n), fromDecimalString("2.54"));
    expect(cmToPt.numerator).toBe(3600n);
    expect(cmToPt.denominator).toBe(127n);
  });
});
