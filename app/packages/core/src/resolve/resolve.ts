import type {
  Binding,
  CbbDocument,
  ConditionalRule,
  ContentRule,
  CustomElementDefinition,
  CustomElementInstance,
  FieldDefinition,
  FieldValueEntry,
  ItemBinding,
  NativeElement,
  NodeId,
  PageLevelWrapper,
  RepeatRule,
} from "../document/types.js";
import { DOCUMENT_LIMITS } from "../document/types.js";
import { customElementDefinitionHash } from "../document/customDefinitions.js";
import type {
  EffectiveScripturePresentation,
  ResolvedElement,
  ResolvedExpansion,
  ResolvedFlowProperties,
  ResolvedNode,
  ResolvedNodeProvenance,
  ResolvedPageElement,
  ResolvedRenderTree,
  ResolvedRightsContribution,
} from "../document/resolvedTypes.js";
import {
  bindingTargetSpec,
  definitionAtItemPointer,
  resolveEffectiveField,
  validateFieldValue,
  type FieldScope,
} from "./field.js";
import { deletePointer, readPointer, writePointer } from "./jsonPointer.js";
import {
  collectMusicRights,
  effectiveScripturePresentation,
  makeRenderProjection,
  resolvedRichTextHasRenderedText,
  resolveRichTextDocument,
  resolveTextContent,
} from "./projection.js";
import type {
  ResolveDocumentResult,
  ResolveFinding,
  ResolveFindingKind,
  ResolveOptions,
  ResolvedReadinessFieldTarget,
  ResolvedReadinessFieldUse,
  ResolvedReadinessSource,
} from "./types.js";

type RuleFieldScope = "document" | "local";

interface RuleIndex {
  readonly id: string;
  readonly fieldScope: RuleFieldScope;
  readonly conditionals: ReadonlyMap<NodeId, readonly ConditionalRule[]>;
  readonly repeats: ReadonlyMap<NodeId, readonly RepeatRule[]>;
  readonly emptyStates: ReadonlyMap<NodeId, readonly RepeatRule[]>;
}

interface ItemContext {
  readonly value: unknown;
  readonly definition: FieldDefinition;
  /** The aggregate array field reviewed for this repeated item. */
  readonly fieldTarget?: ResolvedReadinessFieldTarget;
  readonly itemId: string;
  readonly itemIndex: number;
  readonly bindings: ReadonlyMap<NodeId, readonly ItemBinding[]>;
}

type ProvenanceFrame =
  | { readonly kind: "fixed"; readonly expansion: ResolvedExpansion }
  | {
      readonly kind: "custom";
      readonly ownerInstanceId: NodeId;
      readonly definitionId: NodeId;
    };

interface ResolveContext {
  readonly path: string;
  readonly rules: RuleIndex;
  readonly inheritedLocalScope?: FieldScope;
  /**
   * Active repeat items, outermost first. Nested repeats compose rather than
   * replace these contexts because an outer rule may bind any descendant of
   * its prototype, including content materialized by an inner repeat.
   */
  readonly items?: readonly ItemContext[];
  readonly frames: readonly ProvenanceFrame[];
  readonly customStack: readonly NodeId[];
  readonly skipRepeatRuleId?: string;
}

interface Runtime {
  readonly document: CbbDocument;
  readonly documentScope: FieldScope;
  readonly definitions: ReadonlyMap<NodeId, CustomElementDefinition>;
  readonly findings: ResolveFinding[];
  readonly findingKeys: Set<string>;
  readonly rightsContributions: ResolvedRightsContribution[];
  readonly readinessSources: ResolvedReadinessSource[];
  readonly readinessFieldUses: ResolvedReadinessFieldUse[];
  readonly repeatStateCache: Map<string, RepeatState>;
  readonly presentation: EffectiveScripturePresentation;
  readonly maxExpandedNodes: number;
  readonly maxCustomDepth: number;
  nodeCount: number;
  aborted: boolean;
}

type RepeatState =
  | {
      readonly kind: "nonempty";
      readonly rule: RepeatRule;
      readonly fieldDefinition: FieldDefinition;
      readonly values: readonly unknown[];
      readonly itemIds: readonly string[];
    }
  | { readonly kind: "empty"; readonly rule: RepeatRule }
  | { readonly kind: "unresolved"; readonly rule: RepeatRule };

function makeRuleIndex(
  id: string,
  rules: readonly ContentRule[] | undefined,
  fieldScope: RuleFieldScope,
): RuleIndex {
  const conditionals = new Map<NodeId, ConditionalRule[]>();
  const repeats = new Map<NodeId, RepeatRule[]>();
  const emptyStates = new Map<NodeId, RepeatRule[]>();
  for (const rule of rules ?? []) {
    if (rule.kind === "conditional") {
      const current = conditionals.get(rule.targetNodeId) ?? [];
      current.push(rule);
      conditionals.set(rule.targetNodeId, current);
    } else {
      const current = repeats.get(rule.prototypeNodeId) ?? [];
      current.push(rule);
      repeats.set(rule.prototypeNodeId, current);
      if (rule.emptyState.mode === "show") {
        const empty = emptyStates.get(rule.emptyState.nodeId) ?? [];
        empty.push(rule);
        emptyStates.set(rule.emptyState.nodeId, empty);
      }
    }
  }
  return { id, fieldScope, conditionals, repeats, emptyStates };
}

function addFinding(
  runtime: Runtime,
  finding: Omit<ResolveFinding, "code" | "severity"> & {
    readonly code?: ResolveFinding["code"];
  },
): void {
  const complete: ResolveFinding = {
    code:
      finding.code ??
      (finding.kind.startsWith("field") ||
      finding.kind.startsWith("binding") ||
      finding.kind.startsWith("conditional") ||
      finding.kind.startsWith("repeat")
        ? "CBB-FIELD-0001"
        : "CBB-DOC-0001"),
    severity: "error",
    kind: finding.kind,
    path: finding.path,
    message: finding.message,
    ...(finding.nodeId !== undefined ? { nodeId: finding.nodeId } : {}),
    ...(finding.ruleId !== undefined ? { ruleId: finding.ruleId } : {}),
    ...(finding.fieldId !== undefined ? { fieldId: finding.fieldId } : {}),
  };
  const key = [
    complete.path,
    complete.code,
    complete.kind,
    complete.nodeId ?? "",
    complete.ruleId ?? "",
    complete.fieldId ?? "",
    complete.message,
  ].join("\u0000");
  if (!runtime.findingKeys.has(key)) {
    runtime.findingKeys.add(key);
    runtime.findings.push(complete);
  }
}

