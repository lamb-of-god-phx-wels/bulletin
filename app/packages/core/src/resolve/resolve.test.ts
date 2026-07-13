import { describe, expect, it } from "vitest";
import { canonicalStringify } from "../canonical/index.js";
import { customElementDefinitionHash } from "../document/customDefinitions.js";
import type {
  Binding,
  CbbDocument,
  ConditionalRule,
  CustomElementDefinition,
  FieldContract,
  FieldDefinition,
  NativeElement,
  RepeatRule,
  TextElement,
} from "../document/types.js";
import { resolveDocument } from "./index.js";

function text(
  id: string,
  value: string,
  bindings?: readonly Binding[],
): TextElement {
  return {
    id,
    type: "text",
    name: `Name ${id}`,
    ...(bindings !== undefined ? { bindings } : {}),
    data: { content: { kind: "plain", text: value } },
  };
}

function contract(fields: readonly FieldDefinition[]): FieldContract {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    version: 1,
    name: "Fields",
    fields,
  };
}

function documentWith(
  elements: readonly NativeElement[],
  overrides: Partial<CbbDocument> = {},
): CbbDocument {
  return {
    version: 2,
    kind: "bulletin",
    name: "Bulletin",
    page: { typstWidth: "5.5in", typstHeight: "8.5in" },
    elements,
    ...overrides,
  };
}

function definitionRevision(
  input: Omit<CustomElementDefinition, "definitionVersion" | "definitionHash">,
): CustomElementDefinition {
  const revision = { ...input, definitionVersion: 1 };
  return { ...revision, definitionHash: customElementDefinitionHash(revision) };
}

function projectedPlainTexts(document: CbbDocument): readonly string[] {
  return resolveDocument(document).projection.elements.flatMap((element) =>
    element.type === "text" && element.data.content.kind === "plain"
      ? [element.data.content.text]
      : [],
  );
}

