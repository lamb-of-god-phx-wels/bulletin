import {
  canonicalRevisionToken,
  fromJson,
  hashBytes,
  parseLocalResourceId,
  validateDocumentSemantics,
  type CanonicalRevisionToken,
  type CbbDocument,
  type SchemaCatalog,
} from "@cbb/core";
import {
  WORKSPACE_REGISTRY_PATH,
  assertManagedPathHasNoSymlink,
  canonicalDocumentPath,
  createNodeArtifactStoragePort,
  createNodeFileSystemPort,
  decodeCanonicalJson,
  parseWorkspaceRegistry,
  resolveWorkspacePath,
  type ArtifactStoragePort,
  type BuildQueueState,
  type DurableFileSystemPort,
  type WorkspaceRegistry,
} from "@cbb/services";
import type {
  M3EditableWorkspace,
  M3BuildServices,
  M3ReadOnlyWorkspace,
  M3WorkspacePreferences,
} from "../composition.js";
import type {
  M4BootstrapState,
  M4ChurchProfile,
  M4ChurchProfileSaveOutcome,
  M4ChurchProfileSnapshot,
  M4DocumentSaveState,
  M4DocumentFilter,
  M4DocumentSummary,
  M4EditBufferValue,
  M4EditBufferSaveState,
  M4IpcRequest,
  M4ImageAssetImportOutcome,
  M4ImageAssetSummary,
  M4JsonValue,
  M4LoadedDocument,
  M4PreviewAdmission,
  M4PreviewFailure,
  M4PreviewNavigationMap,
  M4PreviewState,
  M4SaveDocumentOutcome,
  M4WorkspaceSettings,
  M4WorkspaceSettingsSaveOutcome,
  M4WorkspaceSettingsSnapshot,
  M4WorkspaceLocationOutcome,
} from "./contract.js";
import { M4_IPC_LIMITS, assertM4PreviewNavigationMap } from "./contract.js";
import { M4HandlerError, type M4RendererServiceHandlers } from "./dispatcher.js";
import { NodeM4ImageAssetCatalog } from "./nodeImageAssetCatalog.js";

const MAX_WORKSPACE_REGISTRY_BYTES = 100 * 1024 * 1024;

export interface M4AuxiliaryRendererHandlers {
  readEditBuffer(localResourceId: string, bufferKey: string): Promise<M4EditBufferValue | null>;
  writeEditBuffer(localResourceId: string, bufferKey: string, value: string): Promise<M4EditBufferValue>;
  deleteEditBuffer(localResourceId: string, bufferKey: string): Promise<boolean>;
  readAppSettings(): Promise<M4JsonValue>;
  writeAppSettings(value: M4JsonValue): Promise<M4JsonValue>;
}

export interface M4WorkspaceRendererHandlersOptions {
  readonly workspace: M3EditableWorkspace | M3ReadOnlyWorkspace;
  readonly catalog: SchemaCatalog;
  readonly auxiliary: M4AuxiliaryRendererHandlers;
  /** Injectable only for tests. Production uses the no-follow Node port. */
  readonly fileSystem?: DurableFileSystemPort;
  /** Injectable only for tests. Production opens the fixed artifact root. */
  readonly artifactStorage?: Promise<ArtifactStoragePort>;
  /** Read-only sessions can receive the same M3 preference service bound to that session. */
  readonly readOnlyPreferences?: Pick<M3WorkspacePreferences, "loadSettings" | "saveSettings"> &
    Partial<Pick<M3WorkspacePreferences, "loadChurchProfile">>;
  /** Host-owned native chooser. It accepts and returns no path-shaped renderer value. */
  readonly chooseWorkspaceLocation?: () => Promise<M4WorkspaceLocationOutcome>;
  /** Complete host-owned chooser, isolated canonicalization, and atomic install flow. */
  readonly importImageAsset?: () => Promise<M4ImageAssetImportOutcome>;
}

interface LoadedBase {
  readonly document: CbbDocument;
  readonly revisionToken: CanonicalRevisionToken;
}

interface PreviewAdmissionRecord {
  readonly buildId: string;
  readonly requestSequence: number;
}

function editableWorkspace(
  workspace: M3EditableWorkspace | M3ReadOnlyWorkspace,
): workspace is M3EditableWorkspace {
  return "documents" in workspace;
}

