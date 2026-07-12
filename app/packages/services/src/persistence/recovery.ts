import {
  fromJson,
  hashBytes,
  isCanonicalUuid,
  validateDocumentSemantics,
  type CanonicalRevisionToken,
  type SchemaCatalog,
} from "@cbb/core";
import { basename, dirname } from "node:path";
import type { ServicePorts } from "../ports/index.js";
import {
  SAVE_JOURNAL_DIRECTORY,
  WORKSPACE_REGISTRY_PATH,
  assertManagedPathHasNoSymlink,
  canonicalDocumentPath,
  parseWorkspaceRegistry,
  registryHash,
  resolveWorkspacePath,
  type StartupRecoveryPort,
  type StartupRecoveryResult,
  type WorkspaceRegistry,
} from "../workspace/index.js";
import { serviceDiagnostic } from "../workspace/diagnostics.js";
import { canonicalToken, decodeJson, replaceJsonAtomically } from "./atomic.js";
import { replaceResource } from "./registryUpdate.js";
import {
  SAVE_JOURNAL_SCHEMA_ID,
  removeSaveJournalIfExact,
} from "./save.js";
import type { DocumentSaveJournal, SaveJournalState } from "./types.js";

const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const MAX_REGISTRY_BYTES = 100 * 1024 * 1024;
const MAX_SAVE_JOURNAL_BYTES = 16 * 1024 * 1024;

function validateJournal(value: unknown, catalog: SchemaCatalog): DocumentSaveJournal {
  const structural = catalog.validateAgainst(SAVE_JOURNAL_SCHEMA_ID, value);
  if (!structural.valid) throw new Error("Save journal has an invalid persisted shape");
  const journal = value as DocumentSaveJournal;
  if (!isCanonicalUuid(journal.transactionId)) throw new Error("Save journal transaction id is invalid");
  if (journal.documentPath !== canonicalDocumentPath(journal.resourceKind, journal.localResourceId)) {
    throw new Error("Save journal document path is not canonical");
  }
  if (
    journal.afterResource.localId !== journal.localResourceId ||
    journal.afterResource.kind !== journal.resourceKind ||
    journal.afterResource.storagePath !== journal.documentPath ||
    journal.afterResource.contentHash !== journal.newDocumentHash
  ) {
    throw new Error("Save journal after-resource metadata is inconsistent");
  }
  if (
    journal.beforeResource !== null &&
    (journal.beforeResource.localId !== journal.localResourceId ||
      journal.beforeResource.kind !== journal.resourceKind ||
      journal.beforeResource.storagePath !== journal.documentPath ||
      journal.beforeResource.contentHash !== journal.baseDocumentHash)
  ) {
    throw new Error("Save journal before-resource metadata is inconsistent");
  }
  if ((journal.beforeResource === null) !== (journal.baseDocumentHash === null)) {
    throw new Error("Save journal base resource and hash disagree");
  }
  return journal;
}

async function readRegistry(
  root: string,
  ports: ServicePorts,
  catalog: SchemaCatalog,
): Promise<WorkspaceRegistry> {
  return parseWorkspaceRegistry(
    decodeJson(await ports.fileSystem.readFileNoFollow(
      resolveWorkspacePath(root, WORKSPACE_REGISTRY_PATH),
      MAX_REGISTRY_BYTES,
    )),
    catalog,
  );
}

async function readDocumentHash(
  root: string,
  journal: DocumentSaveJournal,
  ports: ServicePorts,
  catalog: SchemaCatalog,
): Promise<CanonicalRevisionToken | null> {
  await assertManagedPathHasNoSymlink(ports.fileSystem, root, journal.documentPath);
  const path = resolveWorkspacePath(root, journal.documentPath);
  const info = await ports.fileSystem.entryInfo(path);
  if (info === undefined) return null;
  if (info.kind !== "file") throw new Error("Journaled document is not a regular file");
  const document = fromJson(
    decodeJson(await ports.fileSystem.readFileNoFollow(path, MAX_DOCUMENT_BYTES)),
    catalog,
  );
  const semantic = validateDocumentSemantics(document);
  if (!semantic.valid) throw new Error("Journaled document fails semantic validation");
  return canonicalToken(document);
}

async function updateJournal(
  root: string,
  journal: DocumentSaveJournal,
  state: SaveJournalState,
  ports: ServicePorts,
  catalog: SchemaCatalog,
): Promise<DocumentSaveJournal> {
  const updated: DocumentSaveJournal = {
    ...journal,
    state,
    updatedAt: ports.clock.now().toISOString(),
  };
  const path = resolveWorkspacePath(root, `${SAVE_JOURNAL_DIRECTORY}/${journal.transactionId}.json`);
  const temp = resolveWorkspacePath(root, `${SAVE_JOURNAL_DIRECTORY}/.${journal.transactionId}.tmp`);
  await replaceJsonAtomically(ports.fileSystem, path, temp, updated, (raw) => {
    validateJournal(raw, catalog);
  });
  return updated;
}

