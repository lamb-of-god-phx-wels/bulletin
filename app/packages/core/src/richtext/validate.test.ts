import { describe, expect, it } from "vitest";
import type { RightsRecord } from "../document/types.js";
import type { ProviderImportSnapshot, RichTextDocument } from "./types.js";
import {
  isRichTextDocument,
  MAX_RICH_TEXT_UNICODE_SCALARS,
} from "./validate.js";

const TRANSLATION = "translation:11111111-1111-4111-8111-111111111111";
const REQUESTED_TRANSLATION = "translation:22222222-2222-4222-8222-222222222222";
const CREDIT = "credit:33333333-3333-4333-8333-333333333333";
const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const HASH_C = `sha256:${"c".repeat(64)}`;

function rights(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    creditKey: CREDIT,
    creditProjectionHash: HASH_A,
    component: "scriptureTranslation",
    status: "copyrighted",
    contributors: [],
    creditRequiredWhen: "always",
    requiredCreditLine: "Exact first line\nExact second line",
    ...overrides,
  };
}

function paragraphOnly(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    type: "scripture",
    structureKind: "paragraphOnly",
    translationId: TRANSLATION,
    paragraphs: [{ type: "paragraph", children: [] }],
    rights: [rights()],
    ...overrides,
  };
}

function documentWith(block: unknown): Record<string, unknown> {
  return { type: "document", blocks: [block] };
}

function nestedList(depth: number): Record<string, unknown> {
  return {
    type: "bulletList",
    children: [{
      type: "listItem",
      children: depth === 1
        ? [{ type: "paragraph", children: [] }]
        : [nestedList(depth - 1)],
    }],
  };
}

