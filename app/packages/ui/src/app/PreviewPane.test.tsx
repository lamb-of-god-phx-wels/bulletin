// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  LoadedPdfDocumentPort,
  PdfPagePort,
  PdfPreviewArtifactRef,
  PdfPreviewLoader,
  PdfRenderTaskPort,
} from "../preview/index.js";
import { PreviewPane } from "./PreviewPane.js";
import { MemoryRendererBridge } from "./testBridge.js";

afterEach(cleanup);

function fakeDocument(numPages: number): LoadedPdfDocumentPort {
  return {
    numPages,
    async getPage(pageNumber: number): Promise<PdfPagePort> {
      return {
        pageNumber,
        getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }),
        render(): PdfRenderTaskPort {
          return { promise: Promise.resolve(), cancel: vi.fn() };
        },
      };
    },
    async destroy() {
      // Nothing to release in the structural test document.
    },
  };
}

describe("PreviewPane renderer integration", () => {
  it("keeps controller diagnostics hidden unless technical PDF details are enabled", async () => {
    const bridge = new MemoryRendererBridge();
    bridge.previewState = {
      status: "failed",
      failure: "couldNotBuild",
      message: "Typst stopped at /Users/volunteer/private/bulletin.typ\n    at runPreview (/Users/volunteer/app.js:4:2)",
    };
    const props = {
      bridge,
      localResourceId: "bulletin-1",
      refreshToken: 1,
      enabled: true,
      zoom: "fitPage" as const,
    };
    const view = render(<PreviewPane {...props} showTechnicalDetails={false} />);

    expect(await screen.findByText("The PDF preview could not be prepared.")).toBeTruthy();
    expect(screen.queryByText(/Typst/u)).toBeNull();
    expect(screen.queryByText("Technical details")).toBeNull();

    view.rerender(<PreviewPane {...props} showTechnicalDetails />);
    expect(screen.getByText("Technical details")).toBeTruthy();
    expect(screen.getByText("Typst stopped at [local path]")).toBeTruthy();
    expect(document.body.textContent).not.toContain("/Users/volunteer");
    expect(document.body.textContent).not.toContain("runPreview");
  });

  it("requests the current artifact, opens it through the loader, and follows source navigation", async () => {
    const bridge = new MemoryRendererBridge();
    bridge.previewState = {
      status: "current",
      lastSuccessfulBuildId: "20000000-0000-4000-8000-000000000007",
      pageCount: 2,
      navigationMap: {
        version: 1,
        entries: [{
          resolvedId: "resolved-prayers",
          sourceElementId: "prayers",
          pageNumber: 2,
          region: "body",
        }],
      },
    };
    const requestPreview = vi.spyOn(bridge, "requestPreview");
    const load = vi.fn(async (_artifact: PdfPreviewArtifactRef) => fakeDocument(2));
    const loader: PdfPreviewLoader = { load };
    const createLoader = vi.fn(async () => loader);

    render(
      <PreviewPane
        bridge={bridge}
        localResourceId="bulletin-1"
        refreshToken={1}
        enabled
        zoom="fitPage"
        selectedSourceElementId="prayers"
        createLoader={createLoader}
      />,
    );

    expect(await screen.findByRole("img", { name: "PDF page 2 of 2" })).toBeTruthy();
    expect(screen.getByText("Page 2 of 2", { selector: "output" })).toBeTruthy();
    expect(requestPreview).toHaveBeenCalledWith({
      localResourceId: "bulletin-1",
      requestSequence: 1,
    });
    expect(createLoader).toHaveBeenCalledWith(bridge);
    await waitFor(() => expect(load).toHaveBeenCalledWith(expect.objectContaining({
      bulletinLocalResourceId: "bulletin-1",
      buildId: "20000000-0000-4000-8000-000000000007",
      navigationMap: bridge.previewState.navigationMap,
    }), expect.any(AbortSignal)));
  });

  it("labels only post-layout intentional-blank marker pages as blank", async () => {
    const bridge = new MemoryRendererBridge();
    bridge.previewState = {
      status: "current",
      lastSuccessfulBuildId: "20000000-0000-4000-8000-000000000008",
      pageCount: 3,
      navigationMap: {
        version: 1,
        entries: [
          {
            resolvedId: "before",
            sourceElementId: "before",
            pageNumber: 1,
            region: "body",
          },
          {
            resolvedId: "$cbb:intentional-blank",
            sourceElementId: "blankBreak",
            pageNumber: 2,
            region: "body",
          },
          {
            resolvedId: "after",
            sourceElementId: "after",
            pageNumber: 3,
            region: "body",
          },
        ],
      },
    };
    const load = vi.fn(async () => fakeDocument(3));
    render(
      <PreviewPane
        bridge={bridge}
        localResourceId="bulletin-1"
        refreshToken={1}
        enabled
        zoom="fitPage"
        createLoader={async () => ({ load })}
      />,
    );

    expect(await screen.findByRole("button", {
      name: /Page 2: Page 2 — intentionally blank.*Blank page/u,
    })).toBeTruthy();
    expect(screen.getByText("This compiled PDF page is intentionally blank.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Page 1: Page 1.*Ready/u })).toBeTruthy();
    expect(load).toHaveBeenCalledWith(expect.objectContaining({
      pages: expect.arrayContaining([expect.objectContaining({
        pageNumber: 2,
        status: "blank",
      })]),
      navigationMap: bridge.previewState.navigationMap,
    }), expect.any(AbortSignal));
  });
});
