import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeSequentialIdPort, type CbbDocument, type NativeElement } from "@cbb/core";
import { EditorStore } from "../store/editorStore.js";
import { assertEditorDocumentValid } from "../store/documentValidation.js";
import {
  customInstanceFixture,
  finalizedCustomDefinitionFixture,
  textElement,
} from "../store/testFixtures.js";
import { StructureTree } from "./StructureTree.js";

afterEach(cleanup);

function documentWith(elements: readonly NativeElement[]): CbbDocument {
  return {
    version: 2,
    kind: "bulletin",
    name: "Structure test",
    page: { typstWidth: "8.5in", typstHeight: "11in" },
    elements,
  };
}

function dataTransfer(): DataTransfer {
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
    setData: (format: string, value: string) => {
      values.set(format, value);
    },
    setDragImage: () => undefined,
  };
}

function setup(
  document: CbbDocument,
  selectedNodeId?: string,
  onChooseImageAsset: () => Promise<string | undefined> = async () =>
    "asset:00000000-0000-4000-8000-000000000123",
) {
  const store = new EditorStore(document, {
    initialMode: "customizeLayout",
    ...(selectedNodeId === undefined
      ? {}
      : { initialSelection: { kind: "node" as const, nodeId: selectedNodeId } }),
  });
  const announcements = vi.fn();
  render(
    <StructureTree
      document={store.getSnapshot().document}
      store={store}
      mode="customizeLayout"
      selectedNodeId={selectedNodeId}
      idPort={makeSequentialIdPort(100)}
      onAnnouncement={announcements}
      onChooseImageAsset={onChooseImageAsset}
      confirmDelete={() => true}
    />,
  );
  return { store, announcements };
}

