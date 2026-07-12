import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalStringify,
  createSchemaCatalog,
  type IdPort,
  type SchemaObject,
} from "@cbb/core";
import {
  createNodeFileSystemPort,
  type DurableFileSystemPort,
  type ServicePorts,
} from "../ports/index.js";
import { SaveJournalRecoveryService } from "../persistence/index.js";
import {
  CHURCH_PROFILE_PATH,
  WORKSPACE_SETTINGS_PATH,
  WorkspacePreferencesService,
  WorkspaceService,
  type ChurchProfile,
  type EditableWorkspaceSession,
  type WorkspaceSettings,
} from "./index.js";

const SCHEMAS = [
  "common.schema.json",
  "richText.schema.json",
  "rights.schema.json",
  "element.schema.json",
  "customElement.schema.json",
  "document.schema.json",
  "workspace.schema.json",
  "settings.schema.json",
  "church-profile.schema.json",
  "workspace-lock.schema.json",
  "save-journal.schema.json",
  "conflict-record.schema.json",
] as const;

function catalog() {
  const result = new Map<string, SchemaObject>();
  for (const name of SCHEMAS) {
    const schema = JSON.parse(
      readFileSync(resolve(process.cwd(), "schemas/v1", name), "utf8"),
    ) as SchemaObject;
    result.set(schema.$id, schema);
  }
  return createSchemaCatalog(result);
}

function ids(start = 1): IdPort {
  let current = start;
  return {
    randomUuid() {
      return `00000000-0000-4000-8000-${(current++).toString(16).padStart(12, "0")}`;
    },
  };
}

function servicePorts(
  fileSystem: DurableFileSystemPort = createNodeFileSystemPort(),
  idPort: IdPort = ids(),
): ServicePorts {
  return {
    fileSystem,
    ids: idPort,
    clock: { now: () => new Date("2026-07-12T12:00:00.000Z") },
    scheduler: {
      setInterval: () => ({ timer: true }),
      clearInterval: () => undefined,
    },
    processIdentity: {
      current: () => ({
        pid: 123,
        hostUserDiscriminator: `sha256:${"a".repeat(64)}`,
        processStartedAt: "2026-07-12T11:00:00.000Z",
      }),
      check: async () => "notLive",
    },
  };
}

async function createAt(
  root: string,
  ports: ServicePorts = servicePorts(),
  initial?: { settings?: WorkspaceSettings; churchProfile?: ChurchProfile },
) {
  const schemas = catalog();
  const workspace = new WorkspaceService(
    ports,
    schemas,
    new SaveJournalRecoveryService(ports, schemas),
    "0.0.0-test",
  );
  const result = await workspace.create({
    root,
    displayName: "Onboarding Test",
    ...(initial?.settings === undefined ? {} : { settings: initial.settings }),
    ...(initial?.churchProfile === undefined
      ? {}
      : { churchProfile: initial.churchProfile }),
  });
  return { result, schemas, workspace, ports };
}

async function newRoot(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "cbb-onboarding-")), "workspace");
}

function editable(result: Awaited<ReturnType<WorkspaceService["create"]>>) {
  expect(result.status).toBe("editable");
  return (result as { status: "editable"; session: EditableWorkspaceSession }).session;
}

function deferred() {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => { resolvePromise = resolve; });
  return {
    promise,
    resolve() {
      if (resolvePromise === undefined) throw new Error("Deferred promise is unavailable");
      resolvePromise();
    },
  };
}

