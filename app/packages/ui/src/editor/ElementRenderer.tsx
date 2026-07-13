import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import type {
  CanvasChildWrapper,
  CbbDocument,
  NativeElement,
  RichTextDocument,
  TextContent,
} from "@cbb/core";
import { formatIsoDate } from "@cbb/core";
import { TASK_LANGUAGE } from "../language/index.js";
import { checkEditorCapability } from "../store/capabilities.js";
import {
  createMoveCanvasChildCommand,
  createResizeElementCommand,
  createSetDateValueCommand,
  createSetGridLayoutCommand,
  createSetMusicTextCommand,
  findElementLocation,
  type MusicTextProperty,
} from "../store/commands/index.js";
import type { EditorStore } from "../store/editorStore.js";
import type { EditorMode } from "../store/types.js";
import { DirectTextEditor } from "./DirectTextEditor.js";
import {
  editorPixelsToInches,
  persistedLengthToEditorPixels,
  snapEditorPixels,
} from "./interactions.js";
import { CoverFocalImage } from "./CoverFocalImage.js";
import type { EditorGeneratedRightsBlock } from "./renderModel.js";
import {
  setActiveEditorDragSource,
  writeEditorDragSource,
} from "./editorDrag.js";

export interface ElementRendererProps {
  readonly document: CbbDocument;
  readonly element: NativeElement;
  readonly store: EditorStore;
  readonly mode: EditorMode;
  readonly readOnly?: boolean | undefined;
  readonly selectedNodeId?: string | undefined;
  readonly fragmentIndices?: readonly number[] | undefined;
  readonly assetUrl?: ((assetRef: string) => string | undefined) | undefined;
  readonly onRequestImageReplacement?: ((nodeId: string, currentAssetRef: string) => void) | undefined;
  /** Resolves a managed portable font id to its registered CSS family name. */
  readonly fontFamily?: ((fontRef: string) => string | undefined) | undefined;
  readonly snapping: boolean;
  readonly snapSizePx: number;
  readonly pageScale?: number | undefined;
  readonly showReadingOrder?: boolean | undefined;
  /** The element data already came through core resolution/binding expansion. */
  readonly resolved?: boolean | undefined;
  readonly generatedRights?: Readonly<Record<string, EditorGeneratedRightsBlock>> | undefined;
  readonly onInsertScripture?: ((nodeId: string, content: TextContent) => void) | undefined;
  readonly spellcheckEnabled: boolean;
  readonly spellingDictionary: readonly string[];
  readonly onAddSpellingDictionaryWord?: ((word: string) => Promise<string>) | undefined;
  readonly contentProtectionReason?: string | undefined;
  readonly selectionContext?: string | undefined;
  readonly onAnnouncement?: ((message: string) => void) | undefined;
}

const EMPTY_PLAIN_TEXT_CONTENT = { kind: "plain", text: "" } as const;

function effectiveTextContent(document: CbbDocument, element: Extract<NativeElement, { type: "text" }>): TextContent {
  const binding = element.bindings?.find(
    (candidate) =>
      candidate.target === "/data/content" ||
      candidate.target === "/data/content/text" ||
      candidate.target === "/data/content/document",
  );
  if (binding === undefined) return element.data.content ?? EMPTY_PLAIN_TEXT_CONTENT;
  const entry = binding.scope === "document"
    ? document.fieldValues?.[binding.fieldId]
    : element.fieldValues?.[binding.fieldId];
  const value = entry?.value ?? binding.fallback;
  if (typeof value === "string") return { kind: "plain", text: value };
  if (
    typeof value === "object" &&
    value !== null &&
    (value as { readonly type?: unknown }).type === "document"
  ) {
    return {
      kind: "richText",
      document: value as RichTextDocument,
    };
  }
  return element.data.content ?? EMPTY_PLAIN_TEXT_CONTENT;
}

function richFormattingAllowed(document: CbbDocument, element: Extract<NativeElement, { type: "text" }>): boolean {
  const binding = element.bindings?.find(
    (candidate) =>
      candidate.target === "/data/content" ||
      candidate.target === "/data/content/text" ||
      candidate.target === "/data/content/document",
  );
  if (binding === undefined) return true;
  const contract = binding.scope === "document" ? document.fieldContract : element.fieldContract;
  const field = contract?.fields.find((candidate) => candidate.id === binding.fieldId);
  return field?.type !== "text";
}

function formatDate(value: string, format?: string, locale?: string): string {
  try {
    return formatIsoDate(value, format, locale).text;
  } catch {
    return value;
  }
}

function DirectDateEditor({
  nodeId,
  value,
  formatted,
  editable,
  disabledReason,
  store,
  editRequest,
}: {
  readonly nodeId: string;
  readonly value: string;
  readonly formatted: string;
  readonly editable: boolean;
  readonly disabledReason?: string | undefined;
  readonly store: EditorStore;
  readonly editRequest: number;
}) {
  const [editing, setEditing] = useState(false);
  const displayRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const handledRequest = useRef(editRequest);
  const restoreFocus = useRef(false);

  useEffect(() => {
    if (editRequest === handledRequest.current) return;
    handledRequest.current = editRequest;
    if (editable) setEditing(true);
  }, [editRequest, editable]);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
    else if (restoreFocus.current) {
      restoreFocus.current = false;
      displayRef.current?.focus();
    }
  }, [editing]);

  if (!editing) {
    return (
      <button
        ref={displayRef}
        type="button"
        className="cbb-direct-date"
        disabled={!editable}
        title={disabledReason}
        aria-label={`${editable ? "Editable" : "Protected"} date. ${formatted}${editable ? " Press Enter or F2 to edit." : ""}`}
        onClick={() => setEditing(true)}
      >
        {formatted}
      </button>
    );
  }
  return (
    <div className="cbb-direct-date-editor">
      <label>
        <span>Date</span>
        <input
          ref={inputRef}
          type="date"
          defaultValue={value}
          onChange={(event) => store.execute(createSetDateValueCommand({
            nodeId,
            value: event.currentTarget.value,
          }))}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            restoreFocus.current = true;
            setEditing(false);
          }}
          onBlur={(event) => {
            if (event.relatedTarget instanceof Node && event.currentTarget.parentElement?.parentElement?.contains(event.relatedTarget)) return;
            setEditing(false);
          }}
        />
      </label>
      <p aria-live="polite">Formatted example: {formatted}</p>
      <button type="button" onClick={() => {
        restoreFocus.current = true;
        setEditing(false);
      }}>Done</button>
    </div>
  );
}

