import { describe, expect, it } from "vitest";

import type {
  EffectiveScripturePresentation,
  RenderProjection,
  ResolvedNode,
  ResolvedPageElement,
  ResolvedRenderTree,
  ResolvedRightsContribution,
} from "../document/resolvedTypes.js";
import { canonicalStringify, hexToSha256Hash } from "../canonical/index.js";
import {
  createSanitizedRenderProjection,
  renderInputHash,
  type HashJsonObject,
} from "../hashes/index.js";
import { projectResolvedTree } from "../resolve/projection.js";
import {
  BUNDLED_NOTO_SANS_FAMILY,
  BUNDLED_NOTO_SANS_FONT_REF,
  BUNDLED_NOTO_SANS_SYMBOLS_2_FAMILY,
  BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF,
} from "./bundledFonts.js";
import { generateTypst as generateTypstCore } from "./generator.js";
import type {
  TypstGenerationInput,
  TypstGenerationOptions,
  TypstGenerationResult,
} from "./types.js";

function directNode(
  resolvedId: string,
  element: ResolvedNode["element"]
): ResolvedNode {
  return {
    resolvedId,
    provenance: { kind: "direct", sourceElementId: resolvedId, expansions: [] },
    element,
  };
}

const PROJECTION_BASE: Omit<RenderProjection, "elements" | "pageElements"> = {
  version: 1,
  title: "Test Bulletin",
  locale: "en-US",
  page: {
    typstWidth: "5.5in",
    typstHeight: "8.5in",
    background: "#ffffff",
    marginMode: "fixed",
    binding: "left",
    margins: {
      top: "0.5in",
      right: "0.5in",
      bottom: "0.5in",
      left: "0.5in",
    },
  },
  scripturePresentation: {
    referencePlacement: "before",
    verseNumberStyle: "superscript",
    paragraphPolicy: "publisher",
    paragraphSpacing: "6pt",
    translationLabelPlacement: "withReference",
  },
  fontFallbackRefs: [
    BUNDLED_NOTO_SANS_FONT_REF,
    BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF,
  ],
  rightsContributions: [],
  referencedFonts: [
    { fontRef: BUNDLED_NOTO_SANS_FONT_REF },
    { fontRef: BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF },
  ],
  referencedAssets: [],
};

function inputFor(
  elements: readonly ResolvedNode[],
  pageElements: readonly ResolvedPageElement[] = [],
  projectionOverrides: Partial<RenderProjection> = {},
): {
  readonly tree: ResolvedRenderTree;
  readonly projection: RenderProjection;
} {
  const tree: ResolvedRenderTree = {
    elements,
    pageElements,
    totalNodeCount: elements.length + pageElements.length,
  };
  const projected = projectResolvedTree(tree);
  return {
    tree,
    projection: {
      ...PROJECTION_BASE,
      ...projected,
      ...projectionOverrides,
    },
  };
}

const HASH = hexToSha256Hash("a".repeat(64));

const MANDATORY_FONT_BINDINGS = {
  [BUNDLED_NOTO_SANS_FONT_REF]: { familyName: BUNDLED_NOTO_SANS_FAMILY },
  [BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF]: {
    familyName: BUNDLED_NOTO_SANS_SYMBOLS_2_FAMILY,
  },
} as const;

function generate(
  input: TypstGenerationInput,
  options: TypstGenerationOptions = {},
): TypstGenerationResult {
  return generateTypstCore(input, {
    ...options,
    fonts: { ...MANDATORY_FONT_BINDINGS, ...options.fonts },
  });
}

function projectionRenderHash(projection: RenderProjection): string {
  return renderInputHash({
    projection: createSanitizedRenderProjection(
      projection as unknown as HashJsonObject,
    ),
    assets: [],
    fonts: [
      {
        fontRef: BUNDLED_NOTO_SANS_FONT_REF,
        familyDigest: HASH,
        selectedFaces: [{
          faceId: "test-noto-regular",
          faceHash: HASH,
          faceIndex: 0,
          embedding: "subset",
        }],
      },
      {
        fontRef: BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF,
        familyDigest: HASH,
        selectedFaces: [{
          faceId: "test-symbols-regular",
          faceHash: HASH,
          faceIndex: 0,
          embedding: "subset",
        }],
      },
    ],
    tools: [{ toolId: "typstgen", version: "test", toolHash: HASH }],
    locale: {
      languageTag: projection.locale,
      dataVersion: "test",
      dataHash: HASH,
    },
    outputOptions: {
      outputForm: "readerOrder",
      pdfConformance: "standard",
      watermark: { kind: "none" },
    },
  });
}

