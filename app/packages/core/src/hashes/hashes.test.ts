import { describe, expect, it } from "vitest";
import type { Sha256Hash } from "../canonical/index.js";
import { canonicalStringify, hashCanonical } from "../canonical/index.js";
import type {
  CbbDocument,
  CustomElementDefinition,
  FieldContract,
  FieldDefinition,
  NativeElement,
} from "../document/types.js";
import type { RichTextDocument } from "../richtext/index.js";
import { resolveDocument } from "../resolve/index.js";
import {
  canonicalRevisionToken,
  createSanitizedRenderProjection,
  fieldContractHash,
  HashInputError,
  projectDocumentReadinessState,
  readinessInputHash,
  renderInputHash,
} from "./index.js";
import type {
  ReadinessEvidenceRecord,
  ReadinessHashInput,
  RenderHashInput,
  SanitizedRenderProjection,
  VerifiedAssetIdentity,
} from "./index.js";

const H_A = `sha256:${"a".repeat(64)}` as Sha256Hash;
const H_B = `sha256:${"b".repeat(64)}` as Sha256Hash;
const H_C = `sha256:${"c".repeat(64)}` as Sha256Hash;
const H_D = `sha256:${"d".repeat(64)}` as Sha256Hash;

const ASSET_A = "asset:11111111-1111-4111-8111-111111111111";
const ASSET_B = "asset:22222222-2222-4222-8222-222222222222";
const FONT_A = "font:33333333-3333-4333-8333-333333333333";

function projection(...texts: readonly string[]): SanitizedRenderProjection {
  return createSanitizedRenderProjection({
    page: { height: "11in", width: "8.5in" },
    locale: "en-US",
    body: texts.map((text) => ({ type: "text", text })),
    referencedAssets: [{ assetRef: ASSET_A }, { assetRef: ASSET_B }],
    referencedFonts: [{ fontRef: FONT_A }],
  });
}

function asset(
  assetRef: string,
  binaryHash: Sha256Hash,
  mediaType = "image/png",
): VerifiedAssetIdentity {
  return { assetRef, binaryHash, mediaType };
}

function baseRenderInput(
  projectionValue: SanitizedRenderProjection = projection("Alpha", "Beta"),
): RenderHashInput {
  return {
    projection: projectionValue,
    assets: [asset(ASSET_A, H_A), asset(ASSET_B, H_B, "image/jpeg")],
    fonts: [
      {
        fontRef: FONT_A,
        familyDigest: H_C,
        selectedFaces: [
          {
            faceId: "regular",
            faceHash: H_A,
            faceIndex: 0,
            embedding: "subset",
          },
          {
            faceId: "bold",
            faceHash: H_B,
            faceIndex: 1,
            embedding: "subset",
            variationAxes: { wght: 700 },
          },
        ],
      },
    ],
    tools: [
      { toolId: "typst", version: "0.13.1", toolHash: H_A },
      { toolId: "cbb-typst-generator", version: "1.0.0", toolHash: H_B },
    ],
    locale: {
      languageTag: "en-US",
      dataVersion: "cldr-47",
      dataHash: H_D,
    },
    outputOptions: {
      outputForm: "readerOrder",
      pdfConformance: "standard",
      watermark: { kind: "none" },
    },
  };
}

