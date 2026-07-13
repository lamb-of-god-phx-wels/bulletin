import {
  CHURCH_PROFILE_ASSET_FIELD_KEYS,
  CHURCH_PROFILE_TEXT_FIELD_KEYS,
  canonicalRevisionToken,
  churchProfileKeyAcceptsFieldType,
  fieldContractHash,
  finalizeCustomDefinitionRevisions,
  hashCanonical,
  parseRepeatItemId,
  type CbbDocument,
  type ChurchProfileFieldKey,
  type ContentRule,
  type CustomElementInstance,
  type FieldDefinition,
  type FieldContract,
  type FieldValueEntry,
  type FieldValues,
  type IdPort,
  type NativeElement,
  type CustomElementDefinition,
  type NodeId,
} from "@cbb/core";
import { findStarter, type StarterId } from "../onboarding/index.js";
import { semanticRoleMetadataMirrorPatches } from "../store/semanticRoleMirrors.js";

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneDocument(document: CbbDocument): CbbDocument {
  return cloneValue(document);
}

function withSemanticRoleMetadataMirrors(
  document: CbbDocument,
  roles: readonly ("publicationDate" | "serviceLabel")[],
): CbbDocument {
  const patches = semanticRoleMetadataMirrorPatches({
    document,
    contract: document.fieldContract,
    values: document.fieldValues,
    roles,
  });
  if (patches.length === 0) return document;
  const patch = patches[0];
  if (patches.length !== 1 || patch === undefined || patch.path !== "/metadata") {
    throw new Error("Semantic field metadata could not be synchronized safely.");
  }
  if (patch.op === "remove") {
    const { metadata: _metadata, ...withoutMetadata } = document;
    return withoutMetadata;
  }
  return {
    ...document,
    metadata: patch.value as NonNullable<CbbDocument["metadata"]>,
  };
}

