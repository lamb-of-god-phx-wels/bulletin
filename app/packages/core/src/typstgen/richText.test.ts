import { describe, expect, it } from "vitest";

import type { ResolvedRichTextDocument } from "../document/resolvedTypes.js";
import { renderRichTextDocument } from "./richText.js";

describe("renderRichTextDocument", () => {
  it("emits semantic constructs while every text leaf stays quoted", () => {
    const document: ResolvedRichTextDocument = {
      type: "document",
      blocks: [
        {
          type: "heading",
          level: 2,
          children: [{ type: "text", text: "#panic(\"owned\")", marks: ["strong"] }],
        },
        {
          type: "bulletList",
          children: [
            {
              type: "listItem",
              children: [
                {
                  type: "paragraph",
                  children: [{ type: "text", text: "Peace & mercy" }],
                },
              ],
            },
          ],
        },
      ],
    };

    const source = renderRichTextDocument(document);
    expect(source).toContain("#heading(level: 2)");
    expect(source).toContain("#list(");
    expect(source).toContain('#text("#panic(\\"owned\\")")');
    expect(source).not.toContain('[#panic("owned")]');
  });

  it("emits effective scripture presentation without import/source evidence", () => {
    const document: ResolvedRichTextDocument = {
      type: "document",
      blocks: [
        {
          type: "scripture",
          structureKind: "verseStructured",
          reference: "John 3:16",
          canonicalReference: "John.3.16",
          translationLabel: "NIV",
          presentation: {
            referencePlacement: "before",
            verseNumberStyle: "superscript",
            paragraphPolicy: "publisher",
            paragraphSpacing: "6pt",
            translationLabelPlacement: "afterPassage",
          },
          verses: [
            {
              verseId: "John.3.16",
              label: "16",
              paragraphStart: true,
              children: [{ type: "text", text: "For God so loved the world." }],
            },
          ],
        },
      ],
    };

    const source = renderRichTextDocument(document);
    expect(source).toContain('#text("John 3:16")');
    expect(source).toContain('#super[#text("16")]');
    expect(source).toContain('#text("(NIV)")');
    expect(source).not.toContain("John.3.16");
  });

  it("does not emit a phantom reference row for paragraph-only Scripture", () => {
    const document: ResolvedRichTextDocument = {
      type: "document",
      blocks: [
        {
          type: "scripture",
          structureKind: "paragraphOnly",
          reference: "",
          translationLabel: "",
          presentation: {
            referencePlacement: "before",
            verseNumberStyle: "hidden",
            paragraphPolicy: "publisher",
            paragraphSpacing: "6pt",
            translationLabelPlacement: "hidden",
          },
          paragraphs: [
            {
              type: "paragraph",
              children: [{ type: "text", text: "The passage body." }],
            },
          ],
        },
      ],
    };

    const source = renderRichTextDocument(document);
    expect(source).toBe('#quote(block: true)[#block[#text("The passage body.")]]');
    expect(source).not.toContain("#strong");
    expect(source).not.toContain("#parbreak()");
  });

  it("renders the closed supported Scripture typography presets", () => {
    const base = {
      type: "scripture" as const,
      structureKind: "paragraphOnly" as const,
      reference: "Psalm 23",
      translationLabel: "",
      paragraphs: [{
        type: "paragraph" as const,
        children: [{ type: "text" as const, text: "The Lord is my shepherd." }],
      }],
      presentation: {
        referencePlacement: "before" as const,
        verseNumberStyle: "hidden" as const,
        paragraphPolicy: "publisher" as const,
        paragraphSpacing: "6pt",
        translationLabelPlacement: "hidden" as const,
      },
    };
    const readable = renderRichTextDocument({
      type: "document",
      blocks: [{
        ...base,
        presentation: {
          ...base.presentation,
          typographyPresetSnapshot: { preset: "readable", version: 1 },
        },
      }],
    });
    const compact = renderRichTextDocument({
      type: "document",
      blocks: [{
        ...base,
        presentation: {
          ...base.presentation,
          typographyPresetSnapshot: { preset: "compact", version: 1 },
        },
      }],
    });
    expect(readable).toContain("#text(size: 1.05em)");
    expect(compact).toContain("#text(size: 0.92em)");
  });
});