function userSummary(outcome: Exclude<M4SaveDocumentOutcome["status"], "saved">, fallback: string): string {
  return outcome === "conflicted"
    ? "This bulletin changed after it was opened. Review the other version before saving."
    : fallback;
}

function previewFailure(value: "failed" | "timedOut" | "canceled" | "staleResult"): {
  readonly failure: M4PreviewFailure;
  readonly message: string;
} {
  switch (value) {
    case "timedOut":
      return { failure: "tookTooLong", message: "Creating the PDF preview took too long." };
    case "canceled":
      return { failure: "canceled", message: "The PDF preview was canceled." };
    case "staleResult":
      return { failure: "outOfDate", message: "The completed PDF no longer matches this bulletin." };
    case "failed":
      return { failure: "couldNotBuild", message: "The PDF preview could not be created." };
  }
}

/**
 * Main-process adapter for one owned M3 workspace. Every lookup begins with an
 * identity and derives its canonical location from trusted registry/artifact
 * state. No path-shaped value is accepted from the renderer.
 */
export class M4WorkspaceRendererHandlers implements M4RendererServiceHandlers {
  private readonly fileSystem: DurableFileSystemPort;
  private readonly imageAssets: NodeM4ImageAssetCatalog;
  private artifactStorage: Promise<ArtifactStoragePort> | undefined;
  private readonly loadedBases = new Map<string, LoadedBase>();
  private readonly knownDocumentIds = new Set<string>();
  private readonly documentSaveStates = new Map<string, Exclude<M4DocumentSaveState, "clean">>();
  private readonly editBufferSaveStates = new Map<string, Exclude<M4EditBufferSaveState, "clean">>();
  private readonly activeEditBufferOperations = new Map<string, number>();
  private activeAppSettingsWrites = 0;
  private readonly previewAdmissions = new Map<string, PreviewAdmissionRecord>();

  constructor(private readonly options: M4WorkspaceRendererHandlersOptions) {
    this.fileSystem = options.fileSystem ?? createNodeFileSystemPort();
    this.imageAssets = new NodeM4ImageAssetCatalog({
      workspaceRoot: options.workspace.root,
      fileSystem: this.fileSystem,
    });
    this.artifactStorage = options.artifactStorage;
    this.rememberRegistryDocuments(options.workspace.registry);
  }

  private rememberRegistryDocuments(registry: WorkspaceRegistry): void {
    for (const entry of [...registry.bulletins ?? [], ...registry.templates ?? []]) {
      if (entry.kind === "bulletin" || entry.kind === "template") {
        this.knownDocumentIds.add(entry.localId);
      }
    }
  }

  private async currentRegistry(): Promise<WorkspaceRegistry> {
    await assertManagedPathHasNoSymlink(
      this.fileSystem,
      this.options.workspace.root,
      WORKSPACE_REGISTRY_PATH,
    );
    const value = decodeCanonicalJson(await this.fileSystem.readFileNoFollow(
      resolveWorkspacePath(this.options.workspace.root, WORKSPACE_REGISTRY_PATH),
      MAX_WORKSPACE_REGISTRY_BYTES,
    ));
    const registry = parseWorkspaceRegistry(value, this.options.catalog);
    if (registry.workspaceId !== this.options.workspace.registry.workspaceId) {
      throw new M4HandlerError("unavailable", "Your bulletin library changed while it was open.");
    }
    this.rememberRegistryDocuments(registry);
    return registry;
  }

  private rememberLoadedBase(localResourceId: string, base: LoadedBase): void {
    // Refresh insertion order so this map is also a tiny LRU. Full documents
    // can be large; keeping an unbounded snapshot for every opened bulletin
    // would let a renderer exhaust main-process memory.
    this.loadedBases.delete(localResourceId);
    this.loadedBases.set(localResourceId, base);
    while (this.loadedBases.size > M4_IPC_LIMITS.maximumLoadedDocumentBases) {
      const oldest = this.loadedBases.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.loadedBases.delete(oldest);
    }
  }

  private loadedBase(localResourceId: string): LoadedBase | undefined {
    const base = this.loadedBases.get(localResourceId);
    if (base !== undefined) this.rememberLoadedBase(localResourceId, base);
    return base;
  }

