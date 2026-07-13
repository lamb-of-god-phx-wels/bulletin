import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeSequentialIdPort, type CbbDocument } from "@cbb/core";
import axe from "axe-core";
import { EditorStore } from "../store/editorStore.js";
import { textElement } from "../store/testFixtures.js";
import { EditorWorkspace } from "./EditorWorkspace.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function bulletin(overrides: Partial<CbbDocument> = {}): CbbDocument {
  return {
    version: 2,
    kind: "bulletin",
    name: "Sunday Worship",
    page: {
      typstWidth: "8.5in",
      typstHeight: "11in",
      margins: { top: "0.5in", right: "0.5in", bottom: "0.5in", left: "0.5in" },
    },
    elements: [
      textElement("welcome", "Welcome", { name: "Welcome message" }),
      {
        id: "photo",
        type: "image",
        name: "Church photo",
        data: {
          assetRef: "asset:00000000-0000-4000-8000-000000000001",
          fit: "cover",
          focalPoint: { x: 0.5, y: 0.5 },
        },
      },
    ],
    ...overrides,
  };
}

function dragDataTransfer(): DataTransfer {
  const values = new Map<string, string>();
  return {
    dropEffect: "none",
    effectAllowed: "uninitialized",
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: [],
    clearData: (format?: string) => {
      if (format === undefined) values.clear(); else values.delete(format);
    },
    getData: (format: string) => values.get(format) ?? "",
    setData: (format: string, value: string) => { values.set(format, value); },
    setDragImage: () => undefined,
  };
}

