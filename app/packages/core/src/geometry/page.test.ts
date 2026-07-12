import { describe, expect, it } from "vitest";
import {
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
  type FixedMargins,
  type MirroredMargins,
  type BookletPrintSetup,
  type FinalPageCountRequirement,
} from "./page.js";
import {
  absoluteIn,
  absolutePt,
  cmpLengths,
  type AbsoluteLength,
} from "./length.js";
import { fromDecimalString, fromInt, rational } from "./rational.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function inches(s: string): AbsoluteLength {
  return absoluteIn(fromDecimalString(s));
}

function zeroMargins(): FixedMargins {
  const zero = absolutePt(fromInt(0n));
  return { mode: "fixed", top: zero, right: zero, bottom: zero, left: zero };
}

// ─── Page presets ─────────────────────────────────────────────────────────────

describe("page presets", () => {
  it("PRESET_FOLDED_5_5_X_8_5: width = 5.5in = 396pt", () => {
    expect(PRESET_FOLDED_5_5_X_8_5.width.pt.numerator).toBe(396n);
    expect(PRESET_FOLDED_5_5_X_8_5.width.pt.denominator).toBe(1n);
  });

  it("PRESET_FOLDED_5_5_X_8_5: height = 8.5in = 612pt", () => {
    expect(PRESET_FOLDED_5_5_X_8_5.height.pt.numerator).toBe(612n);
    expect(PRESET_FOLDED_5_5_X_8_5.height.pt.denominator).toBe(1n);
  });

  it("PRESET_FOLDED_7_X_8_5: width = 7in = 504pt", () => {
    expect(PRESET_FOLDED_7_X_8_5.width.pt.numerator).toBe(504n);
    expect(PRESET_FOLDED_7_X_8_5.width.pt.denominator).toBe(1n);
  });

  it("PRESET_FOLDED_7_X_8_5: height = 8.5in = 612pt", () => {
    expect(PRESET_FOLDED_7_X_8_5.height.pt.numerator).toBe(612n);
  });

  it("LEGACY_FALLBACK_PAGE matches PRESET_FOLDED_7_X_8_5", () => {
    expect(cmpLengths(LEGACY_FALLBACK_PAGE.width, PRESET_FOLDED_7_X_8_5.width)).toBe(0);
    expect(cmpLengths(LEGACY_FALLBACK_PAGE.height, PRESET_FOLDED_7_X_8_5.height)).toBe(0);
  });
});

// ─── Editor pixel conversion ──────────────────────────────────────────────────

describe("lengthToEditorPixels()", () => {
  it("1in = 96px (spec: 96px per inch)", () => {
    expect(lengthToEditorPixels(inches("1"))).toBe(96n);
  });

  it("7in = 672px (spec example)", () => {
    // spec: "7in by 8.5in projects to 672 by 816 pixels"
    expect(lengthToEditorPixels(inches("7"))).toBe(672n);
  });

  it("8.5in = 816px (spec example)", () => {
    expect(lengthToEditorPixels(inches("8.5"))).toBe(816n);
  });

  it("5.5in = 528px", () => {
    expect(lengthToEditorPixels(inches("5.5"))).toBe(528n);
  });

  it("0in = 0px", () => {
    expect(lengthToEditorPixels(absolutePt(fromInt(0n)))).toBe(0n);
  });

  it("uses exact arithmetic: 1pt = 4/3 px → 3pt = 4px", () => {
    expect(lengthToEditorPixels(absolutePt(fromInt(3n)))).toBe(4n);
  });

  it("rounds half-away-from-zero: 1pt = 4/3 px ≈ 1.33px → rounds to 1", () => {
    // 1pt = 4/3 px ≈ 1.333…  half-away-from-zero rounds to 1
    expect(lengthToEditorPixels(absolutePt(fromInt(1n)))).toBe(1n);
  });

  it("rounds half-away-from-zero: 0.51in = 48.96px → rounds to 49", () => {
    // 0.51in = 0.51 * 72pt = 36.72pt; 36.72 * 4/3 = 48.96px → 49px
    const half = absoluteIn(fromDecimalString("0.51"));
    expect(lengthToEditorPixels(half)).toBe(49n);
  });

  it("EDITOR_PX_PER_INCH is 96 (bigint)", () => {
    expect(EDITOR_PX_PER_INCH).toBe(96n);
  });
});

// ─── Mirrored margin resolution ───────────────────────────────────────────────