  private async assertOwnedDocumentResource(localResourceId: string): Promise<void> {
    const registry = await this.currentRegistry();
    const owned = [...registry.bulletins ?? [], ...registry.templates ?? []]
      .some((entry) => entry.localId === localResourceId &&
        (entry.kind === "bulletin" || entry.kind === "template"));
    if (!owned) {
      throw new M4HandlerError("notFound", "That bulletin is no longer in your library.");
    }
  }

  private preferences(): Pick<M3WorkspacePreferences, "loadSettings" | "saveSettings"> | undefined {
    return editableWorkspace(this.options.workspace)
      ? this.options.workspace.preferences
      : this.options.readOnlyPreferences;
  }

  private churchProfilePreferences(): Pick<M3WorkspacePreferences, "loadChurchProfile"> | undefined {
    if (editableWorkspace(this.options.workspace)) return this.options.workspace.preferences;
    const preferences = this.options.readOnlyPreferences;
    return preferences?.loadChurchProfile === undefined
      ? undefined
      : { loadChurchProfile: () => preferences.loadChurchProfile!() };
  }

  async readBootstrapState(): Promise<M4BootstrapState> {
    return Object.freeze({
      workspaceAccess: editableWorkspace(this.options.workspace) ? "readWrite" : "readOnly",
    });
  }

  async chooseWorkspaceLocation(): Promise<M4WorkspaceLocationOutcome> {
    if (!editableWorkspace(this.options.workspace) || this.options.chooseWorkspaceLocation === undefined) {
      return {
        status: "unavailable",
        message: "Another bulletin-library location cannot be chosen in this window.",
      };
    }
    const registry = await this.currentRegistry();
    const hasManagedContent = [
      registry.bulletins,
      registry.templates,
      registry.assets,
      registry.fonts,
      registry.songs,
      registry.scriptureCatalog,
      registry.resourcePacks,
      registry.importProvenance,
      registry.installedPackState,
      registry.sharedLibraryConnections,
      registry.scriptureProviderConfig,
      registry.packMaintainerDrafts,
    ].some((entries) => (entries?.length ?? 0) > 0);
    if (hasManagedContent) {
      return {
        status: "unavailable",
        message: "A location can be chosen only before anything is added to this bulletin library.",
      };
    }
    const preferences = this.preferences();
    if (preferences !== undefined) {
      const settings = await preferences.loadSettings();
      if (settings.status !== "loaded" || settings.value === null ||
        (settings.value.firstRun !== undefined && settings.value.firstRun.disposition !== "inProgress")) {
        return {
          status: "unavailable",
          message: "A location can be chosen only during the first bulletin-library setup.",
        };
      }
    }
    const profilePreferences = this.churchProfilePreferences();
    if (profilePreferences !== undefined) {
      const profile = await profilePreferences.loadChurchProfile();
      if (profile.status !== "loaded" || profile.value !== null) {
        return {
          status: "unavailable",
          message: "A location can be chosen only before a Church Profile is saved.",
        };
      }
    }
    return this.options.chooseWorkspaceLocation();
  }

  async listDocuments(filter: M4DocumentFilter): Promise<readonly M4DocumentSummary[]> {
    const registry = await this.currentRegistry();
    const records = [
      ...(filter === "template" ? [] : registry.bulletins ?? []),
      ...(filter === "bulletin" ? [] : registry.templates ?? []),
    ];
    if (records.length > M4_IPC_LIMITS.maximumDocumentRows) {
      throw new M4HandlerError("unavailable", "Your bulletin library is too large to display safely.");
    }
    return records
      .map((entry): M4DocumentSummary => ({
        localResourceId: entry.localId,
        resourceKind: entry.kind as "bulletin" | "template",
        displayName: entry.displayName,
        modifiedAt: entry.modifiedAt,
        ...(entry.lastOpenedAt === undefined ? {} : { lastOpenedAt: entry.lastOpenedAt }),
        revisionToken: entry.contentHash,
      }))
      .sort((left, right) =>
        right.modifiedAt.localeCompare(left.modifiedAt) ||
        left.displayName.localeCompare(right.displayName) ||
        left.localResourceId.localeCompare(right.localResourceId),
      );
  }

