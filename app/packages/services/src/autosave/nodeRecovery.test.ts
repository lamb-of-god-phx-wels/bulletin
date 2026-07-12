import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalJsonBytes,
  canonicalRevisionToken,
  createSchemaCatalog,
  parseLocalResourceId,
  parseWorkspaceId,
  type CanonicalRevisionToken,
  type CbbDocument,
  type IdPort,
  type LocalResourceId,
  type SchemaObject,
  type Sha256Hash,
} from "@cbb/core";
import {
  createNodeFileSystemPort,
  type DurableFileSystemPort,
} from "../ports/index.js";
import {
  NodeRecoverySnapshotStore,
  RECOVERY_SNAPSHOT_MAX_BYTES,
  RecoverySnapshotStorageError,
  type RecoverySnapshotRecord,
} from "./index.js";

const WORKSPACE_ID = parseWorkspaceId("00000000-0000-4000-8000-000000000001");
const LOCAL_ID = parseLocalResourceId("00000000-0000-4000-8000-000000000002");

const SCHEMAS = [
  "common.schema.json",
  "richText.schema.json",
  "rights.schema.json",
  "element.schema.json",
  "customElement.schema.json",
  "document.schema.json",
  "workspace.schema.json",
  "recovery-snapshot.schema.json",
] as const;

function catalog() {
  const schemas = new Map<string, SchemaObject>();
  for (const name of SCHEMAS) {
    const schema = JSON.parse(
      readFileSync(resolve(process.cwd(), "schemas/v1", name), "utf8"),
    ) as SchemaObject;
    schemas.set(schema.$id, schema);
  }
  return createSchemaCatalog(schemas);
}

function ids(start = 1): IdPort {
  let next = start;
  return {
    randomUuid() {
      return `00000000-0000-4000-8000-${(next++).toString(16).padStart(12, "0")}`;
    },
  };
}

function fixture(): CbbDocument {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), "test/fixtures/full-featured-bulletin.json"), "utf8"),
  ) as CbbDocument;
}

function documentAt(generation: number): CbbDocument {
  const base = fixture();
  return generation === 0 ? base : { ...base, name: `${base.name} recovery ${generation}` };
}

function record(generation: number, document = documentAt(generation)): RecoverySnapshotRecord {
  return {
    version: 1,
    kind: "documentRecoverySnapshot",
    workspaceId: WORKSPACE_ID,
    localResourceId: LOCAL_ID,
    resourceKind: "bulletin",
    editGeneration: generation,
    baseRevisionToken: canonicalRevisionToken(fixture()),
    documentHash: canonicalRevisionToken(document),
    oldestUnsavedEditAt: "2026-07-12T12:00:00.000Z",
    createdAt: `2026-07-12T12:00:0${Math.min(generation, 9)}.000Z`,
    document,
  };
}

async function harness(fileSystem: DurableFileSystemPort = createNodeFileSystemPort()) {
  const root = await mkdtemp(join(tmpdir(), "cbb-recovery-store-"));
  await mkdir(join(root, "transactions", "recovery"), { recursive: true });
  const store = new NodeRecoverySnapshotStore({
    root,
    workspaceId: WORKSPACE_ID,
    fileSystem,
    ids: ids(),
    catalog: catalog(),
  });
  return { root, fileSystem, store };
}

function resourceDirectory(root: string): string {
  return join(root, "transactions", "recovery", LOCAL_ID);
}