export function localDateOnly(now = new Date()): string {
  return [
    String(now.getFullYear()).padStart(4, "0"),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function bulletinFieldValues(
  contract: FieldContract | undefined,
  rules: readonly ContentRule[] | undefined,
  publicationDate: string,
  idPort: IdPort,
): FieldValues | undefined {
  const fields = contract?.fields ?? [];
  const values: Record<string, FieldValues[string]> = {};
  const publicationDateField = fields.find(
    (field) => field.semanticRole === "publicationDate",
  );
  if (publicationDateField !== undefined) {
    values[publicationDateField.id] = {
      value: publicationDate,
      origin: "derived",
    };
  }
  const repeatFieldIds = new Set(
    (rules ?? []).filter((rule) => rule.kind === "repeat").map((rule) => rule.fieldId),
  );
  for (const field of fields) {
    if (!repeatFieldIds.has(field.id) || !Array.isArray(field.default)) {
      continue;
    }
    values[field.id] = {
      value: cloneValue(field.default),
      origin: "materializedDefault",
      itemIds: field.default.map(() => parseRepeatItemId(idPort.randomUuid())),
    };
  }
  return Object.keys(values).length === 0 ? undefined : values;
}

function mapElements(
  elements: readonly NativeElement[],
  transform: (element: NativeElement) => NativeElement,
): readonly NativeElement[] {
  const visit = (element: NativeElement): NativeElement => {
    const nested = element.type === "grid" || element.type === "stack" || element.type === "canvas"
      ? {
          ...element,
          children: element.children.map((wrapper) => ({
            ...wrapper,
            element: visit(wrapper.element),
          })),
        } as NativeElement
      : element;
    return transform(nested);
  };
  return elements.map(visit);
}

function localRepeatValues(
  definition: CustomElementDefinition | undefined,
  existing: FieldValues | undefined,
  idPort: IdPort,
): FieldValues | undefined {
  if (definition === undefined) return existing;
  const repeatFieldIds = new Set(
    (definition.contentRules ?? [])
      .filter((rule) => rule.kind === "repeat")
      .map((rule) => rule.fieldId),
  );
  if (repeatFieldIds.size === 0) return existing;
  const values: Record<string, FieldValues[string]> = { ...(existing ?? {}) };
  let changed = false;
  for (const field of definition.fieldContract.fields) {
    if (!repeatFieldIds.has(field.id)) continue;
    const stored = existing?.[field.id];
    const effective = stored?.value ?? field.default;
    if (!Array.isArray(effective)) continue;
    values[field.id] = {
      ...(stored ?? { value: cloneValue(effective), origin: "materializedDefault" as const }),
      itemIds: effective.map(() => parseRepeatItemId(idPort.randomUuid())),
    };
    changed = true;
  }
  if (!changed) return existing;
  return values;
}

function materializeCustomInstances(
  elements: readonly NativeElement[],
  definitions: ReadonlyMap<NodeId, CustomElementDefinition>,
  idPort: IdPort,
): readonly NativeElement[] {
  return mapElements(elements, (element) => {
    if (element.type !== "customInstance") return element;
    const fieldValues = localRepeatValues(
      definitions.get(element.definitionId),
      element.fieldValues,
      idPort,
    );
    return fieldValues === element.fieldValues || fieldValues === undefined
      ? element
      : { ...element, fieldValues };
  });
}

export function createBulletinFromStarter(input: {
  readonly starterId: StarterId;
  readonly idPort: IdPort;
  readonly publicationDate?: string;
  readonly displayName?: string;
}): CbbDocument {
  const starter = cloneDocument(findStarter(input.starterId).document);
  const publicationDate = input.publicationDate ?? localDateOnly();
  const displayName = input.displayName?.normalize("NFC").trim() ||
    `${findStarter(input.starterId).name} — ${publicationDate}`;
  return createBulletinFromTemplateDocument(starter, {
    idPort: input.idPort,
    publicationDate,
    displayName,
  });
}

export function createBulletinFromTemplateDocument(
  source: CbbDocument,
  input: {
    readonly idPort: IdPort;
    readonly publicationDate?: string;
    readonly displayName?: string;
  },
): CbbDocument {
  const template = cloneDocument(source);
  const publicationDate = input.publicationDate ?? localDateOnly();
  const displayName = input.displayName?.normalize("NFC").trim() ||
    `${template.name} — ${publicationDate}`;
  const lineage = template.fieldContract === undefined
    ? undefined
    : {
      contractId: template.fieldContract.id,
      contractVersion: template.fieldContract.version,
      contractHash: fieldContractHash(template.fieldContract),
      sourceDocumentHash: canonicalRevisionToken(template),
      sourceDisplayName: template.name,
    };
  const {
    sampleFieldValues,
    fieldValues: _templateFieldValues,
    fieldReview: _fieldReview,
    contentReview: _contentReview,
    sourceTemplate: _sourceTemplate,
    ...portable
  } = template;
  // A template's samples are authoring examples, never production weekly
  // values. Scalar defaults remain declarative; every effective repeat
  // default, including an empty array, receives stable per-copy item identity
  // state below without becoming volunteer-entered content.
  const fieldValues = bulletinFieldValues(
    portable.fieldContract,
    portable.contentRules,
    publicationDate,
    input.idPort,
  );
  const publicationDateFieldId = portable.fieldContract?.fields.find(
    (field) => field.semanticRole === "publicationDate",
  )?.id;
  const sourceDefinitions = portable.customElementDefinitions ?? [];
  const definitionsById = new Map(sourceDefinitions.map((definition) => [
    definition.id,
    definition,
  ]));
  const editedDefinitions = sourceDefinitions.map((definition) => ({
    ...definition,
    elements: materializeCustomInstances(definition.elements, definitionsById, input.idPort),
  }));
  const editedElements = materializeCustomInstances(
    portable.elements,
    definitionsById,
    input.idPort,
  );
  const editedPageElements = portable.pageElements?.map((wrapper) => ({
    ...wrapper,
    element: materializeCustomInstances(
      [wrapper.element],
      definitionsById,
      input.idPort,
    )[0] as typeof wrapper.element,
  }));
  const materialized = finalizeCustomDefinitionRevisions({
    definitions: sourceDefinitions,
    elements: portable.elements,
    ...(portable.pageElements === undefined ? {} : { pageElements: portable.pageElements }),
  }, {
    definitions: editedDefinitions,
    elements: editedElements,
    ...(editedPageElements === undefined ? {} : { pageElements: editedPageElements }),
  });
  const bulletin: CbbDocument = {
    ...portable,
    kind: "bulletin",
    name: displayName,
    metadata: {
      ...portable.metadata,
      title: displayName,
      ...(publicationDateFieldId === undefined ||
        fieldValues?.[publicationDateFieldId] === undefined
        ? {}
        : { publicationDate }),
    },
    ...(lineage === undefined ? {} : { sourceTemplate: lineage }),
    ...(fieldValues === undefined ? {} : { fieldValues }),
    elements: materialized.elements,
    ...(portable.customElementDefinitions === undefined
      ? {}
      : { customElementDefinitions: materialized.definitions }),
    ...(materialized.pageElements === undefined
      ? {}
      : { pageElements: materialized.pageElements }),
  };
  return withSemanticRoleMetadataMirrors(
    bulletin,
    ["publicationDate", "serviceLabel"],
  );
}

/**
 * Hydrate author-provided examples only inside the disposable workflow test.
 * Production bulletin creation deliberately never calls this helper.
 */
export function hydrateWeeklyWorkflowSandboxSamples(
  source: CbbDocument,
  bulletin: CbbDocument,
): CbbDocument {
  if (bulletin.kind !== "bulletin") {
    return cloneDocument(bulletin);
  }
  const {
    sampleFieldValues: _forbiddenBulletinSamples,
    ...bulletinBase
  } = cloneDocument(bulletin);
  const definitions = bulletinBase.customElementDefinitions ?? [];
  const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));
  const hydrateElements = (elements: readonly NativeElement[]): readonly NativeElement[] =>
    mapElements(elements, (element) => {
      if (element.type !== "customInstance") return element;
      const samples = definitionsById.get(element.definitionId)?.sampleFieldValues;
      if (samples === undefined) return element;
      return {
        ...element,
        fieldValues: {
          ...cloneValue(samples),
          ...(element.fieldValues ?? {}),
        },
      };
    });

  const editedDefinitions = definitions.map((definition) => ({
    ...definition,
    elements: hydrateElements(definition.elements),
  }));
  const editedElements = hydrateElements(bulletinBase.elements);
  const editedPageElements = bulletinBase.pageElements?.map((wrapper) => ({
    ...wrapper,
    element: hydrateElements([wrapper.element])[0] as typeof wrapper.element,
  }));
  const pinned = finalizeCustomDefinitionRevisions({
    definitions,
    elements: bulletinBase.elements,
    ...(bulletinBase.pageElements === undefined ? {} : { pageElements: bulletinBase.pageElements }),
  }, {
    definitions: editedDefinitions,
    elements: editedElements,
    ...(editedPageElements === undefined ? {} : { pageElements: editedPageElements }),
  });
  const samples = source.sampleFieldValues;
  const hydrated: CbbDocument = {
    ...bulletinBase,
    ...(samples === undefined ? {} : {
      fieldValues: {
        ...cloneValue(samples),
        ...(bulletinBase.fieldValues ?? {}),
      },
    }),
    elements: pinned.elements,
    ...(bulletinBase.customElementDefinitions === undefined
      ? {}
      : { customElementDefinitions: pinned.definitions }),
    ...(pinned.pageElements === undefined ? {} : { pageElements: pinned.pageElements }),
  };
  return withSemanticRoleMetadataMirrors(
    hydrated,
    ["publicationDate", "serviceLabel"],
  );
}