const EMPTY_RICH_TEXT: RichTextDocument = Object.freeze({
  type: "document",
  blocks: Object.freeze([{ type: "paragraph", children: Object.freeze([]) }]),
}) as RichTextDocument;

function MusicTextInput({
  nodeId,
  property,
  label,
  value,
  required = false,
  editable,
  disabledReason,
  store,
  inputRef,
}: {
  readonly nodeId: string;
  readonly property: MusicTextProperty;
  readonly label: string;
  readonly value: string;
  readonly required?: boolean;
  readonly editable: boolean;
  readonly disabledReason?: string | undefined;
  readonly store: EditorStore;
  readonly inputRef?: React.RefObject<HTMLInputElement | null> | undefined;
}) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const skipNextBlurCommit = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  function commit(): boolean {
    if (property === "title" && draft.trim().length === 0) {
      setError("Enter a hymn or song title.");
      return false;
    }
    try {
      store.execute(createSetMusicTextCommand({
        nodeId,
        property,
        value: draft,
      }));
      store.breakHistoryGroup();
      setError("");
      return true;
    } catch (commitError) {
      setError(commitError instanceof Error ? commitError.message : "That value could not be saved.");
      return false;
    }
  }

  return (
    <label className="cbb-music-field">
      <span>{label}</span>
      <input
        ref={(element) => {
          if (inputRef !== undefined) inputRef.current = element;
        }}
        type="text"
        value={draft}
        required={required}
        disabled={!editable}
        title={editable ? undefined : disabledReason}
        aria-invalid={error.length > 0 ? "true" : undefined}
        onFocus={() => setEditing(true)}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
          if (error.length > 0) setError("");
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            skipNextBlurCommit.current = true;
            setDraft(value);
            setError("");
            setEditing(false);
            event.currentTarget.blur();
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (commit()) {
              skipNextBlurCommit.current = true;
              setEditing(false);
              event.currentTarget.blur();
            }
          }
        }}
        onBlur={() => {
          if (skipNextBlurCommit.current) {
            skipNextBlurCommit.current = false;
            return;
          }
          if (commit()) setEditing(false);
        }}
      />
      {error.length === 0 ? null : <span className="cbb-field-error" role="alert">{error}</span>}
    </label>
  );
}

function DirectMusicEditor({
  props,
  editRequest,
}: {
  readonly props: ElementRendererProps & {
    readonly element: Extract<NativeElement, { type: "music" }>;
  };
  readonly editRequest: number;
}) {
  const { document, element, fragmentIndices } = props;
  const titleRef = useRef<HTMLInputElement>(null);
  const handledRequest = useRef(editRequest);
  const addressable = findElementLocation(document, element.id) !== undefined;
  const decision = checkEditorCapability(document, props.mode, {
    capability: "content.edit",
    target: { kind: "node", nodeId: element.id },
  });
  const editable = props.readOnly !== true && addressable && decision.allowed &&
    props.contentProtectionReason === undefined;
  const disabledReason = props.readOnly
    ? "This bulletin library is open read-only."
    : props.contentProtectionReason ??
      (addressable && !decision.allowed
        ? decision.reason
        : "This content is generated from a saved section and is edited at its source.");

  useEffect(() => {
    if (editRequest === handledRequest.current) return;
    handledRequest.current = editRequest;
    if (editable) titleRef.current?.focus();
  }, [editRequest, editable]);

  return (
    <section className="cbb-music" aria-label="Hymn or song content">
      <div className="cbb-music-details">
        <MusicTextInput
          nodeId={element.id}
          property="number"
          label="Number"
          value={element.data.number ?? ""}
          editable={editable}
          disabledReason={disabledReason}
          store={props.store}
        />
        <MusicTextInput
          nodeId={element.id}
          property="title"
          label="Title"
          value={element.data.title ?? ""}
          required
          editable={editable}
          disabledReason={disabledReason}
          store={props.store}
          inputRef={titleRef}
        />
        <MusicTextInput
          nodeId={element.id}
          property="instructions"
          label="Instructions"
          value={element.data.instructions ?? ""}
          editable={editable}
          disabledReason={disabledReason}
          store={props.store}
        />
        <MusicTextInput
          nodeId={element.id}
          property="source"
          label="Source"
          value={element.data.source ?? ""}
          editable={editable}
          disabledReason={disabledReason}
          store={props.store}
        />
      </div>
      <div className="cbb-music-rich-content">
        <span className="cbb-music-rich-content__label">Hymn text</span>
        <DirectTextEditor
          nodeId={element.id}
          content={{
            kind: "richText",
            document: element.data.richContent ?? EMPTY_RICH_TEXT,
          }}
          contentTarget="musicRichContent"
          contentLabel="Hymn text"
          editable={editable}
          disabledReason={disabledReason}
          store={props.store}
          selected={props.selectedNodeId === element.id}
          richFormattingAllowed
          {...(fragmentIndices === undefined ? {} : { fragmentIndices })}
          spellcheckEnabled={props.spellcheckEnabled}
          spellingDictionary={props.spellingDictionary}
          {...(props.onAddSpellingDictionaryWord === undefined
            ? {}
            : { onAddSpellingDictionaryWord: props.onAddSpellingDictionaryWord })}
        />
      </div>
    </section>
  );
}

