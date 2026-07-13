import { describe, expect, it, vi } from "vitest";
import type { CbbDocument } from "@cbb/core";
import { EditorCommandDefinitionError, EditorStore } from "./editorStore.js";
import { DocumentPatchError } from "./patches.js";
import type {
  DocumentPatch,
  EditorCommand,
  EditorSelection,
} from "./types.js";
import { bulletin, textElement } from "./testFixtures.js";

function contentCommand(input: {
  id?: string;
  label?: string;
  patches:
    | readonly DocumentPatch[]
    | EditorCommand["createPatches"];
  targetNodeId?: string;
  historyGroup?: string;
  selectAfter?: EditorSelection;
}): EditorCommand {
  return {
    id: input.id ?? "edit-content",
    label: input.label ?? "Edit content",
    capabilities: [
      {
        capability: "content.edit",
        ...(input.targetNodeId === undefined
          ? {}
          : {
              target: {
                kind: "node" as const,
                nodeId: input.targetNodeId,
              },
            }),
      },
    ],
    createPatches: input.patches,
    ...(input.historyGroup === undefined
      ? {}
      : { historyGroup: input.historyGroup }),
    ...(input.selectAfter === undefined
      ? {}
      : { selectAfter: input.selectAfter }),
  };
}

function rename(value: string, historyGroup?: string): EditorCommand {
  return contentCommand({
    id: "rename",
    label: "Rename bulletin",
    patches: [{ op: "replace", path: "/name", value }],
    ...(historyGroup === undefined ? {} : { historyGroup }),
  });
}

