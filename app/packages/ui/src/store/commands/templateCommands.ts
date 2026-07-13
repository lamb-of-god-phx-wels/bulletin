import {
  churchProfileKeyAcceptsFieldType,
  collectAllNodeIds,
  customElementDefinitionHash,
  finalizeCustomDefinitionRevisions,
  type Binding,
  type CbbDocument,
  type ConditionKind,
  type ConditionalRule,
  type ContentRule,
  type ChurchProfileFieldKey as CoreChurchProfileFieldKey,
  type CustomElementDefinition,
  type FieldContract,
  type FieldContractGroup,
  type FieldDefinition,
  type FieldValues,
  type IdPort,
  type ItemBinding,
  type NativeElement,
  type NodeId,
  type RepeatRule,
} from "@cbb/core";
import type {
  CapabilityRequirement,
  DocumentPatch,
  EditorCommand,
  EditorCommandContext,
} from "../types.js";
import {
  documentHasActiveRightsAttribution,
  EditorCommandVocabularyError,
} from "./commands.js";
import { semanticRoleMetadataMirrorPatches } from "../semanticRoleMirrors.js";
import { findElementLocation, selectionForNode } from "./tree.js";

/** A local weekly field belongs to a reusable Saved Section definition. */
export type TemplateFieldOwner =
  | { readonly kind: "document" }
  | { readonly kind: "savedSection"; readonly definitionId: NodeId };

export interface BindableProperty {
  readonly target: string;
  readonly label: string;
  readonly acceptedTypes: readonly FieldDefinition["type"][];
  readonly currentValue?: unknown;
}

export interface TemplateAuthoringDiagnostic {
  readonly code:
    | "unusedField"
    | "missingBindingField"
    | "brokenBindingTarget"
    | "incompatibleBinding"
    | "missingRuleField"
    | "missingRuleTarget";
  readonly severity: "warning" | "error";
  readonly message: string;
  readonly fieldId?: string;
  readonly nodeId?: NodeId;
}

interface DefinitionLocation {
  readonly definition: CustomElementDefinition;
  readonly index: number;
}

interface OwnedElementLocation {
  readonly element: NativeElement;
  readonly path: string;
}

function nodeTarget(nodeId: NodeId) {
  return { kind: "node" as const, nodeId };
}

function ownerTarget(owner: TemplateFieldOwner) {
  return owner.kind === "document"
    ? { kind: "document" as const }
    : nodeTarget(owner.definitionId);
}