describe("field resolution and bindings", () => {
  it("uses stored value, then default, then binding fallback", () => {
    const fields: FieldDefinition[] = [
      { id: "stored", label: "Stored", type: "text", required: true, default: "D1" },
      { id: "defaulted", label: "Defaulted", type: "text", required: true, default: "D2" },
      { id: "fallback", label: "Fallback", type: "text", required: true },
    ];
    const elements = fields.map((field) =>
      text(field.id, "stale literal", [
        {
          id: `${field.id}Binding`,
          scope: "document",
          fieldId: field.id,
          target: "/data/content/text",
          ...(field.id === "fallback" ? { fallback: "F3" } : {}),
        },
      ]),
    );
    const result = resolveDocument(
      documentWith(elements, {
        fieldContract: contract(fields),
        fieldValues: {
          stored: { value: "S1", origin: "manual" },
          defaulted: { value: 42, origin: "manual" },
          fallback: { value: false, origin: "manual" },
        },
      }),
    );
    expect(projectedPlainTexts(documentWith(elements, {
      fieldContract: contract(fields),
      fieldValues: {
        stored: { value: "S1", origin: "manual" },
        defaulted: { value: 42, origin: "manual" },
        fallback: { value: false, origin: "manual" },
      },
    }))).toEqual(["S1", "D2", "F3"]);
    expect(result.findings.filter((finding) => finding.kind === "fieldValueInvalid"))
      .toHaveLength(2);
  });

  it("fails closed for missing required values and forbidden pointers", () => {
    const fields: FieldDefinition[] = [
      { id: "missing", label: "Missing", type: "text", required: true },
      { id: "unsafe", label: "Unsafe", type: "text", required: true, default: "x" },
    ];
    const result = resolveDocument(
      documentWith(
        [
          text("missingNode", "must not leak", [
            {
              id: "missingBinding",
              scope: "document",
              fieldId: "missing",
              target: "/data/content/text",
            },
          ]),
          text("unsafeNode", "must not mutate", [
            {
              id: "unsafeBinding",
              scope: "document",
              fieldId: "unsafe",
              target: "/style/fontSize",
            },
          ]),
        ],
        { fieldContract: contract(fields) },
      ),
    );
    expect(result.tree.elements).toHaveLength(0);
    expect(result.findings.map((finding) => finding.kind)).toEqual([
      "fieldValueMissing",
      "bindingTargetInvalid",
    ]);
  });

  it("deletes an optional bound leaf when the optional field is missing", () => {
    const element: NativeElement = {
      id: "image",
      type: "image",
      name: "Image",
      bindings: [
        {
          id: "altBinding",
          scope: "document",
          fieldId: "alt",
          target: "/data/alt",
        },
      ],
      data: {
        assetRef: "asset:44444444-4444-4444-8444-444444444444",
        fit: "contain",
        alt: "stale literal",
      },
    };
    const result = resolveDocument(
      documentWith([element], {
        fieldContract: contract([
          { id: "alt", label: "Alt", type: "text", required: false },
        ]),
      }),
    );
    const resolved = result.tree.elements[0]?.element;
    expect(resolved?.type).toBe("image");
    if (resolved?.type === "image") expect(resolved.data.alt).toBeUndefined();
    expect(result.findings).toEqual([]);
  });

  it("materializes bound-only required Text, Date, Image, and Hymn leaves before rendering", () => {
    const fields: FieldDefinition[] = [
      { id: "message", label: "Message", type: "text", required: true },
      { id: "date", label: "Date", type: "date", required: true },
      { id: "image", label: "Image", type: "assetRef", required: true },
      { id: "title", label: "Title", type: "text", required: true },
    ];
    const bind = (id: string, fieldId: string, target: string): Binding => ({
      id,
      scope: "document",
      fieldId,
      target,
    });
    const result = resolveDocument(documentWith([
      {
        id: "text",
        type: "text",
        name: "Text",
        data: { content: { kind: "plain" } },
        bindings: [bind("textBinding", "message", "/data/content/text")],
      },
      {
        id: "date",
        type: "date",
        name: "Date",
        data: {},
        bindings: [bind("dateBinding", "date", "/data/value")],
      },
      {
        id: "image",
        type: "image",
        name: "Image",
        data: { fit: "contain" },
        bindings: [bind("imageBinding", "image", "/data/assetRef")],
      },
      {
        id: "music",
        type: "music",
        name: "Hymn",
        data: {
          rightsAssociationReview: {
            reviewedSongContentHash: `sha256:${"a".repeat(64)}`,
            reviewedRightsProjectionHash: `sha256:${"b".repeat(64)}`,
            reviewTime: "2026-07-13T12:00:00Z",
          },
          rights: [],
        },
        bindings: [bind("titleBinding", "title", "/data/title")],
      },
    ], {
      fieldContract: contract(fields),
      fieldValues: {
        message: { value: "Resolved text", origin: "manual" },
        date: { value: "2026-07-13", origin: "manual" },
        image: {
          value: "asset:44444444-4444-4444-8444-444444444444",
          origin: "manual",
        },
        title: { value: "Resolved hymn", origin: "manual" },
      },
    }));
    expect(result.findings).toEqual([]);
    expect(result.projection.elements.map((element) => {
      if (element.type === "text" && element.data.content.kind === "plain") {
        return element.data.content.text;
      }
      if (element.type === "date") return element.data.value;
      if (element.type === "image") return element.data.assetRef;
      if (element.type === "music") return element.data.title;
      return undefined;
    })).toEqual([
      "Resolved text",
      "2026-07-13",
      "asset:44444444-4444-4444-8444-444444444444",
      "Resolved hymn",
    ]);
  });

  it("materializes the centered default for an unbound focal-point axis", () => {
    const image = (id: string, fieldId: string, target: string): NativeElement => ({
      id,
      type: "image",
      name: id,
      data: {
        assetRef: "asset:44444444-4444-4444-8444-444444444444",
        fit: "cover",
      },
      bindings: [{ id: `${id}Binding`, scope: "document", fieldId, target }],
    });
    const result = resolveDocument(documentWith([
      image("xImage", "x", "/data/focalPoint/x"),
      image("yImage", "y", "/data/focalPoint/y"),
    ], {
      fieldContract: contract([
        { id: "x", label: "X", type: "number", required: true },
        { id: "y", label: "Y", type: "number", required: true },
      ]),
      fieldValues: {
        x: { value: 0.2, origin: "manual" },
        y: { value: 0.8, origin: "manual" },
      },
    }));
    expect(result.findings).toEqual([]);
    expect(result.projection.elements.map((element) =>
      element.type === "image" ? element.data.focalPoint : undefined
    )).toEqual([{ x: 0.2, y: 0.5 }, { x: 0.5, y: 0.8 }]);
  });

  it("rejects unknown rich-text field nodes instead of silently dropping them", () => {
    const target: TextElement = {
      id: "richTarget",
      type: "text",
      name: "Rich target",
      bindings: [
        {
          id: "richBinding",
          scope: "document",
          fieldId: "rich",
          target: "/data/content/document",
        },
      ],
      data: {
        content: {
          kind: "richText",
          document: { type: "document", blocks: [] },
        },
      },
    };
    const result = resolveDocument(documentWith([target], {
      fieldContract: contract([
        { id: "rich", label: "Rich", type: "richText", required: true },
      ]),
      fieldValues: {
        rich: {
          value: {
            type: "document",
            blocks: [{ type: "rawTypst", source: "#read(\"secret\")" }],
          },
          origin: "manual",
        },
      },
    }));

    expect(result.tree.elements).toEqual([]);
    expect(result.findings).toEqual([
      expect.objectContaining({ kind: "fieldValueInvalid", fieldId: "rich" }),
      expect.objectContaining({ kind: "fieldValueMissing", fieldId: "rich" }),
    ]);
  });
});

