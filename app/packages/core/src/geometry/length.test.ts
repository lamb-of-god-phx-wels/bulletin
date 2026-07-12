import { describe, expect, it } from "vitest";
import {
  IN_TO_PT,
  CM_TO_PT,
  MM_TO_PT,
  PX_TO_PT,
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
  cmpLengths,
  isZeroLength,
  lengthEquals,
  type AbsoluteLength,
  type Length,
} from "./length.js";
import {
  fromDecimalString,
  fromInt,
  rational,
  eq,
  toDecimalString,
  type Rational,
} from "./rational.js";

// ─── Conversion constants ────────────────────────────────────────────────────

describe("conversion constants", () => {
  it("1 in = 72 pt exactly", () => {
    expect(IN_TO_PT.numerator).toBe(72n);
    expect(IN_TO_PT.denominator).toBe(1n);
  });

  it("1 cm = 3600/127 pt exactly (72/2.54)", () => {
    expect(CM_TO_PT.numerator).toBe(3600n);
    expect(CM_TO_PT.denominator).toBe(127n);
  });

  it("1 mm = 360/127 pt exactly (72/25.4)", () => {
    expect(MM_TO_PT.numerator).toBe(360n);
    expect(MM_TO_PT.denominator).toBe(127n);
  });

  it("1 px = 3/4 pt exactly", () => {
    expect(PX_TO_PT.numerator).toBe(3n);
    expect(PX_TO_PT.denominator).toBe(4n);
  });

  // Spec mandates: "1in = 72pt = 25.4mm exactly"
  it("1 in = 25.4 mm (spec-mandated identity)", () => {
    const oneInchInPt = IN_TO_PT; // 72/1
    // 25.4 mm in pt = 25.4 * (360/127)
    // 25.4 = 127/5, so 127/5 * 360/127 = 360/5 = 72  ✓
    const twentyFourMmInPt = {
      numerator: fromDecimalString("25.4").numerator * MM_TO_PT.numerator,
      denominator: fromDecimalString("25.4").denominator * MM_TO_PT.denominator,
    };
    // Reduce to check equality
    const gcdVal = (a: bigint, b: bigint): bigint => {
      a = a < 0n ? -a : a;
      while (b !== 0n) { const t = b; b = a % b; a = t; }
      return a;
    };
    const g = gcdVal(twentyFourMmInPt.numerator, twentyFourMmInPt.denominator);
    expect(twentyFourMmInPt.numerator / g).toBe(oneInchInPt.numerator);
    expect(twentyFourMmInPt.denominator / g).toBe(oneInchInPt.denominator);
  });

  it("1 cm = 10 mm (in pt units, exact)", () => {
    // 1 cm = 3600/127 pt, 10 mm = 10 * 360/127 = 3600/127 pt
    const tenMmInPt = rational(10n * 360n, 127n);
    expect(tenMmInPt.numerator).toBe(CM_TO_PT.numerator);
    expect(tenMmInPt.denominator).toBe(CM_TO_PT.denominator);
  });
});

// ─── absoluteX constructors ───────────────────────────────────────────────────

describe("absoluteIn()", () => {
  it("converts 1 inch to 72 pt", () => {
    const l = absoluteIn(fromInt(1n));
    expect(l.pt.numerator).toBe(72n);
    expect(l.pt.denominator).toBe(1n);
  });

  it("converts 0.5 inch to 36 pt", () => {
    const l = absoluteIn(fromDecimalString("0.5"));
    expect(l.pt.numerator).toBe(36n);
    expect(l.pt.denominator).toBe(1n);
  });

  it("converts 8.5 inch exactly", () => {
    const l = absoluteIn(fromDecimalString("8.5"));
    // 8.5 * 72 = 612
    expect(l.pt.numerator).toBe(612n);
    expect(l.pt.denominator).toBe(1n);
  });

  it("converts 7 inch to 504 pt", () => {
    const l = absoluteIn(fromInt(7n));
    expect(l.pt.numerator).toBe(504n);
    expect(l.pt.denominator).toBe(1n);
  });
});

