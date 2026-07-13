/** A stored PDF artifact that can be requested through the renderer bridge. */
export interface PdfArtifactRef {
  readonly bulletinLocalResourceId: string;
  readonly buildId: string;
}

/** Descriptive alias used by preview component contracts. */
export type PdfPreviewArtifactRef = PdfArtifactRef;

/** The renderer-safe subset of the bridge used by the preview. */
export interface PdfBytesReaderPort {
  readPdfBytes(bulletinLocalResourceId: string, buildId: string): Promise<Uint8Array>;
}

/** The viewport properties used by the preview canvas layout. */
export interface PdfViewportPort {
  readonly width: number;
  readonly height: number;
}

/** The cancellable result returned by PDF.js page rendering. */
export interface PdfRenderTaskPort {
  readonly promise: Promise<void>;
  cancel(extraDelay?: number): void;
}

/**
 * The PDF.js v6 canvas render shape. `canvasContext` remains optional for
 * compatibility with the legacy form supported by PDF.js.
 */
export interface PdfRenderParametersPort {
  readonly canvas: HTMLCanvasElement | null;
  readonly canvasContext?: CanvasRenderingContext2D;
  readonly viewport: PdfViewportPort;
  readonly transform?: number[];
}

/** The portion of a PDF.js page proxy needed by the preview. */
export interface PdfPagePort {
  readonly pageNumber: number;
  getViewport(parameters: {
    readonly scale: number;
    readonly rotation?: number;
    readonly offsetX?: number;
    readonly offsetY?: number;
    readonly dontFlip?: boolean;
  }): PdfViewportPort;
  render(parameters: PdfRenderParametersPort): PdfRenderTaskPort;
}

/**
 * The structural document shape resolved by PDF.js. Older PDF.js releases
 * exposed `destroy` here; v6 performs that work through its loading task.
 */
export interface PdfDocumentPort {
  readonly numPages: number;
  getPage(pageNumber: number): Promise<PdfPagePort>;
  destroy?(): void | Promise<void>;
}

/** A loaded preview document with a version-independent cleanup operation. */
export interface LoadedPdfDocumentPort extends PdfDocumentPort {
  destroy(): Promise<void>;
}

/** The loading-task subset returned by PDF.js `getDocument`. */
export interface PdfLoadingTaskPort {
  /** Validated as a `PdfDocumentPort` only after the third-party promise resolves. */
  readonly promise: Promise<unknown>;
  destroy(): void | Promise<void>;
}

/** Data-only input used to keep PDF loading inside the renderer sandbox. */
export interface PdfDocumentSourcePort {
  readonly data: Uint8Array;
}

/** Structurally compatible with PDF.js v6's `getDocument` export. */
export type PdfJsGetDocumentPort = (source: PdfDocumentSourcePort) => PdfLoadingTaskPort;

export interface PdfPreviewLoaderDependencies {
  readonly bytesReader: PdfBytesReaderPort;
  readonly getDocument: PdfJsGetDocumentPort;
}

export interface PdfPreviewLoader {
  load(artifact: PdfArtifactRef, signal?: AbortSignal): Promise<LoadedPdfDocumentPort>;
}

export type PdfPreviewLoadErrorCode =
  | "read-failed"
  | "empty-pdf"
  | "open-failed"
  | "invalid-document";

/** A normalized, display-safe failure from the PDF loading boundary. */
export class PdfPreviewLoadError extends Error {
  readonly code: PdfPreviewLoadErrorCode;

  constructor(code: PdfPreviewLoadErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "PdfPreviewLoadError";
    this.code = code;
  }
}

