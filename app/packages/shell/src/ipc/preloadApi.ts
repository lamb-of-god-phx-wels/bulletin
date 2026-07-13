import {
  M4_BRIDGE_VERSION,
  M4_IPC_CHANNEL,
  M4_IPC_LIMITS,
  assertM4BootstrapState,
  assertM4ChurchProfileSaveOutcome,
  assertM4ChurchProfileSnapshot,
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
  type M4BridgeError,
  type M4BootstrapState,
  type M4ChurchProfile,
  type M4ChurchProfileSaveOutcome,
  type M4ChurchProfileSnapshot,
  type M4DocumentFilter,
  type M4DocumentSummary,
  type M4EditBufferValue,
  type M4EditBufferSaveState,
  type M4IpcOperation,
  type M4IpcRequest,
  type M4IpcResponse,
  type M4ImageAssetImportOutcome,
  type M4ImageAssetSummary,
  type M4JsonValue,
  type M4LoadedDocument,
  type M4RendererBridge,
  type M4SaveDocumentOutcome,
  type M4DocumentSaveState,
  type M4PreviewAdmission,
  type M4PreviewState,
  type M4WorkspaceSettings,
  type M4WorkspaceSettingsSaveOutcome,
  type M4WorkspaceSettingsSnapshot,
  type M4WorkspaceLocationOutcome,
} from "./contract.js";

export const M4_PRELOAD_GLOBAL = "churchBulletinBuilder" as const;

export interface M4InvokePort {
  invoke(channel: string, request: M4IpcRequest): Promise<unknown>;
}

export class M4RendererBridgeError extends Error {
  constructor(readonly bridgeError: M4BridgeError) {
    super(bridgeError.message);
    this.name = "M4RendererBridgeError";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  // IPC/contextBridge values may originate in a distinct V8 realm, so its
  // Object.prototype is not reference-equal to ours. A genuine plain-object
  // prototype still has null as its own prototype; class/custom prototypes do not.
  return prototype === null ||
    prototype === Object.prototype ||
    (typeof prototype === "object" && Object.getPrototypeOf(prototype) === null);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    Object.keys(value).every((key) => keys.includes(key));
}

function parseResponse(
  value: unknown,
  expectedOperation: M4IpcOperation,
): Extract<M4IpcResponse, { ok: true }> {
  if (!record(value) || value["version"] !== 1 || value["operation"] !== expectedOperation || typeof value["ok"] !== "boolean") {
    throw new M4RendererBridgeError({
      code: "failed",
      message: "The application returned an invalid response.",
    });
  }
  if (value["ok"] === false) {
    if (!exactKeys(value, ["version", "ok", "operation", "error"]) || !record(value["error"])) {
      throw new M4RendererBridgeError({ code: "failed", message: "The application returned an invalid response." });
    }
    const error = value["error"];
    const codes = ["invalidRequest", "notAuthorized", "notFound", "conflict", "unavailable", "failed"];
    if (!exactKeys(error, ["code", "message"]) || !codes.includes(String(error["code"])) ||
      typeof error["message"] !== "string" || error["message"].length === 0 || error["message"].length > 500) {
      throw new M4RendererBridgeError({ code: "failed", message: "The application returned an invalid response." });
    }
    throw new M4RendererBridgeError({
      code: error["code"] as M4BridgeError["code"],
      message: error["message"],
    });
  }
  if (!exactKeys(value, ["version", "ok", "operation", "value"])) {
    throw new M4RendererBridgeError({ code: "failed", message: "The application returned an invalid response." });
  }
  return value as unknown as Extract<M4IpcResponse, { ok: true }>;
}

async function call(
  port: M4InvokePort,
  request: M4IpcRequest,
): Promise<unknown> {
  // The preload validates its own outgoing values too; a compromised renderer
  // cannot use this object to reach a more permissive IPC shape.
  let closedRequest: M4IpcRequest;
  try {
    closedRequest = parseM4IpcRequest(request);
  } catch {
    throw new M4RendererBridgeError({
      code: "invalidRequest",
      message: "The app could not understand that request.",
    });
  }
  let response: unknown;
  try {
    response = await port.invoke(M4_IPC_CHANNEL, closedRequest);
  } catch {
    throw new M4RendererBridgeError({
      code: "unavailable",
      message: "The desktop service is temporarily unavailable.",
    });
  }
  return parseResponse(response, closedRequest.operation).value;
}

function assertPdf(value: unknown): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength < 5 || value.byteLength > M4_IPC_LIMITS.pdfBytes ||
    value[0] !== 0x25 || value[1] !== 0x50 || value[2] !== 0x44 || value[3] !== 0x46 || value[4] !== 0x2d) {
    throw new M4RendererBridgeError({ code: "failed", message: "The application returned an invalid PDF." });
  }
}

