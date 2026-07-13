import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import type { CbbDocument, IdPort, PageLevelWrapper, TextContent } from "@cbb/core";
import { findElementLocation } from "../store/commands/index.js";
import type { EditorStore } from "../store/editorStore.js";
import type { EditorMode } from "../store/types.js";
import { ElementRenderer } from "./ElementRenderer.js";
import { EditorFlowDropZone } from "./EditorFlowDropZone.js";
import {
  createEditorRenderModel,
  type EditorRenderPageElement,
} from "./renderModel.js";
import {
  editorPageMetrics,
  paginateEditorDocument,
  type EditorElementMeasurement,
  type EditorMeasurementMap,
  type EditorPageMetrics,
} from "./pagination.js";

export type EditorViewMode = "page" | "contiguous";

export interface EditorViewProps {
  readonly document: CbbDocument;
  readonly store: EditorStore;
  readonly idPort: IdPort;
  readonly mode: EditorMode;
  readonly readOnly?: boolean | undefined;
  readonly selectedNodeId?: string | undefined;
  readonly showMarginGuides: boolean;
  readonly snapping: boolean;
  readonly showReadingOrder: boolean;
  readonly snapSizePx: number;
  readonly zoom: number;
  readonly pagePresentation?: "single" | "facing" | undefined;
  readonly measurements?: EditorMeasurementMap | undefined;
  readonly assetUrl?: ((assetRef: string) => string | undefined) | undefined;
  readonly onRequestImageReplacement?: ((nodeId: string, currentAssetRef: string) => void) | undefined;
  readonly fontFamily?: ((fontRef: string) => string | undefined) | undefined;
  readonly onInsertScripture?: ((nodeId: string, content: TextContent) => void) | undefined;
  readonly spellcheckEnabled: boolean;
  readonly spellingDictionary: readonly string[];
  readonly onAddSpellingDictionaryWord?: ((word: string) => Promise<string>) | undefined;
  readonly onAnnouncement?: ((message: string) => void) | undefined;
}

function marginGuideStyle(metrics: EditorPageMetrics): CSSProperties {
  return {
    top: metrics.marginTopPx,
    right: metrics.marginRightPx,
    bottom: metrics.marginBottomPx,
    left: metrics.marginLeftPx,
  };
}

function targetMatches(wrapper: PageLevelWrapper, pageNumber: number, pageCount: number): boolean {
  switch (wrapper.target.mode) {
    case "all":
      return true;
    case "first":
      return pageNumber === 1;
    case "last":
      return pageNumber === pageCount;
    case "odd":
      return pageNumber % 2 === 1;
    case "even":
      return pageNumber % 2 === 0;
    case "range":
      return pageNumber >= wrapper.target.start && pageNumber <= wrapper.target.end;
    case "pages":
      return wrapper.target.pages.includes(pageNumber);
  }
}

function anchorTransform(anchor: PageLevelWrapper["anchor"]): string {
  const horizontal = anchor.endsWith("Center") || anchor === "center" ? "-50%" : anchor.endsWith("Right") ? "-100%" : "0";
  const vertical = anchor.startsWith("center") ? "-50%" : anchor.startsWith("bottom") ? "-100%" : "0";
  return `translate(${horizontal}, ${vertical})`;
}

function pageElementStyle(wrapper: PageLevelWrapper): CSSProperties {
  return {
    position: "absolute",
    left: wrapper.x,
    top: wrapper.y,
    width: wrapper.width === "auto" ? undefined : wrapper.width,
    height: wrapper.height === "auto" ? undefined : wrapper.height,
    zIndex: wrapper.zIndex,
    overflow: "hidden",
    transform: anchorTransform(wrapper.anchor),
    pointerEvents: "auto",
  };
}

function pagePreviewElement(wrapper: PageLevelWrapper, pageNumber: number) {
  return wrapper.purpose === "pageNumber" && wrapper.element.type === "text"
    ? {
        ...wrapper.element,
        data: { content: { kind: "plain" as const, text: String(pageNumber) } },
      }
    : wrapper.element;
}

