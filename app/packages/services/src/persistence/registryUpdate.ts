import type { LocalResourceId } from "@cbb/core";
import type {
  LocalResourceRecord,
  WorkspaceRegistry,
  WorkspaceResourceKind,
} from "../workspace/index.js";

function listFor(
  registry: WorkspaceRegistry,
  kind: WorkspaceResourceKind,
): readonly LocalResourceRecord[] {
  return (kind === "bulletin" ? registry.bulletins : registry.templates) ?? [];
}

export function findResource(
  registry: WorkspaceRegistry,
  kind: WorkspaceResourceKind,
  localId: LocalResourceId,
): LocalResourceRecord | undefined {
  return listFor(registry, kind).find((record) => record.localId === localId);
}

export function replaceResource(
  registry: WorkspaceRegistry,
  kind: WorkspaceResourceKind,
  localId: LocalResourceId,
  replacement: LocalResourceRecord | null,
): WorkspaceRegistry {
  const records = listFor(registry, kind);
  const existing = records.findIndex((record) => record.localId === localId);
  const next = [...records];
  if (replacement === null) {
    if (existing >= 0) next.splice(existing, 1);
  } else if (existing >= 0) {
    next[existing] = replacement;
  } else {
    next.push(replacement);
  }
  return kind === "bulletin"
    ? { ...registry, bulletins: next }
    : { ...registry, templates: next };
}
