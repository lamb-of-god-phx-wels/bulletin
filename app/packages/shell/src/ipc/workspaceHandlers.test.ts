import { readFileSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  canonicalRevisionToken,
  canonicalStringify,
  createSchemaCatalog,
  fromJson,
  hashBytes,
  type SchemaObject,
} from "@cbb/core";
import type { ArtifactRecord, ArtifactStoragePort, BuildQueueState } from "@cbb/services";
import type { M3EditableWorkspace, M3ReadOnlyWorkspace } from "../composition.js";
import { M4_IPC_LIMITS, type M4EditBufferValue, type M4JsonValue } from "./contract.js";
import type { M4AuxiliaryRendererHandlers } from "./workspaceHandlers.js";
import { M4WorkspaceRendererHandlers } from "./workspaceHandlers.js";

const ID = "10000000-0000-4000-8000-000000000001";
const NEW_ID = "10000000-0000-4000-8000-000000000002";
const BUILD = "20000000-0000-4000-8000-000000000001";
const WORKSPACE_ID = "30000000-0000-4000-8000-000000000001";

function catalog() {
  const directory = resolve(process.cwd(), "schemas/v1");
  const schemas = new Map<string, SchemaObject>();
  for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".json"))) {
    const schema = JSON.parse(readFileSync(join(directory, name), "utf8")) as SchemaObject;
    schemas.set(schema.$id, schema);
  }
  return createSchemaCatalog(schemas);
}

const auxiliary: M4AuxiliaryRendererHandlers = {
  async readEditBuffer() { return null; },
  async writeEditBuffer(_id, _key, value) { return { value, updatedAt: "2026-07-12T12:00:00.000Z" }; },
  async deleteEditBuffer() { return false; },
  async readAppSettings() { return { version: 1, kind: "globalSettings" }; },
  async writeAppSettings(value) { return value; },
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "cbb-m4-workspace-handlers-"));
  const sourceDocument = JSON.parse(readFileSync(
    resolve(process.cwd(), "test/fixtures/minimal-bulletin.json"),
    "utf8",
  ));
  const document = fromJson(sourceDocument, catalog());
  const revision = canonicalRevisionToken(sourceDocument);
  const registry = {
    version: 1,
    kind: "workspace",
    workspaceId: WORKSPACE_ID,
    bulletins: [{
      localId: ID,
      kind: "bulletin",
      displayName: "Sunday Worship",
      storagePath: `bulletins/${ID}/document.json`,
      contentHash: revision,
      createdAt: "2026-07-12T10:00:00.000Z",
      modifiedAt: "2026-07-12T12:00:00.000Z",
    }],
    templates: [],
    assets: [],
    fonts: [],
    songs: [],
    scriptureCatalog: [],
    resourcePacks: [],
    importProvenance: [],
    installedPackState: [],
    sharedLibraryConnections: [],
    scriptureProviderConfig: [],
    packMaintainerDrafts: [],
  };
  await mkdir(join(root, "bulletins", ID), { recursive: true });
  await writeFile(join(root, "workspace.json"), canonicalStringify(registry));
  await writeFile(
    join(root, "bulletins", ID, "document.json"),
    canonicalStringify(sourceDocument),
  );
  const save = vi.fn(async (request: { document: unknown }) => ({
    status: "saved" as const,
    revisionToken: canonicalRevisionToken(request.document),
    registry,
  }));
  const workspace = {
    root,
    registry,
    documents: { save },
  } as unknown as M3EditableWorkspace;
  return { root, document, sourceDocument, revision, registry, save, workspace };
}

