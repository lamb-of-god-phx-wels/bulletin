import { describe, expect, it, vi } from "vitest";
import type { BrowserWindowConstructorOptions, IpcMain } from "electron";
import { M4_IPC_CHANNEL, type M4IpcResponse } from "../ipc/contract.js";
import type { M4IpcInvokeEvent, M4RendererServiceHandlers } from "../ipc/dispatcher.js";
import { createM4Window, type M4BrowserWindowConstructor } from "./windowHost.js";
import { selectM4RendererLocation } from "./windowPolicy.js";

function handlers(): M4RendererServiceHandlers {
  return {
    async readBootstrapState() { return { workspaceAccess: "readWrite" }; },
    async chooseWorkspaceLocation() { return { status: "canceled" }; },
    async listDocuments() { return []; },
    async loadDocument() { throw new Error("not used"); },
    async saveDocument() { return { status: "failed", message: "not used" }; },
    async setDocumentSaveState() {},
    async setEditBufferSaveState() {},
    async readEditBuffer() { return null; },
    async writeEditBuffer(_id, _key, value) { return { value, updatedAt: "2026-07-12T12:00:00.000Z" }; },
    async deleteEditBuffer() { return false; },
    async readAppSettings() { return { version: 1 }; },
    async writeAppSettings(value) { return value; },
    async readWorkspaceSettings() {
      return {
        value: { version: 1, kind: "workspaceSettings" },
        revisionToken: `sha256:${"a".repeat(64)}`,
      };
    },
    async writeWorkspaceSettings(value) {
      return { status: "saved", value, revisionToken: `sha256:${"a".repeat(64)}` };
    },
    async readChurchProfile() { return { value: null, revisionToken: null }; },
    async writeChurchProfile(value) {
      return { status: "saved", value, revisionToken: `sha256:${"b".repeat(64)}` };
    },
    async listImageAssets() { return []; },
    async importImageAsset() { return { status: "canceled" }; },
    async readImageAssetBytes() { return new Uint8Array([1]); },
    async requestPreview() {
      return { status: "enqueued", buildId: "20000000-0000-4000-8000-000000000001" };
    },
    async getPreviewState() { return { status: "idle" }; },
    async cancelPreview() { return false; },
    async readPdfBytes() { return new TextEncoder().encode("%PDF-1.7\n%%EOF\n"); },
  };
}

