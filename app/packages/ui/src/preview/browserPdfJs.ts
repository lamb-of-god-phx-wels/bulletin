import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  createPdfPreviewLoader,
  type PdfBytesReaderPort,
  type PdfJsGetDocumentPort,
  type PdfPreviewLoader,
} from "./pdfLoader.js";

export interface BrowserPdfJsOptions {
  /** Override only with another asset inside the trusted renderer origin. */
  readonly workerSrc?: string;
  /** Injectable production seam for tests; the app uses the browser Worker. */
  readonly workerFactory?: BrowserPdfWorkerFactory;
  /** Injectable production seam for tests; the app uses window.location.href. */
  readonly rendererLocationHref?: string;
  /** Injectable only for unit tests that must not import the browser runtime. */
  readonly loadPdfJs?: () => Promise<BrowserPdfJsModule>;
}

export interface BrowserPdfJsModule {
  readonly GlobalWorkerOptions: {
    workerPort: Worker | null;
    workerSrc: string;
  };
  getDocument(source: Record<string, unknown>): ReturnType<PdfJsGetDocumentPort>;
}

export type BrowserPdfWorkerFactory = (
  url: string,
  options: { readonly type: "module"; readonly name: "cbb-pdf-preview" },
) => Worker;

let sharedBundledWorker: { readonly source: string; readonly worker: Worker } | undefined;

/** Resolve only a bundled same-renderer worker; blob/data/network fallbacks fail closed. */
export function trustedPdfWorkerUrl(workerSrc: string, rendererLocationHref: string): string {
  const renderer = new URL(rendererLocationHref);
  const worker = new URL(workerSrc, renderer);
  if (renderer.protocol === "file:") {
    const root = new URL("./", renderer);
    if (worker.protocol !== "file:" || !worker.href.startsWith(root.href) ||
      worker.username !== "" || worker.password !== "" || worker.search !== "" || worker.hash !== "") {
      throw new Error("The bundled PDF worker is outside the trusted renderer directory.");
    }
    return worker.href;
  }
  if ((renderer.protocol !== "http:" && renderer.protocol !== "https:") ||
    worker.origin !== renderer.origin || (worker.protocol !== "http:" && worker.protocol !== "https:") ||
    worker.username !== "" || worker.password !== "") {
    throw new Error("The PDF worker must use the trusted renderer origin.");
  }
  return worker.href;
}

export function createTrustedPdfWorker(
  workerSrc: string,
  rendererLocationHref: string,
  factory: BrowserPdfWorkerFactory,
): Worker {
  return factory(trustedPdfWorkerUrl(workerSrc, rendererLocationHref), {
    type: "module",
    name: "cbb-pdf-preview",
  });
}

/**
 * Load the browser PDF.js runtime and point it at Vite's bundled worker asset.
 * The dynamic import keeps PDF.js and its DOM requirements out of tests and
 * renderer routes that never open a preview.
 */
export async function loadBrowserPdfJs(
  options: BrowserPdfJsOptions = {},
): Promise<PdfJsGetDocumentPort> {
  const pdfJs = options.loadPdfJs === undefined
    ? await import("pdfjs-dist") as unknown as BrowserPdfJsModule
    : await options.loadPdfJs();
  const locationHref = options.rendererLocationHref ?? window.location.href;
  const source = trustedPdfWorkerUrl(options.workerSrc ?? pdfWorkerUrl, locationHref);
  const worker = options.workerFactory === undefined
    ? (() => {
        if (sharedBundledWorker?.source === source) return sharedBundledWorker.worker;
        const created = createTrustedPdfWorker(
          source,
          locationHref,
          (url, workerOptions) => new Worker(url, workerOptions),
        );
        sharedBundledWorker = { source, worker: created };
        return created;
      })()
    : createTrustedPdfWorker(source, locationHref, options.workerFactory);
  // A direct trusted port prevents PDF.js from manufacturing a blob wrapper
  // for file: pages. Blob workers are deliberately forbidden by the host CSP.
  pdfJs.GlobalWorkerOptions.workerSrc = source;
  pdfJs.GlobalWorkerOptions.workerPort = worker;
  return (documentSource) => pdfJs.getDocument({
    ...documentSource,
    isEvalSupported: false,
    useWasm: false,
  });
}

/** Ready-to-use renderer loader for the secure preload bridge. */
export async function createBrowserPdfPreviewLoader(
  bytesReader: PdfBytesReaderPort,
  options: BrowserPdfJsOptions = {},
): Promise<PdfPreviewLoader> {
  return createPdfPreviewLoader({
    bytesReader,
    getDocument: await loadBrowserPdfJs(options),
  });
}
