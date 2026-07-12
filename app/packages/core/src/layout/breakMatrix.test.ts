import { describe, expect, it } from "vitest";

import {
  type BreakClassification,
  type BreakMatrixSubject,
  classifyBreakBehavior,
} from "./breakMatrix.js";

interface MatrixCase {
  readonly name: string;
  readonly subject: BreakMatrixSubject;
  readonly expected: BreakClassification;
}

const MATRIX_CASES: readonly MatrixCase[] = [
  {
    name: "text fragments between legal rich-text atoms",
    subject: { kind: "text" },
    expected: {
      mode: "breakable",
      breakAt: "textFragment",
      allowsDescendantBreaks: false,
      keepRule: "headingWithFollowingContent",
    },
  },
  {
    name: "image is unbreakable",
    subject: { kind: "image" },
    expected: { mode: "unbreakable", reason: "image" },
  },
  {
    name: "date is unbreakable",
    subject: { kind: "date" },
    expected: { mode: "unbreakable", reason: "date" },
  },
  {
    name: "music with rich content delegates to rich fragments",
    subject: { kind: "music", hasRichContent: true },
    expected: {
      mode: "breakable",
      breakAt: "musicRichContent",
      allowsDescendantBreaks: false,
      keepRule: "metadataWithFirstContent",
    },
  },
  {
    name: "music without rich content is unbreakable",
    subject: { kind: "music", hasRichContent: false },
    expected: { mode: "unbreakable", reason: "musicWithoutRichContent" },
  },
  {
    name: "rights attribution breaks between entries",
    subject: { kind: "rightsAttribution", entryCount: 3 },
    expected: {
      mode: "breakable",
      breakAt: "rightsEntry",
      allowsDescendantBreaks: false,
      keepRule: "headingWithFirstEntry",
    },
  },
  {
    name: "empty rights attribution emits no height",
    subject: { kind: "rightsAttribution", entryCount: 0 },
    expected: { mode: "empty", reason: "emptyRightsAttribution" },
  },
  {
    name: "grid breaks only between rows",
    subject: { kind: "grid", rowCount: 4 },
    expected: {
      mode: "breakable",
      breakAt: "gridRow",
      allowsDescendantBreaks: false,
      keepRule: "none",
    },
  },
  {
    name: "vertical stack breaks between and within children",
    subject: { kind: "stack", direction: "vertical" },
    expected: {
      mode: "breakable",
      breakAt: "verticalStackChild",
      allowsDescendantBreaks: true,
      keepRule: "none",
    },
  },
  {
    name: "horizontal stack remains one row",
    subject: { kind: "stack", direction: "horizontal" },
    expected: { mode: "unbreakable", reason: "horizontalStack" },
  },
  {
    name: "canvas is unbreakable",
    subject: { kind: "canvas" },
    expected: { mode: "unbreakable", reason: "canvas" },
  },
  {
    name: "flow page break is a control",
    subject: { kind: "pageBreak", intent: "flowBreak" },
    expected: { mode: "pageBreak", intent: "flowBreak" },
  },
  {
    name: "intentional blank is a distinct control",
    subject: { kind: "pageBreak", intent: "intentionalBlank" },
    expected: { mode: "pageBreak", intent: "intentionalBlank" },
  },
  {
    name: "expanded custom roots use vertical-stack semantics",
    subject: { kind: "expandedCustomRoots", rootCount: 2 },
    expected: {
      mode: "breakable",
      breakAt: "expandedCustomRoot",
      allowsDescendantBreaks: true,
      keepRule: "none",
    },
  },
];

describe("classifyBreakBehavior", () => {
  for (const matrixCase of MATRIX_CASES) {
    it(matrixCase.name, () => {
      expect(classifyBreakBehavior(matrixCase.subject)).toEqual(
        matrixCase.expected,
      );
    });
  }

  const suppressible: readonly BreakMatrixSubject[] = [
    { kind: "text" },
    { kind: "music", hasRichContent: true },
    { kind: "rightsAttribution", entryCount: 2 },
    { kind: "grid", rowCount: 2 },
    { kind: "stack", direction: "vertical" },
    { kind: "expandedCustomRoots", rootCount: 2 },
  ];

  it("fixed height suppresses every natural descendant break opportunity", () => {
    for (const subject of suppressible) {
      const natural = classifyBreakBehavior(subject);
      const fixed = classifyBreakBehavior(subject, { fixedHeight: true });
      expect(natural.mode).toBe("breakable");
      expect(fixed).toEqual({
        mode: "unbreakable",
        reason: "fixedHeight",
        suppressedBreakAt:
          natural.mode === "breakable" ? natural.breakAt : undefined,
      });
    }
  });

  it("an unbreakable ancestor suppresses every descendant opportunity", () => {
    for (const subject of suppressible) {
      const natural = classifyBreakBehavior(subject);
      const nested = classifyBreakBehavior(subject, {
        unbreakableAncestor: true,
      });
      expect(natural.mode).toBe("breakable");
      expect(nested).toEqual({
        mode: "unbreakable",
        reason: "unbreakableAncestor",
        suppressedBreakAt:
          natural.mode === "breakable" ? natural.breakAt : undefined,
      });
    }
  });

  it("suppression does not turn empty output or page controls into boxes", () => {
    expect(
      classifyBreakBehavior(
        { kind: "rightsAttribution", entryCount: 0 },
        { fixedHeight: true, unbreakableAncestor: true },
      ),
    ).toEqual({ mode: "empty", reason: "emptyRightsAttribution" });
    expect(
      classifyBreakBehavior(
        { kind: "pageBreak", intent: "intentionalBlank" },
        { fixedHeight: true, unbreakableAncestor: true },
      ),
    ).toEqual({ mode: "pageBreak", intent: "intentionalBlank" });
  });

  it("rejects impossible measured counts", () => {
    expect(() =>
      classifyBreakBehavior({ kind: "grid", rowCount: -1 }),
    ).toThrow(RangeError);
    expect(() =>
      classifyBreakBehavior({ kind: "rightsAttribution", entryCount: 1.5 }),
    ).toThrow(RangeError);
    expect(() =>
      classifyBreakBehavior({ kind: "expandedCustomRoots", rootCount: -1 }),
    ).toThrow(RangeError);
  });
});
