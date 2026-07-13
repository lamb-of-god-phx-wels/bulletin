import {
  classifyBreakBehavior,
  fromInt,
  lengthToEditorPixels,
  paginateMeasuredFlow,
  parseLength,
  type CbbDocument,
  type MeasuredFlowBlock,
  type MeasuredFlowItem,
  type MeasuredFragment,
  type NativeElement,
  type PaginationFinding,
} from "@cbb/core";
import {
  createEditorRenderModel,
  type EditorRenderModel,
} from "./renderModel.js";

export interface EditorFragmentMeasurement {
  readonly heightPx: number;
  readonly gapBeforePx?: number;
}

export interface EditorElementMeasurement {
  readonly heightPx?: number;
  readonly fragments?: readonly EditorFragmentMeasurement[];
}

export type EditorMeasurementMap = Readonly<Record<string, EditorElementMeasurement>>;

export interface EditorPageMetrics {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly contentHeightPx: number;
  readonly marginTopPx: number;
  readonly marginRightPx: number;
  readonly marginBottomPx: number;
  readonly marginLeftPx: number;
}

export interface EditorPageItem {
  readonly nodeId: string;
  readonly fragmentIndices: readonly number[];
  readonly overflow: boolean;
}

export interface EditorPagePlan {
  readonly pageNumber: number;
  readonly kind: "content" | "intentionalBlank";
  readonly items: readonly EditorPageItem[];
}

export interface EditorPaginationPlan {
  readonly metrics: EditorPageMetrics;
  readonly pages: readonly EditorPagePlan[];
  readonly findings: readonly PaginationFinding[];
  readonly resolutionFindings: readonly string[];
  readonly hasBlockingFindings: boolean;
}

function absolutePixels(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  try {
    const parsed = parseLength(value);
    return parsed.kind === "absolute"
      ? Math.max(0, Number(lengthToEditorPixels(parsed)))
      : fallback;
  } catch {
    return fallback;
  }
}

export function editorPageMetrics(
  document: CbbDocument,
  pageNumber = 1,
): EditorPageMetrics {
  const widthPx = absolutePixels(document.page.typstWidth, 672);
  const heightPx = absolutePixels(document.page.typstHeight, 816);
  const margins = document.page.margins;
  const marginTopPx = absolutePixels(margins?.top, 0);
  const marginBottomPx = absolutePixels(margins?.bottom, 0);
  const mirrored = document.page.marginMode === "mirrored";
  const oddPage = pageNumber % 2 === 1;
  const innerIsLeft = document.page.binding === "right" ? !oddPage : oddPage;
  const innerPx = absolutePixels(margins?.inner, 0);
  const outerPx = absolutePixels(margins?.outer, 0);
  const marginLeftPx = mirrored
    ? innerIsLeft ? innerPx : outerPx
    : absolutePixels(margins?.left, 0);
  const marginRightPx = mirrored
    ? innerIsLeft ? outerPx : innerPx
    : absolutePixels(margins?.right, 0);
  return {
    widthPx,
    heightPx,
    contentHeightPx: Math.max(1, heightPx - marginTopPx - marginBottomPx),
    marginTopPx,
    marginRightPx,
    marginBottomPx,
    marginLeftPx,
  };
}

function richBlockCount(
  element: Extract<NativeElement, { type: "text" }>,
): number {
  const content = element.data.content;
  if (content === undefined) return 1;
  return content.kind === "richText"
    ? Math.max(1, content.document?.blocks.length ?? 0)
    : Math.max(1, (content.text ?? "").split(/\r?\n/u).length);
}

function subject(element: NativeElement) {
  switch (element.type) {
    case "text":
      return { kind: "text" as const };
    case "image":
      return { kind: "image" as const };
    case "date":
      return { kind: "date" as const };
    case "music":
      return { kind: "music" as const, hasRichContent: element.data.richContent !== undefined };
    case "rightsAttribution":
      return { kind: "rightsAttribution" as const, entryCount: 1 };
    case "grid":
      return { kind: "grid" as const, rowCount: element.data.rows };
    case "stack":
      return { kind: "stack" as const, direction: element.data.direction };
    case "canvas":
      return { kind: "canvas" as const };
    case "pageBreak":
      return {
        kind: "pageBreak" as const,
        intent: element.data.intent ?? "flowBreak" as const,
      };
    case "customInstance":
      return { kind: "expandedCustomRoots" as const, rootCount: 1 };
  }
}

function estimateFragmentHeights(
  element: NativeElement,
): readonly number[] {
  if (element.type === "text") {
    return Array.from({ length: richBlockCount(element) }, () => 28);
  }
  if (element.type === "grid") {
    return Array.from({ length: Math.max(1, element.data.rows) }, () => 72);
  }
  if (element.type === "stack" && element.data.direction === "vertical") {
    return element.children.length === 0
      ? [32]
      : element.children.map((child) => estimateHeight(child.element));
  }
  if (element.type === "music" && element.data.richContent !== undefined) {
    return Array.from(
      { length: Math.max(1, element.data.richContent.blocks.length) },
      (_, index) => index === 0 ? 64 : 28,
    );
  }
  return [estimateHeight(element)];
}

