import { describe, expect, it } from "vitest";
import {
  customElementDefinitionHash,
  makeSequentialIdPort,
  validateDocumentSemantics,
  type CbbDocument,
  type Binding,
  type CustomElementDefinition,
  type NativeElement,
  type RichTextDocument,
} from "@cbb/core";
import { createBulletinFromTemplateDocument } from "../../app/documentFactory.js";
import { EditorStore } from "../editorStore.js";
import { textElement } from "../testFixtures.js";
import {
  EditorCommandVocabularyError,
  createAddCustomInstanceArrayItemCommand,
  createAddDocumentArrayItemCommand,
  createAddElementCommand,
  createAddPageElementCommand,
  createAddRightsAttributionCommand,
  createDeleteElementCommand,
  createDuplicateElementCommand,
  createMoveCanvasChildCommand,
  createMoveElementCommand,
  createMovePageElementCommand,
  createRemoveDocumentArrayItemCommand,
  createRemoveCustomInstanceArrayItemCommand,
  createReorderElementCommand,
  createReorderCanvasChildCommand,
  createReorderCanvasReadingCommand,
  createReorderDocumentArrayItemCommand,
  createReorderCustomInstanceArrayItemCommand,
  createResetCanvasReadingOrderCommand,
  createReplaceImageCommand,
  createResizeElementCommand,
  createSetDateValueCommand,
  createSetDatePresentationCommand,
  createSetDocumentFieldValueCommand,
  createSetCustomInstanceFieldValueCommand,
  createSetDocumentPublicationSettingsCommand,
  createSetElementBreakPolicyCommand,
  createSetElementStyleCommand,
  createSetImageAccessibilityCommand,
  createSetImageFitCommand,
  createSetImageFocalPointCommand,
  createSetGridLayoutCommand,
  createSetStackLayoutCommand,
  createSetPageAppearanceCommand,
  createSetPageElementLayerCommand,
  createSetPageLayoutCommand,
  createSetPageMarginCommand,
  createSetRightsAttributionOptionsCommand,
  createSetAuthoringPolicyCommand,
  createSetTextContentCommand,
  createSetMusicTextCommand,
  createUpdateDocumentArrayItemCommand,
  createUpdateCustomInstanceArrayItemCommand,
} from "./commands.js";
import { findElementLocation } from "./tree.js";

function structure(): readonly NativeElement[] {
  return [
    textElement("intro", "Welcome"),
    {
      id: "stack",
      type: "stack",
      name: "Order of service",
      data: { direction: "vertical", gap: "6pt" },
      children: [
        {
          id: "stack-wrap-a",
          index: 0,
          element: textElement("stack-a", "Invocation"),
        },
        {
          id: "stack-wrap-b",
          index: 1,
          element: textElement("stack-b", "Confession"),
        },
      ],
    },
    {
      id: "grid",
      type: "grid",
      name: "Two columns",
      data: { rows: 1, columns: 2 },
      children: [
        {
          id: "grid-wrap-a",
          row: 0,
          column: 0,
          element: textElement("grid-a", "Left"),
        },
      ],
    },
    {
      id: "canvas",
      type: "canvas",
      name: "Free layout",
      children: [
        {
          id: "canvas-wrap-a",
          x: "0.25in",
          y: "0.5in",
          element: textElement("canvas-a", "Placed"),
        },
      ],
    },
  ];
}

function document(overrides: Partial<CbbDocument> = {}): CbbDocument {
  return {
    version: 2,
    kind: "bulletin",
    name: "Editor commands",
    page: { typstWidth: "7in", typstHeight: "8.5in" },
    elements: structure(),
    ...overrides,
  };
}

function definitionRevision(
  input: Omit<CustomElementDefinition, "definitionVersion" | "definitionHash">,
): CustomElementDefinition {
  const revision = { ...input, definitionVersion: 1 };
  return { ...revision, definitionHash: customElementDefinitionHash(revision) };
}

function richDocument(text: string): RichTextDocument {
  return {
    type: "document",
    blocks: [{ type: "paragraph", children: [{ type: "text", text }] }],
  };
}

function customStore(value = document()): EditorStore {
  return new EditorStore(value, { initialMode: "customizeLayout" });
}

function pageContainerDocument(): CbbDocument {
  return document({
    pageElements: [
      {
        id: "page-placement",
        purpose: "decoration",
        target: { mode: "all" },
        layer: "overlay",
        region: "page",
        anchor: "topLeft",
        x: "0in",
        y: "0in",
        width: "auto",
        height: "auto",
        zIndex: 1,
        clipToRegion: false,
        semantic: { mode: "artifact" },
        element: {
          id: "page-stack",
          type: "stack",
          name: "Page furniture",
          data: { direction: "vertical", gap: "6pt" },
          children: [
            {
              id: "page-text-wrapper",
              index: 0,
              element: textElement("page-text", "Page text"),
            },
            {
              id: "page-grid-wrapper",
              index: 1,
              element: {
                id: "page-grid",
                type: "grid",
                name: "Page grid",
                data: { rows: 1, columns: 2 },
                children: [
                  {
                    id: "page-grid-child-wrapper",
                    row: 0,
                    column: 0,
                    element: textElement("page-grid-child", "Grid child"),
                  },
                ],
              },
            },
            {
              id: "page-canvas-wrapper",
              index: 2,
              element: {
                id: "page-canvas",
                type: "canvas",
                name: "Page canvas",
                children: [],
              },
            },
          ],
        },
      },
    ],
  });
}

