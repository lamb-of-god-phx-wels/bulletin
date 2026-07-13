import type {
  Binding,
  CbbDocument,
  FieldContract,
  FieldDefinition,
  FieldValueEntry,
  FieldValues,
  NativeElement,
  RichTextDocument,
  TextContent,
} from "@cbb/core";
import { checkEditorCapability } from "../store/capabilities.js";
import { semanticRoleMetadataMirrorPatches } from "../store/semanticRoleMirrors.js";
import type {
  CapabilityRequirement,
  DocumentPatch,
  EditorCommand,
  EditorMode,
  EditorSelection,
} from "../store/types.js";

const MAX_QUERY_CODE_POINTS = 256;
const MAX_PREVIEWS = 200;

export interface FindReplaceInput {
  readonly query: string;
  readonly replacement: string;
  readonly matchCase: boolean;
}

export interface FindReplaceMatchPreview {
  readonly id: string;
  readonly label: string;
  readonly snippet: string;
  readonly replaceable: boolean;
  readonly reason?: string;
  readonly selection: EditorSelection;
}

export interface FindReplacePlan {
  readonly query: string;
  readonly replacement: string;
  readonly matchCase: boolean;
  readonly totalMatches: number;
  readonly replaceableMatches: number;
  readonly skippedMatches: number;
  readonly previews: readonly FindReplaceMatchPreview[];
  readonly omittedPreviews: number;
  readonly command?: EditorCommand;
}

interface MutablePlan {
  totalMatches: number;
  replaceableMatches: number;
  skippedMatches: number;
  readonly previews: FindReplaceMatchPreview[];
  readonly patches: DocumentPatch[];
  readonly requirements: CapabilityRequirement[];
  readonly materializedMissingFields: Set<string>;
  readonly documentFieldUpdates: Map<string, FieldValueEntry>;
  readonly changedFieldValues: Set<string>;
  previewSequence: number;
}

interface TextTransformContext {
  readonly input: FindReplaceInput;
  readonly mutable: MutablePlan;
  readonly label: string;
  readonly selection: EditorSelection;
  readonly blockedReason?: string;
}

function escapedPointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
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

function fieldValueKey(valuesPath: string, fieldId: string): string {
  return `${valuesPath}\u0000${fieldId}`;
}

function escapedRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function literalRegExp(input: FindReplaceInput): RegExp {
  return new RegExp(escapedRegExp(input.query), input.matchCase ? "gu" : "giu");
}

function occurrences(text: string, input: FindReplaceInput): readonly { readonly index: number; readonly text: string }[] {
  const result: { index: number; text: string }[] = [];
  const expression = literalRegExp(input);
  for (let match = expression.exec(text); match !== null; match = expression.exec(text)) {
    result.push({ index: match.index, text: match[0] ?? "" });
  }
  return result;
}

function replaceLiteral(text: string, input: FindReplaceInput): string {
  return text.replace(literalRegExp(input), () => input.replacement).normalize("NFC");
}

function matchSnippet(text: string, index: number, match: string): string {
  const beforeStart = Math.max(0, index - 32);
  const afterEnd = Math.min(text.length, index + match.length + 32);
  const before = text.slice(beforeStart, index).replace(/\s+/gu, " ");
  const after = text.slice(index + match.length, afterEnd).replace(/\s+/gu, " ");
  return `${beforeStart > 0 ? "…" : ""}${before}[${match}]${after}${afterEnd < text.length ? "…" : ""}`;
}

function recordTextMatches(text: string, context: TextTransformContext): number {
  const found = occurrences(text, context.input);
  for (const match of found) {
    context.mutable.totalMatches += 1;
    if (context.blockedReason === undefined) context.mutable.replaceableMatches += 1;
    else context.mutable.skippedMatches += 1;
    if (context.mutable.previews.length < MAX_PREVIEWS) {
      context.mutable.previews.push({
        id: `find-${context.mutable.previewSequence++}`,
        label: context.label,
        snippet: matchSnippet(text, match.index, match.text),
        replaceable: context.blockedReason === undefined,
        ...(context.blockedReason === undefined ? {} : { reason: context.blockedReason }),
        selection: context.selection,
      });
    }
  }
  return found.length;
}