function estimateHeight(element: NativeElement): number {
  if (typeof element.height === "number") return Math.max(1, element.height);
  if (typeof element.height === "string" && element.height !== "auto") {
    return Math.max(1, absolutePixels(element.height, 80));
  }
  switch (element.type) {
    case "text":
      return richBlockCount(element) * 28;
    case "image":
      return 220;
    case "date":
      return 40;
    case "music":
      return 96 + (element.data.richContent?.blocks.length ?? 0) * 28;
    case "rightsAttribution":
      return 112;
    case "grid":
      return Math.max(1, element.data.rows) * 72;
    case "stack":
      return element.data.direction === "vertical"
        ? Math.max(32, element.children.reduce((sum, child) => sum + estimateHeight(child.element), 0))
        : Math.max(80, ...element.children.map((child) => estimateHeight(child.element)));
    case "canvas":
      return 280;
    case "pageBreak":
      return 1;
    case "customInstance":
      return 120;
  }
}

function measuredItem(
  element: NativeElement,
  measurements: EditorMeasurementMap,
  blockId = element.id,
): MeasuredFlowItem {
  const classification = classifyBreakBehavior(subject(element), {
    fixedHeight:
      element.height !== undefined && element.height !== "auto",
  });
  if (classification.mode === "pageBreak") {
    return { kind: "pageBreak", id: blockId, intent: classification.intent };
  }

  const supplied = measurements[blockId] ?? measurements[element.id];
  const estimated = estimateFragmentHeights(element);
  const descriptors: readonly EditorFragmentMeasurement[] =
    supplied?.fragments ?? estimated.map((heightPx) => ({ heightPx }));
  const totalHeight = supplied?.heightPx ?? descriptors.reduce(
    (sum, fragment) => sum + fragment.heightPx + (fragment.gapBeforePx ?? 0),
    0,
  );
  const breakable = classification.mode === "breakable";
  const fragments: readonly MeasuredFragment[] = breakable
    ? descriptors.map((fragment, index) => ({
        id: `${blockId}:fragment:${index}`,
        role:
          element.type === "grid"
            ? "gridRow"
            : element.type === "stack"
              ? "stackChild"
              : element.type === "rightsAttribution"
                ? "rightsEntry"
                : element.type === "text"
                  ? "textLine"
                  : "atomic",
        height: fromInt(Math.max(1, Math.round(fragment.heightPx))),
        ...(fragment.gapBeforePx === undefined
          ? {}
          : { gapBefore: fromInt(Math.max(0, Math.round(fragment.gapBeforePx))) }),
      }))
    : [{
        id: `${blockId}:fragment:0`,
        role: "atomic",
        height: fromInt(Math.max(1, Math.round(totalHeight))),
      }];

  return {
    kind: "block",
    id: blockId,
    fragmentation: breakable ? "breakable" : "unbreakable",
    ...(element.breakPolicy === undefined ? {} : { breakPolicy: element.breakPolicy }),
    fragments,
  } satisfies MeasuredFlowBlock;
}

function fragmentIndex(fragmentId: string): number {
  const raw = fragmentId.slice(fragmentId.lastIndexOf(":") + 1);
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function paginateEditorDocument(
  document: CbbDocument,
  measurements: EditorMeasurementMap = {},
  renderModel: EditorRenderModel = createEditorRenderModel(document),
): EditorPaginationPlan {
  const metrics = editorPageMetrics(document);
  const result = paginateMeasuredFlow(
    renderModel.elements.map((node) => measuredItem(node.element, measurements, node.renderId)),
    { pageContentHeight: fromInt(metrics.contentHeightPx) },
  );
  const pages = result.pages.map((page): EditorPagePlan => {
    const grouped = new Map<string, { indices: number[]; overflow: boolean }>();
    for (const placement of page.placements) {
      const current = grouped.get(placement.blockId) ?? { indices: [], overflow: false };
      current.indices.push(fragmentIndex(placement.fragmentId));
      current.overflow ||= placement.overflow;
      grouped.set(placement.blockId, current);
    }
    return {
      pageNumber: page.pageNumber,
      kind: page.kind,
      items: [...grouped].map(([nodeId, value]) => ({
        nodeId,
        fragmentIndices: value.indices,
        overflow: value.overflow,
      })),
    };
  });
  return {
    metrics,
    pages,
    findings: result.findings,
    resolutionFindings: renderModel.findings,
    hasBlockingFindings: result.hasBlockingFindings,
  };
}
