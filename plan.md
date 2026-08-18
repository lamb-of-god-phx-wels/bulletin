# Bulletin Builder Desktop App

  ## Summary

  Build a Windows- and Arch Linux-compatible Electron desktop app that turns versioned bulletin JSON, a structured template, and a user-managed content library into a
  consistent 7×8.5-inch PDF.

  The MVP will serve Lamb of God first, recreate the existing Publisher design in a cleaner form, and provide:

  - A content-first weekly workflow with live paginated preview.
  - A separate structured template builder available to all volunteers.
  - A SharePoint-synced workspace containing templates, library content, bulletin projects, revisions, and exports.
  - No AI import in v1, while preserving a clear extension point for it later.

  ## Core Architecture and Interfaces

  - Use Electron, React, and TypeScript. Keep filesystem access, bounded BibleGateway.com passage imports, and PDF generation in the Electron main process behind a narrow,
    validated IPC interface.

  - Treat the SharePoint-synced directory as an ordinary filesystem workspace; do not require Microsoft Graph. Store only machine preferences, caches, and encrypted
    credentials outside it.

  - Make JSON Schema Draft 2020-12 the source of truth, validated with Ajv. Publish schemas and migrations for three versioned interfaces:
      - BulletinDocumentV1: metadata, pinned template version, stable block IDs, semantic content, library references, resolved Scripture snapshots, and guardrailed layout
        overrides.

      - TemplateV1: page dimensions, theme tokens, page masters, starter block tree, weekly-editable fields, default filler page, and pagination rules.
      - LibraryManifestV1: immutable/versioned songs, liturgy, images, fonts, PDF assets, and licensing/attribution metadata.

  - Use structured rich text—paragraphs, text spans, bold/italic marks, alignment, and named symbols—rather than arbitrary HTML. Normalize current inconsistencies such as
    scripture versus bibleReference, "all" versus verse arrays, and the mixed cross-symbol encodings.

  - Migrate example_bulletin.json into the v1 contract and correct its date to June 7, 2026. Published bulletins remain pinned to immutable template and library versions.
  - Store weekly projects as readable folders containing bulletin.json, one-off assets, export PDFs, and timestamped revision snapshots. Use atomic writes and revision
    hashes; if SharePoint changes an open file externally, pause autosave and offer reload or save-as-conflict-copy rather than attempting an automatic merge.

  ## Application Behavior

  - Weekly flow:
      - Create from a template, enter the date and changing service information, select approved library items, manage announcements, and preview the final pages
        continuously.

      - Resolve Scripture from the user-selected public BibleGateway.com passage page, snapshot the displayed text and attribution into the
        bulletin, and provide a paste-and-confirm fallback when access is unavailable.

      - Generate copyright notices from Scripture and library licensing metadata.
      - Keep layout controls inside a collapsed “Layout adjustments” panel: page break, keep-together, compact spacing, block reorder, and image fit/crop.
      - Permit a PNG/JPEG/SVG or PDF page to replace the cover or be inserted anywhere as a full-page one-off. Full-page PDFs are merged without rasterizing; PDFs used inside
        flowing content receive a print-resolution rendered representation.

      - Autosave edits and create a named immutable revision whenever a PDF is exported.

  - Template builder:
      - Provide a drag-reorder outline, typed block palette, library selectors, weekly-editable flags, page-master selection, theme controls, and sample-data preview.
      - Save edits as drafts; publishing creates a new immutable template version. Do not expose arbitrary coordinates, custom HTML, or custom CSS.
      - Include blocks for cover pages, headings, rich text, responsive readings, Scripture, songs, prayers/creeds, announcements, copyright material,
        and full-page assets.

  - Rendering:
      - Use the same React renderers for preview and export.
      - Measure semantic fragments using the actual loaded fonts, flow them into fixed-size page containers, and honor keep/page-break rules without clipping.
      - Export sequential 7×8.5-inch pages through Chromium, then assemble external PDF pages and metadata with a PDF library.
      - Round the final document up to a multiple of four using the template’s filler-page design, defaulting to blank pages at the end.

  - Library:
      - Allow volunteers to import structured text, images, fonts, and PDF assets through the app; retain originals and validate missing or conflicting IDs.
      - Support offline use for already-resolved content. A missing synced library or asset produces a clear blocking validation message rather than a broken PDF.
      - Reserve a versioned asset-variant field so the future music compositor can publish verse-specific PNG outputs without changing the bulletin renderer.

  - Future AI import:
      - Add after the MVP as an optional provider that receives pasted instructions plus the active template and returns reviewable proposed field changes with source
        excerpts and confidence.

      - Never apply AI changes silently; selected proposals must pass the same JSON validation as manual edits.

  ## Test and Acceptance Plan

  - Unit-test schema validation, v0-to-v1 migration, library resolution, attribution generation, pagination, filler-page calculation, and conflict detection.
  - Test Bible Gateway page parsing, unsupported translations, blocked requests, offline behavior, and manual-paste fallback with mocked network responses.
  - Add visual/PDF regression fixtures based on June 7, 2026 plus representative 12-page and 16-page seasonal bulletins. Assert 7×8.5-inch pages, multiples of four, expected
    text ordering, no clipping or overlap, and stable screenshots.

  - Exercise end-to-end flows for creating a week, changing readings and songs, replacing the cover, inserting a PDF page, applying a layout adjustment, publishing a template
    version, reopening from SharePoint, and exporting a revision.

  - Produce installer smoke tests for Windows and an AppImage/package smoke test on Arch Linux.
  - MVP acceptance requires a faithful but cleaner recreation of the June 7 bulletin and a new weekly bulletin produced without Publisher or direct JSON editing.

  ## Assumptions and Boundaries

  - Users supply and are responsible for authorized fonts, hymn/music files, artwork, and license metadata; the app does not bundle copyrighted worship content.
  - NIV and other copyrighted Scripture use depends on observing the publisher's quotation limits and attribution requirements. The importer retains the publisher notice shown by Bible Gateway.

  - V1 does not ingest Publisher, Word, or arbitrary Office documents, provide free-form desktop-publishing placement, call cloud AI, or include a hosted backend.
  - The operating-system SharePoint client handles authentication, synchronization, and SharePoint history. The app handles local atomic saves, its own export revisions, and
    visible conflict recovery.
