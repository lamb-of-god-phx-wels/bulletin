import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  IpcMain,
  OnBeforeRequestListenerDetails,
  OnHeadersReceivedListenerDetails,
} from "electron";
import type { M4RendererServiceHandlers } from "../ipc/dispatcher.js";
import { registerM4IpcHandler } from "../ipc/dispatcher.js";
import {
  contentSecurityPolicy,
  createSecureWebPreferences,
  isTrustedRendererUrl,
  rendererStartUrl,
  type M4TrustedRendererLocation,
} from "./windowPolicy.js";

export interface M4BrowserWindowConstructor {
  new (options: BrowserWindowConstructorOptions): BrowserWindow;
}

export interface CreateM4WindowOptions {
  readonly BrowserWindow: M4BrowserWindowConstructor;
  readonly ipcMain: IpcMain;
  readonly preloadPath: string;
  readonly renderer: M4TrustedRendererLocation;
  readonly handlers: M4RendererServiceHandlers;
  readonly title?: string;
}

export interface M4WindowHandle {
  readonly window: BrowserWindow;
  dispose(): void;
}

/** Construct one renderer window with every ambient browser capability denied. */
export async function createM4Window(options: CreateM4WindowOptions): Promise<M4WindowHandle> {
  const startUrl = rendererStartUrl(options.renderer);
  const csp = contentSecurityPolicy(options.renderer);
  const window = new options.BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 480,
    useContentSize: true,
    show: false,
    backgroundColor: "#f4f0e8",
    title: options.title ?? "Church Bulletin Builder",
    autoHideMenuBar: false,
    webPreferences: createSecureWebPreferences(
      options.preloadPath,
      options.renderer.kind === "development",
    ),
  });

  const session = window.webContents.session;
  session.setPermissionCheckHandler(() => false);
  session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.setDevicePermissionHandler(() => false);
  session.webRequest.onBeforeRequest(
    { urls: ["<all_urls>"] },
    (details: OnBeforeRequestListenerDetails, callback) => {
      callback({ cancel: !isTrustedRendererUrl(details.url, options.renderer) });
    },
  );
  session.webRequest.onHeadersReceived(
    { urls: ["<all_urls>"] },
    (details: OnHeadersReceivedListenerDetails, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [csp],
          "Cross-Origin-Opener-Policy": ["same-origin"],
          "X-Content-Type-Options": ["nosniff"],
        },
      });
    },
  );

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedRendererUrl(url, options.renderer)) event.preventDefault();
  });
  session.on("will-download", (event) => event.preventDefault());

  const disposeIpc = registerM4IpcHandler(
    options.ipcMain,
    options.handlers,
    {
      isTrustedSender: (event) =>
        event.sender.id === window.webContents.id &&
        event.senderFrame !== null &&
        event.senderFrame !== undefined &&
        event.senderFrame.parent === null &&
        isTrustedRendererUrl(event.senderFrame.url, options.renderer),
    },
  );

  window.once("ready-to-show", () => window.show());
  try {
    await window.loadURL(startUrl);
  } catch (error) {
    disposeIpc();
    window.destroy();
    throw error;
  }

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    disposeIpc();
    session.webRequest.onBeforeRequest(null);
    session.webRequest.onHeadersReceived(null);
  };
  window.once("closed", dispose);
  return { window, dispose };
}