function claimNodes(runtime: Runtime, count: number, path: string): boolean {
  if (runtime.aborted) return false;
  if (runtime.nodeCount + count > runtime.maxExpandedNodes) {
    addFinding(runtime, {
      kind: "expandedNodeLimitExceeded",
      path,
      message: `Resolved output exceeds the ${runtime.maxExpandedNodes} node limit`,
    });
    runtime.aborted = true;
    return false;
  }
  runtime.nodeCount += count;
  return true;
}

function expansionsForSource(
  frames: readonly ProvenanceFrame[],
  sourceElementId: NodeId,
): readonly ResolvedExpansion[] {
  return frames.map((frame) =>
    frame.kind === "fixed"
      ? frame.expansion
      : {
          kind: "custom" as const,
          ownerInstanceId: frame.ownerInstanceId,
          definitionId: frame.definitionId,
          definitionNodeId: sourceElementId,
        },
  );
}

function provenanceFor(
  sourceElementId: NodeId,
  frames: readonly ProvenanceFrame[],
): ResolvedNodeProvenance {
  const expansions = expansionsForSource(frames, sourceElementId);
  const last = expansions[expansions.length - 1];
  if (last?.kind === "repeat") {
    return {
      kind: "repeatExpansion",
      sourceElementId,
      ruleId: last.ruleId,
      itemId: last.itemId,
      itemIndex: last.itemIndex,
      expansions,
    };
  }
  if (last?.kind === "custom") {
    return {
      kind: "customExpansion",
      sourceElementId,
      ownerInstanceId: last.ownerInstanceId,
      definitionNodeId: last.definitionNodeId,
      expansions,
    };
  }
  return { kind: "direct", sourceElementId, expansions };
}

function resolvedIdFor(
  sourceElementId: NodeId,
  frames: readonly ProvenanceFrame[],
): string {
  const parts: string[] = [];
  for (const expansion of expansionsForSource(frames, sourceElementId)) {
    if (expansion.kind === "repeat") {
      parts.push(expansion.ruleId, expansion.itemId);
    } else {
      parts.push(expansion.ownerInstanceId);
    }
  }
  parts.push(sourceElementId);
  return parts.join("/");
}

function flowProperties(element: NativeElement): ResolvedFlowProperties {
  // `style.font` is legacy migration input and is classified output-inert.
  // Keeping it in the resolved projection would make an edit that the
  // generator ignores invalidate renderInputHash.
  const { font: _legacyFont, ...renderStyle } = element.style ?? {};
  return {
    ...(element.width !== undefined ? { width: element.width } : {}),
    ...(element.height !== undefined ? { height: element.height } : {}),
    ...(element.breakPolicy !== undefined
      ? { breakPolicy: element.breakPolicy }
      : {}),
    ...(element.margin !== undefined ? { margin: element.margin } : {}),
    ...(element.padding !== undefined ? { padding: element.padding } : {}),
    ...(Object.keys(renderStyle).length > 0 ? { style: renderStyle } : {}),
  };
}

function localScopeForElement(
  element: NativeElement,
  context: ResolveContext,
): FieldScope | undefined {
  if (element.type !== "customInstance" && element.fieldContract !== undefined) {
    return {
      contract: element.fieldContract,
      ...(element.fieldValues !== undefined ? { values: element.fieldValues } : {}),
    };
  }
  return context.inheritedLocalScope;
}

function innermostCustomOwnerId(
  frames: readonly ProvenanceFrame[],
): NodeId | undefined {
  for (let index = frames.length - 1; index >= 0; index--) {
    const frame = frames[index] as ProvenanceFrame;
    if (frame.kind === "custom") return frame.ownerInstanceId;
    if (frame.expansion.kind === "custom") {
      return frame.expansion.ownerInstanceId;
    }
  }
  return undefined;
}

function localFieldTarget(
  fieldId: string,
  element: NativeElement,
  context: ResolveContext,
): ResolvedReadinessFieldTarget | undefined {
  if (element.type !== "customInstance" && element.fieldContract !== undefined) {
    return { scope: "local", ownerNodeId: element.id, fieldId };
  }
  const ownerNodeId = innermostCustomOwnerId(context.frames);
  return ownerNodeId === undefined
    ? undefined
    : { scope: "local", ownerNodeId, fieldId };
}

function bindingFieldTarget(
  binding: Binding,
  element: NativeElement,
  context: ResolveContext,
): ResolvedReadinessFieldTarget | undefined {
  return binding.scope === "document"
    ? { scope: "document", fieldId: binding.fieldId }
    : localFieldTarget(binding.fieldId, element, context);
}

function ruleFieldTarget(
  fieldId: string,
  context: ResolveContext,
): ResolvedReadinessFieldTarget | undefined {
  return context.rules.fieldScope === "document"
    ? { scope: "document", fieldId }
    : (() => {
        const ownerNodeId = innermostCustomOwnerId(context.frames);
        return ownerNodeId === undefined
          ? undefined
          : { scope: "local" as const, ownerNodeId, fieldId };
      })();
}

function conditionalContentScope(
  context: ResolveContext,
): Extract<
  ResolvedReadinessFieldUse,
  { readonly kind: "conditionalRule" }
>["contentScope"] | undefined {
  if (context.rules.fieldScope === "document") return { scope: "document" };
  for (let index = context.frames.length - 1; index >= 0; index--) {
    const frame = context.frames[index] as ProvenanceFrame;
    if (frame.kind === "custom") {
      return {
        scope: "custom",
        ownerNodeId: frame.ownerInstanceId,
        definitionId: frame.definitionId,
      };
    }
    if (frame.expansion.kind === "custom") {
      return {
        scope: "custom",
        ownerNodeId: frame.expansion.ownerInstanceId,
        definitionId: frame.expansion.definitionId,
      };
    }
  }
  return undefined;
}

function reportInvalidSources(
  runtime: Runtime,
  invalidSources: readonly string[],
  path: string,
  nodeId: NodeId,
  fieldId: string,
): void {
  for (const source of invalidSources) {
    addFinding(runtime, {
      kind: "fieldValueInvalid",
      path,
      nodeId,
      fieldId,
      message: `${source} value for field "${fieldId}" is invalid`,
    });
  }
}

function bindingScope(
  binding: Binding,
  element: NativeElement,
  context: ResolveContext,
  runtime: Runtime,
): FieldScope | undefined {
  return binding.scope === "document"
    ? runtime.documentScope
    : localScopeForElement(element, context);
}