describe("absoluteMm()", () => {
  it("converts 25.4mm to 72 pt (= 1 inch)", () => {
    const l = absoluteMm(fromDecimalString("25.4"));
    // 25.4 = 127/5, so pt = 127/5 * 360/127 = 360/5 = 72
    expect(l.pt.numerator).toBe(72n);
    expect(l.pt.denominator).toBe(1n);
  });

  it("converts 1mm exactly", () => {
    const l = absoluteMm(fromInt(1n));
    expect(l.pt.numerator).toBe(360n);
    expect(l.pt.denominator).toBe(127n);
  });
});

describe("absoluteCm()", () => {
  it("converts 2.54cm to 72 pt (= 1 inch)", () => {
    const l = absoluteCm(fromDecimalString("2.54"));
    // 2.54 = 127/50, so pt = 127/50 * 3600/127 = 3600/50 = 72
    expect(l.pt.numerator).toBe(72n);
    expect(l.pt.denominator).toBe(1n);
  });

  it("converts 1cm exactly", () => {
    const l = absoluteCm(fromInt(1n));
    expect(l.pt.numerator).toBe(3600n);
    expect(l.pt.denominator).toBe(127n);
  });
});

describe("absolutePx()", () => {
  it("converts 1px to 0.75 pt (= 3/4 pt)", () => {
    const l = absolutePx(fromInt(1n));
    expect(l.pt.numerator).toBe(3n);
    expect(l.pt.denominator).toBe(4n);
  });

  it("converts 4px to 3 pt", () => {
    const l = absolutePx(fromInt(4n));
    expect(l.pt.numerator).toBe(3n);
    expect(l.pt.denominator).toBe(1n);
  });
});

// ─── parseLength ──────────────────────────────────────────────────────────────

describe("parseLength()", () => {
  describe("absolute units", () => {
    it("parses '72pt' as 72 pt", () => {
      const l = parseLength("72pt");
      expect(l.kind).toBe("absolute");
      expect((l as AbsoluteLength).pt.numerator).toBe(72n);
    });

    it("parses '1in' as 72 pt", () => {
      const l = parseLength("1in");
      expect(l.kind).toBe("absolute");
      expect((l as AbsoluteLength).pt.numerator).toBe(72n);
    });

    it("parses '25.4mm' as 72 pt", () => {
      const l = parseLength("25.4mm");
      expect(l.kind).toBe("absolute");
      expect((l as AbsoluteLength).pt.numerator).toBe(72n);
      expect((l as AbsoluteLength).pt.denominator).toBe(1n);
    });

    it("parses '2.54cm' as 72 pt", () => {
      const l = parseLength("2.54cm");
      expect(l.kind).toBe("absolute");
      expect((l as AbsoluteLength).pt.numerator).toBe(72n);
      expect((l as AbsoluteLength).pt.denominator).toBe(1n);
    });

    it("parses '4px' as 3 pt", () => {
      const l = parseLength("4px");
      expect(l.kind).toBe("absolute");
      expect((l as AbsoluteLength).pt.numerator).toBe(3n);
    });

    it("parses '0pt'", () => {
      const l = parseLength("0pt");
      expect(l.kind).toBe("absolute");
      expect((l as AbsoluteLength).pt.numerator).toBe(0n);
    });

    it("parses negative lengths: '-1in'", () => {
      const l = parseLength("-1in");
      expect(l.kind).toBe("absolute");
      expect((l as AbsoluteLength).pt.numerator).toBe(-72n);
    });

    it("parses '8.5in' exactly (page height)", () => {
      const l = parseLength("8.5in");
      expect(l.kind).toBe("absolute");
      expect((l as AbsoluteLength).pt.numerator).toBe(612n);
      expect((l as AbsoluteLength).pt.denominator).toBe(1n);
    });

    it("parses '5.5in' exactly (panel width preset)", () => {
      const l = parseLength("5.5in");
      expect(l.kind).toBe("absolute");
      expect((l as AbsoluteLength).pt.numerator).toBe(396n);
      expect((l as AbsoluteLength).pt.denominator).toBe(1n);
    });
  });

  describe("relative/special units", () => {
    it("parses '50%'", () => {
      const l = parseLength("50%");
      expect(l.kind).toBe("percent");
      if (l.kind === "percent") {
        // The raw percent number is stored (50, not 50/100=1/2).
        // Callers resolve: basis * (value / 100).
        expect(l.value.numerator).toBe(50n);
        expect(l.value.denominator).toBe(1n);
      }
    });

    it("parses '1fr'", () => {
      const l = parseLength("1fr");
      expect(l.kind).toBe("fr");
      if (l.kind === "fr") {
        expect(l.value.numerator).toBe(1n);
        expect(l.value.denominator).toBe(1n);
      }
    });

    it("parses '1.5em'", () => {
      const l = parseLength("1.5em");
      expect(l.kind).toBe("em");
      if (l.kind === "em") {
        expect(l.value.numerator).toBe(3n);
        expect(l.value.denominator).toBe(2n);
      }
    });

    it("parses 'auto'", () => {
      const l = parseLength("auto");
      expect(l.kind).toBe("auto");
    });
  });

  describe("error cases", () => {
    it("throws on plain number '72'", () => {
      expect(() => parseLength("72")).toThrow(SyntaxError);
    });

    it("throws on empty string", () => {
      expect(() => parseLength("")).toThrow(SyntaxError);
    });

    it("throws on unknown unit 'dp'", () => {
      expect(() => parseLength("100dp")).toThrow(SyntaxError);
    });
  });
});