function baseDocument(): CbbDocument {
  return {
    version: 1,
    kind: "bulletin",
    name: "July 12 Bulletin",
    metadata: {
      title: "Worship",
      language: "en-US",
      publicationDate: "2026-07-12",
      serviceLabel: "Sunday Worship",
    },
    page: {
      typstWidth: "8.5in",
      typstHeight: "11in",
      printSafeInset: { top: "0.25in", right: "0.25in", bottom: "0.25in", left: "0.25in" },
      bookletPrintSetup: {
        sheetWidth: "11in",
        sheetHeight: "8.5in",
        duplexFlip: "shortEdge",
        scale: 1,
        safeInset: {
          top: "0.25in",
          right: "0.25in",
          bottom: "0.25in",
          left: "0.25in",
          fold: "0.125in",
        },
      },
      finalPageCountRequirement: { multipleOf: 4 },
    },
    authoringPolicy: { contentLocked: false, layoutLocked: false },
    rightsPolicy: { unknownRightsPolicy: "review" },
    publicationContexts: [
      "printedNonsalableChurchBulletin",
      "digitalNonsalableChurchBulletin",
    ],
    fieldReview: [
      {
        target: { scope: "document", fieldId: "serviceDate" },
        disposition: "confirmedUnchanged",
        reviewHash: H_A,
      },
    ],
    contentReview: [
      {
        target: { scope: "document", targetNodeId: "announcement" },
        disposition: "edited",
        reviewHash: H_B,
      },
    ],
    elements: [
      {
        id: "song",
        type: "music",
        name: "Opening Hymn",
        weeklyReview: "everyBulletin",
        data: {
          title: "Amazing Grace",
          rightsAssociationReview: {
            reviewedSongContentHash: H_A,
            reviewedRightsProjectionHash: H_B,
            reviewTime: "2026-07-12T12:00:00Z",
          },
          rights: [
            {
              creditKey: "credit:44444444-4444-4444-8444-444444444444",
              creditProjectionHash: H_C,
              component: "text",
              status: "copyrighted",
              contributors: [],
              creditRequiredWhen: "always",
              requiredCreditLine: "Used by permission.",
              publicationLicenseDisplay: {
                providerLabel: "License provider",
                displayLine: "License 123",
                sourceDisplayRevisionHash: H_D,
                effectiveFrom: "2026-01-01",
                effectiveThrough: "2026-12-31",
              },
            },
          ],
        },
      },
      {
        id: "reading",
        type: "text",
        name: "Reading",
        data: {
          content: {
            kind: "richText",
            document: {
              type: "document",
              blocks: [
                {
                  type: "scripture",
                  structureKind: "paragraphOnly",
                  reference: "John 3:16",
                  translationId: "translation:55555555-5555-4555-8555-555555555555",
                  translationLabel: "Example",
                  paragraphs: [
                    {
                      type: "paragraph",
                      children: [{ type: "text", text: "For God so loved" }],
                    },
                  ],
                  rights: [
                    {
                      creditKey: "credit:66666666-6666-4666-8666-666666666666",
                      creditProjectionHash: H_A,
                      component: "scriptureTranslation",
                      status: "unknown",
                      contributors: [],
                      creditRequiredWhen: "never",
                    },
                  ],
                  importSnapshot: {
                    sourceKind: "provider",
                    structureKind: "paragraphOnly",
                    displayReference: "John 3:16",
                    translationId: "translation:55555555-5555-4555-8555-555555555555",
                    translationLabel: "Example",
                    normalizerId: "scripture-normalizer",
                    normalizerVersion: "1.0.0",
                    sourceText: "Raw source text",
                    sourceTextHash: H_B,
                    importedFidelityHash: H_C,
                    rightsProjectionHash: H_D,
                    paragraphBoundaries: [{
                      paragraphIndex: 0,
                      content: "For God so loved",
                    }],
                    providerId: "provider",
                    adapterId: "adapter",
                    adapterVersion: "1",
                    requestedReference: "John 3:16",
                    requestedTranslationId: "translation:55555555-5555-4555-8555-555555555555",
                    retrievalTime: "2026-07-10T12:00:00Z",
                    sourceUrl: "https://example.invalid/passage",
                  },
                  importReview: {
                    disposition: "changesConfirmed",
                    reviewedFidelityHash: H_C,
                    reviewedRightsProjectionHash: H_D,
                    reviewTime: "2026-07-12T12:30:00Z",
                  },
                },
              ],
            },
          },
        },
      },
    ],
    sourceTemplate: {
      contractId: "77777777-7777-4777-8777-777777777777",
      sourceDisplayName: "Old template",
      sourceDocumentHash: H_A,
    },
    orphanedFieldValues: { oldField: { value: "unused" } },
  } as unknown as CbbDocument;
}

function scriptureDocumentFixture(): RichTextDocument {
  const reading = baseDocument().elements[1];
  if (
    reading?.type !== "text" ||
    reading.data.content.kind !== "richText"
  ) {
    throw new Error("scripture fixture missing");
  }
  return structuredClone(reading.data.content.document);
}

function resolvedReadinessProjection(
  document: CbbDocument,
  verifyDefinitionHashes = true,
) {
  const resolved = resolveDocument(document, { verifyDefinitionHashes });
  return projectDocumentReadinessState(
    document,
    resolved.readinessSources,
    resolved.readinessFieldUses,
  );
}

function readinessInput(document: CbbDocument = baseDocument()): ReadinessHashInput {
  return {
    renderInputHash: renderInputHash(baseRenderInput()),
    profile: { profileId: "printFinal", version: "1", rulesHash: H_A },
    projection: resolvedReadinessProjection(document, false),
    evidence: [
      {
        kind: "dependencyValidation",
        subject: "all-resources",
        status: "pass",
        evidenceHash: H_B,
      },
      {
        kind: "pageCountEvaluation",
        subject: "logical-pages",
        status: "pass",
        evidenceHash: H_C,
      },
    ],
  };
}

describe("canonicalRevisionToken", () => {
  it("uses RFC 8785 key ordering and a stable SHA-256", () => {
    const left = canonicalRevisionToken({ b: 2, a: 1 });
    const right = canonicalRevisionToken({ a: 1, b: 2 });
    expect(left).toBe(right);
    expect(left).toBe(
      "sha256:43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777",
    );
  });

  it("changes for every canonical document edit", () => {
    expect(canonicalRevisionToken({ version: 1, values: [1, 2] })).not.toBe(
      canonicalRevisionToken({ version: 1, values: [1, 3] }),
    );
  });

  it("fails closed for undefined and non-finite values", () => {
    expect(() => canonicalRevisionToken({ value: undefined })).toThrow(HashInputError);
    expect(() => canonicalRevisionToken({ value: Number.NaN })).toThrow(HashInputError);
  });
});