function transformRichValue(
  value: unknown,
  context: TextTransformContext,
  inScripture = false,
): { readonly value: unknown; readonly changed: boolean; readonly replacementCount: number } {
  if (Array.isArray(value)) {
    let changed = false;
    let replacementCount = 0;
    const next = value.map((entry) => {
      const transformed = transformRichValue(entry, context, inScripture);
      changed ||= transformed.changed;
      replacementCount += transformed.replacementCount;
      return transformed.value;
    });
    return { value: changed ? next : value, changed, replacementCount };
  }
  if (typeof value !== "object" || value === null) {
    return { value, changed: false, replacementCount: 0 };
  }
  const record = value as Readonly<Record<string, unknown>>;
  const scripture = inScripture || record["type"] === "scripture";
  if (record["type"] === "text" && typeof record["text"] === "string") {
    const blockedReason = scripture
      ? "Imported Scripture text is source-controlled; replace it with the Scripture assistant."
      : context.blockedReason;
    const leafContext = blockedReason === undefined ? context : { ...context, blockedReason };
    const count = recordTextMatches(record["text"], leafContext);
    if (count === 0 || blockedReason !== undefined) {
      return { value, changed: false, replacementCount: 0 };
    }
    return {
      value: { ...record, text: replaceLiteral(record["text"], context.input) },
      changed: true,
      replacementCount: count,
    };
  }
  let changed = false;
  let replacementCount = 0;
  const entries = Object.entries(record).map(([key, entry]) => {
    const transformed = transformRichValue(entry, context, scripture);
    changed ||= transformed.changed;
    replacementCount += transformed.replacementCount;
    return [key, transformed.value] as const;
  });
  return { value: changed ? Object.fromEntries(entries) : value, changed, replacementCount };
}

function transformTextContent(
  content: TextContent,
  context: TextTransformContext,
): { readonly value: TextContent; readonly replacementCount: number } {
  if (content.kind === "plain") {
    if (content.text === undefined) return { value: content, replacementCount: 0 };
    const count = recordTextMatches(content.text, context);
    return count === 0 || context.blockedReason !== undefined
      ? { value: content, replacementCount: 0 }
      : {
          value: { kind: "plain", text: replaceLiteral(content.text, context.input) },
          replacementCount: count,
        };
  }
  if (content.document === undefined) return { value: content, replacementCount: 0 };
  const transformed = transformRichValue(content.document, context);
  return {
    value: transformed.changed
      ? { kind: "richText", document: transformed.value as RichTextDocument }
      : content,
    replacementCount: transformed.replacementCount,
  };
}

function capabilityReason(
  document: CbbDocument,
  mode: EditorMode,
  requirement: CapabilityRequirement,
  readOnly: boolean,
): string | undefined {
  if (readOnly) return "This bulletin library is open read-only.";
  const decision = checkEditorCapability(document, mode, requirement);
  return decision.allowed ? undefined : decision.reason;
}

function appendRequirement(mutable: MutablePlan, requirement: CapabilityRequirement): void {
  const key = JSON.stringify(requirement);
  if (!mutable.requirements.some((candidate) => JSON.stringify(candidate) === key)) {
    mutable.requirements.push(requirement);
  }
}

