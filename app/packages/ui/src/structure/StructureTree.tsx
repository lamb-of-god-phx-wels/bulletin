import {
  Fragment,
  useMemo,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  collectAllNodeIds,
  type CbbDocument,
  type IdPort,
  type NativeElement,
  type NodeId,
  type PageLevelWrapper,
} from "@cbb/core";
import { Button } from "../design-system/index.js";
import { TASK_LANGUAGE } from "../language/index.js";
import { effectiveAuthoringPolicy } from "../store/capabilities.js";
import {
  createAddElementCommand,
  createAddPageElementCommand,
  createAddRightsAttributionCommand,
  createDeleteElementCommand,
  createDuplicateElementCommand,
  createMoveElementCommand,
  createReorderElementCommand,
  createReorderCanvasChildCommand,
  createReorderCanvasReadingCommand,
  createResetCanvasReadingOrderCommand,
  createSetPageElementLayerCommand,
  documentHasActiveRightsAttribution,
  findContainerLocation,
  findElementLocation,
  type ElementLocation,
  type MoveDestination,
} from "../store/commands/index.js";
import type { EditorStore } from "../store/editorStore.js";
import type { EditorCommand, EditorMode } from "../store/types.js";
import { defaultMusicElement } from "../editor/defaultMusicElement.js";
import {
  activeEditorDragSource,
  readEditorDragSource,
  setActiveEditorDragSource,
  writeEditorDragSource,
  type EditorDragSource as DragSource,
  type EditorPaletteKind as PaletteKind,
} from "../editor/editorDrag.js";

type AddPlacement = "before" | "after" | "inside" | "end";

type DropTarget =
  | {
      readonly kind: "body";
      /** Insertion index before the source has been removed. */
      readonly index: number;
      readonly key: string;
      readonly label: string;
    }
  | {
      readonly kind: "container";
      readonly containerId: NodeId;
      /** Stack insertion index before the source has been removed. */
      readonly index?: number;
      readonly key: string;
      readonly label: string;
    };

interface PreparedDrop {
  readonly valid: boolean;
  readonly message: string;
  readonly command?: EditorCommand;
  readonly itemName?: string;
}

interface DropFeedback {
  readonly key: string;
  readonly valid: boolean;
  readonly message: string;
}

export interface StructureTreeProps {
  readonly document: CbbDocument;
  readonly store: EditorStore;
  readonly mode: EditorMode;
  readonly selectedNodeId?: NodeId | undefined;
  readonly idPort: IdPort;
  readonly confirmDelete?: ((name: string, containsChildren: boolean) => boolean) | undefined;
  readonly onAnnouncement?: ((message: string) => void) | undefined;
  /** Opens the application-owned catalog of already validated image assets. */
  readonly onChooseImageAsset?: (() => Promise<string | undefined>) | undefined;
  /** Plain-language reason image insertion is unavailable in this workspace. */
  readonly imageLibraryUnavailableReason?: string | undefined;
}

function mintNodeId(idPort: IdPort, document: CbbDocument): NodeId {
  const used = new Set(collectAllNodeIds(document));
  for (;;) {
    const id = `n${idPort.randomUuid().replaceAll("-", "")}`;
    if (!used.has(id)) return id;
  }
}

function unusedPreviewId(document: CbbDocument, stem: string): NodeId {
  const used = collectAllNodeIds(document);
  let candidate = `n_cbb_${stem}`;
  let suffix = 1;
  while (used.has(candidate)) candidate = `n_cbb_${stem}_${suffix++}`;
  return candidate;
}

function elementTypeName(element: NativeElement): string {
  switch (element.type) {
    case "text": return "Text";
    case "image": return "Image";
    case "date": return "Date";
    case "music": return "Hymn or song";
    case "rightsAttribution": return "Copyrights & Permissions";
    case "grid": return "Grid";
    case "stack": return "Stack";
    case "canvas": return "Canvas";
    case "pageBreak": return "Page break";
    case "customInstance": return TASK_LANGUAGE.savedSection;
  }
}

function ruleStates(document: CbbDocument, nodeId: NodeId): readonly string[] {
  const rules = document.contentRules ?? [];
  const conditional = rules.find((rule) => rule.kind === "conditional" && rule.targetNodeId === nodeId);
  const repeat = rules.find((rule) => rule.kind === "repeat" && rule.prototypeNodeId === nodeId);
  const states: string[] = [];
  if (conditional?.kind === "conditional") {
    if (conditional.scope === "item") {
      states.push("condition evaluated for each repeated item");
    } else {
      const value = document.fieldValues?.[conditional.fieldId]?.value;
      const active = conditional.condition.kind === "booleanEquals"
        ? typeof value === "boolean" ? value === conditional.condition.value : undefined
        : typeof value === "string"
          ? conditional.condition.kind === "choiceEquals"
            ? value === conditional.condition.choiceId
            : value !== conditional.condition.choiceId
          : undefined;
      states.push(active === undefined
        ? "condition needs a weekly value"
        : active ? "used this week" : conditional.inactiveLabel);
    }
  }
  if (repeat?.kind === "repeat") {
    const value = document.fieldValues?.[repeat.fieldId]?.value;
    states.push(Array.isArray(value)
      ? `repeatable section, ${value.length} ${value.length === 1 ? "item" : "items"}`
      : "repeatable section needs a weekly value");
  }
  return states;
}

function pageTargetState(wrapper: PageLevelWrapper): string | undefined {
  switch (wrapper.target.mode) {
    case "all": return "repeats on all pages";
    case "odd": return "repeats on odd pages";
    case "even": return "repeats on even pages";
    case "range": return `repeats on pages ${wrapper.target.start} through ${wrapper.target.end}`;
    case "pages": return `repeats on pages ${wrapper.target.pages.join(", ")}`;
    case "first": return "first page only";
    case "last": return "last page only";
  }
}