describe("isRichTextDocument", () => {
  it("accepts the closed ordinary AST and exactly four list levels", () => {
    expect(isRichTextDocument({
      type: "document",
      blocks: [
        { type: "heading", level: 2, children: [{ type: "text", text: "Grace" }] },
        {
          type: "blockquote",
          children: [{
            type: "orderedList",
            start: 2,
            children: [{
              type: "listItem",
              children: [{
                type: "paragraph",
                children: [{ type: "text", text: "Peace", marks: ["strong", "emphasis"] }],
              }],
            }],
          }],
        },
        nestedList(4),
      ],
    })).toBe(true);
  });

  it("accepts the schema-valid minimal paragraph-only Scripture shape", () => {
    const value: RichTextDocument = {
      type: "document",
      blocks: [{
        type: "scripture",
        structureKind: "paragraphOnly",
        translationId: TRANSLATION,
        paragraphs: [{ type: "paragraph", children: [] }],
        rights: [{
          creditKey: CREDIT,
          creditProjectionHash: HASH_A,
          component: "scriptureTranslation",
          status: "copyrighted",
          contributors: [],
          creditRequiredWhen: "always",
          requiredCreditLine: "Exact credit",
        }],
      }],
    };
    expect(isRichTextDocument(value)).toBe(true);
  });

  it("accepts a complete provider verse snapshot and every nested rights arm", () => {
    const opaqueTypography: Record<string, unknown> = {
      preset: "body",
      nested: [{ weight: 600, enabled: true, fallback: null }],
    };
    const providerSnapshot: ProviderImportSnapshot = {
      sourceKind: "provider",
      structureKind: "verseStructured",
      displayReference: "John 1:1",
      canonicalReference: "John.1.1",
      translationId: TRANSLATION,
      translationLabel: "Example",
      normalizerId: "normalizer",
      normalizerVersion: "1",
      sourceText: "In the beginning",
      sourceTextHash: HASH_A,
      importedFidelityHash: HASH_B,
      rightsProjectionHash: HASH_C,
      verseBoundaries: [{ verseId: "John.1.1", label: "1" }],
      providerId: "provider",
      adapterId: "adapter",
      adapterVersion: "1",
      requestedReference: "John 1:1",
      requestedTranslationId: REQUESTED_TRANSLATION,
      retrievalTime: "2026-07-12T12:34:56.789Z",
      sourceUrl: "https://example.invalid/passage",
    };
    const completeRights: RightsRecord = {
      creditKey: CREDIT,
      creditProjectionHash: HASH_A,
      component: "scriptureTranslation",
      status: "copyrighted",
      workTitle: "Example Translation",
      edition: "Second",
      arrangement: "Arrangement",
      tune: "Tune",
      translationIdentity: TRANSLATION,
      contributors: [{ name: "A Translator", role: "translator" }],
      copyrightYear: 2026,
      copyrightHolder: "Holder",
      administrator: "Administrator",
      licenseProvider: "Provider",
      providerSongId: "song-id",
      providerCatalogId: "catalog-id",
      providerReportingId: "reporting-id",
      creditRequiredWhen: "always",
      requiredCreditLine: "Exact first line\nExact second line",
      publicationLicenseDisplay: {
        providerLabel: "Provider",
        displayLine: "License 123",
        sourceDisplayRevisionHash: HASH_B,
        effectiveFrom: "2026-01-01",
        effectiveThrough: "2026-12-31",
      },
      usagePolicySnapshot: {
        providerRuleId: "rule",
        providerRuleVersion: "1",
        applicablePublicationContexts: [
          "printedNonsalableChurchBulletin",
          "digitalNonsalableChurchBulletin",
        ],
        quotationConstraints: [{
          metric: "portionBasisPoints",
          scope: "translation",
          limit: 100,
          basisMetric: "words",
          basisUnitCount: 100_000,
        }],
        requiredPublicationDisclosureLine: "Disclosure",
        policySourceHash: HASH_C,
        counterIdVersion: "counter@1",
      },
      metadataSourceHash: HASH_C,
      retrievalTime: "2026-07-12T12:34:56Z",
    };
    expect(isRichTextDocument(documentWith({
      type: "scripture",
      structureKind: "verseStructured",
      reference: "John 1:1",
      canonicalReference: "John.1.1",
      translationId: TRANSLATION,
      translationLabel: "Example",
      sourceCatalog: {
        translationId: TRANSLATION,
        catalogRevision: 1,
        revisionHash: HASH_A,
      },
      verses: [{
        verseId: "John.1.1",
        label: "😀".repeat(20),
        paragraphStart: true,
        children: [{ type: "lineBreak" }],
      }],
      formattingOverride: {
        referencePlacement: "after",
        verseNumberStyle: "inline",
        paragraphPolicy: "oneVerse",
        paragraphSpacing: "0.5in",
        translationLabelPlacement: "afterPassage",
        typographyPresetSnapshot: opaqueTypography,
      },
      importSnapshot: providerSnapshot,
      importReview: {
        disposition: "changesConfirmed",
        reviewedFidelityHash: HASH_A,
        reviewedRightsProjectionHash: HASH_B,
        reviewTime: "2026-07-12T12:34:56Z",
      },
      rights: [completeRights],
    }))).toBe(true);
  });

  it("accepts a complete paragraph-only paste snapshot", () => {
    expect(isRichTextDocument(documentWith(paragraphOnly({
      reference: "John 1",
      translationLabel: "Manual",
      canonicalReference: "",
      importSnapshot: {
        sourceKind: "paste",
        structureKind: "paragraphOnly",
        displayReference: "",
        translationId: TRANSLATION,
        translationLabel: "Manual",
        normalizerId: "paste",
        normalizerVersion: "1",
        sourceText: "",
        sourceTextHash: HASH_A,
        importedFidelityHash: HASH_B,
        rightsProjectionHash: HASH_C,
        paragraphBoundaries: [{ paragraphIndex: 0 }],
        sourceLabel: "Bulletin clipping",
        sourceUrl: "https://example.invalid",
      },
    })))).toBe(true);
  });

  it("counts the verse label bound in Unicode code points", () => {
    const base = {
      type: "scripture",
      structureKind: "verseStructured",
      reference: "Psalm",
      canonicalReference: "Ps.1.1",
      translationId: TRANSLATION,
      translationLabel: "Example",
      rights: [rights()],
    };
    expect(isRichTextDocument(documentWith({
      ...base,
      verses: [{ verseId: "Ps.1.1", label: "😀".repeat(20), paragraphStart: true, children: [] }],
    }))).toBe(true);
    expect(isRichTextDocument(documentWith({
      ...base,
      verses: [{ verseId: "Ps.1.1", label: "😀".repeat(21), paragraphStart: true, children: [] }],
    }))).toBe(false);
  });

  it("enforces the 5,000,000-scalar hard cap over rendered rich text", () => {
    const atLimit = "x".repeat(MAX_RICH_TEXT_UNICODE_SCALARS);
    expect(isRichTextDocument(documentWith({
      type: "paragraph",
      children: [{ type: "text", text: atLimit }],
    }))).toBe(true);
    expect(isRichTextDocument(documentWith({
      type: "paragraph",
      children: [{ type: "text", text: `${atLimit}x` }],
    }))).toBe(false);

    // Inert import source evidence is intentionally outside the rendered
    // rich-text scalar budget.
    expect(isRichTextDocument(documentWith(paragraphOnly({
      reference: "John 1",
      translationLabel: "Manual",
      importSnapshot: {
        sourceKind: "paste",
        structureKind: "paragraphOnly",
        displayReference: "John 1",
        translationId: TRANSLATION,
        translationLabel: "Manual",
        normalizerId: "paste",
        normalizerVersion: "1",
        sourceText: `${atLimit}x`,
        sourceTextHash: HASH_A,
        importedFidelityHash: HASH_B,
        rightsProjectionHash: HASH_C,
        paragraphBoundaries: [{ paragraphIndex: 0 }],
      },
    })))).toBe(true);
  });

  it("enforces Scripture identity invariants needed before readiness projection", () => {
    expect(isRichTextDocument(documentWith(paragraphOnly({
      sourceCatalog: {
        translationId: REQUESTED_TRANSLATION,
        catalogRevision: 1,
        revisionHash: HASH_A,
      },
    })))).toBe(false);
    expect(isRichTextDocument(documentWith(paragraphOnly({
      reference: "John 1",
      translationLabel: "Example",
      importSnapshot: {
        sourceKind: "paste",
        structureKind: "paragraphOnly",
        displayReference: "John 1",
        translationId: REQUESTED_TRANSLATION,
        translationLabel: "Example",
        normalizerId: "paste",
        normalizerVersion: "1",
        sourceText: "text",
        sourceTextHash: HASH_A,
        importedFidelityHash: HASH_B,
        rightsProjectionHash: HASH_C,
        paragraphBoundaries: [{ paragraphIndex: 0 }],
      },
    })))).toBe(false);
    expect(isRichTextDocument(documentWith(paragraphOnly({
      importSnapshot: {
        sourceKind: "paste",
        structureKind: "paragraphOnly",
        displayReference: "John 1",
        translationId: TRANSLATION,
        translationLabel: "Manual",
        normalizerId: "paste",
        normalizerVersion: "1",
        sourceText: "text",
        sourceTextHash: HASH_A,
        importedFidelityHash: HASH_B,
        rightsProjectionHash: HASH_C,
        paragraphBoundaries: [{ paragraphIndex: 0 }],
      },
    })))).toBe(false);
    expect(isRichTextDocument(documentWith(paragraphOnly({
      reference: "John 1",
      translationLabel: "Different label",
      importSnapshot: {
        sourceKind: "paste",
        structureKind: "paragraphOnly",
        displayReference: "John 1",
        translationId: TRANSLATION,
        translationLabel: "Manual",
        normalizerId: "paste",
        normalizerVersion: "1",
        sourceText: "text",
        sourceTextHash: HASH_A,
        importedFidelityHash: HASH_B,
        rightsProjectionHash: HASH_C,
        paragraphBoundaries: [{ paragraphIndex: 0 }],
      },
    })))).toBe(false);
    expect(isRichTextDocument(documentWith(paragraphOnly({
      importReview: {
        disposition: "changesConfirmed",
        reviewedFidelityHash: HASH_A,
        reviewedRightsProjectionHash: HASH_B,
        reviewTime: "2026-07-12T12:00:00Z",
      },
    })))).toBe(false);

    const duplicateVerse = {
      verseId: "John.1.1",
      label: "1",
      paragraphStart: true,
      children: [],
    };
    expect(isRichTextDocument(documentWith({
      type: "scripture",
      structureKind: "verseStructured",
      reference: "John 1:1",
      canonicalReference: "John.1.1",
      translationId: TRANSLATION,
      translationLabel: "Example",
      verses: [duplicateVerse, duplicateVerse],
      rights: [rights()],
    }))).toBe(false);
  });

  it.each([
    { type: "document", blocks: [{ type: "rawTypst", source: "#read(\"/etc/passwd\")" }] },
    { type: "document", blocks: [{ type: "paragraph", children: [{ type: "raw", text: "x" }] }] },
    { type: "document", blocks: [{ type: "heading", level: 7, children: [] }] },
    { type: "document", blocks: [{ type: "paragraph", children: [{ type: "text", text: "" }] }] },
    { type: "document", blocks: [nestedList(5)] },
    { type: "document", blocks: [{ type: "listItem", children: [{ type: "paragraph", children: [] }] }] },
    { type: "document", blocks: [{ type: "blockquote", children: [] }] },
    { type: "document", blocks: [], unknown: true },
  ])("rejects malformed, over-deep, or unknown AST nodes", (value) => {
    expect(isRichTextDocument(value)).toBe(false);
  });

  it.each([
    ["duplicate", ["strong", "strong"]],
    ["noncanonical order", ["emphasis", "strong"]],
    ["unknown", ["underline"]],
  ])("rejects %s marks", (_label, marks) => {
    expect(isRichTextDocument(documentWith({
      type: "paragraph",
      children: [{ type: "text", text: "x", marks }],
    }))).toBe(false);
  });

  it.each([
    ["partial formatting", {
      formattingOverride: { referencePlacement: "before" },
    }],
    ["unitless spacing", {
      formattingOverride: {
        referencePlacement: "before",
        verseNumberStyle: "inline",
        paragraphPolicy: "publisher",
        paragraphSpacing: "6",
        translationLabelPlacement: "hidden",
      },
    }],
    ["negative spacing", {
      formattingOverride: {
        referencePlacement: "before",
        verseNumberStyle: "inline",
        paragraphPolicy: "publisher",
        paragraphSpacing: "-1pt",
        translationLabelPlacement: "hidden",
      },
    }],
    ["non-object typography", {
      formattingOverride: {
        referencePlacement: "before",
        verseNumberStyle: "inline",
        paragraphPolicy: "publisher",
        paragraphSpacing: "1pt",
        translationLabelPlacement: "hidden",
        typographyPresetSnapshot: [],
      },
    }],
  ])("rejects invalid Scripture formatting: %s", (_label, override) => {
    expect(isRichTextDocument(documentWith(paragraphOnly(override)))).toBe(false);
  });

  it.each([
    ["incomplete source catalog", { sourceCatalog: { translationId: TRANSLATION } }],
    ["unknown source catalog property", {
      sourceCatalog: {
        translationId: TRANSLATION,
        catalogRevision: 1,
        revisionHash: HASH_A,
        liveUrl: "https://example.invalid",
      },
    }],
    ["incomplete import review", {
      importReview: { disposition: "changesConfirmed" },
    }],
    ["wrong review timestamp", {
      importReview: {
        disposition: "changesConfirmed",
        reviewedFidelityHash: HASH_A,
        reviewedRightsProjectionHash: HASH_B,
        reviewTime: "2026-07-12",
      },
    }],
    ["incomplete import snapshot", {
      importSnapshot: { sourceKind: "paste", structureKind: "paragraphOnly" },
    }],
    ["mismatched import structure", {
      importSnapshot: {
        sourceKind: "paste",
        structureKind: "verseStructured",
        displayReference: "John 1",
        canonicalReference: "John.1.1",
        translationId: TRANSLATION,
        translationLabel: "Example",
        normalizerId: "n",
        normalizerVersion: "1",
        sourceText: "text",
        sourceTextHash: HASH_A,
        importedFidelityHash: HASH_B,
        rightsProjectionHash: HASH_C,
        verseBoundaries: [{ verseId: "John.1.1", label: "1" }],
      },
    }],
    ["provider snapshot with legacy requestedTranslation", {
      importSnapshot: {
        sourceKind: "provider",
        structureKind: "paragraphOnly",
        displayReference: "John 1",
        translationId: TRANSLATION,
        translationLabel: "Example",
        normalizerId: "n",
        normalizerVersion: "1",
        sourceText: "text",
        sourceTextHash: HASH_A,
        importedFidelityHash: HASH_B,
        rightsProjectionHash: HASH_C,
        paragraphBoundaries: [{ paragraphIndex: 0 }],
        providerId: "provider",
        adapterId: "adapter",
        adapterVersion: "1",
        requestedReference: "John 1",
        requestedTranslation: "Example",
        retrievalTime: "2026-07-12T12:00:00Z",
      },
    }],
  ])("rejects malformed source/review evidence: %s", (_label, override) => {
    expect(() => isRichTextDocument(documentWith(paragraphOnly(override)))).not.toThrow();
    expect(isRichTextDocument(documentWith(paragraphOnly(override)))).toBe(false);
  });

  it.each([
    ["missing contributors", { contributors: undefined }],
    ["invalid contributor", { contributors: [{ name: "", role: "author" }] }],
    ["missing required credit line", { requiredCreditLine: undefined }],
    ["empty required credit line", { requiredCreditLine: "" }],
    ["blank required credit line", { requiredCreditLine: "one\n\ntwo" }],
    ["trailing required credit line", { requiredCreditLine: "one\n" }],
    ["CR required credit line", { requiredCreditLine: "one\r\ntwo" }],
    ["control in required credit line", { requiredCreditLine: "one\u0000two" }],
    ["legacy tune title", { tuneTitle: "Old field" }],
    ["legacy song catalog id", { songCatalogId: "Old field" }],
    ["incomplete publication display", { publicationLicenseDisplay: { displayLine: "x" } }],
    ["bad publication date", {
      publicationLicenseDisplay: {
        providerLabel: "Provider",
        displayLine: "License",
        sourceDisplayRevisionHash: HASH_A,
        effectiveFrom: "2026-1-01",
      },
    }],
    ["duplicate publication contexts", {
      usagePolicySnapshot: {
        providerRuleId: "rule",
        providerRuleVersion: "1",
        applicablePublicationContexts: [
          "printedNonsalableChurchBulletin",
          "printedNonsalableChurchBulletin",
        ],
        policySourceHash: HASH_A,
        counterIdVersion: "counter@1",
      },
    }],
    ["incomplete portion basis", {
      usagePolicySnapshot: {
        providerRuleId: "rule",
        providerRuleVersion: "1",
        applicablePublicationContexts: ["printedNonsalableChurchBulletin"],
        quotationConstraints: [{ metric: "portionBasisPoints", scope: "translation", limit: 1 }],
        policySourceHash: HASH_A,
        counterIdVersion: "counter@1",
      },
    }],
    ["legacy policy counters", {
      usagePolicySnapshot: {
        providerRuleId: "rule",
        providerRuleVersion: "1",
        applicablePublicationContexts: ["printedNonsalableChurchBulletin"],
        policySourceHash: HASH_A,
        counterId: "counter",
        counterVersion: "1",
      },
    }],
  ])("rejects malformed rights: %s", (_label, override) => {
    const candidate = rights(override);
    expect(() => isRichTextDocument(documentWith(paragraphOnly({ rights: [candidate] })))).not.toThrow();
    expect(isRichTextDocument(documentWith(paragraphOnly({ rights: [candidate] })))).toBe(false);
  });

  it("rejects sparse arrays and exotic throwing input without throwing", () => {
    const sparse = new Array(1);
    expect(isRichTextDocument({ type: "document", blocks: sparse })).toBe(false);

    const throwing = new Proxy({}, {
      ownKeys() {
        throw new Error("hostile proxy");
      },
    });
    expect(() => isRichTextDocument(throwing)).not.toThrow();
    expect(isRichTextDocument(throwing)).toBe(false);
  });

  it("iteratively validates very deep opaque typography and rejects cycles", () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let index = 0; index < 10_000; index += 1) deep = { child: deep };
    const formattingOverride = {
      referencePlacement: "before",
      verseNumberStyle: "superscript",
      paragraphPolicy: "publisher",
      paragraphSpacing: "6pt",
      translationLabelPlacement: "withReference",
      typographyPresetSnapshot: deep,
    };
    expect(() => isRichTextDocument(documentWith(paragraphOnly({ formattingOverride })))).not.toThrow();
    expect(isRichTextDocument(documentWith(paragraphOnly({ formattingOverride })))).toBe(true);

    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    expect(isRichTextDocument(documentWith(paragraphOnly({
      formattingOverride: { ...formattingOverride, typographyPresetSnapshot: cyclic },
    })))).toBe(false);
  });
});
