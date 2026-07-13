import type {
  RendererBridge,
  RendererBootstrapState,
  RendererChurchProfile,
  RendererDocumentSaveState,
  RendererDocumentSummary,
  RendererEditBufferValue,
  RendererEditBufferSaveState,
  RendererImageAssetImportOutcome,
  RendererImageAssetSummary,
  RendererJsonValue,
  RendererLoadedDocument,
  RendererPreviewState,
  RendererWorkspaceSettings,
  RendererWorkspaceLocationOutcome,
} from "../bridge/index.js";

function cloned<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class MemoryRendererBridge implements RendererBridge {
  readonly version = 1 as const;
  readonly records = new Map<string, RendererLoadedDocument>();
  readonly buffers = new Map<string, RendererEditBufferValue>();
  readonly saveStates: { readonly localResourceId: string; readonly state: RendererDocumentSaveState }[] = [];
  readonly editBufferSaveStates: { readonly localResourceId: string; readonly state: RendererEditBufferSaveState }[] = [];
  readonly imageAssets: RendererImageAssetSummary[] = [];
  readonly imageAssetBytes = new Map<string, Uint8Array>();
  imageImportOutcome: RendererImageAssetImportOutcome = {
    status: "unavailable",
    message: "Image import is unavailable in this test library.",
  };
  bootstrapState: RendererBootstrapState = { workspaceAccess: "readWrite" };
  saveCount = 0;
  appSettings: RendererJsonValue = { version: 1, kind: "globalSettings", theme: "system" };
  workspaceSettings: RendererWorkspaceSettings = {
    version: 1,
    kind: "workspaceSettings",
    snapGridSize: "0.125in",
  };
  workspaceRevision = `sha256:${"2".repeat(64)}`;
  churchProfile: RendererChurchProfile | null = null;
  churchProfileRevision: string | null = null;
  previewState: RendererPreviewState = {
    status: "unavailable",
    message: "PDF preview is unavailable in this test library.",
  };

  constructor(initial: readonly RendererLoadedDocument[] = []) {
    for (const value of initial) this.records.set(value.localResourceId, cloned(value));
  }

  async readBootstrapState() {
    return cloned(this.bootstrapState);
  }

  async chooseWorkspaceLocation(): Promise<RendererWorkspaceLocationOutcome> {
    return { status: "canceled" as const };
  }

  async listDocuments(filter = "all") {
    return [...this.records.values()]
      .filter((value) => filter === "all" || value.resourceKind === filter)
      .map(({ document: _document, ...summary }) => cloned(summary as RendererDocumentSummary));
  }

  async loadDocument(localResourceId: string) {
    const value = this.records.get(localResourceId);
    if (value === undefined) throw new Error("That item is missing.");
    return cloned(value);
  }

  async saveDocument(input: Parameters<RendererBridge["saveDocument"]>[0]) {
    const current = this.records.get(input.localResourceId);
    if (current !== undefined && current.revisionToken !== input.baseRevisionToken) {
      return { status: "conflicted" as const, message: "The item changed elsewhere." };
    }
    if (current === undefined && input.baseRevisionToken !== null) {
      return { status: "conflicted" as const, message: "The item is missing." };
    }
    this.saveCount += 1;
    const revisionToken = `sha256:${this.saveCount.toString(16).padStart(64, "0")}`;
    this.records.set(input.localResourceId, {
      localResourceId: input.localResourceId,
      resourceKind: input.resourceKind,
      displayName: input.displayName,
      modifiedAt: "2026-07-13T05:00:00.000Z",
      revisionToken,
      document: cloned(input.document),
    });
    return { status: "saved" as const, revisionToken };
  }

  async setDocumentSaveState(localResourceId: string, state: RendererDocumentSaveState) {
    this.saveStates.push({ localResourceId, state });
  }

  async readEditBuffer(localResourceId: string, bufferKey: string) {
    return cloned(this.buffers.get(`${localResourceId}\0${bufferKey}`) ?? null);
  }

  async writeEditBuffer(localResourceId: string, bufferKey: string, value: string) {
    const stored = { value, updatedAt: "2026-07-13T05:00:00.000Z" };
    this.buffers.set(`${localResourceId}\0${bufferKey}`, stored);
    return cloned(stored);
  }

  async deleteEditBuffer(localResourceId: string, bufferKey: string) {
    return this.buffers.delete(`${localResourceId}\0${bufferKey}`);
  }

  async setEditBufferSaveState(localResourceId: string, state: RendererEditBufferSaveState) {
    this.editBufferSaveStates.push({ localResourceId, state });
  }

  async readAppSettings() {
    return cloned(this.appSettings);
  }

  async writeAppSettings(value: RendererJsonValue) {
    this.appSettings = cloned(value);
    return cloned(value);
  }

  async readWorkspaceSettings() {
    return { value: cloned(this.workspaceSettings), revisionToken: this.workspaceRevision };
  }

  async writeWorkspaceSettings(value: RendererWorkspaceSettings, baseRevisionToken: string) {
    if (baseRevisionToken !== this.workspaceRevision) {
      return {
        status: "conflicted" as const,
        currentRevisionToken: this.workspaceRevision,
        message: "Workspace settings changed elsewhere.",
      };
    }
    this.workspaceSettings = cloned(value);
    this.workspaceRevision = `sha256:${"3".repeat(64)}`;
    return {
      status: "saved" as const,
      value: cloned(value),
      revisionToken: this.workspaceRevision,
    };
  }

  async readChurchProfile() {
    return { value: cloned(this.churchProfile), revisionToken: this.churchProfileRevision };
  }

  async writeChurchProfile(value: RendererChurchProfile, baseRevisionToken: string | null) {
    if (baseRevisionToken !== this.churchProfileRevision) {
      return {
        status: "conflicted" as const,
        currentRevisionToken: this.churchProfileRevision,
        message: "Church Profile changed elsewhere.",
      };
    }
    this.churchProfile = cloned(value);
    this.churchProfileRevision = `sha256:${"4".repeat(64)}`;
    return {
      status: "saved" as const,
      value: cloned(value),
      revisionToken: this.churchProfileRevision,
    };
  }

  async listImageAssets() {
    return cloned(this.imageAssets);
  }

  async importImageAsset() {
    return cloned(this.imageImportOutcome);
  }

  async readImageAssetBytes(localAssetId: string, assetRef: string) {
    const asset = this.imageAssets.find((candidate) =>
      candidate.localAssetId === localAssetId && candidate.assetRef === assetRef
    );
    const bytes = this.imageAssetBytes.get(assetRef);
    if (asset === undefined || bytes === undefined) {
      throw new Error("That validated image is unavailable in this test library.");
    }
    return bytes.slice();
  }

  async requestPreview() {
    return {
      status: "ignored" as const,
      buildId: "20000000-0000-4000-8000-000000000001",
    };
  }

  async getPreviewState() {
    return cloned(this.previewState);
  }

  async cancelPreview() {
    return false;
  }

  async readPdfBytes(): Promise<Uint8Array> {
    throw new Error("No PDF fixture is installed.");
  }
}