function transformFieldValue(
  value: unknown,
  definition: FieldDefinition,
  context: TextTransformContext,
): { readonly value: unknown; readonly changed: boolean; readonly replacementCount: number } {
  if (definition.type === "text") {
    if (typeof value !== "string") return { value, changed: false, replacementCount: 0 };
    const count = recordTextMatches(value, context);
    if (count === 0 || context.blockedReason !== undefined) {
      return { value, changed: false, replacementCount: 0 };
    }
    return { value: replaceLiteral(value, context.input), changed: true, replacementCount: count };
  }
  if (definition.type === "richText") {
    const transformed = transformRichValue(value, context);
    return transformed;
  }
  if (definition.type === "array" && Array.isArray(value) && definition.itemField !== undefined) {
    let changed = false;
    let replacementCount = 0;
    const next = value.map((entry) => {
      const transformed = transformFieldValue(entry, definition.itemField!, context);
      changed ||= transformed.changed;
      replacementCount += transformed.replacementCount;
      return transformed.value;
    });
    return { value: changed ? next : value, changed, replacementCount };
  }
  if (definition.type === "object" && typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Readonly<Record<string, unknown>>;
    let changed = false;
    let replacementCount = 0;
    const next: Record<string, unknown> = { ...record };
    for (const child of definition.childFields ?? []) {
      if (!Object.prototype.hasOwnProperty.call(record, child.id)) continue;
      const transformed = transformFieldValue(record[child.id], child, {
        ...context,
        label: `${context.label} · ${child.label}`,
      });
      if (transformed.changed) next[child.id] = transformed.value;
      changed ||= transformed.changed;
      replacementCount += transformed.replacementCount;
    }
    return { value: changed ? next : value, changed, replacementCount };
  }
  return { value, changed: false, replacementCount: 0 };
}

function processFieldValues(input: {
  readonly document: CbbDocument;
  readonly mode: EditorMode;
  readonly readOnly: boolean;
  readonly values: FieldValues | undefined;
  readonly contract: FieldContract | undefined;
  readonly valuesPath: string;
  readonly ownerLabel: string;
  readonly ownerNodeId?: string;
  readonly capability: "content.edit" | "template.editLifecycle";
  readonly find: FindReplaceInput;
  readonly mutable: MutablePlan;
}): void {
  if (input.values === undefined || input.contract === undefined) return;
  for (const definition of input.contract.fields) {
    const entry = input.values[definition.id];
    if (entry === undefined) continue;
    const requirement: CapabilityRequirement = {
      capability: input.capability,
      target: input.ownerNodeId === undefined
        ? { kind: "document" }
        : { kind: "node", nodeId: input.ownerNodeId },
    };
    const reason = entry.origin === "derived"
      ? "This field value is computed and cannot be replaced directly."
      : capabilityReason(input.document, input.mode, requirement, input.readOnly);
    const selection: EditorSelection = {
      kind: "field",
      fieldId: definition.id,
      ...(input.ownerNodeId === undefined ? {} : { ownerNodeId: input.ownerNodeId }),
    };
    const transformed = transformFieldValue(entry.value, definition, {
      input: input.find,
      mutable: input.mutable,
      label: `${input.ownerLabel} · ${definition.label}`,
      selection,
      ...(reason === undefined ? {} : { blockedReason: reason }),
    });
    if (!transformed.changed || transformed.replacementCount === 0) continue;
    const nextEntry = { ...entry, value: transformed.value, origin: "manual" as const };
    input.mutable.patches.push({
      op: "replace",
      path: `${input.valuesPath}/${escapedPointerSegment(definition.id)}`,
      value: nextEntry,
    });
    if (input.valuesPath === "/fieldValues" && input.ownerNodeId === undefined) {
      input.mutable.documentFieldUpdates.set(definition.id, nextEntry);
    }
    input.mutable.changedFieldValues.add(fieldValueKey(input.valuesPath, definition.id));
    appendRequirement(input.mutable, requirement);
  }
}

function appendMaterializedFieldValue(input: {
  readonly values: FieldValues | undefined;
  readonly valuesPath: string;
  readonly fieldId: string;
  readonly value: unknown;
  readonly mutable: MutablePlan;
}): void {
  const entry = { value: input.value, origin: "manual" as const };
  if (input.values !== undefined) {
    input.mutable.patches.push({
      op: "add",
      path: `${input.valuesPath}/${escapedPointerSegment(input.fieldId)}`,
      value: entry,
    });
    return;
  }
  const existingIndex = input.mutable.patches.findIndex(
    (patch) => patch.op === "add" && patch.path === input.valuesPath,
  );
  if (existingIndex < 0) {
    input.mutable.patches.push({
      op: "add",
      path: input.valuesPath,
      value: { [input.fieldId]: entry },
    });
    return;
  }
  const existing = input.mutable.patches[existingIndex];
  const prior = existing?.op === "add" &&
      typeof existing.value === "object" &&
      existing.value !== null &&
      !Array.isArray(existing.value)
    ? existing.value as Readonly<Record<string, unknown>>
    : {};
  input.mutable.patches[existingIndex] = {
    op: "add",
    path: input.valuesPath,
    value: { ...prior, [input.fieldId]: entry },
  };
}

