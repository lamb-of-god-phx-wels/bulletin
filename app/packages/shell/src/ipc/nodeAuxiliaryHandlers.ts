import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { canonicalStringify } from "@cbb/core";
import { createNodeFileSystemPort, decodeCanonicalJson, type DurableFileSystemPort } from "@cbb/services";
import type { M4EditBufferValue, M4JsonValue } from "./contract.js";
import { M4_IPC_LIMITS, assertBoundedJson } from "./contract.js";
import { M4HandlerError } from "./dispatcher.js";
import type { M4AuxiliaryRendererHandlers } from "./workspaceHandlers.js";

const EDIT_BUFFER_DIRECTORY = "transactions/edit-buffer";
const EDIT_BUFFER_FILE_CAP = M4_IPC_LIMITS.editBufferBytes + 4 * 1024;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const BUFFER_KEY = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;

interface EditBufferEnvelope extends M4EditBufferValue {
  readonly version: 1;
  readonly kind: "editBuffer";
  readonly localResourceId: string;
  readonly bufferKey: string;
}

export interface NodeM4AuxiliaryHandlersOptions {
  /** Trusted main-process path. It is never returned to or accepted from the renderer. */
  readonly appSettingsPath: string;
  /** Trusted root of the one currently owned workspace. */
  readonly workspaceRoot: string;
  readonly defaultAppSettings: M4JsonValue;
  /** Schema/semantic gate owned by the application settings service. */
  readonly validateAppSettings: (value: unknown) => M4JsonValue;
  readonly now?: () => Date;
  readonly fileSystem?: DurableFileSystemPort;
}

