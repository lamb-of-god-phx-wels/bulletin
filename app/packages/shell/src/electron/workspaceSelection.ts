import { randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { canonicalStringify } from "@cbb/core";
import { createNodeFileSystemPort, decodeCanonicalJson, type DurableFileSystemPort } from "@cbb/services";

const MAX_SELECTION_BYTES = 16 * 1024;
const MAX_WORKSPACE_ROOT_CODE_POINTS = 4_096;
const UNSAFE_PATH_TEXT = /[\u0000-\u001f\u007f-\u009f]/u;

interface WorkspaceSelectionFile {
  readonly version: 1;
  readonly kind: "workspaceSelection";
  readonly workspaceRoot: string;
}

function workspaceRoot(value: unknown): string {
  if (typeof value !== "string" || !isAbsolute(value) || value !== resolve(value) ||
    [...value].length > MAX_WORKSPACE_ROOT_CODE_POINTS || UNSAFE_PATH_TEXT.test(value)) {
    throw new Error("The saved bulletin-library location is invalid.");
  }
  return value;
}

function parseSelection(value: unknown): WorkspaceSelectionFile {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
    Object.keys(value).sort().join("\0") !== ["kind", "version", "workspaceRoot"].sort().join("\0")) {
    throw new Error("The saved bulletin-library location is invalid.");
  }
  const record = value as Record<string, unknown>;
  if (record["version"] !== 1 || record["kind"] !== "workspaceSelection") {
    throw new Error("The saved bulletin-library location is invalid.");
  }
  return {
    version: 1,
    kind: "workspaceSelection",
    workspaceRoot: workspaceRoot(record["workspaceRoot"]),
  };
}

/** Durable host-only storage for the one selected first-launch workspace. */
export class NodeM4WorkspaceSelection {
  private readonly fileSystem: DurableFileSystemPort;
  private readonly selectionPath: string;

  constructor(selectionPath: string, fileSystem: DurableFileSystemPort = createNodeFileSystemPort()) {
    if (!isAbsolute(selectionPath)) throw new TypeError("Workspace-selection path must be absolute");
    this.selectionPath = resolve(selectionPath);
    this.fileSystem = fileSystem;
  }

  private async ensureDirectory(path: string): Promise<void> {
    const before = await this.fileSystem.entryInfo(path);
    if (before === undefined) {
      const parent = dirname(path);
      if (parent === path) throw new Error("Workspace-selection storage is unavailable.");
      await this.ensureDirectory(parent);
      await this.fileSystem.makeDirectory(path);
      await this.fileSystem.syncDirectory(parent);
    }
    if ((await this.fileSystem.entryInfo(path))?.kind !== "directory") {
      throw new Error("Workspace-selection storage is unsafe.");
    }
  }

  async read(): Promise<string | undefined> {
    await this.ensureDirectory(dirname(this.selectionPath));
    const info = await this.fileSystem.entryInfo(this.selectionPath);
    if (info === undefined) return undefined;
    if (info.kind !== "file") throw new Error("Workspace-selection storage is unsafe.");
    return parseSelection(decodeCanonicalJson(await this.fileSystem.readFileNoFollow(
      this.selectionPath,
      MAX_SELECTION_BYTES,
    ))).workspaceRoot;
  }

  async write(chosenRoot: string): Promise<void> {
    const canonicalRoot = workspaceRoot(chosenRoot);
    const directory = dirname(this.selectionPath);
    await this.ensureDirectory(directory);
    const existing = await this.fileSystem.entryInfo(this.selectionPath);
    if (existing !== undefined && existing.kind !== "file") {
      throw new Error("Workspace-selection storage is unsafe.");
    }
    const bytes = new TextEncoder().encode(canonicalStringify({
      version: 1,
      kind: "workspaceSelection",
      workspaceRoot: canonicalRoot,
    }));
    const temporary = join(directory, `.${basename(this.selectionPath)}.${randomUUID()}.tmp`);
    try {
      await this.fileSystem.writeFileExclusive(temporary, bytes);
      await this.fileSystem.replaceFile(temporary, this.selectionPath);
      await this.fileSystem.syncDirectory(directory);
    } catch (error) {
      await this.fileSystem.removeFile(temporary).catch(() => undefined);
      throw error;
    }
  }
}