function defaultElement(kind: PaletteKind, id: NodeId, imageAssetRef?: string): NativeElement {
  switch (kind) {
    case "text":
      return {
        id,
        type: "text",
        name: "New text",
        data: { content: { kind: "plain", text: "Type here" } },
      };
    case "image":
      if (imageAssetRef === undefined) {
        throw new Error("Choose an installed image before adding it.");
      }
      return {
        id,
        type: "image",
        name: "New image",
        data: {
          assetRef: imageAssetRef,
          fit: "contain",
        },
      };
    case "date": {
      const now = new Date();
      const localDate = [
        String(now.getFullYear()).padStart(4, "0"),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
      ].join("-");
      return {
        id,
        type: "date",
        name: "Service date",
        data: { value: localDate, format: "MMMM D, YYYY" },
      };
    }
    case "music":
      return defaultMusicElement(id);
    case "stack":
      return {
        id,
        type: "stack",
        name: "New section",
        data: { direction: "vertical", gap: "8pt" },
        children: [],
      };
    case "grid":
      return {
        id,
        type: "grid",
        name: "Two-column section",
        data: { rows: 1, columns: 2 },
        children: [],
      };
    case "canvas":
      return { id, type: "canvas", name: "Free layout", children: [] };
    case "pageBreak":
      return { id, type: "pageBreak", name: "Page break", data: { intent: "flowBreak" } };
    case "rightsAttribution":
      return {
        id,
        type: "rightsAttribution",
        name: "Copyrights & Permissions",
        data: {
          heading: "Copyrights & Permissions",
          groupOrder: ["scripture", "music", "other"],
          sortPolicy: "firstAppearance",
          includePublicDomainLines: true,
        },
      };
  }
}

function defaultPageElement(
  purpose: "header" | "footer" | "pageNumber" | "background",
  wrapperId: NodeId,
  elementId: NodeId,
  imageAssetRef?: string,
): PageLevelWrapper {
  if (purpose === "background") {
    if (imageAssetRef === undefined) {
      throw new Error("Choose an installed image before adding a page background.");
    }
    return {
      id: wrapperId,
      purpose,
      target: { mode: "all" },
      layer: "background",
      region: "page",
      anchor: "topLeft",
      x: "0in",
      y: "0in",
      width: "100%",
      height: "100%",
      zIndex: 0,
      clipToRegion: true,
      semantic: { mode: "artifact" },
      element: {
        id: elementId,
        type: "image",
        name: "Page background",
        data: {
          assetRef: imageAssetRef,
          fit: "cover",
          decorative: true,
        },
      },
    };
  }
  const pageNumber = purpose === "pageNumber";
  const footer = purpose === "footer";
  const name = pageNumber ? "Page number" : footer ? "Footer" : "Header";
  return {
    id: wrapperId,
    purpose,
    target: { mode: "all" },
    layer: "overlay",
    region: pageNumber || footer ? "bottomMargin" : "topMargin",
    anchor: pageNumber ? "topCenter" : "topLeft",
    x: pageNumber ? "50%" : "0in",
    y: "0in",
    width: pageNumber ? "auto" : "100%",
    height: "auto",
    zIndex: 0,
    clipToRegion: true,
    semantic: { mode: "artifact" },
    element: {
      id: elementId,
      type: "text",
      name,
      data: { content: { kind: "plain", text: pageNumber ? "1" : name } },
    },
  };
}

function isContainer(element: NativeElement): element is Extract<NativeElement, { type: "grid" | "stack" | "canvas" }> {
  return element.type === "grid" || element.type === "stack" || element.type === "canvas";
}

function elementContainsNode(element: NativeElement, nodeId: NodeId): boolean {
  return element.id === nodeId || (
    isContainer(element) &&
    element.children.some((wrapper) => elementContainsNode(wrapper.element, nodeId))
  );
}

function allContainerIds(elements: readonly NativeElement[]): readonly NodeId[] {
  const ids: NodeId[] = [];
  function visit(element: NativeElement): void {
    if (!isContainer(element)) return;
    ids.push(element.id);
    for (const wrapper of element.children) visit(wrapper.element);
  }
  for (const element of elements) visit(element);
  return ids;
}

function allElementIds(elements: readonly NativeElement[]): readonly NodeId[] {
  const ids: NodeId[] = [];
  function visit(element: NativeElement): void {
    ids.push(element.id);
    if (isContainer(element)) {
      for (const wrapper of element.children) visit(wrapper.element);
    }
  }
  for (const element of elements) visit(element);
  return ids;
}

function orderedChildren(element: Extract<NativeElement, { type: "grid" | "stack" | "canvas" }>) {
  if (element.type === "grid") {
    return [...element.children].sort((left, right) =>
      left.row - right.row || left.column - right.column,
    );
  }
  if (element.type === "stack") {
    return [...element.children].sort((left, right) => left.index - right.index);
  }
  return element.children
    .map((wrapper, sourceIndex) => ({ wrapper, sourceIndex }))
    .sort((left, right) =>
      (left.wrapper.semanticOrder ?? left.sourceIndex) -
      (right.wrapper.semanticOrder ?? right.sourceIndex),
    )
    .map(({ wrapper }) => wrapper);
}

function sourceLocation(document: CbbDocument, source: DragSource): ElementLocation | undefined {
  return source.kind === "node"
    ? findElementLocation(document, source.nodeId)
    : undefined;
}

function sourceIsPageBreak(document: CbbDocument, source: DragSource): boolean {
  if (source.kind === "palette") return source.elementKind === "pageBreak";
  return sourceLocation(document, source)?.element.type === "pageBreak";
}

function wrapperIdNeeded(
  document: CbbDocument,
  source: DragSource,
  target: DropTarget,
): boolean {
  if (target.kind === "body") return false;
  if (source.kind === "palette") return true;
  return sourceLocation(document, source)?.parent.kind === "body";
}

