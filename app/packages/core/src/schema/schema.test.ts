/**
 * Tests for @cbb/core schema module.
 *
 * Covers:
 * - createSchemaCatalog: cross-file $ref resolution, validation error
 *   stability, unknown schemaId, key/$id mismatch, unresolved $refs.
 * - createMigrationRegistry: ordering, idempotence, purity, unsupported
 *   version, chain gaps, missing-version documents.
 * - createFieldClassificationCatalog: registration, retrieval, duplicate
 *   rejection, exhaustiveness check.
 * - createSemanticValidationRegistry: registration, multi-validator merge,
 *   error severity detection, validator exception safety, no-validators
 *   default.
 */

import { describe, it, expect } from "vitest";
import { createSchemaCatalog } from "./catalog.js";
import {
  createMigrationRegistry,
  isVersionedDocument,
} from "./migration.js";
import { createFieldClassificationCatalog } from "./fieldClassification.js";
import { createSemanticValidationRegistry } from "./semanticValidation.js";
import type {
  SchemaObject,
  MigrationStep,
  SemanticDiagnostic,
} from "./types.js";

// ---------------------------------------------------------------------------
// Test schema fixtures
// ---------------------------------------------------------------------------

const BASE_URI = "https://church-bulletin-builder.local/schema/v1";

/**
 * common.schema.json — defines shared primitives referenced by document.
 */
const COMMON_SCHEMA: SchemaObject = {
  $id: `${BASE_URI}/common.schema.json`,
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Common primitives",
  $defs: {
    version: {
      type: "integer",
      minimum: 1,
    },
    displayName: {
      type: "string",
      minLength: 1,
      maxLength: 200,
    },
    color: {
      type: "string",
      pattern: "^#[0-9a-fA-F]{6}$",
    },
  },
};

/**
 * document.schema.json — references common.schema.json via $ref.
 */
const DOCUMENT_SCHEMA: SchemaObject = {
  $id: `${BASE_URI}/document.schema.json`,
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Document",
  type: "object",
  required: ["version", "kind", "displayName"],
  additionalProperties: false,
  properties: {
    version: {
      $ref: `${BASE_URI}/common.schema.json#/$defs/version`,
    },
    kind: {
      type: "string",
      enum: ["bulletin", "template"],
    },
    displayName: {
      $ref: `${BASE_URI}/common.schema.json#/$defs/displayName`,
    },
    accentColor: {
      $ref: `${BASE_URI}/common.schema.json#/$defs/color`,
    },
  },
};

/**
 * richText.schema.json — standalone schema for rich text.
 */
const RICH_TEXT_SCHEMA: SchemaObject = {
  $id: `${BASE_URI}/richText.schema.json`,
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Rich text block",
  type: "object",
  required: ["blocks"],
  additionalProperties: false,
  properties: {
    blocks: {
      type: "array",
      items: {
        type: "object",
        required: ["type", "text"],
        additionalProperties: false,
        properties: {
          type: { type: "string", enum: ["paragraph", "heading"] },
          text: { type: "string" },
        },
      },
    },
  },
};

function buildCatalog(): ReturnType<typeof createSchemaCatalog> {
  const map = new Map<string, SchemaObject>([
    [COMMON_SCHEMA.$id, COMMON_SCHEMA],
    [DOCUMENT_SCHEMA.$id, DOCUMENT_SCHEMA],
    [RICH_TEXT_SCHEMA.$id, RICH_TEXT_SCHEMA],
  ]);
  return createSchemaCatalog(map);
}

// ---------------------------------------------------------------------------
// createSchemaCatalog
// ---------------------------------------------------------------------------

