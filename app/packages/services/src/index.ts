/**
 * @cbb/services — main-process service layer for the Church Bulletin Builder.
 *
 * Runs in the Electron main process. Owns workspace, persistence, build,
 * assets, fonts, library, export, history, backup, and other services.
 */

export const SERVICES_PACKAGE_NAME = "@cbb/services" as const;
