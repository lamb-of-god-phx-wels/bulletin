import type { NodeId } from "@cbb/core";

export type EditorPaletteKind =
  | "text"
  | "image"
  | "date"
  | "music"
  | "stack"
  | "grid"
  | "canvas"
  | "pageBreak"
  | "rightsAttribution";

export type EditorDragSource =
  | { readonly kind: "palette"; readonly elementKind: EditorPaletteKind }
  | { readonly kind: "node"; readonly nodeId: NodeId };

export const EDITOR_DRAG_MIME = "application/x-cbb-structure-item";

let activeSource: EditorDragSource | undefined;
const listeners = new Set<() => void>();

export function activeEditorDragSource(): EditorDragSource | undefined {
  return activeSource;
}

export function subscribeEditorDrag(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setActiveEditorDragSource(source: EditorDragSource | undefined): void {
  activeSource = source;
  for (const listener of listeners) listener();
}

export function writeEditorDragSource(dataTransfer: DataTransfer, source: EditorDragSource): void {
  dataTransfer.effectAllowed = source.kind === "palette" ? "copy" : "move";
  dataTransfer.setData(EDITOR_DRAG_MIME, JSON.stringify(source));
  setActiveEditorDragSource(source);
}

export function readEditorDragSource(dataTransfer: DataTransfer): EditorDragSource | undefined {
  if (activeSource !== undefined) return activeSource;
  const encoded = dataTransfer.getData(EDITOR_DRAG_MIME);
  if (encoded.length === 0) return undefined;
  try {
    const value = JSON.parse(encoded) as Partial<EditorDragSource>;
    if (value.kind === "node" && typeof value.nodeId === "string") {
      return { kind: "node", nodeId: value.nodeId };
    }
    if (
      value.kind === "palette" &&
      (value.elementKind === "text" ||
        value.elementKind === "image" ||
        value.elementKind === "date" ||
        value.elementKind === "music" ||
        value.elementKind === "stack" ||
        value.elementKind === "grid" ||
        value.elementKind === "canvas" ||
        value.elementKind === "pageBreak" ||
        value.elementKind === "rightsAttribution")
    ) {
      return { kind: "palette", elementKind: value.elementKind };
    }
  } catch {
    return undefined;
  }
  return undefined;
}
