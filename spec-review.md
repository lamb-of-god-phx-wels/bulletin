# Spec Review Action Items

This document captures recommendations, risks, and decisions from the review of
`spec.md`. Use it as a decision record before architecture, planning, and
implementation.

## Review Team

- Lead software architect and UX reviewer.
- Product UX specialist for document-editor workflows.
- Local file-safety and application security architect.
- Data model, JSON schema, and persistence architect.
- Typst/PDF rendering and layout engineer.
- QA, accessibility, and reliability lead.

## Decisions Made

- The product is a completely offline packaged desktop application.
- Required desktop targets are Windows and Linux, including Arch Linux.
- Windows distribution should use a signed `.msi` installer.
- Linux distribution should include AppImage, `.deb`, AUR, and native pacman
  package formats.
- Non-technical users should install the app once and launch it from a normal
  desktop, Start Menu, or app-launcher shortcut.
- The app should automatically create a workspace in the system-default user data
  location unless the user chooses a different location on first launch.
- The app should support multiple workspaces, with one active workspace at a
  time.
- The app should support moving an existing workspace from the UI.
- The app does not need a dedicated full-workspace backup and restore command.
- The workspace is app-managed and does not need to be directly browsed or edited
  by the user.
- Local resource ids live in workspace metadata rather than portable
  project/template JSON.
- Imported projects and templates receive new local resource ids when imported as
  new local copies.
- Display names are mutable user-facing labels, not storage identity, and
  duplicates are allowed.
- Church-specific logos, images, starter templates, starter bulletins, and other
  reusable content are data, not application code.
- Church-specific starter content should be delivered through resource packs.
- Resource packs represent arbitrary collections of reusable content and use the
  `.pak` extension.
- Resource packs are zip-compatible archives.
- A resource pack may include a `readme.md` that describes the pack.
- Resource packs may include fonts.
- Resource pack fonts may use any standard format supported by the bundled Typst
  version.
- Resource packs can be created and exported from inside the app.
- Resource pack imports copy content into the workspace after user confirmation.
- Resource pack updates and replacements require explicit confirmation.
- Existing bulletins created from imported templates remain unchanged by default
  when a resource pack update or replacement changes that template.
- File-based import/export bundles are required for transferring projects,
  templates, resource packs, and their dependencies between workspaces.
- Project and template bundles use `.zip`, include referenced assets, include
  generated Typst for diagnostics, and include the latest PDF by default when one
  exists.
- Missing referenced assets prompt the user to add, import, or relink them.
- Missing images render as same-size SVG missing-image placeholders in the editor
  and PDF.
- Older documents are migrated in memory on open and written only on explicit
  save, autosave after user edits, or another user-confirmed persistence action.
- Unknown newer-document fields are warned and preserved when safe; load fails
  only when the app cannot safely preserve, edit, or render without likely data
  loss.
- Physical layout lengths persist as explicit unit strings, with inches as the
  default; editor pixels are derived for display and interaction.
- Image elements use `data.assetRef` with canonical `asset:<uuid>` values;
  legacy filesystem paths remain read/migration-compatible but are not written by
  new documents.
- Vertical content may split across pages at natural breaks, text boxes may
  split, horizontal overflow is an error, and PDF preview is authoritative when
  editor measurement differs.
- Grid tracks are configurable with equal-track defaults, grid cells and stack
  indexes allow one direct child, and canvas children clamp to canvas bounds.
- Templates are copied into bulletins; custom elements have schemas and
  instances, with instance values stored in normal element data.
- AI-assisted filling can launch/configure a local AI helper, uses text and image
  fields first, and exposes only public or AI-approved assets to the helper.
- Autosave is authoritative; live preview failure does not invalidate successful
  JSON autosave, and builds time out after 30 seconds by default.
- SVG imports are allowed with safe rendering/sanitization; archives are scanned
  before quarantine extraction and only validated content is copied into the
  workspace.
- The editor UI targets WCAG 2.2 AA where practical, every drag/drop operation
  does not need an exact keyboard equivalent, final PDFs should be tagged, and
  image alt text is optional.
- Folded/booklet-style bulletins are the expected working model, `7in` by
  `8.5in` is the default page-size preset, professional imposition/crop/bleed
  output is not required, and PDF filenames are configurable with
  `YYYY-MM-DD.pdf` as the default.
- Non-technical users see only operation-blocking errors by default; detailed
  diagnostics and build logs are hidden by default, diagnostic bundles can be
  exported, and autosave errors use ephemeral toasts plus diagnostics.