export function createTemplateFromDocument(
  source: CbbDocument,
  displayName: string,
  decisions?: TemplateValueDecisions,
): CbbDocument {
  const cloned = cloneDocument(source);
  const normalizedName = displayName.normalize("NFC").trim() || `${source.name} template`;
  const {
    fieldValues,
    sampleFieldValues,
    fieldReview: _fieldReview,
    contentReview: _contentReview,
    sourceTemplate: _sourceTemplate,
    ...portable
  } = cloned;
  const sourceValues = fieldValues ?? sampleFieldValues;
  // Duplicating an existing template is a structural copy, not a bulletin-value
  // review. In particular, an output-inert sample must not erase that field's
  // independently authored default or Church Profile mapping.
  const reviewed = cloned.kind === "template"
    ? {
        ...(portable.fieldContract === undefined
          ? {}
          : { fields: portable.fieldContract.fields }),
        ...(sampleFieldValues === undefined ? {} : { samples: sampleFieldValues }),
      }
    : reviewTemplateValues(portable.fieldContract?.fields ?? [], sourceValues, decisions);
  const reviewedLocal = reviewedLocalTemplateValues(portable, decisions);
  const {
    elements: _portableElements,
    pageElements: _portablePageElements,
    customElementDefinitions: _portableDefinitions,
    ...templateBase
  } = portable;
  const {
    publicationDate: _publicationDate,
    ...bulletinTemplateMetadata
  } = portable.metadata ?? {};
  const templateMetadata = cloned.kind === "template"
    ? portable.metadata ?? {}
    : bulletinTemplateMetadata;
  const fieldContract = reviewed.fields === undefined || portable.fieldContract === undefined
    ? portable.fieldContract
    : reviewedFieldContract(portable.fieldContract, reviewed.fields);
  const template: CbbDocument = {
    ...templateBase,
    kind: "template",
    name: normalizedName,
    metadata: {
      ...templateMetadata,
      title: normalizedName,
    },
    ...(fieldContract === undefined ? {} : { fieldContract }),
    ...(reviewed.samples === undefined ? {} : { sampleFieldValues: reviewed.samples }),
    elements: reviewedLocal.elements,
    ...(reviewedLocal.pageElements === undefined
      ? {}
      : { pageElements: reviewedLocal.pageElements }),
    ...(reviewedLocal.customElementDefinitions === undefined
      ? {}
      : { customElementDefinitions: reviewedLocal.customElementDefinitions }),
  };
  return withSemanticRoleMetadataMirrors(
    template,
    ["publicationDate", "serviceLabel"],
  );
}

