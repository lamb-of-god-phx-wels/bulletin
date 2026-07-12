/**
 * Full deterministic-pipeline demonstration.
 *
 * The portable test exercises the pipeline on every platform. The CLI test
 * additionally compiles the exact generated source twice when a Typst binary
 * is genuinely available and compares the resulting PDF bytes.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  hashCanonical,
  type Sha256Hash,
} from "../packages/core/src/canonical/index.js";
import {
  createSchemaCatalog,
  type SchemaObject,
} from "../packages/core/src/schema/index.js";
import {
  fromJson,
  validateDocumentSemantics,
} from "../packages/core/src/document/index.js";
import { resolveDocument } from "../packages/core/src/resolve/index.js";
import {
  createSanitizedRenderProjection,
  renderInputHash,
  type HashJsonObject,
  type PinnedToolIdentity,
} from "../packages/core/src/hashes/index.js";
import {
  DATE_FORMATTER_VERSION,
  generateTypst,
  TYPST_BUNDLED_DEFAULT_FONT_FAMILY,
  TYPST_GENERATOR_VERSION,
} from "../packages/core/src/typstgen/index.js";

const APP_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SCHEMAS_DIR = join(APP_ROOT, "schemas/v1");
const FIXTURES_DIR = join(APP_ROOT, "test/fixtures");
const FIXTURE_PATH = join(FIXTURES_DIR, "full-featured-bulletin.json");
const LOGO_PATH = join(FIXTURES_DIR, "demo-logo.svg");
const TYPSTGEN_DIR = join(APP_ROOT, "packages/core/src/typstgen");
const DATE_SOURCE_PATH = join(TYPSTGEN_DIR, "date.ts");
const LOGO_REF = "asset:44444444-4444-4444-8444-444444444444";
const EVIDENCE_PNG = join(tmpdir(), "cbb-deterministic-pipeline.png");

function utf16Compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function executableCandidate(path: string): string | undefined {
  try {
    if (!existsSync(path) || !statSync(path).isFile()) return undefined;
    if (process.platform !== "win32") accessSync(path, constants.X_OK);
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

/** Locate an executable using Windows PATHEXT semantics when appropriate. */
function executableOnPath(name: string): string | undefined {
  const pathExtensions =
    process.platform === "win32"
      ? (process.env["PATHEXT"] ?? ".COM;.EXE;.BAT;.CMD")
          .split(";")
          .map((entry) => entry.trim())
          .filter((entry) => entry !== "")
      : [""];
  const hasExecutableExtension = pathExtensions.some(
    (extension) => extension.toLowerCase() === extname(name).toLowerCase(),
  );
  const extensions = hasExecutableExtension ? [""] : pathExtensions;

  for (const rawDirectory of (process.env["PATH"] ?? "").split(delimiter)) {
    const unquoted = rawDirectory.replace(/^"|"$/g, "");
    const directory = unquoted === "" ? process.cwd() : unquoted;
    for (const extension of extensions) {
      const found = executableCandidate(join(directory, `${name}${extension}`));
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

const TYPST_PATH = executableOnPath("typst");

function sha256Bytes(value: Uint8Array): Sha256Hash {
  const digest = createHash("sha256").update(value).digest("hex");
  return `sha256:${digest}` as Sha256Hash;
}

function sha256File(path: string): Sha256Hash {
  return sha256Bytes(readFileSync(path));
}

function sha256Text(value: string): Sha256Hash {
  return sha256Bytes(Buffer.from(value, "utf8"));
}

/** Read the pinned Typst PDF page-tree count without another host tool. */
function typstPdfPageCount(value: Buffer): number {
  const match = /\/Type\s*\/Pages\s*\/Count\s+(\d+)/.exec(
    value.toString("latin1"),
  );
  if (match?.[1] === undefined) {
    throw new Error("Pinned Typst PDF has no readable page-tree count");
  }
  return Number(match[1]);
}

function productionTypstSources(): readonly string[] {
  const visit = (directory: string, relativeDirectory = ""): string[] => {
    const result: string[] = [];
    const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      utf16Compare(a.name, b.name),
    );
    for (const entry of entries) {
      const relativePath =
        relativeDirectory === ""
          ? entry.name
          : `${relativeDirectory}/${entry.name}`;
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        result.push(...visit(absolutePath, relativePath));
      } else if (
        entry.isFile() &&
        entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".test.ts")
      ) {
        result.push(relativePath);
      }
    }
    return result;
  };
  return visit(TYPSTGEN_DIR).sort(utf16Compare);
}

