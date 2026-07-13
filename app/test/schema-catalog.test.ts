/**
 * Schema catalog integration tests.
 *
 * Loads every schema from schemas/v1/ into Ajv 2020-12, asserts all compile
 * with offline ref resolution, and validates fixture documents.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import Ajv, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, it, expect, beforeAll } from "vitest";
import {
  customElementDefinitionHash,
  normalizeDocumentForCurrentUse,
  type CustomElementDefinition,
} from "../packages/core/src/document/index.js";

const SCHEMAS_DIR = resolve(__dirname, "../schemas/v1");
const FIXTURES_DIR = resolve(__dirname, "fixtures");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

function listSchemaFiles(): string[] {
  return readdirSync(SCHEMAS_DIR)
    .filter((f) => f.endsWith(".schema.json"))
    .map((f) => join(SCHEMAS_DIR, f));
}

function listFixtureFiles(): string[] {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => join(FIXTURES_DIR, f));
}

// ---------------------------------------------------------------------------
// Ajv setup — load all schemas before any compile
// ---------------------------------------------------------------------------

let ajv: Ajv;
let schemaMap: Map<string, unknown>;

beforeAll(() => {
  ajv = new Ajv({
    strict: true,
    allErrors: true,
    // Disable loading from network; all refs must be pre-added.
    loadSchema: undefined,
  });
  // ajv-formats provides "date" and other format validators.
  addFormats(ajv as Parameters<typeof addFormats>[0]);

  schemaMap = new Map<string, unknown>();
  for (const filePath of listSchemaFiles()) {
    const schema = loadJson(filePath) as Record<string, unknown>;
    const id = schema["$id"] as string;
    schemaMap.set(id, schema);
    ajv.addSchema(schema);
  }
});

// ---------------------------------------------------------------------------
// 1. All schemas compile without errors
// ---------------------------------------------------------------------------

describe("schema compilation", () => {
  it("loads all v1 schema files from the catalog directory", () => {
    const files = listSchemaFiles();
    expect(files.length).toBeGreaterThanOrEqual(16);
  });

  it("every schema has a correct $id starting with the CBB URI prefix", () => {
    for (const filePath of listSchemaFiles()) {
      const schema = loadJson(filePath) as Record<string, unknown>;
      const id = schema["$id"] as string;
      expect(
        id,
        `Schema at ${filePath} must have a $id`
      ).toBeTruthy();
      expect(
        id.startsWith("https://church-bulletin-builder.local/schema/v1/"),
        `Schema $id must start with CBB URI prefix, got: ${id}`
      ).toBe(true);
    }
  });

  it("all schemas compile in Ajv with offline ref resolution", () => {
    for (const [id] of schemaMap) {
      let validate: ValidateFunction | undefined;
      expect(
        () => {
          validate = ajv.getSchema(id);
          if (!validate) {
            // Force compilation
            validate = ajv.compile(schemaMap.get(id) as object);
          }
        },
        `Schema ${id} should compile without errors`
      ).not.toThrow();
      expect(validate, `Schema ${id} should produce a validate function`).toBeDefined();
    }
  });

  it("document.schema.json has the correct $id", () => {
    expect(
      schemaMap.has(
        "https://church-bulletin-builder.local/schema/v1/document.schema.json"
      )
    ).toBe(true);
  });

  it("required catalog schemas are all present", () => {
    const required = [
      "common.schema.json",
      "document.schema.json",
      "element.schema.json",
      "richText.schema.json",
      "rights.schema.json",
      "scripture-catalog.schema.json",
      "customElement.schema.json",
      "ai-exchange.schema.json",
      "manifest.schema.json",
      "workspace.schema.json",
      "pack-feed.schema.json",
      "church-profile.schema.json",
      "weekly-work.schema.json",
      "backup-manifest.schema.json",
      "asset-record.schema.json",
      "font-record.schema.json",
      "settings.schema.json",
      "artifact-record.schema.json",
      "diagnostic-catalog.schema.json",
      "template.schema.json",
    ];
    for (const name of required) {
      const id = `https://church-bulletin-builder.local/schema/v1/${name}`;
      expect(
        schemaMap.has(id),
        `Required schema not found in catalog: ${name}`
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Compile the document validator once for reuse
// ---------------------------------------------------------------------------

function getDocumentValidator(): ValidateFunction {
  const id =
    "https://church-bulletin-builder.local/schema/v1/document.schema.json";
  const validate = ajv.getSchema(id);
  if (!validate) {
    throw new Error(`document.schema.json not found in Ajv`);
  }
  return validate;
}

function getSettingsValidator(): ValidateFunction {
  const id =
    "https://church-bulletin-builder.local/schema/v1/settings.schema.json";
  const validate = ajv.getSchema(id);
  if (!validate) {
    throw new Error(`settings.schema.json not found in Ajv`);
  }
  return validate;
}

function getChurchProfileValidator(): ValidateFunction {
  const id =
    "https://church-bulletin-builder.local/schema/v1/church-profile.schema.json";
  const validate = ajv.getSchema(id);
  if (!validate) {
    throw new Error("church-profile.schema.json not found in Ajv");
  }
  return validate;
}

describe("v1 application and workspace settings", () => {
  it("preserves the pre-M4 minimal variants as inheritance-only settings", () => {
    const validate = getSettingsValidator();
    expect(validate({ version: 1, kind: "globalSettings" })).toBe(true);
    expect(validate({ version: 1, kind: "workspaceSettings" })).toBe(true);
  });

  it("accepts the complete application defaults with the spec-facing scope", () => {
    const validate = getSettingsValidator();
    expect(validate({
      version: 1,
      kind: "globalSettings",
      scope: "application",
      defaultLanguage: "en-US",
      theme: "system",
      viewMode: "page",
      pagePresentation: "facing",
      previewZoom: "fitPage",
      marginGuides: true,
      livePreview: true,
      technicalPdfDetails: false,
      canvasSnap: true,
      snapGridSize: "0.125in",
      exportFilenamePattern: "{date:YYYY-MM-DD} {name}.pdf",
      offlineSpellcheck: true,
      displayTimeZone: "America/Phoenix",
      telemetryEnabled: false,
    })).toBe(true);
  });

  it("accepts complete workspace overrides alongside the existing M3 fields", () => {
    const validate = getSettingsValidator();
    expect(validate({
      version: 1,
      kind: "workspaceSettings",
      scope: "workspace",
      viewMode: "contiguous",
      pagePresentation: "single",
      previewZoom: 125,
      marginGuides: false,
      livePreview: false,
      technicalPdfDetails: true,
      canvasSnap: false,
      snapGridSize: "9pt",
      exportFilenamePattern: "{name} {date:YYYY-MM-DD}.pdf",
      offlineSpellcheck: false,
      displayTimeZone: "UTC",
      defaultExportFormat: "bookletTwoUp",
      previewResolution: 144,
      sourceTemplateLinks: [{
        bulletinLocalResourceId: "10000000-0000-4000-8000-000000000001",
        templateLocalResourceId: "10000000-0000-4000-8000-000000000002",
      }],
    })).toBe(true);
  });

  it("accepts the exact explicit-zoom boundaries and sub-unit positive snap sizes", () => {
    const validate = getSettingsValidator();
    expect(validate({ version: 1, kind: "workspaceSettings", previewZoom: 25 })).toBe(true);
    expect(validate({ version: 1, kind: "workspaceSettings", previewZoom: 200 })).toBe(true);
    expect(validate({
      version: 1,
      kind: "workspaceSettings",
      snapGridSize: "0.0001in",
    })).toBe(true);
  });

  it("accepts bounded workspace-local first-run progress for restart recovery", () => {
    const validate = getSettingsValidator();
    expect(validate({
      version: 1,
      kind: "workspaceSettings",
      firstRun: {
        version: 1,
        disposition: "inProgress",
        step: 1,
        churchName: "Lamb of God",
        mailingAddress: "2210 E. Indian School Road",
        locationAddress: "2210 E. Indian School Road",
        phone: "602-555-0100",
        email: "office@example.test",
        website: "https://example.test",
        preferredOutput: "foldedBooklet",
        starterId: "folded-letter",
        createPracticeBulletin: true,
      },
    })).toBe(true);
  });

  it.each([
    ["mismatched application scope", { version: 1, kind: "globalSettings", scope: "workspace" }],
    ["workspace theme override", { version: 1, kind: "workspaceSettings", theme: "dark" }],
    ["zoom below 25 percent", { version: 1, kind: "workspaceSettings", previewZoom: 24 }],
    ["zoom above 200 percent", { version: 1, kind: "workspaceSettings", previewZoom: 201 }],
    ["fractional explicit zoom", { version: 1, kind: "workspaceSettings", previewZoom: 99.5 }],
    ["zero snap interval", { version: 1, kind: "workspaceSettings", snapGridSize: "0in" }],
    ["unitless-leading decimal", { version: 1, kind: "workspaceSettings", snapGridSize: ".5in" }],
    ["path-like time zone", { version: 1, kind: "workspaceSettings", displayTimeZone: "../Phoenix" }],
    ["path separator in filename pattern", { version: 1, kind: "workspaceSettings", exportFilenamePattern: "../{name}.pdf" }],
    ["unbounded locale string", { version: 1, kind: "globalSettings", defaultLanguage: "not_a_locale" }],
    ["connection preference leakage", { version: 1, kind: "workspaceSettings", checkOnOpen: true }],
    ["unbounded first-run profile text", {
      version: 1,
      kind: "workspaceSettings",
      firstRun: { version: 1, disposition: "inProgress", churchName: "x".repeat(121) },
    }],
    ["control text in a first-run address", {
      version: 1,
      kind: "workspaceSettings",
      firstRun: { version: 1, disposition: "inProgress", mailingAddress: "unsafe\naddress" },
    }],
    ["draft answers on a completed first run", {
      version: 1,
      kind: "workspaceSettings",
      firstRun: { version: 1, disposition: "completed", step: 2, churchName: "Not a draft" },
    }],
    ["path-bearing source template link", {
      version: 1,
      kind: "workspaceSettings",
      sourceTemplateLinks: [{
        bulletinLocalResourceId: "10000000-0000-4000-8000-000000000001",
        templateLocalResourceId: "/tmp/template.json",
      }],
    }],
    ["source template link with an extra portable field", {
      version: 1,
      kind: "workspaceSettings",
      sourceTemplateLinks: [{
        bulletinLocalResourceId: "10000000-0000-4000-8000-000000000001",
        templateLocalResourceId: "10000000-0000-4000-8000-000000000002",
        sourceDocument: { kind: "template" },
      }],
    }],
  ])("rejects %s", (_label, value) => {
    const validate = getSettingsValidator();
    expect(validate(value)).toBe(false);
  });
});

describe("v1 Church Profile mappable values", () => {
  it("accepts the canonical text values and portable logo reference", () => {
    const validate = getChurchProfileValidator();
    expect(validate({
      version: 1,
      kind: "churchProfile",
      churchName: "Lamb of God",
      mailingAddress: "2210 E. Indian School Road",
      locationAddress: "2210 E. Indian School Road",
      phone: "602-555-0100",
      email: "office@example.test",
      website: "https://example.test",
      defaultServiceLabel: "Sunday Worship",
      logo: "asset:44444444-4444-4444-8444-444444444444",
      language: "en-US",
    })).toBe(true);
  });

  it("rejects a non-portable logo reference", () => {
    const validate = getChurchProfileValidator();
    expect(validate({
      version: 1,
      kind: "churchProfile",
      logo: "/tmp/church-logo.png",
    })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Valid fixture documents must pass
// ---------------------------------------------------------------------------

describe("valid fixtures pass document schema", () => {
  it("minimal-bulletin.json is valid", () => {
    const validate = getDocumentValidator();
    const doc = normalizeDocumentForCurrentUse(
      loadJson(join(FIXTURES_DIR, "minimal-bulletin.json")),
    );
    const result = validate(doc);
    if (!result) {
      console.error("Validation errors:", validate.errors);
    }
    expect(result).toBe(true);
  });

  it("full-featured-bulletin.json is valid", () => {
    const validate = getDocumentValidator();
    const doc = normalizeDocumentForCurrentUse(
      loadJson(join(FIXTURES_DIR, "full-featured-bulletin.json")),
    );
    const result = validate(doc);
    if (!result) {
      console.error("Validation errors:", JSON.stringify(validate.errors, null, 2));
    }
    expect(result).toBe(true);
  });

  it("full-featured-template.json is valid", () => {
    const validate = getDocumentValidator();
    const doc = normalizeDocumentForCurrentUse(
      loadJson(join(FIXTURES_DIR, "full-featured-template.json")),
    );
    const result = validate(doc);
    if (!result) {
      console.error("Validation errors:", JSON.stringify(validate.errors, null, 2));
    }
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Invalid fixtures must FAIL with the right error
// ---------------------------------------------------------------------------

interface InvalidCase {
  file: string;
  expectKeyword: string;
  expectPath?: string;
  description: string;
}

const invalidCases: InvalidCase[] = [
  {
    file: "invalid-bad-kind.json",
    expectKeyword: "enum",
    expectPath: "/kind",
    description: "kind must be bulletin or template",
  },
  {
    file: "invalid-missing-version.json",
    expectKeyword: "required",
    description: "version field is required",
  },
  {
    file: "invalid-text-element-missing-content.json",
    expectKeyword: "required",
    description: "data.content is required in text element",
  },
  {
    file: "invalid-image-stretch-fit.json",
    expectKeyword: "enum",
    description: "image fit must be contain or cover, not stretch",
  },
  {
    file: "invalid-music-missing-rights.json",
    expectKeyword: "required",
    description: "music element requires rights array",
  },
  {
    file: "invalid-date-bad-format.json",
    expectKeyword: "pattern",
    description: "date value must be valid YYYY-MM-DD (month 13 is invalid)",
  },
  {
    file: "invalid-page-break-bad-intent.json",
    expectKeyword: "enum",
    description: "pageBreak intent must be flowBreak or intentionalBlank",
  },
  {
    file: "invalid-rights-bad-component.json",
    expectKeyword: "enum",
    description: "rights component must be one of the allowed values",
  },
  {
    file: "invalid-length-bad-unit.json",
    expectKeyword: "pattern",
    description: "typstWidth px is not a valid physical length",
  },
  {
    file: "invalid-node-id-bad-pattern.json",
    expectKeyword: "pattern",
    description: "element id must start with a letter",
  },
  {
    file: "invalid-additional-prop.json",
    expectKeyword: "additionalProperties",
    description: "top-level additional properties must be rejected",
  },
  {
    file: "invalid-scripture-empty-verses.json",
    expectKeyword: "minItems",
    description: "verseStructured scripture must have at least one verse",
  },
  {
    file: "invalid-date-year-zero.json",
    expectKeyword: "pattern",
    description: "date value year 0000 is invalid (spec: years 0001-9999)",
  },
];

describe("invalid fixtures fail with correct error keyword", () => {
  for (const tc of invalidCases) {
    it(`${tc.file}: ${tc.description}`, () => {
      const validate = getDocumentValidator();
      const doc = loadJson(join(FIXTURES_DIR, tc.file));
      const result = validate(doc);
      expect(result, `Expected validation to fail for ${tc.file}`).toBe(false);

      const errors = validate.errors ?? [];
      expect(errors.length, `Expected at least one error for ${tc.file}`).toBeGreaterThan(0);

      const matchingError = errors.find(
        (e) => e.keyword === tc.expectKeyword
      );
      expect(
        matchingError,
        `Expected error with keyword '${tc.expectKeyword}' for ${tc.file}. Got: ${JSON.stringify(errors.map((e) => ({ keyword: e.keyword, instancePath: e.instancePath, message: e.message })), null, 2)}`
      ).toBeDefined();

      if (tc.expectPath !== undefined) {
        expect(
          matchingError?.instancePath,
          `Expected error at path '${tc.expectPath}' for ${tc.file}`
        ).toBe(tc.expectPath);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 5. Schema-specific structural invariants
// ---------------------------------------------------------------------------

describe("common.schema.json primitives", () => {
  function getCommonDef(defName: string): ValidateFunction {
    const id = `https://church-bulletin-builder.local/schema/v1/common.schema.json#/$defs/${defName}`;
    let validate = ajv.getSchema(id);
    if (!validate) {
      validate = ajv.compile({ "$ref": id });
    }
    return validate;
  }

  describe("nodeId", () => {
    it("accepts valid ids", () => {
      const v = getCommonDef("nodeId");
      expect(v("abcDEF123")).toBe(true);
      expect(v("A")).toBe(true);
      expect(v("text-el_1")).toBe(true);
    });
    it("rejects ids starting with a digit", () => {
      const v = getCommonDef("nodeId");
      expect(v("1bad")).toBe(false);
    });
    it("rejects empty string", () => {
      const v = getCommonDef("nodeId");
      expect(v("")).toBe(false);
    });
  });

  describe("physicalLength", () => {
    it("accepts valid physical lengths", () => {
      const v = getCommonDef("physicalLength");
      expect(v("1in")).toBe(true);
      expect(v("8.5in")).toBe(true);
      expect(v("72pt")).toBe(true);
      expect(v("2.54cm")).toBe(true);
      expect(v("25.4mm")).toBe(true);
      expect(v("0.5in")).toBe(true);
    });
    it("rejects px unit", () => {
      const v = getCommonDef("physicalLength");
      expect(v("96px")).toBe(false);
    });
    it("rejects fr unit (not physical)", () => {
      const v = getCommonDef("physicalLength");
      expect(v("1fr")).toBe(false);
    });
    it("rejects auto", () => {
      const v = getCommonDef("physicalLength");
      expect(v("auto")).toBe(false);
    });
    it("rejects bare number", () => {
      const v = getCommonDef("physicalLength");
      expect(v(7 as unknown as string)).toBe(false);
    });
  });

  describe("sha256Hash", () => {
    it("accepts valid sha256 hash", () => {
      const v = getCommonDef("sha256Hash");
      expect(v("sha256:" + "a".repeat(64))).toBe(true);
    });
    it("rejects hash without prefix", () => {
      const v = getCommonDef("sha256Hash");
      expect(v("a".repeat(64))).toBe(false);
    });
    it("rejects wrong length hash", () => {
      const v = getCommonDef("sha256Hash");
      expect(v("sha256:" + "a".repeat(63))).toBe(false);
    });
    it("rejects uppercase hex", () => {
      const v = getCommonDef("sha256Hash");
      expect(v("sha256:" + "A".repeat(64))).toBe(false);
    });
  });

  describe("isoDate", () => {
    it("accepts valid date", () => {
      const v = getCommonDef("isoDate");
      expect(v("2026-07-05")).toBe(true);
    });
    it("rejects invalid month 13", () => {
      const v = getCommonDef("isoDate");
      expect(v("2026-13-01")).toBe(false);
    });
    it("rejects invalid day 00", () => {
      const v = getCommonDef("isoDate");
      expect(v("2026-01-00")).toBe(false);
    });
  });

  describe("portableAssetId", () => {
    it("accepts valid asset ref", () => {
      const v = getCommonDef("portableAssetId");
      expect(v("asset:44444444-4444-4444-8444-444444444444")).toBe(true);
    });
    it("rejects bare uuid without asset: prefix", () => {
      const v = getCommonDef("portableAssetId");
      expect(v("44444444-4444-4444-8444-444444444444")).toBe(false);
    });
    it("rejects font: prefix", () => {
      const v = getCommonDef("portableAssetId");
      expect(v("font:44444444-4444-4444-8444-444444444444")).toBe(false);
    });
  });

  describe("Church Profile field mappings", () => {
    it("closes the mappable key vocabulary and excludes language", () => {
      const v = getCommonDef("churchProfileFieldKey");
      for (const key of [
        "churchName",
        "mailingAddress",
        "locationAddress",
        "phone",
        "email",
        "website",
        "defaultServiceLabel",
        "logo",
      ]) {
        expect(v(key), key).toBe(true);
      }
      expect(v("language")).toBe(false);
      expect(v("congregationName")).toBe(false);
    });

    it("allows text keys only on text fields and logo only on assetRef fields", () => {
      const v = getCommonDef("fieldDefinition");
      const field = {
        id: "profileValue",
        label: "Profile value",
        required: false,
      };
      expect(v({ ...field, type: "text", profileKey: "churchName" })).toBe(true);
      expect(v({ ...field, type: "text", profileKey: "defaultServiceLabel" })).toBe(true);
      expect(v({ ...field, type: "assetRef", profileKey: "logo" })).toBe(true);
      expect(v({ ...field, type: "choice", profileKey: "churchName" })).toBe(false);
      expect(v({ ...field, type: "text", profileKey: "logo" })).toBe(false);
      expect(v({ ...field, type: "assetRef", profileKey: "website" })).toBe(false);
      expect(v({ ...field, type: "text", profileKey: "language" })).toBe(false);
    });
  });

  describe("colorValue", () => {
    it("accepts 6-digit hex", () => {
      const v = getCommonDef("colorValue");
      expect(v("#ffffff")).toBe(true);
      expect(v("#251d18")).toBe(true);
    });
    it("accepts 3-digit hex", () => {
      const v = getCommonDef("colorValue");
      expect(v("#fff")).toBe(true);
    });
    it("accepts transparent", () => {
      const v = getCommonDef("colorValue");
      expect(v("transparent")).toBe(true);
    });
    it("rejects invalid value", () => {
      const v = getCommonDef("colorValue");
      expect(v("red")).toBe(false);
      expect(v("#gggggg")).toBe(false);
    });
  });

  describe("publicationContexts", () => {
    it("accepts both contexts", () => {
      const v = getCommonDef("publicationContexts");
      expect(v(["printedNonsalableChurchBulletin", "digitalNonsalableChurchBulletin"])).toBe(true);
    });
    it("accepts single context", () => {
      const v = getCommonDef("publicationContexts");
      expect(v(["printedNonsalableChurchBulletin"])).toBe(true);
    });
    it("rejects empty array (minItems: 1)", () => {
      const v = getCommonDef("publicationContexts");
      expect(v([])).toBe(false);
    });
    it("rejects unknown context", () => {
      const v = getCommonDef("publicationContexts");
      expect(v(["onlineStream"])).toBe(false);
    });
    it("rejects duplicate items", () => {
      const v = getCommonDef("publicationContexts");
      expect(v([
        "printedNonsalableChurchBulletin",
        "printedNonsalableChurchBulletin"
      ])).toBe(false);
    });
  });
});

describe("element.schema.json structural checks", () => {
  function getElementValidator(defName: string): ValidateFunction {
    const id = `https://church-bulletin-builder.local/schema/v1/element.schema.json#/$defs/${defName}`;
    let validate = ajv.getSchema(id);
    if (!validate) {
      validate = ajv.compile({ "$ref": id });
    }
    return validate;
  }

  describe("textElement", () => {
    it("accepts plain text content", () => {
      const v = getElementValidator("textElement");
      expect(v({
        id: "t1",
        type: "text",
        name: "Test",
        data: { content: { kind: "plain", text: "Hello" } }
      })).toBe(true);
    });

    it("accepts richText content", () => {
      const v = getElementValidator("textElement");
      expect(v({
        id: "t1",
        type: "text",
        name: "Test",
        data: {
          content: {
            kind: "richText",
            document: { type: "document", blocks: [] }
          }
        }
      })).toBe(true);
    });

    it("rejects text element with wrong type", () => {
      const v = getElementValidator("textElement");
      expect(v({
        id: "t1",
        type: "image",
        name: "Test",
        data: { content: { kind: "plain", text: "Hello" } }
      })).toBe(false);
    });
  });

  describe("imageElement", () => {
    it("accepts valid image with contain fit", () => {
      const v = getElementValidator("imageElement");
      expect(v({
        id: "img1",
        type: "image",
        name: "Logo",
        data: {
          assetRef: "asset:44444444-4444-4444-8444-444444444444",
          fit: "contain"
        }
      })).toBe(true);
    });

    it("rejects stretch fit", () => {
      const v = getElementValidator("imageElement");
      expect(v({
        id: "img1",
        type: "image",
        name: "Logo",
        data: {
          assetRef: "asset:44444444-4444-4444-8444-444444444444",
          fit: "stretch"
        }
      })).toBe(false);
    });

    it("rejects focal point outside 0-1 range", () => {
      const v = getElementValidator("imageElement");
      expect(v({
        id: "img1",
        type: "image",
        name: "Logo",
        data: {
          assetRef: "asset:44444444-4444-4444-8444-444444444444",
          fit: "cover",
          focalPoint: { x: 1.5, y: 0.5 }
        }
      })).toBe(false);
    });
  });

  describe("pageBreakElement", () => {
    it("accepts flowBreak intent", () => {
      const v = getElementValidator("pageBreakElement");
      expect(v({
        id: "pb1",
        type: "pageBreak",
        name: "Break",
        data: { intent: "flowBreak" }
      })).toBe(true);
    });

    it("accepts intentionalBlank intent", () => {
      const v = getElementValidator("pageBreakElement");
      expect(v({
        id: "pb1",
        type: "pageBreak",
        name: "Break",
        data: { intent: "intentionalBlank" }
      })).toBe(true);
    });

    it("rejects invalid intent", () => {
      const v = getElementValidator("pageBreakElement");
      expect(v({
        id: "pb1",
        type: "pageBreak",
        name: "Break",
        data: { intent: "forceBreak" }
      })).toBe(false);
    });
  });

  describe("gridChildWrapper", () => {
    it("accepts valid grid child wrapper", () => {
      const v = getElementValidator("gridChildWrapper");
      expect(v({
        id: "wrap1",
        row: 0,
        column: 1,
        element: {
          id: "child1",
          type: "text",
          name: "Child",
          data: { content: { kind: "plain", text: "A" } }
        }
      })).toBe(true);
    });

    it("rejects negative row", () => {
      const v = getElementValidator("gridChildWrapper");
      expect(v({
        id: "wrap1",
        row: -1,
        column: 0,
        element: {
          id: "child1",
          type: "text",
          name: "Child",
          data: { content: { kind: "plain", text: "A" } }
        }
      })).toBe(false);
    });
  });

  describe("pageLevelWrapper", () => {
    it("accepts valid page-level wrapper", () => {
      const v = getElementValidator("pageLevelWrapper");
      expect(v({
        id: "pw1",
        purpose: "footer",
        target: { mode: "all" },
        layer: "overlay",
        region: "bottomMargin",
        anchor: "bottomCenter",
        x: "0in",
        y: "0in",
        width: "100%",
        height: "auto",
        zIndex: 0,
        clipToRegion: true,
        semantic: { mode: "artifact" },
        element: {
          id: "footerText",
          type: "text",
          name: "Footer",
          data: { content: { kind: "plain", text: "Page footer" } }
        }
      })).toBe(true);
    });

    it("rejects zIndex out of range", () => {
      const v = getElementValidator("pageLevelWrapper");
      expect(v({
        id: "pw1",
        purpose: "footer",
        target: { mode: "all" },
        layer: "overlay",
        region: "bottomMargin",
        anchor: "bottomCenter",
        x: "0in",
        y: "0in",
        width: "100%",
        height: "auto",
        zIndex: 9999,
        clipToRegion: true,
        semantic: { mode: "artifact" },
        element: {
          id: "footerText",
          type: "text",
          name: "Footer",
          data: { content: { kind: "plain", text: "Page footer" } }
        }
      })).toBe(false);
    });
  });
});

describe("rights.schema.json", () => {
  function getRightsValidator(defName: string): ValidateFunction {
    const id = `https://church-bulletin-builder.local/schema/v1/rights.schema.json#/$defs/${defName}`;
    let validate = ajv.getSchema(id);
    if (!validate) {
      validate = ajv.compile({ "$ref": id });
    }
    return validate;
  }

  it("rightsRecord accepts a valid public domain record", () => {
    const v = getRightsValidator("rightsRecord");
    expect(v({
      creditKey: "credit:11111111-1111-4111-8111-111111111111",
      creditProjectionHash: "sha256:" + "a".repeat(64),
      component: "text",
      status: "publicDomain",
      workTitle: "Amazing Grace",
      contributors: [{ name: "John Newton", role: "author" }],
      creditRequiredWhen: "never"
    })).toBe(true);
  });

  it("rightsRecord rejects unknown component", () => {
    const v = getRightsValidator("rightsRecord");
    expect(v({
      creditKey: "credit:11111111-1111-4111-8111-111111111111",
      creditProjectionHash: "sha256:" + "a".repeat(64),
      component: "lyric",
      status: "publicDomain",
      contributors: [],
      creditRequiredWhen: "never"
    })).toBe(false);
  });

  it("rightsRecord rejects invalid creditKey format", () => {
    const v = getRightsValidator("rightsRecord");
    expect(v({
      creditKey: "just-a-string",
      creditProjectionHash: "sha256:" + "a".repeat(64),
      component: "text",
      status: "publicDomain",
      contributors: [],
      creditRequiredWhen: "never"
    })).toBe(false);
  });
});

describe("richText.schema.json", () => {
  function getRichTextValidator(defName: string): ValidateFunction {
    const id = `https://church-bulletin-builder.local/schema/v1/richText.schema.json#/$defs/${defName}`;
    let validate = ajv.getSchema(id);
    if (!validate) {
      validate = ajv.compile({ "$ref": id });
    }
    return validate;
  }

  it("richTextDocument accepts empty blocks (valid while editing)", () => {
    const v = getRichTextValidator("richTextDocument");
    expect(v({ type: "document", blocks: [] })).toBe(true);
  });

  it("richTextDocument accepts paragraph block", () => {
    const v = getRichTextValidator("richTextDocument");
    expect(v({
      type: "document",
      blocks: [
        {
          type: "paragraph",
          children: [{ type: "text", text: "Hello" }]
        }
      ]
    })).toBe(true);
  });

  it("heading rejects invalid level 0", () => {
    const v = getRichTextValidator("heading");
    expect(v({
      type: "heading",
      level: 0,
      children: [{ type: "text", text: "Title" }]
    })).toBe(false);
  });

  it("heading rejects invalid level 7", () => {
    const v = getRichTextValidator("heading");
    expect(v({
      type: "heading",
      level: 7,
      children: [{ type: "text", text: "Title" }]
    })).toBe(false);
  });

  it("heading accepts valid levels 1-6", () => {
    const v = getRichTextValidator("heading");
    for (const level of [1, 2, 3, 4, 5, 6]) {
      expect(v({
        type: "heading",
        level,
        children: [{ type: "text", text: "Title" }]
      }), `level ${level} should be valid`).toBe(true);
    }
  });

  it("text inline rejects empty text", () => {
    const v = getRichTextValidator("textInline");
    expect(v({ type: "text", text: "" })).toBe(false);
  });

  it("mark rejects unknown mark value", () => {
    const v = getRichTextValidator("mark");
    expect(v("underline")).toBe(false);
    expect(v("strong")).toBe(true);
    expect(v("emphasis")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Issue-13 fix: importSnapshot structureKind constraints
// ---------------------------------------------------------------------------

/**
 * Shared fixture data for importSnapshot / scripture-block tests.
 * Hard-coded so tests are self-contained and deterministic.
 */