function materializedValue(
  value: unknown,
  fieldType: FieldDefinition["type"],
  wrapsTextContent: boolean,
): unknown {
  if (!wrapsTextContent) return value;
  return fieldType === "richText"
    ? { kind: "richText", document: value }
    : { kind: "plain", text: value };
}

function initializeBindingContainerDefaults(
  current: Record<string, unknown>,
  target: string,
): Record<string, unknown> | undefined {
  if (
    (target === "/data/focalPoint/x" || target === "/data/focalPoint/y") &&
    current["type"] === "image" &&
    readPointer(current, "/data/focalPoint") === undefined
  ) {
    return writePointer(current, "/data/focalPoint", { x: 0.5, y: 0.5 });
  }
  return current;
}

function applyOrdinaryBindings(
  element: NativeElement,
  context: ResolveContext,
  runtime: Runtime,
): NativeElement | undefined {
  let current = element as unknown as Record<string, unknown>;
  for (const binding of element.type === "customInstance" ? [] : element.bindings ?? []) {
    const bindingPath = `${context.path}/bindings/${binding.id}`;
    const target = bindingTargetSpec(current as unknown as NativeElement, binding.target);
    if (target === undefined) {
      addFinding(runtime, {
        kind: "bindingTargetInvalid",
        path: bindingPath,
        nodeId: element.id,
        fieldId: binding.fieldId,
        message: `Binding "${binding.id}" targets a non-content or invalid pointer`,
      });
      return undefined;
    }
    const scope = bindingScope(binding, element, context, runtime);
    const effective = resolveEffectiveField(scope ?? {}, binding.fieldId, binding.fallback);
    if (effective.definition === undefined) {
      addFinding(runtime, {
        kind: "fieldDefinitionMissing",
        path: bindingPath,
        nodeId: element.id,
        fieldId: binding.fieldId,
        message: `Binding "${binding.id}" references an undeclared field`,
      });
      return undefined;
    }
    reportInvalidSources(
      runtime,
      effective.invalidSources,
      bindingPath,
      element.id,
      binding.fieldId,
    );
    if (!target.acceptedTypes.includes(effective.definition.type)) {
      addFinding(runtime, {
        kind: "bindingValueIncompatible",
        path: bindingPath,
        nodeId: element.id,
        fieldId: binding.fieldId,
        message: `Field type "${effective.definition.type}" is incompatible with ${binding.target}`,
      });
      return undefined;
    }
    if (effective.missing) {
      if (effective.definition.required || !target.optional) {
        addFinding(runtime, {
          kind: "fieldValueMissing",
          path: bindingPath,
          nodeId: element.id,
          fieldId: binding.fieldId,
          message: `No valid value, default, or fallback exists for field "${binding.fieldId}"`,
        });
        return undefined;
      }
      const deleted = deletePointer(current, binding.target);
      if (deleted === undefined) return undefined;
      current = deleted;
      const reviewTarget = bindingFieldTarget(binding, element, context);
      if (reviewTarget !== undefined) {
        runtime.readinessFieldUses.push({
          kind: "binding",
          target: reviewTarget,
          bindingId: binding.id,
        });
      }
      continue;
    }
    const initialized = initializeBindingContainerDefaults(current, binding.target);
    const written = initialized === undefined ? undefined : writePointer(
      initialized,
      binding.target,
      materializedValue(
        effective.value,
        effective.definition.type,
        target.wrapsTextContent === true,
      ),
    );
    if (written === undefined) {
      addFinding(runtime, {
        kind: "bindingTargetInvalid",
        path: bindingPath,
        nodeId: element.id,
        fieldId: binding.fieldId,
        message: `Binding "${binding.id}" could not safely materialize its target`,
      });
      return undefined;
    }
    current = written;
    const reviewTarget = bindingFieldTarget(binding, element, context);
    if (reviewTarget !== undefined) {
      runtime.readinessFieldUses.push({
        kind: "binding",
        target: reviewTarget,
        bindingId: binding.id,
        ...(effective.source === "fallback"
          ? { fallbackUsed: effective.value }
          : {}),
      });
    }
  }
  return current as unknown as NativeElement;
}

function applyItemBindings(
  element: NativeElement,
  context: ResolveContext,
  runtime: Runtime,
): NativeElement | undefined {
  let current = element as unknown as Record<string, unknown>;
  for (const item of context.items ?? []) {
    for (const binding of item.bindings.get(element.id) ?? []) {
      const bindingPath = `${context.path}/itemBindings/${binding.id}`;
      const target = bindingTargetSpec(current as unknown as NativeElement, binding.target);
      const definition = definitionAtItemPointer(item.definition, binding.itemPath);
      if (target === undefined || definition === undefined) {
        addFinding(runtime, {
          kind: "bindingTargetInvalid",
          path: bindingPath,
          nodeId: element.id,
          message: `Item binding "${binding.id}" has an invalid item or target pointer`,
        });
        return undefined;
      }
      if (!target.acceptedTypes.includes(definition.type)) {
        addFinding(runtime, {
          kind: "bindingValueIncompatible",
          path: bindingPath,
          nodeId: element.id,
          message: `Item field type "${definition.type}" is incompatible with ${binding.target}`,
        });
        return undefined;
      }
      let value = readPointer(item.value, binding.itemPath);
      let fallbackUsed = false;
      if (
        value === undefined &&
        definition.default !== undefined &&
        validateFieldValue(definition, definition.default)
      ) {
        value = definition.default;
      }
      if (!validateFieldValue(definition, value)) {
        value = binding.fallback;
        fallbackUsed = true;
      }
      if (value === undefined || !validateFieldValue(definition, value)) {
        if (definition.required || !target.optional) {
          addFinding(runtime, {
            kind: "fieldValueMissing",
            path: bindingPath,
            nodeId: element.id,
            fieldId: definition.id,
            message: `Item binding "${binding.id}" has no valid value or fallback`,
          });
          return undefined;
        }
        const deleted = deletePointer(current, binding.target);
        if (deleted === undefined) return undefined;
        current = deleted;
        if (item.fieldTarget !== undefined) {
          runtime.readinessFieldUses.push({
            kind: "binding",
            target: item.fieldTarget,
            bindingId: binding.id,
          });
        }
        continue;
      }
      const initialized = initializeBindingContainerDefaults(current, binding.target);
      const written = initialized === undefined ? undefined : writePointer(
        initialized,
        binding.target,
        materializedValue(value, definition.type, target.wrapsTextContent === true),
      );
      if (written === undefined) return undefined;
      current = written;
      if (item.fieldTarget !== undefined) {
        runtime.readinessFieldUses.push({
          kind: "binding",
          target: item.fieldTarget,
          bindingId: binding.id,
          ...(fallbackUsed ? { fallbackUsed: value } : {}),
        });
      }
    }
  }
  return current as unknown as NativeElement;
}