  async loadDocument(localResourceId: string): Promise<M4LoadedDocument> {
    const registry = await this.currentRegistry();
    const record = [...registry.bulletins ?? [], ...registry.templates ?? []]
      .find((entry) => entry.localId === localResourceId);
    if (record === undefined || (record.kind !== "bulletin" && record.kind !== "template")) {
      throw new M4HandlerError("notFound", "That bulletin is no longer in your library.");
    }
    const brandedId = parseLocalResourceId(localResourceId);
    const expectedRelativePath = canonicalDocumentPath(record.kind, brandedId);
    if (record.storagePath !== expectedRelativePath) {
      throw new M4HandlerError("unavailable", "That bulletin has unsafe library metadata and cannot be opened.");
    }
    await assertManagedPathHasNoSymlink(
      this.fileSystem,
      this.options.workspace.root,
      expectedRelativePath,
    );
    const bytes = await this.fileSystem.readFileNoFollow(
      resolveWorkspacePath(this.options.workspace.root, expectedRelativePath),
      M4_IPC_LIMITS.documentBytes,
    );
    const sourceDocument = decodeCanonicalJson(bytes);
    const revisionToken = canonicalRevisionToken(sourceDocument);
    const document = fromJson(sourceDocument, this.options.catalog);
    const semantic = validateDocumentSemantics(document);
    if (!semantic.valid || document.kind !== record.kind) {
      throw new M4HandlerError("unavailable", "That bulletin is invalid and cannot be opened for editing.");
    }
    if (revisionToken !== record.contentHash) {
      throw new M4HandlerError("conflict", "That bulletin changed outside the app and needs review.");
    }
    this.rememberLoadedBase(localResourceId, { document, revisionToken });
    return {
      localResourceId,
      resourceKind: record.kind,
      displayName: record.displayName,
      modifiedAt: record.modifiedAt,
      ...(record.lastOpenedAt === undefined ? {} : { lastOpenedAt: record.lastOpenedAt }),
      revisionToken,
      document,
    };
  }

  async saveDocument(
    input: Extract<M4IpcRequest, { operation: "documents.save" }>["payload"],
  ): Promise<M4SaveDocumentOutcome> {
    if (!editableWorkspace(this.options.workspace)) {
      return {
        status: "failed",
        message: "This bulletin library is open read-only. Your changes were not saved.",
      };
    }
    const registry = await this.currentRegistry();
    const existing = [...registry.bulletins ?? [], ...registry.templates ?? []]
      .find((entry) => entry.localId === input.localResourceId);
    const documentCount = (registry.bulletins?.length ?? 0) + (registry.templates?.length ?? 0);
    if (existing === undefined && documentCount >= M4_IPC_LIMITS.maximumDocumentRows) {
      return {
        status: "failed",
        message: "Your bulletin library has reached its supported document limit.",
      };
    }
    let base: LoadedBase | undefined = this.loadedBase(input.localResourceId);
    if (existing !== undefined && base === undefined) {
      await this.loadDocument(input.localResourceId);
      base = this.loadedBase(input.localResourceId);
    }
    if (
      existing !== undefined &&
      (existing.kind !== input.resourceKind || base === undefined || input.baseRevisionToken !== base.revisionToken)
    ) {
      return {
        status: "conflicted",
        message: "This bulletin changed after it was opened. Review the other version before saving.",
      };
    }
    if (existing === undefined && (input.baseRevisionToken !== null || base !== undefined)) {
      return { status: "conflicted", message: "This bulletin is no longer in your library." };
    }
    const result = await this.options.workspace.documents.save({
      resourceKind: input.resourceKind,
      localResourceId: parseLocalResourceId(input.localResourceId),
      displayName: input.displayName,
      document: input.document,
      baseDocument: base?.document ?? null,
      baseRevisionToken: base?.revisionToken ?? null,
    });
    if (result.status === "saved") {
      this.knownDocumentIds.add(input.localResourceId);
      this.rememberLoadedBase(input.localResourceId, {
        document: input.document,
        revisionToken: result.revisionToken,
      });
      return { status: "saved", revisionToken: result.revisionToken };
    }
    const message = result.diagnostics[0]?.userSummary ?? "Your bulletin could not be saved safely.";
    if (result.status === "conflicted") return { status: "conflicted", message: userSummary("conflicted", message) };
    if (result.status === "recoveryRequired") return { status: "recoveryRequired", message };
    return { status: "failed", message };
  }

