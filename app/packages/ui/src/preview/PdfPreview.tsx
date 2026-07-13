import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Banner, Button, LiveRegion } from "../design-system/index.js";
import type {
  PdfDocumentPort,
  PdfPreviewLoader,
  PdfRenderTaskPort,
} from "./pdfLoader.js";
import {
  pageForResolvedSource,
  pageForSource,
  validPageNumber,
  type PdfPreviewArtifact,
  type PdfPreviewHandle,
  type PdfPreviewNavigationMap,
  type PdfPreviewNavigationReason,
  type PdfPreviewPageChange,
  type PdfPreviewPageMetadata,
  type PdfPreviewPublication,
  type PdfPreviewViewportSize,
  type PdfPreviewZoom,
} from "./previewTypes.js";
import "./preview.css";

const MIN_ZOOM_PERCENT = 25;
const MAX_ZOOM_PERCENT = 200;
const ZOOM_STEP_PERCENT = 25;
const THUMBNAIL_WIDTH = 116;

interface LoadedPreview {
  readonly artifact: PdfPreviewArtifact;
  readonly document: PdfDocumentPort;
}

interface IntrinsicPageSize {
  readonly document: PdfDocumentPort;
  readonly pageNumber: number;
  readonly width: number;
  readonly height: number;
}

export interface PdfPreviewProps {
  readonly loader: PdfPreviewLoader;
  readonly publication: PdfPreviewPublication;
  readonly title?: string;
  readonly initialPage?: number;
  /** Numeric zoom values are percentages and are clamped to 25–200. */
  readonly initialZoom?: PdfPreviewZoom;
  /** Optional controlled zoom value. Numeric values are percentages. */
  readonly zoom?: PdfPreviewZoom;
  readonly onZoomChange?: (zoom: PdfPreviewZoom) => void;
  readonly selectedSourceElementId?: string;
  readonly selectedResolvedId?: string;
  readonly onPageChange?: (change: PdfPreviewPageChange) => void;
  /** A deterministic measurement seam for hosts and layout-free tests. */
  readonly viewportSize?: PdfPreviewViewportSize;
  /** Reveals bounded, path-redacted diagnostic detail after plain task guidance. */
  readonly showTechnicalDetails?: boolean;
  readonly className?: string;
}

interface PdfCanvasProps {
  readonly document: PdfDocumentPort;
  readonly pageNumber: number;
  readonly label: string;
  readonly scale?: number;
  readonly targetWidth?: number;
  readonly className?: string;
  readonly onError?: (message: string) => void;
}

const MAX_TECHNICAL_DETAIL_LENGTH = 240;

function technicalDetailFrom(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const firstLine = raw.split(/\r?\n/u).find((line) => line.trim().length > 0)?.trim() ?? "";
  const withoutStack = firstLine.replace(
    /\s+at\s+(?:async\s+)?[A-Za-z_$][\w.$<>]*(?:\s+\(.*)?$/u,
    "",
  );
  const redacted = withoutStack
    .replace(/\b(?:https?|file):\/\/[^\s)]+/giu, "[address]")
    .replace(/[A-Za-z]:[\\/][^\s)]+/gu, "[local path]")
    .replace(/\/(?:[^/\s)]+\/)+[^/\s)]*/gu, "[local path]")
    .replace(/\s+/gu, " ")
    .trim();
  if (redacted.length === 0) return "No additional technical details were provided.";
  return redacted.length > MAX_TECHNICAL_DETAIL_LENGTH
    ? `${redacted.slice(0, MAX_TECHNICAL_DETAIL_LENGTH - 1)}…`
    : redacted;
}

function safeDestroy(document: PdfDocumentPort): void {
  try {
    const result = document.destroy?.();
    if (result !== undefined) void Promise.resolve(result).catch(() => undefined);
  } catch {
    // Destruction is best-effort during replacement/unmount.
  }
}

function cancelRender(task: PdfRenderTaskPort | undefined): void {
  try {
    task?.cancel?.();
  } catch {
    // A task can already be complete when React runs cleanup.
  }
}

