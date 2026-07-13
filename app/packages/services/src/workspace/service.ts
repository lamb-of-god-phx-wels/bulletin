import {
  canonicalJsonBytes,
  isCanonicalUuid,
  mintWorkspaceId,
  type SchemaCatalog,
} from "@cbb/core";
import type { ServicePorts } from "../ports/index.js";
import { decodeCanonicalJson } from "../ports/index.js";
import { serviceDiagnostic } from "./diagnostics.js";
import { acquireWorkspaceLease } from "./lock.js";
import {
  CHURCH_PROFILE_PATH,
  WORKSPACE_DIRECTORIES,
  WORKSPACE_REGISTRY_PATH,
  WORKSPACE_SETTINGS_PATH,
  assertManagedPathHasNoSymlink,
  resolveWorkspacePath,
  workspaceCreationTarget,
} from "./paths.js";
import {
  CHURCH_PROFILE_SCHEMA_ID,
  SETTINGS_SCHEMA_ID,
  createEmptyRegistry,
  parseWorkspaceRegistry,
} from "./registry.js";
import type {
  CreateWorkspaceInput,
  OpenWorkspaceOptions,
  OpenWorkspaceResult,
  StartupRecoveryPort,
  WorkspaceLease,
} from "./types.js";

function decodeJson(bytes: Uint8Array): unknown {
  return decodeCanonicalJson(bytes);
}

async function writeNewJson(
  root: string,
  relativePath: string,
  value: unknown,
  ports: ServicePorts,
): Promise<void> {
  const path = resolveWorkspacePath(root, relativePath);
  await ports.fileSystem.writeFileExclusive(path, canonicalJsonBytes(value));
}

export class WorkspaceService {
  constructor(
    private readonly ports: ServicePorts,
    private readonly catalog: SchemaCatalog,
    private readonly recovery: StartupRecoveryPort,
    private readonly appVersion: string,
  ) {
    if (appVersion.length === 0) throw new Error("appVersion is required");
  }

  async create(input: CreateWorkspaceInput): Promise<OpenWorkspaceResult> {
    const correlationId = this.ports.ids.randomUuid();
    try {
      if (!isCanonicalUuid(correlationId)) throw new Error("Id port returned an invalid id");
      const requested = workspaceCreationTarget(input.root);
      const parent = await this.ports.fileSystem.realPath(requested.parent);
      const target = resolveWorkspacePath(parent, requested.name);
      const targetInfo = await this.ports.fileSystem.entryInfo(target);
      const targetWasExistingEmpty = targetInfo !== undefined;
      if (targetInfo !== undefined) {
        if (targetInfo.kind !== "directory") {
          throw new Error("Workspace destination exists and is not a regular directory");
        }
        if ((await this.ports.fileSystem.readDirectory(target)).length !== 0) {
          throw new Error("Workspace destination exists and is not empty");
        }
      }
      const stageName = `.cbb-workspace-${correlationId}.tmp`;
      const stageRoot = resolveWorkspacePath(parent, stageName);
      if (await this.ports.fileSystem.entryInfo(stageRoot) !== undefined) {
        throw new Error("Workspace staging directory already exists");
      }
      await this.ports.fileSystem.makeDirectory(stageRoot);
      for (const directory of WORKSPACE_DIRECTORIES) {
        await this.ports.fileSystem.makeDirectory(resolveWorkspacePath(stageRoot, directory));
      }

      const registry = createEmptyRegistry(
        mintWorkspaceId(this.ports.ids),
        input.displayName,
      );
      parseWorkspaceRegistry(registry, this.catalog);
      const settings = input.settings ?? { version: 1, kind: "workspaceSettings" } as const;
      const settingsValidation = this.catalog.validateAgainst(SETTINGS_SCHEMA_ID, settings);
      if (!settingsValidation.valid) throw new Error("Default workspace settings are invalid");
      if (input.churchProfile !== undefined) {
        const profileValidation = this.catalog.validateAgainst(
          CHURCH_PROFILE_SCHEMA_ID,
          input.churchProfile,
        );
        if (!profileValidation.valid) throw new Error("Initial Church Profile is invalid");
      }

      await writeNewJson(stageRoot, WORKSPACE_REGISTRY_PATH, registry, this.ports);
      await writeNewJson(stageRoot, WORKSPACE_SETTINGS_PATH, settings, this.ports);
      if (input.churchProfile !== undefined) {
        await writeNewJson(stageRoot, CHURCH_PROFILE_PATH, input.churchProfile, this.ports);
      }
      await this.ports.fileSystem.syncDirectory(stageRoot);
      const latestTargetInfo = await this.ports.fileSystem.entryInfo(target);
      if (targetWasExistingEmpty) {
        if (
          latestTargetInfo?.kind !== "directory" ||
          (await this.ports.fileSystem.readDirectory(target)).length !== 0 ||
          !(await this.ports.fileSystem.removeEmptyDirectory(target))
        ) {
          throw new Error("Workspace destination changed after it was confirmed empty");
        }
        await this.ports.fileSystem.syncDirectory(parent);
      } else if (latestTargetInfo !== undefined) {
        throw new Error("Workspace destination appeared while the workspace was being staged");
      }
      await this.ports.fileSystem.replaceFile(stageRoot, target);
      await this.ports.fileSystem.syncDirectory(parent);
      return this.open(target);
    } catch (error) {
      return {
        status: "failed",
        diagnostics: [serviceDiagnostic({
          code: "CBB-SCHEMA-0001",
          correlationId,
          operation: "create-workspace",
          userSummary: "The workspace could not be created safely.",
          technicalDetail: error instanceof Error ? error.message : String(error),
          recoveryActions: ["retry", "cancel"],
        })],
      };
    }
  }