  async setDocumentSaveState(localResourceId: string, state: M4DocumentSaveState): Promise<void> {
    if (!this.knownDocumentIds.has(localResourceId)) {
      throw new M4HandlerError("notFound", "That bulletin is no longer in your library.");
    }
    if (!editableWorkspace(this.options.workspace) && state !== "clean") {
      throw new M4HandlerError("unavailable", "This bulletin library is open read-only.");
    }
    if (state === "clean") this.documentSaveStates.delete(localResourceId);
    else this.documentSaveStates.set(localResourceId, state);
    if (this.documentSaveStates.size > M4_IPC_LIMITS.maximumDocumentRows) {
      throw new M4HandlerError("unavailable", "Too many bulletins have unfinished changes.");
    }
  }

  async setEditBufferSaveState(localResourceId: string, state: M4EditBufferSaveState): Promise<void> {
    if (!this.knownDocumentIds.has(localResourceId)) {
      throw new M4HandlerError("notFound", "That bulletin is no longer in your library.");
    }
    if (!editableWorkspace(this.options.workspace) && state !== "clean") {
      throw new M4HandlerError("unavailable", "This bulletin library is open read-only.");
    }
    if (state === "clean") this.editBufferSaveStates.delete(localResourceId);
    else this.editBufferSaveStates.set(localResourceId, state);
    if (this.editBufferSaveStates.size > M4_IPC_LIMITS.maximumDocumentRows) {
      throw new M4HandlerError("unavailable", "Too many bulletins have unfinished inspector values.");
    }
  }

  hasRendererShutdownBlockers(): boolean {
    return this.documentSaveStates.size > 0 ||
      this.editBufferSaveStates.size > 0 ||
      this.activeEditBufferOperations.size > 0 ||
      this.activeAppSettingsWrites > 0;
  }

  private beginEditBufferOperation(localResourceId: string): void {
    this.activeEditBufferOperations.set(
      localResourceId,
      (this.activeEditBufferOperations.get(localResourceId) ?? 0) + 1,
    );
  }

  private endEditBufferOperation(localResourceId: string): void {
    const remaining = (this.activeEditBufferOperations.get(localResourceId) ?? 1) - 1;
    if (remaining <= 0) this.activeEditBufferOperations.delete(localResourceId);
    else this.activeEditBufferOperations.set(localResourceId, remaining);
  }

  async readEditBuffer(localResourceId: string, bufferKey: string): Promise<M4EditBufferValue | null> {
    if (!editableWorkspace(this.options.workspace)) return null;
    await this.assertOwnedDocumentResource(localResourceId);
    return this.options.auxiliary.readEditBuffer(localResourceId, bufferKey);
  }

  async writeEditBuffer(localResourceId: string, bufferKey: string, value: string): Promise<M4EditBufferValue> {
    if (!editableWorkspace(this.options.workspace)) {
      throw new M4HandlerError("unavailable", "This bulletin library is open read-only.");
    }
    await this.assertOwnedDocumentResource(localResourceId);
    this.beginEditBufferOperation(localResourceId);
    try {
      return await this.options.auxiliary.writeEditBuffer(localResourceId, bufferKey, value);
    } catch (error) {
      this.editBufferSaveStates.set(localResourceId, "failed");
      throw error;
    } finally {
      this.endEditBufferOperation(localResourceId);
    }
  }

  async deleteEditBuffer(localResourceId: string, bufferKey: string): Promise<boolean> {
    if (!editableWorkspace(this.options.workspace)) return false;
    await this.assertOwnedDocumentResource(localResourceId);
    this.beginEditBufferOperation(localResourceId);
    try {
      return await this.options.auxiliary.deleteEditBuffer(localResourceId, bufferKey);
    } catch (error) {
      this.editBufferSaveStates.set(localResourceId, "failed");
      throw error;
    } finally {
      this.endEditBufferOperation(localResourceId);
    }
  }

  readAppSettings(): Promise<M4JsonValue> {
    return this.options.auxiliary.readAppSettings();
  }

  async writeAppSettings(value: M4JsonValue): Promise<M4JsonValue> {
    // Global settings live outside the workspace service lifetime, so the
    // renderer shutdown guard must own their full queued/atomic-write lifetime.
    this.activeAppSettingsWrites += 1;
    try {
      return await this.options.auxiliary.writeAppSettings(value);
    } finally {
      this.activeAppSettingsWrites -= 1;
    }
  }