// ─── toTypstPt ────────────────────────────────────────────────────────────────

describe("toTypstPt()", () => {
  it("formats 72pt as '72pt'", () => {
    expect(toTypstPt(absoluteIn(fromInt(1n)))).toBe("72pt");
  });

  it("strips trailing zeros: 36.000 → '36pt'", () => {
    expect(toTypstPt(absoluteIn(fromDecimalString("0.5")))).toBe("36pt");
  });

  it("formats 1mm as '2.835pt' (rounded to 0.001pt)", () => {
    // 1mm = 360/127 pt ≈ 2.834645669... → rounds to 2.835
    const l = absoluteMm(fromInt(1n));
    expect(toTypstPt(l)).toBe("2.835pt");
  });

  it("rounds 1/3 pt to 0.333pt", () => {
    const l = absolutePt(rational(1n, 3n));
    expect(toTypstPt(l)).toBe("0.333pt");
  });

  it("rounds 2/3 pt to 0.667pt", () => {
    const l = absolutePt(rational(2n, 3n));
    expect(toTypstPt(l)).toBe("0.667pt");
  });

  it("handles zero: returns '0pt'", () => {
    const l = absolutePt(fromInt(0n));
    expect(toTypstPt(l)).toBe("0pt");
  });

  it("handles negative zero (should normalize to '0pt')", () => {
    // A value that rounds to zero from the negative side
    const l = absolutePt(rational(-1n, 100000n)); // -0.00001, rounds to 0.000
    expect(toTypstPt(l)).toBe("0pt");
  });

  it("negative values: -72pt", () => {
    const l = absolutePt(fromInt(-72n));
    expect(toTypstPt(l)).toBe("-72pt");
  });

  it("rounds 0.0005pt → 0.001pt (tie away from zero)", () => {
    const l = absolutePt(rational(1n, 2000n)); // 1/2000 = 0.0005
    expect(toTypstPt(l)).toBe("0.001pt");
  });

  it("rounds -0.0005pt → -0.001pt (tie away from zero for negatives)", () => {
    const l = absolutePt(rational(-1n, 2000n));
    expect(toTypstPt(l)).toBe("-0.001pt");
  });

  // Spec: "strip trailing zeros"
  it("strips trailing zeros: 1.500 → '1.5pt'", () => {
    const l = absolutePt(rational(3n, 2n)); // 1.5 exactly
    expect(toTypstPt(l)).toBe("1.5pt");
  });

  it("no trailing zero for exact integers: '10pt'", () => {
    expect(toTypstPt(absolutePt(fromInt(10n)))).toBe("10pt");
  });
});