describe("workspace onboarding and preferences", () => {
  it("stages beside and safely adopts an already-existing empty directory", async () => {
    const root = await newRoot();
    await mkdir(root);
    const settings: WorkspaceSettings = {
      version: 1,
      kind: "workspaceSettings",
      defaultExportFormat: "bookletTwoUp",
      snapGridSize: "0.125in",
      previewResolution: 144,
    };
    const churchProfile: ChurchProfile = {
      version: 1,
      kind: "churchProfile",
      congregationName: "Lamb of God",
      language: "en-US",
      defaultPublicationContexts: ["printedNonsalableChurchBulletin"],
      schedules: [{
        id: "00000000-0000-4000-8000-000000000099",
        label: "Sunday",
        enabled: true,
        dayOfWeek: 0,
      }],
    };
    const created = await createAt(root, servicePorts(), { settings, churchProfile });
    const session = editable(created.result);
    expect(JSON.parse(await readFile(join(root, WORKSPACE_SETTINGS_PATH), "utf8"))).toEqual(settings);
    expect(JSON.parse(await readFile(join(root, CHURCH_PROFILE_PATH), "utf8"))).toEqual(churchProfile);
    await session.lease.release();
  });

  it("never overwrites a nonempty chosen directory", async () => {
    const root = await newRoot();
    await mkdir(root);
    await writeFile(join(root, "keep.txt"), "user data", "utf8");
    const created = await createAt(root);
    expect(created.result.status).toBe("failed");
    expect(await readFile(join(root, "keep.txt"), "utf8")).toBe("user data");
  });

  it("fails the empty-directory CAS if content appears during staging", async () => {
    const root = await newRoot();
    await mkdir(root);
    const base = createNodeFileSystemPort();
    const racing: DurableFileSystemPort = {
      ...base,
      async removeEmptyDirectory(path) {
        if (path === root) await writeFile(join(root, "appeared.txt"), "race", "utf8");
        return base.removeEmptyDirectory(path);
      },
    };
    const created = await createAt(root, servicePorts(racing));
    expect(created.result.status).toBe("failed");
    expect(await readFile(join(root, "appeared.txt"), "utf8")).toBe("race");
  });

  it("does not overwrite a nonempty directory that races the final rename", async () => {
    const root = await newRoot();
    await mkdir(root);
    const base = createNodeFileSystemPort();
    const racing: DurableFileSystemPort = {
      ...base,
      async removeEmptyDirectory(path) {
        const removed = await base.removeEmptyDirectory(path);
        if (path === root && removed) {
          await mkdir(root);
          await writeFile(join(root, "won-race.txt"), "other owner", "utf8");
        }
        return removed;
      },
    };
    const created = await createAt(root, servicePorts(racing));
    expect(created.result.status).toBe("failed");
    expect(await readFile(join(root, "won-race.txt"), "utf8")).toBe("other owner");
  });

  it("loads, atomically saves, and detects stale settings hashes", async () => {
    const root = await newRoot();
    const created = await createAt(root);
    const session = editable(created.result);
    const preferences = new WorkspacePreferencesService(created.ports, created.schemas);
    const loaded = await preferences.loadSettings(session);
    expect(loaded.status).toBe("loaded");
    if (loaded.status !== "loaded") return;
    const updated: WorkspaceSettings = {
      version: 1,
      kind: "workspaceSettings",
      defaultExportFormat: "readerOrder",
      previewResolution: 192,
    };
    const saved = await preferences.saveSettings({
      session,
      value: updated,
      baseHash: loaded.hash,
    });
    expect(saved.status).toBe("saved");
    expect(JSON.parse(await readFile(join(root, WORKSPACE_SETTINGS_PATH), "utf8"))).toEqual(updated);
    const stale = await preferences.saveSettings({
      session,
      value: { ...updated, previewResolution: 300 },
      baseHash: loaded.hash,
    });
    expect(stale.status).toBe("conflicted");
    expect(JSON.parse(await readFile(join(root, WORKSPACE_SETTINGS_PATH), "utf8"))).toEqual(updated);
    await session.lease.release();
  });

  it("creates an optional Profile and preserves an external valid change on conflict", async () => {
    const root = await newRoot();
    const created = await createAt(root);
    const session = editable(created.result);
    const preferences = new WorkspacePreferencesService(created.ports, created.schemas);
    const absent = await preferences.loadChurchProfile(session);
    expect(absent).toEqual({ status: "loaded", value: null, hash: null });
    const ours: ChurchProfile = {
      version: 1,
      kind: "churchProfile",
      congregationName: "Our Church",
    };
    const saved = await preferences.saveChurchProfile({ session, value: ours, baseHash: null });
    expect(saved.status).toBe("saved");
    if (saved.status !== "saved") return;
    const external: ChurchProfile = {
      version: 1,
      kind: "churchProfile",
      congregationName: "External Church",
    };
    await writeFile(join(root, CHURCH_PROFILE_PATH), canonicalStringify(external), "utf8");
    const conflict = await preferences.saveChurchProfile({
      session,
      value: { ...ours, language: "en-US" },
      baseHash: saved.hash,
    });
    expect(conflict.status).toBe("conflicted");
    expect(JSON.parse(await readFile(join(root, CHURCH_PROFILE_PATH), "utf8"))).toEqual(external);
    await session.lease.release();
  });

  it("fails closed for invalid/secret input and invalid durable preference files", async () => {
    const root = await newRoot();
    const created = await createAt(root);
    const session = editable(created.result);
    const preferences = new WorkspacePreferencesService(created.ports, created.schemas);
    const loaded = await preferences.loadSettings(session);
    if (loaded.status !== "loaded") throw new Error("settings should load");
    const secret = await preferences.saveSettings({
      session,
      value: {
        version: 1,
        kind: "workspaceSettings",
        apiToken: "must-not-persist",
      } as unknown as WorkspaceSettings,
      baseHash: loaded.hash,
    });
    expect(secret.status).toBe("failed");
    expect(await readFile(join(root, WORKSPACE_SETTINGS_PATH), "utf8")).not.toContain(
      "must-not-persist",
    );

    await writeFile(join(root, WORKSPACE_SETTINGS_PATH), "{ malformed", "utf8");
    const invalidDisk = await preferences.saveSettings({
      session,
      value: { version: 1, kind: "workspaceSettings" },
      baseHash: loaded.hash,
    });
    expect(invalidDisk.status).toBe("readOnly");
    expect(await readFile(join(root, WORKSPACE_SETTINGS_PATH), "utf8")).toBe("{ malformed");
    await session.lease.release();
  });

  it("returns read-only without writing when the workspace has no edit lease", async () => {
    const root = await newRoot();
    const created = await createAt(root);
    const editSession = editable(created.result);
    await editSession.lease.release();
    const opened = await created.workspace.open(root, { mode: "readOnly" });
    expect(opened.status).toBe("readOnly");
    if (opened.status !== "readOnly") return;
    const preferences = new WorkspacePreferencesService(created.ports, created.schemas);
    const before = await readFile(join(root, WORKSPACE_SETTINGS_PATH), "utf8");
    const result = await preferences.saveSettings({
      session: opened.session,
      value: { version: 1, kind: "workspaceSettings", previewResolution: 200 },
      baseHash: null,
    });
    expect(result.status).toBe("readOnly");
    expect(await readFile(join(root, WORKSPACE_SETTINGS_PATH), "utf8")).toBe(before);
  });

  it("serializes writers so two callers with one base cannot both commit", async () => {
    const root = await newRoot();
    const created = await createAt(root);
    const session = editable(created.result);
    const initialService = new WorkspacePreferencesService(created.ports, created.schemas);
    const loaded = await initialService.loadSettings(session);
    if (loaded.status !== "loaded") throw new Error("settings should load");

    const base = created.ports.fileSystem;
    const reachedReplace = deferred();
    const releaseReplace = deferred();
    let blocked = false;
    const delayed: DurableFileSystemPort = {
      ...base,
      async replaceFile(source, destination) {
        if (!blocked && destination === join(root, WORKSPACE_SETTINGS_PATH)) {
          blocked = true;
          reachedReplace.resolve();
          await releaseReplace.promise;
        }
        await base.replaceFile(source, destination);
      },
    };
    const preferences = new WorkspacePreferencesService(
      servicePorts(delayed, ids(500)),
      created.schemas,
    );
    const first = preferences.saveSettings({
      session,
      value: { version: 1, kind: "workspaceSettings", previewResolution: 100 },
      baseHash: loaded.hash,
    });
    await reachedReplace.promise;
    const second = preferences.saveSettings({
      session,
      value: { version: 1, kind: "workspaceSettings", previewResolution: 200 },
      baseHash: loaded.hash,
    });
    releaseReplace.resolve();
    expect((await first).status).toBe("saved");
    expect((await second).status).toBe("conflicted");
    expect(JSON.parse(await readFile(join(root, WORKSPACE_SETTINGS_PATH), "utf8"))).toMatchObject({
      previewResolution: 100,
    });
    await session.lease.release();
  });
});
