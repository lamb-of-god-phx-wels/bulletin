import { describe, expect, it } from "vitest";
import type { CbbDocument } from "@cbb/core";
import { editorPageMetrics, paginateEditorDocument } from "./pagination.js";

function document(elements: CbbDocument["elements"]): CbbDocument {
  return {
    version: 2,
    kind: "bulletin",
    name: "Pagination",
    page: {
      typstWidth: "4in",
      typstHeight: "4in",
      margins: { top: "0.5in", right: "0.5in", bottom: "0.5in", left: "0.5in" },
    },
    elements,
  };
}

describe("shared editor pagination plan", () => {
  it("segments breakable text at measured natural boundaries", () => {
    const plan = paginateEditorDocument(document([{
      id: "reading",
      type: "text",
      name: "Reading",
      data: { content: { kind: "plain", text: "One\nTwo\nThree" } },
    }]), {
      reading: {
        fragments: [
          { heightPx: 140 },
          { heightPx: 140 },
          { heightPx: 140 },
        ],
      },
    });

    expect(plan.pages).toHaveLength(2);
    expect(plan.pages[0]?.items[0]?.fragmentIndices).toEqual([0, 1]);
    expect(plan.pages[1]?.items[0]?.fragmentIndices).toEqual([2]);
    expect(plan.hasBlockingFindings).toBe(false);
  });

  it("includes container gaps when deciding where a fragment continues", () => {
    const plan = paginateEditorDocument(document([{
      id: "prayers",
      type: "stack",
      name: "Prayers",
      data: { direction: "vertical", gap: "15pt" },
      children: [
        { id: "first-wrapper", index: 0, element: { id: "first", type: "text", name: "First", data: { content: { kind: "plain", text: "First" } } } },
        { id: "second-wrapper", index: 1, element: { id: "second", type: "text", name: "Second", data: { content: { kind: "plain", text: "Second" } } } },
      ],
    }]), {
      prayers: {
        fragments: [
          { heightPx: 140 },
          { heightPx: 140, gapBeforePx: 20 },
        ],
      },
    });

    expect(plan.pages).toHaveLength(2);
    expect(plan.pages[0]?.items[0]?.fragmentIndices).toEqual([0]);
    expect(plan.pages[1]?.items[0]?.fragmentIndices).toEqual([1]);
  });

  it("represents flow breaks and one intentional blank without mutating the document", () => {
    const value = document([
      { id: "a", type: "text", name: "A", data: { content: { kind: "plain", text: "A" } } },
      { id: "break", type: "pageBreak", name: "Blank", data: { intent: "intentionalBlank" } },
      { id: "b", type: "text", name: "B", data: { content: { kind: "plain", text: "B" } } },
    ]);
    const before = JSON.stringify(value);
    const plan = paginateEditorDocument(value, {
      a: { heightPx: 20 },
      b: { heightPx: 20 },
    });

    expect(plan.pages.map((page) => page.kind)).toEqual([
      "content",
      "intentionalBlank",
      "content",
    ]);
    expect(JSON.stringify(value)).toBe(before);
  });

  it("marks an over-height unbreakable item as blocking", () => {
    const plan = paginateEditorDocument(document([{
      id: "photo",
      type: "image",
      name: "Photo",
      data: { assetRef: "asset:00000000-0000-4000-8000-000000000001", fit: "cover" },
    }]), { photo: { heightPx: 500 } });

    expect(plan.hasBlockingFindings).toBe(true);
    expect(plan.pages.some((page) => page.items.some((item) => item.overflow))).toBe(true);
  });

  it("paginates the effective bound text instead of its stale source fallback", () => {
    const value = document([{
      id: "reading",
      type: "text",
      name: "Reading",
      data: { content: { kind: "plain", text: "Short fallback" } },
      bindings: [{
        id: "reading-binding",
        scope: "document",
        fieldId: "readingText",
        target: "/data/content/text",
      }],
    }]);
    const bound: CbbDocument = {
      ...value,
      fieldContract: {
        id: "00000000-0000-4000-8000-000000000001",
        version: 1,
        name: "Weekly fields",
        fields: [{ id: "readingText", label: "Reading", type: "text", required: false }],
      },
      fieldValues: {
        readingText: {
          value: Array.from({ length: 20 }, (_, index) => `Line ${index + 1}`).join("\n"),
          origin: "manual",
        },
      },
    };

    const plan = paginateEditorDocument(bound);
    expect(plan.pages.length).toBeGreaterThan(1);
    expect(plan.pages.flatMap((page) => page.items[0]?.fragmentIndices ?? [])).toHaveLength(20);
  });

  it("matches zero Typst margin defaults and swaps mirrored margins by page parity", () => {
    const noMargins: CbbDocument = {
      ...document([]),
      page: { typstWidth: "4in", typstHeight: "4in" },
    };
    expect(editorPageMetrics(noMargins)).toMatchObject({
      marginTopPx: 0,
      marginRightPx: 0,
      marginBottomPx: 0,
      marginLeftPx: 0,
    });

    const mirrored: CbbDocument = {
      ...noMargins,
      page: {
        ...noMargins.page,
        marginMode: "mirrored",
        binding: "left",
        margins: { inner: "0.75in", outer: "0.25in" },
      },
    };
    expect(editorPageMetrics(mirrored, 1)).toMatchObject({ marginLeftPx: 72, marginRightPx: 24 });
    expect(editorPageMetrics(mirrored, 2)).toMatchObject({ marginLeftPx: 24, marginRightPx: 72 });
  });
});