describe("resolveMirroredMargins()", () => {
  const margins: MirroredMargins = {
    mode: "mirrored",
    top: inches("0.5"),
    bottom: inches("0.5"),
    inner: inches("1"),
    outer: inches("0.75"),
  };

  it("binding=left, odd page: inner=left, outer=right", () => {
    const fixed = resolveMirroredMargins(margins, "left", "odd");
    expect(cmpLengths(fixed.left, inches("1"))).toBe(0);
    expect(cmpLengths(fixed.right, inches("0.75"))).toBe(0);
  });

  it("binding=left, even page: inner=right, outer=left", () => {
    const fixed = resolveMirroredMargins(margins, "left", "even");
    expect(cmpLengths(fixed.right, inches("1"))).toBe(0);
    expect(cmpLengths(fixed.left, inches("0.75"))).toBe(0);
  });

  it("binding=right, odd page: inner=right, outer=left", () => {
    const fixed = resolveMirroredMargins(margins, "right", "odd");
    expect(cmpLengths(fixed.right, inches("1"))).toBe(0);
    expect(cmpLengths(fixed.left, inches("0.75"))).toBe(0);
  });

  it("binding=right, even page: inner=left, outer=right", () => {
    const fixed = resolveMirroredMargins(margins, "right", "even");
    expect(cmpLengths(fixed.left, inches("1"))).toBe(0);
    expect(cmpLengths(fixed.right, inches("0.75"))).toBe(0);
  });

  it("top/bottom are unchanged in all cases", () => {
    const fixed = resolveMirroredMargins(margins, "left", "odd");
    expect(cmpLengths(fixed.top, inches("0.5"))).toBe(0);
    expect(cmpLengths(fixed.bottom, inches("0.5"))).toBe(0);
  });
});

// ─── Content box computation ──────────────────────────────────────────────────

describe("computeContentBox()", () => {
  it("7in × 8.5in with 0.5in margins all sides", () => {
    // content width = 7 - 0.5 - 0.5 = 6in
    // content height = 8.5 - 0.5 - 0.5 = 7.5in
    const half = inches("0.5");
    const margins: FixedMargins = {
      mode: "fixed",
      top: half,
      right: half,
      bottom: half,
      left: half,
    };
    const box = computeContentBox(inches("7"), inches("8.5"), margins);
    expect(cmpLengths(box.width, inches("6"))).toBe(0);
    expect(cmpLengths(box.height, inches("7.5"))).toBe(0);
  });

  it("asymmetric margins", () => {
    // page 8.5in × 11in, margins top=1in, bottom=1in, left=1.25in, right=1in
    // content width = 8.5 - 1.25 - 1 = 6.25in
    // content height = 11 - 1 - 1 = 9in
    const margins: FixedMargins = {
      mode: "fixed",
      top: inches("1"),
      right: inches("1"),
      bottom: inches("1"),
      left: inches("1.25"),
    };
    const box = computeContentBox(inches("8.5"), inches("11"), margins);
    expect(cmpLengths(box.width, inches("6.25"))).toBe(0);
    expect(cmpLengths(box.height, inches("9"))).toBe(0);
  });

  it("zero margins: content box equals page dimensions", () => {
    const box = computeContentBox(inches("7"), inches("8.5"), zeroMargins());
    expect(cmpLengths(box.width, inches("7"))).toBe(0);
    expect(cmpLengths(box.height, inches("8.5"))).toBe(0);
  });

  it("throws when content width would be zero", () => {
    const margins: FixedMargins = {
      mode: "fixed",
      top: inches("0"),
      right: inches("3.5"),
      bottom: inches("0"),
      left: inches("3.5"),
    };
    expect(() => computeContentBox(inches("7"), inches("8.5"), margins)).toThrow(RangeError);
  });

  it("throws when content width would be negative", () => {
    const margins: FixedMargins = {
      mode: "fixed",
      top: inches("0"),
      right: inches("4"),
      bottom: inches("0"),
      left: inches("4"),
    };
    expect(() => computeContentBox(inches("7"), inches("8.5"), margins)).toThrow(RangeError);
  });

  it("throws when content height would be zero", () => {
    const margins: FixedMargins = {
      mode: "fixed",
      top: inches("4.25"),
      right: inches("0"),
      bottom: inches("4.25"),
      left: inches("0"),
    };
    expect(() => computeContentBox(inches("7"), inches("8.5"), margins)).toThrow(RangeError);
  });

  it("exact arithmetic: content width is exact rational", () => {
    // 5.5in page, 1/3in margins each side
    // content = 5.5 - 1/3 - 1/3 = 11/2 - 2/3 = 33/6 - 4/6 = 29/6 in
    // in pt: 29/6 * 72 = 29 * 12 = 348pt  (exact!)
    const thirdIn = absoluteIn(rational(1n, 3n));
    const margins: FixedMargins = {
      mode: "fixed",
      top: inches("0"),
      right: thirdIn,
      bottom: inches("0"),
      left: thirdIn,
    };
    const box = computeContentBox(inches("5.5"), inches("8.5"), margins);
    // 348pt exactly
    expect(box.width.pt.numerator).toBe(348n);
    expect(box.width.pt.denominator).toBe(1n);
  });
});

