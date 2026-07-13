import { describe, expect, it, vi } from "vitest";
import {
  loadBrowserPdfJs,
  trustedPdfWorkerUrl,
  type BrowserPdfJsModule,
} from "./browserPdfJs.js";

describe("production PDF.js worker bootstrap", () => {
  it("accepts only a local asset beneath the packaged renderer directory", () => {
    const page = "file:///opt/church-bulletin-builder/renderer/index.html";
    expect(trustedPdfWorkerUrl("./assets/pdf.worker-abc.mjs", page)).toBe(
      "file:///opt/church-bulletin-builder/renderer/assets/pdf.worker-abc.mjs",
    );
    expect(() => trustedPdfWorkerUrl("blob:null/unsafe", page)).toThrow(/trusted renderer/u);
    expect(() => trustedPdfWorkerUrl("../outside/pdf.worker.mjs", page)).toThrow(/trusted renderer/u);
    expect(() => trustedPdfWorkerUrl("https://example.test/pdf.worker.mjs", page)).toThrow(/trusted renderer/u);
  });

  it("installs a direct module Worker port for a file build without a blob fallback", async () => {
    const worker = { marker: "trusted-worker" } as unknown as Worker;
    const workerFactory = vi.fn(() => worker);
    const getDocument = vi.fn(() => ({
      promise: Promise.resolve({ numPages: 1, getPage: vi.fn() }),
      destroy: vi.fn(),
    }));
    const module: BrowserPdfJsModule = {
      GlobalWorkerOptions: { workerPort: null, workerSrc: "" },
      getDocument,
    };

    const open = await loadBrowserPdfJs({
      workerSrc: "./assets/pdf.worker-production.mjs",
      rendererLocationHref: "file:///opt/cbb/renderer/index.html",
      workerFactory,
      loadPdfJs: async () => module,
    });
    open({ data: new Uint8Array([37, 80, 68, 70, 45]) });

    expect(workerFactory).toHaveBeenCalledWith(
      "file:///opt/cbb/renderer/assets/pdf.worker-production.mjs",
      { type: "module", name: "cbb-pdf-preview" },
    );
    expect(module.GlobalWorkerOptions.workerPort).toBe(worker);
    expect(module.GlobalWorkerOptions.workerSrc).not.toMatch(/^blob:/u);
    expect(getDocument).toHaveBeenCalledWith(expect.objectContaining({
      isEvalSupported: false,
      useWasm: false,
    }));
  });
});