// ─── toInchString ─────────────────────────────────────────────────────────────

describe("toInchString()", () => {
  it("formats 1in as '1in'", () => {
    expect(toInchString(absoluteIn(fromInt(1n)))).toBe("1in");
  });

  it("formats 0.5in as '0.5in'", () => {
    expect(toInchString(absoluteIn(fromDecimalString("0.5")))).toBe("0.5in");
  });

  it("formats 8.5in as '8.5in'", () => {
    expect(toInchString(absoluteIn(fromDecimalString("8.5")))).toBe("8.5in");
  });

  it("formats 7in as '7in'", () => {
    expect(toInchString(absoluteIn(fromInt(7n)))).toBe("7in");
  });

  it("formats 0 as '0in'", () => {
    expect(toInchString(absolutePt(fromInt(0n)))).toBe("0in");
  });

  it("1mm in inches: strips trailing zeros, max 6 digits", () => {
    // 1mm = 360/127 pt = (360/127)/72 in = 360/(127*72) = 5/127 ≈ 0.039370...
    const s = toInchString(absoluteMm(fromInt(1n)));
    expect(s).toMatch(/^-?\d+\.\d{1,6}in$/);
    // Must not exceed 6 decimal places
    const digits = s.replace("in", "").split(".")[1] ?? "";
    expect(digits.length).toBeLessThanOrEqual(6);
    // Must not have trailing zeros
    expect(digits.endsWith("0")).toBe(false);
  });
});

// ─── Round-trip parsing/printing ─────────────────────────────────────────────

describe("parse/print round-trips", () => {
  it("'8.5in' round-trips through parseLength → toInchString", () => {
    const l = parseLength("8.5in");
    expect(l.kind).toBe("absolute");
    expect(toInchString(l as AbsoluteLength)).toBe("8.5in");
  });

  it("'1in' round-trips", () => {
    const l = parseLength("1in");
    expect(toInchString(l as AbsoluteLength)).toBe("1in");
  });

  it("'72pt' round-trips through parseLength → toTypstPt", () => {
    const l = parseLength("72pt");
    expect(toTypstPt(l as AbsoluteLength)).toBe("72pt");
  });

  // Spec: "repeated open/save/build cycles must not introduce conversion drift"
  it("repeated inch→pt→inch conversion is stable (no drift)", () => {
    const original = "3.141592in";
    const l = parseLength(original);
    const roundTrip1 = toInchString(l as AbsoluteLength);
    const l2 = parseLength(roundTrip1);
    const roundTrip2 = toInchString(l2 as AbsoluteLength);
    // Second round-trip must equal the first (stable)
    expect(roundTrip2).toBe(roundTrip1);
  });

  it("1in → mm → pt is exact identity with direct 72pt", () => {
    // 1in = 25.4mm, 25.4mm in pt = 25.4 * 360/127 = 127/5 * 360/127 = 360/5 = 72
    const via_mm = absoluteMm(fromDecimalString("25.4"));
    const direct = absoluteIn(fromInt(1n));
    expect(cmpLengths(via_mm, direct)).toBe(0);
  });

  it("1in → cm → pt is exact identity with direct 72pt", () => {
    const via_cm = absoluteCm(fromDecimalString("2.54"));
    const direct = absoluteIn(fromInt(1n));
    expect(cmpLengths(via_cm, direct)).toBe(0);
  });
});

// ─── Arithmetic ───────────────────────────────────────────────────────────────