function utf8(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalStringify(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bufferFileName(bufferKey: string): string {
  return `${createHash("sha256").update(bufferKey, "utf8").digest("hex")}.json`;
}

function parseEnvelope(
  value: unknown,
  localResourceId: string,
  bufferKey: string,
): EditBufferEnvelope {
  if (!isRecord(value) || Object.keys(value).sort().join("\u0000") !==
    ["bufferKey", "kind", "localResourceId", "updatedAt", "value", "version"].sort().join("\u0000") ||
    value["version"] !== 1 || value["kind"] !== "editBuffer" ||
    value["localResourceId"] !== localResourceId || value["bufferKey"] !== bufferKey ||
    typeof value["value"] !== "string" || typeof value["updatedAt"] !== "string" ||
    Number.isNaN(Date.parse(value["updatedAt"]))) {
    throw new M4HandlerError("unavailable", "An unfinished field value could not be recovered safely.");
  }
  if (new TextEncoder().encode(value["value"]).byteLength > M4_IPC_LIMITS.editBufferBytes) {
    throw new M4HandlerError("unavailable", "An unfinished field value is too large to recover safely.");
  }
  return value as unknown as EditBufferEnvelope;
}

/** Durable, path-free auxiliary storage for edit buffers and application settings. */
export class NodeM4AuxiliaryHandlers implements M4AuxiliaryRendererHandlers {
  private readonly fileSystem: DurableFileSystemPort;
  private readonly appSettingsPath: string;
  private readonly workspaceRoot: string;
  private readonly directoriesAwaitingParentSync = new Set<string>();
  private operationTail: Promise<void> = Promise.resolve();

  constructor(private readonly options: NodeM4AuxiliaryHandlersOptions) {
    if (!isAbsolute(options.appSettingsPath) || !isAbsolute(options.workspaceRoot)) {
      throw new TypeError("M4 auxiliary storage roots must be absolute trusted paths");
    }
    this.fileSystem = options.fileSystem ?? createNodeFileSystemPort();
    this.appSettingsPath = resolve(options.appSettingsPath);
    this.workspaceRoot = resolve(options.workspaceRoot);
    assertBoundedJson(options.defaultAppSettings, M4_IPC_LIMITS.appSettingsBytes);
    options.validateAppSettings(options.defaultAppSettings);
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async ensureDirectory(path: string): Promise<void> {
    const before = await this.fileSystem.entryInfo(path);
    if (before === undefined) {
      const parent = dirname(path);
      if (parent === path) {
        throw new M4HandlerError("unavailable", "Local recovery storage is unavailable.");
      }
      // Create and persist missing ancestors from the root downward. The port
      // owns the platform-specific directory-sync implementation.
      await this.ensureDirectory(parent);
      await this.fileSystem.makeDirectory(path);
      this.directoriesAwaitingParentSync.add(path);
    }
    const after = await this.fileSystem.entryInfo(path);
    if (after?.kind !== "directory") {
      throw new M4HandlerError("unavailable", "Local recovery storage is unavailable.");
    }
    if (this.directoriesAwaitingParentSync.has(path)) {
      await this.fileSystem.syncDirectory(dirname(path));
      this.directoriesAwaitingParentSync.delete(path);
    }
  }

  private async editBufferPath(localResourceId: string, bufferKey: string): Promise<string> {
    if (!UUID_V4.test(localResourceId) || !BUFFER_KEY.test(bufferKey)) {
      throw new M4HandlerError("failed", "That unfinished field value has an invalid identity.");
    }
    const transactionRoot = join(this.workspaceRoot, "transactions");
    const editRoot = join(this.workspaceRoot, ...EDIT_BUFFER_DIRECTORY.split("/"));
    const resourceRoot = join(editRoot, localResourceId);
    const transactionInfo = await this.fileSystem.entryInfo(transactionRoot);
    if (transactionInfo?.kind !== "directory") {
      throw new M4HandlerError("unavailable", "Local recovery storage is unavailable.");
    }
    await this.ensureDirectory(editRoot);
    await this.ensureDirectory(resourceRoot);
    return join(resourceRoot, bufferFileName(bufferKey));
  }

  private async replaceJson(path: string, value: unknown, maximumBytes: number): Promise<void> {
    const bytes = utf8(value);
    if (bytes.byteLength > maximumBytes) throw new M4HandlerError("failed", "That value is too large to save safely.");
    const directory = dirname(path);
    const name = basename(path);
    const existing = await this.fileSystem.entryInfo(path);
    if (existing !== undefined && existing.kind !== "file") {
      throw new M4HandlerError("unavailable", "Local settings storage is unsafe.");
    }
    const temp = join(directory, `.${name}.${randomUUID()}.tmp`);
    try {
      await this.fileSystem.writeFileExclusive(temp, bytes);
      await this.fileSystem.replaceFile(temp, path);
      await this.fileSystem.syncDirectory(directory);
    } catch (error) {
      await this.fileSystem.removeFile(temp).catch(() => undefined);
      throw error;
    }
  }

  private async readEnvelope(
    path: string,
    localResourceId: string,
    bufferKey: string,
  ): Promise<EditBufferEnvelope> {
    try {
      return parseEnvelope(
        decodeCanonicalJson(await this.fileSystem.readFileNoFollow(path, EDIT_BUFFER_FILE_CAP)),
        localResourceId,
        bufferKey,
      );
    } catch (error) {
      if (error instanceof M4HandlerError) throw error;
      throw new M4HandlerError("unavailable", "An unfinished field value could not be recovered safely.");
    }
  }

  readEditBuffer(localResourceId: string, bufferKey: string): Promise<M4EditBufferValue | null> {
    return this.serialize(async () => {
      const path = await this.editBufferPath(localResourceId, bufferKey);
      if (await this.fileSystem.entryInfo(path) === undefined) return null;
      const parsed = await this.readEnvelope(path, localResourceId, bufferKey);
      return { value: parsed.value, updatedAt: parsed.updatedAt };
    });
  }

  writeEditBuffer(localResourceId: string, bufferKey: string, value: string): Promise<M4EditBufferValue> {
    return this.serialize(async () => {
      if (new TextEncoder().encode(value).byteLength > M4_IPC_LIMITS.editBufferBytes) {
        throw new M4HandlerError("failed", "That unfinished field value is too large to save safely.");
      }
      const path = await this.editBufferPath(localResourceId, bufferKey);
      const directory = dirname(path);
      const names = await this.fileSystem.readDirectory(directory);
      const existing = await this.fileSystem.entryInfo(path);
      if (existing === undefined && names.length >= M4_IPC_LIMITS.maximumEditBuffersPerDocument) {
        throw new M4HandlerError("failed", "Too many unfinished field values are already being protected for this bulletin.");
      }
      const envelope: EditBufferEnvelope = {
        version: 1,
        kind: "editBuffer",
        localResourceId,
        bufferKey,
        value,
        updatedAt: (this.options.now ?? (() => new Date()))().toISOString(),
      };
      await this.replaceJson(path, envelope, EDIT_BUFFER_FILE_CAP);
      return { value: envelope.value, updatedAt: envelope.updatedAt };
    });
  }

  deleteEditBuffer(localResourceId: string, bufferKey: string): Promise<boolean> {
    return this.serialize(async () => {
      const path = await this.editBufferPath(localResourceId, bufferKey);
      if (await this.fileSystem.entryInfo(path) === undefined) return false;
      // Verify this exact identity/key envelope before removing the app-owned file.
      await this.readEnvelope(path, localResourceId, bufferKey);
      await this.fileSystem.removeFile(path);
      await this.fileSystem.syncDirectory(dirname(path));
      return true;
    });
  }

  readAppSettings(): Promise<M4JsonValue> {
    return this.serialize(async () => {
      await this.ensureDirectory(dirname(this.appSettingsPath));
      if (await this.fileSystem.entryInfo(this.appSettingsPath) === undefined) {
        return this.options.validateAppSettings(this.options.defaultAppSettings);
      }
      const value = decodeCanonicalJson(await this.fileSystem.readFileNoFollow(
        this.appSettingsPath,
        M4_IPC_LIMITS.appSettingsBytes,
      ));
      assertBoundedJson(value, M4_IPC_LIMITS.appSettingsBytes);
      return this.options.validateAppSettings(value);
    });
  }

  writeAppSettings(value: M4JsonValue): Promise<M4JsonValue> {
    return this.serialize(async () => {
      await this.ensureDirectory(dirname(this.appSettingsPath));
      assertBoundedJson(value, M4_IPC_LIMITS.appSettingsBytes);
      const validated = this.options.validateAppSettings(value);
      await this.replaceJson(this.appSettingsPath, validated, M4_IPC_LIMITS.appSettingsBytes);
      return validated;
    });
  }
}
