import { describe, expect, it } from "vitest";

import {
  rationalFromJsonNumber,
  typstColor,
  typstFontSize,
  typstLength,
} from "./values.js";

describe("rationalFromJsonNumber", () => {
  it.each([
    [0.1, { numerator: 1n, denominator: 10n }],
    [1e-7, { numerator: 1n, denominator: 10_000_000n }],
    [1.25e3, { numerator: 1250n, denominator: 1n }],
    [-2.5e-2, { numerator: -1n, denominator: 40n }],
  ])("converts %s from its JSON decimal representation exactly", (value, expected) => {
    expect(rationalFromJsonNumber(value as number)).toEqual(expected);
  });

  it("rejects non-finite values", () => {
    expect(() => rationalFromJsonNumber(Number.NaN)).toThrow(/finite/);
    expect(() => rationalFromJsonNumber(Number.POSITIVE_INFINITY)).toThrow(/finite/);
  });
});

describe("typstLength", () => {
  it("converts physical units exactly and rounds only at emission", () => {
    expect(typstLength("1in", "physical")).toBe("72pt");
    expect(typstLength("2.54cm", "physical")).toBe("72pt");
    expect(typstLength("1mm", "spacing")).toBe("2.835pt");
  });

  it("migrates legacy numeric geometry as exact 0.75pt pixels", () => {
    expect(typstLength(96, "element-size")).toBe("72pt");
    expect(typstLength(0.5, "spacing")).toBe("0.375pt");
  });

  it("preserves allowed relative values and auto", () => {
    expect(typstLength("50%", "element-size")).toBe("50%");
    expect(typstLength("1fr", "track")).toBe("1fr");
    expect(typstLength("auto", "page-element-size")).toBe("auto");
    expect(typstLength("1.2em", "font-size")).toBe("1.2em");
    expect(typstLength("10%", "physical-or-relative")).toBe("10%");
  });

  it("fails closed when a role forbids the supplied unit", () => {
    expect(() => typstLength("1fr", "element-size")).toThrow(/not valid/);
    expect(() => typstLength("10%", "spacing")).toThrow(/not valid/);
    expect(() => typstLength(3, "track")).toThrow(/legacy numeric/);
  });
});

describe("Typst scalar values", () => {
  it("emits font defaults and colors", () => {
    expect(typstFontSize(undefined)).toBe("11pt");
    expect(typstFontSize("1.25em")).toBe("1.25em");
    expect(typstColor("#FFAA00")).toBe('rgb("#ffaa00")');
    expect(typstColor("transparent")).toBe("none");
  });
});