function processMissingPlainTextBinding(input: {
  readonly document: CbbDocument;
  readonly mode: EditorMode;
  readonly readOnly: boolean;
  readonly element: Extract<NativeElement, { readonly type: "text" }>;
  readonly elementPath: string;
  readonly binding: Binding;
  readonly find: FindReplaceInput;
  readonly mutable: MutablePlan;
  readonly computedReason?: string;
}): boolean {
  const contract = input.binding.scope === "document"
    ? input.document.fieldContract
    : input.element.fieldContract;
  const definition = contract?.fields.find((field) => field.id === input.binding.fieldId);
  if (definition?.type !== "text") return false;
  const source = input.element.data.content?.kind === "plain"
    ? input.element.data.content.text
    : undefined;
  const effective = typeof definition.default === "string"
    ? definition.default
    : typeof input.binding.fallback === "string"
      ? input.binding.fallback
      : source;
  if (effective === undefined) return false;
  const values = input.binding.scope === "document"
    ? input.document.fieldValues
    : input.element.fieldValues;
  const valuesPath = input.binding.scope === "document"
    ? "/fieldValues"
    : `${input.elementPath}/fieldValues`;
  const fieldKey = fieldValueKey(valuesPath, input.binding.fieldId);
  if (input.mutable.materializedMissingFields.has(fieldKey)) return true;
  input.mutable.materializedMissingFields.add(fieldKey);
  const requirement: CapabilityRequirement = {
    capability: "content.edit",
    target: input.binding.scope === "document"
      ? { kind: "document" }
      : { kind: "node", nodeId: input.element.id },
  };
  const reason = input.computedReason ?? capabilityReason(
    input.document,
    input.mode,
    requirement,
    input.readOnly,
  );
  const transformed = transformTextContent({ kind: "plain", text: effective }, {
    input: input.find,
    mutable: input.mutable,
    label: `${input.element.name} · ${definition.label}`,
    selection: {
      kind: "field",
      fieldId: definition.id,
      ...(input.binding.scope === "document" ? {} : { ownerNodeId: input.element.id }),
    },
    ...(reason === undefined ? {} : { blockedReason: reason }),
  });
  if (transformed.replacementCount > 0 && transformed.value.kind === "plain") {
    const nextEntry = {
      value: transformed.value.text,
      origin: "manual" as const,
    };
    appendMaterializedFieldValue({
      values,
      valuesPath,
      fieldId: definition.id,
      value: transformed.value.text,
      mutable: input.mutable,
    });
    if (input.binding.scope === "document") {
      input.mutable.documentFieldUpdates.set(definition.id, nextEntry);
    }
    input.mutable.changedFieldValues.add(fieldKey);
    appendRequirement(input.mutable, requirement);
  }
  return true;
}

function textFromBindingFallback(value: unknown, fallback: TextContent | undefined): TextContent {
  if (typeof value === "string") return { kind: "plain", text: value };
  if (typeof value === "object" && value !== null &&
    (value as { readonly type?: unknown }).type === "document") {
    return { kind: "richText", document: value as RichTextDocument };
  }
  return fallback ?? { kind: "plain" };
}

