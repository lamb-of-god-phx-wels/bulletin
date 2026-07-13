import { describe, expect, it } from "vitest";
import type { CbbDocument, RichTextDocument } from "@cbb/core";
import { EditorStore } from "../store/editorStore.js";
import { planDocumentFindReplace } from "./findReplace.js";

function document(): CbbDocument {
  return {
    version: 2,
    kind: "bulletin",
    name: "Find test",
    page: { typstWidth: "8.5in", typstHeight: "11in" },
    fieldContract: {
      id: "weekly-contract",
      version: 1,
      name: "Weekly",
      fields: [
        { id: "greeting", label: "Greeting", type: "text", required: true },
        { id: "computed", label: "Computed note", type: "text", required: true },
      ],
    },
    fieldValues: {
      greeting: { value: "Welcome, welcome", origin: "manual" },
      computed: { value: "Welcome later", origin: "derived" },
    },
    elements: [
      {
        id: "direct",
        type: "text",
        name: "Direct message",
        data: { content: { kind: "plain", text: "Welcome home" } },
      },
      {
        id: "locked",
        type: "text",
        name: "Protected message",
        authoringPolicy: { contentLocked: true },
        data: { content: { kind: "plain", text: "Welcome protected" } },
      },
      {
        id: "bound",
        type: "text",
        name: "Bound greeting",
        bindings: [{ id: "binding", scope: "document", fieldId: "greeting", target: "/data/content/text" }],
        data: { content: { kind: "plain", text: "Welcome fallback" } },
      },
    ],
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
      element: {
        id: "page-number",
        type: "text",
        name: "Page number",
        data: { content: { kind: "plain", text: "Welcome page" } },
      },
    }],
  };
}

function richDocument(text: string): RichTextDocument {
  return {
    type: "document",
    blocks: [{ type: "paragraph", children: [{ type: "text", text }] }],
  };
}

