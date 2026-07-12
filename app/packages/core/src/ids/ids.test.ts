import { describe, expect, it } from "vitest";
import {
  extractAssetId,
  extractCreditId,
  extractFontId,
  extractSongWorkId,
  extractTranslationId,
  formatAssetRef,
  formatCreditRef,
  formatFontRef,
  formatSongWorkRef,
  formatTranslationRef,
  isCanonicalUuid,
  isPortableAssetRef,
  isPortableFontRef,
  isPortableSongWorkRef,
  isRightsCreditRef,
  isScriptureTranslationRef,
  isWorkspaceId,
  makeSequentialIdPort,
  mintAiExchangeId,
  mintBundleId,
  mintDocumentElementId,
  mintLocalResourceId,
  mintPortableAssetId,
  mintPortableAssetRef,
  mintPortableFontRef,
  mintPortableSongWorkRef,
  mintRightsCreditRef,
  mintScriptureTranslationRef,
  mintWorkspaceId,
  normaliseUuid,
  parseLocalResourceId,
  parsePortableAssetRef,
  parsePortableFontRef,
  parsePortableSongWorkRef,
  parseRightsCreditRef,
  parseScriptureTranslationRef,
  parseWorkspaceId,
} from "./index.js";
import {
  parseDocumentElementId,
} from "./constructors.js";

// ---------------------------------------------------------------------------
// UUID validation
// ---------------------------------------------------------------------------

describe("isCanonicalUuid", () => {
  it("accepts a valid lowercase-hyphenated UUIDv4", () => {
    expect(
      isCanonicalUuid("550e8400-e29b-41d4-a716-446655440000"),
    ).toBe(true);
  });

  it("accepts all-zeros UUID", () => {
    expect(
      isCanonicalUuid("00000000-0000-0000-0000-000000000000"),
    ).toBe(true);
  });

  it("rejects uppercase hex", () => {
    expect(
      isCanonicalUuid("550E8400-E29B-41D4-A716-446655440000"),
    ).toBe(false);
  });

  it("rejects compact form (no hyphens)", () => {
    expect(
      isCanonicalUuid("550e8400e29b41d4a716446655440000"),
    ).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isCanonicalUuid("")).toBe(false);
  });

  it("rejects string with wrong segment lengths", () => {
    expect(
      isCanonicalUuid("550e8400-e29b-41d4-a716-44665544000"),
    ).toBe(false);
  });

  it("rejects string with extra hyphens", () => {
    expect(
      isCanonicalUuid("550e8400-e29b-41d4-a716-4466-55440000"),
    ).toBe(false);
  });

  it("rejects non-hex characters", () => {
    expect(
      isCanonicalUuid("550e8400-e29b-41d4-a716-44665544000g"),
    ).toBe(false);
  });
});

