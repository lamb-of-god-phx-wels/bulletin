import { describe, expect, it } from "vitest";
import type { CbbDocument, NativeElement } from "@cbb/core";
import {
  customInstanceFixture,
  finalizedCustomDefinitionFixture,
} from "../store/testFixtures.js";
import { createEditorRenderModel } from "./renderModel.js";

function text(id: string, value: string): NativeElement {
  return { id, type: "text", name: id, data: { content: { kind: "plain", text: value } } };
}

function document(elements: readonly NativeElement[], overrides: Partial<CbbDocument> = {}): CbbDocument {
  return {
    version: 2,
    kind: "bulletin",
    name: "Resolved preview",
    page: { typstWidth: "8.5in", typstHeight: "11in" },
    elements,
    ...overrides,
  };
}

describe("editor resolved render model", () => {
  it("uses bound values and removes inactive conditional content", () => {
    const visible = {
      ...text("visible", "stale"),
      bindings: [{
        id: "label-binding",
        scope: "document" as const,
        fieldId: "label",
        target: "/data/content/text",
      }],
    };
    const hidden = text("hidden", "Must not render");
    const model = createEditorRenderModel(document([visible, hidden], {
      fieldContract: {
        id: "00000000-0000-4000-8000-000000000001",
        version: 1,
        name: "Weekly fields",
        fields: [
          { id: "label", label: "Label", type: "text", required: false },
          { id: "show", label: "Show", type: "boolean", required: false },
        ],
      },
      fieldValues: {
        label: { value: "Effective value", origin: "manual" },
        show: { value: false, origin: "manual" },
      },
      contentRules: [{
        kind: "conditional",
        id: "show-hidden",
        targetNodeId: "hidden",
        scope: "document",
        fieldId: "show",
        condition: { kind: "booleanEquals", value: true },
        activateLabel: "Show",
        inactiveLabel: "Hide",
      }],
    }));

    expect(model.elements.map((entry) => entry.sourceNodeId)).toEqual(["visible"]);
    const content = model.elements[0]?.element;
    expect(content?.type === "text" ? content.data.content : undefined).toEqual({
      kind: "plain",
      text: "Effective value",
    });
  });

  it("expands repeat items and custom sections into preview-native elements", () => {
    const prototype: NativeElement = {
      id: "prototype",
      type: "stack",
      name: "Item",
      data: { direction: "vertical", gap: "4pt" },
      children: [{ id: "label-wrapper", index: 0, element: text("item-label", "stale") }],
    };
    const definition = finalizedCustomDefinitionFixture({
      version: 1,
      kind: "customElementDefinition",
      id: "saved-section",
      name: "Saved section",
      fieldContract: {
        id: "00000000-0000-4000-8000-000000000003",
        version: 1,
        name: "Saved section fields",
        fields: [],
      },
      elements: [text("saved-text", "From saved section")],
    });
    const model = createEditorRenderModel(document([
      prototype,
      customInstanceFixture(definition, {
        id: "saved-instance",
        type: "customInstance",
        name: "Saved instance",
      }),
    ], {
      fieldContract: {
        id: "00000000-0000-4000-8000-000000000002",
        version: 1,
        name: "Repeat fields",
        fields: [{
          id: "items",
          label: "Items",
          type: "array",
          required: true,
          constraints: { maxItems: 3 },
          itemField: {
            id: "item",
            label: "Item",
            type: "object",
            required: true,
            childFields: [{ id: "label", label: "Label", type: "text", required: true }],
          },
        }],
      },
      fieldValues: {
        items: {
          value: [{ label: "First" }, { label: "Second" }],
          origin: "manual",
          itemIds: [
            "11111111-1111-4111-8111-111111111111",
            "22222222-2222-4222-8222-222222222222",
          ],
        },
      },
      contentRules: [{
        kind: "repeat",
        id: "repeat-items",
        fieldId: "items",
        prototypeNodeId: "prototype",
        itemBindings: [{
          id: "item-label-binding",
          itemPath: "/label",
          targetNodeId: "item-label",
          target: "/data/content/text",
        }],
        emptyState: { mode: "collapse" },
        maxItems: 3,
        userReorderable: true,
        itemLabel: "Item",
        addLabel: "Add item",
      }],
      customElementDefinitions: [definition],
    }));

    expect(model.findings).toEqual([]);
    expect(model.elements).toHaveLength(3);
    const labels = model.elements.slice(0, 2).map((entry) => {
      const stack = entry.element;
      if (stack.type !== "stack") return undefined;
      const child = stack.children[0]?.element;
      return child?.type === "text" && child.data.content?.kind === "plain"
        ? child.data.content.text
        : undefined;
    });
    expect(labels).toEqual(["First", "Second"]);
    expect(JSON.stringify(model.elements[2]?.element)).toContain("From saved section");
  });
});