describe("M3 workspace renderer handlers", () => {
  it("refuses the first-launch location chooser after managed content exists", async () => {
    const value = await fixture();
    const chooseWorkspaceLocation = vi.fn(async () => ({ status: "restarting" as const }));
    const handlers = new M4WorkspaceRendererHandlers({
      workspace: value.workspace,
      catalog: catalog(),
      auxiliary,
      chooseWorkspaceLocation,
      artifactStorage: Promise.resolve({} as ArtifactStoragePort),
    });

    await expect(handlers.chooseWorkspaceLocation()).resolves.toMatchObject({
      status: "unavailable",
      message: expect.stringMatching(/before anything is added/u),
    });
    expect(chooseWorkspaceLocation).not.toHaveBeenCalled();
  });

  it("delegates an empty first-launch library to the host-owned path-free chooser", async () => {
    const value = await fixture();
    await writeFile(join(value.root, "workspace.json"), canonicalStringify({
      ...value.registry,
      bulletins: [],
    }));
    const chooseWorkspaceLocation = vi.fn(async () => ({ status: "restarting" as const }));
    const handlers = new M4WorkspaceRendererHandlers({
      workspace: value.workspace,
      catalog: catalog(),
      auxiliary,
      chooseWorkspaceLocation,
      artifactStorage: Promise.resolve({} as ArtifactStoragePort),
    });

    await expect(handlers.chooseWorkspaceLocation()).resolves.toEqual({ status: "restarting" });
    expect(chooseWorkspaceLocation).toHaveBeenCalledOnce();
  });

  it("reports image import capability honestly and delegates only in an editable workspace", async () => {
    const value = await fixture();
    const unavailable = new M4WorkspaceRendererHandlers({
      workspace: value.workspace,
      catalog: catalog(),
      auxiliary,
    });
    await expect(unavailable.importImageAsset()).resolves.toEqual({
      status: "unavailable",
      message: "Image import is unavailable in this installation.",
    });

    const importImageAsset = vi.fn(async () => ({ status: "canceled" as const }));
    const available = new M4WorkspaceRendererHandlers({
      workspace: value.workspace,
      catalog: catalog(),
      auxiliary,
      importImageAsset,
    });
    await expect(available.importImageAsset()).resolves.toEqual({ status: "canceled" });
    expect(importImageAsset).toHaveBeenCalledOnce();
  });

  it("lists and loads only path-free verified document data", async () => {
    const value = await fixture();
    const handlers = new M4WorkspaceRendererHandlers({
      workspace: value.workspace,
      catalog: catalog(),
      auxiliary,
      artifactStorage: Promise.resolve({} as ArtifactStoragePort),
    });
    const rows = await handlers.listDocuments("all");
    expect(rows).toEqual([{
      localResourceId: ID,
      resourceKind: "bulletin",
      displayName: "Sunday Worship",
      modifiedAt: "2026-07-12T12:00:00.000Z",
      revisionToken: value.revision,
    }]);
    expect(JSON.stringify(rows)).not.toContain("bulletins/");
    await expect(handlers.loadDocument(ID)).resolves.toMatchObject({
      localResourceId: ID,
      modifiedAt: "2026-07-12T12:00:00.000Z",
      revisionToken: value.revision,
      document: value.document,
    });
  });

  it("allows edit buffers only for documents owned by the current registry", async () => {
    const value = await fixture();
    const guardedAuxiliary = {
      ...auxiliary,
      readEditBuffer: vi.fn(auxiliary.readEditBuffer),
      writeEditBuffer: vi.fn(auxiliary.writeEditBuffer),
      deleteEditBuffer: vi.fn(auxiliary.deleteEditBuffer),
    };
    const handlers = new M4WorkspaceRendererHandlers({
      workspace: value.workspace,
      catalog: catalog(),
      auxiliary: guardedAuxiliary,
      artifactStorage: Promise.resolve({} as ArtifactStoragePort),
    });

    await expect(handlers.writeEditBuffer(ID, "inspector.title", "unfinished"))
      .resolves.toMatchObject({ value: "unfinished" });
    await expect(handlers.readEditBuffer(NEW_ID, "inspector.title"))
      .rejects.toMatchObject({ code: "notFound" });
    await expect(handlers.deleteEditBuffer(NEW_ID, "inspector.title"))
      .rejects.toMatchObject({ code: "notFound" });
    expect(guardedAuxiliary.writeEditBuffer).toHaveBeenCalledTimes(1);
    expect(guardedAuxiliary.readEditBuffer).not.toHaveBeenCalled();
    expect(guardedAuxiliary.deleteEditBuffer).not.toHaveBeenCalled();
  });

  it("keeps only a bounded LRU of full conflict-base documents", async () => {
    const value = await fixture();
    const ids = Array.from(
      { length: M4_IPC_LIMITS.maximumLoadedDocumentBases + 1 },
      (_, index) => `10000000-0000-4000-8000-${(index + 11).toString().padStart(12, "0")}`,
    );
    const records = [];
    for (const [index, localId] of ids.entries()) {
      const document = { ...value.document, name: `Bulletin ${index + 1}` };
      records.push({
        localId,
        kind: "bulletin",
        displayName: document.name,
        storagePath: `bulletins/${localId}/document.json`,
        contentHash: canonicalRevisionToken(document),
        createdAt: "2026-07-12T10:00:00.000Z",
        modifiedAt: "2026-07-12T12:00:00.000Z",
      });
      await mkdir(join(value.root, "bulletins", localId), { recursive: true });
      await writeFile(join(value.root, "bulletins", localId, "document.json"), canonicalStringify(document));
    }
    await writeFile(join(value.root, "workspace.json"), canonicalStringify({
      ...value.registry,
      bulletins: records,
    }));
    const handlers = new M4WorkspaceRendererHandlers({
      workspace: value.workspace,
      catalog: catalog(),
      auxiliary,
      artifactStorage: Promise.resolve({} as ArtifactStoragePort),
    });
    for (const localId of ids) await handlers.loadDocument(localId);

    const bases = (handlers as unknown as { readonly loadedBases: ReadonlyMap<string, unknown> }).loadedBases;
    expect(bases.size).toBe(M4_IPC_LIMITS.maximumLoadedDocumentBases);
    expect(bases.has(ids[0]!)).toBe(false);
    expect(bases.has(ids.at(-1)!)).toBe(true);
  });

  it("opens a locked workspace for safe reading while refusing mutations", async () => {
    const value = await fixture();
    const guardedAuxiliary = {
      ...auxiliary,
      writeEditBuffer: vi.fn(auxiliary.writeEditBuffer),
      deleteEditBuffer: vi.fn(auxiliary.deleteEditBuffer),
    };
    const readOnly = {
      mode: "readOnly",
      root: value.root,
      registry: value.registry,
      reason: "liveLock",
      diagnostics: [],
    } as unknown as M3ReadOnlyWorkspace;
    const handlers = new M4WorkspaceRendererHandlers({
      workspace: readOnly,
      catalog: catalog(),
      auxiliary: guardedAuxiliary,
    });

    await expect(handlers.readBootstrapState()).resolves.toEqual({ workspaceAccess: "readOnly" });
    await expect(handlers.listDocuments("all")).resolves.toHaveLength(1);
    await expect(handlers.loadDocument(ID)).resolves.toMatchObject({ localResourceId: ID });
    await expect(handlers.saveDocument({
      localResourceId: ID,
      resourceKind: "bulletin",
      displayName: "Changed",
      document: { ...value.document, name: "Changed" },
      baseRevisionToken: value.revision,
    })).resolves.toMatchObject({ status: "failed", message: expect.stringMatching(/read-only/i) });
    await expect(handlers.readEditBuffer(ID, "inspector.title")).resolves.toBeNull();
    await expect(handlers.writeEditBuffer(ID, "inspector.title", "unfinished"))
      .rejects.toMatchObject({ code: "unavailable" });
    await expect(handlers.deleteEditBuffer(ID, "inspector.title")).resolves.toBe(false);
    await expect(handlers.setEditBufferSaveState(ID, "pending"))
      .rejects.toMatchObject({ code: "unavailable" });
    await expect(handlers.readChurchProfile()).rejects.toMatchObject({ code: "unavailable" });
    await expect(handlers.writeChurchProfile({
      version: 1,
      kind: "churchProfile",
      congregationName: "Lamb of God",
    }, null)).resolves.toMatchObject({ status: "readOnly" });
    await expect(handlers.importImageAsset()).resolves.toMatchObject({ status: "readOnly" });
    expect(guardedAuxiliary.writeEditBuffer).not.toHaveBeenCalled();
    expect(guardedAuxiliary.deleteEditBuffer).not.toHaveBeenCalled();
  });

  it("can read an injected Church Profile in a locked workspace but never writes it", async () => {
    const value = await fixture();
    const profile = {
      version: 1 as const,
      kind: "churchProfile" as const,
      congregationName: "Lamb of God",
    };
    const readOnly = {
      mode: "readOnly",
      root: value.root,
      registry: value.registry,
      reason: "liveLock",
      diagnostics: [],
    } as unknown as M3ReadOnlyWorkspace;
    const loadChurchProfile = vi.fn(async () => ({
      status: "loaded" as const,
      value: profile,
      hash: value.revision,
    }));
    const handlers = new M4WorkspaceRendererHandlers({
      workspace: readOnly,
      catalog: catalog(),
      auxiliary,
      readOnlyPreferences: {
        async loadSettings() {
          return {
            status: "loaded" as const,
            value: { version: 1 as const, kind: "workspaceSettings" as const },
            hash: value.revision,
          };
        },
        async saveSettings() { return { status: "readOnly" as const, diagnostics: [] }; },
        loadChurchProfile,
      },
    });

    await expect(handlers.readChurchProfile()).resolves.toEqual({
      value: profile,
      revisionToken: value.revision,
    });
    await expect(handlers.writeChurchProfile(profile, value.revision))
      .resolves.toEqual({ status: "readOnly", message: "This bulletin library is open read-only." });
    expect(loadChurchProfile).toHaveBeenCalledOnce();
  });

  it("round-trips M3 workspace settings with an exact conflict token", async () => {
    const value = await fixture();
    const settings = {
      version: 1 as const,
      kind: "workspaceSettings" as const,
      scope: "workspace" as const,
      viewMode: "page" as const,
      pagePresentation: "facing" as const,
      previewZoom: "fitPage" as const,
      marginGuides: true,
      livePreview: true,
      technicalPdfDetails: false,
      canvasSnap: true,
      snapGridSize: "0.125in",
      exportFilenamePattern: "{date:YYYY-MM-DD} {name}.pdf",
      offlineSpellcheck: true,
      displayTimeZone: "America/Phoenix",
      defaultExportFormat: "readerOrder" as const,
      previewResolution: 144,
    };
    const settingsRevision = `sha256:${"b".repeat(64)}` as const;
    const saveSettings = vi.fn(async () => ({
      status: "saved" as const,
      value: settings,
      hash: settingsRevision,
    }));
    const workspace = {
      ...value.workspace,
      preferences: {
        async loadSettings() {
          return { status: "loaded" as const, value: settings, hash: settingsRevision };
        },
        saveSettings,
      },
    } as unknown as M3EditableWorkspace;
    const handlers = new M4WorkspaceRendererHandlers({
      workspace,
      catalog: catalog(),
      auxiliary,
    });

    await expect(handlers.readWorkspaceSettings()).resolves.toEqual({
      value: settings,
      revisionToken: settingsRevision,
    });
    await expect(handlers.writeWorkspaceSettings(settings, settingsRevision))
      .resolves.toEqual({ status: "saved", value: settings, revisionToken: settingsRevision });
    expect(saveSettings).toHaveBeenCalledWith(settings, settingsRevision);

    workspace.preferences.saveSettings = vi.fn(async () => ({
      status: "conflicted" as const,
      diskHash: value.revision,
      diagnostics: [],
    }));
    await expect(handlers.writeWorkspaceSettings(settings, settingsRevision)).resolves.toEqual({
      status: "conflicted",
      currentRevisionToken: value.revision,
      message: "These settings changed elsewhere, so they were not overwritten.",
    });
  });

  it("round-trips the optional Church Profile with nullable exact conflict tokens", async () => {
    const value = await fixture();
    const profile = {
      version: 1 as const,
      kind: "churchProfile" as const,
      congregationName: "Lamb of God",
      language: "en-US",
      defaultPublicationContexts: ["printedNonsalableChurchBulletin"] as const,
      defaultUnknownRightsPolicy: "review" as const,
      schedules: [{
        id: "50000000-0000-4000-8000-000000000001",
        label: "Sunday worship",
        enabled: true,
        dayOfWeek: 0,
      }],
    };
    const profileRevision = value.revision;
    const loadChurchProfile = vi.fn(async () => ({
      status: "loaded" as const,
      value: null,
      hash: null,
    }));
    const saveChurchProfile = vi.fn(async () => ({
      status: "saved" as const,
      value: profile,
      hash: profileRevision,
    }));
    const workspace = {
      ...value.workspace,
      preferences: {
        loadChurchProfile,
        saveChurchProfile,
      },
    } as unknown as M3EditableWorkspace;
    const handlers = new M4WorkspaceRendererHandlers({
      workspace,
      catalog: catalog(),
      auxiliary,
    });

    await expect(handlers.readChurchProfile()).resolves.toEqual({
      value: null,
      revisionToken: null,
    });
    await expect(handlers.writeChurchProfile(profile, null)).resolves.toEqual({
      status: "saved",
      value: profile,
      revisionToken: profileRevision,
    });
    expect(saveChurchProfile).toHaveBeenCalledWith(profile, null);

    workspace.preferences.saveChurchProfile = vi.fn(async () => ({
      status: "conflicted" as const,
      diskHash: profileRevision,
      diagnostics: [],
    }));
    await expect(handlers.writeChurchProfile(profile, profileRevision)).resolves.toEqual({
      status: "conflicted",
      currentRevisionToken: profileRevision,
      message: "Church Profile changed elsewhere, so it was not overwritten.",
    });
  });

  it("tracks renderer dirty/saving states and clears the close blocker only when clean", async () => {
    const value = await fixture();
    const handlers = new M4WorkspaceRendererHandlers({
      workspace: value.workspace,
      catalog: catalog(),
      auxiliary,
    });
    expect(handlers.hasRendererShutdownBlockers()).toBe(false);
    await handlers.setDocumentSaveState(ID, "dirty");
    expect(handlers.hasRendererShutdownBlockers()).toBe(true);
    await handlers.setDocumentSaveState(ID, "saving");
    expect(handlers.hasRendererShutdownBlockers()).toBe(true);
    await handlers.setDocumentSaveState(ID, "saveFailed");
    expect(handlers.hasRendererShutdownBlockers()).toBe(true);
    await handlers.setDocumentSaveState(ID, "clean");
    expect(handlers.hasRendererShutdownBlockers()).toBe(false);
    await expect(handlers.setDocumentSaveState(NEW_ID, "dirty"))
      .rejects.toMatchObject({ code: "notFound" });
  });

  it("tracks inspector durability independently from document autosave state", async () => {
    const value = await fixture();
    const handlers = new M4WorkspaceRendererHandlers({
      workspace: value.workspace,
      catalog: catalog(),
      auxiliary,
    });
    await expect(handlers.readBootstrapState()).resolves.toEqual({ workspaceAccess: "readWrite" });
    await handlers.setEditBufferSaveState(ID, "pending");
    await handlers.setDocumentSaveState(ID, "clean");
    expect(handlers.hasRendererShutdownBlockers()).toBe(true);
    await handlers.setEditBufferSaveState(ID, "failed");
    expect(handlers.hasRendererShutdownBlockers()).toBe(true);
    await handlers.setEditBufferSaveState(ID, "clean");
    expect(handlers.hasRendererShutdownBlockers()).toBe(false);
  });

  it("keeps quit blocked when an inspector recovery write fails", async () => {
    const value = await fixture();
    const handlers = new M4WorkspaceRendererHandlers({
      workspace: value.workspace,
      catalog: catalog(),
      auxiliary: {
        ...auxiliary,
        async writeEditBuffer() {
          throw new Error("disk unavailable");
        },
      },
    });
    await expect(handlers.writeEditBuffer(ID, "inspector.title", "unfinished"))
      .rejects.toThrow("disk unavailable");
    expect(handlers.hasRendererShutdownBlockers()).toBe(true);
    await handlers.setDocumentSaveState(ID, "clean");
    expect(handlers.hasRendererShutdownBlockers()).toBe(true);
  });

  it("blocks quit for the full duration of an in-flight durable inspector write", async () => {
    const value = await fixture();
    let finish!: () => void;
    const writeEditBuffer = vi.fn(() => new Promise<M4EditBufferValue>((resolve) => {
      finish = () => resolve({ value: "unfinished", updatedAt: "2026-07-13T01:00:00.000Z" });
    }));
    const handlers = new M4WorkspaceRendererHandlers({
      workspace: value.workspace,
      catalog: catalog(),
      auxiliary: { ...auxiliary, writeEditBuffer },
    });
    const pending = handlers.writeEditBuffer(ID, "inspector.title", "unfinished");
    await vi.waitFor(() => expect(writeEditBuffer).toHaveBeenCalledOnce());
    expect(handlers.hasRendererShutdownBlockers()).toBe(true);
    finish();
    await pending;
    expect(handlers.hasRendererShutdownBlockers()).toBe(false);
  });

  it("blocks quit until an in-flight global settings write settles", async () => {
    const value = await fixture();
    let finish!: () => void;
    const writeAppSettings: M4AuxiliaryRendererHandlers["writeAppSettings"] = vi.fn(
      (settings: M4JsonValue) => new Promise<M4JsonValue>((resolve) => {
        finish = () => resolve(settings);
      }),
    );
    const handlers = new M4WorkspaceRendererHandlers({
      workspace: value.workspace,
      catalog: catalog(),
      auxiliary: { ...auxiliary, writeAppSettings },
    });
    const settings = { version: 1, kind: "globalSettings", theme: "dark" } as const;

    const pending = handlers.writeAppSettings(settings);
    expect(writeAppSettings).toHaveBeenCalledOnce();
    expect(handlers.hasRendererShutdownBlockers()).toBe(true);
    finish();
    await expect(pending).resolves.toEqual(settings);
    expect(handlers.hasRendererShutdownBlockers()).toBe(false);

    const rejectedHandlers = new M4WorkspaceRendererHandlers({
      workspace: value.workspace,
      catalog: catalog(),
      auxiliary: {
        ...auxiliary,
        async writeAppSettings() { throw new Error("settings disk unavailable"); },
      },
    });
    await expect(rejectedHandlers.writeAppSettings(settings)).rejects.toThrow("settings disk unavailable");
    expect(rejectedHandlers.hasRendererShutdownBlockers()).toBe(false);
  });

  it("projects bounded task-language preview state and cancels only active previews", async () => {
    const value = await fixture();
    const queueRevision = value.revision as unknown as `sha256:${string}`;
    const submitPreview = vi.fn(async () => ({ status: "enqueued" as const, buildId: BUILD }));
    const cancel = vi.fn(async () => undefined);
    let state: BuildQueueState = {
      nextOrdinal: 0,
      queued: [],
      latestPreviewSequence: {},
      previewPublication: {},
      dragActiveResources: [],
    };
    const build = {
      getState: () => structuredClone(state),
      submitPreview,
      cancel,
    };
    const workspace = {
      ...value.workspace,
      build,
      artifacts: {
        async readArtifact() {
          return {
            status: "succeeded",
            bulletinLocalId: ID,
            buildId: BUILD,
            outputEvidence: {
              mode: "compile",
              pdf: { pageCount: 3 },
              navigationMap: {
                version: 1,
                entries: [{
                  resolvedId: "resolved-prayers",
                  sourceElementId: "prayers",
                  pageNumber: 2,
                  region: "body",
                }],
              },
            },
          } as unknown as ArtifactRecord;
        },
      },
    } as unknown as M3EditableWorkspace;
    const handlers = new M4WorkspaceRendererHandlers({
      workspace,
      catalog: catalog(),
      auxiliary,
    });

    await expect(handlers.requestPreview({ localResourceId: ID, requestSequence: 7 }))
      .resolves.toEqual({ status: "enqueued", buildId: BUILD });
    expect(submitPreview).toHaveBeenCalledWith({ localResourceId: ID, requestSequence: 7 });

    state = {
      ...state,
      running: {
        cancelRequested: false,
        request: {
          kind: "preview",
          buildId: BUILD,
          localResourceId: ID,
          requestSequence: 7,
          documentRevision: queueRevision,
          renderInputHash: queueRevision,
          editGeneration: 2,
        },
      },
      latestPreviewSequence: { [ID]: 7 },
      previewPublication: { [ID]: { latestRequestSequence: 7, current: false } },
    };
    await expect(handlers.getPreviewState(ID)).resolves.toMatchObject({
      status: "building",
      attemptedBuildId: BUILD,
      message: "Creating the PDF preview.",
    });
    await expect(handlers.cancelPreview(BUILD)).resolves.toBe(true);
    expect(cancel).toHaveBeenCalledWith(BUILD);

    state = {
      ...state,
      running: undefined,
      previewPublication: {
        [ID]: {
          latestRequestSequence: 7,
          current: true,
          lastSuccessfulBuildId: BUILD,
          lastSuccessfulRenderInputHash: queueRevision,
        },
      },
    };
    await expect(handlers.getPreviewState(ID)).resolves.toMatchObject({
      status: "current",
      lastSuccessfulBuildId: BUILD,
      attemptedBuildId: BUILD,
      pageCount: 3,
      navigationMap: {
        version: 1,
        entries: [{
          resolvedId: "resolved-prayers",
          sourceElementId: "prayers",
          pageNumber: 2,
          region: "body",
        }],
      },
    });
    await expect(handlers.cancelPreview(BUILD)).resolves.toBe(false);
  });

  it("fails preview mutations closed when signed build adapters are unavailable", async () => {
    const value = await fixture();
    const handlers = new M4WorkspaceRendererHandlers({
      workspace: value.workspace,
      catalog: catalog(),
      auxiliary,
    });
    await expect(handlers.requestPreview({ localResourceId: ID, requestSequence: 1 }))
      .rejects.toMatchObject({ code: "unavailable" });
    await expect(handlers.getPreviewState(ID)).resolves.toEqual({
      status: "unavailable",
      message: "PDF preview is unavailable in this installation.",
    });
    await expect(handlers.cancelPreview(BUILD)).rejects.toMatchObject({ code: "unavailable" });
  });

  it("keeps base documents in main and passes exact snapshots to M3 saves", async () => {
    const value = await fixture();
    const handlers = new M4WorkspaceRendererHandlers({
      workspace: value.workspace,
      catalog: catalog(),
      auxiliary,
      artifactStorage: Promise.resolve({} as ArtifactStoragePort),
    });
    const edited = { ...value.document, name: "Edited Sunday Worship" };
    await expect(handlers.saveDocument({
      localResourceId: ID,
      resourceKind: "bulletin",
      displayName: "Edited Sunday Worship",
      document: edited,
      baseRevisionToken: value.revision,
    })).resolves.toMatchObject({ status: "saved" });
    expect(value.save).toHaveBeenCalledWith(expect.objectContaining({
      localResourceId: ID,
      baseDocument: value.document,
      baseRevisionToken: value.revision,
    }));

    await expect(handlers.saveDocument({
      localResourceId: NEW_ID,
      resourceKind: "bulletin",
      displayName: "New Bulletin",
      document: { ...value.document, name: "New Bulletin" },
      baseRevisionToken: null,
    })).resolves.toMatchObject({ status: "saved" });
    expect(value.save).toHaveBeenLastCalledWith(expect.objectContaining({
      localResourceId: NEW_ID,
      baseDocument: null,
      baseRevisionToken: null,
    }));
  });

  it("rejects stale renderer bases before persistence", async () => {
    const value = await fixture();
    const handlers = new M4WorkspaceRendererHandlers({
      workspace: value.workspace,
      catalog: catalog(),
      auxiliary,
      artifactStorage: Promise.resolve({} as ArtifactStoragePort),
    });
    await expect(handlers.saveDocument({
      localResourceId: ID,
      resourceKind: "bulletin",
      displayName: "Sunday Worship",
      document: value.document,
      baseRevisionToken: `sha256:${"f".repeat(64)}`,
    })).resolves.toMatchObject({ status: "conflicted" });
    expect(value.save).not.toHaveBeenCalled();
  });

  it("reads PDF bytes only through a matching succeeded immutable artifact", async () => {
    const value = await fixture();
    const pdf = new TextEncoder().encode("%PDF-1.7\n%%EOF\n");
    const artifact: ArtifactRecord = {
      version: 1,
      kind: "artifactRecord",
      buildId: BUILD,
      bulletinLocalId: ID,
      artifactKind: "preview",
      status: "succeeded",
      executionMode: "compile",
      createdAt: "2026-07-12T12:00:00.000Z",
      startedAt: "2026-07-12T12:00:01.000Z",
      completedAt: "2026-07-12T12:00:02.000Z",
      outputForm: "readerOrder",
      readinessProfile: "draft",
      canonicalRevisionToken: value.revision,
      renderInputHash: hashBytes(new Uint8Array([1])),
      toolIdentities: [],
      schemaIdentities: [],
      diagnosticCodes: [],
      outputEvidence: {
        mode: "compile",
        renderProjectionHash: hashBytes(new Uint8Array([2])),
        typstRelativePath: `artifacts/${ID}/${BUILD}.typ`,
        typstHash: hashBytes(new Uint8Array([3])),
        generatorVersion: "test",
        pdf: {
          relativePath: `artifacts/${ID}/${BUILD}.pdf`,
          hash: hashBytes(pdf),
          byteSize: pdf.byteLength,
          pageCount: 1,
          pdfVersion: "1.7",
        },
        resources: { assets: [], fontFaces: [] },
      },
    };
    const workspace = {
      ...value.workspace,
      artifacts: { async readArtifact() { return artifact; } },
    } as unknown as M3EditableWorkspace;
    const artifactStorage = {
      async readOwnedByte() { return pdf; },
    } as unknown as ArtifactStoragePort;
    const handlers = new M4WorkspaceRendererHandlers({
      workspace,
      catalog: catalog(),
      auxiliary,
      artifactStorage: Promise.resolve(artifactStorage),
    });
    await expect(handlers.readPdfBytes(ID, BUILD)).resolves.toEqual(pdf);
  });
});
