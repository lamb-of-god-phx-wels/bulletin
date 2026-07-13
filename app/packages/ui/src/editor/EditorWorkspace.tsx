import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import type { CbbDocument, IdPort, NodeId, TextContent } from "@cbb/core";
import { Button, LiveRegion } from "../design-system/index.js";
import {
  InspectorPanel,
  type InspectorAssetInfo,
  type InspectorEditBufferUpdate,
  type InspectorRestoredEditBuffer,
} from "../inspector/index.js";
import {
  createMoveCanvasChildCommand,
  createDeleteElementCommand,
  findContainerLocation,
  findElementLocation,
  findPlacementWrapperLocation,
} from "../store/commands/index.js";
import type { EditorStore } from "../store/editorStore.js";
import type { EditorMode } from "../store/types.js";
import { StructureTree } from "../structure/index.js";
import { TemplateAuthoringPanel } from "../template-authoring/index.js";
import { ContiguousView, PageView, type EditorViewMode } from "./EditorViews.js";
import { FindReplacePanel } from "./FindReplacePanel.js";
import {
  editorPixelsToInches,
  persistedLengthToEditorPixels,
  snapEditorPixels,
} from "./interactions.js";
import { editorPageMetrics, type EditorMeasurementMap } from "./pagination.js";
import "./editor.css";

export interface EditorWorkspaceProps {
  readonly store: EditorStore;
  readonly idPort: IdPort;
  readonly readOnly?: boolean | undefined;
  readonly initialView?: EditorViewMode | undefined;
  readonly initialPagePresentation?: "single" | "facing" | undefined;
  readonly initialZoom?: number | "fit" | undefined;
  readonly initialMarginGuides?: boolean | undefined;
  readonly initialSnapping?: boolean | undefined;
  readonly initialReadingOrderOverlay?: boolean | undefined;
  readonly snapSizePx?: number | undefined;
  readonly measurements?: EditorMeasurementMap | undefined;
  readonly assetUrl?: ((assetRef: string) => string | undefined) | undefined;
  readonly fontFamily?: ((fontRef: string) => string | undefined) | undefined;
  readonly assetInfo?: ((assetRef: string) => InspectorAssetInfo | undefined) | undefined;
  readonly restoredEditBuffers?: Readonly<Record<string, string | InspectorRestoredEditBuffer>> | undefined;
  readonly documentRevisionToken?: string | null | undefined;
  readonly onEditBufferChange?: ((update: InspectorEditBufferUpdate) => void) | undefined;
  readonly onRequestImageReplacement?: ((nodeId: NodeId, currentAssetRef: string) => void) | undefined;
  readonly onChooseImageAsset?: (() => Promise<string | undefined>) | undefined;
  readonly imageLibraryUnavailableReason?: string | undefined;
  readonly onInsertScripture?: ((nodeId: NodeId, content: TextContent) => void) | undefined;
  readonly spellcheckEnabled?: boolean | undefined;
  readonly spellingDictionary?: readonly string[] | undefined;
  readonly onAddSpellingDictionaryWord?: ((word: string) => Promise<string>) | undefined;
  readonly confirmEnterCustomize?: (() => boolean) | undefined;
  readonly confirmDelete?: ((name: string, containsChildren: boolean) => boolean) | undefined;
  readonly onViewStateChange?: ((state: EditorWorkspaceViewState) => void) | undefined;
  readonly confirmTemplateAction?: ((message: string) => boolean) | undefined;
  readonly onSaveAsTemplate?: ((document: CbbDocument) => void) | undefined;
  readonly onDuplicateTemplate?: ((document: CbbDocument) => void) | undefined;
  readonly onTestWeeklyWorkflow?: ((document: CbbDocument) => void) | undefined;
  readonly onOpenSourceTemplate?: (() => void) | undefined;
  readonly onChangeOnlyThisBulletin?: (() => void) | undefined;
  readonly onUpdateTemplateForFutureBulletins?: ((document: CbbDocument) => void) | undefined;
}

export interface EditorWorkspaceViewState {
  readonly view: EditorViewMode;
  readonly pagePresentation: "single" | "facing";
  readonly zoom: number;
  readonly marginGuides: boolean;
  readonly snapping: boolean;
  readonly readingOrderOverlay: boolean;
}

function interactiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest(
    "input, textarea, select, button, a, summary, [contenteditable='true'], [role='button'], [role='tab']",
  ) !== null;
}

function containsChildren(document: ReturnType<EditorStore["getSnapshot"]>["document"], nodeId: NodeId): boolean {
  const element = findElementLocation(document, nodeId)?.element;
  return element !== undefined &&
    (element.type === "grid" || element.type === "stack" || element.type === "canvas") &&
    element.children.length > 0;
}

function selectionCycleCandidates(
  document: ReturnType<EditorStore["getSnapshot"]>["document"],
  selectedNodeId: NodeId | undefined,
): readonly NodeId[] {
  if (selectedNodeId === undefined) return [];
  const placement = findPlacementWrapperLocation(document, selectedNodeId);
  const location = placement === undefined
    ? findElementLocation(document, selectedNodeId)
    : findElementLocation(document, placement.wrapper.element.id);
  const parent = placement ?? (location === undefined || location.parent.kind === "body"
    ? undefined
    : {
        kind: location.parent.kind,
        wrapper: location.parent.wrapper,
        ...(location.parent.kind === "page" ? {} : { containerId: location.parent.containerId }),
      });
  if (parent?.kind === "page") {
    return (document.pageElements ?? []).flatMap((wrapper) => [wrapper.id, wrapper.element.id]);
  }
  if (parent?.kind === "canvas") {
    const container = parent.containerId === undefined
      ? undefined
      : findContainerLocation(document, parent.containerId)?.container;
    return container?.type === "canvas"
      ? container.children.flatMap((wrapper) => [wrapper.id, wrapper.element.id])
      : [parent.wrapper.id, parent.wrapper.element.id];
  }
  return parent === undefined ? [selectedNodeId] : [parent.wrapper.id, parent.wrapper.element.id];
}

