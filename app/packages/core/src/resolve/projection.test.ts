import { describe, expect, it } from "vitest";

import type { ResolvedRightsContribution } from "../document/resolvedTypes.js";
import {
  collectMusicRights,
  resolveRichTextDocument,
} from "./projection.js";

const CREDIT_HASH = `sha256:${"1".repeat(64)}`;
const DISPLAY_HASH = `sha256:${"2".repeat(64)}`;

describe("active rights projection", () => {
  it("preserves output identity and reviewed lines while dropping catalog metadata", () => {
    const contributions: ResolvedRightsContribution[] = [];
    collectMusicRights(
      [
        {
          creditKey: "credit:one",
          creditProjectionHash: CREDIT_HASH,
          component: "text",
          status: "copyrighted",
          workTitle: "Render-inert copyrighted title",
          edition: "Secret edition metadata",
          contributors: [{ name: "Must not be composed", role: "author" }],
          providerCatalogId: "private-catalog-id",
          creditRequiredWhen: "always",
          requiredCreditLine: "Exact credit.",
          usagePolicySnapshot: {
            providerRuleId: "private-policy-id",
            requiredPublicationDisclosureLine: "Required disclosure.",
          },
          publicationLicenseDisplay: {
            providerLabel: "Private provider metadata",
            displayLine: "License display.",
            sourceDisplayRevisionHash: DISPLAY_HASH,
            effectiveFrom: "2026-01-01",
          },
        },
        {
          creditKey: "credit:public-domain",
          creditProjectionHash: `sha256:${"3".repeat(64)}`,
          component: "tune",
          status: "publicDomain",
          workTitle: "Public-domain title",
          contributors: [],
          creditRequiredWhen: "never",
        },
      ],
      contributions,
      false,
    );

    expect(contributions).toEqual([
      {
        firstAppearance: 0,
        creditKey: "credit:one",
        creditProjectionHash: CREDIT_HASH,
        component: "text",
        status: "copyrighted",
        creditRequiredWhen: "always",
        requiredCreditLineApplies: true,
        requiredCreditLine: "Exact credit.",
        usagePolicyDisclosureLine: "Required disclosure.",
        publicationLicenseDisplay: {
          displayLine: "License display.",
          sourceDisplayRevisionHash: DISPLAY_HASH,
        },
      },
      {
        firstAppearance: 0,
        creditKey: "credit:public-domain",
        creditProjectionHash: `sha256:${"3".repeat(64)}`,
        component: "tune",
        status: "publicDomain",
        workTitle: "Public-domain title",
        creditRequiredWhen: "never",
        requiredCreditLineApplies: false,
      },
    ]);

    const serialized = JSON.stringify(contributions);
    expect(serialized).not.toContain("Must not be composed");
    expect(serialized).not.toContain("private-policy-id");
    expect(serialized).not.toContain("Private provider metadata");
    expect(serialized).not.toContain("Secret edition metadata");
  });

  it("assigns one appearance token to records from the same rendered source", () => {
    const contributions: ResolvedRightsContribution[] = [];
    const record = (key: string) => ({
      creditKey: key,
      creditProjectionHash: CREDIT_HASH,
      component: "text",
      status: "copyrighted",
      creditRequiredWhen: "always",
      requiredCreditLine: key,
    });

    collectMusicRights([record("credit:a"), record("credit:b")], contributions, true);
    collectMusicRights([record("credit:c")], contributions, true);

    expect(contributions.map((contribution) => contribution.firstAppearance)).toEqual([
      0,
      0,
      2,
    ]);
  });

  it("resolves renderedText applicability without dropping independent publication lines", () => {
    const raw = [{
      creditKey: "credit:lyrics",
      creditProjectionHash: CREDIT_HASH,
      component: "text",
      status: "copyrighted",
      creditRequiredWhen: "renderedText",
      requiredCreditLine: "Lyrics credit.",
      usagePolicySnapshot: {
        requiredPublicationDisclosureLine: "Usage disclosure.",
      },
      publicationLicenseDisplay: {
        displayLine: "Publication license.",
        sourceDisplayRevisionHash: DISPLAY_HASH,
      },
    }];
    const withoutLyrics: ResolvedRightsContribution[] = [];
    const withLyrics: ResolvedRightsContribution[] = [];

    collectMusicRights(raw, withoutLyrics, false);
    collectMusicRights(raw, withLyrics, true);

    expect(withoutLyrics[0]).toMatchObject({
      creditRequiredWhen: "renderedText",
      requiredCreditLineApplies: false,
      requiredCreditLine: "Lyrics credit.",
      usagePolicyDisclosureLine: "Usage disclosure.",
      publicationLicenseDisplay: { displayLine: "Publication license." },
    });
    expect(withLyrics[0]?.requiredCreditLineApplies).toBe(true);
  });

  it("applies renderedText Scripture credit only to a nonempty passage", () => {
    const scripture = (text: string) => ({
      type: "document",
      blocks: [{
        type: "scripture",
        structureKind: "paragraphOnly",
        reference: "John 1",
        translationId: "translation:test",
        translationLabel: "Test",
        paragraphs: [{
          type: "paragraph",
          children: text.length === 0 ? [] : [{ type: "text", text }],
        }],
        rights: [{
          creditKey: "credit:scripture",
          creditProjectionHash: CREDIT_HASH,
          component: "scriptureTranslation",
          status: "copyrighted",
          creditRequiredWhen: "renderedText",
          requiredCreditLine: "Translation credit.",
        }],
      }],
    });
    const presentation = {
      referencePlacement: "before" as const,
      verseNumberStyle: "superscript" as const,
      paragraphPolicy: "publisher" as const,
      paragraphSpacing: "6pt",
      translationLabelPlacement: "withReference" as const,
    };
    const empty: ResolvedRightsContribution[] = [];
    const nonempty: ResolvedRightsContribution[] = [];

    resolveRichTextDocument(scripture(""), presentation, empty);
    resolveRichTextDocument(scripture("In the beginning"), presentation, nonempty);

    expect(empty[0]?.requiredCreditLineApplies).toBe(false);
    expect(nonempty[0]?.requiredCreditLineApplies).toBe(true);
  });
});