  async readWorkspaceSettings(): Promise<M4WorkspaceSettingsSnapshot> {
    const preferences = this.preferences();
    if (preferences === undefined) {
      throw new M4HandlerError("unavailable", "Workspace settings are unavailable while this library is read-only.");
    }
    const result = await preferences.loadSettings();
    if (result.status !== "loaded" || result.value === null || result.hash === null) {
      throw new M4HandlerError("unavailable", "Workspace settings could not be opened safely.");
    }
    return { value: result.value, revisionToken: result.hash };
  }

  async writeWorkspaceSettings(
    value: M4WorkspaceSettings,
    baseRevisionToken: string,
  ): Promise<M4WorkspaceSettingsSaveOutcome> {
    if (!editableWorkspace(this.options.workspace)) {
      return { status: "readOnly", message: "This bulletin library is open read-only." };
    }
    const result = await this.options.workspace.preferences.saveSettings(
      value,
      baseRevisionToken as CanonicalRevisionToken,
    );
    if (result.status === "saved") {
      return { status: "saved", value: result.value, revisionToken: result.hash };
    }
    if (result.status === "conflicted") {
      return {
        status: "conflicted",
        currentRevisionToken: result.diskHash,
        message: "These settings changed elsewhere, so they were not overwritten.",
      };
    }
    if (result.status === "readOnly") {
      return { status: "readOnly", message: "This bulletin library is now read-only." };
    }
    return { status: "failed", message: "Workspace settings could not be saved safely." };
  }

  async readChurchProfile(): Promise<M4ChurchProfileSnapshot> {
    const preferences = this.churchProfilePreferences();
    if (preferences === undefined) {
      throw new M4HandlerError("unavailable", "Church Profile is unavailable while this library is read-only.");
    }
    const result = await preferences.loadChurchProfile();
    if (result.status !== "loaded") {
      throw new M4HandlerError("unavailable", "Church Profile could not be opened safely.");
    }
    if ((result.value === null) !== (result.hash === null)) {
      throw new M4HandlerError("unavailable", "Church Profile could not be opened safely.");
    }
    return { value: result.value, revisionToken: result.hash };
  }

  async writeChurchProfile(
    value: M4ChurchProfile,
    baseRevisionToken: string | null,
  ): Promise<M4ChurchProfileSaveOutcome> {
    if (!editableWorkspace(this.options.workspace)) {
      return { status: "readOnly", message: "This bulletin library is open read-only." };
    }
    const result = await this.options.workspace.preferences.saveChurchProfile(
      value,
      baseRevisionToken as CanonicalRevisionToken | null,
    );
    if (result.status === "saved") {
      return { status: "saved", value: result.value, revisionToken: result.hash };
    }
    if (result.status === "conflicted") {
      return {
        status: "conflicted",
        currentRevisionToken: result.diskHash,
        message: "Church Profile changed elsewhere, so it was not overwritten.",
      };
    }
    if (result.status === "readOnly") {
      return { status: "readOnly", message: "This bulletin library is now read-only." };
    }
    return { status: "failed", message: "Church Profile could not be saved safely." };
  }

  async listImageAssets(): Promise<readonly M4ImageAssetSummary[]> {
    try {
      return await this.imageAssets.list(await this.currentRegistry());
    } catch {
      throw new M4HandlerError(
        "unavailable",
        "The validated image library could not be opened safely.",
      );
    }
  }

  async importImageAsset(): Promise<M4ImageAssetImportOutcome> {
    if (!editableWorkspace(this.options.workspace)) {
      return { status: "readOnly", message: "This bulletin library is open read-only." };
    }
    if (this.options.importImageAsset === undefined) {
      return {
        status: "unavailable",
        message: "Image import is unavailable in this installation.",
      };
    }
    return this.options.importImageAsset();
  }

  async readImageAssetBytes(localAssetId: string, assetRef: string): Promise<Uint8Array> {
    try {
      return await this.imageAssets.read(
        await this.currentRegistry(),
        localAssetId,
        assetRef,
      );
    } catch {
      throw new M4HandlerError(
        "unavailable",
        "That validated image could not be opened safely.",
      );
    }
  }

