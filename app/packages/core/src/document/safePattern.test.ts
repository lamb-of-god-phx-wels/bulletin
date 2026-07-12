import { describe, expect, it } from "vitest";
import { isSafeFieldPattern, matchesSafeFieldPattern } from "./safePattern.js";

describe("safe field patterns", () => {
  it.each([
    ["^[A-Z][a-z]+$", "Lamb", true],
    ["^[A-Z][a-z]+$", "lamb", false],
    ["^\\d{4}-\\d{2}-\\d{2}$", "2026-07-12", true],
    ["colou?r", "color", true],
    ["colou?r", "colour", true],
    ["[^0-9]+", "abc", true],
    ["^a{2,4}$", "aaaaa", false],
    ["^\\w+$", "a_B9", true],
    ["^🐑+$", "🐑🐑", true],
    ["^[🐑]$", "🐑", true],
    ["^[🐑-🐴]$", "🐴", true],
    ["^[🐑-🐴]$", "🐶", false],
    ["^[^🐑]$", "🐴", true],
    ["^[^🐑]$", "🐑", false],
    ["^\\🐑$", "🐑", true],
  ])("matches %s against %s", (pattern, value, expected) => {
    expect(matchesSafeFieldPattern(value, pattern)).toBe(expected);
  });

  it.each([
    "(a+)+",
    "a|b",
    "(?=x)",
    "[abc",
    "a{3,2}",
    "a{9999}",
    "^\\1$",
    "^\\9$",
    "^\\k<name>$",
    "^\\bword\\b$",
    "^[\\1]$",
    "^[\\b]$",
    "^\ud800$",
    "^[\udc00]$",
  ])(
    "rejects unsupported or unbounded-risk syntax %s",
    (pattern) => expect(isSafeFieldPattern(pattern)).toBe(false),
  );

  it("accepts escaped punctuation literals but rejects unsupported letter escapes", () => {
    expect(matchesSafeFieldPattern("a+b$\\", "^a\\+b\\$\\\\$")).toBe(true);
    expect(isSafeFieldPattern("^\\q$")).toBe(false);
    expect(isSafeFieldPattern("^[\\q]$")).toBe(false);
  });

  it("uses the closed ASCII whitespace class including form feed", () => {
    for (const whitespace of [" ", "\t", "\n", "\f", "\r"]) {
      expect(matchesSafeFieldPattern(whitespace, "^\\s$")).toBe(true);
      expect(matchesSafeFieldPattern(whitespace, "^\\S$")).toBe(false);
    }
    expect(matchesSafeFieldPattern("\v", "^\\s$")).toBe(false);
    expect(matchesSafeFieldPattern("x", "^\\S$")).toBe(true);
  });

  it("treats one Unicode scalar as one dot and excludes CR/LF line terminators", () => {
    expect(matchesSafeFieldPattern("🐑", "^.$")).toBe(true);
    expect(matchesSafeFieldPattern("\f", "^.$")).toBe(true);
    expect(matchesSafeFieldPattern("\n", "^.$")).toBe(false);
    expect(matchesSafeFieldPattern("\r", "^.$")).toBe(false);
  });

  it("handles long hostile input without host RegExp backtracking", () => {
    expect(matchesSafeFieldPattern("a".repeat(50_000) + "!", "^a+!$")).toBe(true);
  });
});