- The app prevents opening the same workspace twice, uses both file locks and
  optimistic version checks for saves, and prompts users to choose between disk
  changes and the current workspace version when files change externally.
- Primary users are pastors, church secretaries, and volunteers.
- The ideal weekly workflow is to create each bulletin from a formal reusable
  template.
- Rich text editing, headings, lists, scripture formatting, and inline
  bold/italic should be supported.
- Page numbers, headings/headers, footers, backgrounds, and decorative elements
  may render in margin regions only as explicit page-level elements.
- Final PDF publishing should include an approval/finalization step.
- Templates should support AI-assisted data filling from high-level user
  instructions through a structured, validated import workflow.

## Highest Priority Decisions

### SR-001: Product Packaging And Workspace

Status: Decided

The application should feel like a normal desktop app, not a developer workflow.
The user should not need to install Node, Typst, fonts, schemas, or dependencies
manually.

Decisions:

- Windows and Linux are required desktop targets.
- Arch Linux support is required.
- Windows uses a signed `.msi` installer.
- Linux packages include AppImage, `.deb`, AUR, and native pacman package.
- The app creates a local workspace on first launch.
- The first launch flow should offer a default workspace or a custom location.
- The default workspace should use the platform's normal user data location.
- The app supports multiple workspaces, with one active workspace at a time.
- The app supports moving an existing workspace from the UI.
- The app does not need a dedicated full-workspace backup and restore command.
- Normal interaction with workspace data should happen through the app UI.

Recommended outcome:

- Keep packaging and workspace requirements in `spec.md`.
- Defer implementation staging decisions, such as initially supporting only one
  workspace, to planning rather than changing the product design.

### SR-001A: Resource Packs

Status: Decided

Resource packs let a church or designer distribute starter content without
modifying the application. A pack can contain any supported reusable content,
including assets, fonts, templates, starter bulletins, custom element schemas,
styles, AI-ready metadata, and a descriptive `readme.md`.

Decisions:

- Resource packs use the `.pak` extension.
- A resource pack is a zip-compatible archive.
- Resource packs can include fonts.
- Included fonts may use any standard font format supported by the bundled Typst
  version.
- Users can create and export resource packs from inside the app.
- Imported pack contents are copied into the workspace after user confirmation.
- Packs support update behavior after import.
- Duplicate/update handling is replace or update with explicit confirmation.
- Existing bulletins created from imported templates remain unchanged by default
  when a resource pack update or replacement changes that template.

Accepted manifest baseline added to `spec.md`:

- `manifest.json` at the archive root.
- Resource pack format version.
- Stable pack id.
- Pack name.
- Optional pack version.
- Optional description.
- Optional author, church, or organization display metadata.
- Optional homepage, support, or contact metadata.
- Optional license metadata for the pack and included content.
- Optional minimum compatible app version.
- Optional readme path, defaulting to `readme.md` when present.
- Manifest entries for assets, templates, starter bulletins, custom element
  schemas, styles, fonts, AI template contracts, sample AI data imports, and
  other supported content.
- Dependency metadata for content that references other pack entries.
- Update metadata for recognizing later `.pak` files as updates to previously
  imported packs.

Recommended outcome:

- Keep the accepted resource pack requirements in `spec.md`.
- During implementation planning, define the exact `manifest.json` schema and
  import review UI.

### SR-002: Stable Resource Identity For Storage

Status: Decided

Display names should not be storage identity. A project, template, asset, or pack
entry needs a stable internal id so rename and duplicate operations are safe.

Relevant spec areas: `Project Files`, `Resource Identity`, `Assets`, `Resource
Packs`, `Import And Export Bundles`.

Decisions:

- Local resource ids live in workspace metadata, not inside portable
  project/template JSON.
- Export manifests may include source resource ids as provenance metadata.
- Imported projects and templates always receive new local resource ids when
  imported as new local copies.
- A display name is the mutable user-facing label shown in lists, tabs,
  inspectors, exports, and dialogs.
- Duplicate display names are allowed.
- Rename changes display metadata only and must not change resource id, storage
  path, generated artifact path, or internal references.
- Duplicate creates a new local resource id and copied content.

Disambiguation metadata:

- Resource kind, such as bulletin, template, asset, or resource pack.
- Last modified time.
- Created or imported time.
- Source resource pack name and version, when applicable.
- Document date or service date, when present.
- Media type, dimensions, or original filename for assets.
- Short local resource id only as an advanced or last-resort disambiguator.

Recommended outcome:

- Keep the accepted resource identity requirements in `spec.md`.
- Define archive, delete, and restore behavior separately if those workflows are
  in scope.

### SR-003: Import And Export Bundle Behavior

Status: Decided

The application needs reliable file-based transfer for projects, templates, and
resource packs.

Relevant spec areas: `Import And Export Bundles`, `Assets`, `Persistence And
Build`.

Decisions:

- Project and template bundles use the `.zip` extension.
- Project and template bundles are zip-compatible archives.
- Exported project bundles include the latest PDF by default when one exists.
- Generated Typst is included by default for diagnostics.
- Project and template bundle exports always include referenced assets.
- Metadata-only project/template exports are not supported.
- Unsupported bundle versions block import and show an informative error message.

Recommended outcome:

- Keep the accepted bundle requirements in `spec.md`.
- During implementation planning, define the exact bundle manifest schema,
  import preview UI, duplicate handling, rollback behavior, and export naming
  conventions.

### SR-004: Local Asset Dependency Rules

Status: Decided

Projects and templates must remain portable. They should not depend on arbitrary
absolute filesystem paths outside the workspace.

Relevant spec areas: `Image`, `Assets`, `Resource Packs`, `Import And Export
Bundles`.

Decisions:

- Exported project and template bundles always include all referenced managed
  asset binaries.
- If a referenced asset is missing from the local workspace, the app asks the
  user to add, import, or relink it.
- Users can relink a missing asset to another local managed asset or import a
  replacement.
- The editor and PDF renderer represent missing images with an SVG missing-image
  icon sized to the image element's resolved container box.

Recommended outcome:

- Keep the accepted local asset dependency requirements in `spec.md`.
- During implementation planning, define the missing-image SVG and relink UI.

### SR-005: Persistence Contract

Status: Decided

JSON is described as canonical, but versioning, normalization, migration, and
generated-file consistency need explicit rules.

Relevant spec areas: `Document Model`, `Validation Expectations`, `Persistence
And Build`.

Decisions:

- Project and template JSON are canonical editable state.
- Generated Typst, PDFs, preview PDFs, build logs, thumbnails, and import
  summaries are derived artifacts.
- Opening an older document may migrate or normalize it in memory, but stored
  JSON is rewritten only on explicit save, autosave after a user document edit,
  or another user-confirmed persistence operation.
- Unknown fields from newer documents should produce warnings and be preserved
  when the app can safely operate on the document.
- Loading fails only when the app cannot safely load, preserve, edit, or render
  without likely data loss.
- Migrations should be ordered, deterministic, idempotent, and non-lossy wherever
  practical.
- Saves must be atomic and failed saves must leave the previous valid document
  intact.
- Derived artifacts become stale when canonical JSON or referenced assets change.

Validation severity decisions:

- Hard errors: unsafe project names, invalid resource ids, unreadable or
  unsupported document versions that cannot be preserved safely, malformed JSON,
  invalid element ids, asset references outside approved roots, path traversal,
  unsupported bundle/resource-pack versions, incompatible AI import schema
  versions, and missing required fields that prevent safe rendering or saving.
- Warnings: unknown fields that can be preserved, newer document features that
  may not be editable, missing optional metadata, duplicate display names,
  missing assets that can be relinked, unsupported optional bundle entries, and
  validation issues that do not prevent safe editing.
- Safe migrations: legacy margin names, safe legacy asset references, missing
  defaults, older enum aliases, legacy layout details with deterministic modern
  equivalents, and compatible schema-version upgrades.
- Default-fill cases: omitted optional style fields, omitted optional page
  fields, omitted optional element fields with defined defaults, empty optional
  data objects, and missing user preference values.

Recommended outcome:

- Keep the accepted persistence contract in `spec.md`.
- During implementation planning, define the exact migration registry and
  validation error codes.

### SR-006: Canonicalize Lengths And Units

Status: Decided

Physical layout lengths should persist as explicit unit strings, with inches as
the default. Editor pixels are a derived projection for display and interaction.

Relevant spec areas: `Document Model`, `Lengths And Units`, `Page Model`.

Decisions:

- Inch-mode fields persist plain-number user input as explicit inch strings such
  as `"1in"`.
- Persisted JSON length strings use `.` as the decimal separator.
- A future locale-aware input layer may convert localized user input, but stored
  JSON remains locale-independent.
- Legacy numeric physical layout values are interpreted as editor pixels during
  migration and normalized to explicit unit strings where safe.