function pageRegionStyle(
  region: PageLevelWrapper["region"],
  metrics: EditorPageMetrics,
  clip: boolean,
): CSSProperties {
  const contentWidth = Math.max(0, metrics.widthPx - metrics.marginLeftPx - metrics.marginRightPx);
  const contentHeight = Math.max(0, metrics.heightPx - metrics.marginTopPx - metrics.marginBottomPx);
  const rectangles: Record<PageLevelWrapper["region"], CSSProperties> = {
    page: { left: 0, top: 0, width: metrics.widthPx, height: metrics.heightPx },
    content: {
      left: metrics.marginLeftPx,
      top: metrics.marginTopPx,
      width: contentWidth,
      height: contentHeight,
    },
    topMargin: { left: metrics.marginLeftPx, top: 0, width: contentWidth, height: metrics.marginTopPx },
    bottomMargin: {
      left: metrics.marginLeftPx,
      top: metrics.heightPx - metrics.marginBottomPx,
      width: contentWidth,
      height: metrics.marginBottomPx,
    },
    leftMargin: { left: 0, top: metrics.marginTopPx, width: metrics.marginLeftPx, height: contentHeight },
    rightMargin: {
      left: metrics.widthPx - metrics.marginRightPx,
      top: metrics.marginTopPx,
      width: metrics.marginRightPx,
      height: contentHeight,
    },
  };
  return {
    position: "absolute",
    ...rectangles[region],
    overflow: clip ? "hidden" : "visible",
    pointerEvents: "none",
  };
}

function PageLayers({
  props,
  pageNumber,
  pageCount,
  layer,
  metrics,
  pageElements,
  rightsBlocks,
}: {
  readonly props: EditorViewProps;
  readonly pageNumber: number;
  readonly pageCount: number;
  readonly layer: "background" | "underlay" | "overlay";
  readonly metrics: EditorPageMetrics;
  readonly pageElements: readonly EditorRenderPageElement[];
  readonly rightsBlocks: ReturnType<typeof createEditorRenderModel>["rightsBlocks"];
}) {
  return (
    <div role="group" className={`cbb-page-layer cbb-page-layer--${layer}`} aria-label={`${layer} page items`}>
      {pageElements
        .filter(({ wrapper }) => wrapper.layer === layer && targetMatches(wrapper, pageNumber, pageCount))
        .map(({ renderId, wrapper }) => (
          <div
            className={`cbb-page-region${props.selectedNodeId === wrapper.id ? " is-selected" : ""}`}
            key={renderId}
            data-page-region={wrapper.region}
            data-clip-to-region={wrapper.clipToRegion ? "true" : "false"}
            style={pageRegionStyle(wrapper.region, metrics, wrapper.clipToRegion)}
          >
            <div style={pageElementStyle(wrapper)}>
              {props.showReadingOrder
                ? (
                  <span className="cbb-reading-order-badge">
                    {wrapper.semantic.mode === "artifact"
                      ? "Decorative — skipped in reading order"
                      : `${wrapper.semantic.readingOrder === "beforeBody" ? "Before body" : "After body"} ${wrapper.semantic.order + 1}`}
                  </span>
                )
                : null}
              <button
                type="button"
                className="cbb-page-placement-handle"
                aria-label={`Select placement for ${wrapper.element.name}`}
                aria-pressed={props.selectedNodeId === wrapper.id}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onAnnouncement?.(`Selected ${wrapper.element.name} placement on page ${pageNumber}.`);
                  props.store.setSelection({ kind: "node", nodeId: wrapper.id, surface: "editor" });
                }}
              >
                Placement
              </button>
              <ElementRenderer
                document={props.document}
                element={pagePreviewElement(wrapper, pageNumber)}
                store={props.store}
                mode={props.mode}
                readOnly={props.readOnly}
                selectedNodeId={props.selectedNodeId}
                assetUrl={props.assetUrl}
                onRequestImageReplacement={props.onRequestImageReplacement}
                fontFamily={props.fontFamily}
                snapping={props.snapping}
                snapSizePx={props.snapSizePx}
                pageScale={props.zoom}
                showReadingOrder={props.showReadingOrder}
                resolved
                {...(wrapper.purpose === "pageNumber"
                  ? { contentProtectionReason: "Page numbers are generated from the current page and are edited through their placement settings." }
                  : {})}
                selectionContext={`Page ${pageNumber}`}
                onAnnouncement={props.onAnnouncement}
                generatedRights={rightsBlocks}
                {...(props.onInsertScripture === undefined ? {} : { onInsertScripture: props.onInsertScripture })}
                spellcheckEnabled={props.spellcheckEnabled}
                spellingDictionary={props.spellingDictionary}
                {...(props.onAddSpellingDictionaryWord === undefined ? {} : { onAddSpellingDictionaryWord: props.onAddSpellingDictionaryWord })}
              />
            </div>
          </div>
        ))}
    </div>
  );
}

