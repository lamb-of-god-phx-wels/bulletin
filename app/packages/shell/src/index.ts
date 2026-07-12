/**
 * @cbb/shell — Electron application shell for the Church Bulletin Builder.
 *
 * Entry point for the Electron main process. Owns application lifecycle,
 * IPC bridge configuration, BrowserWindow management, auto-update,
 * single-instance lock, and packaging entry points.
 */

export const SHELL_PACKAGE_NAME = "@cbb/shell" as const;