const SNAP_TRANS_ID = "translation:22222222-2222-4222-8222-222222222222";
const SNAP_SHA_A = "sha256:" + "a".repeat(64);
const SNAP_SHA_B = "sha256:" + "b".repeat(64);
const SNAP_SHA_C = "sha256:" + "c".repeat(64);

const basePasteSnapshot = {
  sourceKind: "paste" as const,
  displayReference: "John 3:16",
  translationId: SNAP_TRANS_ID,
  translationLabel: "NIV",
  normalizerId: "normalizer-v1",
  normalizerVersion: "1.0.0",
  sourceText: "For God so loved the world",
  sourceTextHash: SNAP_SHA_A,
  importedFidelityHash: SNAP_SHA_B,
  rightsProjectionHash: SNAP_SHA_C,
};

const baseProviderSnapshot = {
  ...basePasteSnapshot,
  sourceKind: "provider" as const,
  providerId: "bible-gateway",
  adapterId: "adapter-bg-1",
  adapterVersion: "2.0",
  requestedReference: "John 3:16",
  requestedTranslationId: SNAP_TRANS_ID,
  retrievalTime: "2026-07-01T12:00:00Z",
};

const snapSampleRights = [
  {
    creditKey: "credit:11111111-1111-4111-8111-111111111111",
    creditProjectionHash: SNAP_SHA_A,
    component: "scriptureTranslation",
    status: "publicDomain",
    contributors: [] as unknown[],
    creditRequiredWhen: "never",
  },
];

