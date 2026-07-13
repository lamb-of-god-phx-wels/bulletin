import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CbbDocument, TextContent } from "@cbb/core";
import { EditorStore } from "../store/editorStore.js";
import { DirectTextEditor } from "./DirectTextEditor.js";

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  cleanup();
});

function renderEditor(content: TextContent) {
  const bulletin: CbbDocument = {
    version: 2,
    kind: "bulletin",
    name: "Formatting",
    page: { typstWidth: "8.5in", typstHeight: "11in" },
    elements: [{ id: "text", type: "text", name: "Text", data: { content } }],
  };
  const store = new EditorStore(bulletin);
  const result = render(
    <DirectTextEditor
      nodeId="text"
      content={content}
      editable
      store={store}
      selected
    />,
  );
  fireEvent.keyDown(screen.getByLabelText(/Editable text/u), { key: "F2" });
  return {
    ...result,
    editor: screen.getByRole("textbox", { name: "Text content" }),
  };
}

function setSelection(
  startNode: Node,
  startOffset: number,
  endNode: Node = startNode,
  endOffset: number = startOffset,
): void {
  const range = window.document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  const selection = window.getSelection();
  if (selection === null) throw new Error("Expected a browser selection");
  selection.removeAllRanges();
  selection.addRange(range);
  fireEvent(window.document, new Event("selectionchange"));
}

function textNode(element: Element | null): Text {
  const node = element?.firstChild;
  if (node?.nodeType !== Node.TEXT_NODE) throw new Error("Expected a text node");
  return node as Text;
}