async function cleanupJournal(
  root: string,
  journal: DocumentSaveJournal,
  ports: ServicePorts,
  catalog: SchemaCatalog,
): Promise<void> {
  const journalTemp = resolveWorkspacePath(
    root,
    `${SAVE_JOURNAL_DIRECTORY}/.${journal.transactionId}.tmp`,
  );
  const documentTemp = resolveWorkspacePath(
    root,
    `${dirname(journal.documentPath)}/.${basename(journal.documentPath)}.${journal.transactionId}.tmp`,
  );
  const documentTempInfo = await ports.fileSystem.entryInfo(documentTemp);
  if (documentTempInfo !== undefined) {
    if (documentTempInfo.kind !== "file" || documentTempInfo.size > MAX_DOCUMENT_BYTES) {
      throw new Error("Save document staging residue is not a bounded regular file");
    }
    const bytes = await ports.fileSystem.readFileNoFollow(documentTemp, MAX_DOCUMENT_BYTES);
    const document = fromJson(decodeJson(bytes), catalog);
    const semantic = validateDocumentSemantics(document);
    if (!semantic.valid || canonicalToken(document) !== journal.newDocumentHash) {
      throw new Error("Save document staging residue is not owned by the journal");
    }
    if (!await removeObservedFileExact(documentTemp, hashBytes(bytes), ports, MAX_DOCUMENT_BYTES)) {
      throw new Error("Save document staging residue changed before cleanup");
    }
  }
  const journalTempInfo = await ports.fileSystem.entryInfo(journalTemp);
  if (journalTempInfo !== undefined) {
    if (journalTempInfo.kind !== "file" || journalTempInfo.size > MAX_SAVE_JOURNAL_BYTES) {
      throw new Error("Save journal staging residue is not a bounded regular file");
    }
    const bytes = await ports.fileSystem.readFileNoFollow(journalTemp, MAX_SAVE_JOURNAL_BYTES);
    const staged = validateJournal(decodeJson(bytes), catalog);
    if (!sameJournalIdentity(staged, journal)) {
      throw new Error("Save journal staging residue is not owned by the journal");
    }
    if (!await removeObservedFileExact(journalTemp, hashBytes(bytes), ports, MAX_SAVE_JOURNAL_BYTES)) {
      throw new Error("Save journal staging residue changed before cleanup");
    }
  }
  if (!await removeSaveJournalIfExact(root, journal, ports, catalog)) {
    throw new Error("Save journal changed before verified cleanup");
  }
  await ports.fileSystem.syncDirectory(resolveWorkspacePath(root, SAVE_JOURNAL_DIRECTORY));
}

function sameJournalIdentity(
  left: DocumentSaveJournal,
  right: DocumentSaveJournal,
): boolean {
  return left.transactionId === right.transactionId &&
    left.workspaceId === right.workspaceId &&
    left.resourceKind === right.resourceKind &&
    left.localResourceId === right.localResourceId &&
    left.documentPath === right.documentPath &&
    left.baseDocumentHash === right.baseDocumentHash &&
    left.newDocumentHash === right.newDocumentHash &&
    left.baseRegistryHash === right.baseRegistryHash &&
    left.newRegistryHash === right.newRegistryHash;
}

async function removeObservedFileExact(
  path: string,
  expectedHash: string,
  ports: ServicePorts,
  maximumBytes: number,
): Promise<boolean> {
  const cleanupId = ports.ids.randomUuid();
  if (!isCanonicalUuid(cleanupId)) throw new Error("Id port returned an invalid cleanup id");
  const moved = `${path}.cleanup-${cleanupId}`;
  if (!await ports.fileSystem.moveFileNoReplace(path, moved)) return false;
  await ports.fileSystem.syncDirectory(dirname(path));
  const movedBytes = await ports.fileSystem.readFileNoFollow(moved, maximumBytes);
  if (hashBytes(movedBytes) !== expectedHash) {
    await ports.fileSystem.moveFileNoReplace(moved, path).catch(() => false);
    await ports.fileSystem.syncDirectory(dirname(path));
    return false;
  }
  await ports.fileSystem.removeFile(moved);
  await ports.fileSystem.syncDirectory(dirname(path));
  return true;
}

export class SaveJournalRecoveryService implements StartupRecoveryPort {
  constructor(
    private readonly ports: ServicePorts,
    private readonly catalog: SchemaCatalog,
  ) {}

