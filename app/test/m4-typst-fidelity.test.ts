import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUNDLED_NOTO_SANS_FAMILY,
  BUNDLED_NOTO_SANS_FONT_REF,
  BUNDLED_NOTO_SANS_SYMBOLS_2_FAMILY,
  BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF,
  INTENTIONAL_BLANK_NAVIGATION_RESOLVED_ID,
  generateTypst,
  projectResolvedTree,
  type RenderProjection,
  type ResolvedNode,
  type ResolvedRenderTree,
  type TypstAssetBinding,
} from "@cbb/core";
import {
  pageForResolvedSource,
  pageForSource,
  type PdfPreviewNavigationMap,
} from "../packages/ui/src/preview/previewTypes.js";

const TYPST = "/usr/bin/typst";
const PDFINFO = "/usr/bin/pdfinfo";
const FONT_PATH = "/usr/share/fonts/noto";
const NOTO_SANS = join(FONT_PATH, "NotoSans-Regular.ttf");
const NOTO_SYMBOLS = join(FONT_PATH, "NotoSansSymbols2-Regular.ttf");
const RASTER = "/usr/share/pixmaps/archlinux-logo.png";

function runLocalTool(
  executable: string,
  arguments_: readonly string[],
  options: {
    readonly env?: NodeJS.ProcessEnv;
    readonly timeout?: number;
    readonly maxBuffer?: number;
  } = {},
): string {
  const result = spawnSync(executable, arguments_, {
    encoding: "utf8",
    ...options,
  });
  // Some restricted test hosts report a supervisory EPERM even after the
  // pinned child completed successfully. Status and exact output remain the
  // authoritative bounded-process evidence in that case.
  if (result.status !== 0) {
    throw new Error(result.stderr || result.error?.message || `${executable} failed`);
  }
  return result.stdout;
}

function pinnedPrerequisitesAvailable(): boolean {
  if (![TYPST, PDFINFO, NOTO_SANS, NOTO_SYMBOLS, RASTER].every(existsSync)) return false;
  try {
    return runLocalTool(TYPST, ["--version"]).startsWith("typst 0.14.2 ");
  } catch {
    return false;
  }
}

function directNode(
  resolvedId: string,
  element: ResolvedNode["element"],
): ResolvedNode {
  return {
    resolvedId,
    provenance: { kind: "direct", sourceElementId: resolvedId, expansions: [] },
    element,
  };
}

