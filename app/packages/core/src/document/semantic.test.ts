import { describe, expect, it } from "vitest";

import type {
  CbbDocument,
  CustomElementDefinition,
  FieldContract,
  FieldDefinition,
  NativeElement,
  PageLevelWrapper,
  TextElement,
} from "./types.js";
import { DOCUMENT_LIMITS } from "./types.js";
import { validateDocumentSemantics } from "./semantic.js";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const HASH = `sha256:${"a".repeat(64)}`;

function text(id: string, value = id): TextElement {
  return {
    id,
    type: "text",
    name: id,
    data: { content: { kind: "plain", text: value } },
  };
}

function contract(
  fields: readonly FieldDefinition[],
  overrides: Partial<FieldContract> = {},
): FieldContract {
  return {
    id: UUID_A,
    version: 1,
    name: "Fields",
    fields,
    ...overrides,
  };
}

function document(overrides: Partial<CbbDocument> = {}): CbbDocument {
  return {
    version: 1,
    kind: "bulletin",
    name: "Semantic test",
    page: { typstWidth: "8.5in", typstHeight: "11in" },
    elements: [],
    ...overrides,
  };
}

function placement(
  id: string,
  overrides: Partial<PageLevelWrapper> = {},
): PageLevelWrapper {
  return {
    id,
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
    element: text(`${id}Text`),
    ...overrides,
  };
}

function codes(doc: CbbDocument): readonly string[] {
  return validateDocumentSemantics(doc).findings.map((finding) => finding.code);
}

