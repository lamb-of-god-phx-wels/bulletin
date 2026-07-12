import {
  canonicalJsonBytes,
  hashBytes,
  isCanonicalUuid,
  isLocalResourceId,
  type CanonicalRevisionToken,
  type CbbDocument,
  type SchemaCatalog,
} from "@cbb/core";
import type { ServicePorts } from "../ports/index.js";
import {
  CONFLICT_DIRECTORY,
  assertManagedPathHasNoSymlink,
  resolveWorkspacePath,
  type WorkspaceRegistry,
  type WorkspaceResourceKind,
} from "../workspace/index.js";
import { writeJsonExclusive } from "./atomic.js";
import type { ConflictRecord } from "./types.js";

export const CONFLICT_RECORD_SCHEMA_ID =
  "https://church-bulletin-builder.local/schema/v1/conflict-record.schema.json";

function safeTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:.]/gu, "");
}

export async function captureConflict(input: {
  readonly root: string;
  readonly registry: WorkspaceRegistry;
  readonly resourceKind: WorkspaceResourceKind;
  readonly localResourceId: ConflictRecord["localResourceId"];
  readonly baseDocument: CbbDocument | null;
  readonly baseHash: CanonicalRevisionToken | null;
  readonly diskBytes: Uint8Array | null;
  readonly diskHash: CanonicalRevisionToken | null;
  readonly diskValidation: ConflictRecord["diskValidation"];
  readonly oursDocument: CbbDocument;
  readonly oursHash: CanonicalRevisionToken;
  readonly ports: ServicePorts;
  readonly catalog: SchemaCatalog;
}): Promise<string> {
  if (!isLocalResourceId(input.localResourceId)) {
    throw new TypeError("Conflict local resource id is invalid");
  }
  const conflictId = input.ports.ids.randomUuid();
  if (!isCanonicalUuid(conflictId)) throw new Error("Id port returned an invalid conflict id");
  const createdAt = input.ports.clock.now().toISOString();
  const relativeDirectory =
    `${CONFLICT_DIRECTORY}/${input.localResourceId}/${safeTimestamp(new Date(createdAt))}-${conflictId}`;
  const record: ConflictRecord = {
    version: 1,
    kind: "documentConflict",
    conflictId,
    workspaceId: input.registry.workspaceId,
    localResourceId: input.localResourceId,
    resourceKind: input.resourceKind,
    createdAt,
    baseHash: input.baseHash,
    diskHash: input.diskBytes === null
      ? null
      : input.diskHash ?? (hashBytes(input.diskBytes) as CanonicalRevisionToken),
    oursHash: input.oursHash,
    diskValidation: input.diskValidation,
  };
  const validation = input.catalog.validateAgainst(CONFLICT_RECORD_SCHEMA_ID, record);
  if (!validation.valid) throw new Error("Generated conflict record is invalid");
  const directory = resolveWorkspacePath(input.root, relativeDirectory);
  await assertManagedPathHasNoSymlink(
    input.ports.fileSystem,
    input.root,
    relativeDirectory,
  );
  await input.ports.fileSystem.makeDirectory(directory);
  await assertManagedPathHasNoSymlink(
    input.ports.fileSystem,
    input.root,
    relativeDirectory,
  );

  const basePath = resolveWorkspacePath(input.root, `${relativeDirectory}/base.json`);
  const diskPath = resolveWorkspacePath(input.root, `${relativeDirectory}/disk.json`);
  const oursPath = resolveWorkspacePath(input.root, `${relativeDirectory}/ours.json`);
  await input.ports.fileSystem.writeFileExclusive(
    basePath,
    canonicalJsonBytes(input.baseDocument),
  );
  await input.ports.fileSystem.writeFileExclusive(
    diskPath,
    input.diskBytes ?? canonicalJsonBytes(null),
  );
  await input.ports.fileSystem.writeFileExclusive(
    oursPath,
    canonicalJsonBytes(input.oursDocument),
  );
  await input.ports.fileSystem.syncDirectory(directory);

  await writeJsonExclusive(
    input.ports.fileSystem,
    resolveWorkspacePath(input.root, `${relativeDirectory}/conflict.json`),
    record,
  );
  return relativeDirectory;
}