describe("fieldContractHash", () => {
  const contract: FieldContract = {
    id: "88888888-8888-4888-8888-888888888888",
    version: 1,
    name: "Weekly fields",
    fields: [{ id: "date", label: "Date", type: "date", required: true }],
    contractHash: H_A,
  };

  it("excludes only the self-referential contractHash", () => {
    expect(fieldContractHash(contract)).toBe(
      fieldContractHash({ ...contract, contractHash: H_B }),
    );
  });

  it("changes for substantive contract edits", () => {
    expect(fieldContractHash(contract)).not.toBe(
      fieldContractHash({ ...contract, name: "Changed fields" }),
    );
  });
});

describe("sanitized render projection", () => {
  it("is stable across object insertion order", () => {
    const first = createSanitizedRenderProjection({
      page: { width: "8.5in", height: "11in" },
      body: [],
      referencedAssets: [{ assetRef: ASSET_A }, { assetRef: ASSET_B }],
      referencedFonts: [{ fontRef: FONT_A }],
    });
    const second = createSanitizedRenderProjection({
      referencedFonts: [{ fontRef: FONT_A }],
      referencedAssets: [{ assetRef: ASSET_A }, { assetRef: ASSET_B }],
      body: [],
      page: { height: "11in", width: "8.5in" },
    });
    expect(renderInputHash(baseRenderInput(first))).toBe(renderInputHash(baseRenderInput(second)));
  });

  it.each(["id", "name", "origin", "itemIds", "provenance", "fieldReview"])(
    "rejects forbidden persisted field %s",
    (field) => {
      expect(() => createSanitizedRenderProjection({ body: [{ [field]: "leak" }] })).toThrow(
        HashInputError,
      );
    },
  );

  it("allows arbitrary keys inside a schema-owned typography snapshot", () => {
    expect(() =>
      createSanitizedRenderProjection({
        scripturePresentation: {
          typographyPresetSnapshot: { id: "body", name: "Body" },
        },
      }),
    ).not.toThrow();
  });

  it("does not infer trusted ancestry from dots inside attacker-controlled keys", () => {
    expect(() =>
      createSanitizedRenderProjection({
        "fake.typographyPresetSnapshot": { name: "must remain forbidden" },
      }),
    ).toThrow(HashInputError);
    expect(() =>
      createSanitizedRenderProjection({
        "fake.rightsContributions": [{ creditKey: "credit:not-trusted" }],
      }),
    ).toThrow(HashInputError);
  });
});

describe("renderInputHash", () => {
  it("preserves authoritative render array order", () => {
    expect(renderInputHash(baseRenderInput(projection("Alpha", "Beta")))).not.toBe(
      renderInputHash(baseRenderInput(projection("Beta", "Alpha"))),
    );
  });

  it("normalizes unordered resource, face, and tool identity collections", () => {
    const input = baseRenderInput();
    const reordered: RenderHashInput = {
      ...input,
      assets: [...input.assets].reverse(),
      fonts: input.fonts.map((font) => ({
        ...font,
        selectedFaces: [...font.selectedFaces].reverse(),
      })),
      tools: [...input.tools].reverse(),
    };
    expect(renderInputHash(input)).toBe(renderInputHash(reordered));
  });

  it("deduplicates identical identities", () => {
    const input = baseRenderInput();
    expect(
      renderInputHash({ ...input, assets: [...input.assets, input.assets[0] as VerifiedAssetIdentity] }),
    ).toBe(renderInputHash(input));
  });

  it("rejects conflicting duplicate asset identities", () => {
    const input = baseRenderInput();
    expect(() =>
      renderInputHash({
        ...input,
        assets: [...input.assets, asset(ASSET_A, H_D)],
      }),
    ).toThrow(/conflicting identities for asset/);
  });

  it("rejects conflicting duplicate selected faces", () => {
    const input = baseRenderInput();
    const font = input.fonts[0];
    if (font === undefined) throw new Error("test fixture font missing");
    const firstFace = font.selectedFaces[0];
    if (firstFace === undefined) throw new Error("test fixture face missing");
    expect(() =>
      renderInputHash({
        ...input,
        fonts: [
          {
            ...font,
            selectedFaces: [...font.selectedFaces, { ...firstFace, faceHash: H_D }],
          },
        ],
      }),
    ).toThrow(/conflicting selected face/);
  });

  it("fails closed for invalid or missing dependency hashes", () => {
    const input = baseRenderInput();
    expect(() =>
      renderInputHash({
        ...input,
        assets: [{ ...input.assets[0], binaryHash: "sha256:ABC" }],
      } as unknown as RenderHashInput),
    ).toThrow(HashInputError);
    expect(() =>
      renderInputHash({
        ...input,
        tools: [{ toolId: "typst", version: "1" }],
      } as unknown as RenderHashInput),
    ).toThrow(/required field is missing/);
  });

  it("rejects referenced assets or fonts without verified identities", () => {
    const input = baseRenderInput(
      createSanitizedRenderProjection({
        body: [
          { type: "image", assetRef: ASSET_A },
          { type: "text", style: { fontRef: FONT_A }, text: "Hello" },
        ],
      }),
    );
    expect(() => renderInputHash({ ...input, assets: [] })).toThrow(
      /missing verified binary identity/,
    );
    expect(() => renderInputHash({ ...input, fonts: [] })).toThrow(
      /missing verified family\/face identity/,
    );
  });

  it("rejects verified resources outside the resolved reference closure", () => {
    const input = baseRenderInput(
      createSanitizedRenderProjection({
        referencedAssets: [{ assetRef: ASSET_A }],
        referencedFonts: [{ fontRef: FONT_A }],
      }),
    );
    expect(() => renderInputHash(input)).toThrow(/outside the resolved reference closure/);
  });

  it("changes for asset, font, tool, locale, and output-option changes", () => {
    const input = baseRenderInput();
    const original = renderInputHash(input);
    const font = input.fonts[0];
    if (font === undefined) throw new Error("test fixture font missing");
    expect(renderInputHash({
      ...input,
      assets: input.assets.map((value) =>
        value.assetRef === ASSET_A ? asset(ASSET_A, H_D) : value,
      ),
    })).not.toBe(original);
    expect(renderInputHash({ ...input, fonts: [{ ...font, familyDigest: H_D }] })).not.toBe(original);
    expect(
      renderInputHash({
        ...input,
        tools: input.tools.map((tool) =>
          tool.toolId === "typst" ? { ...tool, version: "0.14.0" } : tool,
        ),
      }),
    ).not.toBe(original);
    expect(
      renderInputHash({ ...input, locale: { ...input.locale, languageTag: "de-DE" } }),
    ).not.toBe(original);
    expect(
      renderInputHash({
        ...input,
        outputOptions: {
          ...input.outputOptions,
          watermark: { kind: "proof", text: "PROOF", version: "1" },
        },
      }),
    ).not.toBe(original);
  });

  it("enforces the closed output-options contract", () => {
    const input = baseRenderInput();
    expect(() =>
      renderInputHash({
        ...input,
        outputOptions: { ...input.outputOptions, printerSafeInset: "0.25in" },
      } as unknown as RenderHashInput),
    ).toThrow(/unknown field/);
  });
});

