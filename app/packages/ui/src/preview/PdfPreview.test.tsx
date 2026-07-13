import { createRef } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  LoadedPdfDocumentPort,
  PdfPagePort,
  PdfPreviewArtifactRef,
  PdfPreviewLoader,
  PdfRenderTaskPort,
} from "./pdfLoader.js";
import { PdfPreview } from "./PdfPreview.js";
import type {
  PdfPreviewArtifact,
  PdfPreviewHandle,
  PdfPreviewPublication,
} from "./previewTypes.js";

afterEach(cleanup);

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

interface FakeDocument extends LoadedPdfDocumentPort {
  readonly getPage: ReturnType<typeof vi.fn<(pageNumber: number) => Promise<PdfPagePort>>>;
  readonly destroy: ReturnType<typeof vi.fn<() => Promise<void>>>;
  readonly renderTasks: PdfRenderTaskPort[];
}

function fakeDocument(
  numPages: number,
  options: { readonly pendingRenders?: boolean } = {},
): FakeDocument {
  const renderTasks: PdfRenderTaskPort[] = [];
  const getPage = vi.fn(async (pageNumber: number): Promise<PdfPagePort> => ({
    pageNumber,
    getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }),
    render: () => {
      const task = {
        promise: options.pendingRenders ? new Promise<void>(() => undefined) : Promise.resolve(),
        cancel: vi.fn(),
      } satisfies PdfRenderTaskPort;
      renderTasks.push(task);
      return task;
    },
  }));
  const destroy = vi.fn(async () => undefined);
  return { numPages, getPage, destroy, renderTasks };
}

function artifact(
  buildId: string,
  overrides: Partial<PdfPreviewArtifact> = {},
): PdfPreviewArtifact {
  return {
    bulletinLocalResourceId: "bulletin-1",
    buildId,
    ...overrides,
  };
}

function loaderFrom(
  load: (artifact: PdfPreviewArtifactRef, signal?: AbortSignal) => Promise<LoadedPdfDocumentPort>,
): PdfPreviewLoader & { readonly load: ReturnType<typeof vi.fn<typeof load>> } {
  return { load: vi.fn(load) };
}

function current(value: PdfPreviewArtifact): PdfPreviewPublication {
  return { status: "current", artifact: value };
}

