import {
  canonicalJsonBytes,
  isCanonicalUuid,
  type CanonicalRevisionToken,
  type DiagnosticRecord,
  type SchemaCatalog,
} from "@cbb/core";
import { basename, dirname } from "node:path";
import type { ServicePorts } from "../ports/index.js";
import { canonicalToken, decodeJson } from "../persistence/atomic.js";
import { serviceDiagnostic } from "./diagnostics.js";
import {
  CHURCH_PROFILE_PATH,
  WORKSPACE_SETTINGS_PATH,
  assertManagedPathHasNoSymlink,
  resolveWorkspacePath,
} from "./paths.js";
import { CHURCH_PROFILE_SCHEMA_ID, SETTINGS_SCHEMA_ID } from "./registry.js";
import type {
  ChurchProfile,
  EditableWorkspaceSession,
  ReadOnlyWorkspaceSession,
  WorkspaceSettings,
} from "./types.js";

type PreferencesSession = EditableWorkspaceSession | ReadOnlyWorkspaceSession;

export interface PreferenceSaveRequest<T> {
  readonly session: PreferencesSession;
  readonly value: T;
  readonly baseHash: CanonicalRevisionToken | null;
}

export type PreferenceLoadResult<T> =
  | {
      readonly status: "loaded";
      readonly value: T | null;
      readonly hash: CanonicalRevisionToken | null;
    }
  | { readonly status: "readOnly"; readonly diagnostics: readonly DiagnosticRecord[] };

export type PreferenceSaveResult<T> =
  | {
      readonly status: "saved";
      readonly value: T;
      readonly hash: CanonicalRevisionToken;
    }
  | {
      readonly status: "conflicted";
      readonly diskHash: CanonicalRevisionToken | null;
      readonly diagnostics: readonly DiagnosticRecord[];
    }
  | { readonly status: "readOnly"; readonly diagnostics: readonly DiagnosticRecord[] }
  | { readonly status: "failed"; readonly diagnostics: readonly DiagnosticRecord[] };

class UnsafePreferenceStateError extends Error {}
class InvalidPreferenceInputError extends Error {}

class SerializedPreferenceWriter {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    this.tails.set(key, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}

const secretKey = /(?:password|token|secret|credential|private[_-]?key|api[_-]?key)/iu;

function assertContainsNoSecretFields(value: unknown): void {
  const pending: unknown[] = [value];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current !== "object") continue;
    if (seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      if (secretKey.test(key)) {
        throw new InvalidPreferenceInputError("Settings and Church Profile files cannot contain secrets");
      }
      pending.push(child);
    }
  }
}

interface PreferenceDefinition<T> {
  readonly relativePath: string;
  readonly schemaId: string;
  readonly optional: boolean;
  readonly operation: string;
  readonly cast: (value: unknown) => T;
}

const SETTINGS: PreferenceDefinition<WorkspaceSettings> = {
  relativePath: WORKSPACE_SETTINGS_PATH,
  schemaId: SETTINGS_SCHEMA_ID,
  optional: false,
  operation: "save-workspace-settings",
  cast: (value) => value as WorkspaceSettings,
};

const PROFILE: PreferenceDefinition<ChurchProfile> = {
  relativePath: CHURCH_PROFILE_PATH,
  schemaId: CHURCH_PROFILE_SCHEMA_ID,
  optional: true,
  operation: "save-church-profile",
  cast: (value) => value as ChurchProfile,
};

export class WorkspacePreferencesService {
  private readonly writers = new SerializedPreferenceWriter();

  constructor(
    private readonly ports: ServicePorts,
    private readonly catalog: SchemaCatalog,
  ) {}

  loadSettings(session: PreferencesSession): Promise<PreferenceLoadResult<WorkspaceSettings>> {
    return this.load(session, SETTINGS);
  }

  loadChurchProfile(session: PreferencesSession): Promise<PreferenceLoadResult<ChurchProfile>> {
    return this.load(session, PROFILE);
  }