- `page.typstWidth` and `page.typstHeight` are authoritative for physical output.
- `page.width` and `page.height` are derived editor dimensions, or legacy values
  to migrate.
- Editor dimensions are derived at `96px` per inch.
- Font size and border width remain raw field-specific length fields, not
  inch-mode fields by default.

Unit allowance baseline:

- Page size: `in`, `pt`, `cm`, `mm`.
- Margins, padding, fixed element size, element margin, canvas position, grid
  gaps, stack gaps, and snap grid size: `in`, `pt`, `cm`, `mm`.
- Responsive element width: physical lengths, `%`, and `auto` where schema
  permits.
- Automatic element height: physical lengths and `auto` where schema permits.
- Future grid tracks: physical lengths, `%`, `fr`, and `auto` where schema
  permits.
- Font size: `pt`, `em`, or plain number as defined by font-size schema.
- Border width: `pt`, physical lengths, or plain number as defined by
  border-width schema.

Recommended outcome:

- Keep the accepted length/unit requirements in `spec.md`.
- During implementation planning, define exact JSON schema constraints for each
  length-bearing field.

### SR-007: Resolve Image Asset References

Status: Decided

The image model uses managed asset references with migration-only support for
legacy filesystem paths.

Relevant spec areas: `Image`, `Assets`.

Decisions:

- Canonical image field is `data.assetRef`.
- Canonical image asset value format is `asset:<uuid>`.
- Legacy filesystem asset paths remain valid indefinitely for read/migration
  compatibility.
- Newly written documents, templates, resource packs, and exports must not write
  legacy filesystem paths.
- Safe legacy paths are automatically copied into the local workspace asset
  library during migration.
- Legacy paths should normalize to managed `asset:<uuid>` references at the next
  safe persistence point.
- Unresolved legacy paths preserve source metadata for diagnostics and use the
  missing-asset relink workflow.

Recommended outcome:

- Keep the accepted image asset reference requirements in `spec.md`.
- During implementation planning, define exact legacy source metadata and relink
  UI behavior.

### SR-008: Pagination And Overflow Rules

Status: Decided

Pagination and overflow behavior now defines vertical splitting, horizontal
overflow errors, text splitting, and PDF preview authority.

Relevant spec areas: `Page Model`, `Element Types`, `Flow Layout`, `Page View`.

Decisions:

- PDF output/preview is authoritative when editor measurement differs.
- Vertical overflow may split across pages at natural break points.
- Natural break points include text line/paragraph boundaries, flow element
  boundaries, stack child boundaries, and other renderer-supported vertical break
  locations.
- Text boxes may split across pages.
- Elements taller than the page content area should split vertically when they
  have natural break points.
- Oversized unbreakable elements should surface overflow warnings while remaining
  constrained to page content width.
- Horizontal overflow is an error.

Recommended outcome:

- Keep the accepted pagination and overflow rules in `spec.md`.
- During implementation planning, define exact validation messages and editor
  indicators for horizontal overflow and oversized unbreakable content.

### SR-009: Container Layout Semantics

Status: Decided

Grid, stack, and canvas layout now defines configurable tracks, one direct child
per grid cell/stack index, and canvas clamping rules.

Relevant spec areas: `Grid`, `Stack`, `Canvas`.

Decisions:

- Grid row and column tracks are configurable.
- Grid defaults are equal-width/equal-height tracks, represented with percentage
  units.
- Only one direct child is allowed per grid cell.
- Only one direct child is allowed per stack index.
- Nested containers are allowed when multiple elements are needed in a cell or
  stack position.
- Canvas children are clamped, not clipped or allowed to overflow.
- Canvas children are clamped to canvas width and canvas height.
- Canvas elements should always fit on a single page.

Recommended outcome:

- Keep the accepted container layout requirements in `spec.md`.
- During implementation planning, define exact track-size UI, gap math, canvas
  origin, z-order, and padding interactions.

### SR-010: Template And Custom Element Lifecycle

Status: Decided

Templates are copied into bulletins. Custom elements have reusable schemas and
instances that store values in normal element data.

Relevant spec areas: `Document Model`, `Custom Elements And Bindings`, `Resource
Packs`.

Decisions:

- Templates are copied into bulletins when a bulletin is created from a template.
- Bulletins are not live-linked to source templates by default.
- Later source template changes do not silently rewrite existing bulletins.
- Custom elements have a reusable custom element schema and instantiated uses of
  that schema.
- Custom element instance field values are stored in the instance element's
  normal `data` fields.
- Custom element instances track enough schema metadata to identify their source
  schema and schema version.