describe("length arithmetic", () => {
  it("addLengths: 1in + 1in = 2in (144pt)", () => {
    const sum = addLengths(absoluteIn(fromInt(1n)), absoluteIn(fromInt(1n)));
    expect(sum.pt.numerator).toBe(144n);
    expect(sum.pt.denominator).toBe(1n);
  });

  it("subLengths: 2in - 1in = 1in (72pt)", () => {
    const diff = subLengths(absoluteIn(fromInt(2n)), absoluteIn(fromInt(1n)));
    expect(diff.pt.numerator).toBe(72n);
    expect(diff.pt.denominator).toBe(1n);
  });

  it("subLengths: 1in - 1in = 0", () => {
    const diff = subLengths(absoluteIn(fromInt(1n)), absoluteIn(fromInt(1n)));
    expect(isZeroLength(diff)).toBe(true);
  });

  it("cmpLengths: 1in < 2in", () => {
    expect(cmpLengths(absoluteIn(fromInt(1n)), absoluteIn(fromInt(2n)))).toBe(-1);
  });

  it("cmpLengths: 1in = 72pt", () => {
    expect(cmpLengths(absoluteIn(fromInt(1n)), absolutePt(fromInt(72n)))).toBe(0);
  });
});

// ─── lengthEquals ────────────────────────────────────────────────────────────

describe("lengthEquals()", () => {
  it("equal absolute lengths", () => {
    expect(lengthEquals(absolutePt(fromInt(72n)), absoluteIn(fromInt(1n)))).toBe(true);
  });

  it("unequal absolute lengths", () => {
    expect(lengthEquals(absolutePt(fromInt(71n)), absolutePt(fromInt(72n)))).toBe(false);
  });

  it("different kinds are not equal", () => {
    expect(lengthEquals(AUTO_LENGTH, absolutePt(fromInt(0n)))).toBe(false);
  });

  it("two auto lengths are equal", () => {
    expect(lengthEquals(AUTO_LENGTH, AUTO_LENGTH)).toBe(true);
  });

  it("percent lengths: same value equal", () => {
    expect(lengthEquals(parseLength("50%"), parseLength("50%"))).toBe(true);
  });

  it("percent lengths: different values not equal", () => {
    expect(lengthEquals(parseLength("50%"), parseLength("25%"))).toBe(false);
  });
});

// ─── roundToTypstPrecision ───────────────────────────────────────────────────

describe("roundToTypstPrecision()", () => {
  it("rounds 1/3 to 0.333", () => {
    const r = roundToTypstPrecision(absolutePt(rational(1n, 3n)));
    expect(toDecimalString(r.pt, 3)).toBe("0.333");
  });

  it("rounds 2/3 to 0.667", () => {
    const r = roundToTypstPrecision(absolutePt(rational(2n, 3n)));
    expect(toDecimalString(r.pt, 3)).toBe("0.667");
  });

  it("rounds 1/2 to 0.500 (3 decimal places)", () => {
    const r = roundToTypstPrecision(absolutePt(rational(1n, 2n)));
    expect(toDecimalString(r.pt, 3)).toBe("0.500");
  });

  it("rounds 0 to 0.000", () => {
    const r = roundToTypstPrecision(absolutePt(rational(0n, 1n)));
    expect(toDecimalString(r.pt, 3)).toBe("0.000");
  });

  it("type check: result pt field is a Rational and eq works", () => {
    const r = roundToTypstPrecision(absolutePt(rational(1n, 4n)));
    // 1/4 = 0.25 exactly — no rounding needed
    const pt: Rational = r.pt;
    expect(eq(pt, rational(1n, 4n))).toBe(true);
  });
});

// ─── Length type usage ───────────────────────────────────────────────────────

describe("Length type", () => {
  it("auto length satisfies the Length type", () => {
    const l: Length = AUTO_LENGTH;
    expect(l.kind).toBe("auto");
  });

  it("absolute length satisfies the Length type", () => {
    const l: Length = absolutePt(fromInt(72n));
    expect(l.kind).toBe("absolute");
  });
});