  saveSettings(
    request: PreferenceSaveRequest<WorkspaceSettings>,
  ): Promise<PreferenceSaveResult<WorkspaceSettings>> {
    return this.save(request, SETTINGS);
  }

  saveChurchProfile(
    request: PreferenceSaveRequest<ChurchProfile>,
  ): Promise<PreferenceSaveResult<ChurchProfile>> {
    return this.save(request, PROFILE);
  }

  private async load<T>(
    session: PreferencesSession,
    definition: PreferenceDefinition<T>,
  ): Promise<PreferenceLoadResult<T>> {
    const correlationId = this.ports.ids.randomUuid();
    try {
      if (!isCanonicalUuid(correlationId)) throw new Error("Id port returned an invalid id");
      const current = await this.readCurrent(session.root, definition);
      return { status: "loaded", value: current.value, hash: current.hash };
    } catch (error) {
      return {
        status: "readOnly",
        diagnostics: [this.diagnostic(
          "CBB-SCHEMA-0001",
          correlationId,
          `load-${definition.operation}`,
          "These workspace preferences cannot be edited because their saved file is unsafe or invalid.",
          error,
        )],
      };
    }
  }

  private async save<T>(
    request: PreferenceSaveRequest<T>,
    definition: PreferenceDefinition<T>,
  ): Promise<PreferenceSaveResult<T>> {
    const correlationId = this.ports.ids.randomUuid();
    if (!isCanonicalUuid(correlationId)) {
      return {
        status: "failed",
        diagnostics: [this.diagnostic(
          "CBB-SAVE-0001",
          "invalid-correlation-id",
          definition.operation,
          "The preference could not be saved safely.",
          new Error("Id port returned an invalid id"),
        )],
      };
    }
    return this.writers.run(
      `${request.session.root}\u0000${definition.relativePath}`,
      () => this.saveSerialized(request, definition, correlationId),
    );
  }

  private async saveSerialized<T>(
    request: PreferenceSaveRequest<T>,
    definition: PreferenceDefinition<T>,
    correlationId: string,
  ): Promise<PreferenceSaveResult<T>> {
    if (request.session.mode !== "editable") {
      return {
        status: "readOnly",
        diagnostics: [this.diagnostic(
          "CBB-SAVE-0002",
          correlationId,
          definition.operation,
          "This workspace is open read-only, so its preferences were not changed.",
        )],
      };
    }

    let targetWasReplaced = false;
    let tempPath: string | undefined;
    try {
      this.validateValue(request.value, definition);
      try {
        await request.session.lease.heartbeat();
      } catch (error) {
        throw new UnsafePreferenceStateError(
          error instanceof Error ? error.message : "Workspace edit lease was lost",
        );
      }
      const current = await this.readCurrent(request.session.root, definition);
      if (current.hash !== request.baseHash) {
        return this.conflict(definition, correlationId, current.hash);
      }

      const transactionId = this.ports.ids.randomUuid();
      if (!isCanonicalUuid(transactionId)) throw new Error("Id port returned an invalid save id");
      const targetPath = resolveWorkspacePath(request.session.root, definition.relativePath);
      tempPath = resolveWorkspacePath(
        request.session.root,
        `.${basename(definition.relativePath)}.${transactionId}.tmp`,
      );
      const expectedHash = canonicalToken(request.value);
      await this.ports.fileSystem.removeFile(tempPath);
      await this.ports.fileSystem.writeFileExclusive(tempPath, canonicalJsonBytes(request.value));
      const staged = definition.cast(decodeJson(
        await this.ports.fileSystem.readFileNoFollow(tempPath, 16 * 1024 * 1024),
      ));
      this.validateValue(staged, definition);
      if (canonicalToken(staged) !== expectedHash) {
        throw new Error("Staged preference verification hash mismatch");
      }

      const latest = await this.readCurrent(request.session.root, definition);
      if (latest.hash !== request.baseHash) {
        await this.ports.fileSystem.removeFile(tempPath);
        tempPath = undefined;
        return this.conflict(definition, correlationId, latest.hash);
      }
      await this.ports.fileSystem.replaceFile(tempPath, targetPath);
      tempPath = undefined;
      targetWasReplaced = true;
      await this.ports.fileSystem.syncDirectory(dirname(targetPath));
      const durable = await this.readCurrent(request.session.root, definition);
      if (durable.hash !== expectedHash) {
        throw new UnsafePreferenceStateError("Durable preference verification hash mismatch");
      }
      return { status: "saved", value: definition.cast(request.value), hash: expectedHash };
    } catch (error) {
      if (tempPath !== undefined) {
        try { await this.ports.fileSystem.removeFile(tempPath); } catch { /* owned temp only */ }
      }
      if (error instanceof UnsafePreferenceStateError || targetWasReplaced) {
        return {
          status: "readOnly",
          diagnostics: [this.diagnostic(
            "CBB-SAVE-0001",
            correlationId,
            definition.operation,
            "The preference save could not be verified, so this workspace must remain read-only.",
            error,
          )],
        };
      }
      return {
        status: "failed",
        diagnostics: [this.diagnostic(
          error instanceof InvalidPreferenceInputError ? "CBB-SCHEMA-0001" : "CBB-SAVE-0001",
          correlationId,
          definition.operation,
          "The preference could not be saved safely.",
          error,
        )],
      };
    }
  }