describe("DirectTextEditor", () => {
  it("exposes an edit action only when editable and never gives protected text a false edit instruction", () => {
    const content = { kind: "plain" as const, text: "Protected words" };
    const document: CbbDocument = {
      version: 2,
      kind: "bulletin",
      name: "Protected",
      page: { typstWidth: "8.5in", typstHeight: "11in" },
      elements: [{ id: "text", type: "text", name: "Text", data: { content } }],
    };
    const store = new EditorStore(document);
    const { rerender } = render(
      <DirectTextEditor nodeId="text" content={content} editable store={store} selected />,
    );
    expect(screen.getByRole("button", { name: /Editable text/u })).toBeTruthy();

    rerender(
      <DirectTextEditor
        nodeId="text"
        content={content}
        editable={false}
        disabledReason="Layout policy protects this content."
        store={store}
        selected
      />,
    );
    const protectedText = screen.getByRole("note", { name: /Protected text/u });
    expect(protectedText.getAttribute("aria-label")).toContain("Layout policy protects this content.");
    expect(protectedText.getAttribute("aria-label")).not.toContain("Press Enter");
    expect(protectedText.tabIndex).toBe(-1);
  });

  it("retains source line indices when rendering a paginated plain-text fragment", () => {
    const content = { kind: "plain" as const, text: "First\nSecond\nThird" };
    const document: CbbDocument = {
      version: 2,
      kind: "bulletin",
      name: "Fragments",
      page: { typstWidth: "8.5in", typstHeight: "11in" },
      elements: [{ id: "text", type: "text", name: "Text", data: { content } }],
    };
    const store = new EditorStore(document);
    const { container } = render(
      <DirectTextEditor
        nodeId="text"
        content={content}
        editable
        store={store}
        selected={false}
        fragmentIndices={[2]}
      />,
    );
    const paragraph = container.querySelector("p");
    expect(paragraph?.textContent).toBe("Third");
    expect(paragraph?.getAttribute("data-cbb-fragment-index")).toBe("2");
  });

  it("updates inline toolbar state when the caret selection changes", () => {
    const content: TextContent = {
      kind: "richText",
      document: {
        type: "document",
        blocks: [{
          type: "paragraph",
          children: [
            { type: "text", text: "Bold", marks: ["strong"] },
            { type: "text", text: " and " },
            { type: "text", text: "italic", marks: ["emphasis"] },
          ],
        }],
      },
    };
    const { editor } = renderEditor(content);
    const boldText = textNode(editor.querySelector("strong"));
    const italicText = textNode(editor.querySelector("em"));

    setSelection(boldText, 2);
    expect(screen.getByRole("button", { name: "Bold" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Italic" }).getAttribute("aria-pressed")).toBe("false");

    setSelection(italicText, 2);
    expect(screen.getByRole("button", { name: "Bold" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Italic" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("reports mixed inline marks for a selection spanning differently formatted text", () => {
    const content: TextContent = {
      kind: "richText",
      document: {
        type: "document",
        blocks: [{
          type: "paragraph",
          children: [
            { type: "text", text: "Bold", marks: ["strong"] },
            { type: "text", text: " plain " },
            { type: "text", text: "Italic", marks: ["emphasis"] },
          ],
        }],
      },
    };
    const { editor } = renderEditor(content);
    const boldText = textNode(editor.querySelector("strong"));
    const italicText = textNode(editor.querySelector("em"));

    setSelection(boldText, 0, italicText, italicText.length);

    expect(screen.getByRole("button", { name: "Bold" }).getAttribute("aria-pressed")).toBe("mixed");
    expect(screen.getByRole("button", { name: "Italic" }).getAttribute("aria-pressed")).toBe("mixed");
  });

  it("tracks the active block style and reports mixed controls across blocks", () => {
    const content: TextContent = {
      kind: "richText",
      document: {
        type: "document",
        blocks: [
          {
            type: "heading",
            level: 2,
            children: [{ type: "text", text: "Heading" }],
          },
          {
            type: "bulletList",
            children: [{
              type: "listItem",
              children: [{
                type: "paragraph",
                children: [{ type: "text", text: "Bullet" }],
              }],
            }],
          },
        ],
      },
    };
    const { editor } = renderEditor(content);
    const headingText = textNode(editor.querySelector("h2"));
    const bulletText = textNode(editor.querySelector("li p"));
    const style = screen.getByRole("combobox", { name: "Paragraph style" }) as HTMLSelectElement;
    const bulletButton = screen.getByRole("button", { name: "Bulleted list" });

    setSelection(headingText, 2);
    expect(style.value).toBe("heading2");
    expect(bulletButton.getAttribute("aria-pressed")).toBe("false");

    setSelection(headingText, 0, bulletText, bulletText.length);
    expect(style.value).toBe("mixed");
    expect(bulletButton.getAttribute("aria-pressed")).toBe("mixed");

    setSelection(bulletText, 2);
    expect(style.value).toBe("paragraph");
    expect(bulletButton.getAttribute("aria-pressed")).toBe("true");
  });

  it("turns the browser's local spellcheck off without presenting unsupported spelling actions", () => {
    const content = { kind: "plain" as const, text: "Kyrie eleison" };
    const bulletin: CbbDocument = {
      version: 2,
      kind: "bulletin",
      name: "Spelling",
      page: { typstWidth: "8.5in", typstHeight: "11in" },
      elements: [{ id: "text", type: "text", name: "Text", data: { content } }],
    };
    const store = new EditorStore(bulletin);
    render(
      <DirectTextEditor
        nodeId="text"
        content={content}
        editable
        store={store}
        selected
        spellcheckEnabled={false}
      />,
    );
    fireEvent.keyDown(screen.getByLabelText(/Editable text/u), { key: "F2" });
    const editor = screen.getByRole("textbox", { name: "Text content" }) as HTMLDivElement;
    expect(editor.getAttribute("spellcheck")).toBe("false");
    expect(screen.queryByRole("button", { name: "Word review" })).toBeNull();
  });

  it("supports local ignore actions and sends one canonical word to durable Church Profile storage", async () => {
    const content = { kind: "plain" as const, text: "Kyrie Kyrie" };
    const bulletin: CbbDocument = {
      version: 2,
      kind: "bulletin",
      name: "Spelling",
      page: { typstWidth: "8.5in", typstHeight: "11in" },
      elements: [{ id: "text", type: "text", name: "Text", data: { content } }],
    };
    const store = new EditorStore(bulletin);
    const add = vi.fn(async () => "Added “kyrie” to the Church Profile dictionary on this computer.");
    const { container } = render(
      <DirectTextEditor
        nodeId="text"
        content={content}
        editable
        store={store}
        selected
        spellcheckEnabled
        onAddSpellingDictionaryWord={add}
      />,
    );
    fireEvent.keyDown(screen.getByLabelText(/Editable text/u), { key: "F2" });
    const editor = screen.getByRole("textbox", { name: "Text content" });
    const first = editor.firstChild;
    if (first?.nodeType !== Node.TEXT_NODE) throw new Error("Expected plain text");
    setSelection(first, 2);
    fireEvent.click(screen.getByRole("button", { name: "Word review" }));
    expect(screen.getByRole("group", { name: "Offline spelling actions" }).textContent).toContain("Kyrie");
    fireEvent.click(screen.getByRole("button", { name: "Ignore once" }));
    expect(container.querySelectorAll("[data-cbb-spelling-exclusion='kyrie']")).toHaveLength(1);

    const remainingText = [...editor.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.includes("Kyrie"));
    if (remainingText === undefined) throw new Error("Expected remaining word");
    setSelection(remainingText, (remainingText.textContent?.length ?? 1) - 1);
    fireEvent.keyDown(editor, { key: "F10", shiftKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Add to Church Profile dictionary" }));
    await waitFor(() => expect(add).toHaveBeenCalledWith("kyrie"));
    await waitFor(() => expect(container.querySelectorAll("[data-cbb-spelling-exclusion='kyrie']")).toHaveLength(2));
    expect(store.getSnapshot().document.elements[0]).toMatchObject({
      data: { content: { kind: "plain", text: "Kyrie Kyrie" } },
    });
  });
});