describe("EditorStore", () => {
  it("owns a deeply immutable clone and defaults bulletins to Weekly Content", () => {
    const source = bulletin();
    const store = new EditorStore(source);
    const snapshot = store.getSnapshot();

    expect(snapshot.mode).toBe("weeklyContent");
    expect(snapshot.selection).toEqual({ kind: "document" });
    expect(snapshot.document).not.toBe(source);
    expect(Object.isFrozen(snapshot.document)).toBe(true);
    expect(Object.isFrozen(snapshot.document.elements[0])).toBe(true);
    expect(Object.isFrozen(source)).toBe(false);
  });

  it("opens templates in Customize Layout unless explicitly overridden", () => {
    const template: CbbDocument = bulletin({ kind: "template" });
    expect(new EditorStore(template).getSnapshot().mode).toBe("customizeLayout");
    expect(
      new EditorStore(template, { initialMode: "weeklyContent" }).getSnapshot().mode,
    ).toBe("weeklyContent");
  });

  it("rejects every document mutation in a read-only store while retaining selection", () => {
    const store = new EditorStore(bulletin(), { readOnly: true });
    const changes = vi.fn();
    store.subscribeToDocumentChanges(changes);
    expect(store.canExecute(rename("Unsafe"))).toMatchObject({
      allowed: false,
      code: "readOnly",
    });
    expect(store.execute(rename("Unsafe"))).toMatchObject({
      status: "denied",
      denial: { code: "readOnly" },
    });
    store.setMode("customizeLayout");
    expect(store.getSnapshot()).toMatchObject({
      document: { name: "Sunday Bulletin" },
      mode: "weeklyContent",
      documentRevision: 0,
    });
    expect(changes).not.toHaveBeenCalled();
  });

  it("executes dynamic immutable commands and publishes patch events", () => {
    const store = new EditorStore(bulletin());
    const stateListener = vi.fn();
    const changes = vi.fn();
    store.subscribe(stateListener);
    store.subscribeToDocumentChanges(changes);

    const command = contentCommand({
      patches: ({ document }) => [
        {
          op: "replace",
          path: "/name",
          value: `${document.name} — revised`,
        },
      ],
    });
    const result = store.execute(command);

    expect(result.status).toBe("applied");
    expect(store.getSnapshot()).toMatchObject({
      document: { name: "Sunday Bulletin — revised" },
      documentRevision: 1,
      canUndo: true,
      canRedo: false,
      undoLabel: "Edit content",
    });
    expect(stateListener).toHaveBeenCalledOnce();
    expect(changes).toHaveBeenCalledOnce();
    expect(changes.mock.calls[0]?.[0]).toMatchObject({
      kind: "execute",
      patches: [
        {
          op: "replace",
          path: "/name",
          value: "Sunday Bulletin — revised",
        },
      ],
      inversePatches: [
        { op: "replace", path: "/name", value: "Sunday Bulletin" },
      ],
      documentRevision: 1,
    });
  });

  it("undoes and redoes exact JSON while restoring relevant selections", () => {
    const store = new EditorStore(bulletin(), {
      initialSelection: { kind: "node", nodeId: "heading", surface: "editor" },
    });
    const changes: string[] = [];
    store.subscribeToDocumentChanges((event) => changes.push(event.kind));

    store.execute(
      contentCommand({
        id: "delete-heading",
        label: "Delete heading",
        targetNodeId: "heading",
        patches: [{ op: "remove", path: "/elements/0" }],
        selectAfter: { kind: "node", nodeId: "body", surface: "structure" },
      }),
    );
    expect(store.getSnapshot().document.elements.map((item) => item.id)).toEqual([
      "body",
    ]);
    expect(store.getSnapshot().selection).toEqual({
      kind: "node",
      nodeId: "body",
      surface: "structure",
    });

    const undoEvent = store.undo();
    expect(undoEvent?.kind).toBe("undo");
    expect(store.getSnapshot().document.elements.map((item) => item.id)).toEqual([
      "heading",
      "body",
    ]);
    expect(store.getSnapshot().selection).toEqual({
      kind: "node",
      nodeId: "heading",
      surface: "editor",
    });
    expect(store.getSnapshot()).toMatchObject({ canUndo: false, canRedo: true });

    const redoEvent = store.redo();
    expect(redoEvent?.kind).toBe("redo");
    expect(store.getSnapshot().document.elements.map((item) => item.id)).toEqual([
      "body",
    ]);
    expect(store.getSnapshot().selection).toEqual({
      kind: "node",
      nodeId: "body",
      surface: "structure",
    });
    expect(changes).toEqual(["execute", "undo", "redo"]);
  });

  it("coalesces adjacent commands with one continuous-edit token", () => {
    const store = new EditorStore(bulletin());
    store.execute(rename("S", "document-name-session-1"));
    store.execute(rename("Su", "document-name-session-1"));
    store.execute(rename("Sun", "document-name-session-1"));

    expect(store.getSnapshot().document.name).toBe("Sun");
    store.undo();
    expect(store.getSnapshot().document.name).toBe("Sunday Bulletin");
    expect(store.getSnapshot()).toMatchObject({ canUndo: false, canRedo: true });
    store.redo();
    expect(store.getSnapshot().document.name).toBe("Sun");
  });

  it("keeps grouping inverses correct when one field is changed repeatedly", () => {
    const store = new EditorStore(bulletin());
    store.execute(
      contentCommand({
        patches: [
          { op: "replace", path: "/name", value: "One" },
          { op: "add", path: "/metadata", value: { title: "One" } },
        ],
        historyGroup: "session",
      }),
    );
    store.execute(
      contentCommand({
        patches: [
          { op: "replace", path: "/name", value: "Two" },
          { op: "replace", path: "/metadata/title", value: "Two" },
        ],
        historyGroup: "session",
      }),
    );
    store.undo();
    expect(store.getSnapshot().document).toEqual(bulletin());
    store.redo();
    expect(store.getSnapshot().document).toMatchObject({
      name: "Two",
      metadata: { title: "Two" },
    });
  });

  it("ends a history group on focus selection, mode, undo, or explicit boundary", () => {
    const store = new EditorStore(bulletin());
    store.execute(rename("First", "same-key"));
    store.setSelection({ kind: "node", nodeId: "heading" });
    store.execute(rename("Second", "same-key"));
    store.setMode("customizeLayout");
    store.execute(rename("Third", "same-key"));
    store.breakHistoryGroup();
    store.execute(rename("Fourth", "same-key"));

    store.undo();
    expect(store.getSnapshot().document.name).toBe("Third");
    store.undo();
    expect(store.getSnapshot().document.name).toBe("Second");
    store.undo();
    expect(store.getSnapshot().document.name).toBe("First");
    store.undo();
    expect(store.getSnapshot().document.name).toBe("Sunday Bulletin");

    store.redo();
    store.execute(rename("New branch", "same-key"));
    store.undo();
    expect(store.getSnapshot().document.name).toBe("First");
  });

  it("clears redo only when a new undoable action is actually applied", () => {
    const store = new EditorStore(bulletin());
    store.execute(rename("First"));
    store.execute(rename("Second"));
    store.undo();
    expect(store.getSnapshot().canRedo).toBe(true);

    expect(store.execute(rename("First"))).toEqual({ status: "noChange" });
    expect(store.getSnapshot().canRedo).toBe(true);

    store.execute(rename("Branch"));
    expect(store.getSnapshot().canRedo).toBe(false);
    expect(store.redo()).toBeUndefined();
  });

  it("does not create history or document events for mode and selection state", () => {
    const store = new EditorStore(bulletin());
    const states = vi.fn();
    const changes = vi.fn();
    store.subscribe(states);
    store.subscribeToDocumentChanges(changes);

    const documentBefore = store.getSnapshot().document;
    store.setMode("customizeLayout");
    store.setSelection({ kind: "node", nodeId: "heading" });

    expect(store.getSnapshot()).toMatchObject({
      mode: "customizeLayout",
      selection: { kind: "node", nodeId: "heading" },
      documentRevision: 0,
      canUndo: false,
      canRedo: false,
    });
    expect(store.getSnapshot().document).toBe(documentBefore);
    expect(states).toHaveBeenCalledTimes(2);
    expect(changes).not.toHaveBeenCalled();
  });

  it("uses one capability gate for controls and execution", () => {
    const store = new EditorStore(
      bulletin({ authoringPolicy: { contentLocked: true } }),
    );
    const changes = vi.fn();
    store.subscribeToDocumentChanges(changes);
    const command = rename("Forbidden");

    expect(store.canExecute(command)).toMatchObject({
      allowed: false,
      code: "contentLocked",
    });
    expect(store.execute(command)).toMatchObject({
      status: "denied",
      denial: { code: "contentLocked" },
    });
    expect(store.getSnapshot()).toMatchObject({
      document: { name: "Sunday Bulletin" },
      documentRevision: 0,
      canUndo: false,
    });
    expect(changes).not.toHaveBeenCalled();
  });

  it("rejects document commands that omit their capability declaration", () => {
    const store = new EditorStore(bulletin());
    const command: EditorCommand = {
      id: "unguarded",
      label: "Unguarded edit",
      capabilities: [],
      createPatches: [{ op: "replace", path: "/name", value: "Unsafe" }],
    };
    expect(() => store.canExecute(command)).toThrow(EditorCommandDefinitionError);
    expect(() => store.execute(command)).toThrow(
      "must declare at least one capability",
    );
    expect(store.getSnapshot().document.name).toBe("Sunday Bulletin");
  });

  it("supports dynamic multi-target capability requirements", () => {
    const store = new EditorStore(
      bulletin({
        elements: [
          textElement("source"),
          textElement("target", "Target", {
            authoringPolicy: { layoutLocked: true },
          }),
        ],
      }),
      { initialMode: "customizeLayout" },
    );
    const move: EditorCommand = {
      id: "move",
      label: "Move item",
      capabilities: ({ document }) =>
        document.elements.map((element) => ({
          capability: "layout.editPlacement" as const,
          target: { kind: "node" as const, nodeId: element.id },
        })),
      createPatches: [
        { op: "replace", path: "/elements/0/name", value: "Moved" },
      ],
    };

    expect(store.execute(move)).toMatchObject({
      status: "denied",
      denial: {
        code: "layoutLocked",
        requirement: { target: { nodeId: "target" } },
      },
    });
  });

  it("is atomic when a patch or selection callback fails", () => {
    const store = new EditorStore(bulletin());
    const before = store.getSnapshot();
    expect(() =>
      store.execute(
        contentCommand({
          patches: [{ op: "replace", path: "/missing/value", value: 1 }],
        }),
      ),
    ).toThrow(DocumentPatchError);
    expect(store.getSnapshot()).toBe(before);

    const badSelection: EditorCommand = {
      ...rename("Would not commit"),
      selectAfter: () => {
        throw new Error("selection failed");
      },
    };
    expect(() => store.execute(badSelection)).toThrow("selection failed");
    expect(store.getSnapshot()).toBe(before);
  });

  it("falls back to document selection when selected nodes disappear", () => {
    const store = new EditorStore(bulletin(), {
      initialSelection: { kind: "node", nodeId: "heading" },
    });
    store.execute(
      contentCommand({
        targetNodeId: "heading",
        patches: [{ op: "remove", path: "/elements/0" }],
        selectAfter: { kind: "node", nodeId: "also-missing" },
      }),
    );
    expect(store.getSnapshot().selection).toEqual({ kind: "document" });
  });

  it("rejects invalid initial selection and supports unsubscribe", () => {
    const store = new EditorStore(bulletin(), {
      initialSelection: { kind: "node", nodeId: "missing" },
    });
    expect(store.getSnapshot().selection).toEqual({ kind: "document" });

    const stateListener = vi.fn();
    const changeListener = vi.fn();
    const unsubscribeState = store.subscribe(stateListener);
    const unsubscribeChanges = store.subscribeToDocumentChanges(changeListener);
    unsubscribeState();
    unsubscribeChanges();
    store.execute(rename("Changed"));
    expect(stateListener).not.toHaveBeenCalled();
    expect(changeListener).not.toHaveBeenCalled();
  });

  it("validates owner-scoped field selections against that owner's contract", () => {
    const document = bulletin({
      elements: [
        textElement("local-fields", "Welcome", {
          fieldContract: {
            id: "00000000-0000-4000-8000-000000000001",
            version: 1,
            name: "Local fields",
            fields: [
              {
                id: "greeting",
                label: "Greeting",
                type: "text",
                required: false,
              },
            ],
          },
          fieldValues: {
            greeting: { value: "Welcome", origin: "manual" },
          },
        }),
      ],
    });
    const store = new EditorStore(document, {
      initialSelection: {
        kind: "field",
        ownerNodeId: "local-fields",
        fieldId: "greeting",
      },
    });
    expect(store.getSnapshot().selection).toMatchObject({
      kind: "field",
      fieldId: "greeting",
    });

    store.setSelection({
      kind: "field",
      ownerNodeId: "local-fields",
      fieldId: "phantom",
    });
    expect(store.getSnapshot().selection).toEqual({ kind: "document" });

    const invalid = new EditorStore(document, {
      initialSelection: {
        kind: "field",
        ownerNodeId: "heading-that-does-not-exist",
        fieldId: "greeting",
      },
    });
    expect(invalid.getSnapshot().selection).toEqual({ kind: "document" });
  });

  it("isolates subscriber failures so autosave and later listeners still run", () => {
    const failures: { channel: string; error: unknown }[] = [];
    const store = new EditorStore(bulletin(), {
      onSubscriberError: (failure) => failures.push(failure),
    });
    const stateAfterFailure = vi.fn();
    const changeAfterFailure = vi.fn();
    store.subscribeToDocumentChanges(() => {
      throw new Error("broken autosave observer");
    });
    store.subscribeToDocumentChanges(changeAfterFailure);
    store.subscribe(() => {
      throw new Error("broken state observer");
    });
    store.subscribe(stateAfterFailure);

    expect(() => store.execute(rename("Committed"))).not.toThrow();
    expect(store.getSnapshot().document.name).toBe("Committed");
    expect(changeAfterFailure).toHaveBeenCalledOnce();
    expect(stateAfterFailure).toHaveBeenCalledOnce();
    expect(failures.map((failure) => failure.channel)).toEqual([
      "documentChange",
      "state",
    ]);
  });

  it("queues reentrant publications without overtaking document-change events", () => {
    const store = new EditorStore(bulletin());
    const order: string[] = [];
    let nested = false;
    store.subscribeToDocumentChanges((event) => {
      order.push(`document:${event.documentRevision}`);
    });
    store.subscribe(() => {
      const revision = store.getSnapshot().documentRevision;
      order.push(`state:${revision}`);
      if (!nested) {
        nested = true;
        store.execute(rename("Nested"));
      }
    });

    store.execute(rename("First"));
    expect(order).toEqual([
      "document:1",
      "state:1",
      "document:2",
      "state:2",
    ]);
    expect(store.getSnapshot()).toMatchObject({
      document: { name: "Nested" },
      documentRevision: 2,
    });
  });

  it("runs an injected structural validator atomically before commit", () => {
    const validateDocument = vi.fn((document: CbbDocument) => {
      if (document.name === "Rejected by schema") {
        throw new Error("schema rejected document");
      }
    });
    const store = new EditorStore(bulletin(), { validateDocument });
    const before = store.getSnapshot();

    expect(() => store.execute(rename("Rejected by schema"))).toThrow(
      "schema rejected document",
    );
    expect(store.getSnapshot()).toBe(before);
    expect(validateDocument).toHaveBeenCalledTimes(2);
  });

  it("keeps committed snapshots stable for useSyncExternalStore consumers", () => {
    const store = new EditorStore(bulletin());
    const initial = store.getSnapshot();
    expect(store.getSnapshot()).toBe(initial);

    store.setMode("weeklyContent");
    expect(store.getSnapshot()).toBe(initial);
    store.execute(rename("Changed"));
    const changed = store.getSnapshot();
    expect(changed).not.toBe(initial);
    expect(store.getSnapshot()).toBe(changed);
  });
});