describe("render projection classification", () => {
  it("materializes output-equivalent page defaults", () => {
    const implicit = documentWith([text("same", "Same")]);
    const explicit = {
      ...implicit,
      page: {
        ...implicit.page,
        background: "#ffffff",
        marginMode: "fixed" as const,
        binding: "left" as const,
      },
    };

    expect(canonicalStringify(resolveDocument(implicit).projection)).toBe(
      canonicalStringify(resolveDocument(explicit).projection),
    );
  });

  it("removes the inert legacy font family while preserving render style", () => {
    const withLegacyFont: TextElement = {
      ...text("styled", "Same output"),
      style: { font: "Legacy Family", fontSize: "12pt" },
    };
    const withoutLegacyFont: TextElement = {
      ...text("styled", "Same output"),
      style: { fontSize: "12pt" },
    };

    const first = resolveDocument(documentWith([withLegacyFont])).projection;
    const second = resolveDocument(documentWith([withoutLegacyFont])).projection;

    expect(canonicalStringify(first)).toBe(canonicalStringify(second));
    expect(first.elements[0]?.style).toEqual({
      fontSize: "12pt",
      fontWeight: "regular",
      fontStyle: "normal",
      color: "#251d18",
      background: "transparent",
      borderColor: "#d8cdbd",
      borderWidth: 0,
      align: "left",
      verticalAlign: "top",
    });
    expect(first.elements[0]?.style).not.toHaveProperty("font");
  });

  it("drops a legacy-only font while materializing effective style defaults", () => {
    const legacyOnly: TextElement = {
      ...text("styled", "Same output"),
      style: { font: "Legacy Family" },
    };

    const style = resolveDocument(documentWith([legacyOnly])).projection
      .elements[0]?.style;
    expect(style).toEqual({
      fontSize: 11,
      fontWeight: "regular",
      fontStyle: "normal",
      color: "#251d18",
      background: "transparent",
      borderColor: "#d8cdbd",
      borderWidth: 0,
      align: "left",
      verticalAlign: "top",
    });
    expect(style).not.toHaveProperty("font");
  });

  it("canonicalizes grid children to rendered row-major order", () => {
    const first: NativeElement = {
      id: "grid",
      type: "grid",
      name: "Grid",
      data: { rows: 2, columns: 1 },
      children: [
        { id: "rowOne", row: 1, column: 0, element: text("second", "Second") },
        { id: "rowZero", row: 0, column: 0, element: text("first", "First") },
      ],
    };
    const second: NativeElement = {
      ...first,
      children: [...first.children].reverse(),
    };

    const firstProjection = resolveDocument(documentWith([first])).projection;
    const secondProjection = resolveDocument(documentWith([second])).projection;
    expect(canonicalStringify(firstProjection)).toBe(
      canonicalStringify(secondProjection),
    );
    const projectedGrid = firstProjection.elements[0];
    expect(projectedGrid?.type).toBe("grid");
    if (projectedGrid?.type === "grid") {
      expect(projectedGrid.children.map((child) => child.row)).toEqual([0, 1]);
    }
  });
});