function visitElement(input: {
  readonly document: CbbDocument;
  readonly mode: EditorMode;
  readonly readOnly: boolean;
  readonly element: NativeElement;
  readonly path: string;
  readonly find: FindReplaceInput;
  readonly mutable: MutablePlan;
  readonly computedReason?: string;
}): void {
  const element = input.element;
  const customDefinition = element.type === "customInstance"
    ? input.document.customElementDefinitions?.find((candidate) => candidate.id === element.definitionId)
    : undefined;
  processFieldValues({
    document: input.document,
    mode: input.mode,
    readOnly: input.readOnly,
    values: input.element.fieldValues,
    contract: input.element.type === "customInstance" ? customDefinition?.fieldContract : input.element.fieldContract,
    valuesPath: `${input.path}/fieldValues`,
    ownerLabel: input.element.name,
    ownerNodeId: input.element.id,
    capability: "content.edit",
    find: input.find,
    mutable: input.mutable,
  });

  if (input.element.type === "text") {
    const binding = input.element.bindings?.find((candidate) =>
      candidate.target === "/data/content" ||
      candidate.target === "/data/content/text" ||
      candidate.target === "/data/content/document"
    );
    if (binding !== undefined) {
      const values = binding.scope === "document" ? input.document.fieldValues : input.element.fieldValues;
      if (values?.[binding.fieldId] === undefined) {
        const materialized = processMissingPlainTextBinding({
          document: input.document,
          mode: input.mode,
          readOnly: input.readOnly,
          element: input.element,
          elementPath: input.path,
          binding,
          find: input.find,
          mutable: input.mutable,
          ...(input.computedReason === undefined ? {} : { computedReason: input.computedReason }),
        });
        if (!materialized) {
          transformTextContent(
            textFromBindingFallback(binding.fallback, input.element.data.content),
            {
              input: input.find,
              mutable: input.mutable,
              label: `${input.element.name} · generated field`,
              selection: { kind: "node", nodeId: input.element.id, surface: "editor" },
              blockedReason: "This generated field has no writable weekly value.",
            },
          );
        }
      }
    } else {
      if (input.element.data.content === undefined) return;
      const requirement: CapabilityRequirement = {
        capability: "content.edit",
        target: { kind: "node", nodeId: input.element.id },
      };
      const reason = input.computedReason ?? capabilityReason(
        input.document,
        input.mode,
        requirement,
        input.readOnly,
      );
      const transformed = transformTextContent(input.element.data.content, {
        input: input.find,
        mutable: input.mutable,
        label: input.element.name,
        selection: { kind: "node", nodeId: input.element.id, surface: "editor" },
        ...(reason === undefined ? {} : { blockedReason: reason }),
      });
      if (transformed.replacementCount > 0) {
        input.mutable.patches.push({
          op: "replace",
          path: `${input.path}/data/content`,
          value: transformed.value,
        });
        appendRequirement(input.mutable, requirement);
      }
    }
  }

  if (input.element.type !== "customInstance") {
    for (const binding of input.element.bindings ?? []) {
      const valuesPath = binding.scope === "document"
        ? "/fieldValues"
        : `${input.path}/fieldValues`;
      if (
        input.mutable.changedFieldValues.has(fieldValueKey(valuesPath, binding.fieldId)) &&
        pointerExists(input.element, binding.target)
      ) {
        input.mutable.patches.push({
          op: "remove",
          path: `${input.path}${binding.target}`,
        });
      }
    }
  }

  if (input.element.type === "grid" || input.element.type === "stack" || input.element.type === "canvas") {
    for (const [index, wrapper] of input.element.children.entries()) {
      visitElement({
        ...input,
        element: wrapper.element,
        path: `${input.path}/children/${index}/element`,
      });
    }
  }
}

function recordArchivedStrings(
  value: unknown,
  context: TextTransformContext,
): void {
  if (typeof value === "string") {
    recordTextMatches(value, context);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) recordArchivedStrings(entry, context);
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const entry of Object.values(value)) recordArchivedStrings(entry, context);
  }
}