describe("document readiness projection", () => {
  it("materializes defaults and normalizes publication-context set order", () => {
    const document = baseDocument();
    const reversed = {
      ...document,
      publicationContexts: [...(document.publicationContexts ?? [])].reverse(),
    } as CbbDocument;
    expect(resolvedReadinessProjection(document)).toEqual(
      resolvedReadinessProjection(reversed),
    );

    const withoutDefaults = {
      ...document,
      rightsPolicy: undefined,
      publicationContexts: undefined,
    } as unknown as CbbDocument;
    // Explicit undefined is rejected rather than silently omitted.
    expect(() =>
      resolvedReadinessProjection(withoutDefaults),
    ).toThrow(HashInputError);
  });

  it("excludes inert lineage and raw Scripture source URL/text/retrieval time", () => {
    const original = baseDocument();
    const changed = structuredClone(original) as unknown as Record<string, unknown>;
    changed["name"] = "Renamed only";
    changed["authoringPolicy"] = { contentLocked: true, layoutLocked: true };
    changed["sourceTemplate"] = {
      contractId: "99999999-9999-4999-8999-999999999999",
      sourceDisplayName: "Different lineage",
      sourceDocumentHash: H_D,
    };
    const elements = changed["elements"] as Record<string, unknown>[];
    const richDocument = (((elements[1] as Record<string, unknown>)["data"] as Record<string, unknown>)[
      "content"
    ] as Record<string, unknown>)["document"] as Record<string, unknown>;
    const scripture = (richDocument["blocks"] as Record<string, unknown>[])[0] as Record<
      string,
      unknown
    >;
    const snapshot = scripture["importSnapshot"] as Record<string, unknown>;
    snapshot["sourceText"] = "Different raw text that is not active content";
    snapshot["sourceUrl"] = "https://example.invalid/other";
    snapshot["retrievalTime"] = "2026-07-11T12:00:00Z";

    expect(canonicalStringify(
      resolvedReadinessProjection(original),
    )).toBe(
      canonicalStringify(
        resolvedReadinessProjection(changed as unknown as CbbDocument),
      ),
    );
  });

  it("treats typography preset snapshots as opaque instead of key-sniffing readiness", () => {
    const original = baseDocument();
    const changed = structuredClone(original) as unknown as Record<string, unknown>;
    const elements = changed["elements"] as Record<string, unknown>[];
    const richDocument = (((elements[1] as Record<string, unknown>)["data"] as Record<string, unknown>)[
      "content"
    ] as Record<string, unknown>)["document"] as Record<string, unknown>;
    const scripture = (richDocument["blocks"] as Record<string, unknown>[])[0] as Record<
      string,
      unknown
    >;
    scripture["formattingOverride"] = {
      referencePlacement: "before",
      verseNumberStyle: "superscript",
      paragraphPolicy: "publisher",
      paragraphSpacing: "6pt",
      translationLabelPlacement: "withReference",
      typographyPresetSnapshot: {
        rights: "opaque typography metadata, not a rights array",
        weeklyReview: "everyBulletin",
        importReview: { disposition: "opaque" },
      },
    };

    const originalProjection = resolvedReadinessProjection(original);
    const changedDocument = changed as unknown as CbbDocument;
    const changedProjection = resolvedReadinessProjection(changedDocument);
    expect(canonicalStringify(changedProjection)).toBe(
      canonicalStringify(originalProjection),
    );
  });

  it("includes weekly review, rights association, policy, and import review evidence", () => {
    const document = baseDocument();
    const projected = resolvedReadinessProjection(document);
    expect(projected.weeklyReviews).toHaveLength(1);
    expect(projected.rightsAssociations).toHaveLength(1);
    expect(projected.rightsRecords).toHaveLength(2);
    expect(projected.scriptureImports).toHaveLength(1);
    expect(projected.pageChecks).toMatchObject({
      finalPageCountRequirement: { multipleOf: 4 },
    });
  });

  it("excludes readiness state owned only by an inactive resolved branch", () => {
    const original: CbbDocument = {
      ...baseDocument(),
      fieldContract: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        version: 1,
        name: "Conditional fields",
        fields: [
          { id: "showSong", label: "Show song", type: "boolean", required: true },
        ],
      },
      fieldValues: {
        showSong: { value: false, origin: "manual" },
      },
      contentRules: [
        {
          kind: "conditional",
          id: "showSongRule",
          targetNodeId: "song",
          scope: "document",
          fieldId: "showSong",
          condition: { kind: "booleanEquals", value: true },
          activateLabel: "Include song",
          inactiveLabel: "Song not used",
        },
      ],
    };
    const changed = structuredClone(original) as unknown as CbbDocument;
    const changedSong = changed.elements[0];
    if (changedSong?.type !== "music") throw new Error("song fixture missing");
    (changedSong as unknown as { weeklyReview: string }).weeklyReview = "none";
    const rights = changedSong.data.rights;
    if (rights?.[0] === undefined) throw new Error("rights fixture missing");
    (rights[0] as unknown as { requiredCreditLine: string }).requiredCreditLine =
      "Changed while inactive";

    const originalProjection = resolvedReadinessProjection(original);
    const changedProjection = resolvedReadinessProjection(changed);
    expect(canonicalStringify(changedProjection)).toBe(
      canonicalStringify(originalProjection),
    );
    expect(originalProjection.weeklyReviews).toEqual([]);
    expect(originalProjection.rightsAssociations).toEqual([]);
    expect(originalProjection.rightsRecords).toHaveLength(1);
  });

  it("projects complete active field and content review context without inert binding leakage", () => {
    const document: CbbDocument = {
      version: 1,
      kind: "bulletin",
      name: "Review context",
      page: { typstWidth: "8.5in", typstHeight: "11in" },
      fieldContract: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        version: 4,
        name: "Review fields",
        fields: [
          {
            id: "label",
            label: "Label",
            type: "text",
            required: true,
            weeklyBehavior: {
              rolloverPolicy: "ask",
              reviewExpectation: "everyBulletin",
            },
          },
          { id: "show", label: "Show", type: "boolean", required: true },
        ],
      },
      fieldValues: {
        label: { value: "Rendered", origin: "manual" },
        show: { value: true, origin: "manual" },
      },
      fieldReview: [
        {
          target: { scope: "document", fieldId: "label" },
          disposition: "edited",
          reviewHash: H_A,
        },
      ],
      contentReview: [
        {
          target: { scope: "document", targetNodeId: "reviewedText" },
          disposition: "edited",
          reviewHash: H_B,
        },
      ],
      contentRules: [
        {
          kind: "conditional",
          id: "showReviewedText",
          targetNodeId: "reviewedText",
          scope: "document",
          fieldId: "show",
          condition: { kind: "booleanEquals", value: true },
          activateLabel: "Show",
          inactiveLabel: "Hide",
        },
      ],
      elements: [
        {
          id: "reviewedText",
          type: "text",
          name: "Reviewed text",
          bindings: [
            {
              id: "labelBinding",
              scope: "document",
              fieldId: "label",
              target: "/data/content/text",
              fallback: "Unused fallback",
            },
          ],
          data: { content: { kind: "plain", text: "stale" } },
        },
      ],
    };

    const resolved = resolveDocument(document);
    const projected = projectDocumentReadinessState(
      document,
      resolved.readinessSources,
      resolved.readinessFieldUses,
    );
    const labelContext = projected.fieldReviewContexts.find((value) =>
      (value as Record<string, unknown>)["target"] !== undefined &&
      ((value as Record<string, unknown>)["target"] as Record<string, unknown>)[
        "fieldId"
      ] === "label",
    ) as Record<string, unknown>;
    expect(labelContext).toMatchObject({
      target: { scope: "document", fieldId: "label" },
      contract: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        version: 4,
      },
      effectiveValue: {
        state: "present",
        valueHash: hashCanonical("Rendered"),
      },
      activeBindings: [{ id: "labelBinding" }],
    });
    expect(projected.contentReviewContexts).toEqual([
      {
        target: { scope: "document", targetNodeId: "reviewedText" },
        activeConditionalRules: [
          expect.objectContaining({
            id: "showReviewedText",
            activation: "active",
            controllerTarget: { scope: "document", fieldId: "show" },
          }),
        ],
      },
    ]);

    const renamedBinding = structuredClone(document);
    const renamedText = renamedBinding.elements[0];
    if (renamedText?.type !== "text" || renamedText.bindings?.[0] === undefined) {
      throw new Error("bound review fixture missing");
    }
    (renamedText.bindings[0] as unknown as { id: string }).id = "renamedBinding";
    expect(resolveDocument(renamedBinding).projection).toEqual(resolved.projection);
    expect(resolvedReadinessProjection(renamedBinding)).not.toEqual(projected);

    const unusedFallbackChanged = structuredClone(document);
    const fallbackText = unusedFallbackChanged.elements[0];
    if (fallbackText?.type !== "text" || fallbackText.bindings?.[0] === undefined) {
      throw new Error("bound review fixture missing");
    }
    (fallbackText.bindings[0] as unknown as { fallback: string }).fallback =
      "Different unused fallback";
    expect(resolvedReadinessProjection(unusedFallbackChanged)).toEqual(projected);

    const fallbackUsed = structuredClone(document);
    delete (fallbackUsed.fieldValues as unknown as Record<string, unknown>)["label"];
    const fallbackProjection = resolvedReadinessProjection(fallbackUsed);
    const fallbackContext = fallbackProjection.fieldReviewContexts.find((value) =>
      ((value as Record<string, unknown>)["target"] as Record<string, unknown>)[
        "fieldId"
      ] === "label",
    ) as Record<string, unknown>;
    expect(fallbackContext).toMatchObject({
      effectiveValue: { state: "missing" },
      activeBindings: [
        { id: "labelBinding", fallbackHash: hashCanonical("Unused fallback") },
      ],
    });

    const policyChanged = structuredClone(document);
    const labelField = policyChanged.fieldContract?.fields[0];
    if (labelField?.weeklyBehavior === undefined) {
      throw new Error("review field fixture missing");
    }
    (labelField.weeklyBehavior as unknown as { reviewExpectation: string })
      .reviewExpectation = "whenCarried";
    expect(resolveDocument(policyChanged).projection).toEqual(resolved.projection);
    expect(resolvedReadinessProjection(policyChanged)).not.toEqual(projected);

    const originChanged = structuredClone(document);
    const labelValue = originChanged.fieldValues?.["label"];
    if (labelValue === undefined) throw new Error("review value fixture missing");
    (labelValue as unknown as { origin: string }).origin = "ai";
    expect(resolvedReadinessProjection(originChanged)).toEqual(projected);

    const inactive = structuredClone(document);
    const showValue = inactive.fieldValues?.["show"];
    if (showValue === undefined) throw new Error("conditional fixture missing");
    (showValue as unknown as { value: boolean }).value = false;
    const inactiveRenamed = structuredClone(inactive);
    const inactiveText = inactiveRenamed.elements[0];
    if (inactiveText?.type !== "text" || inactiveText.bindings?.[0] === undefined) {
      throw new Error("bound review fixture missing");
    }
    (inactiveText.bindings[0] as unknown as { id: string }).id = "inactiveRename";
    expect(resolvedReadinessProjection(inactiveRenamed)).toEqual(
      resolvedReadinessProjection(inactive),
    );

    const repeated = structuredClone(document);
    (repeated.fieldContract?.fields as FieldDefinition[]).push({
        id: "items",
        label: "Items",
        type: "array",
        required: true,
        constraints: { maxItems: 3 },
        itemField: { id: "item", label: "Item", type: "text", required: true },
      });
    (repeated.fieldValues as unknown as Record<string, unknown>)["items"] = {
      value: ["One"],
      origin: "manual",
      itemIds: ["11111111-1111-4111-8111-111111111111"],
    };
    (repeated.contentRules as unknown as Record<string, unknown>[]).push({
      kind: "repeat",
      id: "repeatItems",
      fieldId: "items",
      prototypeNodeId: "itemPrototype",
      itemBindings: [
        {
          id: "itemTextBinding",
          itemPath: "",
          targetNodeId: "itemPrototype",
          target: "/data/content/text",
        },
      ],
      emptyState: { mode: "collapse" },
      maxItems: 2,
      userReorderable: true,
      itemLabel: "Item",
      addLabel: "Add item",
    });
    (repeated.elements as unknown as NativeElement[]).push({
      id: "itemPrototype",
      type: "text",
      name: "Item",
      data: { content: { kind: "plain", text: "stale" } },
    });
    const repeatedProjection = resolvedReadinessProjection(repeated);
    const changedMax = structuredClone(repeated);
    const repeatRule = changedMax.contentRules?.[1];
    if (repeatRule?.kind !== "repeat") throw new Error("repeat fixture missing");
    (repeatRule as unknown as { maxItems: number }).maxItems = 3;
    expect(resolveDocument(changedMax).projection).toEqual(
      resolveDocument(repeated).projection,
    );
    expect(resolvedReadinessProjection(changedMax)).not.toEqual(
      repeatedProjection,
    );

    const changedItemLabel = structuredClone(repeated);
    const labelRule = changedItemLabel.contentRules?.[1];
    if (labelRule?.kind !== "repeat") throw new Error("repeat fixture missing");
    (labelRule as unknown as { itemLabel: string }).itemLabel = "Entry";
    expect(resolvedReadinessProjection(changedItemLabel)).toEqual(
      repeatedProjection,
    );
  });

  it("projects Scripture readiness from an authoritative document binding", () => {
    const document: CbbDocument = {
      ...baseDocument(),
      fieldContract: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        version: 1,
        name: "Bound passage",
        fields: [
          {
            id: "passage",
            label: "Passage",
            type: "richText",
            required: true,
          },
        ],
      },
      fieldValues: {
        passage: { value: scriptureDocumentFixture(), origin: "manual" },
      },
      elements: [
        {
          id: "boundReading",
          type: "text",
          name: "Bound reading",
          weeklyReview: "everyBulletin",
          bindings: [
            {
              id: "passageBinding",
              scope: "document",
              fieldId: "passage",
              target: "/data/content",
            },
          ],
          data: { content: { kind: "plain", text: "stale literal" } },
        },
      ],
    };

    const resolved = resolveDocument(document);
    const projected = projectDocumentReadinessState(
      document,
      resolved.readinessSources,
      resolved.readinessFieldUses,
    );
    expect(resolved.readinessSources).toHaveLength(1);
    expect(projected.weeklyReviews).toEqual([
      { path: "/elements/boundReading", expectation: "everyBulletin" },
    ]);
    expect(projected.scriptureImports).toHaveLength(1);
    expect(projected.rightsRecords).toHaveLength(1);
    expect(projected.rightsRecords[0]?.path).toContain("/data/content/document");
  });

  it("does not materialize readiness from a conditionally inactive binding", () => {
    const document: CbbDocument = {
      ...baseDocument(),
      fieldContract: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        version: 1,
        name: "Conditional passage",
        fields: [
          { id: "show", label: "Show", type: "boolean", required: true },
          {
            id: "passage",
            label: "Passage",
            type: "richText",
            required: true,
          },
        ],
      },
      fieldValues: {
        show: { value: false, origin: "manual" },
        passage: { value: scriptureDocumentFixture(), origin: "manual" },
      },
      contentRules: [
        {
          kind: "conditional",
          id: "showBoundReading",
          targetNodeId: "hiddenBoundReading",
          scope: "document",
          fieldId: "show",
          condition: { kind: "booleanEquals", value: true },
          activateLabel: "Show reading",
          inactiveLabel: "Hide reading",
        },
      ],
      elements: [
        {
          id: "hiddenBoundReading",
          type: "text",
          name: "Hidden bound reading",
          weeklyReview: "everyBulletin",
          bindings: [
            {
              id: "hiddenPassageBinding",
              scope: "document",
              fieldId: "passage",
              target: "/data/content",
            },
          ],
          data: { content: { kind: "plain", text: "stale literal" } },
        },
      ],
    };

    const resolved = resolveDocument(document);
    const projected = projectDocumentReadinessState(
      document,
      resolved.readinessSources,
      resolved.readinessFieldUses,
    );
    expect(resolved.readinessSources).toEqual([]);
    expect(projected.weeklyReviews).toEqual([]);
    expect(projected.scriptureImports).toEqual([]);
    expect(projected.rightsRecords).toEqual([]);
  });

  it("projects each repeated item's bound Scripture readiness at a stable item path", () => {
    const firstId = "11111111-1111-4111-8111-111111111111";
    const secondId = "22222222-2222-4222-8222-222222222222";
    const document: CbbDocument = {
      ...baseDocument(),
      fieldContract: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        version: 1,
        name: "Repeated passages",
        fields: [
          {
            id: "passages",
            label: "Passages",
            type: "array",
            required: true,
            itemField: {
              id: "passage",
              label: "Passage",
              type: "richText",
              required: true,
            },
            constraints: { maxItems: 2 },
          },
        ],
      },
      fieldValues: {
        passages: {
          value: [scriptureDocumentFixture(), scriptureDocumentFixture()],
          origin: "manual",
          itemIds: [firstId, secondId],
        },
      },
      contentRules: [
        {
          kind: "repeat",
          id: "repeatPassages",
          fieldId: "passages",
          prototypeNodeId: "passagePrototype",
          itemBindings: [
            {
              id: "repeatPassageBinding",
              itemPath: "",
              targetNodeId: "passagePrototype",
              target: "/data/content",
            },
          ],
          emptyState: { mode: "collapse" },
          maxItems: 2,
          userReorderable: true,
          itemLabel: "Passage",
          addLabel: "Add passage",
        },
      ],
      elements: [
        {
          id: "passagePrototype",
          type: "text",
          name: "Passage prototype",
          data: { content: { kind: "plain", text: "stale literal" } },
        },
      ],
    };

    const resolved = resolveDocument(document);
    const projected = projectDocumentReadinessState(
      document,
      resolved.readinessSources,
      resolved.readinessFieldUses,
    );
    expect(resolved.readinessSources.map((source) => source.path)).toEqual([
      `/elements/passagePrototype/repeat/repeatPassages/${firstId}`,
      `/elements/passagePrototype/repeat/repeatPassages/${secondId}`,
    ]);
    expect(projected.scriptureImports).toHaveLength(2);
    expect(projected.rightsRecords).toHaveLength(2);
    expect(projected.scriptureImports.map((entry) => entry.path)).toEqual([
      expect.stringContaining(firstId),
      expect.stringContaining(secondId),
    ]);
  });

  it("projects Scripture readiness after custom-instance local binding", () => {
    const definition: CustomElementDefinition = {
      version: 1,
      kind: "customElementDefinition",
      id: "readingDefinition",
      name: "Reading definition",
      fieldContract: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        version: 1,
        name: "Reading fields",
        fields: [
          {
            id: "passage",
            label: "Passage",
            type: "richText",
            required: true,
          },
        ],
      },
      elements: [
        {
          id: "customReading",
          type: "text",
          name: "Custom reading",
          bindings: [
            {
              id: "customPassageBinding",
              scope: "local",
              fieldId: "passage",
              target: "/data/content",
            },
          ],
          data: { content: { kind: "plain", text: "stale literal" } },
        },
      ],
    };
    const document: CbbDocument = {
      ...baseDocument(),
      customElementDefinitions: [definition],
      elements: [
        {
          id: "readingInstance",
          type: "customInstance",
          name: "Reading instance",
          definitionId: definition.id,
          fieldValues: {
            passage: { value: scriptureDocumentFixture(), origin: "manual" },
          },
        },
      ],
    };

    const resolved = resolveDocument(document);
    const projected = projectDocumentReadinessState(
      document,
      resolved.readinessSources,
      resolved.readinessFieldUses,
    );
    const customSource = resolved.readinessSources.find(
      (source) => source.element.id === "customReading",
    );
    expect(customSource?.path).toBe(
      "/elements/readingInstance/definition/readingDefinition/customReading",
    );
    expect(customSource?.provenance.expansions).toMatchObject([
      { kind: "custom", ownerInstanceId: "readingInstance" },
    ]);
    expect(projected.scriptureImports).toHaveLength(1);
    expect(projected.rightsRecords).toHaveLength(1);
    expect(projected.scriptureImports[0]?.path).toContain("readingDefinition");
    expect(projected.fieldReviewContexts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        target: {
          scope: "local",
          ownerNodeId: "readingInstance",
          fieldId: "passage",
        },
        activeBindings: [{ id: "customPassageBinding" }],
      }),
    ]));
  });
});