function reviewedFieldContract(
  contract: NonNullable<CbbDocument["fieldContract"]>,
  fields: readonly FieldDefinition[],
): NonNullable<CbbDocument["fieldContract"]> {
  if (JSON.stringify(fields) === JSON.stringify(contract.fields)) return contract;
  if (
    !Number.isSafeInteger(contract.version) ||
    contract.version < 1 ||
    contract.version >= Number.MAX_SAFE_INTEGER
  ) {
    throw new Error("This weekly field contract has reached its revision limit.");
  }
  const { contractHash: _staleHash, ...editable } = contract;
  return {
    ...editable,
    version: contract.version + 1,
    fields,
  };
}

export type TemplateValueDisposition = "clear" | "default" | "sample" | "profile";

export interface TemplateValueDecision {
  readonly disposition: TemplateValueDisposition;
  /** Closed Church Profile property selected by the author. */
  readonly profileKey?: ChurchProfileFieldKey;
}

export type TemplateValueDecisions = Readonly<Record<string, TemplateValueDecision>>;

export type TemplateValueReviewTarget =
  | { readonly scope: "document"; readonly fieldId: string }
  | {
      readonly scope: "savedSection";
      readonly definitionId: NodeId;
      readonly fieldId: string;
    };

/** Stable UI identity for a value decision without exposing JSON paths. */
export function templateValueDecisionKey(target: TemplateValueReviewTarget): string {
  return target.scope === "document"
    ? `document:${target.fieldId}`
    : `savedSection:${target.definitionId}:${target.fieldId}`;
}