describe(
  "richText.schema.json — Issue-13 fix: importSnapshot structureKind constraints",
  () => {
    function getRichTextDef(defName: string): ValidateFunction {
      const id = `https://church-bulletin-builder.local/schema/v1/richText.schema.json#/$defs/${defName}`;
      let v = ajv.getSchema(id);
      if (!v) {
        v = ajv.compile({ $ref: id });
      }
      return v;
    }

    // -----------------------------------------------------------------------
    // (a) paragraphOnly snapshot requires paragraphBoundaries
    // -----------------------------------------------------------------------
    describe("pasteImportSnapshot — paragraphOnly branch requires paragraphBoundaries", () => {
      it("rejects paragraphOnly snapshot without paragraphBoundaries", () => {
        const v = getRichTextDef("pasteImportSnapshot");
        const result = v({
          ...basePasteSnapshot,
          structureKind: "paragraphOnly",
          // paragraphBoundaries intentionally absent
        });
        expect(result, "should be invalid — paragraphBoundaries is required").toBe(
          false
        );
        const errors = v.errors ?? [];
        expect(errors.length).toBeGreaterThan(0);
        const hasRequired = errors.some(
          (e) =>
            e.keyword === "required" &&
            typeof e.params === "object" &&
            (e.params as Record<string, unknown>)["missingProperty"] ===
              "paragraphBoundaries"
        );
        expect(
          hasRequired,
          `Expected a 'required' error for paragraphBoundaries. Errors: ${JSON.stringify(errors)}`
        ).toBe(true);
      });

      it("rejects paragraphOnly snapshot with empty paragraphBoundaries array", () => {
        const v = getRichTextDef("pasteImportSnapshot");
        const result = v({
          ...basePasteSnapshot,
          structureKind: "paragraphOnly",
          paragraphBoundaries: [],
        });
        expect(
          result,
          "should be invalid — paragraphBoundaries must have minItems 1"
        ).toBe(false);
      });

      it("accepts paragraphOnly snapshot with non-empty paragraphBoundaries", () => {
        const v = getRichTextDef("pasteImportSnapshot");
        const result = v({
          ...basePasteSnapshot,
          structureKind: "paragraphOnly",
          paragraphBoundaries: [{ paragraphIndex: 0, content: "Hello world" }],
        });
        expect(result, "should be valid").toBe(true);
      });
    });

    describe("providerImportSnapshot — paragraphOnly branch requires paragraphBoundaries", () => {
      it("rejects paragraphOnly snapshot without paragraphBoundaries", () => {
        const v = getRichTextDef("providerImportSnapshot");
        const result = v({
          ...baseProviderSnapshot,
          structureKind: "paragraphOnly",
        });
        expect(result, "should be invalid — paragraphBoundaries is required").toBe(
          false
        );
        const errors = v.errors ?? [];
        const hasRequired = errors.some(
          (e) =>
            e.keyword === "required" &&
            typeof e.params === "object" &&
            (e.params as Record<string, unknown>)["missingProperty"] ===
              "paragraphBoundaries"
        );
        expect(
          hasRequired,
          `Expected a 'required' error for paragraphBoundaries. Errors: ${JSON.stringify(errors)}`
        ).toBe(true);
      });

      it("accepts paragraphOnly provider snapshot with non-empty paragraphBoundaries", () => {
        const v = getRichTextDef("providerImportSnapshot");
        const result = v({
          ...baseProviderSnapshot,
          structureKind: "paragraphOnly",
          paragraphBoundaries: [{ paragraphIndex: 0 }],
        });
        expect(result, "should be valid").toBe(true);
      });
    });

    // -----------------------------------------------------------------------
    // Regression: verseStructured branch still enforces canonicalReference
    // -----------------------------------------------------------------------
    describe("verseStructured snapshot — canonicalReference + verseBoundaries still required", () => {
      it("accepts verseStructured paste snapshot with all required fields", () => {
        const v = getRichTextDef("pasteImportSnapshot");
        expect(
          v({
            ...basePasteSnapshot,
            structureKind: "verseStructured",
            canonicalReference: "John.3.16",
            verseBoundaries: [{ verseId: "John.3.16", label: "16" }],
          })
        ).toBe(true);
      });

      it("rejects verseStructured paste snapshot missing verseBoundaries", () => {
        const v = getRichTextDef("pasteImportSnapshot");
        expect(
          v({
            ...basePasteSnapshot,
            structureKind: "verseStructured",
            canonicalReference: "John.3.16",
          })
        ).toBe(false);
      });

      it("rejects verseStructured paste snapshot missing canonicalReference", () => {
        const v = getRichTextDef("pasteImportSnapshot");
        expect(
          v({
            ...basePasteSnapshot,
            structureKind: "verseStructured",
            verseBoundaries: [{ verseId: "John.3.16", label: "16" }],
          })
        ).toBe(false);
      });
    });

    // -----------------------------------------------------------------------
    // (b) Mirror rule: importSnapshot.structureKind must match the block
    // -----------------------------------------------------------------------
    describe("mirror rule — verseStructuredScripture.importSnapshot must be verseStructured", () => {
      const verseBlock = {
        type: "scripture",
        structureKind: "verseStructured",
        reference: "John 3:16",
        canonicalReference: "John.3.16",
        translationId: SNAP_TRANS_ID,
        translationLabel: "NIV",
        verses: [
          {
            verseId: "John.3.16",
            label: "16",
            paragraphStart: true,
            children: [{ type: "text", text: "For God so loved the world" }],
          },
        ],
        rights: snapSampleRights,
      };

      it("rejects verseStructured block with paragraphOnly paste importSnapshot", () => {
        const v = getRichTextDef("verseStructuredScripture");
        const result = v({
          ...verseBlock,
          importSnapshot: {
            ...basePasteSnapshot,
            structureKind: "paragraphOnly",
            paragraphBoundaries: [{ paragraphIndex: 0, content: "Hello" }],
          },
        });
        expect(
          result,
          "verseStructured block must not accept paragraphOnly paste snapshot"
        ).toBe(false);
      });

      it("rejects verseStructured block with paragraphOnly provider importSnapshot", () => {
        const v = getRichTextDef("verseStructuredScripture");
        const result = v({
          ...verseBlock,
          importSnapshot: {
            ...baseProviderSnapshot,
            structureKind: "paragraphOnly",
            paragraphBoundaries: [{ paragraphIndex: 0, content: "Hello" }],
          },
        });
        expect(
          result,
          "verseStructured block must not accept paragraphOnly provider snapshot"
        ).toBe(false);
      });

      it("accepts verseStructured block with verseStructured paste importSnapshot", () => {
        const v = getRichTextDef("verseStructuredScripture");
        expect(
          v({
            ...verseBlock,
            importSnapshot: {
              ...basePasteSnapshot,
              structureKind: "verseStructured",
              canonicalReference: "John.3.16",
              verseBoundaries: [{ verseId: "John.3.16", label: "16" }],
            },
          })
        ).toBe(true);
      });

      it("accepts verseStructured block with verseStructured provider importSnapshot", () => {
        const v = getRichTextDef("verseStructuredScripture");
        expect(
          v({
            ...verseBlock,
            importSnapshot: {
              ...baseProviderSnapshot,
              structureKind: "verseStructured",
              canonicalReference: "John.3.16",
              verseBoundaries: [{ verseId: "John.3.16", label: "16" }],
            },
          })
        ).toBe(true);
      });

      it("accepts verseStructured block without importSnapshot (field is optional)", () => {
        const v = getRichTextDef("verseStructuredScripture");
        expect(v(verseBlock)).toBe(true);
      });
    });

    describe("mirror rule — paragraphOnlyScripture.importSnapshot must be paragraphOnly", () => {
      const paraBlock = {
        type: "scripture",
        structureKind: "paragraphOnly",
        translationId: SNAP_TRANS_ID,
        paragraphs: [
          {
            type: "paragraph",
            children: [
              { type: "text", text: "For God so loved the world" },
            ],
          },
        ],
        rights: snapSampleRights,
      };

      it("rejects paragraphOnly block with verseStructured paste importSnapshot", () => {
        const v = getRichTextDef("paragraphOnlyScripture");
        const result = v({
          ...paraBlock,
          importSnapshot: {
            ...basePasteSnapshot,
            structureKind: "verseStructured",
            canonicalReference: "John.3.16",
            verseBoundaries: [{ verseId: "John.3.16", label: "16" }],
          },
        });
        expect(
          result,
          "paragraphOnly block must not accept verseStructured paste snapshot"
        ).toBe(false);
      });

      it("rejects paragraphOnly block with verseStructured provider importSnapshot", () => {
        const v = getRichTextDef("paragraphOnlyScripture");
        const result = v({
          ...paraBlock,
          importSnapshot: {
            ...baseProviderSnapshot,
            structureKind: "verseStructured",
            canonicalReference: "John.3.16",
            verseBoundaries: [{ verseId: "John.3.16", label: "16" }],
          },
        });
        expect(
          result,
          "paragraphOnly block must not accept verseStructured provider snapshot"
        ).toBe(false);
      });

      it("accepts paragraphOnly block with paragraphOnly paste importSnapshot", () => {
        const v = getRichTextDef("paragraphOnlyScripture");
        expect(
          v({
            ...paraBlock,
            importSnapshot: {
              ...basePasteSnapshot,
              structureKind: "paragraphOnly",
              paragraphBoundaries: [{ paragraphIndex: 0, content: "Hello" }],
            },
          })
        ).toBe(true);
      });

      it("accepts paragraphOnly block with paragraphOnly provider importSnapshot", () => {
        const v = getRichTextDef("paragraphOnlyScripture");
        expect(
          v({
            ...paraBlock,
            importSnapshot: {
              ...baseProviderSnapshot,
              structureKind: "paragraphOnly",
              paragraphBoundaries: [{ paragraphIndex: 0, content: "Hello" }],
            },
          })
        ).toBe(true);
      });

      it("accepts paragraphOnly block without importSnapshot (field is optional)", () => {
        const v = getRichTextDef("paragraphOnlyScripture");
        expect(v(paraBlock)).toBe(true);
      });
    });
  }
);