- Compatible custom element schema updates may update existing instances.
- If data bindings, required fields, field types, or visual structure changes
  cannot be applied safely, the app requires user review/intervention before
  changing the instance.
- Existing user-provided instance data should be preserved whenever practical.

Recommended outcome:

- Keep the accepted template/custom element lifecycle requirements in `spec.md`.
- During implementation planning, define exact schema versioning, update preview,
  and user intervention flows.

### SR-010A: AI-Assisted Template Filling

Status: Decided

Templates should be designed so an AI tool can fill bulletin data from high-level
user instructions without directly editing layout or generated Typst. The app
should expose a machine-readable template contract and import AI-generated data
through validation and user review.

Relevant spec areas: `Document Model`, `Import And Export Bundles`,
`AI-Assisted Data Import`, `Custom Elements And Bindings`, `Resource Packs`.

Decisions:

- The app should be able to launch/configure a local AI helper.
- File-based exchange with external AI tools remains supported.
- AI template contracts use `.ai-template.json`.
- AI data import results use structured JSON and `.ai-import.json` when exchanged
  as files.
- AI source input may be pasted text, selected text documents, selected image
  files, or selected managed assets.
- AI imports can create a new bulletin from a template or update an existing
  bulletin.
- Initial AI output scope is data fields only.
- The design may reserve space for future user-reviewable editor edit
  suggestions, but they are not applied automatically.
- First required AI-ready field types are text and images.
- AI contracts may include local asset catalogs with tags/descriptions, but only
  for assets marked public or AI-approved.
- Asset records need AI visibility metadata: private, approved, or public.
- AI imports preserve the original high-level instruction and tool metadata for
  diagnostics when available.
- Imported AI text may use only forms supported by the target field schema and
  Typst renderer.

Recommended outcome:

- Keep the accepted AI-assisted template filling requirements in `spec.md`.
- During implementation planning, define local AI helper configuration, contract
  schema, import result schema, approved asset catalog format, and review UI.

### SR-011: Autosave, Build, And Preview Reliability

Status: Decided

Autosave, live preview, and manual build reliability behavior is now defined.

Relevant spec areas: `Selection And Inspector`, `Persistence And Build`.

Decisions:

- Autosave is authoritative for document persistence.
- Manual save may exist, but users should not need it before final build or
  publication.
- The UI should show dirty, saving, saved, save failed, preview/build running,
  stale, failed, and succeeded states.
- Autosave failure is a blocking document reliability issue.
- If autosave fails, the app preserves unsaved in-memory changes, shows an
  actionable error, and retries when appropriate.
- Manual build/export should warn or block when the latest document state has not
  saved successfully.
- Live preview failure is non-blocking when JSON autosave succeeds.
- If live preview fails, the document remains saved, the last successful preview
  remains visible but stale when available, and diagnostics plus retry/manual
  build actions are shown.
- Default build timeout is 30 seconds.
- Timed-out builds fail with diagnostics and partial-output cleanup.
- Live preview builds are debounced and use monotonically increasing build ids.
- Only the newest successful preview build can update the live preview.
- Manual builds take priority over live preview builds.
- Project size, element count, and asset size limits are not fixed by the spec.

Recommended outcome:

- Keep the accepted autosave/build reliability requirements in `spec.md`.
- During implementation planning, define exact debounce durations, retry policy,
  diagnostics format, and oversized-project heuristics.

### SR-012: Local File Safety For PDFs, Previews, Assets, And Typst

Status: Decided

The app must avoid path traversal, unintended file reads, and unsafe imported
content while still working fully from local files.

Relevant spec areas: `Offline Application And Workspace`, `Persistence And
Build`, `Assets`, `Resource Packs`, `Import And Export Bundles`.

Decisions:

- SVG uploads/imports are allowed.
- SVG files are treated as untrusted images, not executable documents.
- SVGs should be sanitized or safely rendered before preview/build use.
- SVG scripts, event handlers, external network/file references, and arbitrary
  local-file exposure are rejected.
- Asset and bundle size limits should be reasonably generous for desktop use.
- The app must enforce limits for individual assets, PDFs, resource packs,
  project/template bundles, extracted archive size, and archive entry count.
- Imported archives are scanned for zip-slip paths before extraction.
- Imported archives are extracted to quarantine/temp storage before validated
  content is copied into the workspace.
- Only validated content is copied from quarantine into the workspace.
- Canonical path validation and symlink/hardlink escape rejection are required.
- Typst builds are restricted to app-controlled generated source, resolved
  validated assets, and approved fonts.