export interface TemplateValueReviewItem {
  readonly decisionKey: string;
  readonly target: TemplateValueReviewTarget;
  readonly fieldId: string;
  readonly label: string;
  readonly ownerLabel?: string;
  readonly field: FieldDefinition;
  readonly value: FieldValues[string];
  readonly occurrenceCount: number;
  readonly valueCount: number;
  readonly hasConflictingValues: boolean;
  readonly likelyOneWeekContent: boolean;
  readonly profileKeys: readonly ChurchProfileFieldKey[];
  readonly profileCompatible: boolean;
}

function likelyOneWeekField(field: FieldDefinition): boolean {
  return field.type === "date" || field.semanticRole === "publicationDate" ||
    /(?:date|week|name|prayer|announcement|service|sermon|lesson)/iu.test(field.label);
}

export function compatibleChurchProfileKeys(
  field: FieldDefinition,
): readonly ChurchProfileFieldKey[] {
  if (field.type === "text") return CHURCH_PROFILE_TEXT_FIELD_KEYS;
  if (field.type === "assetRef") return CHURCH_PROFILE_ASSET_FIELD_KEYS;
  return [];
}

interface LocalReviewAccumulator {
  readonly target: Extract<TemplateValueReviewTarget, { readonly scope: "savedSection" }>;
  readonly definition: CustomElementDefinition;
  readonly field: FieldDefinition;
  readonly values: FieldValueEntry[];
  occurrenceCount: number;
}

function customInstances(elements: readonly NativeElement[]): readonly CustomElementInstance[] {
  const instances: CustomElementInstance[] = [];
  mapElements(elements, (element) => {
    if (element.type === "customInstance") instances.push(element);
    return element;
  });
  return instances;
}

function persistedCustomInstances(source: CbbDocument): readonly CustomElementInstance[] {
  return [
    ...customInstances(source.elements),
    ...(source.pageElements ?? []).flatMap((wrapper) => customInstances([wrapper.element])),
    ...(source.customElementDefinitions ?? []).flatMap((definition) =>
      customInstances(definition.elements)),
  ];
}

function localTemplateValueReviewItems(source: CbbDocument): readonly TemplateValueReviewItem[] {
  const definitions = new Map(
    (source.customElementDefinitions ?? []).map((definition) => [definition.id, definition]),
  );
  const groups = new Map<string, LocalReviewAccumulator>();
  for (const instance of persistedCustomInstances(source)) {
    const definition = definitions.get(instance.definitionId);
    if (definition === undefined) continue;
    for (const field of definition.fieldContract.fields) {
      const key = `${definition.id}\u0000${field.id}`;
      let group = groups.get(key);
      if (group === undefined) {
        const target = {
          scope: "savedSection" as const,
          definitionId: definition.id,
          fieldId: field.id,
        };
        group = {
          target,
          definition,
          field,
          values: [],
          occurrenceCount: 0,
        };
        groups.set(key, group);
      }
      group.occurrenceCount += 1;
      const value = instance.fieldValues?.[field.id];
      if (value !== undefined) group.values.push(value);
    }
  }

  return Object.freeze([...groups.values()].flatMap((group) => {
    const value = group.values[0];
    if (value === undefined) return [];
    const profileKeys = compatibleChurchProfileKeys(group.field);
    const distinctValues = new Set(group.values.map((entry) => hashCanonical(entry.value)));
    return [Object.freeze({
      decisionKey: templateValueDecisionKey(group.target),
      target: group.target,
      fieldId: group.field.id,
      label: group.field.label,
      ownerLabel: group.definition.name,
      field: group.field,
      value,
      occurrenceCount: group.occurrenceCount,
      valueCount: group.values.length,
      hasConflictingValues: distinctValues.size > 1,
      likelyOneWeekContent: likelyOneWeekField(group.field),
      profileKeys,
      profileCompatible: profileKeys.length > 0,
    })];
  }));
}