function abortError(): Error {
  const error = new Error("PDF preview loading was cancelled.");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function errorDetail(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message.trim();
  if (typeof error === "string" && error.trim().length > 0) return error.trim();
  return "An unknown error occurred.";
}

function normalizedFailure(
  code: "read-failed" | "open-failed",
  prefix: string,
  error: unknown,
): PdfPreviewLoadError {
  if (error instanceof PdfPreviewLoadError) return error;
  return new PdfPreviewLoadError(code, `${prefix}: ${errorDetail(error)}`, error);
}

/**
 * Wait for a promise while allowing the caller to stop waiting. The original
 * promise always receives handlers, so a late rejection cannot become an
 * unhandled rejection after cancellation.
 */
function waitForAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  onAbort?: () => void,
): Promise<T> {
  if (signal === undefined) return promise;
  if (signal.aborted) {
    onAbort?.();
    return Promise.reject(abortError());
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", handleAbort);
      callback();
    };
    const handleAbort = (): void => {
      finish(() => {
        onAbort?.();
        reject(abortError());
      });
    };

    signal.addEventListener("abort", handleAbort, { once: true });
    promise.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

function createTaskDestroyer(task: PdfLoadingTaskPort): () => Promise<void> {
  let destruction: Promise<void> | undefined;
  return () => {
    if (destruction !== undefined) return destruction;
    try {
      destruction = Promise.resolve(task.destroy()).then(
        () => undefined,
        () => undefined,
      );
    } catch {
      destruction = Promise.resolve();
    }
    return destruction;
  };
}

async function destroyDocumentSafely(document: unknown): Promise<void> {
  if (typeof document !== "object" || document === null) return;
  const destroy = (document as { readonly destroy?: unknown }).destroy;
  if (typeof destroy !== "function") return;
  try {
    await destroy.call(document);
  } catch {
    // Cleanup is best effort and must not replace the load/cancellation result.
  }
}

function validDocument(value: unknown): value is PdfDocumentPort {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { readonly numPages?: unknown; readonly getPage?: unknown };
  return Number.isSafeInteger(candidate.numPages) &&
    (candidate.numPages as number) > 0 &&
    typeof candidate.getPage === "function";
}

function loadedDocument(
  document: PdfDocumentPort,
  destroyTask: () => Promise<void>,
): LoadedPdfDocumentPort {
  let destruction: Promise<void> | undefined;
  return Object.freeze({
    numPages: document.numPages,
    getPage(pageNumber: number) {
      return document.getPage(pageNumber);
    },
    destroy() {
      destruction ??= Promise.all([
        destroyDocumentSafely(document),
        destroyTask(),
      ]).then(() => undefined);
      return destruction;
    },
  });
}

/**
 * Build a renderer-only PDF loader from the preload byte capability and an
 * injected PDF.js-compatible `getDocument` function.
 */
export function createPdfPreviewLoader(
  dependencies: PdfPreviewLoaderDependencies,
): PdfPreviewLoader {
  const { bytesReader, getDocument } = dependencies;

  return Object.freeze({
    async load(
      artifact: PdfArtifactRef,
      signal?: AbortSignal,
    ): Promise<LoadedPdfDocumentPort> {
      if (isAborted(signal)) throw abortError();

      let bytes: Uint8Array;
      try {
        bytes = await waitForAbort(
          Promise.resolve().then(() => bytesReader.readPdfBytes(
            artifact.bulletinLocalResourceId,
            artifact.buildId,
          )),
          signal,
        );
      } catch (error) {
        if (isAborted(signal) || isAbortError(error)) throw abortError();
        throw normalizedFailure("read-failed", "Could not read the preview PDF", error);
      }

      if (!(bytes instanceof Uint8Array)) {
        throw new PdfPreviewLoadError(
          "read-failed",
          "Could not read the preview PDF: the renderer returned invalid PDF bytes.",
        );
      }
      if (bytes.byteLength === 0) {
        throw new PdfPreviewLoadError("empty-pdf", "The preview PDF is empty.");
      }
      if (isAborted(signal)) throw abortError();

      let copiedBytes: Uint8Array;
      try {
        // PDF.js may transfer the backing buffer to its worker. Never surrender
        // ownership of bytes held by the preload bridge or a caller's cache.
        copiedBytes = bytes.slice();
      } catch (error) {
        throw normalizedFailure("read-failed", "Could not prepare the preview PDF", error);
      }

      let task: PdfLoadingTaskPort;
      try {
        task = getDocument({ data: copiedBytes });
      } catch (error) {
        if (isAborted(signal) || isAbortError(error)) throw abortError();
        throw normalizedFailure("open-failed", "Could not open the preview PDF", error);
      }

      if (
        typeof task !== "object" ||
        task === null ||
        !("promise" in task) ||
        !(task.promise instanceof Promise) ||
        typeof task.destroy !== "function"
      ) {
        throw new PdfPreviewLoadError(
          "open-failed",
          "Could not open the preview PDF: the PDF renderer returned an invalid loading task.",
        );
      }

      const destroyTask = createTaskDestroyer(task);
      const documentPromise = task.promise.then(async (document) => {
        if (!isAborted(signal)) return document;
        await Promise.all([destroyDocumentSafely(document), destroyTask()]);
        throw abortError();
      });

      let document: unknown;
      try {
        document = await waitForAbort(documentPromise, signal, () => {
          void destroyTask();
        });
      } catch (error) {
        if (isAborted(signal) || isAbortError(error)) throw abortError();
        await destroyTask();
        throw normalizedFailure("open-failed", "Could not open the preview PDF", error);
      }

      if (!validDocument(document)) {
        await Promise.all([destroyDocumentSafely(document), destroyTask()]);
        throw new PdfPreviewLoadError(
          "invalid-document",
          "The preview PDF has an invalid page count.",
        );
      }
      if (isAborted(signal)) {
        await Promise.all([destroyDocumentSafely(document), destroyTask()]);
        throw abortError();
      }

      return loadedDocument(document, destroyTask);
    },
  });
}
