import type {
  M4BootstrapState,
  M4ChurchProfile,
  M4ChurchProfileSaveOutcome,
  M4ChurchProfileSnapshot,
  M4DocumentFilter,
  M4DocumentSummary,
  M4EditBufferValue,
  M4EditBufferSaveState,
  M4DocumentSaveState,
  M4IpcOperation,
  M4IpcRequest,
  M4IpcResponse,
  M4ImageAssetImportOutcome,
  M4ImageAssetSummary,
  M4JsonValue,
  M4LoadedDocument,
  M4SaveDocumentOutcome,
  M4PreviewAdmission,
  M4PreviewState,
  M4WorkspaceSettings,
  M4WorkspaceSettingsSaveOutcome,
  M4WorkspaceSettingsSnapshot,
  M4WorkspaceLocationOutcome,
} from "./contract.js";
import {
  assertM4BootstrapState,
  assertM4ChurchProfileSaveOutcome,
  assertM4ChurchProfileSnapshot,
  M4ContractError,
  M4_IPC_CHANNEL,
  M4_IPC_LIMITS,
  assertBoundedJson,
  assertM4DocumentSummary,
  assertM4EditBuffer,
  assertM4ImageAssetImportOutcome,
  assertM4ImageAssetSummary,
  assertM4LoadedDocument,
  assertM4SaveOutcome,
  assertM4PreviewAdmission,
  assertM4PreviewState,
  assertM4WorkspaceSettingsSaveOutcome,
  assertM4WorkspaceSettingsSnapshot,
  assertM4WorkspaceLocationOutcome,
  parseM4IpcRequest,
} from "./contract.js";

export interface M4RendererServiceHandlers {
  readBootstrapState(): Promise<M4BootstrapState>;
  chooseWorkspaceLocation(): Promise<M4WorkspaceLocationOutcome>;
  listDocuments(filter: M4DocumentFilter): Promise<readonly M4DocumentSummary[]>;
  loadDocument(localResourceId: string): Promise<M4LoadedDocument>;
  saveDocument(
    input: Extract<M4IpcRequest, { operation: "documents.save" }>["payload"],
  ): Promise<M4SaveDocumentOutcome>;
  setDocumentSaveState(localResourceId: string, state: M4DocumentSaveState): Promise<void>;
  readEditBuffer(localResourceId: string, bufferKey: string): Promise<M4EditBufferValue | null>;
  writeEditBuffer(localResourceId: string, bufferKey: string, value: string): Promise<M4EditBufferValue>;
  deleteEditBuffer(localResourceId: string, bufferKey: string): Promise<boolean>;
  setEditBufferSaveState(localResourceId: string, state: M4EditBufferSaveState): Promise<void>;
  readAppSettings(): Promise<M4JsonValue>;
  writeAppSettings(value: M4JsonValue): Promise<M4JsonValue>;
  readWorkspaceSettings(): Promise<M4WorkspaceSettingsSnapshot>;
  writeWorkspaceSettings(
    value: M4WorkspaceSettings,
    baseRevisionToken: string,
  ): Promise<M4WorkspaceSettingsSaveOutcome>;
  readChurchProfile(): Promise<M4ChurchProfileSnapshot>;
  writeChurchProfile(
    value: M4ChurchProfile,
    baseRevisionToken: string | null,
  ): Promise<M4ChurchProfileSaveOutcome>;
  listImageAssets(): Promise<readonly M4ImageAssetSummary[]>;
  importImageAsset(): Promise<M4ImageAssetImportOutcome>;
  readImageAssetBytes(localAssetId: string, assetRef: string): Promise<Uint8Array>;
  requestPreview(input: {
    readonly localResourceId: string;
    readonly requestSequence: number;
  }): Promise<M4PreviewAdmission>;
  getPreviewState(localResourceId: string): Promise<M4PreviewState>;
  cancelPreview(buildId: string): Promise<boolean>;
  readPdfBytes(bulletinLocalResourceId: string, buildId: string): Promise<Uint8Array>;
}

export class M4HandlerError extends Error {
  constructor(
    readonly code: "notFound" | "conflict" | "unavailable" | "failed",
    readonly userMessage: string,
  ) {
    super(userMessage);
    this.name = "M4HandlerError";
  }
}

function success(operation: M4IpcOperation, value: unknown): M4IpcResponse {
  return { version: 1, ok: true, operation, value };
}