export function templateValueReviewItems(source: CbbDocument): readonly TemplateValueReviewItem[] {
  const values = source.fieldValues ?? source.sampleFieldValues;
  const fields = new Map((source.fieldContract?.fields ?? []).map((field) => [field.id, field]));
  const documentItems = (source.fieldContract?.fields ?? []).flatMap((field) => {
    const value = values?.[field.id];
    if (value === undefined || fields.get(field.id) === undefined) return [];
    const profileKeys = compatibleChurchProfileKeys(field);
    const target = { scope: "document" as const, fieldId: field.id };
    return [Object.freeze({
      decisionKey: templateValueDecisionKey(target),
      target,
      fieldId: field.id,
      label: field.label,
      field,
      value,
      occurrenceCount: 1,
      valueCount: 1,
      hasConflictingValues: false,
      likelyOneWeekContent: likelyOneWeekField(field),
      profileKeys,
      profileCompatible: profileKeys.length > 0,
    })];
  });
  return Object.freeze([...documentItems, ...localTemplateValueReviewItems(source)]);
}

function updateField(
  field: FieldDefinition,
  value: FieldValues[string] | undefined,
  decision: TemplateValueDecision,
): FieldDefinition {
  if (value === undefined) return field;
  const { default: _default, profileKey: _profileKey, ...neutral } = field;
  if (decision.disposition === "profile") {
    const profileKey = decision.profileKey;
    if (
      profileKey === undefined ||
      !churchProfileKeyAcceptsFieldType(profileKey, field.type)
    ) {
      throw new Error(`Choose a compatible Church Profile value for ${field.label}.`);
    }
    return { ...neutral, profileKey };
  }
  if (decision.disposition === "default") return { ...neutral, default: value.value };
  return neutral;
}

function decisionFor(
  decisions: TemplateValueDecisions | undefined,
  target: TemplateValueReviewTarget,
): TemplateValueDecision {
  const scoped = decisions?.[templateValueDecisionKey(target)];
  if (scoped !== undefined) return scoped;
  // Keep the old document-field key readable for callers that persisted an
  // in-progress review before scoped Saved Section decisions existed.
  if (target.scope === "document") {
    const legacy = decisions?.[target.fieldId];
    if (legacy !== undefined) return legacy;
  }
  return { disposition: "sample" };
}

function reviewTemplateValues(
  fields: readonly FieldDefinition[],
  values: FieldValues | undefined,
  decisions: TemplateValueDecisions | undefined,
): { readonly fields?: readonly FieldDefinition[]; readonly samples?: FieldValues } {
  if (values === undefined) return {};
  const samples: Record<string, FieldValues[string]> = {};
  const nextFields = fields.map((field) => {
    const value = values[field.id];
    const decision = decisionFor(decisions, { scope: "document", fieldId: field.id });
    if (value !== undefined && decision.disposition === "sample") samples[field.id] = value;
    return updateField(field, value, decision);
  });
  return {
    ...(fields.length === 0 ? {} : { fields: nextFields }),
    ...(Object.keys(samples).length === 0 ? {} : { samples }),
  };
}

function withoutReviewedLocalValues(
  elements: readonly NativeElement[],
  reviewedFields: ReadonlyMap<NodeId, ReadonlySet<string>>,
): readonly NativeElement[] {
  return mapElements(elements, (element) => {
    if (element.type !== "customInstance" || element.fieldValues === undefined) return element;
    const removed = reviewedFields.get(element.definitionId);
    if (removed === undefined || removed.size === 0) return element;
    const fieldValues = Object.fromEntries(
      Object.entries(element.fieldValues).filter(([fieldId]) => !removed.has(fieldId)),
    );
    if (Object.keys(fieldValues).length === Object.keys(element.fieldValues).length) return element;
    if (Object.keys(fieldValues).length === 0) {
      const { fieldValues: _fieldValues, ...independent } = element;
      return independent;
    }
    return { ...element, fieldValues };
  });
}

function sampleEntry(value: FieldValueEntry): FieldValueEntry {
  // Repeat samples need their stable per-item identities when hydrated into a
  // disposable bulletin; scalar entries simply clone the same canonical shape.
  return cloneValue(value);
}

