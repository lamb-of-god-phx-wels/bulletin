# Bulletin Builder

Bulletin Builder is a local-first desktop app for producing a consistent weekly church bulletin from structured content. It runs on Windows and Arch Linux, stores projects in an ordinary synced folder, and exports sequential 7 × 8.5-inch PDF pages ready for a printer's booklet mode.

## Run it

```bash
npm install
npm run dev
```

`npm run build` performs the production TypeScript and Vite build. `npm test` runs the schema, migration, pagination, and shared-workspace tests. `npm run package` creates a Windows NSIS installer or Linux AppImage for the current build platform.

For UI work in an ordinary browser, run `npm exec vite`. The browser build uses persistent IndexedDB workspaces and real file pickers, so its weekly, template, and library flows can be exercised without Electron. The packaged desktop app continues to use ordinary folders on disk.

## First use

1. Choose a folder already synchronized by the SharePoint/OneDrive desktop client.
2. The app initializes `templates/`, `bulletins/`, `assets/`, and `library.json` without requiring Microsoft credentials.
3. Add approved songs, liturgy, images, and license notices on the Library screen.
4. Create a week from the published template, fill in the changing content, and import each reading from its public BibleGateway.com passage page or use the manual paste fallback.
5. Check the live page preview and export. Every export records an immutable JSON revision beside the project.

The app does not bundle copyrighted worship content or scrape Bible sites. Full-page PDFs remain vector pages in the final export; images and structured content use the common document renderer.

BibleGateway.com import does not use a login or API credentials. It makes one bounded request for the public passage selected by the user and snapshots the displayed text and publisher notice into the bulletin. Page changes, browser verification, or rate limiting produce an actionable error and preserve the “Open on Bible Gateway” and manual-paste fallback. Users remain responsible for each translation’s quotation limits and attribution requirements.

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
