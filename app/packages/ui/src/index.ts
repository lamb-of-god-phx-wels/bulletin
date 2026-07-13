/**
 * @cbb/ui — React renderer layer for the Church Bulletin Builder.
 *
 * Runs in the sandboxed Electron renderer process (no Node, context-isolated).
 * Owns the document store, editor surface, inspector, structure panel,
 * PDF preview integration, and design system components.
 *
 * May only import from @cbb/core among sibling packages.
 */

export const UI_PACKAGE_NAME = "@cbb/ui" as const;

export * from "./store/index.js";
export * from "./design-system/index.js";
export * from "./language/index.js";
export * from "./onboarding/index.js";
export * from "./library/index.js";
export { DEFAULT_UI_SETTINGS, SettingsPanel } from "./settings/index.js";
export type {
  AppTheme,
  EditorViewMode as SettingsEditorViewMode,
  PagePresentation,
  PreviewZoom,
  SettingsPanelProps,
  UiSettings,
} from "./settings/index.js";
export * from "./help/index.js";
export * from "./app-shell/index.js";
export * from "./bridge/index.js";
export * from "./editor/index.js";
export * from "./inspector/index.js";
export * from "./structure/index.js";
export * from "./template-authoring/index.js";
export * from "./preview/index.js";
export * from "./app/index.js";
