import { describe, expect, it, vi } from "vitest";
import {
  PdfPreviewLoadError,
  createPdfPreviewLoader,
  type PdfDocumentPort,
  type PdfJsGetDocumentPort,
  type PdfLoadingTaskPort,
  type PdfPagePort,
} from "./pdfLoader.js";

type ActualPdfJsGetDocument = typeof import("pdfjs-dist").getDocument;
const actualPdfJsShapeIsCompatible: PdfJsGetDocumentPort =
  null as unknown as ActualPdfJsGetDocument;

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function fakePage(pageNumber = 1): PdfPagePort {
  return {
    pageNumber,
    getViewport: () => ({ width: 612, height: 792 }),
    render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
  };
}

function fakeDocument(
  numPages = 2,
  destroy = vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
): PdfDocumentPort {
  return {
    numPages,
    getPage: vi.fn(async (pageNumber: number) => fakePage(pageNumber)),
    destroy,
  };
}

function taskFor(
  document: PdfDocumentPort,
  destroy = vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
): PdfLoadingTaskPort {
  return { promise: Promise.resolve(document), destroy };
}

describe("createPdfPreviewLoader", () => {
  it("accepts the installed PDF.js v6 getDocument shape", () => {
    expect(actualPdfJsShapeIsCompatible).toBeNull();
  });

  it("reads the requested artifact, copies its bytes, and exposes a disposable document", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70]);
    const readPdfBytes = vi.fn().mockResolvedValue(bytes);
    const rawDestroy = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const taskDestroy = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const document = fakeDocument(2, rawDestroy);
    let receivedData: Uint8Array | undefined;
    const getDocument = vi.fn((source: { readonly data: Uint8Array }) => {
      receivedData = source.data;
      return taskFor(document, taskDestroy);
    });
    const loader = createPdfPreviewLoader({ bytesReader: { readPdfBytes }, getDocument });

    const loaded = await loader.load({ bulletinLocalResourceId: "bulletin-1", buildId: "build-9" });

    expect(readPdfBytes).toHaveBeenCalledWith("bulletin-1", "build-9");
    expect(receivedData).toEqual(bytes);
    expect(receivedData).not.toBe(bytes);
    receivedData![0] = 0;
    expect(bytes[0]).toBe(37);
    expect(loaded.numPages).toBe(2);
    await expect(loaded.getPage(2)).resolves.toMatchObject({ pageNumber: 2 });

    await loaded.destroy();
    await loaded.destroy();
    expect(rawDestroy).toHaveBeenCalledTimes(1);
    expect(taskDestroy).toHaveBeenCalledTimes(1);
  });

  it("rejects empty PDF data before invoking PDF.js", async () => {
    const getDocument = vi.fn();
    const loader = createPdfPreviewLoader({
      bytesReader: { readPdfBytes: vi.fn().mockResolvedValue(new Uint8Array()) },
      getDocument,
    });

    await expect(loader.load({ bulletinLocalResourceId: "bulletin", buildId: "build" }))
      .rejects.toMatchObject({ code: "empty-pdf", message: "The preview PDF is empty." });
    expect(getDocument).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects and disposes an invalid page count (%s)",
    async (numPages) => {
      const rawDestroy = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
      const taskDestroy = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
      const loader = createPdfPreviewLoader({
        bytesReader: { readPdfBytes: vi.fn().mockResolvedValue(new Uint8Array([1])) },
        getDocument: () => taskFor(fakeDocument(numPages, rawDestroy), taskDestroy),
      });

      await expect(loader.load({ bulletinLocalResourceId: "bulletin", buildId: "build" }))
        .rejects.toMatchObject({ code: "invalid-document" });
      expect(rawDestroy).toHaveBeenCalledTimes(1);
      expect(taskDestroy).toHaveBeenCalledTimes(1);
    },
  );

  it("normalizes non-Error byte reader failures", async () => {
    const loader = createPdfPreviewLoader({
      bytesReader: { readPdfBytes: vi.fn().mockRejectedValue("storage offline") },
      getDocument: vi.fn(),
    });

    const failure = await loader.load({ bulletinLocalResourceId: "bulletin", buildId: "build" })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PdfPreviewLoadError);
    expect(failure).toMatchObject({
      code: "read-failed",
      message: "Could not read the preview PDF: storage offline",
    });
  });

  it.each([
    ["a synchronous failure", (error: unknown) => () => { throw error; }],
    ["an asynchronous failure", (error: unknown) => () => ({
      promise: Promise.reject(error),
      destroy: vi.fn(),
    })],
  ] as const)("normalizes %s from PDF.js", async (_label, makeGetDocument) => {
    const loader = createPdfPreviewLoader({
      bytesReader: { readPdfBytes: vi.fn().mockResolvedValue(new Uint8Array([1])) },
      getDocument: makeGetDocument({ reason: "bad PDF" }) as PdfJsGetDocumentPort,
    });

    const failure = await loader.load({ bulletinLocalResourceId: "bulletin", buildId: "build" })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PdfPreviewLoadError);
    expect(failure).toMatchObject({
      code: "open-failed",
      message: "Could not open the preview PDF: An unknown error occurred.",
    });
  });

  it("does no work when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const readPdfBytes = vi.fn();
    const getDocument = vi.fn();
    const loader = createPdfPreviewLoader({ bytesReader: { readPdfBytes }, getDocument });

    await expect(loader.load(
      { bulletinLocalResourceId: "bulletin", buildId: "build" },
      controller.signal,
    )).rejects.toMatchObject({ name: "AbortError" });
    expect(readPdfBytes).not.toHaveBeenCalled();
    expect(getDocument).not.toHaveBeenCalled();
  });

  it("stops waiting when byte reading is aborted and never invokes PDF.js", async () => {
    const bytes = deferred<Uint8Array>();
    const controller = new AbortController();
    const getDocument = vi.fn();
    const loader = createPdfPreviewLoader({
      bytesReader: { readPdfBytes: () => bytes.promise },
      getDocument,
    });
    const loading = loader.load(
      { bulletinLocalResourceId: "bulletin", buildId: "build" },
      controller.signal,
    );

    controller.abort();
    await expect(loading).rejects.toMatchObject({ name: "AbortError" });
    bytes.resolve(new Uint8Array([1]));
    await Promise.resolve();
    expect(getDocument).not.toHaveBeenCalled();
  });

  it("destroys the loading task immediately and a document that resolves after abort", async () => {
    const pendingDocument = deferred<PdfDocumentPort>();
    const taskDestroy = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const rawDestroy = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const controller = new AbortController();
    const getDocument = vi.fn(() => ({
      promise: pendingDocument.promise,
      destroy: taskDestroy,
    }));
    const loader = createPdfPreviewLoader({
      bytesReader: { readPdfBytes: vi.fn().mockResolvedValue(new Uint8Array([1])) },
      getDocument,
    });
    const loading = loader.load(
      { bulletinLocalResourceId: "bulletin", buildId: "build" },
      controller.signal,
    );
    await vi.waitFor(() => expect(getDocument).toHaveBeenCalledTimes(1));

    controller.abort();
    await expect(loading).rejects.toMatchObject({ name: "AbortError" });
    expect(taskDestroy).toHaveBeenCalledTimes(1);

    pendingDocument.resolve(fakeDocument(1, rawDestroy));
    await vi.waitFor(() => expect(rawDestroy).toHaveBeenCalledTimes(1));
    expect(taskDestroy).toHaveBeenCalledTimes(1);
  });
});
