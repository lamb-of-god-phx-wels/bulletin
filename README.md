# Bulletin Builder

Bulletin Builder is a local-first desktop app for producing a consistent weekly church bulletin from structured content. It runs on Windows and Arch Linux, stores projects in an ordinary synced folder, and exports sequential 7 × 8.5-inch PDF pages ready for a printer's booklet mode.

## Run it

```bash
npm install
npm run dev
```

`npm run build` performs the production TypeScript and Vite build. `npm test` runs the schema, migration, pagination, and shared-workspace tests. `npm run package` creates a Windows NSIS installer or Linux AppImage for the current build platform.

## First use

1. Choose a folder already synchronized by the SharePoint/OneDrive desktop client.
2. The app initializes `templates/`, `bulletins/`, `assets/`, and `library.json` without requiring Microsoft credentials.
3. Add approved songs, liturgy, images, and license notices on the Library screen.
4. Create a week from the published template, fill in the changing content, and resolve each reading through approved Bible Gateway access or the manual paste fallback.
5. Check the live page preview and export. Every export records an immutable JSON revision beside the project.

The app does not bundle copyrighted worship content and does not scrape Bible Gateway. Full-page PDFs remain vector pages in the final export; images and structured content use the common document renderer.

## Workspace layout

```text
shared-bulletins/
├── library.json
├── assets/
│   └── library/<stable-id>/...
├── templates/
│   └── <template-id>/v<version>.json
└── bulletins/
    └── YYYY-MM-DD/
        ├── bulletin.json
        ├── assets/...
        ├── revisions/...
        └── exports/...
```

Published templates and library entries are versioned rather than overwritten. Bulletin writes are atomic and revision-checked; if a synced copy changes while it is open, the app stops autosaving and reports the conflict.

## JSON contract

The public schemas live in [`schemas/`](schemas/). Every document declares `schemaVersion: 1`; dates use ISO `YYYY-MM-DD`, IDs are stable strings, and filesystem references are relative to the selected workspace. See [`docs/json-contract.md`](docs/json-contract.md) for the block model and extension rules.

The supplied `example_bulletin.json` has been migrated from the original prototype and corrected to the source PDF's June 7, 2026 date. Re-run `npm run migrate:example` only on an unmigrated legacy copy; v1 input passes through unchanged.