describe("editor command vocabulary", () => {
  it("adds a top-level element as one undoable command", () => {
    const store = customStore();
    expect(
      store.execute(
        createAddElementCommand({
          element: textElement("added", "Announcement"),
          destination: { kind: "body", index: 1 },
        }),
      ).status,
    ).toBe("applied");
    expect(store.getSnapshot().document.elements.map((element) => element.id)).toEqual([
      "intro",
      "added",
      "stack",
      "grid",
      "canvas",
    ]);
    expect(store.getSnapshot().selection).toMatchObject({ nodeId: "added" });
    store.undo();
    expect(store.getSnapshot().document.elements.map((element) => element.id)).toEqual([
      "intro",
      "stack",
      "grid",
      "canvas",
    ]);
  });

  it("adds a page item with distinct placement selection and undo", () => {
    const store = customStore();
    const result = store.execute(createAddPageElementCommand({
      wrapper: {
        id: "new-footer-placement",
        purpose: "footer",
        target: { mode: "all" },
        layer: "overlay",
        region: "bottomMargin",
        anchor: "topLeft",
        x: "0in",
        y: "0in",
        width: "100%",
        height: "auto",
        zIndex: 0,
        clipToRegion: true,
        semantic: { mode: "artifact" },
        element: textElement("new-footer", "Footer", { name: "Footer" }),
      },
    }));
    expect(result.status).toBe("applied");
    expect(store.getSnapshot().document.pageElements?.[0]?.id).toBe("new-footer-placement");
    expect(store.getSnapshot().selection).toMatchObject({ nodeId: "new-footer-placement" });
    store.undo();
    expect(store.getSnapshot().document.pageElements).toBeUndefined();
  });

  it("requires Customize Layout and destination permission for container insertion", () => {
    const weekly = new EditorStore(document());
    const command = createAddElementCommand({
      element: textElement("added"),
      destination: {
        kind: "stack",
        containerId: "stack",
        index: 1,
        wrapperId: "added-wrapper",
      },
    });
    expect(weekly.execute(command)).toMatchObject({
      status: "denied",
      denial: { code: "requiresCustomizeLayout" },
    });

    const locked = customStore(
      document({
        elements: structure().map((element) =>
          element.id === "stack"
            ? { ...element, authoringPolicy: { layoutLocked: true } }
            : element,
        ),
      }),
    );
    expect(locked.execute(command)).toMatchObject({
      status: "denied",
      denial: { code: "layoutLocked" },
    });
  });

  it("moves body and nested items across every supported destination", () => {
    const store = customStore();
    store.execute(
      createMoveElementCommand({
        nodeId: "intro",
        destination: {
          kind: "grid",
          containerId: "grid",
          row: 0,
          column: 1,
          wrapperId: "intro-placement",
        },
      }),
    );
    expect(findElementLocation(store.getSnapshot().document, "intro")?.parent).toMatchObject({
      kind: "grid",
      wrapper: { id: "intro-placement", row: 0, column: 1 },
    });

    store.execute(
      createMoveElementCommand({
        nodeId: "intro",
        destination: {
          kind: "canvas",
          containerId: "canvas",
          x: "1in",
          y: "1.5in",
        },
      }),
    );
    expect(findElementLocation(store.getSnapshot().document, "intro")?.parent).toMatchObject({
      kind: "canvas",
      wrapper: { id: "intro-placement", x: "1in", y: "1.5in" },
    });

    store.execute(
      createMoveElementCommand({
        nodeId: "intro",
        destination: { kind: "body", index: 0 },
      }),
    );
    expect(store.getSnapshot().document.elements[0]?.id).toBe("intro");
    expect(findElementLocation(store.getSnapshot().document, "intro")?.parent.kind).toBe(
      "body",
    );
  });

  it("rejects occupied cells and ancestor-to-descendant cycles atomically", () => {
    const store = customStore();
    const before = store.getSnapshot();
    expect(() =>
      store.execute(
        createMoveElementCommand({
          nodeId: "intro",
          destination: {
            kind: "grid",
            containerId: "grid",
            row: 0,
            column: 0,
            wrapperId: "new-wrapper",
          },
        }),
      ),
    ).toThrow("already contains");
    expect(store.getSnapshot()).toBe(before);

    expect(() =>
      store.execute(
        createMoveElementCommand({
          nodeId: "stack",
          destination: {
            kind: "stack",
            containerId: "stack",
            index: 0,
            wrapperId: "cycle-wrapper",
          },
        }),
      ),
    ).toThrow("inside the moved item");
    expect(store.getSnapshot()).toBe(before);
  });

  it("deletes nested elements without discarding their container and restores on undo", () => {
    const store = customStore();
    store.execute(createDeleteElementCommand("stack-a"));
    const stack = store.getSnapshot().document.elements.find(
      (element) => element.id === "stack",
    );
    expect(stack?.type).toBe("stack");
    if (stack?.type !== "stack") throw new Error("Expected stack");
    expect(stack.children.map((child) => [child.id, child.index])).toEqual([
      ["stack-wrap-b", 0],
    ]);
    store.undo();
    expect(findElementLocation(store.getSnapshot().document, "stack-a")).toBeDefined();
  });

  it("deletes and duplicates children nested below a page placement", () => {
    const store = customStore(pageContainerDocument());

    expect(store.execute(createDeleteElementCommand("page-text")).status).toBe("applied");
    expect(findElementLocation(store.getSnapshot().document, "page-stack")).toBeDefined();
    expect(findElementLocation(store.getSnapshot().document, "page-text")).toBeUndefined();
    expect(store.getSnapshot().selection).toMatchObject({ nodeId: "page-stack" });
    store.undo();
    expect(findElementLocation(store.getSnapshot().document, "page-text")).toBeDefined();

    expect(store.execute(createDuplicateElementCommand({
      nodeId: "page-text",
      idPort: makeSequentialIdPort(40),
    })).status).toBe("applied");
    const pageRoot = store.getSnapshot().document.pageElements?.[0]?.element;
    if (pageRoot?.type !== "stack") throw new Error("Expected page stack");
    expect(pageRoot.children).toHaveLength(4);
    expect(pageRoot.children[1]?.element.id).not.toBe("page-text");
    expect(new Set(pageRoot.children.map((child) => child.id)).size).toBe(4);
    store.undo();
    const restoredPageRoot = store.getSnapshot().document.pageElements?.[0]?.element;
    if (restoredPageRoot?.type !== "stack") throw new Error("Expected page stack");
    expect(restoredPageRoot.children).toHaveLength(3);
  });

  it("moves items into, out of, and between containers below page placements", () => {
    const store = customStore(pageContainerDocument());

    expect(store.execute(createMoveElementCommand({
      nodeId: "page-grid-child",
      destination: {
        kind: "canvas",
        containerId: "page-canvas",
        x: "0.5in",
        y: "0.75in",
      },
    })).status).toBe("applied");
    expect(findElementLocation(store.getSnapshot().document, "page-grid-child")?.parent)
      .toMatchObject({ kind: "canvas", containerId: "page-canvas" });
    store.undo();
    expect(findElementLocation(store.getSnapshot().document, "page-grid-child")?.parent.kind)
      .toBe("grid");

    expect(store.execute(createMoveElementCommand({
      nodeId: "page-grid-child",
      destination: { kind: "body", index: 1 },
    })).status).toBe("applied");
    expect(findElementLocation(store.getSnapshot().document, "page-grid-child")?.parent.kind)
      .toBe("body");
    expect(store.getSnapshot().document.pageElements).toHaveLength(1);
    store.undo();

    expect(store.execute(createMoveElementCommand({
      nodeId: "intro",
      destination: {
        kind: "grid",
        containerId: "page-grid",
        row: 0,
        column: 1,
        wrapperId: "intro-page-wrapper",
      },
    })).status).toBe("applied");
    expect(findElementLocation(store.getSnapshot().document, "intro")?.parent)
      .toMatchObject({ kind: "grid", containerId: "page-grid" });
    store.undo();
    expect(findElementLocation(store.getSnapshot().document, "intro")?.parent.kind)
      .toBe("body");

    expect(store.execute(createAddElementCommand({
      element: textElement("new-page-child", "New"),
      destination: {
        kind: "canvas",
        containerId: "page-canvas",
        x: "1in",
        y: "1in",
        wrapperId: "new-page-child-wrapper",
      },
    })).status).toBe("applied");
    expect(findElementLocation(store.getSnapshot().document, "new-page-child")?.parent.kind)
      .toBe("canvas");
  });

  it("rejects cycles in page-nested containers before changing either tree", () => {
    const store = customStore(pageContainerDocument());
    const before = store.getSnapshot();
    expect(() => store.execute(createMoveElementCommand({
      nodeId: "page-grid",
      destination: {
        kind: "grid",
        containerId: "page-grid",
        row: 0,
        column: 1,
      },
    }))).toThrow("inside the moved item");
    expect(store.getSnapshot()).toBe(before);
  });

  it("duplicates body and nested subtrees with fresh visual and placement ids", () => {
    const body = customStore();
    body.execute(
      createDuplicateElementCommand({
        nodeId: "stack",
        idPort: makeSequentialIdPort(10),
      }),
    );
    const duplicate = body.getSnapshot().document.elements[2];
    expect(duplicate?.type).toBe("stack");
    expect(duplicate?.id).not.toBe("stack");
    if (duplicate?.type !== "stack") throw new Error("Expected duplicate stack");
    expect(duplicate.children[0]?.id).not.toBe("stack-wrap-a");
    expect(duplicate.children[0]?.element.id).not.toBe("stack-a");

    const nested = customStore();
    nested.execute(
      createDuplicateElementCommand({
        nodeId: "stack-a",
        idPort: makeSequentialIdPort(20),
      }),
    );
    const stack = nested.getSnapshot().document.elements[1];
    if (stack?.type !== "stack") throw new Error("Expected stack");
    expect(stack.children).toHaveLength(3);
    expect(new Set(stack.children.map((child) => child.id)).size).toBe(3);
    expect(stack.children.map((child) => child.index)).toEqual([0, 1, 2]);
  });

  it("reorders top-level and stack items with accessible parity commands", () => {
    const store = customStore();
    store.execute(
      createReorderElementCommand({ nodeId: "intro", direction: "after" }),
    );
    expect(store.getSnapshot().document.elements.slice(0, 2).map((item) => item.id)).toEqual([
      "stack",
      "intro",
    ]);
    store.execute(
      createReorderElementCommand({ nodeId: "stack-b", direction: "before" }),
    );
    const stack = store.getSnapshot().document.elements[0];
    if (stack?.type !== "stack") throw new Error("Expected stack");
    expect(stack.children.map((child) => child.element.id)).toEqual([
      "stack-b",
      "stack-a",
    ]);
    expect(stack.children.map((child) => child.index)).toEqual([0, 1]);
  });

  it("writes unbound text and authoritative bound field values", () => {
    const store = new EditorStore(document());
    store.execute(
      createSetTextContentCommand({
        nodeId: "intro",
        content: { kind: "plain", text: "Changed" },
        historyGroup: "typing:intro",
      }),
    );
    const intro = findElementLocation(store.getSnapshot().document, "intro")?.element;
    expect(intro?.type === "text" ? intro.data.content : undefined).toEqual({
      kind: "plain",
      text: "Changed",
    });

    const boundDocument = document({
      fieldContract: {
        id: "00000000-0000-4000-8000-000000000001",
        version: 1,
        name: "Weekly fields",
        fields: [
          { id: "greeting", label: "Greeting", type: "text", required: false },
        ],
      },
      fieldValues: {
        greeting: { value: "Welcome", origin: "imported" },
      },
      elements: [
        textElement("bound", "Welcome", {
          bindings: [
            {
              id: "greeting-binding",
              scope: "document",
              fieldId: "greeting",
              target: "/data/content/text",
            },
          ],
        }),
      ],
    });
    const bound = new EditorStore(boundDocument);
    bound.execute(
      createSetTextContentCommand({
        nodeId: "bound",
        content: { kind: "plain", text: "Grace and peace" },
      }),
    );
    expect(bound.getSnapshot().document.fieldValues?.["greeting"]?.value).toBe(
      "Grace and peace",
    );
    expect(bound.getSnapshot().document.fieldValues?.["greeting"]?.origin).toBe(
      "manual",
    );
    const boundElement = bound.getSnapshot().document.elements[0];
    expect(boundElement?.type === "text" ? boundElement.data.content : undefined)
      .toEqual({ kind: "plain" });
  });

  it("edits direct and bound hymn details and formatted content without flattening", () => {
    const originalRichText = richDocument("Original hymn stanza");
    const changedRichText: RichTextDocument = {
      type: "document",
      blocks: [{
        type: "paragraph",
        children: [
          { type: "text", text: "Grace", marks: ["strong"] },
          { type: "text", text: " remains" },
        ],
      }],
    };
    const music = (bindings: readonly Binding[] = []): NativeElement => ({
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
    });

    const direct = new EditorStore(document({ elements: [music()] }));
    direct.execute(createSetMusicTextCommand({
      nodeId: "hymn",
      property: "source",
      value: "Christian Worship: Hymnal",
      historyGroup: "direct-music:hymn:source",
    }));
    direct.execute(createSetTextContentCommand({
      nodeId: "hymn",
      target: "musicRichContent",
      content: { kind: "richText", document: changedRichText },
      historyGroup: "direct-music:hymn:richContent",
    }));
    const directMusic = direct.getSnapshot().document.elements[0];
    expect(directMusic?.type === "music" ? directMusic.data.source : undefined)
      .toBe("Christian Worship: Hymnal");
    expect(directMusic?.type === "music" ? directMusic.data.richContent : undefined)
      .toEqual(changedRichText);
    expect(directMusic?.type === "music" ? directMusic.data.richContent : undefined)
      .not.toEqual(richDocument("Grace remains"));
    direct.undo();
    expect((direct.getSnapshot().document.elements[0] as Extract<NativeElement, { type: "music" }>).data.richContent)
      .toEqual(originalRichText);

    const bound = new EditorStore(document({
      fieldContract: {
        id: "00000000-0000-4000-8000-000000000099",
        version: 1,
        name: "Music fields",
        fields: [
          { id: "songSource", label: "Song source", type: "text", required: false },
          { id: "songText", label: "Formatted song content", type: "richText", required: false },
        ],
      },
      fieldValues: {
        songSource: { value: "Weekly source", origin: "imported" },
        songText: { value: originalRichText, origin: "imported" },
      },
      elements: [music([
        {
          id: "source-binding",
          scope: "document",
          fieldId: "songSource",
          target: "/data/source",
        },
        {
          id: "content-binding",
          scope: "document",
          fieldId: "songText",
          target: "/data/richContent",
        },
      ])],
    }));
    bound.execute(createSetMusicTextCommand({
      nodeId: "hymn",
      property: "source",
      value: "Bound source changed",
    }));
    bound.execute(createSetTextContentCommand({
      nodeId: "hymn",
      target: "musicRichContent",
      content: { kind: "richText", document: changedRichText },
    }));
    expect(bound.getSnapshot().document.fieldValues).toMatchObject({
      songSource: { value: "Bound source changed", origin: "manual" },
      songText: { value: changedRichText, origin: "manual" },
    });
    const boundMusic = bound.getSnapshot().document.elements[0];
    expect(boundMusic?.type === "music" ? boundMusic.data.source : undefined)
      .toBeUndefined();
    expect(boundMusic?.type === "music" ? boundMusic.data.richContent : undefined)
      .toBeUndefined();
  });

  it("replaces image bytes and resets the crop atomically unless a reviewed crop is supplied", () => {
    const originalRef = "asset:00000000-0000-4000-8000-000000000001";
    const replacementRef = "asset:00000000-0000-4000-8000-000000000002";
    const imageDocument = document({
      elements: [{
        id: "photo",
        type: "image",
        name: "Church exterior",
        data: {
          assetRef: originalRef,
          fit: "cover",
          focalPoint: { x: 0.1, y: 0.9 },
          alt: "Church exterior",
          decorative: false,
        },
      }],
    });
    const centered = new EditorStore(imageDocument);
    centered.execute(createReplaceImageCommand({
      nodeId: "photo",
      assetRef: replacementRef,
    }));
    expect((centered.getSnapshot().document.elements[0] as Extract<NativeElement, { type: "image" }>).data)
      .toMatchObject({
        assetRef: replacementRef,
        focalPoint: { x: 0.5, y: 0.5 },
        alt: "Church exterior",
        decorative: false,
      });
    centered.undo();
    expect((centered.getSnapshot().document.elements[0] as Extract<NativeElement, { type: "image" }>).data)
      .toMatchObject({ assetRef: originalRef, focalPoint: { x: 0.1, y: 0.9 } });

    const retained = new EditorStore(imageDocument);
    retained.execute(createReplaceImageCommand({
      nodeId: "photo",
      assetRef: replacementRef,
      focalPoint: { x: 0.1, y: 0.9 },
    }));
    expect((retained.getSnapshot().document.elements[0] as Extract<NativeElement, { type: "image" }>).data.focalPoint)
      .toEqual({ x: 0.1, y: 0.9 });
  });

  it("materializes, validates, and safely removes manual document field values", () => {
    const store = new EditorStore(document({
      fieldContract: {
        id: "00000000-0000-4000-8000-000000000020",
        version: 1,
        name: "Weekly setup",
        fields: [
          {
            id: "title",
            label: "Service title",
            type: "text",
            required: true,
            constraints: { minLength: 2, maxLength: 20 },
          },
          {
            id: "attendance",
            label: "Attendance",
            type: "number",
            required: false,
            constraints: { minimum: 0, maximum: 10 },
          },
          {
            id: "items",
            label: "Announcements",
            type: "array",
            required: false,
            itemField: { id: "item", label: "Item", type: "text", required: true },
          },
        ],
      },
    }));

    expect(store.execute(createSetDocumentFieldValueCommand({
      fieldId: "title",
      value: "Sunday worship",
    })).status).toBe("applied");
    expect(store.getSnapshot().document.fieldValues).toEqual({
      title: { value: "Sunday worship", origin: "manual" },
    });
    expect(() => store.execute(createSetDocumentFieldValueCommand({
      fieldId: "title",
      value: "x",
    }))).toThrow(/valid value for Service title/u);
    expect(() => store.execute(createSetDocumentFieldValueCommand({
      fieldId: "attendance",
      value: 11,
    }))).toThrow(/valid value for Attendance/u);
    expect(() => store.execute(createSetDocumentFieldValueCommand({
      fieldId: "items",
      value: ["One"],
    }))).toThrow(/dedicated repeated-item editor/u);
    expect(store.getSnapshot().document.fieldValues?.["title"]?.value)
      .toBe("Sunday worship");

    expect(store.execute(createSetDocumentFieldValueCommand({
      fieldId: "title",
      value: undefined,
    })).status).toBe("applied");
    expect(store.getSnapshot().document.fieldValues).toBeUndefined();
    store.undo();
    expect(store.getSnapshot().document.fieldValues?.["title"]).toEqual({
      value: "Sunday worship",
      origin: "manual",
    });
  });

  it("adds, edits, removes, and reorders repeat values with parallel stable item ids", () => {
    const repeatDocument = document({
      fieldContract: {
        id: "00000000-0000-4000-8000-000000000021",
        version: 1,
        name: "Repeated setup",
        fields: [{
          id: "items",
          label: "Announcements",
          type: "array",
          required: true,
          constraints: { minItems: 1, maxItems: 4 },
          itemField: {
            id: "item",
            label: "Announcement",
            type: "text",
            required: true,
            constraints: { minLength: 1 },
          },
        }],
      },
      fieldValues: {
        items: {
          value: ["First", "Second"],
          origin: "imported",
          itemIds: [
            "30000000-0000-4000-8000-000000000001",
            "30000000-0000-4000-8000-000000000002",
          ],
        },
      },
      contentRules: [{
        kind: "repeat",
        id: "repeat-items",
        fieldId: "items",
        prototypeNodeId: "intro",
        emptyState: { mode: "collapse" },
        maxItems: 3,
        userReorderable: true,
        itemLabel: "Announcement",
        addLabel: "Add announcement",
      }],
    });
    const idPort = makeSequentialIdPort(900);
    const store = new EditorStore(repeatDocument);

    expect(store.execute(createReorderDocumentArrayItemCommand({
      fieldId: "items",
      fromIndex: 0,
      toIndex: 1,
      idPort,
    })).status).toBe("applied");
    const reordered = store.getSnapshot().document.fieldValues?.["items"];
    expect(reordered?.value).toEqual(["Second", "First"]);
    expect(reordered?.itemIds).toHaveLength(2);
    expect(new Set(reordered?.itemIds).size).toBe(2);

    expect(store.execute(createUpdateDocumentArrayItemCommand({
      fieldId: "items",
      index: 1,
      value: "Updated first",
      idPort,
    })).status).toBe("applied");
    expect(store.execute(createAddDocumentArrayItemCommand({
      fieldId: "items",
      value: "Third",
      idPort,
    })).status).toBe("applied");
    expect(store.getSnapshot().document.fieldValues?.["items"]?.value)
      .toEqual(["Second", "Updated first", "Third"]);
    expect(store.getSnapshot().document.fieldValues?.["items"]?.itemIds).toHaveLength(3);
    expect(() => store.execute(createAddDocumentArrayItemCommand({
      fieldId: "items",
      value: "Too many",
      idPort,
    }))).toThrow(/repeated-item limit/u);

    expect(store.execute(createRemoveDocumentArrayItemCommand({
      fieldId: "items",
      index: 1,
      idPort,
    })).status).toBe("applied");
    expect(store.getSnapshot().document.fieldValues?.["items"]?.value)
      .toEqual(["Second", "Third"]);
    expect(store.getSnapshot().document.fieldValues?.["items"]?.itemIds).toHaveLength(2);
    expect(store.execute(createRemoveDocumentArrayItemCommand({
      fieldId: "items",
      index: 1,
      idPort,
    })).status).toBe("applied");
    expect(() => store.execute(createRemoveDocumentArrayItemCommand({
      fieldId: "items",
      index: 0,
      idPort,
    }))).toThrow(/allowed list size/u);

    const fixed = new EditorStore({
      ...repeatDocument,
      contentRules: [{
        ...(repeatDocument.contentRules?.[0] as Extract<NonNullable<CbbDocument["contentRules"]>[number], { kind: "repeat" }>),
        userReorderable: false,
      }],
    });
    expect(() => fixed.execute(createReorderDocumentArrayItemCommand({
      fieldId: "items",
      fromIndex: 0,
      toIndex: 1,
      idPort: makeSequentialIdPort(950),
    }))).toThrow(/not configured for volunteer reordering/u);
  });

  it("edits scalar and structured repeat values on a customInstance contract", () => {
    const definition = definitionRevision({
      version: 1,
      kind: "customElementDefinition",
      id: "savedAgenda",
      name: "Agenda",
      fieldContract: {
        id: "50000000-0000-4000-8000-000000000001",
        version: 1,
        name: "Agenda fields",
        fields: [
          { id: "enabled", label: "Enabled", type: "boolean", required: false },
          {
            id: "items",
            label: "Agenda items",
            type: "array",
            required: false,
            constraints: { maxItems: 2 },
            itemField: {
              id: "item",
              label: "Agenda item",
              type: "object",
              required: true,
              childFields: [{ id: "title", label: "Title", type: "text", required: true }],
            },
          },
        ],
      },
      contentRules: [{
        kind: "repeat",
        id: "repeatAgenda",
        fieldId: "items",
        prototypeNodeId: "agendaText",
        itemBindings: [{
          id: "agendaTitleBinding",
          itemPath: "/title",
          targetNodeId: "agendaText",
          target: "/data/content/text",
        }],
        emptyState: { mode: "collapse" },
        maxItems: 2,
        userReorderable: true,
        itemLabel: "Agenda item",
        addLabel: "Add agenda item",
      }],
      elements: [textElement("agendaText", "Agenda item")],
    });
    const store = new EditorStore(document({
      customElementDefinitions: [definition],
      elements: [{
        id: "agendaInstance",
        type: "customInstance",
        name: "Sunday agenda",
        definitionId: definition.id,
        definitionVersion: definition.definitionVersion,
        definitionHash: definition.definitionHash,
        fieldValues: {
          items: {
            value: [{ title: "Opening hymn" }],
            origin: "manual",
            itemIds: ["60000000-0000-4000-8000-000000000001"],
          },
        },
      }],
    }));
    const ids = makeSequentialIdPort(1000);

    expect(store.execute(createSetCustomInstanceFieldValueCommand({
      instanceId: "agendaInstance",
      fieldId: "enabled",
      value: true,
    })).status).toBe("applied");
    expect(store.execute(createUpdateCustomInstanceArrayItemCommand({
      instanceId: "agendaInstance",
      fieldId: "items",
      index: 0,
      value: { title: "Gathering song" },
      idPort: ids,
    })).status).toBe("applied");
    expect(store.execute(createAddCustomInstanceArrayItemCommand({
      instanceId: "agendaInstance",
      fieldId: "items",
      value: { title: "Prayer of the day" },
      idPort: ids,
    })).status).toBe("applied");
    expect(store.execute(createReorderCustomInstanceArrayItemCommand({
      instanceId: "agendaInstance",
      fieldId: "items",
      fromIndex: 1,
      toIndex: 0,
      idPort: ids,
    })).status).toBe("applied");
    let instance = store.getSnapshot().document.elements[0];
    expect(instance?.type === "customInstance" ? instance.fieldValues : undefined)
      .toMatchObject({
        enabled: { value: true, origin: "manual" },
        items: {
          value: [{ title: "Prayer of the day" }, { title: "Gathering song" }],
          itemIds: expect.any(Array),
        },
      });
    expect(store.getSnapshot().document.fieldValues).toBeUndefined();

    expect(store.execute(createRemoveCustomInstanceArrayItemCommand({
      instanceId: "agendaInstance",
      fieldId: "items",
      index: 1,
      idPort: ids,
    })).status).toBe("applied");
    instance = store.getSnapshot().document.elements[0];
    expect(instance?.type === "customInstance" ? instance.fieldValues?.["items"]?.value : undefined)
      .toEqual([{ title: "Prayer of the day" }]);
    store.undo();
    instance = store.getSnapshot().document.elements[0];
    expect(instance?.type === "customInstance" ? instance.fieldValues?.["items"]?.value : undefined)
      .toEqual([{ title: "Prayer of the day" }, { title: "Gathering song" }]);
  });

  it("edits a reachable nested Saved Section owner and repins every transitive occurrence", () => {
    const inner = definitionRevision({
      version: 1,
      kind: "customElementDefinition",
      id: "innerSavedSection",
      name: "Inner weekly content",
      fieldContract: {
        id: "61000000-0000-4000-8000-000000000001",
        version: 1,
        name: "Inner fields",
        fields: [
          { id: "notice", label: "Notice", type: "text", required: false },
          {
            id: "items",
            label: "Items",
            type: "array",
            required: false,
            constraints: { maxItems: 2 },
            itemField: { id: "item", label: "Item", type: "text", required: true },
          },
        ],
      },
      contentRules: [{
        kind: "repeat",
        id: "repeatInnerItems",
        fieldId: "items",
        prototypeNodeId: "innerItemText",
        itemBindings: [{
          id: "innerItemBinding",
          itemPath: "",
          targetNodeId: "innerItemText",
          target: "/data/content/text",
        }],
        emptyState: { mode: "collapse" },
        maxItems: 2,
        userReorderable: true,
        itemLabel: "Item",
        addLabel: "Add item",
      }],
      elements: [textElement("innerItemText", "Item")],
    });
    const outer = definitionRevision({
      version: 1,
      kind: "customElementDefinition",
      id: "outerSavedSection",
      name: "Outer section",
      fieldContract: {
        id: "61000000-0000-4000-8000-000000000002",
        version: 1,
        name: "Outer fields",
        fields: [],
      },
      elements: [{
        id: "nestedInnerOwner",
        type: "customInstance",
        name: "Nested weekly content",
        definitionId: inner.id,
        definitionVersion: inner.definitionVersion,
        definitionHash: inner.definitionHash,
      }],
    });
    const top = definitionRevision({
      version: 1,
      kind: "customElementDefinition",
      id: "topSavedSection",
      name: "Top section",
      fieldContract: {
        id: "61000000-0000-4000-8000-000000000003",
        version: 1,
        name: "Top fields",
        fields: [],
      },
      elements: [{
        id: "outerInsideTop",
        type: "customInstance",
        name: "Outer inside top",
        definitionId: outer.id,
        definitionVersion: outer.definitionVersion,
        definitionHash: outer.definitionHash,
      }],
    });
    const source = document({
      customElementDefinitions: [inner, outer, top],
      elements: [{
        id: "topInBody",
        type: "customInstance",
        name: "Top in body",
        definitionId: top.id,
        definitionVersion: top.definitionVersion,
        definitionHash: top.definitionHash,
      }],
      pageElements: [{
        id: "outerPagePlacement",
        purpose: "decoration",
        target: { mode: "all" },
        layer: "overlay",
        region: "page",
        anchor: "topLeft",
        x: "0in",
        y: "0in",
        width: "auto",
        height: "auto",
        zIndex: 0,
        clipToRegion: false,
        semantic: { mode: "artifact" },
        element: {
          id: "outerPageStack",
          type: "stack",
          name: "Outer page stack",
          data: { direction: "vertical", gap: "0pt" },
          children: [{
            id: "outerPageChild",
            index: 0,
            element: {
              id: "outerOnPage",
              type: "customInstance",
              name: "Outer on page",
              definitionId: outer.id,
              definitionVersion: outer.definitionVersion,
              definitionHash: outer.definitionHash,
            },
          }],
        },
      }],
    });
    const original = JSON.stringify(source);
    const store = new EditorStore(source);

    expect(store.execute(createSetCustomInstanceFieldValueCommand({
      instanceId: "nestedInnerOwner",
      fieldId: "notice",
      value: "Shared nested value",
    })).status).toBe("applied");
    expect(store.execute(createAddCustomInstanceArrayItemCommand({
      instanceId: "nestedInnerOwner",
      fieldId: "items",
      value: "First",
      idPort: makeSequentialIdPort(1400),
    })).status).toBe("applied");

    const next = store.getSnapshot().document;
    const nextInner = next.customElementDefinitions?.find((entry) => entry.id === inner.id);
    const nextOuter = next.customElementDefinitions?.find((entry) => entry.id === outer.id);
    const nextTop = next.customElementDefinitions?.find((entry) => entry.id === top.id);
    const nested = nextOuter?.elements[0];
    const outerInTop = nextTop?.elements[0];
    expect(nextInner?.definitionVersion).toBe(inner.definitionVersion);
    expect(nextOuter?.definitionVersion).toBe(outer.definitionVersion + 2);
    expect(nextTop?.definitionVersion).toBe(top.definitionVersion + 2);
    expect(nested?.type === "customInstance" ? nested.fieldValues : undefined).toMatchObject({
      notice: { value: "Shared nested value", origin: "manual" },
      items: { value: ["First"], origin: "manual", itemIds: [expect.any(String)] },
    });
    expect(nested?.type === "customInstance" ? nested.definitionHash : undefined)
      .toBe(nextInner?.definitionHash);
    expect(outerInTop?.type === "customInstance" ? outerInTop.definitionHash : undefined)
      .toBe(nextOuter?.definitionHash);
    expect(next.elements[0]?.type === "customInstance" ? next.elements[0].definitionHash : undefined)
      .toBe(nextTop?.definitionHash);
    const nextPageRoot = next.pageElements?.[0]?.element;
    const nextPageInstance = nextPageRoot?.type === "stack"
      ? nextPageRoot.children[0]?.element
      : undefined;
    expect(nextPageInstance?.type === "customInstance" ? nextPageInstance.definitionHash : undefined)
      .toBe(nextOuter?.definitionHash);
    expect(validateDocumentSemantics(next)).toEqual({ valid: true, findings: [] });

    store.undo();
    store.undo();
    expect(JSON.stringify(store.getSnapshot().document)).toBe(original);
  });

  it("writes bound date and image replacements back to their weekly fields", () => {
    const store = new EditorStore(document({
      fieldContract: {
        id: "00000000-0000-4000-8000-000000000010",
        version: 1,
        name: "Weekly media",
        fields: [
          { id: "serviceDate", label: "Service date", type: "date", required: true },
          { id: "coverImage", label: "Cover image", type: "assetRef", required: true },
        ],
      },
      fieldValues: {
        serviceDate: { value: "2026-07-12", origin: "derived" },
        coverImage: {
          value: "asset:00000000-0000-4000-8000-000000000001",
          origin: "imported",
        },
      },
      elements: [
        {
          id: "date",
          type: "date",
          name: "Service date",
          data: { value: "2026-01-01" },
          bindings: [{
            id: "date-binding",
            scope: "document",
            fieldId: "serviceDate",
            target: "/data/value",
          }],
        },
        {
          id: "image",
          type: "image",
          name: "Cover",
          data: {
            assetRef: "asset:00000000-0000-4000-8000-000000000001",
            fit: "cover",
          },
          bindings: [{
            id: "image-binding",
            scope: "document",
            fieldId: "coverImage",
            target: "/data/assetRef",
          }],
        },
      ],
    }));

    store.execute(createSetDateValueCommand({ nodeId: "date", value: "2026-07-19" }));
    store.execute(createSetDatePresentationCommand({ nodeId: "date", format: "dddd, MMMM D, YYYY" }));
    store.execute(createReplaceImageCommand({
      nodeId: "image",
      assetRef: "asset:00000000-0000-4000-8000-000000000002",
    }));
    expect(store.getSnapshot().document.fieldValues).toMatchObject({
      serviceDate: { value: "2026-07-19", origin: "manual" },
      coverImage: {
        value: "asset:00000000-0000-4000-8000-000000000002",
        origin: "manual",
      },
    });
  });

  it("keeps top-level semantic metadata synchronized while local field edits stay local", () => {
    const source = document({
      metadata: {
        publicationDate: "2026-07-12",
        serviceLabel: "Sunday Service",
      },
      fieldContract: {
        id: "00000000-0000-4000-8000-000000000011",
        version: 1,
        name: "Semantic weekly fields",
        fields: [
          {
            id: "serviceDate",
            label: "Service date",
            type: "date",
            required: false,
            semanticRole: "publicationDate",
            weeklyBehavior: {
              rolloverPolicy: "clear",
              reviewExpectation: "everyBulletin",
            },
          },
          {
            id: "serviceKind",
            label: "Service kind",
            type: "choice",
            required: false,
            default: "sunday",
            semanticRole: "serviceLabel",
            constraints: {
              choices: [
                { id: "sunday", label: "Sunday Service" },
                { id: "midweek", label: "Midweek Service" },
              ],
            },
          },
          { id: "note", label: "Note", type: "text", required: false },
        ],
      },
      fieldValues: {
        serviceDate: { value: "2026-07-12", origin: "derived" },
        serviceKind: { value: "sunday", origin: "imported" },
      },
      elements: [{
        id: "semantic-date",
        type: "date",
        name: "Service date",
        data: {},
        bindings: [{
          id: "semantic-date-binding",
          scope: "document",
          fieldId: "serviceDate",
          target: "/data/value",
        }],
      }],
    });
    const store = new EditorStore(source);

    expect(store.execute(createSetDateValueCommand({
      nodeId: "semantic-date",
      value: "2026-07-19",
    })).status).toBe("applied");
    expect(store.getSnapshot().document).toMatchObject({
      metadata: { publicationDate: "2026-07-19", serviceLabel: "Sunday Service" },
      fieldValues: { serviceDate: { value: "2026-07-19", origin: "manual" } },
    });
    store.undo();
    expect(store.getSnapshot().document).toEqual(source);

    expect(store.execute(createSetDocumentFieldValueCommand({
      fieldId: "serviceKind",
      value: "midweek",
    })).status).toBe("applied");
    expect(store.getSnapshot().document.metadata?.serviceLabel).toBe("Midweek Service");
    expect(store.execute(createSetDocumentFieldValueCommand({
      fieldId: "serviceKind",
      value: undefined,
    })).status).toBe("applied");
    expect(store.getSnapshot().document.metadata?.serviceLabel).toBe("Sunday Service");
    expect(store.execute(createSetDocumentFieldValueCommand({
      fieldId: "serviceDate",
      value: undefined,
    })).status).toBe("applied");
    expect(store.getSnapshot().document.metadata).toEqual({ serviceLabel: "Sunday Service" });

    const localDefinition = definitionRevision({
      version: 1,
      kind: "customElementDefinition",
      id: "localSemanticDefinition",
      name: "Local semantic section",
      fieldContract: {
        id: "00000000-0000-4000-8000-000000000012",
        version: 1,
        name: "Local fields",
        fields: [{
          id: "localService",
          label: "Local service",
          type: "text",
          required: false,
          semanticRole: "serviceLabel",
        }],
      },
      elements: [],
    });
    const localSource = document({
      metadata: { serviceLabel: "Historical top-level label" },
      elements: [{
        id: "localSemanticInstance",
        type: "customInstance",
        name: "Local semantic section",
        definitionId: localDefinition.id,
        definitionVersion: localDefinition.definitionVersion,
        definitionHash: localDefinition.definitionHash,
        fieldValues: {
          localService: { value: "Local old label", origin: "imported" },
        },
      }],
      customElementDefinitions: [localDefinition],
    });
    const localStore = new EditorStore(localSource);
    expect(localStore.execute(createSetCustomInstanceFieldValueCommand({
      instanceId: "localSemanticInstance",
      fieldId: "localService",
      value: "Local new label",
    })).status).toBe("applied");
    expect(localStore.getSnapshot().document.metadata).toEqual(localSource.metadata);
  });

  it("creates authoritative manual values when a template bulletin has no fieldValues", () => {
    const originalRichText = richDocument("Template formatted text");
    const template = document({
      kind: "template",
      name: "Binding template",
      fieldContract: {
        id: "00000000-0000-4000-8000-000000000020",
        version: 1,
        name: "Weekly content",
        fields: [
          { id: "formatted", label: "Formatted text", type: "richText", required: false },
          { id: "serviceDate", label: "Service date", type: "date", required: false },
          { id: "coverImage", label: "Cover image", type: "assetRef", required: false },
        ],
      },
      elements: [
        {
          id: "formatted-text",
          type: "text",
          name: "Formatted text",
          data: { content: { kind: "richText", document: originalRichText } },
          bindings: [{
            id: "formatted-binding",
            scope: "document",
            fieldId: "formatted",
            target: "/data/content/document",
          }],
        },
        {
          id: "bound-date",
          type: "date",
          name: "Service date",
          data: { value: "2026-07-12" },
          bindings: [{
            id: "date-binding",
            scope: "document",
            fieldId: "serviceDate",
            target: "/data/value",
          }],
        },
        {
          id: "bound-image",
          type: "image",
          name: "Cover image",
          data: {
            assetRef: "asset:00000000-0000-4000-8000-000000000001",
            fit: "cover",
          },
          bindings: [{
            id: "image-binding",
            scope: "document",
            fieldId: "coverImage",
            target: "/data/assetRef",
          }],
        },
      ],
    });
    const bulletin = createBulletinFromTemplateDocument(template, {
      idPort: makeSequentialIdPort(1100),
      publicationDate: "2026-07-19",
    });
    expect(bulletin.fieldValues).toBeUndefined();
    const store = new EditorStore(bulletin);
    const editedRichText = richDocument("Edited formatted text");

    expect(store.execute(createSetTextContentCommand({
      nodeId: "formatted-text",
      content: { kind: "richText", document: editedRichText },
    })).status).toBe("applied");
    expect(store.execute(createSetDateValueCommand({
      nodeId: "bound-date",
      value: "2026-07-19",
    })).status).toBe("applied");
    expect(store.execute(createReplaceImageCommand({
      nodeId: "bound-image",
      assetRef: "asset:00000000-0000-4000-8000-000000000002",
    })).status).toBe("applied");

    expect(store.getSnapshot().document.fieldValues).toEqual({
      formatted: { value: editedRichText, origin: "manual" },
      serviceDate: { value: "2026-07-19", origin: "manual" },
      coverImage: {
        value: "asset:00000000-0000-4000-8000-000000000002",
        origin: "manual",
      },
    });
    const text = findElementLocation(store.getSnapshot().document, "formatted-text")?.element;
    expect(text?.type === "text" ? text.data.content : undefined)
      .toEqual({ kind: "richText" });
  });

  it("creates a missing local fieldValues container for bound text", () => {
    const store = new EditorStore(document({
      elements: [textElement("local-text", "Template value", {
        fieldContract: {
          id: "00000000-0000-4000-8000-000000000021",
          version: 1,
          name: "Local content",
          fields: [{ id: "label", label: "Label", type: "text", required: false }],
        },
        bindings: [{
          id: "local-label-binding",
          scope: "local",
          fieldId: "label",
          target: "/data/content/text",
        }],
      })],
    }));

    expect(store.execute(createSetTextContentCommand({
      nodeId: "local-text",
      content: { kind: "plain", text: "Entered value" },
    })).status).toBe("applied");
    const element = findElementLocation(store.getSnapshot().document, "local-text")?.element;
    expect(element?.fieldValues).toEqual({
      label: { value: "Entered value", origin: "manual" },
    });
    expect(store.getSnapshot().document.fieldValues).toBeUndefined();
  });

  it("updates authoring policy properties without materializing inherited false values", () => {
    const store = customStore(document({ authoringPolicy: { contentLocked: true } }));
    expect(store.execute(createSetAuthoringPolicyCommand({ layoutLocked: false })).status)
      .toBe("applied");
    expect(store.getSnapshot().document.authoringPolicy).toEqual({
      contentLocked: true,
      layoutLocked: false,
    });

    expect(store.execute(createSetAuthoringPolicyCommand({
      nodeId: "intro",
      layoutLocked: true,
    })).status).toBe("applied");
    expect(findElementLocation(store.getSnapshot().document, "intro")?.element.authoringPolicy)
      .toEqual({ layoutLocked: true });

    expect(store.execute(createSetAuthoringPolicyCommand({
      nodeId: "intro",
      contentLocked: true,
    })).status).toBe("applied");
    expect(findElementLocation(store.getSnapshot().document, "intro")?.element.authoringPolicy)
      .toEqual({ contentLocked: true, layoutLocked: true });

    const wrapperStore = customStore(pageContainerDocument());
    expect(wrapperStore.execute(createSetAuthoringPolicyCommand({
      nodeId: "page-text-wrapper",
      layoutLocked: true,
    })).status).toBe("applied");
    const pageRoot = wrapperStore.getSnapshot().document.pageElements?.[0]?.element;
    expect(pageRoot?.type === "stack" ? pageRoot.children[0]?.authoringPolicy : undefined)
      .toEqual({ layoutLocked: true });
    expect(wrapperStore.getSnapshot().selection).toMatchObject({ nodeId: "page-text-wrapper" });
  });

  it("resizes elements, moves canvas children, and groups pointer changes", () => {
    const store = customStore();
    store.execute(
      createResizeElementCommand({
        nodeId: "intro",
        width: "4in",
        height: "auto",
        historyGroup: "resize:intro",
      }),
    );
    store.execute(
      createResizeElementCommand({
        nodeId: "intro",
        width: "4.25in",
        height: "auto",
        historyGroup: "resize:intro",
      }),
    );
    expect(findElementLocation(store.getSnapshot().document, "intro")?.element).toMatchObject({
      width: "4.25in",
      height: "auto",
    });
    store.undo();
    expect(findElementLocation(store.getSnapshot().document, "intro")?.element.width).toBeUndefined();

    store.setSelection({ kind: "node", nodeId: "canvas-wrap-a", surface: "structure" });
    store.execute(
      createMoveCanvasChildCommand({
        nodeId: "canvas-a",
        x: "1in",
        y: "2in",
      }),
    );
    expect(findElementLocation(store.getSnapshot().document, "canvas-a")?.parent).toMatchObject({
      wrapper: { x: "1in", y: "2in" },
    });
    expect(store.getSnapshot().selection).toMatchObject({ nodeId: "canvas-wrap-a" });
    store.execute(createResizeElementCommand({ nodeId: "canvas-a", width: "2in", height: "1in" }));
    expect(store.getSnapshot().selection).toMatchObject({ nodeId: "canvas-wrap-a" });
  });

  it("updates image focal point with content-lock enforcement", () => {
    const image: NativeElement = {
      id: "photo",
      type: "image",
      name: "Church photo",
      data: {
        assetRef: "asset:00000000-0000-4000-8000-000000000001",
        fit: "cover",
        alt: "Church exterior",
      },
    };
    const store = new EditorStore(document({ elements: [image] }));
    store.execute(
      createSetImageFocalPointCommand({
        nodeId: "photo",
        focalPoint: { x: 0.25, y: 0.75 },
      }),
    );
    expect(store.getSnapshot().document.elements[0]).toMatchObject({
      data: { focalPoint: { x: 0.25, y: 0.75 } },
    });
    expect(() => store.execute(createSetImageFocalPointCommand({
      nodeId: "photo",
      focalPoint: { x: Number.NaN, y: 0.5 },
    }))).toThrow(/between 0 and 1/u);
    expect(() => store.execute(createSetImageFocalPointCommand({
      nodeId: "photo",
      focalPoint: { x: 1.1, y: 0.5 },
    }))).toThrow(/between 0 and 1/u);
    expect(() => store.execute(createSetImageFocalPointCommand({
      nodeId: "photo",
      focalPoint: { x: 0.5 } as unknown as { readonly x: number; readonly y: number },
    }))).toThrow(/between 0 and 1/u);

    const locked = new EditorStore(
      document({
        elements: [{ ...image, authoringPolicy: { contentLocked: true } }],
      }),
    );
    expect(
      locked.execute(
        createSetImageFocalPointCommand({
          nodeId: "photo",
          focalPoint: { x: 0.5, y: 0.5 },
        }),
      ),
    ).toMatchObject({ status: "denied", denial: { code: "contentLocked" } });
  });

  it("stores only unbound focal axes for crop edits and image replacement, with undo", () => {
    const originalRef = "asset:00000000-0000-4000-8000-000000000001";
    const replacementRef = "asset:00000000-0000-4000-8000-000000000002";
    for (const boundAxes of [[], ["x"], ["y"], ["x", "y"]] as const) {
      const axes: readonly ("x" | "y")[] = boundAxes;
      const bindings = axes.map((axis) => ({
        id: `${axis}-binding`,
        scope: "document" as const,
        fieldId: `focal-${axis}`,
        target: `/data/focalPoint/${axis}`,
      }));
      const focalPoint = {
        ...(axes.includes("x") ? {} : { x: 0.1 }),
        ...(axes.includes("y") ? {} : { y: 0.9 }),
      };
      const source = document({
        fieldContract: {
          id: "00000000-0000-4000-8000-000000000088",
          version: 1,
          name: "Crop fields",
          fields: [
            { id: "focal-x", label: "Focal X", type: "number", required: false },
            { id: "focal-y", label: "Focal Y", type: "number", required: false },
          ],
        },
        elements: [{
          id: "bound-photo",
          type: "image",
          name: "Bound photo",
          data: {
            assetRef: originalRef,
            fit: "cover",
            ...(Object.keys(focalPoint).length === 0 ? {} : { focalPoint }),
          },
          ...(bindings.length === 0 ? {} : { bindings }),
        }],
      });
      const expectedSetLiteral = {
        ...(axes.includes("x") ? {} : { x: 0.2 }),
        ...(axes.includes("y") ? {} : { y: 0.8 }),
      };
      const setStore = new EditorStore(source);
      expect(setStore.execute(createSetImageFocalPointCommand({
        nodeId: "bound-photo",
        focalPoint: { x: 0.2, y: 0.8 },
      })).status).toBe("applied");
      const setImage = setStore.getSnapshot().document.elements[0];
      expect(setImage?.type === "image" ? setImage.data.focalPoint : undefined)
        .toEqual(Object.keys(expectedSetLiteral).length === 0 ? undefined : expectedSetLiteral);
      if (axes.length === 0) expect(setStore.getSnapshot().document.fieldValues).toBeUndefined();
      else {
        expect(setStore.getSnapshot().document.fieldValues).toMatchObject({
          ...(axes.includes("x") ? { "focal-x": { value: 0.2, origin: "manual" } } : {}),
          ...(axes.includes("y") ? { "focal-y": { value: 0.8, origin: "manual" } } : {}),
        });
      }
      setStore.undo();
      expect(setStore.getSnapshot().document).toEqual(source);

      const expectedReplaceLiteral = {
        ...(axes.includes("x") ? {} : { x: 0.3 }),
        ...(axes.includes("y") ? {} : { y: 0.7 }),
      };
      const replaceStore = new EditorStore(source);
      expect(replaceStore.execute(createReplaceImageCommand({
        nodeId: "bound-photo",
        assetRef: replacementRef,
        focalPoint: { x: 0.3, y: 0.7 },
      })).status).toBe("applied");
      const replaced = replaceStore.getSnapshot().document.elements[0];
      expect(replaced?.type === "image" ? replaced.data.focalPoint : undefined)
        .toEqual(Object.keys(expectedReplaceLiteral).length === 0
          ? undefined
          : expectedReplaceLiteral);
      if (axes.length === 0) expect(replaceStore.getSnapshot().document.fieldValues).toBeUndefined();
      else {
        expect(replaceStore.getSnapshot().document.fieldValues).toMatchObject({
          ...(axes.includes("x") ? { "focal-x": { value: 0.3, origin: "manual" } } : {}),
          ...(axes.includes("y") ? { "focal-y": { value: 0.7, origin: "manual" } } : {}),
        });
      }
      replaceStore.undo();
      expect(replaceStore.getSnapshot().document).toEqual(source);
    }

    const sharedSource = document({
      fieldContract: {
        id: "00000000-0000-4000-8000-000000000089",
        version: 1,
        name: "Shared crop field",
        fields: [{ id: "crop", label: "Crop", type: "number", required: false }],
      },
      elements: [{
        id: "shared-photo",
        type: "image",
        name: "Shared photo",
        data: { assetRef: originalRef, fit: "cover" },
        bindings: [
          { id: "shared-x", scope: "document", fieldId: "crop", target: "/data/focalPoint/x" },
          { id: "shared-y", scope: "document", fieldId: "crop", target: "/data/focalPoint/y" },
        ],
      }],
    });
    const shared = new EditorStore(sharedSource);
    expect(() => shared.execute(createSetImageFocalPointCommand({
      nodeId: "shared-photo",
      focalPoint: { x: 0.2, y: 0.8 },
    }))).toThrow(/share one weekly field/u);
    expect(() => shared.execute(createReplaceImageCommand({
      nodeId: "shared-photo",
      assetRef: replacementRef,
      focalPoint: { x: 0.3, y: 0.7 },
    }))).toThrow(/share one weekly field/u);
    expect(shared.getSnapshot().document).toEqual(sharedSource);
  });

  it("edits page margins and page-placement dimensions through their owners", () => {
    const pageDocument = document({
      pageElements: [
        {
          id: "header-placement",
          purpose: "header",
          target: { mode: "all" },
          layer: "overlay",
          region: "topMargin",
          anchor: "topCenter",
          x: "0pt",
          y: "0pt",
          width: "auto",
          height: "auto",
          zIndex: 1,
          clipToRegion: true,
          semantic: { mode: "artifact" },
          element: textElement("header-text", "Header"),
        },
      ],
    });
    const store = customStore(pageDocument);
    store.execute(createSetPageMarginCommand({ side: "top", value: "0.75in" }));
    store.setSelection({ kind: "node", nodeId: "header-placement", surface: "editor" });
    store.execute(
      createResizeElementCommand({
        nodeId: "header-text",
        width: "100%",
        height: "0.5in",
      }),
    );
    expect(store.getSnapshot().document.page.margins?.top).toBe("0.75in");
    expect(store.getSnapshot().document.pageElements?.[0]).toMatchObject({
      width: "100%",
      height: "0.5in",
    });
    expect(store.getSnapshot().selection).toMatchObject({ nodeId: "header-placement" });
  });

  it("throws stable vocabulary errors without mutating state", () => {
    const store = customStore();
    const before = store.getSnapshot();
    expect(() =>
      store.execute(
        createMoveCanvasChildCommand({
          nodeId: "intro",
          x: "1in",
          y: "1in",
        }),
      ),
    ).toThrow(EditorCommandVocabularyError);
    expect(store.getSnapshot()).toBe(before);
  });

  it("updates image bytes, fit, focal point, and accessibility without disturbing placement", () => {
    const store = customStore(document({
      elements: [{
        id: "photo",
        type: "image",
        name: "Photo",
        width: "2in",
        data: {
          assetRef: "asset:00000000-0000-4000-8000-000000000001",
          fit: "contain",
          alt: "Old description",
        },
      }],
    }));
    store.execute(createReplaceImageCommand({
      nodeId: "photo",
      assetRef: "asset:00000000-0000-4000-8000-000000000002",
    }));
    store.execute(createSetImageFitCommand({ nodeId: "photo", fit: "cover" }));
    store.execute(createSetImageFocalPointCommand({ nodeId: "photo", focalPoint: { x: 0.2, y: 0.8 } }));
    store.execute(createSetImageAccessibilityCommand({ nodeId: "photo", decorative: true }));
    const photo = store.getSnapshot().document.elements[0];
    if (photo?.type !== "image") throw new Error("Expected image");
    expect(photo.width).toBe("2in");
    expect(photo.data).toEqual({
      assetRef: "asset:00000000-0000-4000-8000-000000000002",
      fit: "cover",
      focalPoint: { x: 0.2, y: 0.8 },
      decorative: true,
    });
  });

  it("writes both bound image accessibility properties to one missing fieldValues container", () => {
    const sourceData = {
      assetRef: "asset:00000000-0000-4000-8000-000000000001" as const,
      fit: "cover" as const,
      focalPoint: { x: 0.25, y: 0.75 },
      alt: "Template description",
      decorative: true,
    };
    const store = new EditorStore(document({
      fieldContract: {
        id: "00000000-0000-4000-8000-000000000040",
        version: 1,
        name: "Image accessibility",
        fields: [
          { id: "imageAlt", label: "Image description", type: "text", required: false },
          { id: "imageDecorative", label: "Decorative", type: "boolean", required: false },
        ],
      },
      elements: [{
        id: "bound-photo",
        type: "image",
        name: "Bound photo",
        data: sourceData,
        bindings: [
          {
            id: "alt-binding",
            scope: "document",
            fieldId: "imageAlt",
            target: "/data/alt",
          },
          {
            id: "decorative-binding",
            scope: "document",
            fieldId: "imageDecorative",
            target: "/data/decorative",
          },
        ],
      }],
    }));

    expect(store.execute(createSetImageAccessibilityCommand({
      nodeId: "bound-photo",
      alt: "  Entered description  ",
      decorative: false,
    })).status).toBe("applied");
    expect(store.getSnapshot().document.fieldValues).toEqual({
      imageAlt: { value: "Entered description", origin: "manual" },
      imageDecorative: { value: false, origin: "manual" },
    });
    const image = findElementLocation(store.getSnapshot().document, "bound-photo")?.element;
    expect(image?.type === "image" ? image.data : undefined).toEqual({
      assetRef: sourceData.assetRef,
      fit: sourceData.fit,
      focalPoint: sourceData.focalPoint,
    });
  });

  it("updates literal image accessibility data only for properties without bindings", () => {
    const altBound = new EditorStore(document({
      elements: [{
        id: "alt-bound-photo",
        type: "image",
        name: "Alt-bound photo",
        fieldContract: {
          id: "00000000-0000-4000-8000-000000000041",
          version: 1,
          name: "Local image description",
          fields: [{ id: "imageAlt", label: "Image description", type: "text", required: false }],
        },
        data: {
          assetRef: "asset:00000000-0000-4000-8000-000000000001",
          fit: "contain",
          alt: "Template description",
          decorative: true,
        },
        bindings: [{
          id: "local-alt-binding",
          scope: "local",
          fieldId: "imageAlt",
          target: "/data/alt",
        }],
      }],
    }));
    expect(altBound.execute(createSetImageAccessibilityCommand({
      nodeId: "alt-bound-photo",
      alt: "Entered description",
      decorative: false,
    })).status).toBe("applied");
    const altImage = findElementLocation(
      altBound.getSnapshot().document,
      "alt-bound-photo",
    )?.element;
    expect(altImage?.fieldValues).toEqual({
      imageAlt: { value: "Entered description", origin: "manual" },
    });
    expect(altImage?.type === "image" ? altImage.data : undefined).toMatchObject({
      decorative: false,
      fit: "contain",
    });
    expect(altImage?.type === "image" ? altImage.data.alt : undefined).toBeUndefined();
    altBound.undo();
    expect((findElementLocation(altBound.getSnapshot().document, "alt-bound-photo")?.element as
      Extract<NativeElement, { type: "image" }>).data.alt).toBe("Template description");
    expect(altBound.execute(createSetImageAccessibilityCommand({
      nodeId: "alt-bound-photo",
      decorative: true,
    })).status).toBe("applied");
    const missingAlt = findElementLocation(
      altBound.getSnapshot().document,
      "alt-bound-photo",
    )?.element;
    expect(missingAlt?.fieldValues).toBeUndefined();
    expect(missingAlt?.type === "image" ? missingAlt.data : undefined).toMatchObject({
      decorative: true,
      fit: "contain",
    });
    expect(missingAlt?.type === "image" ? missingAlt.data.alt : undefined).toBeUndefined();

    const decorativeBound = new EditorStore(document({
      fieldContract: {
        id: "00000000-0000-4000-8000-000000000042",
        version: 1,
        name: "Image role",
        fields: [{ id: "decorative", label: "Decorative", type: "boolean", required: false }],
      },
      elements: [{
        id: "decorative-bound-photo",
        type: "image",
        name: "Decorative-bound photo",
        data: {
          assetRef: "asset:00000000-0000-4000-8000-000000000001",
          fit: "cover",
          alt: "Template description",
          decorative: true,
        },
        bindings: [{
          id: "decorative-only-binding",
          scope: "document",
          fieldId: "decorative",
          target: "/data/decorative",
        }],
      }],
    }));
    expect(decorativeBound.execute(createSetImageAccessibilityCommand({
      nodeId: "decorative-bound-photo",
      alt: "Entered description",
      decorative: false,
    })).status).toBe("applied");
    expect(decorativeBound.getSnapshot().document.fieldValues).toEqual({
      decorative: { value: false, origin: "manual" },
    });
    const decorativeImage = findElementLocation(
      decorativeBound.getSnapshot().document,
      "decorative-bound-photo",
    )?.element;
    expect(decorativeImage?.type === "image" ? decorativeImage.data : undefined).toMatchObject({
      alt: "Entered description",
      fit: "cover",
    });
    expect(decorativeImage?.type === "image"
      ? decorativeImage.data.decorative
      : undefined).toBeUndefined();
    decorativeBound.undo();
    expect((findElementLocation(
      decorativeBound.getSnapshot().document,
      "decorative-bound-photo",
    )?.element as Extract<NativeElement, { type: "image" }>).data.decorative).toBe(true);
  });

  it("updates grid tracks, gutters, and table semantics as one undoable layout command", () => {
    const base = document();
    const store = customStore({
      ...base,
      elements: base.elements.map((element) => element.id === "grid" && element.type === "grid"
        ? {
            ...element,
            children: [
              ...element.children,
              {
                id: "grid-wrap-b",
                row: 0,
                column: 1,
                element: textElement("grid-b", "Right"),
              },
            ],
          }
        : element),
    });
    expect(store.execute(createSetGridLayoutCommand({
      nodeId: "grid",
      rowGap: "8pt",
      columnGap: "12pt",
      columnTracks: ["2fr", "1fr"],
      semanticRole: "table",
      tableSemantics: { summary: "Service assignments", headerRows: 1, headerColumns: 0 },
    })).status).toBe("applied");
    const grid = findElementLocation(store.getSnapshot().document, "grid")?.element;
    expect(grid?.type === "grid" ? grid.data : undefined).toMatchObject({
      rowGap: "8pt",
      columnGap: "12pt",
      columnTracks: ["2fr", "1fr"],
      semanticRole: "table",
      tableSemantics: { summary: "Service assignments", headerRows: 1, headerColumns: 0 },
    });
    expect(store.execute(createSetGridLayoutCommand({
      nodeId: "grid",
      semanticRole: "layout",
    })).status).toBe("applied");
    const layoutGrid = findElementLocation(store.getSnapshot().document, "grid")?.element;
    expect(layoutGrid?.type === "grid" ? layoutGrid.data : undefined).toMatchObject({
      semanticRole: "layout",
      columnTracks: ["2fr", "1fr"],
    });
    expect(layoutGrid?.type === "grid" ? layoutGrid.data.tableSemantics : undefined).toBeUndefined();
    store.undo();
    store.undo();
    const restored = findElementLocation(store.getSnapshot().document, "grid")?.element;
    expect(restored?.type === "grid" ? restored.data.columnGap : undefined).toBeUndefined();
  });

  it("explains why an incomplete grid cannot become a semantic table", () => {
    const store = customStore();
    expect(() => store.execute(createSetGridLayoutCommand({
      nodeId: "grid",
      semanticRole: "table",
      tableSemantics: { summary: "Assignments", headerRows: 1, headerColumns: 0 },
    }))).toThrow("Fill every grid cell before marking this grid as tabular data");
  });

  it("changes stack direction and gap as one undoable layout command", () => {
    const store = customStore();
    expect(store.execute(createSetStackLayoutCommand({
      nodeId: "stack",
      direction: "horizontal",
      gap: "12pt",
    })).status).toBe("applied");
    const stack = findElementLocation(store.getSnapshot().document, "stack")?.element;
    expect(stack?.type === "stack" ? stack.data : undefined).toEqual({
      direction: "horizontal",
      gap: "12pt",
    });
    store.undo();
    const restored = findElementLocation(store.getSnapshot().document, "stack")?.element;
    expect(restored?.type === "stack" ? restored.data.direction : undefined).toBe("vertical");
  });

  it("changes canvas paint and reading order independently", () => {
    const base = document();
    const store = customStore({
      ...base,
      elements: base.elements.map((element) => element.id === "canvas" && element.type === "canvas"
        ? {
            ...element,
            children: [
              ...element.children,
              { id: "canvas-wrap-b", x: "1in", y: "1in", element: textElement("canvas-b", "Second") },
            ],
          }
        : element),
    });
    store.execute(createReorderCanvasChildCommand({ nodeId: "canvas-a", direction: "forward" }));
    let canvas = findElementLocation(store.getSnapshot().document, "canvas")?.element;
    expect(canvas?.type === "canvas" ? canvas.children.map((wrapper) => wrapper.element.id) : []).toEqual([
      "canvas-b",
      "canvas-a",
    ]);

    store.execute(createReorderCanvasReadingCommand({ nodeId: "canvas-a", direction: "earlier" }));
    canvas = findElementLocation(store.getSnapshot().document, "canvas")?.element;
    expect(canvas?.type === "canvas" ? canvas.children.map((wrapper) => wrapper.semanticOrder) : []).toEqual([1, 0]);
    store.execute(createResetCanvasReadingOrderCommand("canvas"));
    canvas = findElementLocation(store.getSnapshot().document, "canvas")?.element;
    expect(canvas?.type === "canvas" ? canvas.children.every((wrapper) => wrapper.semanticOrder === undefined) : false).toBe(true);
  });

  it("updates date, style, break behavior, and page configuration through undoable commands", () => {
    const store = customStore(document({
      elements: [{ id: "date", type: "date", name: "Date", data: { value: "2026-07-12" } }],
    }));
    store.execute(createSetDateValueCommand({ nodeId: "date", value: "2026-07-19" }));
    store.execute(createSetDatePresentationCommand({ nodeId: "date", format: "dddd, MMMM D, YYYY" }));
    store.execute(createSetElementStyleCommand({ nodeId: "date", style: { align: "center", color: "#123456" } }));
    store.execute(createSetElementBreakPolicyCommand({ nodeId: "date", breakPolicy: "avoid" }));
    store.execute(createSetPageAppearanceCommand({ background: "#fefefe" }));
    store.execute(createSetPageLayoutCommand({ layoutIntent: "foldedBooklet", marginMode: "mirrored", binding: "left" }));

    const date = store.getSnapshot().document.elements[0];
    expect(date?.type === "date" ? date.data.value : undefined).toBe("2026-07-19");
    expect(date?.type === "date" ? date.data.format : undefined).toBe("dddd, MMMM D, YYYY");
    expect(date?.style).toEqual({ align: "center", color: "#123456" });
    expect(date?.breakPolicy).toBe("avoid");
    expect(store.getSnapshot().document.page).toMatchObject({
      background: "#fefefe",
      layoutIntent: "foldedBooklet",
      marginMode: "mirrored",
      binding: "left",
    });
    expect(() => store.execute(createSetDateValueCommand({ nodeId: "date", value: "July 19" }))).toThrow("complete date");
  });

  it("moves a page item through its placement wrapper and restores it on undo", () => {
    const store = customStore(document({
      elements: [],
      pageElements: [{
        id: "header-placement",
        purpose: "decoration",
        target: { mode: "all" },
        layer: "overlay",
        region: "topMargin",
        anchor: "topLeft",
        x: "0in",
        y: "0in",
        width: "auto",
        height: "auto",
        zIndex: 1,
        clipToRegion: false,
        semantic: { mode: "artifact" },
        element: textElement("header", "Header"),
      }, {
        id: "footer-placement",
        purpose: "footer",
        target: { mode: "all" },
        layer: "overlay",
        region: "bottomMargin",
        anchor: "bottomLeft",
        x: "0in",
        y: "0in",
        width: "auto",
        height: "auto",
        zIndex: 1,
        clipToRegion: false,
        semantic: { mode: "artifact" },
        element: textElement("footer", "Footer"),
      }],
    }));
    store.execute(createMovePageElementCommand({ nodeId: "header", x: "0.5in", y: "0.25in" }));
    expect(store.getSnapshot().document.pageElements?.[0]).toMatchObject({ x: "0.5in", y: "0.25in" });
    store.undo();
    expect(store.getSnapshot().document.pageElements?.[0]).toMatchObject({ x: "0in", y: "0in" });
    store.execute(createReorderElementCommand({ nodeId: "header", direction: "after" }));
    expect(store.getSnapshot().document.pageElements?.map((wrapper) => wrapper.element.id)).toEqual(["footer", "header"]);
    store.execute(createSetPageElementLayerCommand({ nodeId: "header", layer: "underlay" }));
    expect(store.getSnapshot().document.pageElements?.[1]?.layer).toBe("underlay");
    store.execute(createDuplicateElementCommand({ nodeId: "header", idPort: makeSequentialIdPort(90) }));
    expect(store.getSnapshot().document.pageElements).toHaveLength(3);
    expect(new Set(store.getSnapshot().document.pageElements?.map((wrapper) => wrapper.id)).size).toBe(3);
  });

  it("updates no-code Scripture, sharing, and Copyrights & Permissions options", () => {
    const store = customStore(document({
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
    }));
    store.execute(createSetDocumentPublicationSettingsCommand({
      scripturePresentation: {
        referencePlacement: "after",
        verseNumberStyle: "inline",
        paragraphPolicy: "oneVerse",
        paragraphSpacing: "8pt",
        translationLabelPlacement: "afterPassage",
      },
      rightsPolicy: { unknownRightsPolicy: "block" },
      publicationContexts: [
        "printedNonsalableChurchBulletin",
        "digitalNonsalableChurchBulletin",
      ],
    }));
    store.execute(createSetRightsAttributionOptionsCommand({
      nodeId: "credits",
      heading: "Credits and permissions",
      groupOrder: ["music", "scripture", "other"],
      sortPolicy: "firstAppearance",
      includePublicDomainLines: true,
    }));
    expect(store.getSnapshot().document).toMatchObject({
      scripturePresentation: {
        referencePlacement: "after",
        verseNumberStyle: "inline",
        paragraphPolicy: "oneVerse",
        paragraphSpacing: "8pt",
        translationLabelPlacement: "afterPassage",
      },
      rightsPolicy: { unknownRightsPolicy: "block" },
      publicationContexts: [
        "printedNonsalableChurchBulletin",
        "digitalNonsalableChurchBulletin",
      ],
      elements: [expect.objectContaining({
        data: expect.objectContaining({
          heading: "Credits and permissions",
          groupOrder: ["music", "scripture", "other"],
          includePublicDomainLines: true,
        }),
      })],
    });
    store.undo();
    const restored = store.getSnapshot().document.elements[0];
    expect(restored?.type === "rightsAttribution"
      ? restored.data.heading
      : undefined).toBe("Copyrights & Permissions");
  });

  it("writes bound date presentation and credits options without retaining competing literals", () => {
    const source = document({
      fieldContract: {
        id: "00000000-0000-4000-8000-000000000060",
        version: 1,
        name: "Presentation options",
        fields: [
          { id: "dateFormat", label: "Date format", type: "text", required: false },
          { id: "creditsHeading", label: "Credits heading", type: "text", required: false },
          { id: "showPublicDomain", label: "Show public domain", type: "boolean", required: false },
        ],
      },
      fieldValues: {
        dateFormat: { value: "MMMM D, YYYY", origin: "imported" },
        creditsHeading: { value: "Copyrights & Permissions", origin: "imported" },
        showPublicDomain: { value: false, origin: "imported" },
      },
      elements: [
        {
          id: "bound-format-date",
          type: "date",
          name: "Bound date format",
          data: {
            value: "2026-07-19",
            format: "MMMM D, YYYY",
            locale: "en-US",
          },
          bindings: [{
            id: "date-format-binding",
            scope: "document",
            fieldId: "dateFormat",
            target: "/data/format",
          }],
        },
        {
          id: "bound-credits",
          type: "rightsAttribution",
          name: "Bound credits",
          data: {
            heading: "Copyrights & Permissions",
            introText: "Retained introduction",
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
        },
      ],
    });
    const store = customStore(source);

    expect(store.execute(createSetDatePresentationCommand({
      nodeId: "bound-format-date",
      format: "dddd, MMMM D, YYYY",
    })).status).toBe("applied");
    expect(store.getSnapshot().document.fieldValues?.["dateFormat"]).toEqual({
      value: "dddd, MMMM D, YYYY",
      origin: "manual",
    });
    const date = findElementLocation(store.getSnapshot().document, "bound-format-date")?.element;
    expect(date?.type === "date" ? date.data : undefined).toEqual({
      value: "2026-07-19",
      locale: "en-US",
    });
    store.undo();
    expect(store.getSnapshot().document).toEqual(source);

    expect(store.execute(createSetRightsAttributionOptionsCommand({
      nodeId: "bound-credits",
      heading: "Credits and permissions",
      groupOrder: ["music", "scripture", "other"],
      sortPolicy: "firstAppearance",
      includePublicDomainLines: true,
    })).status).toBe("applied");
    expect(store.getSnapshot().document.fieldValues).toMatchObject({
      creditsHeading: { value: "Credits and permissions", origin: "manual" },
      showPublicDomain: { value: true, origin: "manual" },
    });
    const credits = findElementLocation(store.getSnapshot().document, "bound-credits")?.element;
    expect(credits?.type === "rightsAttribution" ? credits.data : undefined).toEqual({
      introText: "Retained introduction",
      groupOrder: ["music", "scripture", "other"],
      sortPolicy: "firstAppearance",
    });
    store.undo();
    expect(store.getSnapshot().document).toEqual(source);
  });

  it("adds exactly one configurable Copyrights & Permissions block and forbids duplication", () => {
    const store = customStore(document({ elements: [] }));
    store.execute(createAddRightsAttributionCommand({
      nodeId: "credits",
      destination: { kind: "body", index: 0 },
      heading: "Permissions",
      groupOrder: ["music", "scripture", "other"],
      includePublicDomainLines: false,
    }));
    expect(store.getSnapshot().document.elements[0]).toMatchObject({
      id: "credits",
      type: "rightsAttribution",
      data: {
        heading: "Permissions",
        groupOrder: ["music", "scripture", "other"],
        includePublicDomainLines: false,
      },
    });
    expect(() => store.execute(createAddRightsAttributionCommand({
      nodeId: "other-credits",
      destination: { kind: "body", index: 1 },
    }))).toThrow(/already has Copyrights/u);
    expect(() => store.execute(createDuplicateElementCommand({
      nodeId: "credits",
      idPort: makeSequentialIdPort(500),
    }))).toThrow(/unique/u);
    expect(store.getSnapshot().document.elements).toHaveLength(1);
  });
});