function sameMeasurements(
  left: EditorMeasurementMap,
  right: EditorMeasurementMap,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function useDomMeasurements(
  rootRef: RefObject<HTMLDivElement | null>,
  zoom: number,
): EditorMeasurementMap {
  const [measurements, setMeasurements] = useState<EditorMeasurementMap>({});
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const measure = () => {
      const byId = new Map<string, {
        heightPx: number;
        fragments: Map<number, { heightPx: number; gapBeforePx: number }>;
      }>();
      for (const flow of root.querySelectorAll<HTMLElement>("[data-flow-node-id]")) {
        const nodeId = flow.dataset["flowNodeId"];
        if (nodeId === undefined) continue;
        const current = byId.get(nodeId) ?? { heightPx: 0, fragments: new Map() };
        current.heightPx = Math.max(current.heightPx, flow.getBoundingClientRect().height / zoom);
        const fragments = [...flow.querySelectorAll<HTMLElement>("[data-cbb-fragment-index]")]
          .filter((fragment) => {
            if (fragment.closest("[data-flow-node-id]") !== flow) return false;
            const parent = fragment.parentElement?.closest("[data-cbb-fragment-index]");
            return parent == null || !flow.contains(parent);
          });
        for (const fragment of fragments) {
          const index = Number(fragment.dataset["cbbFragmentIndex"]);
          if (!Number.isSafeInteger(index) || index < 0) continue;
          const computed = getComputedStyle(fragment);
          const verticalMargins = Number.parseFloat(computed.marginTop || "0") +
            Number.parseFloat(computed.marginBottom || "0");
          const height = fragment.getBoundingClientRect().height / zoom + verticalMargins;
          const gapBeforePx = Number(fragment.dataset["cbbFragmentGapBefore"] ?? 0);
          const prior = current.fragments.get(index);
          current.fragments.set(index, {
            heightPx: Math.max(prior?.heightPx ?? 0, height),
            gapBeforePx: Math.max(
              prior?.gapBeforePx ?? 0,
              Number.isFinite(gapBeforePx) ? Math.max(0, gapBeforePx) : 0,
            ),
          });
        }
        byId.set(nodeId, current);
      }
      const next: Record<string, EditorElementMeasurement> = {};
      for (const [nodeId, entry] of [...byId].sort(([left], [right]) => left.localeCompare(right))) {
        const fragmentEntries = [...entry.fragments].sort(([left], [right]) => left - right);
        next[nodeId] = {
          heightPx: Math.max(1, entry.heightPx),
          ...(fragmentEntries.length === 0
            ? {}
            : {
                fragments: Array.from(
                  { length: (fragmentEntries.at(-1)?.[0] ?? -1) + 1 },
                  (_, index) => {
                    const fragment = entry.fragments.get(index);
                    return {
                      heightPx: Math.max(1, fragment?.heightPx ?? 1),
                      ...(fragment === undefined ? {} : { gapBeforePx: fragment.gapBeforePx }),
                    };
                  },
                ),
              }),
        };
      }
      setMeasurements((current) => sameMeasurements(current, next) ? current : next);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    for (const element of root.querySelectorAll<HTMLElement>("[data-flow-node-id], [data-cbb-fragment-index]")) {
      observer.observe(element);
    }
    return () => observer.disconnect();
  });
  return measurements;
}