describe("conditionals", () => {
  const target = text("conditional", "Conditional");
  const booleanRule: ConditionalRule = {
    kind: "conditional",
    id: "showRule",
    targetNodeId: "conditional",
    scope: "document",
    fieldId: "show",
    condition: { kind: "booleanEquals", value: true },
    activateLabel: "Show",
    inactiveLabel: "Hide",
  };

  it("excludes an explicitly inactive branch without a finding", () => {
    const result = resolveDocument(
      documentWith([target], {
        fieldContract: contract([
          { id: "show", label: "Show", type: "boolean", required: false },
        ]),
        fieldValues: { show: { value: false, origin: "manual" } },
        contentRules: [booleanRule],
      }),
    );
    expect(result.tree.elements).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  it("does not evaluate missing bindings inside an inactive branch", () => {
    const boundTarget = text("conditional", "must not leak", [
      {
        id: "inactiveBinding",
        scope: "document",
        fieldId: "inactiveText",
        target: "/data/content/text",
      },
    ]);
    const result = resolveDocument(
      documentWith([boundTarget], {
        fieldContract: contract([
          { id: "show", label: "Show", type: "boolean", required: false },
          { id: "inactiveText", label: "Inactive text", type: "text", required: true },
        ]),
        fieldValues: { show: { value: false, origin: "manual" } },
        contentRules: [booleanRule],
      }),
    );

    expect(result.tree.elements).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  it("treats missing choice-not-equals as unresolved, never true", () => {
    const result = resolveDocument(
      documentWith([target], {
        fieldContract: contract([
          {
            id: "season",
            label: "Season",
            type: "choice",
            required: false,
            constraints: { choices: [{ id: "easter", label: "Easter" }] },
          },
        ]),
        contentRules: [
          {
            ...booleanRule,
            id: "notEaster",
            fieldId: "season",
            condition: { kind: "choiceNotEquals", choiceId: "easter" },
          },
        ],
      }),
    );
    expect(result.tree.elements).toEqual([]);
    expect(result.findings[0]?.kind).toBe("conditionalUnresolved");
  });
});

describe("repeat expansion", () => {
  const itemDefinition: FieldDefinition = {
    id: "item",
    label: "Item",
    type: "object",
    required: true,
    childFields: [
      { id: "label", label: "Label", type: "text", required: true },
      { id: "visible", label: "Visible", type: "boolean", required: true },
    ],
  };
  const listDefinition: FieldDefinition = {
    id: "items",
    label: "Items",
    type: "array",
    required: true,
    itemField: itemDefinition,
    constraints: { maxItems: 5 },
  };
  const prototype: NativeElement = {
    id: "prototype",
    type: "stack",
    name: "Prototype",
    data: { direction: "vertical", gap: "1pt" },
    children: [
      {
        id: "prototypeWrapper",
        index: 0,
        element: text("itemText", "stale"),
      },
    ],
  };
  const repeat: RepeatRule = {
    kind: "repeat",
    id: "repeatItems",
    fieldId: "items",
    prototypeNodeId: "prototype",
    itemBindings: [
      {
        id: "itemLabelBinding",
        itemPath: "/label",
        targetNodeId: "itemText",
        target: "/data/content/text",
      },
    ],
    emptyState: { mode: "collapse" },
    maxItems: 5,
    userReorderable: true,
    itemLabel: "Item",
    addLabel: "Add",
  };

  it("expands in item order with stable ids, item pointers, and item conditions", () => {
    const itemConditional: ConditionalRule = {
      kind: "conditional",
      id: "visibleItem",
      targetNodeId: "itemText",
      scope: "item",
      fieldId: "/visible",
      condition: { kind: "booleanEquals", value: true },
      activateLabel: "Show",
      inactiveLabel: "Hide",
    };
    const result = resolveDocument(
      documentWith([prototype], {
        fieldContract: contract([listDefinition]),
        fieldValues: {
          items: {
            value: [
              { label: "First", visible: true },
              { label: "Second", visible: false },
            ],
            origin: "manual",
            itemIds: [
              "11111111-1111-4111-8111-111111111111",
              "22222222-2222-4222-8222-222222222222",
            ],
          },
        },
        contentRules: [repeat, itemConditional],
      }),
    );
    expect(result.tree.elements).toHaveLength(2);
    expect(result.tree.elements.map((node) => node.resolvedId)).toEqual([
      "repeatItems/11111111-1111-4111-8111-111111111111/prototype",
      "repeatItems/22222222-2222-4222-8222-222222222222/prototype",
    ]);
    const first = result.tree.elements[0]?.element;
    const second = result.tree.elements[1]?.element;
    expect(first?.type).toBe("stack");
    expect(second?.type).toBe("stack");
    if (first?.type === "stack") {
      const child = first.children[0]?.element.element;
      expect(child?.type).toBe("text");
      if (child?.type === "text" && child.data.content.kind === "plain") {
        expect(child.data.content.text).toBe("First");
      }
      expect(first.children[0]?.provenance.expansions[0]?.kind).toBe("repeat");
    }
    if (second?.type === "stack") expect(second.children).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  it("composes outer and inner item bindings across nested repeat expansion", () => {
    const outerPrototype: NativeElement = {
      id: "outerPrototype",
      type: "stack",
      name: "Outer prototype",
      data: { direction: "vertical", gap: "0pt" },
      children: [
        {
          id: "outerWrapper",
          index: 0,
          element: {
            id: "innerPrototype",
            type: "stack",
            name: "Inner prototype",
            data: { direction: "vertical", gap: "0pt" },
            children: [
              {
                id: "outerLabelWrapper",
                index: 0,
                element: text("outerLabel", "stale outer"),
              },
              {
                id: "innerLabelWrapper",
                index: 1,
                element: text("innerLabel", "stale inner"),
              },
            ],
          },
        },
      ],
    };
    const outerField: FieldDefinition = {
      id: "outers",
      label: "Outers",
      type: "array",
      required: true,
      constraints: { maxItems: 2 },
      itemField: {
        id: "outer",
        label: "Outer",
        type: "object",
        required: true,
        childFields: [
          { id: "label", label: "Label", type: "text", required: true },
        ],
      },
    };
    const innerField: FieldDefinition = {
      id: "inners",
      label: "Inners",
      type: "array",
      required: true,
      constraints: { maxItems: 2 },
      itemField: {
        id: "inner",
        label: "Inner",
        type: "object",
        required: true,
        childFields: [
          { id: "label", label: "Label", type: "text", required: true },
          { id: "visible", label: "Visible", type: "boolean", required: true },
        ],
      },
    };
    const outerRepeat: RepeatRule = {
      kind: "repeat",
      id: "outerRepeat",
      fieldId: "outers",
      prototypeNodeId: "outerPrototype",
      itemBindings: [
        {
          id: "outerLabelBinding",
          itemPath: "/label",
          targetNodeId: "outerLabel",
          target: "/data/content/text",
        },
      ],
      emptyState: { mode: "collapse" },
      maxItems: 2,
      userReorderable: true,
      itemLabel: "Outer",
      addLabel: "Add outer",
    };
    const innerRepeat: RepeatRule = {
      kind: "repeat",
      id: "innerRepeat",
      fieldId: "inners",
      prototypeNodeId: "innerPrototype",
      itemBindings: [
        {
          id: "innerLabelBinding",
          itemPath: "/label",
          targetNodeId: "innerLabel",
          target: "/data/content/text",
        },
      ],
      emptyState: { mode: "collapse" },
      maxItems: 2,
      userReorderable: true,
      itemLabel: "Inner",
      addLabel: "Add inner",
    };
    const innerConditional: ConditionalRule = {
      kind: "conditional",
      id: "innerVisible",
      targetNodeId: "innerPrototype",
      scope: "item",
      fieldId: "/visible",
      condition: { kind: "booleanEquals", value: true },
      activateLabel: "Show inner",
      inactiveLabel: "Hide inner",
    };
    const result = resolveDocument(documentWith([outerPrototype], {
      fieldContract: contract([outerField, innerField]),
      fieldValues: {
        outers: {
          value: [{ label: "Outer value" }],
          origin: "manual",
          itemIds: ["11111111-1111-4111-8111-111111111111"],
        },
        inners: {
          value: [
            { label: "Inner one", visible: true },
            { label: "Inner two", visible: true },
          ],
          origin: "manual",
          itemIds: [
            "22222222-2222-4222-8222-222222222222",
            "33333333-3333-4333-8333-333333333333",
          ],
        },
      },
      contentRules: [outerRepeat, innerRepeat, innerConditional],
    }));

    const outer = result.tree.elements[0]?.element;
    expect(outer?.type).toBe("stack");
    if (outer?.type !== "stack") return;
    const innerExpansionGroup = outer.children[0]?.element.element;
    expect(innerExpansionGroup?.type).toBe("stack");
    if (innerExpansionGroup?.type !== "stack") return;
    const renderedPairs = innerExpansionGroup.children.map((expanded) => {
      const inner = expanded.element.element;
      expect(inner.type).toBe("stack");
      if (inner.type !== "stack") return [];
      return inner.children.map((child) => {
        const value = child.element.element;
        return value.type === "text" && value.data.content.kind === "plain"
          ? value.data.content.text
          : "";
      });
    });
    expect(renderedPairs).toEqual([
      ["Outer value", "Inner one"],
      ["Outer value", "Inner two"],
    ]);
    expect(result.findings).toEqual([]);
  });

  it("renders a static empty-state sibling only for an empty array", () => {
    const emptyRule: RepeatRule = {
      ...repeat,
      emptyState: { mode: "show", nodeId: "empty" },
    };
    const result = resolveDocument(
      documentWith([prototype, text("empty", "Nothing scheduled")], {
        fieldContract: contract([listDefinition]),
        fieldValues: { items: { value: [], origin: "manual", itemIds: [] } },
        contentRules: [emptyRule],
      }),
    );
    expect(projectedPlainTexts(documentWith([prototype, text("empty", "Nothing scheduled")], {
      fieldContract: contract([listDefinition]),
      fieldValues: { items: { value: [], origin: "manual", itemIds: [] } },
      contentRules: [emptyRule],
    }))).toEqual(["Nothing scheduled"]);
    expect(result.tree.elements[0]?.resolvedId).toBe("empty");
  });

  it("fails closed when stable item ids are absent or maximum is exceeded", () => {
    const missingIds = resolveDocument(
      documentWith([prototype], {
        fieldContract: contract([listDefinition]),
        fieldValues: {
          items: { value: [{ label: "One", visible: true }], origin: "manual" },
        },
        contentRules: [repeat],
      }),
    );
    expect(missingIds.tree.elements).toEqual([]);
    expect(missingIds.findings[0]?.kind).toBe("repeatItemIdsInvalid");

    const tooMany = resolveDocument(
      documentWith([prototype], {
        fieldContract: contract([listDefinition]),
        fieldValues: {
          items: {
            value: [
              { label: "1", visible: true },
              { label: "2", visible: true },
            ],
            origin: "manual",
            itemIds: ["id-1", "id-2"],
          },
        },
        contentRules: [{ ...repeat, maxItems: 1 }],
      }),
    );
    expect(tooMany.tree.elements).toEqual([]);
    expect(tooMany.findings[0]?.kind).toBe("repeatRuleInvalid");
  });

  it("does not evaluate prototype bindings when an empty repeat collapses", () => {
    const collapsedPrototype = text("collapsedPrototype", "must not leak", [
      {
        id: "collapsedBinding",
        scope: "document",
        fieldId: "missingText",
        target: "/data/content/text",
      },
    ]);
    const emptyRepeat: RepeatRule = {
      kind: "repeat",
      id: "emptyRepeat",
      fieldId: "emptyItems",
      prototypeNodeId: "collapsedPrototype",
      emptyState: { mode: "collapse" },
      maxItems: 5,
      userReorderable: true,
      itemLabel: "Item",
      addLabel: "Add",
    };
    const result = resolveDocument(
      documentWith([collapsedPrototype], {
        fieldContract: contract([
          {
            id: "emptyItems",
            label: "Items",
            type: "array",
            required: true,
            itemField: { id: "item", label: "Item", type: "text", required: true },
            constraints: { maxItems: 5 },
          },
          { id: "missingText", label: "Missing text", type: "text", required: true },
        ]),
        fieldValues: {
          emptyItems: { value: [], origin: "manual", itemIds: [] },
        },
        contentRules: [emptyRepeat],
      }),
    );

    expect(result.tree.elements).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  it("keeps origins and stable item ids out of the render projection", () => {
    const baseValues = {
      value: [{ label: "Same", visible: true }],
      origin: "manual" as const,
      itemIds: ["11111111-1111-4111-8111-111111111111"],
    };
    const first = documentWith([prototype], {
      fieldContract: contract([listDefinition]),
      fieldValues: { items: baseValues },
      contentRules: [repeat],
    });
    const second = documentWith([prototype], {
      fieldContract: contract([listDefinition]),
      fieldValues: {
        items: {
          ...baseValues,
          origin: "carriedForward",
          itemIds: ["22222222-2222-4222-8222-222222222222"],
        },
      },
      contentRules: [repeat],
    });
    expect(canonicalStringify(resolveDocument(first).projection)).toBe(
      canonicalStringify(resolveDocument(second).projection),
    );
  });
});

describe("custom elements", () => {
  it("expands nested definitions with instance-scoped values and composable provenance", () => {
    const inner = definitionRevision({
      version: 1,
      kind: "customElementDefinition",
      id: "innerDef",
      name: "Inner",
      fieldContract: contract([
        { id: "label", label: "Label", type: "text", required: true },
      ]),
      elements: [
        text("innerText", "stale", [
          {
            id: "innerBinding",
            scope: "local",
            fieldId: "label",
            target: "/data/content/text",
          },
        ]),
      ],
    });
    const outer = definitionRevision({
      version: 1,
      kind: "customElementDefinition",
      id: "outerDef",
      name: "Outer",
      fieldContract: contract([]),
      elements: [
        {
          id: "nestedInstance",
          type: "customInstance",
          name: "Nested",
          definitionId: "innerDef",
          definitionVersion: inner.definitionVersion,
          definitionHash: inner.definitionHash,
          fieldValues: { label: { value: "Nested value", origin: "manual" } },
        },
      ],
    });
    const result = resolveDocument(
      documentWith(
        [
          {
            id: "outerInstance",
            type: "customInstance",
            name: "Outer instance",
            definitionId: "outerDef",
            definitionVersion: outer.definitionVersion,
            definitionHash: outer.definitionHash,
          },
        ],
        { customElementDefinitions: [outer, inner] },
      ),
    );
    const outerStack = result.tree.elements[0]?.element;
    expect(outerStack?.type).toBe("stack");
    if (outerStack?.type !== "stack") return;
    const nestedStack = outerStack.children[0]?.element.element;
    expect(nestedStack?.type).toBe("stack");
    if (nestedStack?.type !== "stack") return;
    const innerText = nestedStack.children[0]?.element.element;
    expect(innerText?.type).toBe("text");
    if (innerText?.type === "text" && innerText.data.content.kind === "plain") {
      expect(innerText.data.content.text).toBe("Nested value");
    }
    expect(nestedStack.children[0]?.element.provenance.expansions.map((step) => step.kind))
      .toEqual(["custom", "custom"]);
    expect(result.findings).toEqual([]);
  });

  it("reports missing, hash-mismatched, and cyclic definitions", () => {
    const missing = resolveDocument(
      documentWith([
        {
          id: "missing",
          type: "customInstance",
          name: "Missing",
          definitionId: "none",
          definitionVersion: 1,
          definitionHash: `sha256:${"0".repeat(64)}`,
        },
      ]),
    );
    expect(missing.findings[0]?.kind).toBe("customDefinitionMissing");

    const plainDefinition = definitionRevision({
      version: 1,
      kind: "customElementDefinition",
      id: "plain",
      name: "Plain",
      fieldContract: contract([]),
      elements: [text("inside", "Inside")],
    });
    const mismatch = resolveDocument(
      documentWith(
        [
          {
            id: "badHash",
            type: "customInstance",
            name: "Bad hash",
            definitionId: "plain",
            definitionVersion: plainDefinition.definitionVersion,
            definitionHash: `sha256:${"0".repeat(64)}`,
          },
        ],
        { customElementDefinitions: [plainDefinition] },
      ),
    );
    expect(mismatch.findings[0]?.kind).toBe("customDefinitionHashMismatch");

    const cyclicDraft = {
      version: 1,
      kind: "customElementDefinition",
      id: "cycle",
      definitionVersion: 1,
      name: "Cycle",
      fieldContract: contract([]),
      elements: [
        {
          id: "self",
          type: "customInstance",
          name: "Self",
          definitionId: "cycle",
          definitionVersion: 1,
          definitionHash: `sha256:${"0".repeat(64)}`,
        },
      ],
    } as const;
    const cyclic: CustomElementDefinition = {
      ...cyclicDraft,
      definitionHash: customElementDefinitionHash(cyclicDraft),
    };
    const cycle = resolveDocument(
      documentWith(
        [
          {
            id: "cycleRoot",
            type: "customInstance",
            name: "Cycle root",
            definitionId: "cycle",
            definitionVersion: cyclic.definitionVersion,
            definitionHash: cyclic.definitionHash,
          },
        ],
        { customElementDefinitions: [cyclic] },
      ),
    );
    expect(cycle.findings[0]?.kind).toBe("customDefinitionHashMismatch");
  });

  it("enforces the custom expansion depth bound", () => {
    const leaf = definitionRevision({
      version: 1,
      kind: "customElementDefinition",
      id: "depthLeaf",
      name: "Leaf",
      fieldContract: contract([]),
      elements: [text("depthText", "Depth")],
    });
    const outer = definitionRevision({
      version: 1,
      kind: "customElementDefinition",
      id: "depthOuter",
      name: "Outer",
      fieldContract: contract([]),
      elements: [
        {
          id: "depthNested",
          type: "customInstance",
          name: "Nested",
          definitionId: leaf.id,
          definitionVersion: leaf.definitionVersion,
          definitionHash: leaf.definitionHash,
        },
      ],
    });
    const result = resolveDocument(
      documentWith(
        [
          {
            id: "depthRoot",
            type: "customInstance",
            name: "Root",
            definitionId: outer.id,
            definitionVersion: outer.definitionVersion,
            definitionHash: outer.definitionHash,
          },
        ],
        { customElementDefinitions: [outer, leaf] },
      ),
      { maxCustomDepth: 1 },
    );
    expect(result.findings[0]?.kind).toBe("customDefinitionDepthExceeded");
  });
});

describe("containers, limits, projection, and active rights", () => {
  it("preserves nested grid/stack/canvas wrapper placement", () => {
    const nested: NativeElement = {
      id: "grid",
      type: "grid",
      name: "Grid",
      data: { rows: 1, columns: 1 },
      children: [
        {
          id: "gridWrapper",
          row: 0,
          column: 0,
          element: {
            id: "canvas",
            type: "canvas",
            name: "Canvas",
            children: [
              {
                id: "canvasWrapper",
                x: "1in",
                y: "2in",
                semanticOrder: 3,
                element: text("leaf", "Leaf"),
              },
            ],
          },
        },
      ],
    };
    const result = resolveDocument(documentWith([nested]));
    const grid = result.tree.elements[0]?.element;
    expect(grid?.type).toBe("grid");
    if (grid?.type !== "grid") return;
    expect(grid.children[0]).toMatchObject({ row: 0, column: 0 });
    const canvas = grid.children[0]?.element.element;
    expect(canvas?.type).toBe("canvas");
    if (canvas?.type === "canvas") {
      expect(canvas.children[0]).toMatchObject({ x: "1in", y: "2in", semanticOrder: 3 });
    }
  });

  it("clears partial output when the expanded-node cap is crossed", () => {
    const result = resolveDocument(
      documentWith([text("one", "1"), text("two", "2")]),
      { maxExpandedNodes: 1 },
    );
    expect(result.tree).toMatchObject({ elements: [], pageElements: [], totalNodeCount: 0 });
    expect(result.findings[0]?.kind).toBe("expandedNodeLimitExceeded");
  });

  it("produces the same projection for inert/readiness-only edits when render metadata is fixed", () => {
    const base = documentWith([text("content", "Same")], {
      metadata: { title: "A", language: "fr", publicationDate: "2026-01-01" },
      authoringPolicy: { contentLocked: true },
      publicationContexts: ["printedNonsalableChurchBulletin"],
      rightsPolicy: { unknownRightsPolicy: "review" },
      page: {
        typstWidth: "5.5in",
        typstHeight: "8.5in",
        width: 528,
        height: 816,
        printSafeInset: { top: "1pt", right: "1pt", bottom: "1pt", left: "1pt" },
        finalPageCountRequirement: { exact: 4 },
      },
    });
    const edited = {
      ...base,
      name: "Renamed",
      metadata: { title: "A", language: "de", publicationDate: "2030-02-02" },
      authoringPolicy: { layoutLocked: true },
      publicationContexts: ["digitalNonsalableChurchBulletin"],
      rightsPolicy: { unknownRightsPolicy: "block" },
      sourceTemplate: { contractId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      orphanedFieldValues: { old: "ignored" },
      page: {
        ...base.page,
        width: 999,
        height: 999,
        printSafeInset: { top: "9pt", right: "9pt", bottom: "9pt", left: "9pt" },
        finalPageCountRequirement: { exact: 8 },
      },
    } satisfies CbbDocument;
    const first = resolveDocument(base, { locale: "en-US" }).projection;
    const second = resolveDocument(edited, { locale: "en-US" }).projection;
    expect(first.title).toBe("A");
    expect(canonicalStringify(first)).toBe(canonicalStringify(second));
    expect(canonicalStringify(first)).not.toContain("contentLocked");
    expect(canonicalStringify(first)).not.toContain("resolvedId");
  });

  it("projects an explicit PDF title or the stable document-name fallback", () => {
    const fallback = documentWith([text("content", "Same")], { name: "Fallback title" });
    const explicit = { ...fallback, metadata: { title: "Explicit title" } };
    expect(resolveDocument(fallback).projection.title).toBe("Fallback title");
    expect(resolveDocument(explicit).projection.title).toBe("Explicit title");
    expect(resolveDocument(explicit).projection).not.toEqual(
      resolveDocument(fallback).projection,
    );
  });

  it("applies scripture defaults and separates sanitized active rights", () => {
    const scripture: NativeElement = {
      id: "scripture",
      type: "text",
      name: "Scripture",
      data: {
        content: {
          kind: "richText",
          document: {
            type: "document",
            blocks: [
              {
                type: "scripture",
                structureKind: "paragraphOnly",
                reference: "John 1",
                translationId: "translation:22222222-2222-4222-8222-222222222222",
                translationLabel: "Test",
                paragraphs: [
                  { type: "paragraph", children: [{ type: "text", text: "In the beginning" }] },
                ],
                importSnapshot: {
                  sourceKind: "paste",
                  structureKind: "paragraphOnly",
                  displayReference: "John 1",
                  translationId: "translation:22222222-2222-4222-8222-222222222222",
                  translationLabel: "Test",
                  normalizerId: "n",
                  normalizerVersion: "1",
                  sourceText: "secret source evidence",
                  sourceTextHash: `sha256:${"1".repeat(64)}`,
                  importedFidelityHash: `sha256:${"2".repeat(64)}`,
                  rightsProjectionHash: `sha256:${"3".repeat(64)}`,
                  paragraphBoundaries: [{ paragraphIndex: 0, content: "In the beginning" }],
                },
                importReview: {
                  disposition: "changesConfirmed",
                  reviewedFidelityHash: `sha256:${"4".repeat(64)}`,
                  reviewedRightsProjectionHash: `sha256:${"5".repeat(64)}`,
                  reviewTime: "2026-01-01T00:00:00Z",
                },
                rights: [
                  {
                    creditKey: "credit:33333333-3333-4333-8333-333333333333",
                    creditProjectionHash: `sha256:${"6".repeat(64)}`,
                    component: "scriptureTranslation",
                    status: "copyrighted",
                    workTitle: "Test Translation",
                    contributors: [],
                    creditRequiredWhen: "always",
                    requiredCreditLine: "Displayed credit",
                    usagePolicySnapshot: {
                      providerRuleId: "secret-policy",
                      providerRuleVersion: "1",
                      applicablePublicationContexts: ["printedNonsalableChurchBulletin"],
                      policySourceHash: `sha256:${"7".repeat(64)}`,
                      counterIdVersion: "c@1",
                    },
                  },
                ],
              },
            ],
          },
        },
      },
    } as unknown as NativeElement;
    const result = resolveDocument(documentWith([scripture]));
    expect(result.projection.scripturePresentation).toMatchObject({
      referencePlacement: "before",
      verseNumberStyle: "superscript",
      paragraphPolicy: "publisher",
      paragraphSpacing: "6pt",
      translationLabelPlacement: "withReference",
    });
    expect(result.rightsContributions).toEqual([
      expect.objectContaining({
        creditKey: "credit:33333333-3333-4333-8333-333333333333",
        requiredCreditLineApplies: true,
        requiredCreditLine: "Displayed credit",
      }),
    ]);
    const serialized = canonicalStringify(result.projection);
    expect(serialized).not.toContain("secret source evidence");
    expect(serialized).not.toContain("secret-policy");
    expect(serialized).not.toContain("importReview");
    expect(serialized).toContain(`sha256:${"6".repeat(64)}`);
  });

  it("resolves renderedText music credit from actual rich lyrics, not title/source chrome", () => {
    const music = (id: string, richContent?: unknown): NativeElement => ({
      id,
      type: "music",
      name: id,
      data: {
        title: `${id} title`,
        source: `${id} source`,
        ...(richContent === undefined ? {} : { richContent }),
        rightsAssociationReview: {
          reviewedSongContentHash: `sha256:${"8".repeat(64)}`,
          reviewedRightsProjectionHash: `sha256:${"9".repeat(64)}`,
          reviewTime: "2026-01-01T00:00:00Z",
        },
        rights: [{
          creditKey: `credit:${id}`,
          creditProjectionHash: `sha256:${(id === "noLyrics" ? "a" : "b").repeat(64)}`,
          component: "text",
          status: "copyrighted",
          contributors: [],
          creditRequiredWhen: "renderedText",
          requiredCreditLine: `${id} credit`,
          usagePolicySnapshot: {
            providerRuleId: "rule",
            providerRuleVersion: "1",
            applicablePublicationContexts: ["printedNonsalableChurchBulletin"],
            requiredPublicationDisclosureLine: `${id} disclosure`,
            policySourceHash: `sha256:${"c".repeat(64)}`,
            counterIdVersion: "counter@1",
          },
        }],
      },
    } as unknown as NativeElement);
    const result = resolveDocument(documentWith([
      music("noLyrics"),
      music("withLyrics", {
        type: "document",
        blocks: [{
          type: "paragraph",
          children: [{ type: "text", text: "Actual rendered lyrics" }],
        }],
      }),
    ]));

    expect(result.rightsContributions).toEqual([
      expect.objectContaining({
        creditKey: "credit:noLyrics",
        requiredCreditLineApplies: false,
        requiredCreditLine: "noLyrics credit",
        usagePolicyDisclosureLine: "noLyrics disclosure",
      }),
      expect.objectContaining({
        creditKey: "credit:withLyrics",
        requiredCreditLineApplies: true,
        requiredCreditLine: "withLyrics credit",
        usagePolicyDisclosureLine: "withLyrics disclosure",
      }),
    ]);
  });
});