export function planDocumentFindReplace(
  document: CbbDocument,
  mode: EditorMode,
  input: FindReplaceInput,
  readOnly = false,
): FindReplacePlan {
  const find: FindReplaceInput = {
    query: [...input.query.normalize("NFC")].slice(0, MAX_QUERY_CODE_POINTS).join(""),
    replacement: input.replacement.normalize("NFC"),
    matchCase: input.matchCase,
  };
  const mutable: MutablePlan = {
    totalMatches: 0,
    replaceableMatches: 0,
    skippedMatches: 0,
    previews: [],
    patches: [],
    requirements: [],
    materializedMissingFields: new Set(),
    documentFieldUpdates: new Map(),
    changedFieldValues: new Set(),
    previewSequence: 0,
  };
  if (find.query.length === 0) {
    return {
      ...find,
      totalMatches: 0,
      replaceableMatches: 0,
      skippedMatches: 0,
      previews: [],
      omittedPreviews: 0,
    };
  }

  processFieldValues({
    document,
    mode,
    readOnly,
    values: document.fieldValues,
    contract: document.fieldContract,
    valuesPath: "/fieldValues",
    ownerLabel: "Weekly Content",
    capability: "content.edit",
    find,
    mutable,
  });
  processFieldValues({
    document,
    mode,
    readOnly,
    values: document.sampleFieldValues,
    contract: document.fieldContract,
    valuesPath: "/sampleFieldValues",
    ownerLabel: "Template sample values",
    capability: "template.editLifecycle",
    find,
    mutable,
  });

  for (const [index, element] of document.elements.entries()) {
    visitElement({ document, mode, readOnly, element, path: `/elements/${index}`, find, mutable });
  }
  for (const [index, wrapper] of (document.pageElements ?? []).entries()) {
    visitElement({
      document,
      mode,
      readOnly,
      element: wrapper.element,
      path: `/pageElements/${index}/element`,
      find,
      mutable,
      ...(wrapper.purpose === "pageNumber"
        ? { computedReason: "Page numbers are generated and cannot be replaced as stored text." }
        : {}),
    });
  }
  for (const [definitionIndex, definition] of (document.customElementDefinitions ?? []).entries()) {
    processFieldValues({
      document,
      mode,
      readOnly,
      values: definition.sampleFieldValues,
      contract: definition.fieldContract,
      valuesPath: `/customElementDefinitions/${definitionIndex}/sampleFieldValues`,
      ownerLabel: `${definition.name} sample values`,
      ownerNodeId: definition.id,
      capability: "template.editLifecycle",
      find,
      mutable,
    });
    for (const [elementIndex, element] of definition.elements.entries()) {
      visitElement({
        document,
        mode,
        readOnly,
        element,
        path: `/customElementDefinitions/${definitionIndex}/elements/${elementIndex}`,
        find,
        mutable,
      });
    }
  }
  if (document.orphanedFieldValues !== undefined) {
    recordArchivedStrings(document.orphanedFieldValues, {
      input: find,
      mutable,
      label: "Archived field value",
      selection: { kind: "document" },
      blockedReason: "Archived field values are preserved for recovery and are not replaced.",
    });
  }

  if (mutable.documentFieldUpdates.size > 0 && document.fieldContract !== undefined) {
    const projectedValues: Record<string, FieldValueEntry> = { ...(document.fieldValues ?? {}) };
    const roles: ("publicationDate" | "serviceLabel")[] = [];
    for (const [fieldId, entry] of mutable.documentFieldUpdates) {
      projectedValues[fieldId] = entry;
      const role = document.fieldContract.fields.find((field) => field.id === fieldId)?.semanticRole;
      if (role !== undefined) roles.push(role);
    }
    mutable.patches.push(...semanticRoleMetadataMirrorPatches({
      document,
      contract: document.fieldContract,
      values: projectedValues,
      roles,
    }));
  }

  const command = mutable.patches.length === 0 || mutable.requirements.length === 0
    ? undefined
    : {
        id: "document.replaceAll",
        label: `Replace ${mutable.replaceableMatches} ${mutable.replaceableMatches === 1 ? "match" : "matches"}`,
        capabilities: [...mutable.requirements],
        createPatches: [...mutable.patches],
      } satisfies EditorCommand;
  return {
    ...find,
    totalMatches: mutable.totalMatches,
    replaceableMatches: mutable.replaceableMatches,
    skippedMatches: mutable.skippedMatches,
    previews: mutable.previews,
    omittedPreviews: Math.max(0, mutable.totalMatches - mutable.previews.length),
    ...(command === undefined ? {} : { command }),
  };
}