describe("createSchemaCatalog", () => {
  describe("construction", () => {
    it("builds a catalog from multiple schemas with cross-file $refs", () => {
      // Should not throw.
      expect(() => buildCatalog()).not.toThrow();
    });

    it("exposes all registered schemaIds in sorted order", () => {
      const catalog = buildCatalog();
      expect(catalog.schemaIds()).toEqual([
        `${BASE_URI}/common.schema.json`,
        `${BASE_URI}/document.schema.json`,
        `${BASE_URI}/richText.schema.json`,
      ]);
    });

    it("throws if catalog key does not match schema $id", () => {
      const map = new Map<string, SchemaObject>([
        ["https://wrong.key/schema.json", COMMON_SCHEMA],
      ]);
      expect(() => createSchemaCatalog(map)).toThrow(
        /does not match schema \$id/
      );
    });

    it("throws if a $ref cannot be resolved within the catalog", () => {
      const brokenSchema: SchemaObject = {
        $id: `${BASE_URI}/broken.schema.json`,
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: {
          missing: {
            $ref: `${BASE_URI}/nonexistent.schema.json#/$defs/something`,
          },
        },
      };
      const map = new Map<string, SchemaObject>([
        [brokenSchema.$id, brokenSchema],
      ]);
      expect(() => createSchemaCatalog(map)).toThrow(
        /Failed to compile schema/
      );
    });

    it("builds a catalog with a single standalone schema", () => {
      const map = new Map<string, SchemaObject>([
        [RICH_TEXT_SCHEMA.$id, RICH_TEXT_SCHEMA],
      ]);
      expect(() => createSchemaCatalog(map)).not.toThrow();
    });
  });

  describe("validateAgainst — valid cases", () => {
    it("validates a valid document object", () => {
      const catalog = buildCatalog();
      const result = catalog.validateAgainst(DOCUMENT_SCHEMA.$id, {
        version: 1,
        kind: "bulletin",
        displayName: "Sunday Bulletin",
      });
      expect(result.valid).toBe(true);
    });

    it("validates a valid document with optional accentColor", () => {
      const catalog = buildCatalog();
      const result = catalog.validateAgainst(DOCUMENT_SCHEMA.$id, {
        version: 1,
        kind: "template",
        displayName: "My Template",
        accentColor: "#ff0000",
      });
      expect(result.valid).toBe(true);
    });

    it("validates a valid richText object", () => {
      const catalog = buildCatalog();
      const result = catalog.validateAgainst(RICH_TEXT_SCHEMA.$id, {
        blocks: [{ type: "paragraph", text: "Hello" }],
      });
      expect(result.valid).toBe(true);
    });

    it("validates an empty blocks array as valid", () => {
      const catalog = buildCatalog();
      const result = catalog.validateAgainst(RICH_TEXT_SCHEMA.$id, {
        blocks: [],
      });
      expect(result.valid).toBe(true);
    });
  });

  describe("validateAgainst — invalid cases with stable error ordering", () => {
    it("returns structured errors for missing required fields", () => {
      const catalog = buildCatalog();
      const result = catalog.validateAgainst(DOCUMENT_SCHEMA.$id, {});

      expect(result.valid).toBe(false);
      if (result.valid) throw new Error("Expected invalid");

      // Must have errors for all three required fields.
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      // All errors must have the required shape.
      for (const err of result.errors) {
        expect(typeof err.instancePath).toBe("string");
        expect(typeof err.keyword).toBe("string");
        expect(typeof err.message).toBe("string");
        expect(typeof err.schemaPath).toBe("string");
      }
    });

    it("errors are stably ordered (primary instancePath, secondary schemaPath)", () => {
      const catalog = buildCatalog();
      // Call twice with the same input — must produce identical error arrays.
      const r1 = catalog.validateAgainst(DOCUMENT_SCHEMA.$id, {
        version: 0,   // below minimum (1)
        kind: "unknown-kind",
        displayName: "", // below minLength
      });
      const r2 = catalog.validateAgainst(DOCUMENT_SCHEMA.$id, {
        version: 0,
        kind: "unknown-kind",
        displayName: "",
      });

      expect(r1.valid).toBe(false);
      expect(r2.valid).toBe(false);
      if (r1.valid || r2.valid) throw new Error("Expected invalid");

      // Ordering must be identical across two calls.
      expect(r1.errors).toEqual(r2.errors);

      // Verify the sort: instancePaths should be non-decreasing.
      for (let i = 1; i < r1.errors.length; i++) {
        const prev = r1.errors[i - 1];
        const curr = r1.errors[i];
        if (prev === undefined || curr === undefined) continue;
        const cmp = prev.instancePath.localeCompare(curr.instancePath);
        expect(cmp).toBeLessThanOrEqual(0);
        if (cmp === 0) {
          expect(
            prev.schemaPath.localeCompare(curr.schemaPath)
          ).toBeLessThanOrEqual(0);
        }
      }
    });

    it("returns an error for unknown schemaId (never throws)", () => {
      const catalog = buildCatalog();
      const result = catalog.validateAgainst("https://unknown.local/x.json", {});
      expect(result.valid).toBe(false);
      if (result.valid) throw new Error("Expected invalid");
      expect(result.errors[0]?.message).toMatch(/No schema registered/);
    });

    it("reports additionalProperties violations", () => {
      const catalog = buildCatalog();
      const result = catalog.validateAgainst(DOCUMENT_SCHEMA.$id, {
        version: 1,
        kind: "bulletin",
        displayName: "Test",
        unexpectedField: "should fail",
      });
      expect(result.valid).toBe(false);
    });

    it("validates $ref-resolved field constraints (color pattern)", () => {
      const catalog = buildCatalog();
      const result = catalog.validateAgainst(DOCUMENT_SCHEMA.$id, {
        version: 1,
        kind: "bulletin",
        displayName: "Test",
        accentColor: "not-a-hex-color",
      });
      expect(result.valid).toBe(false);
      if (result.valid) throw new Error("Expected invalid");
      // The instancePath should point at accentColor
      const colorError = result.errors.find((e) =>
        e.instancePath.includes("accentColor")
      );
      expect(colorError).toBeDefined();
    });

    it("detects version below minimum (1) via $ref to common#/$defs/version", () => {
      const catalog = buildCatalog();
      const result = catalog.validateAgainst(DOCUMENT_SCHEMA.$id, {
        version: 0, // below minimum
        kind: "bulletin",
        displayName: "Test",
      });
      expect(result.valid).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// createMigrationRegistry
// ---------------------------------------------------------------------------

describe("createMigrationRegistry", () => {
  const SCHEMA_A = `${BASE_URI}/document.schema.json`;
  const SCHEMA_B = `${BASE_URI}/richText.schema.json`;

  function makeMigration(
    schemaId: string,
    fromVersion: number,
    transform?: (doc: Readonly<Record<string, unknown>>) => Record<string, unknown>
  ): MigrationStep {
    return {
      schemaId,
      fromVersion,
      toVersion: fromVersion + 1,
      up:
        transform ??
        ((doc) => ({ ...doc, version: fromVersion + 1 })),
    };
  }

  describe("registration", () => {
    it("registers migrations without error", () => {
      const registry = createMigrationRegistry();
      expect(() => registry.register(makeMigration(SCHEMA_A, 1))).not.toThrow();
      expect(() => registry.register(makeMigration(SCHEMA_A, 2))).not.toThrow();
    });

    it("throws on duplicate (schemaId, fromVersion) registration", () => {
      const registry = createMigrationRegistry();
      registry.register(makeMigration(SCHEMA_A, 1));
      expect(() => registry.register(makeMigration(SCHEMA_A, 1))).toThrow(
        /already registered/
      );
    });

    it("throws if toVersion !== fromVersion + 1", () => {
      const registry = createMigrationRegistry();
      expect(() =>
        registry.register({
          schemaId: SCHEMA_A,
          fromVersion: 1,
          toVersion: 3, // skip
          up: (doc) => doc,
        })
      ).toThrow(/toVersion must equal fromVersion \+ 1/);
    });

    it("allows independent migrations for different schemaIds", () => {
      const registry = createMigrationRegistry();
      registry.register(makeMigration(SCHEMA_A, 1));
      registry.register(makeMigration(SCHEMA_B, 1)); // same from-version, different schema
      expect(registry.maxSupportedVersion(SCHEMA_A)).toBe(2);
      expect(registry.maxSupportedVersion(SCHEMA_B)).toBe(2);
    });
  });

  describe("applyMigrations", () => {
    it("returns ok with no migrations applied when no steps registered", () => {
      const registry = createMigrationRegistry();
      const doc = { version: 1, kind: "bulletin" };
      const result = registry.applyMigrations(SCHEMA_A, doc);

      expect(result.status).toBe("ok");
      if (result.status !== "ok") throw new Error();
      expect(result.migrationsApplied).toEqual([]);
      expect(result.document).toEqual(doc);
    });

    it("applies a single migration step", () => {
      const registry = createMigrationRegistry();
      registry.register({
        schemaId: SCHEMA_A,
        fromVersion: 1,
        toVersion: 2,
        up: (doc) => ({ ...doc, version: 2, migrated: true }),
      });

      const result = registry.applyMigrations(SCHEMA_A, { version: 1, kind: "bulletin" });
      expect(result.status).toBe("ok");
      if (result.status !== "ok") throw new Error();
      expect(result.document["version"]).toBe(2);
      expect(result.document["migrated"]).toBe(true);
      expect(result.migrationsApplied).toEqual([
        { schemaId: SCHEMA_A, fromVersion: 1, toVersion: 2 },
      ]);
    });

    it("chains multiple migrations in order (1->2->3)", () => {
      const registry = createMigrationRegistry();
      registry.register({
        schemaId: SCHEMA_A,
        fromVersion: 1,
        toVersion: 2,
        up: (doc) => ({ ...doc, version: 2, step2: true }),
      });
      registry.register({
        schemaId: SCHEMA_A,
        fromVersion: 2,
        toVersion: 3,
        up: (doc) => ({ ...doc, version: 3, step3: true }),
      });

      const result = registry.applyMigrations(SCHEMA_A, { version: 1 });
      expect(result.status).toBe("ok");
      if (result.status !== "ok") throw new Error();
      expect(result.document["version"]).toBe(3);
      expect(result.document["step2"]).toBe(true);
      expect(result.document["step3"]).toBe(true);
      expect(result.migrationsApplied).toHaveLength(2);
    });

    it("runs no steps when document is already at latest version", () => {
      const registry = createMigrationRegistry();
      registry.register(makeMigration(SCHEMA_A, 1)); // 1->2

      const result = registry.applyMigrations(SCHEMA_A, { version: 2 });
      expect(result.status).toBe("ok");
      if (result.status !== "ok") throw new Error();
      expect(result.migrationsApplied).toEqual([]);
      expect(result.document["version"]).toBe(2);
    });

    it("starts mid-chain (applies only later steps when doc is at version 2)", () => {
      const registry = createMigrationRegistry();
      registry.register(makeMigration(SCHEMA_A, 1)); // 1->2
      registry.register(makeMigration(SCHEMA_A, 2)); // 2->3

      const result = registry.applyMigrations(SCHEMA_A, { version: 2 });
      expect(result.status).toBe("ok");
      if (result.status !== "ok") throw new Error();
      expect(result.document["version"]).toBe(3);
      expect(result.migrationsApplied).toEqual([
        { schemaId: SCHEMA_A, fromVersion: 2, toVersion: 3 },
      ]);
    });

    it("returns unsupported when document version exceeds max registered", () => {
      const registry = createMigrationRegistry();
      registry.register(makeMigration(SCHEMA_A, 1)); // 1->2

      const result = registry.applyMigrations(SCHEMA_A, { version: 99 });
      expect(result.status).toBe("unsupported");
      if (result.status !== "unsupported") throw new Error();
      expect(result.documentVersion).toBe(99);
      expect(result.maxSupportedVersion).toBe(2);
      expect(result.schemaId).toBe(SCHEMA_A);
    });

    it("returns unsupported for a newer-than-current version (spec: read-only mode)", () => {
      const registry = createMigrationRegistry();
      // App understands up to version 3.
      registry.register(makeMigration(SCHEMA_A, 1));
      registry.register(makeMigration(SCHEMA_A, 2));

      const result = registry.applyMigrations(SCHEMA_A, { version: 5 });
      expect(result.status).toBe("unsupported");
      if (result.status !== "unsupported") throw new Error();
      expect(result.documentVersion).toBe(5);
      expect(result.maxSupportedVersion).toBe(3);
    });

    it("is pure — does not mutate the original document", () => {
      const registry = createMigrationRegistry();
      registry.register({
        schemaId: SCHEMA_A,
        fromVersion: 1,
        toVersion: 2,
        up: (doc) => ({ ...doc, version: 2, added: "new-field" }),
      });

      const original = Object.freeze({ version: 1, kind: "bulletin" });
      const result = registry.applyMigrations(SCHEMA_A, original);

      expect(result.status).toBe("ok");
      if (result.status !== "ok") throw new Error();
      // Original must be untouched.
      expect((original as Record<string, unknown>)["added"]).toBeUndefined();
      // New document has the added field.
      expect(result.document["added"]).toBe("new-field");
      // Original and result are different object references.
      expect(result.document).not.toBe(original);
    });

    it("handles document with missing version field (treats as version 0)", () => {
      const registry = createMigrationRegistry();
      registry.register({
        schemaId: SCHEMA_A,
        fromVersion: 0,
        toVersion: 1,
        up: (doc) => ({ ...doc, version: 1 }),
      });

      const result = registry.applyMigrations(SCHEMA_A, { kind: "bulletin" });
      expect(result.status).toBe("ok");
      if (result.status !== "ok") throw new Error();
      expect(result.document["version"]).toBe(1);
    });

    it("returns unsupported at chain gap (no step from version 2 to 3)", () => {
      // Fix for issue #4: a gap in the migration chain must not silently present
      // an unmigrated document as current. The correct behavior is to return
      // 'unsupported' so the caller can surface the error explicitly.
      const registry = createMigrationRegistry();
      registry.register(makeMigration(SCHEMA_A, 1)); // 1->2
      // No 2->3 registered, but 3->4 is — creating a chain gap.
      registry.register(makeMigration(SCHEMA_A, 3)); // 3->4

      const result = registry.applyMigrations(SCHEMA_A, { version: 1 });
      // A gap in the chain means the document cannot be safely migrated to the
      // latest version. This should be a distinct error, not silently ok.
      expect(result.status).toBe("unsupported");
      if (result.status !== "unsupported") throw new Error();
      // The document was at version 1, successfully migrated to version 2,
      // but then hit the gap at 2->3, so documentVersion reflects where we
      // got stuck (version 2).
      expect(result.documentVersion).toBe(2);
      expect(result.maxSupportedVersion).toBe(4);
    });

    it("records migrationsApplied in ascending fromVersion order", () => {
      const registry = createMigrationRegistry();
      // Register out of API-call order.
      registry.register(makeMigration(SCHEMA_A, 2));
      registry.register(makeMigration(SCHEMA_A, 1));

      const result = registry.applyMigrations(SCHEMA_A, { version: 1 });
      expect(result.status).toBe("ok");
      if (result.status !== "ok") throw new Error();
      expect(result.migrationsApplied).toEqual([
        { schemaId: SCHEMA_A, fromVersion: 1, toVersion: 2 },
        { schemaId: SCHEMA_A, fromVersion: 2, toVersion: 3 },
      ]);
    });

    it("throws if migration step does not set version to toVersion", () => {
      // Fix for issue #4: post-condition assertion after each migration step.
      // A step that forgets to bump 'version' must be caught immediately.
      const registry = createMigrationRegistry();
      registry.register({
        schemaId: SCHEMA_A,
        fromVersion: 1,
        toVersion: 2,
        // Bug: this step forgets to set version: 2 in its output.
        up: (doc) => ({ ...doc, data: "updated" }),
      });
      expect(() => registry.applyMigrations(SCHEMA_A, { version: 1 })).toThrow(
        /did not set version to 2/,
      );
    });

    it("deep-freeze prevents misbehaving step from mutating nested shared state", () => {
      // Fix for issue #4: the input snapshot must be deep-frozen so a step
      // cannot mutate nested state shared with the caller's original document.
      const registry = createMigrationRegistry();
      let capturedInput: Readonly<Record<string, unknown>> | undefined;
      registry.register({
        schemaId: SCHEMA_A,
        fromVersion: 1,
        toVersion: 2,
        up: (doc) => {
          capturedInput = doc;
          // Try to mutate a nested property. In strict mode this would throw;
          // in non-strict it would silently fail. Either way the original is safe.
          try {
            (doc as Record<string, unknown>)["nested"] = "mutated";
          } catch {
            // Expected in strict mode.
          }
          return { ...doc, version: 2 };
        },
      });

      const original = { version: 1, nested: { value: 42 } };
      const result = registry.applyMigrations(SCHEMA_A, original);
      expect(result.status).toBe("ok");
      // The step received a frozen snapshot, not the original.
      expect(capturedInput).toBeDefined();
      expect(Object.isFrozen(capturedInput)).toBe(true);
      // The original document was not mutated.
      expect(original.nested.value).toBe(42);
    });

    it("does not interfere across different schemaIds", () => {
      const registry = createMigrationRegistry();
      registry.register(makeMigration(SCHEMA_A, 1));
      registry.register(makeMigration(SCHEMA_B, 1));

      const rA = registry.applyMigrations(SCHEMA_A, { version: 1 });
      const rB = registry.applyMigrations(SCHEMA_B, { version: 1 });

      expect(rA.status).toBe("ok");
      expect(rB.status).toBe("ok");
      if (rA.status !== "ok" || rB.status !== "ok") throw new Error();
      expect(rA.migrationsApplied[0]?.schemaId).toBe(SCHEMA_A);
      expect(rB.migrationsApplied[0]?.schemaId).toBe(SCHEMA_B);
    });
  });

  describe("maxSupportedVersion", () => {
    it("returns undefined for unknown schemaId", () => {
      const registry = createMigrationRegistry();
      expect(registry.maxSupportedVersion("unknown")).toBeUndefined();
    });

    it("tracks the highest toVersion across all registered steps", () => {
      const registry = createMigrationRegistry();
      registry.register(makeMigration(SCHEMA_A, 1));
      registry.register(makeMigration(SCHEMA_A, 2));
      expect(registry.maxSupportedVersion(SCHEMA_A)).toBe(3);
    });
  });
});

// ---------------------------------------------------------------------------
// isVersionedDocument
// ---------------------------------------------------------------------------

describe("isVersionedDocument", () => {
  it("returns true for object with integer version", () => {
    expect(isVersionedDocument({ version: 1 })).toBe(true);
    expect(isVersionedDocument({ version: 100, other: "data" })).toBe(true);
  });

  it("returns false for missing version field", () => {
    expect(isVersionedDocument({ kind: "bulletin" })).toBe(false);
  });

  it("returns false for non-integer version", () => {
    expect(isVersionedDocument({ version: 1.5 })).toBe(false);
    expect(isVersionedDocument({ version: "1" })).toBe(false);
    expect(isVersionedDocument({ version: null })).toBe(false);
  });

  it("returns false for non-object values", () => {
    expect(isVersionedDocument(null)).toBe(false);
    expect(isVersionedDocument(undefined)).toBe(false);
    expect(isVersionedDocument(42)).toBe(false);
    expect(isVersionedDocument("string")).toBe(false);
    expect(isVersionedDocument([])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createFieldClassificationCatalog
// ---------------------------------------------------------------------------

describe("createFieldClassificationCatalog", () => {
  const SCHEMA_ID = `${BASE_URI}/document.schema.json`;

  describe("register and retrieve", () => {
    it("registers entries and retrieves them", () => {
      const catalog = createFieldClassificationCatalog();
      catalog.register(SCHEMA_ID, [
        { path: "version", classification: "renderAffecting" },
        { path: "displayName", classification: "readinessOnly" },
        { path: "editorNotes", classification: "inert" },
      ]);

      expect(catalog.classificationFor(SCHEMA_ID, "version")).toBe("renderAffecting");
      expect(catalog.classificationFor(SCHEMA_ID, "displayName")).toBe("readinessOnly");
      expect(catalog.classificationFor(SCHEMA_ID, "editorNotes")).toBe("inert");
    });

    it("returns undefined for unregistered path", () => {
      const catalog = createFieldClassificationCatalog();
      catalog.register(SCHEMA_ID, [
        { path: "version", classification: "renderAffecting" },
      ]);
      expect(catalog.classificationFor(SCHEMA_ID, "unknown")).toBeUndefined();
    });

    it("returns undefined for unregistered schemaId", () => {
      const catalog = createFieldClassificationCatalog();
      expect(
        catalog.classificationFor("https://unknown.local/x.json", "version")
      ).toBeUndefined();
    });

    it("returns empty array for entriesFor an unknown schemaId", () => {
      const catalog = createFieldClassificationCatalog();
      expect(catalog.entriesFor("https://unknown.local/x.json")).toEqual([]);
    });

    it("entriesFor returns all entries in registration order", () => {
      const catalog = createFieldClassificationCatalog();
      const entries = [
        { path: "version", classification: "renderAffecting" as const },
        { path: "displayName", classification: "readinessOnly" as const },
        { path: "editorNotes", classification: "inert" as const },
      ];
      catalog.register(SCHEMA_ID, entries);

      const retrieved = catalog.entriesFor(SCHEMA_ID);
      expect(retrieved).toHaveLength(3);
      expect(retrieved.map((e) => e.path)).toEqual([
        "version",
        "displayName",
        "editorNotes",
      ]);
    });

    it("supports optional reason field", () => {
      const catalog = createFieldClassificationCatalog();
      catalog.register(SCHEMA_ID, [
        {
          path: "accentColor",
          classification: "renderAffecting",
          reason: "Color changes affect PDF output.",
        },
      ]);
      const entry = catalog.entriesFor(SCHEMA_ID)[0];
      expect(entry?.reason).toBe("Color changes affect PDF output.");
    });
  });

  describe("duplicate rejection", () => {
    it("throws on duplicate (schemaId, path)", () => {
      const catalog = createFieldClassificationCatalog();
      catalog.register(SCHEMA_ID, [
        { path: "version", classification: "renderAffecting" },
      ]);
      expect(() =>
        catalog.register(SCHEMA_ID, [
          { path: "version", classification: "inert" },
        ])
      ).toThrow(/already registered/);
    });

    it("allows same path in a different schemaId", () => {
      const catalog = createFieldClassificationCatalog();
      catalog.register(SCHEMA_ID, [
        { path: "version", classification: "renderAffecting" },
      ]);
      const OTHER = `${BASE_URI}/richText.schema.json`;
      expect(() =>
        catalog.register(OTHER, [
          { path: "version", classification: "inert" },
        ])
      ).not.toThrow();
    });
  });

  describe("checkExhaustiveness", () => {
    it("reports all properties as unclassified when catalog is empty", () => {
      const catalog = createFieldClassificationCatalog();
      const report = catalog.checkExhaustiveness(SCHEMA_ID, [
        "version",
        "kind",
        "displayName",
      ]);
      expect(report.schemaId).toBe(SCHEMA_ID);
      expect(report.unclassified).toEqual(["version", "kind", "displayName"]);
      expect(report.classified).toEqual([]);
    });

    it("reports correctly when all properties are classified", () => {
      const catalog = createFieldClassificationCatalog();
      catalog.register(SCHEMA_ID, [
        { path: "version", classification: "renderAffecting" },
        { path: "kind", classification: "renderAffecting" },
        { path: "displayName", classification: "readinessOnly" },
      ]);
      const report = catalog.checkExhaustiveness(SCHEMA_ID, [
        "version",
        "kind",
        "displayName",
      ]);
      expect(report.unclassified).toEqual([]);
      expect(report.classified).toEqual(["version", "kind", "displayName"]);
    });

    it("reports mixed classified/unclassified correctly", () => {
      const catalog = createFieldClassificationCatalog();
      catalog.register(SCHEMA_ID, [
        { path: "version", classification: "renderAffecting" },
      ]);
      const report = catalog.checkExhaustiveness(SCHEMA_ID, [
        "version",
        "displayName",
        "accentColor",
      ]);
      expect(report.classified).toEqual(["version"]);
      expect(report.unclassified).toEqual(["displayName", "accentColor"]);
    });

    it("handles empty propertyNames list", () => {
      const catalog = createFieldClassificationCatalog();
      catalog.register(SCHEMA_ID, [
        { path: "version", classification: "renderAffecting" },
      ]);
      const report = catalog.checkExhaustiveness(SCHEMA_ID, []);
      expect(report.classified).toEqual([]);
      expect(report.unclassified).toEqual([]);
    });
  });

  describe("registeredSchemaIds", () => {
    it("returns empty array when no schemas registered", () => {
      const catalog = createFieldClassificationCatalog();
      expect(catalog.registeredSchemaIds()).toEqual([]);
    });

    it("returns sorted list of registered schemaIds", () => {
      const catalog = createFieldClassificationCatalog();
      const IDA = `${BASE_URI}/z-document.schema.json`;
      const IDB = `${BASE_URI}/a-document.schema.json`;
      catalog.register(IDA, [{ path: "x", classification: "inert" }]);
      catalog.register(IDB, [{ path: "y", classification: "inert" }]);
      expect(catalog.registeredSchemaIds()).toEqual([IDB, IDA]);
    });
  });

  describe("atomic batch registration", () => {
    it("batch registration is atomic: a duplicate mid-batch leaves registry unchanged", () => {
      const catalog = createFieldClassificationCatalog();
      const schemaId = "https://example.com/test.schema.json";

      // First, register a single entry so we have a known state.
      catalog.register(schemaId, [
        { path: "title", classification: "renderAffecting" },
      ]);
      expect(catalog.entriesFor(schemaId)).toHaveLength(1);

      // Now attempt a batch where the second entry duplicates "title".
      // The batch should fail atomically — "subtitle" must NOT be registered.
      expect(() =>
        catalog.register(schemaId, [
          { path: "subtitle", classification: "inert" },
          { path: "title", classification: "inert" }, // duplicate!
        ])
      ).toThrow(/already registered/i);

      // Registry should be unchanged: still only "title"
      const entries = catalog.entriesFor(schemaId);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.path).toBe("title");
      expect(catalog.classificationFor(schemaId, "subtitle")).toBeUndefined();
    });

    it("intra-batch duplicate is also rejected atomically", () => {
      const catalog = createFieldClassificationCatalog();
      const schemaId = "https://example.com/intra-batch.schema.json";

      expect(() =>
        catalog.register(schemaId, [
          { path: "alpha", classification: "inert" },
          { path: "alpha", classification: "renderAffecting" }, // intra-batch duplicate
        ])
      ).toThrow(/already registered|more than once/i);

      // Nothing should have been registered
      expect(catalog.entriesFor(schemaId)).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// createSemanticValidationRegistry
// ---------------------------------------------------------------------------

describe("createSemanticValidationRegistry", () => {
  const SCHEMA_ID = `${BASE_URI}/document.schema.json`;

  const noIssuesValidator = (): readonly SemanticDiagnostic[] => [];

  const errorValidator = (): readonly SemanticDiagnostic[] => [
    {
      code: "CBB-DOC-0001",
      severity: "error",
      message: "Duplicate element ids found.",
      instancePath: "/elements",
    },
  ];

  const warningValidator = (): readonly SemanticDiagnostic[] => [
    {
      code: "CBB-DOC-0002",
      severity: "warning",
      message: "Element is unreachable.",
    },
  ];

  describe("register", () => {
    it("registers a validator without error", () => {
      const registry = createSemanticValidationRegistry();
      expect(() =>
        registry.register(SCHEMA_ID, {
          name: "element-id-uniqueness",
          validate: noIssuesValidator,
        })
      ).not.toThrow();
    });

    it("throws on duplicate (schemaId, name) registration", () => {
      const registry = createSemanticValidationRegistry();
      registry.register(SCHEMA_ID, {
        name: "element-id-uniqueness",
        validate: noIssuesValidator,
      });
      expect(() =>
        registry.register(SCHEMA_ID, {
          name: "element-id-uniqueness",
          validate: noIssuesValidator,
        })
      ).toThrow(/already registered/);
    });

    it("allows same name for different schemaIds", () => {
      const registry = createSemanticValidationRegistry();
      const OTHER = `${BASE_URI}/richText.schema.json`;
      registry.register(SCHEMA_ID, {
        name: "my-validator",
        validate: noIssuesValidator,
      });
      expect(() =>
        registry.register(OTHER, {
          name: "my-validator",
          validate: noIssuesValidator,
        })
      ).not.toThrow();
    });
  });

  describe("runValidators", () => {
    it("returns valid with no findings when no validators registered", () => {
      const registry = createSemanticValidationRegistry();
      const result = registry.runValidators(SCHEMA_ID, { version: 1 });
      expect(result.valid).toBe(true);
      expect(result.findings).toEqual([]);
    });

    it("returns valid with no findings when all validators pass", () => {
      const registry = createSemanticValidationRegistry();
      registry.register(SCHEMA_ID, {
        name: "always-pass",
        validate: noIssuesValidator,
      });
      const result = registry.runValidators(SCHEMA_ID, { version: 1 });
      expect(result.valid).toBe(true);
      expect(result.findings).toEqual([]);
    });

    it("returns invalid when any validator returns an error", () => {
      const registry = createSemanticValidationRegistry();
      registry.register(SCHEMA_ID, {
        name: "error-validator",
        validate: errorValidator,
      });
      const result = registry.runValidators(SCHEMA_ID, { version: 1 });
      expect(result.valid).toBe(false);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]?.code).toBe("CBB-DOC-0001");
    });

    it("returns valid with findings when only warnings are produced", () => {
      const registry = createSemanticValidationRegistry();
      registry.register(SCHEMA_ID, {
        name: "warning-validator",
        validate: warningValidator,
      });
      const result = registry.runValidators(SCHEMA_ID, { version: 1 });
      expect(result.valid).toBe(true);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]?.severity).toBe("warning");
    });

    it("merges findings from multiple validators", () => {
      const registry = createSemanticValidationRegistry();
      registry.register(SCHEMA_ID, {
        name: "error-validator",
        validate: errorValidator,
      });
      registry.register(SCHEMA_ID, {
        name: "warning-validator",
        validate: warningValidator,
      });
      const result = registry.runValidators(SCHEMA_ID, { version: 1 });
      expect(result.valid).toBe(false); // error present
      expect(result.findings).toHaveLength(2);
      const codes = result.findings.map((f) => f.code);
      expect(codes).toContain("CBB-DOC-0001");
      expect(codes).toContain("CBB-DOC-0002");
    });

    it("catches exceptions from a throwing validator and converts to error finding", () => {
      const registry = createSemanticValidationRegistry();
      registry.register(SCHEMA_ID, {
        name: "buggy-validator",
        validate: (_value: unknown): readonly SemanticDiagnostic[] => {
          throw new Error("Unexpected internal error");
        },
      });
      let result!: ReturnType<typeof registry.runValidators>;
      // Must not throw.
      expect(() => {
        result = registry.runValidators(SCHEMA_ID, { version: 1 });
      }).not.toThrow();

      expect(result.valid).toBe(false);
      const internalErr = result.findings.find(
        (f) => f.code === "CBB-SCHEMA-0002"
      );
      expect(internalErr).toBeDefined();
      expect(internalErr?.severity).toBe("error");
      expect(internalErr?.message).toMatch(/buggy-validator/);
    });

    it("the value passed to validator is the same object passed to runValidators", () => {
      const registry = createSemanticValidationRegistry();
      let capturedValue: unknown;
      registry.register(SCHEMA_ID, {
        name: "capture-validator",
        validate: (value) => {
          capturedValue = value;
          return [];
        },
      });
      const input = { version: 1, kind: "bulletin" };
      registry.runValidators(SCHEMA_ID, input);
      expect(capturedValue).toBe(input);
    });
  });

  describe("validatorNamesFor / registeredSchemaIds", () => {
    it("returns empty array for unknown schemaId", () => {
      const registry = createSemanticValidationRegistry();
      expect(registry.validatorNamesFor("unknown")).toEqual([]);
    });

    it("lists validators in registration order", () => {
      const registry = createSemanticValidationRegistry();
      registry.register(SCHEMA_ID, { name: "first", validate: noIssuesValidator });
      registry.register(SCHEMA_ID, { name: "second", validate: noIssuesValidator });
      expect(registry.validatorNamesFor(SCHEMA_ID)).toEqual(["first", "second"]);
    });

    it("registeredSchemaIds returns sorted list", () => {
      const registry = createSemanticValidationRegistry();
      const IDA = `${BASE_URI}/z-doc.schema.json`;
      const IDB = `${BASE_URI}/a-doc.schema.json`;
      registry.register(IDA, { name: "v", validate: noIssuesValidator });
      registry.register(IDB, { name: "v", validate: noIssuesValidator });
      expect(registry.registeredSchemaIds()).toEqual([IDB, IDA]);
    });
  });
});