export function EditorWorkspace({
  store,
  idPort,
  readOnly = false,
  initialView = "page",
  initialPagePresentation = "facing",
  initialZoom,
  initialMarginGuides = true,
  initialSnapping = true,
  initialReadingOrderOverlay = false,
  snapSizePx = 8,
  measurements,
  assetUrl,
  fontFamily,
  assetInfo,
  restoredEditBuffers,
  documentRevisionToken,
  onEditBufferChange,
  onRequestImageReplacement,
  onChooseImageAsset,
  imageLibraryUnavailableReason,
  onInsertScripture,
  spellcheckEnabled = true,
  spellingDictionary = [],
  onAddSpellingDictionaryWord,
  confirmEnterCustomize,
  confirmDelete,
  onViewStateChange,
  confirmTemplateAction,
  onSaveAsTemplate,
  onDuplicateTemplate,
  onTestWeeklyWorkflow,
  onOpenSourceTemplate,
  onChangeOnlyThisBulletin,
  onUpdateTemplateForFutureBulletins,
}: EditorWorkspaceProps) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [view, setView] = useState<EditorViewMode>(initialView);
  const [pagePresentation, setPagePresentation] = useState(initialPagePresentation);
  const [zoomSetting, setZoomSetting] = useState<number | "fit">(
    initialZoom === undefined ? "fit" : typeof initialZoom === "number"
      ? Math.max(0.25, Math.min(2, initialZoom))
      : initialZoom,
  );
  const surfaceRef = useRef<HTMLElement>(null);
  const [surfaceWidth, setSurfaceWidth] = useState(0);
  const [marginGuides, setMarginGuides] = useState(initialMarginGuides);
  const [snapping, setSnapping] = useState(initialSnapping);
  const [readingOrderOverlay, setReadingOrderOverlay] = useState(initialReadingOrderOverlay);
  const [structureOpen, setStructureOpen] = useState(!readOnly);
  const [inspectorOpen, setInspectorOpen] = useState(!readOnly);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [narrowLayout, setNarrowLayout] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 76rem)").matches
  );
  const structureToggleRef = useRef<HTMLButtonElement>(null);
  const inspectorToggleRef = useRef<HTMLButtonElement>(null);
  const templateToggleRef = useRef<HTMLButtonElement>(null);
  const templateCloseRef = useRef<HTMLButtonElement>(null);
  const findReplaceToggleRef = useRef<HTMLButtonElement>(null);
  const [announcement, setAnnouncement] = useState("");
  const selectedNodeId = snapshot.selection.kind === "node"
    ? snapshot.selection.nodeId
    : snapshot.selection.kind === "field"
      ? snapshot.selection.ownerNodeId
      : undefined;
  const pageWidth = useMemo(
    () => editorPageMetrics(snapshot.document).widthPx,
    [snapshot.document],
  );
  const fitPageCount = pagePresentation === "facing" && surfaceWidth > 1600 ? 2 : 1;
  const fitZoom = surfaceWidth <= 0
    ? 0.82
    : Math.max(0.25, Math.min(2, (surfaceWidth - 64) / (pageWidth * fitPageCount + (fitPageCount - 1) * 16)));
  const zoom = zoomSetting === "fit" ? fitZoom : zoomSetting;
  const cycleCandidates = useMemo(
    () => selectionCycleCandidates(snapshot.document, selectedNodeId),
    [selectedNodeId, snapshot.document],
  );

  useEffect(() => {
    const surface = surfaceRef.current;
    if (surface === null) return;
    const update = () => setSurfaceWidth(surface.clientWidth);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(surface);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (templateOpen) templateCloseRef.current?.focus();
  }, [templateOpen]);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 76rem)");
    const update = () => setNarrowLayout(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!narrowLayout) return;
    if (templateOpen) {
      setStructureOpen(false);
      setInspectorOpen(false);
      return;
    }
    if (structureOpen && inspectorOpen) {
      const focusWasInInspector = document.activeElement instanceof HTMLElement &&
        document.activeElement.closest(".cbb-editor-inspector") !== null;
      setInspectorOpen(false);
      if (focusWasInInspector) queueMicrotask(() => inspectorToggleRef.current?.focus());
    }
  }, [inspectorOpen, narrowLayout, structureOpen, templateOpen]);

  function closeTemplateTools(restoreFocus = true): void {
    setTemplateOpen(false);
    if (restoreFocus) queueMicrotask(() => templateToggleRef.current?.focus());
  }

  function closeFindReplace(): void {
    setFindReplaceOpen(false);
    queueMicrotask(() => findReplaceToggleRef.current?.focus());
  }

  function toggleStructurePanel(): void {
    const opening = !structureOpen;
    setStructureOpen(opening);
    if (opening && narrowLayout) {
      setInspectorOpen(false);
      if (templateOpen) closeTemplateTools(false);
    }
  }

  function toggleInspectorPanel(): void {
    const opening = !inspectorOpen;
    setInspectorOpen(opening);
    if (opening && narrowLayout) {
      setStructureOpen(false);
      if (templateOpen) closeTemplateTools(false);
    }
  }

  function toggleTemplateTools(): void {
    const opening = !templateOpen;
    setTemplateOpen(opening);
    if (opening && narrowLayout) {
      setStructureOpen(false);
      setInspectorOpen(false);
    }
  }

  const publishViewState = useCallback((next: Partial<EditorWorkspaceViewState>) => {
    onViewStateChange?.({ view, pagePresentation, zoom, marginGuides, snapping, readingOrderOverlay, ...next });
  }, [marginGuides, onViewStateChange, pagePresentation, readingOrderOverlay, snapping, view, zoom]);

  function switchMode(mode: EditorMode): void {
    if (readOnly) return;
    if (mode === snapshot.mode) return;
    if (mode === "customizeLayout") {
      const allowed = confirmEnterCustomize?.() ?? window.confirm(
        "Customize Layout can change this bulletin’s structure and page setup. Changes affect this bulletin unless you explicitly save a template. Continue?",
      );
      if (!allowed) return;
    }
    if (mode === "weeklyContent" && templateOpen) closeTemplateTools(false);
    store.setMode(mode);
    setAnnouncement(mode === "weeklyContent"
      ? "Weekly Content mode. Layout is protected."
      : "Customize Layout mode. Structure and page controls are available.");
  }

  function deleteSelection(): void {
    if (readOnly) return;
    if (selectedNodeId === undefined) return;
    const placement = findPlacementWrapperLocation(snapshot.document, selectedNodeId);
    const nodeId = placement?.wrapper.element.id ?? selectedNodeId;
    const location = findElementLocation(snapshot.document, nodeId);
    if (location === undefined) return;
    const command = createDeleteElementCommand(nodeId);
    const decision = store.canExecute(command);
    if (!decision.allowed) {
      setAnnouncement(decision.reason);
      return;
    }
    const nested = containsChildren(snapshot.document, nodeId);
    const allowed = confirmDelete?.(location.element.name, nested) ?? window.confirm(
      nested
        ? `Delete “${location.element.name}” and everything inside it?`
        : `Delete “${location.element.name}”?`,
    );
    if (!allowed) return;
    const result = store.execute(command);
    setAnnouncement(result.status === "denied" ? result.denial.reason : `${location.element.name} deleted.`);
  }

  function workspaceKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.defaultPrevented) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      setFindReplaceOpen(true);
      return;
    }
    if (event.key === "Escape" && findReplaceOpen) {
      event.preventDefault();
      closeFindReplace();
      return;
    }
    if (event.key === "Escape" && templateOpen) {
      event.preventDefault();
      closeTemplateTools();
      return;
    }
    if (event.key === "Escape" && narrowLayout && event.target instanceof HTMLElement) {
      if (structureOpen && event.target.closest(".cbb-editor-structure") !== null) {
        event.preventDefault();
        setStructureOpen(false);
        queueMicrotask(() => structureToggleRef.current?.focus());
        return;
      }
      if (inspectorOpen && event.target.closest(".cbb-editor-inspector") !== null) {
        event.preventDefault();
        setInspectorOpen(false);
        queueMicrotask(() => inspectorToggleRef.current?.focus());
        return;
      }
    }
    if (readOnly && (event.key === "Delete" || event.key.startsWith("Arrow") ||
      ((event.ctrlKey || event.metaKey) && ["y", "z"].includes(event.key.toLowerCase())))) return;
    const arrow = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key);
    const placement = selectedNodeId === undefined
      ? undefined
      : findPlacementWrapperLocation(snapshot.document, selectedNodeId);
    const selectedLocation = selectedNodeId === undefined
      ? undefined
      : findElementLocation(snapshot.document, selectedNodeId);
    const canvasLocation = placement?.kind === "canvas"
      ? findElementLocation(snapshot.document, placement.wrapper.element.id)
      : selectedLocation?.parent.kind === "canvas" ? selectedLocation : undefined;
    const arrowTarget = event.target instanceof HTMLElement ? event.target : undefined;
    const arrowTargetAllowsMovement = arrowTarget === undefined ||
      arrowTarget.closest("input, textarea, select, a, summary, [contenteditable='true']") === null &&
      (arrowTarget.closest("button") === null || arrowTarget.closest(".cbb-tree-placement, .cbb-canvas-move-handle") !== null);
    if (arrow && canvasLocation !== undefined && arrowTargetAllowsMovement) {
      event.preventDefault();
      const wrapper = canvasLocation.parent.kind === "canvas" ? canvasLocation.parent.wrapper : undefined;
      if (wrapper === undefined) return;
      const base = snapping ? snapSizePx : 1;
      const amount = event.shiftKey ? base * 10 : base;
      const left = persistedLengthToEditorPixels(wrapper.x, 0);
      const top = persistedLengthToEditorPixels(wrapper.y, 0);
      const nextLeft = Math.max(0, snapEditorPixels(
        left + (event.key === "ArrowRight" ? amount : event.key === "ArrowLeft" ? -amount : 0),
        snapping,
        snapSizePx,
      ));
      const nextTop = Math.max(0, snapEditorPixels(
        top + (event.key === "ArrowDown" ? amount : event.key === "ArrowUp" ? -amount : 0),
        snapping,
        snapSizePx,
      ));
      const result = store.execute(createMoveCanvasChildCommand({
        nodeId: canvasLocation.element.id,
        x: editorPixelsToInches(nextLeft),
        y: editorPixelsToInches(nextTop),
      }));
      setAnnouncement(result.status === "denied"
        ? result.denial.reason
        : `${canvasLocation.element.name} moved to ${Math.round(nextLeft)} by ${Math.round(nextTop)} editor pixels.`);
      return;
    }
    if (interactiveTarget(event.target)) return;
    const commandKey = event.ctrlKey || event.metaKey;
    if (commandKey && event.key.toLowerCase() === "z") {
      event.preventDefault();
      const change = event.shiftKey ? store.redo() : store.undo();
      setAnnouncement(change === undefined ? "Nothing to undo or redo." : `${event.shiftKey ? "Redid" : "Undid"} ${change.label}.`);
      return;
    }
    if (commandKey && event.key.toLowerCase() === "y") {
      event.preventDefault();
      const change = store.redo();
      setAnnouncement(change === undefined ? "Nothing to redo." : `Redid ${change.label}.`);
      return;
    }
    if (event.key === "Delete") {
      event.preventDefault();
      deleteSelection();
    }
    if (event.altKey && event.key === "`") {
      event.preventDefault();
      cycleSelection();
    }
  }

  function cycleSelection(): void {
    if (cycleCandidates.length < 2) return;
    const current = selectedNodeId === undefined ? -1 : cycleCandidates.indexOf(selectedNodeId);
    const next = cycleCandidates[(current + 1 + cycleCandidates.length) % cycleCandidates.length];
    if (next === undefined) return;
    store.setSelection({ kind: "node", nodeId: next, surface: "editor" });
    const placement = findPlacementWrapperLocation(snapshot.document, next);
    const element = placement?.wrapper.element ?? findElementLocation(snapshot.document, next)?.element;
    setAnnouncement(`Selected ${element?.name ?? "next item"}${placement === undefined ? "" : " placement"}.`);
  }

  const viewProps = {
    document: snapshot.document,
    store,
    idPort,
    mode: snapshot.mode,
    readOnly,
    ...(selectedNodeId === undefined ? {} : { selectedNodeId }),
    showMarginGuides: marginGuides,
    snapping,
    showReadingOrder: readingOrderOverlay,
    snapSizePx,
    zoom,
    pagePresentation,
    ...(measurements === undefined ? {} : { measurements }),
    ...(assetUrl === undefined ? {} : { assetUrl }),
    ...(onRequestImageReplacement === undefined ? {} : { onRequestImageReplacement }),
    ...(fontFamily === undefined ? {} : { fontFamily }),
    ...(onInsertScripture === undefined ? {} : { onInsertScripture }),
    spellcheckEnabled,
    spellingDictionary,
    ...(onAddSpellingDictionaryWord === undefined ? {} : { onAddSpellingDictionaryWord }),
    onAnnouncement: setAnnouncement,
  };

  return (
    <div
      className="cbb-editor-workspace"
      data-mode={snapshot.mode}
      data-structure-open={structureOpen ? "true" : "false"}
      data-inspector-open={inspectorOpen ? "true" : "false"}
      data-template-open={templateOpen ? "true" : "false"}
      data-narrow-layout={narrowLayout ? "true" : "false"}
      data-read-only={readOnly ? "true" : "false"}
      onKeyDown={workspaceKeyDown}
    >
      <div className="cbb-editor-toolbar" role="group" aria-label="Editor controls">
        <div className="cbb-editor-identity">
          <strong>{snapshot.document.name}</strong>
          <span className={`cbb-mode-badge cbb-mode-badge--${snapshot.mode}`}>
            {readOnly ? "Read-only" : snapshot.mode === "weeklyContent" ? "Weekly Content" : "Customize Layout"}
          </span>
        </div>
        {readOnly ? null : <div className="cbb-toolbar-group" role="group" aria-label="Editing mode">
          <Button
            variant={snapshot.mode === "weeklyContent" ? "primary" : "default"}
            aria-pressed={snapshot.mode === "weeklyContent"}
            onClick={() => switchMode("weeklyContent")}
          >Weekly Content</Button>
          <Button
            variant={snapshot.mode === "customizeLayout" ? "primary" : "default"}
            aria-pressed={snapshot.mode === "customizeLayout"}
            onClick={() => switchMode("customizeLayout")}
          >Customize Layout</Button>
        </div>}
        {readOnly ? null : <div className="cbb-toolbar-group" role="group" aria-label="History">
          <Button
            disabled={!snapshot.canUndo}
            title={snapshot.undoLabel === undefined ? "Nothing to undo" : `Undo ${snapshot.undoLabel}`}
            onClick={() => {
              const change = store.undo();
              if (change !== undefined) setAnnouncement(`Undid ${change.label}.`);
            }}
          >Undo</Button>
          <Button
            disabled={!snapshot.canRedo}
            title={snapshot.redoLabel === undefined ? "Nothing to redo" : `Redo ${snapshot.redoLabel}`}
            onClick={() => {
              const change = store.redo();
              if (change !== undefined) setAnnouncement(`Redid ${change.label}.`);
            }}
          >Redo</Button>
        </div>}
        <div className="cbb-toolbar-group" role="group" aria-label="Document search">
          <Button
            ref={findReplaceToggleRef}
            aria-expanded={findReplaceOpen}
            aria-controls="cbb-find-replace-panel"
            aria-keyshortcuts="Control+F Meta+F"
            onClick={() => setFindReplaceOpen((open) => !open)}
          >Find / Replace</Button>
        </div>
        <div className="cbb-toolbar-group" role="group" aria-label="Editor view">
          <Button
            variant={view === "page" ? "primary" : "default"}
            aria-pressed={view === "page"}
            onClick={() => { setView("page"); publishViewState({ view: "page" }); }}
          >Page View</Button>
          <Button
            variant={view === "contiguous" ? "primary" : "default"}
            aria-pressed={view === "contiguous"}
            onClick={() => { setView("contiguous"); publishViewState({ view: "contiguous" }); }}
          >Contiguous</Button>
          <Button
            aria-pressed={snapshot.selection.kind === "document"}
            onClick={() => store.setSelection({ kind: "document" })}
          >Page setup</Button>
        </div>
        <details className="cbb-view-options">
          <summary>View options</summary>
          <div className="cbb-view-options-popover">
            <label>
              Zoom
              <select
                value={zoomSetting}
                onChange={(event) => {
                  const next = event.currentTarget.value === "fit"
                    ? "fit" as const
                    : Number(event.currentTarget.value);
                  setZoomSetting(next);
                  publishViewState({ zoom: next === "fit" ? fitZoom : next });
                }}
              >
                <option value={0.5}>50%</option>
                <option value={0.67}>67%</option>
                <option value="fit">Fit width</option>
                <option value={1}>100%</option>
                <option value={1.25}>125%</option>
                <option value={1.5}>150%</option>
                <option value={2}>200%</option>
              </select>
            </label>
            {view === "page"
              ? (
                <label>
                  Page presentation
                  <select
                    value={pagePresentation}
                    onChange={(event) => {
                      const next = event.currentTarget.value as "single" | "facing";
                      setPagePresentation(next);
                      publishViewState({ pagePresentation: next });
                    }}
                  >
                    <option value="single">One page per row</option>
                    <option value="facing">Facing pages</option>
                  </select>
                </label>
              )
              : null}
            <label>
              <input
                type="checkbox"
                checked={marginGuides}
                onChange={(event) => {
                  setMarginGuides(event.currentTarget.checked);
                  publishViewState({ marginGuides: event.currentTarget.checked });
                }}
              />
              Show margin guides
            </label>
            <label>
              <input
                type="checkbox"
                checked={snapping}
                onChange={(event) => {
                  setSnapping(event.currentTarget.checked);
                  publishViewState({ snapping: event.currentTarget.checked });
                }}
              />
              Snap while moving and resizing
            </label>
            <label>
              <input
                type="checkbox"
                checked={readingOrderOverlay}
                onChange={(event) => {
                  setReadingOrderOverlay(event.currentTarget.checked);
                  publishViewState({ readingOrderOverlay: event.currentTarget.checked });
                }}
              />
              Show reading order
            </label>
            <Button
              disabled={cycleCandidates.length < 2}
              title={cycleCandidates.length < 2 ? "Select a placed or overlapping item first." : "Also available with Alt+`"}
              onClick={cycleSelection}
            >
              Cycle items at selection
            </Button>
          </div>
        </details>
        {readOnly ? null : <div className="cbb-toolbar-group cbb-panel-toggles" role="group" aria-label="Panels">
          <Button
            ref={structureToggleRef}
            aria-pressed={structureOpen}
            aria-expanded={structureOpen}
            aria-controls="cbb-editor-structure-panel"
            onClick={toggleStructurePanel}
          >Structure</Button>
          <Button
            ref={inspectorToggleRef}
            aria-pressed={inspectorOpen}
            aria-expanded={inspectorOpen}
            aria-controls="cbb-editor-inspector-panel"
            onClick={toggleInspectorPanel}
          >Inspector</Button>
          {snapshot.mode === "customizeLayout"
            ? (
              <Button
                ref={templateToggleRef}
                aria-expanded={templateOpen}
                aria-controls="cbb-template-authoring-drawer"
                aria-pressed={templateOpen}
                onClick={toggleTemplateTools}
              >
                Template tools
              </Button>
            )
            : null}
        </div>}
      </div>
      {findReplaceOpen
        ? (
            <div id="cbb-find-replace-panel">
              <FindReplacePanel
                store={store}
                mode={snapshot.mode}
                readOnly={readOnly}
                onClose={closeFindReplace}
                onAnnouncement={setAnnouncement}
              />
            </div>
          )
        : null}
      <div className="cbb-editor-layout">
        {readOnly ? null : <div id="cbb-editor-structure-panel" className="cbb-editor-structure" hidden={!structureOpen}>
          <StructureTree
            document={snapshot.document}
            store={store}
            mode={snapshot.mode}
            {...(selectedNodeId === undefined ? {} : { selectedNodeId })}
            idPort={idPort}
            {...(confirmDelete === undefined ? {} : { confirmDelete })}
            {...(onChooseImageAsset === undefined ? {} : { onChooseImageAsset })}
            {...(imageLibraryUnavailableReason === undefined ? {} : { imageLibraryUnavailableReason })}
            onAnnouncement={setAnnouncement}
          />
        </div>}
        <main
          ref={surfaceRef}
          className="cbb-editor-surface"
          aria-label={`${view === "page" ? "Page" : "Contiguous"} bulletin editor`}
          onClick={(event) => {
            if (event.currentTarget === event.target) store.setSelection({ kind: "document" });
          }}
        >
          {view === "page" ? <PageView {...viewProps} /> : <ContiguousView {...viewProps} />}
        </main>
        {readOnly ? null : <div id="cbb-editor-inspector-panel" className="cbb-editor-inspector" hidden={!inspectorOpen}>
          <InspectorPanel
            document={snapshot.document}
            documentRevision={snapshot.documentRevision}
            documentRevisionToken={documentRevisionToken}
            store={store}
            mode={snapshot.mode}
            {...(selectedNodeId === undefined ? {} : { selectedNodeId })}
            {...(restoredEditBuffers === undefined ? {} : { restoredEditBuffers })}
            {...(onEditBufferChange === undefined ? {} : { onEditBufferChange })}
            {...(onRequestImageReplacement === undefined ? {} : { onRequestImageReplacement })}
            {...(imageLibraryUnavailableReason === undefined ? {} : { imageLibraryUnavailableReason })}
            {...(assetUrl === undefined ? {} : { assetUrl })}
            {...(assetInfo === undefined ? {} : { assetInfo })}
            onAnnouncement={setAnnouncement}
          />
        </div>}
        {readOnly ? null : <aside
          id="cbb-template-authoring-drawer"
          className="cbb-editor-template-tools"
          aria-label="Template authoring tools"
          hidden={!templateOpen}
        >
          <div className="cbb-template-drawer-actions">
            <Button ref={templateCloseRef} onClick={() => closeTemplateTools()}>Close template tools</Button>
          </div>
          <TemplateAuthoringPanel
            document={snapshot.document}
            store={store}
            mode={snapshot.mode}
            {...(selectedNodeId === undefined ? {} : { selectedNodeId })}
            idPort={idPort}
            onAnnouncement={setAnnouncement}
            {...(confirmTemplateAction === undefined ? {} : { confirmAction: confirmTemplateAction })}
            {...(onSaveAsTemplate === undefined ? {} : { onSaveAsTemplate })}
            {...(onDuplicateTemplate === undefined ? {} : { onDuplicateTemplate })}
            {...(onTestWeeklyWorkflow === undefined ? {} : { onTestWeeklyWorkflow })}
            {...(onOpenSourceTemplate === undefined ? {} : { onOpenSourceTemplate })}
            {...(onChangeOnlyThisBulletin === undefined ? {} : { onChangeOnlyThisBulletin })}
            {...(onUpdateTemplateForFutureBulletins === undefined ? {} : { onUpdateTemplateForFutureBulletins })}
          />
        </aside>}
      </div>
      <LiveRegion message={announcement} />
    </div>
  );
}
