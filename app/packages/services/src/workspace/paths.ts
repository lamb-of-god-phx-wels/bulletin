import { basename, dirname, isAbsolute, posix, relative, resolve, sep } from "node:path";
import type { LocalResourceId } from "@cbb/core";
import type { DurableFileSystemPort } from "../ports/index.js";
import type { WorkspaceResourceKind } from "./types.js";

export const WORKSPACE_REGISTRY_PATH = "workspace.json";
export const WORKSPACE_SETTINGS_PATH = "settings.json";
export const CHURCH_PROFILE_PATH = "church-profile.json";
export const WORKSPACE_LOCK_PATH = ".workspace.lock";
export const WORKSPACE_LOCK_HEARTBEAT_PATH = ".workspace.lock.heartbeat";
export const SAVE_JOURNAL_DIRECTORY = "transactions/save";
export const MULTI_TRANSACTION_JOURNAL_DIRECTORY = "transactions/multi";
export const MULTI_TRANSACTION_PAYLOAD_DIRECTORY = "transactions/staging";
export const TRANSACTION_QUARANTINE_DIRECTORY = "transactions/quarantine";
export const ARTIFACT_INSTALL_JOURNAL_DIRECTORY = "transactions/artifacts";
export const CONFLICT_DIRECTORY = "conflicts";

export const WORKSPACE_DIRECTORIES = [
  "bulletins",
  "templates",
  "saved-sections",
  "weekly-work",
  "assets",
  "fonts",
  "songs",
  "scripture-catalog",
  "resource-packs",
  "pack-drafts",
  "shared-libraries",
  "scripture-providers",
  "artifacts",
  "preview",
  "ai-exchange",
  "history",
  "trash",
  "transactions",
  SAVE_JOURNAL_DIRECTORY,
  "transactions/recovery",
  MULTI_TRANSACTION_JOURNAL_DIRECTORY,
  MULTI_TRANSACTION_PAYLOAD_DIRECTORY,
  TRANSACTION_QUARANTINE_DIRECTORY,
  ARTIFACT_INSTALL_JOURNAL_DIRECTORY,
  CONFLICT_DIRECTORY,
] as const;

export function canonicalDocumentPath(
  kind: WorkspaceResourceKind,
  localId: LocalResourceId,
): string {
  return kind === "bulletin"
    ? `bulletins/${localId}/document.json`
    : `templates/${localId}/template.json`;
}

export function assertSafeRelativePath(value: string): string {
  if (
    value.length === 0 ||
    value.includes("\0") ||
    value.includes("\\") ||
    isAbsolute(value) ||
    posix.isAbsolute(value) ||
    posix.normalize(value) !== value ||
    value === ".." ||
    value.startsWith("../")
  ) {
    throw new Error(`Unsafe workspace-relative path: ${JSON.stringify(value)}`);
  }
  return value;
}

export function resolveWorkspacePath(root: string, relativePath: string): string {
  assertSafeRelativePath(relativePath);
  const canonicalRoot = resolve(root);
  const candidate = resolve(canonicalRoot, ...relativePath.split("/"));
  const fromRoot = relative(canonicalRoot, candidate);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`Workspace path escapes root: ${JSON.stringify(relativePath)}`);
  }
  return candidate;
}

/** Reject any existing symlink between the workspace root and a managed path. */
export async function assertManagedPathHasNoSymlink(
  fileSystem: DurableFileSystemPort,
  root: string,
  relativePath: string,
): Promise<void> {
  const safe = assertSafeRelativePath(relativePath);
  let current = resolve(root);
  for (const segment of safe.split("/")) {
    current = resolve(current, segment);
    const info = await fileSystem.entryInfo(current);
    if (info?.kind === "symbolicLink") {
      throw new Error(`Managed workspace path contains a symbolic link: ${safe}`);
    }
    if (info === undefined) return;
  }
}

export function workspaceCreationTarget(root: string): {
  readonly parent: string;
  readonly target: string;
  readonly name: string;
} {
  const target = resolve(root);
  const name = basename(target);
  if (name.length === 0 || target === dirname(target)) {
    throw new Error("A workspace cannot use a filesystem root as its directory");
  }
  return { parent: dirname(target), target, name };
}
