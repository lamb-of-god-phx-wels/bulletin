import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CbbDocument } from "@cbb/core";
import { EditorStore } from "../store/editorStore.js";
import {
  customInstanceFixture,
  finalizedCustomDefinitionFixture,
  textElement,
} from "../store/testFixtures.js";
import { inspectorCanonicalValueHash } from "./editBufferEvidence.js";
import { InspectorPanel, type InspectorPanelProps } from "./InspectorPanel.js";

afterEach(cleanup);

function documentWithText(): CbbDocument {
  return {
    version: 2,
    kind: "bulletin",
    name: "Draft isolation",
    page: { typstWidth: "8.5in", typstHeight: "11in" },
    elements: [
      textElement("first", "Alpha", { name: "First item" }),
      textElement("second", "Beta", { name: "Second item" }),
    ],
  };
}

function inspectorProps(
  store: EditorStore,
  overrides: Partial<InspectorPanelProps> = {},
): InspectorPanelProps {
  const snapshot = store.getSnapshot();
  return {
    document: snapshot.document,
    documentRevision: snapshot.documentRevision,
    store,
    mode: snapshot.mode,
    selectedNodeId: "first",
    ...overrides,
  };
}

describe("InspectorPanel edit buffers", () => {
  it("uses Saved section task language for reusable content instances", () => {
    const definition = finalizedCustomDefinitionFixture({
      version: 1,
      kind: "customElementDefinition",
      id: "saved-prayers",
      name: "Reusable prayers",
      fieldContract: {
        id: "10000000-0000-4000-8000-000000000072",
        version: 1,
        name: "Reusable prayer fields",
        fields: [],
      },
      elements: [textElement("saved-prayer-text", "Prayer")],
    });
    const value: CbbDocument = {
      ...documentWithText(),
      elements: [customInstanceFixture(definition, {
        id: "saved-instance",
        type: "customInstance",
        name: "Reusable prayers",
      })],
      customElementDefinitions: [definition],
    };
    const store = new EditorStore(value, { initialMode: "customizeLayout" });
    render(<InspectorPanel {...inspectorProps(store, {
      mode: "customizeLayout",
      selectedNodeId: "saved-instance",
    })} />);

    expect(screen.getByText("Saved section", { selector: "header span" })).toBeTruthy();
    expect(document.body.textContent).not.toContain("Saved custom section");
  });

  it("moves focus with tab keys and returns to Content on Weekly Content mode", () => {
    const store = new EditorStore(documentWithText(), { initialMode: "customizeLayout" });
    const { rerender } = render(<InspectorPanel {...inspectorProps(store)} />);
    const layout = screen.getByRole("tab", { name: "Layout" });
    layout.focus();
    fireEvent.keyDown(layout, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Appearance" }));
    expect(screen.getByRole("tab", { name: "Appearance" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Home" });
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Content" }));

    fireEvent.click(screen.getByRole("tab", { name: "Accessibility" }));
    rerender(<InspectorPanel {...inspectorProps(store, { mode: "weeklyContent" })} />);
    expect(screen.getByRole("tab", { name: "Content" }).getAttribute("aria-selected")).toBe("true");
  });

  it("uses named date styles with a live example and keeps raw tokens under Advanced", () => {
    const dateDocument: CbbDocument = {
      ...documentWithText(),
      elements: [{
        id: "service-date",
        type: "date",
        name: "Service date",
        data: { value: "2026-07-12" },
      }],
    };
    const store = new EditorStore(dateDocument, { initialMode: "customizeLayout" });
    render(<InspectorPanel {...inspectorProps(store, {
      mode: "customizeLayout",
      selectedNodeId: "service-date",
    })} />);

    expect(screen.getByText("Example: July 12, 2026")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Date style"), {
      target: { value: "dddd, MMMM D, YYYY" },
    });
    const date = store.getSnapshot().document.elements[0];
    expect(date?.type === "date" ? date.data.format : undefined).toBe("dddd, MMMM D, YYYY");
    expect(screen.getByText("Advanced date format")).toBeTruthy();
  });

  it("distinguishes placement settings from child content and edits layout protection", () => {
    const wrapped: CbbDocument = {
      ...documentWithText(),
      elements: [{
        id: "stack",
        type: "stack",
        name: "Section",
        data: { direction: "vertical", gap: "6pt" },
        children: [{
          id: "text-placement",
          index: 0,
          element: textElement("placed-text", "Placed", { name: "Placed text" }),
        }],
      }],
    };
    const store = new EditorStore(wrapped, { initialMode: "customizeLayout" });
    render(
      <InspectorPanel
        {...inspectorProps(store, {
          mode: "customizeLayout",
          selectedNodeId: "text-placement",
        })}
      />,
    );
    expect(screen.getByRole("heading", { name: "Placed text placement" })).toBeTruthy();
    expect(screen.getByText("stack placement settings")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Content" }));
    expect(screen.getByText(/owns position, size, and layout protection/u)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Accessibility" }));
    fireEvent.click(screen.getByLabelText("Protect layout"));
    const root = store.getSnapshot().document.elements[0];
    expect(root?.type === "stack" ? root.children[0]?.authoringPolicy : undefined)
      .toEqual({ layoutLocked: true });
  });

  it("shows and edits the effective bound weekly value rather than the source fallback", () => {
    const source = documentWithText();
    const first = source.elements[0];
    if (first?.type !== "text") throw new Error("Expected text fixture");
    const boundDocument: CbbDocument = {
      ...source,
      fieldContract: {
        id: "00000000-0000-4000-8000-000000000020",
        version: 1,
        name: "Weekly fields",
        fields: [{ id: "message", label: "Message", type: "text", required: false }],
      },
      fieldValues: { message: { value: "Effective weekly value", origin: "imported" } },
      elements: [{
        ...first,
        bindings: [{
          id: "message-binding",
          scope: "document",
          fieldId: "message",
          target: "/data/content/text",
        }],
      }, ...source.elements.slice(1)],
    };
    const store = new EditorStore(boundDocument);
    render(<InspectorPanel {...inspectorProps(store)} />);
    const field = screen.getByLabelText("Text") as HTMLTextAreaElement;
    expect(field.value).toBe("Effective weekly value");
    fireEvent.change(field, { target: { value: "Changed weekly value" } });
    fireEvent.blur(field);
    expect(store.getSnapshot().document.fieldValues?.["message"]).toMatchObject({
      value: "Changed weekly value",
      origin: "manual",
    });
    const persistedSource = store.getSnapshot().document.elements[0];
    expect(persistedSource?.type === "text" ? persistedSource.data.content : undefined)
      .toEqual({ kind: "plain" });
  });

  it("uses effective bound image accessibility values when displaying and toggling decorative state", () => {
    const boundDocument: CbbDocument = {
      ...documentWithText(),
      fieldContract: {
        id: "00000000-0000-4000-8000-000000000021",
        version: 1,
        name: "Image accessibility fields",
        fields: [
          { id: "imageAlt", label: "Image description", type: "text", required: false },
          { id: "imageDecorative", label: "Decorative", type: "boolean", required: false },
        ],
      },
      fieldValues: {
        imageAlt: { value: "Effective weekly description", origin: "imported" },
        imageDecorative: { value: true, origin: "imported" },
      },
      elements: [{
        id: "photo",
        type: "image",
        name: "Church photo",
        data: {
          assetRef: "asset:00000000-0000-4000-8000-000000000021",
          fit: "contain",
          alt: "Stale authored description",
          decorative: false,
        },
        bindings: [
          {
            id: "image-alt-binding",
            scope: "document",
            fieldId: "imageAlt",
            target: "/data/alt",
          },
          {
            id: "image-decorative-binding",
            scope: "document",
            fieldId: "imageDecorative",
            target: "/data/decorative",
          },
        ],
      }],
    };
    const store = new EditorStore(boundDocument);
    render(<InspectorPanel {...inspectorProps(store, { selectedNodeId: "photo" })} />);
    fireEvent.click(screen.getByRole("tab", { name: "Accessibility" }));

    const decorative = screen.getByLabelText("This image is only decorative") as HTMLInputElement;
    const description = screen.getByLabelText(
      "Description for people who cannot see the image",
    ) as HTMLTextAreaElement;
    expect(decorative.checked).toBe(true);
    expect(description.value).toBe("Effective weekly description");
    expect(description.disabled).toBe(true);

    fireEvent.click(decorative);
    expect(store.getSnapshot().document.fieldValues).toMatchObject({
      imageAlt: { value: "Effective weekly description", origin: "manual" },
      imageDecorative: { value: false, origin: "manual" },
    });
  });

  it("uses effective bound Copyrights & Permissions options for display and companion updates", () => {
    const boundDocument: CbbDocument = {
      ...documentWithText(),
      fieldContract: {
        id: "00000000-0000-4000-8000-000000000022",
        version: 1,
        name: "Credits fields",
        fields: [
          { id: "creditsHeading", label: "Credits heading", type: "text", required: false },
          { id: "showPublicDomain", label: "Show public domain", type: "boolean", required: false },
        ],
      },
      fieldValues: {
        creditsHeading: { value: "Effective weekly credits", origin: "imported" },
        showPublicDomain: { value: true, origin: "imported" },
      },
      elements: [{
        id: "credits",
        type: "rightsAttribution",
        name: "Copyrights & Permissions",
        data: {
          heading: "Stale authored credits",
          groupOrder: ["scripture", "music", "other"],
          sortPolicy: "firstAppearance",
          includePublicDomainLines: false,
        },
        bindings: [
          {
            id: "credits-heading-binding",
            scope: "document",
            fieldId: "creditsHeading",
            target: "/data/heading",
          },
          {
            id: "public-domain-binding",
            scope: "document",
            fieldId: "showPublicDomain",
            target: "/data/includePublicDomainLines",
          },
        ],
      }],
    };
    const store = new EditorStore(boundDocument, { initialMode: "customizeLayout" });
    render(<InspectorPanel {...inspectorProps(store, {
      mode: "customizeLayout",
      selectedNodeId: "credits",
    })} />);

    expect((screen.getByLabelText("Heading") as HTMLInputElement).value)
      .toBe("Effective weekly credits");
    const includePublicDomain = screen.getByLabelText(
      "Show explicit public-domain lines",
    ) as HTMLInputElement;
    expect(includePublicDomain.checked).toBe(true);
    fireEvent.click(includePublicDomain);
    expect(store.getSnapshot().document.fieldValues).toMatchObject({
      creditsHeading: { value: "Effective weekly credits" },
      showPublicDomain: { value: false, origin: "manual" },
    });
  });

  it("keeps a draft bound to its control across selections and retains its base revision", () => {
    const store = new EditorStore(documentWithText());
    const updates = vi.fn();
    const { rerender } = render(
      <InspectorPanel
        {...inspectorProps(store, {
          documentRevision: 3,
          onEditBufferChange: updates,
        })}
      />,
    );

    const first = screen.getByLabelText("Text") as HTMLTextAreaElement;
    fireEvent.change(first, { target: { value: "Alpha draft" } });

    rerender(
      <InspectorPanel
        {...inspectorProps(store, {
          documentRevision: 8,
          selectedNodeId: "second",
          onEditBufferChange: updates,
        })}
      />,
    );
    const second = screen.getByLabelText("Text") as HTMLTextAreaElement;
    expect(second.value).toBe("Beta");
    fireEvent.blur(second);
    expect(store.getSnapshot().document.elements[1]).toMatchObject({
      data: { content: { kind: "plain", text: "Beta" } },
    });

    rerender(
      <InspectorPanel
        {...inspectorProps(store, {
          documentRevision: 9,
          selectedNodeId: "first",
          onEditBufferChange: updates,
        })}
      />,
    );
    const restoredFirst = screen.getByLabelText("Text") as HTMLTextAreaElement;
    expect(restoredFirst.value).toBe("Alpha draft");
    fireEvent.blur(restoredFirst);

    expect(store.getSnapshot().document.elements[0]).toMatchObject({
      data: { content: { kind: "plain", text: "Alpha draft" } },
    });
    expect(updates).toHaveBeenLastCalledWith(expect.objectContaining({
      controlId: "inspector-first-text",
      value: "Alpha draft",
      baseDocumentRevision: 3,
      status: "committed",
    }));
  });

  it("clears durable recovery state when typed text returns to the canonical value", () => {
    const store = new EditorStore(documentWithText());
    const updates = vi.fn();
    render(<InspectorPanel {...inspectorProps(store, { onEditBufferChange: updates })} />);
    const field = screen.getByLabelText("Text");
    fireEvent.change(field, { target: { value: "Alpha draft" } });
    fireEvent.change(field, { target: { value: "Alpha" } });
    expect(updates).toHaveBeenLastCalledWith(expect.objectContaining({
      controlId: "inspector-first-text",
      value: "Alpha",
      status: "discarded",
    }));
    const callCount = updates.mock.calls.length;
    fireEvent.blur(field);
    expect(updates).toHaveBeenCalledTimes(callCount);
    expect(store.getSnapshot().documentRevision).toBe(0);
  });

  it("restores invalid buffer metadata without rebasing it", () => {
    const store = new EditorStore(documentWithText());
    const updates = vi.fn();
    render(
      <InspectorPanel
        {...inspectorProps(store, {
          documentRevision: 12,
          documentRevisionToken: "revision-current",
          onEditBufferChange: updates,
          restoredEditBuffers: {
            "inspector-first-text": {
              value: "Recovered draft",
              baseDocumentRevision: 4,
              baseResourceRevisionToken: "revision-current",
              baseCanonicalHash: inspectorCanonicalValueHash("Alpha"),
              status: "invalid",
              error: "Resolve this recovered draft.",
            },
          },
        })}
      />,
    );

    expect((screen.getByLabelText("Text") as HTMLTextAreaElement).value).toBe("Recovered draft");
    expect(screen.getByRole("alert").textContent).toContain("recovered draft");
    fireEvent.blur(screen.getByLabelText("Text"));
    expect(updates).toHaveBeenLastCalledWith(expect.objectContaining({
      baseDocumentRevision: 4,
      baseResourceRevisionToken: "revision-current",
      status: "committed",
    }));
  });

  it("blocks stale canonical recovery until the author explicitly resolves it", () => {
    const store = new EditorStore(documentWithText());
    const updates = vi.fn();
    render(
      <InspectorPanel
        {...inspectorProps(store, {
          documentRevision: 0,
          documentRevisionToken: "revision-current",
          onEditBufferChange: updates,
          restoredEditBuffers: {
            "inspector-first-text": {
              value: "Stale recovered draft",
              baseDocumentRevision: 5,
              baseResourceRevisionToken: "revision-current",
              baseCanonicalHash: inspectorCanonicalValueHash("Older saved text"),
              status: "dirty",
            },
          },
        })}
      />,
    );

    const field = screen.getByLabelText("Text") as HTMLTextAreaElement;
    expect(field.value).toBe("Alpha");
    expect(field.disabled).toBe(true);
    expect(screen.getByText(/saved value changed/u)).toBeTruthy();
    fireEvent.blur(field);
    expect(store.getSnapshot().document.elements[0]).toMatchObject({
      data: { content: { kind: "plain", text: "Alpha" } },
    });
    expect(updates).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Review and fix" }));
    expect(field.disabled).toBe(false);
    expect(field.value).toBe("Stale recovered draft");
    fireEvent.change(field, { target: { value: "Reviewed recovery" } });
    fireEvent.blur(field);
    expect(store.getSnapshot().document.elements[0]).toMatchObject({
      data: { content: { kind: "plain", text: "Reviewed recovery" } },
    });
    expect(updates).toHaveBeenLastCalledWith(expect.objectContaining({
      value: "Reviewed recovery",
      baseCanonicalHash: inspectorCanonicalValueHash("Older saved text"),
      status: "committed",
    }));
  });

  it("blocks recovery from an older durable revision and can discard it without a commit", () => {
    const store = new EditorStore(documentWithText());
    const updates = vi.fn();
    render(
      <InspectorPanel
        {...inspectorProps(store, {
          documentRevisionToken: "revision-current",
          onEditBufferChange: updates,
          restoredEditBuffers: {
            "inspector-first-text": {
              value: "Old revision draft",
              baseDocumentRevision: 2,
              baseResourceRevisionToken: "revision-before",
              baseCanonicalHash: inspectorCanonicalValueHash("Alpha"),
              status: "dirty",
              recoveryConflict: "durableRevisionChanged",
            },
          },
        })}
      />,
    );

    expect((screen.getByLabelText("Text") as HTMLTextAreaElement).value).toBe("Alpha");
    fireEvent.click(screen.getByRole("button", { name: "Discard recovered text" }));
    expect(store.getSnapshot().documentRevision).toBe(0);
    expect(updates).toHaveBeenLastCalledWith(expect.objectContaining({
      value: "Alpha",
      status: "discarded",
    }));
  });

  it("does not flatten rich text through the plain inspector field", () => {
    const richDocument: CbbDocument = {
      ...documentWithText(),
      elements: [textElement("first", "unused", {
        data: {
          content: {
            kind: "richText",
            document: {
              type: "document",
              blocks: [
                { type: "heading", level: 2, children: [{ type: "text", text: "A heading" }] },
                { type: "paragraph", children: [{ type: "text", text: "A paragraph" }] },
              ],
            },
          },
        },
      })],
    };
    const store = new EditorStore(richDocument);
    render(<InspectorPanel {...inspectorProps(store)} />);

    const field = screen.getByLabelText("Text") as HTMLTextAreaElement;
    expect(field.disabled).toBe(true);
    expect(screen.getByText(/contains rich formatting/u)).toBeTruthy();
    fireEvent.blur(field);
    expect(store.getSnapshot().document.elements[0]).toEqual(richDocument.elements[0]);
  });

  it("never exposes an internal managed-image reference as its visible label", () => {
    const internalRef = "asset:00000000-0000-4000-8000-000000000099";
    const imageDocument: CbbDocument = {
      ...documentWithText(),
      elements: [{
        id: "photo",
        type: "image",
        name: "Church photo",
        data: { assetRef: internalRef, fit: "cover" },
      }],
    };
    const store = new EditorStore(imageDocument);
    render(<InspectorPanel {...inspectorProps(store, {
      selectedNodeId: "photo",
      imageLibraryUnavailableReason: "Install a validated image library to replace this image.",
    })} />);

    expect(screen.getByText("Managed image · details unavailable")).toBeTruthy();
    expect(screen.queryByText(new RegExp(internalRef, "u"))).toBeNull();
    expect(screen.getByText("Install a validated image library to replace this image.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Replace image" }).getAttribute("title"))
      .toBe("Install a validated image library to replace this image.");
  });

  it("does not turn an inherited protection setting into an explicit false override", () => {
    const store = new EditorStore(documentWithText(), { initialMode: "customizeLayout" });
    const { rerender } = render(<InspectorPanel {...inspectorProps(store)} />);
    fireEvent.click(screen.getByRole("tab", { name: "Accessibility" }));
    fireEvent.click(screen.getByLabelText("Protect content in Weekly Content"));

    const first = store.getSnapshot().document.elements[0];
    expect(first?.authoringPolicy).toEqual({ contentLocked: true });
    expect(first?.authoringPolicy).not.toHaveProperty("layoutLocked");

    rerender(
      <InspectorPanel
        {...inspectorProps(store, { selectedNodeId: "second" })}
      />,
    );
    fireEvent.click(screen.getByLabelText("Protect layout"));
    const second = store.getSnapshot().document.elements[1];
    expect(second?.authoringPolicy).toEqual({ layoutLocked: true });
    expect(second?.authoringPolicy).not.toHaveProperty("contentLocked");
  });

  it("authors Scripture, sharing, and Copyrights & Permissions settings without code", () => {
    const rightsDocument: CbbDocument = {
      ...documentWithText(),
      elements: [{
        id: "credits",
        type: "rightsAttribution",
        name: "Copyrights & Permissions",
        data: {
          heading: "Copyrights & Permissions",
          groupOrder: ["scripture", "music", "other"],
          sortPolicy: "firstAppearance",
          includePublicDomainLines: false,
        },
      }],
    };
    const store = new EditorStore(rightsDocument, { initialMode: "customizeLayout" });
    const { rerender } = render(<InspectorPanel {...inspectorProps(store, {
      mode: "customizeLayout",
      selectedNodeId: undefined,
    })} />);
    fireEvent.click(screen.getByRole("tab", { name: "Content" }));
    fireEvent.click(screen.getByLabelText("Share the PDF by email or online"));
    rerender(<InspectorPanel {...inspectorProps(store, {
      mode: "customizeLayout",
      selectedNodeId: undefined,
    })} />);
    fireEvent.change(screen.getByLabelText("Reference placement"), { target: { value: "after" } });
    rerender(<InspectorPanel {...inspectorProps(store, {
      mode: "customizeLayout",
      selectedNodeId: undefined,
    })} />);
    fireEvent.change(screen.getByLabelText("Verse numbers"), { target: { value: "inline" } });
    rerender(<InspectorPanel {...inspectorProps(store, {
      mode: "customizeLayout",
      selectedNodeId: undefined,
    })} />);
    fireEvent.change(screen.getByLabelText("Scripture typography"), {
      target: { value: "readable" },
    });
    expect(store.getSnapshot().document).toMatchObject({
      publicationContexts: [
        "printedNonsalableChurchBulletin",
        "digitalNonsalableChurchBulletin",
      ],
      scripturePresentation: {
        referencePlacement: "after",
        verseNumberStyle: "inline",
        typographyPresetSnapshot: { preset: "readable", version: 1 },
      },
    });
    rerender(<InspectorPanel {...inspectorProps(store, {
      mode: "customizeLayout",
      selectedNodeId: undefined,
    })} />);
    fireEvent.change(screen.getByLabelText("Scripture typography"), {
      target: { value: "inherit" },
    });
    expect(store.getSnapshot().document.scripturePresentation?.typographyPresetSnapshot)
      .toBeUndefined();

    rerender(<InspectorPanel {...inspectorProps(store, {
      mode: "customizeLayout",
      selectedNodeId: "credits",
    })} />);
    fireEvent.click(screen.getByRole("tab", { name: "Content" }));
    fireEvent.change(screen.getByLabelText("Credit group shown first"), { target: { value: "music" } });
    rerender(<InspectorPanel {...inspectorProps(store, {
      mode: "customizeLayout",
      selectedNodeId: "credits",
    })} />);
    fireEvent.click(screen.getByLabelText("Show explicit public-domain lines"));
    const credits = store.getSnapshot().document.elements[0];
    expect(credits?.type === "rightsAttribution" ? credits.data : undefined).toMatchObject({
      groupOrder: ["music", "scripture", "other"],
      includePublicDomainLines: true,
    });
  });
});