describe("readinessInputHash", () => {
  it("changes for readiness-only edits while the render hash remains stable", () => {
    const originalDocument = baseDocument();
    const changedDocument = {
      ...originalDocument,
      rightsPolicy: { unknownRightsPolicy: "block" as const },
    };
    const originalRender = renderInputHash(baseRenderInput());
    const changedRender = renderInputHash(baseRenderInput());
    expect(changedRender).toBe(originalRender);
    expect(readinessInputHash(readinessInput(originalDocument))).not.toBe(
      readinessInputHash(readinessInput(changedDocument)),
    );
  });

  it("changes for field/content review, profile, render, and evidence edits", () => {
    const input = readinessInput();
    const original = readinessInputHash(input);
    const changedDocument = baseDocument();
    changedDocument.fieldReview?.[0];
    const changedReview = {
      ...changedDocument,
      fieldReview: changedDocument.fieldReview?.map((entry) => ({
        ...entry,
        disposition: "edited" as const,
      })),
    } as CbbDocument;
    expect(readinessInputHash(readinessInput(changedReview))).not.toBe(original);
    const changedContentReview = {
      ...baseDocument(),
      contentReview: baseDocument().contentReview?.map((entry) => ({
        ...entry,
        disposition: "notApplicable" as const,
      })),
    } as CbbDocument;
    expect(readinessInputHash(readinessInput(changedContentReview))).not.toBe(original);
    expect(
      readinessInputHash({
        ...input,
        profile: { ...input.profile, profileId: "accessibleFinal" },
      }),
    ).not.toBe(original);
    expect(readinessInputHash({ ...input, renderInputHash: H_D })).not.toBe(original);
    expect(
      readinessInputHash({
        ...input,
        evidence: input.evidence.map((entry) =>
          entry.kind === "pageCountEvaluation" ? { ...entry, evidenceHash: H_D } : entry,
        ),
      }),
    ).not.toBe(original);
  });

  it("normalizes semantically unordered evidence input", () => {
    const input = readinessInput();
    expect(readinessInputHash(input)).toBe(
      readinessInputHash({ ...input, evidence: [...input.evidence].reverse() }),
    );
  });

  it("deduplicates identical evidence and rejects conflicts", () => {
    const input = readinessInput();
    const first = input.evidence[0];
    if (first === undefined) throw new Error("test fixture evidence missing");
    expect(
      readinessInputHash({ ...input, evidence: [...input.evidence, first] }),
    ).toBe(readinessInputHash(input));
    const conflict: ReadinessEvidenceRecord = { ...first, status: "block" };
    expect(() =>
      readinessInputHash({ ...input, evidence: [...input.evidence, conflict] }),
    ).toThrow(/conflicting readiness evidence/);
  });

  it("rejects invalid hashes anywhere in projected readiness state", () => {
    const input = readinessInput();
    const projectionValue = structuredClone(input.projection) as unknown as Record<
      string,
      unknown
    >;
    (projectionValue["fieldReview"] as Record<string, unknown>[])[0]!["reviewHash"] =
      "bad-hash";
    expect(() =>
      readinessInputHash({
        ...input,
        projection: projectionValue as unknown as ReadinessHashInput["projection"],
      }),
    ).toThrow(HashInputError);
  });
});