  private buildServices(): M3BuildServices | undefined {
    return editableWorkspace(this.options.workspace) ? this.options.workspace.build : undefined;
  }

  private prunePreviewAdmissions(state: BuildQueueState): void {
    if (this.previewAdmissions.size < M4_IPC_LIMITS.maximumTrackedPreviewDocuments) return;
    const active = new Set<string>([
      ...state.queued.map((entry) => entry.request.buildId),
      ...(state.running === undefined ? [] : [state.running.request.buildId]),
    ]);
    for (const [localResourceId, admission] of this.previewAdmissions) {
      if (!active.has(admission.buildId)) this.previewAdmissions.delete(localResourceId);
      if (this.previewAdmissions.size < M4_IPC_LIMITS.maximumTrackedPreviewDocuments) return;
    }
  }

  async requestPreview(input: {
    readonly localResourceId: string;
    readonly requestSequence: number;
  }): Promise<M4PreviewAdmission> {
    const build = this.buildServices();
    if (build === undefined) {
      throw new M4HandlerError("unavailable", "PDF preview is unavailable in this installation.");
    }
    await this.assertOwnedDocumentResource(input.localResourceId);
    const state = build.getState();
    this.prunePreviewAdmissions(state);
    if (!this.previewAdmissions.has(input.localResourceId) &&
      this.previewAdmissions.size >= M4_IPC_LIMITS.maximumTrackedPreviewDocuments) {
      throw new M4HandlerError("unavailable", "Too many PDF previews are already being tracked.");
    }
    try {
      const admission = await build.submitPreview(input);
      if (admission.status === "enqueued") {
        this.previewAdmissions.delete(input.localResourceId);
        this.previewAdmissions.set(input.localResourceId, {
          buildId: admission.buildId,
          requestSequence: input.requestSequence,
        });
      }
      return admission;
    } catch {
      throw new M4HandlerError("unavailable", "The PDF preview could not be started safely.");
    }
  }

  private async previewArtifactMetadata(
    localResourceId: string,
    buildId: string | undefined,
  ): Promise<{
    readonly pageCount?: number;
    readonly navigationMap?: M4PreviewNavigationMap;
  }> {
    if (buildId === undefined || !editableWorkspace(this.options.workspace) ||
      this.options.workspace.artifacts === undefined) return {};
    try {
      const record = await this.options.workspace.artifacts.readArtifact(localResourceId, buildId);
      if (record === undefined || record.status !== "succeeded" || record.outputEvidence === undefined ||
        record.bulletinLocalId !== localResourceId || record.buildId !== buildId) return {};
      const pageCount = record.outputEvidence.pdf.pageCount;
      if (!Number.isSafeInteger(pageCount) || pageCount < 1 ||
        pageCount > M4_IPC_LIMITS.maximumPreviewPageCount) return {};
      if (record.outputEvidence.mode !== "compile" || record.outputEvidence.navigationMap === undefined) {
        return { pageCount };
      }
      const map: M4PreviewNavigationMap = {
        version: record.outputEvidence.navigationMap.version,
        entries: record.outputEvidence.navigationMap.entries.map((entry) => ({
          resolvedId: entry.resolvedId,
          sourceElementId: entry.sourceElementId,
          pageNumber: entry.pageNumber,
          region: entry.region,
        })),
      };
      assertM4PreviewNavigationMap(map, pageCount);
      return { pageCount, navigationMap: map };
    } catch {
      return {};
    }
  }