function destinationForTarget(
  document: CbbDocument,
  source: DragSource,
  target: DropTarget,
  wrapperId: NodeId | undefined,
): { readonly destination?: MoveDestination; readonly error?: string } {
  const sourceEntry = sourceLocation(document, source);
  if (source.kind === "node" && sourceEntry === undefined) {
    return { error: "That item is no longer in the document." };
  }
  if (sourceEntry?.parent.kind === "page") {
    return { error: "Page items stay in Page items; change their layer or order instead." };
  }

  if (target.kind === "body") {
    let index = Math.max(0, Math.min(target.index, document.elements.length));
    if (sourceEntry?.parent.kind === "body" && sourceEntry.parent.index < index) index--;
    return { destination: { kind: "body", index } };
  }

  const location = findContainerLocation(document, target.containerId);
  if (location === undefined) return { error: "That section is no longer in the document." };
  if (
    sourceEntry !== undefined &&
    elementContainsNode(sourceEntry.element, target.containerId)
  ) {
    return { error: "An item cannot be moved inside itself." };
  }
  if (sourceIsPageBreak(document, source)) {
    return { error: "Page breaks can only be placed in the top-level document flow." };
  }

  const common = wrapperId === undefined ? {} : { wrapperId };
  if (location.container.type === "stack") {
    let index = Math.max(0, Math.min(
      target.index ?? location.container.children.length,
      location.container.children.length,
    ));
    if (
      sourceEntry?.parent.kind === "stack" &&
      sourceEntry.parent.containerId === location.container.id &&
      sourceEntry.parent.wrapperIndex < index
    ) {
      index--;
    }
    return {
      destination: {
        kind: "stack",
        containerId: location.container.id,
        index,
        ...common,
      },
    };
  }
  if (location.container.type === "canvas") {
    return {
      destination: {
        kind: "canvas",
        containerId: location.container.id,
        x: "0.25in",
        y: "0.25in",
        ...common,
      },
    };
  }

  const reusableWrapperId =
    sourceEntry?.parent.kind === "grid" &&
    sourceEntry.parent.containerId === location.container.id
      ? sourceEntry.parent.wrapper.id
      : undefined;
  for (let row = 0; row < location.container.data.rows; row++) {
    for (let column = 0; column < location.container.data.columns; column++) {
      const occupied = location.container.children.some((child) =>
        child.id !== reusableWrapperId && child.row === row && child.column === column,
      );
      if (!occupied) {
        return {
          destination: {
            kind: "grid",
            containerId: location.container.id,
            row,
            column,
            ...common,
          },
        };
      }
    }
  }
  return { error: "That grid has no empty cell." };
}

function relativeTarget(
  target: ElementLocation,
  placement: "before" | "after",
): DropTarget | undefined {
  if (target.parent.kind === "body") {
    const index = target.parent.index + (placement === "after" ? 1 : 0);
    return {
      kind: "body",
      index,
      key: `relative-body-${index}`,
      label: `${placement === "before" ? "Before" : "After"} ${target.element.name}`,
    };
  }
  if (target.parent.kind === "stack") {
    const index = target.parent.wrapperIndex + (placement === "after" ? 1 : 0);
    return {
      kind: "container",
      containerId: target.parent.containerId,
      index,
      key: `relative-stack-${target.parent.containerId}-${index}`,
      label: `${placement === "before" ? "Before" : "After"} ${target.element.name}`,
    };
  }
  return undefined;
}

function parseDragSource(event: DragEvent<HTMLElement>, fallback: DragSource | undefined): DragSource | undefined {
  return fallback ?? activeEditorDragSource() ?? readEditorDragSource(event.dataTransfer);
}

function DropZone({
  target,
  dragging,
  feedback,
  evaluate,
  onFeedback,
  onDropSource,
  dragSource,
}: {
  readonly target: DropTarget;
  readonly dragging: boolean;
  readonly feedback: DropFeedback | undefined;
  readonly evaluate: (source: DragSource, target: DropTarget) => PreparedDrop;
  readonly onFeedback: (feedback: DropFeedback) => void;
  readonly onDropSource: (source: DragSource, target: DropTarget) => void;
  readonly dragSource: DragSource | undefined;
}) {
  const current = dragSource === undefined ? undefined : evaluate(dragSource, target);
  const active = feedback?.key === target.key;
  const status = active ? feedback : undefined;

  function update(event: DragEvent<HTMLLIElement>): DragSource | undefined {
    const source = parseDragSource(event, dragSource);
    if (source === undefined) return undefined;
    event.preventDefault();
    event.stopPropagation();
    const result = evaluate(source, target);
    event.dataTransfer.dropEffect = result.valid
      ? source.kind === "palette" ? "copy" : "move"
      : "none";
    onFeedback({ key: target.key, valid: result.valid, message: result.message });
    return source;
  }

  return (
    <li
      role="treeitem"
      aria-hidden={!dragging}
      className={[
        "cbb-tree-drop-zone",
        dragging ? "is-dragging" : "",
        dragging && current?.valid === true ? "is-available" : "",
        dragging && current?.valid === false ? "is-unavailable" : "",
        active && status?.valid === true ? "is-valid" : "",
        active && status?.valid === false ? "is-invalid" : "",
      ].filter(Boolean).join(" ")}
      data-drop-status={active ? status?.valid === true ? "valid" : "invalid" : "idle"}
      data-drop-valid={dragging && current !== undefined ? String(current.valid) : undefined}
      aria-label={target.label}
      onDragEnter={update}
      onDragOver={update}
      onDrop={(event) => {
        const source = update(event);
        if (source !== undefined) onDropSource(source, target);
      }}
    >
      <span aria-hidden={!active}>
        {active ? status?.message : current?.valid === false ? "" : target.label}
      </span>
    </li>
  );
}