function cssLength(value: number | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "number" ? `${value}px` : value;
}

function cssTrack(value: number | string): string {
  return typeof value === "number" ? `${value}px` : value;
}

function elementStyle(
  element: NativeElement,
  fontFamily?: (fontRef: string) => string | undefined,
): CSSProperties {
  const style = element.style;
  const resolvedFontFamily = style?.fontRef === undefined
    ? style?.font
    : fontFamily?.(style.fontRef);
  return {
    ...(element.width === undefined || element.width === "auto"
      ? {}
      : { width: cssLength(element.width) }),
    ...(element.height === undefined || element.height === "auto"
      ? {}
      : { height: cssLength(element.height) }),
    ...(element.margin === undefined
      ? {}
      : { marginBlock: cssLength(element.margin) }),
    ...(element.padding === undefined
      ? {}
      : { padding: cssLength(element.padding) }),
    ...(style?.fontSize === undefined ? {} : { fontSize: cssLength(style.fontSize) }),
    ...(resolvedFontFamily === undefined ? {} : { fontFamily: resolvedFontFamily }),
    ...(style?.fontWeight === undefined
      ? {}
      : { fontWeight: { regular: 400, medium: 500, semibold: 600, bold: 700 }[style.fontWeight] }),
    ...(style?.fontStyle === undefined ? {} : { fontStyle: style.fontStyle }),
    ...(style?.color === undefined ? {} : { color: style.color }),
    ...(style?.background === undefined ? {} : { backgroundColor: style.background }),
    ...(style?.borderWidth === undefined
      ? {}
      : {
          borderWidth: cssLength(style.borderWidth),
          borderStyle: "solid",
          borderColor: style.borderColor ?? "currentColor",
        }),
    ...(style?.align === undefined ? {} : { textAlign: style.align }),
    ...(style?.verticalAlign === undefined
      ? {}
      : {
          alignContent: style.verticalAlign === "center"
            ? "center"
            : style.verticalAlign === "bottom" ? "end" : "start",
        }),
  };
}