function materializeBindings(
  element: NativeElement,
  context: ResolveContext,
  runtime: Runtime,
): NativeElement | undefined {
  const firstBindingUse = runtime.readinessFieldUses.length;
  const ordinary = applyOrdinaryBindings(element, context, runtime);
  const materialized = ordinary === undefined
    ? undefined
    : applyItemBindings(ordinary, context, runtime);
  if (materialized === undefined) {
    runtime.readinessFieldUses.splice(firstBindingUse);
  }
  return materialized;
}

function controllerFromItem(
  rule: ConditionalRule,
  context: ResolveContext,
): { readonly value?: unknown; readonly definition?: FieldDefinition } {
  const item = context.items?.at(-1);
  if (item === undefined) return {};
  const pointer = rule.fieldId.startsWith("/") ? rule.fieldId : `/${rule.fieldId}`;
  const definition = rule.fieldId === item.definition.id
    ? item.definition
    : definitionAtItemPointer(item.definition, pointer);
  let value = rule.fieldId === item.definition.id
    ? item.value
    : readPointer(item.value, pointer);
  if (
    value === undefined &&
    definition?.default !== undefined &&
    validateFieldValue(definition, definition.default)
  ) {
    value = definition.default;
  }
  return { ...(value !== undefined ? { value } : {}), ...(definition !== undefined ? { definition } : {}) };
}

function conditionActive(
  rule: ConditionalRule,
  element: NativeElement,
  context: ResolveContext,
  runtime: Runtime,
): boolean | undefined {
  let value: unknown;
  let definition: FieldDefinition | undefined;
  if (rule.scope === "item") {
    const item = context.items?.at(-1);
    if (item === undefined) return true;
    ({ value, definition } = controllerFromItem(rule, context));
  } else {
    const scope = context.rules.fieldScope === "document"
      ? runtime.documentScope
      : context.inheritedLocalScope ?? {};
    const effective = resolveEffectiveField(scope, rule.fieldId);
    definition = effective.definition;
    value = effective.value;
    reportInvalidSources(
      runtime,
      effective.invalidSources,
      `${context.path}/condition/${rule.id}`,
      element.id,
      rule.fieldId,
    );
  }
  if (definition === undefined) {
    addFinding(runtime, {
      kind: "conditionalRuleInvalid",
      path: `${context.path}/condition/${rule.id}`,
      nodeId: element.id,
      ruleId: rule.id,
      fieldId: rule.fieldId,
      message: `Conditional rule "${rule.id}" references an invalid controller`,
    });
    return undefined;
  }
  if (value === undefined || value === null || !validateFieldValue(definition, value)) {
    addFinding(runtime, {
      kind: "conditionalUnresolved",
      path: `${context.path}/condition/${rule.id}`,
      nodeId: element.id,
      ruleId: rule.id,
      fieldId: rule.fieldId,
      message: `Conditional controller for rule "${rule.id}" is unresolved`,
    });
    return undefined;
  }
  if (rule.condition.kind === "booleanEquals") {
    if (definition.type !== "boolean" || typeof value !== "boolean") {
      addFinding(runtime, {
        kind: "conditionalRuleInvalid",
        path: `${context.path}/condition/${rule.id}`,
        nodeId: element.id,
        ruleId: rule.id,
        fieldId: rule.fieldId,
        message: `Rule "${rule.id}" requires a boolean controller`,
      });
      return undefined;
    }
    return value === rule.condition.value;
  }
  if (definition.type !== "choice" || typeof value !== "string") {
    addFinding(runtime, {
      kind: "conditionalRuleInvalid",
      path: `${context.path}/condition/${rule.id}`,
      nodeId: element.id,
      ruleId: rule.id,
      fieldId: rule.fieldId,
      message: `Rule "${rule.id}" requires a choice controller`,
    });
    return undefined;
  }
  return rule.condition.kind === "choiceEquals"
    ? value === rule.condition.choiceId
    : value !== rule.condition.choiceId;
}

function passesConditionalRules(
  element: NativeElement,
  context: ResolveContext,
  runtime: Runtime,
): boolean {
  const rules = context.rules.conditionals.get(element.id) ?? [];
  if (rules.length > 1) {
    addFinding(runtime, {
      kind: "conditionalRuleInvalid",
      path: context.path,
      nodeId: element.id,
      message: `Node "${element.id}" has more than one direct conditional rule`,
    });
    return false;
  }
  const rule = rules[0];
  if (rule === undefined) return true;
  if (rule.scope === "item") {
    const ownRepeats = context.rules.repeats.get(element.id) ?? [];
    const ownRepeat = ownRepeats.length === 1 ? ownRepeats[0] : undefined;
    if (
      ownRepeat !== undefined &&
      context.skipRepeatRuleId !== ownRepeat.id
    ) {
      // A prototype-root condition belongs to the item that this repeat is
      // about to create, not to an enclosing repeat item. Defer it until the
      // prototype is re-entered with that new item context.
      return true;
    }
  }
  const active = conditionActive(rule, element, context, runtime);
  const reviewTarget = rule.scope === "item"
    ? context.items?.at(-1)?.fieldTarget
    : ruleFieldTarget(rule.fieldId, context);
  const contentScope = conditionalContentScope(context);
  if (reviewTarget !== undefined && contentScope !== undefined) {
    runtime.readinessFieldUses.push({
      kind: "conditionalRule",
      target: reviewTarget,
      ruleId: rule.id,
      targetNodeId: rule.targetNodeId,
      condition: rule.condition,
      activation:
        active === undefined ? "unresolved" : active ? "active" : "inactive",
      contentScope,
    });
  }
  return active === true;
}

function repeatScope(context: ResolveContext, runtime: Runtime): FieldScope {
  return context.rules.fieldScope === "document"
    ? runtime.documentScope
    : context.inheritedLocalScope ?? {};
}

function repeatCacheKey(rule: RepeatRule, context: ResolveContext): string {
  const scopeIdentity = context.frames
    .map((frame) =>
      frame.kind === "fixed"
        ? frame.expansion.kind === "repeat"
          ? `${frame.expansion.ruleId}:${frame.expansion.itemId}`
          : frame.expansion.ownerInstanceId
        : frame.ownerInstanceId,
    )
    .join("/");
  return `${context.rules.id}|${scopeIdentity}|${rule.id}`;
}