Recommended outcome:

- Keep the accepted local file safety requirements in `spec.md`.
- During implementation planning, define exact numeric size limits, SVG sanitizer
  or renderer choice, and quarantine cleanup policy.

### SR-013: Accessibility Requirements

Status: Decided

The spec relies heavily on drag-and-drop and visual feedback, but does not define
complete accessibility behavior.

Relevant spec areas: `Drag And Drop`, `Selection And Inspector`, `Style Model`,
`Image`.

Decisions:

- The desktop editor UI should target WCAG 2.2 AA where the standard applies to a
  desktop application.
- Every drag/drop operation does not need an exact keyboard-only equivalent.
- Core document operations should still be keyboard-accessible where practical.
- Final manual builds and exported PDFs should be accessible/tagged PDFs.
- Image alt text is optional.
- Image elements should provide optional alt text and decorative/artifact fields.

Recommended outcome:

- Keep the accepted accessibility requirements in `spec.md`.
- During implementation planning, verify the selected PDF toolchain can produce
  tagged PDFs or define a post-processing path.

### SR-014: Print And Export Workflows

Status: Decided

The spec focuses on PDF generation but does not define practical publication and
printing workflows.

Relevant spec areas: `Goals`, `Page Model`, `Persistence And Build`, `Import And
Export Bundles`.

Decisions:

- Folded or booklet-style bulletins are the expected working model.
- The editor should support booklet-oriented setup and preview/navigation where
  practical.
- `7in` by `8.5in` is one preset and is the default page size.
- Templates, bulletins, and resource packs may include their own page setup
  configurations.
- Bleed marks, print-safe margin overlays, crop marks, and professional printer
  imposition are not required.
- Export filename formatting should be configurable.
- The default exported PDF filename format is `YYYY-MM-DD.pdf`.

Recommended outcome:

- Keep the accepted print/export workflow requirements in `spec.md`.
- During implementation planning, decide how booklet view is represented in the
  editor without adding professional imposition scope.

### SR-015: Error States And Supportability

Status: Decided

The spec names many operations but does not define user-facing error recovery or
diagnostics.

Relevant spec areas: `Validation Expectations`, `Persistence And Build`,
`Assets`, `Resource Packs`, `Import And Export Bundles`.

Decisions:

- Non-technical users should see only critical errors that prevent the current
  operation from continuing.
- Detailed error information should be available in a diagnostic view hidden by
  default.
- Users should be able to export a diagnostic bundle.
- Build logs should reside in a separate window or panel hidden by default.
- Autosave errors should show an ephemeral toast error message and record full
  details in diagnostics.

Recommended outcome:

- Keep the accepted error and supportability requirements in `spec.md`.
- During implementation planning, define stable error-code taxonomy and exact
  diagnostic bundle contents.

### SR-016: Local File Conflict Behavior

Status: Decided

Even a local app can encounter conflicts if the same workspace is opened by two
app processes, restored from backup while open, or stored in a synchronized
folder.

Relevant spec areas: `Offline Application And Workspace`, `Persistence And
Build`, `Undo And Redo`.

Decisions:

- The app should prevent the same workspace from being opened for editing by two
  app processes at the same time.
- Project and template saves should use both file locks and optimistic version
  checks.
- When a file changes on disk while the project is open, the app should prompt
  the user to choose between accepting the disk change or keeping the current
  workspace version.
- Automatic merge is not required.
- Conflict recovery should prevent silent data loss and preserve conflict backups
  where practical.

Recommended outcome:

- Keep the accepted local file conflict behavior in `spec.md`.
- During implementation planning, define the exact lock-file format, stale-lock
  recovery flow, revision metadata, and conflict backup location.

## Additional Product Workflow Decisions

Status: Decided

Decisions:

- Primary users are pastors, church secretaries, and volunteers.
- The ideal workflow is to create a bulletin from a formal template each week.
- Rich text editing, headings, lists, scripture formatting, and inline
  bold/italic should be supported.
- Designs may place backgrounds, page numbers, headings/headers, footers, and
  decorative elements in margin regions.
- Normal body flow remains constrained to the content box.
- Margin-region content should be modeled as explicit page-level elements rather
  than arbitrary normal flow content escaping margins.
- Users should have an approval/finalization step before publishing the final
  PDF.

## Proposed Next Step

All numbered review items and additional product workflow questions in this file
are now decided and reflected in `spec.md`. Next, begin architecture and
implementation planning from the updated source-of-truth spec.
