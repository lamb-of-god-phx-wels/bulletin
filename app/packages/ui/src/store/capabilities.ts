import type {
  AuthoringPolicy,
  CbbDocument,
  NativeElement,
  NodeId,
} from "@cbb/core";
import type {
  CapabilityDecision,
  CapabilityRequirement,
  CapabilityTarget,
  EditorCapability,
  EditorMode,
} from "./types.js";

type LockKind = "content" | "layout" | "none";

export interface EditorCapabilityDefinition {
  readonly minimumMode: EditorMode;
  readonly lock: LockKind;
  readonly actionLabel: string;
}

/** One closed catalog keeps toolbar, keyboard, and drag/drop checks identical. */
export const EDITOR_CAPABILITY_CATALOG: Readonly<
  Record<EditorCapability, EditorCapabilityDefinition>
> = Object.freeze({
  "content.edit": {
    minimumMode: "weeklyContent",
    lock: "content",
    actionLabel: "edit content",
  },
  "content.replaceImage": {
    minimumMode: "weeklyContent",
    lock: "content",
    actionLabel: "replace this image",
  },
  "content.adjustImageCrop": {
    minimumMode: "weeklyContent",
    lock: "content",
    actionLabel: "adjust this image",
  },
  "content.manageConditionalSection": {
    minimumMode: "weeklyContent",
    lock: "content",
    actionLabel: "change this optional section",
  },
  "content.manageRepeatItems": {
    minimumMode: "weeklyContent",
    lock: "content",
    actionLabel: "change these items",
  },
  "content.editAccessibility": {
    minimumMode: "weeklyContent",
    lock: "content",
    actionLabel: "edit the accessibility description",
  },
  "layout.edit": {
    minimumMode: "customizeLayout",
    lock: "layout",
    actionLabel: "change layout",
  },
  "layout.editStructure": {
    minimumMode: "customizeLayout",
    lock: "layout",
    actionLabel: "change document structure",
  },
  "layout.editPageSetup": {
    minimumMode: "customizeLayout",
    lock: "layout",
    actionLabel: "change page setup",
  },
  "layout.editPlacement": {
    minimumMode: "customizeLayout",
    lock: "layout",
    actionLabel: "move this item",
  },
  "layout.resize": {
    minimumMode: "customizeLayout",
    lock: "layout",
    actionLabel: "resize this item",
  },
  "template.editBindings": {
    minimumMode: "customizeLayout",
    lock: "layout",
    actionLabel: "change weekly field connections",
  },
  "template.editFieldContract": {
    minimumMode: "customizeLayout",
    lock: "layout",
    actionLabel: "change weekly fields",
  },
  "template.editRules": {
    minimumMode: "customizeLayout",
    lock: "layout",
    actionLabel: "change section rules",
  },
  "template.editLifecycle": {
    minimumMode: "customizeLayout",
    lock: "layout",
    actionLabel: "change this template",
  },
  "authoringPolicy.edit": {
    minimumMode: "customizeLayout",
    lock: "none",
    actionLabel: "change editing protection",
  },
});

export interface EffectiveAuthoringPolicy {
  readonly contentLocked: boolean;
  readonly layoutLocked: boolean;
  readonly contentLockSource?: CapabilityTarget;
  readonly layoutLockSource?: CapabilityTarget;
}

interface PolicyState {
  readonly contentLocked: boolean;
  readonly layoutLocked: boolean;
  readonly contentLockSource?: CapabilityTarget;
  readonly layoutLockSource?: CapabilityTarget;
}

function policyTarget(nodeId?: NodeId): CapabilityTarget {
  return nodeId === undefined
    ? { kind: "document" }
    : { kind: "node", nodeId };
}

function applyPolicy(
  inherited: PolicyState,
  policy: AuthoringPolicy | undefined,
  source: CapabilityTarget,
): PolicyState {
  if (policy === undefined) return inherited;

  let contentLocked = inherited.contentLocked;
  let contentLockSource = inherited.contentLockSource;
  if (policy.contentLocked !== undefined) {
    contentLocked = policy.contentLocked;
    contentLockSource = policy.contentLocked ? source : undefined;
  }

  let layoutLocked = inherited.layoutLocked;
  let layoutLockSource = inherited.layoutLockSource;
  if (policy.layoutLocked !== undefined) {
    layoutLocked = policy.layoutLocked;
    layoutLockSource = policy.layoutLocked ? source : undefined;
  }

  return {
    contentLocked,
    layoutLocked,
    ...(contentLockSource === undefined ? {} : { contentLockSource }),
    ...(layoutLockSource === undefined ? {} : { layoutLockSource }),
  };
}