function evaluateRepeat(
  rule: RepeatRule,
  context: ResolveContext,
  runtime: Runtime,
): RepeatState {
  const reviewTarget = ruleFieldTarget(rule.fieldId, context);
  if (reviewTarget !== undefined) {
    runtime.readinessFieldUses.push({
      kind: "repeatRule",
      target: reviewTarget,
      ruleId: rule.id,
      prototypeNodeId: rule.prototypeNodeId,
      emptyState: rule.emptyState,
      maxItems: rule.maxItems,
      nullIsEmpty: rule.nullIsEmpty ?? false,
    });
  }
  const cacheKey = repeatCacheKey(rule, context);
  const cached = runtime.repeatStateCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const scope = repeatScope(context, runtime);
  const effective = resolveEffectiveField(scope, rule.fieldId);
  reportInvalidSources(
    runtime,
    effective.invalidSources,
    `${context.path}/repeat/${rule.id}`,
    rule.prototypeNodeId,
    rule.fieldId,
  );
  if (effective.definition === undefined || effective.definition.type !== "array") {
    addFinding(runtime, {
      kind: "repeatRuleInvalid",
      path: `${context.path}/repeat/${rule.id}`,
      nodeId: rule.prototypeNodeId,
      ruleId: rule.id,
      fieldId: rule.fieldId,
      message: `Repeat rule "${rule.id}" does not reference an array field`,
    });
    const state: RepeatState = { kind: "unresolved", rule };
    runtime.repeatStateCache.set(cacheKey, state);
    return state;
  }
  if (effective.missing || effective.value === undefined) {
    addFinding(runtime, {
      kind: "repeatUnresolved",
      path: `${context.path}/repeat/${rule.id}`,
      nodeId: rule.prototypeNodeId,
      ruleId: rule.id,
      fieldId: rule.fieldId,
      message: `Repeat field "${rule.fieldId}" is unresolved`,
    });
    const state: RepeatState = { kind: "unresolved", rule };
    runtime.repeatStateCache.set(cacheKey, state);
    return state;
  }
  if (effective.value === null) {
    const state: RepeatState = rule.nullIsEmpty === true
      ? { kind: "empty", rule }
      : { kind: "unresolved", rule };
    if (state.kind === "unresolved") {
      addFinding(runtime, {
        kind: "repeatUnresolved",
        path: `${context.path}/repeat/${rule.id}`,
        nodeId: rule.prototypeNodeId,
        ruleId: rule.id,
        fieldId: rule.fieldId,
        message: `Null is not an empty value for repeat rule "${rule.id}"`,
      });
    }
    runtime.repeatStateCache.set(cacheKey, state);
    return state;
  }
  if (!Array.isArray(effective.value)) {
    const state: RepeatState = { kind: "unresolved", rule };
    runtime.repeatStateCache.set(cacheKey, state);
    return state;
  }
  if (
    rule.maxItems < 1 ||
    effective.value.length > rule.maxItems ||
    (effective.definition.constraints?.minItems !== undefined &&
      rule.maxItems < effective.definition.constraints.minItems) ||
    (effective.definition.constraints?.maxItems !== undefined &&
      rule.maxItems > effective.definition.constraints.maxItems)
  ) {
    addFinding(runtime, {
      kind: "repeatRuleInvalid",
      path: `${context.path}/repeat/${rule.id}`,
      nodeId: rule.prototypeNodeId,
      ruleId: rule.id,
      fieldId: rule.fieldId,
      message: `Repeat rule "${rule.id}" exceeds its declared maximum`,
    });
    const state: RepeatState = { kind: "unresolved", rule };
    runtime.repeatStateCache.set(cacheKey, state);
    return state;
  }
  if (effective.value.length === 0) {
    const state: RepeatState = { kind: "empty", rule };
    runtime.repeatStateCache.set(cacheKey, state);
    return state;
  }
  const entry: FieldValueEntry | undefined =
    effective.source === "stored" ? scope.values?.[rule.fieldId] : undefined;
  const itemIds = entry?.itemIds;
  if (
    itemIds === undefined ||
    itemIds.length !== effective.value.length ||
    new Set(itemIds).size !== itemIds.length
  ) {
    addFinding(runtime, {
      kind: "repeatItemIdsInvalid",
      path: `${context.path}/repeat/${rule.id}`,
      nodeId: rule.prototypeNodeId,
      ruleId: rule.id,
      fieldId: rule.fieldId,
      message: `Repeat rule "${rule.id}" requires one unique stable item id per value`,
    });
    const state: RepeatState = { kind: "unresolved", rule };
    runtime.repeatStateCache.set(cacheKey, state);
    return state;
  }
  const state: RepeatState = {
    kind: "nonempty",
    rule,
    fieldDefinition: effective.definition,
    values: effective.value,
    itemIds,
  };
  runtime.repeatStateCache.set(cacheKey, state);
  return state;
}

function emptyStateAllows(
  element: NativeElement,
  context: ResolveContext,
  runtime: Runtime,
): boolean {
  const owners = context.rules.emptyStates.get(element.id) ?? [];
  if (owners.length === 0) return true;
  if (owners.length > 1) {
    addFinding(runtime, {
      kind: "repeatRuleInvalid",
      path: context.path,
      nodeId: element.id,
      message: `Empty-state node "${element.id}" is owned by multiple repeat rules`,
    });
    return false;
  }
  return evaluateRepeat(owners[0] as RepeatRule, context, runtime).kind === "empty";
}

function itemBindingIndex(rule: RepeatRule): ReadonlyMap<NodeId, readonly ItemBinding[]> {
  const result = new Map<NodeId, ItemBinding[]>();
  for (const binding of rule.itemBindings ?? []) {
    const bindings = result.get(binding.targetNodeId) ?? [];
    bindings.push(binding);
    result.set(binding.targetNodeId, bindings);
  }
  return result;
}

function expandRepeat(
  element: NativeElement,
  rule: RepeatRule,
  state: Extract<RepeatState, { kind: "nonempty" }>,
  context: ResolveContext,
  runtime: Runtime,
): readonly ResolvedNode[] {
  const itemDefinition = state.fieldDefinition.itemField;
  if (itemDefinition === undefined) return [];
  const bindingIndex = itemBindingIndex(rule);
  const fieldTarget = ruleFieldTarget(rule.fieldId, context);
  const nodes: ResolvedNode[] = [];
  for (let index = 0; index < state.values.length && !runtime.aborted; index++) {
    const itemId = state.itemIds[index] as string;
    const expansion: ResolvedExpansion = {
      kind: "repeat",
      ruleId: rule.id,
      prototypeNodeId: rule.prototypeNodeId,
      itemId,
      itemIndex: index,
    };
    const itemContext: ItemContext = {
      value: state.values[index],
      definition: itemDefinition,
      ...(fieldTarget === undefined ? {} : { fieldTarget }),
      itemId,
      itemIndex: index,
      bindings: bindingIndex,
    };
    nodes.push(
      ...resolveSourceElement(
        element,
        {
          ...context,
          path: `${context.path}/repeat/${rule.id}/${itemId}`,
          items: [...(context.items ?? []), itemContext],
          frames: [...context.frames, { kind: "fixed", expansion }],
          skipRepeatRuleId: rule.id,
        },
        runtime,
      ),
    );
  }
  return nodes;
}