export function PageView(props: EditorViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const domMeasurements = useDomMeasurements(rootRef, props.zoom);
  const renderModel = useMemo(() => createEditorRenderModel(props.document), [props.document]);
  const effectiveMeasurements = useMemo(
    () => ({ ...domMeasurements, ...props.measurements }),
    [domMeasurements, props.measurements],
  );
  const plan = useMemo(
    () => paginateEditorDocument(props.document, effectiveMeasurements, renderModel),
    [effectiveMeasurements, props.document, renderModel],
  );
  const elements = new Map(renderModel.elements.map((node) => [node.renderId, node]));
  const renderPage = (page: (typeof plan.pages)[number]) => {
    const pageMetrics = editorPageMetrics(props.document, page.pageNumber);
    return (
    <section
      className="cbb-scaled-page"
      key={page.pageNumber}
      aria-label={`Page ${page.pageNumber}${page.kind === "intentionalBlank" ? ", intentionally blank" : ""}`}
      style={{
        width: plan.metrics.widthPx * props.zoom,
        height: plan.metrics.heightPx * props.zoom,
      }}
    >
      <div
        className="cbb-editor-page"
        style={{
          width: plan.metrics.widthPx,
          height: plan.metrics.heightPx,
          transform: `scale(${props.zoom})`,
          background: props.document.page.background ?? "#ffffff",
        }}
      >
        <PageLayers props={props} pageNumber={page.pageNumber} pageCount={plan.pages.length} layer="background" metrics={pageMetrics} pageElements={renderModel.pageElements} rightsBlocks={renderModel.rightsBlocks} />
        <PageLayers props={props} pageNumber={page.pageNumber} pageCount={plan.pages.length} layer="underlay" metrics={pageMetrics} pageElements={renderModel.pageElements} rightsBlocks={renderModel.rightsBlocks} />
        {props.showMarginGuides
          ? <div className="cbb-margin-guides" style={marginGuideStyle(pageMetrics)} aria-hidden="true" />
          : null}
        <div
          className="cbb-page-content"
          style={{
            paddingTop: pageMetrics.marginTopPx,
            paddingRight: pageMetrics.marginRightPx,
            paddingBottom: pageMetrics.marginBottomPx,
            paddingLeft: pageMetrics.marginLeftPx,
          }}
        >
          {page.kind === "intentionalBlank"
            ? <p className="cbb-intentional-blank">Intentionally blank</p>
            : page.items.map((item) => {
                const renderNode = elements.get(item.nodeId);
                const sourceLocation = renderNode === undefined || renderNode.derived
                  ? undefined
                  : findElementLocation(props.document, renderNode.sourceNodeId);
                const bodyIndex = sourceLocation?.parent.kind === "body"
                  ? sourceLocation.parent.index
                  : undefined;
                return renderNode === undefined
                  ? null
                  : (
                    <div
                      key={item.nodeId}
                      data-flow-node-id={item.nodeId}
                      className={`cbb-editor-flow-item${item.overflow ? " has-overflow" : ""}`}
                    >
                      {bodyIndex === undefined || props.readOnly
                        ? null
                        : (
                          <EditorFlowDropZone
                            document={props.document}
                            store={props.store}
                            mode={props.mode}
                            idPort={props.idPort}
                            targetIndex={bodyIndex}
                            label={`Drop before ${renderNode.element.name}`}
                            edge="before"
                            onAnnouncement={props.onAnnouncement}
                          />
                        )}
                      <ElementRenderer
                        document={props.document}
                        element={renderNode.element}
                        store={props.store}
                        mode={props.mode}
                        readOnly={props.readOnly}
                        selectedNodeId={props.selectedNodeId}
                        fragmentIndices={item.fragmentIndices}
                        assetUrl={props.assetUrl}
                        onRequestImageReplacement={props.onRequestImageReplacement}
                        fontFamily={props.fontFamily}
                        snapping={props.snapping}
                        snapSizePx={props.snapSizePx}
                        pageScale={props.zoom}
                        showReadingOrder={props.showReadingOrder}
                        resolved
                        {...(renderNode.derived
                          ? { contentProtectionReason: "This occurrence comes from a repeated weekly row or a Saved Section. Edit that weekly row or the original Saved Section." }
                          : {})}
                        {...(renderNode.contextLabel === undefined ? {} : { selectionContext: renderNode.contextLabel })}
                        onAnnouncement={props.onAnnouncement}
                        generatedRights={renderModel.rightsBlocks}
                        {...(props.onInsertScripture === undefined ? {} : { onInsertScripture: props.onInsertScripture })}
                        spellcheckEnabled={props.spellcheckEnabled}
                        spellingDictionary={props.spellingDictionary}
                        {...(props.onAddSpellingDictionaryWord === undefined ? {} : { onAddSpellingDictionaryWord: props.onAddSpellingDictionaryWord })}
                      />
                      {item.overflow
                        ? (
                          <div
                            className="cbb-overflow-marker"
                            role="note"
                            aria-label={`Overflow for ${renderNode.element.name}`}
                          >
                            <strong>{renderNode.element.name} does not fit this page.</strong>
                            <span>{props.mode === "customizeLayout"
                              ? "Allow automatic height, resize it, or move it to the next page."
                              : "Open Customize Layout to resize or move it."}</span>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                props.store.setSelection({ kind: "node", nodeId: renderNode.sourceNodeId, surface: "editor" });
                                props.onAnnouncement?.(`Selected ${renderNode.element.name}, which does not fit on page ${page.pageNumber}.`);
                              }}
                            >Go to item</button>
                          </div>
                        )
                        : null}
                      {bodyIndex === undefined || props.readOnly
                        ? null
                        : (
                          <EditorFlowDropZone
                            document={props.document}
                            store={props.store}
                            mode={props.mode}
                            idPort={props.idPort}
                            targetIndex={bodyIndex + 1}
                            label={`Drop after ${renderNode.element.name}`}
                            edge="after"
                            onAnnouncement={props.onAnnouncement}
                          />
                        )}
                    </div>
                  );
              })}
        </div>
        <PageLayers props={props} pageNumber={page.pageNumber} pageCount={plan.pages.length} layer="overlay" metrics={pageMetrics} pageElements={renderModel.pageElements} rightsBlocks={renderModel.rightsBlocks} />
      </div>
    </section>
    );
  };
  const facingRows = plan.pages.reduce<{
    readonly left?: (typeof plan.pages)[number];
    readonly right?: (typeof plan.pages)[number];
  }[]>((rows, page, index) => {
    const oddOnLeft = props.document.page.binding === "right";
    const side = page.pageNumber % 2 === 1
      ? oddOnLeft ? "left" : "right"
      : oddOnLeft ? "right" : "left";
    const row = rows.at(-1);
    if (index === 0 || row?.[side] !== undefined) rows.push({ [side]: page });
    else rows[rows.length - 1] = { ...row, [side]: page };
    return rows;
  }, []);
  return (
    <div
      ref={rootRef}
      className={`cbb-page-view${props.pagePresentation === "facing" ? " cbb-page-view--facing" : ""}`}
      role="region"
      aria-label="Page View"
    >
      {props.pagePresentation === "facing"
        ? facingRows.map((row, index) => (
            <div className="cbb-facing-row" key={index}>
              {row.left === undefined
                ? <div role="note" className="cbb-facing-spacer" aria-label="Editor-only blank facing-page slot" style={{ width: plan.metrics.widthPx * props.zoom, height: plan.metrics.heightPx * props.zoom }}>No document page</div>
                : renderPage(row.left)}
              {row.right === undefined
                ? <div role="note" className="cbb-facing-spacer" aria-label="Editor-only blank facing-page slot" style={{ width: plan.metrics.widthPx * props.zoom, height: plan.metrics.heightPx * props.zoom }}>No document page</div>
                : renderPage(row.right)}
            </div>
          ))
        : plan.pages.map(renderPage)}
      {plan.findings.length === 0 && plan.resolutionFindings.length === 0
        ? null
        : (
          <aside className="cbb-pagination-findings" aria-label="Page layout notices">
            {plan.findings.map((finding, index) => (
              <p key={`${finding.kind}-${index}`}>
                {finding.severity === "error" ? "Needs attention: " : "Note: "}
                {finding.kind === "avoidFallback"
                  ? "Content marked keep together had to continue on the next page."
                  : finding.kind === "pageCapExceeded"
                    ? "The bulletin exceeds the supported page count."
                    : "Some content cannot fit within the finished page."}
              </p>
            ))}
            {plan.resolutionFindings.map((finding, index) => (
              <p key={`resolution-${index}`}>Needs attention: {finding}</p>
            ))}
          </aside>
        )}
    </div>
  );
}

