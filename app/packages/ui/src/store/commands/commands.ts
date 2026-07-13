import {
  collectAllNodeIds,
  finalizeCustomDefinitionRevisions,
  formatIsoDate,
  isRepeatItemId,
  remintIds,
  validateFieldValue,
  type AuthoringPolicy,
  type Binding,
  type CanvasChildWrapper,
  type CanvasPosition,
  type CbbDocument,
  type ContentRule,
  type ElementSize,
  type FieldId,
  type FieldDefinition,
  type FieldValueEntry,
  type GridChildWrapper,
  type GridElementData,
  type IdPort,
  type NativeElement,
  type NodeId,
  type PageElementSize,
  type PageContentElement,
  type PageLevelWrapper,
  type PhysicalLength,
  type PhysicalOrRelativeLength,
  type PortableAssetRefString,
  type PublicationContext,
  type RightsPolicy,
  type ScripturePresentationSettings,
  type StackChildWrapper,
  type SpacingLength,
  type StyleObject,
  type TextContent,
} from "@cbb/core";
import type {
  CapabilityRequirement,
  DocumentPatch,
  EditorCommand,
  EditorCommandContext,
  EditorSelection,
  SelectionTransitionContext,
} from "../types.js";
import {
  semanticRoleMetadataMirrorPatches,
  type SemanticMetadataRole,
} from "../semanticRoleMirrors.js";
import {
  findContainerLocation,
  findElementLocation,
  findPlacementWrapperLocation,
  selectionForNode,
  type ContainerWrapper,
  type ElementLocation,
} from "./tree.js";

export class EditorCommandVocabularyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditorCommandVocabularyError";
  }
}

export interface CompleteFocalPoint {
  readonly x: number;
  readonly y: number;
}

function validateCompleteFocalPoint(value: CompleteFocalPoint): void {
  if (
    !Number.isFinite(value.x) || value.x < 0 || value.x > 1 ||
    !Number.isFinite(value.y) || value.y < 0 || value.y > 1
  ) {
    throw new EditorCommandVocabularyError("Image crop point must stay between 0 and 1");
  }
}

function rootPropertyPatch(
  document: CbbDocument,
  property: keyof CbbDocument,
  value: unknown,
): DocumentPatch {
  return {
    op: Object.prototype.hasOwnProperty.call(document, property) ? "replace" : "add",
    path: `/${String(property)}`,
    value,
  };
}

function escapedPointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

interface DefinitionOwnedCustomInstanceLocation {
  readonly instance: Extract<NativeElement, { readonly type: "customInstance" }>;
}

