/**
 * @cbb/shell — Electron application shell for the Church Bulletin Builder.
 *
 * Entry point for the Electron main process. Owns application lifecycle,
 * IPC bridge configuration, BrowserWindow management, auto-update,
 * single-instance lock, and packaging entry points.
 */

export const SHELL_PACKAGE_NAME = "@cbb/shell" as const;

export * from "./composition.js";
export * from "./ipc/contract.js";
export * from "./ipc/dispatcher.js";
export * from "./ipc/preloadApi.js";
export * from "./ipc/workspaceHandlers.js";
export * from "./ipc/nodeAuxiliaryHandlers.js";
export * from "./ipc/nodeImageAssetCatalog.js";
export * from "./electron/windowPolicy.js";
export * from "./electron/windowHost.js";
export * from "./electron/defaultPaths.js";
export * from "./electron/schemaCatalog.js";
export * from "./electron/shutdownGuard.js";