  async recover(root: string, loadedRegistry: WorkspaceRegistry): Promise<StartupRecoveryResult> {
    const correlationId = this.ports.ids.randomUuid();
    try {
      if (!isCanonicalUuid(correlationId)) throw new Error("Id port returned an invalid recovery id");
      await assertManagedPathHasNoSymlink(
        this.ports.fileSystem,
        root,
        SAVE_JOURNAL_DIRECTORY,
      );
      const names = await this.ports.fileSystem.readDirectory(
        resolveWorkspacePath(root, SAVE_JOURNAL_DIRECTORY),
      );
      const journals: DocumentSaveJournal[] = [];
      const tempNames = new Set<string>();
      for (const name of names) {
        if (/^\.[0-9a-f-]+\.tmp$/u.test(name)) {
          tempNames.add(name);
          continue;
        }
        if (!/^[0-9a-f-]+\.json$/u.test(name)) {
          throw new Error("Save journal directory contains unrecognized residue");
        }
        const relative = `${SAVE_JOURNAL_DIRECTORY}/${name}`;
        await assertManagedPathHasNoSymlink(this.ports.fileSystem, root, relative);
        const journal = validateJournal(
          decodeJson(await this.ports.fileSystem.readFileNoFollow(
            resolveWorkspacePath(root, relative),
            MAX_SAVE_JOURNAL_BYTES,
          )),
          this.catalog,
        );
        if (`${journal.transactionId}.json` !== name) {
          throw new Error("Save journal filename does not match its transaction id");
        }
        if (journal.workspaceId !== loadedRegistry.workspaceId) {
          throw new Error("Save journal belongs to a different workspace");
        }
        journals.push(journal);
      }
      const journalIds = new Set(journals.map((journal) => journal.transactionId));
      for (const tempName of tempNames) {
        const transactionId = tempName.slice(1, -4);
        if (!journalIds.has(transactionId)) {
          throw new Error("Orphaned save-journal temporary file cannot be attributed safely");
        }
      }

      const active = journals.filter(
        (journal) => journal.state !== "committed" && journal.state !== "rolledBack",
      );
      if (active.length > 1) {
        throw new Error("More than one nonterminal save journal exists");
      }

      for (const journal of journals) {
        if (journal.state === "committed" || journal.state === "rolledBack") {
          await cleanupJournal(root, journal, this.ports, this.catalog);
        }
      }

      if (active.length === 0) {
        return { status: "ok", registry: await readRegistry(root, this.ports, this.catalog), diagnostics: [] };
      }

      let journal = active[0] as DocumentSaveJournal;
      let registry = await readRegistry(root, this.ports, this.catalog);
      const documentHash = await readDocumentHash(root, journal, this.ports, this.catalog);
      const currentRegistryHash = registryHash(registry);
      const documentIsNew = documentHash === journal.newDocumentHash;
      const documentIsBase = documentHash === journal.baseDocumentHash;
      const registryIsNew = currentRegistryHash === journal.newRegistryHash;
      const registryIsBase = currentRegistryHash === journal.baseRegistryHash;

      if (documentIsNew && registryIsBase) {
        const completed = replaceResource(
          registry,
          journal.resourceKind,
          journal.localResourceId,
          journal.afterResource,
        );
        if (registryHash(completed) !== journal.newRegistryHash) {
          throw new Error("Recorded registry completion does not produce its declared hash");
        }
        const registryPath = resolveWorkspacePath(root, WORKSPACE_REGISTRY_PATH);
        const temp = resolveWorkspacePath(root, `.workspace.json.${journal.transactionId}.recovery.tmp`);
        await replaceJsonAtomically(this.ports.fileSystem, registryPath, temp, completed, (value) => {
          parseWorkspaceRegistry(value, this.catalog);
        });
        registry = completed;
        journal = await updateJournal(root, journal, "committed", this.ports, this.catalog);
      } else if (documentIsNew && registryIsNew) {
        journal = await updateJournal(root, journal, "committed", this.ports, this.catalog);
      } else if (documentIsBase && registryIsNew) {
        const rolledBack = replaceResource(
          registry,
          journal.resourceKind,
          journal.localResourceId,
          journal.beforeResource,
        );
        if (registryHash(rolledBack) !== journal.baseRegistryHash) {
          throw new Error("Recorded registry rollback does not produce its declared hash");
        }
        const registryPath = resolveWorkspacePath(root, WORKSPACE_REGISTRY_PATH);
        const temp = resolveWorkspacePath(root, `.workspace.json.${journal.transactionId}.recovery.tmp`);
        await replaceJsonAtomically(this.ports.fileSystem, registryPath, temp, rolledBack, (value) => {
          parseWorkspaceRegistry(value, this.catalog);
        });
        registry = rolledBack;
        journal = await updateJournal(root, journal, "rolledBack", this.ports, this.catalog);
      } else if (documentIsBase && registryIsBase) {
        journal = await updateJournal(root, journal, "rolledBack", this.ports, this.catalog);
      } else {
        throw new Error("Save journal bytes have a third or contradictory hash");
      }

      await cleanupJournal(root, journal, this.ports, this.catalog);
      return { status: "ok", registry, diagnostics: [] };
    } catch (error) {
      return {
        status: "readOnly",
        registry: loadedRegistry,
        diagnostics: [serviceDiagnostic({
          code: "CBB-SAVE-0001",
          correlationId,
          operation: "recover-workspace",
          userSummary: "The workspace has an interrupted save that cannot be reconciled safely.",
          technicalDetail: error instanceof Error ? error.message : String(error),
          recoveryActions: ["export-recovery-copy", "cancel"],
        })],
      };
    }
  }
}