export function ContiguousView(props: EditorViewProps) {
  const renderModel = useMemo(() => createEditorRenderModel(props.document), [props.document]);
  const metrics = useMemo(
    () => paginateEditorDocument(props.document, {}, renderModel).metrics,
    [props.document, renderModel],
  );
  return (
    <section
      className="cbb-scaled-contiguous-view"
      aria-label="Contiguous View"
      style={{ width: metrics.widthPx * props.zoom }}
    >
      <div
        className="cbb-contiguous-view"
        style={{ width: metrics.widthPx, transform: `scale(${props.zoom})` }}
      >
        {props.showMarginGuides
          ? (
            <div className="cbb-contiguous-margin-guide" aria-label="Margin guides visible">
              Finished-page margins are shown in Page View
            </div>
          )
          : null}
        {renderModel.elements.map((renderNode) => {
          const sourceLocation = renderNode.derived
            ? undefined
            : findElementLocation(props.document, renderNode.sourceNodeId);
          const bodyIndex = sourceLocation?.parent.kind === "body"
            ? sourceLocation.parent.index
            : undefined;
          return (
            <div className="cbb-editor-flow-item" key={renderNode.renderId}>
              {bodyIndex === undefined || props.readOnly
                ? null
                : (
                  <EditorFlowDropZone
                    document={props.document}
                    store={props.store}
                    mode={props.mode}
                    idPort={props.idPort}
                    targetIndex={bodyIndex}
                    label={`Drop before ${renderNode.element.name}`}
                    edge="before"
                    onAnnouncement={props.onAnnouncement}
                  />
                )}
              <ElementRenderer
                document={props.document}
                element={renderNode.element}
                store={props.store}
                mode={props.mode}
                readOnly={props.readOnly}
                selectedNodeId={props.selectedNodeId}
                assetUrl={props.assetUrl}
                onRequestImageReplacement={props.onRequestImageReplacement}
                fontFamily={props.fontFamily}
                snapping={props.snapping}
                snapSizePx={props.snapSizePx}
                pageScale={props.zoom}
                showReadingOrder={props.showReadingOrder}
                resolved
                {...(renderNode.derived
                  ? { contentProtectionReason: "This occurrence comes from a repeated weekly row or a Saved Section. Edit that weekly row or the original Saved Section." }
                  : {})}
                {...(renderNode.contextLabel === undefined ? {} : { selectionContext: renderNode.contextLabel })}
                onAnnouncement={props.onAnnouncement}
                generatedRights={renderModel.rightsBlocks}
                {...(props.onInsertScripture === undefined ? {} : { onInsertScripture: props.onInsertScripture })}
                spellcheckEnabled={props.spellcheckEnabled}
                spellingDictionary={props.spellingDictionary}
                {...(props.onAddSpellingDictionaryWord === undefined ? {} : { onAddSpellingDictionaryWord: props.onAddSpellingDictionaryWord })}
              />
              {bodyIndex === undefined || props.readOnly
                ? null
                : (
                  <EditorFlowDropZone
                    document={props.document}
                    store={props.store}
                    mode={props.mode}
                    idPort={props.idPort}
                    targetIndex={bodyIndex + 1}
                    label={`Drop after ${renderNode.element.name}`}
                    edge="after"
                    onAnnouncement={props.onAnnouncement}
                  />
                )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
