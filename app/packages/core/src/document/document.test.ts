/**
 * Tests for @cbb/core/document module.
 *
 * Coverage:
 *   1. Round-trip stability (fromJson/toJson) over both M1 fixtures
 *   2. Tree operations: findById, buildParentMap, collectAllNodeIds, countNodes
 *   3. insertElement / removeElement / moveElement
 *   4. Collision re-mint determinism with sequential IdPort
 *   5. Classification exhaustiveness (document + element schemas)
 *   6. Limits enforcement (node count cap, container depth cap)
 *   7. Downstream contract type constructors (resolved node constructors)
 *   8. DocumentValidationError on invalid input
 *   9. findDuplicateNodeId invariant
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, beforeAll } from "vitest";

import { createSchemaCatalog, createFieldClassificationCatalog } from "../schema/index.js";
import { makeSequentialIdPort } from "../ids/index.js";
import { canonicalStringify } from "../canonical/index.js";

import {
  fromJson,
  toJson,
  DocumentValidationError,
  findById,
  buildParentMap,
  collectAllNodeIds,
  countNodes,
  insertElement,
  removeElement,
  moveElement,
  remintIds,
  maxContainerDepth,
  findDuplicateNodeId,
  checkNodeLimit,
  checkContainerDepth,
  makeDirectResolvedNode,
  makeRepeatResolvedNode,
  makeCustomResolvedNode,
  makeEmptyResolvedRenderTree,
  DOCUMENT_LIMITS,
  DOCUMENT_FIELD_CLASSIFICATIONS,
  ELEMENT_FIELD_CLASSIFICATIONS,
  registerDocumentClassifications,
  DOCUMENT_CLASSIFICATION_SCHEMA_ID,
  ELEMENT_CLASSIFICATION_SCHEMA_ID,
} from "./index.js";

import type {
  CbbDocument,
  NativeElement,
  TextElement,
  GridElement,
  StackElement,
  CanvasElement,
} from "./index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// The test file lives at app/packages/core/src/document/
// 4 directories up lands at app/
const SCHEMAS_DIR = resolve(
  new URL(".", import.meta.url).pathname,
  "../../../..",   // -> app/
  "schemas/v1"
);
const FIXTURES_DIR = resolve(
  new URL(".", import.meta.url).pathname,
  "../../../..",   // -> app/
  "test/fixtures"
);

import { readdirSync } from "node:fs";
import type { SchemaObject } from "../schema/index.js";

function loadSchemas(): ReadonlyMap<string, SchemaObject> {
  const map = new Map<string, SchemaObject>();
  for (const f of readdirSync(SCHEMAS_DIR).filter((n) =>
    n.endsWith(".schema.json")
  )) {
    const schema = JSON.parse(
      readFileSync(resolve(SCHEMAS_DIR, f), "utf-8")
    ) as SchemaObject;
    map.set(schema.$id, schema);
  }
  return map;
}

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(FIXTURES_DIR, name), "utf-8"));
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

let catalog: ReturnType<typeof createSchemaCatalog>;

beforeAll(() => {
  catalog = createSchemaCatalog(loadSchemas());
});

// ---------------------------------------------------------------------------
// 1. Round-trip stability
// ---------------------------------------------------------------------------

describe("fromJson / toJson round-trip", () => {
  it("parses minimal-bulletin.json without errors", () => {
    const raw = loadFixture("minimal-bulletin.json");
    const doc = fromJson(raw, catalog);
    expect(doc.kind).toBe("bulletin");
    expect(doc.version).toBe(1);
    expect(Array.isArray(doc.elements)).toBe(true);
  });

  it("parses full-featured-bulletin.json without errors", () => {
    const raw = loadFixture("full-featured-bulletin.json");
    const doc = fromJson(raw, catalog);
    expect(doc.kind).toBe("bulletin");
    expect(doc.elements.length).toBeGreaterThan(0);
  });

  it("parses full-featured-template.json without errors", () => {
    const raw = loadFixture("full-featured-template.json");
    const doc = fromJson(raw, catalog);
    expect(doc.kind).toBe("template");
  });

  it("minimal-bulletin: toJson -> canonicalStringify is byte-stable on re-parse", () => {
    const raw = loadFixture("minimal-bulletin.json");
    const rawStr = canonicalStringify(raw as Record<string, unknown>);

    const doc = fromJson(raw, catalog);
    const json = toJson(doc);
    const roundTrip = canonicalStringify(json);

    expect(roundTrip).toBe(rawStr);
  });

  it("full-featured-bulletin: toJson -> canonicalStringify is byte-stable on re-parse", () => {
    const raw = loadFixture("full-featured-bulletin.json");
    const rawStr = canonicalStringify(raw as Record<string, unknown>);

    const doc = fromJson(raw, catalog);
    const json = toJson(doc);
    const roundTrip = canonicalStringify(json);

    expect(roundTrip).toBe(rawStr);
  });

  it("full-featured-template: toJson -> canonicalStringify is byte-stable on re-parse", () => {
    const raw = loadFixture("full-featured-template.json");
    const rawStr = canonicalStringify(raw as Record<string, unknown>);

    const doc = fromJson(raw, catalog);
    const json = toJson(doc);
    const roundTrip = canonicalStringify(json);

    expect(roundTrip).toBe(rawStr);
  });

  it("throws DocumentValidationError on missing version", () => {
    const bad = { kind: "bulletin", name: "Bad", page: { typstWidth: "7in", typstHeight: "8.5in" }, elements: [] };
    expect(() => fromJson(bad, catalog)).toThrow(DocumentValidationError);
  });

  it("throws DocumentValidationError on invalid kind", () => {
    const bad = { version: 1, kind: "draft", name: "Bad", page: { typstWidth: "7in", typstHeight: "8.5in" }, elements: [] };
    expect(() => fromJson(bad, catalog)).toThrow(DocumentValidationError);
  });

  it("DocumentValidationError includes structured errors", () => {
    const bad = { version: 1, kind: "draft", name: "X", page: { typstWidth: "7in", typstHeight: "8.5in" }, elements: [] };
    let err: DocumentValidationError | undefined;
    try {
      fromJson(bad, catalog);
    } catch (e) {
      if (e instanceof DocumentValidationError) err = e;
    }
    expect(err).toBeDefined();
    expect(err!.errors.length).toBeGreaterThan(0);
    expect(err!.errors[0].message).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 2. Tree operations — findById, buildParentMap, collectAllNodeIds, countNodes
// ---------------------------------------------------------------------------

describe("tree operations", () => {
  let doc: CbbDocument;

  beforeAll(() => {
    doc = fromJson(loadFixture("full-featured-bulletin.json"), catalog);
  });

  it("findById finds a top-level body element", () => {
    const ref = findById(doc, "titleText1");
    expect(ref).toBeDefined();
    expect(ref!.id).toBe("titleText1");
    expect(ref!.location.kind).toBe("bodyElement");
  });

  it("findById finds a nested grid child element", () => {
    const ref = findById(doc, "gridChildText1");
    expect(ref).toBeDefined();
    expect(ref!.location.kind).toBe("gridChild");
  });

  it("findById finds a grid wrapper", () => {
    const ref = findById(doc, "gridWrap1");
    expect(ref).toBeDefined();
    expect(ref!.location.kind).toBe("gridWrapper");
  });

  it("findById finds a stack child element", () => {
    const ref = findById(doc, "stackChild1");
    expect(ref).toBeDefined();
    expect(ref!.location.kind).toBe("stackChild");
  });

  it("findById finds a canvas child element", () => {
    const ref = findById(doc, "canvasChild1");
    expect(ref).toBeDefined();
    expect(ref!.location.kind).toBe("canvasChild");
  });

  it("findById finds a page-level wrapper", () => {
    const ref = findById(doc, "pageFooter1");
    expect(ref).toBeDefined();
    expect(ref!.location.kind).toBe("pageLevelWrapper");
  });

  it("findById finds a page-level wrapper's inner element", () => {
    const ref = findById(doc, "footerText1");
    expect(ref).toBeDefined();
    expect(ref!.location.kind).toBe("pageElementChild");
  });

  it("findById returns undefined for a nonexistent id", () => {
    const ref = findById(doc, "nonexistent_xyz");
    expect(ref).toBeUndefined();
  });

  it("buildParentMap maps nested elements to correct parents", () => {
    const map = buildParentMap(doc);

    // Grid child wrapper -> grid element
    expect(map.get("gridWrap1")).toBe("gridEl1");
    // Grid child element -> grid wrapper
    expect(map.get("gridChildText1")).toBe("gridWrap1");
    // Stack wrapper -> stack element
    expect(map.get("stackWrap1")).toBe("stackEl1");
    // Stack child -> stack wrapper
    expect(map.get("stackChild1")).toBe("stackWrap1");
    // Canvas wrapper -> canvas element
    expect(map.get("canvasWrap1")).toBe("canvasEl1");
    // Canvas child -> canvas wrapper
    expect(map.get("canvasChild1")).toBe("canvasWrap1");
    // Page-level element inner -> wrapper
    expect(map.get("footerText1")).toBe("pageFooter1");
    // Top-level body elements have no parent
    expect(map.get("titleText1")).toBeUndefined();
  });

  it("collectAllNodeIds returns all expected ids", () => {
    const ids = collectAllNodeIds(doc);

    // Body elements
    expect(ids.has("titleText1")).toBe(true);
    expect(ids.has("dateEl1")).toBe(true);
    expect(ids.has("hymnEl1")).toBe(true);
    // Grid structure
    expect(ids.has("gridEl1")).toBe(true);
    expect(ids.has("gridWrap1")).toBe(true);
    expect(ids.has("gridChildText1")).toBe(true);
    // Stack structure
    expect(ids.has("stackEl1")).toBe(true);
    expect(ids.has("stackWrap1")).toBe(true);
    expect(ids.has("stackChild1")).toBe(true);
    // Canvas structure
    expect(ids.has("canvasEl1")).toBe(true);
    expect(ids.has("canvasWrap1")).toBe(true);
    expect(ids.has("canvasChild1")).toBe(true);
    // Page elements
    expect(ids.has("pageFooter1")).toBe(true);
    expect(ids.has("footerText1")).toBe(true);
  });

  it("countNodes returns a positive integer >= body element count", () => {
    const count = countNodes(doc);
    expect(count).toBeGreaterThanOrEqual(doc.elements.length);
  });

  it("countNodes is consistent with collectAllNodeIds size", () => {
    const count = countNodes(doc);
    const ids = collectAllNodeIds(doc);
    expect(count).toBe(ids.size);
  });

  it("findDuplicateNodeId returns undefined when all ids are unique", () => {
    expect(findDuplicateNodeId(doc)).toBeUndefined();
  });

  it("maxContainerDepth on flat document is 0", () => {
    const flat = fromJson(loadFixture("minimal-bulletin.json"), catalog);
    expect(maxContainerDepth(flat.elements)).toBe(0);
  });

  it("maxContainerDepth on document with grid is >= 1", () => {
    expect(maxContainerDepth(doc.elements)).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 3. insertElement / removeElement / moveElement
// ---------------------------------------------------------------------------

describe("insertElement", () => {
  it("inserts at index 0 prepends", () => {
    const raw = loadFixture("minimal-bulletin.json");
    const doc = fromJson(raw, catalog);
    const newEl: TextElement = {
      id: "newText",
      type: "text",
      name: "New",
      data: { content: { kind: "plain", text: "Hello" } },
    };
    const next = insertElement(doc, newEl, 0);
    expect(next.elements[0].id).toBe("newText");
  });

  it("inserts at end when index > length", () => {
    const raw = loadFixture("minimal-bulletin.json");
    const doc = fromJson(raw, catalog);
    const newEl: TextElement = {
      id: "newText2",
      type: "text",
      name: "New2",
      data: { content: { kind: "plain", text: "World" } },
    };
    const next = insertElement(doc, newEl, 999);
    expect(next.elements[next.elements.length - 1].id).toBe("newText2");
  });

  it("does not mutate the original document", () => {
    const raw = loadFixture("minimal-bulletin.json");
    const doc = fromJson(raw, catalog);
    const origLen = doc.elements.length;
    const newEl: TextElement = {
      id: "immutableTest",
      type: "text",
      name: "Immutable",
      data: { content: { kind: "plain", text: "X" } },
    };
    insertElement(doc, newEl, 0);
    expect(doc.elements.length).toBe(origLen);
  });

  it("throws on id collision", () => {
    const raw = loadFixture("full-featured-bulletin.json");
    const doc = fromJson(raw, catalog);
    const colliding: TextElement = {
      id: "titleText1", // already exists
      type: "text",
      name: "Collision",
      data: { content: { kind: "plain", text: "x" } },
    };
    expect(() => insertElement(doc, colliding, 0)).toThrow(/collision/i);
  });
});

describe("removeElement", () => {
  it("removes a body element by id", () => {
    const raw = loadFixture("full-featured-bulletin.json");
    const doc = fromJson(raw, catalog);
    const origLen = doc.elements.length;
    const next = removeElement(doc, "titleText1");
    expect(next.elements.length).toBe(origLen - 1);
    expect(next.elements.find((e) => e.id === "titleText1")).toBeUndefined();
  });

  it("does not mutate the original", () => {
    const raw = loadFixture("full-featured-bulletin.json");
    const doc = fromJson(raw, catalog);
    const origLen = doc.elements.length;
    removeElement(doc, "titleText1");
    expect(doc.elements.length).toBe(origLen);
  });

  it("throws when id is not in body elements", () => {
    const raw = loadFixture("full-featured-bulletin.json");
    const doc = fromJson(raw, catalog);
    // gridChildText1 is nested, not a direct body element
    expect(() => removeElement(doc, "gridChildText1")).toThrow(/not found/i);
  });
});

describe("moveElement", () => {
  it("moves an element from index 0 to index 1", () => {
    const raw = loadFixture("full-featured-bulletin.json");
    const doc = fromJson(raw, catalog);
    const firstId = doc.elements[0].id;
    const secondId = doc.elements[1].id;

    const next = moveElement(doc, 0, 1);
    expect(next.elements[0].id).toBe(secondId);
    expect(next.elements[1].id).toBe(firstId);
  });

  it("is a no-op when fromIndex === toIndex", () => {
    const raw = loadFixture("full-featured-bulletin.json");
    const doc = fromJson(raw, catalog);
    const origIds = doc.elements.map((e) => e.id);
    const next = moveElement(doc, 0, 0);
    expect(next.elements.map((e) => e.id)).toEqual(origIds);
  });

  it("clamps out-of-bound indices", () => {
    const raw = loadFixture("full-featured-bulletin.json");
    const doc = fromJson(raw, catalog);
    const len = doc.elements.length;
    const lastId = doc.elements[len - 1].id;
    // Moving index 0 to 9999 should land it at the end
    const next = moveElement(doc, 0, 9999);
    expect(next.elements[next.elements.length - 1].id).toBe(doc.elements[0].id);
    expect(next.elements.length).toBe(len);
    // Original last element moves to index len-2
    expect(next.elements[len - 2].id).toBe(lastId);
  });
});

// ---------------------------------------------------------------------------
// 4. Collision re-mint determinism with sequential IdPort
// ---------------------------------------------------------------------------

describe("remintIds", () => {
  it("produces stable new ids with sequential IdPort", () => {
    const raw = loadFixture("full-featured-bulletin.json");
    const doc = fromJson(raw, catalog);
    const existingIds = collectAllNodeIds(doc) as Set<string>;

    const textEl = doc.elements.find((e) => e.id === "titleText1") as TextElement;
    expect(textEl).toBeDefined();

    // Use forceRemint=true to always generate fresh ids
    const port1 = makeSequentialIdPort(0);
    const reminted1 = remintIds(textEl, existingIds, port1, true);

    const port2 = makeSequentialIdPort(0);
    const reminted2 = remintIds(textEl, existingIds, port2, true);

    // Same starting state -> same deterministic output
    expect(reminted1.id).toBe(reminted2.id);
    expect(reminted1.id).not.toBe(textEl.id);
  });

  it("does not re-mint ids that have no collision", () => {
    const raw = loadFixture("minimal-bulletin.json");
    const doc = fromJson(raw, catalog);

    // A brand-new element with a unique id
    const newEl: TextElement = {
      id: "uniqueNewId",
      type: "text",
      name: "New",
      data: { content: { kind: "plain", text: "x" } },
    };

    const port = makeSequentialIdPort(0);
    // existingIds does NOT contain "uniqueNewId"
    const result = remintIds(newEl, collectAllNodeIds(doc), port, false);
    expect(result.id).toBe("uniqueNewId");
  });

  it("re-mints colliding ids in a container (grid)", () => {
    const raw = loadFixture("full-featured-bulletin.json");
    const doc = fromJson(raw, catalog);
    const existing = collectAllNodeIds(doc) as Set<string>;

    const gridEl = doc.elements.find((e) => e.type === "grid") as GridElement;
    expect(gridEl).toBeDefined();

    const port = makeSequentialIdPort(0);
    // forceRemint=false: only collisions get new ids. Since all these ids ARE
    // in existingIds, they must all be replaced.
    const reminted = remintIds(gridEl, existing, port, false) as GridElement;

    // Grid root must have a new id (old id was in existingIds)
    expect(reminted.id).not.toBe(gridEl.id);
    // Wrappers must also have new ids
    for (let i = 0; i < reminted.children.length; i++) {
      expect(reminted.children[i].id).not.toBe(gridEl.children[i].id);
      // Child elements must have new ids too
      expect(reminted.children[i].element.id).not.toBe(
        gridEl.children[i].element.id
      );
    }
  });

  it("preserves non-id element data after reminting", () => {
    const raw = loadFixture("full-featured-bulletin.json");
    const doc = fromJson(raw, catalog);
    const existing = collectAllNodeIds(doc) as Set<string>;

    const textEl = doc.elements.find((e) => e.id === "titleText1") as TextElement;
    const port = makeSequentialIdPort(0);
    const reminted = remintIds(textEl, existing, port, true) as TextElement;

    expect(reminted.name).toBe(textEl.name);
    expect(reminted.data).toEqual(textEl.data);
  });

  it("forceRemint=true generates new ids for every node regardless of collision", () => {
    const raw = loadFixture("minimal-bulletin.json");
    const doc = fromJson(raw, catalog);

    const textEl: TextElement = {
      id: "absolutelyUniqueId",
      type: "text",
      name: "Unique",
      data: { content: { kind: "plain", text: "x" } },
    };

    const port = makeSequentialIdPort(0);
    // Even though "absolutelyUniqueId" is not in the existing set, forceRemint
    // should still mint a new id
    const result = remintIds(textEl, new Set<string>(), port, true);
    expect(result.id).not.toBe("absolutelyUniqueId");
  });
});

// ---------------------------------------------------------------------------
// 5. Classification exhaustiveness
// ---------------------------------------------------------------------------

describe("field classification exhaustiveness", () => {
  it("DOCUMENT_FIELD_CLASSIFICATIONS covers all document schema top-level properties", () => {
    const catalog2 = createFieldClassificationCatalog();
    registerDocumentClassifications(catalog2);

    // Document schema top-level properties
    const docProperties = [
      "version", "kind", "name", "metadata", "page",
      "authoringPolicy", "fontFallbackRefs", "scripturePresentation",
      "rightsPolicy", "publicationContexts",
      "fieldContract", "fieldValues", "fieldReview",
      "contentRules", "contentReview",
      "elements", "pageElements",
      "sampleFieldValues", "sourceTemplate",
      "customElementDefinitions", "orphanedFieldValues",
    ];

    const report = catalog2.checkExhaustiveness(
      DOCUMENT_CLASSIFICATION_SCHEMA_ID,
      docProperties
    );

    expect(report.unclassified).toHaveLength(0);
    expect(report.classified.sort()).toEqual([...docProperties].sort());
  });

  it("ELEMENT_FIELD_CLASSIFICATIONS covers all base element fields", () => {
    const catalog2 = createFieldClassificationCatalog();
    registerDocumentClassifications(catalog2);

    const elementProperties = [
      "id", "type", "name", "width", "height", "breakPolicy",
      "margin", "padding", "style",
      "fieldContract", "fieldValues", "bindings",
      "authoringPolicy", "weeklyReview",
      "data", "children",
    ];

    const report = catalog2.checkExhaustiveness(
      ELEMENT_CLASSIFICATION_SCHEMA_ID,
      elementProperties
    );

    expect(report.unclassified).toHaveLength(0);
  });

  it("document fields are classified correctly", () => {
    const catalog2 = createFieldClassificationCatalog();
    registerDocumentClassifications(catalog2);

    expect(catalog2.classificationFor(DOCUMENT_CLASSIFICATION_SCHEMA_ID, "elements")).toBe("renderAffecting");
    expect(catalog2.classificationFor(DOCUMENT_CLASSIFICATION_SCHEMA_ID, "fieldReview")).toBe("readinessOnly");
    expect(catalog2.classificationFor(DOCUMENT_CLASSIFICATION_SCHEMA_ID, "authoringPolicy")).toBe("inert");
    expect(catalog2.classificationFor(DOCUMENT_CLASSIFICATION_SCHEMA_ID, "orphanedFieldValues")).toBe("inert");
    expect(catalog2.classificationFor(DOCUMENT_CLASSIFICATION_SCHEMA_ID, "contentRules")).toBe("renderAffecting");
    expect(catalog2.classificationFor(DOCUMENT_CLASSIFICATION_SCHEMA_ID, "publicationContexts")).toBe("readinessOnly");
    expect(catalog2.classificationFor(DOCUMENT_CLASSIFICATION_SCHEMA_ID, "rightsPolicy")).toBe("readinessOnly");
  });

  it("element fields are classified correctly", () => {
    const catalog2 = createFieldClassificationCatalog();
    registerDocumentClassifications(catalog2);

    expect(catalog2.classificationFor(ELEMENT_CLASSIFICATION_SCHEMA_ID, "data")).toBe("renderAffecting");
    expect(catalog2.classificationFor(ELEMENT_CLASSIFICATION_SCHEMA_ID, "style")).toBe("renderAffecting");
    expect(catalog2.classificationFor(ELEMENT_CLASSIFICATION_SCHEMA_ID, "authoringPolicy")).toBe("inert");
    expect(catalog2.classificationFor(ELEMENT_CLASSIFICATION_SCHEMA_ID, "weeklyReview")).toBe("readinessOnly");
    expect(catalog2.classificationFor(ELEMENT_CLASSIFICATION_SCHEMA_ID, "id")).toBe("inert");
    expect(catalog2.classificationFor(ELEMENT_CLASSIFICATION_SCHEMA_ID, "name")).toBe("inert");
  });

  it("throws on duplicate registration", () => {
    const catalog2 = createFieldClassificationCatalog();
    registerDocumentClassifications(catalog2);
    // Second registration must throw
    expect(() => registerDocumentClassifications(catalog2)).toThrow(
      /already registered/i
    );
  });

  it("DOCUMENT_FIELD_CLASSIFICATIONS has only valid classification values", () => {
    for (const entry of DOCUMENT_FIELD_CLASSIFICATIONS) {
      expect(["renderAffecting", "readinessOnly", "inert"]).toContain(
        entry.classification
      );
    }
  });

  it("ELEMENT_FIELD_CLASSIFICATIONS has only valid classification values", () => {
    for (const entry of ELEMENT_FIELD_CLASSIFICATIONS) {
      expect(["renderAffecting", "readinessOnly", "inert"]).toContain(
        entry.classification
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Limits enforcement
// ---------------------------------------------------------------------------

describe("node count limits", () => {
  it("checkNodeLimit returns ok for valid documents", () => {
    const doc = fromJson(loadFixture("full-featured-bulletin.json"), catalog);
    expect(checkNodeLimit(doc)).toEqual({ ok: true });
  });

  it("DOCUMENT_LIMITS has expected caps", () => {
    expect(DOCUMENT_LIMITS.PERSISTED_VISUAL_NODES_CAP).toBe(20_000);
    expect(DOCUMENT_LIMITS.PERSISTED_VISUAL_NODES_WARN).toBe(5_000);
    expect(DOCUMENT_LIMITS.CONTAINER_NESTING_DEPTH_CAP).toBe(32);
    expect(DOCUMENT_LIMITS.EXPANDED_RENDER_NODES_CAP).toBe(50_000);
  });

  it("checkContainerDepth returns ok for valid documents", () => {
    const doc = fromJson(loadFixture("full-featured-bulletin.json"), catalog);
    expect(checkContainerDepth(doc)).toEqual({ ok: true });
  });

  it("insertElement throws when adding a subtree would exceed the cap", () => {
    // Build a document that is exactly at the cap by constructing a big element array
    const raw = loadFixture("minimal-bulletin.json");
    const doc = fromJson(raw, catalog);

    // Build a doc with close-to-cap elements by creating many simple text elements
    let bigDoc = doc;
    for (let i = 0; i < DOCUMENT_LIMITS.PERSISTED_VISUAL_NODES_CAP; i++) {
      bigDoc = {
        ...bigDoc,
        elements: [
          ...bigDoc.elements,
          {
            id: `autoEl${i}`,
            type: "text",
            name: `Auto ${i}`,
            data: { content: { kind: "plain", text: `Text ${i}` } },
          } as NativeElement,
        ],
      };
    }

    // Now bigDoc has > cap elements; checkNodeLimit should fail
    const limitResult = checkNodeLimit(bigDoc);
    expect(limitResult.ok).toBe(false);

    // insertElement must also throw
    const extraEl: TextElement = {
      id: "extraElAfterCap",
      type: "text",
      name: "Extra",
      data: { content: { kind: "plain", text: "x" } },
    };

    expect(() => insertElement(bigDoc, extraEl, 0)).toThrow(/cap/i);
  });
});

describe("container depth limits", () => {
  it("maxContainerDepth returns 0 for no containers", () => {
    const doc = fromJson(loadFixture("minimal-bulletin.json"), catalog);
    expect(maxContainerDepth(doc.elements)).toBe(0);
  });

  it("maxContainerDepth returns correct depth for nested containers", () => {
    // Build grid(stack(text)) to get depth 2
    const inner: TextElement = {
      id: "deepText",
      type: "text",
      name: "Deep",
      data: { content: { kind: "plain", text: "x" } },
    };
    const stack: StackElement = {
      id: "deepStack",
      type: "stack",
      name: "Stack",
      data: { direction: "vertical", gap: "0.5in" },
      children: [{ id: "swrap1", index: 0, element: inner }],
    };
    const grid: GridElement = {
      id: "deepGrid",
      type: "grid",
      name: "Grid",
      data: { rows: 1, columns: 1 },
      children: [{ id: "gwrap1", row: 0, column: 0, element: stack }],
    };

    expect(maxContainerDepth([grid])).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 7. Downstream contract type constructors
// ---------------------------------------------------------------------------

describe("resolved type constructors", () => {
  it("makeDirectResolvedNode produces correct resolvedId and provenance", () => {
    const el: TextElement = {
      id: "testEl",
      type: "text",
      name: "T",
      data: { content: { kind: "plain", text: "hi" } },
    };
    const node = makeDirectResolvedNode(el);
    expect(node.resolvedId).toBe("testEl");
    expect(node.provenance.kind).toBe("direct");
    if (node.provenance.kind === "direct") {
      expect(node.provenance.sourceElementId).toBe("testEl");
    }
    expect(node.element).toBe(el);
  });

  it("makeRepeatResolvedNode produces composite resolvedId", () => {
    const el: TextElement = {
      id: "proto1",
      type: "text",
      name: "P",
      data: { content: { kind: "plain", text: "x" } },
    };
    const node = makeRepeatResolvedNode("ruleA", "uuid-1", 0, el);
    expect(node.resolvedId).toBe("ruleA/uuid-1/proto1");
    expect(node.provenance.kind).toBe("repeatExpansion");
    if (node.provenance.kind === "repeatExpansion") {
      expect(node.provenance.ruleId).toBe("ruleA");
      expect(node.provenance.itemId).toBe("uuid-1");
      expect(node.provenance.itemIndex).toBe(0);
      expect(node.provenance.sourceElementId).toBe("proto1");
    }
  });

  it("makeCustomResolvedNode produces composite resolvedId", () => {
    const el: TextElement = {
      id: "defEl1",
      type: "text",
      name: "D",
      data: { content: { kind: "plain", text: "y" } },
    };
    const node = makeCustomResolvedNode("ownerInst1", el);
    expect(node.resolvedId).toBe("ownerInst1/defEl1");
    expect(node.provenance.kind).toBe("customExpansion");
    if (node.provenance.kind === "customExpansion") {
      expect(node.provenance.ownerInstanceId).toBe("ownerInst1");
      expect(node.provenance.definitionNodeId).toBe("defEl1");
    }
  });

  it("makeEmptyResolvedRenderTree produces empty tree", () => {
    const tree = makeEmptyResolvedRenderTree();
    expect(tree.elements).toHaveLength(0);
    expect(tree.pageElements).toHaveLength(0);
    expect(tree.totalNodeCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 8. findDuplicateNodeId — invariant checking
// ---------------------------------------------------------------------------

describe("findDuplicateNodeId", () => {
  it("returns undefined on full-featured-bulletin (all ids unique)", () => {
    const doc = fromJson(loadFixture("full-featured-bulletin.json"), catalog);
    expect(findDuplicateNodeId(doc)).toBeUndefined();
  });

  it("detects a duplicate id injected into body elements", () => {
    const doc = fromJson(loadFixture("full-featured-bulletin.json"), catalog);
    // Manually inject a duplicate id (bypassing validation)
    const dup: TextElement = {
      id: "titleText1", // duplicate of existing body element
      type: "text",
      name: "Dup",
      data: { content: { kind: "plain", text: "dup" } },
    };
    const tamperedDoc: CbbDocument = {
      ...doc,
      elements: [...doc.elements, dup],
    };
    expect(findDuplicateNodeId(tamperedDoc)).toBe("titleText1");
  });
});

// ---------------------------------------------------------------------------
// 9. Stack and Canvas tree ops (additional coverage)
// ---------------------------------------------------------------------------

describe("stack and canvas tree operations", () => {
  it("buildParentMap correctly maps stack wrapper -> stack element", () => {
    const doc = fromJson(loadFixture("full-featured-bulletin.json"), catalog);
    const map = buildParentMap(doc);
    // stackWrap1's parent should be stackEl1
    expect(map.get("stackWrap1")).toBe("stackEl1");
    // stackWrap2's parent should be stackEl1
    expect(map.get("stackWrap2")).toBe("stackEl1");
    // stackChild2's parent should be stackWrap2
    expect(map.get("stackChild2")).toBe("stackWrap2");
  });

  it("buildParentMap correctly maps canvas wrapper -> canvas element", () => {
    const doc = fromJson(loadFixture("full-featured-bulletin.json"), catalog);
    const map = buildParentMap(doc);
    expect(map.get("canvasWrap1")).toBe("canvasEl1");
    expect(map.get("canvasChild1")).toBe("canvasWrap1");
  });

  it("findById returns correct location for canvas wrapper", () => {
    const doc = fromJson(loadFixture("full-featured-bulletin.json"), catalog);
    const ref = findById(doc, "canvasWrap1");
    expect(ref).toBeDefined();
    expect(ref!.location.kind).toBe("canvasWrapper");
    if (ref!.location.kind === "canvasWrapper") {
      expect(ref!.location.parentId).toBe("canvasEl1");
    }
  });

  it("findById returns correct location for stack wrapper", () => {
    const doc = fromJson(loadFixture("full-featured-bulletin.json"), catalog);
    const ref = findById(doc, "stackWrap1");
    expect(ref).toBeDefined();
    expect(ref!.location.kind).toBe("stackWrapper");
    if (ref!.location.kind === "stackWrapper") {
      expect(ref!.location.parentId).toBe("stackEl1");
    }
  });
});