  async open(root: string, options: OpenWorkspaceOptions = {}): Promise<OpenWorkspaceResult> {
    const correlationId = this.ports.ids.randomUuid();
    let acquiredLease: WorkspaceLease | undefined;
    try {
      if (!isCanonicalUuid(correlationId)) throw new Error("Id port returned an invalid id");
      const rootInfo = await this.ports.fileSystem.entryInfo(root);
      if (rootInfo?.kind !== "directory") {
        throw new Error("Workspace root is missing, not a directory, or is a symbolic link");
      }
      const canonicalRoot = await this.ports.fileSystem.realPath(root);
      await assertManagedPathHasNoSymlink(
        this.ports.fileSystem,
        canonicalRoot,
        WORKSPACE_REGISTRY_PATH,
      );
      const registryPath = resolveWorkspacePath(canonicalRoot, WORKSPACE_REGISTRY_PATH);
      const registry = parseWorkspaceRegistry(
        decodeJson(await this.ports.fileSystem.readFileNoFollow(registryPath, 100 * 1024 * 1024)),
        this.catalog,
      );

      if (options.mode === "readOnly") {
        return {
          status: "readOnly",
          session: {
            mode: "readOnly",
            root: canonicalRoot,
            registry,
            reason: "requested",
            diagnostics: [],
          },
        };
      }

      const lock = await acquireWorkspaceLease(
        canonicalRoot,
        registry,
        this.appVersion,
        this.ports,
        this.catalog,
        options.confirmedStaleLock,
      );
      acquiredLease = lock.status === "acquired" ? lock.lease : undefined;
      if (lock.status === "readOnly") {
        return {
          status: "readOnly",
          session: {
            mode: "readOnly",
            root: canonicalRoot,
            registry,
            reason: lock.reason,
            ...(lock.observedLock === undefined ? {} : { observedLock: lock.observedLock }),
            diagnostics: [serviceDiagnostic({
              code: "CBB-SECURITY-0001",
              correlationId,
              operation: "open-workspace",
              userSummary: "This workspace cannot be opened for editing right now.",
              technicalDetail: lock.detail,
              recoveryActions: ["cancel"],
            })],
          },
        };
      }

      const recovered = await this.recovery.recover(canonicalRoot, registry);
      if (recovered.status === "readOnly") {
        await lock.lease.release();
        acquiredLease = undefined;
        return {
          status: "readOnly",
          session: {
            mode: "readOnly",
            root: canonicalRoot,
            registry: recovered.registry,
            reason: "ambiguousRecovery",
            diagnostics: recovered.diagnostics,
          },
        };
      }
      acquiredLease = undefined;
      return {
        status: "editable",
        session: {
          mode: "editable",
          root: canonicalRoot,
          registry: recovered.registry,
          lease: lock.lease,
          recoveryDiagnostics: recovered.diagnostics,
        },
      };
    } catch (error) {
      await acquiredLease?.release().catch(() => undefined);
      return {
        status: "failed",
        diagnostics: [serviceDiagnostic({
          code: "CBB-SCHEMA-0001",
          correlationId,
          operation: "open-workspace",
          userSummary: "The workspace could not be opened safely.",
          technicalDetail: error instanceof Error ? error.message : String(error),
          recoveryActions: ["cancel"],
        })],
      };
    }
  }
}
