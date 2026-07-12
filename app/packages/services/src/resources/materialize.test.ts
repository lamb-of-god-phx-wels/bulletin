import { describe, expect, it } from "vitest";
import {
  BUNDLED_NOTO_SANS_FONT_REF,
  BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF,
  createSanitizedRenderProjection,
  hexToSha256Hash,
  parsePortableFontRef,
  renderInputHash,
  type HashJsonObject,
  type PortableFontRef,
  type RenderProjection,
  type VerifiedFontIdentity,
} from "@cbb/core";
import { materializeMandatoryFontFallbacks } from "./materialize.js";

const uuid = (digit: string) =>
  `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const USER = parsePortableFontRef(`font:${uuid("1")}`);
const NOTO = BUNDLED_NOTO_SANS_FONT_REF;
const SYMBOLS = BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF;
const HASH = hexToSha256Hash("a".repeat(64));

function projection(): RenderProjection {
  return {
    version: 1,
    title: "Bulletin",
    locale: "en-US",
    page: {
      typstWidth: "5.5in",
      typstHeight: "8.5in",
      marginMode: "fixed",
      binding: "left",
    },
    scripturePresentation: {
      referencePlacement: "before",
      verseNumberStyle: "superscript",
      paragraphPolicy: "publisher",
      paragraphSpacing: "6pt",
      translationLabelPlacement: "withReference",
    },
    fontFallbackRefs: [USER],
    elements: [],
    pageElements: [],
    rightsContributions: [],
    referencedFonts: [{ fontRef: USER }],
    referencedAssets: [],
  };
}

function fontIdentity(fontRef: PortableFontRef, index: number): VerifiedFontIdentity {
  return {
    fontRef,
    familyDigest: hexToSha256Hash(index.toString(16).repeat(64)),
    selectedFaces: [
      {
        faceId: "regular",
        faceHash: hexToSha256Hash((index + 3).toString(16).repeat(64)),
        faceIndex: 0,
        embedding: "subset",
      },
    ],
  };
}

describe("mandatory build font materialization", () => {
  it("adds bundled revisions to fallback order and the exact hashed closure", () => {
    const original = projection();
    const effective = materializeMandatoryFontFallbacks(original);
    expect(effective.fontFallbackRefs).toEqual([USER, NOTO, SYMBOLS]);
    expect(effective.referencedFonts).toEqual([
      { fontRef: USER },
      { fontRef: NOTO },
      { fontRef: SYMBOLS },
    ].sort((left, right) => left.fontRef < right.fontRef ? -1 : left.fontRef > right.fontRef ? 1 : 0));
    expect(original.fontFallbackRefs).toEqual([USER]);

    expect(() =>
      renderInputHash({
        projection: createSanitizedRenderProjection(
          effective as unknown as HashJsonObject,
        ),
        assets: [],
        fonts: [fontIdentity(USER, 1), fontIdentity(NOTO, 2), fontIdentity(SYMBOLS, 3)],
        tools: [{ toolId: "typst", version: "test", toolHash: HASH }],
        locale: { languageTag: "en-US", dataVersion: "test", dataHash: HASH },
        outputOptions: {
          outputForm: "readerOrder",
          pdfConformance: "standard",
          watermark: { kind: "none" },
        },
      }),
    ).not.toThrow();
  });

  it("is idempotent and restores the mandatory tail order", () => {
    const outOfOrder = {
      ...projection(),
      fontFallbackRefs: [SYMBOLS, USER, NOTO, USER],
    };
    const first = materializeMandatoryFontFallbacks(outOfOrder);
    const second = materializeMandatoryFontFallbacks(first);
    expect(first.fontFallbackRefs).toEqual([USER, NOTO, SYMBOLS]);
    expect(second).toEqual(first);
  });
});