describe("M4 Electron window host", () => {
  it("keeps a packaged override sandboxed on the bundled renderer and authorizes only its main frame", async () => {
    let constructorOptions: BrowserWindowConstructorOptions | undefined;
    let beforeRequest: ((details: { url: string }, callback: (result: { cancel: boolean }) => void) => void) | undefined;
    let headersReceived: ((details: { responseHeaders?: Record<string, string[]> }, callback: (result: { responseHeaders: Record<string, string[]> }) => void) => void) | undefined;
    const webContentsListeners = new Map<string, (...args: unknown[]) => void>();
    const windowListeners = new Map<string, (...args: unknown[]) => void>();
    let invokeListener: ((event: M4IpcInvokeEvent, request: unknown) => Promise<M4IpcResponse>) | undefined;
    const removeHandler = vi.fn();
    const show = vi.fn();
    const destroy = vi.fn();
    const loadURL = vi.fn(async () => undefined);
    const session = {
      setPermissionCheckHandler: vi.fn(),
      setPermissionRequestHandler: vi.fn(),
      setDevicePermissionHandler: vi.fn(),
      on: vi.fn(),
      webRequest: {
        onBeforeRequest: vi.fn((filter: unknown, listener?: typeof beforeRequest) => {
          if (filter !== null) beforeRequest = listener;
        }),
        onHeadersReceived: vi.fn((filter: unknown, listener?: typeof headersReceived) => {
          if (filter !== null) headersReceived = listener;
        }),
      },
    };
    const webContents = {
      id: 41,
      session,
      setWindowOpenHandler: vi.fn(),
      on: vi.fn((name: string, listener: (...args: unknown[]) => void) => webContentsListeners.set(name, listener)),
    };
    class FakeWindow {
      readonly webContents = webContents;
      constructor(options: BrowserWindowConstructorOptions) { constructorOptions = options; }
      once(name: string, listener: (...args: unknown[]) => void) { windowListeners.set(name, listener); }
      loadURL = loadURL;
      show = show;
      destroy = destroy;
    }
    const ipcMain = {
      handle(channel: string, listener: typeof invokeListener) {
        expect(channel).toBe(M4_IPC_CHANNEL);
        invokeListener = listener;
      },
      removeHandler,
    } as unknown as IpcMain;

    const renderer = selectM4RendererLocation({
      isPackaged: true,
      productionIndexPath: "/opt/cbb/renderer/index.html",
      developmentUrl: "http://127.0.0.1:5173/",
    });
    const handle = await createM4Window({
      BrowserWindow: FakeWindow as unknown as M4BrowserWindowConstructor,
      ipcMain,
      preloadPath: "/opt/cbb/preload.js",
      renderer,
      handlers: handlers(),
    });
    expect(constructorOptions?.webPreferences).toMatchObject({
      preload: "/opt/cbb/preload.js",
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      devTools: false,
    });
    expect(constructorOptions).toMatchObject({ minWidth: 900, minHeight: 480, useContentSize: true });
    expect(loadURL).toHaveBeenCalledWith("file:///opt/cbb/renderer/index.html");
    expect(session.setPermissionCheckHandler).toHaveBeenCalled();
    expect(session.setPermissionRequestHandler).toHaveBeenCalled();
    expect(session.setDevicePermissionHandler).toHaveBeenCalled();
    expect(webContents.setWindowOpenHandler).toHaveBeenCalled();

    let decision: { cancel: boolean } | undefined;
    beforeRequest?.({ url: "https://example.com/collect" }, (result) => { decision = result; });
    expect(decision).toEqual({ cancel: true });
    beforeRequest?.({ url: "file:///opt/cbb/renderer/assets/app.js" }, (result) => { decision = result; });
    expect(decision).toEqual({ cancel: false });
    let responseHeaders: Record<string, string[]> | undefined;
    headersReceived?.({ responseHeaders: {} }, (result) => { responseHeaders = result.responseHeaders; });
    expect(responseHeaders?.["Content-Security-Policy"]?.[0]).toContain("connect-src 'none'");

    const request = { version: 1, operation: "documents.list", payload: { filter: "all" } };
    await expect(invokeListener?.(
      { sender: { id: 41 }, senderFrame: { url: "file:///opt/cbb/renderer/index.html", parent: {} } },
      request,
    )).resolves.toMatchObject({ ok: false, error: { code: "notAuthorized" } });
    await expect(invokeListener?.(
      { sender: { id: 41 }, senderFrame: { url: "http://127.0.0.1:5173/", parent: null } },
      request,
    )).resolves.toMatchObject({ ok: false, error: { code: "notAuthorized" } });
    await expect(invokeListener?.(
      { sender: { id: 41 }, senderFrame: { url: "file:///opt/cbb/renderer/index.html", parent: null } },
      request,
    )).resolves.toMatchObject({ ok: true });

    windowListeners.get("ready-to-show")?.();
    expect(show).toHaveBeenCalled();
    handle.dispose();
    expect(removeHandler).toHaveBeenCalledWith(M4_IPC_CHANNEL);
  });

  it("destroys the window and unregisters IPC when initial loading fails", async () => {
    const removeHandler = vi.fn();
    const destroy = vi.fn();
    const session = {
      setPermissionCheckHandler() {},
      setPermissionRequestHandler() {},
      setDevicePermissionHandler() {},
      on() {},
      webRequest: { onBeforeRequest() {}, onHeadersReceived() {} },
    };
    class FailingWindow {
      readonly webContents = {
        id: 9,
        session,
        setWindowOpenHandler() {},
        on() {},
      };
      once() {}
      async loadURL() { throw new Error("load failed"); }
      show() {}
      destroy = destroy;
    }
    const ipcMain = {
      handle() {},
      removeHandler,
    } as unknown as IpcMain;
    await expect(createM4Window({
      BrowserWindow: FailingWindow as unknown as M4BrowserWindowConstructor,
      ipcMain,
      preloadPath: "/opt/cbb/preload.js",
      renderer: { kind: "file", indexPath: "/opt/cbb/renderer/index.html" },
      handlers: handlers(),
    })).rejects.toThrow("load failed");
    expect(removeHandler).toHaveBeenCalledWith(M4_IPC_CHANNEL);
    expect(destroy).toHaveBeenCalled();
  });
});
