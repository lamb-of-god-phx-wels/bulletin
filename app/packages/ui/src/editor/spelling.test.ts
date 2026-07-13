import { describe, expect, it } from "vitest";
import {
  canonicalSpellingDictionary,
  canonicalSpellingWord,
  MAX_CHURCH_DICTIONARY_WORDS,
} from "./spelling.js";

describe("offline spelling vocabulary", () => {
  it("canonicalizes Unicode church words without accepting phrases or control text", () => {
    expect(canonicalSpellingWord("  Kyrie  ")).toBe("kyrie");
    expect(canonicalSpellingWord("D’Youville")).toBe("d’youville");
    expect(canonicalSpellingWord("two words")).toBeUndefined();
    expect(canonicalSpellingWord("bad\nword")).toBeUndefined();
  });

  it("deduplicates, sorts, and bounds persisted words", () => {
    const values = Array.from({ length: MAX_CHURCH_DICTIONARY_WORDS + 3 }, (_, index) =>
      `word${String.fromCharCode(97 + (index % 26))}${"z".repeat(Math.floor(index / 26))}`
    );
    const result = canonicalSpellingDictionary(["Zion", "zion", "amen", ...values]);
    expect(result[0]).toBe("amen");
    expect(result.filter((word) => word === "zion")).toHaveLength(1);
    expect(result.length).toBeLessThanOrEqual(MAX_CHURCH_DICTIONARY_WORDS);
  });
});