function findDefinitionOwnedCustomInstance(
  document: CbbDocument,
  instanceId: NodeId,
): DefinitionOwnedCustomInstanceLocation | undefined {
  function visit(element: NativeElement): DefinitionOwnedCustomInstanceLocation | undefined {
    if (element.id === instanceId) {
      return element.type === "customInstance" ? { instance: element } : undefined;
    }
    if (element.type !== "grid" && element.type !== "stack" && element.type !== "canvas") {
      return undefined;
    }
    for (const wrapper of element.children) {
      const found = visit(wrapper.element);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  for (const definition of document.customElementDefinitions ?? []) {
    for (const element of definition.elements) {
      const found = visit(element);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function mapCommandElement(
  element: NativeElement,
  transform: (element: NativeElement) => NativeElement,
): NativeElement {
  const nested = element.type === "grid" || element.type === "stack" || element.type === "canvas"
    ? {
        ...element,
        children: element.children.map((wrapper) => ({
          ...wrapper,
          element: mapCommandElement(wrapper.element, transform),
        })),
      } as NativeElement
    : element;
  return transform(nested);
}

function mapCommandElements(
  elements: readonly NativeElement[],
  transform: (element: NativeElement) => NativeElement,
): readonly NativeElement[] {
  return elements.map((element) => mapCommandElement(element, transform));
}

function updateDefinitionOwnedFieldValues(
  document: CbbDocument,
  instanceId: NodeId,
  fieldValues: CbbDocument["fieldValues"],
): readonly DocumentPatch[] {
  let found = false;
  const rawDefinitions = (document.customElementDefinitions ?? []).map((definition) => ({
    ...definition,
    elements: mapCommandElements(definition.elements, (element) => {
      if (element.id !== instanceId) return element;
      if (element.type !== "customInstance") {
        throw new EditorCommandVocabularyError("That Saved section is no longer available.");
      }
      found = true;
      if (fieldValues === undefined) {
        const { fieldValues: _removed, ...withoutValues } = element;
        return withoutValues;
      }
      return { ...element, fieldValues };
    }),
  }));
  if (!found) {
    throw new EditorCommandVocabularyError("That Saved section is no longer available.");
  }

  let finalized;
  try {
    finalized = finalizeCustomDefinitionRevisions({
      definitions: document.customElementDefinitions ?? [],
      elements: document.elements,
      ...(document.pageElements === undefined ? {} : { pageElements: document.pageElements }),
    }, {
      definitions: rawDefinitions,
      elements: document.elements,
      ...(document.pageElements === undefined ? {} : { pageElements: document.pageElements }),
    });
  } catch (error) {
    throw new EditorCommandVocabularyError(
      error instanceof Error
        ? error.message
        : "These Saved sections could not be revised safely.",
    );
  }
  const patches: DocumentPatch[] = [{
    op: "replace",
    path: "/customElementDefinitions",
    value: finalized.definitions,
  }];
  if (JSON.stringify(finalized.elements) !== JSON.stringify(document.elements)) {
    patches.push({ op: "replace", path: "/elements", value: finalized.elements });
  }
  if (
    finalized.pageElements !== undefined &&
    JSON.stringify(finalized.pageElements) !== JSON.stringify(document.pageElements)
  ) {
    patches.push({ op: "replace", path: "/pageElements", value: finalized.pageElements });
  }
  return patches;
}

type EditableFieldValueOwner =
  | { readonly kind: "document" }
  | { readonly kind: "customInstance"; readonly instanceId: NodeId };

function editableFieldValueOwner(
  document: CbbDocument,
  owner: EditableFieldValueOwner,
): {
  readonly contract: NonNullable<CbbDocument["fieldContract"]>;
  readonly values: CbbDocument["fieldValues"];
  readonly valueStorePath: string;
  readonly repeatRules: readonly ContentRule[];
  readonly definitionOwnedInstanceId?: NodeId;
} {
  if (owner.kind === "document") {
    if (document.fieldContract === undefined) {
      throw new EditorCommandVocabularyError("This bulletin has no weekly fields.");
    }
    return {
      contract: document.fieldContract,
      values: document.fieldValues,
      valueStorePath: "/fieldValues",
      repeatRules: document.contentRules ?? [],
    };
  }
  const location = findElementLocation(document, owner.instanceId);
  const definitionLocation = location === undefined
    ? findDefinitionOwnedCustomInstance(document, owner.instanceId)
    : undefined;
  const instance = location?.element ?? definitionLocation?.instance;
  if (instance?.type !== "customInstance") {
    throw new EditorCommandVocabularyError("That Saved section is no longer available.");
  }
  const definition = document.customElementDefinitions?.find(
    (candidate) => candidate.id === instance.definitionId,
  );
  if (definition === undefined) {
    throw new EditorCommandVocabularyError("That Saved section definition is unavailable.");
  }
  return {
    contract: definition.fieldContract,
    values: instance.fieldValues,
    valueStorePath: location === undefined ? "" : `${location.elementPath}/fieldValues`,
    repeatRules: definition.contentRules ?? [],
    ...(location === undefined ? { definitionOwnedInstanceId: instance.id } : {}),
  };
}

function createSetFieldValueCommand(input: {
  readonly owner: EditableFieldValueOwner;
  readonly fieldId: FieldId;
  readonly value: unknown;
}): EditorCommand {
  const target = input.owner.kind === "document"
    ? { kind: "document" as const }
    : { kind: "node" as const, nodeId: input.owner.instanceId };
  return {
    id: `field.setValue:${input.owner.kind}:${input.fieldId}`,
    label: "Change weekly field value",
    capabilities: [{ capability: "content.edit", target }],
    createPatches: ({ document }) => {
      const owner = editableFieldValueOwner(document, input.owner);
      const field = owner.contract.fields.find((candidate) => candidate.id === input.fieldId);
      if (field === undefined) {
        throw new EditorCommandVocabularyError(
          "That weekly field is no longer available.",
        );
      }

      const values = owner.values;
      const entry = values?.[input.fieldId];
      const path = `${owner.valueStorePath}/${escapedPointerSegment(input.fieldId)}`;
      const withMetadataMirror = (
        patches: readonly DocumentPatch[],
        nextValues: CbbDocument["fieldValues"],
      ): readonly DocumentPatch[] => input.owner.kind !== "document" ||
        field.semanticRole === undefined
        ? patches
        : [
            ...patches,
            ...semanticRoleMetadataMirrorPatches({
              document,
              contract: owner.contract,
              values: nextValues,
              roles: [field.semanticRole],
            }),
          ];
      if (input.value === undefined) {
        const nextValues = values === undefined
          ? undefined
          : Object.fromEntries(Object.entries(values).filter(([fieldId]) =>
              fieldId !== input.fieldId));
        const normalized = nextValues !== undefined && Object.keys(nextValues).length === 0
          ? undefined
          : nextValues;
        const valuePatches: readonly DocumentPatch[] = entry === undefined
          ? []
          : owner.definitionOwnedInstanceId !== undefined
            ? updateDefinitionOwnedFieldValues(
                document,
                owner.definitionOwnedInstanceId,
                normalized,
              )
            : Object.keys(values ?? {}).length === 1
              ? [{ op: "remove", path: owner.valueStorePath }]
              : [{ op: "remove", path }];
        return withMetadataMirror(valuePatches, normalized);
      }
      if (!validateFieldValue(field, input.value)) {
        throw new EditorCommandVocabularyError(
          `Enter a valid value for ${field.label}.`,
        );
      }
      if (field.type === "array") {
        throw new EditorCommandVocabularyError(
          `${field.label} needs a dedicated repeated-item editor.`,
        );
      }

      const nextEntry = { value: input.value, origin: "manual" as const };
      const nextValues = { ...(values ?? {}), [input.fieldId]: nextEntry };
      if (owner.definitionOwnedInstanceId !== undefined) {
        return updateDefinitionOwnedFieldValues(
          document,
          owner.definitionOwnedInstanceId,
          nextValues,
        );
      }
      if (values === undefined) {
        return withMetadataMirror([{
          op: "add",
          path: owner.valueStorePath,
          value: { [input.fieldId]: nextEntry },
        }], nextValues);
      }
      return withMetadataMirror([{
        op: entry === undefined ? "add" : "replace",
        path,
        value: nextEntry,
      }], nextValues);
    },
    selectAfter: {
      kind: "field",
      fieldId: input.fieldId,
      ...(input.owner.kind === "customInstance"
        ? { ownerNodeId: input.owner.instanceId }
        : {}),
    },
  };
}

/**
 * Set or clear one top-level weekly field value. Undefined clears the stored
 * entry so a declared default can become effective again.
 */
export function createSetDocumentFieldValueCommand(input: {
  readonly fieldId: FieldId;
  readonly value: unknown;
}): EditorCommand {
  return createSetFieldValueCommand({ owner: { kind: "document" }, ...input });
}

export function createSetCustomInstanceFieldValueCommand(input: {
  readonly instanceId: NodeId;
  readonly fieldId: FieldId;
  readonly value: unknown;
}): EditorCommand {
  return createSetFieldValueCommand({
    owner: { kind: "customInstance", instanceId: input.instanceId },
    fieldId: input.fieldId,
    value: input.value,
  });
}

type DocumentArrayMutation =
  | { readonly kind: "add"; readonly value: unknown }
  | { readonly kind: "update"; readonly index: number; readonly value: unknown }
  | { readonly kind: "remove"; readonly index: number }
  | { readonly kind: "reorder"; readonly fromIndex: number; readonly toIndex: number };

function validArraySource(
  field: FieldDefinition,
  entry: FieldValueEntry | undefined,
): readonly unknown[] {
  const value = entry?.value ?? field.default ?? [];
  if (!Array.isArray(value) || field.itemField === undefined ||
    !value.every((item) => validateFieldValue(field.itemField as FieldDefinition, item))) {
    throw new EditorCommandVocabularyError(
      `The current ${field.label} list cannot be edited safely.`,
    );
  }
  return value;
}

function stableArrayItemIds(
  entry: FieldValueEntry | undefined,
  length: number,
  idPort: IdPort,
): readonly string[] {
  const itemIds = entry?.itemIds;
  if (itemIds !== undefined && itemIds.length === length &&
    itemIds.every(isRepeatItemId) && new Set(itemIds).size === itemIds.length) {
    return itemIds;
  }
  const used = new Set<string>();
  return Array.from({ length }, () => {
    for (;;) {
      const id = idPort.randomUuid();
      if (isRepeatItemId(id) && !used.has(id)) {
        used.add(id);
        return id;
      }
    }
  });
}

function createMutateDocumentArrayFieldCommand(input: {
  readonly owner?: EditableFieldValueOwner;
  readonly fieldId: FieldId;
  readonly idPort: IdPort;
  readonly mutation: DocumentArrayMutation;
}): EditorCommand {
  const declaredOwner = input.owner ?? { kind: "document" as const };
  const target = declaredOwner.kind === "document"
    ? { kind: "document" as const }
    : { kind: "node" as const, nodeId: declaredOwner.instanceId };
  return {
    id: `field.mutateArray:${declaredOwner.kind}:${input.fieldId}:${input.mutation.kind}`,
    label: "Change repeated weekly field",
    capabilities: [{ capability: "content.manageRepeatItems", target }],
    createPatches: ({ document }) => {
      const owner = editableFieldValueOwner(document, declaredOwner);
      const field = owner.contract.fields.find(
        (candidate) => candidate.id === input.fieldId,
      );
      if (field === undefined || field.type !== "array" || field.itemField === undefined) {
        throw new EditorCommandVocabularyError(
          "That repeated weekly field is no longer available.",
        );
      }
      const entry = owner.values?.[field.id];
      const values = [...validArraySource(field, entry)];
      const itemIds = [...stableArrayItemIds(entry, values.length, input.idPort)];
      const mutation = input.mutation;
      const repeatRules = owner.repeatRules.filter(
        (rule) => rule.kind === "repeat" && rule.fieldId === field.id,
      );

      if (mutation.kind === "add") {
        if (!validateFieldValue(field.itemField, mutation.value)) {
          throw new EditorCommandVocabularyError(
            `Enter a valid ${field.itemField.label}.`,
          );
        }
        values.push(mutation.value);
        const used = new Set(itemIds);
        for (;;) {
          const id = input.idPort.randomUuid();
          if (isRepeatItemId(id) && !used.has(id)) {
            itemIds.push(id);
            break;
          }
        }
      } else if (mutation.kind === "update") {
        if (!Number.isInteger(mutation.index) || mutation.index < 0 || mutation.index >= values.length) {
          throw new EditorCommandVocabularyError("Choose a repeated item that still exists.");
        }
        if (!validateFieldValue(field.itemField, mutation.value)) {
          throw new EditorCommandVocabularyError(
            `Enter a valid ${field.itemField.label}.`,
          );
        }
        values[mutation.index] = mutation.value;
      } else if (mutation.kind === "remove") {
        if (!Number.isInteger(mutation.index) || mutation.index < 0 || mutation.index >= values.length) {
          throw new EditorCommandVocabularyError("Choose a repeated item that still exists.");
        }
        values.splice(mutation.index, 1);
        itemIds.splice(mutation.index, 1);
      } else {
        if (repeatRules.some((rule) => rule.kind === "repeat" && !rule.userReorderable)) {
          throw new EditorCommandVocabularyError(
            `${field.label} is not configured for volunteer reordering.`,
          );
        }
        if (!Number.isInteger(mutation.fromIndex) || !Number.isInteger(mutation.toIndex) ||
          mutation.fromIndex < 0 || mutation.fromIndex >= values.length ||
          mutation.toIndex < 0 || mutation.toIndex >= values.length) {
          throw new EditorCommandVocabularyError("Choose valid repeated-item positions.");
        }
        if (mutation.fromIndex === mutation.toIndex) return [];
        const [value] = values.splice(mutation.fromIndex, 1);
        const [itemId] = itemIds.splice(mutation.fromIndex, 1);
        values.splice(mutation.toIndex, 0, value);
        itemIds.splice(mutation.toIndex, 0, itemId as string);
      }

      if (!validateFieldValue(field, values)) {
        throw new EditorCommandVocabularyError(
          `${field.label} must stay within its allowed list size and item rules.`,
        );
      }
      if (repeatRules.some((rule) => rule.kind === "repeat" && values.length > rule.maxItems)) {
        throw new EditorCommandVocabularyError(
          `${field.label} has reached the template’s repeated-item limit.`,
        );
      }
      const nextEntry = {
        value: values,
        origin: "manual" as const,
        itemIds,
      };
      const fieldValues = owner.values;
      if (owner.definitionOwnedInstanceId !== undefined) {
        return updateDefinitionOwnedFieldValues(
          document,
          owner.definitionOwnedInstanceId,
          { ...(fieldValues ?? {}), [field.id]: nextEntry },
        );
      }
      if (fieldValues === undefined) {
        return [{
          op: "add",
          path: owner.valueStorePath,
          value: { [field.id]: nextEntry },
        }];
      }
      return [{
        op: entry === undefined ? "add" : "replace",
        path: `${owner.valueStorePath}/${escapedPointerSegment(field.id)}`,
        value: nextEntry,
      }];
    },
    selectAfter: {
      kind: "field",
      fieldId: input.fieldId,
      ...(declaredOwner.kind === "customInstance"
        ? { ownerNodeId: declaredOwner.instanceId }
        : {}),
    },
  };
}

export function createAddDocumentArrayItemCommand(input: {
  readonly fieldId: FieldId;
  readonly value: unknown;
  readonly idPort: IdPort;
}): EditorCommand {
  return createMutateDocumentArrayFieldCommand({
    fieldId: input.fieldId,
    idPort: input.idPort,
    mutation: { kind: "add", value: input.value },
  });
}

export function createUpdateDocumentArrayItemCommand(input: {
  readonly fieldId: FieldId;
  readonly index: number;
  readonly value: unknown;
  readonly idPort: IdPort;
}): EditorCommand {
  return createMutateDocumentArrayFieldCommand({
    fieldId: input.fieldId,
    idPort: input.idPort,
    mutation: { kind: "update", index: input.index, value: input.value },
  });
}

export function createRemoveDocumentArrayItemCommand(input: {
  readonly fieldId: FieldId;
  readonly index: number;
  readonly idPort: IdPort;
}): EditorCommand {
  return createMutateDocumentArrayFieldCommand({
    fieldId: input.fieldId,
    idPort: input.idPort,
    mutation: { kind: "remove", index: input.index },
  });
}

export function createReorderDocumentArrayItemCommand(input: {
  readonly fieldId: FieldId;
  readonly fromIndex: number;
  readonly toIndex: number;
  readonly idPort: IdPort;
}): EditorCommand {
  return createMutateDocumentArrayFieldCommand({
    fieldId: input.fieldId,
    idPort: input.idPort,
    mutation: { kind: "reorder", fromIndex: input.fromIndex, toIndex: input.toIndex },
  });
}

export function createAddCustomInstanceArrayItemCommand(input: {
  readonly instanceId: NodeId;
  readonly fieldId: FieldId;
  readonly value: unknown;
  readonly idPort: IdPort;
}): EditorCommand {
  return createMutateDocumentArrayFieldCommand({
    owner: { kind: "customInstance", instanceId: input.instanceId },
    fieldId: input.fieldId,
    idPort: input.idPort,
    mutation: { kind: "add", value: input.value },
  });
}

export function createUpdateCustomInstanceArrayItemCommand(input: {
  readonly instanceId: NodeId;
  readonly fieldId: FieldId;
  readonly index: number;
  readonly value: unknown;
  readonly idPort: IdPort;
}): EditorCommand {
  return createMutateDocumentArrayFieldCommand({
    owner: { kind: "customInstance", instanceId: input.instanceId },
    fieldId: input.fieldId,
    idPort: input.idPort,
    mutation: { kind: "update", index: input.index, value: input.value },
  });
}

export function createRemoveCustomInstanceArrayItemCommand(input: {
  readonly instanceId: NodeId;
  readonly fieldId: FieldId;
  readonly index: number;
  readonly idPort: IdPort;
}): EditorCommand {
  return createMutateDocumentArrayFieldCommand({
    owner: { kind: "customInstance", instanceId: input.instanceId },
    fieldId: input.fieldId,
    idPort: input.idPort,
    mutation: { kind: "remove", index: input.index },
  });
}

export function createReorderCustomInstanceArrayItemCommand(input: {
  readonly instanceId: NodeId;
  readonly fieldId: FieldId;
  readonly fromIndex: number;
  readonly toIndex: number;
  readonly idPort: IdPort;
}): EditorCommand {
  return createMutateDocumentArrayFieldCommand({
    owner: { kind: "customInstance", instanceId: input.instanceId },
    fieldId: input.fieldId,
    idPort: input.idPort,
    mutation: { kind: "reorder", fromIndex: input.fromIndex, toIndex: input.toIndex },
  });
}

export function createSetDocumentPublicationSettingsCommand(input: {
  readonly scripturePresentation: ScripturePresentationSettings;
  readonly rightsPolicy: RightsPolicy;
  readonly publicationContexts: readonly PublicationContext[];
}): EditorCommand {
  return {
    id: "document.publicationSettings",
    label: "Change Scripture and sharing settings",
    capabilities: [{ capability: "template.editLifecycle", target: { kind: "document" } }],
    createPatches: ({ document }) => [
      rootPropertyPatch(document, "scripturePresentation", input.scripturePresentation),
      rootPropertyPatch(document, "rightsPolicy", input.rightsPolicy),
      rootPropertyPatch(document, "publicationContexts", input.publicationContexts),
    ],
    selectAfter: { kind: "document" },
  };
}

export function createSetRightsAttributionOptionsCommand(input: {
  readonly nodeId: NodeId;
  readonly heading: string;
  readonly groupOrder: readonly ("scripture" | "music" | "other")[];
  readonly sortPolicy: "firstAppearance";
  readonly includePublicDomainLines: boolean;
}): EditorCommand {
  return {
    id: "rightsAttribution.options",
    label: "Change Copyrights & Permissions settings",
    capabilities: [
      { capability: "layout.edit", target: nodeTarget(input.nodeId) },
      { capability: "template.editLifecycle", target: nodeTarget(input.nodeId) },
    ],
    createPatches: ({ document }) => {
      const location = requireLocation(document, input.nodeId);
      if (location.element.type !== "rightsAttribution") {
        throw new EditorCommandVocabularyError("Selected item is not Copyrights & Permissions");
      }
      const heading = input.heading.normalize("NFC").trim();
      if (heading.length < 1 || [...heading].length > 120) {
        throw new EditorCommandVocabularyError("Enter a heading from 1 through 120 characters.");
      }
      const requiredGroups = ["scripture", "music", "other"] as const;
      if (new Set(input.groupOrder).size !== 3 ||
        !requiredGroups.every((group) => input.groupOrder.includes(group))) {
        throw new EditorCommandVocabularyError("Choose each credit group exactly once.");
      }
      const headingBinding = matchingBinding(location, ["/data/heading"]);
      const publicDomainBinding = matchingBinding(
        location,
        ["/data/includePublicDomainLines"],
      );
      const updates: { readonly binding: Binding; readonly value: unknown }[] = [];
      if (headingBinding !== undefined) updates.push({ binding: headingBinding, value: heading });
      if (publicDomainBinding !== undefined) {
        updates.push({ binding: publicDomainBinding, value: input.includePublicDomainLines });
      }
      const {
        heading: _currentHeading,
        includePublicDomainLines: _currentPublicDomainLines,
        ...otherData
      } = location.element.data;
      return [
        ...fieldValuePatches(document, location, updates),
        {
        op: "replace",
        path: `${location.elementPath}/data`,
        value: {
          ...otherData,
          ...(headingBinding === undefined ? { heading } : {}),
          groupOrder: [...input.groupOrder],
          sortPolicy: input.sortPolicy,
          ...(publicDomainBinding === undefined
            ? { includePublicDomainLines: input.includePublicDomainLines }
            : {}),
        },
        },
      ];
    },
    selectAfter: selectionForNode(input.nodeId),
  };
}

function selectionAfterPlacementEdit(
  context: SelectionTransitionContext,
  nodeId: NodeId,
): EditorSelection {
  const location = findElementLocation(context.document, nodeId);
  const wrapperId = location === undefined || location.parent.kind === "body"
    ? undefined
    : location.parent.wrapper.id;
  return wrapperId !== undefined &&
      context.selection.kind === "node" &&
      context.selection.nodeId === wrapperId
    ? context.selection
    : selectionForNode(nodeId);
}

export type MoveDestination =
  | { readonly kind: "body"; readonly index: number }
  | {
      readonly kind: "grid";
      readonly containerId: NodeId;
      readonly row: number;
      readonly column: number;
      readonly wrapperId?: NodeId;
    }
  | {
      readonly kind: "stack";
      readonly containerId: NodeId;
      readonly index: number;
      readonly wrapperId?: NodeId;
    }
  | {
      readonly kind: "canvas";
      readonly containerId: NodeId;
      readonly x: CanvasPosition;
      readonly y: CanvasPosition;
      readonly wrapperId?: NodeId;
    };

function nodeTarget(nodeId: NodeId) {
  return { kind: "node" as const, nodeId };
}

function requireLocation(document: CbbDocument, nodeId: NodeId): ElementLocation {
  const location = findElementLocation(document, nodeId);
  if (location === undefined) {
    throw new EditorCommandVocabularyError(`Item '${nodeId}' is no longer in the document`);
  }
  return location;
}

function placementRequirement(location: ElementLocation): CapabilityRequirement | undefined {
  if (
    location.parent.kind === "grid" ||
    location.parent.kind === "stack" ||
    location.parent.kind === "canvas" ||
    location.parent.kind === "page"
  ) {
    return {
      capability: "layout.editPlacement",
      target: nodeTarget(location.parent.wrapper.id),
    };
  }
  return undefined;
}

function structuralRequirements(
  context: EditorCommandContext,
  nodeId: NodeId,
): readonly CapabilityRequirement[] {
  const location = requireLocation(context.document, nodeId);
  const placement = placementRequirement(location);
  return [
    { capability: "layout.editStructure", target: nodeTarget(nodeId) },
    ...(placement === undefined ? [] : [placement]),
  ];
}

function destinationRequirements(destination: MoveDestination): readonly CapabilityRequirement[] {
  if (destination.kind === "body") {
    return [{ capability: "layout.editStructure" }];
  }
  return [
    {
      capability: "layout.editStructure",
      target: nodeTarget(destination.containerId),
    },
  ];
}

function mintNodeId(idPort: IdPort, used: Set<string>): NodeId {
  for (;;) {
    const candidate = `n${idPort.randomUuid().replaceAll("-", "")}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

interface ExtractedElement {
  readonly element: NativeElement;
  readonly wrapper?: ContainerWrapper;
  readonly elements: readonly NativeElement[];
}

function normalizeStackChildren(
  children: readonly StackChildWrapper[],
): readonly StackChildWrapper[] {
  return children.map((wrapper, index) =>
    wrapper.index === index ? wrapper : { ...wrapper, index },
  );
}

function extractFromElement(
  element: NativeElement,
  nodeId: NodeId,
): { readonly element: NativeElement; readonly extracted?: NativeElement; readonly wrapper?: ContainerWrapper } {
  if (
    element.type !== "grid" &&
    element.type !== "stack" &&
    element.type !== "canvas"
  ) {
    return { element };
  }

  for (const [index, wrapper] of element.children.entries()) {
    if (wrapper.element.id === nodeId) {
      const remaining = element.children.filter((_, childIndex) => childIndex !== index);
      if (element.type === "stack") {
        return {
          element: { ...element, children: normalizeStackChildren(remaining as readonly StackChildWrapper[]) },
          extracted: wrapper.element,
          wrapper,
        };
      }
      return { element: { ...element, children: remaining } as NativeElement, extracted: wrapper.element, wrapper };
    }
    const nested = extractFromElement(wrapper.element, nodeId);
    if (nested.extracted !== undefined) {
      const children = element.children.map((entry, childIndex) =>
        childIndex === index ? { ...entry, element: nested.element } : entry,
      );
      return {
        element: { ...element, children } as NativeElement,
        extracted: nested.extracted,
        ...(nested.wrapper === undefined ? {} : { wrapper: nested.wrapper }),
      };
    }
  }
  return { element };
}

function extractElement(
  elements: readonly NativeElement[],
  nodeId: NodeId,
): ExtractedElement {
  const topIndex = elements.findIndex((element) => element.id === nodeId);
  if (topIndex >= 0) {
    const element = elements[topIndex];
    if (element === undefined) throw new EditorCommandVocabularyError("Move source disappeared");
    return {
      element,
      elements: elements.filter((_, index) => index !== topIndex),
    };
  }
  for (const [index, root] of elements.entries()) {
    const nested = extractFromElement(root, nodeId);
    if (nested.extracted !== undefined) {
      return {
        element: nested.extracted,
        ...(nested.wrapper === undefined ? {} : { wrapper: nested.wrapper }),
        elements: elements.map((entry, rootIndex) =>
          rootIndex === index ? nested.element : entry,
        ),
      };
    }
  }
  throw new EditorCommandVocabularyError(`Item '${nodeId}' cannot be moved from this document`);
}

function baseWrapper(
  wrapper: ContainerWrapper | undefined,
  wrapperId: NodeId | undefined,
  element: NativeElement,
): { readonly id: NodeId; readonly element: NativeElement; readonly authoringPolicy?: AuthoringPolicy } {
  const id = wrapperId ?? wrapper?.id;
  if (id === undefined) {
    throw new EditorCommandVocabularyError("Moving a body item into a container requires a wrapper id");
  }
  return {
    id,
    element,
    ...(wrapper?.authoringPolicy === undefined
      ? {}
      : { authoringPolicy: wrapper.authoringPolicy }),
  };
}

function insertAtDestination(
  elements: readonly NativeElement[],
  element: NativeElement,
  oldWrapper: ContainerWrapper | undefined,
  destination: MoveDestination,
): readonly NativeElement[] {
  if (destination.kind === "body") {
    const index = Math.max(0, Math.min(destination.index, elements.length));
    return [...elements.slice(0, index), element, ...elements.slice(index)];
  }

  const containerDestination = destination;
  let inserted = false;
  function visit(candidate: NativeElement): NativeElement {
    if (candidate.id === containerDestination.containerId) {
      if (
        candidate.type !== "grid" &&
        candidate.type !== "stack" &&
        candidate.type !== "canvas"
      ) {
        throw new EditorCommandVocabularyError("Move destination is not a container");
      }
      if (element.type === "pageBreak") {
        throw new EditorCommandVocabularyError("Page breaks can only be placed in the top-level flow");
      }
      inserted = true;
      const common = baseWrapper(oldWrapper, containerDestination.wrapperId, element);
      if (containerDestination.kind === "grid" && candidate.type === "grid") {
        if (
          candidate.children.some(
            (child) => child.row === containerDestination.row && child.column === containerDestination.column,
          )
        ) {
          throw new EditorCommandVocabularyError("That grid cell already contains an item");
        }
        const wrapper: GridChildWrapper = {
          ...common,
          row: containerDestination.row,
          column: containerDestination.column,
        };
        return { ...candidate, children: [...candidate.children, wrapper] };
      }
      if (containerDestination.kind === "stack" && candidate.type === "stack") {
        const index = Math.max(0, Math.min(containerDestination.index, candidate.children.length));
        const wrapper: StackChildWrapper = { ...common, index };
        return {
          ...candidate,
          children: normalizeStackChildren([
            ...candidate.children.slice(0, index),
            wrapper,
            ...candidate.children.slice(index),
          ]),
        };
      }
      if (containerDestination.kind === "canvas" && candidate.type === "canvas") {
        const semanticOrders = candidate.children
          .map((child) => child.semanticOrder)
          .filter((order): order is number => order !== undefined);
        const wrapper: CanvasChildWrapper = {
          ...common,
          x: containerDestination.x,
          y: containerDestination.y,
          ...(semanticOrders.length === candidate.children.length && candidate.children.length > 0
            ? { semanticOrder: Math.max(...semanticOrders) + 1 }
            : {}),
        };
        return { ...candidate, children: [...candidate.children, wrapper] };
      }
      throw new EditorCommandVocabularyError("Move destination type does not match its container");
    }

    if (
      candidate.type !== "grid" &&
      candidate.type !== "stack" &&
      candidate.type !== "canvas"
    ) {
      return candidate;
    }
    let changed = false;
    const children = candidate.children.map((wrapper) => {
      const nextElement = visit(wrapper.element);
      if (nextElement === wrapper.element) return wrapper;
      changed = true;
      return { ...wrapper, element: nextElement };
    });
    return changed ? ({ ...candidate, children } as NativeElement) : candidate;
  }

  const next = elements.map(visit);
  if (!inserted) {
    throw new EditorCommandVocabularyError("Move destination is inside the moved item or no longer exists");
  }
  return next;
}

interface DocumentElementTree {
  readonly elements: readonly NativeElement[];
  readonly pageElements: readonly PageLevelWrapper[];
}

interface ExtractedDocumentElement extends DocumentElementTree {
  readonly element: NativeElement;
  readonly wrapper?: ContainerWrapper;
}

function sameEntries<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function extractDocumentElement(
  document: CbbDocument,
  location: ElementLocation,
  nodeId: NodeId,
): ExtractedDocumentElement {
  if (location.elementPath.startsWith("/elements/")) {
    const extracted = extractElement(document.elements, nodeId);
    return {
      element: extracted.element,
      ...(extracted.wrapper === undefined ? {} : { wrapper: extracted.wrapper }),
      elements: extracted.elements,
      pageElements: document.pageElements ?? [],
    };
  }

  const currentPageElements = document.pageElements ?? [];
  for (const [pageIndex, pageWrapper] of currentPageElements.entries()) {
    const nested = extractFromElement(pageWrapper.element, nodeId);
    if (nested.extracted === undefined) continue;
    return {
      element: nested.extracted,
      ...(nested.wrapper === undefined ? {} : { wrapper: nested.wrapper }),
      elements: document.elements,
      pageElements: currentPageElements.map((entry, index) =>
        index === pageIndex
          ? { ...entry, element: nested.element as PageContentElement }
          : entry,
      ),
    };
  }

  throw new EditorCommandVocabularyError(
    `Item '${nodeId}' cannot be moved from this document`,
  );
}

function insertAtDocumentDestination(
  tree: DocumentElementTree,
  element: NativeElement,
  oldWrapper: ContainerWrapper | undefined,
  destination: MoveDestination,
): DocumentElementTree {
  if (destination.kind === "body") {
    return {
      elements: insertAtDestination(
        tree.elements,
        element,
        oldWrapper,
        destination,
      ),
      pageElements: tree.pageElements,
    };
  }

  const roots: readonly NativeElement[] = [
    ...tree.elements,
    ...tree.pageElements.map((wrapper) => wrapper.element as NativeElement),
  ];
  const nextRoots = insertAtDestination(roots, element, oldWrapper, destination);
  const bodyCount = tree.elements.length;
  const nextBodyRoots = nextRoots.slice(0, bodyCount);
  const nextElements = sameEntries(tree.elements, nextBodyRoots)
    ? tree.elements
    : nextBodyRoots;
  const nextPageElements = tree.pageElements.map((wrapper, index) => {
    const nextElement = nextRoots[bodyCount + index];
    if (nextElement === undefined) {
      throw new EditorCommandVocabularyError("Page item disappeared during insertion");
    }
    return nextElement === wrapper.element
      ? wrapper
      : { ...wrapper, element: nextElement as PageContentElement };
  });

  return {
    elements: nextElements,
    pageElements: sameEntries(tree.pageElements, nextPageElements)
      ? tree.pageElements
      : nextPageElements,
  };
}

function replaceDocumentTreePatches(
  document: CbbDocument,
  tree: DocumentElementTree,
): readonly DocumentPatch[] {
  const patches: DocumentPatch[] = [];
  if (!sameEntries(document.elements, tree.elements)) {
    patches.push({ op: "replace", path: "/elements", value: tree.elements });
  }
  const currentPageElements = document.pageElements ?? [];
  if (!sameEntries(currentPageElements, tree.pageElements)) {
    patches.push({
      op: document.pageElements === undefined ? "add" : "replace",
      path: "/pageElements",
      value: tree.pageElements,
    });
  }
  return patches;
}

function elementContainsNode(element: NativeElement, nodeId: NodeId): boolean {
  if (element.id === nodeId) return true;
  if (
    element.type !== "grid" &&
    element.type !== "stack" &&
    element.type !== "canvas"
  ) {
    return false;
  }
  return element.children.some((wrapper) =>
    elementContainsNode(wrapper.element, nodeId),
  );
}

function elementRightsAttributionCount(
  document: CbbDocument,
  element: NativeElement,
  visitingDefinitions: ReadonlySet<NodeId> = new Set(),
): number {
  if (element.type === "rightsAttribution") return 1;
  if (element.type === "customInstance") {
    if (visitingDefinitions.has(element.definitionId)) return 0;
    const definition = document.customElementDefinitions?.find(
      (candidate) => candidate.id === element.definitionId,
    );
    if (definition === undefined) return 0;
    const visiting = new Set(visitingDefinitions);
    visiting.add(element.definitionId);
    return definition.elements.reduce(
      (count, child) => count + elementRightsAttributionCount(document, child, visiting),
      0,
    );
  }
  if (element.type !== "grid" && element.type !== "stack" && element.type !== "canvas") {
    return 0;
  }
  return element.children.reduce(
    (count, wrapper) => count + elementRightsAttributionCount(
      document,
      wrapper.element,
      visitingDefinitions,
    ),
    0,
  );
}

function activeRightsAttributionCount(document: CbbDocument): number {
  return [
    ...document.elements,
    ...(document.pageElements ?? []).map((wrapper) => wrapper.element),
  ].reduce(
    (count, element) => count + elementRightsAttributionCount(document, element),
    0,
  );
}

/** Whether the rendered document already contains its one credits block. */
export function documentHasActiveRightsAttribution(document: CbbDocument): boolean {
  return activeRightsAttributionCount(document) > 0;
}

function assertDestinationIsOutsideMovedElement(
  element: NativeElement,
  destination: MoveDestination,
): void {
  if (
    destination.kind !== "body" &&
    elementContainsNode(element, destination.containerId)
  ) {
    throw new EditorCommandVocabularyError(
      "Move destination is inside the moved item",
    );
  }
}

function replaceElementsPatch(elements: readonly NativeElement[]): readonly DocumentPatch[] {
  return [{ op: "replace", path: "/elements", value: elements }];
}

export function createAddElementCommand(input: {
  readonly element: NativeElement;
  readonly destination: MoveDestination;
}): EditorCommand {
  return {
    id: "element.add",
    label: `Add ${input.element.name}`,
    capabilities: destinationRequirements(input.destination),
    createPatches: ({ document }) => {
      const incomingRights = elementRightsAttributionCount(document, input.element);
      if (incomingRights > 1 || (incomingRights === 1 && documentHasActiveRightsAttribution(document))) {
        throw new EditorCommandVocabularyError(
          "This bulletin already has Copyrights & Permissions. Move or edit that block instead.",
        );
      }
      if (collectAllNodeIds(document).has(input.element.id)) {
        throw new EditorCommandVocabularyError(`Item id '${input.element.id}' is already used`);
      }
      const tree = insertAtDocumentDestination(
        {
          elements: document.elements,
          pageElements: document.pageElements ?? [],
        },
        input.element,
        undefined,
        input.destination,
      );
      return replaceDocumentTreePatches(document, tree);
    },
    selectAfter: selectionForNode(input.element.id),
  };
}

export function createAddRightsAttributionCommand(input: {
  readonly nodeId: NodeId;
  readonly destination: MoveDestination;
  readonly heading?: string;
  readonly groupOrder?: readonly [
    "scripture" | "music" | "other",
    "scripture" | "music" | "other",
    "scripture" | "music" | "other",
  ];
  readonly includePublicDomainLines?: boolean;
}): EditorCommand {
  const heading = input.heading?.normalize("NFC").trim() || "Copyrights & Permissions";
  if ([...heading].length > 120) {
    throw new EditorCommandVocabularyError("Enter a heading from 1 through 120 characters.");
  }
  const groupOrder = input.groupOrder ?? ["scripture", "music", "other"];
  const requiredGroups = ["scripture", "music", "other"] as const;
  if (new Set(groupOrder).size !== 3 ||
    !requiredGroups.every((group) => groupOrder.includes(group))) {
    throw new EditorCommandVocabularyError("Choose each credit group exactly once.");
  }
  const base = createAddElementCommand({
    destination: input.destination,
    element: {
      id: input.nodeId,
      type: "rightsAttribution",
      name: "Copyrights & Permissions",
      data: {
        heading,
        groupOrder: [...groupOrder],
        sortPolicy: "firstAppearance",
        includePublicDomainLines: input.includePublicDomainLines ?? true,
      },
    },
  });
  return {
    ...base,
    id: "rightsAttribution.add",
    label: "Add Copyrights & Permissions",
  };
}

export function createAddPageElementCommand(input: {
  readonly wrapper: PageLevelWrapper;
}): EditorCommand {
  return {
    id: "pageElement.add",
    label: `Add ${input.wrapper.element.name}`,
    capabilities: [
      { capability: "layout.editStructure" },
      { capability: "layout.editPageSetup" },
    ],
    createPatches: ({ document }) => {
      const existing = collectAllNodeIds(document);
      const incoming = collectAllNodeIds({
        ...document,
        elements: [],
        pageElements: [input.wrapper],
        customElementDefinitions: [],
      });
      for (const id of incoming) {
        if (existing.has(id)) throw new EditorCommandVocabularyError(`Item id '${id}' is already used`);
      }
      const pageElements = [...(document.pageElements ?? []), input.wrapper];
      return [{
        op: document.pageElements === undefined ? "add" : "replace",
        path: "/pageElements",
        value: pageElements,
      }];
    },
    selectAfter: selectionForNode(input.wrapper.id),
  };
}

export function createDeleteElementCommand(nodeId: NodeId): EditorCommand {
  let fallbackNodeId: NodeId | undefined;
  return {
    id: "element.delete",
    label: "Delete item",
    capabilities: (context) => structuralRequirements(context, nodeId),
    createPatches: ({ document }) => {
      const location = requireLocation(document, nodeId);
      if (location.parent.kind === "page") {
        const wrapperIndex = location.parent.wrapperIndex;
        const pages = (document.pageElements ?? []).filter(
          (_, index) => index !== wrapperIndex,
        );
        fallbackNodeId = undefined;
        return [{ op: "replace", path: "/pageElements", value: pages }];
      }
      const extracted = extractDocumentElement(document, location, nodeId);
      if (
        location.parent.kind === "grid" ||
        location.parent.kind === "stack" ||
        location.parent.kind === "canvas"
      ) {
        fallbackNodeId = location.parent.containerId;
      } else {
        const locationAfter = extracted.elements.at(
          Math.min(location.parent.index, extracted.elements.length - 1),
        );
        fallbackNodeId = locationAfter?.id;
      }
      return replaceDocumentTreePatches(document, extracted);
    },
    selectAfter: () =>
      fallbackNodeId === undefined
        ? { kind: "document" }
        : selectionForNode(fallbackNodeId),
  };
}

export function createDuplicateElementCommand(input: {
  readonly nodeId: NodeId;
  readonly idPort: IdPort;
}): EditorCommand {
  let duplicateId: NodeId | undefined;
  return {
    id: "element.duplicate",
    label: "Duplicate item",
    capabilities: (context) => structuralRequirements(context, input.nodeId),
    createPatches: ({ document }) => {
      const location = requireLocation(document, input.nodeId);
      if (elementRightsAttributionCount(document, location.element) > 0) {
        throw new EditorCommandVocabularyError(
          "Copyrights & Permissions is unique. Move or edit it instead of duplicating it.",
        );
      }
      if (location.parent.kind === "page") {
        const duplicate = remintIds(
          location.element,
          collectAllNodeIds(document),
          input.idPort,
          true,
        );
        if (duplicate.type === "pageBreak" || duplicate.type === "customInstance") {
          throw new EditorCommandVocabularyError("That item cannot be placed at page level");
        }
        duplicateId = duplicate.id;
        const used = new Set(collectAllNodeIds({
          ...document,
          elements: [...document.elements, duplicate],
        }));
        const wrapperId = mintNodeId(input.idPort, used);
        const pageElements = [...(document.pageElements ?? [])];
        pageElements.splice(location.parent.wrapperIndex + 1, 0, {
          ...location.parent.wrapper,
          id: wrapperId,
          element: duplicate as PageContentElement,
        });
        return [{ op: "replace", path: "/pageElements", value: pageElements }];
      }
      const duplicate = remintIds(
        location.element,
        collectAllNodeIds(document),
        input.idPort,
        true,
      );
      duplicateId = duplicate.id;
      if (location.parent.kind === "body") {
        const elements = [...document.elements];
        elements.splice(location.parent.index + 1, 0, duplicate);
        return replaceElementsPatch(elements);
      }

      const used = new Set(
        collectAllNodeIds({
          ...document,
          elements: [...document.elements, duplicate],
        }),
      );
      const wrapperId = mintNodeId(input.idPort, used);
      const parent = location.parent;
      let destination: MoveDestination;
      if (parent.kind === "stack") {
        destination = {
          kind: "stack",
          containerId: parent.containerId,
          index: parent.wrapperIndex + 1,
          wrapperId,
        };
      } else if (parent.kind === "grid") {
        const container = findContainerLocation(document, parent.containerId)?.container;
        if (container?.type !== "grid") {
          throw new EditorCommandVocabularyError("Grid destination disappeared");
        }
        let open: { row: number; column: number } | undefined;
        for (let row = 0; row < container.data.rows && open === undefined; row++) {
          for (let column = 0; column < container.data.columns; column++) {
            if (!container.children.some((child) => child.row === row && child.column === column)) {
              open = { row, column };
              break;
            }
          }
        }
        if (open === undefined) {
          throw new EditorCommandVocabularyError("This grid has no empty cell for a duplicate");
        }
        destination = {
          kind: "grid",
          containerId: parent.containerId,
          row: open.row,
          column: open.column,
          wrapperId,
        };
      } else {
        destination = {
          kind: "canvas",
          containerId: parent.containerId,
          x: parent.wrapper.x,
          y: parent.wrapper.y,
          wrapperId,
        };
      }
      const tree = insertAtDocumentDestination(
        {
          elements: document.elements,
          pageElements: document.pageElements ?? [],
        },
        duplicate,
        parent.wrapper,
        destination,
      );
      return replaceDocumentTreePatches(document, tree);
    },
    selectAfter: () =>
      duplicateId === undefined ? { kind: "document" } : selectionForNode(duplicateId),
  };
}

export function createMoveElementCommand(input: {
  readonly nodeId: NodeId;
  readonly destination: MoveDestination;
}): EditorCommand {
  return {
    id: "element.move",
    label: "Move item",
    capabilities: (context) => [
      ...structuralRequirements(context, input.nodeId),
      ...destinationRequirements(input.destination),
    ],
    createPatches: ({ document }) => {
      const location = requireLocation(document, input.nodeId);
      if (location.parent.kind === "page") {
        throw new EditorCommandVocabularyError("Page items cannot move into body containers");
      }
      assertDestinationIsOutsideMovedElement(location.element, input.destination);
      const extracted = extractDocumentElement(document, location, input.nodeId);
      return replaceDocumentTreePatches(
        document,
        insertAtDocumentDestination(
          extracted,
          extracted.element,
          extracted.wrapper,
          input.destination,
        ),
      );
    },
    selectAfter: (context) => selectionAfterPlacementEdit(context, input.nodeId),
  };
}

export function createReorderElementCommand(input: {
  readonly nodeId: NodeId;
  readonly direction: "before" | "after";
}): EditorCommand {
  return {
    id: "element.reorder",
    label: input.direction === "before" ? "Move item earlier" : "Move item later",
    capabilities: (context) => structuralRequirements(context, input.nodeId),
    createPatches: ({ document }) => {
      const location = requireLocation(document, input.nodeId);
      if (location.parent.kind === "body") {
        const from = location.parent.index;
        const to = input.direction === "before" ? from - 1 : from + 1;
        if (to < 0 || to >= document.elements.length) return [];
        const elements = [...document.elements];
        const current = elements[from];
        if (current === undefined) return [];
        elements.splice(from, 1);
        elements.splice(to, 0, current);
        return replaceElementsPatch(elements);
      }
      if (location.parent.kind === "page") {
        const from = location.parent.wrapperIndex;
        const pageElements = [...(document.pageElements ?? [])];
        const to = input.direction === "before" ? from - 1 : from + 1;
        if (to < 0 || to >= pageElements.length) return [];
        const current = pageElements[from];
        if (current === undefined) return [];
        pageElements.splice(from, 1);
        pageElements.splice(to, 0, current);
        return [{ op: "replace", path: "/pageElements", value: pageElements }];
      }
      if (location.parent.kind !== "stack") {
        throw new EditorCommandVocabularyError("Use Move item for grid, canvas, and page placements");
      }
      const container = findContainerLocation(document, location.parent.containerId)?.container;
      if (container?.type !== "stack") {
        throw new EditorCommandVocabularyError("Stack destination disappeared");
      }
      const from = location.parent.wrapperIndex;
      const to = input.direction === "before" ? from - 1 : from + 1;
      if (to < 0 || to >= container.children.length) return [];
      const children = [...container.children];
      const current = children[from];
      if (current === undefined) return [];
      children.splice(from, 1);
      children.splice(to, 0, current);
      return [
        {
          op: "replace",
          path: `${findContainerLocation(document, container.id)?.elementPath ?? ""}/children`,
          value: normalizeStackChildren(children),
        },
      ];
    },
    selectAfter: (context) => selectionAfterPlacementEdit(context, input.nodeId),
  };
}

export function createReorderCanvasChildCommand(input: {
  readonly nodeId: NodeId;
  readonly direction: "backward" | "forward";
}): EditorCommand {
  return {
    id: "canvas.reorderPaint",
    label: input.direction === "backward" ? "Send item backward" : "Bring item forward",
    capabilities: (context) => structuralRequirements(context, input.nodeId),
    createPatches: ({ document }) => {
      const location = requireLocation(document, input.nodeId);
      if (location.parent.kind !== "canvas") {
        throw new EditorCommandVocabularyError("Selected item is not placed on a canvas");
      }
      const container = findContainerLocation(document, location.parent.containerId)?.container;
      if (container?.type !== "canvas") throw new EditorCommandVocabularyError("Canvas disappeared");
      const from = location.parent.wrapperIndex;
      const to = input.direction === "backward" ? from - 1 : from + 1;
      if (to < 0 || to >= container.children.length) return [];
      const children = [...container.children];
      const wrapper = children[from];
      if (wrapper === undefined) return [];
      children.splice(from, 1);
      children.splice(to, 0, wrapper);
      return [{
        op: "replace",
        path: `${findContainerLocation(document, container.id)?.elementPath ?? ""}/children`,
        value: children,
      }];
    },
    selectAfter: (context) => selectionAfterPlacementEdit(context, input.nodeId),
  };
}

export function createReorderCanvasReadingCommand(input: {
  readonly nodeId: NodeId;
  readonly direction: "earlier" | "later";
}): EditorCommand {
  return {
    id: "canvas.reorderReading",
    label: input.direction === "earlier" ? "Read item earlier" : "Read item later",
    capabilities: (context) => structuralRequirements(context, input.nodeId),
    createPatches: ({ document }) => {
      const location = requireLocation(document, input.nodeId);
      if (location.parent.kind !== "canvas") {
        throw new EditorCommandVocabularyError("Selected item is not placed on a canvas");
      }
      const containerLocation = findContainerLocation(document, location.parent.containerId);
      const container = containerLocation?.container;
      if (container?.type !== "canvas") throw new EditorCommandVocabularyError("Canvas disappeared");
      const ordered = container.children
        .map((wrapper, paintIndex) => ({ wrapper, paintIndex }))
        .sort((left, right) =>
          (left.wrapper.semanticOrder ?? left.paintIndex) -
          (right.wrapper.semanticOrder ?? right.paintIndex)
        );
      const from = ordered.findIndex(({ wrapper }) => wrapper.element.id === input.nodeId);
      const to = input.direction === "earlier" ? from - 1 : from + 1;
      if (from < 0 || to < 0 || to >= ordered.length) return [];
      const current = ordered[from];
      if (current === undefined) return [];
      ordered.splice(from, 1);
      ordered.splice(to, 0, current);
      const semanticByWrapper = new Map(ordered.map(({ wrapper }, index) => [wrapper.id, index]));
      return [{
        op: "replace",
        path: `${containerLocation?.elementPath ?? ""}/children`,
        value: container.children.map((wrapper) => ({
          ...wrapper,
          semanticOrder: semanticByWrapper.get(wrapper.id) ?? 0,
        })),
      }];
    },
    selectAfter: (context) => selectionAfterPlacementEdit(context, input.nodeId),
  };
}

export function createResetCanvasReadingOrderCommand(containerId: NodeId): EditorCommand {
  return {
    id: "canvas.resetReadingOrder",
    label: "Use paint order for reading",
    capabilities: [{ capability: "layout.edit", target: nodeTarget(containerId) }],
    createPatches: ({ document }) => {
      const location = findContainerLocation(document, containerId);
      if (location?.container.type !== "canvas") {
        throw new EditorCommandVocabularyError("Selected item is not a canvas");
      }
      if (location.container.children.every((wrapper) => wrapper.semanticOrder === undefined)) return [];
      return [{
        op: "replace",
        path: `${location.elementPath}/children`,
        value: location.container.children.map(({ semanticOrder, ...wrapper }) => {
          void semanticOrder;
          return wrapper;
        }),
      }];
    },
    selectAfter: selectionForNode(containerId),
  };
}

function propertyPatch(
  document: CbbDocument,
  nodeId: NodeId,
  property: string,
  value: unknown,
): readonly DocumentPatch[] {
  const location = requireLocation(document, nodeId);
  const record = location.element as unknown as Readonly<Record<string, unknown>>;
  const op = Object.prototype.hasOwnProperty.call(record, property) ? "replace" : "add";
  return [{ op, path: `${location.elementPath}/${property}`, value }];
}

export function createResizeElementCommand(input: {
  readonly nodeId: NodeId;
  readonly width?: ElementSize | PageElementSize;
  readonly height?: ElementSize | PageElementSize;
  readonly historyGroup?: string;
}): EditorCommand {
  return {
    id: "element.resize",
    label: "Resize item",
    capabilities: (context) => {
      const location = requireLocation(context.document, input.nodeId);
      return [
        {
          capability: "layout.resize",
          target: nodeTarget(
            location.parent.kind === "page"
              ? location.parent.wrapper.id
              : input.nodeId,
          ),
        },
      ];
    },
    createPatches: ({ document }) => {
      const location = requireLocation(document, input.nodeId);
      if (location.parent.kind === "page") {
        return [
          ...(input.width === undefined
            ? []
            : [{
                op: "replace" as const,
                path: `${location.parent.wrapperPath}/width`,
                value: input.width,
              }]),
          ...(input.height === undefined
            ? []
            : [{
                op: "replace" as const,
                path: `${location.parent.wrapperPath}/height`,
                value: input.height,
              }]),
        ];
      }
      return [
        ...(input.width === undefined
          ? []
          : propertyPatch(document, input.nodeId, "width", input.width)),
        ...(input.height === undefined
          ? []
          : propertyPatch(document, input.nodeId, "height", input.height)),
      ];
    },
    ...(input.historyGroup === undefined ? {} : { historyGroup: input.historyGroup }),
    selectAfter: (context) => selectionAfterPlacementEdit(context, input.nodeId),
  };
}

export function createMoveCanvasChildCommand(input: {
  readonly nodeId: NodeId;
  readonly x: CanvasPosition;
  readonly y: CanvasPosition;
  readonly historyGroup?: string;
}): EditorCommand {
  return {
    id: "canvas.moveChild",
    label: "Move item",
    capabilities: (context) => {
      const location = requireLocation(context.document, input.nodeId);
      if (location.parent.kind !== "canvas") {
        throw new EditorCommandVocabularyError("Only canvas children have free x/y placement");
      }
      return [
        {
          capability: "layout.editPlacement",
          target: nodeTarget(location.parent.wrapper.id),
        },
      ];
    },
    createPatches: ({ document }) => {
      const location = requireLocation(document, input.nodeId);
      if (location.parent.kind !== "canvas") {
        throw new EditorCommandVocabularyError("Only canvas children have free x/y placement");
      }
      return [
        { op: "replace", path: `${location.parent.wrapperPath}/x`, value: input.x },
        { op: "replace", path: `${location.parent.wrapperPath}/y`, value: input.y },
      ];
    },
    ...(input.historyGroup === undefined ? {} : { historyGroup: input.historyGroup }),
    selectAfter: (context) => selectionAfterPlacementEdit(context, input.nodeId),
  };
}

export function createMovePageElementCommand(input: {
  readonly nodeId: NodeId;
  readonly x: PhysicalOrRelativeLength;
  readonly y: PhysicalOrRelativeLength;
  readonly historyGroup?: string;
}): EditorCommand {
  return {
    id: "pageElement.move",
    label: "Move page item",
    capabilities: (context) => {
      const location = requireLocation(context.document, input.nodeId);
      if (location.parent.kind !== "page") {
        throw new EditorCommandVocabularyError("Only page items have page placement");
      }
      return [{
        capability: "layout.editPlacement",
        target: nodeTarget(location.parent.wrapper.id),
      }];
    },
    createPatches: ({ document }) => {
      const location = requireLocation(document, input.nodeId);
      if (location.parent.kind !== "page") {
        throw new EditorCommandVocabularyError("Only page items have page placement");
      }
      return [
        { op: "replace", path: `${location.parent.wrapperPath}/x`, value: input.x },
        { op: "replace", path: `${location.parent.wrapperPath}/y`, value: input.y },
      ];
    },
    ...(input.historyGroup === undefined ? {} : { historyGroup: input.historyGroup }),
    selectAfter: (context) => selectionAfterPlacementEdit(context, input.nodeId),
  };
}

export function createSetPageElementLayerCommand(input: {
  readonly nodeId: NodeId;
  readonly layer: "background" | "underlay" | "overlay";
}): EditorCommand {
  return {
    id: "pageElement.setLayer",
    label: "Change page layer",
    capabilities: (context) => {
      const location = requireLocation(context.document, input.nodeId);
      if (location.parent.kind !== "page") {
        throw new EditorCommandVocabularyError("Only page items have a page layer");
      }
      return [{
        capability: "layout.editPlacement",
        target: nodeTarget(location.parent.wrapper.id),
      }];
    },
    createPatches: ({ document }) => {
      const location = requireLocation(document, input.nodeId);
      if (location.parent.kind !== "page") {
        throw new EditorCommandVocabularyError("Only page items have a page layer");
      }
      const requiredLayer = location.parent.wrapper.purpose === "background"
        ? "background"
        : location.parent.wrapper.purpose === "decoration"
          ? undefined
          : "overlay";
      if (requiredLayer !== undefined && input.layer !== requiredLayer) {
        throw new EditorCommandVocabularyError(
          `${location.parent.wrapper.purpose} page items must remain on the ${requiredLayer} layer`,
        );
      }
      return [{
        op: "replace",
        path: `${location.parent.wrapperPath}/layer`,
        value: input.layer,
      }];
    },
    selectAfter: (context) => selectionAfterPlacementEdit(context, input.nodeId),
  };
}

export function createSetTextContentCommand(input: {
  readonly nodeId: NodeId;
  readonly content: TextContent;
  /** Direct formatted content lives at this music target instead of text.data.content. */
  readonly target?: "textContent" | "musicRichContent";
  readonly historyGroup?: string;
}): EditorCommand {
  const target = input.target ?? "textContent";
  return {
    id: "content.setText",
    label: target === "musicRichContent" ? "Edit hymn text" : "Edit text",
    capabilities: [
      { capability: "content.edit", target: nodeTarget(input.nodeId) },
    ],
    createPatches: ({ document }) => {
      const location = requireLocation(document, input.nodeId);
      if (target === "musicRichContent") {
        if (location.element.type !== "music") {
          throw new EditorCommandVocabularyError("Selected item is not a hymn or song");
        }
        if (input.content.kind !== "richText") {
          throw new EditorCommandVocabularyError("Hymn text must preserve formatted content");
        }
        const binding = matchingBinding(location, ["/data/richContent"]);
        if (binding !== undefined) {
          return fieldValuePatch(document, location, binding, input.content.document);
        }
        return [{
          op: location.element.data.richContent === undefined ? "add" : "replace",
          path: `${location.elementPath}/data/richContent`,
          value: input.content.document,
        }];
      }
      if (location.element.type !== "text") {
        throw new EditorCommandVocabularyError("Selected item is not text");
      }
      const binding = matchingBinding(
        location,
        ["/data/content", "/data/content/text", "/data/content/document"],
      );
      if (binding !== undefined) {
        return fieldValuePatch(
          document,
          location,
          binding,
          textBindingValue(binding, input.content),
        );
      }
      return [
        {
          op: "replace",
          path: `${location.elementPath}/data/content`,
          value: input.content,
        },
      ];
    },
    ...(input.historyGroup === undefined ? {} : { historyGroup: input.historyGroup }),
    selectAfter: selectionForNode(input.nodeId),
  };
}

export type MusicTextProperty = "title" | "number" | "instructions" | "source";

export function createSetMusicTextCommand(input: {
  readonly nodeId: NodeId;
  readonly property: MusicTextProperty;
  readonly value: string;
  readonly historyGroup?: string;
}): EditorCommand {
  return {
    id: `music.setText:${input.property}`,
    label: "Edit hymn details",
    capabilities: [{ capability: "content.edit", target: nodeTarget(input.nodeId) }],
    createPatches: ({ document }) => {
      const location = requireLocation(document, input.nodeId);
      if (location.element.type !== "music") {
        throw new EditorCommandVocabularyError("Selected item is not a hymn or song");
      }
      const value = input.value.replaceAll("\u0000", "").normalize("NFC");
      if (input.property === "title" && value.trim().length === 0) {
        throw new EditorCommandVocabularyError("Hymn or song title cannot be empty");
      }
      const binding = matchingBinding(location, [`/data/${input.property}`]);
      if (binding !== undefined) {
        return fieldValuePatch(document, location, binding, value);
      }
      const path = `${location.elementPath}/data/${input.property}`;
      const current = location.element.data[input.property];
      if (input.property !== "title" && value.length === 0) {
        return current === undefined ? [] : [{ op: "remove", path }];
      }
      return [{ op: current === undefined ? "add" : "replace", path, value }];
    },
    ...(input.historyGroup === undefined ? {} : { historyGroup: input.historyGroup }),
    selectAfter: selectionForNode(input.nodeId),
  };
}

function matchingBinding(
  location: ElementLocation,
  targets: readonly string[],
): Binding | undefined {
  const bindings = location.element.type === "customInstance"
    ? undefined
    : location.element.bindings;
  return bindings?.find((candidate) => targets.includes(candidate.target));
}

function textBindingValue(binding: Binding, content: TextContent): unknown {
  if (binding.target === "/data/content/text") {
    if (content.kind !== "plain") {
      throw new EditorCommandVocabularyError(
        `Weekly field '${binding.fieldId}' accepts plain text only`,
      );
    }
    return content.text;
  }
  if (binding.target === "/data/content/document") {
    if (content.kind !== "richText") {
      throw new EditorCommandVocabularyError(
        `Weekly field '${binding.fieldId}' accepts formatted text only`,
      );
    }
    return content.document;
  }
  return content.kind === "plain" ? content.text : content.document;
}

function fieldValuePatch(
  document: CbbDocument,
  location: ElementLocation,
  binding: Binding,
  value: unknown,
): readonly DocumentPatch[] {
  const patches = fieldValuePatches(document, location, [{ binding, value }]);
  if (patches.length === 0) {
    throw new EditorCommandVocabularyError("A bound field update could not be created");
  }
  return patches;
}

function pointerExists(root: unknown, pointer: string): boolean {
  if (!pointer.startsWith("/")) return false;
  let current = root;
  for (const raw of pointer.slice(1).split("/")) {
    const segment = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, segment)) {
      return false;
    }
    current = (current as Readonly<Record<string, unknown>>)[segment];
  }
  return true;
}

function boundLiteralRemovalPatches(
  location: ElementLocation,
  bindings: readonly Binding[],
): readonly DocumentPatch[] {
  const removedTargets = new Set<string>();
  const patches: DocumentPatch[] = [];
  for (const binding of bindings) {
    if (removedTargets.has(binding.target) || !pointerExists(location.element, binding.target)) {
      continue;
    }
    removedTargets.add(binding.target);
    patches.push({ op: "remove", path: `${location.elementPath}${binding.target}` });
  }
  return patches;
}

function fieldValuePatches(
  document: CbbDocument,
  location: ElementLocation,
  updates: readonly { readonly binding: Binding; readonly value: unknown }[],
): readonly DocumentPatch[] {
  const patches: DocumentPatch[] = [];
  for (const scope of ["document", "local"] as const) {
    const scoped = updates.filter((update) => update.binding.scope === scope);
    if (scoped.length === 0) continue;
    const ownerPath = scope === "document" ? "" : location.elementPath;
    const values = scope === "document" ? document.fieldValues : location.element.fieldValues;
    if (values === undefined) {
      const entries = Object.fromEntries(scoped.map(({ binding, value }) => [
        binding.fieldId,
        { value, origin: "manual" as const },
      ]));
      patches.push({ op: "add", path: `${ownerPath}/fieldValues`, value: entries });
      continue;
    }
    for (const { binding, value } of scoped) {
      const entry = values[binding.fieldId];
      patches.push({
        op: entry === undefined ? "add" : "replace",
        path: `${ownerPath}/fieldValues/${escapedPointerSegment(binding.fieldId)}`,
        value: { ...(entry ?? {}), value, origin: "manual" as const },
      });
    }
  }
  patches.push(...boundLiteralRemovalPatches(
    location,
    updates.map((update) => update.binding),
  ));
  const documentUpdates = updates.filter((update) => update.binding.scope === "document");
  if (documentUpdates.length > 0 && document.fieldContract !== undefined) {
    const nextValues: Record<string, FieldValueEntry> = { ...(document.fieldValues ?? {}) };
    const roles: SemanticMetadataRole[] = [];
    for (const { binding, value } of documentUpdates) {
      const prior = nextValues[binding.fieldId];
      nextValues[binding.fieldId] = { ...(prior ?? {}), value, origin: "manual" };
      const role = document.fieldContract.fields.find((field) =>
        field.id === binding.fieldId)?.semanticRole;
      if (role !== undefined) roles.push(role);
    }
    patches.push(...semanticRoleMetadataMirrorPatches({
      document,
      contract: document.fieldContract,
      values: nextValues,
      roles,
    }));
  }
  return patches;
}

function focalPointBindingState(
  location: ElementLocation,
  focalPoint: CompleteFocalPoint,
): {
  readonly xBinding: Binding | undefined;
  readonly yBinding: Binding | undefined;
  readonly updates: readonly { readonly binding: Binding; readonly value: unknown }[];
} {
  const xBinding = matchingBinding(location, ["/data/focalPoint/x"]);
  const yBinding = matchingBinding(location, ["/data/focalPoint/y"]);
  const sharedField = xBinding !== undefined && yBinding !== undefined &&
    xBinding.scope === yBinding.scope && xBinding.fieldId === yBinding.fieldId;
  if (sharedField && focalPoint.x !== focalPoint.y) {
    throw new EditorCommandVocabularyError(
      "The horizontal and vertical crop axes share one weekly field and must use the same value.",
    );
  }
  return {
    xBinding,
    yBinding,
    updates: [
      ...(xBinding === undefined ? [] : [{ binding: xBinding, value: focalPoint.x }]),
      ...(yBinding === undefined || sharedField
        ? []
        : [{ binding: yBinding, value: focalPoint.y }]),
    ],
  };
}

function focalPointLiteralPatches(
  location: ElementLocation,
  focalPoint: CompleteFocalPoint,
  xBinding: Binding | undefined,
  yBinding: Binding | undefined,
): readonly DocumentPatch[] {
  if (location.element.type !== "image") return [];
  const path = `${location.elementPath}/data/focalPoint`;
  if (xBinding !== undefined && yBinding !== undefined) {
    return location.element.data.focalPoint === undefined
      ? []
      : [{ op: "remove", path }];
  }
  const literal = {
    ...(xBinding === undefined ? { x: focalPoint.x } : {}),
    ...(yBinding === undefined ? { y: focalPoint.y } : {}),
  };
  return [{
    op: location.element.data.focalPoint === undefined ? "add" : "replace",
    path,
    value: literal,
  }];
}

function boundFieldValuePatch(
  document: CbbDocument,
  location: ElementLocation,
  targets: readonly string[],
  value: unknown,
): readonly DocumentPatch[] | undefined {
  const binding = matchingBinding(location, targets);
  if (binding === undefined) return undefined;
  return fieldValuePatch(document, location, binding, value);
}

export function createSetDateValueCommand(input: {
  readonly nodeId: NodeId;
  readonly value: string;
}): EditorCommand {
  return {
    id: "date.setValue",
    label: "Change date",
    capabilities: [
      { capability: "content.edit", target: nodeTarget(input.nodeId) },
    ],
    createPatches: ({ document }) => {
      const location = requireLocation(document, input.nodeId);
      if (location.element.type !== "date") {
        throw new EditorCommandVocabularyError("Selected item is not a date");
      }
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(input.value)) {
        throw new EditorCommandVocabularyError("Enter a complete date");
      }
      const bound = boundFieldValuePatch(
        document,
        location,
        ["/data/value"],
        input.value,
      );
      if (bound !== undefined) return bound;
      return [{
        op: "replace",
        path: `${location.elementPath}/data/value`,
        value: input.value,
      }];
    },
    selectAfter: selectionForNode(input.nodeId),
  };
}

/** Change only how a date is presented; its authoritative calendar value is unchanged. */
export function createSetDatePresentationCommand(input: {
  readonly nodeId: NodeId;
  readonly format: string;
}): EditorCommand {
  return {
    id: "date.setPresentation",
    label: "Change date appearance",
    capabilities: [{ capability: "layout.edit", target: nodeTarget(input.nodeId) }],
    createPatches: ({ document }) => {
      const location = requireLocation(document, input.nodeId);
      if (location.element.type !== "date") {
        throw new EditorCommandVocabularyError("Selected item is not a date");
      }
      const format = input.format.normalize("NFC");
      try {
        formatIsoDate(
          location.element.data.value ?? "2000-01-01",
          format,
          location.element.data.locale,
        );
      } catch (error) {
        throw new EditorCommandVocabularyError(
          error instanceof Error ? error.message : "That date format is not supported",
        );
      }
      const binding = matchingBinding(location, ["/data/format"]);
      if (binding !== undefined) {
        return fieldValuePatch(document, location, binding, format);
      }
      const path = `${location.elementPath}/data/format`;
      return [{
        op: location.element.data.format === undefined ? "add" : "replace",
        path,
        value: format,
      }];
    },
    selectAfter: selectionForNode(input.nodeId),
  };
}

export function createSetImageFocalPointCommand(input: {
  readonly nodeId: NodeId;
  readonly focalPoint: CompleteFocalPoint;
  readonly historyGroup?: string;
}): EditorCommand {
  return {
    id: "image.setFocalPoint",
    label: "Adjust image crop",
    capabilities: [
      { capability: "content.adjustImageCrop", target: nodeTarget(input.nodeId) },
    ],
    createPatches: ({ document }) => {
      const location = requireLocation(document, input.nodeId);
      if (location.element.type !== "image") {
        throw new EditorCommandVocabularyError("Selected item is not an image");
      }
      validateCompleteFocalPoint(input.focalPoint);
      const state = focalPointBindingState(location, input.focalPoint);
      return [
        ...fieldValuePatches(document, location, state.updates),
        ...focalPointLiteralPatches(
          location,
          input.focalPoint,
          state.xBinding,
          state.yBinding,
        ),
      ];
    },
    ...(input.historyGroup === undefined ? {} : { historyGroup: input.historyGroup }),
    selectAfter: selectionForNode(input.nodeId),
  };
}

/** Replace managed bytes and explicitly establish the reviewed starting crop. */
export function createReplaceImageCommand(input: {
  readonly nodeId: NodeId;
  readonly assetRef: PortableAssetRefString;
  /** Defaults to the required replacement behavior: start the new binary centered. */
  readonly focalPoint?: CompleteFocalPoint;
}): EditorCommand {
  return {
    id: "image.replace",
    label: "Replace image",
    capabilities: [
      { capability: "content.replaceImage", target: nodeTarget(input.nodeId) },
    ],
    createPatches: ({ document }) => {
      const location = requireLocation(document, input.nodeId);
      if (location.element.type !== "image") {
        throw new EditorCommandVocabularyError("Selected item is not an image");
      }
      const focalPoint = {
        x: input.focalPoint?.x ?? 0.5,
        y: input.focalPoint?.y ?? 0.5,
      };
      validateCompleteFocalPoint(focalPoint);
      const updates: { readonly binding: Binding; readonly value: unknown }[] = [];
      const assetBinding = matchingBinding(location, ["/data/assetRef"]);
      const focalState = focalPointBindingState(location, focalPoint);
      if (assetBinding !== undefined) updates.push({ binding: assetBinding, value: input.assetRef });
      updates.push(...focalState.updates);
      return [
        ...fieldValuePatches(document, location, updates),
        ...(assetBinding === undefined
          ? [{
              op: "replace" as const,
              path: `${location.elementPath}/data/assetRef`,
              value: input.assetRef,
            }]
          : []),
        ...focalPointLiteralPatches(
          location,
          focalPoint,
          focalState.xBinding,
          focalState.yBinding,
        ),
      ];
    },
    selectAfter: selectionForNode(input.nodeId),
  };
}

export function createSetImageFitCommand(input: {
  readonly nodeId: NodeId;
  readonly fit: "contain" | "cover";
}): EditorCommand {
  return {
    id: "image.setFit",
    label: input.fit === "cover" ? "Crop image to fill" : "Fit whole image",
    capabilities: [
      { capability: "content.adjustImageCrop", target: nodeTarget(input.nodeId) },
    ],
    createPatches: ({ document }) => {
      const location = requireLocation(document, input.nodeId);
      if (location.element.type !== "image") {
        throw new EditorCommandVocabularyError("Selected item is not an image");
      }
      return [{
        op: "replace",
        path: `${location.elementPath}/data/fit`,
        value: input.fit,
      }];
    },
    selectAfter: selectionForNode(input.nodeId),
  };
}

export function createSetPageMarginCommand(input: {
  readonly side: "top" | "right" | "bottom" | "left" | "inner" | "outer";
  readonly value: PhysicalLength;
}): EditorCommand {
  return {
    id: "page.setMargin",
    label: "Change page margin",
    capabilities: [{ capability: "layout.editPageSetup" }],
    createPatches: ({ document }) => {
      const margins = document.page.margins ?? {};
      return [
        {
          op: document.page.margins === undefined ? "add" : "replace",
          path: "/page/margins",
          value: { ...margins, [input.side]: input.value },
        },
      ];
    },
  };
}

export function createSetElementNameCommand(input: {
  readonly nodeId: NodeId;
  readonly name: string;
}): EditorCommand {
  return {
    id: "element.rename",
    label: "Rename item",
    capabilities: [
      { capability: "layout.edit", target: nodeTarget(input.nodeId) },
    ],
    createPatches: ({ document }) => {
      const name = input.name.normalize("NFC").trim();
      if (name.length === 0) {
        throw new EditorCommandVocabularyError("Item name cannot be empty");
      }
      return propertyPatch(document, input.nodeId, "name", name);
    },
    selectAfter: selectionForNode(input.nodeId),
  };
}

export function createSetElementSpacingCommand(input: {
  readonly nodeId: NodeId;
  readonly property: "margin" | "padding";
  readonly value: SpacingLength;
}): EditorCommand {
  return {
    id: `element.set${input.property === "margin" ? "Margin" : "Padding"}`,
    label: input.property === "margin" ? "Change outer spacing" : "Change inner spacing",
    capabilities: [
      { capability: "layout.edit", target: nodeTarget(input.nodeId) },
    ],
    createPatches: ({ document }) =>
      propertyPatch(document, input.nodeId, input.property, input.value),
    selectAfter: selectionForNode(input.nodeId),
  };
}

export function createSetGridLayoutCommand(input: {
  readonly nodeId: NodeId;
  readonly rowGap?: SpacingLength | undefined;
  readonly columnGap?: SpacingLength | undefined;
  readonly columnTracks?: GridElementData["columnTracks"] | undefined;
  readonly semanticRole?: GridElementData["semanticRole"] | undefined;
  readonly tableSemantics?: GridElementData["tableSemantics"] | undefined;
  readonly historyGroup?: string | undefined;
}): EditorCommand {
  return {
    id: "grid.setLayout",
    label: "Change column layout",
    capabilities: [{ capability: "layout.edit", target: nodeTarget(input.nodeId) }],
    createPatches: ({ document }) => {
      const location = requireLocation(document, input.nodeId);
      if (location.element.type !== "grid") {
        throw new EditorCommandVocabularyError("Selected item is not a grid");
      }
      const grid = location.element;
      if (
        input.columnTracks !== undefined &&
        input.columnTracks.length !== grid.data.columns
      ) {
        throw new EditorCommandVocabularyError("Column tracks must match the number of columns");
      }
      if (input.semanticRole === "table") {
        const occupied = new Set(
          grid.children.map((wrapper) => `${wrapper.row}:${wrapper.column}`),
        );
        const everyCellIsFilled = Array.from(
          { length: grid.data.rows },
          (_, row) => Array.from(
            { length: grid.data.columns },
            (_, column) => occupied.has(`${row}:${column}`),
          ).every(Boolean),
        ).every(Boolean);
        if (!everyCellIsFilled) {
          throw new EditorCommandVocabularyError(
            "Fill every grid cell before marking this grid as tabular data",
          );
        }
      }
      const currentData = grid.data;
      const { tableSemantics, ...layoutData } = currentData;
      void tableSemantics;
      return [{
        op: "replace",
        path: `${location.elementPath}/data`,
        value: {
          ...(input.semanticRole === "layout" ? layoutData : currentData),
          ...(input.rowGap === undefined ? {} : { rowGap: input.rowGap }),
          ...(input.columnGap === undefined ? {} : { columnGap: input.columnGap }),
          ...(input.columnTracks === undefined ? {} : { columnTracks: input.columnTracks }),
          ...(input.semanticRole === undefined ? {} : { semanticRole: input.semanticRole }),
          ...(input.tableSemantics === undefined ? {} : { tableSemantics: input.tableSemantics }),
        },
      }];
    },
    ...(input.historyGroup === undefined ? {} : { historyGroup: input.historyGroup }),
    selectAfter: selectionForNode(input.nodeId),
  };
}

export function createSetStackLayoutCommand(input: {
  readonly nodeId: NodeId;
  readonly direction?: "vertical" | "horizontal" | undefined;
  readonly gap?: SpacingLength | undefined;
}): EditorCommand {
  return {
    id: "stack.setLayout",
    label: "Change section layout",
    capabilities: [{ capability: "layout.edit", target: nodeTarget(input.nodeId) }],
    createPatches: ({ document }) => {
      const location = requireLocation(document, input.nodeId);
      if (location.element.type !== "stack") {
        throw new EditorCommandVocabularyError("Selected item is not a stack section");
      }
      return [{
        op: "replace",
        path: `${location.elementPath}/data`,
        value: {
          ...location.element.data,
          ...(input.direction === undefined ? {} : { direction: input.direction }),
          ...(input.gap === undefined ? {} : { gap: input.gap }),
        },
      }];
    },
    selectAfter: selectionForNode(input.nodeId),
  };
}

export function createSetElementBreakPolicyCommand(input: {
  readonly nodeId: NodeId;
  readonly breakPolicy: "auto" | "avoid";
}): EditorCommand {
  return {
    id: "element.setBreakPolicy",
    label: "Change page-break behavior",
    capabilities: [
      { capability: "layout.edit", target: nodeTarget(input.nodeId) },
    ],
    createPatches: ({ document }) =>
      propertyPatch(document, input.nodeId, "breakPolicy", input.breakPolicy),
    selectAfter: selectionForNode(input.nodeId),
  };
}

export function createSetElementStyleCommand(input: {
  readonly nodeId: NodeId;
  readonly style: StyleObject;
}): EditorCommand {
  return {
    id: "element.setStyle",
    label: "Change appearance",
    capabilities: [
      { capability: "layout.edit", target: nodeTarget(input.nodeId) },
    ],
    createPatches: ({ document }) =>
      propertyPatch(document, input.nodeId, "style", input.style),
    selectAfter: selectionForNode(input.nodeId),
  };
}

export function createSetImageAccessibilityCommand(input: {
  readonly nodeId: NodeId;
  readonly alt?: string;
  readonly decorative: boolean;
}): EditorCommand {
  return {
    id: "image.setAccessibility",
    label: "Change image description",
    capabilities: [
      { capability: "content.editAccessibility", target: nodeTarget(input.nodeId) },
    ],
    createPatches: ({ document }) => {
      const location = requireLocation(document, input.nodeId);
      if (location.element.type !== "image") {
        throw new EditorCommandVocabularyError("Selected item is not an image");
      }
      const data = location.element.data;
      const alt = input.alt?.normalize("NFC").trim();
      const altBinding = matchingBinding(location, ["/data/alt"]);
      const decorativeBinding = matchingBinding(location, ["/data/decorative"]);
      const updates: { binding: Binding; value: unknown }[] = [];
      if (altBinding !== undefined && alt !== undefined) {
        updates.push({ binding: altBinding, value: alt });
      }
      if (decorativeBinding !== undefined) {
        updates.push({ binding: decorativeBinding, value: input.decorative });
      }
      const patches = [...fieldValuePatches(document, location, updates)];
      const updatedBindings = new Set(updates.map((update) => update.binding.id));
      patches.push(...boundLiteralRemovalPatches(
        location,
        [altBinding, decorativeBinding].filter(
          (binding): binding is Binding => binding !== undefined && !updatedBindings.has(binding.id),
        ),
      ));
      if (altBinding === undefined || decorativeBinding === undefined) {
        const {
          alt: _currentAlt,
          decorative: _currentDecorative,
          ...otherData
        } = data;
        patches.push({
          op: "replace",
          path: `${location.elementPath}/data`,
          value: {
            ...otherData,
            ...(decorativeBinding === undefined
              ? { decorative: input.decorative }
              : {}),
            ...(altBinding === undefined
              ? input.decorative || alt === undefined || alt.length === 0 ? {} : { alt }
              : {}),
          },
        });
      }
      return patches;
    },
    selectAfter: selectionForNode(input.nodeId),
  };
}

export function createSetAuthoringPolicyCommand(input: {
  readonly nodeId?: NodeId;
  readonly contentLocked?: boolean;
  readonly layoutLocked?: boolean;
}): EditorCommand {
  const target = input.nodeId === undefined
    ? { kind: "document" as const }
    : nodeTarget(input.nodeId);
  return {
    id: "authoringPolicy.set",
    label: "Change editing protection",
    capabilities: [
      { capability: "authoringPolicy.edit", target },
    ],
    createPatches: ({ document }) => {
      if (input.nodeId === undefined) {
        if (input.contentLocked === undefined && input.layoutLocked === undefined) {
          return [];
        }
        const value: AuthoringPolicy = {
          ...(document.authoringPolicy ?? {}),
          ...(input.contentLocked === undefined
            ? {}
            : { contentLocked: input.contentLocked }),
          ...(input.layoutLocked === undefined
            ? {}
            : { layoutLocked: input.layoutLocked }),
        };
        return [
          {
            op: document.authoringPolicy === undefined ? "add" : "replace",
            path: "/authoringPolicy",
            value,
          },
        ];
      }
      if (input.contentLocked === undefined && input.layoutLocked === undefined) {
        return [];
      }
      const location = findElementLocation(document, input.nodeId);
      const wrapperLocation = location === undefined
        ? findPlacementWrapperLocation(document, input.nodeId)
        : undefined;
      if (location === undefined && wrapperLocation === undefined) {
        throw new EditorCommandVocabularyError(`Item '${input.nodeId}' is no longer in the document`);
      }
      const currentPolicy = location?.element.authoringPolicy ?? wrapperLocation?.wrapper.authoringPolicy;
      const path = location?.elementPath ?? wrapperLocation?.wrapperPath;
      if (path === undefined) {
        throw new EditorCommandVocabularyError(`Item '${input.nodeId}' is no longer in the document`);
      }
      const value: AuthoringPolicy = {
        ...(currentPolicy ?? {}),
        ...(input.contentLocked === undefined
          ? {}
          : { contentLocked: input.contentLocked }),
        ...(input.layoutLocked === undefined
          ? {}
          : { layoutLocked: input.layoutLocked }),
      };
      return [
        {
          op: currentPolicy === undefined ? "add" : "replace",
          path: `${path}/authoringPolicy`,
          value,
        },
      ];
    },
    ...(input.nodeId === undefined ? {} : { selectAfter: selectionForNode(input.nodeId) }),
  };
}

export function createSetFinishedPageSizeCommand(input: {
  readonly width: PhysicalLength;
  readonly height: PhysicalLength;
}): EditorCommand {
  return {
    id: "page.setFinishedSize",
    label: "Change finished page size",
    capabilities: [{ capability: "layout.editPageSetup" }],
    createPatches: [
      { op: "replace", path: "/page/typstWidth", value: input.width },
      { op: "replace", path: "/page/typstHeight", value: input.height },
    ],
  };
}

export function createSetPageAppearanceCommand(input: {
  readonly background: string;
}): EditorCommand {
  return {
    id: "page.setAppearance",
    label: "Change page color",
    capabilities: [{ capability: "layout.editPageSetup" }],
    createPatches: ({ document }) => [{
      op: document.page.background === undefined ? "add" : "replace",
      path: "/page/background",
      value: input.background,
    }],
  };
}

export function createSetPageLayoutCommand(input: {
  readonly layoutIntent: "singlePage" | "foldedBooklet";
  readonly marginMode: "fixed" | "mirrored";
  readonly binding: "left" | "right";
}): EditorCommand {
  return {
    id: "page.setLayout",
    label: "Change page layout",
    capabilities: [{ capability: "layout.editPageSetup" }],
    createPatches: ({ document }) => [
      {
        op: document.page.layoutIntent === undefined ? "add" : "replace",
        path: "/page/layoutIntent",
        value: input.layoutIntent,
      },
      {
        op: document.page.marginMode === undefined ? "add" : "replace",
        path: "/page/marginMode",
        value: input.marginMode,
      },
      {
        op: document.page.binding === undefined ? "add" : "replace",
        path: "/page/binding",
        value: input.binding,
      },
    ],
  };
}