describe("current-document find and replace", () => {
  it("previews editable and skipped matches without double-counting bound fallback text", () => {
    const plan = planDocumentFindReplace(document(), "weeklyContent", {
      query: "welcome",
      replacement: "Hello",
      matchCase: false,
    });
    expect(plan).toMatchObject({
      totalMatches: 6,
      replaceableMatches: 3,
      skippedMatches: 3,
    });
    expect(plan.previews.some((entry) => entry.reason?.includes("protected"))).toBe(true);
    expect(plan.previews.some((entry) => entry.reason?.includes("computed"))).toBe(true);
    expect(plan.previews.some((entry) => entry.reason?.includes("Page numbers"))).toBe(true);
    expect(plan.previews.some((entry) => entry.snippet.includes("fallback"))).toBe(false);
  });

  it("commits every replaceable source as one command and one undo transaction", () => {
    const store = new EditorStore(document());
    const plan = planDocumentFindReplace(store.getSnapshot().document, "weeklyContent", {
      query: "welcome",
      replacement: "Hello",
      matchCase: false,
    });
    if (plan.command === undefined) throw new Error("Expected a replace command");
    expect(store.execute(plan.command).status).toBe("applied");
    expect(store.getSnapshot().document.fieldValues?.["greeting"]?.value).toBe("Hello, Hello");
    const direct = store.getSnapshot().document.elements[0];
    expect(direct?.type === "text" ? direct.data.content : undefined).toEqual({
      kind: "plain",
      text: "Hello home",
    });
    expect(store.getSnapshot()).toMatchObject({ canUndo: true, undoLabel: "Replace 3 matches" });

    store.undo();
    expect(store.getSnapshot().document).toEqual(document());
    expect(store.getSnapshot()).toMatchObject({ canUndo: false, canRedo: true });
  });

  it("replaces a formatted-text binding through its authoritative field value once", () => {
    const stored = richDocument("Welcome from the weekly field");
    const fallback = richDocument("Welcome from the template fallback");
    const value: CbbDocument = {
      version: 2,
      kind: "bulletin",
      name: "Formatted binding",
      page: { typstWidth: "8.5in", typstHeight: "11in" },
      fieldContract: {
        id: "00000000-0000-4000-8000-000000000030",
        version: 1,
        name: "Weekly content",
        fields: [{
          id: "formatted",
          label: "Formatted message",
          type: "richText",
          required: false,
        }],
      },
      fieldValues: {
        formatted: { value: stored, origin: "imported" },
      },
      elements: [{
        id: "formatted-text",
        type: "text",
        name: "Formatted message",
        data: { content: { kind: "richText", document: fallback } },
        bindings: [{
          id: "formatted-binding",
          scope: "document",
          fieldId: "formatted",
          target: "/data/content/document",
        }],
      }],
    };
    const store = new EditorStore(value);
    const plan = planDocumentFindReplace(store.getSnapshot().document, "weeklyContent", {
      query: "Welcome",
      replacement: "Hello",
      matchCase: true,
    });

    expect(plan).toMatchObject({
      totalMatches: 1,
      replaceableMatches: 1,
      skippedMatches: 0,
    });
    if (plan.command === undefined) throw new Error("Expected a replace command");
    expect(store.execute(plan.command).status).toBe("applied");
    expect(store.getSnapshot().document.fieldValues?.["formatted"]).toEqual({
      value: richDocument("Hello from the weekly field"),
      origin: "manual",
    });
    const element = store.getSnapshot().document.elements[0];
    expect(element?.type === "text" ? element.data.content : undefined).toEqual({
      kind: "richText",
    });
    store.undo();
    expect(store.getSnapshot().document).toEqual(value);
  });

  it("materializes a missing document field from its effective text fallback", () => {
    const fallbackDocument: CbbDocument = {
      version: 2,
      kind: "bulletin",
      name: "Missing document field",
      page: { typstWidth: "8.5in", typstHeight: "11in" },
      fieldContract: {
        id: "00000000-0000-4000-8000-000000000031",
        version: 1,
        name: "Weekly content",
        fields: [
          { id: "message", label: "Message", type: "text", required: false },
          { id: "secondMessage", label: "Second message", type: "text", required: false },
        ],
      },
      elements: [
        {
          id: "bound-message",
          type: "text",
          name: "Bound message",
          data: { content: { kind: "plain", text: "Welcome from the source" } },
          bindings: [{
            id: "message-binding",
            scope: "document",
            fieldId: "message",
            target: "/data/content/text",
            fallback: "Welcome from the fallback",
          }],
        },
        {
          id: "second-bound-message",
          type: "text",
          name: "Second bound message",
          data: { content: { kind: "plain", text: "Welcome second source" } },
          bindings: [{
            id: "second-message-binding",
            scope: "document",
            fieldId: "secondMessage",
            target: "/data/content/text",
            fallback: "Welcome from the second fallback",
          }],
        },
      ],
    };
    const store = new EditorStore(fallbackDocument);
    const plan = planDocumentFindReplace(store.getSnapshot().document, "weeklyContent", {
      query: "Welcome",
      replacement: "Hello",
      matchCase: true,
    });

    expect(plan).toMatchObject({
      totalMatches: 2,
      replaceableMatches: 2,
      skippedMatches: 0,
    });
    if (plan.command === undefined) throw new Error("Expected a replace command");
    expect(store.execute(plan.command).status).toBe("applied");
    expect(store.getSnapshot().document.fieldValues).toEqual({
      message: { value: "Hello from the fallback", origin: "manual" },
      secondMessage: { value: "Hello from the second fallback", origin: "manual" },
    });
    expect(store.getSnapshot().document.elements[0]).toMatchObject({
      data: { content: { kind: "plain" } },
    });
    const firstContent = (store.getSnapshot().document.elements[0] as Extract<
      CbbDocument["elements"][number],
      { type: "text" }
    >).data.content;
    expect(firstContent?.kind === "plain" ? firstContent.text : undefined).toBeUndefined();
  });

  it("materializes a missing local field from its source text", () => {
    const sourceDocument: CbbDocument = {
      version: 2,
      kind: "bulletin",
      name: "Missing local field",
      page: { typstWidth: "8.5in", typstHeight: "11in" },
      elements: [{
        id: "local-message",
        type: "text",
        name: "Local message",
        fieldContract: {
          id: "00000000-0000-4000-8000-000000000032",
          version: 1,
          name: "Local content",
          fields: [{ id: "message", label: "Message", type: "text", required: false }],
        },
        data: { content: { kind: "plain", text: "Welcome from the source" } },
        bindings: [{
          id: "local-message-binding",
          scope: "local",
          fieldId: "message",
          target: "/data/content/text",
        }],
      }],
    };
    const store = new EditorStore(sourceDocument);
    const plan = planDocumentFindReplace(store.getSnapshot().document, "weeklyContent", {
      query: "Welcome",
      replacement: "Hello",
      matchCase: true,
    });

    expect(plan).toMatchObject({
      totalMatches: 1,
      replaceableMatches: 1,
      skippedMatches: 0,
    });
    if (plan.command === undefined) throw new Error("Expected a replace command");
    expect(store.execute(plan.command).status).toBe("applied");
    const element = store.getSnapshot().document.elements[0];
    expect(element?.fieldValues).toEqual({
      message: { value: "Hello from the source", origin: "manual" },
    });
    expect(element?.type === "text" ? element.data.content : undefined).toEqual({
      kind: "plain",
    });
    store.undo();
    expect(store.getSnapshot().document).toEqual(sourceDocument);
  });

  it("updates semantic metadata and removes an edited bound legacy literal atomically", () => {
    const source: CbbDocument = {
      version: 2,
      kind: "bulletin",
      name: "Service label replacement",
      page: { typstWidth: "8.5in", typstHeight: "11in" },
      metadata: { serviceLabel: "Sunday Welcome" },
      fieldContract: {
        id: "00000000-0000-4000-8000-000000000033",
        version: 1,
        name: "Weekly content",
        fields: [{
          id: "serviceName",
          label: "Service name",
          type: "text",
          required: true,
          semanticRole: "serviceLabel",
        }],
      },
      fieldValues: {
        serviceName: { value: "Sunday Welcome", origin: "imported" },
      },
      elements: [{
        id: "service-name",
        type: "text",
        name: "Service name",
        data: { content: { kind: "plain", text: "Legacy competing copy" } },
        bindings: [{
          id: "service-name-binding",
          scope: "document",
          fieldId: "serviceName",
          target: "/data/content/text",
        }],
      }],
    };
    const store = new EditorStore(source);
    const plan = planDocumentFindReplace(store.getSnapshot().document, "weeklyContent", {
      query: "Welcome",
      replacement: "Worship",
      matchCase: true,
    });
    if (plan.command === undefined) throw new Error("Expected a replace command");

    expect(store.execute(plan.command).status).toBe("applied");
    expect(store.getSnapshot().document.fieldValues?.["serviceName"]).toEqual({
      value: "Sunday Worship",
      origin: "manual",
    });
    expect(store.getSnapshot().document.metadata?.serviceLabel).toBe("Sunday Worship");
    const element = store.getSnapshot().document.elements[0];
    const content = element?.type === "text" ? element.data.content : undefined;
    expect(content?.kind === "plain" ? content.text : undefined).toBeUndefined();

    store.undo();
    expect(store.getSnapshot().document).toEqual(source);
  });

  it("finds but cannot replace in read-only workspaces", () => {
    const plan = planDocumentFindReplace(document(), "weeklyContent", {
      query: "Welcome",
      replacement: "Hello",
      matchCase: true,
    }, true);
    expect(plan.totalMatches).toBeGreaterThan(0);
    expect(plan.replaceableMatches).toBe(0);
    expect(plan.command).toBeUndefined();
    expect(plan.previews.every((entry) => !entry.replaceable)).toBe(true);
  });
});