function failure(
  operation: M4IpcOperation | "invalid",
  code: "invalidRequest" | "notAuthorized" | "notFound" | "conflict" | "unavailable" | "failed",
  message: string,
): M4IpcResponse {
  return { version: 1, ok: false, operation, error: { code, message } };
}

const UNSAFE_ERROR_TEXT = /[\u0000-\u001f\u007f-\u009f]|(?:file:\/\/|\/(?:home|users|tmp|var|etc)\/|[a-z]:\\)/iu;

function safeHandlerMessage(value: string): string {
  return value.length > 0 && value.length <= 500 && !UNSAFE_ERROR_TEXT.test(value)
    ? value
    : "That action could not be completed safely. Your bulletin was not changed.";
}

function assertPdfBytes(value: unknown): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength < 5 || value.byteLength > M4_IPC_LIMITS.pdfBytes) {
    throw new M4ContractError();
  }
  if (
    value[0] !== 0x25 ||
    value[1] !== 0x50 ||
    value[2] !== 0x44 ||
    value[3] !== 0x46 ||
    value[4] !== 0x2d
  ) {
    throw new M4ContractError();
  }
}

function assertImageAssetBytes(value: unknown): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength < 1 ||
    value.byteLength > M4_IPC_LIMITS.imageAssetBytes) {
    throw new M4ContractError();
  }
}

async function invokeParsed(
  request: M4IpcRequest,
  handlers: M4RendererServiceHandlers,
): Promise<M4IpcResponse> {
  switch (request.operation) {
    case "bootstrap.read": {
      const state = await handlers.readBootstrapState();
      assertM4BootstrapState(state);
      return success(request.operation, state);
    }
    case "workspace.chooseLocation": {
      const outcome = await handlers.chooseWorkspaceLocation();
      assertM4WorkspaceLocationOutcome(outcome);
      return success(request.operation, outcome);
    }
    case "documents.list": {
      const rows = await handlers.listDocuments(request.payload.filter);
      if (!Array.isArray(rows) || rows.length > M4_IPC_LIMITS.maximumDocumentRows) throw new M4ContractError();
      for (const row of rows) assertM4DocumentSummary(row);
      return success(request.operation, rows);
    }
    case "documents.load": {
      const loaded = await handlers.loadDocument(request.payload.localResourceId);
      assertM4LoadedDocument(loaded);
      return success(request.operation, loaded);
    }
    case "documents.save": {
      const outcome = await handlers.saveDocument(request.payload);
      assertM4SaveOutcome(outcome);
      return success(request.operation, outcome);
    }
    case "documents.saveState": {
      await handlers.setDocumentSaveState(request.payload.localResourceId, request.payload.state);
      return success(request.operation, true);
    }
    case "editBuffer.read": {
      const buffer = await handlers.readEditBuffer(
        request.payload.localResourceId,
        request.payload.bufferKey,
      );
      if (buffer !== null) assertM4EditBuffer(buffer);
      return success(request.operation, buffer);
    }
    case "editBuffer.write": {
      const buffer = await handlers.writeEditBuffer(
        request.payload.localResourceId,
        request.payload.bufferKey,
        request.payload.value,
      );
      assertM4EditBuffer(buffer);
      return success(request.operation, buffer);
    }
    case "editBuffer.delete": {
      const deleted = await handlers.deleteEditBuffer(
        request.payload.localResourceId,
        request.payload.bufferKey,
      );
      if (typeof deleted !== "boolean") throw new M4ContractError();
      return success(request.operation, deleted);
    }
    case "editBuffer.saveState": {
      await handlers.setEditBufferSaveState(
        request.payload.localResourceId,
        request.payload.state,
      );
      return success(request.operation, true);
    }
    case "appSettings.read": {
      const settings = await handlers.readAppSettings();
      assertBoundedJson(settings, M4_IPC_LIMITS.appSettingsBytes);
      return success(request.operation, settings);
    }
    case "appSettings.write": {
      const settings = await handlers.writeAppSettings(request.payload.value);
      assertBoundedJson(settings, M4_IPC_LIMITS.appSettingsBytes);
      return success(request.operation, settings);
    }
    case "workspaceSettings.read": {
      const settings = await handlers.readWorkspaceSettings();
      assertM4WorkspaceSettingsSnapshot(settings);
      return success(request.operation, settings);
    }
    case "workspaceSettings.write": {
      const outcome = await handlers.writeWorkspaceSettings(
        request.payload.value,
        request.payload.baseRevisionToken,
      );
      assertM4WorkspaceSettingsSaveOutcome(outcome);
      return success(request.operation, outcome);
    }
    case "churchProfile.read": {
      const profile = await handlers.readChurchProfile();
      assertM4ChurchProfileSnapshot(profile);
      return success(request.operation, profile);
    }
    case "churchProfile.write": {
      const outcome = await handlers.writeChurchProfile(
        request.payload.value,
        request.payload.baseRevisionToken,
      );
      assertM4ChurchProfileSaveOutcome(outcome);
      return success(request.operation, outcome);
    }
    case "assets.images.list": {
      const assets = await handlers.listImageAssets();
      if (!Array.isArray(assets) || assets.length > M4_IPC_LIMITS.maximumImageAssetRows) {
        throw new M4ContractError();
      }
      for (const asset of assets) assertM4ImageAssetSummary(asset);
      return success(request.operation, assets);
    }
    case "assets.image.import": {
      const outcome = await handlers.importImageAsset();
      assertM4ImageAssetImportOutcome(outcome);
      return success(request.operation, outcome);
    }
    case "assets.image.read": {
      const bytes = await handlers.readImageAssetBytes(
        request.payload.localAssetId,
        request.payload.assetRef,
      );
      assertImageAssetBytes(bytes);
      return success(request.operation, bytes);
    }
    case "preview.request": {
      const admission = await handlers.requestPreview(request.payload);
      assertM4PreviewAdmission(admission);
      return success(request.operation, admission);
    }
    case "preview.state": {
      const state = await handlers.getPreviewState(request.payload.localResourceId);
      assertM4PreviewState(state);
      return success(request.operation, state);
    }
    case "preview.cancel": {
      const canceled = await handlers.cancelPreview(request.payload.buildId);
      if (typeof canceled !== "boolean") throw new M4ContractError();
      return success(request.operation, canceled);
    }
    case "pdf.read": {
      const bytes = await handlers.readPdfBytes(
        request.payload.bulletinLocalResourceId,
        request.payload.buildId,
      );
      assertPdfBytes(bytes);
      return success(request.operation, bytes);
    }
  }
}