describe("NodeRecoverySnapshotStore", () => {
  it("atomically stores at the fixed path and lists generations deterministically", async () => {
    const h = await harness();
    expect((await h.store.flush(record(3))).status).toBe("saved");
    expect((await h.store.flush(record(1))).status).toBe("saved");
    expect((await h.store.flush(record(2))).status).toBe("saved");
    expect((await readdir(resourceDirectory(h.root))).sort()).toEqual([
      "1.json",
      "2.json",
      "3.json",
    ]);
    const listed = await h.store.listValidSnapshots(LOCAL_ID);
    expect(listed.map((candidate) => candidate.record.editGeneration)).toEqual([1, 2, 3]);
    expect(listed.every((candidate) => candidate.relativePath ===
      `transactions/recovery/${LOCAL_ID}/${candidate.record.editGeneration}.json`)).toBe(true);
  });

  it("returns only newer content-different candidates and never changes canonical disk", async () => {
    const h = await harness();
    const canonical = fixture();
    const canonicalPath = join(h.root, "canonical-document.json");
    await writeFile(canonicalPath, canonicalJsonBytes(canonical));
    expect((await h.store.flush(record(1, canonical))).status).toBe("saved");
    expect((await h.store.flush(record(2))).status).toBe("saved");
    expect((await h.store.flush(record(3))).status).toBe("saved");
    const discovered = await h.store.discoverNewerSnapshots(LOCAL_ID, {
      document: canonical,
      revisionToken: canonicalRevisionToken(canonical),
    });
    expect(discovered.validSnapshots).toHaveLength(3);
    expect(discovered.newerCandidates.map((candidate) => candidate.record.editGeneration)).toEqual([
      2,
      3,
    ]);
    expect(new Uint8Array(await readFile(canonicalPath))).toEqual(canonicalJsonBytes(canonical));
  });

  it("rejects hash-mismatched canonical evidence rather than guessing recency", async () => {
    const h = await harness();
    await expect(h.store.discoverNewerSnapshots(LOCAL_ID, {
      document: fixture(),
      revisionToken: `sha256:${"f".repeat(64)}` as CanonicalRevisionToken,
    })).rejects.toThrow("Canonical revision evidence is hash-mismatched");
  });

  it("prunes only snapshots covered by the saved boundary and retains later edits after restart", async () => {
    const h = await harness();
    expect((await h.store.flush(record(1))).status).toBe("saved");
    expect((await h.store.flush(record(2))).status).toBe("saved");
    const savedDocument = documentAt(9);
    const savedRevisionToken = canonicalRevisionToken(savedDocument);
    expect(await h.store.pruneCovered({
      workspaceId: WORKSPACE_ID,
      localResourceId: LOCAL_ID,
      resourceKind: "bulletin",
      previousRevisionToken: canonicalRevisionToken(fixture()),
      savedRevisionToken,
      coveredThroughEditGeneration: 1,
    })).toEqual({
      status: "pruned",
      deletedSnapshots: 1,
      retainedSnapshots: 1,
    });
    expect((await h.store.listValidSnapshots(LOCAL_ID)).map(
      (candidate) => candidate.record.editGeneration,
    )).toEqual([2]);

    const restarted = new NodeRecoverySnapshotStore({
      root: h.root,
      workspaceId: WORKSPACE_ID,
      fileSystem: h.fileSystem,
      ids: ids(100),
      catalog: catalog(),
    });
    const discovery = await restarted.discoverNewerSnapshots(LOCAL_ID, {
      document: savedDocument,
      revisionToken: savedRevisionToken,
    });
    expect(discovery.newerCandidates.map(
      (candidate) => candidate.record.editGeneration,
    )).toEqual([2]);
  });

  it("does not offer an exact covered old snapshot after restart when pruning cannot move it", async () => {
    const base = createNodeFileSystemPort();
    let failCleanupMove = false;
    const faulted: DurableFileSystemPort = {
      ...base,
      async replaceFile(source, destination) {
        if (failCleanupMove && destination.includes(".cleanup-")) {
          throw new Error("injected cleanup move failure");
        }
        await base.replaceFile(source, destination);
      },
    };
    const h = await harness(faulted);
    expect((await h.store.flush(record(1))).status).toBe("saved");
    const savedDocument = documentAt(9);
    const savedRevisionToken = canonicalRevisionToken(savedDocument);
    failCleanupMove = true;
    expect(await h.store.pruneCovered({
      workspaceId: WORKSPACE_ID,
      localResourceId: LOCAL_ID,
      resourceKind: "bulletin",
      previousRevisionToken: canonicalRevisionToken(fixture()),
      savedRevisionToken,
      coveredThroughEditGeneration: 1,
    })).toMatchObject({ status: "failed", detail: "injected cleanup move failure" });
    failCleanupMove = false;

    const restarted = new NodeRecoverySnapshotStore({
      root: h.root,
      workspaceId: WORKSPACE_ID,
      fileSystem: base,
      ids: ids(200),
      catalog: catalog(),
    });
    const discovery = await restarted.discoverNewerSnapshots(LOCAL_ID, {
      document: savedDocument,
      revisionToken: savedRevisionToken,
    });
    expect(discovery.validSnapshots).toHaveLength(1);
    expect(discovery.newerCandidates).toEqual([]);
  });

  it("restores exact snapshot bytes when cleanup unlink fails after the move", async () => {
    const base = createNodeFileSystemPort();
    let failNextCleanupUnlink = false;
    const faulted: DurableFileSystemPort = {
      ...base,
      async removeFile(path) {
        if (failNextCleanupUnlink && path.includes(".cleanup-")) {
          failNextCleanupUnlink = false;
          throw new Error("injected cleanup unlink failure");
        }
        await base.removeFile(path);
      },
    };
    const h = await harness(faulted);
    expect((await h.store.flush(record(1))).status).toBe("saved");
    const before = (await h.store.listValidSnapshots(LOCAL_ID))[0];
    if (before === undefined) throw new Error("candidate missing");
    failNextCleanupUnlink = true;
    const savedDocument = documentAt(9);
    expect(await h.store.pruneCovered({
      workspaceId: WORKSPACE_ID,
      localResourceId: LOCAL_ID,
      resourceKind: "bulletin",
      previousRevisionToken: canonicalRevisionToken(fixture()),
      savedRevisionToken: canonicalRevisionToken(savedDocument),
      coveredThroughEditGeneration: 1,
    })).toMatchObject({
      status: "failed",
      detail: "Covered recovery snapshot changed during exact pruning",
    });
    const after = await h.store.listValidSnapshots(LOCAL_ID);
    expect(after).toHaveLength(1);
    expect(after[0]?.byteHash).toBe(before.byteHash);
    expect((await readdir(resourceDirectory(h.root))).some(
      (name) => name.includes(".cleanup-"),
    )).toBe(false);
  });

  it("is idempotent for identical generations and preserves a differing owner", async () => {
    const h = await harness();
    const first = record(1);
    expect((await h.store.flush(first)).status).toBe("saved");
    expect((await h.store.flush(first)).status).toBe("saved");
    const different = record(1, documentAt(9));
    const conflict = await h.store.flush(different);
    expect(conflict).toMatchObject({
      status: "failed",
      detail: "A different recovery snapshot already owns this edit generation",
    });
    expect((await h.store.listValidSnapshots(LOCAL_ID))[0]?.record.documentHash).toBe(
      first.documentHash,
    );
  });

  it("rejects unrecognized residue and symbolic links", async () => {
    const residue = await harness();
    await mkdir(resourceDirectory(residue.root));
    await writeFile(join(resourceDirectory(residue.root), "note.txt"), "unexpected", "utf8");
    await expect(residue.store.listValidSnapshots(LOCAL_ID)).rejects.toThrow(
      "unrecognized residue",
    );

    const linked = await harness();
    await mkdir(resourceDirectory(linked.root));
    const outside = join(linked.root, "outside.json");
    await writeFile(outside, canonicalJsonBytes(record(1)));
    await symlink(outside, join(resourceDirectory(linked.root), "1.json"));
    await expect(linked.store.listValidSnapshots(LOCAL_ID)).rejects.toThrow(
      "symbolic link",
    );
  });

  it("rejects malformed, schema-invalid, and document-hash-mismatched snapshots", async () => {
    const malformed = await harness();
    await mkdir(resourceDirectory(malformed.root));
    await writeFile(join(resourceDirectory(malformed.root), "1.json"), "{ malformed", "utf8");
    await expect(malformed.store.listValidSnapshots(LOCAL_ID)).rejects.toThrow();

    const mismatched = await harness();
    await mkdir(resourceDirectory(mismatched.root));
    const invalid = {
      ...record(1),
      documentHash: `sha256:${"e".repeat(64)}`,
    };
    await writeFile(
      join(resourceDirectory(mismatched.root), "1.json"),
      canonicalJsonBytes(invalid),
    );
    await expect(mismatched.store.listValidSnapshots(LOCAL_ID)).rejects.toThrow(
      "document hash binding",
    );
  });

  it("enforces the 50 MiB cap before a no-follow read", async () => {
    const baseHarness = await harness();
    expect((await baseHarness.store.flush(record(1))).status).toBe("saved");
    const base = baseHarness.fileSystem;
    let noFollowReads = 0;
    const overCap: DurableFileSystemPort = {
      ...base,
      async entryInfo(path) {
        const info = await base.entryInfo(path);
        if (info?.kind === "file" && path.endsWith("/1.json")) {
          return { ...info, size: RECOVERY_SNAPSHOT_MAX_BYTES + 1 };
        }
        return info;
      },
      async readFileNoFollow(path, maximumBytes) {
        noFollowReads++;
        return base.readFileNoFollow(path, maximumBytes);
      },
    };
    const store = new NodeRecoverySnapshotStore({
      root: baseHarness.root,
      workspaceId: WORKSPACE_ID,
      fileSystem: overCap,
      ids: ids(100),
      catalog: catalog(),
    });
    await expect(store.listValidSnapshots(LOCAL_ID)).rejects.toThrow("50 MiB cap");
    expect(noFollowReads).toBe(0);

    const exactCap: DurableFileSystemPort = {
      ...base,
      async entryInfo(path) {
        const info = await base.entryInfo(path);
        return info?.kind === "file" && path.endsWith("/1.json")
          ? { ...info, size: RECOVERY_SNAPSHOT_MAX_BYTES }
          : info;
      },
    };
    const exactStore = new NodeRecoverySnapshotStore({
      root: baseHarness.root,
      workspaceId: WORKSPACE_ID,
      fileSystem: exactCap,
      ids: ids(200),
      catalog: catalog(),
    });
    await expect(exactStore.listValidSnapshots(LOCAL_ID)).resolves.toHaveLength(1);
  });

  it("cleans an exact accepted/discarded candidate and preserves changed bytes", async () => {
    const h = await harness();
    expect((await h.store.flush(record(1))).status).toBe("saved");
    const candidate = (await h.store.listValidSnapshots(LOCAL_ID))[0];
    if (candidate === undefined) throw new Error("candidate missing");
    expect(await h.store.cleanupExact({
      localResourceId: LOCAL_ID,
      editGeneration: 1,
      expectedByteHash: `sha256:${"0".repeat(64)}` as Sha256Hash,
      disposition: "discarded",
    })).toBe("changed");
    expect(await h.store.cleanupExact({
      localResourceId: LOCAL_ID,
      editGeneration: 1,
      expectedByteHash: candidate.byteHash,
      disposition: "accepted",
    })).toBe("deleted");
    expect(await h.store.cleanupExact({
      localResourceId: LOCAL_ID,
      editGeneration: 1,
      expectedByteHash: candidate.byteHash,
      disposition: "accepted",
    })).toBe("missing");
  });

  it("re-verifies after the cleanup rename and restores a candidate changed in flight", async () => {
    const base = createNodeFileSystemPort();
    let mutateMoved = false;
    const faulted: DurableFileSystemPort = {
      ...base,
      async replaceFile(source, destination) {
        await base.replaceFile(source, destination);
        if (mutateMoved && destination.includes(".cleanup-")) {
          await writeFile(destination, canonicalJsonBytes(record(1, documentAt(9))));
        }
      },
    };
    const h = await harness(faulted);
    expect((await h.store.flush(record(1))).status).toBe("saved");
    const candidate = (await h.store.listValidSnapshots(LOCAL_ID))[0];
    if (candidate === undefined) throw new Error("candidate missing");
    mutateMoved = true;
    expect(await h.store.cleanupExact({
      localResourceId: LOCAL_ID,
      editGeneration: 1,
      expectedByteHash: candidate.byteHash,
      disposition: "discarded",
    })).toBe("changed");
    const restored = await h.store.listValidSnapshots(LOCAL_ID);
    expect(restored).toHaveLength(1);
    expect(restored[0]?.byteHash).not.toBe(candidate.byteHash);
  });

  it("fails safely on an interrupted atomic replace and leaves no accepted snapshot", async () => {
    const base = createNodeFileSystemPort();
    const faulted: DurableFileSystemPort = {
      ...base,
      async replaceFile(source, destination) {
        if (destination.endsWith("/1.json")) throw new Error("injected replace failure");
        await base.replaceFile(source, destination);
      },
    };
    const h = await harness(faulted);
    const result = await h.store.flush(record(1));
    expect(result).toMatchObject({ status: "failed", detail: "injected replace failure" });
    expect(await readdir(resourceDirectory(h.root))).toEqual([]);
    expect(await h.store.listValidSnapshots(LOCAL_ID)).toEqual([]);
  });

  it("uses no-follow reads for every discovered snapshot", async () => {
    const base = createNodeFileSystemPort();
    let noFollowReads = 0;
    const observed: DurableFileSystemPort = {
      ...base,
      async readFileNoFollow(path, maximumBytes) {
        noFollowReads++;
        return base.readFileNoFollow(path, maximumBytes);
      },
    };
    const h = await harness(observed);
    expect((await h.store.flush(record(1))).status).toBe("saved");
    noFollowReads = 0;
    await h.store.listValidSnapshots(LOCAL_ID);
    expect(noFollowReads).toBe(1);
  });

  it("rejects invalid ids and generation filename residue", async () => {
    const h = await harness();
    await expect(
      h.store.listValidSnapshots("../../escape" as LocalResourceId),
    ).rejects.toBeInstanceOf(RecoverySnapshotStorageError);
    await mkdir(resourceDirectory(h.root));
    await writeFile(join(resourceDirectory(h.root), "01.json"), canonicalJsonBytes(record(1)));
    await expect(h.store.listValidSnapshots(LOCAL_ID)).rejects.toThrow("unrecognized residue");
  });
});
