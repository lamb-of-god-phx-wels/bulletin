import { describe, expect, it } from "vitest";

import { rational } from "../geometry/rational.js";
import type { Rational } from "../geometry/rational.js";
import {
  type MeasuredFlowBlock,
  type MeasuredFlowItem,
  type MeasuredFragment,
  paginateMeasuredFlow,
} from "./paginator.js";

function r(numerator: number, denominator = 1): Rational {
  return rational(BigInt(numerator), BigInt(denominator));
}

function fragment(
  id: string,
  height: Rational,
  overrides: Partial<MeasuredFragment> = {},
): MeasuredFragment {
  return { id, role: "atomic", height, ...overrides };
}

function block(
  id: string,
  fragmentation: "breakable" | "unbreakable",
  fragments: readonly MeasuredFragment[],
  overrides: Partial<MeasuredFlowBlock> = {},
): MeasuredFlowBlock {
  return { kind: "block", id, fragmentation, fragments, ...overrides };
}

describe("paginateMeasuredFlow", () => {
  it("uses exact fractional arithmetic without rounding drift", () => {
    const result = paginateMeasuredFlow(
      [
        block("text", "breakable", [
          fragment("first", r(1, 3), { role: "textLine" }),
          fragment("second", r(1, 2), {
            role: "textLine",
            gapBefore: r(1, 6),
          }),
        ]),
      ],
      { pageContentHeight: r(1) },
    );

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.usedHeight).toEqual(r(1));
    expect(result.placements[0]?.y).toEqual(r(0));
    expect(result.placements[1]?.y).toEqual(r(1, 2));
    expect(result.findings).toEqual([]);
  });

  it("moves an unbreakable that fits on a fresh page", () => {
    const result = paginateMeasuredFlow(
      [
        block("lead", "unbreakable", [fragment("lead-box", r(3, 4))]),
        block(
          "image",
          "unbreakable",
          [fragment("image-box", r(1, 2))],
          { marginBefore: r(1, 8) },
        ),
      ],
      { pageContentHeight: r(1) },
    );

    expect(result.pages).toHaveLength(2);
    expect(result.placements.map((placement) => placement.pageNumber)).toEqual([
      1,
      2,
    ]);
    expect(result.placements[1]?.y).toEqual(r(0));
    expect(result.placements[1]?.spaceBefore).toEqual(r(0));
    expect(result.findings).toEqual([]);
  });

  it("reports and places an oversized unbreakable error representation", () => {
    const result = paginateMeasuredFlow(
      [
        block(
          "canvas",
          "unbreakable",
          [fragment("canvas-box", r(5, 4))],
          { breakPolicy: "avoid" },
        ),
      ],
      { pageContentHeight: r(1) },
    );

    expect(result.placements[0]?.overflow).toBe(true);
    expect(result.findings).toEqual([
      {
        kind: "oversizedUnbreakable",
        severity: "error",
        blocking: true,
        itemId: "canvas",
        fragmentId: "canvas-box",
        pageNumber: 1,
        measuredHeight: r(5, 4),
        pageContentHeight: r(1),
      },
    ]);
    expect(result.hasBlockingFindings).toBe(true);
    expect(result.complete).toBe(true);
  });

  it("reports an oversized atomic grid row as blocking", () => {
    const result = paginateMeasuredFlow(
      [
        block("grid", "breakable", [
          fragment("row-1", r(3, 2), { role: "gridRow" }),
        ]),
      ],
      { pageContentHeight: r(1) },
    );

    expect(result.findings[0]).toMatchObject({
      kind: "oversizedFragment",
      blocking: true,
      itemId: "grid",
      fragmentId: "row-1",
      fragmentRole: "gridRow",
    });
    expect(result.placements[0]?.overflow).toBe(true);
  });

  it("honors avoid by moving a whole breakable block when it fits fresh", () => {
    const result = paginateMeasuredFlow(
      [
        block("lead", "unbreakable", [fragment("lead-box", r(1, 2))]),
        block(
          "paragraphs",
          "breakable",
          [
            fragment("p1", r(3, 10), { role: "paragraph" }),
            fragment("p2", r(3, 10), { role: "paragraph" }),
          ],
          { breakPolicy: "avoid" },
        ),
      ],
      { pageContentHeight: r(1) },
    );

    expect(result.placements.map((placement) => placement.pageNumber)).toEqual([
      1,
      2,
      2,
    ]);
    expect(result.findings).toEqual([]);
  });

  it("falls back with one warning only for oversized naturally breakable avoid", () => {
    const result = paginateMeasuredFlow(
      [
        block(
          "long-text",
          "breakable",
          [
            fragment("p1", r(3, 5), { role: "paragraph" }),
            fragment("p2", r(3, 5), { role: "paragraph" }),
          ],
          { breakPolicy: "avoid" },
        ),
      ],
      { pageContentHeight: r(1) },
    );

    expect(result.placements.map((placement) => placement.pageNumber)).toEqual([
      1,
      2,
    ]);
    expect(result.findings).toEqual([
      {
        kind: "avoidFallback",
        severity: "warning",
        blocking: false,
        itemId: "long-text",
        measuredHeight: r(6, 5),
        pageContentHeight: r(1),
      },
    ]);
  });

  it("emits outer margins and internal gaps once without carrying them across a page boundary", () => {
    const result = paginateMeasuredFlow(
      [
        block("lead", "unbreakable", [fragment("lead-box", r(3, 4))]),
        block(
          "stack",
          "breakable",
          [
            fragment("child-1", r(1, 8), { role: "stackChild" }),
            fragment("child-2", r(3, 4), {
              role: "stackChild",
              gapBefore: r(1, 4),
            }),
          ],
          { marginBefore: r(1, 8), marginAfter: r(1, 8) },
        ),
      ],
      { pageContentHeight: r(1) },
    );

    const firstChild = result.placements[1];
    const secondChild = result.placements[2];
    expect(firstChild?.pageNumber).toBe(1);
    expect(firstChild?.spaceBefore).toEqual(r(1, 8));
    expect(secondChild?.pageNumber).toBe(2);
    expect(secondChild?.spaceBefore).toEqual(r(0));
    expect(secondChild?.y).toEqual(r(0));
    expect(result.pages[0]?.usedHeight).toEqual(r(1));
    expect(result.pages[1]?.usedHeight).toEqual(r(7, 8));
  });

  it("expresses heading and list keeps through keepWithNext", () => {
    const result = paginateMeasuredFlow(
      [
        block("lead", "unbreakable", [fragment("lead-box", r(3, 10))]),
        block(
          "heading-group",
          "breakable",
          [
            fragment("heading", r(1, 5), {
              role: "paragraph",
              keepWithNext: 2,
            }),
            fragment("line-1", r(1, 5), { role: "textLine" }),
            fragment("line-2", r(1, 5), { role: "textLine" }),
          ],
          { marginBefore: r(1, 2) },
        ),
      ],
      { pageContentHeight: r(1) },
    );

    expect(result.placements.map((placement) => placement.pageNumber)).toEqual([
      1,
      2,
      2,
      2,
    ]);
  });

  it("preserves leading, consecutive, and trailing flow-break pages with warnings", () => {
    const items: readonly MeasuredFlowItem[] = [
      { kind: "pageBreak", id: "break-1", intent: "flowBreak" },
      { kind: "pageBreak", id: "break-2", intent: "flowBreak" },
    ];
    const result = paginateMeasuredFlow(items, { pageContentHeight: r(1) });

    expect(result.pages).toHaveLength(3);
    expect(result.pages.every((page) => page.kind === "content")).toBe(true);
    expect(result.pages.every((page) => page.placements.length === 0)).toBe(true);
    expect(result.findings.map((finding) => finding.kind)).toEqual([
      "leadingFlowBreak",
      "trailingFlowBreak",
      "consecutiveFlowBreak",
    ]);
  });

  it.each([
    {
      name: "at the start",
      items: [
        { kind: "pageBreak", id: "blank", intent: "intentionalBlank" },
        block("after", "unbreakable", [fragment("after-box", r(1, 4))]),
      ] satisfies readonly MeasuredFlowItem[],
      pageKinds: ["intentionalBlank", "content"],
    },
    {
      name: "between content",
      items: [
        block("before", "unbreakable", [fragment("before-box", r(1, 4))]),
        { kind: "pageBreak", id: "blank", intent: "intentionalBlank" },
        block("after", "unbreakable", [fragment("after-box", r(1, 4))]),
      ] satisfies readonly MeasuredFlowItem[],
      pageKinds: ["content", "intentionalBlank", "content"],
    },
    {
      name: "at the end",
      items: [
        block("before", "unbreakable", [fragment("before-box", r(1, 4))]),
        { kind: "pageBreak", id: "blank", intent: "intentionalBlank" },
      ] satisfies readonly MeasuredFlowItem[],
      pageKinds: ["content", "intentionalBlank"],
    },
    {
      name: "as the only item",
      items: [
        { kind: "pageBreak", id: "blank", intent: "intentionalBlank" },
      ] satisfies readonly MeasuredFlowItem[],
      pageKinds: ["intentionalBlank"],
    },
  ])("emits exactly one intentional blank $name", ({ items, pageKinds }) => {
    const result = paginateMeasuredFlow(items, { pageContentHeight: r(1) });

    expect(result.pages.map((page) => page.kind)).toEqual(pageKinds);
    expect(
      result.pages.filter((page) => page.kind === "intentionalBlank"),
    ).toHaveLength(1);
  });

  it.each([
    {
      name: "reuses the page opened by flowBreak before intentionalBlank",
      items: [
        block("before", "unbreakable", [fragment("before-box", r(1, 4))]),
        { kind: "pageBreak", id: "flow", intent: "flowBreak" },
        { kind: "pageBreak", id: "blank", intent: "intentionalBlank" },
        block("after", "unbreakable", [fragment("after-box", r(1, 4))]),
      ] satisfies readonly MeasuredFlowItem[],
      pageKinds: ["content", "intentionalBlank", "content"],
      afterPage: 3,
    },
    {
      name: "preserves the legacy blank from flowBreak after intentionalBlank",
      items: [
        block("before", "unbreakable", [fragment("before-box", r(1, 4))]),
        { kind: "pageBreak", id: "blank", intent: "intentionalBlank" },
        { kind: "pageBreak", id: "flow", intent: "flowBreak" },
        block("after", "unbreakable", [fragment("after-box", r(1, 4))]),
      ] satisfies readonly MeasuredFlowItem[],
      pageKinds: ["content", "intentionalBlank", "content", "content"],
      afterPage: 4,
    },
    {
      name: "accounts for consecutive mixed boundaries exactly once each",
      items: [
        block("before", "unbreakable", [fragment("before-box", r(1, 4))]),
        { kind: "pageBreak", id: "flow-1", intent: "flowBreak" },
        { kind: "pageBreak", id: "blank-1", intent: "intentionalBlank" },
        { kind: "pageBreak", id: "blank-2", intent: "intentionalBlank" },
        { kind: "pageBreak", id: "flow-2", intent: "flowBreak" },
        block("after", "unbreakable", [fragment("after-box", r(1, 4))]),
      ] satisfies readonly MeasuredFlowItem[],
      pageKinds: [
        "content",
        "intentionalBlank",
        "intentionalBlank",
        "content",
        "content",
      ],
      afterPage: 5,
    },
  ])("$name", ({ items, pageKinds, afterPage }) => {
    const result = paginateMeasuredFlow(items, { pageContentHeight: r(1) });

    expect(result.pages.map((page) => page.kind)).toEqual(pageKinds);
    expect(result.placements.find((placement) => placement.blockId === "after")?.pageNumber)
      .toBe(afterPage);
    expect(result.pages.filter((page) => page.kind === "intentionalBlank"))
      .toHaveLength(pageKinds.filter((kind) => kind === "intentionalBlank").length);
  });

  it("gives an empty rights block zero height including its margins", () => {
    const result = paginateMeasuredFlow(
      [
        block("empty-rights", "breakable", [], {
          marginBefore: r(2),
          marginAfter: r(2),
        }),
      ],
      { pageContentHeight: r(1) },
    );

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.usedHeight).toEqual(r(0));
    expect(result.placements).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  it("fragments a vertical stack but blocks an oversized horizontal row", () => {
    const vertical = paginateMeasuredFlow(
      [
        block("vertical", "breakable", [
          fragment("v1", r(3, 5), { role: "stackChild" }),
          fragment("v2", r(3, 5), { role: "stackChild" }),
        ]),
      ],
      { pageContentHeight: r(1) },
    );
    const horizontal = paginateMeasuredFlow(
      [
        block("horizontal", "unbreakable", [
          fragment("horizontal-row", r(6, 5), { role: "atomic" }),
        ]),
      ],
      { pageContentHeight: r(1) },
    );

    expect(vertical.pages).toHaveLength(2);
    expect(vertical.hasBlockingFindings).toBe(false);
    expect(horizontal.pages).toHaveLength(1);
    expect(horizontal.findings[0]?.kind).toBe("oversizedUnbreakable");
  });

  it("halts deterministically at the configured page cap", () => {
    const result = paginateMeasuredFlow(
      [
        block("one", "unbreakable", [fragment("one-box", r(1))]),
        block("two", "unbreakable", [fragment("two-box", r(1))]),
        block("three", "unbreakable", [fragment("three-box", r(1))]),
      ],
      { pageContentHeight: r(1), pageCap: 2 },
    );

    expect(result.pages).toHaveLength(2);
    expect(result.placements.map((placement) => placement.blockId)).toEqual([
      "one",
      "two",
    ]);
    expect(result.findings.at(-1)).toEqual({
      kind: "pageCapExceeded",
      severity: "error",
      blocking: true,
      itemId: "three",
      pageCap: 2,
    });
    expect(result.complete).toBe(false);
  });

  it("terminates through the no-progress iteration guard", () => {
    const result = paginateMeasuredFlow(
      [block("guarded", "breakable", [fragment("f", r(1, 2))])],
      { pageContentHeight: r(1), iterationLimit: 1 },
    );

    expect(result.complete).toBe(false);
    expect(result.placements).toEqual([]);
    expect(result.findings).toEqual([
      {
        kind: "noProgress",
        severity: "error",
        blocking: true,
        itemId: "guarded",
        iterationLimit: 1,
      },
    ]);
  });

  it("returns byte-for-byte-equivalent structures on repeated runs", () => {
    const items: readonly MeasuredFlowItem[] = [
      block("text", "breakable", [
        fragment("heading", r(1, 4), {
          role: "paragraph",
          keepWithNext: 1,
        }),
        fragment("line", r(1, 3), {
          role: "textLine",
          gapBefore: r(1, 12),
        }),
        fragment("tail", r(2, 3), {
          role: "paragraph",
          gapBefore: r(1, 10),
        }),
      ]),
      { kind: "pageBreak", id: "blank", intent: "intentionalBlank" },
      block("image", "unbreakable", [fragment("image-box", r(1, 2))]),
    ];
    const options = { pageContentHeight: r(1) };

    expect(paginateMeasuredFlow(items, options)).toEqual(
      paginateMeasuredFlow(items, options),
    );
  });

  it("rejects descriptors that are not legal measured atoms", () => {
    expect(() =>
      paginateMeasuredFlow(
        [
          block("bad", "unbreakable", [
            fragment("one", r(1, 4)),
            fragment("two", r(1, 4)),
          ]),
        ],
        { pageContentHeight: r(1) },
      ),
    ).toThrow(/at most one fragment/);
    expect(() =>
      paginateMeasuredFlow(
        [
          block("bad-keep", "breakable", [
            fragment("only", r(1, 4), { keepWithNext: 1 }),
          ]),
        ],
        { pageContentHeight: r(1) },
      ),
    ).toThrow(/keepWithNext/);
  });
});