describe("normaliseUuid", () => {
  it("passes through an already-canonical UUID unchanged", () => {
    expect(
      normaliseUuid("550e8400-e29b-41d4-a716-446655440000"),
    ).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("lowercases an uppercase UUID", () => {
    expect(
      normaliseUuid("550E8400-E29B-41D4-A716-446655440000"),
    ).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("converts compact (32-char) UUID to hyphenated form", () => {
    expect(
      normaliseUuid("550e8400e29b41d4a716446655440000"),
    ).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("strips curly braces and lowercases", () => {
    expect(
      normaliseUuid("{550E8400-E29B-41D4-A716-446655440000}"),
    ).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("returns null for non-UUID garbage", () => {
    expect(normaliseUuid("not-a-uuid")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(normaliseUuid("")).toBeNull();
  });

  it("handles leading/trailing whitespace", () => {
    expect(
      normaliseUuid("  550e8400-e29b-41d4-a716-446655440000  "),
    ).toBe("550e8400-e29b-41d4-a716-446655440000");
  });
});

// ---------------------------------------------------------------------------
// IdPort — makeSequentialIdPort
// ---------------------------------------------------------------------------

describe("makeSequentialIdPort", () => {
  it("produces valid canonical UUIDs", () => {
    const port = makeSequentialIdPort();
    const id = port.randomUuid();
    expect(isCanonicalUuid(id)).toBe(true);
  });

  it("produces distinct values on successive calls", () => {
    const port = makeSequentialIdPort();
    const a = port.randomUuid();
    const b = port.randomUuid();
    const c = port.randomUuid();
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(a).not.toBe(c);
  });

  it("is deterministic (same sequence every time)", () => {
    const port1 = makeSequentialIdPort();
    const port2 = makeSequentialIdPort();
    for (let i = 0; i < 5; i++) {
      expect(port1.randomUuid()).toBe(port2.randomUuid());
    }
  });

  it("respects a custom start index", () => {
    const portA = makeSequentialIdPort(0);
    const portB = makeSequentialIdPort(10);
    // The 11th call on portA should equal the 1st call on portB.
    for (let i = 0; i < 10; i++) portA.randomUuid();
    expect(portA.randomUuid()).toBe(portB.randomUuid());
  });
});

// ---------------------------------------------------------------------------
// Plain-UUID id constructors
// ---------------------------------------------------------------------------

describe("WorkspaceId", () => {
  it("mints a valid WorkspaceId", () => {
    const port = makeSequentialIdPort();
    const id = mintWorkspaceId(port);
    expect(isWorkspaceId(id)).toBe(true);
    expect(isCanonicalUuid(id)).toBe(true);
  });

  it("parseWorkspaceId accepts a valid UUID", () => {
    const id = parseWorkspaceId("550e8400-e29b-41d4-a716-446655440000");
    expect(isCanonicalUuid(id)).toBe(true);
  });

  it("parseWorkspaceId throws on invalid input", () => {
    expect(() => parseWorkspaceId("not-a-uuid")).toThrow(TypeError);
    expect(() => parseWorkspaceId("")).toThrow(TypeError);
  });
});

describe("LocalResourceId", () => {
  it("mints a valid LocalResourceId", () => {
    const port = makeSequentialIdPort();
    const id = mintLocalResourceId(port);
    expect(isCanonicalUuid(id)).toBe(true);
  });

  it("parseLocalResourceId throws on garbage input", () => {
    expect(() => parseLocalResourceId("garbage")).toThrow(TypeError);
  });
});

describe("BundleId", () => {
  it("mints a valid BundleId", () => {
    const port = makeSequentialIdPort();
    const id = mintBundleId(port);
    expect(isCanonicalUuid(id)).toBe(true);
  });
});

describe("DocumentElementId", () => {
  it("mints a DocumentElementId (any non-empty string)", () => {
    const port = makeSequentialIdPort();
    const id = mintDocumentElementId(port);
    expect(id.length).toBeGreaterThan(0);
  });

  it("accepts non-UUID non-empty strings", () => {
    const id = "el-header-1";
    // parseDocumentElementId should succeed — element ids are opaque strings.
    expect(parseDocumentElementId(id)).toBe(id);
  });

  it("throws on empty string", () => {
    expect(() => parseDocumentElementId("")).toThrow(TypeError);
  });
});

describe("AiExchangeId", () => {
  it("mints a valid AiExchangeId", () => {
    const port = makeSequentialIdPort();
    const id = mintAiExchangeId(port);
    expect(isCanonicalUuid(id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Prefixed reference types
// ---------------------------------------------------------------------------

describe("PortableAssetRef", () => {
  const validRef = "asset:550e8400-e29b-41d4-a716-446655440000";
  const validUuid = "550e8400-e29b-41d4-a716-446655440000";

  it("isPortableAssetRef accepts a well-formed reference", () => {
    expect(isPortableAssetRef(validRef)).toBe(true);
  });

  it("isPortableAssetRef rejects a bare UUID", () => {
    expect(isPortableAssetRef(validUuid)).toBe(false);
  });

  it("isPortableAssetRef rejects wrong prefix", () => {
    expect(isPortableAssetRef(`font:${validUuid}`)).toBe(false);
  });

  it("isPortableAssetRef rejects malformed UUID after prefix", () => {
    expect(isPortableAssetRef("asset:not-a-uuid")).toBe(false);
  });

  it("parsePortableAssetRef accepts valid reference", () => {
    const ref = parsePortableAssetRef(validRef);
    expect(ref).toBe(validRef);
  });

  it("parsePortableAssetRef throws on bare UUID", () => {
    expect(() => parsePortableAssetRef(validUuid)).toThrow(TypeError);
  });

  it("parsePortableAssetRef throws on wrong prefix", () => {
    expect(() => parsePortableAssetRef(`font:${validUuid}`)).toThrow(TypeError);
  });

  it("mintPortableAssetRef produces a valid reference", () => {
    const port = makeSequentialIdPort();
    const ref = mintPortableAssetRef(port);
    expect(isPortableAssetRef(ref)).toBe(true);
    expect(ref.startsWith("asset:")).toBe(true);
  });

  it("extractAssetId extracts the UUID portion", () => {
    const ref = parsePortableAssetRef(validRef);
    const id = extractAssetId(ref);
    expect(id).toBe(validUuid);
    expect(isCanonicalUuid(id)).toBe(true);
  });

  it("formatAssetRef reconstructs the ref from a bare id", () => {
    const id = mintPortableAssetId(makeSequentialIdPort());
    const ref = formatAssetRef(id);
    expect(ref).toBe(`asset:${id}`);
    expect(isPortableAssetRef(ref)).toBe(true);
  });

  it("round-trip: mintPortableAssetRef → extractAssetId → formatAssetRef", () => {
    const port = makeSequentialIdPort();
    const ref = mintPortableAssetRef(port);
    const id = extractAssetId(ref);
    const rebuilt = formatAssetRef(id);
    expect(rebuilt).toBe(ref);
  });
});

describe("PortableFontRef", () => {
  const validUuid = "550e8400-e29b-41d4-a716-446655440001";
  const validRef = `font:${validUuid}`;

  it("isPortableFontRef accepts a well-formed reference", () => {
    expect(isPortableFontRef(validRef)).toBe(true);
  });

  it("isPortableFontRef rejects wrong prefix", () => {
    expect(isPortableFontRef(`asset:${validUuid}`)).toBe(false);
  });

  it("mintPortableFontRef produces a valid reference", () => {
    const port = makeSequentialIdPort();
    const ref = mintPortableFontRef(port);
    expect(isPortableFontRef(ref)).toBe(true);
  });

  it("extractFontId extracts the UUID", () => {
    const ref = parsePortableFontRef(validRef);
    expect(extractFontId(ref)).toBe(validUuid);
  });

  it("formatFontRef round-trips correctly", () => {
    const port = makeSequentialIdPort();
    const ref = mintPortableFontRef(port);
    const id = extractFontId(ref);
    expect(formatFontRef(id)).toBe(ref);
  });
});

describe("PortableSongWorkRef", () => {
  const validUuid = "550e8400-e29b-41d4-a716-446655440002";
  const validRef = `song:${validUuid}`;

  it("isPortableSongWorkRef accepts a well-formed reference", () => {
    expect(isPortableSongWorkRef(validRef)).toBe(true);
  });

  it("parsePortableSongWorkRef accepts valid reference", () => {
    const ref = parsePortableSongWorkRef(validRef);
    expect(ref).toBe(validRef);
  });

  it("parsePortableSongWorkRef throws on wrong prefix", () => {
    expect(() => parsePortableSongWorkRef(`asset:${validUuid}`)).toThrow(TypeError);
  });

  it("isPortableSongWorkRef rejects wrong prefix", () => {
    expect(isPortableSongWorkRef(`translation:${validUuid}`)).toBe(false);
  });

  it("mintPortableSongWorkRef produces valid reference", () => {
    const port = makeSequentialIdPort();
    expect(isPortableSongWorkRef(mintPortableSongWorkRef(port))).toBe(true);
  });

  it("extractSongWorkId / formatSongWorkRef round-trip", () => {
    const port = makeSequentialIdPort();
    const ref = mintPortableSongWorkRef(port);
    const id = extractSongWorkId(ref);
    expect(formatSongWorkRef(id)).toBe(ref);
  });
});

describe("ScriptureTranslationRef", () => {
  const validUuid = "550e8400-e29b-41d4-a716-446655440003";
  const validRef = `translation:${validUuid}`;

  it("isScriptureTranslationRef accepts a well-formed reference", () => {
    expect(isScriptureTranslationRef(validRef)).toBe(true);
  });

  it("parseScriptureTranslationRef accepts valid reference", () => {
    const ref = parseScriptureTranslationRef(validRef);
    expect(ref).toBe(validRef);
  });

  it("parseScriptureTranslationRef throws on wrong prefix", () => {
    expect(() => parseScriptureTranslationRef(`credit:${validUuid}`)).toThrow(TypeError);
  });

  it("isScriptureTranslationRef rejects wrong prefix", () => {
    expect(isScriptureTranslationRef(`credit:${validUuid}`)).toBe(false);
  });

  it("mintScriptureTranslationRef produces valid reference", () => {
    const port = makeSequentialIdPort();
    expect(isScriptureTranslationRef(mintScriptureTranslationRef(port))).toBe(
      true,
    );
  });

  it("extractTranslationId / formatTranslationRef round-trip", () => {
    const port = makeSequentialIdPort();
    const ref = mintScriptureTranslationRef(port);
    const id = extractTranslationId(ref);
    expect(formatTranslationRef(id)).toBe(ref);
  });
});

describe("RightsCreditRef", () => {
  const validUuid = "550e8400-e29b-41d4-a716-446655440004";
  const validRef = `credit:${validUuid}`;

  it("isRightsCreditRef accepts a well-formed reference", () => {
    expect(isRightsCreditRef(validRef)).toBe(true);
  });

  it("parseRightsCreditRef accepts valid reference", () => {
    const ref = parseRightsCreditRef(validRef);
    expect(ref).toBe(validRef);
  });

  it("parseRightsCreditRef throws on wrong prefix", () => {
    expect(() => parseRightsCreditRef(`song:${validUuid}`)).toThrow(TypeError);
  });

  it("isRightsCreditRef rejects wrong prefix", () => {
    expect(isRightsCreditRef(`song:${validUuid}`)).toBe(false);
  });

  it("mintRightsCreditRef produces valid reference", () => {
    const port = makeSequentialIdPort();
    expect(isRightsCreditRef(mintRightsCreditRef(port))).toBe(true);
  });

  it("extractCreditId / formatCreditRef round-trip", () => {
    const port = makeSequentialIdPort();
    const ref = mintRightsCreditRef(port);
    const id = extractCreditId(ref);
    expect(formatCreditRef(id)).toBe(ref);
  });
});

// ---------------------------------------------------------------------------
// Cross-prefix rejection: each prefix rejects all other prefixes
// ---------------------------------------------------------------------------

describe("prefix cross-rejection", () => {
  const uuid = "550e8400-e29b-41d4-a716-446655440000";
  const prefixes = ["asset", "font", "song", "translation", "credit"] as const;
  const guards: Record<string, (v: string) => boolean> = {
    asset: isPortableAssetRef,
    font: isPortableFontRef,
    song: isPortableSongWorkRef,
    translation: isScriptureTranslationRef,
    credit: isRightsCreditRef,
  };

  for (const own of prefixes) {
    for (const other of prefixes) {
      if (own === other) continue;
      it(`${other}:<uuid> is rejected by is${own.charAt(0).toUpperCase()}${own.slice(1)}Ref guard`, () => {
        expect(guards[own]?.(`${other}:${uuid}`)).toBe(false);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Error message quality
// ---------------------------------------------------------------------------

describe("parse error messages", () => {
  it("parseWorkspaceId error includes the bad value", () => {
    try {
      parseWorkspaceId("bad-value");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(TypeError);
      expect((e as TypeError).message).toContain("WorkspaceId");
      expect((e as TypeError).message).toContain("bad-value");
    }
  });

  it("parsePortableAssetRef error includes the bad value", () => {
    try {
      parsePortableAssetRef("totally-wrong");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(TypeError);
      expect((e as TypeError).message).toContain("PortableAssetRef");
    }
  });
});
