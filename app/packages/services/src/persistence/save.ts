import {
  canonicalJsonBytes,
  fromJson,
  isCanonicalUuid,
  validateDocumentSemantics,
  type CanonicalRevisionToken,
  type CbbDocument,
  type SchemaCatalog,
} from "@cbb/core";
import { basename, dirname } from "node:path";
import type { ServicePorts } from "../ports/index.js";
import {
  SAVE_JOURNAL_DIRECTORY,
  WORKSPACE_REGISTRY_PATH,
  assertManagedPathHasNoSymlink,
  canonicalDocumentPath,
  normalizeDisplayLabel,
  parseWorkspaceRegistry,
  registryHash,
  resolveWorkspacePath,
  withWorkspaceMutation,
} from "../workspace/index.js";
import { serviceDiagnostic } from "../workspace/diagnostics.js";
import {
  canonicalToken,
  decodeJson,
  replaceJsonAtomically,
} from "./atomic.js";
import { captureConflict } from "./conflict.js";
import { findResource, replaceResource } from "./registryUpdate.js";
import type {
  DocumentSaveJournal,
  SaveDocumentRequest,
  SaveDocumentResult,
  SaveJournalState,
} from "./types.js";

export const SAVE_JOURNAL_SCHEMA_ID =
  "https://church-bulletin-builder.local/schema/v1/save-journal.schema.json";
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const MAX_REGISTRY_BYTES = 100 * 1024 * 1024;
const MAX_SAVE_JOURNAL_BYTES = 16 * 1024 * 1024;

interface DiskDocument {
  readonly bytes: Uint8Array | null;
  readonly document: CbbDocument | null;
  readonly hash: CanonicalRevisionToken | null;
  readonly validation: "valid" | "invalid" | "missing";
}

function validateDocument(value: unknown, catalog: SchemaCatalog): CbbDocument {
  const document = fromJson(value, catalog);
  const semantic = validateDocumentSemantics(document);
  if (!semantic.valid) {
    throw new Error(`Document semantic validation failed: ${semantic.findings[0]?.message ?? "invalid document"}`);
  }
  return document;
}

async function readDiskDocument(
  path: string,
  ports: ServicePorts,
  catalog: SchemaCatalog,
): Promise<DiskDocument> {
  const info = await ports.fileSystem.entryInfo(path);
  if (info === undefined) {
    return { bytes: null, document: null, hash: null, validation: "missing" };
  }
  if (info.size > MAX_DOCUMENT_BYTES) {
    throw new RangeError("Workspace document exceeds the 50 MiB safety cap");
  }
  if (info.kind !== "file") {
    return { bytes: null, document: null, hash: null, validation: "invalid" };
  }
  const bytes = await ports.fileSystem.readFileNoFollow(path, MAX_DOCUMENT_BYTES);
  try {
    const sourceDocument = decodeJson(bytes);
    const document = validateDocument(sourceDocument, catalog);
    return {
      bytes,
      document,
      hash: canonicalToken(sourceDocument),
      validation: "valid",
    };
  } catch {
    return { bytes, document: null, hash: null, validation: "invalid" };
  }
}

function validateJournal(journal: DocumentSaveJournal, catalog: SchemaCatalog): void {
  const result = catalog.validateAgainst(SAVE_JOURNAL_SCHEMA_ID, journal);
  if (!result.valid) throw new Error("Generated save journal failed schema validation");
  if (journal.documentPath !== canonicalDocumentPath(journal.resourceKind, journal.localResourceId)) {
    throw new Error("Save journal contains a non-canonical document path");
  }
  if (
    journal.afterResource.localId !== journal.localResourceId ||
    journal.afterResource.kind !== journal.resourceKind ||
    journal.afterResource.storagePath !== journal.documentPath ||
    journal.afterResource.contentHash !== journal.newDocumentHash
  ) {
    throw new Error("Save journal after-resource metadata is inconsistent");
  }
}

async function replaceJournalState(
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
  await replaceJsonAtomically(ports.fileSystem, path, temp, updated, (value) => {
    validateJournal(value as DocumentSaveJournal, catalog);
  });
  return updated;
}

async function currentRegistry(
  root: string,
  ports: ServicePorts,
  catalog: SchemaCatalog,
) {
  const path = resolveWorkspacePath(root, WORKSPACE_REGISTRY_PATH);
  return parseWorkspaceRegistry(
    decodeJson(await ports.fileSystem.readFileNoFollow(path, MAX_REGISTRY_BYTES)),
    catalog,
  );
}