/**
 * Validate both sides of every renderer request. Handler exceptions are reduced
 * to a closed, user-safe error; technical details never cross the preload seam.
 */
export async function dispatchM4IpcRequest(
  rawRequest: unknown,
  handlers: M4RendererServiceHandlers,
): Promise<M4IpcResponse> {
  let request: M4IpcRequest;
  try {
    request = parseM4IpcRequest(rawRequest);
  } catch {
    return failure("invalid", "invalidRequest", "The app could not understand that request.");
  }
  try {
    return await invokeParsed(request, handlers);
  } catch (error) {
    if (error instanceof M4HandlerError) {
      return failure(request.operation, error.code, safeHandlerMessage(error.userMessage));
    }
    return failure(
      request.operation,
      "failed",
      "That action could not be completed safely. Your bulletin was not changed.",
    );
  }
}

export interface M4IpcInvokeEvent {
  readonly sender: { readonly id: number };
  readonly senderFrame?: { readonly url: string; readonly parent?: unknown | null } | null;
}

export interface M4IpcMainPort {
  handle(
    channel: string,
    listener: (event: M4IpcInvokeEvent, request: unknown) => Promise<M4IpcResponse>,
  ): void;
  removeHandler(channel: string): void;
}

export interface M4IpcRegistrationOptions {
  /** Bind authorization to the exact BrowserWindow/main-frame created by the host. */
  readonly isTrustedSender: (event: M4IpcInvokeEvent) => boolean;
}

export function registerM4IpcHandler(
  ipcMain: M4IpcMainPort,
  handlers: M4RendererServiceHandlers,
  options: M4IpcRegistrationOptions,
): () => void {
  ipcMain.handle(M4_IPC_CHANNEL, async (event, request) => {
    if (!options.isTrustedSender(event)) {
      return failure("invalid", "notAuthorized", "This window is not allowed to perform that action.");
    }
    return dispatchM4IpcRequest(request, handlers);
  });
  return () => ipcMain.removeHandler(M4_IPC_CHANNEL);
}