function assertImageAssetBytes(value: unknown): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength < 1 ||
    value.byteLength > M4_IPC_LIMITS.imageAssetBytes) {
    throw new M4RendererBridgeError({
      code: "failed",
      message: "The application returned an invalid image.",
    });
  }
}

function validatedResponseValue<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof M4RendererBridgeError) throw error;
    throw new M4RendererBridgeError({
      code: "failed",
      message: "The application returned an invalid response.",
    });
  }
}

export function createM4PreloadApi(port: M4InvokePort): M4RendererBridge {
  const api: M4RendererBridge = {
    version: M4_BRIDGE_VERSION,
    async readBootstrapState(): Promise<M4BootstrapState> {
      const value = await call(port, {
        version: 1,
        operation: "bootstrap.read",
        payload: {},
      });
      return validatedResponseValue(() => {
        assertM4BootstrapState(value);
        return value;
      });
    },
    async chooseWorkspaceLocation(): Promise<M4WorkspaceLocationOutcome> {
      const value = await call(port, {
        version: 1,
        operation: "workspace.chooseLocation",
        payload: {},
      });
      return validatedResponseValue(() => {
        assertM4WorkspaceLocationOutcome(value);
        return value;
      });
    },
    async listDocuments(filter: M4DocumentFilter = "all"): Promise<readonly M4DocumentSummary[]> {
      const value = await call(port, {
        version: 1,
        operation: "documents.list",
        payload: { filter },
      });
      if (!Array.isArray(value) || value.length > M4_IPC_LIMITS.maximumDocumentRows) {
        throw new M4RendererBridgeError({ code: "failed", message: "The application returned an invalid bulletin list." });
      }
      return validatedResponseValue(() => {
        for (const row of value) assertM4DocumentSummary(row);
        return value;
      });
    },
    async loadDocument(localResourceId: string): Promise<M4LoadedDocument> {
      const value = await call(port, {
        version: 1,
        operation: "documents.load",
        payload: { localResourceId },
      });
      return validatedResponseValue(() => {
        assertM4LoadedDocument(value);
        return value;
      });
    },
    async saveDocument(input): Promise<M4SaveDocumentOutcome> {
      const value = await call(port, {
        version: 1,
        operation: "documents.save",
        payload: input,
      });
      return validatedResponseValue(() => {
        assertM4SaveOutcome(value);
        return value;
      });
    },
    async setDocumentSaveState(localResourceId: string, state: M4DocumentSaveState): Promise<void> {
      const value = await call(port, {
        version: 1,
        operation: "documents.saveState",
        payload: { localResourceId, state },
      });
      if (value !== true) {
        throw new M4RendererBridgeError({ code: "failed", message: "The application returned an invalid response." });
      }
    },
    async readEditBuffer(localResourceId: string, bufferKey: string): Promise<M4EditBufferValue | null> {
      const value = await call(port, {
        version: 1,
        operation: "editBuffer.read",
        payload: { localResourceId, bufferKey },
      });
      return validatedResponseValue(() => {
        if (value !== null) assertM4EditBuffer(value);
        return value;
      });
    },
    async writeEditBuffer(localResourceId: string, bufferKey: string, value: string): Promise<M4EditBufferValue> {
      const result = await call(port, {
        version: 1,
        operation: "editBuffer.write",
        payload: { localResourceId, bufferKey, value },
      });
      return validatedResponseValue(() => {
        assertM4EditBuffer(result);
        return result;
      });
    },
    async deleteEditBuffer(localResourceId: string, bufferKey: string): Promise<boolean> {
      const value = await call(port, {
        version: 1,
        operation: "editBuffer.delete",
        payload: { localResourceId, bufferKey },
      });
      if (typeof value !== "boolean") {
        throw new M4RendererBridgeError({ code: "failed", message: "The application returned an invalid response." });
      }
      return value;
    },
    async setEditBufferSaveState(localResourceId: string, state: M4EditBufferSaveState): Promise<void> {
      const value = await call(port, {
        version: 1,
        operation: "editBuffer.saveState",
        payload: { localResourceId, state },
      });
      if (value !== true) {
        throw new M4RendererBridgeError({ code: "failed", message: "The application returned an invalid response." });
      }
    },
    async readAppSettings(): Promise<M4JsonValue> {
      const value = await call(port, {
        version: 1,
        operation: "appSettings.read",
        payload: {},
      });
      return validatedResponseValue(() => {
        assertBoundedJson(value, M4_IPC_LIMITS.appSettingsBytes);
        return value;
      });
    },
    async writeAppSettings(value: M4JsonValue): Promise<M4JsonValue> {
      const result = await call(port, {
        version: 1,
        operation: "appSettings.write",
        payload: { value },
      });
      return validatedResponseValue(() => {
        assertBoundedJson(result, M4_IPC_LIMITS.appSettingsBytes);
        return result;
      });
    },
    async readWorkspaceSettings(): Promise<M4WorkspaceSettingsSnapshot> {
      const value = await call(port, {
        version: 1,
        operation: "workspaceSettings.read",
        payload: {},
      });
      return validatedResponseValue(() => {
        assertM4WorkspaceSettingsSnapshot(value);
        return value;
      });
    },
    async writeWorkspaceSettings(
      value: M4WorkspaceSettings,
      baseRevisionToken: string,
    ): Promise<M4WorkspaceSettingsSaveOutcome> {
      const result = await call(port, {
        version: 1,
        operation: "workspaceSettings.write",
        payload: { value, baseRevisionToken },
      });
      return validatedResponseValue(() => {
        assertM4WorkspaceSettingsSaveOutcome(result);
        return result;
      });
    },
    async readChurchProfile(): Promise<M4ChurchProfileSnapshot> {
      const value = await call(port, {
        version: 1,
        operation: "churchProfile.read",
        payload: {},
      });
      return validatedResponseValue(() => {
        assertM4ChurchProfileSnapshot(value);
        return value;
      });
    },
    async writeChurchProfile(
      value: M4ChurchProfile,
      baseRevisionToken: string | null,
    ): Promise<M4ChurchProfileSaveOutcome> {
      const result = await call(port, {
        version: 1,
        operation: "churchProfile.write",
        payload: { value, baseRevisionToken },
      });
      return validatedResponseValue(() => {
        assertM4ChurchProfileSaveOutcome(result);
        return result;
      });
    },
    async listImageAssets(): Promise<readonly M4ImageAssetSummary[]> {
      const value = await call(port, {
        version: 1,
        operation: "assets.images.list",
        payload: {},
      });
      if (!Array.isArray(value) || value.length > M4_IPC_LIMITS.maximumImageAssetRows) {
        throw new M4RendererBridgeError({
          code: "failed",
          message: "The application returned an invalid image library.",
        });
      }
      return validatedResponseValue(() => {
        for (const row of value) assertM4ImageAssetSummary(row);
        return value;
      });
    },
    async importImageAsset(): Promise<M4ImageAssetImportOutcome> {
      const value = await call(port, {
        version: 1,
        operation: "assets.image.import",
        payload: {},
      });
      return validatedResponseValue(() => {
        assertM4ImageAssetImportOutcome(value);
        return value;
      });
    },
    async readImageAssetBytes(localAssetId: string, assetRef: string): Promise<Uint8Array> {
      const value = await call(port, {
        version: 1,
        operation: "assets.image.read",
        payload: { localAssetId, assetRef },
      });
      assertImageAssetBytes(value);
      return new Uint8Array(value);
    },
    async requestPreview(input): Promise<M4PreviewAdmission> {
      const value = await call(port, {
        version: 1,
        operation: "preview.request",
        payload: input,
      });
      return validatedResponseValue(() => {
        assertM4PreviewAdmission(value);
        return value;
      });
    },
    async getPreviewState(localResourceId: string): Promise<M4PreviewState> {
      const value = await call(port, {
        version: 1,
        operation: "preview.state",
        payload: { localResourceId },
      });
      return validatedResponseValue(() => {
        assertM4PreviewState(value);
        return value;
      });
    },
    async cancelPreview(buildId: string): Promise<boolean> {
      const value = await call(port, {
        version: 1,
        operation: "preview.cancel",
        payload: { buildId },
      });
      if (typeof value !== "boolean") {
        throw new M4RendererBridgeError({ code: "failed", message: "The application returned an invalid response." });
      }
      return value;
    },
    async readPdfBytes(bulletinLocalResourceId: string, buildId: string): Promise<Uint8Array> {
      const value = await call(port, {
        version: 1,
        operation: "pdf.read",
        payload: { bulletinLocalResourceId, buildId },
      });
      assertPdf(value);
      return new Uint8Array(value);
    },
  };
  return Object.freeze(api);
}