describe("StructureTree drag, drop, and non-drag parity", () => {
  it("uses Saved section task language for reusable content instances", () => {
    const definition = finalizedCustomDefinitionFixture({
      version: 1,
      kind: "customElementDefinition",
      id: "saved-prayers",
      name: "Reusable prayers",
      fieldContract: {
        id: "10000000-0000-4000-8000-000000000071",
        version: 1,
        name: "Reusable prayer fields",
        fields: [],
      },
      elements: [textElement("saved-prayer-text", "Prayer")],
    });
    setup({
      ...documentWith([customInstanceFixture(definition, {
        id: "saved-instance",
        type: "customInstance",
        name: "Reusable prayers",
      })]),
      customElementDefinitions: [definition],
    });

    const row = screen.getByRole("treeitem", { name: /Reusable prayers/u });
    expect(row.textContent).toContain("Saved section");
    expect(row.textContent).not.toContain("Custom section");
  });

  it("names conditional, repeat, page scope, clipping, and artifact state in tree rows", () => {
    const conditional = textElement("conditional", "Optional", { name: "Optional section" });
    const repeated = textElement("repeated", "Prototype", { name: "Prayer row" });
    const value: CbbDocument = {
      ...documentWith([conditional, repeated]),
      fieldContract: {
        id: "00000000-0000-4000-8000-000000000040",
        version: 1,
        name: "Weekly fields",
        fields: [
          { id: "include", label: "Include section", type: "boolean", required: true },
          {
            id: "prayers",
            label: "Prayers",
            type: "array",
            required: true,
            constraints: { maxItems: 10 },
            itemField: { id: "prayer", label: "Prayer", type: "text", required: true },
          },
        ],
      },
      fieldValues: {
        include: { value: false, origin: "manual" },
        prayers: {
          value: ["One", "Two"],
          origin: "manual",
          itemIds: [
            "10000000-0000-4000-8000-000000000001",
            "10000000-0000-4000-8000-000000000002",
          ],
        },
      },
      contentRules: [
        {
          kind: "conditional",
          id: "conditional-rule",
          targetNodeId: "conditional",
          scope: "document",
          fieldId: "include",
          condition: { kind: "booleanEquals", value: true },
          activateLabel: "Include it",
          inactiveLabel: "Not used this week",
        },
        {
          kind: "repeat",
          id: "repeat-rule",
          fieldId: "prayers",
          prototypeNodeId: "repeated",
          emptyState: { mode: "collapse" },
          maxItems: 10,
          userReorderable: true,
          itemLabel: "Prayer",
          addLabel: "Add prayer",
        },
      ],
      pageElements: [{
        id: "footer-wrapper",
        purpose: "footer",
        target: { mode: "all" },
        layer: "overlay",
        region: "bottomMargin",
        anchor: "topLeft",
        x: "0in",
        y: "0in",
        width: "auto",
        height: "auto",
        zIndex: 0,
        clipToRegion: true,
        semantic: { mode: "artifact" },
        element: textElement("footer", "Footer", { name: "Footer" }),
      }],
    };
    setup(value);

    expect(screen.getByRole("treeitem", { name: /Optional section/u }).textContent).toContain("Not used this week");
    expect(screen.getByRole("treeitem", { name: /Prayer row/u }).textContent).toContain("repeatable section, 2 items");
    const footer = screen.getByRole("treeitem", { name: /Footer/u });
    expect(footer.textContent).toContain("repeats on all pages");
    expect(footer.textContent).toContain("clipped to bottomMargin region");
    expect(footer.textContent).toContain("decorative — skipped in reading order");
  });

  it("supports standard tree arrow, Home, and End focus navigation", () => {
    setup(documentWith([
      textElement("first", "First"),
      textElement("second", "Second"),
      textElement("third", "Third"),
    ]));
    const tree = screen.getByRole("tree", { name: "Bulletin structure" });
    tree.focus();
    fireEvent.keyDown(tree, { key: "Home" });
    const items = screen.getAllByRole("treeitem");
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "End" });
    expect(document.activeElement).toBe(items.at(-1));
  });

  it("lets authors select placement settings independently from child content", () => {
    const stack: NativeElement = {
      id: "stack",
      type: "stack",
      name: "Section",
      data: { direction: "vertical", gap: "6pt" },
      children: [{ id: "child-placement", index: 0, element: textElement("child", "Child") }],
    };
    const { store } = setup(documentWith([stack]));
    const placement = screen.getByRole("button", { name: "Select placement for child" });
    expect(placement.title).toBe(
      "Select placement settings for position, size, and layout protection",
    );
    fireEvent.click(placement);
    expect(store.getSnapshot().selection).toEqual({
      kind: "node",
      nodeId: "child-placement",
      surface: "structure",
    });
  });

  it("adds before or after the selection without requiring drag and keeps page breaks top-level", () => {
    const { store } = setup(
      documentWith([textElement("first", "First"), textElement("second", "Second")]),
      "second",
    );

    const placement = screen.getByLabelText("Add placement");
    expect(within(placement).getByRole("option", { name: "After selection" })).toBeTruthy();
    fireEvent.change(placement, { target: { value: "before" } });
    fireEvent.click(screen.getByRole("button", { name: /^Text$/u }));

    expect(store.getSnapshot().document.elements.map((element) => element.name)).toEqual([
      "first",
      "New text",
      "second",
    ]);
    expect(store.getSnapshot()).toMatchObject({ canUndo: true, documentRevision: 1 });
  });

  it("adds a chosen validated image, date, and page furniture without requiring drag", async () => {
    const { store } = setup(documentWith([]));
    fireEvent.click(screen.getByRole("button", { name: "Image" }));
    await waitFor(() => {
      expect(store.getSnapshot().document.elements).toHaveLength(1);
    });
    fireEvent.click(screen.getByRole("button", { name: "Date" }));
    fireEvent.click(screen.getByRole("button", { name: "Page number" }));

    await waitFor(() => {
      expect(store.getSnapshot().document.elements.map((element) => element.type).sort()).toEqual(["date", "image"]);
    });
    expect(store.getSnapshot().document.elements.find((element) => element.type === "image")).toMatchObject({
      data: { assetRef: "asset:00000000-0000-4000-8000-000000000123" },
    });
    expect(store.getSnapshot().document.pageElements?.[0]).toMatchObject({
      purpose: "pageNumber",
      target: { mode: "all" },
      element: { name: "Page number" },
    });
    expect(store.getSnapshot().selection).toMatchObject({
      nodeId: store.getSnapshot().document.pageElements?.[0]?.id,
    });
  });

  it("offers a discoverable Hymn/Song action with explicit unknown rights", () => {
    const { store, announcements } = setup(documentWith([]));
    fireEvent.click(screen.getByRole("button", { name: "Hymn/Song" }));

    const added = store.getSnapshot().document.elements[0];
    expect(added).toMatchObject({
      type: "music",
      name: "New hymn or song",
      data: {
        title: "New hymn or song",
        richContent: { type: "document", blocks: [{ type: "paragraph", children: [] }] },
        rights: [{ status: "unknown", component: "other", creditRequiredWhen: "never" }],
      },
    });
    expect(added?.type === "music" ? added.data.rights[0]?.creditProjectionHash : undefined)
      .toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(() => assertEditorDocumentValid(store.getSnapshot().document)).not.toThrow();
    expect(announcements).toHaveBeenLastCalledWith("New hymn or song added");
  });

  it("adds, configures, and moves the one Copyrights & Permissions block", () => {
    const { store } = setup(documentWith([textElement("welcome", "Welcome")]));
    fireEvent.click(screen.getByRole("button", { name: "Copyrights & Permissions" }));
    const credits = store.getSnapshot().document.elements[1];
    expect(credits).toMatchObject({
      type: "rightsAttribution",
      data: {
        heading: "Copyrights & Permissions",
        groupOrder: ["scripture", "music", "other"],
        includePublicDomainLines: true,
      },
    });
    cleanup();
    const moved = setup(store.getSnapshot().document, credits?.id);
    fireEvent.click(screen.getByRole("button", { name: "Move earlier" }));
    expect(moved.store.getSnapshot().document.elements.map((element) => element.type)).toEqual([
      "rightsAttribution",
      "text",
    ]);

    cleanup();
    setup(moved.store.getSnapshot().document);
    expect((screen.getByRole("button", { name: "Copyrights & Permissions" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables image and page-background insertion with an exposed availability reason", () => {
    const store = new EditorStore(documentWith([]), { initialMode: "customizeLayout" });
    render(
      <StructureTree
        document={store.getSnapshot().document}
        store={store}
        mode="customizeLayout"
        idPort={makeSequentialIdPort(200)}
        onChooseImageAsset={async () => "asset:00000000-0000-4000-8000-000000000123"}
        imageLibraryUnavailableReason="Install an image in Settings before adding one."
      />,
    );
    expect((screen.getByRole("button", { name: "Image" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Background" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Install an image in Settings/u)).toBeTruthy();
  });

  it("does not create a fake image element when the asset chooser is canceled", async () => {
    const { store, announcements } = setup(documentWith([]), undefined, async () => undefined);
    fireEvent.click(screen.getByRole("button", { name: "Image" }));
    await waitFor(() => expect(announcements).toHaveBeenCalledWith("No image was added."));
    expect(store.getSnapshot().document.elements).toEqual([]);
    expect(JSON.stringify(store.getSnapshot().document)).not.toContain(
      "asset:00000000-0000-4000-8000-000000000000",
    );
  });

  it("drags a palette item into the first free grid cell with visible valid feedback", () => {
    const grid: NativeElement = {
      id: "grid",
      type: "grid",
      name: "Two columns",
      data: { rows: 1, columns: 2 },
      children: [
        { id: "occupied-wrapper", row: 0, column: 0, element: textElement("occupied", "Occupied") },
      ],
    };
    const { store, announcements } = setup(documentWith([grid]));
    const transfer = dataTransfer();

    fireEvent.dragStart(screen.getByRole("button", { name: /^Text$/u }), { dataTransfer: transfer });
    const target = screen.getByLabelText("Drop in first empty cell of Two columns");
    fireEvent.dragEnter(target, { dataTransfer: transfer });

    expect(target.getAttribute("data-drop-status")).toBe("valid");
    expect(screen.getByRole("status").textContent).toContain("Drop:");
    fireEvent.drop(target, { dataTransfer: transfer });

    const next = store.getSnapshot().document.elements[0];
    expect(next?.type).toBe("grid");
    if (next?.type !== "grid") throw new Error("Expected grid");
    expect(next.children).toHaveLength(2);
    expect(next.children[1]).toMatchObject({ row: 0, column: 1, element: { name: "New text" } });
    expect(announcements).toHaveBeenLastCalledWith("New text added");
  });

  it("uses stack insertion indexes and preserves an accessible Move before/after alternative", () => {
    const stack: NativeElement = {
      id: "stack",
      type: "stack",
      name: "Order of service",
      data: { direction: "vertical", gap: "6pt" },
      children: [
        { id: "opening-wrapper", index: 0, element: textElement("opening", "Opening") },
      ],
    };
    const { store } = setup(
      documentWith([textElement("welcome", "Welcome"), stack]),
      "welcome",
    );
    const transfer = dataTransfer();

    fireEvent.dragStart(screen.getByTitle("Drag to move welcome"), { dataTransfer: transfer });
    const target = screen.getByLabelText("Drop at position 1 in Order of service");
    fireEvent.dragOver(target, { dataTransfer: transfer });
    fireEvent.drop(target, { dataTransfer: transfer });

    const nextStack = store.getSnapshot().document.elements[0];
    expect(nextStack?.type).toBe("stack");
    if (nextStack?.type !== "stack") throw new Error("Expected stack");
    expect(nextStack.children.map((wrapper) => wrapper.element.id)).toEqual(["welcome", "opening"]);
    expect(nextStack.children.map((wrapper) => wrapper.index)).toEqual([0, 1]);
    expect(screen.getByRole("button", { name: "Move before" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Move after" })).toBeTruthy();
  });

  it("shows invalid feedback and safely refuses descendant drops", () => {
    const nested: NativeElement = {
      id: "outer",
      type: "stack",
      name: "Outer section",
      data: { direction: "vertical", gap: "6pt" },
      children: [
        {
          id: "inner-wrapper",
          index: 0,
          element: {
            id: "inner",
            type: "stack",
            name: "Inner section",
            data: { direction: "vertical", gap: "6pt" },
            children: [],
          },
        },
      ],
    };
    const source = documentWith([nested]);
    const { store, announcements } = setup(source);
    const transfer = dataTransfer();

    fireEvent.dragStart(screen.getByTitle("Drag to move Outer section"), { dataTransfer: transfer });
    const target = screen.getByLabelText("Drop inside Inner section");
    fireEvent.dragOver(target, { dataTransfer: transfer });

    expect(target.getAttribute("data-drop-status")).toBe("invalid");
    expect(screen.getByRole("status").textContent).toContain("Cannot drop:");
    expect(screen.getByRole("status").textContent).toContain("cannot be moved inside itself");
    expect(() => fireEvent.drop(target, { dataTransfer: transfer })).not.toThrow();
    expect(store.getSnapshot().document).toEqual(source);
    expect(announcements).toHaveBeenLastCalledWith("An item cannot be moved inside itself.");
  });

  it("marks full grids and container-bound page breaks invalid without executing a command", () => {
    const fullGrid: NativeElement = {
      id: "full-grid",
      type: "grid",
      name: "Full grid",
      data: { rows: 1, columns: 1 },
      children: [
        { id: "full-wrapper", row: 0, column: 0, element: textElement("full", "Full") },
      ],
    };
    const { store } = setup(documentWith([fullGrid]));
    const fullTransfer = dataTransfer();

    fireEvent.dragStart(screen.getByRole("button", { name: /^Text$/u }), { dataTransfer: fullTransfer });
    const target = screen.getByLabelText("Drop in first empty cell of Full grid");
    fireEvent.dragEnter(target, { dataTransfer: fullTransfer });
    expect(target.getAttribute("data-drop-status")).toBe("invalid");
    expect(screen.getByRole("status").textContent).toContain("no empty cell");
    fireEvent.drop(target, { dataTransfer: fullTransfer });

    const breakTransfer = dataTransfer();
    fireEvent.dragStart(screen.getByRole("button", { name: /^Page break$/u }), { dataTransfer: breakTransfer });
    const breakTarget = screen.getByLabelText("Drop in first empty cell of Full grid");
    fireEvent.dragEnter(breakTarget, { dataTransfer: breakTransfer });
    expect(breakTarget.getAttribute("data-drop-status")).toBe("invalid");
    expect(screen.getByRole("status").textContent).toContain("Page breaks can only be placed");
    fireEvent.drop(breakTarget, { dataTransfer: breakTransfer });
    expect(store.getSnapshot()).toMatchObject({ documentRevision: 0, canUndo: false });
  });

  it("drops into canvas at the documented default", () => {
    const canvas: NativeElement = {
      id: "canvas",
      type: "canvas",
      name: "Free layout",
      children: [],
    };
    const locked = documentWith([canvas]);
    const { store } = setup(locked);
    const transfer = dataTransfer();

    fireEvent.dragStart(screen.getByRole("button", { name: /^Columns$/u }), { dataTransfer: transfer });
    const target = screen.getByLabelText("Drop inside Free layout");
    fireEvent.dragOver(target, { dataTransfer: transfer });
    fireEvent.drop(target, { dataTransfer: transfer });

    const next = store.getSnapshot().document.elements[0];
    expect(next?.type).toBe("canvas");
    if (next?.type !== "canvas") throw new Error("Expected canvas");
    expect(next.children[0]).toMatchObject({ x: "0.25in", y: "0.25in", element: { type: "grid" } });
  });

  it("uses the store capability gate to mark protected destinations invalid", () => {
    const source = {
      ...documentWith([textElement("existing", "Existing")]),
      authoringPolicy: { layoutLocked: true },
    } satisfies CbbDocument;
    const { store } = setup(source);
    const transfer = dataTransfer();

    fireEvent.dragStart(screen.getByRole("button", { name: /^Text$/u }), { dataTransfer: transfer });
    const target = screen.getByLabelText("Drop at end of document");
    fireEvent.dragEnter(target, { dataTransfer: transfer });

    expect(target.getAttribute("data-drop-status")).toBe("invalid");
    expect(screen.getByRole("status").textContent).toContain("layout is protected");
    fireEvent.drop(target, { dataTransfer: transfer });
    expect(store.getSnapshot()).toMatchObject({ documentRevision: 0, canUndo: false });
  });
});