function PdfCanvas({
  document,
  pageNumber,
  label,
  scale = 1,
  targetWidth,
  className,
  onError,
}: PdfCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rendering, setRendering] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    let active = true;
    let renderTask: PdfRenderTaskPort | undefined;
    setRendering(true);

    void document.getPage(pageNumber).then((page) => {
      if (!active) return undefined;
      const baseViewport = page.getViewport({ scale: 1 });
      const renderScale = targetWidth === undefined
        ? scale
        : targetWidth / Math.max(1, baseViewport.width);
      const viewport = page.getViewport({ scale: renderScale });
      const outputScale = Math.max(1, Math.min(2, globalThis.devicePixelRatio ?? 1));
      canvas.width = Math.max(1, Math.ceil(viewport.width * outputScale));
      canvas.height = Math.max(1, Math.ceil(viewport.height * outputScale));
      canvas.style.width = `${Math.max(1, viewport.width)}px`;
      canvas.style.height = `${Math.max(1, viewport.height)}px`;
      renderTask = page.render({
        canvas,
        viewport,
        ...(outputScale === 1
          ? {}
          : { transform: [outputScale, 0, 0, outputScale, 0, 0] }),
      });
      return renderTask.promise;
    }).then(() => {
      if (active) setRendering(false);
    }).catch((error: unknown) => {
      if (!active) return;
      setRendering(false);
      onError?.(technicalDetailFrom(error));
    });

    return () => {
      active = false;
      cancelRender(renderTask);
    };
  }, [document, onError, pageNumber, scale, targetWidth]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      role="img"
      aria-label={label}
      aria-busy={rendering}
    >
      {label}
    </canvas>
  );
}

function LazyThumbnailCanvas(props: Omit<PdfCanvasProps, "scale" | "targetWidth">) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    const host = hostRef.current;
    if (host === null || visible || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "240px" });
    observer.observe(host);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <div ref={hostRef} className="cbb-pdf-preview__thumbnail-image" aria-hidden="true">
      {visible
        ? <PdfCanvas {...props} targetWidth={THUMBNAIL_WIDTH} />
        : <span className="cbb-pdf-preview__thumbnail-placeholder" />}
    </div>
  );
}

function artifactKey(artifact: PdfPreviewArtifact): string {
  return `${artifact.bulletinLocalResourceId}\u0000${artifact.buildId}`;
}

function publicationArtifact(publication: PdfPreviewPublication): PdfPreviewArtifact | undefined {
  return publication.artifact;
}

function clampZoomPercent(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.max(MIN_ZOOM_PERCENT, Math.min(MAX_ZOOM_PERCENT, Math.round(value)));
}

function clampScale(value: number): number {
  return clampZoomPercent(value * 100) / 100;
}

function clampPage(value: number, pageCount: number): number {
  if (pageCount < 1) return 1;
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(pageCount, Math.round(value)));
}

function pageMetadata(
  artifact: PdfPreviewArtifact | undefined,
  pageNumber: number,
): PdfPreviewPageMetadata | undefined {
  return artifact?.pages?.find((page) => page.pageNumber === pageNumber);
}

function pageLabel(metadata: PdfPreviewPageMetadata | undefined, pageNumber: number): string {
  const label = metadata?.label?.trim();
  return label === undefined || label.length === 0 ? `Page ${pageNumber}` : label;
}

function findingCount(metadata: PdfPreviewPageMetadata | undefined): number {
  const count = metadata?.findingCount ?? 0;
  return Number.isSafeInteger(count) && count > 0 ? count : 0;
}

function pageReviewLabel(metadata: PdfPreviewPageMetadata | undefined): string {
  const findings = findingCount(metadata);
  if (metadata?.status === "blank") return findings === 0 ? "Blank page" : `Blank page · ${findings} findings`;
  if (findings > 0 || metadata?.status === "hasFindings") {
    return findings === 0 ? "Findings need review" : findings === 1 ? "1 finding" : `${findings} findings`;
  }
  return "Ready";
}

function publicationLabel(status: PdfPreviewPublication["status"]): string {
  switch (status) {
    case "current": return "Current";
    case "updating": return "Updating";
    case "stale": return "Out of date";
    case "failed": return "Failed";
  }
}