describe("PdfPreview", () => {
  it("keeps updating and empty states inside the preview frame", () => {
    const loader = loaderFrom(async () => fakeDocument(1));
    render(
      <PdfPreview
        loader={loader}
        publication={{ status: "updating", message: "Preparing the latest edits." }}
      />,
    );

    expect(screen.getByText("Updating preview")).toBeTruthy();
    expect(screen.getByText("Preparing the latest edits.")).toBeTruthy();
    expect(screen.getByText("No PDF to show yet")).toBeTruthy();
    expect(screen.getByText("No page outline is available yet.")).toBeTruthy();
    expect(loader.load).not.toHaveBeenCalled();
  });

  it("renders page canvases, labeled thumbnails, an outline, navigation, and 25–200% zoom", async () => {
    const document = fakeDocument(3);
    const loader = loaderFrom(async () => document);
    const onPageChange = vi.fn();
    const previewArtifact = artifact("build-a", {
      pages: [
        { pageNumber: 1, label: "Cover", status: "ready" },
        { pageNumber: 2, label: "Prayers", status: "blank", findingCount: 3 },
        { pageNumber: 3, label: "Announcements", summary: "Community news" },
      ],
      navigationMap: {
        version: 1,
        entries: [{
          resolvedId: "resolved-prayers",
          sourceElementId: "prayers",
          pageNumber: 2,
          region: "body",
        }],
      },
    });
    const { container } = render(
      <PdfPreview
        loader={loader}
        publication={current(previewArtifact)}
        viewportSize={{ width: 648, height: 448 }}
        onPageChange={onPageChange}
      />,
    );

    await screen.findByRole("img", { name: "PDF page 1 of 3" });
    const pageTwoThumbnail = screen.getByRole("button", {
      name: /Page 2: Prayers\. Blank page · 3 findings\. Preview current/u,
    });
    fireEvent.click(pageTwoThumbnail);
    expect(screen.getByText("Page 2 of 3", { selector: "output" })).toBeTruthy();
    expect(await screen.findByRole("img", { name: "PDF page 2 of 3" })).toBeTruthy();
    expect(onPageChange).toHaveBeenLastCalledWith({
      pageNumber: 2,
      reason: "thumbnail",
      sourceElementIds: ["prayers"],
      resolvedIds: ["resolved-prayers"],
    });

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Page 3 of 3", { selector: "output" })).toBeTruthy();
    const outline = screen.getByRole("navigation", { name: "Page outline" });
    fireEvent.click(within(outline).getByRole("button", { name: /Page 1: Cover/u }));
    expect(screen.getByText("Page 1 of 3", { selector: "output" })).toBeTruthy();

    const region = screen.getByRole("region", { name: "PDF preview" });
    fireEvent.keyDown(region, { key: "End" });
    expect(screen.getByText("Page 3 of 3", { selector: "output" })).toBeTruthy();
    fireEvent.keyDown(region, { key: "Home" });
    expect(screen.getByText("Page 1 of 3", { selector: "output" })).toBeTruthy();

    const zoom = screen.getByRole("spinbutton", { name: "Zoom" }) as HTMLInputElement;
    fireEvent.click(screen.getByRole("button", { name: "Fit page" }));
    await waitFor(() => expect(zoom.value).toBe("50"));
    fireEvent.click(screen.getByRole("button", { name: "Fit width" }));
    await waitFor(() => expect(zoom.value).toBe("100"));
    fireEvent.change(zoom, { target: { value: "500" } });
    expect(zoom.value).toBe("200");
    fireEvent.change(zoom, { target: { value: "10" } });
    expect(zoom.value).toBe("25");

    const report = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(report.violations.filter((violation) =>
      violation.impact === "critical" || violation.impact === "serious"
    )).toEqual([]);
  });

  it("preserves the last successful PDF while a replacement loads and after it fails", async () => {
    const first = fakeDocument(2);
    const loader = loaderFrom(async (requested) => {
      if (requested.buildId === "build-b") {
        throw new Error("Typst could not read /home/taylor/private/main.typ\n    at renderPreview (/home/taylor/app.ts:10:2)");
      }
      return first;
    });
    const firstArtifact = artifact("build-a", {
      pages: [{ pageNumber: 1, label: "Cover" }, { pageNumber: 2, label: "Worship" }],
    });
    const { rerender } = render(
      <PdfPreview loader={loader} publication={current(firstArtifact)} />,
    );
    await screen.findByRole("img", { name: "PDF page 1 of 2" });

    rerender(<PdfPreview loader={loader} publication={current(artifact("build-b"))} />);
    expect(screen.getByRole("img", { name: "PDF page 1 of 2" })).toBeTruthy();
    expect(screen.getByText(/last successful preview remains visible until the new PDF is ready/u)).toBeTruthy();
    await screen.findByText("The PDF preview could not be displayed. The last successful preview remains visible.");
    expect(screen.queryByText(/Typst/u)).toBeNull();
    expect(screen.queryByText("Technical details")).toBeNull();
    expect(screen.getByRole("img", { name: "PDF page 1 of 2" })).toBeTruthy();
    expect(first.destroy).not.toHaveBeenCalled();

    rerender(
      <PdfPreview
        loader={loader}
        publication={current(artifact("build-b"))}
        showTechnicalDetails
      />,
    );
    expect(screen.getByText("Technical details")).toBeTruthy();
    expect(screen.getByText("Typst could not read [local path]")).toBeTruthy();
    expect(document.body.textContent).not.toContain("/home/taylor");
    expect(document.body.textContent).not.toContain("renderPreview");

    rerender(
      <PdfPreview
        loader={loader}
        publication={{
          status: "failed",
          artifact: firstArtifact,
          attemptedBuildId: "build-b",
          message: "The latest edits did not produce a PDF.",
        }}
      />,
    );
    expect(await screen.findByText(/The latest edits did not produce a PDF/u)).toBeTruthy();
    expect(screen.getByRole("img", { name: "PDF page 1 of 2" })).toBeTruthy();
  });

  it("keeps stale and failed messaging persistent even when no artifact is repeated by the controller", async () => {
    const document = fakeDocument(1);
    const loader = loaderFrom(async () => document);
    const { rerender } = render(
      <PdfPreview loader={loader} publication={current(artifact("build-a"))} />,
    );
    await screen.findByRole("img", { name: "PDF page 1 of 1" });

    rerender(
      <PdfPreview
        loader={loader}
        publication={{ status: "stale", message: "The bulletin changed after this PDF was built." }}
      />,
    );
    expect(screen.getByText("Preview out of date")).toBeTruthy();
    expect(screen.getByText(/last successful preview remains visible/u)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Preview out of date/u })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fit width" }));
    expect(screen.getByText("Preview out of date")).toBeTruthy();

    rerender(
      <PdfPreview
        loader={loader}
        publication={{ status: "failed", message: "The replacement build timed out." }}
      />,
    );
    expect(screen.getByText("Preview failed")).toBeTruthy();
    expect(screen.getByRole("img", { name: "PDF page 1 of 1" })).toBeTruthy();
    expect(document.destroy).not.toHaveBeenCalled();
  });

  it("prevents a slow superseded load from replacing a newer PDF", async () => {
    const older = deferred<LoadedPdfDocumentPort>();
    const newer = deferred<LoadedPdfDocumentPort>();
    const oldDocument = fakeDocument(1);
    const newDocument = fakeDocument(2);
    const loader = loaderFrom((requested) => requested.buildId === "old" ? older.promise : newer.promise);
    const { rerender } = render(
      <PdfPreview loader={loader} publication={current(artifact("old"))} />,
    );
    rerender(<PdfPreview loader={loader} publication={current(artifact("new"))} />);

    await act(async () => newer.resolve(newDocument));
    expect(await screen.findByRole("img", { name: "PDF page 1 of 2" })).toBeTruthy();
    await act(async () => older.resolve(oldDocument));
    await waitFor(() => expect(oldDocument.destroy).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("img", { name: "PDF page 1 of 2" })).toBeTruthy();
    expect(newDocument.destroy).not.toHaveBeenCalled();
  });

  it("navigates source occurrences through the build-specific map and explains a missing map", async () => {
    const document = fakeDocument(4);
    const loader = loaderFrom(async () => document);
    const ref = createRef<PdfPreviewHandle>();
    const mappedArtifact = artifact("mapped", {
      navigationMap: {
        version: 1,
        entries: [
          { resolvedId: "repeat-1", sourceElementId: "weekly-prayer", pageNumber: 1, region: "body" },
          { resolvedId: "repeat-2", sourceElementId: "weekly-prayer", pageNumber: 4, region: "body" },
          { resolvedId: "pastor-note", sourceElementId: "note", pageNumber: 2, region: "page-foreground" },
        ],
      },
    });
    const onPageChange = vi.fn();
    const { rerender } = render(
      <PdfPreview
        ref={ref}
        loader={loader}
        publication={current(mappedArtifact)}
        initialPage={3}
        selectedSourceElementId="weekly-prayer"
        onPageChange={onPageChange}
      />,
    );

    await waitFor(() => expect(screen.getByText("Page 4 of 4", { selector: "output" })).toBeTruthy());
    expect(onPageChange).toHaveBeenLastCalledWith(expect.objectContaining({
      pageNumber: 4,
      reason: "source",
    }));
    act(() => {
      expect(ref.current?.goToResolvedSource("pastor-note")).toBe(true);
    });
    expect(screen.getByText("Page 2 of 4", { selector: "output" })).toBeTruthy();
    act(() => {
      expect(ref.current?.goToSource("missing-source")).toBe(false);
      expect(ref.current?.goToPage(99)).toBe(false);
    });

    rerender(
      <PdfPreview
        ref={ref}
        loader={loader}
        publication={current(artifact("mapped"))}
        selectedSourceElementId="weekly-prayer"
      />,
    );
    expect(await screen.findByText(/Jump to selection is unavailable for this preview/u)).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Page outline" })).toBeTruthy();
  });

  it("cancels page renders and destroys superseded and unmounted documents", async () => {
    const first = fakeDocument(1, { pendingRenders: true });
    const second = fakeDocument(1, { pendingRenders: true });
    const loader = loaderFrom(async (requested) => requested.buildId === "first" ? first : second);
    const { rerender, unmount } = render(
      <PdfPreview loader={loader} publication={current(artifact("first"))} />,
    );
    await screen.findByRole("img", { name: "PDF page 1 of 1" });
    await waitFor(() => expect(first.renderTasks.length).toBeGreaterThan(0));

    rerender(<PdfPreview loader={loader} publication={current(artifact("second"))} />);
    await waitFor(() => expect(first.destroy).toHaveBeenCalledTimes(1));
    expect(first.renderTasks.some((task) => vi.mocked(task.cancel).mock.calls.length > 0)).toBe(true);
    await screen.findByRole("img", { name: "PDF page 1 of 1" });

    unmount();
    expect(second.destroy).toHaveBeenCalledTimes(1);
    expect(second.renderTasks.some((task) => vi.mocked(task.cancel).mock.calls.length > 0)).toBe(true);
  });
});