describe("document.schema.json page model", () => {
  it("accepts mirrored margins with inner/outer", () => {
    const validate = getDocumentValidator();
    expect(validate({
      version: 2,
      kind: "bulletin",
      name: "Mirrored Margins",
      page: {
        typstWidth: "8.5in",
        typstHeight: "11in",
        marginMode: "mirrored",
        binding: "left",
        margins: {
          top: "0.75in",
          bottom: "0.75in",
          inner: "1in",
          outer: "0.75in"
        }
      },
      elements: []
    })).toBe(true);
  });

  it("accepts finalPageCountRequirement with exact", () => {
    const validate = getDocumentValidator();
    expect(validate({
      version: 2,
      kind: "bulletin",
      name: "Exact Pages",
      page: {
        typstWidth: "5.5in",
        typstHeight: "8.5in",
        layoutIntent: "foldedBooklet",
        finalPageCountRequirement: { exact: 8 }
      },
      elements: []
    })).toBe(true);
  });

  it("accepts finalPageCountRequirement with multipleOf", () => {
    const validate = getDocumentValidator();
    expect(validate({
      version: 2,
      kind: "bulletin",
      name: "Multiple Of Pages",
      page: {
        typstWidth: "5.5in",
        typstHeight: "8.5in",
        layoutIntent: "foldedBooklet",
        finalPageCountRequirement: { minimum: 4, maximum: 24, multipleOf: 4 }
      },
      elements: []
    })).toBe(true);
  });

  it("rejects finalPageCountRequirement with exact coexisting with minimum", () => {
    const validate = getDocumentValidator();
    const result = validate({
      version: 1,
      kind: "bulletin",
      name: "Conflict Pages",
      page: {
        typstWidth: "5.5in",
        typstHeight: "8.5in",
        finalPageCountRequirement: { exact: 8, minimum: 4 }
      },
      elements: []
    });
    expect(result).toBe(false);
  });
});