function ResizeFrame({
  nodeId,
  store,
  enabled,
  snapping,
  snapSizePx,
  preserveAspect,
  scale,
  anchor,
  children,
}: {
  readonly nodeId: string;
  readonly store: EditorStore;
  readonly enabled: boolean;
  readonly snapping: boolean;
  readonly snapSizePx: number;
  readonly preserveAspect: boolean;
  readonly scale: number;
  readonly anchor: "topLeft" | "topCenter" | "topRight" | "centerLeft" | "center" | "centerRight" | "bottomLeft" | "bottomCenter" | "bottomRight";
  readonly children: ReactNode;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    width: number;
    height: number;
    maxWidth: number;
    maxHeight: number;
  } | undefined>(undefined);
  const [draft, setDraft] = useState<{ width: number; height: number }>();

  function maximumSize(bounds: DOMRect): { readonly maxWidth: number; readonly maxHeight: number } {
    const pageRegion = frameRef.current?.closest<HTMLElement>(".cbb-page-region");
    const boundaryElement = pageRegion?.dataset["clipToRegion"] === "false"
      ? frameRef.current?.closest<HTMLElement>(".cbb-editor-page")
      : frameRef.current?.closest<HTMLElement>(".cbb-canvas-element, .cbb-page-region, .cbb-page-content");
    const boundary = boundaryElement?.getBoundingClientRect();
    if (boundary === undefined) {
      return { maxWidth: Number.POSITIVE_INFINITY, maxHeight: Number.POSITIVE_INFINITY };
    }
    const horizontalFactor = anchor.endsWith("Center") || anchor === "center"
      ? 0.5
      : anchor.endsWith("Right") ? 1 : 0;
    const verticalFactor = anchor.startsWith("center")
      ? 0.5
      : anchor.startsWith("bottom") ? 1 : 0;
    const anchorX = bounds.left + bounds.width * horizontalFactor;
    const anchorY = bounds.top + bounds.height * verticalFactor;
    const leftLimit = horizontalFactor === 0
      ? Number.POSITIVE_INFINITY
      : (anchorX - boundary.left) / horizontalFactor;
    const rightLimit = horizontalFactor === 1
      ? Number.POSITIVE_INFINITY
      : (boundary.right - anchorX) / (1 - horizontalFactor);
    const topLimit = verticalFactor === 0
      ? Number.POSITIVE_INFINITY
      : (anchorY - boundary.top) / verticalFactor;
    const bottomLimit = verticalFactor === 1
      ? Number.POSITIVE_INFINITY
      : (boundary.bottom - anchorY) / (1 - verticalFactor);
    return {
      maxWidth: Math.max(24, Math.min(leftLimit, rightLimit) / scale),
      maxHeight: Math.max(24, Math.min(topLimit, bottomLimit) / scale),
    };
  }

  function commit(width: number, height: number): void {
    store.execute(
      createResizeElementCommand({
        nodeId,
        width: editorPixelsToInches(width),
        height: editorPixelsToInches(height),
      }),
    );
  }

  function pointerDown(event: PointerEvent<HTMLButtonElement>): void {
    if (!enabled || frameRef.current === null) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = frameRef.current.getBoundingClientRect();
    const maximum = maximumSize(bounds);
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: bounds.width / scale,
      height: bounds.height / scale,
      maxWidth: maximum.maxWidth,
      maxHeight: maximum.maxHeight,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function pointerMove(event: PointerEvent<HTMLButtonElement>): void {
    const current = drag.current;
    if (current === undefined || current.pointerId !== event.pointerId) return;
    let width = Math.min(current.maxWidth, Math.max(24, snapEditorPixels(
      current.width + (event.clientX - current.startX) / scale,
      snapping,
      snapSizePx,
    )));
    let height = Math.min(current.maxHeight, Math.max(24, snapEditorPixels(
      current.height + (event.clientY - current.startY) / scale,
      snapping,
      snapSizePx,
    )));
    if (preserveAspect && current.width > 0 && current.height > 0) {
      height = width * current.height / current.width;
      if (height > current.maxHeight) {
        height = current.maxHeight;
        width = height * current.width / current.height;
      }
      width = Math.max(24, Math.round(width));
      height = Math.max(24, Math.round(height));
    }
    setDraft({ width, height });
  }

  function pointerUp(event: PointerEvent<HTMLButtonElement>): void {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = undefined;
    if (draft !== undefined) commit(draft.width, draft.height);
    setDraft(undefined);
  }

  function keyboardResize(event: KeyboardEvent<HTMLButtonElement>): void {
    if (!enabled || !["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const bounds = frameRef.current?.getBoundingClientRect();
    if (bounds === undefined) return;
    const baseAmount = snapping ? snapSizePx : 1;
    const amount = event.shiftKey ? baseAmount * 10 : baseAmount;
    const modelWidth = bounds.width / scale;
    const modelHeight = bounds.height / scale;
    const maximum = maximumSize(bounds);
    const maxWidth = maximum.maxWidth;
    const maxHeight = maximum.maxHeight;
    let width = Math.min(maxWidth, Math.max(24, modelWidth + (event.key === "ArrowRight" ? amount : event.key === "ArrowLeft" ? -amount : 0)));
    let height = Math.min(maxHeight, Math.max(24, modelHeight + (event.key === "ArrowDown" ? amount : event.key === "ArrowUp" ? -amount : 0)));
    if (preserveAspect && modelWidth > 0 && modelHeight > 0) {
      height = width * modelHeight / modelWidth;
      if (height > maxHeight) {
        height = maxHeight;
        width = height * modelWidth / modelHeight;
      }
      width = Math.max(24, Math.round(width));
      height = Math.max(24, Math.round(height));
    }
    commit(width, height);
  }

  return (
    <div
      ref={frameRef}
      className="cbb-element-frame"
      style={draft === undefined ? undefined : { width: draft.width, height: draft.height }}
    >
      {children}
      {enabled
        ? (
          <button
            type="button"
            className="cbb-resize-handle"
            aria-label="Resize item. Use arrow keys for precise sizing."
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={pointerUp}
            onKeyDown={keyboardResize}
            onBlur={() => store.breakHistoryGroup()}
          />
        )
        : null}
    </div>
  );
}

function CanvasChild({
  wrapper,
  paintIndex,
  rendererProps,
}: {
  readonly wrapper: CanvasChildWrapper;
  readonly paintIndex: number;
  readonly rendererProps: Omit<ElementRendererProps, "element" | "fragmentIndices">;
}) {
  const { store, mode, snapping, snapSizePx } = rendererProps;
  const canMove = rendererProps.readOnly !== true && checkEditorCapability(rendererProps.document, mode, {
    capability: "layout.editPlacement",
    target: { kind: "node", nodeId: wrapper.id },
  }).allowed && findElementLocation(rendererProps.document, wrapper.element.id) !== undefined;
  const start = useRef<{
    pointerId: number;
    x: number;
    y: number;
    left: number;
    top: number;
    maxLeft: number;
    maxTop: number;
  } | undefined>(undefined);
  const [draft, setDraft] = useState<{ left: number; top: number }>();
  const left = persistedLengthToEditorPixels(wrapper.x, 0);
  const top = persistedLengthToEditorPixels(wrapper.y, 0);

  function pointerDown(event: PointerEvent<HTMLButtonElement>): void {
    if (!canMove) return;
    event.preventDefault();
    event.stopPropagation();
    const childBounds = event.currentTarget.parentElement?.getBoundingClientRect();
    const containerBounds = event.currentTarget.closest(".cbb-canvas-element")?.getBoundingClientRect();
    const scale = rendererProps.pageScale ?? 1;
    start.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left,
      top,
      maxLeft: containerBounds === undefined || childBounds === undefined
        ? Number.POSITIVE_INFINITY
        : Math.max(0, (containerBounds.width - childBounds.width) / scale),
      maxTop: containerBounds === undefined || childBounds === undefined
        ? Number.POSITIVE_INFINITY
        : Math.max(0, (containerBounds.height - childBounds.height) / scale),
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function pointerMove(event: PointerEvent<HTMLButtonElement>): void {
    const current = start.current;
    if (current === undefined || current.pointerId !== event.pointerId) return;
    setDraft({
      left: Math.min(current.maxLeft, Math.max(0, snapEditorPixels(
        current.left + (event.clientX - current.x) / (rendererProps.pageScale ?? 1),
        snapping,
        snapSizePx,
      ))),
      top: Math.min(current.maxTop, Math.max(0, snapEditorPixels(
        current.top + (event.clientY - current.y) / (rendererProps.pageScale ?? 1),
        snapping,
        snapSizePx,
      ))),
    });
  }

  function commit(position: { left: number; top: number }): void {
    store.execute(
      createMoveCanvasChildCommand({
        nodeId: wrapper.element.id,
        x: editorPixelsToInches(position.left),
        y: editorPixelsToInches(position.top),
      }),
    );
  }

  function pointerUp(event: PointerEvent<HTMLButtonElement>): void {
    if (start.current?.pointerId !== event.pointerId) return;
    start.current = undefined;
    if (draft !== undefined) commit(draft);
    setDraft(undefined);
  }

  const position = draft ?? { left, top };
  return (
    <div className={`cbb-canvas-child${rendererProps.selectedNodeId === wrapper.id ? " is-selected" : ""}`} style={position}>
      {rendererProps.showReadingOrder
        ? (
          <span className="cbb-reading-order-badge">
            Reading {wrapper.semanticOrder === undefined ? paintIndex + 1 : wrapper.semanticOrder + 1}; paint {paintIndex + 1}
          </span>
        )
        : null}
      <button
        type="button"
        className="cbb-canvas-move-handle"
        disabled={!canMove}
        title={canMove ? "Move item" : "Switch to Customize Layout to move this item."}
        aria-label={`Move ${wrapper.element.name}`}
        aria-pressed={rendererProps.selectedNodeId === wrapper.id}
        onClick={(event) => {
          event.stopPropagation();
          store.setSelection({ kind: "node", nodeId: wrapper.id, surface: "editor" });
        }}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        onKeyDown={(event) => {
          if (!canMove || !event.key.startsWith("Arrow")) return;
          event.preventDefault();
          const baseAmount = snapping ? snapSizePx : 1;
          const amount = event.shiftKey ? baseAmount * 10 : baseAmount;
          const childBounds = event.currentTarget.parentElement?.getBoundingClientRect();
          const containerBounds = event.currentTarget.closest(".cbb-canvas-element")?.getBoundingClientRect();
          const scale = rendererProps.pageScale ?? 1;
          const maxLeft = containerBounds === undefined || childBounds === undefined
            ? Number.POSITIVE_INFINITY
            : Math.max(0, (containerBounds.width - childBounds.width) / scale);
          const maxTop = containerBounds === undefined || childBounds === undefined
            ? Number.POSITIVE_INFINITY
            : Math.max(0, (containerBounds.height - childBounds.height) / scale);
          commit({
            left: Math.min(maxLeft, Math.max(0, left + (event.key === "ArrowRight" ? amount : event.key === "ArrowLeft" ? -amount : 0))),
            top: Math.min(maxTop, Math.max(0, top + (event.key === "ArrowDown" ? amount : event.key === "ArrowUp" ? -amount : 0))),
          });
        }}
      >
        Move
      </button>
      <ElementRenderer {...rendererProps} element={wrapper.element} />
    </div>
  );
}

function GridGutterHandles({
  element,
  rendererProps,
}: {
  readonly element: Extract<NativeElement, { type: "grid" }>;
  readonly rendererProps: ElementRendererProps;
}) {
  const drag = useRef<{
    readonly pointerId: number;
    readonly startX: number;
    readonly initialGap: number;
    readonly grid: HTMLElement;
  } | undefined>(undefined);
  const canResize = rendererProps.readOnly !== true && rendererProps.selectedNodeId === element.id && checkEditorCapability(
    rendererProps.document,
    rendererProps.mode,
    { capability: "layout.edit", target: { kind: "node", nodeId: element.id } },
  ).allowed;
  const trackWeights = element.data.columnTracks === undefined
    ? Array.from({ length: element.data.columns }, () => 1)
    : element.data.columnTracks.map((track) => {
        const match = /^(\d+(?:\.\d+)?)fr$/u.exec(String(track).trim());
        return match?.[1] === undefined ? undefined : Number(match[1]);
      });
  if (!canResize || element.data.columns < 2 || trackWeights.some((weight) => weight === undefined || weight <= 0)) {
    return null;
  }
  const numericWeights = trackWeights as readonly number[];
  const totalWeight = numericWeights.reduce((sum, weight) => sum + weight, 0);
  const currentGap = persistedLengthToEditorPixels(
    element.data.columnGap ?? element.data.cellPadding,
    0,
  );
  const commit = (gapPx: number, grouped = false): void => {
    rendererProps.store.execute(createSetGridLayoutCommand({
      nodeId: element.id,
      columnGap: editorPixelsToInches(Math.max(0, gapPx)),
      ...(grouped ? { historyGroup: `grid-gutter:${element.id}` } : {}),
    }));
  };
  return <>{Array.from({ length: element.data.columns - 1 }, (_, index) => (
    <button
      key={index}
      type="button"
      className="cbb-grid-gutter-handle"
      style={{
        left: `${(numericWeights.slice(0, index + 1).reduce((sum, weight) => sum + weight, 0) / totalWeight) * 100}%`,
      }}
      aria-label={`Resize column gutter ${index + 1}. Use left and right arrow keys for precise sizing.`}
      title={`Column gap ${element.data.columnGap ?? element.data.cellPadding ?? 0}`}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const grid = event.currentTarget.parentElement;
        if (grid === null) return;
        drag.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          initialGap: currentGap,
          grid,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (current === undefined || current.pointerId !== event.pointerId) return;
        const next = Math.max(0, snapEditorPixels(
          current.initialGap + (event.clientX - current.startX) / (rendererProps.pageScale ?? 1),
          rendererProps.snapping,
          rendererProps.snapSizePx,
        ));
        current.grid.style.columnGap = `${next}px`;
      }}
      onPointerUp={(event) => {
        const current = drag.current;
        if (current === undefined || current.pointerId !== event.pointerId) return;
        const next = Number.parseFloat(current.grid.style.columnGap);
        drag.current = undefined;
        if (Number.isFinite(next)) commit(next, true);
        rendererProps.store.breakHistoryGroup();
      }}
      onPointerCancel={() => {
        if (drag.current !== undefined) {
          drag.current.grid.style.columnGap = `${currentGap}px`;
          drag.current = undefined;
        }
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const base = rendererProps.snapping ? rendererProps.snapSizePx : 1;
        const amount = event.shiftKey ? base * 10 : base;
        commit(currentGap + (event.key === "ArrowRight" ? amount : -amount));
      }}
      onBlur={() => rendererProps.store.breakHistoryGroup()}
    />
  ))}</>;
}

function estimatedCanvasHeight(element: Extract<NativeElement, { type: "canvas" }>): number {
  return element.children.reduce((maximum, wrapper) => {
    const top = persistedLengthToEditorPixels(wrapper.y, 0);
    const explicitHeight = persistedLengthToEditorPixels(wrapper.element.height, 0);
    const fallbackHeight = wrapper.element.type === "image"
      ? 160
      : wrapper.element.type === "grid" || wrapper.element.type === "stack" || wrapper.element.type === "canvas"
        ? 120
        : 48;
    return Math.max(maximum, top + (explicitHeight > 0 ? explicitHeight : fallbackHeight));
  }, 160);
}

function CanvasElementContent({
  element,
  props,
}: {
  readonly element: Extract<NativeElement, { type: "canvas" }>;
  readonly props: ElementRendererProps;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const automatic = element.height === undefined || element.height === "auto";
  const [minimumHeight, setMinimumHeight] = useState(() => estimatedCanvasHeight(element));

  useLayoutEffect(() => {
    if (!automatic) return;
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const measure = () => {
      const scale = props.pageScale ?? 1;
      let measured = estimatedCanvasHeight(element);
      for (const child of canvas.querySelectorAll<HTMLElement>(":scope > .cbb-canvas-child")) {
        const top = Number.parseFloat(child.style.top || "0");
        measured = Math.max(measured, top + child.getBoundingClientRect().height / scale);
      }
      setMinimumHeight((current) => current === Math.ceil(measured) ? current : Math.ceil(measured));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    for (const child of canvas.querySelectorAll<HTMLElement>(":scope > .cbb-canvas-child")) observer.observe(child);
    return () => observer.disconnect();
  }, [automatic, element, props.pageScale]);

  return (
    <div
      ref={canvasRef}
      className="cbb-canvas-element"
      style={automatic ? { minHeight: minimumHeight } : { height: "100%" }}
    >
      {element.children.map((wrapper, index) => (
        <CanvasChild
          key={wrapper.id}
          wrapper={wrapper}
          paintIndex={index}
          rendererProps={{
            document: props.document,
            store: props.store,
            mode: props.mode,
            readOnly: props.readOnly,
            ...(props.selectedNodeId === undefined ? {} : { selectedNodeId: props.selectedNodeId }),
            ...(props.assetUrl === undefined ? {} : { assetUrl: props.assetUrl }),
            ...(props.onRequestImageReplacement === undefined ? {} : { onRequestImageReplacement: props.onRequestImageReplacement }),
            ...(props.fontFamily === undefined ? {} : { fontFamily: props.fontFamily }),
            snapping: props.snapping,
            snapSizePx: props.snapSizePx,
            ...(props.pageScale === undefined ? {} : { pageScale: props.pageScale }),
            ...(props.showReadingOrder === undefined ? {} : { showReadingOrder: props.showReadingOrder }),
            ...(props.onInsertScripture === undefined ? {} : { onInsertScripture: props.onInsertScripture }),
            spellcheckEnabled: props.spellcheckEnabled,
            spellingDictionary: props.spellingDictionary,
            ...(props.onAddSpellingDictionaryWord === undefined ? {} : { onAddSpellingDictionaryWord: props.onAddSpellingDictionaryWord }),
          }}
        />
      ))}
    </div>
  );
}

function contentForElement(props: ElementRendererProps, directEditRequest = 0): ReactNode {
  const { document, element, fragmentIndices } = props;
  switch (element.type) {
    case "text": {
      const addressable = findElementLocation(document, element.id) !== undefined;
      const decision = checkEditorCapability(document, props.mode, {
        capability: "content.edit",
        target: { kind: "node", nodeId: element.id },
      });
      return (
        <DirectTextEditor
          nodeId={element.id}
          content={props.resolved
            ? element.data.content ?? EMPTY_PLAIN_TEXT_CONTENT
            : effectiveTextContent(document, element)}
          editable={props.readOnly !== true && addressable && decision.allowed && props.contentProtectionReason === undefined}
          {...(props.readOnly !== true && addressable && decision.allowed && props.contentProtectionReason === undefined
            ? {}
            : { disabledReason: props.readOnly ? "This bulletin library is open read-only." : props.contentProtectionReason ?? (addressable && !decision.allowed ? decision.reason : "This content is generated from a saved section and is edited at its source.") })}
          store={props.store}
          selected={props.selectedNodeId === element.id}
          richFormattingAllowed={richFormattingAllowed(document, element)}
          editRequest={directEditRequest}
          {...(props.readOnly || props.onInsertScripture === undefined ? {} : { onInsertScripture: props.onInsertScripture })}
          {...(fragmentIndices === undefined ? {} : { fragmentIndices })}
          spellcheckEnabled={props.spellcheckEnabled}
          spellingDictionary={props.spellingDictionary}
          {...(props.onAddSpellingDictionaryWord === undefined ? {} : { onAddSpellingDictionaryWord: props.onAddSpellingDictionaryWord })}
        />
      );
    }
    case "image": {
      const assetRef = element.data.assetRef;
      const source = assetRef === undefined ? undefined : props.assetUrl?.(assetRef);
      const alt = element.data.decorative === true ? "" : element.data.alt ?? "Image description needed";
      const sourceLocation = findElementLocation(document, element.id);
      const boundedDestination = sourceLocation?.parent.kind === "page"
        ? sourceLocation.parent.wrapper.width !== "auto" &&
          sourceLocation.parent.wrapper.height !== "auto"
        : element.width !== undefined && element.width !== "auto" &&
          element.height !== undefined && element.height !== "auto";
      return source === undefined
        ? (
          <div className="cbb-image-placeholder">
            <div role="img" aria-label={alt || "Decorative image"}>
              <span aria-hidden="true">▧</span>
              <span>Image unavailable</span>
            </div>
            <button
              type="button"
              disabled={props.readOnly || props.onRequestImageReplacement === undefined || assetRef === undefined}
              title={props.readOnly
                ? "This bulletin library is open read-only."
                : assetRef === undefined
                  ? "This image is waiting for its connected weekly value."
                  : props.onRequestImageReplacement === undefined
                    ? "Image library is unavailable in this window."
                    : undefined}
              onClick={(event) => {
                event.stopPropagation();
                if (assetRef !== undefined) props.onRequestImageReplacement?.(element.id, assetRef);
              }}
            >Find replacement</button>
          </div>
        )
        : element.data.fit === "cover" && boundedDestination
          ? (
              <CoverFocalImage
                source={source}
                alt={alt}
                focalX={element.data.focalPoint?.x ?? 0.5}
                focalY={element.data.focalPoint?.y ?? 0.5}
                className="cbb-focal-cover"
              />
            )
          : <img src={source} alt={alt} style={{ objectFit: element.data.fit ?? "contain" }} />;
    }
    case "date": {
      const decision = checkEditorCapability(document, props.mode, {
        capability: "content.edit",
        target: { kind: "node", nodeId: element.id },
      });
      const addressable = findElementLocation(document, element.id) !== undefined;
      const value = element.data.value ?? "";
      const formatted = `${element.data.prefix ?? ""}${formatDate(value, element.data.format, element.data.locale)}${element.data.suffix ?? ""}`;
      return (
        <DirectDateEditor
          nodeId={element.id}
          value={value}
          formatted={formatted}
          editable={props.readOnly !== true && addressable && decision.allowed && props.contentProtectionReason === undefined}
          disabledReason={props.readOnly ? "This bulletin library is open read-only." : props.contentProtectionReason ?? (decision.allowed ? undefined : decision.reason)}
          store={props.store}
          editRequest={directEditRequest}
        />
      );
    }
    case "music":
      return <DirectMusicEditor props={{ ...props, element }} editRequest={directEditRequest} />;
    case "rightsAttribution":
      return props.generatedRights?.[element.id] === undefined
        ? (
        <section className="cbb-rights-block">
          <h2>{element.data.heading ?? "Copyrights & Permissions"}</h2>
          {element.data.introText === undefined ? null : <p>{element.data.introText}</p>}
          <p className="cbb-muted">Credit lines are generated from content used in this bulletin.</p>
        </section>
        )
        : (
          <section className="cbb-rights-block">
            {props.generatedRights[element.id]?.heading === undefined
              ? null
              : <h2>{props.generatedRights[element.id]?.heading}</h2>}
            {props.generatedRights[element.id]?.introText === undefined
              ? null
              : <p>{props.generatedRights[element.id]?.introText}</p>}
            {props.generatedRights[element.id]?.entries.map((entry) => (
              <p key={`${entry.creditKey}-${entry.firstAppearance}`}>
                {entry.lines.map((line, index) => (
                  <span key={index}>{index === 0 ? null : <br />}{line}</span>
                ))}
              </p>
            ))}
          </section>
        );
    case "grid": {
      const rows = fragmentIndices === undefined ? undefined : new Set(fragmentIndices);
      const rowGap = element.data.rowGap ?? element.data.cellPadding ?? 0;
      const columnGap = element.data.columnGap ?? element.data.cellPadding ?? 0;
      const rowGapPx = persistedLengthToEditorPixels(rowGap, typeof rowGap === "number" ? rowGap : 0);
      const childrenByCell = new Map(
        element.children.map((wrapper) => [`${wrapper.row}:${wrapper.column}`, wrapper] as const),
      );
      const visibleCells = Array.from({ length: element.data.rows }, (_, row) => row)
        .filter((row) => rows === undefined || rows.has(row))
        .flatMap((row) => Array.from({ length: element.data.columns }, (_, column) => ({ row, column })));
      return (
        <div
          className="cbb-grid-element"
          style={{
            gridTemplateColumns: element.data.columnTracks?.map(cssTrack).join(" ") ??
              `repeat(${element.data.columns}, minmax(0, 1fr))`,
            gridTemplateRows: element.data.rowTracks?.map(cssTrack).join(" ") ??
              `repeat(${element.data.rows}, auto)`,
            rowGap: cssLength(rowGap),
            columnGap: cssLength(columnGap),
          }}
        >
          <GridGutterHandles element={element} rendererProps={props} />
          {visibleCells.map(({ row, column }) => {
            const wrapper = childrenByCell.get(`${row}:${column}`);
            return wrapper === undefined
              ? (
                <button
                  key={`empty-${row}-${column}`}
                  type="button"
                  className="cbb-grid-cell cbb-grid-cell--empty"
                  data-cbb-fragment-index={row}
                  data-cbb-fragment-gap-before={row === 0 ? 0 : rowGapPx}
                  style={{ gridRow: row + 1, gridColumn: column + 1 }}
                  aria-label={`Empty grid cell, row ${row + 1}, column ${column + 1}. Select grid.`}
                  disabled={props.readOnly || props.mode !== "customizeLayout"}
                  onClick={(event) => {
                    event.stopPropagation();
                    props.store.setSelection({ kind: "node", nodeId: element.id, surface: "editor" });
                    props.onAnnouncement?.(`Selected empty cell in ${element.name}, row ${row + 1}, column ${column + 1}. Add content from Structure.`);
                  }}
                >
                  <span aria-hidden="true">Empty</span>
                </button>
              )
              : (
              <div
                key={wrapper.id}
                className="cbb-grid-cell"
                data-cbb-fragment-index={row}
                data-cbb-fragment-gap-before={row === 0 ? 0 : rowGapPx}
                style={{ gridRow: row + 1, gridColumn: column + 1 }}
              >
                <ElementRenderer {...props} element={wrapper.element} fragmentIndices={undefined} />
              </div>
              );
          })}
        </div>
      );
    }
    case "stack": {
      const indices = fragmentIndices === undefined ? undefined : new Set(fragmentIndices);
      const gapPx = persistedLengthToEditorPixels(
        element.data.gap,
        typeof element.data.gap === "number" ? element.data.gap : 0,
      );
      return (
        <div
          className={`cbb-stack-element cbb-stack-element--${element.data.direction}`}
          style={{ gap: cssLength(element.data.gap) }}
        >
          {element.children
            .map((wrapper, index) => ({ wrapper, index }))
            .filter(({ index }) => indices === undefined || indices.has(index))
            .map(({ wrapper, index }) => (
              <div
                data-cbb-fragment-index={index}
                data-cbb-fragment-gap-before={index === 0 ? 0 : gapPx}
                key={wrapper.id}
              >
                <ElementRenderer {...props} element={wrapper.element} fragmentIndices={undefined} />
              </div>
            ))}
        </div>
      );
    }
    case "canvas":
      return <CanvasElementContent element={element} props={props} />;
    case "pageBreak":
      return <div className="cbb-page-break-marker" role="separator">Page break</div>;
    case "customInstance":
      return (
        <div className="cbb-custom-placeholder">
          <strong>{element.name}</strong>
          <span>{TASK_LANGUAGE.savedSection}</span>
        </div>
      );
  }
}

export function ElementRenderer(props: ElementRendererProps) {
  const { element, store, mode, selectedNodeId } = props;
  const [directEditRequest, setDirectEditRequest] = useState(0);
  const [imageAspectLocked, setImageAspectLocked] = useState(true);
  const location = findElementLocation(props.document, element.id);
  const selected = selectedNodeId === element.id;
  const placementSelected = location !== undefined &&
    location.parent.kind !== "body" &&
    location.parent.wrapper.id === selectedNodeId;
  const resizeDecision = checkEditorCapability(props.document, mode, {
    capability: "layout.resize",
    target: {
      kind: "node",
      nodeId: location?.parent.kind === "page"
        ? location.parent.wrapper.id
        : element.id,
    },
  });
  const hasVisualResizeHandle = element.type === "image" ||
    location?.parent.kind === "canvas" ||
    location?.parent.kind === "page";
  const resizeEnabled = props.readOnly !== true && (selected || placementSelected) &&
    location !== undefined &&
    resizeDecision.allowed &&
    hasVisualResizeHandle;
  const canDrag = props.readOnly !== true && location !== undefined &&
    location.parent.kind !== "page" &&
    checkEditorCapability(props.document, mode, {
      capability: "layout.editStructure",
      target: { kind: "node", nodeId: element.id },
    }).allowed;

  function startElementDrag(event: DragEvent<HTMLElement>): void {
    if (!canDrag) {
      event.preventDefault();
      return;
    }
    event.stopPropagation();
    writeEditorDragSource(event.dataTransfer, { kind: "node", nodeId: element.id });
    store.setSelection({ kind: "node", nodeId: element.id, surface: "editor" });
    props.onAnnouncement?.(`${element.name} picked up. Choose a highlighted destination.`);
  }
  return (
    <article
      className={`cbb-editor-element${selected ? " is-selected" : ""}`}
      data-node-id={element.id}
      data-element-type={element.type}
      style={elementStyle(element, props.fontFamily)}
      draggable={canDrag}
      tabIndex={0}
      aria-label={`${element.name}, ${element.type}`}
      onDragStart={startElementDrag}
      onDragEnd={(event) => {
        event.stopPropagation();
        setActiveEditorDragSource(undefined);
      }}
        onClick={(event) => {
          event.stopPropagation();
          store.setSelection({ kind: "node", nodeId: element.id, surface: "editor" });
          if (props.selectionContext !== undefined) {
            props.onAnnouncement?.(`Selected ${element.name}. ${props.selectionContext}`);
          }
        }}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === "F2") && event.currentTarget === event.target) {
          event.preventDefault();
          store.setSelection({ kind: "node", nodeId: element.id, surface: "editor" });
          if (element.type === "text" || element.type === "date" || element.type === "music") {
            setDirectEditRequest((value) => value + 1);
          }
        }
      }}
    >
      <ResizeFrame
        nodeId={element.id}
        store={store}
        enabled={resizeEnabled}
        snapping={props.snapping}
        snapSizePx={props.snapSizePx}
        preserveAspect={element.type === "image" && imageAspectLocked}
        scale={props.pageScale ?? 1}
        anchor={location?.parent.kind === "page" ? location.parent.wrapper.anchor : "topLeft"}
      >
        {contentForElement(props, directEditRequest)}
      </ResizeFrame>
      {resizeEnabled && element.type === "image"
        ? (
          <label
            className="cbb-resize-aspect-lock"
            onClick={(event) => event.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={imageAspectLocked}
              onChange={(event) => setImageAspectLocked(event.currentTarget.checked)}
            />
            Keep image proportions
          </label>
        )
        : null}
      {props.fragmentIndices === undefined || props.fragmentIndices.length === 0
        ? null
        : <span className="cbb-fragment-label">Continued content</span>}
    </article>
  );
}