function TreeElement({
  element,
  level,
  props,
  expanded,
  toggle,
  pageWrapper,
  placementWrapperId,
  dragSource,
  onDragStart,
  onDragEnd,
  renderDropZone,
}: {
  readonly element: NativeElement;
  readonly level: number;
  readonly props: StructureTreeProps;
  readonly expanded: ReadonlySet<NodeId>;
  readonly toggle: (nodeId: NodeId) => void;
  readonly pageWrapper?: PageLevelWrapper | undefined;
  readonly placementWrapperId?: NodeId | undefined;
  readonly dragSource: DragSource | undefined;
  readonly onDragStart: (event: DragEvent<HTMLElement>, source: DragSource) => void;
  readonly onDragEnd: () => void;
  readonly renderDropZone: (target: DropTarget) => ReactNode;
}) {
  const container = isContainer(element);
  const open = expanded.has(element.id);
  const effectivePlacementId = placementWrapperId ?? pageWrapper?.id;
  const selected = props.selectedNodeId === element.id;
  const placementSelected = effectivePlacementId !== undefined && props.selectedNodeId === effectivePlacementId;
  const dragging = dragSource?.kind === "node" && dragSource.nodeId === element.id;
  const policy = effectiveAuthoringPolicy(props.document, {
    kind: "node",
    nodeId: element.id,
  });
  const states = [
    policy?.contentLocked === true ? "content protected" : undefined,
    policy?.layoutLocked === true ? "layout protected" : undefined,
    pageWrapper === undefined ? undefined : `${pageWrapper.layer} layer`,
    pageWrapper?.semantic.mode === "artifact" ? "decorative — skipped in reading order" : undefined,
    pageWrapper === undefined ? undefined : pageTargetState(pageWrapper),
    pageWrapper?.clipToRegion === true ? `clipped to ${pageWrapper.region} region` : undefined,
    ...ruleStates(props.document, element.id),
  ].filter((value): value is string => value !== undefined);
  const canDrag = props.mode === "customizeLayout" && pageWrapper === undefined;
  const children = container ? orderedChildren(element) : [];

  return (
    <li
      role="none"
    >
      <div className={`cbb-tree-row${selected || placementSelected ? " is-selected" : ""}${effectivePlacementId === undefined ? "" : " has-placement"}${dragging ? " is-drag-source" : ""}`}>
        {container
          ? (
            <button
              type="button"
              className="cbb-tree-toggle"
              aria-label={`${open ? "Collapse" : "Expand"} ${element.name}`}
              onClick={() => toggle(element.id)}
            >
              <span aria-hidden="true">{open ? "▾" : "▸"}</span>
            </button>
          )
          : <span className="cbb-tree-toggle" aria-hidden="true" />}
        <button
          type="button"
          className="cbb-tree-select"
          role="treeitem"
          aria-level={level}
          aria-selected={selected || placementSelected}
          {...(container ? { "aria-expanded": open } : {})}
          data-tree-node-id={element.id}
          data-tree-container={container ? "true" : "false"}
          tabIndex={selected || placementSelected ? 0 : -1}
          draggable={canDrag}
          title={canDrag ? `Drag to move ${element.name}` : undefined}
          onDragStart={(event) => onDragStart(event, { kind: "node", nodeId: element.id })}
          onDragEnd={onDragEnd}
          onClick={() => props.store.setSelection({ kind: "node", nodeId: element.id, surface: "structure" })}
        >
          <span>{element.name}</span>
          <small>{elementTypeName(element)}{states.length === 0 ? "" : ` — ${states.join(", ")}`}</small>
        </button>
        {effectivePlacementId === undefined
          ? null
          : (
            <button
              type="button"
              className="cbb-tree-placement"
              aria-label={`Select placement for ${element.name}`}
              aria-pressed={placementSelected}
              title="Select placement settings for position, size, and layout protection"
              onClick={() => props.store.setSelection({
                kind: "node",
                nodeId: effectivePlacementId,
                surface: "structure",
              })}
            >
              <span aria-hidden="true">⌖</span>
            </button>
          )}
      </div>
      {container && open
        ? (
          <ul role="group">
            {element.type === "stack"
              ? (
                <>
                  {children.map((wrapper, index) => (
                    <Fragment key={wrapper.id}>
                      {renderDropZone({
                        kind: "container",
                        containerId: element.id,
                        index,
                        key: `stack-${element.id}-${index}`,
                        label: `Drop at position ${index + 1} in ${element.name}`,
                      })}
                      <TreeElement
                        element={wrapper.element}
                        level={level + 1}
                        props={props}
                        expanded={expanded}
                        toggle={toggle}
                        dragSource={dragSource}
                        onDragStart={onDragStart}
                        onDragEnd={onDragEnd}
                        renderDropZone={renderDropZone}
                        placementWrapperId={wrapper.id}
                      />
                    </Fragment>
                  ))}
                  {renderDropZone({
                    kind: "container",
                    containerId: element.id,
                    index: children.length,
                    key: `stack-${element.id}-${children.length}`,
                    label: children.length === 0
                      ? `Drop inside ${element.name}`
                      : `Drop at end of ${element.name}`,
                  })}
                </>
              )
              : (
                <>
                  {renderDropZone({
                    kind: "container",
                    containerId: element.id,
                    key: `${element.type}-${element.id}`,
                    label: element.type === "grid"
                      ? `Drop in first empty cell of ${element.name}`
                      : `Drop inside ${element.name}`,
                  })}
                  {children.map((wrapper) => (
                    <TreeElement
                      key={wrapper.id}
                      element={wrapper.element}
                      level={level + 1}
                      props={props}
                      expanded={expanded}
                      toggle={toggle}
                      dragSource={dragSource}
                      onDragStart={onDragStart}
                      onDragEnd={onDragEnd}
                      renderDropZone={renderDropZone}
                      placementWrapperId={wrapper.id}
                    />
                  ))}
                </>
              )}
          </ul>
        )
        : null}
    </li>
  );
}