describe("EditorWorkspace", () => {
  it("opens a bulletin in protected Weekly Content with Page View, Structure, and Inspector", () => {
    const store = new EditorStore(bulletin());
    render(<EditorWorkspace store={store} idPort={makeSequentialIdPort(10)} />);

    expect(screen.getByText("Sunday Worship")).toBeTruthy();
    expect(screen.getAllByText("Weekly Content").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Page View")).toBeTruthy();
    expect(screen.getByLabelText("Structure and layers")).toBeTruthy();
    expect(screen.getByLabelText("Inspector")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Customize Layout" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("shows facing pages with a clearly editor-only slot and does not insert a document page", () => {
    const store = new EditorStore(bulletin());
    render(
      <EditorWorkspace
        store={store}
        idPort={makeSequentialIdPort(15)}
        initialPagePresentation="facing"
      />,
    );
    expect(screen.getByRole("note", { name: "Editor-only blank facing-page slot" })).toBeTruthy();
    expect(screen.getByLabelText("Page 1")).toBeTruthy();
    expect(store.getSnapshot()).toMatchObject({ documentRevision: 0, canUndo: false });
  });

  it("edits text directly and exposes every M4 block-format control", () => {
    const store = new EditorStore(bulletin());
    render(<EditorWorkspace store={store} idPort={makeSequentialIdPort(20)} />);

    const direct = screen.getAllByLabelText(/Editable text\. Press Enter or F2 to edit\./u)[0];
    if (direct === undefined) throw new Error("Expected direct text editor");
    fireEvent.keyDown(direct, { key: "F2" });
    const editor = screen.getByRole("textbox", { name: "Text content" });
    editor.textContent = "Grace and peace";
    fireEvent.input(editor);

    expect(screen.getByRole("combobox", { name: "Paragraph style" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bold" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Italic" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bulleted list" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Numbered list" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Block quote" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Insert Scripture" })).toBeTruthy();
    const element = store.getSnapshot().document.elements[0];
    expect(element?.type === "text" ? element.data.content : undefined).toEqual({
      kind: "plain",
      text: "Grace and peace",
    });
  });

  it("starts direct editing from a keyboard-selected text item and returns focus on Escape", () => {
    const store = new EditorStore(bulletin());
    render(<EditorWorkspace store={store} idPort={makeSequentialIdPort(25)} />);
    const item = screen.getByLabelText("Welcome message, text");
    item.focus();
    fireEvent.keyDown(item, { key: "F2" });
    const editor = screen.getByRole("textbox", { name: "Text content" });
    expect(document.activeElement).toBe(editor);
    fireEvent.keyDown(editor, { key: "Escape" });
    expect(document.activeElement?.getAttribute("aria-label")).toContain("Editable text");
  });

  it("opens the same accessible date input directly with Enter or F2", () => {
    const store = new EditorStore(bulletin({
      elements: [{
        id: "service-date",
        type: "date",
        name: "Service date",
        data: { value: "2026-07-12", format: "dddd, MMMM D, YYYY" },
      }],
    }), {
      initialSelection: { kind: "node", nodeId: "service-date" },
    });
    render(<EditorWorkspace store={store} idPort={makeSequentialIdPort(26)} />);
    const item = screen.getByLabelText("Service date, date");
    item.focus();
    fireEvent.keyDown(item, { key: "F2" });
    const input = within(item).getByLabelText("Date") as HTMLInputElement;
    expect(input.value).toBe("2026-07-12");
    fireEvent.change(input, { target: { value: "2026-07-19" } });
    const date = store.getSnapshot().document.elements[0];
    expect(date?.type === "date" ? date.data.value : undefined).toBe("2026-07-19");
    expect(screen.getByText(/Formatted example:/u)).toBeTruthy();
  });

  it("keeps generated page-number text protected and announces its transient page context", () => {
    const store = new EditorStore(bulletin({
      pageElements: [{
        id: "page-number-placement",
        purpose: "pageNumber",
        target: { mode: "all" },
        layer: "overlay",
        region: "bottomMargin",
        anchor: "topCenter",
        x: "50%",
        y: "0in",
        width: "auto",
        height: "auto",
        zIndex: 1,
        clipToRegion: true,
        semantic: { mode: "artifact" },
        element: textElement("page-number-text", "Hidden source", { name: "Page number" }),
      }],
    }), { initialMode: "customizeLayout" });
    const { container } = render(<EditorWorkspace store={store} idPort={makeSequentialIdPort(28)} />);
    const item = container.querySelector<HTMLElement>(".cbb-page-region .cbb-editor-element");
    if (item === null) throw new Error("Expected rendered page number");
    item.focus();
    fireEvent.keyDown(item, { key: "F2" });
    expect(screen.queryByRole("textbox", { name: "Text content" })).toBeNull();
    expect(screen.getByLabelText(/Protected text/u).textContent).toContain("1");
    const pageRegion = container.querySelector<HTMLElement>(".cbb-page-region");
    if (pageRegion === null) throw new Error("Expected page-number region");
    fireEvent.click(within(pageRegion).getByRole("button", { name: "Select placement for Page number" }));
    expect([...container.querySelectorAll<HTMLElement>(".cbb-visually-hidden[role='status']")]
      .some((status) => status.textContent?.includes("page 1") === true)).toBe(true);
  });

  it("edits multi-block rich text without flattening its block and mark structure", () => {
    const rich = textElement("rich", "unused", {
      name: "Rich message",
      data: {
        content: {
          kind: "richText",
          document: {
            type: "document",
            blocks: [
              {
                type: "heading",
                level: 2,
                children: [{ type: "text", text: "Heading", marks: ["strong"] }],
              },
              {
                type: "paragraph",
                children: [{ type: "text", text: "Original paragraph", marks: ["emphasis"] }],
              },
            ],
          },
        },
      },
    });
    const store = new EditorStore(bulletin({ elements: [rich] }));
    const { container } = render(<EditorWorkspace store={store} idPort={makeSequentialIdPort(27)} />);
    const direct = screen.getByLabelText(/Editable text\. Press Enter or F2 to edit\./u);
    fireEvent.keyDown(direct, { key: "F2" });
    const editor = screen.getByRole("textbox", { name: "Text content" });
    const paragraph = container.querySelector<HTMLElement>("[role='textbox'] p em");
    if (paragraph === null) throw new Error("Expected editable rich-text paragraph");
    paragraph.textContent = "Changed paragraph";
    fireEvent.input(editor);

    const updated = store.getSnapshot().document.elements[0];
    expect(updated?.type === "text" ? updated.data.content : undefined).toEqual({
      kind: "richText",
      document: {
        type: "document",
        blocks: [
          {
            type: "heading",
            level: 2,
            children: [{ type: "text", text: "Heading", marks: ["strong"] }],
          },
          {
            type: "paragraph",
            children: [{ type: "text", text: "Changed paragraph", marks: ["emphasis"] }],
          },
        ],
      },
    });
  });

  it("requires confirmation to enter Customize Layout and never adds mode changes to undo", () => {
    const store = new EditorStore(bulletin());
    const confirm = vi.fn(() => true);
    render(<EditorWorkspace store={store} idPort={makeSequentialIdPort(30)} confirmEnterCustomize={confirm} />);

    fireEvent.click(screen.getByRole("button", { name: "Customize Layout" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().mode).toBe("customizeLayout");
    expect(store.getSnapshot().canUndo).toBe(false);
  });

  it("keeps an unparseable inspector buffer visible and commits one valid page-size edit", () => {
    const store = new EditorStore(bulletin(), { initialMode: "customizeLayout" });
    const buffers = vi.fn();
    render(
      <EditorWorkspace
        store={store}
        idPort={makeSequentialIdPort(40)}
        onEditBufferChange={buffers}
      />,
    );

    const width = screen.getByLabelText("Width");
    fireEvent.change(width, { target: { value: "not a length" } });
    fireEvent.blur(width);
    expect(screen.getByRole("alert").textContent).toContain("physical length");
    expect((width as HTMLInputElement).value).toBe("not a length");
    expect(store.getSnapshot().document.page.typstWidth).toBe("8.5in");
    expect(buffers).toHaveBeenCalledWith(expect.objectContaining({ status: "invalid" }));

    fireEvent.change(width, { target: { value: "8in" } });
    fireEvent.blur(width);
    expect(store.getSnapshot().document.page.typstWidth).toBe("8in");
    expect(store.getSnapshot().canUndo).toBe(true);
    expect(buffers).toHaveBeenCalledWith(expect.objectContaining({ status: "committed" }));
  });

  it("provides non-drag structure actions and keyboard undo/redo", () => {
    const store = new EditorStore(bulletin(), {
      initialMode: "customizeLayout",
      initialSelection: { kind: "node", nodeId: "welcome" },
    });
    const { container } = render(<EditorWorkspace store={store} idPort={makeSequentialIdPort(50)} />);
    const structure = screen.getByLabelText("Structure and layers");
    expect(within(structure).getByRole("button", { name: "Move earlier" })).toBeTruthy();
    expect(within(structure).getByRole("button", { name: "Move later" })).toBeTruthy();
    expect(within(structure).getByRole("button", { name: "Duplicate" })).toBeTruthy();
    fireEvent.click(within(structure).getByRole("button", { name: "Duplicate" }));
    expect(store.getSnapshot().document.elements).toHaveLength(3);

    fireEvent.keyDown(container.firstElementChild as Element, { key: "z", ctrlKey: true });
    expect(store.getSnapshot().document.elements).toHaveLength(2);
    fireEvent.keyDown(container.firstElementChild as Element, { key: "y", ctrlKey: true });
    expect(store.getSnapshot().document.elements).toHaveLength(3);
  });

  it("reorders and adds body content directly on the editor surface with drop feedback", () => {
    const store = new EditorStore(bulletin(), { initialMode: "customizeLayout" });
    const { container } = render(<EditorWorkspace store={store} idPort={makeSequentialIdPort(51)} />);
    const welcome = screen.getByLabelText("Welcome message, text");
    const moveTransfer = dragDataTransfer();
    fireEvent.dragStart(welcome, { dataTransfer: moveTransfer });
    const afterPhoto = [...container.querySelectorAll<HTMLElement>(".cbb-editor-drop-zone--after")]
      .find((zone) => zone.textContent === "Drop after Church photo");
    if (afterPhoto === undefined) throw new Error("Expected editor drop target after photo");
    fireEvent.dragOver(afterPhoto, { dataTransfer: moveTransfer });
    expect(afterPhoto.dataset["dropValid"]).toBe("true");
    fireEvent.drop(afterPhoto, { dataTransfer: moveTransfer });
    expect(store.getSnapshot().document.elements.map((element) => element.id)).toEqual(["photo", "welcome"]);

    const addTransfer = dragDataTransfer();
    fireEvent.dragStart(screen.getByRole("button", { name: /^Text$/u }), { dataTransfer: addTransfer });
    const beforePhoto = [...container.querySelectorAll<HTMLElement>(".cbb-editor-drop-zone--before")]
      .find((zone) => zone.textContent === "Drop before Church photo");
    if (beforePhoto === undefined) throw new Error("Expected editor drop target before photo");
    fireEvent.dragEnter(beforePhoto, { dataTransfer: addTransfer });
    expect(beforePhoto.dataset["dropValid"]).toBe("true");
    fireEvent.drop(beforePhoto, { dataTransfer: addTransfer });
    expect(store.getSnapshot().document.elements[0]?.name).toBe("New text");
  });

  it("moves a Structure-selected canvas placement with arrows and cycles placed selections", () => {
    const canvas: CbbDocument["elements"][number] = {
      id: "canvas",
      type: "canvas",
      name: "Free layout",
      children: [{
        id: "canvas-placement",
        x: "0in",
        y: "0in",
        element: textElement("canvas-text", "Move me", { name: "Movable text" }),
      }],
    };
    const store = new EditorStore(bulletin({ elements: [canvas] }), {
      initialMode: "customizeLayout",
      initialSelection: { kind: "node", nodeId: "canvas-placement", surface: "structure" },
    });
    render(<EditorWorkspace store={store} idPort={makeSequentialIdPort(52)} snapSizePx={8} />);
    const placementButton = screen.getByRole("button", { name: "Select placement for Movable text" });
    fireEvent.keyDown(placementButton, { key: "ArrowRight" });
    let current = store.getSnapshot().document.elements[0];
    expect(current?.type === "canvas" ? current.children[0]?.x : undefined).not.toBe("0in");
    expect(store.getSnapshot().selection).toMatchObject({ nodeId: "canvas-placement" });
    fireEvent.keyDown(placementButton, { key: "ArrowDown", shiftKey: true });
    current = store.getSnapshot().document.elements[0];
    expect(current?.type === "canvas" ? current.children[0]?.y : undefined).not.toBe("0in");

    fireEvent.click(screen.getByText("View options"));
    fireEvent.click(screen.getByRole("button", { name: "Cycle items at selection" }));
    expect(store.getSnapshot().selection).toMatchObject({ nodeId: "canvas-text" });
  });

  it("does not treat Delete on a toolbar control as a request to delete the selection", () => {
    const store = new EditorStore(bulletin(), {
      initialMode: "customizeLayout",
      initialSelection: { kind: "node", nodeId: "welcome" },
    });
    render(<EditorWorkspace store={store} idPort={makeSequentialIdPort(55)} />);
    const panelToggle = screen.getByRole("button", { name: "Structure" });
    panelToggle.focus();
    fireEvent.keyDown(panelToggle, { key: "Delete" });
    expect(store.getSnapshot().document.elements).toHaveLength(2);
  });

  it("selects, resizes, and deletes a page placement independently from its content", () => {
    const placed = textElement("footer-text", "Thanks be to God", { name: "Footer text" });
    const store = new EditorStore(bulletin({
      pageElements: [{
        id: "footer-placement",
        purpose: "footer",
        target: { mode: "all" },
        layer: "overlay",
        region: "bottomMargin",
        anchor: "topLeft",
        x: "0in",
        y: "0in",
        width: "7.5in",
        height: "0.4in",
        zIndex: 1,
        clipToRegion: true,
        semantic: { mode: "artifact" },
        element: placed,
      }],
    }), {
      initialMode: "customizeLayout",
    });
    const confirmDelete = vi.fn(() => true);
    const { container } = render(
      <EditorWorkspace
        store={store}
        idPort={makeSequentialIdPort(56)}
        confirmDelete={confirmDelete}
      />,
    );

    const renderedRegion = container.querySelector<HTMLElement>(".cbb-page-region");
    if (renderedRegion === null) throw new Error("Expected rendered footer region");
    fireEvent.click(within(renderedRegion).getByRole("button", { name: "Select placement for Footer text" }));
    expect(store.getSnapshot().selection).toMatchObject({ nodeId: "footer-placement" });
    expect(screen.getByRole("button", { name: /Resize item/u })).toBeTruthy();
    const region = renderedRegion;
    expect(region === null ? undefined : getComputedStyle(region).pointerEvents).toBe("none");
    expect(region?.firstElementChild === null || region?.firstElementChild === undefined
      ? undefined
      : getComputedStyle(region.firstElementChild).pointerEvents).toBe("auto");
    fireEvent.keyDown(container.firstElementChild as Element, { key: "Delete" });
    expect(confirmDelete).toHaveBeenCalledWith("Footer text", false);
    expect(store.getSnapshot().document.pageElements).toEqual([]);
  });

  it("renders persisted appearance, stack spacing, and grid reading order", () => {
    const styled = textElement("styled", "Styled", {
      name: "Styled text",
      style: {
        fontSize: "14pt",
        fontWeight: "bold",
        color: "#123456",
        background: "#eeeeee",
        align: "center",
      },
    });
    const grid: CbbDocument["elements"][number] = {
      id: "grid",
      type: "grid",
      name: "Announcements",
      data: { rows: 2, columns: 1, rowGap: "9pt" },
      children: [
        { id: "later-wrapper", row: 1, column: 0, element: textElement("later", "Second") },
        { id: "first-wrapper", row: 0, column: 0, element: textElement("first", "First") },
      ],
    };
    const store = new EditorStore(bulletin({ elements: [styled, grid] }));
    const { container } = render(<EditorWorkspace store={store} idPort={makeSequentialIdPort(57)} />);

    const article = screen.getByLabelText("Styled text, text") as HTMLElement;
    expect(article.style.fontSize).toBe("14pt");
    expect(article.style.fontWeight).toBe("700");
    expect(article.style.color).toBe("rgb(18, 52, 86)");
    expect(article.style.textAlign).toBe("center");
    const renderedGrid = container.querySelector<HTMLElement>(".cbb-grid-element");
    expect(renderedGrid?.style.rowGap).toBe("9pt");
    expect(renderedGrid?.textContent?.indexOf("First")).toBeLessThan(renderedGrid?.textContent?.indexOf("Second") ?? -1);
  });

  it("renders managed fonts and vertical flow margins without adding horizontal margins", () => {
    const styled = textElement("styled", "Styled", {
      name: "Styled text",
      margin: "12pt",
      style: { fontRef: "font:00000000-0000-4000-8000-000000000010" },
    });
    const store = new EditorStore(bulletin({ elements: [styled] }));
    render(
      <EditorWorkspace
        store={store}
        idPort={makeSequentialIdPort(571)}
        fontFamily={() => "Managed Parish Sans"}
      />,
    );

    const article = screen.getByLabelText("Styled text, text") as HTMLElement;
    expect(article.style.fontFamily).toBe("Managed Parish Sans");
    expect(article.style.marginBlock).toBe("12pt");
    expect(article.style.marginInline).toBe("");
  });

  it("updates contrast guidance from uncommitted color text", () => {
    const store = new EditorStore(bulletin({ elements: [textElement("styled", "Contrast", { name: "Contrast text" })] }), {
      initialMode: "customizeLayout",
      initialSelection: { kind: "node", nodeId: "styled" },
    });
    render(<EditorWorkspace store={store} idPort={makeSequentialIdPort(5711)} />);
    fireEvent.click(screen.getByRole("tab", { name: "Appearance" }));
    fireEvent.change(screen.getByLabelText("Text color"), { target: { value: "#777777" } });
    expect(screen.getByText(/Needs attention: text contrast is/u).textContent).toContain("4.48:1");
    expect(store.getSnapshot().document.elements[0]?.style?.color).toBeUndefined();
  });

  it("reports skipped heading levels in the document accessibility check", () => {
    const rich = textElement("outline", "unused", {
      name: "Service outline",
      data: {
        content: {
          kind: "richText",
          document: {
            type: "document",
            blocks: [{ type: "heading", level: 2, children: [{ type: "text", text: "Opening" }] }],
          },
        },
      },
    });
    const store = new EditorStore(bulletin({ elements: [rich] }), { initialMode: "customizeLayout" });
    render(<EditorWorkspace store={store} idPort={makeSequentialIdPort(5712)} />);
    fireEvent.click(screen.getByRole("tab", { name: "Accessibility" }));
    const check = screen.getByRole("note", { name: "Heading order check" });
    expect(check.textContent).toContain("starts at Heading 2");
  });

  it("shows selectable empty grid cells and preserves row-gap measurement metadata", () => {
    const grid: CbbDocument["elements"][number] = {
      id: "grid",
      type: "grid",
      name: "Assignments",
      data: { rows: 2, columns: 2, rowGap: "9pt" },
      children: [{ id: "first-cell", row: 0, column: 0, element: textElement("first", "Filled") }],
    };
    const store = new EditorStore(bulletin({ elements: [grid] }), { initialMode: "customizeLayout" });
    const { container } = render(<EditorWorkspace store={store} idPort={makeSequentialIdPort(572)} />);

    const empty = screen.getAllByRole("button", { name: /Empty grid cell/u })[0];
    if (empty === undefined) throw new Error("Expected an empty grid cell");
    fireEvent.click(empty);
    expect(store.getSnapshot().selection).toMatchObject({ nodeId: "grid" });
    const secondRow = container.querySelector<HTMLElement>("[data-cbb-fragment-index='1']");
    expect(Number(secondRow?.dataset["cbbFragmentGapBefore"])).toBe(12);
  });

  it("grows an automatic canvas to include lower placed children", () => {
    const canvas: CbbDocument["elements"][number] = {
      id: "canvas",
      type: "canvas",
      name: "Free layout",
      children: [{
        id: "placed",
        x: "0in",
        y: "3in",
        element: textElement("low-text", "Still visible"),
      }],
    };
    const store = new EditorStore(bulletin({ elements: [canvas] }));
    const { container } = render(<EditorWorkspace store={store} idPort={makeSequentialIdPort(573)} />);
    const rendered = container.querySelector<HTMLElement>(".cbb-canvas-element");
    expect(Number.parseFloat(rendered?.style.minHeight ?? "0")).toBeGreaterThan(300);
  });

  it("shows explicit canvas reading and paint order on demand", () => {
    const canvas: CbbDocument["elements"][number] = {
      id: "canvas",
      type: "canvas",
      name: "Free layout",
      children: [{
        id: "placed",
        x: "0in",
        y: "0in",
        semanticOrder: 3,
        element: textElement("reading-text", "Read me"),
      }],
    };
    const store = new EditorStore(bulletin({ elements: [canvas] }), { initialMode: "customizeLayout" });
    render(<EditorWorkspace store={store} idPort={makeSequentialIdPort(5731)} />);
    fireEvent.click(screen.getByText("View options"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Show reading order" }));
    expect(screen.getByText("Reading 4; paint 1")).toBeTruthy();
  });

  it("attaches named overflow recovery to the affected item", () => {
    const value = bulletin({
      page: {
        typstWidth: "4in",
        typstHeight: "4in",
        margins: { top: "0.5in", right: "0.5in", bottom: "0.5in", left: "0.5in" },
      },
      elements: [bulletin().elements[1]!],
    });
    const store = new EditorStore(value, { initialMode: "customizeLayout" });
    render(
      <EditorWorkspace
        store={store}
        idPort={makeSequentialIdPort(574)}
        measurements={{ photo: { heightPx: 500 } }}
      />,
    );

    const notice = screen.getByRole("note", { name: "Overflow for Church photo" });
    expect(notice.textContent).toContain("Church photo does not fit");
    fireEvent.click(within(notice).getByRole("button", { name: "Go to item" }));
    expect(store.getSnapshot().selection).toMatchObject({ nodeId: "photo" });
  });

  it("offers equal/two-column presets, gutters, and table semantics without dragging", () => {
    const grid: CbbDocument["elements"][number] = {
      id: "grid",
      type: "grid",
      name: "Assignments",
      data: { rows: 1, columns: 2 },
      children: [
        { id: "left-cell", row: 0, column: 0, element: textElement("left", "Name") },
        { id: "right-cell", row: 0, column: 1, element: textElement("right", "Assignment") },
      ],
    };
    const store = new EditorStore(bulletin({ elements: [grid] }), {
      initialMode: "customizeLayout",
      initialSelection: { kind: "node", nodeId: "grid" },
    });
    render(<EditorWorkspace store={store} idPort={makeSequentialIdPort(58)} />);
    const widths = screen.getByLabelText("Column widths");
    fireEvent.change(widths, { target: { value: "2fr,1fr" } });
    fireEvent.change(screen.getByLabelText("This grid is"), { target: { value: "table" } });

    const updated = store.getSnapshot().document.elements[0];
    expect(updated?.type === "grid" ? updated.data : undefined).toMatchObject({
      columnTracks: ["2fr", "1fr"],
      semanticRole: "table",
    });
    expect(screen.getByLabelText("Row gap")).toBeTruthy();
    expect(screen.getByLabelText("Column gap")).toBeTruthy();
    expect(screen.getByLabelText("Table summary")).toBeTruthy();
    expect(screen.getByLabelText("Header rows")).toBeTruthy();
    expect(screen.getByLabelText("Header columns")).toBeTruthy();
    const gutter = screen.getByRole("button", { name: /Resize column gutter 1/u });
    expect((gutter as HTMLElement).style.left).toContain("66.666");
    fireEvent.keyDown(gutter, { key: "ArrowRight" });
    const resized = store.getSnapshot().document.elements[0];
    expect(resized?.type === "grid" ? resized.data.columnGap : undefined).toBeDefined();
  });

  it("exposes image crop and accessible-description controls without dragging", () => {
    const imageDocument = bulletin();
    const store = new EditorStore({
      ...imageDocument,
      elements: imageDocument.elements.map((element) => element.id === "photo"
        ? { ...element, width: "2in", height: "1in" }
        : element),
    }, {
      initialSelection: { kind: "node", nodeId: "photo" },
    });
    render(
      <EditorWorkspace
        store={store}
        idPort={makeSequentialIdPort(60)}
        assetInfo={() => ({
          displayName: "church-front.jpg",
          kind: "raster",
          pixelWidth: 200,
          pixelHeight: 200,
        })}
      />,
    );

    expect(screen.getByRole("button", { name: "Replace image" })).toBeTruthy();
    expect(screen.getByLabelText("Image fit")).toBeTruthy();
    expect(screen.getByText("church-front.jpg")).toBeTruthy();
    expect(screen.getByText(/Effective print resolution: 100 PPI — low for print/u)).toBeTruthy();
    expect(screen.getByText("Adjust crop")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Accessibility" }));
    expect(screen.getByLabelText("This image is only decorative")).toBeTruthy();
    expect(screen.getByLabelText("Description for people who cannot see the image")).toBeTruthy();
  });

  it("offers image replacement at a missing image on the page", () => {
    const store = new EditorStore(bulletin(), { initialSelection: { kind: "node", nodeId: "photo" } });
    const replace = vi.fn();
    render(
      <EditorWorkspace
        store={store}
        idPort={makeSequentialIdPort(601)}
        onRequestImageReplacement={replace}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Find replacement" }));
    expect(replace).toHaveBeenCalledWith("photo", "asset:00000000-0000-4000-8000-000000000001");
  });

  it("preserves image proportions by default and offers an explicit visual-resize unlock", () => {
    const store = new EditorStore(bulletin(), {
      initialMode: "customizeLayout",
      initialSelection: { kind: "node", nodeId: "photo" },
    });
    render(<EditorWorkspace store={store} idPort={makeSequentialIdPort(61)} />);
    const lock = screen.getByRole("checkbox", { name: "Keep image proportions" }) as HTMLInputElement;
    expect(lock.checked).toBe(true);
    fireEvent.click(lock);
    expect(lock.checked).toBe(false);
    expect(screen.getByRole("button", { name: /Resize item/u })).toBeTruthy();
  });

  it("opens template authoring as a focus-managed drawer and restores focus when it closes", async () => {
    const store = new EditorStore(bulletin(), { initialMode: "customizeLayout" });
    render(<EditorWorkspace store={store} idPort={makeSequentialIdPort(65)} />);

    const toggle = screen.getByRole("button", { name: "Template tools" });
    fireEvent.click(toggle);
    const drawer = screen.getByRole("complementary", { name: "Template authoring tools" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const close = within(drawer).getByRole("button", { name: "Close template tools" });
    await waitFor(() => expect(document.activeElement).toBe(close));

    fireEvent.keyDown(close, { key: "Escape" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await waitFor(() => expect(document.activeElement).toBe(toggle));
  });

  it("keeps only one secondary drawer open in narrow layouts and restores focus on Escape", async () => {
    vi.stubGlobal("matchMedia", vi.fn((query: string): MediaQueryList => ({
      matches: query === "(max-width: 76rem)",
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })));
    const store = new EditorStore(bulletin(), { initialMode: "customizeLayout" });
    const { container } = render(<EditorWorkspace store={store} idPort={makeSequentialIdPort(66)} />);
    const workspace = container.querySelector<HTMLElement>(".cbb-editor-workspace");
    if (workspace === null) throw new Error("Expected editor workspace");
    await waitFor(() => expect(workspace.dataset["inspectorOpen"]).toBe("false"));
    expect(workspace.dataset["structureOpen"]).toBe("true");

    const inspectorToggle = screen.getByRole("button", { name: "Inspector" });
    fireEvent.click(inspectorToggle);
    expect(workspace.dataset["inspectorOpen"]).toBe("true");
    expect(workspace.dataset["structureOpen"]).toBe("false");
    const layoutTab = screen.getByRole("tab", { name: "Layout" });
    layoutTab.focus();
    fireEvent.keyDown(layoutTab, { key: "Escape" });
    await waitFor(() => expect(workspace.dataset["inspectorOpen"]).toBe("false"));
    await waitFor(() => expect(document.activeElement).toBe(inspectorToggle));
  });

  it("previews and applies replace-all as one undoable document command", async () => {
    const store = new EditorStore(bulletin({
      elements: [
        textElement("first", "Welcome, welcome", { name: "Greeting" }),
        textElement("locked", "Welcome protected", {
          name: "Protected greeting",
          authoringPolicy: { contentLocked: true },
        }),
      ],
    }));
    const { container } = render(<EditorWorkspace store={store} idPort={makeSequentialIdPort(67)} />);
    const workspace = container.querySelector<HTMLElement>(".cbb-editor-workspace");
    if (workspace === null) throw new Error("Expected editor workspace");
    fireEvent.keyDown(workspace, { key: "f", ctrlKey: true });
    const find = await screen.findByRole("searchbox", { name: "Find" });
    fireEvent.change(find, { target: { value: "welcome" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Replace with" }), { target: { value: "Hello" } });
    expect(screen.getByText(/3 matches: 2 replaceable, 1 skipped/u)).toBeTruthy();
    expect(screen.getByText(/Skipped — This content is protected/u)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Replace all (2)" }));
    expect(store.getSnapshot()).toMatchObject({ canUndo: true, undoLabel: "Replace 2 matches" });
    expect(store.getSnapshot().document.elements[0]).toMatchObject({
      data: { content: { kind: "plain", text: "Hello, Hello" } },
    });
    expect(store.getSnapshot().document.elements[1]).toMatchObject({
      data: { content: { kind: "plain", text: "Welcome protected" } },
    });
    store.undo();
    expect(store.getSnapshot().document.elements[0]).toMatchObject({
      data: { content: { kind: "plain", text: "Welcome, welcome" } },
    });
  });

  it("keeps the open find preview accessible", async () => {
    const store = new EditorStore(bulletin());
    const { container } = render(<EditorWorkspace store={store} idPort={makeSequentialIdPort(68)} />);
    fireEvent.click(screen.getByRole("button", { name: "Find / Replace" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Find" }), { target: { value: "Welcome" } });
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
  });

  it("has no automated landmark, tree, tab, naming, or form violations", async () => {
    const store = new EditorStore(bulletin(), {
      initialMode: "customizeLayout",
      initialSelection: { kind: "node", nodeId: "photo" },
    });
    const { container } = render(<EditorWorkspace store={store} idPort={makeSequentialIdPort(70)} />);
    const result = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(result.violations).toEqual([]);
  });
});
