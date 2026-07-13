import { useState, useSyncExternalStore, type DragEvent } from "react";
import {
  collectAllNodeIds,
  type CbbDocument,
  type IdPort,
  type NativeElement,
  type NodeId,
} from "@cbb/core";
import {
  createAddElementCommand,
  createAddRightsAttributionCommand,
  createMoveElementCommand,
  findElementLocation,
} from "../store/commands/index.js";
import type { EditorStore } from "../store/editorStore.js";
import type { EditorCommand, EditorMode } from "../store/types.js";
import { defaultMusicElement } from "./defaultMusicElement.js";
import {
  activeEditorDragSource,
  readEditorDragSource,
  setActiveEditorDragSource,
  subscribeEditorDrag,
  type EditorDragSource,
  type EditorPaletteKind,
} from "./editorDrag.js";

interface PreparedDrop {
  readonly valid: boolean;
  readonly message: string;
  readonly command?: EditorCommand;
  readonly name?: string;
}

function mintNodeId(idPort: IdPort, document: CbbDocument): NodeId {
  const used = collectAllNodeIds(document);
  for (;;) {
    const candidate = `n${idPort.randomUuid().replaceAll("-", "")}`;
    if (!used.has(candidate)) return candidate;
  }
}

function unusedPreviewId(document: CbbDocument): NodeId {
  const used = collectAllNodeIds(document);
  let candidate = "n_cbb_editor_drag_preview";
  let suffix = 1;
  while (used.has(candidate)) candidate = `n_cbb_editor_drag_preview_${suffix++}`;
  return candidate;
}

function defaultElement(kind: EditorPaletteKind, id: NodeId): NativeElement {
  switch (kind) {
    case "text":
      return { id, type: "text", name: "New text", data: { content: { kind: "plain", text: "Type here" } } };
    case "image":
      throw new Error("Choose an installed image from the Image button before adding it.");
    case "date": {
      const now = new Date();
      const value = [
        String(now.getFullYear()).padStart(4, "0"),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
      ].join("-");
      return { id, type: "date", name: "Service date", data: { value, format: "MMMM D, YYYY" } };
    }
    case "music":
      return defaultMusicElement(id);
    case "stack":
      return { id, type: "stack", name: "New section", data: { direction: "vertical", gap: "8pt" }, children: [] };
    case "grid":
      return { id, type: "grid", name: "Two-column section", data: { rows: 1, columns: 2 }, children: [] };
    case "canvas":
      return { id, type: "canvas", name: "Free layout", children: [] };
    case "pageBreak":
      return { id, type: "pageBreak", name: "Page break", data: { intent: "flowBreak" } };
    case "rightsAttribution":
      return {
        id,
        type: "rightsAttribution",
        name: "Copyrights & Permissions",
        data: {
          heading: "Copyrights & Permissions",
          groupOrder: ["scripture", "music", "other"],
          sortPolicy: "firstAppearance",
          includePublicDomainLines: true,
        },
      };
  }
}

export function EditorFlowDropZone({
  document,
  store,
  mode,
  idPort,
  targetIndex,
  label,
  edge,
  onAnnouncement,
}: {
  readonly document: CbbDocument;
  readonly store: EditorStore;
  readonly mode: EditorMode;
  readonly idPort: IdPort;
  readonly targetIndex: number;
  readonly label: string;
  readonly edge: "before" | "after";
  readonly onAnnouncement?: ((message: string) => void) | undefined;
}) {
  const source = useSyncExternalStore(
    subscribeEditorDrag,
    activeEditorDragSource,
    activeEditorDragSource,
  );
  const [hovered, setHovered] = useState(false);

  function prepare(candidate: EditorDragSource, actualIds: boolean): PreparedDrop {
    try {
      const element = candidate.kind === "palette"
        ? defaultElement(
            candidate.elementKind,
            actualIds ? mintNodeId(idPort, document) : unusedPreviewId(document),
          )
        : findElementLocation(document, candidate.nodeId)?.element;
      if (element === undefined) return { valid: false, message: "That item is no longer in the bulletin." };
      const sourceLocation = candidate.kind === "node"
        ? findElementLocation(document, candidate.nodeId)
        : undefined;
      if (sourceLocation?.parent.kind === "page") {
        return { valid: false, message: "Page items stay in Page items; change their layer or order instead." };
      }
      let index = Math.max(0, Math.min(targetIndex, document.elements.length));
      if (sourceLocation?.parent.kind === "body" && sourceLocation.parent.index < index) index--;
      const command = candidate.kind === "palette"
        ? element.type === "rightsAttribution"
          ? createAddRightsAttributionCommand({
              nodeId: element.id,
              destination: { kind: "body", index },
              heading: element.data.heading ?? "Copyrights & Permissions",
              groupOrder: element.data.groupOrder,
              includePublicDomainLines: element.data.includePublicDomainLines ?? true,
            })
          : createAddElementCommand({ element, destination: { kind: "body", index } })
        : createMoveElementCommand({ nodeId: candidate.nodeId, destination: { kind: "body", index } });
      const decision = store.canExecute(command);
      if (!decision.allowed) return { valid: false, message: decision.reason };
      if (typeof command.createPatches === "function") {
        command.createPatches({ document, mode, selection: store.getSnapshot().selection });
      }
      return { valid: true, message: label, command, name: element.name };
    } catch (error) {
      return {
        valid: false,
        message: error instanceof Error ? error.message : "That item cannot be dropped here.",
      };
    }
  }

  const preview = source === undefined ? undefined : prepare(source, false);

  function update(event: DragEvent<HTMLDivElement>): EditorDragSource | undefined {
    const candidate = readEditorDragSource(event.dataTransfer);
    if (candidate === undefined) return undefined;
    event.preventDefault();
    event.stopPropagation();
    setHovered(true);
    const result = prepare(candidate, false);
    event.dataTransfer.dropEffect = result.valid
      ? candidate.kind === "palette" ? "copy" : "move"
      : "none";
    return candidate;
  }

  return (
    <div
      className={[
        "cbb-editor-drop-zone",
        `cbb-editor-drop-zone--${edge}`,
        source === undefined ? "" : "is-dragging",
        preview?.valid === true ? "is-available" : "",
        preview?.valid === false ? "is-unavailable" : "",
        hovered ? "is-hovered" : "",
      ].filter(Boolean).join(" ")}
      aria-hidden="true"
      data-drop-valid={preview === undefined ? undefined : String(preview.valid)}
      onDragEnter={update}
      onDragOver={update}
      onDragLeave={(event) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        setHovered(false);
      }}
      onDrop={(event) => {
        const candidate = update(event);
        if (candidate === undefined) return;
        const prepared = prepare(candidate, true);
        if (prepared.command === undefined || prepared.name === undefined) {
          onAnnouncement?.(prepared.message);
        } else {
          const result = store.execute(prepared.command);
          onAnnouncement?.(result.status === "denied"
            ? result.denial.reason
            : result.status === "noChange"
              ? `${prepared.name} is already there.`
              : `${prepared.name} ${candidate.kind === "palette" ? "added" : "moved"}.`);
        }
        setHovered(false);
        setActiveEditorDragSource(undefined);
      }}
    >
      {hovered ? preview?.message : label}
    </div>
  );
}