  private validateValue<T>(value: T, definition: PreferenceDefinition<T>): void {
    assertContainsNoSecretFields(value);
    const validation = this.catalog.validateAgainst(definition.schemaId, value);
    if (!validation.valid) {
      throw new InvalidPreferenceInputError(
        `Preference schema validation failed: ${validation.errors[0]?.message ?? "invalid value"}`,
      );
    }
  }

  private async readCurrent<T>(
    root: string,
    definition: PreferenceDefinition<T>,
  ): Promise<{ readonly value: T | null; readonly hash: CanonicalRevisionToken | null }> {
    await assertManagedPathHasNoSymlink(
      this.ports.fileSystem,
      root,
      definition.relativePath,
    );
    const path = resolveWorkspacePath(root, definition.relativePath);
    const info = await this.ports.fileSystem.entryInfo(path);
    if (info === undefined) {
      if (definition.optional) return { value: null, hash: null };
      throw new UnsafePreferenceStateError("Required workspace settings file is missing");
    }
    if (info.kind !== "file") {
      throw new UnsafePreferenceStateError("Preference path is not a regular file");
    }
    let value: T;
    try {
      value = definition.cast(decodeJson(
        await this.ports.fileSystem.readFileNoFollow(path, 16 * 1024 * 1024),
      ));
      this.validateValue(value, definition);
    } catch (error) {
      if (error instanceof UnsafePreferenceStateError) throw error;
      throw new UnsafePreferenceStateError(
        error instanceof Error ? error.message : "Preference file is invalid",
      );
    }
    return { value, hash: canonicalToken(value) };
  }

  private conflict<T>(
    definition: PreferenceDefinition<T>,
    correlationId: string,
    diskHash: CanonicalRevisionToken | null,
  ): PreferenceSaveResult<T> {
    return {
      status: "conflicted",
      diskHash,
      diagnostics: [this.diagnostic(
        "CBB-CONFLICT-0001",
        correlationId,
        definition.operation,
        "These preferences changed outside the app, so they were not overwritten.",
      )],
    };
  }

  private diagnostic(
    code: string,
    correlationId: string,
    operation: string,
    summary: string,
    error?: unknown,
  ): DiagnosticRecord {
    return serviceDiagnostic({
      code,
      correlationId,
      operation,
      userSummary: summary,
      ...(error === undefined
        ? {}
        : { technicalDetail: error instanceof Error ? error.message : String(error) }),
      recoveryActions: code === "CBB-CONFLICT-0001"
        ? ["open-review", "cancel"]
        : ["retry", "cancel"],
    });
  }
}
