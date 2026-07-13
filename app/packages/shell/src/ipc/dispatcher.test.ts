import { describe, expect, it, vi } from "vitest";
import { M4_IPC_CHANNEL, type M4IpcResponse } from "./contract.js";
import {
  M4HandlerError,
  dispatchM4IpcRequest,
  registerM4IpcHandler,
  type M4IpcInvokeEvent,
  type M4RendererServiceHandlers,
} from "./dispatcher.js";

const ID = "10000000-0000-4000-8000-000000000001";
const BUILD = "20000000-0000-4000-8000-000000000001";
const ASSET_LOCAL_ID = "30000000-0000-4000-8000-000000000001";
const ASSET_REF = "asset:40000000-0000-4000-8000-000000000001";
const REVISION = `sha256:${"a".repeat(64)}`;
const PROFILE = {
  version: 1 as const,
  kind: "churchProfile" as const,
  congregationName: "Lamb of God",
  language: "en-US",
};

function handlers(): M4RendererServiceHandlers {
  return {
    async readBootstrapState() { return { workspaceAccess: "readWrite" }; },
    async chooseWorkspaceLocation() { return { status: "canceled" }; },
    async listDocuments() {
      return [{
        localResourceId: ID,
        resourceKind: "bulletin",
        displayName: "Sunday Worship",
        modifiedAt: "2026-07-12T12:00:00.000Z",
        revisionToken: REVISION,
      }];
    },
    async loadDocument() {
      return {
        localResourceId: ID,
        resourceKind: "bulletin",
        displayName: "Sunday Worship",
        modifiedAt: "2026-07-12T12:00:00.000Z",
        revisionToken: REVISION,
        document: { version: 2, kind: "bulletin", name: "Sunday Worship", page: { typstWidth: "8.5in", typstHeight: "11in" }, elements: [] },
      };
    },
    async saveDocument() { return { status: "saved", revisionToken: REVISION }; },
    async setDocumentSaveState() {},
    async setEditBufferSaveState() {},
    async readEditBuffer() { return null; },
    async writeEditBuffer(_id, _key, value) { return { value, updatedAt: "2026-07-12T12:00:00.000Z" }; },
    async deleteEditBuffer() { return true; },
    async readAppSettings() { return { version: 1, theme: "system" }; },
    async writeAppSettings(value) { return value; },
    async readWorkspaceSettings() {
      return { value: { version: 1, kind: "workspaceSettings" }, revisionToken: REVISION };
    },
    async writeWorkspaceSettings(value) {
      return { status: "saved", value, revisionToken: REVISION };
    },
    async readChurchProfile() {
      return { value: PROFILE, revisionToken: REVISION };
    },
    async writeChurchProfile(value) {
      return { status: "saved", value, revisionToken: REVISION };
    },
    async listImageAssets() {
      return [{
        localAssetId: ASSET_LOCAL_ID,
        assetRef: ASSET_REF,
        displayName: "Sanctuary",
        mediaType: "image/png",
        byteSize: 3,
        pixelWidth: 1200,
        pixelHeight: 800,
        importedAt: "2026-07-12T12:00:00.000Z",
      }];
    },
    async importImageAsset() { return { status: "canceled" }; },
    async readImageAssetBytes() { return new Uint8Array([1, 2, 3]); },
    async requestPreview() { return { status: "enqueued", buildId: BUILD }; },
    async getPreviewState() {
      return { status: "current", lastSuccessfulBuildId: BUILD, pageCount: 2 };
    },
    async cancelPreview() { return true; },
    async readPdfBytes() { return new TextEncoder().encode("%PDF-1.7\n%%EOF\n"); },
  };
}

