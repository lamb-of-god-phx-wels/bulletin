/**
 * Full deterministic-pipeline demonstration.
 *
 * The portable test exercises the pipeline on every platform. Real compilation
 * stays disabled until the signed release manifest and bundled font bytes are
 * present; using Typst's embedded or platform fonts would invalidate the demo.
 */
import { createHash } from "node:crypto";
import {
  readFileSync,
  readdirSync,
} from "node:fs";
import { join, resolve } from "node:path";
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
  BUNDLED_NOTO_SANS_FAMILY,
  BUNDLED_NOTO_SANS_FONT_REF,
  BUNDLED_NOTO_SANS_SYMBOLS_2_FAMILY,
  BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF,
  DATE_FORMATTER_VERSION,
  generateTypst,
  TYPST_GENERATOR_VERSION,
} from "../packages/core/src/typstgen/index.js";
import { materializeMandatoryFontFallbacks } from "../packages/services/src/resources/materialize.js";

const APP_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SCHEMAS_DIR = join(APP_ROOT, "schemas/v1");
const FIXTURES_DIR = join(APP_ROOT, "test/fixtures");
const FIXTURE_PATH = join(FIXTURES_DIR, "full-featured-bulletin.json");
const LOGO_PATH = join(FIXTURES_DIR, "demo-logo.svg");
const DATE_SOURCE_PATH = join(APP_ROOT, "packages/core/src/typstgen/date.ts");
const LOGO_REF = "asset:44444444-4444-4444-8444-444444444444";

function utf16Compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

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
  const effectiveProjection = materializeMandatoryFontFallbacks(resolved.projection);
  const projection = createSanitizedRenderProjection(
    effectiveProjection as unknown as HashJsonObject,
  );

  const generated = generateTypst(
    { tree: resolved.tree, projection: effectiveProjection },
    {
      assets: { [LOGO_REF]: { relativePath: "assets/demo-logo.svg" } },
      fonts: {
        [BUNDLED_NOTO_SANS_FONT_REF]: { familyName: BUNDLED_NOTO_SANS_FAMILY },
        [BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF]: {
          familyName: BUNDLED_NOTO_SANS_SYMBOLS_2_FAMILY,
        },
      },
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
    // Synthetic identities exercise closure hashing only. They do not stand
    // in for the unresolved signed release records or packaged font bytes.
    fonts: [
      {
        fontRef: BUNDLED_NOTO_SANS_FONT_REF,
        familyDigest: "sha256:3333333333333333333333333333333333333333333333333333333333333333" as Sha256Hash,
        selectedFaces: [{
          faceId: "synthetic-noto-test-face",
          faceHash: "sha256:4444444444444444444444444444444444444444444444444444444444444444" as Sha256Hash,
          faceIndex: 0,
          embedding: "subset",
        }],
      },
      {
        fontRef: BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF,
        familyDigest: "sha256:5555555555555555555555555555555555555555555555555555555555555555" as Sha256Hash,
        selectedFaces: [{
          faceId: "synthetic-symbols-test-face",
          faceHash: "sha256:6666666666666666666666666666666666666666666666666666666666666666" as Sha256Hash,
          faceIndex: 0,
          embedding: "subset",
        }],
      },
    ],
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
      'font: ("Noto Sans", "Noto Sans Symbols 2")',
    );
    expect({
      fixtureHash: output.fixtureHash,
      projectionHash: output.projectionHash,
      sourceHash: output.sourceHash,
      renderHash: output.renderHash,
    }).toEqual({
      fixtureHash: "sha256:d796d03a4246ba6b9d4f37be505542d037652c82fd9775dbda7990949bd9b086",
      projectionHash: "sha256:ebf753ae135f91069784c7c544bef4b4d5f98dad50a3fcbf5676678b9c77c4a6",
      sourceHash: "sha256:c8aaeea67c0ccaf7762f01523f1d257e7a461cf570fe15f28bcf5be1cdf14930",
      renderHash: "sha256:6126338880ffc8bfa426b9b2c99c25f26094a351fd559938b1fa554d14748b20",
    });
  });

  it.skip(
    "compiles identical PDFs after signed bundled-font records and bytes are packaged",
    () => {},
  );
});
