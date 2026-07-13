// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Binding, CbbDocument, NativeElement, RichTextDocument } from "@cbb/core";
import { EditorStore } from "../store/editorStore.js";
import { createEditorRenderModel } from "./renderModel.js";
import { ElementRenderer } from "./ElementRenderer.js";

afterEach(cleanup);

const originalRichText: RichTextDocument = {
  type: "document",
  blocks: [{ type: "paragraph", children: [{ type: "text", text: "Original stanza" }] }],
};

function music(bindings: readonly Binding[] = []): Extract<NativeElement, { type: "music" }> {
  return {
    id: "hymn",
    type: "music",
    name: "Opening hymn",
    bindings,
    data: {
      number: "CW 578",
      title: "Chief of Sinners Though I Be",
      instructions: "Stand for stanza 4",
      source: "Christian Worship",
      richContent: originalRichText,
      rightsAssociationReview: {
        reviewedSongContentHash: `sha256:${"8".repeat(64)}`,
        reviewedRightsProjectionHash: `sha256:${"9".repeat(64)}`,
        reviewTime: "2026-01-01T00:00:00Z",
      },
      rights: [{
        creditKey: "credit:11111111-1111-4111-8111-111111111111",
        creditProjectionHash: `sha256:${"a".repeat(64)}`,
        component: "text",
        status: "publicDomain",
        contributors: [],
        creditRequiredWhen: "never",
      }],
    },
  };
}

function documentWith(element: NativeElement): CbbDocument {
  return {
    version: 2,
    kind: "bulletin",
    name: "Music test",
    page: { typstWidth: "8.5in", typstHeight: "11in" },
    elements: [element],
  };
}

function renderElement(document: CbbDocument, element: NativeElement, store: EditorStore) {
  return render(
    <ElementRenderer
      document={document}
      element={element}
      store={store}
      mode="weeklyContent"
      selectedNodeId={element.id}
      snapping
      snapSizePx={8}
      spellcheckEnabled
      spellingDictionary={[]}
    />,
  );
}

describe("ElementRenderer M4 content editing", () => {
  it("keeps auto-sized cover images intrinsic and preserves accessible image semantics", () => {
    const element: NativeElement = {
      id: "photo",
      type: "image",
      name: "Church photo",
      data: {
        assetRef: "asset:00000000-0000-4000-8000-000000000001",
        fit: "cover",
        focalPoint: { x: 0.2, y: 0.8 },
        alt: "Church exterior",
      },
    };
    const document = documentWith(element);
    const store = new EditorStore(document);
    const view = render(
      <ElementRenderer
        document={document}
        element={element}
        store={store}
        mode="weeklyContent"
        assetUrl={() => "blob:cbb-photo"}
        snapping
        snapSizePx={8}
        spellcheckEnabled
        spellingDictionary={[]}
      />,
    );
    const image = screen.getByRole("img", { name: "Church exterior" }) as HTMLImageElement;
    expect(image.style.objectFit).toBe("cover");
    expect(view.container.querySelector(".cbb-focal-cover")).toBeNull();
  });

  it("buffers required titles and edits every direct hymn field plus formatted content", () => {
    const element = music();
    const document = documentWith(element);
    const store = new EditorStore(document);
    renderElement(document, element, store);

    const title = screen.getByLabelText("Title") as HTMLInputElement;
    fireEvent.focus(title);
    fireEvent.change(title, { target: { value: "" } });
    expect(title.value).toBe("");
    expect((store.getSnapshot().document.elements[0] as typeof element).data.title)
      .toBe("Chief of Sinners Though I Be");
    fireEvent.blur(title);
    expect(screen.getByRole("alert").textContent).toContain("Enter a hymn or song title");
    fireEvent.change(title, { target: { value: "Grace Has a Thrilling Sound" } });
    fireEvent.keyDown(title, { key: "Enter" });

    const source = screen.getByLabelText("Source") as HTMLInputElement;
    fireEvent.focus(source);
    fireEvent.change(source, { target: { value: "Christian Worship: Hymnal" } });
    fireEvent.blur(source);
    const direct = screen.getByLabelText(/Editable hymn text/u);
    fireEvent.click(direct);
    const editor = screen.getByRole("textbox", { name: "Hymn text content" });
    editor.innerHTML = "<p><strong>Grace</strong> remains</p>";
    fireEvent.input(editor);

    const updated = store.getSnapshot().document.elements[0] as typeof element;
    expect(updated.data.title).toBe("Grace Has a Thrilling Sound");
    expect(updated.data.source).toBe("Christian Worship: Hymnal");
    expect(updated.data.number).toBe("CW 578");
    expect(updated.data.instructions).toBe("Stand for stanza 4");
    expect(updated.data.richContent).toEqual({
      type: "document",
      blocks: [{
        type: "paragraph",
        children: [
          { type: "text", text: "Grace", marks: ["strong"] },
          { type: "text", text: " remains" },
        ],
      }],
    });
  });

  it("renders bound hymn values and writes source/rich content only to field authority", () => {
    const sourceBinding: Binding = {
      id: "sourceBinding",
      scope: "document",
      fieldId: "songSource",
      target: "/data/source",
    };
    const richBinding: Binding = {
      id: "richBinding",
      scope: "document",
      fieldId: "songText",
      target: "/data/richContent",
    };
    const element = music([sourceBinding, richBinding]);
    const document: CbbDocument = {
      ...documentWith(element),
      fieldContract: {
        id: "00000000-0000-4000-8000-000000000099",
        version: 1,
        name: "Music fields",
        fields: [
          { id: "songSource", label: "Song source", type: "text", required: false },
          { id: "songText", label: "Song text", type: "richText", required: false },
        ],
      },
      fieldValues: {
        songSource: { value: "Bound weekly source", origin: "manual" },
        songText: {
          value: {
            type: "document",
            blocks: [{ type: "paragraph", children: [{ type: "text", text: "Bound stanza" }] }],
          },
          origin: "manual",
        },
      },
    };
    const store = new EditorStore(document);
    const rendered = createEditorRenderModel(document).elements[0]?.element;
    if (rendered?.type !== "music") throw new Error("Expected resolved music");
    renderElement(document, rendered, store);
    const source = screen.getByLabelText("Source") as HTMLInputElement;
    expect(source.value).toBe("Bound weekly source");
    fireEvent.focus(source);
    fireEvent.change(source, { target: { value: "Updated bound source" } });
    fireEvent.blur(source);
    fireEvent.click(screen.getByLabelText(/Editable hymn text/u));
    const editor = screen.getByRole("textbox", { name: "Hymn text content" });
    editor.innerHTML = "<p><em>Updated bound stanza</em></p>";
    fireEvent.input(editor);

    expect(store.getSnapshot().document.fieldValues).toMatchObject({
      songSource: { value: "Updated bound source", origin: "manual" },
      songText: {
        value: {
          type: "document",
          blocks: [{
            type: "paragraph",
            children: [{ type: "text", text: "Updated bound stanza", marks: ["emphasis"] }],
          }],
        },
        origin: "manual",
      },
    });
    const sourceElement = store.getSnapshot().document.elements[0] as typeof element;
    expect(sourceElement.data.source).toBeUndefined();
    expect(sourceElement.data.richContent).toBeUndefined();
  });
});
