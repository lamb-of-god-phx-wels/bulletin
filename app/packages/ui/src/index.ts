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