function ownerRequirements(
  capability:
    | "template.editBindings"
    | "template.editFieldContract"
    | "template.editRules"
    | "template.editLifecycle",
  owner: TemplateFieldOwner,
): readonly CapabilityRequirement[] {
  return [{ capability, target: ownerTarget(owner) }];
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function definitionLocation(
  document: CbbDocument,
  definitionId: NodeId,
): DefinitionLocation {
  const index = document.customElementDefinitions?.findIndex(
    (candidate) => candidate.id === definitionId,
  ) ?? -1;
  const definition = document.customElementDefinitions?.[index];
  if (index < 0 || definition === undefined) {
    throw new EditorCommandVocabularyError(
      "That Saved section is no longer in this bulletin.",
    );
  }
  return { definition, index };
}

function contractForOwner(
  document: CbbDocument,
  owner: TemplateFieldOwner,
): FieldContract | undefined {
  return owner.kind === "document"
    ? document.fieldContract
    : definitionLocation(document, owner.definitionId).definition.fieldContract;
}

function rulesForOwner(
  document: CbbDocument,
  owner: TemplateFieldOwner,
): readonly ContentRule[] {
  return owner.kind === "document"
    ? document.contentRules ?? []
    : definitionLocation(document, owner.definitionId).definition.contentRules ?? [];
}

function findInElements(
  elements: readonly NativeElement[],
  basePath: string,
  nodeId: NodeId,
): OwnedElementLocation | undefined {
  function visit(element: NativeElement, path: string): OwnedElementLocation | undefined {
    if (element.id === nodeId) return { element, path };
    if (element.type !== "grid" && element.type !== "stack" && element.type !== "canvas") {
      return undefined;
    }
    for (const [index, wrapper] of element.children.entries()) {
      const found = visit(wrapper.element, `${path}/children/${index}/element`);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  for (const [index, element] of elements.entries()) {
    const found = visit(element, `${basePath}/${index}`);
    if (found !== undefined) return found;
  }
  return undefined;
}

function ownedElementLocation(
  document: CbbDocument,
  owner: TemplateFieldOwner,
  nodeId: NodeId,
): OwnedElementLocation {
  if (owner.kind === "document") {
    const found = findElementLocation(document, nodeId);
    if (found !== undefined) return { element: found.element, path: found.elementPath };
  } else {
    const { definition, index } = definitionLocation(document, owner.definitionId);
    const found = findInElements(
      definition.elements,
      `/customElementDefinitions/${index}/elements`,
      nodeId,
    );
    if (found !== undefined) return found;
  }
  throw new EditorCommandVocabularyError("That item is no longer available.");
}

function elementsForOwner(
  document: CbbDocument,
  owner: TemplateFieldOwner,
): readonly NativeElement[] {
  return owner.kind === "document"
    ? [
        ...document.elements,
        ...(document.pageElements ?? []).map((wrapper) => wrapper.element as NativeElement),
      ]
    : definitionLocation(document, owner.definitionId).definition.elements;
}

function mapElement(
  element: NativeElement,
  transform: (element: NativeElement) => NativeElement,
): NativeElement {
  let current = element;
  if (element.type === "grid" || element.type === "stack" || element.type === "canvas") {
    current = {
      ...element,
      children: element.children.map((wrapper) => ({
        ...wrapper,
        element: mapElement(wrapper.element, transform),
      })),
    } as NativeElement;
  }
  return transform(current);
}

function mapElements(
  elements: readonly NativeElement[],
  transform: (element: NativeElement) => NativeElement,
): readonly NativeElement[] {
  return elements.map((element) => mapElement(element, transform));
}

function mapDefinitionElements(
  definitions: readonly CustomElementDefinition[],
  transform: (element: NativeElement) => NativeElement,
): readonly CustomElementDefinition[] {
  return definitions.map((definition) => ({
    ...definition,
    elements: mapElements(definition.elements, transform),
  }));
}

function definitionsTransaction(
  document: CbbDocument,
  rawDefinitions: readonly CustomElementDefinition[],
  rootElements: readonly NativeElement[] = document.elements,
  rootPageElements = document.pageElements,
): readonly DocumentPatch[] {
  let finalized;
  try {
    finalized = finalizeCustomDefinitionRevisions({
      definitions: document.customElementDefinitions ?? [],
      elements: document.elements,
      ...(document.pageElements === undefined ? {} : { pageElements: document.pageElements }),
    }, {
      definitions: rawDefinitions,
      elements: rootElements,
      ...(rootPageElements === undefined ? {} : { pageElements: rootPageElements }),
    });
  } catch (error) {
    throw new EditorCommandVocabularyError(
      error instanceof Error
        ? error.message
        : "These Saved sections could not be revised safely.",
    );
  }
  const patches: DocumentPatch[] = [];

  if (finalized.definitions.length === 0) {
    if (document.customElementDefinitions !== undefined) {
      patches.push({ op: "remove", path: "/customElementDefinitions" });
    }
  } else if (document.customElementDefinitions === undefined) {
    patches.push({ op: "add", path: "/customElementDefinitions", value: finalized.definitions });
  } else if (!sameValue(document.customElementDefinitions, finalized.definitions)) {
    patches.push({ op: "replace", path: "/customElementDefinitions", value: finalized.definitions });
  }
  if (!sameValue(document.elements, finalized.elements)) {
    patches.push({ op: "replace", path: "/elements", value: finalized.elements });
  }
  if (finalized.pageElements !== undefined && !sameValue(document.pageElements, finalized.pageElements)) {
    patches.push({ op: "replace", path: "/pageElements", value: finalized.pageElements });
  }
  return patches;
}

function withDefinition(
  document: CbbDocument,
  definitionId: NodeId,
  update: (definition: CustomElementDefinition) => CustomElementDefinition,
): readonly DocumentPatch[] {
  const { definition, index } = definitionLocation(document, definitionId);
  const definitions = [...(document.customElementDefinitions ?? [])];
  definitions[index] = update(definition);
  return definitionsTransaction(document, definitions);
}

function withoutContractHash(contract: FieldContract): FieldContract {
  const { contractHash: _contractHash, ...editable } = contract;
  return editable;
}

function nextContractVersion(contract: FieldContract): number {
  if (
    !Number.isSafeInteger(contract.version) ||
    contract.version < 1 ||
    contract.version >= Number.MAX_SAFE_INTEGER
  ) {
    throw new EditorCommandVocabularyError(
      "This weekly field contract has reached its revision limit.",
    );
  }
  return contract.version + 1;
}

function bumpedContract(contract: FieldContract): FieldContract {
  return {
    ...withoutContractHash(contract),
    version: nextContractVersion(contract),
  };
}

function fieldContractMeaning(field: FieldDefinition): unknown {
  return {
    type: field.type,
    required: field.required,
    nullable: field.nullable,
    default: field.default,
    constraints: field.constraints,
    semanticRole: field.semanticRole,
    weeklyBehavior: field.weeklyBehavior,
    profileKey: field.profileKey,
    itemField: field.itemField,
    childFields: field.childFields,
  };
}

function contractAfterWeeklyFieldChange(
  contract: FieldContract,
  prior: FieldDefinition,
  next: FieldDefinition,
): FieldContract {
  if (sameValue(prior, next)) return contract;
  return sameValue(fieldContractMeaning(prior), fieldContractMeaning(next))
    ? withoutContractHash(contract)
    : bumpedContract(contract);
}

function fieldValueMatches(field: FieldDefinition, value: unknown): boolean {
  if (value === null) return field.nullable === true;
  switch (field.type) {
    case "text":
    case "date":
      return typeof value === "string";
    case "richText":
      return value !== null && typeof value === "object" &&
        (value as Readonly<Record<string, unknown>>)["type"] === "document";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "boolean": return typeof value === "boolean";
    case "choice": return typeof value === "string" &&
      field.constraints?.choices?.some((choice) => choice.id === value) === true;
    case "assetRef": return typeof value === "string" && value.startsWith("asset:");
    case "array": return Array.isArray(value) && field.itemField !== undefined &&
      value.every((item) => fieldValueMatches(field.itemField as FieldDefinition, item));
    case "object": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
      const record = value as Readonly<Record<string, unknown>>;
      return (field.childFields ?? []).every((child) =>
        record[child.id] === undefined ? !child.required : fieldValueMatches(child, record[child.id]));
    }
  }
}

function effectiveFieldValue(
  contract: FieldContract | undefined,
  values: FieldValues | undefined,
  fieldId: string,
  fallback: unknown,
): { readonly missing: boolean; readonly value?: unknown } {
  const field = contract?.fields.find((candidate) => candidate.id === fieldId);
  if (field === undefined) return { missing: true };
  const stored = values?.[fieldId]?.value;
  if (stored !== undefined && fieldValueMatches(field, stored)) return { missing: false, value: stored };
  if (field.default !== undefined && fieldValueMatches(field, field.default)) {
    return { missing: false, value: field.default };
  }
  if (fallback !== undefined && fieldValueMatches(field, fallback)) {
    return { missing: false, value: fallback };
  }
  return { missing: true };
}

function validateFieldDefinitionForAuthoring(field: FieldDefinition): void {
  if (field.id.trim().length === 0 || field.label.trim().length === 0) {
    throw new EditorCommandVocabularyError("Give this weekly field a name.");
  }
  if (field.type === "choice" && (field.constraints?.choices?.length ?? 0) === 0) {
    throw new EditorCommandVocabularyError("Add at least one choice.");
  }
  if (field.type === "array" && field.itemField === undefined) {
    throw new EditorCommandVocabularyError("Choose what each repeated item contains.");
  }
  if (field.default !== undefined && !fieldValueMatches(field, field.default)) {
    throw new EditorCommandVocabularyError("The default value does not match this weekly field.");
  }
  if (
    field.profileKey !== undefined &&
    !profileKeyIsCompatible(field, field.profileKey)
  ) {
    throw new EditorCommandVocabularyError(
      "Choose a Church Profile value that matches this weekly field type.",
    );
  }
}

function contractWithAddedField(
  contract: FieldContract | undefined,
  field: FieldDefinition,
  contractId: string,
  contractName: string,
): FieldContract {
  validateFieldDefinitionForAuthoring(field);
  if (contract?.fields.some((candidate) => candidate.id === field.id) === true) {
    throw new EditorCommandVocabularyError("A weekly field with that name already exists.");
  }
  return contract === undefined
    ? { id: contractId, version: 1, name: contractName, fields: [field] }
    : { ...bumpedContract(contract), fields: [...contract.fields, field] };
}

function patchDocumentContract(
  document: CbbDocument,
  contract: FieldContract,
): DocumentPatch {
  return document.fieldContract === undefined
    ? { op: "add", path: "/fieldContract", value: contract }
    : { op: "replace", path: "/fieldContract", value: contract };
}

function bindingList(element: NativeElement): readonly Binding[] {
  return element.type === "customInstance" ? [] : element.bindings ?? [];
}

function withBindings(element: NativeElement, bindings: readonly Binding[]): NativeElement {
  if (element.type === "customInstance") {
    throw new EditorCommandVocabularyError("Choose content inside the Saved section instead.");
  }
  if (bindings.length === 0) {
    const { bindings: _bindings, ...rest } = element;
    return rest as NativeElement;
  }
  return { ...element, bindings };
}

function ensureBindable(
  element: NativeElement,
  field: FieldDefinition,
  target: string,
): void {
  if (bindingList(element).some((binding) =>
    binding.target === target ||
    binding.target.startsWith(`${target}/`) ||
    target.startsWith(`${binding.target}/`)
  )) {
    throw new EditorCommandVocabularyError(
      "That content overlaps an existing Linked weekly field.",
    );
  }
  const property = bindableProperties(element).find((candidate) => candidate.target === target);
  if (property === undefined) {
    throw new EditorCommandVocabularyError("That content cannot be connected to a weekly field.");
  }
  if (!property.acceptedTypes.includes(field.type)) {
    throw new EditorCommandVocabularyError(
      `Choose a compatible weekly field for ${element.name}.`,
    );
  }
}

function replaceDefinitionElement(
  definition: CustomElementDefinition,
  nodeId: NodeId,
  replacement: NativeElement,
): CustomElementDefinition {
  let found = false;
  const elements = mapElements(definition.elements, (element) => {
    if (element.id !== nodeId) return element;
    found = true;
    return replacement;
  });
  if (!found) throw new EditorCommandVocabularyError("That item is no longer available.");
  return { ...definition, elements };
}

function bindingCommandRequirements(
  context: EditorCommandContext,
  owner: TemplateFieldOwner,
  nodeId: NodeId,
): readonly CapabilityRequirement[] {
  ownedElementLocation(context.document, owner, nodeId);
  return [
    ...ownerRequirements("template.editBindings", owner),
    { capability: "template.editBindings", target: nodeTarget(nodeId) },
  ];
}

export interface AddWeeklyFieldInput {
  readonly owner: TemplateFieldOwner;
  readonly field: FieldDefinition;
  readonly contractId: string;
  readonly contractName?: string;
}

/** Add one document or Saved Section field as an undoable template edit. */
export function createAddWeeklyFieldCommand(input: AddWeeklyFieldInput): EditorCommand {
  return {
    id: `template.addWeeklyField:${input.owner.kind}:${input.field.id}`,
    label: `Add weekly field “${input.field.label}”`,
    capabilities: ownerRequirements("template.editFieldContract", input.owner),
    createPatches: ({ document }) => {
      const nextContract = contractWithAddedField(
        contractForOwner(document, input.owner),
        input.field,
        input.contractId,
        input.contractName ?? "Weekly fields",
      );
      if (input.owner.kind === "document") {
        return [
          patchDocumentContract(document, nextContract),
          ...semanticRoleMetadataMirrorPatches({
            document,
            contract: nextContract,
            values: document.fieldValues,
            roles: input.field.semanticRole === undefined ? [] : [input.field.semanticRole],
          }),
        ];
      }
      return withDefinition(document, input.owner.definitionId, (definition) => ({
        ...definition,
        fieldContract: nextContract,
      }));
    },
    selectAfter: {
      kind: "field",
      fieldId: input.field.id,
      ...(input.owner.kind === "savedSection"
        ? { ownerNodeId: input.owner.definitionId }
        : {}),
    },
  };
}

export interface UpdateWeeklyFieldInput {
  readonly owner: TemplateFieldOwner;
  readonly fieldId: string;
  readonly field: FieldDefinition;
}

/** Church Profile fields that v1 templates may offer during weekly setup. */
export type ChurchProfileFieldKey = CoreChurchProfileFieldKey;

export interface AddWeeklyFieldGroupInput {
  readonly owner: TemplateFieldOwner;
  readonly group: FieldContractGroup;
  readonly contractId: string;
  readonly contractName?: string;
}

export interface UpdateWeeklyFieldGroupInput {
  readonly owner: TemplateFieldOwner;
  readonly groupId: string;
  readonly group: FieldContractGroup;
}

function validateFieldGroupForAuthoring(group: FieldContractGroup): void {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/u.test(group.id)) {
    throw new EditorCommandVocabularyError(
      "The setup-form group needs a stable name that starts with a letter.",
    );
  }
  if (group.label.trim().length === 0) {
    throw new EditorCommandVocabularyError("Give this setup-form group a name.");
  }
}

function validateGroupConditionalRule(
  document: CbbDocument,
  owner: TemplateFieldOwner,
  group: FieldContractGroup,
): void {
  if (group.conditionalRuleId === undefined) return;
  if (!rulesForOwner(document, owner).some((rule) =>
    rule.kind === "conditional" && rule.scope === "document" && rule.id === group.conditionalRuleId)) {
    throw new EditorCommandVocabularyError(
      "Choose an available Show this section when rule for this setup-form group.",
    );
  }
}

function contractWithGroups(
  contract: FieldContract,
  groups: readonly FieldContractGroup[],
): FieldContract {
  const { groups: _groups, ...editable } = withoutContractHash(contract);
  return groups.length === 0 ? editable : { ...editable, groups };
}

function patchOwnerContract(
  document: CbbDocument,
  owner: TemplateFieldOwner,
  contract: FieldContract,
): readonly DocumentPatch[] {
  return owner.kind === "document"
    ? [patchDocumentContract(document, contract)]
    : withDefinition(document, owner.definitionId, (definition) => ({
        ...definition,
        fieldContract: contract,
      }));
}

/** Add a visual setup-form group without requiring a weekly field first. */
export function createAddWeeklyFieldGroupCommand(
  input: AddWeeklyFieldGroupInput,
): EditorCommand {
  return {
    id: `template.addWeeklyFieldGroup:${input.owner.kind}:${input.group.id}`,
    label: `Add setup-form group “${input.group.label}”`,
    capabilities: ownerRequirements("template.editFieldContract", input.owner),
    createPatches: ({ document }) => {
      validateFieldGroupForAuthoring(input.group);
      validateGroupConditionalRule(document, input.owner, input.group);
      const contract = contractForOwner(document, input.owner);
      if (contract?.groups?.some((group) => group.id === input.group.id) === true) {
        throw new EditorCommandVocabularyError("A setup-form group with that name already exists.");
      }
      const next = contract === undefined
        ? {
            id: input.contractId,
            version: 1,
            name: input.contractName ?? "Weekly fields",
            groups: [input.group],
            fields: [],
          }
        : contractWithGroups(contract, [...(contract.groups ?? []), input.group]);
      return patchOwnerContract(document, input.owner, next);
    },
  };
}

/** Rename or describe a visual setup-form group while preserving its identity. */
export function createUpdateWeeklyFieldGroupCommand(
  input: UpdateWeeklyFieldGroupInput,
): EditorCommand {
  return {
    id: `template.updateWeeklyFieldGroup:${input.owner.kind}:${input.groupId}`,
    label: `Update setup-form group “${input.group.label}”`,
    capabilities: ownerRequirements("template.editFieldContract", input.owner),
    createPatches: ({ document }) => {
      validateFieldGroupForAuthoring(input.group);
      validateGroupConditionalRule(document, input.owner, input.group);
      if (input.group.id !== input.groupId) {
        throw new EditorCommandVocabularyError("Setup-form group identity cannot be renamed.");
      }
      const contract = contractForOwner(document, input.owner);
      const index = contract?.groups?.findIndex((group) => group.id === input.groupId) ?? -1;
      if (contract === undefined || index < 0) {
        throw new EditorCommandVocabularyError("That setup-form group is no longer available.");
      }
      const groups = [...(contract.groups ?? [])];
      groups[index] = input.group;
      return patchOwnerContract(document, input.owner, contractWithGroups(contract, groups));
    },
  };
}

/** Remove a visual group and leave its weekly fields available as ungrouped fields. */
export function createRemoveWeeklyFieldGroupCommand(input: {
  readonly owner: TemplateFieldOwner;
  readonly groupId: string;
}): EditorCommand {
  return {
    id: `template.removeWeeklyFieldGroup:${input.owner.kind}:${input.groupId}`,
    label: "Remove setup-form group",
    capabilities: ownerRequirements("template.editFieldContract", input.owner),
    createPatches: ({ document }) => {
      const contract = contractForOwner(document, input.owner);
      if (contract?.groups?.some((group) => group.id === input.groupId) !== true) {
        throw new EditorCommandVocabularyError("That setup-form group is no longer available.");
      }
      const groups = (contract.groups ?? []).filter((group) => group.id !== input.groupId);
      const fields = contract.fields.map((field) => {
        if (field.groupId !== input.groupId) return field;
        const { groupId: _groupId, ...ungrouped } = field;
        return ungrouped;
      });
      return patchOwnerContract(
        document,
        input.owner,
        { ...contractWithGroups(contract, groups), fields },
      );
    },
  };
}

/** Move a visual group to an exact position in the ordered setup form. */
export function createReorderWeeklyFieldGroupCommand(input: {
  readonly owner: TemplateFieldOwner;
  readonly groupId: string;
  readonly toIndex: number;
}): EditorCommand {
  return {
    id: `template.reorderWeeklyFieldGroup:${input.owner.kind}:${input.groupId}`,
    label: "Reorder setup-form group",
    capabilities: ownerRequirements("template.editFieldContract", input.owner),
    createPatches: ({ document }) => {
      const contract = contractForOwner(document, input.owner);
      const groups = [...(contract?.groups ?? [])];
      const fromIndex = groups.findIndex((group) => group.id === input.groupId);
      if (contract === undefined || fromIndex < 0) {
        throw new EditorCommandVocabularyError("That setup-form group is no longer available.");
      }
      if (!Number.isInteger(input.toIndex) || input.toIndex < 0 || input.toIndex >= groups.length) {
        throw new EditorCommandVocabularyError("Choose a valid position for this setup-form group.");
      }
      const [group] = groups.splice(fromIndex, 1);
      groups.splice(input.toIndex, 0, group as FieldContractGroup);
      return patchOwnerContract(document, input.owner, contractWithGroups(contract, groups));
    },
  };
}

/** Assign a weekly field to a visual group, or pass no group to make it ungrouped. */
export function createAssignWeeklyFieldGroupCommand(input: {
  readonly owner: TemplateFieldOwner;
  readonly fieldId: string;
  readonly groupId?: string;
}): EditorCommand {
  return {
    id: `template.assignWeeklyFieldGroup:${input.owner.kind}:${input.fieldId}`,
    label: "Change weekly field group",
    capabilities: ownerRequirements("template.editFieldContract", input.owner),
    createPatches: ({ document }) => {
      const contract = contractForOwner(document, input.owner);
      const index = contract?.fields.findIndex((field) => field.id === input.fieldId) ?? -1;
      if (contract === undefined || index < 0) {
        throw new EditorCommandVocabularyError("That weekly field is no longer available.");
      }
      if (
        input.groupId !== undefined &&
        contract.groups?.some((group) => group.id === input.groupId) !== true
      ) {
        throw new EditorCommandVocabularyError("Choose an available setup-form group.");
      }
      const field = contract.fields[index] as FieldDefinition;
      const { groupId: _groupId, ...ungrouped } = field;
      const fields = [...contract.fields];
      fields[index] = input.groupId === undefined
        ? ungrouped
        : { ...ungrouped, groupId: input.groupId };
      return patchOwnerContract(
        document,
        input.owner,
        { ...withoutContractHash(contract), fields },
      );
    },
  };
}

/** Move a weekly field to an exact position in the contract's authoritative order. */
export function createReorderWeeklyFieldCommand(input: {
  readonly owner: TemplateFieldOwner;
  readonly fieldId: string;
  readonly toIndex: number;
}): EditorCommand {
  return {
    id: `template.reorderWeeklyField:${input.owner.kind}:${input.fieldId}`,
    label: "Reorder weekly field",
    capabilities: ownerRequirements("template.editFieldContract", input.owner),
    createPatches: ({ document }) => {
      const contract = contractForOwner(document, input.owner);
      const fields = [...(contract?.fields ?? [])];
      const fromIndex = fields.findIndex((field) => field.id === input.fieldId);
      if (contract === undefined || fromIndex < 0) {
        throw new EditorCommandVocabularyError("That weekly field is no longer available.");
      }
      if (!Number.isInteger(input.toIndex) || input.toIndex < 0 || input.toIndex >= fields.length) {
        throw new EditorCommandVocabularyError("Choose a valid position for this weekly field.");
      }
      const [field] = fields.splice(fromIndex, 1);
      fields.splice(input.toIndex, 0, field as FieldDefinition);
      return patchOwnerContract(
        document,
        input.owner,
        { ...withoutContractHash(contract), fields },
      );
    },
  };
}

function profileKeyIsCompatible(
  field: FieldDefinition,
  profileKey: unknown,
): profileKey is ChurchProfileFieldKey {
  return churchProfileKeyAcceptsFieldType(profileKey, field.type);
}

/** Offer a compatible Church Profile value in weekly setup, or clear the offer. */
export function createSetWeeklyFieldProfileMappingCommand(input: {
  readonly owner: TemplateFieldOwner;
  readonly fieldId: string;
  readonly profileKey?: ChurchProfileFieldKey;
}): EditorCommand {
  return {
    id: `template.setWeeklyFieldProfileMapping:${input.owner.kind}:${input.fieldId}`,
    label: "Change Church Profile mapping",
    capabilities: ownerRequirements("template.editFieldContract", input.owner),
    createPatches: ({ document }) => {
      const contract = contractForOwner(document, input.owner);
      const index = contract?.fields.findIndex((field) => field.id === input.fieldId) ?? -1;
      const field = contract?.fields[index];
      if (contract === undefined || field === undefined || index < 0) {
        throw new EditorCommandVocabularyError("That weekly field is no longer available.");
      }
      if (input.profileKey !== undefined && !profileKeyIsCompatible(field, input.profileKey)) {
        throw new EditorCommandVocabularyError(
          "That Church Profile value is not compatible with this weekly field.",
        );
      }
      if (field.profileKey === input.profileKey) return [];
      const { profileKey: _profileKey, ...unmapped } = field;
      const fields = [...contract.fields];
      const nextField = input.profileKey === undefined
        ? unmapped
        : { ...unmapped, profileKey: input.profileKey };
      fields[index] = nextField;
      return patchOwnerContract(
        document,
        input.owner,
        { ...contractAfterWeeklyFieldChange(contract, field, nextField), fields },
      );
    },
  };
}

export function createUpdateWeeklyFieldCommand(input: UpdateWeeklyFieldInput): EditorCommand {
  return {
    id: `template.updateWeeklyField:${input.owner.kind}:${input.fieldId}`,
    label: `Update weekly field “${input.field.label}”`,
    capabilities: ownerRequirements("template.editFieldContract", input.owner),
    createPatches: ({ document }) => {
      validateFieldDefinitionForAuthoring(input.field);
      if (input.field.id !== input.fieldId) {
        throw new EditorCommandVocabularyError("Weekly field identity cannot be renamed.");
      }
      const contract = contractForOwner(document, input.owner);
      const index = contract?.fields.findIndex((field) => field.id === input.fieldId) ?? -1;
      const prior = contract?.fields[index];
      if (contract === undefined || prior === undefined || index < 0) {
        throw new EditorCommandVocabularyError("That weekly field is no longer available.");
      }
      if (prior.type !== input.field.type) {
        throw new EditorCommandVocabularyError(
          "Create a new weekly field to change its content type.",
        );
      }
      if (sameValue(prior, input.field)) return [];
      const fields = [...contract.fields];
      fields[index] = input.field;
      const next = {
        ...contractAfterWeeklyFieldChange(contract, prior, input.field),
        fields,
      };
      return input.owner.kind === "document"
        ? [
            patchDocumentContract(document, next),
            ...semanticRoleMetadataMirrorPatches({
              document,
              contract: next,
              values: document.fieldValues,
              // Removing a role may deliberately leave historical metadata in
              // place; assigning or changing one must establish its mirror.
              roles: input.field.semanticRole === undefined ? [] : [input.field.semanticRole],
            }),
          ]
        : withDefinition(document, input.owner.definitionId, (definition) => ({
            ...definition,
            fieldContract: next,
          }));
    },
  };
}

/** Set or clear an author-provided preview value without changing a default. */
export function createSetWeeklyFieldSampleValueCommand(input: {
  readonly owner: TemplateFieldOwner;
  readonly fieldId: string;
  readonly value: unknown;
}): EditorCommand {
  return {
    id: `template.setWeeklyFieldSample:${input.owner.kind}:${input.fieldId}`,
    label: "Change sample/test value",
    capabilities: ownerRequirements("template.editLifecycle", input.owner),
    createPatches: ({ document }) => {
      const field = contractForOwner(document, input.owner)?.fields.find(
        (candidate) => candidate.id === input.fieldId,
      );
      if (field === undefined) {
        throw new EditorCommandVocabularyError("That weekly field is no longer available.");
      }
      if (input.value !== undefined && !fieldValueMatches(field, input.value)) {
        throw new EditorCommandVocabularyError(
          `Enter a valid sample/test value for ${field.label}.`,
        );
      }
      const write = (values: FieldValues | undefined): FieldValues | undefined => {
        if (input.value === undefined) return withoutFieldValue(values, input.fieldId);
        return {
          ...(values ?? {}),
          [input.fieldId]: { value: input.value, origin: "manual" as const },
        };
      };
      if (input.owner.kind === "document") {
        const next = write(document.sampleFieldValues);
        if (sameValue(next, document.sampleFieldValues)) return [];
        if (next === undefined) return [{ op: "remove", path: "/sampleFieldValues" }];
        return [{
          op: document.sampleFieldValues === undefined ? "add" : "replace",
          path: "/sampleFieldValues",
          value: next,
        }];
      }
      return withDefinition(document, input.owner.definitionId, (definition) => {
        const next = write(definition.sampleFieldValues);
        if (next === undefined) {
          const { sampleFieldValues: _samples, ...base } = definition;
          return base;
        }
        return { ...definition, sampleFieldValues: next };
      });
    },
    selectAfter: {
      kind: "field",
      fieldId: input.fieldId,
      ...(input.owner.kind === "savedSection"
        ? { ownerNodeId: input.owner.definitionId }
        : {}),
    },
  };
}

function customInstanceValueState(
  document: CbbDocument,
): ReadonlyMap<NodeId, FieldValues | undefined> {
  const values = new Map<NodeId, FieldValues | undefined>();
  const collect = (element: NativeElement): NativeElement => {
    if (element.type === "customInstance") values.set(element.id, element.fieldValues);
    return element;
  };
  mapElements(document.elements, collect);
  for (const wrapper of document.pageElements ?? []) mapElements([wrapper.element], collect);
  return values;
}

function customInstanceTestStateMatches(source: CbbDocument, next: CbbDocument): boolean {
  const sourceValues = customInstanceValueState(source);
  for (const [instanceId, fieldValues] of customInstanceValueState(next)) {
    if (!sourceValues.has(instanceId)) {
      if (fieldValues !== undefined) return false;
      continue;
    }
    if (!sameValue(fieldValues, sourceValues.get(instanceId))) return false;
  }
  return true;
}

/**
 * Commit a reviewed authoring-only sandbox projection as one undoable edit.
 * Identity, live weekly values, and review evidence must already match the
 * source document; this command rejects accidental test-state ingress.
 */
export function createApplyTemplateAuthoringChangesCommand(input: {
  readonly document: CbbDocument;
}): EditorCommand {
  return {
    id: "template.applyReviewedSandboxAuthoring",
    label: "Apply reviewed authoring changes to template",
    // The reviewed projection may itself remove document layout protection.
    // Use the protection-edit gate (Customize Layout, but not the current
    // layout lock) so an explicitly reviewed unlock can be applied atomically.
    capabilities: [{ capability: "authoringPolicy.edit", target: { kind: "document" } }],
    createPatches: ({ document }) => {
      const next = input.document;
      if (
        next.kind !== document.kind ||
        next.name !== document.name ||
        !sameValue(next.metadata, document.metadata) ||
        !sameValue(next.fieldValues, document.fieldValues) ||
        !sameValue(next.fieldReview, document.fieldReview) ||
        !sameValue(next.contentReview, document.contentReview) ||
        !sameValue(next.sourceTemplate, document.sourceTemplate) ||
        !sameValue(next.orphanedFieldValues, document.orphanedFieldValues) ||
        !customInstanceTestStateMatches(document, next)
      ) {
        throw new EditorCommandVocabularyError(
          "Test values and review state cannot be applied to the template.",
        );
      }
      return sameValue(next, document)
        ? []
        : [{ op: "replace", path: "", value: next }];
    },
    selectAfter: { kind: "document" },
  };
}

function withoutFieldValue(
  values: FieldValues | undefined,
  fieldId: string,
): FieldValues | undefined {
  if (values === undefined || !Object.hasOwn(values, fieldId)) return values;
  const { [fieldId]: _removed, ...remaining } = values;
  return Object.keys(remaining).length === 0 ? undefined : remaining;
}

function archiveOrphan(
  orphaned: Readonly<Record<string, unknown>>,
  preferredKey: string,
  value: unknown,
): Readonly<Record<string, unknown>> {
  let key = preferredKey;
  let suffix = 2;
  while (Object.hasOwn(orphaned, key)) key = `${preferredKey}#${suffix++}`;
  return { ...orphaned, [key]: value };
}

function orphanPatch(
  document: CbbDocument,
  orphaned: Readonly<Record<string, unknown>>,
): DocumentPatch | undefined {
  if (sameValue(orphaned, document.orphanedFieldValues ?? {})) return undefined;
  return {
    op: document.orphanedFieldValues === undefined ? "add" : "replace",
    path: "/orphanedFieldValues",
    value: orphaned,
  };
}

function removeBindingsForField(
  elements: readonly NativeElement[],
  scope: "document" | "local",
  fieldId: string,
  contract: FieldContract,
  values: FieldValues | undefined,
): readonly NativeElement[] {
  return mapElements(elements, (element) => {
    if (element.type === "customInstance" || element.bindings === undefined) return element;
    const removed = element.bindings.filter(
      (binding) => binding.scope === scope && binding.fieldId === fieldId,
    );
    if (removed.length === 0) return element;
    let literal: NativeElement = element;
    for (const binding of removed) {
      const effective = effectiveFieldValue(contract, values, fieldId, binding.fallback);
      if (effective.missing) {
        if (targetRequiresLiteral(element, binding.target)) {
          throw new EditorCommandVocabularyError(
            "Add a current or default value before removing this weekly field.",
          );
        }
        literal = deletePointer(literal, binding.target) as NativeElement;
        continue;
      }
      literal = writePointer(
        literal,
        binding.target,
        literalBindingValue(literal, binding.target, effective.value),
      ) as NativeElement;
    }
    const bindings = element.bindings.filter(
      (binding) => !(binding.scope === scope && binding.fieldId === fieldId),
    );
    return withBindings(literal, bindings);
  });
}

function elementsWithFieldBinding(
  elements: readonly NativeElement[],
  scope: "document" | "local",
  fieldId: string,
): readonly NodeId[] {
  const ids: NodeId[] = [];
  mapElements(elements, (element) => {
    if (
      element.type !== "customInstance" &&
      element.bindings?.some((binding) =>
        binding.scope === scope && binding.fieldId === fieldId) === true
    ) {
      ids.push(element.id);
    }
    return element;
  });
  return ids;
}

function removeFieldRequirements(
  context: EditorCommandContext,
  owner: TemplateFieldOwner,
  fieldId: string,
): readonly CapabilityRequirement[] {
  const requirements: CapabilityRequirement[] = [
    ...ownerRequirements("template.editFieldContract", owner),
  ];
  const document = context.document;
  const ruleElements = elementsForOwner(document, owner);
  const priorRules = rulesForOwner(document, owner);
  const nextRules = rulesWithoutField(priorRules, fieldId, ruleElements) ?? [];
  const remaining = new Set(nextRules.map((rule) => rule.id));
  for (const rule of priorRules) {
    if (remaining.has(rule.id)) continue;
    requirements.push({
      capability: "template.editRules",
      target: nodeTarget(rule.kind === "repeat" ? rule.prototypeNodeId : rule.targetNodeId),
    });
  }
  const bindingNodeIds = owner.kind === "document"
    ? [
        ...elementsWithFieldBinding(document.elements, "document", fieldId),
        ...(document.pageElements ?? []).flatMap((wrapper) =>
          elementsWithFieldBinding([wrapper.element], "document", fieldId)),
        ...(document.customElementDefinitions ?? []).flatMap((definition) =>
          elementsWithFieldBinding(definition.elements, "document", fieldId)),
      ]
    : elementsWithFieldBinding(
        definitionLocation(document, owner.definitionId).definition.elements,
        "local",
        fieldId,
      );
  for (const nodeId of new Set(bindingNodeIds)) {
    requirements.push({ capability: "template.editBindings", target: nodeTarget(nodeId) });
  }
  return requirements;
}

function rulesWithoutField(
  rules: readonly ContentRule[] | undefined,
  fieldId: string,
  elements: readonly NativeElement[],
): readonly ContentRule[] | undefined {
  if (rules === undefined) return undefined;
  const directlyFiltered = rules.filter((rule) => rule.fieldId !== fieldId);
  const remainingRepeats = directlyFiltered.filter(
    (rule): rule is RepeatRule => rule.kind === "repeat",
  );
  const elementById = new Map<NodeId, NativeElement>();
  mapElements(elements, (element) => {
    elementById.set(element.id, element);
    return element;
  });
  const contains = (element: NativeElement, nodeId: NodeId): boolean =>
    element.id === nodeId || (
      (element.type === "grid" || element.type === "stack" || element.type === "canvas") &&
      element.children.some((wrapper) => contains(wrapper.element, nodeId))
    );
  const filtered = directlyFiltered.filter((rule) => {
    if (rule.kind !== "conditional" || rule.scope !== "item") return true;
    return remainingRepeats.some((repeat) => {
      const prototype = elementById.get(repeat.prototypeNodeId);
      return prototype !== undefined && contains(prototype, rule.targetNodeId);
    });
  });
  return filtered.length === 0 ? undefined : filtered;
}

function contractWithoutField(
  contract: FieldContract,
  fieldId: string,
  priorRules: readonly ContentRule[] | undefined,
  nextRules: readonly ContentRule[] | undefined,
): FieldContract {
  const remainingRuleIds = new Set((nextRules ?? []).map((rule) => rule.id));
  const removedRuleIds = new Set(
    (priorRules ?? [])
      .filter((rule) => !remainingRuleIds.has(rule.id))
      .map((rule) => rule.id),
  );
  const groups = contract.groups?.map((group) => {
    if (group.conditionalRuleId === undefined || !removedRuleIds.has(group.conditionalRuleId)) {
      return group;
    }
    const { conditionalRuleId: _ruleId, ...rest } = group;
    return rest;
  });
  return {
    ...bumpedContract(contract),
    fields: contract.fields.filter((candidate) => candidate.id !== fieldId),
    ...(groups === undefined ? {} : { groups }),
  };
}

function removeInstanceFieldValues(
  elements: readonly NativeElement[],
  definitionId: NodeId,
  fieldId: string,
): readonly NativeElement[] {
  return mapElements(elements, (element) => {
    if (element.type !== "customInstance" || element.definitionId !== definitionId) {
      return element;
    }
    const fieldValues = withoutFieldValue(element.fieldValues, fieldId);
    if (fieldValues === element.fieldValues) return element;
    if (fieldValues === undefined) {
      const { fieldValues: _fieldValues, ...rest } = element;
      return rest;
    }
    return { ...element, fieldValues };
  });
}

export function createRemoveWeeklyFieldCommand(input: {
  readonly owner: TemplateFieldOwner;
  readonly fieldId: string;
}): EditorCommand {
  return {
    id: `template.removeWeeklyField:${input.owner.kind}:${input.fieldId}`,
    label: "Remove weekly field",
    capabilities: (context) => removeFieldRequirements(context, input.owner, input.fieldId),
    createPatches: ({ document }) => {
      const contract = contractForOwner(document, input.owner);
      const field = contract?.fields.find((candidate) => candidate.id === input.fieldId);
      if (contract === undefined || field === undefined) {
        throw new EditorCommandVocabularyError("That weekly field is no longer available.");
      }
      if (input.owner.kind === "document") {
        let orphaned = document.orphanedFieldValues ?? {};
        const removedValue = document.fieldValues?.[input.fieldId];
        if (removedValue !== undefined) {
          orphaned = archiveOrphan(
            orphaned,
            `document:${contract.id}:${input.fieldId}`,
            removedValue,
          );
        }
        const removedSample = document.sampleFieldValues?.[input.fieldId];
        if (removedSample !== undefined) {
          orphaned = archiveOrphan(
            orphaned,
            `document-sample:${contract.id}:${input.fieldId}`,
            removedSample,
          );
        }
        const rules = rulesWithoutField(
          document.contentRules,
          input.fieldId,
          document.elements,
        );
        const nextContract = contractWithoutField(
          contract,
          input.fieldId,
          document.contentRules,
          rules,
        );
        const patches: DocumentPatch[] = [patchDocumentContract(document, nextContract)];
        const archive = orphanPatch(document, orphaned);
        if (archive !== undefined) patches.push(archive);
        const fieldValues = withoutFieldValue(document.fieldValues, input.fieldId);
        const sampleValues = withoutFieldValue(document.sampleFieldValues, input.fieldId);
        if (fieldValues !== document.fieldValues) {
          patches.push(fieldValues === undefined
            ? { op: "remove", path: "/fieldValues" }
            : { op: "replace", path: "/fieldValues", value: fieldValues });
        }
        if (sampleValues !== document.sampleFieldValues) {
          patches.push(sampleValues === undefined
            ? { op: "remove", path: "/sampleFieldValues" }
            : { op: "replace", path: "/sampleFieldValues", value: sampleValues });
        }
        const fieldReview = document.fieldReview?.filter((review) => !(
          review.target.scope === "document" && review.target.fieldId === input.fieldId
        ));
        if (fieldReview !== undefined && fieldReview.length !== document.fieldReview?.length) {
          patches.push(fieldReview.length === 0
            ? { op: "remove", path: "/fieldReview" }
            : { op: "replace", path: "/fieldReview", value: fieldReview });
        }
        if (!sameValue(rules, document.contentRules)) {
          patches.push(rules === undefined
            ? { op: "remove", path: "/contentRules" }
            : { op: "replace", path: "/contentRules", value: rules });
        }
        const elements = removeBindingsForField(
          document.elements,
          "document",
          input.fieldId,
          contract,
          document.fieldValues,
        );
        const pageElements = document.pageElements?.map((wrapper) => ({
          ...wrapper,
          element: removeBindingsForField(
            [wrapper.element],
            "document",
            input.fieldId,
            contract,
            document.fieldValues,
          )[0] as typeof wrapper.element,
        }));
        const definitions = mapDefinitionElements(
          document.customElementDefinitions ?? [],
          (element) => {
            if (element.type === "customInstance" || element.bindings === undefined) return element;
            return removeBindingsForField(
              [element],
              "document",
              input.fieldId,
              contract,
              document.fieldValues,
            )[0] as NativeElement;
          },
        );
        patches.push(...definitionsTransaction(document, definitions, elements, pageElements));
        return patches;
      }

      const definitionId = input.owner.definitionId;
      const { index } = definitionLocation(document, definitionId);
      let definitions = [...(document.customElementDefinitions ?? [])];
      const current = definitions[index] as CustomElementDefinition;
      let orphaned = document.orphanedFieldValues ?? {};
      const removedSample = current.sampleFieldValues?.[input.fieldId];
      if (removedSample !== undefined) {
        orphaned = archiveOrphan(
          orphaned,
          `local-sample:${definitionId}:${input.fieldId}`,
          removedSample,
        );
      }
      const instanceSources = [
        ...customInstances(document.elements, definitionId),
        ...(document.pageElements ?? []).flatMap((wrapper) =>
          customInstances([wrapper.element], definitionId)),
        ...(document.customElementDefinitions ?? []).flatMap((definition) =>
          customInstances(definition.elements, definitionId)),
      ];
      for (const instance of instanceSources) {
        const removedValue = instance.fieldValues?.[input.fieldId];
        if (removedValue === undefined) continue;
        orphaned = archiveOrphan(
          orphaned,
          `local:${definitionId}:${instance.id}:${input.fieldId}`,
          removedValue,
        );
      }
      const sampleFieldValues = withoutFieldValue(current.sampleFieldValues, input.fieldId);
      const nextRules = rulesWithoutField(current.contentRules, input.fieldId, current.elements);
      const nextContract = contractWithoutField(
        contract,
        input.fieldId,
        current.contentRules,
        nextRules,
      );
      const { contentRules: _oldRules, sampleFieldValues: _oldSamples, ...base } = current;
      definitions[index] = {
        ...base,
        fieldContract: nextContract,
        elements: removeBindingsForField(
          current.elements,
          "local",
          input.fieldId,
          contract,
          current.sampleFieldValues,
        ),
        ...(nextRules === undefined ? {} : { contentRules: nextRules }),
        ...(sampleFieldValues === undefined ? {} : { sampleFieldValues }),
      };
      definitions = mapDefinitionElements(definitions, (element) => {
        if (element.type !== "customInstance" || element.definitionId !== definitionId) {
          return element;
        }
        const fieldValues = withoutFieldValue(element.fieldValues, input.fieldId);
        if (fieldValues === element.fieldValues) return element;
        if (fieldValues === undefined) {
          const { fieldValues: _values, ...rest } = element;
          return rest;
        }
        return { ...element, fieldValues };
      }) as CustomElementDefinition[];
      const rootElements = removeInstanceFieldValues(
        document.elements,
        definitionId,
        input.fieldId,
      );
      const pageElements = document.pageElements?.map((wrapper) => ({
        ...wrapper,
        element: removeInstanceFieldValues(
          [wrapper.element],
          definitionId,
          input.fieldId,
        )[0] as typeof wrapper.element,
      }));
      const ownerIds = new Set<NodeId>([
        ...customInstances(document.elements, definitionId).map((instance) => instance.id),
        ...(document.pageElements ?? []).flatMap((wrapper) =>
          customInstances([wrapper.element], definitionId).map((instance) => instance.id)),
      ]);
      const fieldReview = document.fieldReview?.filter((review) => !(
        review.target.scope === "local" &&
        ownerIds.has(review.target.ownerNodeId) &&
        review.target.fieldId === input.fieldId
      ));
      const patches = [...definitionsTransaction(
        document,
        definitions,
        rootElements,
        pageElements,
      )];
      const archive = orphanPatch(document, orphaned);
      if (archive !== undefined) patches.push(archive);
      if (fieldReview !== undefined && fieldReview.length !== document.fieldReview?.length) {
        patches.push(fieldReview.length === 0
          ? { op: "remove", path: "/fieldReview" }
          : { op: "replace", path: "/fieldReview", value: fieldReview });
      }
      return patches;
    },
    selectAfter: { kind: "document" },
  };
}

export interface LinkWeeklyFieldInput {
  readonly owner: TemplateFieldOwner;
  readonly nodeId: NodeId;
  readonly fieldId: string;
  readonly target: string;
  readonly bindingId: string;
  readonly fallback?: unknown;
}

export function createLinkWeeklyFieldCommand(input: LinkWeeklyFieldInput): EditorCommand {
  return {
    id: `template.linkWeeklyField:${input.bindingId}`,
    label: "Connect Linked weekly field",
    capabilities: (context) => bindingCommandRequirements(
      context,
      input.owner,
      input.nodeId,
    ),
    createPatches: ({ document }) => {
      if (collectBindingIds(document).has(input.bindingId)) {
        throw new EditorCommandVocabularyError("Could not create a unique weekly field connection.");
      }
      const contract = contractForOwner(document, input.owner);
      const field = contract?.fields.find((candidate) => candidate.id === input.fieldId);
      if (field === undefined) {
        throw new EditorCommandVocabularyError("Choose an available weekly field.");
      }
      const location = ownedElementLocation(document, input.owner, input.nodeId);
      ensureBindable(location.element, field, input.target);
      const fallback = input.fallback === undefined
        ? bindingFallbackFromLiteral(location.element, input.target)
        : input.fallback;
      const binding: Binding = {
        id: input.bindingId,
        scope: input.owner.kind === "document" ? "document" : "local",
        fieldId: field.id,
        target: input.target,
        ...(fallback === undefined ? {} : { fallback }),
      };
      const boundElement = deletePointer(location.element, input.target) as NativeElement;
      const element = withBindings(boundElement, [
        ...bindingList(location.element),
        binding,
      ]);
      const nextContract = bumpedContract(contract as FieldContract);
      if (input.owner.kind === "document") {
        return [
          patchDocumentContract(document, nextContract),
          { op: "replace", path: location.path, value: element },
        ];
      }
      return withDefinition(document, input.owner.definitionId, (definition) => ({
        ...replaceDefinitionElement(definition, input.nodeId, element),
        fieldContract: nextContract,
      }));
    },
    selectAfter: selectionForNode(input.nodeId),
  };
}

export interface MakeWeeklyFieldInput extends LinkWeeklyFieldInput {
  readonly field: FieldDefinition;
  readonly contractId: string;
  readonly contractName?: string;
}

/** Create the field and its visible connection in one undoable transaction. */
export function createMakeWeeklyFieldCommand(input: MakeWeeklyFieldInput): EditorCommand {
  return {
    id: `template.makeWeeklyField:${input.bindingId}`,
    label: `Make “${input.field.label}” a weekly field`,
    capabilities: (context) => [
      ...ownerRequirements("template.editFieldContract", input.owner),
      ...bindingCommandRequirements(context, input.owner, input.nodeId),
    ],
    createPatches: ({ document }) => {
      if (input.fieldId !== input.field.id) {
        throw new EditorCommandVocabularyError("The new weekly field does not match its connection.");
      }
      if (collectBindingIds(document).has(input.bindingId)) {
        throw new EditorCommandVocabularyError("Could not create a unique weekly field connection.");
      }
      const contract = contractWithAddedField(
        contractForOwner(document, input.owner),
        input.field,
        input.contractId,
        input.contractName ?? "Weekly fields",
      );
      const location = ownedElementLocation(document, input.owner, input.nodeId);
      ensureBindable(location.element, input.field, input.target);
      const fallback = input.fallback === undefined
        ? bindingFallbackFromLiteral(location.element, input.target)
        : input.fallback;
      const binding: Binding = {
        id: input.bindingId,
        scope: input.owner.kind === "document" ? "document" : "local",
        fieldId: input.field.id,
        target: input.target,
        ...(fallback === undefined ? {} : { fallback }),
      };
      const boundElement = deletePointer(location.element, input.target) as NativeElement;
      const element = withBindings(boundElement, [
        ...bindingList(location.element),
        binding,
      ]);
      if (input.owner.kind === "document") {
        return [
          patchDocumentContract(document, contract),
          { op: "replace", path: location.path, value: element },
        ];
      }
      return withDefinition(document, input.owner.definitionId, (definition) => ({
        ...replaceDefinitionElement(definition, input.nodeId, element),
        fieldContract: contract,
      }));
    },
    selectAfter: {
      kind: "field",
      fieldId: input.field.id,
      ...(input.owner.kind === "savedSection"
        ? { ownerNodeId: input.owner.definitionId }
        : {}),
    },
  };
}

function pointerSegments(pointer: string): readonly string[] {
  if (!pointer.startsWith("/")) {
    throw new EditorCommandVocabularyError("This Linked weekly field cannot be made independent.");
  }
  return pointer.slice(1).split("/").map((segment) =>
    segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function writePointer(root: unknown, pointer: string, value: unknown): unknown {
  const segments = pointerSegments(pointer);
  function write(current: unknown, index: number): unknown {
    if (index === segments.length) return value;
    const key = segments[index] as string;
    if (Array.isArray(current)) {
      const next = [...current];
      next[Number(key)] = write(next[Number(key)], index + 1);
      return next;
    }
    const record = current !== null && typeof current === "object"
      ? current as Readonly<Record<string, unknown>>
      : {};
    return { ...record, [key]: write(record[key], index + 1) };
  }
  return write(root, 0);
}

function deletePointer(root: unknown, pointer: string): unknown {
  const segments = pointerSegments(pointer);
  function remove(current: unknown, index: number): unknown {
    if (index >= segments.length) return undefined;
    const key = segments[index] as string;
    if (Array.isArray(current)) {
      const next = [...current];
      if (index === segments.length - 1) next.splice(Number(key), 1);
      else next[Number(key)] = remove(next[Number(key)], index + 1);
      return next;
    }
    if (current === null || typeof current !== "object") return current;
    const record = current as Readonly<Record<string, unknown>>;
    if (!Object.hasOwn(record, key)) return current;
    if (index === segments.length - 1) {
      const { [key]: _removed, ...rest } = record;
      return rest;
    }
    return { ...record, [key]: remove(record[key], index + 1) };
  }
  return remove(root, 0);
}

function bindingFallbackFromLiteral(element: NativeElement, target: string): unknown {
  const literal = readPointer(element, target);
  if (element.type !== "text" || target !== "/data/content") return literal;
  if (literal === null || typeof literal !== "object") return literal;
  const content = literal as Readonly<Record<string, unknown>>;
  return content["kind"] === "plain" ? content["text"] : content["document"];
}

function targetRequiresLiteral(element: NativeElement, target: string): boolean {
  if (element.type === "text") {
    return target === "/data/content" ||
      target === "/data/content/text" ||
      target === "/data/content/document";
  }
  if (element.type === "date") return target === "/data/value";
  if (element.type === "image") {
    return target === "/data/assetRef" ||
      target === "/data/focalPoint/x" ||
      target === "/data/focalPoint/y";
  }
  return element.type === "music" && target === "/data/title";
}

function effectiveBindingValue(
  document: CbbDocument,
  owner: TemplateFieldOwner,
  binding: Binding,
): unknown {
  const contract = contractForOwner(document, owner);
  const values = owner.kind === "document"
    ? document.fieldValues
    : definitionLocation(document, owner.definitionId).definition.sampleFieldValues;
  const effective = effectiveFieldValue(contract, values, binding.fieldId, binding.fallback);
  if (effective.missing) {
    throw new EditorCommandVocabularyError(
      "Add a current or default value before making this Linked weekly field independent.",
    );
  }
  return effective.value;
}

function literalBindingValue(
  element: NativeElement,
  target: string,
  value: unknown,
): unknown {
  if (element.type !== "text" || target !== "/data/content") return value;
  return typeof value === "string"
    ? { kind: "plain", text: value }
    : { kind: "richText", document: value };
}

export function createMakeIndependentCommand(input: {
  readonly owner: TemplateFieldOwner;
  readonly nodeId: NodeId;
  readonly bindingId: string;
}): EditorCommand {
  return {
    id: `template.makeIndependent:${input.bindingId}`,
    label: "Make independent",
    capabilities: (context) => bindingCommandRequirements(
      context,
      input.owner,
      input.nodeId,
    ),
    createPatches: ({ document }) => {
      const location = ownedElementLocation(document, input.owner, input.nodeId);
      const binding = bindingList(location.element).find(
        (candidate) => candidate.id === input.bindingId,
      );
      if (binding === undefined) {
        throw new EditorCommandVocabularyError("That weekly field connection is no longer available.");
      }
      let literal = location.element;
      try {
        const value = literalBindingValue(
          location.element,
          binding.target,
          effectiveBindingValue(document, input.owner, binding),
        );
        literal = writePointer(location.element, binding.target, value) as NativeElement;
      } catch (error) {
        if (targetRequiresLiteral(location.element, binding.target)) throw error;
        literal = deletePointer(location.element, binding.target) as NativeElement;
      }
      const element = withBindings(
        literal,
        bindingList(location.element).filter((candidate) => candidate.id !== binding.id),
      );
      const contract = contractForOwner(document, input.owner);
      if (contract === undefined) {
        throw new EditorCommandVocabularyError("That weekly field contract is no longer available.");
      }
      const nextContract = bumpedContract(contract);
      if (input.owner.kind === "document") {
        return [
          patchDocumentContract(document, nextContract),
          { op: "replace", path: location.path, value: element },
        ];
      }
      return withDefinition(document, input.owner.definitionId, (definition) => ({
        ...replaceDefinitionElement(definition, input.nodeId, element),
        fieldContract: nextContract,
      }));
    },
    selectAfter: selectionForNode(input.nodeId),
  };
}

/** Set the weekly stale-content reminder for content not linked to a field. */
export function createSetUnboundContentReviewCommand(input: {
  readonly owner: TemplateFieldOwner;
  readonly nodeId: NodeId;
  readonly weeklyReview: "everyBulletin" | "whenDuplicated" | "none";
}): EditorCommand {
  return {
    id: `template.setUnboundReview:${input.nodeId}`,
    label: "Change unlinked content review",
    capabilities: () => [
      ...ownerRequirements("template.editLifecycle", input.owner),
      { capability: "template.editLifecycle", target: nodeTarget(input.nodeId) },
    ],
    createPatches: ({ document }) => {
      const location = ownedElementLocation(document, input.owner, input.nodeId);
      if (bindingList(location.element).length > 0) {
        throw new EditorCommandVocabularyError(
          "Linked content uses its weekly field review setting instead.",
        );
      }
      if (bindableProperties(location.element).length === 0) {
        throw new EditorCommandVocabularyError(
          "Choose unlinked text, a date, an image, or song content.",
        );
      }
      const replacement = {
        ...location.element,
        weeklyReview: input.weeklyReview,
      } as NativeElement;
      if (input.owner.kind === "document") {
        return [{
          op: location.element.weeklyReview === undefined ? "add" : "replace",
          path: `${location.path}/weeklyReview`,
          value: input.weeklyReview,
        }];
      }
      return withDefinition(document, input.owner.definitionId, (definition) =>
        replaceDefinitionElement(definition, input.nodeId, replacement));
    },
    selectAfter: selectionForNode(input.nodeId),
  };
}

function conditionMatches(value: unknown, condition: ConditionKind): boolean {
  switch (condition.kind) {
    case "booleanEquals": return value === condition.value;
    case "choiceEquals": return typeof value === "string" && value === condition.choiceId;
    case "choiceNotEquals": return typeof value === "string" && value !== condition.choiceId;
  }
}

function validateConditional(
  field: FieldDefinition,
  condition: ConditionKind,
): void {
  if (condition.kind === "booleanEquals" && field.type !== "boolean") {
    throw new EditorCommandVocabularyError("Choose a Yes/No weekly field for this condition.");
  }
  if (condition.kind !== "booleanEquals") {
    if (field.type !== "choice") {
      throw new EditorCommandVocabularyError("Choose a choice weekly field for this condition.");
    }
    const choiceId = condition.choiceId;
    if (field.constraints?.choices?.some((choice) => choice.id === choiceId) !== true) {
      throw new EditorCommandVocabularyError("Choose one of this weekly field’s available choices.");
    }
  }
}

function addRulePatches(
  document: CbbDocument,
  owner: TemplateFieldOwner,
  rule: ContentRule,
): readonly DocumentPatch[] {
  const rules = rulesForOwner(document, owner);
  if (rules.some((candidate) => candidate.id === rule.id)) {
    throw new EditorCommandVocabularyError("That section rule already exists.");
  }
  if (owner.kind === "document") {
    return [{
      op: document.contentRules === undefined ? "add" : "replace",
      path: "/contentRules",
      value: [...rules, rule],
    }];
  }
  return withDefinition(document, owner.definitionId, (definition) => ({
    ...definition,
    contentRules: [...rules, rule],
  }));
}

export interface AddConditionalRuleInput {
  readonly owner: TemplateFieldOwner;
  readonly ruleId: string;
  readonly targetNodeId: NodeId;
  readonly fieldId: string;
  readonly condition: ConditionKind;
  readonly activateLabel: string;
  readonly inactiveLabel: string;
}

export function createAddConditionalRuleCommand(
  input: AddConditionalRuleInput,
): EditorCommand {
  return {
    id: `template.addConditional:${input.ruleId}`,
    label: "Add optional-section rule",
    capabilities: (context) => {
      ownedElementLocation(context.document, input.owner, input.targetNodeId);
      return [
        ...ownerRequirements("template.editRules", input.owner),
        { capability: "template.editRules", target: nodeTarget(input.targetNodeId) },
      ];
    },
    createPatches: ({ document }) => {
      const field = contractForOwner(document, input.owner)?.fields.find(
        (candidate) => candidate.id === input.fieldId,
      );
      if (field === undefined) throw new EditorCommandVocabularyError("Choose a weekly field.");
      validateConditional(field, input.condition);
      ownedElementLocation(document, input.owner, input.targetNodeId);
      if (rulesForOwner(document, input.owner).some(
        (rule) => rule.kind === "conditional" && rule.targetNodeId === input.targetNodeId,
      )) {
        throw new EditorCommandVocabularyError("That section already has a show/hide rule.");
      }
      const rule: ConditionalRule = {
        kind: "conditional",
        id: input.ruleId,
        targetNodeId: input.targetNodeId,
        scope: "document",
        fieldId: input.fieldId,
        condition: input.condition,
        activateLabel: input.activateLabel.trim() || "Show section",
        inactiveLabel: input.inactiveLabel.trim() || "Hide section",
      };
      return addRulePatches(document, input.owner, rule);
    },
    selectAfter: selectionForNode(input.targetNodeId),
  };
}

export interface AddRepeatRuleInput {
  readonly owner: TemplateFieldOwner;
  readonly ruleId: string;
  readonly prototypeNodeId: NodeId;
  readonly fieldId: string;
  readonly maxItems: number;
  readonly itemLabel: string;
  readonly addLabel: string;
  readonly userReorderable: boolean;
  readonly emptyState?: RepeatRule["emptyState"];
  readonly itemBindings?: readonly ItemBinding[];
  /** @deprecated Use itemBindings for structured repeat items. */
  readonly itemBinding?: ItemBinding;
}

export function createAddRepeatRuleCommand(input: AddRepeatRuleInput): EditorCommand {
  return {
    id: `template.addRepeat:${input.ruleId}`,
    label: "Allow more than one",
    capabilities: (context) => {
      ownedElementLocation(context.document, input.owner, input.prototypeNodeId);
      return [
        ...ownerRequirements("template.editRules", input.owner),
        { capability: "template.editRules", target: nodeTarget(input.prototypeNodeId) },
      ];
    },
    createPatches: ({ document }) => {
      const field = contractForOwner(document, input.owner)?.fields.find(
        (candidate) => candidate.id === input.fieldId,
      );
      if (field?.type !== "array" || field.itemField === undefined) {
        throw new EditorCommandVocabularyError("Choose a repeatable weekly field.");
      }
      if (!Number.isSafeInteger(input.maxItems) || input.maxItems < 1) {
        throw new EditorCommandVocabularyError("Maximum items must be a whole number of at least 1.");
      }
      if (field.constraints?.maxItems !== undefined && input.maxItems > field.constraints.maxItems) {
        throw new EditorCommandVocabularyError(
          `Maximum items cannot exceed ${field.constraints.maxItems} for this weekly field.`,
        );
      }
      ownedElementLocation(document, input.owner, input.prototypeNodeId);
      if (rulesForOwner(document, input.owner).some(
        (rule) => rule.kind === "repeat" && rule.prototypeNodeId === input.prototypeNodeId,
      )) {
        throw new EditorCommandVocabularyError("That section already allows more than one item.");
      }
      const itemBindings = input.itemBindings ?? (
        input.itemBinding === undefined ? undefined : [input.itemBinding]
      );
      const rule: RepeatRule = {
        kind: "repeat",
        id: input.ruleId,
        fieldId: input.fieldId,
        prototypeNodeId: input.prototypeNodeId,
        ...(itemBindings === undefined || itemBindings.length === 0 ? {} : { itemBindings }),
        emptyState: input.emptyState ?? { mode: "collapse" },
        maxItems: input.maxItems,
        userReorderable: input.userReorderable,
        itemLabel: input.itemLabel.trim() || "Item",
        addLabel: input.addLabel.trim() || "Add item",
      };
      return addRulePatches(document, input.owner, rule);
    },
    selectAfter: selectionForNode(input.prototypeNodeId),
  };
}

export function createUpdateContentRuleCommand(input: {
  readonly owner: TemplateFieldOwner;
  readonly rule: ContentRule;
}): EditorCommand {
  return {
    id: `template.updateRule:${input.rule.id}`,
    label: input.rule.kind === "repeat" ? "Update repeated section" : "Update optional section",
    capabilities: (context) => {
      const prior = rulesForOwner(context.document, input.owner).find(
        (candidate) => candidate.id === input.rule.id,
      );
      if (prior === undefined) {
        throw new EditorCommandVocabularyError("That section rule is no longer available.");
      }
      const targetNodeId = input.rule.kind === "repeat"
        ? input.rule.prototypeNodeId
        : input.rule.targetNodeId;
      ownedElementLocation(context.document, input.owner, targetNodeId);
      const priorTargetNodeId = prior.kind === "repeat"
        ? prior.prototypeNodeId
        : prior.targetNodeId;
      return [
        ...ownerRequirements("template.editRules", input.owner),
        { capability: "template.editRules", target: nodeTarget(priorTargetNodeId) },
        ...(priorTargetNodeId === targetNodeId ? [] : [
          { capability: "template.editRules" as const, target: nodeTarget(targetNodeId) },
        ]),
      ];
    },
    createPatches: ({ document }) => {
      const rules = rulesForOwner(document, input.owner);
      const index = rules.findIndex((candidate) => candidate.id === input.rule.id);
      if (index < 0) throw new EditorCommandVocabularyError("That section rule is no longer available.");
      const next = [...rules];
      next[index] = input.rule;
      if (input.owner.kind === "document") {
        return [{ op: "replace", path: "/contentRules", value: next }];
      }
      return withDefinition(document, input.owner.definitionId, (definition) => ({
        ...definition,
        contentRules: next,
      }));
    },
  };
}

export function createRemoveContentRuleCommand(input: {
  readonly owner: TemplateFieldOwner;
  readonly ruleId: string;
}): EditorCommand {
  return {
    id: `template.removeRule:${input.ruleId}`,
    label: "Remove section rule",
    capabilities: (context) => {
      const rule = rulesForOwner(context.document, input.owner).find(
        (candidate) => candidate.id === input.ruleId,
      );
      if (rule === undefined) {
        throw new EditorCommandVocabularyError("That section rule is no longer available.");
      }
      const targetNodeId = rule.kind === "repeat" ? rule.prototypeNodeId : rule.targetNodeId;
      return [
        ...ownerRequirements("template.editRules", input.owner),
        { capability: "template.editRules", target: nodeTarget(targetNodeId) },
      ];
    },
    createPatches: ({ document }) => {
      const rules = rulesForOwner(document, input.owner);
      if (!rules.some((candidate) => candidate.id === input.ruleId)) {
        throw new EditorCommandVocabularyError("That section rule is no longer available.");
      }
      const next = rules.filter((candidate) => candidate.id !== input.ruleId);
      if (input.owner.kind === "document") {
        const patches: DocumentPatch[] = next.length === 0
          ? [{ op: "remove", path: "/contentRules" }]
          : [{ op: "replace", path: "/contentRules", value: next }];
        const contract = document.fieldContract;
        if (contract?.groups?.some((group) => group.conditionalRuleId === input.ruleId)) {
          const groups = contract.groups.map((group) => {
            if (group.conditionalRuleId !== input.ruleId) return group;
            const { conditionalRuleId: _conditionalRuleId, ...visible } = group;
            return visible;
          });
          patches.push(patchDocumentContract(document, contractWithGroups(contract, groups)));
        }
        return patches;
      }
      return withDefinition(document, input.owner.definitionId, (definition) => {
        const { contentRules: _rules, ...base } = definition;
        const contract = definition.fieldContract;
        const groups = contract.groups?.map((group) => {
          if (group.conditionalRuleId !== input.ruleId) return group;
          const { conditionalRuleId: _conditionalRuleId, ...visible } = group;
          return visible;
        });
        const fieldContract = groups === undefined
          ? contract
          : contractWithGroups(contract, groups);
        return next.length === 0
          ? { ...base, fieldContract }
          : { ...base, contentRules: next, fieldContract };
      });
    },
  };
}

function nextNodeId(idPort: IdPort, used: Set<string>): NodeId {
  for (;;) {
    const candidate = `n${idPort.randomUuid().replaceAll("-", "")}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

function remintTree(
  element: NativeElement,
  idPort: IdPort,
  used: Set<string>,
  bindingIds: Set<string>,
  nodeIds?: Map<NodeId, NodeId>,
): NativeElement {
  const id = nextNodeId(idPort, used);
  nodeIds?.set(element.id, id);
  let next: NativeElement = { ...element, id };
  if (element.type !== "customInstance" && element.bindings !== undefined) {
    next = {
      ...next,
      bindings: element.bindings.map((binding) => {
        let bindingId: string;
        do bindingId = `connection-${idPort.randomUuid()}`;
        while (bindingIds.has(bindingId));
        bindingIds.add(bindingId);
        return { ...binding, id: bindingId };
      }),
    } as NativeElement;
  }
  if (element.type === "grid" || element.type === "stack" || element.type === "canvas") {
    next = {
      ...next,
      children: element.children.map((wrapper) => ({
        ...wrapper,
        id: nextNodeId(idPort, used),
        element: remintTree(wrapper.element, idPort, used, bindingIds, nodeIds),
      })),
    } as NativeElement;
  }
  return next;
}

function collectBindingIds(document: CbbDocument): Set<string> {
  const ids = new Set<string>();
  const collect = (element: NativeElement): NativeElement => {
    if (element.type !== "customInstance") {
      for (const binding of element.bindings ?? []) ids.add(binding.id);
    }
    return element;
  };
  mapElements(document.elements, collect);
  for (const wrapper of document.pageElements ?? []) mapElements([wrapper.element], collect);
  for (const definition of document.customElementDefinitions ?? []) {
    mapElements(definition.elements, collect);
    for (const rule of definition.contentRules ?? []) {
      if (rule.kind === "repeat") {
        for (const binding of rule.itemBindings ?? []) ids.add(binding.id);
      }
    }
  }
  for (const rule of document.contentRules ?? []) {
    if (rule.kind === "repeat") for (const binding of rule.itemBindings ?? []) ids.add(binding.id);
  }
  return ids;
}

function customInstances(
  elements: readonly NativeElement[],
  definitionId: NodeId,
): readonly NativeElement[] {
  const found: NativeElement[] = [];
  mapElements(elements, (element) => {
    if (element.type === "customInstance" && element.definitionId === definitionId) {
      found.push(element);
    }
    return element;
  });
  return found;
}

export interface SaveAsSavedSectionInput {
  readonly nodeId: NodeId;
  readonly definitionId: NodeId;
  readonly contractId: string;
  readonly name: string;
  readonly description?: string;
  readonly idPort: IdPort;
}

/** Save the selected source and replace it with a pinned reusable instance. */
export function createSaveAsSavedSectionCommand(
  input: SaveAsSavedSectionInput,
): EditorCommand {
  return {
    id: `template.saveAsSavedSection:${input.definitionId}`,
    label: `Save “${input.name}” for reuse`,
    capabilities: (context) => {
      const location = findElementLocation(context.document, input.nodeId);
      if (location === undefined) throw new EditorCommandVocabularyError("That section is no longer available.");
      return [
        { capability: "template.editLifecycle", target: { kind: "document" } },
        { capability: "layout.editStructure", target: nodeTarget(input.nodeId) },
      ];
    },
    createPatches: ({ document }) => {
      if (input.name.trim().length === 0) {
        throw new EditorCommandVocabularyError("Give this Saved section a name.");
      }
      if (document.customElementDefinitions?.some((definition) => definition.id === input.definitionId)) {
        throw new EditorCommandVocabularyError("A Saved section with that identity already exists.");
      }
      const location = findElementLocation(document, input.nodeId);
      if (location === undefined) throw new EditorCommandVocabularyError("That section is no longer available.");
      const used = new Set<string>(collectAllNodeIds(document));
      used.add(input.definitionId);
      const source = remintTree(location.element, input.idPort, used, collectBindingIds(document));
      const definitionDraft = {
        version: 1 as const,
        kind: "customElementDefinition" as const,
        id: input.definitionId,
        definitionVersion: 1,
        name: input.name.trim(),
        ...(input.description?.trim() ? { description: input.description.trim() } : {}),
        fieldContract: {
          id: input.contractId,
          version: 1,
          name: `${input.name.trim()} weekly fields`,
          fields: [],
        },
        elements: [source],
      };
      const definition: CustomElementDefinition = {
        ...definitionDraft,
        definitionHash: customElementDefinitionHash(definitionDraft),
      };
      const definitions = [...(document.customElementDefinitions ?? []), definition];
      const instance: NativeElement = {
        id: location.element.id,
        type: "customInstance",
        name: input.name.trim(),
        definitionId: definition.id,
        definitionVersion: definition.definitionVersion,
        definitionHash: definition.definitionHash,
        ...(location.element.width === undefined ? {} : { width: location.element.width }),
        ...(location.element.height === undefined ? {} : { height: location.element.height }),
        ...(location.element.breakPolicy === undefined ? {} : { breakPolicy: location.element.breakPolicy }),
        ...(location.element.margin === undefined ? {} : { margin: location.element.margin }),
        ...(location.element.padding === undefined ? {} : { padding: location.element.padding }),
        ...(location.element.style === undefined ? {} : { style: location.element.style }),
        ...(location.element.authoringPolicy === undefined ? {} : { authoringPolicy: location.element.authoringPolicy }),
        ...(location.element.weeklyReview === undefined ? {} : { weeklyReview: location.element.weeklyReview }),
      };
      const rootElements = mapElements(document.elements, (element) =>
        element.id === input.nodeId ? instance : element);
      const pageElements = document.pageElements?.map((wrapper) => ({
        ...wrapper,
        element: mapElements([wrapper.element], (element) =>
          element.id === input.nodeId ? instance : element)[0] as typeof wrapper.element,
      }));
      return definitionsTransaction(document, definitions, rootElements, pageElements);
    },
    selectAfter: selectionForNode(input.nodeId),
  };
}

export function createInsertSavedSectionCommand(input: {
  readonly definitionId: NodeId;
  readonly instanceId: NodeId;
  readonly index: number;
}): EditorCommand {
  return {
    id: `template.insertSavedSection:${input.instanceId}`,
    label: "Insert Saved section",
    capabilities: [
      { capability: "template.editLifecycle", target: { kind: "document" } },
      { capability: "layout.editStructure", target: { kind: "document" } },
    ],
    createPatches: ({ document }) => {
      const definition = definitionLocation(document, input.definitionId).definition;
      if (collectAllNodeIds(document).has(input.instanceId)) {
        throw new EditorCommandVocabularyError("Could not create a unique Saved section item.");
      }
      const index = Math.max(0, Math.min(input.index, document.elements.length));
      const instance: NativeElement = {
        id: input.instanceId,
        type: "customInstance",
        name: definition.name,
        definitionId: definition.id,
        definitionVersion: definition.definitionVersion,
        definitionHash: definition.definitionHash,
      };
      const definitionContainsRights = documentHasActiveRightsAttribution({
        ...document,
        elements: [instance],
        pageElements: [],
      });
      if (definitionContainsRights && documentHasActiveRightsAttribution(document)) {
        throw new EditorCommandVocabularyError(
          "This bulletin already has Copyrights & Permissions. Move or edit that block instead.",
        );
      }
      const elements = [...document.elements];
      elements.splice(index, 0, instance);
      return [{ op: "replace", path: "/elements", value: elements }];
    },
    selectAfter: selectionForNode(input.instanceId),
  };
}

interface SavedSectionItemContext {
  readonly rule: RepeatRule;
  readonly item: unknown;
}

function readItemValue(item: unknown, itemPath: string): unknown {
  if (itemPath === "") return item;
  if (!itemPath.startsWith("/")) return undefined;
  let current = item;
  for (const raw of itemPath.slice(1).split("/")) {
    const segment = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(current)) current = current[Number(segment)];
    else if (current !== null && typeof current === "object") {
      current = (current as Readonly<Record<string, unknown>>)[segment];
    } else return undefined;
  }
  return current;
}

function repeatItems(
  definition: CustomElementDefinition,
  values: FieldValues | undefined,
  rule: RepeatRule,
): readonly unknown[] | undefined {
  const effective = effectiveFieldValue(
    definition.fieldContract,
    values,
    rule.fieldId,
    undefined,
  );
  if (effective.missing) return undefined;
  if (effective.value === null && rule.nullIsEmpty === true) return [];
  return Array.isArray(effective.value) ? effective.value : undefined;
}

function materializeSavedSectionRoots(
  definition: CustomElementDefinition,
  values: FieldValues | undefined,
): readonly NativeElement[] {
  const conditionals = new Map<NodeId, ConditionalRule[]>();
  const repeats = new Map<NodeId, RepeatRule>();
  const emptyStates = new Map<NodeId, RepeatRule>();
  for (const rule of definition.contentRules ?? []) {
    if (rule.kind === "conditional") {
      const list = conditionals.get(rule.targetNodeId) ?? [];
      list.push(rule);
      conditionals.set(rule.targetNodeId, list);
    } else {
      repeats.set(rule.prototypeNodeId, rule);
      if (rule.emptyState.mode === "show") emptyStates.set(rule.emptyState.nodeId, rule);
    }
  }

  const coalesce = (
    source: NativeElement,
    expanded: readonly NativeElement[],
  ): NativeElement | undefined => {
    if (expanded.length === 0) return undefined;
    if (expanded.length === 1) return expanded[0];
    return {
      id: source.id,
      type: "stack",
      name: source.name,
      data: { direction: "vertical", gap: "0pt" },
      children: expanded.map((element, index) => ({
        id: `${source.id}-expanded-${index}`,
        index,
        element,
      })),
    };
  };

  const expand = (
    source: NativeElement,
    items: readonly SavedSectionItemContext[],
    skipRepeatId?: string,
    inheritedContract: FieldContract = definition.fieldContract,
    inheritedValues: FieldValues | undefined = values,
  ): readonly NativeElement[] => {
    const localContract = source.type !== "customInstance" && source.fieldContract !== undefined
      ? source.fieldContract
      : inheritedContract;
    const localValues = source.type !== "customInstance" && source.fieldContract !== undefined
      ? source.fieldValues
      : inheritedValues;
    const emptyOwner = emptyStates.get(source.id);
    if (emptyOwner !== undefined) {
      const repeated = repeatItems(definition, values, emptyOwner);
      if (repeated === undefined || repeated.length > 0) return [];
    }

    for (const conditional of conditionals.get(source.id) ?? []) {
      let value: unknown;
      if (conditional.scope === "document") {
        const effective = effectiveFieldValue(
          definition.fieldContract,
          values,
          conditional.fieldId,
          undefined,
        );
        if (effective.missing) return [];
        value = effective.value;
      } else {
        const context = items.at(-1);
        if (context === undefined) return [];
        value = conditional.fieldId.startsWith("/")
          ? readItemValue(context.item, conditional.fieldId)
          : readItemValue(context.item, `/${conditional.fieldId}`);
      }
      if (!conditionMatches(value, conditional.condition)) return [];
    }

    const repeat = repeats.get(source.id);
    if (repeat !== undefined && repeat.id !== skipRepeatId) {
      const repeated = repeatItems(definition, values, repeat);
      if (repeated === undefined || repeated.length === 0) return [];
      return repeated.flatMap((item) =>
        expand(
          source,
          [...items, { rule: repeat, item }],
          repeat.id,
          inheritedContract,
          inheritedValues,
        ));
    }

    let current = source;
    if (source.type === "stack") {
      const children = source.children.flatMap((wrapper) => {
        const child = coalesce(
          wrapper.element,
          expand(wrapper.element, items, undefined, localContract, localValues),
        );
        return child === undefined ? [] : [{ ...wrapper, element: child }];
      }).map((wrapper, index) => ({ ...wrapper, index }));
      current = { ...source, children };
    } else if (source.type === "grid") {
      const children = source.children.flatMap((wrapper) => {
        const child = coalesce(
          wrapper.element,
          expand(wrapper.element, items, undefined, localContract, localValues),
        );
        return child === undefined ? [] : [{ ...wrapper, element: child }];
      });
      current = { ...source, children };
    } else if (source.type === "canvas") {
      const children = source.children.flatMap((wrapper) => {
        const child = coalesce(
          wrapper.element,
          expand(wrapper.element, items, undefined, localContract, localValues),
        );
        return child === undefined ? [] : [{ ...wrapper, element: child }];
      });
      current = { ...source, children };
    }

    if (current.type !== "customInstance") {
      for (const binding of current.bindings ?? []) {
        if (binding.scope !== "local") continue;
        const effective = effectiveFieldValue(
          localContract,
          localValues,
          binding.fieldId,
          binding.fallback,
        );
        if (!effective.missing) {
          current = writePointer(
            current,
            binding.target,
            literalBindingValue(current, binding.target, effective.value),
          ) as NativeElement;
        }
      }
      current = withBindings(
        current,
        bindingList(current).filter((binding) => binding.scope !== "local"),
      );
      const authored = current as Exclude<NativeElement, { type: "customInstance" }>;
      const {
        fieldContract: _fieldContract,
        fieldValues: _fieldValues,
        ...literal
      } = authored;
      current = literal as NativeElement;
    }

    for (const context of items) {
      for (const binding of context.rule.itemBindings ?? []) {
        if (binding.targetNodeId !== current.id) continue;
        const value = readItemValue(context.item, binding.itemPath);
        if (value === undefined && binding.fallback === undefined) continue;
        current = writePointer(
          current,
          binding.target,
          literalBindingValue(
            current,
            binding.target,
            value === undefined ? binding.fallback : value,
          ),
        ) as NativeElement;
      }
    }
    return [current];
  };

  return definition.elements.flatMap((element) => expand(element, []));
}

export function createMakeSavedSectionIndependentCommand(input: {
  readonly instanceId: NodeId;
  readonly idPort: IdPort;
}): EditorCommand {
  return {
    id: `template.makeSavedSectionIndependent:${input.instanceId}`,
    label: "Make Saved section independent",
    capabilities: (context) => {
      const location = findElementLocation(context.document, input.instanceId);
      if (location?.element.type !== "customInstance") {
        throw new EditorCommandVocabularyError("That inserted Saved section is no longer available.");
      }
      return [
        { capability: "template.editLifecycle", target: { kind: "document" } },
        { capability: "layout.editStructure", target: nodeTarget(input.instanceId) },
      ];
    },
    createPatches: ({ document }) => {
      const location = findElementLocation(document, input.instanceId);
      if (location?.element.type !== "customInstance") {
        throw new EditorCommandVocabularyError("That inserted Saved section is no longer available.");
      }
      const instance = location.element;
      const definition = definitionLocation(document, instance.definitionId).definition;
      const used = new Set<string>(collectAllNodeIds(document));
      const bindingIds = collectBindingIds(document);
      const roots = materializeSavedSectionRoots(definition, instance.fieldValues).map((element) =>
        remintTree(element, input.idPort, used, bindingIds));
      const detached: NativeElement = {
        id: instance.id,
        type: "stack",
        name: instance.name,
        data: { direction: "vertical", gap: "0pt" },
        children: roots.map((element, index) => ({
          id: nextNodeId(input.idPort, used),
          index,
          element,
        })),
        ...(instance.width === undefined ? {} : { width: instance.width }),
        ...(instance.height === undefined ? {} : { height: instance.height }),
        ...(instance.breakPolicy === undefined ? {} : { breakPolicy: instance.breakPolicy }),
        ...(instance.margin === undefined ? {} : { margin: instance.margin }),
        ...(instance.padding === undefined ? {} : { padding: instance.padding }),
        ...(instance.style === undefined ? {} : { style: instance.style }),
        ...(instance.authoringPolicy === undefined ? {} : { authoringPolicy: instance.authoringPolicy }),
        ...(instance.weeklyReview === undefined ? {} : { weeklyReview: instance.weeklyReview }),
      };
      return [{ op: "replace", path: location.elementPath, value: detached }];
    },
    selectAfter: selectionForNode(input.instanceId),
  };
}

export function createRenameSavedSectionCommand(input: {
  readonly definitionId: NodeId;
  readonly name: string;
}): EditorCommand {
  return {
    id: `template.renameSavedSection:${input.definitionId}`,
    label: "Rename Saved section",
    capabilities: ownerRequirements("template.editLifecycle", {
      kind: "savedSection",
      definitionId: input.definitionId,
    }),
    createPatches: ({ document }) => {
      const name = input.name.trim();
      if (name.length === 0) throw new EditorCommandVocabularyError("Give this Saved section a name.");
      return withDefinition(document, input.definitionId, (definition) => ({
        ...definition,
        name,
      }));
    },
  };
}

export function createDuplicateSavedSectionCommand(input: {
  readonly definitionId: NodeId;
  readonly duplicateDefinitionId: NodeId;
  readonly contractId: string;
  readonly name: string;
  readonly idPort: IdPort;
}): EditorCommand {
  return {
    id: `template.duplicateSavedSection:${input.duplicateDefinitionId}`,
    label: "Duplicate Saved section",
    capabilities: ownerRequirements("template.editLifecycle", {
      kind: "savedSection",
      definitionId: input.definitionId,
    }),
    createPatches: ({ document }) => {
      const source = definitionLocation(document, input.definitionId).definition;
      if (document.customElementDefinitions?.some(
        (definition) => definition.id === input.duplicateDefinitionId,
      )) {
        throw new EditorCommandVocabularyError("Could not create a unique Saved section.");
      }
      const name = input.name.trim();
      if (name.length === 0) throw new EditorCommandVocabularyError("Give this Saved section a name.");
      const used = new Set<string>(collectAllNodeIds(document));
      used.add(input.duplicateDefinitionId);
      const bindingIds = collectBindingIds(document);
      const nodeIds = new Map<NodeId, NodeId>();
      const elements = source.elements.map((element) =>
        remintTree(element, input.idPort, used, bindingIds, nodeIds));
      const ruleIds = new Map<string, string>();
      for (const rule of source.contentRules ?? []) {
        ruleIds.set(rule.id, `rule-${input.idPort.randomUuid()}`);
      }
      const contentRules = source.contentRules?.map((rule): ContentRule => {
        const id = ruleIds.get(rule.id) as string;
        if (rule.kind === "conditional") {
          return {
            ...rule,
            id,
            targetNodeId: nodeIds.get(rule.targetNodeId) ?? rule.targetNodeId,
          };
        }
        return {
          ...rule,
          id,
          prototypeNodeId: nodeIds.get(rule.prototypeNodeId) ?? rule.prototypeNodeId,
          ...(rule.emptyState.mode === "show"
            ? {
                emptyState: {
                  mode: "show" as const,
                  nodeId: nodeIds.get(rule.emptyState.nodeId) ?? rule.emptyState.nodeId,
                },
              }
            : {}),
          ...(rule.itemBindings === undefined
            ? {}
            : {
                itemBindings: rule.itemBindings.map((binding) => ({
                  ...binding,
                  id: `connection-${input.idPort.randomUuid()}`,
                  targetNodeId: nodeIds.get(binding.targetNodeId) ?? binding.targetNodeId,
                })),
              }),
        };
      });
      const groups = source.fieldContract.groups?.map((group) => ({
        ...group,
        ...(group.conditionalRuleId === undefined
          ? {}
          : { conditionalRuleId: ruleIds.get(group.conditionalRuleId) ?? group.conditionalRuleId }),
      }));
      const duplicate: CustomElementDefinition = {
        ...source,
        id: input.duplicateDefinitionId,
        name,
        fieldContract: {
          ...withoutContractHash(source.fieldContract),
          id: input.contractId,
          name: `${name} weekly fields`,
          ...(groups === undefined ? {} : { groups }),
        },
        elements,
        ...(contentRules === undefined ? {} : { contentRules }),
      };
      return definitionsTransaction(
        document,
        [...(document.customElementDefinitions ?? []), duplicate],
      );
    },
  };
}

export function createRemoveSavedSectionCommand(input: {
  readonly definitionId: NodeId;
}): EditorCommand {
  return {
    id: `template.removeSavedSection:${input.definitionId}`,
    label: "Remove Saved section",
    capabilities: ownerRequirements("template.editLifecycle", {
      kind: "savedSection",
      definitionId: input.definitionId,
    }),
    createPatches: ({ document }) => {
      definitionLocation(document, input.definitionId);
      const references = [
        ...customInstances(document.elements, input.definitionId),
        ...(document.pageElements ?? []).flatMap((wrapper) =>
          customInstances([wrapper.element], input.definitionId)),
        ...(document.customElementDefinitions ?? []).flatMap((definition) =>
          customInstances(definition.elements, input.definitionId)),
      ];
      if (references.length > 0) {
        throw new EditorCommandVocabularyError(
          "Make every inserted copy independent before removing this Saved section.",
        );
      }
      return definitionsTransaction(
        document,
        (document.customElementDefinitions ?? []).filter(
          (definition) => definition.id !== input.definitionId,
        ),
      );
    },
  };
}

function readPointer(root: unknown, pointer: string): unknown {
  let current = root;
  for (const segment of pointerSegments(pointer)) {
    if (Array.isArray(current)) current = current[Number(segment)];
    else if (current !== null && typeof current === "object") {
      current = (current as Readonly<Record<string, unknown>>)[segment];
    } else return undefined;
  }
  return current;
}

export function bindableProperties(element: NativeElement): readonly BindableProperty[] {
  const candidates: readonly {
    readonly target: string;
    readonly label: string;
    readonly acceptedTypes: readonly FieldDefinition["type"][];
  }[] =
    element.type === "text"
      ? element.data.content?.kind === "richText"
        ? [{ target: "/data/content/document", label: "Formatted text", acceptedTypes: ["richText"] }]
        : element.data.content?.kind === "plain"
        ? [{ target: "/data/content/text", label: "Text", acceptedTypes: ["text", "choice"] }]
        : [{ target: "/data/content", label: "Text", acceptedTypes: ["text", "richText"] }]
      : element.type === "date"
        ? [{ target: "/data/value", label: "Date", acceptedTypes: ["date"] }]
        : element.type === "image"
          ? [
              { target: "/data/assetRef", label: "Image", acceptedTypes: ["assetRef"] },
              { target: "/data/alt", label: "Image description", acceptedTypes: ["text"] },
              { target: "/data/decorative", label: "Decorative image choice", acceptedTypes: ["boolean"] },
            ]
          : element.type === "music"
            ? [
                { target: "/data/title", label: "Song title", acceptedTypes: ["text"] },
                { target: "/data/number", label: "Song number", acceptedTypes: ["text", "choice"] },
                { target: "/data/instructions", label: "Song instructions", acceptedTypes: ["text", "choice"] },
                { target: "/data/source", label: "Song source", acceptedTypes: ["text"] },
                { target: "/data/richContent", label: "Formatted song content", acceptedTypes: ["richText"] },
              ]
            : [];
  return candidates.map((candidate) => ({
    ...candidate,
    currentValue: readPointer(element, candidate.target),
  }));
}

/** Plain-language helper for previews and tests. */
export function conditionalPreviewIsActive(
  rule: ConditionalRule,
  value: unknown,
): boolean {
  return conditionMatches(value, rule.condition);
}

/** Concrete, author-facing checks for field/rule connections. */
export function templateAuthoringDiagnostics(
  document: CbbDocument,
  owner: TemplateFieldOwner,
): readonly TemplateAuthoringDiagnostic[] {
  const elements = authorableElements(document, owner);
  const contract = contractForOwner(document, owner);
  const rules = rulesForOwner(document, owner);
  const fields = new Map((contract?.fields ?? []).map((field) => [field.id, field]));
  const nodes = new Map(elements.map((element) => [element.id, element]));
  const usedFields = new Set<string>();
  const diagnostics: TemplateAuthoringDiagnostic[] = [];
  const relevantScope = owner.kind === "document" ? "document" : "local";

  for (const element of elements) {
    for (const binding of bindingList(element)) {
      if (binding.scope !== relevantScope) continue;
      const field = fields.get(binding.fieldId);
      if (field === undefined) {
        diagnostics.push({
          code: "missingBindingField",
          severity: "error",
          fieldId: binding.fieldId,
          nodeId: element.id,
          message: `${element.name} is connected to a weekly field that no longer exists. Reconnect or remove it.`,
        });
      } else {
        usedFields.add(field.id);
      }
      const property = bindableProperties(element).find(
        (candidate) => candidate.target === binding.target,
      );
      if (property === undefined) {
        diagnostics.push({
          code: "brokenBindingTarget",
          severity: "error",
          nodeId: element.id,
          fieldId: binding.fieldId,
          message: `${element.name} has a content connection that is no longer available. Reconnect or remove it.`,
        });
      } else if (field !== undefined && !property.acceptedTypes.includes(field.type)) {
        diagnostics.push({
          code: "incompatibleBinding",
          severity: "error",
          nodeId: element.id,
          fieldId: field.id,
          message: `${element.name}: ${property.label} cannot use ${field.label} (${field.type}).`,
        });
      }
    }
  }

  for (const rule of rules) {
    if (rule.kind === "conditional" && rule.scope !== "document") continue;
    const field = fields.get(rule.fieldId);
    if (field === undefined) {
      diagnostics.push({
        code: "missingRuleField",
        severity: "error",
        fieldId: rule.fieldId,
        message: `${rule.kind === "repeat" ? "Repeated" : "Optional"} section rule uses missing weekly field “${rule.fieldId}”.`,
      });
    } else {
      usedFields.add(field.id);
    }
    const targetId = rule.kind === "repeat" ? rule.prototypeNodeId : rule.targetNodeId;
    if (!nodes.has(targetId)) {
      diagnostics.push({
        code: "missingRuleTarget",
        severity: "error",
        nodeId: targetId,
        message: `${rule.kind === "repeat" ? "Repeated" : "Optional"} section rule points to missing content “${targetId}”.`,
      });
    }
    if (rule.kind === "repeat") {
      if (rule.emptyState.mode === "show" && !nodes.has(rule.emptyState.nodeId)) {
        diagnostics.push({
          code: "missingRuleTarget",
          severity: "error",
          nodeId: rule.emptyState.nodeId,
          message: `Repeated section empty state points to missing content “${rule.emptyState.nodeId}”.`,
        });
      }
      for (const binding of rule.itemBindings ?? []) {
        const target = nodes.get(binding.targetNodeId);
        if (target === undefined || !bindableProperties(target).some(
          (property) => property.target === binding.target,
        )) {
          diagnostics.push({
            code: "brokenBindingTarget",
            severity: "error",
            nodeId: binding.targetNodeId,
            message: "Repeated item has a content connection that is no longer available. Reconnect or remove it.",
          });
        }
      }
    }
  }

  for (const field of fields.values()) {
    if (usedFields.has(field.id)) continue;
    diagnostics.push({
      code: "unusedField",
      severity: "warning",
      fieldId: field.id,
      message: `Weekly field “${field.label}” is unused. Connect it to content or a section rule, or remove it.`,
    });
  }
  return diagnostics;
}

/** All authorable source items in reading order; wrapper identities stay hidden. */
export function authorableElements(
  document: CbbDocument,
  owner: TemplateFieldOwner,
): readonly NativeElement[] {
  const result: NativeElement[] = [];
  mapElements(elementsForOwner(document, owner), (element) => {
    result.push(element);
    return element;
  });
  return result;
}

export function fieldOwnerContract(
  document: CbbDocument,
  owner: TemplateFieldOwner,
): FieldContract | undefined {
  return contractForOwner(document, owner);
}

export function fieldOwnerRules(
  document: CbbDocument,
  owner: TemplateFieldOwner,
): readonly ContentRule[] {
  return rulesForOwner(document, owner);
}
