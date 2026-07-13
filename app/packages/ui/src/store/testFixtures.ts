import {
  customElementDefinitionHash,
  type CbbDocument,
  type CustomElementDefinition,
  type CustomElementInstance,
  type NativeElement,
  type TextElement,
} from "@cbb/core";

export function finalizedCustomDefinitionFixture(
  definition: Omit<CustomElementDefinition, "definitionVersion" | "definitionHash">,
  definitionVersion = 1,
): CustomElementDefinition {
  const revision = { ...definition, definitionVersion };
  return {
    ...revision,
    definitionHash: customElementDefinitionHash(revision),
  };
}

export function customInstanceFixture(
  definition: CustomElementDefinition,
  instance: Omit<
    CustomElementInstance,
    "definitionId" | "definitionVersion" | "definitionHash"
  >,
): CustomElementInstance {
  return {
    ...instance,
    definitionId: definition.id,
    definitionVersion: definition.definitionVersion,
    definitionHash: definition.definitionHash,
  };
}

export function textElement(
  id: string,
  text = id,
  overrides: Partial<TextElement> = {},
): TextElement {
  return {
    id,
    type: "text",
    name: id,
    data: { content: { kind: "plain", text } },
    ...overrides,
  };
}

export function bulletin(
  overrides: Partial<CbbDocument> = {},
): CbbDocument {
  return {
    version: 2,
    kind: "bulletin",
    name: "Sunday Bulletin",
    page: { typstWidth: "7in", typstHeight: "8.5in" },
    elements: [textElement("heading", "Welcome"), textElement("body", "News")],
    ...overrides,
  };
}

export function nestedElements(): readonly NativeElement[] {
  return [
    {
      id: "stack",
      type: "stack",
      name: "Order of service",
      data: { direction: "vertical", gap: "6pt" },
      children: [
        {
          id: "stack-item",
          index: 0,
          element: textElement("nested-text", "Invocation"),
        },
      ],
    },
  ];
}