export async function removeSaveJournalIfExact(
  root: string,
  journal: DocumentSaveJournal,
  ports: ServicePorts,
  catalog: SchemaCatalog,
): Promise<boolean> {
  const relative = `${SAVE_JOURNAL_DIRECTORY}/${journal.transactionId}.json`;
  const path = resolveWorkspacePath(root, relative);
  const info = await ports.fileSystem.entryInfo(path);
  if (info === undefined) return true;
  if (info.kind !== "file" || info.size > MAX_SAVE_JOURNAL_BYTES) return false;
  const expectedToken = canonicalToken(journal);
  const observed = await ports.fileSystem.readFileNoFollow(path, MAX_SAVE_JOURNAL_BYTES);
  const parsed = decodeJson(observed) as DocumentSaveJournal;
  validateJournal(parsed, catalog);
  if (canonicalToken(parsed) !== expectedToken) return false;
  const moved = resolveWorkspacePath(
    root,
    `${SAVE_JOURNAL_DIRECTORY}/.${journal.transactionId}.cleanup`,
  );
  if (await ports.fileSystem.entryInfo(moved) !== undefined) return false;
  if (!await ports.fileSystem.moveFileNoReplace(path, moved)) return false;
  await ports.fileSystem.syncDirectory(dirname(path));
  const movedBytes = await ports.fileSystem.readFileNoFollow(moved, MAX_SAVE_JOURNAL_BYTES);
  let stillOwned = false;
  try {
    const movedJournal = decodeJson(movedBytes) as DocumentSaveJournal;
    validateJournal(movedJournal, catalog);
    stillOwned = canonicalToken(movedJournal) === expectedToken;
  } catch { /* preserve and restore ambiguous evidence */ }
  if (!stillOwned) {
    try {
      await ports.fileSystem.writeFileExclusive(path, movedBytes);
      await ports.fileSystem.syncDirectory(dirname(path));
      await ports.fileSystem.removeFile(moved);
    } catch { /* preserve moved evidence when the live name is occupied */ }
    return false;
  }
  await ports.fileSystem.removeFile(moved);
  await ports.fileSystem.syncDirectory(dirname(path));
  return true;
}

export class DocumentPersistenceService {
  constructor(
    private readonly ports: ServicePorts,
    private readonly catalog: SchemaCatalog,
  ) {}

  async save(request: SaveDocumentRequest): Promise<SaveDocumentResult> {
    // The registry is shared by document saves and generic resource
    // transactions. Hold the process-wide workspace mutation lane across the
    // document and registry journal sequence so neither writer can erase a
    // concurrent update from the other.
    return withWorkspaceMutation(
      request.session.root,
      () => this.saveSerialized(request),
    );
  }