  async getPreviewState(localResourceId: string): Promise<M4PreviewState> {
    const build = this.buildServices();
    if (build === undefined) {
      return {
        status: "unavailable",
        message: "PDF preview is unavailable in this installation.",
      };
    }
    await this.assertOwnedDocumentResource(localResourceId);
    let state: BuildQueueState;
    try {
      state = build.getState();
    } catch {
      return { status: "unavailable", message: "PDF preview is temporarily unavailable." };
    }
    const running = state.running?.request.kind === "preview" &&
      state.running.request.localResourceId === localResourceId
      ? state.running
      : undefined;
    const queued = state.queued
      .filter((entry) => entry.request.kind === "preview" && entry.request.localResourceId === localResourceId)
      .sort((left, right) => {
        const leftSequence = left.request.kind === "preview" ? left.request.requestSequence : 0;
        const rightSequence = right.request.kind === "preview" ? right.request.requestSequence : 0;
        return rightSequence - leftSequence;
      })[0];
    const runningSequence = running?.request.kind === "preview" ? running.request.requestSequence : 0;
    const queuedSequence = queued?.request.kind === "preview" ? queued.request.requestSequence : 0;
    const active = queuedSequence > runningSequence ? queued : running;
    const tracked = this.previewAdmissions.get(localResourceId);
    const attemptedBuildId = active?.request.buildId ?? tracked?.buildId;
    const publication = state.previewPublication[localResourceId];
    const lastSuccessfulBuildId = publication?.lastSuccessfulBuildId;
    const artifact = await this.previewArtifactMetadata(localResourceId, lastSuccessfulBuildId);
    const shared = {
      ...(lastSuccessfulBuildId === undefined ? {} : { lastSuccessfulBuildId }),
      ...(attemptedBuildId === undefined ? {} : { attemptedBuildId }),
      ...artifact,
    };

    if (active !== undefined) {
      const newestIsRunning = active === running && running?.cancelRequested !== true;
      return {
        status: newestIsRunning ? "building" : "queued",
        ...shared,
        message: newestIsRunning
          ? "Creating the PDF preview."
          : "The PDF preview is waiting to be created.",
      };
    }
    if (publication?.current === true && lastSuccessfulBuildId !== undefined) {
      return { status: "current", ...shared, message: "The PDF preview is up to date." };
    }
    if (publication?.failure !== undefined) {
      const failure = previewFailure(publication.failure);
      return {
        status: lastSuccessfulBuildId === undefined ? "failed" : "stale",
        ...shared,
        ...failure,
      };
    }
    if (lastSuccessfulBuildId !== undefined) {
      return {
        status: "stale",
        ...shared,
        failure: "outOfDate",
        message: "The saved PDF preview is out of date.",
      };
    }
    return { status: "idle" };
  }

  async cancelPreview(buildId: string): Promise<boolean> {
    const build = this.buildServices();
    if (build === undefined) {
      throw new M4HandlerError("unavailable", "PDF preview is unavailable in this installation.");
    }
    let state: BuildQueueState;
    try {
      state = build.getState();
    } catch {
      throw new M4HandlerError("unavailable", "PDF preview is temporarily unavailable.");
    }
    const activePreview = state.running?.request.kind === "preview" &&
      state.running.request.buildId === buildId ||
      state.queued.some((entry) => entry.request.kind === "preview" && entry.request.buildId === buildId);
    if (!activePreview) return false;
    try {
      await build.cancel(buildId);
      return true;
    } catch {
      throw new M4HandlerError("unavailable", "The PDF preview could not be canceled safely.");
    }
  }

  async readPdfBytes(bulletinLocalResourceId: string, buildId: string): Promise<Uint8Array> {
    if (!editableWorkspace(this.options.workspace)) {
      throw new M4HandlerError("unavailable", "PDF preview is unavailable while this library is read-only.");
    }
    const artifacts = this.options.workspace.artifacts;
    if (artifacts === undefined) {
      throw new M4HandlerError("unavailable", "PDF preview is not available in this installation.");
    }
    const record = await artifacts.readArtifact(bulletinLocalResourceId, buildId);
    if (
      record === undefined ||
      record.bulletinLocalId !== bulletinLocalResourceId ||
      record.buildId !== buildId ||
      record.status !== "succeeded" ||
      record.outputEvidence === undefined
    ) {
      throw new M4HandlerError("notFound", "That PDF is no longer available.");
    }
    const evidence = record.outputEvidence.pdf;
    if (evidence.byteSize > M4_IPC_LIMITS.pdfBytes) {
      throw new M4HandlerError("unavailable", "That PDF is too large to preview safely.");
    }
    this.artifactStorage ??= createNodeArtifactStoragePort(this.options.workspace.root);
    const bytes = await (await this.artifactStorage).readOwnedByte({
      kind: "artifactOwnedByte",
      bulletinLocalId: bulletinLocalResourceId,
      buildId,
      extension: "pdf",
    });
    if (bytes === undefined || bytes.byteLength !== evidence.byteSize || hashBytes(bytes) !== evidence.hash) {
      throw new M4HandlerError("unavailable", "That PDF failed its integrity check.");
    }
    return bytes;
  }
}