describe("computeContentBoxMirrored()", () => {
  it("produces same result as resolveMirroredMargins + computeContentBox", () => {
    const margins: MirroredMargins = {
      mode: "mirrored",
      top: inches("0.5"),
      bottom: inches("0.5"),
      inner: inches("1"),
      outer: inches("0.75"),
    };
    const direct = computeContentBoxMirrored(
      inches("7"), inches("8.5"), margins, "left", "odd",
    );
    const fixed = resolveMirroredMargins(margins, "left", "odd");
    const indirect = computeContentBox(inches("7"), inches("8.5"), fixed);
    expect(cmpLengths(direct.width, indirect.width)).toBe(0);
    expect(cmpLengths(direct.height, indirect.height)).toBe(0);
  });
});

// ─── parsePageSize ────────────────────────────────────────────────────────────

describe("parsePageSize()", () => {
  it("parses '8.5in' × '11in'", () => {
    const size = parsePageSize("8.5in", "11in");
    expect(cmpLengths(size.width, inches("8.5"))).toBe(0);
    expect(cmpLengths(size.height, inches("11"))).toBe(0);
  });

  it("parses '612pt' × '792pt' (letter in pt)", () => {
    const size = parsePageSize("612pt", "792pt");
    expect(size.width.pt.numerator).toBe(612n);
    expect(size.height.pt.numerator).toBe(792n);
  });

  it("throws on non-absolute width ('auto')", () => {
    expect(() => parsePageSize("auto", "11in")).toThrow(TypeError);
  });

  it("throws on non-absolute height ('50%')", () => {
    expect(() => parsePageSize("8.5in", "50%")).toThrow(TypeError);
  });
});

// ─── validateBookletPrintSetup ────────────────────────────────────────────────

describe("validateBookletPrintSetup()", () => {
  function makeSetup(
    overrides: Partial<BookletPrintSetup> = {},
  ): BookletPrintSetup {
    return {
      sheetWidth: inches("11"),
      sheetHeight: inches("8.5"),
      duplexFlip: "shortEdge",
      scale: fromInt(1n),
      safeInset: {
        top: inches("0.25"),
        right: inches("0.25"),
        bottom: inches("0.25"),
        left: inches("0.25"),
        fold: inches("0.125"),
      },
      ...overrides,
    };
  }

  it("accepts a valid landscape setup", () => {
    expect(validateBookletPrintSetup(makeSetup())).toBeNull();
  });

  it("rejects portrait orientation (sheetWidth <= sheetHeight)", () => {
    expect(validateBookletPrintSetup(makeSetup({
      sheetWidth: inches("8.5"),
      sheetHeight: inches("11"),
    }))).toMatch(/landscape/i);
  });

  it("rejects square (sheetWidth = sheetHeight)", () => {
    expect(validateBookletPrintSetup(makeSetup({
      sheetWidth: inches("8.5"),
      sheetHeight: inches("8.5"),
    }))).not.toBeNull();
  });

  it("rejects scale = 0", () => {
    expect(validateBookletPrintSetup(makeSetup({
      scale: fromInt(0n),
    }))).toMatch(/scale/i);
  });

  it("rejects scale > 1", () => {
    expect(validateBookletPrintSetup(makeSetup({
      scale: rational(3n, 2n),
    }))).toMatch(/scale/i);
  });

  it("accepts scale = 1 exactly", () => {
    expect(validateBookletPrintSetup(makeSetup({ scale: fromInt(1n) }))).toBeNull();
  });

  it("accepts scale = 0.5", () => {
    expect(validateBookletPrintSetup(makeSetup({
      scale: rational(1n, 2n),
    }))).toBeNull();
  });

  it("rejects when top+bottom inset >= sheetHeight", () => {
    expect(validateBookletPrintSetup(makeSetup({
      safeInset: {
        top: inches("4.25"),
        bottom: inches("4.25"),
        left: inches("0.25"),
        right: inches("0.25"),
        fold: inches("0.125"),
      },
    }))).toMatch(/top/i);
  });

  it("rejects when left+fold >= slotWidth (5.5in)", () => {
    // slotWidth = 11/2 = 5.5in; left=3in, fold=3in → 6 > 5.5
    expect(validateBookletPrintSetup(makeSetup({
      safeInset: {
        top: inches("0.25"),
        bottom: inches("0.25"),
        left: inches("3"),
        right: inches("0.25"),
        fold: inches("3"),
      },
    }))).toMatch(/left|fold/i);
  });

  it("rejects when right+fold >= slotWidth", () => {
    expect(validateBookletPrintSetup(makeSetup({
      safeInset: {
        top: inches("0.25"),
        bottom: inches("0.25"),
        left: inches("0.25"),
        right: inches("3"),
        fold: inches("3"),
      },
    }))).toMatch(/right|fold/i);
  });

  it("handles exact equality (slotWidth - left - fold = 0) as invalid", () => {
    // slotWidth = 5.5in; left=2.75in, fold=2.75in → remaining = 0
    expect(validateBookletPrintSetup(makeSetup({
      safeInset: {
        top: inches("0.25"),
        bottom: inches("0.25"),
        left: inches("2.75"),
        right: inches("0.25"),
        fold: inches("2.75"),
      },
    }))).not.toBeNull(); // must not be zero
  });
});