/** Hash path + byte-length + bytes for every production generator source. */
function typstGeneratorSourceHash(): Sha256Hash {
  const hash = createHash("sha256");
  for (const relativePath of productionTypstSources()) {
    const source = readFileSync(join(TYPSTGEN_DIR, ...relativePath.split("/")));
    hash.update(relativePath, "utf8");
    hash.update("\0");
    hash.update(String(source.length), "ascii");
    hash.update("\0");
    hash.update(source);
  }
  return `sha256:${hash.digest("hex")}` as Sha256Hash;
}

function loadSchemaCatalog(): ReturnType<typeof createSchemaCatalog> {
  const schemas = new Map<string, SchemaObject>();
  for (const name of readdirSync(SCHEMAS_DIR)
    .filter((entry) => entry.endsWith(".schema.json"))
    .sort(utf16Compare)) {
    const schema = JSON.parse(
      readFileSync(join(SCHEMAS_DIR, name), "utf8"),
    ) as SchemaObject;
    schemas.set(schema.$id, schema);
  }
  return createSchemaCatalog(schemas);
}

const SYNTHETIC_TOOL_IDENTITIES: readonly PinnedToolIdentity[] = [
  {
    toolId: "typst",
    version: "portable-test-tool-v1",
    toolHash:
      "sha256:1111111111111111111111111111111111111111111111111111111111111111" as Sha256Hash,
  },
  {
    toolId: "cbb-typst-generator",
    version: TYPST_GENERATOR_VERSION,
    toolHash:
      "sha256:2222222222222222222222222222222222222222222222222222222222222222" as Sha256Hash,
  },
];

interface PipelineOutput {
  readonly fixtureHash: Sha256Hash;
  readonly projectionHash: Sha256Hash;
  readonly source: string;
  readonly sourceHash: Sha256Hash;
  readonly renderHash: Sha256Hash;
}

function runPipeline(tools: readonly PinnedToolIdentity[]): PipelineOutput {
  // Parse fresh JSON on every pass so mutation or object identity cannot make
  // the second pass accidentally reuse state from the first.
  const raw: unknown = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
  const document = fromJson(raw, loadSchemaCatalog());
  const semantics = validateDocumentSemantics(document);
  expect(semantics.valid).toBe(true);
  expect(semantics.findings).toEqual([]);

  const resolved = resolveDocument(document);
  expect(resolved.findings).toEqual([]);
  const projection = createSanitizedRenderProjection(
    resolved.projection as unknown as HashJsonObject,
  );

  const generated = generateTypst(
    { tree: resolved.tree, projection: resolved.projection },
    {
      assets: { [LOGO_REF]: { relativePath: "assets/demo-logo.svg" } },
    },
  );
  expect(generated.findings).toEqual([]);

  const renderHash = renderInputHash({
    projection,
    assets: [
      {
        assetRef: LOGO_REF,
        binaryHash: sha256File(LOGO_PATH),
        mediaType: "image/svg+xml",
      },
    ],
    fonts: [],
    tools,
    locale: {
      languageTag: resolved.projection.locale,
      dataVersion: DATE_FORMATTER_VERSION,
      dataHash: sha256File(DATE_SOURCE_PATH),
    },
    outputOptions: {
      outputForm: "readerOrder",
      pdfConformance: "standard",
      watermark: { kind: "none" },
    },
  });

  return {
    fixtureHash: hashCanonical(raw),
    projectionHash: hashCanonical(projection),
    source: generated.source,
    sourceHash: sha256Text(generated.source),
    renderHash,
  };
}