function reviewedLocalTemplateValues(
  source: CbbDocument,
  decisions: TemplateValueDecisions | undefined,
): {
  readonly elements: readonly NativeElement[];
  readonly pageElements: CbbDocument["pageElements"];
  readonly customElementDefinitions: CbbDocument["customElementDefinitions"];
} {
  if (source.kind !== "bulletin") {
    return {
      elements: source.elements,
      pageElements: source.pageElements,
      customElementDefinitions: source.customElementDefinitions,
    };
  }
  const items = localTemplateValueReviewItems(source);
  if (items.length === 0) {
    return {
      elements: source.elements,
      pageElements: source.pageElements,
      customElementDefinitions: source.customElementDefinitions,
    };
  }

  const byDefinition = new Map<NodeId, Map<string, {
    readonly item: TemplateValueReviewItem;
    readonly decision: TemplateValueDecision;
  }>>();
  for (const item of items) {
    if (item.target.scope !== "savedSection") continue;
    const decision = decisionFor(decisions, item.target);
    if (
      item.hasConflictingValues &&
      (decision.disposition === "default" || decision.disposition === "sample")
    ) {
      throw new Error(
        `${item.ownerLabel ?? "This Saved section"} has different current values for ${item.label}. ` +
        "Clear them or use one compatible Church Profile value before creating the template.",
      );
    }
    const fields = byDefinition.get(item.target.definitionId) ?? new Map();
    fields.set(item.fieldId, { item, decision });
    byDefinition.set(item.target.definitionId, fields);
  }
  const reviewedFields = new Map<NodeId, ReadonlySet<string>>(
    [...byDefinition].map(([definitionId, fields]) => [definitionId, new Set(fields.keys())]),
  );
  const definitions = (source.customElementDefinitions ?? []).map((definition) => {
    const reviews = byDefinition.get(definition.id);
    const elements = withoutReviewedLocalValues(definition.elements, reviewedFields);
    if (reviews === undefined) return elements === definition.elements
      ? definition
      : { ...definition, elements };

    const fields = definition.fieldContract.fields.map((field) => {
      const review = reviews.get(field.id);
      return review === undefined
        ? field
        : updateField(field, review.item.value, review.decision);
    });
    const samples: Record<string, FieldValueEntry> = { ...(definition.sampleFieldValues ?? {}) };
    for (const [fieldId, review] of reviews) {
      delete samples[fieldId];
      if (review.decision.disposition === "sample") {
        samples[fieldId] = sampleEntry(review.item.value);
      }
    }
    return {
      ...definition,
      fieldContract: reviewedFieldContract(definition.fieldContract, fields),
      elements,
      ...(Object.keys(samples).length === 0 ? { sampleFieldValues: undefined } : { sampleFieldValues: samples }),
    };
  }).map((definition) => {
    if (definition.sampleFieldValues !== undefined) return definition;
    const { sampleFieldValues: _samples, ...withoutSamples } = definition;
    return withoutSamples;
  }) as readonly CustomElementDefinition[];

  const elements = withoutReviewedLocalValues(source.elements, reviewedFields);
  const pageElements = source.pageElements?.map((wrapper) => ({
    ...wrapper,
    element: withoutReviewedLocalValues(
      [wrapper.element],
      reviewedFields,
    )[0] as typeof wrapper.element,
  }));
  const pinned = finalizeCustomDefinitionRevisions({
    definitions: source.customElementDefinitions ?? [],
    elements: source.elements,
    ...(source.pageElements === undefined ? {} : { pageElements: source.pageElements }),
  }, {
    definitions,
    elements,
    ...(pageElements === undefined ? {} : { pageElements }),
  });
  return {
    elements: pinned.elements,
    pageElements: pinned.pageElements,
    customElementDefinitions: pinned.definitions,
  };
}

export function hydrateBrowserPracticeDocument(document: CbbDocument, idPort: IdPort): CbbDocument {
  if (document.kind !== "bulletin" || document.elements.length > 0) return document;
  return createBulletinFromStarter({
    starterId: "simple-service",
    idPort,
    displayName: document.name,
  });
}