describe("validateDocumentSemantics", () => {
  it("accepts a valid document with bindings, rules, custom values, and reviews", () => {
    const docContract = contract([
      { id: "heading", label: "Heading", type: "text", required: true },
      { id: "enabled", label: "Enabled", type: "boolean", required: true },
      {
        id: "items",
        label: "Items",
        type: "array",
        required: true,
        constraints: { maxItems: 3 },
        itemField: { id: "item", label: "Item", type: "text", required: true },
      },
    ]);
    const definition: CustomElementDefinition = {
      version: 1,
      kind: "customElementDefinition",
      id: "calloutDefinition",
      name: "Callout",
      fieldContract: contract(
        [{ id: "label", label: "Label", type: "text", required: true }],
        { id: UUID_B, name: "Callout fields" },
      ),
      elements: [
        {
          ...text("calloutLabel"),
          bindings: [
            {
              id: "calloutLabelBinding",
              scope: "local",
              fieldId: "label",
              target: "/data/content/text",
            },
          ],
        },
      ],
      sampleFieldValues: { label: { value: "Preview", origin: "manual" } },
    };
    const boundHeading: TextElement = {
      ...text("boundHeading"),
      bindings: [
        {
          id: "headingBinding",
          scope: "document",
          fieldId: "heading",
          target: "/data/content/text",
        },
      ],
    };
    const customInstance: NativeElement = {
      id: "calloutInstance",
      type: "customInstance",
      name: "Callout",
      definitionId: "calloutDefinition",
      fieldValues: { label: { value: "Welcome", origin: "manual" } },
    };
    const doc = document({
      fieldContract: docContract,
      fieldValues: {
        heading: { value: "Worship", origin: "manual" },
        enabled: { value: true, origin: "manual" },
        items: { value: ["One"], origin: "manual", itemIds: [UUID_A] },
      },
      elements: [
        boundHeading,
        text("conditionalTarget"),
        text("repeatPrototype"),
        customInstance,
        {
          id: "directPageBreak",
          type: "pageBreak",
          name: "Break",
          data: { intent: "flowBreak" },
        },
      ],
      contentRules: [
        {
          kind: "conditional",
          id: "conditionalRule",
          targetNodeId: "conditionalTarget",
          scope: "document",
          fieldId: "enabled",
          condition: { kind: "booleanEquals", value: true },
          activateLabel: "Show",
          inactiveLabel: "Hide",
        },
        {
          kind: "repeat",
          id: "repeatRule",
          fieldId: "items",
          prototypeNodeId: "repeatPrototype",
          itemBindings: [
            {
              id: "itemBinding",
              itemPath: "",
              targetNodeId: "repeatPrototype",
              target: "/data/content/text",
            },
          ],
          emptyState: { mode: "collapse" },
          maxItems: 3,
          userReorderable: true,
          itemLabel: "Item",
          addLabel: "Add item",
        },
      ],
      customElementDefinitions: [definition],
      pageElements: [placement("footerPlacement")],
      fieldReview: [
        {
          target: { scope: "local", ownerNodeId: "calloutInstance", fieldId: "label" },
          disposition: "edited",
          reviewHash: HASH,
        },
      ],
      contentReview: [
        {
          target: {
            scope: "custom",
            ownerNodeId: "calloutInstance",
            definitionNodeId: "calloutDefinition",
          },
          disposition: "edited",
          reviewHash: HASH,
        },
      ],
    });
    const before = JSON.stringify(doc);

    expect(validateDocumentSemantics(doc)).toEqual({ valid: true, findings: [] });
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("enforces the global visual-node namespace, all-root depth, and page-break topology", () => {
    let nested: NativeElement = {
      id: "nestedBreak",
      type: "pageBreak",
      name: "Nested break",
      data: {},
    };
    for (let depth = 0; depth <= DOCUMENT_LIMITS.CONTAINER_NESTING_DEPTH_CAP; depth++) {
      nested = {
        id: `deepStack${depth}`,
        type: "stack",
        name: `Stack ${depth}`,
        data: { direction: "vertical", gap: "0pt" },
        children: [{ id: `deepWrapper${depth}`, index: 0, element: nested }],
      };
    }
    const definition: CustomElementDefinition = {
      version: 1,
      kind: "customElementDefinition",
      id: "deepDefinition",
      name: "Deep",
      fieldContract: contract([]),
      elements: [nested, text("sharedNode")],
    };
    const invalidDocument = document({
      elements: [text("sharedNode")],
      customElementDefinitions: [definition],
    });
    const result = validateDocumentSemantics(invalidDocument);

    expect(result.valid).toBe(false);
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "CBB-DOC-0100", instancePath: "/customElementDefinitions/0/elements/1/id" }),
      expect.objectContaining({ code: "CBB-LAYOUT-0100" }),
      expect.objectContaining({ code: "CBB-LAYOUT-0101" }),
    ]));
  });

  it("counts embedded definition trees against the persisted-node hard cap", () => {
    const definition: CustomElementDefinition = {
      version: 1,
      kind: "customElementDefinition",
      id: "largeDefinition",
      name: "Large",
      fieldContract: contract([]),
      elements: Array.from(
        { length: DOCUMENT_LIMITS.PERSISTED_VISUAL_NODES_CAP },
        (_, index) => text(`largeNode${index}`),
      ),
    };

    expect(codes(document({ customElementDefinitions: [definition] }))).toContain("CBB-DOC-0101");
  });

  it("accumulates stack, grid, semantic-table, and canvas violations", () => {
    const stack: NativeElement = {
      id: "badStack",
      type: "stack",
      name: "Bad stack",
      data: { direction: "vertical", gap: "0pt" },
      children: [{ id: "badStackWrapper", index: 4, element: text("stackChild") }],
    };
    const table: NativeElement = {
      id: "badTable",
      type: "grid",
      name: "Bad table",
      data: {
        rows: 2,
        columns: 2,
        rowTracks: ["1fr"],
        semanticRole: "table",
        tableSemantics: { summary: "Summary", headerRows: 3, headerColumns: 0 },
      },
      children: [
        { id: "tableWrapA", row: 0, column: 0, element: text("tableA") },
        { id: "tableWrapB", row: 0, column: 0, element: text("tableB") },
      ],
    };
    const boundsGrid: NativeElement = {
      id: "boundsGrid",
      type: "grid",
      name: "Bounds",
      data: { rows: 1, columns: 1 },
      children: [{ id: "boundsWrap", row: 1, column: 0, element: text("boundsChild") }],
    };
    const canvas: NativeElement = {
      id: "badCanvas",
      type: "canvas",
      name: "Bad canvas",
      children: [
        { id: "canvasWrapA", x: 0, y: 0, semanticOrder: 0, element: text("canvasA") },
        { id: "canvasWrapB", x: 0, y: 0, element: text("canvasB") },
        { id: "canvasWrapC", x: 0, y: 0, semanticOrder: 0, element: text("canvasC") },
      ],
    };
    const result = validateDocumentSemantics(document({ elements: [stack, table, boundsGrid, canvas] }));

    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "CBB-LAYOUT-0102", instancePath: "/elements/0/children/0/index" }),
      expect.objectContaining({ code: "CBB-LAYOUT-0103", instancePath: "/elements/1/children/1" }),
      expect.objectContaining({ code: "CBB-LAYOUT-0103", instancePath: "/elements/1/children" }),
      expect.objectContaining({ code: "CBB-LAYOUT-0103", instancePath: "/elements/2/children/0" }),
      expect.objectContaining({ code: "CBB-LAYOUT-0104", instancePath: "/elements/3/children" }),
      expect.objectContaining({ code: "CBB-LAYOUT-0104", instancePath: "/elements/3/children/2/semanticOrder" }),
    ]));
  });

  it("validates page target order, purpose placement, and overlapping content order", () => {
    const contentSemantic = { mode: "content", readingOrder: "beforeBody", order: 0 } as const;
    const pageElements: PageLevelWrapper[] = [
      placement("contentHeaderA", {
        purpose: "header",
        target: { mode: "first" },
        region: "topMargin",
        semantic: contentSemantic,
      }),
      placement("contentHeaderB", {
        purpose: "header",
        target: { mode: "pages", pages: [1] },
        region: "topMargin",
        semantic: contentSemantic,
      }),
      placement("contentHeaderC", {
        purpose: "header",
        target: { mode: "pages", pages: [2] },
        region: "topMargin",
        semantic: contentSemantic,
      }),
      placement("badBackground", {
        purpose: "background",
        target: { mode: "all" },
        region: "content",
        layer: "overlay",
        semantic: contentSemantic,
      }),
      placement("badRange", { target: { mode: "range", start: 4, end: 2 } }),
      placement("badPages", { target: { mode: "pages", pages: [2, 2, 1] } }),
    ];
    const result = validateDocumentSemantics(document({ pageElements }));

    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "CBB-LAYOUT-0105", instancePath: "/pageElements/1/semantic" }),
      expect.objectContaining({ code: "CBB-LAYOUT-0105", instancePath: "/pageElements/3/region" }),
      expect.objectContaining({ code: "CBB-LAYOUT-0105", instancePath: "/pageElements/3/layer" }),
      expect.objectContaining({ code: "CBB-LAYOUT-0105", instancePath: "/pageElements/3/semantic/mode" }),
      expect.objectContaining({ code: "CBB-LAYOUT-0105", instancePath: "/pageElements/3/target" }),
      expect.objectContaining({ code: "CBB-LAYOUT-0105", instancePath: "/pageElements/4/target" }),
      expect.objectContaining({ code: "CBB-LAYOUT-0105", instancePath: "/pageElements/5/target/pages/1" }),
    ]));
    expect(result.findings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ instancePath: "/pageElements/2/semantic" }),
    ]));
  });

  it("rejects missing custom definitions and definition dependency cycles", () => {
    const definitionA: CustomElementDefinition = {
      version: 1,
      kind: "customElementDefinition",
      id: "definitionA",
      name: "A",
      fieldContract: contract([]),
      elements: [
        { id: "useB", type: "customInstance", name: "B", definitionId: "definitionB" },
      ],
    };
    const definitionB: CustomElementDefinition = {
      version: 1,
      kind: "customElementDefinition",
      id: "definitionB",
      name: "B",
      fieldContract: contract([], { id: UUID_B }),
      elements: [
        { id: "useA", type: "customInstance", name: "A", definitionId: "definitionA" },
      ],
    };
    const result = validateDocumentSemantics(document({
      elements: [
        { id: "missingUse", type: "customInstance", name: "Missing", definitionId: "notThere" },
      ],
      customElementDefinitions: [definitionA, definitionB],
    }));

    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "CBB-DOC-0102", instancePath: "/elements/0/definitionId" }),
      expect.objectContaining({ code: "CBB-DOC-0103" }),
    ]));
  });

  it("validates contract identity, semantic roles, values, and stable item ids", () => {
    const fields: FieldDefinition[] = [
      {
        id: "publication",
        label: "Publication",
        type: "date",
        required: true,
        groupId: "missingGroup",
        semanticRole: "publicationDate",
      },
      {
        id: "otherPublication",
        label: "Other",
        type: "text",
        required: false,
        semanticRole: "publicationDate",
      },
      {
        id: "items",
        label: "Items",
        type: "array",
        required: true,
        itemField: { id: "item", label: "Item", type: "text", required: true },
      },
      {
        id: "mode",
        label: "Mode",
        type: "choice",
        required: true,
        constraints: { choices: [{ id: "same", label: "One" }, { id: "same", label: "Two" }] },
      },
      {
        id: "object",
        label: "Object",
        type: "object",
        required: true,
        childFields: [{ id: "child", label: "Child", type: "number", required: true }],
      },
      { id: "publication", label: "Duplicate", type: "date", required: false },
    ];
    const result = validateDocumentSemantics(document({
      fieldContract: contract(fields, {
        groups: [{ id: "group", label: "One" }, { id: "group", label: "Two" }],
      }),
      fieldValues: {
        publication: { value: "2026-02-30", origin: "manual" },
        items: { value: ["A", "B"], origin: "manual", itemIds: [UUID_A, UUID_A] },
        mode: { value: "undeclared", origin: "manual" },
        object: { value: {}, origin: "manual" },
        unknown: { value: true, origin: "manual" },
      },
    }));

    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "CBB-FIELD-0100", instancePath: "/fieldContract/groups/1/id" }),
      expect.objectContaining({ code: "CBB-FIELD-0100", instancePath: "/fieldContract/fields/0/groupId" }),
      expect.objectContaining({ code: "CBB-FIELD-0100", instancePath: "/fieldContract/fields/5/id" }),
      expect.objectContaining({ code: "CBB-FIELD-0101", instancePath: "/fieldValues/publication/value" }),
      expect.objectContaining({ code: "CBB-FIELD-0101", instancePath: "/fieldValues/items/itemIds/1" }),
      expect.objectContaining({ code: "CBB-FIELD-0101", instancePath: "/fieldValues/unknown" }),
    ]));
  });

  it("requires metadata mirrors to match effective top-level semantic-role values", () => {
    const roleContract = contract([
      {
        id: "serviceDate",
        label: "Service date",
        type: "date",
        required: true,
        default: "2026-07-12",
        semanticRole: "publicationDate",
        weeklyBehavior: {
          rolloverPolicy: "clear",
          reviewExpectation: "everyBulletin",
        },
      },
      {
        id: "service",
        label: "Service",
        type: "choice",
        required: true,
        default: "sunday",
        semanticRole: "serviceLabel",
        constraints: {
          choices: [{ id: "sunday", label: "Sunday Worship" }],
        },
      },
    ]);
    const matching = document({
      metadata: {
        publicationDate: "2026-07-12",
        serviceLabel: "Sunday Worship",
      },
      fieldContract: roleContract,
    });
    expect(validateDocumentSemantics(matching)).toEqual({
      valid: true,
      findings: [],
    });

    const mismatched = document({
      metadata: {
        publicationDate: "2026-07-13",
        // A choice mirrors its display label, never its stable stored id.
        serviceLabel: "sunday",
      },
      fieldContract: roleContract,
    });
    expect(validateDocumentSemantics(mismatched).findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "CBB-FIELD-0101",
          instancePath: "/metadata/publicationDate",
        }),
        expect.objectContaining({
          code: "CBB-FIELD-0101",
          instancePath: "/metadata/serviceLabel",
        }),
      ]),
    );
  });

  it("does not promote a binding fallback into a semantic-role metadata mirror", () => {
    const fallbackOnly = document({
      metadata: { publicationDate: "2026-07-12" },
      fieldContract: contract([
        {
          id: "serviceDate",
          label: "Service date",
          type: "date",
          required: true,
          semanticRole: "publicationDate",
          weeklyBehavior: {
            rolloverPolicy: "clear",
            reviewExpectation: "everyBulletin",
          },
        },
      ]),
      elements: [
        {
          id: "boundDate",
          type: "date",
          name: "Bound date",
          bindings: [
            {
              id: "dateBinding",
              scope: "document",
              fieldId: "serviceDate",
              target: "/data/value",
              fallback: "2026-07-12",
            },
          ],
          data: { value: "2026-01-01" },
        },
      ],
    });

    expect(validateDocumentSemantics(fallbackOnly).findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "CBB-FIELD-0101",
          instancePath: "/metadata/publicationDate",
          message: expect.stringContaining("no effective stored/default value"),
        }),
      ]),
    );
  });

  it("validates safe patterns and the complete rich-text field AST", () => {
    const result = validateDocumentSemantics(document({
      fieldContract: contract([
        {
          id: "unsafePattern",
          label: "Unsafe",
          type: "text",
          required: false,
          constraints: { pattern: "(a+)+" },
        },
        {
          id: "unsupportedEscape",
          label: "Unsupported escape",
          type: "text",
          required: false,
          constraints: { pattern: "^\\1$" },
        },
        {
          id: "patterned",
          label: "Patterned",
          type: "text",
          required: false,
          constraints: { pattern: "^[A-Z][a-z]+$" },
          default: "lowercase",
        },
        {
          id: "rich",
          label: "Rich",
          type: "richText",
          required: false,
          default: {
            type: "document",
            blocks: [{ type: "rawTypst", source: "#read(\"secret\")" }],
          },
        },
      ]),
      elements: [],
    }));

    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "CBB-FIELD-0100",
        instancePath: "/fieldContract/fields/0/constraints/pattern",
      }),
      expect.objectContaining({
        code: "CBB-FIELD-0101",
        instancePath: "/fieldContract/fields/2/default",
      }),
      expect.objectContaining({
        code: "CBB-FIELD-0101",
        instancePath: "/fieldContract/fields/3/default",
      }),
      expect.objectContaining({
        code: "CBB-FIELD-0100",
        instancePath: "/fieldContract/fields/1/constraints/pattern",
      }),
    ]));
  });

  it("validates global binding/rule ids, references, compatibility, and rule cycles", () => {
    const fields: FieldDefinition[] = [
      { id: "flag", label: "Flag", type: "text", required: true },
      { id: "title", label: "Title", type: "number", required: true },
      {
        id: "items",
        label: "Items",
        type: "array",
        required: true,
        constraints: { maxItems: 2 },
        itemField: { id: "item", label: "Item", type: "number", required: true },
      },
    ];
    const outer: NativeElement = {
      id: "outer",
      type: "stack",
      name: "Outer",
      data: { direction: "vertical", gap: "0pt" },
      children: [{ id: "innerWrapper", index: 0, element: text("innerPrototype") }],
    };
    const bound: TextElement = {
      ...text("bound"),
      bindings: [
        { id: "sharedBinding", scope: "document", fieldId: "title", target: "/data/content/text" },
        { id: "sharedBinding", scope: "document", fieldId: "missing", target: "/style/color" },
      ],
    };
    const ruleDocument = document({
      fieldContract: contract(fields),
      fieldValues: {
        flag: { value: "yes", origin: "manual" },
        title: { value: 3, origin: "manual" },
        items: { value: [1, 2], origin: "manual" },
      },
      elements: [outer, bound],
      contentRules: [
        {
          kind: "repeat",
          id: "sharedRule",
          fieldId: "items",
          prototypeNodeId: "innerPrototype",
          itemBindings: [
            {
              id: "sharedBinding",
              itemPath: "",
              targetNodeId: "innerPrototype",
              target: "/data/content/text",
            },
          ],
          emptyState: { mode: "show", nodeId: "outer" },
          maxItems: 3,
          userReorderable: true,
          itemLabel: "Item",
          addLabel: "Add",
        },
        {
          kind: "conditional",
          id: "sharedRule",
          targetNodeId: "outer",
          scope: "document",
          fieldId: "flag",
          condition: { kind: "booleanEquals", value: true },
          activateLabel: "Show",
          inactiveLabel: "Hide",
        },
        {
          kind: "conditional",
          id: "otherRule",
          targetNodeId: "outer",
          scope: "document",
          fieldId: "flag",
          condition: { kind: "booleanEquals", value: true },
          activateLabel: "Show",
          inactiveLabel: "Hide",
        },
      ],
    });
    const result = validateDocumentSemantics(ruleDocument);

    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "CBB-FIELD-0102", instancePath: "/elements/1/bindings/0/target" }),
      expect.objectContaining({ code: "CBB-FIELD-0102", instancePath: "/elements/1/bindings/1/id" }),
      expect.objectContaining({ code: "CBB-FIELD-0103", instancePath: "/contentRules/1/id" }),
      expect.objectContaining({ code: "CBB-FIELD-0103", instancePath: "/contentRules/2/targetNodeId" }),
      expect.objectContaining({ code: "CBB-FIELD-0104" }),
      expect.objectContaining({ code: "CBB-FIELD-0101", instancePath: "/fieldValues/items/itemIds" }),
    ]));

    const keys = result.findings.map(
      (finding) => `${finding.instancePath ?? ""}\u0000${finding.code}\u0000${finding.message}`,
    );
    expect(keys).toEqual([...keys].sort());
    expect(validateDocumentSemantics(ruleDocument).findings).toEqual(result.findings);
  });

  it("requires local field-review targets to resolve through the owner contract", () => {
    const owned: TextElement = {
      ...text("owned"),
      fieldContract: contract([{ id: "known", label: "Known", type: "text", required: true }]),
      fieldValues: { known: { value: "yes", origin: "manual" } },
    };
    const definition: CustomElementDefinition = {
      version: 1,
      kind: "customElementDefinition",
      id: "reviewDefinition",
      name: "Review definition",
      fieldContract: contract(
        [{ id: "customKnown", label: "Known", type: "text", required: true }],
        { id: UUID_B },
      ),
      elements: [text("reviewDefinitionText")],
    };
    const result = validateDocumentSemantics(document({
      elements: [
        owned,
        text("unowned"),
        {
          id: "reviewInstance",
          type: "customInstance",
          name: "Review instance",
          definitionId: "reviewDefinition",
        },
      ],
      customElementDefinitions: [definition],
      fieldReview: [
        { target: { scope: "local", ownerNodeId: "owned", fieldId: "known" }, disposition: "edited", reviewHash: HASH },
        { target: { scope: "local", ownerNodeId: "owned", fieldId: "missing" }, disposition: "edited", reviewHash: HASH },
        { target: { scope: "local", ownerNodeId: "unowned", fieldId: "known" }, disposition: "edited", reviewHash: HASH },
        { target: { scope: "local", ownerNodeId: "reviewInstance", fieldId: "customKnown" }, disposition: "edited", reviewHash: HASH },
        { target: { scope: "local", ownerNodeId: "reviewInstance", fieldId: "missing" }, disposition: "edited", reviewHash: HASH },
      ],
    }));

    expect(result.findings.filter((finding) => finding.instancePath?.startsWith("/fieldReview"))).toEqual([
      expect.objectContaining({ code: "CBB-FIELD-0101", instancePath: "/fieldReview/1/target" }),
      expect.objectContaining({ code: "CBB-FIELD-0101", instancePath: "/fieldReview/2/target" }),
      expect.objectContaining({ code: "CBB-FIELD-0101", instancePath: "/fieldReview/4/target" }),
    ]);
  });

  it("requires rights group order to be an exact permutation", () => {
    const result = validateDocumentSemantics(document({
      elements: [{
        id: "rights",
        type: "rightsAttribution",
        name: "Copyrights & Permissions",
        data: { groupOrder: ["scripture", "scripture", "other"] },
      }],
    }));

    expect(result.findings).toContainEqual(expect.objectContaining({
      code: "CBB-RIGHTS-0002",
      instancePath: "/elements/0/data/groupOrder",
    }));
  });
});