/** Placement wrappers may override layout protection, never child content. */
function applyPlacementPolicy(
  inherited: PolicyState,
  policy: AuthoringPolicy | undefined,
  source: CapabilityTarget,
): PolicyState {
  if (policy?.layoutLocked === undefined) return inherited;
  return applyPolicy(
    inherited,
    { layoutLocked: policy.layoutLocked },
    source,
  );
}

function findInElement(
  element: NativeElement,
  targetNodeId: NodeId,
  inherited: PolicyState,
): PolicyState | undefined {
  const elementState = applyPolicy(
    inherited,
    element.authoringPolicy,
    policyTarget(element.id),
  );
  if (element.id === targetNodeId) return elementState;

  if (
    element.type !== "grid" &&
    element.type !== "stack" &&
    element.type !== "canvas"
  ) {
    return undefined;
  }

  for (const wrapper of element.children) {
    const wrapperState = applyPlacementPolicy(
      elementState,
      wrapper.authoringPolicy,
      policyTarget(wrapper.id),
    );
    if (wrapper.id === targetNodeId) return wrapperState;
    // The wrapper owns placement only. Its override must not silently change
    // the wrapped native element's content/style policy.
    const found = findInElement(wrapper.element, targetNodeId, elementState);
    if (found !== undefined) return found;
  }
  return undefined;
}

function rootPolicy(document: CbbDocument): PolicyState {
  return applyPolicy(
    { contentLocked: false, layoutLocked: false },
    document.authoringPolicy,
    policyTarget(),
  );
}

/** Resolve property-level inherited content/layout protection for any node. */
export function effectiveAuthoringPolicy(
  document: CbbDocument,
  target: CapabilityTarget = { kind: "document" },
): EffectiveAuthoringPolicy | undefined {
  const root = rootPolicy(document);
  if (target.kind === "document") return root;

  for (const element of document.elements) {
    const found = findInElement(element, target.nodeId, root);
    if (found !== undefined) return found;
  }

  for (const wrapper of document.pageElements ?? []) {
    const wrapperState = applyPlacementPolicy(
      root,
      wrapper.authoringPolicy,
      policyTarget(wrapper.id),
    );
    if (wrapper.id === target.nodeId) return wrapperState;
    const found = findInElement(wrapper.element, target.nodeId, root);
    if (found !== undefined) return found;
  }

  for (const definition of document.customElementDefinitions ?? []) {
    const definitionState = applyPolicy(
      root,
      definition.authoringPolicy,
      policyTarget(definition.id),
    );
    if (definition.id === target.nodeId) return definitionState;
    for (const element of definition.elements) {
      const found = findInElement(element, target.nodeId, definitionState);
      if (found !== undefined) return found;
    }
  }

  return undefined;
}

function denied(
  code: "requiresCustomizeLayout" | "contentLocked" | "layoutLocked",
  reason: string,
  requirement: CapabilityRequirement,
  lockSource?: CapabilityTarget,
): CapabilityDecision {
  return {
    allowed: false,
    code,
    reason,
    requirement,
    ...(lockSource === undefined ? {} : { lockSource }),
  };
}

/** Evaluate one command requirement for the current mode and inherited locks. */
export function checkEditorCapability(
  document: CbbDocument,
  mode: EditorMode,
  requirement: CapabilityRequirement,
): CapabilityDecision {
  const definition = EDITOR_CAPABILITY_CATALOG[requirement.capability];
  if (
    definition.minimumMode === "customizeLayout" &&
    mode !== "customizeLayout"
  ) {
    return denied(
      "requiresCustomizeLayout",
      `Switch to Customize Layout to ${definition.actionLabel}.`,
      requirement,
    );
  }

  const target = requirement.target ?? { kind: "document" };
  const policy = effectiveAuthoringPolicy(document, target);
  if (policy === undefined) {
    return {
      allowed: false,
      code: "targetNotFound",
      reason: "This item is no longer in the document.",
      requirement,
    };
  }

  if (definition.lock === "content" && policy.contentLocked) {
    return denied(
      "contentLocked",
      mode === "weeklyContent"
        ? "This content is protected by the template. Open Customize Layout to change its protection."
        : "This content is protected. Turn off Protect content before editing it.",
      requirement,
      policy.contentLockSource,
    );
  }
  if (definition.lock === "layout" && policy.layoutLocked) {
    return denied(
      "layoutLocked",
      "This layout is protected. Turn off Protect layout before changing it.",
      requirement,
      policy.layoutLockSource,
    );
  }

  return { allowed: true };
}

/** First-denial evaluation used by every command entry point. */
export function checkEditorCapabilities(
  document: CbbDocument,
  mode: EditorMode,
  requirements: readonly CapabilityRequirement[],
): CapabilityDecision {
  for (const requirement of requirements) {
    const decision = checkEditorCapability(document, mode, requirement);
    if (!decision.allowed) return decision;
  }
  return { allowed: true };
}