function coalesceNodes(
  nodes: readonly ResolvedNode[],
  sourceId: NodeId,
  context: ResolveContext,
  runtime: Runtime,
  path: string,
): ResolvedNode | undefined {
  if (nodes.length === 0) return undefined;
  if (nodes.length === 1) return nodes[0];
  if (!claimNodes(runtime, nodes.length + 1, path)) return undefined;
  const provenance = provenanceFor(sourceId, context.frames);
  const resolvedId = `${resolvedIdFor(sourceId, context.frames)}/$group`;
  return {
    resolvedId,
    provenance,
    element: {
      type: "stack",
      data: { direction: "vertical", gap: "0pt" },
      children: nodes.map((node, index) => ({
        resolvedId: `${resolvedId}/child/${index}`,
        provenance: node.provenance,
        index,
        element: node,
      })),
    },
  };
}

function buildResolvedElement(
  element: Exclude<NativeElement, CustomElementInstance>,
  context: ResolveContext,
  runtime: Runtime,
): ResolvedElement | undefined {
  const base = flowProperties(element);
  if (element.type === "text") {
    const content = element.data.content;
    if (
      content === undefined ||
      (content.kind === "plain" && content.text === undefined) ||
      (content.kind === "richText" && content.document === undefined)
    ) {
      addFinding(runtime, {
        kind: "fieldValueMissing",
        path: `${context.path}/data/content`,
        nodeId: element.id,
        message: "Text content remained unresolved after applying bindings",
      });
      return undefined;
    }
    return {
      ...base,
      type: "text",
      data: {
        content: resolveTextContent(
          content,
          runtime.presentation,
          runtime.rightsContributions,
        ),
      },
    };
  }
  if (element.type === "image") {
    if (
      element.data.assetRef === undefined ||
      (element.data.focalPoint !== undefined &&
        (element.data.focalPoint.x === undefined || element.data.focalPoint.y === undefined))
    ) {
      addFinding(runtime, {
        kind: "fieldValueMissing",
        path: `${context.path}/data`,
        nodeId: element.id,
        message: "Image content remained unresolved after applying bindings",
      });
      return undefined;
    }
    return { ...base, type: "image", data: element.data } as ResolvedElement;
  }
  if (element.type === "date") {
    if (element.data.value === undefined) {
      addFinding(runtime, {
        kind: "fieldValueMissing",
        path: `${context.path}/data/value`,
        nodeId: element.id,
        message: "Date content remained unresolved after applying bindings",
      });
      return undefined;
    }
    return { ...base, type: "date", data: element.data } as ResolvedElement;
  }
  if (element.type === "rightsAttribution" || element.type === "pageBreak") {
    return { ...base, type: element.type, data: element.data } as ResolvedElement;
  }
  if (element.type === "music") {
    if (element.data.title === undefined) {
      addFinding(runtime, {
        kind: "fieldValueMissing",
        path: `${context.path}/data/title`,
        nodeId: element.id,
        message: "Song title remained unresolved after applying bindings",
      });
      return undefined;
    }
    const nestedRights: ResolvedRightsContribution[] = [];
    const richContent = element.data.richContent === undefined
      ? undefined
      : resolveRichTextDocument(
          element.data.richContent,
          runtime.presentation,
          nestedRights,
        );
    collectMusicRights(
      element.data.rights,
      runtime.rightsContributions,
      richContent !== undefined && resolvedRichTextHasRenderedText(richContent),
    );
    const nestedAppearanceOffset = runtime.rightsContributions.length;
    runtime.rightsContributions.push(...nestedRights.map((contribution) => ({
      ...contribution,
      firstAppearance: contribution.firstAppearance + nestedAppearanceOffset,
    })));
    return {
      ...base,
      type: "music",
      data: {
        ...(element.data.number !== undefined ? { number: element.data.number } : {}),
        title: element.data.title,
        ...(element.data.instructions !== undefined
          ? { instructions: element.data.instructions }
          : {}),
        ...(element.data.source !== undefined ? { source: element.data.source } : {}),
        ...(richContent !== undefined
          ? { richContent }
          : {}),
      },
    };
  }
  if (element.type === "grid") {
    const children = [];
    // Grid coordinates, not persisted wrapper-array order, are authoritative
    // for visual/reading traversal. Resolve in the same row-major order that
    // Typst emits so rights first appearance and the render projection agree.
    const orderedWrappers = [...element.children].sort(
      (left, right) =>
        left.row - right.row ||
        left.column - right.column ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    );
    for (const wrapper of orderedWrappers) {
      const childPath = `${context.path}/children/${wrapper.id}`;
      const resolved = resolveSourceElement(
        wrapper.element,
        { ...context, path: childPath },
        runtime,
      );
      const child = coalesceNodes(resolved, wrapper.element.id, context, runtime, childPath);
      if (child !== undefined && claimNodes(runtime, 1, childPath)) {
        children.push({
          resolvedId: resolvedIdFor(wrapper.id, context.frames),
          provenance: provenanceFor(wrapper.id, context.frames),
          row: wrapper.row,
          column: wrapper.column,
          element: child,
        });
      }
    }
    return { ...base, type: "grid", data: element.data, children };
  }
  if (element.type === "stack") {
    const children = [];
    for (const wrapper of element.children) {
      const childPath = `${context.path}/children/${wrapper.id}`;
      const resolved = resolveSourceElement(
        wrapper.element,
        { ...context, path: childPath },
        runtime,
      );
      const child = coalesceNodes(resolved, wrapper.element.id, context, runtime, childPath);
      if (child !== undefined && claimNodes(runtime, 1, childPath)) {
        children.push({
          resolvedId: resolvedIdFor(wrapper.id, context.frames),
          provenance: provenanceFor(wrapper.id, context.frames),
          index: wrapper.index,
          element: child,
        });
      }
    }
    return { ...base, type: "stack", data: element.data, children };
  }
  const children = [];
  for (const wrapper of element.children) {
    const childPath = `${context.path}/children/${wrapper.id}`;
    const resolved = resolveSourceElement(
      wrapper.element,
      { ...context, path: childPath },
      runtime,
    );
    const child = coalesceNodes(resolved, wrapper.element.id, context, runtime, childPath);
    if (child !== undefined && claimNodes(runtime, 1, childPath)) {
      children.push({
        resolvedId: resolvedIdFor(wrapper.id, context.frames),
        provenance: provenanceFor(wrapper.id, context.frames),
        x: wrapper.x,
        y: wrapper.y,
        ...(wrapper.semanticOrder !== undefined
          ? { semanticOrder: wrapper.semanticOrder }
          : {}),
        element: child,
      });
    }
  }
  return {
    ...base,
    type: "canvas",
    ...(element.data !== undefined ? { data: element.data } : {}),
    children,
  };
}

