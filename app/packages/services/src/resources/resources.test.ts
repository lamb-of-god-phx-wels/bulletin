import { describe, expect, it } from "vitest";
import {
  BUNDLED_NOTO_SANS_FAMILY,
  BUNDLED_NOTO_SANS_FONT_REF,
  BUNDLED_NOTO_SANS_SYMBOLS_2_FAMILY,
  BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF,
  parseLocalResourceId,
  parsePortableAssetRef,
  parsePortableFontRef,
} from "@cbb/core";
import type { Sha256Hash } from "@cbb/core";
import {
  computeFontFamilyDigest,
  createResourceResolverIndex,
  RESOURCE_CLOSURE_LIMITS,
  resolveVerifiedResourceClosure,
  ResourceContractError,
} from "./index.js";
import type {
  AssetRevisionRecord,
  FontRevisionRecord,
  ManagedFontFaceRecord,
  NoFollowResourceByteVerifier,
  ResourceByteVerificationRequest,
} from "./index.js";

const H1 = `sha256:${"1".repeat(64)}` as Sha256Hash;
const H2 = `sha256:${"2".repeat(64)}` as Sha256Hash;
const H3 = `sha256:${"3".repeat(64)}` as Sha256Hash;

function uuid(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

function localId(index: number) {
  return parseLocalResourceId(uuid(index));
}

function assetRef(index: number) {
  return parsePortableAssetRef(`asset:${uuid(index)}`);
}

function fontRef(index: number) {
  return parsePortableFontRef(`font:${uuid(index)}`);
}

function asset(
  index: number,
  overrides: Partial<AssetRevisionRecord> = {},
): AssetRevisionRecord {
  return {
    version: 1,
    kind: "assetRecord",
    localId: localId(index),
    portableAssetId: assetRef(index),
    displayName: `Asset ${index}`,
    mediaType: "image/png",
    canonicalHash: H1,
    byteSize: 128,
    sanitizationState: "validated",
    aiVisibility: "private",
    importedAt: "2026-07-12T12:00:00Z",
    ...overrides,
  };
}

function face(
  faceId: string,
  overrides: Partial<ManagedFontFaceRecord> = {},
): ManagedFontFaceRecord {
  return {
    faceId,
    faceIndex: 0,
    format: "ttf",
    weight: 400,
    style: "normal",
    stretch: 1,
    hash: H2,
    byteSize: 256,
    ...overrides,
  };
}

function font(
  index: number,
  overrides: Partial<FontRevisionRecord> = {},
): FontRevisionRecord {
  const faces = overrides.faces ?? [face(`regular_${index}`)];
  return {
    version: 1,
    kind: "fontRecord",
    localId: localId(10_000 + index),
    portableFontId: fontRef(index),
    familyDigest: computeFontFamilyDigest(faces),
    displayName: `Font ${index}`,
    typstFamilyName: `Managed Family ${index}`,
    redistributionAsserted: true,
    exportable: true,
    pdfEmbeddingPermitted: true,
    pdfSubsettingPermitted: true,
    validationState: "validated",
    faces,
    ...overrides,
  };
}

class ExactVerifier implements NoFollowResourceByteVerifier {
  readonly requests: ResourceByteVerificationRequest[] = [];

  async verify(request: ResourceByteVerificationRequest) {
    this.requests.push(request);
    return {
      observedHash: request.expectedHash,
      observedByteSize: request.expectedByteSize,
    };
  }
}

function projection(assets: number[], fonts: number[]) {
  return {
    referencedAssets: assets.map((index) => ({ assetRef: assetRef(index) })),
    referencedFonts: [
      ...fonts.map((index) => ({ fontRef: fontRef(index) })),
      { fontRef: BUNDLED_NOTO_SANS_FONT_REF },
      { fontRef: BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF },
    ],
    fontFallbackRefs: [
      BUNDLED_NOTO_SANS_FONT_REF,
      BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF,
    ],
  };
}

function bundledFonts(): readonly FontRevisionRecord[] {
  return [
    font(101, {
      portableFontId: BUNDLED_NOTO_SANS_FONT_REF,
      typstFamilyName: BUNDLED_NOTO_SANS_FAMILY,
    }),
    font(102, {
      portableFontId: BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF,
      typstFamilyName: BUNDLED_NOTO_SANS_SYMBOLS_2_FAMILY,
    }),
  ];
}

function buildIndex(
  assets: readonly AssetRevisionRecord[],
  fonts: readonly FontRevisionRecord[],
) {
  return createResourceResolverIndex({ assets, fonts: [...fonts, ...bundledFonts()] });
}

describe("font family digest", () => {
  it("is order-independent while committing every binary face property", () => {
    const regular = face("regular", {
      variableAxisCoordinates: { wght: 400, wdth: 100 },
    });
    const italic = face("italic", {
      faceIndex: 1,
      style: "italic",
      hash: H3,
      variableAxisCoordinates: { wdth: 100, wght: 400 },
    });

    expect(computeFontFamilyDigest([regular, italic])).toBe(
      computeFontFamilyDigest([italic, regular]),
    );
    expect(
      computeFontFamilyDigest([{ ...regular, weight: 500 }, italic]),
    ).not.toBe(computeFontFamilyDigest([regular, italic]));
    expect(
      computeFontFamilyDigest([
        { ...regular, variableAxisCoordinates: { wdth: 100, wght: 401 } },
        italic,
      ]),
    ).not.toBe(computeFontFamilyDigest([regular, italic]));
  });
});

describe("resource resolver indexes", () => {
  it("validates, snapshots, and indexes records by portable identity", () => {
    const mutable = asset(1);
    const index = createResourceResolverIndex({ assets: [mutable], fonts: [font(1)] });
    (mutable as { displayName: string }).displayName = "Changed later";
    expect(index.assetsByRef.get(assetRef(1))?.displayName).toBe("Asset 1");
    expect(index.fontsByRef.get(fontRef(1))?.typstFamilyName).toBe("Managed Family 1");
  });

  it("rejects duplicate portable ids and local ids across resource kinds", () => {
    expect(() => createResourceResolverIndex({
      assets: [asset(1), asset(2, { portableAssetId: assetRef(1) })],
      fonts: [],
    }))
      .toThrowError(expect.objectContaining({ kind: "duplicatePortableId" }));

    const collidingFont = font(2, { localId: localId(1) });
    expect(() => createResourceResolverIndex({ assets: [asset(1)], fonts: [collidingFont] }))
      .toThrowError(expect.objectContaining({ kind: "duplicateLocalId" }));
  });

  it("rejects stale family digests, unsafe face ids, unknown fields, and non-NFC text", () => {
    expect(() => createResourceResolverIndex({ assets: [], fonts: [font(1, { familyDigest: H1 })] }))
      .toThrowError(expect.objectContaining({ kind: "invalidFamilyDigest" }));
    expect(() => createResourceResolverIndex({
      assets: [],
      fonts: [font(1, { faces: [face("../escape")] })],
    })).toThrowError(expect.objectContaining({ kind: "invalidRecord" }));
    expect(() => createResourceResolverIndex({
      assets: [{ ...asset(1), unexpectedPath: "/tmp/private" }],
      fonts: [],
    })).toThrowError(expect.objectContaining({ kind: "invalidRecord" }));
    expect(() => createResourceResolverIndex({
      assets: [asset(1, { displayName: "Cafe\u0301" })],
      fonts: [],
    })).toThrowError(expect.objectContaining({ kind: "invalidRecord" }));
  });
});

describe("verified resource closure", () => {
  it("fails closed when release-owned bundled font records or bytes are unavailable", async () => {
    const bundledProjection = {
      referencedAssets: [],
      referencedFonts: [
        { fontRef: BUNDLED_NOTO_SANS_FONT_REF },
        { fontRef: BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF },
      ],
      fontFallbackRefs: [
        BUNDLED_NOTO_SANS_FONT_REF,
        BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF,
      ],
    };
    await expect(resolveVerifiedResourceClosure({
      projection: bundledProjection,
      index: createResourceResolverIndex({ assets: [], fonts: [] }),
      verifier: new ExactVerifier(),
    })).rejects.toMatchObject({ kind: "missingFont", code: "CBB-FONT-0001" });

    const noto = font(101, {
      portableFontId: BUNDLED_NOTO_SANS_FONT_REF,
      typstFamilyName: BUNDLED_NOTO_SANS_FAMILY,
    });
    const symbols = font(102, {
      portableFontId: BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF,
      typstFamilyName: BUNDLED_NOTO_SANS_SYMBOLS_2_FAMILY,
    });
    await expect(resolveVerifiedResourceClosure({
      projection: bundledProjection,
      index: createResourceResolverIndex({ assets: [], fonts: [noto, symbols] }),
      verifier: {
        async verify() {
          throw new Error("packaged bundled font bytes are absent");
        },
      },
    })).rejects.toMatchObject({ kind: "byteVerificationFailed", code: "CBB-SECURITY-0001" });

    await expect(resolveVerifiedResourceClosure({
      projection: bundledProjection,
      index: createResourceResolverIndex({
        assets: [],
        fonts: [
          { ...noto, typstFamilyName: "Noto Sans substitute" },
          symbols,
        ],
      }),
      verifier: new ExactVerifier(),
    })).rejects.toMatchObject({ kind: "invalidRecord", code: "CBB-FONT-0001" });
  });

  it("returns only the exact closure in stable order with opaque aliases", async () => {
    const records = [asset(2, { mediaType: "image/jpeg", canonicalHash: H2 }), asset(1), asset(3)];
    const fonts = [font(2), font(1), font(3)];
    const verifierA = new ExactVerifier();
    const first = await resolveVerifiedResourceClosure({
      projection: projection([2, 1], [2, 1]),
      index: buildIndex(records, fonts),
      verifier: verifierA,
    });
    const verifierB = new ExactVerifier();
    const second = await resolveVerifiedResourceClosure({
      projection: projection([1, 2], [2, 1]),
      index: buildIndex([...records].reverse(), [...fonts].reverse()),
      verifier: verifierB,
    });

    expect(first).toEqual(second);
    expect(first.assets.map((entry) => entry.assetRef)).toEqual([assetRef(1), assetRef(2)]);
    expect(first.fonts.map((entry) => entry.fontRef)).toEqual([
      fontRef(1),
      fontRef(2),
      BUNDLED_NOTO_SANS_FONT_REF,
      BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF,
    ]);
    expect(first.assets).not.toContainEqual(expect.objectContaining({ assetRef: assetRef(3) }));
    expect(first.fonts).not.toContainEqual(expect.objectContaining({ fontRef: fontRef(3) }));
    expect(first.assetBindings).toEqual({
      [assetRef(1)]: { relativePath: "assets/a0000.png" },
      [assetRef(2)]: { relativePath: "assets/a0001.jpg" },
    });
    expect(first.stagingEntries).toHaveLength(6);
    for (const entry of first.stagingEntries) {
      expect(entry.relativePath).toMatch(/^(?:assets|fonts)\/[A-Za-z0-9.-]+$/u);
      expect(entry.relativePath).not.toMatch(/^(?:\/|[A-Za-z]:|.*\.\.)/u);
    }
    for (const request of verifierA.requests) {
      expect(request).not.toHaveProperty("path");
      expect(request.locator).not.toHaveProperty("path");
    }
    expect(JSON.stringify(first)).not.toContain("/tmp/");
    expect(JSON.stringify(first)).not.toContain("/home/");
  });

  it("selects all immutable faces and records full versus subset embedding", async () => {
    const faces = [
      face("bold", { weight: 700, hash: H3 }),
      face("regular", { variableAxisCoordinates: { wght: 400 } }),
    ];
    const record = font(1, {
      faces,
      familyDigest: computeFontFamilyDigest(faces),
      pdfSubsettingPermitted: false,
    });
    const result = await resolveVerifiedResourceClosure({
      projection: projection([], [1]),
      index: buildIndex([], [record]),
      verifier: new ExactVerifier(),
    });
    const selected = result.fonts.find((entry) => entry.fontRef === fontRef(1));
    expect(selected?.selectedFaces.map((entry) => [entry.faceId, entry.embedding])).toEqual([
      ["bold", "full"],
      ["regular", "full"],
    ]);
    expect(result.fonts[0]?.selectedFaces[1]?.variationAxes).toEqual({ wght: 400 });
  });

  it("rejects missing, duplicate, unvalidated, and non-embeddable dependencies", async () => {
    const verifier = new ExactVerifier();
    const empty = buildIndex([], []);
    await expect(resolveVerifiedResourceClosure({
      projection: projection([1], []), index: empty, verifier,
    })).rejects.toMatchObject({ kind: "missingAsset", code: "CBB-ASSET-0001" });

    const assetIndex = buildIndex([asset(1)], []);
    await expect(resolveVerifiedResourceClosure({
      projection: {
        referencedAssets: [{ assetRef: assetRef(1) }, { assetRef: assetRef(1) }],
        referencedFonts: [
          { fontRef: BUNDLED_NOTO_SANS_FONT_REF },
          { fontRef: BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF },
        ],
        fontFallbackRefs: [
          BUNDLED_NOTO_SANS_FONT_REF,
          BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF,
        ],
      },
      index: assetIndex,
      verifier,
    })).rejects.toMatchObject({ kind: "invalidProjectionClosure" });

    await expect(resolveVerifiedResourceClosure({
      projection: projection([1], []),
      index: buildIndex([asset(1, { sanitizationState: "pending" })], []),
      verifier,
    })).rejects.toMatchObject({ kind: "assetNotValidated" });

    await expect(resolveVerifiedResourceClosure({
      projection: projection([], [1]),
      index: buildIndex([], [font(1, { pdfEmbeddingPermitted: false })]),
      verifier,
    })).rejects.toMatchObject({ kind: "fontEmbeddingBlocked", code: "CBB-FONT-0003" });
  });

  it("rejects ambiguous family selectors before any bytes are opened", async () => {
    const verifier = new ExactVerifier();
    await expect(resolveVerifiedResourceClosure({
      projection: projection([], [1, 2]),
      index: buildIndex([], [
          font(1, { typstFamilyName: "Same Family" }),
          font(2, { typstFamilyName: "same family" }),
      ]),
      verifier,
    })).rejects.toMatchObject({ kind: "ambiguousFontFamily" });
    expect(verifier.requests).toHaveLength(0);
  });

  it("rehashes every selected binary and redacts verifier implementation failures", async () => {
    const index = buildIndex([asset(1)], []);
    await expect(resolveVerifiedResourceClosure({
      projection: projection([1], []),
      index,
      verifier: {
        async verify() {
          throw new Error("private file /home/alice/workspace/assets/secret");
        },
      },
    })).rejects.toEqual(expect.objectContaining({
      kind: "byteVerificationFailed",
      code: "CBB-SECURITY-0001",
      message: expect.not.stringContaining("/home/alice"),
    }));

    await expect(resolveVerifiedResourceClosure({
      projection: projection([1], []),
      index,
      verifier: {
        async verify(request) {
          return { observedHash: H3, observedByteSize: request.expectedByteSize };
        },
      },
    })).rejects.toMatchObject({ kind: "byteVerificationFailed" });
  });

  it("enforces deterministic aggregate caps at exact and one-over boundaries", async () => {
    const atAssetCap = Array.from({ length: 8 }, (_, index) => asset(index + 1, {
      byteSize: RESOURCE_CLOSURE_LIMITS.assetFileBytesHard,
    }));
    atAssetCap.push(asset(9, {
      byteSize:
        RESOURCE_CLOSURE_LIMITS.assetTotalBytesHard -
        8 * RESOURCE_CLOSURE_LIMITS.assetFileBytesHard,
    }));
    await expect(resolveVerifiedResourceClosure({
      projection: projection(atAssetCap.map((_, index) => index + 1), []),
      index: buildIndex(atAssetCap, []),
      verifier: new ExactVerifier(),
    })).resolves.toMatchObject({ totals: { assetBytes: RESOURCE_CLOSURE_LIMITS.assetTotalBytesHard } });

    const overAssetCap = [...atAssetCap, asset(10, { byteSize: 1 })];
    await expect(resolveVerifiedResourceClosure({
      projection: projection(overAssetCap.map((_, index) => index + 1), []),
      index: buildIndex(overAssetCap, []),
      verifier: new ExactVerifier(),
    })).rejects.toMatchObject({ kind: "resourceLimitExceeded" });

    const refsAtCountCap = Array.from(
      { length: RESOURCE_CLOSURE_LIMITS.assetCountHard },
      (_, index) => ({ assetRef: assetRef(index + 1) }),
    );
    await expect(resolveVerifiedResourceClosure({
      projection: {
        ...projection([], []),
        referencedAssets: refsAtCountCap,
      },
      index: buildIndex([], []),
      verifier: new ExactVerifier(),
    })).rejects.toMatchObject({ kind: "missingAsset" });
    await expect(resolveVerifiedResourceClosure({
      projection: {
        ...projection([], []),
        referencedAssets: [...refsAtCountCap, { assetRef: assetRef(9_999) }],
      },
      index: buildIndex([], []),
      verifier: new ExactVerifier(),
    })).rejects.toMatchObject({ kind: "resourceLimitExceeded" });
  });

  it("emits stable warnings only when a warning threshold is crossed", async () => {
    const record = asset(1, { byteSize: RESOURCE_CLOSURE_LIMITS.assetFileBytesWarning + 1 });
    const result = await resolveVerifiedResourceClosure({
      projection: projection([1], []),
      index: buildIndex([record], []),
      verifier: new ExactVerifier(),
    });
    expect(result.warnings).toContainEqual({
      kind: "assetFileBytes",
      observed: RESOURCE_CLOSURE_LIMITS.assetFileBytesWarning + 1,
      warningThreshold: RESOURCE_CLOSURE_LIMITS.assetFileBytesWarning,
      subject: assetRef(1),
    });
  });

  it("uses ResourceContractError as the stable public failure class", async () => {
    try {
      await resolveVerifiedResourceClosure({
        projection: projection([1], []),
        index: buildIndex([], []),
        verifier: new ExactVerifier(),
      });
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ResourceContractError);
    }
  });
});