describe("M4 IPC dispatcher", () => {
  it("routes every closed operation and validates privileged output", async () => {
    const service = handlers();
    const list = await dispatchM4IpcRequest(
      { version: 1, operation: "documents.list", payload: { filter: "all" } },
      service,
    );
    expect(list).toMatchObject({ ok: true, operation: "documents.list" });
    await expect(dispatchM4IpcRequest(
      { version: 1, operation: "workspace.chooseLocation", payload: {} },
      service,
    )).resolves.toMatchObject({ ok: true, value: { status: "canceled" } });
    await expect(dispatchM4IpcRequest(
      { version: 1, operation: "workspaceSettings.read", payload: {} },
      service,
    )).resolves.toMatchObject({ ok: true, operation: "workspaceSettings.read" });
    await expect(dispatchM4IpcRequest(
      { version: 1, operation: "churchProfile.read", payload: {} },
      service,
    )).resolves.toMatchObject({ ok: true, value: { value: PROFILE, revisionToken: REVISION } });
    await expect(dispatchM4IpcRequest(
      {
        version: 1,
        operation: "churchProfile.write",
        payload: { value: PROFILE, baseRevisionToken: REVISION },
      },
      service,
    )).resolves.toMatchObject({ ok: true, operation: "churchProfile.write" });
    await expect(dispatchM4IpcRequest(
      { version: 1, operation: "preview.request", payload: { localResourceId: ID, requestSequence: 1 } },
      service,
    )).resolves.toMatchObject({ ok: true, value: { buildId: BUILD } });
    await expect(dispatchM4IpcRequest(
      { version: 1, operation: "assets.images.list", payload: {} },
      service,
    )).resolves.toMatchObject({ ok: true, value: [{ assetRef: ASSET_REF }] });
    await expect(dispatchM4IpcRequest(
      { version: 1, operation: "assets.image.import", payload: {} },
      service,
    )).resolves.toMatchObject({ ok: true, value: { status: "canceled" } });
    await expect(dispatchM4IpcRequest(
      {
        version: 1,
        operation: "assets.image.read",
        payload: { localAssetId: ASSET_LOCAL_ID, assetRef: ASSET_REF },
      },
      service,
    )).resolves.toMatchObject({ ok: true, operation: "assets.image.read" });
    const pdf = await dispatchM4IpcRequest(
      { version: 1, operation: "pdf.read", payload: { bulletinLocalResourceId: ID, buildId: BUILD } },
      service,
    );
    expect(pdf).toMatchObject({ ok: true, operation: "pdf.read" });
  });

  it("never calls handlers for malformed input", async () => {
    const service = handlers();
    service.loadDocument = vi.fn(service.loadDocument);
    const response = await dispatchM4IpcRequest(
      { version: 1, operation: "documents.load", payload: { localResourceId: "/etc/passwd" } },
      service,
    );
    expect(response).toEqual({
      version: 1,
      ok: false,
      operation: "invalid",
      error: { code: "invalidRequest", message: "The app could not understand that request." },
    });
    expect(service.loadDocument).not.toHaveBeenCalled();
  });

  it("passes only explicit safe errors and suppresses technical exceptions", async () => {
    const safe = handlers();
    safe.loadDocument = async () => { throw new M4HandlerError("notFound", "That bulletin is gone."); };
    await expect(dispatchM4IpcRequest(
      { version: 1, operation: "documents.load", payload: { localResourceId: ID } },
      safe,
    )).resolves.toMatchObject({ ok: false, error: { code: "notFound", message: "That bulletin is gone." } });

    const unsafe = handlers();
    unsafe.loadDocument = async () => { throw new Error("secret path /home/person/private"); };
    const response = await dispatchM4IpcRequest(
      { version: 1, operation: "documents.load", payload: { localResourceId: ID } },
      unsafe,
    );
    expect(response).toMatchObject({ ok: false, error: { code: "failed" } });
    expect(JSON.stringify(response)).not.toContain("/home/person");

    safe.loadDocument = async () => {
      throw new M4HandlerError("notFound", "Missing at /home/person/private/document.json");
    };
    const redactedSafeError = await dispatchM4IpcRequest(
      { version: 1, operation: "documents.load", payload: { localResourceId: ID } },
      safe,
    );
    expect(JSON.stringify(redactedSafeError)).not.toContain("/home/person");
  });

  it("rejects invalid handler output instead of forwarding it", async () => {
    const service = handlers();
    service.listDocuments = async () => [{
      localResourceId: ID,
      resourceKind: "bulletin",
      displayName: "Sunday Worship",
      modifiedAt: "not-a-date",
      revisionToken: REVISION,
    }];
    await expect(dispatchM4IpcRequest(
      { version: 1, operation: "documents.list", payload: { filter: "all" } },
      service,
    )).resolves.toMatchObject({ ok: false, error: { code: "failed" } });
  });

  it("binds the single channel to an exact trusted sender and disposes it", async () => {
    let listener: ((event: M4IpcInvokeEvent, request: unknown) => Promise<M4IpcResponse>) | undefined;
    const removeHandler = vi.fn();
    const dispose = registerM4IpcHandler({
      handle(channel, next) {
        expect(channel).toBe(M4_IPC_CHANNEL);
        listener = next;
      },
      removeHandler,
    }, handlers(), { isTrustedSender: (event) => event.sender.id === 7 });
    expect(listener).toBeDefined();
    await expect(listener?.(
      { sender: { id: 8 }, senderFrame: { url: "file:///app/index.html", parent: null } },
      { version: 1, operation: "documents.list", payload: { filter: "all" } },
    )).resolves.toMatchObject({ ok: false, error: { code: "notAuthorized" } });
    await expect(listener?.(
      { sender: { id: 7 }, senderFrame: { url: "file:///app/index.html", parent: null } },
      { version: 1, operation: "documents.list", payload: { filter: "all" } },
    )).resolves.toMatchObject({ ok: true });
    dispose();
    expect(removeHandler).toHaveBeenCalledWith(M4_IPC_CHANNEL);
  });
});
