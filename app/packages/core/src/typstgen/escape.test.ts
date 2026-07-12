import { describe, expect, it } from "vitest";

import { assertSafeBuildRelativePath, typstStringLiteral } from "./escape.js";
import { DATE_FORMATTER_VERSION, formatIsoDate } from "./date.js";

describe("typstStringLiteral", () => {
  it("keeps markup sigils inert inside a quoted string", () => {
    expect(typstStringLiteral('#[]$*_<>@ = "x"')).toBe(
      '"#[]$*_<>@ = \\"x\\""'
    );
  });

  it("escapes slashes, line controls, and unsafe Unicode separators", () => {
    expect(typstStringLiteral("a\\b\n\t\u0001\u2028"))
      .toBe('"a\\\\b\\n\\t\\u{1}\\u{2028}"');
  });

  it("retains ordinary Unicode verbatim", () => {
    expect(typstStringLiteral("Lamb 🐑 — εἰρήνη"))
      .toBe('"Lamb 🐑 — εἰρήνη"');
  });

  it("rejects lone UTF-16 surrogates before UTF-8 emission", () => {
    expect(() => typstStringLiteral(String.fromCharCode(0xd800))).toThrow(
      /well-formed Unicode/,
    );
    expect(() => typstStringLiteral(String.fromCharCode(0xdc00))).toThrow(
      /well-formed Unicode/,
    );
  });
});

describe("assertSafeBuildRelativePath", () => {
  it.each(["assets/logo.png", "fonts/noto/sans.ttf"])("accepts %s", (path) => {
    expect(() => assertSafeBuildRelativePath(path)).not.toThrow();
  });

  it.each([
    "",
    "/etc/passwd",
    "C:/Windows/font.ttf",
    "../secret",
    "assets/../secret",
    "assets//logo.png",
    "assets\\logo.png",
    "./logo.png",
  ])("rejects %s", (path) => {
    expect(() => assertSafeBuildRelativePath(path)).toThrow();
  });
});

describe("formatIsoDate", () => {
  it("formats with pinned English tables and tokens", () => {
    expect(formatIsoDate("2026-07-05", "MMMM D, YYYY", "en-US")).toEqual({
      text: "July 5, 2026",
      formatterVersion: DATE_FORMATTER_VERSION,
      localeUsed: "en-US",
    });
    expect(formatIsoDate("2024-02-29", "MMM DD, YY", "en").text)
      .toBe("Feb 29, 24");
    expect(formatIsoDate("2026-07-05", "dddd, MMMM D [at church]", "en-US").text)
      .toBe("Sunday, July 5 at church");
  });

  it("rejects invalid calendar dates", () => {
    expect(() => formatIsoDate("2026-02-29")).toThrow(/Gregorian/);
    expect(() => formatIsoDate("0000-01-01")).toThrow(/Gregorian/);
  });

  it("reports deterministic locale fallback and fails closed for unknown tokens", () => {
    expect(formatIsoDate("2026-07-05", "MMMM D, YYYY", "fr-FR"))
      .toEqual({
        text: "July 5, 2026",
        formatterVersion: DATE_FORMATTER_VERSION,
        localeUsed: "en-US",
        localeFallbackFrom: "fr-FR",
      });
    expect(() => formatIsoDate("2026-07-05", "dddd, MMMM D"))
      .not.toThrow();
    expect(() => formatIsoDate("2026-07-05", "QQ, MMMM D"))
      .toThrow(/format token/);
    expect(() => formatIsoDate("2026-07-05", "MMMM D [at church"))
      .toThrow(/Unterminated/);
  });
});
