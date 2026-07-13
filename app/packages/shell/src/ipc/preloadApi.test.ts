import { describe, expect, it, vi } from "vitest";
import { M4_IPC_CHANNEL, type M4IpcRequest } from "./contract.js";
import {
  M4RendererBridgeError,
  createM4PreloadApi,
  type M4InvokePort,
} from "./preloadApi.js";

const ID = "10000000-0000-4000-8000-000000000001";
const REVISION = `sha256:${"a".repeat(64)}`;

function port(
  value: (request: M4IpcRequest) => unknown,
): M4InvokePort & { invoke: ReturnType<typeof vi.fn> } {
  return {
    invoke: vi.fn(async (_channel: string, request: M4IpcRequest) => value(request)),
  };
}

describe("M4 preload API", () => {
  it("exposes a frozen method-only bridge over the one invoke channel", async () => {
    const invoke = port((request) => ({
      version: 1,
      ok: true,
      operation: request.operation,
      value: request.operation === "documents.list" ? [] : null,
    }));
    const bridge = createM4PreloadApi(invoke);
    expect(Object.isFrozen(bridge)).toBe(true);
    expect(Object.keys(bridge).sort()).toEqual([
      "cancelPreview",
      "chooseWorkspaceLocation",
      "deleteEditBuffer",
      "getPreviewState",
      "importImageAsset",
      "listDocuments",
      "listImageAssets",
      "loadDocument",
      "readAppSettings",
      "readBootstrapState",
      "readChurchProfile",
      "readEditBuffer",
      "readImageAssetBytes",
      "readPdfBytes",
      "readWorkspaceSettings",
      "requestPreview",
      "saveDocument",
      "setDocumentSaveState",
      "setEditBufferSaveState",
      "version",
      "writeAppSettings",
      "writeChurchProfile",
      "writeEditBuffer",
      "writeWorkspaceSettings",
    ]);
    await bridge.listDocuments();
    expect(invoke.invoke).toHaveBeenCalledWith(
      M4_IPC_CHANNEL,
      { version: 1, operation: "documents.list", payload: { filter: "all" } },
    );
  });

  it("exposes validated settings, preview, and shutdown-state seams", async () => {
    const workspaceSettings = {
      version: 1 as const,
      kind: "workspaceSettings" as const,
      scope: "workspace" as const,
      viewMode: "contiguous" as const,
      pagePresentation: "facing" as const,
      previewZoom: 125,
      marginGuides: false,
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
    const churchProfile = {
      version: 1 as const,
      kind: "churchProfile" as const,
      congregationName: "Lamb of God",
      language: "en-US",
    };
    const invoke = port((request) => {
      let value: unknown;
      switch (request.operation) {
        case "bootstrap.read":
          value = { workspaceAccess: "readWrite" };
          break;
        case "workspace.chooseLocation":
          value = { status: "canceled" };
          break;
        case "documents.saveState":
        case "editBuffer.saveState":
          value = true;
          break;
        case "workspaceSettings.read":
          value = { value: workspaceSettings, revisionToken: REVISION };
          break;
        case "workspaceSettings.write":
          value = { status: "saved", value: request.payload.value, revisionToken: REVISION };
          break;
        case "churchProfile.read":
          value = { value: churchProfile, revisionToken: REVISION };
          break;
        case "churchProfile.write":
          value = { status: "saved", value: request.payload.value, revisionToken: REVISION };
          break;
        case "preview.request":
          value = { status: "enqueued", buildId: "20000000-0000-4000-8000-000000000001" };
          break;
        case "preview.state":
          value = {
            status: "current",
            lastSuccessfulBuildId: "20000000-0000-4000-8000-000000000001",
            pageCount: 2,
            navigationMap: {
              version: 1,
              entries: [{
                resolvedId: "resolved-title",
                sourceElementId: "title",
                pageNumber: 1,
                region: "body",
              }],
            },
          };
          break;
        case "preview.cancel":
          value = true;
          break;
        default:
          value = null;
      }
      return { version: 1, ok: true, operation: request.operation, value };
    });
    const bridge = createM4PreloadApi(invoke);
    await expect(bridge.readBootstrapState()).resolves.toEqual({ workspaceAccess: "readWrite" });
    await expect(bridge.chooseWorkspaceLocation()).resolves.toEqual({ status: "canceled" });
    await expect(bridge.setDocumentSaveState(ID, "dirty")).resolves.toBeUndefined();
    await expect(bridge.setEditBufferSaveState(ID, "pending")).resolves.toBeUndefined();
    await expect(bridge.readWorkspaceSettings()).resolves.toEqual({
      value: workspaceSettings,
      revisionToken: REVISION,
    });
    await expect(bridge.writeWorkspaceSettings(workspaceSettings, REVISION))
      .resolves.toMatchObject({ status: "saved" });
    await expect(bridge.readChurchProfile()).resolves.toEqual({
      value: churchProfile,
      revisionToken: REVISION,
    });
    await expect(bridge.writeChurchProfile(churchProfile, REVISION))
      .resolves.toEqual({ status: "saved", value: churchProfile, revisionToken: REVISION });
    await expect(bridge.requestPreview({ localResourceId: ID, requestSequence: 1 }))
      .resolves.toMatchObject({ status: "enqueued" });
    await expect(bridge.getPreviewState(ID)).resolves.toMatchObject({
      status: "current",
      pageCount: 2,
      navigationMap: { entries: [{ sourceElementId: "title", pageNumber: 1 }] },
    });
    await expect(bridge.cancelPreview("20000000-0000-4000-8000-000000000001"))
      .resolves.toBe(true);
  });

  it("validates renderer arguments before IPC", async () => {
    const invoke = port(() => undefined);
    const bridge = createM4PreloadApi(invoke);
    await expect(bridge.loadDocument("../../etc/passwd")).rejects.toThrow();
    expect(invoke.invoke).not.toHaveBeenCalled();
  });

  it("does not expose raw IPC transport errors to the renderer", async () => {
    const bridge = createM4PreloadApi({
      async invoke() {
        throw new Error("No handler for cbb:m4:invoke at /private/preload.js");
      },
    });
    await expect(bridge.listDocuments()).rejects.toMatchObject({
      bridgeError: {
        code: "unavailable",
        message: "The desktop service is temporarily unavailable.",
      },
    });
  });

  it("validates returned values and preserves only closed safe errors", async () => {
    const malformed = createM4PreloadApi(port((request) => ({
      version: 1,
      ok: true,
      operation: request.operation,
      value: [{ path: "/private/file", localResourceId: ID }],
    })));
    await expect(malformed.listDocuments()).rejects.toBeInstanceOf(M4RendererBridgeError);

    const safe = createM4PreloadApi(port((request) => ({
      version: 1,
      ok: false,
      operation: request.operation,
      error: { code: "notFound", message: "That bulletin is gone." },
    })));
    await expect(safe.loadDocument(ID)).rejects.toMatchObject({
      bridgeError: { code: "notFound", message: "That bulletin is gone." },
    });
  });

  it("copies validated PDF bytes before returning them", async () => {
    const original = new TextEncoder().encode("%PDF-1.7\n%%EOF\n");
    const bridge = createM4PreloadApi(port((request) => ({
      version: 1,
      ok: true,
      operation: request.operation,
      value: original,
    })));
    const returned = await bridge.readPdfBytes(ID, "20000000-0000-4000-8000-000000000001");
    expect(returned).toEqual(original);
    expect(returned).not.toBe(original);
    returned[0] = 0;
    expect(original[0]).toBe(0x25);
  });

  it("validates path-free image summaries and copies their bounded bytes", async () => {
    const localAssetId = "30000000-0000-4000-8000-000000000001";
    const assetRef = "asset:40000000-0000-4000-8000-000000000001";
    const original = new Uint8Array([1, 2, 3]);
    const summary = {
      localAssetId,
      assetRef,
      displayName: "Sanctuary",
      mediaType: "image/png",
      byteSize: original.byteLength,
      pixelWidth: 1200,
      pixelHeight: 800,
      importedAt: "2026-07-12T12:00:00.000Z",
    };
    const bridge = createM4PreloadApi(port((request) => ({
      version: 1,
      ok: true,
      operation: request.operation,
      value: request.operation === "assets.images.list"
        ? [summary]
        : request.operation === "assets.image.import"
          ? { status: "imported", asset: summary }
          : original,
    })));
    await expect(bridge.listImageAssets()).resolves.toEqual([summary]);
    await expect(bridge.importImageAsset()).resolves.toEqual({ status: "imported", asset: summary });
    const returned = await bridge.readImageAssetBytes(localAssetId, assetRef);
    expect(returned).toEqual(original);
    expect(returned).not.toBe(original);
    returned[0] = 0;
    expect(original[0]).toBe(1);
  });

  it("accepts valid loaded documents", async () => {
    const loaded = {
      localResourceId: ID,
      resourceKind: "bulletin",
      displayName: "Sunday Worship",
      modifiedAt: "2026-07-12T12:00:00.000Z",
      revisionToken: REVISION,
      document: { version: 1, kind: "bulletin", name: "Sunday Worship", page: { typstWidth: "8.5in", typstHeight: "11in" }, elements: [] },
    };
    const bridge = createM4PreloadApi(port((request) => ({
      version: 1,
      ok: true,
      operation: request.operation,
      value: loaded,
    })));
    await expect(bridge.loadDocument(ID)).resolves.toEqual(loaded);
  });
});