  private async saveSerialized(request: SaveDocumentRequest): Promise<SaveDocumentResult> {
    const transactionId = this.ports.ids.randomUuid();
    let documentWasReplaced = false;
    let tempDocumentPath: string | undefined;
    let durableJournal: DocumentSaveJournal | undefined;
    let journalOwned = false;
    try {
      if (!isCanonicalUuid(transactionId)) throw new Error("Id port returned an invalid transaction id");
      await request.session.lease.heartbeat();
      const root = request.session.root;
      const registry = await currentRegistry(root, this.ports, this.catalog);
      if (registry.workspaceId !== request.session.registry.workspaceId) {
        throw new Error("Workspace identity changed while open");
      }
      const pendingSaveResidue = await this.ports.fileSystem.readDirectory(
        resolveWorkspacePath(root, SAVE_JOURNAL_DIRECTORY),
      );
      if (pendingSaveResidue.length !== 0) {
        return {
          status: "recoveryRequired",
          diagnostics: [serviceDiagnostic({
            code: "CBB-SAVE-0001",
            correlationId: transactionId,
            operation: "save-document",
            userSummary: "An interrupted save must be recovered before more edits can be saved.",
            recoveryActions: ["export-recovery-copy", "cancel"],
          })],
        };
      }

      const document = validateDocument(request.document, this.catalog);
      if (document.kind !== request.resourceKind) {
        throw new Error("Document kind does not match the requested workspace resource kind");
      }
      const newDocumentHash = canonicalToken(document);
      if ((request.baseDocument === null) !== (request.baseRevisionToken === null)) {
        throw new Error("Base document and revision token must both be present or both be null");
      }
      const baseDocument = request.baseDocument === null
        ? null
        : validateDocument(request.baseDocument, this.catalog);

      const documentPath = canonicalDocumentPath(request.resourceKind, request.localResourceId);
      await assertManagedPathHasNoSymlink(this.ports.fileSystem, root, documentPath);
      const absoluteDocumentPath = resolveWorkspacePath(root, documentPath);
      const disk = await readDiskDocument(absoluteDocumentPath, this.ports, this.catalog);
      const beforeResource = findResource(
        registry,
        request.resourceKind,
        request.localResourceId,
      ) ?? null;
      if (
        (request.baseRevisionToken === null && beforeResource !== null) ||
        (request.baseRevisionToken !== null && beforeResource?.contentHash !== request.baseRevisionToken)
      ) {
        throw new Error("Workspace registry metadata disagrees with the authoritative document base");
      }
      const optimisticMatch = disk.validation === "valid"
        ? disk.hash === request.baseRevisionToken
        : disk.validation === "missing" && request.baseRevisionToken === null;
      if (!optimisticMatch) {
        const conflictPath = await captureConflict({
          root,
          registry,
          resourceKind: request.resourceKind,
          localResourceId: request.localResourceId,
          baseDocument,
          baseHash: request.baseRevisionToken,
          diskBytes: disk.bytes,
          diskHash: disk.hash,
          diskValidation: disk.validation,
          oursDocument: document,
          oursHash: newDocumentHash,
          ports: this.ports,
          catalog: this.catalog,
        });
        return {
          status: "conflicted",
          conflictPath,
          diagnostics: [serviceDiagnostic({
            code: "CBB-CONFLICT-0001",
            correlationId: transactionId,
            operation: "save-document",
            userSummary: "The saved file changed outside the app, so your work was not overwritten.",
            technicalDetail: "The durable document hash did not match the loaded base revision.",
            recoveryActions: ["open-review", "cancel"],
            resourceKind: request.resourceKind,
            resourceLabel: normalizeDisplayLabel(request.displayName),
          })],
        };
      }
      if (
        baseDocument !== null &&
        canonicalToken(baseDocument) !== request.baseRevisionToken &&
        (
          disk.document === null ||
          canonicalToken(disk.document) !== canonicalToken(baseDocument)
        )
      ) {
        throw new Error("Base document does not match its source-bound revision token");
      }
      const now = this.ports.clock.now().toISOString();
      const afterResource = {
        localId: request.localResourceId,
        kind: request.resourceKind,
        displayName: normalizeDisplayLabel(request.displayName),
        storagePath: documentPath,
        contentHash: newDocumentHash,
        createdAt: beforeResource?.createdAt ?? now,
        modifiedAt: now,
        ...(beforeResource?.lastOpenedAt === undefined
          ? {}
          : { lastOpenedAt: beforeResource.lastOpenedAt }),
      } as const;
      const nextRegistry = replaceResource(
        registry,
        request.resourceKind,
        request.localResourceId,
        afterResource,
      );
      parseWorkspaceRegistry(nextRegistry, this.catalog);
      const createdAt = now;
      let journal: DocumentSaveJournal = {
        version: 1,
        kind: "documentSaveJournal",
        transactionId,
        workspaceId: registry.workspaceId,
        resourceKind: request.resourceKind,
        localResourceId: request.localResourceId,
        documentPath,
        state: "prepared",
        baseDocumentHash: request.baseRevisionToken,
        newDocumentHash,
        baseRegistryHash: registryHash(registry),
        newRegistryHash: registryHash(nextRegistry),
        beforeResource,
        afterResource,
        createdAt,
        updatedAt: createdAt,
      };
      validateJournal(journal, this.catalog);
      const journalPath = resolveWorkspacePath(root, `${SAVE_JOURNAL_DIRECTORY}/${transactionId}.json`);
      await assertManagedPathHasNoSymlink(
        this.ports.fileSystem,
        root,
        `${SAVE_JOURNAL_DIRECTORY}/${transactionId}.json`,
      );
      durableJournal = journal;
      await this.ports.fileSystem.writeFileExclusive(journalPath, canonicalJsonBytes(journal));
      journalOwned = true;
      await this.ports.fileSystem.syncDirectory(dirname(journalPath));

      await this.ports.fileSystem.makeDirectory(dirname(absoluteDocumentPath));
      await this.ports.fileSystem.syncDirectory(dirname(dirname(absoluteDocumentPath)));
      await assertManagedPathHasNoSymlink(this.ports.fileSystem, root, documentPath);
      tempDocumentPath = resolveWorkspacePath(
        root,
        `${dirname(documentPath)}/.${basename(documentPath)}.${transactionId}.tmp`,
      );
      await this.ports.fileSystem.writeFileExclusive(
        tempDocumentPath,
        canonicalJsonBytes(document),
      );
      const verifiedTemp = validateDocument(
        decodeJson(await this.ports.fileSystem.readFileNoFollow(tempDocumentPath, MAX_DOCUMENT_BYTES)),
        this.catalog,
      );
      if (canonicalToken(verifiedTemp) !== newDocumentHash) {
        throw new Error("Staged document verification hash mismatch");
      }

      // Repeat the optimistic check immediately before replacement. This catches
      // external edits that race the first check; the workspace lease and writer
      // queue cover cooperating app processes and in-process writers.
      const latestDisk = await readDiskDocument(absoluteDocumentPath, this.ports, this.catalog);
      const stillMatches = latestDisk.validation === "valid"
        ? latestDisk.hash === request.baseRevisionToken
        : latestDisk.validation === "missing" && request.baseRevisionToken === null;
      if (!stillMatches) {
        journal = await replaceJournalState(root, journal, "rolledBack", this.ports, this.catalog);
        durableJournal = journal;
        await this.ports.fileSystem.removeFile(tempDocumentPath);
        tempDocumentPath = undefined;
        const conflictPath = await captureConflict({
          root,
          registry,
          resourceKind: request.resourceKind,
          localResourceId: request.localResourceId,
          baseDocument,
          baseHash: request.baseRevisionToken,
          diskBytes: latestDisk.bytes,
          diskHash: latestDisk.hash,
          diskValidation: latestDisk.validation,
          oursDocument: document,
          oursHash: newDocumentHash,
          ports: this.ports,
          catalog: this.catalog,
        });
        if (!await removeSaveJournalIfExact(root, journal, this.ports, this.catalog)) {
          return {
            status: "recoveryRequired",
            diagnostics: [serviceDiagnostic({
              code: "CBB-SAVE-0001",
              correlationId: transactionId,
              operation: "save-document",
              userSummary: "The canceled save left evidence that must be recovered before retrying.",
              recoveryActions: ["export-recovery-copy", "cancel"],
            })],
          };
        }
        durableJournal = undefined;
        return {
          status: "conflicted",
          conflictPath,
          diagnostics: [serviceDiagnostic({
            code: "CBB-CONFLICT-0001",
            correlationId: transactionId,
            operation: "save-document",
            userSummary: "The saved file changed during saving, so your work was not overwritten.",
            recoveryActions: ["open-review", "cancel"],
          })],
        };
      }

      await this.ports.fileSystem.replaceFile(tempDocumentPath, absoluteDocumentPath);
      tempDocumentPath = undefined;
      documentWasReplaced = true;
      await this.ports.fileSystem.syncDirectory(dirname(absoluteDocumentPath));
      journal = await replaceJournalState(root, journal, "documentReplaced", this.ports, this.catalog);
      durableJournal = journal;

      const registryPath = resolveWorkspacePath(root, WORKSPACE_REGISTRY_PATH);
      const registryTemp = resolveWorkspacePath(root, `.workspace.json.${transactionId}.tmp`);
      await replaceJsonAtomically(
        this.ports.fileSystem,
        registryPath,
        registryTemp,
        nextRegistry,
        (value) => { parseWorkspaceRegistry(value, this.catalog); },
      );
      if (registryHash(await currentRegistry(root, this.ports, this.catalog)) !== journal.newRegistryHash) {
        throw new Error("Registry durable verification hash mismatch");
      }
      journal = await replaceJournalState(root, journal, "committed", this.ports, this.catalog);
      durableJournal = journal;
      try {
        if (await removeSaveJournalIfExact(root, journal, this.ports, this.catalog)) {
          durableJournal = undefined;
        }
      } catch {
        // A committed journal is safe and startup recovery will only clean it.
      }
      return { status: "saved", revisionToken: newDocumentHash, registry: nextRegistry };
    } catch (error) {
      if (tempDocumentPath !== undefined) {
        try { await this.ports.fileSystem.removeFile(tempDocumentPath); } catch { /* owned temp only */ }
      }
      let journalCleaned = durableJournal === undefined;
      if (journalOwned && !documentWasReplaced && durableJournal?.state === "prepared") {
        try {
          journalCleaned = await removeSaveJournalIfExact(
            request.session.root,
            durableJournal,
            this.ports,
            this.catalog,
          );
        } catch { journalCleaned = false; }
      }
      return {
        status: documentWasReplaced || !journalCleaned ? "recoveryRequired" : "failed",
        diagnostics: [serviceDiagnostic({
          code: "CBB-SAVE-0001",
          correlationId: transactionId,
          operation: "save-document",
          userSummary: documentWasReplaced || !journalCleaned
            ? "Saving was interrupted and the workspace needs recovery before more edits."
            : "Your changes could not be saved safely.",
          technicalDetail: error instanceof Error ? error.message : String(error),
          recoveryActions: ["retry", "export-recovery-copy", "cancel"],
          resourceKind: request.resourceKind,
        })],
      };
    }
  }
}