describe("generateTypst", () => {
  it("fails closed without the materialized release font contract", () => {
    const input = inputFor([]);
    expect(() => generateTypstCore(input)).toThrow(/no verified build font binding/);
    expect(() =>
      generateTypstCore(input, {
        fonts: {
          ...MANDATORY_FONT_BINDINGS,
          [BUNDLED_NOTO_SANS_FONT_REF]: { familyName: "Same-name substitute" },
        },
      }),
    ).toThrow(/must bind to Noto Sans/);
    expect(() =>
      generateTypstCore(
        {
          ...input,
          projection: {
            ...input.projection,
            fontFallbackRefs: [],
          },
        },
        { fonts: MANDATORY_FONT_BINDINGS },
      ),
    ).toThrow(/projection must end with/);
  });

  it("is byte-stable and never interpolates user markup as source", () => {
    const input = inputFor([
      directNode("title", {
        type: "text",
        style: { fontSize: "14pt", fontWeight: "bold", align: "center" },
        data: { content: { kind: "plain", text: '#panic("owned") [] $x$' } },
      }),
      directNode("date", {
        type: "date",
        data: { value: "2026-07-05", format: "MMMM D, YYYY" },
      }),
    ]);

    const first = generate(input);
    const second = generate(input);
    expect(first).toEqual(second);
    expect(first.source).toContain('#text("#panic(\\"owned\\") [] $x$")');
    expect(first.source).not.toContain('[#panic("owned")]');
    expect(first.source).toContain('#text("July 5, 2026")');
    expect(first.source).toContain(
      '#metadata((resolvedId: "title", sourceElementId: "title", region: "body")) <cbb-source>',
    );
    expect(first.source).toContain("<cbb-located>");
    expect(first.sourceMap.entries.map((entry) => entry.resolvedId)).toEqual([
      "title",
      "date",
    ]);
    expect(first.sourceMap.entries.map((entry) => entry.sourceElementId)).toEqual([
      "title",
      "date",
    ]);
  });

  it("emits hashed PDF title/language metadata and fails closed for unmappable tags", () => {
    const body = directNode("body", {
      type: "text",
      data: { content: { kind: "plain", text: "Inhalt" } },
    });
    const german = inputFor([body], [], {
      title: 'Gemeinde #panic("not source")',
      locale: "de-DE",
    });
    const english = inputFor([body], [], {
      title: "English Bulletin",
      locale: "en-US",
    });
    const germanResult = generate(german);

    expect(germanResult.source).toContain(
      '#set document(title: "Gemeinde #panic(\\"not source\\")")',
    );
    expect(germanResult.source).toContain(
      '#set text(font: ("Noto Sans", "Noto Sans Symbols 2"), top-edge: "ascender", bottom-edge: "descender")',
    );
    expect(germanResult.source).toContain('#set text(lang: "de", region: "DE")');
    expect(germanResult.findings).toEqual([]);
    expect(germanResult.source).not.toBe(generate(english).source);
    expect(projectionRenderHash(german.projection)).not.toBe(
      projectionRenderHash(english.projection),
    );

    const unsupported = generate(
      inputFor([body], [], { locale: "sr-Latn-RS" }),
    );
    expect(unsupported.source).not.toContain("sr-Latn-RS");
    expect(unsupported.findings).toContainEqual(
      expect.objectContaining({
        code: "CBB-PDF-0002",
        severity: "error",
        kind: "unsupportedLocale",
      }),
    );
  });

  it("emits controlled image paths and preview placeholders for missing assets", () => {
    const image = directNode("logo", {
      type: "image",
      width: "2in",
      data: {
        assetRef: "asset:11111111-1111-4111-8111-111111111111",
        fit: "contain",
        alt: "Church logo",
      },
    });
    const input = inputFor([image]);
    const missing = generate(input);
    expect(missing.source).toContain("Missing image");
    expect(missing.findings).toContainEqual(
      expect.objectContaining({ code: "CBB-ASSET-0001", resolvedId: "logo" })
    );

    const bound = generate(input, {
      assets: {
        "asset:11111111-1111-4111-8111-111111111111": {
          relativePath: "assets/logo.svg",
        },
      },
    });
    expect(bound.source).toContain('#image("assets/logo.svg"');
    expect(bound.findings).toEqual([]);
  });

  it("keeps a draft image representation but warns when alt text is missing", () => {
    const assetRef = "asset:11111111-1111-4111-8111-111111111111";
    const result = generate(
      inputFor([
        directNode("draftImage", {
          type: "image",
          data: { assetRef, fit: "contain" },
        }),
      ]),
      { assets: { [assetRef]: { relativePath: "assets/image.svg" } } },
    );
    expect(result.source).toContain('alt: ""');
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: "CBB-PDF-0002",
        severity: "warning",
        kind: "missingAltText",
        resolvedId: "draftImage",
      }),
    );
  });

  it("maps nested container nodes and applies the grid/stack model", () => {
    const left = directNode("left", {
      type: "text",
      data: { content: { kind: "plain", text: "Left" } },
    });
    const right = directNode("right", {
      type: "text",
      data: { content: { kind: "plain", text: "Right" } },
    });
    const grid = directNode("grid", {
      type: "grid",
      data: { rows: 1, columns: 2, columnTracks: ["1fr", "1fr"] },
      children: [
        {
          resolvedId: "leftWrap",
          provenance: { kind: "direct", sourceElementId: "leftWrap", expansions: [] },
          row: 0,
          column: 0,
          element: left,
        },
        {
          resolvedId: "rightWrap",
          provenance: { kind: "direct", sourceElementId: "rightWrap", expansions: [] },
          row: 0,
          column: 1,
          element: right,
        },
      ],
    });
    const result = generate(inputFor([grid]));
    expect(result.source).toContain("#grid(columns: (1fr,) * 2");
    expect(result.source).toContain("grid.cell(x: 0, y: 0, breakable: false)");
    expect(result.sourceMap.entries.map((entry) => entry.resolvedId)).toEqual([
      "left",
      "right",
      "grid",
    ]);
  });

  it("uses equal columns without making auto-height rows consume the page", () => {
    const autoGrid = directNode("autoGrid", {
      type: "grid",
      data: { rows: 2, columns: 3 },
      children: [],
    });
    const fixedGrid = directNode("fixedGrid", {
      type: "grid",
      height: "2in",
      data: { rows: 2, columns: 2 },
      children: [],
    });
    const horizontal = directNode("horizontal", {
      type: "stack",
      data: { direction: "horizontal", gap: "6pt" },
      children: [
        {
          resolvedId: "firstWrap",
          provenance: { kind: "direct", sourceElementId: "firstWrap", expansions: [] },
          index: 0,
          element: directNode("first", {
            type: "text",
            data: { content: { kind: "plain", text: "Long first item" } },
          }),
        },
        {
          resolvedId: "secondWrap",
          provenance: { kind: "direct", sourceElementId: "secondWrap", expansions: [] },
          index: 1,
          element: directNode("second", {
            type: "text",
            data: { content: { kind: "plain", text: "B" } },
          }),
        },
      ],
    });
    const source = generate(inputFor([autoGrid, fixedGrid, horizontal])).source;
    expect(source).toContain("columns: (1fr,) * 3, rows: (auto,) * 2");
    expect(source).toContain("columns: (1fr,) * 2, rows: (1fr,) * 2");
    expect(source).toContain("#grid(columns: (1fr,) * 2, column-gutter: 6pt");
  });

  it("fails closed for staged table semantics and non-identity canvas reading order", () => {
    const tableCell = directNode("tableCell", {
      type: "text",
      data: { content: { kind: "plain", text: "Header" } },
    });
    const table = directNode("table", {
      type: "grid",
      data: {
        rows: 1,
        columns: 1,
        semanticRole: "table",
        tableSemantics: { summary: "One-cell table", headerRows: 1, headerColumns: 0 },
      },
      children: [
        {
          resolvedId: "tableWrap",
          provenance: { kind: "direct", sourceElementId: "tableWrap", expansions: [] },
          row: 0,
          column: 0,
          element: tableCell,
        },
      ],
    });
    const canvasChild = (resolvedId: string, text: string) => ({
      resolvedId: `${resolvedId}Wrap`,
      provenance: {
        kind: "direct" as const,
        sourceElementId: `${resolvedId}Wrap`,
        expansions: [],
      },
      x: "0pt" as const,
      y: "0pt" as const,
      element: directNode(resolvedId, {
        type: "text",
        height: "12pt",
        data: { content: { kind: "plain", text } },
      }),
    });
    const first = canvasChild("paintFirst", "First");
    const second = canvasChild("paintSecond", "Second");
    const canvas = directNode("canvas", {
      type: "canvas",
      height: "1in",
      children: [
        { ...first, semanticOrder: 1 },
        { ...second, semanticOrder: 0 },
      ],
    });
    const findings = generate(inputFor([table, canvas])).findings;
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: "CBB-PDF-0002",
        kind: "unsupportedTableSemantics",
        resolvedId: "table",
      }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: "CBB-PDF-0002",
        kind: "unsupportedCanvasSemantics",
        resolvedId: "canvas",
      }),
    );

    const identityCanvas = directNode("identityCanvas", {
      type: "canvas",
      height: "1in",
      children: [
        { ...first, semanticOrder: 3 },
        { ...second, semanticOrder: 7 },
      ],
    });
    expect(
      generate(inputFor([identityCanvas])).findings.some(
        (finding) => finding.kind === "unsupportedCanvasSemantics",
      ),
    ).toBe(false);
  });

  it("gives intentional blanks exactly one intervening page break and a post-layout marker", () => {
    const before = directNode("before", {
      type: "text",
      data: { content: { kind: "plain", text: "Before" } },
    });
    const blank = directNode("blank", {
      type: "pageBreak",
      data: { intent: "intentionalBlank" },
    });
    const after = directNode("after", {
      type: "text",
      data: { content: { kind: "plain", text: "After" } },
    });
    const middle = generate(inputFor([before, blank, after]));
    expect(middle.source).toContain(
      '#pagebreak(weak: true)\n#metadata((resolvedId: "blank", sourceElementId: "blank", region: "body")) <cbb-source>\n#metadata((resolvedId: "$cbb:intentional-blank", sourceElementId: "blank", region: "body")) <cbb-source>\n#box(width: 0pt, height: 0pt)[]\n#pagebreak()\n'
    );
    expect(middle.source.indexOf('resolvedId: "blank"')).toBeGreaterThan(
      middle.source.indexOf("#pagebreak(weak: true)"),
    );

    const trailing = generate(inputFor([before, blank]));
    expect(trailing.source).toContain("#pagebreak(weak: true)\n");
    expect(trailing.source).not.toContain(
      '<cbb-source>\n#pagebreak()\n'
    );

    const leading = generate(inputFor([blank, after]));
    expect(leading.source).toContain(
      '#pagebreak(weak: true)\n#metadata((resolvedId: "blank", sourceElementId: "blank", region: "body")) <cbb-source>\n#metadata((resolvedId: "$cbb:intentional-blank", sourceElementId: "blank", region: "body")) <cbb-source>\n#box(width: 0pt, height: 0pt)[]\n#pagebreak()\n',
    );

    const secondBlank = directNode("blankSecond", {
      type: "pageBreak",
      data: { intent: "intentionalBlank" },
    });
    const consecutive = generate(inputFor([before, blank, secondBlank, after]));
    expect(consecutive.source.match(/#pagebreak\(weak: true\)/gu)).toHaveLength(2);
    expect(consecutive.source.match(/resolvedId: "\$cbb:intentional-blank"/gu)).toHaveLength(2);
    expect(consecutive.source).toContain(
      'resolvedId: "$cbb:intentional-blank", sourceElementId: "blankSecond", region: "body"',
    );
  });

  it("rejects a tree paired with different hashed elements or page elements", () => {
    const body = directNode("body", {
      type: "text",
      data: { content: { kind: "plain", text: "Original" } },
    });
    const input = inputFor([body]);
    const projectedBody = input.projection.elements[0];
    if (projectedBody?.type !== "text") throw new Error("test fixture drift");
    expect(() =>
      generate({
        ...input,
        projection: {
          ...input.projection,
          elements: [
            {
              ...projectedBody,
              data: { content: { kind: "plain", text: "Different" } },
            },
          ],
        },
      }),
    ).toThrow(/tree does not match projection/);

    const pageNode = directNode("pageText", {
      type: "text",
      data: { content: { kind: "plain", text: "Footer" } },
    });
    const pageElement: ResolvedPageElement = {
      resolvedId: "pageWrap",
      provenance: {
        kind: "direct",
        sourceElementId: "pageWrap",
        expansions: [],
      },
      purpose: "footer",
      target: { mode: "all" },
      layer: "overlay",
      region: "bottomMargin",
      anchor: "bottomCenter",
      x: "0pt",
      y: "0pt",
      width: "100%",
      height: "auto",
      zIndex: 0,
      clipToRegion: true,
      semantic: { mode: "artifact" },
      element: pageNode,
    };
    const withPage = inputFor([], [pageElement]);
    const projectedPage = withPage.projection.pageElements[0];
    if (projectedPage === undefined) throw new Error("test fixture drift");
    expect(() =>
      generate({
        ...withPage,
        projection: {
          ...withPage.projection,
          pageElements: [{ ...projectedPage, x: "1pt" }],
        },
      }),
    ).toThrow(/tree does not match projection/);
  });

  it("materializes visual defaults for equal projection, source, and render hash", () => {
    const implicit = inputFor([
      directNode("same", {
        type: "text",
        data: { content: { kind: "plain", text: "Same" } },
      }),
    ]);
    const explicit = inputFor([
      directNode("same", {
        type: "text",
        breakPolicy: "auto",
        margin: 0,
        padding: 0,
        style: {
          fontSize: 11,
          fontWeight: "regular",
          fontStyle: "normal",
          color: "#251d18",
          background: "transparent",
          borderColor: "#d8cdbd",
          borderWidth: 0,
          align: "left",
          verticalAlign: "top",
        },
        data: { content: { kind: "plain", text: "Same" } },
      }),
    ]);

    expect(canonicalStringify(implicit.projection)).toBe(
      canonicalStringify(explicit.projection),
    );
    expect(generate(implicit).source).toBe(generate(explicit).source);
    expect(projectionRenderHash(implicit.projection)).toBe(
      projectionRenderHash(explicit.projection),
    );
    // Default alignment must not wrap block-level content in Typst `align`.
    // That wrapper collapses the measured height of nested blocks and lets the
    // next body element paint over them in a real PDF.
    const implicitSource = generate(implicit).source;
    expect(implicitSource).toContain("#set text(");
    expect(implicitSource).not.toContain("#align(left)[");
    expect(implicitSource).not.toContain("#text(font:");
    expect(implicitSource).not.toContain("above: 0pt");
    expect(implicitSource).not.toContain("below: 0pt");

    const bottomAligned = generate(
      inputFor([
        directNode("fixed", {
          type: "text",
          height: "1in",
          style: { verticalAlign: "bottom" },
          data: { content: { kind: "plain", text: "Bottom" } },
        }),
      ]),
    );
    expect(bottomAligned.source).toContain("#align(left + bottom)[");

    const justifiedBottom = generate(
      inputFor([
        directNode("justifiedFixed", {
          type: "text",
          height: "1in",
          style: { align: "justify", verticalAlign: "bottom" },
          data: { content: { kind: "plain", text: "Justified bottom" } },
        }),
      ]),
    );
    expect(justifiedBottom.source).toContain("#set par(justify: true)");
    expect(justifiedBottom.source).toContain("#align(left + bottom)[");
  });

  it("normalizes defaults for date, page-break, grid gaps, canvas, and rights policy", () => {
    const gridChild = directNode("gridText", {
      type: "text",
      data: { content: { kind: "plain", text: "Cell" } },
    });
    const grid = (explicit: boolean): ResolvedNode =>
      directNode("gridDefaults", {
        type: "grid",
        data: {
          rows: 1,
          columns: 1,
          ...(explicit
            ? { rowGap: 0, columnGap: 0, semanticRole: "layout" as const }
            : {}),
        },
        children: [
          {
            resolvedId: "gridWrap",
            provenance: {
              kind: "direct",
              sourceElementId: "gridWrap",
              expansions: [],
            },
            row: 0,
            column: 0,
            element: gridChild,
          },
        ],
      });
    const variant = (explicit: boolean) =>
      inputFor([
        directNode("dateDefault", {
          type: "date",
          data: {
            value: "2026-07-12",
            ...(explicit
              ? { format: "MMMM D, YYYY", prefix: "", suffix: "" }
              : {}),
          },
        }),
        directNode("breakDefault", {
          type: "pageBreak",
          data: explicit ? { intent: "flowBreak" } : {},
        }),
        grid(explicit),
        directNode("canvasDefault", {
          type: "canvas",
          ...(explicit ? { width: "100%", height: "auto" } : {}),
          children: [],
        }),
        directNode("rightsDefault", {
          type: "rightsAttribution",
          data: {
            groupOrder: ["scripture", "music", "other"],
            ...(explicit
              ? {
                  sortPolicy: "firstAppearance" as const,
                  includePublicDomainLines: false,
                }
              : {}),
          },
        }),
      ]);
    const implicit = variant(false);
    const explicit = variant(true);
    expect(canonicalStringify(implicit.projection)).toBe(
      canonicalStringify(explicit.projection),
    );
    expect(generate(implicit).source).toBe(generate(explicit).source);
    expect(projectionRenderHash(implicit.projection)).toBe(
      projectionRenderHash(explicit.projection),
    );
  });

  it("emits each exact rights line as a separately escaped text leaf", () => {
    const contribution: ResolvedRightsContribution = {
      firstAppearance: 0,
      creditKey: "credit:test",
      creditProjectionHash: `sha256:${"b".repeat(64)}`,
      component: "text",
      status: "copyrighted",
      creditRequiredWhen: "always",
      requiredCreditLineApplies: true,
      requiredCreditLine: "First exact line.\nSecond exact line.",
    };
    const input = inputFor(
      [
        directNode("rights", {
          type: "rightsAttribution",
          data: { groupOrder: ["scripture", "music", "other"] },
        }),
      ],
      [],
      { rightsContributions: [contribution] },
    );
    const result = generate(input);
    expect(result.source).toContain(
      '#text("First exact line.")#linebreak()#text("Second exact line.")',
    );
    expect(result.source).not.toContain('First exact line.\\nSecond exact line.');
  });

  it("blocks required active rights when no generated rights block exists", () => {
    const contribution: ResolvedRightsContribution = {
      firstAppearance: 0,
      creditKey: "credit:missing-block",
      creditProjectionHash: `sha256:${"c".repeat(64)}`,
      component: "scriptureTranslation",
      status: "copyrighted",
      creditRequiredWhen: "always",
      requiredCreditLineApplies: true,
      requiredCreditLine: "Required credit.",
    };
    const result = generate(
      inputFor(
        [
          directNode("bodyOnly", {
            type: "text",
            data: { content: { kind: "plain", text: "Body" } },
          }),
        ],
        [],
        { rightsContributions: [contribution] },
      ),
    );
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: "CBB-RIGHTS-0001",
        severity: "error",
        kind: "rightsGeneration",
      }),
    );
  });

  it("resolves page rectangles, preserves layers, and styles generated numbers", () => {
    const pageEntry = (
      resolvedId: string,
      layer: ResolvedPageElement["layer"],
      purpose: ResolvedPageElement["purpose"],
      text: string,
      zIndex: number,
      style: ResolvedNode["element"]["style"] = undefined,
    ): ResolvedPageElement => ({
      resolvedId,
      provenance: { kind: "direct", sourceElementId: resolvedId, expansions: [] },
      purpose,
      target: { mode: "all" },
      layer,
      region: purpose === "background" ? "page" : "bottomMargin",
      anchor: "bottomCenter",
      x: "0pt",
      y: "0pt",
      width: "100%",
      height: "18pt",
      zIndex,
      clipToRegion: true,
      semantic: { mode: "artifact" },
      element: directNode(`${resolvedId}Text`, {
        type: "text",
        ...(style !== undefined ? { style } : {}),
        data: { content: { kind: "plain", text } },
      }),
    });
    const background = pageEntry("background", "background", "background", "BG", 100);
    const underlay = pageEntry("underlay", "underlay", "decoration", "UNDER", -100);
    const pageNumber = pageEntry(
      "number",
      "overlay",
      "pageNumber",
      "ignored placeholder",
      0,
      { fontWeight: "bold", color: "#251d18", align: "right" },
    );
    const result = generate(
      inputFor([], [underlay, background, pageNumber], {
        page: {
          ...PROJECTION_BASE.page,
          marginMode: "mirrored",
          binding: "right",
          margins: {
            top: "36pt",
            bottom: "42pt",
            inner: "24pt",
            outer: "30pt",
          },
        },
      }),
    );
    expect(result.source).toContain("let left = if not odd { 24pt } else { 30pt }");
    expect(result.source).toContain(
      'cbb_page_region(cbb_page_number, "bottomMargin")',
    );
    expect(result.source).toContain(
      "block(width: cbb_region.width, height: cbb_region.height, clip: true)",
    );
    expect(result.source.indexOf('#text("BG")')).toBeLessThan(
      result.source.indexOf('#text("UNDER")'),
    );
    expect(result.source).toContain('weight: 700');
    expect(result.source).toContain('#context counter(page).display("1")');
    expect(result.source).not.toContain("ignored placeholder");
  });

  it("blocks page content semantics that Typst page callbacks cannot expose to AT", () => {
    const pageNode = directNode("meaningfulText", {
      type: "text",
      data: { content: { kind: "plain", text: "Meaningful footer" } },
    });
    const meaningful: ResolvedPageElement = {
      resolvedId: "meaningful",
      provenance: { kind: "direct", sourceElementId: "meaningful", expansions: [] },
      purpose: "footer",
      target: { mode: "first" },
      layer: "overlay",
      region: "bottomMargin",
      anchor: "bottomLeft",
      x: "0pt",
      y: "0pt",
      width: "100%",
      height: "auto",
      zIndex: 0,
      clipToRegion: true,
      semantic: { mode: "content", readingOrder: "afterBody", order: 0 },
      element: pageNode,
    };
    expect(generate(inputFor([], [meaningful])).findings).toContainEqual(
      expect.objectContaining({
        code: "CBB-PDF-0002",
        severity: "error",
        kind: "unsupportedPageSemantics",
        resolvedId: "meaningful",
      }),
    );
  });

  it("fills authoritative image boxes and blocks focal crops without verified raster dimensions", () => {
    const image = directNode("cover", {
      type: "image",
      data: {
        assetRef: "asset:11111111-1111-4111-8111-111111111111",
        fit: "cover",
        focalPoint: { x: 0.25, y: 0.75 },
        alt: "Cover image",
      },
    });
    const pageImage: ResolvedPageElement = {
      resolvedId: "imageWrap",
      provenance: { kind: "direct", sourceElementId: "imageWrap", expansions: [] },
      purpose: "decoration",
      target: { mode: "first" },
      layer: "overlay",
      region: "content",
      anchor: "center",
      x: "0pt",
      y: "0pt",
      width: "50%",
      height: "1in",
      zIndex: 0,
      clipToRegion: true,
      semantic: { mode: "artifact" },
      element: image,
    };
    const result = generate(inputFor([], [pageImage]), {
      assets: {
        "asset:11111111-1111-4111-8111-111111111111": {
          relativePath: "assets/cover.svg",
        },
      },
    });
    expect(result.source).toContain(
      '#image("assets/cover.svg", fit: "cover", width: 100%, height: 100%',
    );
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: "CBB-LAYOUT-0003",
        kind: "unsupportedImageFocalPoint",
        resolvedId: "cover",
      }),
    );
  });

  it("emits deterministic edge-positioned cover crops for verified canonical rasters", () => {
    const assetRef = "asset:11111111-1111-4111-8111-111111111111";
    const image = directNode("cover", {
      type: "image",
      width: "2in",
      height: "1in",
      data: {
        assetRef,
        fit: "cover",
        focalPoint: { x: 0, y: 1 },
        alt: "Wide cover image",
      },
    });
    const result = generate(inputFor([image]), {
      assets: {
        [assetRef]: {
          relativePath: "assets/cover.png",
          canonicalRasterDimensions: { pixelWidth: 600, pixelHeight: 900 },
        },
      },
    });
    expect(result.findings).not.toContainEqual(expect.objectContaining({
      kind: "unsupportedImageFocalPoint",
    }));
    expect(result.source).toContain("let cbb_source_aspect = 600 / 900");
    expect(result.source).toContain(
      "let cbb_candidate_x = cbb_rendered_width * 0 - cbb_target.width / 2",
    );
    expect(result.source).toContain(
      "let cbb_candidate_y = cbb_rendered_height * 1 - cbb_target.height / 2",
    );
    expect(result.source).toContain(
      "let cbb_origin_x = if cbb_candidate_x < 0pt { 0pt } else if cbb_candidate_x > cbb_overflow_x { cbb_overflow_x } else { cbb_candidate_x }",
    );
    expect(result.source).toContain("let cbb_offset_x = -cbb_origin_x");
    expect(result.source).toContain(
      '#image("assets/cover.png", width: cbb_rendered_width, height: cbb_rendered_height, fit: "stretch", alt: "Wide cover image")',
    );
    expect(result.source).not.toContain(
      '#image("assets/cover.png", fit: "cover", width: 100%, height: 100%',
    );
  });

  it("grows auto canvases from fixed child extents and blocks unknown extents", () => {
    const fixedChild = directNode("fixedChild", {
      type: "text",
      height: "24pt",
      data: { content: { kind: "plain", text: "Placed" } },
    });
    const canvasWith = (child: ResolvedNode): ResolvedNode =>
      directNode("canvas", {
        type: "canvas",
        height: "auto",
        children: [
          {
            resolvedId: "canvasWrap",
            provenance: {
              kind: "direct",
              sourceElementId: "canvasWrap",
              expansions: [],
            },
            x: "6pt",
            y: "12pt",
            element: child,
          },
        ],
      });
    const measured = generate(inputFor([canvasWith(fixedChild)]));
    expect(measured.source).toContain("calc.max(0pt, (12pt + 24pt))");
    expect(measured.findings).toEqual([]);

    const naturalChild = directNode("naturalChild", {
      type: "text",
      data: { content: { kind: "plain", text: "Natural height" } },
    });
    expect(generate(inputFor([canvasWith(naturalChild)])).findings).toContainEqual(
      expect.objectContaining({
        code: "CBB-LAYOUT-0003",
        severity: "error",
        kind: "invalidLayout",
        resolvedId: "canvas",
      }),
    );
  });

  it("fails closed for avoid fragmentation without a measured pagination plan", () => {
    const result = generate(
      inputFor([
        directNode("avoidText", {
          type: "text",
          breakPolicy: "avoid",
          data: { content: { kind: "plain", text: "Keep when it fits." } },
        }),
      ]),
    );
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: "CBB-LAYOUT-0003",
        severity: "error",
        kind: "invalidLayout",
        resolvedId: "avoidText",
        message: expect.stringContaining("measured pagination plan"),
      }),
    );
    // paginateMeasuredFlow owns the fresh-page attempt and oversized natural
    // fragmentation fallback once measured fragments are supplied.
    expect(result.source).toContain("breakable: false");
  });

  it("blocks unsupported Scripture typography snapshots", () => {
    const presentation: EffectiveScripturePresentation = {
      ...PROJECTION_BASE.scripturePresentation,
      typographyPresetSnapshot: { preset: "unmapped" },
    };
    expect(
      generate(
        inputFor([], [], { scripturePresentation: presentation }),
      ).findings,
    ).toContainEqual(
      expect.objectContaining({
        code: "CBB-DOC-0001",
        severity: "error",
        kind: "unsupportedTypographyPreset",
      }),
    );
  });

  it("accepts the closed rendered Scripture typography snapshots", () => {
    const presentation: EffectiveScripturePresentation = {
      ...PROJECTION_BASE.scripturePresentation,
      typographyPresetSnapshot: { preset: "readable", version: 1 },
    };
    expect(generate(inputFor([], [], { scripturePresentation: presentation })).findings)
      .not.toContainEqual(expect.objectContaining({ kind: "unsupportedTypographyPreset" }));
  });
});
