import { describe, expect, it } from "vitest";
import {
  customElementDefinitionHash,
  finalizeCustomDefinitionRevisions,
  type CustomDefinitionRevisionSet,
} from "./customDefinitions.js";
import type {
  CustomElementDefinition,
  CustomElementInstance,
  NativeElement,
} from "./types.js";

function definition(
  id: string,
  elements: readonly NativeElement[],
): CustomElementDefinition {
  const revision = {
    version: 1 as const,
    kind: "customElementDefinition" as const,
    id,
    definitionVersion: 1,
    name: id,
    fieldContract: {
      id: `${id}0000000-0000-4000-8000-000000000000`.slice(0, 36),
      version: 1,
      name: `${id} fields`,
      fields: [],
    },
    elements,
  };
  return { ...revision, definitionHash: customElementDefinitionHash(revision) };
}

function instance(
  id: string,
  target: CustomElementDefinition,
  fieldValues?: CustomElementInstance["fieldValues"],
): CustomElementInstance {
  return {
    id,
    type: "customInstance",
    name: id,
    definitionId: target.id,
    definitionVersion: target.definitionVersion,
    definitionHash: target.definitionHash,
    ...(fieldValues === undefined ? {} : { fieldValues }),
  };
}

function graph(): CustomDefinitionRevisionSet {
  const leaf = definition("leaf", [{
    id: "leafText",
    type: "text",
    name: "Leaf text",
    data: { content: { kind: "plain", text: "Leaf" } },
  }]);
  const outer = definition("outer", [instance("nestedLeaf", leaf)]);
  const top = definition("top", [instance("nestedOuter", outer)]);
  return {
    definitions: [leaf, outer, top],
    elements: [instance("bodyTop", top)],
    pageElements: [{
      id: "pageOuter",
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
        id: "pageStack",
        type: "stack",
        name: "Page stack",
        data: { direction: "vertical", gap: "0pt" },
        children: [{ id: "pageChild", index: 0, element: instance("pageOuterUse", outer) }],
      },
    }],
  };
}

describe("custom definition revision finalization", () => {
  it("bumps one edited owner and every ancestor exactly once, then repins body and page uses", () => {
    const previous = graph();
    const edited = structuredClone(previous) as CustomDefinitionRevisionSet;
    const outer = edited.definitions[1] as CustomElementDefinition;
    const nested = outer.elements[0] as CustomElementInstance;
    const definitions = [...edited.definitions];
    definitions[1] = {
      ...outer,
      elements: [{
        ...nested,
        fieldValues: { message: { value: "Changed", origin: "manual" } },
      }],
    };

    const result = finalizeCustomDefinitionRevisions(previous, { ...edited, definitions });
    const [leaf, nextOuter, nextTop] = result.definitions;
    expect(leaf).toEqual(previous.definitions[0]);
    expect(nextOuter?.definitionVersion).toBe(2);
    expect(nextTop?.definitionVersion).toBe(2);
    expect((nextTop?.elements[0] as CustomElementInstance).definitionHash)
      .toBe(nextOuter?.definitionHash);
    expect((result.elements[0] as CustomElementInstance).definitionHash)
      .toBe(nextTop?.definitionHash);
    const pageStack = result.pageElements?.[0]?.element;
    const pageUse = pageStack?.type === "stack" ? pageStack.children[0]?.element : undefined;
    expect(pageUse?.type === "customInstance" ? pageUse.definitionHash : undefined)
      .toBe(nextOuter?.definitionHash);
  });

  it("does not bump definitions for root/page values and rejects invalid previous v2 evidence", () => {
    const previous = graph();
    const body = previous.elements[0] as CustomElementInstance;
    const pageStack = previous.pageElements?.[0]?.element;
    if (pageStack?.type !== "stack") throw new Error("page fixture missing");
    const pageWrapper = pageStack.children[0];
    if (pageWrapper === undefined) throw new Error("page fixture child missing");
    const pageUse = pageWrapper.element as CustomElementInstance;
    const edited: CustomDefinitionRevisionSet = {
      ...previous,
      elements: [{
        ...body,
        fieldValues: { message: { value: "Body only", origin: "manual" } },
      }],
      pageElements: [{
        ...(previous.pageElements?.[0] as NonNullable<CustomDefinitionRevisionSet["pageElements"]>[number]),
        element: {
          ...pageStack,
          children: [{
            ...pageWrapper,
            element: {
              ...pageUse,
              fieldValues: { message: { value: "Page only", origin: "manual" } },
            },
          }],
        },
      }],
    };
    const result = finalizeCustomDefinitionRevisions(previous, edited);
    expect(result.definitions).toEqual(previous.definitions);

    const invalid = structuredClone(previous) as CustomDefinitionRevisionSet;
    const invalidDefinitions = [...invalid.definitions];
    invalidDefinitions[0] = {
      ...(invalidDefinitions[0] as CustomElementDefinition),
      definitionHash: `sha256:${"0".repeat(64)}`,
    };
    expect(() => finalizeCustomDefinitionRevisions(
      { ...invalid, definitions: invalidDefinitions },
      edited,
    )).toThrow(/invalid self-hash/u);
  });
});