function publicationThumbnailLabel(status: PdfPreviewPublication["status"]): string {
  switch (status) {
    case "current": return "Preview current";
    case "updating": return "Preview updating";
    case "stale": return "Preview out of date";
    case "failed": return "Preview failed";
  }
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function pageChange(
  pageNumber: number,
  reason: PdfPreviewNavigationReason,
  map: PdfPreviewNavigationMap | undefined,
): PdfPreviewPageChange {
  const entries = map?.entries.filter((entry) => entry.pageNumber === pageNumber) ?? [];
  return {
    pageNumber,
    reason,
    sourceElementIds: unique(entries.map((entry) => entry.sourceElementId)),
    resolvedIds: unique(entries.map((entry) => entry.resolvedId)),
  };
}

function interactiveTarget(target: EventTarget | null, currentTarget: EventTarget): boolean {
  if (!(target instanceof HTMLElement) || target === currentTarget) return false;
  return target.closest("button, input, select, textarea, a, summary, [contenteditable='true']") !== null;
}

function TechnicalDetails({
  visible,
  message,
}: {
  readonly visible: boolean;
  readonly message: string | undefined;
}) {
  if (!visible || message === undefined) return null;
  return (
    <details className="cbb-pdf-preview__technical-details">
      <summary>Technical details</summary>
      <p>{technicalDetailFrom(message)}</p>
    </details>
  );
}

function PreviewNotice({
  publication,
  loading,
  loadError,
  renderError,
  hasDocument,
  showTechnicalDetails,
}: {
  readonly publication: PdfPreviewPublication;
  readonly loading: boolean;
  readonly loadError: string | undefined;
  readonly renderError: string | undefined;
  readonly hasDocument: boolean;
  readonly showTechnicalDetails: boolean;
}) {
  const preservation = hasDocument ? " The last successful preview remains visible." : "";
  if (loadError !== undefined || renderError !== undefined) {
    return (
      <Banner tone="danger" title="Preview failed" className="cbb-pdf-preview__notice">
        <span>{`The PDF preview could not be displayed.${preservation}`}</span>
        <TechnicalDetails
          visible={showTechnicalDetails}
          message={loadError ?? renderError}
        />
      </Banner>
    );
  }
  switch (publication.status) {
    case "updating":
      return (
        <Banner tone="info" title={loading && !hasDocument ? "Loading preview" : "Updating preview"} className="cbb-pdf-preview__notice">
          {publication.message ?? (hasDocument
            ? "The last successful preview remains visible while the new PDF is prepared."
            : "The PDF will appear when it is ready.")}
        </Banner>
      );
    case "stale":
      return (
        <Banner tone="warning" title="Preview out of date" className="cbb-pdf-preview__notice">
          <span>{publication.message + preservation}</span>
          <TechnicalDetails
            visible={showTechnicalDetails}
            message={publication.technicalMessage}
          />
        </Banner>
      );
    case "failed":
      return (
        <Banner tone="danger" title="Preview failed" className="cbb-pdf-preview__notice">
          <span>{publication.message + preservation}</span>
          <TechnicalDetails
            visible={showTechnicalDetails}
            message={publication.technicalMessage}
          />
        </Banner>
      );
    case "current":
      return loading
        ? (
            <Banner tone="info" title="Loading preview" className="cbb-pdf-preview__notice">
              {hasDocument
                ? "The last successful preview remains visible until the new PDF is ready."
                : "Opening the current PDF…"}
            </Banner>
          )
        : null;
  }
}

export const PdfPreview = forwardRef<PdfPreviewHandle, PdfPreviewProps>(function PdfPreview({
  loader,
  publication,
  title = "PDF preview",
  initialPage = 1,
  initialZoom = "fitPage",
  zoom: controlledZoom,
  onZoomChange,
  selectedSourceElementId,
  selectedResolvedId,
  onPageChange,
  viewportSize,
  showTechnicalDetails = false,
  className,
}, ref) {
  const initialZoomValue = typeof initialZoom === "number"
    ? clampZoomPercent(initialZoom)
    : initialZoom;
  const [uncontrolledZoom, setUncontrolledZoom] = useState<PdfPreviewZoom>(initialZoomValue);
  const zoomSetting = controlledZoom === undefined
    ? uncontrolledZoom
    : typeof controlledZoom === "number"
      ? clampZoomPercent(controlledZoom)
      : controlledZoom;
  const [loaded, setLoaded] = useState<LoadedPreview | undefined>();
  const loadedRef = useRef<LoadedPreview | undefined>(undefined);
  const loadGenerationRef = useRef(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [renderError, setRenderError] = useState<string | undefined>();
  const [currentPage, setCurrentPage] = useState(() => validPageNumber(initialPage) ? initialPage : 1);
  const currentPageRef = useRef(currentPage);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [measuredViewport, setMeasuredViewport] = useState<PdfPreviewViewportSize>({ width: 0, height: 0 });
  const [intrinsicPage, setIntrinsicPage] = useState<IntrinsicPageSize | undefined>();
  const [announcement, setAnnouncement] = useState("");
  const zoomRangeId = useId();
  const requestedArtifact = publicationArtifact(publication);
  const requestedKey = requestedArtifact === undefined ? undefined : artifactKey(requestedArtifact);
  const requestedArtifactRef = useRef(requestedArtifact);
  requestedArtifactRef.current = requestedArtifact;

  useEffect(() => {
    const generation = ++loadGenerationRef.current;
    const artifact = requestedArtifactRef.current;
    if (artifact === undefined) {
      setLoading(false);
      return;
    }
    if (loadedRef.current !== undefined && artifactKey(loadedRef.current.artifact) === requestedKey) {
      setLoadError(undefined);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setLoadError(undefined);
    void loader.load(artifact, controller.signal).then((document) => {
      if (controller.signal.aborted || generation !== loadGenerationRef.current) {
        safeDestroy(document);
        return;
      }
      const previous = loadedRef.current;
      const next = { artifact, document };
      loadedRef.current = next;
      setLoaded(next);
      setCurrentPage((page) => clampPage(page, document.numPages));
      setLoading(false);
      setRenderError(undefined);
      if (previous !== undefined && previous.document !== document) safeDestroy(previous.document);
    }).catch((error: unknown) => {
      if (controller.signal.aborted || generation !== loadGenerationRef.current) return;
      setLoading(false);
      setLoadError(technicalDetailFrom(error));
    });

    return () => controller.abort();
  }, [loader, requestedKey]);

  useEffect(() => () => {
    ++loadGenerationRef.current;
    const current = loadedRef.current;
    loadedRef.current = undefined;
    if (current !== undefined) safeDestroy(current.document);
  }, []);

  const pageCount = loaded?.document.numPages ?? 0;
  useEffect(() => {
    if (pageCount < 1) return;
    setCurrentPage((page) => clampPage(page, pageCount));
  }, [pageCount]);

  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  const displayArtifact = useMemo(() => {
    if (
      loaded !== undefined &&
      requestedArtifact !== undefined &&
      artifactKey(loaded.artifact) === artifactKey(requestedArtifact)
    ) {
      return requestedArtifact;
    }
    return loaded?.artifact;
  }, [loaded, requestedArtifact]);
  const navigationMap = displayArtifact?.navigationMap;

  const navigate = useCallback((pageNumber: number, reason: PdfPreviewNavigationReason): boolean => {
    if (pageCount < 1 || !validPageNumber(pageNumber) || pageNumber > pageCount) return false;
    setCurrentPage(pageNumber);
    setRenderError(undefined);
    const change = pageChange(pageNumber, reason, navigationMap);
    onPageChange?.(change);
    setAnnouncement(`Page ${pageNumber} of ${pageCount}`);
    return true;
  }, [navigationMap, onPageChange, pageCount]);

  const goToSource = useCallback((sourceElementId: string): boolean => {
    const pageNumber = pageForSource(navigationMap, sourceElementId, currentPageRef.current);
    return pageNumber === undefined ? false : navigate(pageNumber, "source");
  }, [navigate, navigationMap]);

  const goToResolvedSource = useCallback((resolvedId: string): boolean => {
    const pageNumber = pageForResolvedSource(navigationMap, resolvedId, currentPageRef.current);
    return pageNumber === undefined ? false : navigate(pageNumber, "source");
  }, [navigate, navigationMap]);

  useImperativeHandle(ref, () => ({
    goToPage: (pageNumber) => navigate(pageNumber, "programmatic"),
    goToSource,
    goToResolvedSource,
  }), [goToResolvedSource, goToSource, navigate]);

  const navigateRef = useRef({ goToSource, goToResolvedSource });
  navigateRef.current = { goToSource, goToResolvedSource };
  useEffect(() => {
    if (pageCount < 1) return;
    if (selectedResolvedId !== undefined) {
      navigateRef.current.goToResolvedSource(selectedResolvedId);
    } else if (selectedSourceElementId !== undefined) {
      navigateRef.current.goToSource(selectedSourceElementId);
    }
  }, [navigationMap, pageCount, selectedResolvedId, selectedSourceElementId]);

  const navigationUnavailable = pageCount > 0 && (
    selectedResolvedId !== undefined
      ? pageForResolvedSource(navigationMap, selectedResolvedId, currentPage) === undefined
      : selectedSourceElementId !== undefined &&
        pageForSource(navigationMap, selectedSourceElementId, currentPage) === undefined
  );

  useEffect(() => {
    if (viewportSize !== undefined) return;
    const element = viewportRef.current;
    if (element === null) return;
    const measure = () => {
      const rectangle = element.getBoundingClientRect();
      setMeasuredViewport({
        width: element.clientWidth || rectangle.width,
        height: element.clientHeight || rectangle.height,
      });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [viewportSize]);

  useEffect(() => {
    const document = loaded?.document;
    if (document === undefined || pageCount < 1) {
      setIntrinsicPage(undefined);
      return;
    }
    let active = true;
    void document.getPage(currentPage).then((page) => {
      if (!active) return;
      const viewport = page.getViewport({ scale: 1 });
      setIntrinsicPage({
        document,
        pageNumber: currentPage,
        width: viewport.width,
        height: viewport.height,
      });
    }).catch((error: unknown) => {
      if (active) setRenderError(technicalDetailFrom(error));
    });
    return () => { active = false; };
  }, [currentPage, loaded?.document, pageCount]);

  const size = viewportSize ?? measuredViewport;
  const fittingSize = intrinsicPage !== undefined &&
    intrinsicPage.document === loaded?.document &&
    intrinsicPage.pageNumber === currentPage
    ? intrinsicPage
    : undefined;
  const availableWidth = Math.max(1, size.width - 48);
  const availableHeight = Math.max(1, size.height - 48);
  const scale = typeof zoomSetting === "number"
    ? clampZoomPercent(zoomSetting) / 100
    : fittingSize === undefined || size.width <= 0 || size.height <= 0
      ? 1
      : zoomSetting === "fitWidth"
        ? clampScale(availableWidth / Math.max(1, fittingSize.width))
        : clampScale(Math.min(
            availableWidth / Math.max(1, fittingSize.width),
            availableHeight / Math.max(1, fittingSize.height),
          ));
  const zoomPercent = clampZoomPercent(scale * 100);

  const setZoom = useCallback((next: PdfPreviewZoom) => {
    const normalized = typeof next === "number" ? clampZoomPercent(next) : next;
    if (controlledZoom === undefined) setUncontrolledZoom(normalized);
    onZoomChange?.(normalized);
  }, [controlledZoom, onZoomChange]);

  const handleKeyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (interactiveTarget(event.target, event.currentTarget) || pageCount < 1) return;
    let handled = true;
    switch (event.key) {
      case "ArrowLeft":
      case "PageUp":
        navigate(Math.max(1, currentPage - 1), "keyboard");
        break;
      case "ArrowRight":
      case "PageDown":
        navigate(Math.min(pageCount, currentPage + 1), "keyboard");
        break;
      case "Home":
        navigate(1, "keyboard");
        break;
      case "End":
        navigate(pageCount, "keyboard");
        break;
      case "+":
      case "=":
        setZoom(zoomPercent + ZOOM_STEP_PERCENT);
        break;
      case "-":
      case "_":
        setZoom(zoomPercent - ZOOM_STEP_PERCENT);
        break;
      case "0":
        setZoom("fitPage");
        break;
      default:
        handled = false;
    }
    if (handled) event.preventDefault();
  };

  const pages = useMemo(
    () => Array.from({ length: pageCount }, (_, index) => index + 1),
    [pageCount],
  );
  const rootClassName = ["cbb-pdf-preview", className].filter(Boolean).join(" ");

  return (
    <section
      className={rootClassName}
      aria-label={title}
      tabIndex={0}
      onKeyDown={handleKeyboard}
    >
      <header className="cbb-pdf-preview__header">
        <div>
          <h2>{title}</h2>
          <span className={`cbb-pdf-preview__status cbb-pdf-preview__status--${publication.status}`}>
            {publicationLabel(publication.status)}
          </span>
        </div>
        <div className="cbb-pdf-preview__toolbar" role="toolbar" aria-label="PDF page and zoom controls">
          <Button
            variant="quiet"
            aria-label="Previous page"
            disabled={pageCount < 1 || currentPage <= 1}
            onClick={() => navigate(currentPage - 1, "previous")}
          >
            ← <span aria-hidden="true">Previous</span>
          </Button>
          <output className="cbb-pdf-preview__page-count" aria-live="polite" aria-atomic="true">
            {pageCount < 1 ? "No pages" : `Page ${currentPage} of ${pageCount}`}
          </output>
          <Button
            variant="quiet"
            aria-label="Next page"
            disabled={pageCount < 1 || currentPage >= pageCount}
            onClick={() => navigate(currentPage + 1, "next")}
          >
            <span aria-hidden="true">Next</span> →
          </Button>
          <span className="cbb-pdf-preview__toolbar-divider" aria-hidden="true" />
          <Button
            variant="quiet"
            aria-pressed={zoomSetting === "fitPage"}
            onClick={() => setZoom("fitPage")}
          >
            Fit page
          </Button>
          <Button
            variant="quiet"
            aria-pressed={zoomSetting === "fitWidth"}
            onClick={() => setZoom("fitWidth")}
          >
            Fit width
          </Button>
          <label className="cbb-pdf-preview__zoom-field">
            <span>Zoom</span>
            <input
              type="number"
              min={MIN_ZOOM_PERCENT}
              max={MAX_ZOOM_PERCENT}
              step={5}
              value={zoomPercent}
              onChange={(event) => setZoom(Number(event.currentTarget.value))}
              aria-describedby={zoomRangeId}
            />
            <span aria-hidden="true">%</span>
          </label>
          <span id={zoomRangeId} className="cbb-visually-hidden">
            Choose a zoom from 25 to 200 percent.
          </span>
        </div>
      </header>

      <div className="cbb-pdf-preview__body">
        <aside className="cbb-pdf-preview__sidebar" aria-label="PDF pages">
          <nav aria-label="Page thumbnails">
            <h3>Pages</h3>
            <ol className="cbb-pdf-preview__thumbnails">
              {pages.map((pageNumber) => {
                const metadata = pageMetadata(displayArtifact, pageNumber);
                const label = pageLabel(metadata, pageNumber);
                const current = pageNumber === currentPage;
                const accessibleLabel = [
                  `Page ${pageNumber}: ${label}`,
                  current ? "Current page" : undefined,
                  pageReviewLabel(metadata),
                  publicationThumbnailLabel(publication.status),
                ].filter((value): value is string => value !== undefined).join(". ");
                return (
                  <li key={pageNumber}>
                    <button
                      type="button"
                      className="cbb-pdf-preview__thumbnail"
                      aria-label={accessibleLabel}
                      aria-current={current ? "page" : undefined}
                      onClick={() => navigate(pageNumber, "thumbnail")}
                    >
                      {loaded === undefined ? null : (
                        <LazyThumbnailCanvas
                          document={loaded.document}
                          pageNumber={pageNumber}
                          label={`Thumbnail image for page ${pageNumber}`}
                        />
                      )}
                      <span className="cbb-pdf-preview__thumbnail-copy">
                        <strong>Page {pageNumber}</strong>
                        <span>{label}</span>
                        <small>{pageReviewLabel(metadata)}</small>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          <nav className="cbb-pdf-preview__outline" aria-label="Page outline">
            <h3>Page outline</h3>
            {pageCount < 1
              ? <p>No page outline is available yet.</p>
              : (
                  <ol>
                    {pages.map((pageNumber) => {
                      const metadata = pageMetadata(displayArtifact, pageNumber);
                      const label = pageLabel(metadata, pageNumber);
                      return (
                        <li key={pageNumber}>
                          <button
                            type="button"
                            aria-current={pageNumber === currentPage ? "page" : undefined}
                            onClick={() => navigate(pageNumber, "outline")}
                          >
                            <span>Page {pageNumber}: {label}</span>
                            {metadata?.summary === undefined ? null : <small>{metadata.summary}</small>}
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                )}
          </nav>
        </aside>

        <div ref={viewportRef} className="cbb-pdf-preview__viewport">
          <PreviewNotice
            publication={publication}
            loading={loading}
            loadError={loadError}
            renderError={renderError}
            hasDocument={loaded !== undefined}
            showTechnicalDetails={showTechnicalDetails}
          />
          {navigationUnavailable ? (
            <p className="cbb-pdf-preview__navigation-note" role="status">
              Jump to selection is unavailable for this preview. You can still use the page controls and outline.
            </p>
          ) : null}
          <div className="cbb-pdf-preview__canvas-stage">
            {loaded === undefined || pageCount < 1
              ? (
                  <div className="cbb-pdf-preview__empty" role="status">
                    <strong>No PDF to show yet</strong>
                    <span>The latest successful preview will appear here.</span>
                  </div>
                )
              : (
                  <PdfCanvas
                    document={loaded.document}
                    pageNumber={currentPage}
                    scale={scale}
                    label={`PDF page ${currentPage} of ${pageCount}`}
                    className="cbb-pdf-preview__page-canvas"
                    onError={setRenderError}
                  />
                )}
          </div>
        </div>
      </div>
      <LiveRegion message={announcement} />
    </section>
  );
});
