import { describe, expect, it } from "vitest";

import type {
  ResolvedRightsAttributionElement,
  ResolvedRightsContribution,
} from "../document/resolvedTypes.js";
import { generateRightsBlock } from "./rights.js";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const DISPLAY_HASH_A = `sha256:${"c".repeat(64)}`;
const DISPLAY_HASH_B = `sha256:${"d".repeat(64)}`;

const BLOCK: ResolvedRightsAttributionElement = {
  type: "rightsAttribution",
  data: {
    heading: "Copyrights & Permissions",
    groupOrder: ["scripture", "music", "other"],
    includePublicDomainLines: false,
  },
};

function contribution(
  overrides: Partial<ResolvedRightsContribution> = {},
): ResolvedRightsContribution {
  return {
    firstAppearance: 0,
    creditKey: "credit:one",
    creditProjectionHash: HASH_A,
    component: "text",
    status: "copyrighted",
    creditRequiredWhen: "always",
    requiredCreditLineApplies: true,
    requiredCreditLine: "Copyright line one.",
    ...overrides,
  };
}

describe("generateRightsBlock", () => {
  it("splits LF credit text and emits ordered unique record lines", () => {
    const result = generateRightsBlock(BLOCK, [
      contribution({
        requiredCreditLine: "Required one.\nShared.\nRequired one.",
        usagePolicyDisclosureLine: "Shared.",
        publicationLicenseDisplay: {
          displayLine: "Publication display.",
          sourceDisplayRevisionHash: DISPLAY_HASH_A,
        },
      }),
    ]);

    expect(result.entries[0]).toMatchObject({
      lines: ["Required one.", "Shared.", "Publication display."],
      line: "Required one.\nShared.\nPublication display.",
    });
    expect(result.findings).toEqual([]);
  });

  it("deduplicates only identical credit-key and projection-hash revisions", () => {
    const first = contribution();
    const repeatedLater = contribution({ firstAppearance: 8 });
    const result = generateRightsBlock(BLOCK, [first, repeatedLater]);

    expect(result.entries).toEqual([
      {
        creditKey: "credit:one",
        group: "music",
        lines: ["Copyright line one."],
        line: "Copyright line one.",
        firstAppearance: 0,
      },
    ]);
    expect(result.findings).toEqual([]);
  });

  it("reports same-key hash changes and same-hash projection conflicts", () => {
    const changedHash = generateRightsBlock(BLOCK, [
      contribution(),
      contribution({ creditProjectionHash: HASH_B }),
    ]);
    const changedProjection = generateRightsBlock(BLOCK, [
      contribution(),
      contribution({ requiredCreditLine: "Changed without a new hash." }),
    ]);

    expect(changedHash.findings).toContainEqual(
      expect.objectContaining({ code: "CBB-RIGHTS-0002", severity: "error" }),
    );
    expect(changedProjection.findings).toContainEqual(
      expect.objectContaining({ code: "CBB-RIGHTS-0002", severity: "error" }),
    );
    expect(changedHash.entries.map((entry) => entry.lines)).toEqual([
      ["Copyright line one."],
      ["Copyright line one."],
    ]);
    expect(changedProjection.entries.map((entry) => entry.lines)).toEqual([
      ["Copyright line one."],
      ["Changed without a new hash."],
    ]);
  });

  it("collapses cross-record publication displays only for matching text and source hash", () => {
    const result = generateRightsBlock(BLOCK, [
      contribution({
        creditKey: "credit:first",
        requiredCreditLine: "Repeated required line.",
        publicationLicenseDisplay: {
          displayLine: "License display.",
          sourceDisplayRevisionHash: DISPLAY_HASH_A,
        },
      }),
      contribution({
        creditKey: "credit:second",
        requiredCreditLine: "Repeated required line.",
        publicationLicenseDisplay: {
          displayLine: "License display.",
          sourceDisplayRevisionHash: DISPLAY_HASH_A,
        },
      }),
      contribution({
        creditKey: "credit:third",
        creditRequiredWhen: "never",
        requiredCreditLineApplies: false,
        requiredCreditLine: undefined,
        publicationLicenseDisplay: {
          displayLine: "License display.",
          sourceDisplayRevisionHash: DISPLAY_HASH_B,
        },
      }),
    ]);

    expect(result.entries.map((entry) => entry.lines)).toEqual([
      ["Repeated required line.", "License display."],
      ["Repeated required line."],
      ["License display."],
    ]);
  });

  it("orders by configured group, source appearance, component rank, and key", () => {
    const result = generateRightsBlock(BLOCK, [
      contribution({
        creditKey: "credit:recording",
        component: "recording",
        firstAppearance: 4,
      }),
      contribution({
        creditKey: "credit:tune",
        component: "tune",
        firstAppearance: 4,
      }),
      contribution({
        creditKey: "credit:text-z",
        component: "text",
        firstAppearance: 4,
      }),
      contribution({
        creditKey: "credit:text-a",
        component: "text",
        firstAppearance: 4,
      }),
      contribution({
        creditKey: "credit:earlier-tune",
        component: "tune",
        firstAppearance: 1,
      }),
      contribution({
        creditKey: "credit:scripture",
        component: "scriptureTranslation",
        firstAppearance: 9,
      }),
      contribution({
        creditKey: "credit:other",
        component: "other",
        firstAppearance: 0,
      }),
    ]);

    expect(result.entries.map((entry) => entry.creditKey)).toEqual([
      "credit:scripture",
      "credit:earlier-tune",
      "credit:text-a",
      "credit:text-z",
      "credit:tune",
      "credit:recording",
      "credit:other",
    ]);
  });

  it("reports missing required credit text even when another display line exists", () => {
    const result = generateRightsBlock(BLOCK, [
      contribution({
        requiredCreditLine: undefined,
        publicationLicenseDisplay: {
          displayLine: "Used by permission.",
          sourceDisplayRevisionHash: DISPLAY_HASH_A,
        },
      }),
    ]);

    expect(result.entries[0]?.lines).toEqual(["Used by permission."]);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: "CBB-RIGHTS-0001",
        creditKey: "credit:one",
      }),
    );
  });

  it("omits a non-applicable renderedText line but retains independent publication lines", () => {
    const result = generateRightsBlock(BLOCK, [
      contribution({
        creditRequiredWhen: "renderedText",
        requiredCreditLineApplies: false,
        requiredCreditLine: "Lyrics credit.",
        usagePolicyDisclosureLine: "Usage disclosure.",
        publicationLicenseDisplay: {
          displayLine: "Publication display.",
          sourceDisplayRevisionHash: DISPLAY_HASH_A,
        },
      }),
    ]);

    expect(result.entries[0]?.lines).toEqual([
      "Usage disclosure.",
      "Publication display.",
    ]);
    expect(result.findings).toEqual([]);
  });

  it("reports missing renderedText credit only when it applies", () => {
    const inactive = generateRightsBlock(BLOCK, [
      contribution({
        creditRequiredWhen: "renderedText",
        requiredCreditLineApplies: false,
        requiredCreditLine: undefined,
      }),
    ]);
    const active = generateRightsBlock(BLOCK, [
      contribution({
        creditRequiredWhen: "renderedText",
        requiredCreditLineApplies: true,
        requiredCreditLine: undefined,
      }),
    ]);

    expect(inactive.entries).toEqual([]);
    expect(inactive.findings).toEqual([]);
    expect(active.findings).toContainEqual(
      expect.objectContaining({ code: "CBB-RIGHTS-0001" }),
    );
  });

  it("applies one shared credit revision when any rendered occurrence has governed text", () => {
    const result = generateRightsBlock(BLOCK, [
      contribution({
        creditRequiredWhen: "renderedText",
        requiredCreditLineApplies: false,
      }),
      contribution({
        firstAppearance: 4,
        creditRequiredWhen: "renderedText",
        requiredCreditLineApplies: true,
      }),
    ]);

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.lines).toEqual(["Copyright line one."]);
    expect(result.entries[0]?.firstAppearance).toBe(0);
    expect(result.findings).toEqual([]);
  });

  it("emits the app-owned public-domain status only when block policy enables it", () => {
    const publicDomain = contribution({
      status: "publicDomain",
      creditRequiredWhen: "never",
      requiredCreditLineApplies: false,
      requiredCreditLine: undefined,
      workTitle: "A Mighty Fortress",
    });
    expect(generateRightsBlock(BLOCK, [publicDomain]).entries).toEqual([]);

    const shown = generateRightsBlock(
      {
        ...BLOCK,
        data: { ...BLOCK.data, includePublicDomainLines: true },
      },
      [publicDomain],
    );
    expect(shown.entries[0]?.lines).toEqual([
      "A Mighty Fortress — Public domain.",
    ]);
  });
});