const PROJECTION_BASE: Omit<RenderProjection, "elements" | "pageElements"> = {
  version: 1,
  title: "M4 Typst fidelity",
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

function generatedSource(
  elements: readonly ResolvedNode[],
  assets: Readonly<Record<string, TypstAssetBinding>> = {},
): string {
  const tree: ResolvedRenderTree = {
    elements,
    pageElements: [],
    totalNodeCount: elements.length,
  };
  return generateTypst(
    {
      tree,
      projection: {
        ...PROJECTION_BASE,
        ...projectResolvedTree(tree),
        referencedAssets: Object.keys(assets).map((assetRef) => ({ assetRef })),
      },
    },
    {
      assets,
      fonts: {
        [BUNDLED_NOTO_SANS_FONT_REF]: { familyName: BUNDLED_NOTO_SANS_FAMILY },
        [BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF]: {
          familyName: BUNDLED_NOTO_SANS_SYMBOLS_2_FAMILY,
        },
      },
    },
  ).source;
}

interface LocatedMarker {
  readonly resolvedId: string;
  readonly sourceElementId: string;
  readonly region: "body" | "page-background" | "page-foreground";
  readonly page: number;
}

function typstArguments(root: string): readonly string[] {
  return [
    "--root", root,
    "--font-path", FONT_PATH,
    "--ignore-system-fonts",
    "--ignore-embedded-fonts",
    "--package-path", join(root, "packages"),
    "--package-cache-path", join(root, "cache"),
    "--creation-timestamp", "0",
    "--jobs", "1",
    "--diagnostic-format", "short",
  ];
}

function compileAndLocate(source: string): {
  readonly pageCount: number;
  readonly markers: readonly LocatedMarker[];
} {
  const root = mkdtempSync(join(tmpdir(), "cbb-m4-typst-"));
  try {
    mkdirSync(join(root, "packages"));
    mkdirSync(join(root, "cache"));
    const input = join(root, "main.typ");
    const output = join(root, "output.pdf");
    writeFileSync(input, source, { encoding: "utf8", mode: 0o600 });
    const environment = {
      PATH: "/usr/bin:/bin",
      LANG: "C.UTF-8",
      TZ: "UTC",
      HOME: root,
      SOURCE_DATE_EPOCH: "0",
    };
    runLocalTool(TYPST, ["compile", ...typstArguments(root), input, output], {
      env: environment,
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const details = runLocalTool(PDFINFO, [output], {
      env: environment,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    const pageCount = Number(/^Pages:\s+(\d+)$/mu.exec(details)?.[1]);
    const query = runLocalTool(TYPST, [
      "query",
      ...typstArguments(root),
      input,
      "<cbb-located>",
      "--field", "value",
      "--format", "json",
    ], {
      env: environment,
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return {
      pageCount,
      markers: JSON.parse(query) as LocatedMarker[],
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function text(id: string, value: string): ResolvedNode {
  return directNode(id, {
    type: "text",
    data: { content: { kind: "plain", text: value } },
  });
}

function blank(id: string): ResolvedNode {
  return directNode(id, {
    type: "pageBreak",
    data: { intent: "intentionalBlank" },
  });
}

function navigationMap(markers: readonly LocatedMarker[]): PdfPreviewNavigationMap {
  return {
    version: 1,
    entries: markers.map((marker) => ({
      resolvedId: marker.resolvedId,
      sourceElementId: marker.sourceElementId,
      region: marker.region,
      pageNumber: marker.page,
    })),
  };
}

describe.runIf(pinnedPrerequisitesAvailable())("M4 pinned Typst fidelity", () => {
  it.each([
    {
      name: "leading",
      elements: [blank("blankLeading"), text("afterLeading", "After")],
      pageCount: 2,
      blanks: { blankLeading: 1 },
    },
    {
      name: "middle",
      elements: [text("beforeMiddle", "Before"), blank("blankMiddle"), text("afterMiddle", "After")],
      pageCount: 3,
      blanks: { blankMiddle: 2 },
    },
    {
      name: "trailing",
      elements: [text("beforeTrailing", "Before"), blank("blankTrailing")],
      pageCount: 2,
      blanks: { blankTrailing: 2 },
    },
    {
      name: "consecutive",
      elements: [
        text("beforeConsecutive", "Before"),
        blank("blankFirst"),
        blank("blankSecond"),
        text("afterConsecutive", "After"),
      ],
      pageCount: 4,
      blanks: { blankFirst: 2, blankSecond: 3 },
    },
  ])("locates $name intentional blank pages from post-layout evidence", (fixture) => {
    expect(runLocalTool(TYPST, ["--version"]))
      .toMatch(/^typst 0\.14\.2 /u);
    const compiled = compileAndLocate(generatedSource(fixture.elements));
    expect(compiled.pageCount).toBe(fixture.pageCount);
    const map = navigationMap(compiled.markers);

    for (const [sourceId, expectedPage] of Object.entries(fixture.blanks)) {
      expect(compiled.markers).toContainEqual({
        resolvedId: sourceId,
        sourceElementId: sourceId,
        region: "body",
        page: expectedPage,
      });
      expect(compiled.markers).toContainEqual({
        resolvedId: INTENTIONAL_BLANK_NAVIGATION_RESOLVED_ID,
        sourceElementId: sourceId,
        region: "body",
        page: expectedPage,
      });
      expect(pageForSource(map, sourceId)).toBe(expectedPage);
      expect(pageForResolvedSource(map, sourceId)).toBe(expectedPage);
    }
  });

  it("compiles the exact non-centered raster cover implementation", () => {
    const png = readFileSync(RASTER);
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    const pixelWidth = png.readUInt32BE(16);
    const pixelHeight = png.readUInt32BE(20);
    const assetRef = "asset:00000000-0000-4000-8000-000000000001";
    const binding: TypstAssetBinding = {
      relativePath: "assets/a0000.png",
      canonicalRasterDimensions: { pixelWidth, pixelHeight },
    };
    const source = generatedSource([
      directNode("focalImage", {
        type: "image",
        width: "2in",
        height: "1in",
        data: {
          assetRef,
          fit: "cover",
          focalPoint: { x: 0.2, y: 0.8 },
          alt: "Pinned focal crop test",
        },
      }),
    ], { [assetRef]: binding });
    expect(source).toContain("let cbb_candidate_x = cbb_rendered_width * 0.2 - cbb_target.width / 2");
    expect(source).toContain("let cbb_candidate_y = cbb_rendered_height * 0.8 - cbb_target.height / 2");
    expect(source).toContain("else if cbb_candidate_x > cbb_overflow_x { cbb_overflow_x }");

    const root = mkdtempSync(join(tmpdir(), "cbb-m4-focal-"));
    try {
      mkdirSync(join(root, "assets"));
      mkdirSync(join(root, "packages"));
      mkdirSync(join(root, "cache"));
      copyFileSync(RASTER, join(root, "assets", "a0000.png"));
      const input = join(root, "main.typ");
      const output = join(root, "output.pdf");
      writeFileSync(input, source, { encoding: "utf8", mode: 0o600 });
      expect(() => runLocalTool(TYPST, ["compile", ...typstArguments(root), input, output], {
        env: {
          PATH: "/usr/bin:/bin",
          LANG: "C.UTF-8",
          TZ: "UTC",
          HOME: root,
          SOURCE_DATE_EPOCH: "0",
        },
        timeout: 30_000,
        maxBuffer: 8 * 1024 * 1024,
      })).not.toThrow();
      expect(readFileSync(output).subarray(0, 5).toString("ascii")).toBe("%PDF-");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