describe("document portability boundary: portable ids must not appear as local-resource-id", () => {
  it("workspace.schema.json localResourceId pattern matches uuid only", () => {
    const workspaceSchema = schemaMap.get(
      "https://church-bulletin-builder.local/schema/v1/workspace.schema.json"
    ) as Record<string, unknown>;
    const defs = workspaceSchema["$defs"] as Record<string, unknown>;
    const def = defs["localResourceId"] as Record<string, unknown>;
    // localResourceId is a plain UUID, not prefixed with asset:/font: etc.
    expect(def["type"]).toBe("string");
    const pattern = def["pattern"] as string;
    // Must match plain UUIDs
    expect(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      "44444444-4444-4444-8444-444444444444"
    )).toBe(true);
    // Document schema must not define a 'localResourceId' $def (portable boundary)
    const docSchema = schemaMap.get(
      "https://church-bulletin-builder.local/schema/v1/document.schema.json"
    ) as Record<string, unknown>;
    const docDefs = (docSchema["$defs"] ?? {}) as Record<string, unknown>;
    expect(Object.keys(docDefs)).not.toContain("localResourceId");
    expect(pattern).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Issue-20 fix: full-featured-bulletin.json must exercise all previously
// missing schema paths. These tests prove each feature is present in the
// fixture AND that the schema accepts/rejects those features correctly.
// ---------------------------------------------------------------------------

describe("Issue-20: full-featured-bulletin.json feature coverage", () => {
  let doc: Record<string, unknown>;

  beforeAll(() => {
    doc = normalizeDocumentForCurrentUse(loadJson(
      join(FIXTURES_DIR, "full-featured-bulletin.json")
    )) as Record<string, unknown>;
  });

  it("fixture validates against document schema", () => {
    const validate = getDocumentValidator();
    const result = validate(doc);
    if (!result) {
      console.error(
        "Validation errors:",
        JSON.stringify(validate.errors, null, 2)
      );
    }
    expect(result).toBe(true);
  });

  it("fixture has kind bulletin", () => {
    expect(doc["kind"]).toBe("bulletin");
  });

  // --- mirrored margins ---
  it("fixture uses mirrored margins (inner/outer keys, no left/right)", () => {
    const page = doc["page"] as Record<string, unknown>;
    expect(page["marginMode"]).toBe("mirrored");
    const margins = page["margins"] as Record<string, unknown>;
    expect(margins).toHaveProperty("inner");
    expect(margins).toHaveProperty("outer");
    expect(margins).not.toHaveProperty("left");
    expect(margins).not.toHaveProperty("right");
  });

  // --- bookletPrintSetup ---
  it("fixture has bookletPrintSetup with safeInset.fold", () => {
    const page = doc["page"] as Record<string, unknown>;
    const bps = page["bookletPrintSetup"] as Record<string, unknown>;
    expect(bps).toBeDefined();
    expect(bps["sheetWidth"]).toBeDefined();
    expect(bps["duplexFlip"]).toBeDefined();
    const si = bps["safeInset"] as Record<string, unknown>;
    expect(si["fold"]).toBeDefined();
  });

  // --- finalPageCountRequirement ---
  it("fixture has finalPageCountRequirement", () => {
    const page = doc["page"] as Record<string, unknown>;
    const req = page["finalPageCountRequirement"] as Record<string, unknown>;
    expect(req).toBeDefined();
  });

  // --- fieldContract ---
  it("fixture has top-level fieldContract with id, version, fields, groups", () => {
    const fc = doc["fieldContract"] as Record<string, unknown>;
    expect(fc).toBeDefined();
    expect(typeof fc["id"]).toBe("string");
    expect(typeof fc["version"]).toBe("number");
    const fields = fc["fields"] as unknown[];
    expect(fields.length).toBeGreaterThanOrEqual(1);
    const groups = fc["groups"] as unknown[];
    expect(groups.length).toBeGreaterThanOrEqual(1);
  });

  it("fixture fieldContract includes an array-type field with itemField", () => {
    const fc = doc["fieldContract"] as Record<string, unknown>;
    const fields = fc["fields"] as Array<Record<string, unknown>>;
    const arrayField = fields.find((f) => f["type"] === "array");
    expect(arrayField).toBeDefined();
    expect(
      (arrayField as Record<string, unknown>)["itemField"]
    ).toBeDefined();
  });

  // --- fieldValues ---
  it("fixture has top-level fieldValues exercising multiple origins", () => {
    const fv = doc["fieldValues"] as Record<
      string,
      Record<string, unknown>
    >;
    expect(fv).toBeDefined();
    const origins = Object.values(fv).map((e) => e["origin"]);
    expect(origins).toContain("derived");
    expect(origins).toContain("carriedForward");
    expect(origins).toContain("manual");
  });

  it("fixture fieldValues has an entry with itemIds for a repeat-rule array field", () => {
    const fv = doc["fieldValues"] as Record<
      string,
      Record<string, unknown>
    >;
    const entry = Object.values(fv).find(
      (e) => Array.isArray(e["itemIds"])
    );
    expect(entry).toBeDefined();
    const ids = (entry as Record<string, unknown>)["itemIds"] as unknown[];
    expect(ids.length).toBeGreaterThanOrEqual(1);
  });

  // --- contentRules with conditional + repeat ---
  it("fixture has non-empty contentRules covering conditional and repeat kinds", () => {
    const rules = doc["contentRules"] as Array<Record<string, unknown>>;
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThan(0);
    const kinds = rules.map((r) => r["kind"]);
    expect(kinds).toContain("conditional");
    expect(kinds).toContain("repeat");
  });

  it("fixture conditional rule has booleanEquals condition", () => {
    const rules = doc["contentRules"] as Array<Record<string, unknown>>;
    const cond = rules.find(
      (r) => r["kind"] === "conditional"
    ) as Record<string, unknown>;
    const condition = cond["condition"] as Record<string, unknown>;
    expect(condition["kind"]).toBe("booleanEquals");
  });

  it("fixture repeat rule has itemBindings with itemPath/targetNodeId/target", () => {
    const rules = doc["contentRules"] as Array<Record<string, unknown>>;
    const rep = rules.find(
      (r) => r["kind"] === "repeat"
    ) as Record<string, unknown>;
    const itemBindings = rep["itemBindings"] as Array<
      Record<string, unknown>
    >;
    expect(Array.isArray(itemBindings)).toBe(true);
    expect(itemBindings.length).toBeGreaterThan(0);
    const b = itemBindings[0] as Record<string, unknown>;
    expect(b["itemPath"]).toBeDefined();
    expect(b["targetNodeId"]).toBeDefined();
    expect(b["target"]).toBeDefined();
  });

  // --- fieldReview ---
  it("fixture has non-empty fieldReview with derivedConfirmed, kept, and edited dispositions", () => {
    const fr = doc["fieldReview"] as Array<Record<string, unknown>>;
    expect(Array.isArray(fr)).toBe(true);
    expect(fr.length).toBeGreaterThan(0);
    const dispositions = fr.map((e) => e["disposition"]);
    expect(dispositions).toContain("derivedConfirmed");
    expect(dispositions).toContain("kept");
    expect(dispositions).toContain("edited");
  });

  it("fixture fieldReview derivedConfirmed entry has derivationEvidence with all required fields", () => {
    const fr = doc["fieldReview"] as Array<Record<string, unknown>>;
    const entry = fr.find(
      (e) => e["disposition"] === "derivedConfirmed"
    ) as Record<string, unknown>;
    expect(entry).toBeDefined();
    const evidence = entry["derivationEvidence"] as Record<
      string,
      unknown
    >;
    expect(evidence).toBeDefined();
    expect(evidence["kind"]).toBe("nextScheduledServiceDate");
    expect(evidence["selectedScheduleId"]).toBeDefined();
    expect(evidence["selectedScheduleLabel"]).toBeDefined();
    expect(evidence["churchProfileRevisionHash"]).toBeDefined();
    expect(evidence["resultingDate"]).toBeDefined();
  });

  it("fixture fieldReview has a local-scoped entry (ownerNodeId + fieldId)", () => {
    const fr = doc["fieldReview"] as Array<Record<string, unknown>>;
    const localEntry = fr.find((e) => {
      return (
        (e["target"] as Record<string, unknown>)["scope"] === "local"
      );
    });
    expect(localEntry).toBeDefined();
    const target = (
      localEntry as Record<string, unknown>
    )["target"] as Record<string, unknown>;
    expect(target["ownerNodeId"]).toBeDefined();
    expect(target["fieldId"]).toBeDefined();
  });

  // --- contentReview ---
  it("fixture has non-empty contentReview with confirmedUnchanged + sourceEvidence", () => {
    const cr = doc["contentReview"] as Array<Record<string, unknown>>;
    expect(Array.isArray(cr)).toBe(true);
    expect(cr.length).toBeGreaterThan(0);
    const confirmed = cr.find(
      (e) => e["disposition"] === "confirmedUnchanged"
    ) as Record<string, unknown>;
    expect(confirmed).toBeDefined();
    const evidence = confirmed["sourceEvidence"] as Record<
      string,
      unknown
    >;
    expect(evidence).toBeDefined();
    expect(evidence["sourceKind"]).toBeDefined();
    expect(evidence["sourceDocumentHash"]).toBeDefined();
    expect(evidence["sourceContentProjectionHash"]).toBeDefined();
  });

  it("fixture contentReview has custom-scoped entry (ownerNodeId + definitionNodeId)", () => {
    const cr = doc["contentReview"] as Array<Record<string, unknown>>;
    const customEntry = cr.find((e) => {
      return (
        (e["target"] as Record<string, unknown>)["scope"] === "custom"
      );
    });
    expect(customEntry).toBeDefined();
    const target = (
      customEntry as Record<string, unknown>
    )["target"] as Record<string, unknown>;
    expect(target["ownerNodeId"]).toBeDefined();
    expect(target["definitionNodeId"]).toBeDefined();
  });

  // --- sourceTemplate ---
  it("fixture has sourceTemplate with contractId and all optional lineage fields", () => {
    const st = doc["sourceTemplate"] as Record<string, unknown>;
    expect(st).toBeDefined();
    expect(typeof st["contractId"]).toBe("string");
    expect(st["contractVersion"]).toBeDefined();
    expect(st["contractHash"]).toBeDefined();
    expect(st["sourceDisplayName"]).toBeDefined();
    expect(st["packId"]).toBeDefined();
    expect(st["contentId"]).toBeDefined();
    expect(st["packVersion"]).toBeDefined();
  });

  // --- customElementDefinitions + customInstance ---
  it("fixture has customElementDefinitions with a valid definition containing contentRules", () => {
    const defs = doc[
      "customElementDefinitions"
    ] as Array<Record<string, unknown>>;
    expect(Array.isArray(defs)).toBe(true);
    expect(defs.length).toBeGreaterThan(0);
    const def = defs[0] as Record<string, unknown>;
    expect(def["kind"]).toBe("customElementDefinition");
    expect(def["version"]).toBe(1);
    expect(def["fieldContract"]).toBeDefined();
    const elems = def["elements"] as unknown[];
    expect(elems.length).toBeGreaterThanOrEqual(1);
    expect(def["contentRules"]).toBeDefined();
    expect(def["sampleFieldValues"]).toBeDefined();
  });

  it("fixture elements array contains a customInstance element", () => {
    const elements = doc["elements"] as Array<Record<string, unknown>>;
    const inst = elements.find((e) => e["type"] === "customInstance");
    expect(inst).toBeDefined();
    const i = inst as Record<string, unknown>;
    expect(i["definitionId"]).toBeDefined();
    expect(i["definitionHash"]).toBeDefined();
    expect(i["fieldValues"]).toBeDefined();
  });

  // --- element-level fieldContract, fieldValues, bindings ---
  it("fixture has an element with fieldContract, fieldValues, and bindings (scope:local)", () => {
    const elements = doc["elements"] as Array<Record<string, unknown>>;
    const bound = elements.find(
      (e) => Array.isArray(e["bindings"])
    ) as Record<string, unknown>;
    expect(bound).toBeDefined();
    expect(bound["fieldContract"]).toBeDefined();
    expect(bound["fieldValues"]).toBeDefined();
    const bindings = bound["bindings"] as Array<Record<string, unknown>>;
    expect(bindings.length).toBeGreaterThan(0);
    const b = bindings[0] as Record<string, unknown>;
    expect(b["id"]).toBeDefined();
    expect(b["scope"]).toBeDefined();
    expect(b["fieldId"]).toBeDefined();
    expect(b["target"]).toBeDefined();
  });

  // --- paragraphOnly scripture ---
  it("fixture contains a paragraphOnly scripture block", () => {
    const elements = doc["elements"] as Array<Record<string, unknown>>;
    let found = false;
    for (const el of elements) {
      if (el["type"] !== "text") continue;
      const data = el["data"] as Record<string, unknown>;
      const content = data["content"] as Record<string, unknown>;
      if (content["kind"] !== "richText") continue;
      const rtDoc = content["document"] as Record<string, unknown>;
      for (const block of rtDoc["blocks"] as Array<
        Record<string, unknown>
      >) {
        if (
          block["type"] === "scripture" &&
          block["structureKind"] === "paragraphOnly"
        ) {
          found = true;
          const paras = block["paragraphs"] as unknown[];
          expect(paras.length).toBeGreaterThan(0);
        }
      }
    }
    expect(found).toBe(true);
  });

  // --- verseStructured scripture with importSnapshot (provider) + importReview ---
  it("fixture verseStructured scripture has provider importSnapshot and importReview", () => {
    const elements = doc["elements"] as Array<Record<string, unknown>>;
    let block: Record<string, unknown> | undefined;
    for (const el of elements) {
      if (el["type"] !== "text") continue;
      const data = el["data"] as Record<string, unknown>;
      const content = data["content"] as Record<string, unknown>;
      if (content["kind"] !== "richText") continue;
      const rtDoc = content["document"] as Record<string, unknown>;
      for (const b of rtDoc["blocks"] as Array<Record<string, unknown>>) {
        if (
          b["type"] === "scripture" &&
          b["structureKind"] === "verseStructured" &&
          b["importSnapshot"]
        ) {
          block = b;
        }
      }
    }
    expect(block).toBeDefined();
    const snap = block!["importSnapshot"] as Record<string, unknown>;
    expect(snap["sourceKind"]).toBe("provider");
    expect(snap["providerId"]).toBeDefined();
    expect(snap["verseBoundaries"]).toBeDefined();
    const review = block!["importReview"] as Record<string, unknown>;
    expect(review).toBeDefined();
    expect(review["disposition"]).toBe("changesConfirmed");
  });

  // --- paragraphOnly scripture with importSnapshot (paste) + importReview ---
  it("fixture paragraphOnly scripture has paste importSnapshot and importReview", () => {
    const elements = doc["elements"] as Array<Record<string, unknown>>;
    let block: Record<string, unknown> | undefined;
    for (const el of elements) {
      if (el["type"] !== "text") continue;
      const data = el["data"] as Record<string, unknown>;
      const content = data["content"] as Record<string, unknown>;
      if (content["kind"] !== "richText") continue;
      const rtDoc = content["document"] as Record<string, unknown>;
      for (const b of rtDoc["blocks"] as Array<Record<string, unknown>>) {
        if (
          b["type"] === "scripture" &&
          b["structureKind"] === "paragraphOnly" &&
          b["importSnapshot"]
        ) {
          block = b;
        }
      }
    }
    expect(block).toBeDefined();
    const snap = block!["importSnapshot"] as Record<string, unknown>;
    expect(snap["sourceKind"]).toBe("paste");
    expect(snap["paragraphBoundaries"]).toBeDefined();
    const review = block!["importReview"] as Record<string, unknown>;
    expect(review).toBeDefined();
    expect(review["disposition"]).toBe("changesConfirmed");
  });

  // --- bulletin must not have sampleFieldValues ---
  it("fixture does not contain sampleFieldValues (forbidden on bulletins)", () => {
    expect(doc["sampleFieldValues"]).toBeUndefined();
  });
});

describe("Issue-20: full-featured-template.json feature coverage", () => {
  let doc: Record<string, unknown>;

  beforeAll(() => {
    doc = normalizeDocumentForCurrentUse(loadJson(
      join(FIXTURES_DIR, "full-featured-template.json")
    )) as Record<string, unknown>;
  });

  it("fixture validates against document schema", () => {
    const validate = getDocumentValidator();
    const result = validate(doc);
    if (!result) {
      console.error(
        "Validation errors:",
        JSON.stringify(validate.errors, null, 2)
      );
    }
    expect(result).toBe(true);
  });

  it("fixture has kind template", () => {
    expect(doc["kind"]).toBe("template");
  });

  it("template fixture has sampleFieldValues (allowed on templates)", () => {
    const sfv = doc["sampleFieldValues"] as Record<string, unknown>;
    expect(sfv).toBeDefined();
    expect(Object.keys(sfv).length).toBeGreaterThan(0);
  });

  it("template fixture does not contain fieldReview (forbidden)", () => {
    expect(doc["fieldReview"]).toBeUndefined();
  });

  it("template fixture does not contain contentReview (forbidden)", () => {
    expect(doc["contentReview"]).toBeUndefined();
  });

  it("template fixture has mirrored margins", () => {
    const page = doc["page"] as Record<string, unknown>;
    expect(page["marginMode"]).toBe("mirrored");
    const margins = page["margins"] as Record<string, unknown>;
    expect(margins["inner"]).toBeDefined();
    expect(margins["outer"]).toBeDefined();
  });

  it("template fixture has bookletPrintSetup", () => {
    const page = doc["page"] as Record<string, unknown>;
    expect(page["bookletPrintSetup"]).toBeDefined();
  });

  it("template fixture has finalPageCountRequirement", () => {
    const page = doc["page"] as Record<string, unknown>;
    expect(page["finalPageCountRequirement"]).toBeDefined();
  });

  it("template fixture contentRules covers all three condition variants", () => {
    const rules = doc["contentRules"] as Array<Record<string, unknown>>;
    const condKinds = rules
      .filter((r) => r["kind"] === "conditional")
      .map((r) => (r["condition"] as Record<string, unknown>)["kind"]);
    expect(condKinds).toContain("booleanEquals");
    expect(condKinds).toContain("choiceEquals");
    expect(condKinds).toContain("choiceNotEquals");
  });

  it("template fixture has a customInstance element", () => {
    const elements = doc["elements"] as Array<Record<string, unknown>>;
    const inst = elements.find((e) => e["type"] === "customInstance");
    expect(inst).toBeDefined();
  });

  it("template does not contain fieldReview — schema rejects it", () => {
    const validate = getDocumentValidator();
    expect(
      validate({
        version: 1,
        kind: "template",
        name: "T",
        page: { typstWidth: "8.5in", typstHeight: "11in" },
        elements: [],
        fieldReview: [
          {
            target: { scope: "document", fieldId: "f1" },
            disposition: "kept",
            reviewHash: "sha256:" + "a".repeat(64),
          },
        ],
      })
    ).toBe(false);
  });

  it("template does not contain contentReview — schema rejects it", () => {
    const validate = getDocumentValidator();
    expect(
      validate({
        version: 1,
        kind: "template",
        name: "T",
        page: { typstWidth: "8.5in", typstHeight: "11in" },
        elements: [],
        contentReview: [
          {
            target: { scope: "document", targetNodeId: "el1" },
            disposition: "edited",
            reviewHash: "sha256:" + "a".repeat(64),
          },
        ],
      })
    ).toBe(false);
  });
});

describe("Issue-20: common.schema.json contentRule and review primitives", () => {
  function getCommonValidator(defName: string): ValidateFunction {
    const id = `https://church-bulletin-builder.local/schema/v1/common.schema.json#/$defs/${defName}`;
    let v = ajv.getSchema(id);
    if (!v) {
      v = ajv.compile({ $ref: id });
    }
    return v;
  }

  // -------------------------------------------------------------------------
  // conditionalRule — three condition variants
  // -------------------------------------------------------------------------
  describe("conditionalRule", () => {
    it("accepts booleanEquals=true condition", () => {
      const v = getCommonValidator("conditionalRule");
      expect(
        v({
          kind: "conditional",
          id: "r1",
          targetNodeId: "el1",
          scope: "document",
          fieldId: "showSomething",
          condition: { kind: "booleanEquals", value: true },
          activateLabel: "Show",
          inactiveLabel: "Hide",
        })
      ).toBe(true);
    });

    it("accepts booleanEquals=false condition", () => {
      const v = getCommonValidator("conditionalRule");
      expect(
        v({
          kind: "conditional",
          id: "r2",
          targetNodeId: "el2",
          scope: "document",
          fieldId: "flag",
          condition: { kind: "booleanEquals", value: false },
          activateLabel: "A",
          inactiveLabel: "B",
        })
      ).toBe(true);
    });

    it("accepts choiceEquals condition", () => {
      const v = getCommonValidator("conditionalRule");
      expect(
        v({
          kind: "conditional",
          id: "r3",
          targetNodeId: "el3",
          scope: "document",
          fieldId: "theme",
          condition: { kind: "choiceEquals", choiceId: "advent" },
          activateLabel: "Advent mode",
          inactiveLabel: "Standard mode",
        })
      ).toBe(true);
    });

    it("accepts choiceNotEquals condition", () => {
      const v = getCommonValidator("conditionalRule");
      expect(
        v({
          kind: "conditional",
          id: "r4",
          targetNodeId: "el4",
          scope: "document",
          fieldId: "theme",
          condition: { kind: "choiceNotEquals", choiceId: "lent" },
          activateLabel: "Non-lent",
          inactiveLabel: "Lent",
        })
      ).toBe(true);
    });

    it("rejects unknown condition kind", () => {
      const v = getCommonValidator("conditionalRule");
      expect(
        v({
          kind: "conditional",
          id: "r5",
          targetNodeId: "el5",
          scope: "document",
          fieldId: "flag",
          condition: { kind: "greaterThan", value: 5 },
          activateLabel: "A",
          inactiveLabel: "B",
        })
      ).toBe(false);
    });

    it("rejects booleanEquals missing value", () => {
      const v = getCommonValidator("conditionalRule");
      expect(
        v({
          kind: "conditional",
          id: "r6",
          targetNodeId: "el6",
          scope: "document",
          fieldId: "flag",
          condition: { kind: "booleanEquals" },
          activateLabel: "A",
          inactiveLabel: "B",
        })
      ).toBe(false);
    });

    it("accepts item-scope rule with JSON Pointer fieldId", () => {
      const v = getCommonValidator("conditionalRule");
      expect(
        v({
          kind: "conditional",
          id: "r7",
          targetNodeId: "el7",
          scope: "item",
          fieldId: "/isFeatured",
          condition: { kind: "booleanEquals", value: true },
          activateLabel: "Featured",
          inactiveLabel: "Not featured",
        })
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // repeatRule
  // -------------------------------------------------------------------------
  describe("repeatRule", () => {
    it("accepts valid repeat rule with collapse emptyState", () => {
      const v = getCommonValidator("repeatRule");
      expect(
        v({
          kind: "repeat",
          id: "rRep1",
          fieldId: "hymnList",
          prototypeNodeId: "protoHymn",
          emptyState: { mode: "collapse" },
          maxItems: 10,
          userReorderable: true,
          itemLabel: "Hymn",
          addLabel: "Add Hymn",
        })
      ).toBe(true);
    });

    it("accepts repeat rule with show emptyState", () => {
      const v = getCommonValidator("repeatRule");
      expect(
        v({
          kind: "repeat",
          id: "rRep2",
          fieldId: "readingList",
          prototypeNodeId: "protoReading",
          emptyState: { mode: "show", nodeId: "emptyHolder1" },
          maxItems: 5,
          userReorderable: false,
          itemLabel: "Reading",
          addLabel: "Add Reading",
        })
      ).toBe(true);
    });

    it("accepts repeat rule with itemBindings", () => {
      const v = getCommonValidator("repeatRule");
      expect(
        v({
          kind: "repeat",
          id: "rRep3",
          fieldId: "hymnList",
          prototypeNodeId: "protoHymn",
          itemBindings: [
            {
              id: "hymnNumBind",
              itemPath: "/0",
              targetNodeId: "protoHymn",
              target: "/data/content/text",
            },
          ],
          emptyState: { mode: "collapse" },
          maxItems: 10,
          userReorderable: true,
          nullIsEmpty: true,
          itemLabel: "Hymn",
          addLabel: "Add Hymn",
        })
      ).toBe(true);
    });

    it("rejects repeat rule missing maxItems", () => {
      const v = getCommonValidator("repeatRule");
      expect(
        v({
          kind: "repeat",
          id: "rRep4",
          fieldId: "hymnList",
          prototypeNodeId: "protoHymn",
          emptyState: { mode: "collapse" },
          userReorderable: true,
          itemLabel: "Hymn",
          addLabel: "Add Hymn",
        })
      ).toBe(false);
    });

    it("rejects repeat rule with maxItems < 1", () => {
      const v = getCommonValidator("repeatRule");
      expect(
        v({
          kind: "repeat",
          id: "rRep5",
          fieldId: "hymnList",
          prototypeNodeId: "protoHymn",
          emptyState: { mode: "collapse" },
          maxItems: 0,
          userReorderable: true,
          itemLabel: "Hymn",
          addLabel: "Add Hymn",
        })
      ).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // fieldReviewEntry
  // -------------------------------------------------------------------------
  describe("fieldReviewEntry", () => {
    it("accepts derivedConfirmed with full derivationEvidence", () => {
      const v = getCommonValidator("fieldReviewEntry");
      expect(
        v({
          target: { scope: "document", fieldId: "publicationDate" },
          disposition: "derivedConfirmed",
          reviewHash: "sha256:" + "a".repeat(64),
          derivationEvidence: {
            kind: "nextScheduledServiceDate",
            selectedScheduleId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
            selectedScheduleLabel: "Sunday 10:00 AM",
            churchProfileRevisionHash: "sha256:" + "b".repeat(64),
            baseDateRuleDescription: "Next Sunday",
            resultingDate: "2026-07-05",
          },
        })
      ).toBe(true);
    });

    it("accepts local-scoped entry", () => {
      const v = getCommonValidator("fieldReviewEntry");
      expect(
        v({
          target: {
            scope: "local",
            ownerNodeId: "hymnEl1",
            fieldId: "hymnTitle",
          },
          disposition: "edited",
          reviewHash: "sha256:" + "c".repeat(64),
        })
      ).toBe(true);
    });

    it("accepts all valid dispositions", () => {
      const v = getCommonValidator("fieldReviewEntry");
      const base = {
        target: { scope: "document", fieldId: "f1" },
        reviewHash: "sha256:" + "a".repeat(64),
      };
      for (const disposition of [
        "kept",
        "clearedPrior",
        "edited",
        "profileAccepted",
        "confirmedUnchanged",
        "notApplicable",
      ]) {
        expect(v({ ...base, disposition }), `disposition ${disposition} should be valid`).toBe(true);
      }
    });

    it("rejects invalid disposition value", () => {
      const v = getCommonValidator("fieldReviewEntry");
      expect(
        v({
          target: { scope: "document", fieldId: "f1" },
          disposition: "approved",
          reviewHash: "sha256:" + "a".repeat(64),
        })
      ).toBe(false);
    });

    it("rejects target missing scope", () => {
      const v = getCommonValidator("fieldReviewEntry");
      expect(
        v({
          target: { fieldId: "f1" },
          disposition: "kept",
          reviewHash: "sha256:" + "a".repeat(64),
        })
      ).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // contentReviewEntry
  // -------------------------------------------------------------------------
  describe("contentReviewEntry", () => {
    it("accepts confirmedUnchanged with sourceEvidence", () => {
      const v = getCommonValidator("contentReviewEntry");
      expect(
        v({
          target: { scope: "document", targetNodeId: "el1" },
          disposition: "confirmedUnchanged",
          reviewHash: "sha256:" + "a".repeat(64),
          sourceEvidence: {
            sourceKind: "bulletinDuplicate",
            sourceDocumentHash: "sha256:" + "b".repeat(64),
            sourceContentProjectionHash: "sha256:" + "c".repeat(64),
            sourcePublicationDate: "2026-06-28",
            sourceTarget: { scope: "document", targetNodeId: "el1" },
          },
        })
      ).toBe(true);
    });

    it("accepts custom-scoped entry", () => {
      const v = getCommonValidator("contentReviewEntry");
      expect(
        v({
          target: {
            scope: "custom",
            ownerNodeId: "customEl1",
            definitionNodeId: "customDef1",
          },
          disposition: "edited",
          reviewHash: "sha256:" + "d".repeat(64),
        })
      ).toBe(true);
    });

    it("rejects invalid disposition value", () => {
      const v = getCommonValidator("contentReviewEntry");
      expect(
        v({
          target: { scope: "document", targetNodeId: "el1" },
          disposition: "confirmed",
          reviewHash: "sha256:" + "a".repeat(64),
        })
      ).toBe(false);
    });

    it("rejects document-scoped target missing targetNodeId", () => {
      const v = getCommonValidator("contentReviewEntry");
      expect(
        v({
          target: { scope: "document" },
          disposition: "edited",
          reviewHash: "sha256:" + "a".repeat(64),
        })
      ).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // sourceTemplate
  // -------------------------------------------------------------------------
  describe("sourceTemplate", () => {
    it("accepts full sourceTemplate with all fields", () => {
      const v = getCommonValidator("sourceTemplate");
      expect(
        v({
          contractId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          contractVersion: 1,
          contractHash: "sha256:" + "a".repeat(64),
          sourceDocumentHash: "sha256:" + "b".repeat(64),
          sourceDisplayName: "My Template",
          packId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          contentId: "my-template-v1",
          packVersion: "1.0.0",
        })
      ).toBe(true);
    });

    it("accepts minimal sourceTemplate (contractId only)", () => {
      const v = getCommonValidator("sourceTemplate");
      expect(
        v({ contractId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })
      ).toBe(true);
    });

    it("rejects sourceTemplate with malformed contractId", () => {
      const v = getCommonValidator("sourceTemplate");
      expect(v({ contractId: "not-a-uuid" })).toBe(false);
    });
  });
});

describe("Issue-20: customElement.schema.json coverage", () => {
  function getCustomValidator(defName: string): ValidateFunction {
    const id = `https://church-bulletin-builder.local/schema/v1/customElement.schema.json#/$defs/${defName}`;
    let v = ajv.getSchema(id);
    if (!v) {
      v = ajv.compile({ $ref: id });
    }
    return v;
  }

  const definitionRevision = {
    version: 1 as const,
    kind: "customElementDefinition" as const,
    id: "customDef1",
    definitionVersion: 1,
    name: "Announcement Block",
    fieldContract: {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      version: 1,
      name: "Fields",
      fields: [
        { id: "text", label: "Text", type: "text" as const, required: true },
      ],
    },
    elements: [
      {
        id: "annText1",
        type: "text" as const,
        name: "Text",
        data: { content: { kind: "plain" as const, text: "Announcement" } },
      },
    ],
    contentRules: [
      {
        kind: "conditional" as const,
        id: "rLocal",
        targetNodeId: "annText1",
        scope: "document" as const,
        fieldId: "text",
        condition: { kind: "booleanEquals" as const, value: true },
        activateLabel: "Show",
        inactiveLabel: "Hide",
      },
    ],
    sampleFieldValues: {
      text: { value: "Sample text", origin: "manual" as const },
    },
  } satisfies Omit<CustomElementDefinition, "definitionHash">;
  const pinnedDefinition: CustomElementDefinition = {
    ...definitionRevision,
    definitionHash: customElementDefinitionHash(definitionRevision),
  };

  describe("customElementInstance", () => {
    it("accepts a valid customInstance with all optional fields", () => {
      const v = getCustomValidator("customElementInstance");
      expect(
        v({
          id: "customEl1",
          type: "customInstance",
          name: "Children's Sermon",
          definitionId: pinnedDefinition.id,
          definitionVersion: pinnedDefinition.definitionVersion,
          definitionHash: pinnedDefinition.definitionHash,
          width: "100%",
          breakPolicy: "avoid",
          margin: "0.25in",
          fieldValues: {
            sermonTitle: { value: "The Good Shepherd", origin: "manual" },
          },
        })
      ).toBe(true);
    });

    it("accepts minimal customInstance (only required fields)", () => {
      const v = getCustomValidator("customElementInstance");
      expect(
        v({
          id: "customEl1",
          type: "customInstance",
          name: "My Custom",
          definitionId: pinnedDefinition.id,
          definitionVersion: pinnedDefinition.definitionVersion,
          definitionHash: pinnedDefinition.definitionHash,
        })
      ).toBe(true);
    });

    it("rejects customInstance missing definitionId", () => {
      const v = getCustomValidator("customElementInstance");
      expect(
        v({
          id: "customEl1",
          type: "customInstance",
          name: "Missing",
          definitionVersion: pinnedDefinition.definitionVersion,
          definitionHash: pinnedDefinition.definitionHash,
        })
      ).toBe(false);
    });

    it("rejects customInstance with wrong type constant", () => {
      const v = getCustomValidator("customElementInstance");
      expect(
        v({
          id: "customEl1",
          type: "custom",
          name: "Wrong",
          definitionId: pinnedDefinition.id,
          definitionVersion: pinnedDefinition.definitionVersion,
          definitionHash: pinnedDefinition.definitionHash,
        })
      ).toBe(false);
    });
  });

  describe("customElementDefinition", () => {
    it("accepts definition with contentRules and sampleFieldValues", () => {
      const v = getCustomValidator("customElementDefinition");
      expect(v(pinnedDefinition)).toBe(true);
    });

    it("rejects definition with empty elements array (minItems: 1)", () => {
      const v = getCustomValidator("customElementDefinition");
      expect(
        v({
          version: 1,
          kind: "customElementDefinition",
          id: "def2",
          name: "Empty",
          fieldContract: {
            id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            version: 1,
            name: "Fields",
            fields: [],
          },
          elements: [],
        })
      ).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Issue fixes: optional fields, binding format, isoDate year constraints
// ---------------------------------------------------------------------------

describe("element.schema.json optional field fixes", () => {
  function getElementValidator(defName: string): ValidateFunction {
    const id = `https://church-bulletin-builder.local/schema/v1/element.schema.json#/$defs/${defName}`;
    let validate = ajv.getSchema(id);
    if (!validate) {
      validate = ajv.compile({ "$ref": id });
    }
    return validate;
  }

  describe("pageBreakElement optional intent", () => {
    it("accepts pageBreak with no data properties (intent defaults to flowBreak)", () => {
      const v = getElementValidator("pageBreakElement");
      expect(v({
        id: "pb1",
        type: "pageBreak",
        name: "Break",
        data: {}
      })).toBe(true);
    });
  });

  describe("dateElement optional format", () => {
    it("accepts date element without format (format is optional, has default)", () => {
      const v = getElementValidator("dateElement");
      expect(v({
        id: "d1",
        type: "date",
        name: "Service Date",
        data: { value: "2026-07-06" }
      })).toBe(true);
    });

    it("accepts date element with explicit format", () => {
      const v = getElementValidator("dateElement");
      expect(v({
        id: "d1",
        type: "date",
        name: "Service Date",
        data: { value: "2026-07-06", format: "MMMM D, YYYY" }
      })).toBe(true);
    });
  });

  describe("gridElement optional cellPadding", () => {
    it("accepts gridElement without cellPadding (cellPadding is optional, has fallback)", () => {
      const v = getElementValidator("gridElement");
      expect(v({
        id: "g1",
        type: "grid",
        name: "Grid",
        data: { rows: 2, columns: 3 },
        children: []
      })).toBe(true);
    });
  });
});

describe("common.schema.json binding format", () => {
  function getCommonDef(defName: string): ValidateFunction {
    const id = `https://church-bulletin-builder.local/schema/v1/common.schema.json#/$defs/${defName}`;
    let validate = ajv.getSchema(id);
    if (!validate) {
      validate = ajv.compile({ "$ref": id });
    }
    return validate;
  }

  describe("binding", () => {
    it("accepts binding without format (format is optional)", () => {
      const v = getCommonDef("binding");
      expect(v({
        id: "bind1",
        scope: "document",
        fieldId: "serviceDate",
        target: "/data/value"
      })).toBe(true);
    });

    it("accepts binding with empty format object (only {} is valid)", () => {
      const v = getCommonDef("binding");
      expect(v({
        id: "bind1",
        scope: "document",
        fieldId: "serviceDate",
        target: "/data/value",
        format: {}
      })).toBe(true);
    });

    it("rejects binding with non-empty format object (closed empty object)", () => {
      const v = getCommonDef("binding");
      expect(v({
        id: "bind1",
        scope: "document",
        fieldId: "serviceDate",
        target: "/data/value",
        format: { datePattern: "YYYY-MM-DD" }
      })).toBe(false);
    });
  });
});

describe("isoDate year constraints", () => {
  function getCommonDef(defName: string): ValidateFunction {
    const id = `https://church-bulletin-builder.local/schema/v1/common.schema.json#/$defs/${defName}`;
    let validate = ajv.getSchema(id);
    if (!validate) {
      validate = ajv.compile({ "$ref": id });
    }
    return validate;
  }

  it("rejects year 0000 (spec: years 0001-9999)", () => {
    const v = getCommonDef("isoDate");
    expect(v("0000-01-01")).toBe(false);
  });
  it("accepts year 0001 (earliest valid year)", () => {
    const v = getCommonDef("isoDate");
    expect(v("0001-01-01")).toBe(true);
  });
  it("accepts year 9999 (latest valid year)", () => {
    const v = getCommonDef("isoDate");
    expect(v("9999-12-31")).toBe(true);
  });
});