// ─── validateFinalPageCountRequirement ───────────────────────────────────────

describe("validateFinalPageCountRequirement()", () => {
  it("accepts exact: 4", () => {
    expect(validateFinalPageCountRequirement({ exact: 4 })).toBeNull();
  });

  it("accepts exact: 1 (minimum positive)", () => {
    expect(validateFinalPageCountRequirement({ exact: 1 })).toBeNull();
  });

  it("rejects exact: 0", () => {
    expect(validateFinalPageCountRequirement({ exact: 0 })).not.toBeNull();
  });

  it("rejects exact: negative", () => {
    expect(validateFinalPageCountRequirement({ exact: -1 })).not.toBeNull();
  });

  it("rejects exact exceeding hard cap", () => {
    expect(validateFinalPageCountRequirement({ exact: PDF_PAGE_HARD_CAP + 1 })).not.toBeNull();
  });

  it("accepts spec example: min=4, max=24, multipleOf=4", () => {
    expect(validateFinalPageCountRequirement({
      minimum: 4, maximum: 24, multipleOf: 4,
    })).toBeNull();
  });

  it("rejects minimum > maximum", () => {
    expect(validateFinalPageCountRequirement({ minimum: 10, maximum: 5 })).not.toBeNull();
  });

  it("rejects multipleOf: 1 (must be >= 2)", () => {
    expect(validateFinalPageCountRequirement({ multipleOf: 1 })).not.toBeNull();
  });

  it("accepts multipleOf: 4 alone", () => {
    expect(validateFinalPageCountRequirement({ multipleOf: 4 })).toBeNull();
  });

  it("rejects when no multiple fits in [min, max]", () => {
    // multipleOf=4, min=3, max=3 — no multiple of 4 in [3,3]
    expect(validateFinalPageCountRequirement({
      minimum: 3, maximum: 3, multipleOf: 4,
    })).not.toBeNull();
  });

  it("accepts when first multiple fits: min=4, max=8, multipleOf=4", () => {
    expect(validateFinalPageCountRequirement({
      minimum: 4, maximum: 8, multipleOf: 4,
    })).toBeNull();
  });

  it("rejects minimum: 0", () => {
    expect(validateFinalPageCountRequirement({ minimum: 0 })).not.toBeNull();
  });

  it("accepts maximum alone", () => {
    expect(validateFinalPageCountRequirement({ maximum: 100 })).toBeNull();
  });

  it("accepts minimum alone", () => {
    expect(validateFinalPageCountRequirement({ minimum: 1 })).toBeNull();
  });

  it("rejects minimum exceeding hard cap", () => {
    expect(validateFinalPageCountRequirement({ minimum: PDF_PAGE_HARD_CAP + 1 })).not.toBeNull();
  });

  it("rejects non-integer exact", () => {
    expect(validateFinalPageCountRequirement({ exact: 2.5 })).not.toBeNull();
  });

  it("FinalPageCountRequirement type: exact requirement object", () => {
    const req: FinalPageCountRequirement = { exact: 8 };
    expect(validateFinalPageCountRequirement(req)).toBe(null);
  });
});