describe("deterministic document pipeline", () => {
  it("keeps portable fixture, projection, source, and render goldens", () => {
    const output = runPipeline(SYNTHETIC_TOOL_IDENTITIES);
    expect(
      output.source.split("Scripture quotation taken from the Holy Bible").length -
        1,
    ).toBe(1);
    expect(output.source).toContain(
      `font: ("${TYPST_BUNDLED_DEFAULT_FONT_FAMILY}",)`,
    );
    expect({
      fixtureHash: output.fixtureHash,
      projectionHash: output.projectionHash,
      sourceHash: output.sourceHash,
      renderHash: output.renderHash,
    }).toEqual({
      fixtureHash: "sha256:d796d03a4246ba6b9d4f37be505542d037652c82fd9775dbda7990949bd9b086",
      projectionHash: "sha256:418b166c10cff38bc6e8e2feffb2c6c1670ae02af1a8dd10a4787c260edbce72",
      sourceHash: "sha256:ebf72f59298cc91f88b106528ad3159c7178a3c4f024d2d6e501f4668fc5833e",
      renderHash: "sha256:e49b30ab53e0b0460bb2e3cc403e41c6cc2c3996ef81f4c69242acdabe449476",
    });
  });

  it.skipIf(TYPST_PATH === undefined)(
    "produces identical source, render identity, and PDF bytes twice",
    () => {
      if (TYPST_PATH === undefined) {
        throw new Error("unreachable: test is skipped when Typst is unavailable");
      }

      const typstVersion = execFileSync(TYPST_PATH, ["--version"], {
        encoding: "utf8",
      }).trim();
      const actualTools: readonly PinnedToolIdentity[] = [
        {
          toolId: "typst",
          version: typstVersion,
          toolHash: sha256File(TYPST_PATH),
        },
        {
          toolId: "cbb-typst-generator",
          version: TYPST_GENERATOR_VERSION,
          toolHash: typstGeneratorSourceHash(),
        },
      ];
      const first = runPipeline(actualTools);
      const second = runPipeline(actualTools);

      expect(first.source).toBe(second.source);
      expect(first.renderHash).toBe(second.renderHash);

      const buildRoot = mkdtempSync(join(tmpdir(), "cbb-deterministic-pipeline-"));
      const assetsDir = join(buildRoot, "assets");
      mkdirSync(assetsDir, { recursive: true });
      copyFileSync(LOGO_PATH, join(assetsDir, "demo-logo.svg"));
      const sourcePath = join(buildRoot, "bulletin.typ");
      const firstPdfPath = join(buildRoot, "first.pdf");
      const secondPdfPath = join(buildRoot, "second.pdf");
      writeFileSync(sourcePath, first.source, "utf8");

      const compile = (outputPath: string): void => {
        // The generator pins Typst's embedded Libertinus Serif; excluding
        // system fonts prevents the host font registry from affecting bytes.
        execFileSync(
          TYPST_PATH,
          [
            "compile",
            "--ignore-system-fonts",
            "--creation-timestamp",
            "0",
            "--root",
            buildRoot,
            sourcePath,
            outputPath,
          ],
          { cwd: buildRoot, encoding: "utf8" },
        );
      };
      compile(firstPdfPath);
      compile(secondPdfPath);

      const firstPdf = readFileSync(firstPdfPath);
      const secondPdf = readFileSync(secondPdfPath);
      expect(firstPdf.length).toBeGreaterThan(0);
      expect(firstPdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
      expect(firstPdf.equals(secondPdf)).toBe(true);
      expect(typstPdfPageCount(firstPdf)).toBe(3);

      // Leave a human-inspectable first-page artifact in the platform temp
      // directory (/tmp on Linux) without checking generated files into Git.
      execFileSync(
        TYPST_PATH,
        [
          "compile",
          "--ignore-system-fonts",
          "--creation-timestamp",
          "0",
          "--root",
          buildRoot,
          "--format",
          "png",
          "--pages",
          "1",
          sourcePath,
          EVIDENCE_PNG,
        ],
        { cwd: buildRoot, encoding: "utf8" },
      );
      expect(statSync(EVIDENCE_PNG).size).toBeGreaterThan(0);
      expect(readFileSync(EVIDENCE_PNG).subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
    },
    60_000,
  );
});