function expandCustom(
  instance: CustomElementInstance,
  context: ResolveContext,
  runtime: Runtime,
): readonly ResolvedNode[] {
  const definition = runtime.definitions.get(instance.definitionId);
  if (definition === undefined) {
    addFinding(runtime, {
      kind: "customDefinitionMissing",
      path: context.path,
      nodeId: instance.id,
      message: `Custom definition "${instance.definitionId}" is missing`,
    });
    return [];
  }
  const rawInstance = instance as unknown as Readonly<Record<string, unknown>>;
  const pinnedVersion = rawInstance["definitionVersion"];
  const pinnedHash = rawInstance["definitionHash"];
  if (
    !Number.isSafeInteger(definition.definitionVersion) ||
    definition.definitionVersion < 1 ||
    customElementDefinitionHash(definition) !== definition.definitionHash
  ) {
    addFinding(runtime, {
      kind: "customDefinitionHashMismatch",
      path: context.path,
      nodeId: instance.id,
      message: `Custom definition "${instance.definitionId}" has invalid revision evidence`,
    });
    return [];
  }
  if (
    !Number.isSafeInteger(pinnedVersion) ||
    (pinnedVersion as number) < 1 ||
    typeof pinnedHash !== "string"
  ) {
    addFinding(runtime, {
      kind: "customDefinitionPinMissing",
      path: context.path,
      nodeId: instance.id,
      message: `Custom instance "${instance.id}" lacks a complete definition pin`,
    });
    return [];
  }
  if (pinnedVersion !== definition.definitionVersion) {
    addFinding(runtime, {
      kind: "customDefinitionVersionMismatch",
      path: context.path,
      nodeId: instance.id,
      message: `Pinned revision for custom definition "${instance.definitionId}" does not match`,
    });
    return [];
  }
  if (pinnedHash !== definition.definitionHash) {
    addFinding(runtime, {
      kind: "customDefinitionHashMismatch",
      path: context.path,
      nodeId: instance.id,
      message: `Pinned hash for custom definition "${instance.definitionId}" does not match`,
    });
    return [];
  }
  if (context.customStack.includes(definition.id)) {
    addFinding(runtime, {
      kind: "customDefinitionCycle",
      path: context.path,
      nodeId: instance.id,
      message: `Custom definition cycle includes "${definition.id}"`,
    });
    return [];
  }
  if (context.customStack.length >= runtime.maxCustomDepth) {
    addFinding(runtime, {
      kind: "customDefinitionDepthExceeded",
      path: context.path,
      nodeId: instance.id,
      message: `Custom definition expansion exceeds depth ${runtime.maxCustomDepth}`,
    });
    return [];
  }

  const localScope: FieldScope = {
    contract: definition.fieldContract,
    ...(instance.fieldValues !== undefined ? { values: instance.fieldValues } : {}),
  };
  const frames: ProvenanceFrame[] = context.frames.map((frame) =>
    frame.kind === "fixed"
      ? frame
      : {
          kind: "fixed" as const,
          expansion: {
            kind: "custom" as const,
            ownerInstanceId: frame.ownerInstanceId,
            definitionId: frame.definitionId,
            definitionNodeId: instance.id,
          },
        },
  );
  frames.push({
    kind: "custom",
    ownerInstanceId: instance.id,
    definitionId: definition.id,
  });
  const rules = makeRuleIndex(
    `${context.rules.id}/custom/${resolvedIdFor(instance.id, context.frames)}`,
    definition.contentRules,
    "local",
  );
  const roots: ResolvedNode[] = [];
  for (const root of definition.elements) {
    roots.push(
      ...resolveSourceElement(
        root,
        {
          path: `${context.path}/definition/${definition.id}/${root.id}`,
          rules,
          inheritedLocalScope: localScope,
          frames,
          customStack: [...context.customStack, definition.id],
          ...(context.items !== undefined ? { items: context.items } : {}),
        },
        runtime,
      ),
    );
  }
  if (roots.length === 0 || runtime.aborted) return [];
  if (!claimNodes(runtime, roots.length + 1, context.path)) return [];
  const resolvedId = resolvedIdFor(instance.id, context.frames);
  return [
    {
      resolvedId,
      provenance: provenanceFor(instance.id, context.frames),
      element: {
        ...flowProperties(instance),
        type: "stack",
        data: { direction: "vertical", gap: "0pt" },
        children: roots.map((root, index) => ({
          resolvedId: `${resolvedId}/custom-root/${index}`,
          provenance: root.provenance,
          index,
          element: root,
        })),
      },
    },
  ];
}