export function StructureTree(props: StructureTreeProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<NodeId>>(
    () => new Set(allContainerIds([
      ...props.document.elements,
      ...(props.document.pageElements ?? []).map((wrapper) => wrapper.element),
    ])),
  );
  const [moveTarget, setMoveTarget] = useState("");
  const [relativeMoveTarget, setRelativeMoveTarget] = useState("");
  const [addPlacement, setAddPlacement] = useState<AddPlacement>("after");
  const [dragSource, setDragSource] = useState<DragSource>();
  const [dropFeedback, setDropFeedback] = useState<DropFeedback>();

  const containers = useMemo(
    () => allContainerIds([
      ...props.document.elements,
      ...(props.document.pageElements ?? []).map((wrapper) => wrapper.element),
    ]),
    [props.document],
  );
  const selected = props.selectedNodeId === undefined
    ? undefined
    : findElementLocation(props.document, props.selectedNodeId);

  function announce(message: string): void {
    props.onAnnouncement?.(message);
  }

  function execute(command: EditorCommand, success: string): boolean {
    try {
      const result = props.store.execute(command);
      if (result.status === "denied") {
        announce(result.denial.reason);
        return false;
      }
      announce(result.status === "noChange" ? "That item is already there." : success);
      return true;
    } catch (error) {
      announce(error instanceof Error ? error.message : "That change could not be completed.");
      return false;
    }
  }

  function prepareDrop(
    source: DragSource,
    target: DropTarget,
    actualIds: boolean,
    imageAssetRef?: string,
  ): PreparedDrop {
    try {
      const element = source.kind === "palette"
        ? defaultElement(
            source.elementKind,
            actualIds
              ? mintNodeId(props.idPort, props.document)
              : unusedPreviewId(props.document, "drag_element"),
            imageAssetRef,
          )
        : sourceLocation(props.document, source)?.element;
      if (element === undefined) {
        return { valid: false, message: "That item is no longer in the document." };
      }
      const wrapperId = wrapperIdNeeded(props.document, source, target)
        ? actualIds
          ? mintNodeId(props.idPort, props.document)
          : unusedPreviewId(props.document, "drag_wrapper")
        : undefined;
      const resolved = destinationForTarget(
        props.document,
        source,
        target,
        wrapperId,
      );
      if (resolved.destination === undefined) {
        return { valid: false, message: resolved.error ?? "That drop target is not available." };
      }
      const command = source.kind === "palette"
        ? element.type === "rightsAttribution"
          ? createAddRightsAttributionCommand({
              nodeId: element.id,
              destination: resolved.destination,
              groupOrder: element.data.groupOrder,
              ...(element.data.heading === undefined ? {} : { heading: element.data.heading }),
              ...(element.data.includePublicDomainLines === undefined
                ? {}
                : { includePublicDomainLines: element.data.includePublicDomainLines }),
            })
          : createAddElementCommand({ element, destination: resolved.destination })
        : createMoveElementCommand({ nodeId: source.nodeId, destination: resolved.destination });
      const decision = props.store.canExecute(command);
      if (!decision.allowed) return { valid: false, message: decision.reason };

      // Command patch creation is pure. Running it here makes hover feedback use
      // exactly the same source x target vocabulary as the eventual drop.
      const context = {
        document: props.document,
        mode: props.mode,
        selection: props.store.getSnapshot().selection,
      } as const;
      if (typeof command.createPatches === "function") command.createPatches(context);

      return {
        valid: true,
        message: target.label,
        command,
        itemName: element.name,
      };
    } catch (error) {
      return {
        valid: false,
        message: error instanceof Error ? error.message : "That item cannot be dropped there.",
      };
    }
  }

  function performDrop(source: DragSource, target: DropTarget, imageAssetRef?: string): void {
    const preview = prepareDrop(source, target, false, imageAssetRef);
    if (!preview.valid) {
      announce(preview.message);
      setDragSource(undefined);
      setDropFeedback(undefined);
      setActiveEditorDragSource(undefined);
      return;
    }
    const prepared = prepareDrop(source, target, true, imageAssetRef);
    if (prepared.command !== undefined && prepared.itemName !== undefined) {
      const applied = execute(
        prepared.command,
        source.kind === "palette"
          ? `${prepared.itemName} added`
          : `${prepared.itemName} moved`,
      );
      if (applied && target.kind === "container") {
        setExpanded((current) => new Set([...current, target.containerId]));
      }
    } else {
      announce(prepared.message);
    }
    setDragSource(undefined);
    setDropFeedback(undefined);
    setActiveEditorDragSource(undefined);
  }

  function startDrag(event: DragEvent<HTMLElement>, source: DragSource): void {
    writeEditorDragSource(event.dataTransfer, source);
    setDragSource(source);
    setDropFeedback(undefined);
    announce(
      source.kind === "palette"
        ? `${source.elementKind === "pageBreak"
          ? "Page break"
          : source.elementKind === "music"
            ? "Hymn/Song"
            : source.elementKind} picked up. Choose a highlighted destination.`
        : "Item picked up. Choose a highlighted destination.",
    );
  }

  function finishDrag(): void {
    setDragSource(undefined);
    setDropFeedback(undefined);
    setActiveEditorDragSource(undefined);
  }

  const toggle = (nodeId: NodeId): void => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId);
    return next;
  });

  function treeKeyDown(event: KeyboardEvent<HTMLUListElement>): void {
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tree = event.currentTarget;
    const items = [...tree.querySelectorAll<HTMLElement>("[role='treeitem'][data-tree-node-id]")].filter(
      (item) => item.closest("[role='tree']") === tree,
    );
    if (items.length === 0) return;
    const target = event.target instanceof HTMLElement
      ? event.target.closest<HTMLElement>("[role='treeitem']")
      : null;
    if (target === null && event.target !== tree) return;
    let index = target === null ? -1 : items.indexOf(target);
    const focus = (candidate: HTMLElement | undefined): void => {
      if (candidate === undefined) return;
      event.preventDefault();
      candidate.focus();
    };
    if (event.key === "Home") return focus(items[0]);
    if (event.key === "End") return focus(items.at(-1));
    if (event.key === "ArrowDown") return focus(items[Math.min(items.length - 1, index + 1)]);
    if (event.key === "ArrowUp") return focus(items[Math.max(0, index - 1)]);
    if (target === null) return focus(items[0]);
    const level = Number(target.getAttribute("aria-level") ?? "1");
    const nodeId = target.dataset.treeNodeId;
    const isContainer = target.dataset.treeContainer === "true";
    const open = target.getAttribute("aria-expanded") === "true";
    if (event.key === "ArrowRight") {
      if (isContainer && !open && nodeId !== undefined) {
        event.preventDefault();
        toggle(nodeId);
        return;
      }
      const next = items[index + 1];
      if (open && next !== undefined && Number(next.getAttribute("aria-level") ?? "1") > level) focus(next);
      return;
    }
    if (event.key === "ArrowLeft") {
      if (isContainer && open && nodeId !== undefined) {
        event.preventDefault();
        toggle(nodeId);
        return;
      }
      while (--index >= 0) {
        const prior = items[index];
        if (prior !== undefined && Number(prior.getAttribute("aria-level") ?? "1") < level) {
          focus(prior);
          return;
        }
      }
    }
  }

  const renderDropZone = (target: DropTarget): ReactNode => (
    <DropZone
      key={target.key}
      target={target}
      dragging={dragSource !== undefined}
      feedback={dropFeedback}
      evaluate={(source, destination) => prepareDrop(source, destination, false)}
      onFeedback={setDropFeedback}
      onDropSource={performDrop}
      dragSource={dragSource}
    />
  );

  const availableAddPlacements: readonly AddPlacement[] = [
    ...(selected?.parent.kind === "body" || selected?.parent.kind === "stack"
      ? ["before", "after"] as const
      : []),
    ...(selected !== undefined && isContainer(selected.element)
      ? ["inside"] as const
      : []),
    "end",
  ];
  const effectiveAddPlacement = availableAddPlacements.includes(addPlacement)
    ? addPlacement
    : availableAddPlacements[0] ?? "end";

  function targetForAdd(kind: PaletteKind, placement: AddPlacement): DropTarget {
    if (kind !== "pageBreak" && placement === "inside" && selected !== undefined && isContainer(selected.element)) {
      return {
        kind: "container",
        containerId: selected.element.id,
        ...(selected.element.type === "stack" ? { index: selected.element.children.length } : {}),
        key: `add-inside-${selected.element.id}`,
        label: `Add inside ${selected.element.name}`,
      };
    }
    if ((placement === "before" || placement === "after") && selected !== undefined) {
      const relative = relativeTarget(selected, placement);
      if (relative !== undefined && (kind !== "pageBreak" || relative.kind === "body")) return relative;
    }
    return {
      kind: "body",
      index: props.document.elements.length,
      key: "add-end",
      label: "Add at end of document",
    };
  }

  async function add(kind: PaletteKind): Promise<void> {
    const imageAssetRef = kind === "image"
      ? await props.onChooseImageAsset?.()
      : undefined;
    if (kind === "image" && imageAssetRef === undefined) {
      announce(props.onChooseImageAsset === undefined
        ? "The validated image library is unavailable in this window."
        : "No image was added.");
      return;
    }
    performDrop(
      { kind: "palette", elementKind: kind },
      targetForAdd(kind, effectiveAddPlacement),
      imageAssetRef,
    );
  }

  async function addPageElement(purpose: "header" | "footer" | "pageNumber" | "background"): Promise<void> {
    const imageAssetRef = purpose === "background"
      ? await props.onChooseImageAsset?.()
      : undefined;
    if (purpose === "background" && imageAssetRef === undefined) {
      announce(props.onChooseImageAsset === undefined
        ? "The validated image library is unavailable in this window."
        : "No page background was added.");
      return;
    }
    const wrapper = defaultPageElement(
      purpose,
      mintNodeId(props.idPort, props.document),
      mintNodeId(props.idPort, props.document),
      imageAssetRef,
    );
    execute(createAddPageElementCommand({ wrapper }), `${wrapper.element.name} added`);
  }

  function deleteSelected(): void {
    if (selected === undefined) return;
    const hasChildren = isContainer(selected.element) && selected.element.children.length > 0;
    const allowed = props.confirmDelete?.(selected.element.name, hasChildren) ??
      window.confirm(
        hasChildren
          ? `Delete “${selected.element.name}” and everything inside it?`
          : `Delete “${selected.element.name}”?`,
      );
    if (!allowed) return;
    execute(createDeleteElementCommand(selected.element.id), `${selected.element.name} deleted`);
  }

  function moveOut(): void {
    if (selected === undefined || selected.parent.kind === "body" || selected.parent.kind === "page") return;
    const rootMatch = /^\/elements\/(\d+)/u.exec(selected.elementPath);
    const rootIndex = rootMatch?.[1] === undefined
      ? props.document.elements.length
      : Number.parseInt(rootMatch[1], 10) + 1;
    execute(
      createMoveElementCommand({
        nodeId: selected.element.id,
        destination: { kind: "body", index: rootIndex },
      }),
      `${selected.element.name} moved out`,
    );
  }

  const validContainers = selected === undefined
    ? containers
    : containers.filter((id) => {
        const target: DropTarget = {
          kind: "container",
          containerId: id,
          key: `move-into-${id}`,
          label: `Move into ${findContainerLocation(props.document, id)?.container.name ?? id}`,
        };
        return prepareDrop({ kind: "node", nodeId: selected.element.id }, target, false).valid;
      });

  const relativeTargets = selected === undefined || selected.parent.kind === "page"
    ? []
    : allElementIds(props.document.elements)
        .filter((id) => id !== selected.element.id && !elementContainsNode(selected.element, id))
        .map((id) => findElementLocation(props.document, id))
        .filter((location): location is ElementLocation =>
          location !== undefined &&
          (location.parent.kind === "body" || location.parent.kind === "stack") &&
          (selected.element.type !== "pageBreak" || location.parent.kind === "body"),
        );

  function moveRelative(placement: "before" | "after"): void {
    if (selected === undefined || relativeMoveTarget.length === 0) return;
    const targetLocation = findElementLocation(props.document, relativeMoveTarget);
    const target = targetLocation === undefined
      ? undefined
      : relativeTarget(targetLocation, placement);
    if (target === undefined) {
      announce("That destination is no longer available.");
      return;
    }
    const prepared = prepareDrop({ kind: "node", nodeId: selected.element.id }, target, true);
    if (prepared.command === undefined) {
      announce(prepared.message);
      return;
    }
    execute(prepared.command, `${selected.element.name} moved`);
  }

  const canReorder = selected?.parent.kind === "body" ||
    selected?.parent.kind === "page" || selected?.parent.kind === "stack";
  const customize = props.mode === "customizeLayout";
  const imageUnavailableReason = props.imageLibraryUnavailableReason ??
    (props.onChooseImageAsset === undefined
      ? "The validated image library is unavailable in this window."
      : undefined);
  const hasRightsAttribution = documentHasActiveRightsAttribution(props.document);

  return (
    <aside
      className={`cbb-structure-panel${dragSource === undefined ? "" : " is-dragging"}`}
      aria-label="Structure and layers"
      onDragEnd={finishDrag}
    >
      <header>
        <h2>Structure</h2>
        <p>Document order and page layers</p>
      </header>
      {customize
        ? (
          <div className="cbb-palette" role="group" aria-label="Add an item">
            <span>Add</span>
            <label htmlFor="cbb-add-placement">Placement</label>
            <select
              id="cbb-add-placement"
              aria-label="Add placement"
              value={effectiveAddPlacement}
              onChange={(event) => setAddPlacement(event.currentTarget.value as AddPlacement)}
            >
              {availableAddPlacements.includes("before") ? <option value="before">Before selection</option> : null}
              {availableAddPlacements.includes("after") ? <option value="after">After selection</option> : null}
              {availableAddPlacements.includes("inside") ? <option value="inside">Inside selected section</option> : null}
              <option value="end">End of document</option>
            </select>
            {([
              ["text", "Text"],
              ["image", "Image"],
              ["date", "Date"],
              ["music", "Hymn/Song"],
              ["stack", "Section"],
              ["grid", "Columns"],
              ["canvas", "Free layout"],
              ["pageBreak", "Page break"],
              ["rightsAttribution", "Copyrights & Permissions"],
            ] as const).map(([kind, label]) => (
              <Button
                key={kind}
                disabled={(kind === "image" && imageUnavailableReason !== undefined) ||
                  (kind === "rightsAttribution" && hasRightsAttribution)}
                aria-describedby={kind === "image" && imageUnavailableReason !== undefined
                  ? "cbb-image-library-unavailable"
                  : undefined}
                draggable={kind !== "image" && !(kind === "rightsAttribution" && hasRightsAttribution)}
                className={dragSource?.kind === "palette" && dragSource.elementKind === kind ? "is-drag-source" : undefined}
                title={kind === "image"
                  ? imageUnavailableReason ?? "Choose a validated image, then add it at the selected placement"
                  : kind === "rightsAttribution" && hasRightsAttribution
                    ? "This bulletin already has Copyrights & Permissions. Select it in Structure to move or edit it."
                  : `Click to add or drag ${label.toLowerCase()} to a destination`}
                onDragStart={kind === "image"
                  ? undefined
                  : (event) => startDrag(event, { kind: "palette", elementKind: kind })}
                onDragEnd={finishDrag}
                onClick={() => { void add(kind); }}
              >
                {label}
              </Button>
            ))}
            {imageUnavailableReason === undefined ? null : (
              <p id="cbb-image-library-unavailable" className="cbb-panel-note">
                Images: {imageUnavailableReason}
              </p>
            )}
            <span>Add to pages</span>
            {([
              ["header", "Header"],
              ["footer", "Footer"],
              ["pageNumber", "Page number"],
              ["background", "Background"],
            ] as const).map(([purpose, label]) => (
              <Button
                key={purpose}
                disabled={purpose === "background" && imageUnavailableReason !== undefined}
                aria-describedby={purpose === "background" && imageUnavailableReason !== undefined
                  ? "cbb-image-library-unavailable"
                  : undefined}
                title={purpose === "background" ? imageUnavailableReason : undefined}
                onClick={() => { void addPageElement(purpose); }}
              >{label}</Button>
            ))}
          </div>
        )
        : <p className="cbb-panel-note">Switch to Customize Layout to add or rearrange items.</p>}

      {dragSource === undefined || dropFeedback === undefined
        ? null
        : (
          <p
            className={`cbb-drag-status ${dropFeedback.valid ? "is-valid" : "is-invalid"}`}
            role="status"
          >
            {dropFeedback.valid ? "Drop: " : "Cannot drop: "}{dropFeedback.message}
          </p>
        )}

      <ul
        role="tree"
        aria-label="Bulletin structure"
        className="cbb-structure-tree"
        tabIndex={0}
        onKeyDown={treeKeyDown}
      >
        {renderDropZone({
          kind: "body",
          index: 0,
          key: "body-0",
          label: props.document.elements.length === 0 ? "Drop in empty document" : "Drop at start of document",
        })}
        {props.document.elements.map((element, index) => (
          <Fragment key={element.id}>
            <TreeElement
              element={element}
              level={1}
              props={props}
              expanded={expanded}
              toggle={toggle}
              dragSource={dragSource}
              onDragStart={startDrag}
              onDragEnd={finishDrag}
              renderDropZone={renderDropZone}
            />
            {renderDropZone({
              kind: "body",
              index: index + 1,
              key: `body-${index + 1}`,
              label: index === props.document.elements.length - 1
                ? "Drop at end of document"
                : `Drop after ${element.name}`,
            })}
          </Fragment>
        ))}
      </ul>

      {(props.document.pageElements ?? []).length === 0
        ? null
        : (
          <section className="cbb-layer-tree" aria-labelledby="cbb-page-layers-title">
            <h3 id="cbb-page-layers-title">Page items</h3>
            {(["background", "underlay", "overlay"] as const).map((layer) => {
              const wrappers = (props.document.pageElements ?? []).filter((wrapper) => wrapper.layer === layer);
              return wrappers.length === 0
                ? null
                : (
                  <section key={layer} className="cbb-layer-group" aria-labelledby={`cbb-layer-${layer}`}>
                    <h4 id={`cbb-layer-${layer}`}>{layer[0]?.toUpperCase()}{layer.slice(1)}</h4>
                    <ul
                      role="tree"
                      aria-label={`${layer} page layer`}
                      className="cbb-structure-tree"
                      tabIndex={0}
                      onKeyDown={treeKeyDown}
                    >
                      {wrappers.map((wrapper) => (
                        <TreeElement
                          key={wrapper.id}
                          element={wrapper.element}
                          level={1}
                          props={props}
                          expanded={expanded}
                          toggle={toggle}
                          dragSource={dragSource}
                          onDragStart={startDrag}
                          onDragEnd={finishDrag}
                          renderDropZone={renderDropZone}
                          pageWrapper={wrapper}
                          placementWrapperId={wrapper.id}
                        />
                      ))}
                    </ul>
                  </section>
                );
            })}
          </section>
        )}

      {selected === undefined || !customize
        ? null
        : (
          <div className="cbb-structure-actions" role="group" aria-label={`Actions for ${selected.element.name}`}>
            {canReorder
              ? <Button onClick={() => execute(createReorderElementCommand({ nodeId: selected.element.id, direction: "before" }), `${selected.element.name} moved earlier`)}>Move earlier</Button>
              : null}
            {canReorder
              ? <Button onClick={() => execute(createReorderElementCommand({ nodeId: selected.element.id, direction: "after" }), `${selected.element.name} moved later`)}>Move later</Button>
              : null}
            {selected.parent.kind === "canvas"
              ? <Button onClick={() => execute(createReorderCanvasChildCommand({ nodeId: selected.element.id, direction: "backward" }), `${selected.element.name} sent backward`)}>Send backward</Button>
              : null}
            {selected.parent.kind === "canvas"
              ? <Button onClick={() => execute(createReorderCanvasChildCommand({ nodeId: selected.element.id, direction: "forward" }), `${selected.element.name} brought forward`)}>Bring forward</Button>
              : null}
            {selected.parent.kind === "canvas"
              ? <Button onClick={() => execute(createReorderCanvasReadingCommand({ nodeId: selected.element.id, direction: "earlier" }), `${selected.element.name} will be read earlier`)}>Read earlier</Button>
              : null}
            {selected.parent.kind === "canvas"
              ? <Button onClick={() => execute(createReorderCanvasReadingCommand({ nodeId: selected.element.id, direction: "later" }), `${selected.element.name} will be read later`)}>Read later</Button>
              : null}
            {selected.element.type === "canvas"
              ? <Button onClick={() => execute(createResetCanvasReadingOrderCommand(selected.element.id), "Canvas reading order now follows paint order")}>Use paint order for reading</Button>
              : null}
            <Button onClick={() => execute(createDuplicateElementCommand({ nodeId: selected.element.id, idPort: props.idPort }), `${selected.element.name} duplicated`)}>
              Duplicate
            </Button>
            {selected.parent.kind === "body" || selected.parent.kind === "page"
              ? null
              : <Button onClick={moveOut}>Move out of section</Button>}

            {relativeTargets.length === 0
              ? null
              : (
                <div className="cbb-move-relative">
                  <label htmlFor="cbb-relative-move-target">Move next to</label>
                  <select
                    id="cbb-relative-move-target"
                    value={relativeMoveTarget}
                    onChange={(event) => setRelativeMoveTarget(event.currentTarget.value)}
                  >
                    <option value="">Choose an item</option>
                    {relativeTargets.map((location) => (
                      <option key={location.element.id} value={location.element.id}>
                        {location.element.name} ({elementTypeName(location.element)})
                      </option>
                    ))}
                  </select>
                  <Button disabled={relativeMoveTarget.length === 0} onClick={() => moveRelative("before")}>Move before</Button>
                  <Button disabled={relativeMoveTarget.length === 0} onClick={() => moveRelative("after")}>Move after</Button>
                </div>
              )}

            {selected.parent.kind === "page" || validContainers.length === 0
              ? null
              : (
                <div className="cbb-move-into">
                  <label htmlFor="cbb-move-target">Move into</label>
                  <select id="cbb-move-target" value={moveTarget} onChange={(event) => setMoveTarget(event.currentTarget.value)}>
                    <option value="">Choose a section</option>
                    {validContainers.map((id) => (
                      <option key={id} value={id}>{findContainerLocation(props.document, id)?.container.name ?? id}</option>
                    ))}
                  </select>
                  <Button
                    disabled={moveTarget.length === 0}
                    onClick={() => {
                      const target: DropTarget = {
                        kind: "container",
                        containerId: moveTarget,
                        key: `move-into-${moveTarget}`,
                        label: `Move into ${findContainerLocation(props.document, moveTarget)?.container.name ?? "section"}`,
                      };
                      const prepared = prepareDrop({ kind: "node", nodeId: selected.element.id }, target, true);
                      if (prepared.command !== undefined) {
                        if (execute(prepared.command, `${selected.element.name} moved`)) {
                          setExpanded((current) => new Set([...current, moveTarget]));
                        }
                      } else {
                        announce(prepared.message);
                      }
                    }}
                  >
                    Move
                  </Button>
                </div>
              )}
            {selected.parent.kind === "page" && selected.parent.wrapper.purpose === "decoration"
              ? (
                <div className="cbb-move-into">
                  <label htmlFor="cbb-page-layer">Page layer</label>
                  <select
                    id="cbb-page-layer"
                    value={selected.parent.wrapper.layer}
                    onChange={(event) => execute(createSetPageElementLayerCommand({
                      nodeId: selected.element.id,
                      layer: event.currentTarget.value as "background" | "underlay" | "overlay",
                    }), `${selected.element.name} layer changed`)}
                  >
                    <option value="background">Background</option>
                    <option value="underlay">Under body content</option>
                    <option value="overlay">Over body content</option>
                  </select>
                </div>
              )
              : selected.parent.kind === "page"
                ? <p className="cbb-readonly-placement">Page layer: {selected.parent.wrapper.layer}. This layer is set by its {selected.parent.wrapper.purpose} purpose.</p>
                : null}
            <Button variant="danger" onClick={deleteSelected}>Delete</Button>
          </div>
        )}
    </aside>
  );
}