function resolveSourceElement(
  source: NativeElement,
  context: ResolveContext,
  runtime: Runtime,
): readonly ResolvedNode[] {
  if (runtime.aborted) return [];
  // Structural exclusion precedes content materialization. Inactive branches
  // and collapsed repeat prototypes must not evaluate bindings or report
  // missing values that cannot affect this render.
  if (!emptyStateAllows(source, context, runtime)) return [];
  if (!passesConditionalRules(source, context, runtime)) return [];

  const repeatRules = context.rules.repeats.get(source.id) ?? [];
  if (repeatRules.length > 1) {
    addFinding(runtime, {
      kind: "repeatRuleInvalid",
      path: context.path,
      nodeId: source.id,
      message: `Node "${source.id}" is the prototype of multiple repeat rules`,
    });
    return [];
  }
  const repeatRule = repeatRules[0];
  if (repeatRule !== undefined && context.skipRepeatRuleId !== repeatRule.id) {
    const state = evaluateRepeat(repeatRule, context, runtime);
    return state.kind === "nonempty"
      ? expandRepeat(source, repeatRule, state, context, runtime)
      : [];
  }

  const materialized = materializeBindings(source, context, runtime);
  if (materialized === undefined) return [];

  if (materialized.type === "customInstance") {
    const expanded = expandCustom(materialized, context, runtime);
    if (expanded.length > 0 && !runtime.aborted) {
      runtime.readinessSources.push({
        path: context.path,
        resolvedId: resolvedIdFor(materialized.id, context.frames),
        provenance: provenanceFor(materialized.id, context.frames),
        element: materialized,
      });
    }
    return expanded;
  }
  const resolvedElement = buildResolvedElement(materialized, context, runtime);
  if (resolvedElement === undefined || !claimNodes(runtime, 1, context.path)) return [];
  runtime.readinessSources.push({
    path: context.path,
    resolvedId: resolvedIdFor(materialized.id, context.frames),
    provenance: provenanceFor(materialized.id, context.frames),
    element: materialized,
  });
  return [
    {
      resolvedId: resolvedIdFor(materialized.id, context.frames),
      provenance: provenanceFor(materialized.id, context.frames),
      element: resolvedElement,
    },
  ];
}

function resolvePageElements(
  pageElements: readonly PageLevelWrapper[] | undefined,
  rootContext: ResolveContext,
  runtime: Runtime,
): readonly ResolvedPageElement[] {
  const result: ResolvedPageElement[] = [];
  for (const wrapper of pageElements ?? []) {
    const source = wrapper.element as unknown as NativeElement;
    const nodes = resolveSourceElement(
      source,
      { ...rootContext, path: `/pageElements/${wrapper.id}` },
      runtime,
    );
    for (const node of nodes) {
      if (!claimNodes(runtime, 1, `/pageElements/${wrapper.id}`)) break;
      result.push({
        resolvedId:
          nodes.length === 1
            ? resolvedIdFor(wrapper.id, rootContext.frames)
            : `${resolvedIdFor(wrapper.id, rootContext.frames)}/${node.resolvedId}`,
        provenance: provenanceFor(wrapper.id, rootContext.frames),
        purpose: wrapper.purpose,
        target: wrapper.target,
        layer: wrapper.layer,
        region: wrapper.region,
        anchor: wrapper.anchor,
        x: wrapper.x,
        y: wrapper.y,
        width: wrapper.width,
        height: wrapper.height,
        zIndex: wrapper.zIndex,
        clipToRegion: wrapper.clipToRegion,
        semantic: wrapper.semantic,
        element: node,
      });
    }
  }
  return result;
}

function definitionsById(
  definitions: readonly CustomElementDefinition[] | undefined,
): ReadonlyMap<NodeId, CustomElementDefinition> {
  const result = new Map<NodeId, CustomElementDefinition>();
  for (const definition of definitions ?? []) {
    if (!result.has(definition.id)) result.set(definition.id, definition);
  }
  return result;
}

function sortFindings(findings: readonly ResolveFinding[]): readonly ResolveFinding[] {
  return [...findings].sort((left, right) => {
    const a = [left.path, left.code, left.kind, left.nodeId ?? "", left.ruleId ?? "", left.fieldId ?? ""];
    const b = [right.path, right.code, right.kind, right.nodeId ?? "", right.ruleId ?? "", right.fieldId ?? ""];
    for (let index = 0; index < a.length; index++) {
      const leftValue = a[index] as string;
      const rightValue = b[index] as string;
      if (leftValue < rightValue) return -1;
      if (leftValue > rightValue) return 1;
    }
    return 0;
  });
}

/** Resolve one already schema-validated v1 document without I/O or host APIs. */
export function resolveDocument(
  document: CbbDocument,
  options: ResolveOptions = {},
): ResolveDocumentResult {
  const requestedNodeLimit = options.maxExpandedNodes;
  const maxExpandedNodes =
    requestedNodeLimit !== undefined &&
    Number.isFinite(requestedNodeLimit) &&
    requestedNodeLimit > 0
      ? Math.min(
          Math.floor(requestedNodeLimit),
          DOCUMENT_LIMITS.EXPANDED_RENDER_NODES_CAP,
        )
      : DOCUMENT_LIMITS.EXPANDED_RENDER_NODES_CAP;
  const requestedCustomDepth = options.maxCustomDepth;
  const maxCustomDepth =
    requestedCustomDepth !== undefined &&
    Number.isFinite(requestedCustomDepth) &&
    requestedCustomDepth > 0
      ? Math.floor(requestedCustomDepth)
      : 32;
  const presentation = effectiveScripturePresentation(document.scripturePresentation);
  const runtime: Runtime = {
    document,
    documentScope: {
      ...(document.fieldContract !== undefined
        ? { contract: document.fieldContract }
        : {}),
      ...(document.fieldValues !== undefined ? { values: document.fieldValues } : {}),
    },
    definitions: definitionsById(document.customElementDefinitions),
    findings: [],
    findingKeys: new Set(),
    rightsContributions: [],
    readinessSources: [],
    readinessFieldUses: [],
    repeatStateCache: new Map(),
    presentation,
    maxExpandedNodes,
    maxCustomDepth,
    nodeCount: 0,
    aborted: false,
  };
  const rules = makeRuleIndex("document", document.contentRules, "document");
  const rootContext: ResolveContext = {
    path: "/elements",
    rules,
    frames: [],
    customStack: [],
  };
  const elements: ResolvedNode[] = [];
  for (const element of document.elements) {
    elements.push(
      ...resolveSourceElement(
        element,
        { ...rootContext, path: `/elements/${element.id}` },
        runtime,
      ),
    );
  }
  const pageElements = resolvePageElements(document.pageElements, rootContext, runtime);
  const tree: ResolvedRenderTree = runtime.aborted
    ? { elements: [], pageElements: [], totalNodeCount: 0 }
    : { elements, pageElements, totalNodeCount: runtime.nodeCount };
  const rightsContributions = runtime.aborted ? [] : runtime.rightsContributions;
  const readinessSources = runtime.aborted ? [] : runtime.readinessSources;
  const readinessFieldUses = runtime.aborted ? [] : runtime.readinessFieldUses;
  const locale = options.locale ?? document.metadata?.language ?? "en-US";
  const projection = makeRenderProjection(
    document,
    tree,
    locale,
    presentation,
    rightsContributions,
  );
  return {
    tree,
    projection,
    rightsContributions,
    readinessSources,
    readinessFieldUses,
    findings: sortFindings(runtime.findings),
  };
}

// Type-only assertion helper used by tests and downstream exhaustive switches.
export type { ResolveFindingKind };
