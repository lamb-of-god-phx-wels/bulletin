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
- Multiple-workspace management is a product requirement deferred from v1.
- Moving an existing workspace from the UI is deferred from v1.
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
- Resource pack import is required in v1; creation and export may be staged.
- Resource pack imports copy content into the workspace after user confirmation.
- Resource pack updates and replacements may be staged and require explicit
  confirmation when implemented.
- Existing bulletins created from imported templates remain unchanged by default
  when a resource pack update or replacement changes that template.
- File-based import/export bundles are required for transferring projects,
  templates, resource packs, and their dependencies between workspaces.
- Project and template bundles use `.zip`, include referenced assets, include
  generated Typst for diagnostics, and include the current approved PDF by
  default, otherwise the newest non-stale manual artifact when one exists.
- Missing referenced assets prompt the user to add, import, or relink them.
- Missing images render as same-size SVG missing-image placeholders in the
  editor/live preview and in explicitly confirmed draft-placeholder PDFs; final
  and self-contained bundle outputs block.
- Older documents are migrated in memory on open and written only on explicit
  save, autosave after user edits, or another user-confirmed persistence action.
- Unknown newer-document fields are warned and preserved when safe; load fails
  only when the app cannot safely preserve, edit, or render without likely data
  loss.
- Physical layout lengths persist as explicit unit strings, with inches as the
  default; editor pixels are derived for display and interaction.
- Image elements use `data.assetRef` with canonical `asset:<uuid>` values. The
  UUID is a portable immutable asset-revision id, not a local resource id; legacy
  filesystem paths remain read/migration-compatible but are not written by new
  documents.
- Vertical content may split across pages at natural breaks, text boxes may
  split, horizontal overflow is an error, and PDF preview is authoritative when
  editor measurement differs.
- Grid tracks are configurable with equal-track defaults, grid cells and stack
  indexes allow one direct child, and canvas children clamp to canvas bounds.
- Templates are copied into bulletins; custom elements have schemas and
  instances, with authoritative scoped values stored in shared `fieldValues`.
- File-based AI contract exchange is required in v1. Broader AI-assisted filling
  and local AI helper launch/configuration may be staged.
- Autosave is authoritative; live preview failure does not invalidate successful
  JSON autosave, and builds time out after 30 seconds by default.
- SVG imports are allowed with safe rendering/sanitization; archives are scanned
  before quarantine extraction and only validated content is copied into the
  workspace.
- The editor UI targets WCAG 2.2 AA where practical, every drag/drop operation
  does not need an exact keyboard equivalent, tagged final PDFs may be staged,
  and image alt text is optional generally but required for nondecorative
  PDF/UA-final figures.
- Folded/booklet-style bulletins are the expected working model, `7in` by
  `8.5in` is the default page-size preset, professional imposition/crop/bleed
  output is not required, and PDF filenames are configurable with
  `{date:YYYY-MM-DD}.pdf` as the default pattern.
- A document/template may require an exact, minimum, maximum, or multiple-of
  final PDF page count. A mismatch permits only a labeled non-publication draft
  or historical diagnostic and blocks current, final, approved, and finalized
  publication.
- Non-technical users see only operation-blocking errors by default; detailed
  diagnostics and build logs are hidden by default, diagnostic bundles can be
  exported, and autosave errors use an immediate toast plus persistent
  save/unprotected state and diagnostics until resolved.
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
- Approval/finalization is a committed workflow that may be staged.
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
- Multiple-workspace management is deferred from v1.
- Moving an existing workspace from the UI is deferred from v1.
- The app does not need a dedicated full-workspace backup and restore command.
- Normal interaction with workspace data should happen through the app UI.

Recommended outcome:

- Keep packaging and workspace requirements in `spec.md`.
- Keep one configured workspace in v1 while preserving a path to deferred
  multiple-workspace management and workspace moves.

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
- Resource pack import is required in v1.
- Creating and exporting resource packs may be staged.
- Imported pack contents are copied into the workspace after user confirmation.
- Pack update behavior may be staged after v1 import support.
- Duplicate/update handling is side-by-side import or an explicit reviewed
  update/replace only after signer continuity, release sequence, dependency
  impact, and transactional safety checks pass.
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
- SP2-010 and SP2-011 define the exact manifest, import review, trust, update,
  retention, and rollback contracts.

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
- Exported project bundles include the current approved PDF by default, otherwise
  the newest non-stale persisted manual artifact when one exists.
- Generated Typst is included by default for diagnostics.
- Project and template bundle exports always include referenced assets.
- Metadata-only project/template exports are not supported.
- Unsupported bundle versions block import and show an informative error message.

Recommended outcome:

- Keep the accepted bundle requirements in `spec.md`.
- SP2-010, SP2-014, and SP2-022 define the manifest, duplicate/remap,
  transactional rollback, artifact selection, and export naming contracts.

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
- The editor/live preview and explicitly confirmed draft-placeholder PDFs
  represent missing images with a same-size SVG missing-image icon. Current,
  final, approval, and self-contained bundle outputs block.

Recommended outcome:

- Keep the accepted local asset dependency requirements in `spec.md`.
- SP2-018 defines the missing-image/relink operation matrix and final/bundle
  blocking behavior.

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
  versions, and missing structurally required schema fields needed for safe
  parsing or rendering.
- Warnings: unknown fields that can be preserved, newer document features that
  may not be editable, missing optional metadata, duplicate display names,
  missing assets that can be relinked, unsupported optional bundle entries, and
  validation issues that do not prevent safe editing.
- Missing required field-contract values remain saveable draft warnings but
  block final readiness until resolved.
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
- The UUID is a portable immutable asset-revision id, separate from the
  workspace-local asset resource id and storage path.
- Legacy filesystem asset paths remain valid indefinitely for read/migration
  compatibility.
- Newly written documents, templates, resource packs, and exports must not write
  legacy filesystem paths.
- Safe legacy paths are automatically copied into the local workspace asset
  library during migration.
- Legacy paths should normalize to portable `asset:<uuid>` references at the next
  safe persistence point.
- Unresolved legacy paths preserve source metadata for diagnostics and use the
  missing-asset relink workflow.

Recommended outcome:

- Keep the accepted image asset reference requirements in `spec.md`.
- SP2-003 and SP2-018 define portable resolution/remapping, legacy migration,
  missing-reference preservation, relinking, and operation-specific behavior.

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
- Oversized unbreakable elements show editor/live-preview diagnostics and block
  manual/final builds.
- Horizontal overflow is an error.

Recommended outcome:

- Keep the accepted pagination and overflow rules in `spec.md`.
- SP2-007 and SP2-017 now define exact operation severity/readiness behavior;
  implementation planning must provide conforming indicators and diagnostics.

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
instances whose authoritative scoped values use the shared `fieldValues` map.

Relevant spec areas: `Document Model`, `Custom Elements And Bindings`, `Resource
Packs`.

Decisions:

- Templates are copied into bulletins when a bulletin is created from a template.
- Bulletins are not live-linked to source templates by default.
- Later source template changes do not silently rewrite existing bulletins.
- Custom elements have a reusable custom element schema and instantiated uses of
  that schema.
- Custom-element instance values use scoped shared `fieldValues`, not duplicate
  literals in ordinary element data.
- Custom-element instances pin the definition id, version, and canonical hash.
- Compatible definition updates may update an instance only through the explicit
  reviewed update workflow; library/pack changes never switch it silently.
- If data bindings, required fields, field types, or visual structure changes
  cannot be applied safely, the app requires user review/intervention before
  changing the instance.
- Existing manual values win by default; incompatible values are preserved in
  the inert orphaned-values map until explicitly remapped or removed.

Recommended outcome:

- Keep the accepted template/custom element lifecycle requirements in `spec.md`.
- SP2-004 defines contract/definition versioning, hash pinning, update review,
  orphan preservation, and manual-value precedence.

### SR-010A: AI-Assisted Template Filling

Status: Decided

Templates should be designed so an AI tool can fill bulletin data from high-level
user instructions without directly editing layout or generated Typst. The app
should expose a machine-readable template contract and import AI-generated data
through validation and user review.

Relevant spec areas: `Document Model`, `Import And Export Bundles`,
`AI-Assisted Data Import`, `Custom Elements And Bindings`, `Resource Packs`.

Decisions:

- File-based exchange with external AI tools is required in v1.
- Launch/configuration of a local AI helper may be staged.
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
- SP2-004 and SP2-013 define the shared AI contract/import model, asset catalog,
  field-level review, target/base checks, and isolated helper boundary.

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
- Manual build/export blocks when the latest document state has not saved
  successfully.
- Live preview failure is non-blocking when JSON autosave succeeds.
- If live preview fails, the document remains saved, the last successful preview
  remains visible but stale when available, and diagnostics plus retry/manual
  build actions are shown.
- Default build timeout is 30 seconds.
- Timed-out builds fail with diagnostics and partial-output cleanup.
- Live preview builds use UUID build ids plus monotonically increasing request
  sequences for supersession.
- Only the newest successful preview build can update the live preview.
- Manual builds take priority over live preview builds.
- SP2-020 defines deterministic warning and hard caps for project, element,
  asset, font, archive, AI, and generated-output size/complexity.

Recommended outcome:

- Keep the accepted autosave/build reliability requirements in `spec.md`.
- SP2-014, SP2-017, and SP2-020 now define exact debounce/retry, diagnostics, and
  oversized-project behavior.

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
- Deterministic warning thresholds and hard caps apply to assets, PDFs, fonts,
  SVG/raster complexity, documents, resource packs/bundles, extracted archives,
  entry counts/ratios, AI exchange, and generated output.
- Imported archives are scanned for zip-slip paths before extraction.
- Imported archives are extracted to quarantine/temp storage before validated
  content is copied into the workspace.
- Only validated content is copied from quarantine into the workspace.
- Canonical path validation and symlink/hardlink escape rejection are required.
- Typst builds are restricted to app-controlled generated source, resolved
  validated assets, and approved fonts.

Recommended outcome:

- Keep the accepted local file safety requirements in `spec.md`.
- SP2-012 and SP2-020 now define fail-closed SVG/quarantine behavior and numeric
  warning/hard caps; implementation planning must select conforming isolated
  parser/renderer components.

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
- Accessible/tagged final PDFs are required but may be staged after the initial
  v1 release.
- Image alt text is optional for save/draft/print-final, but required for each
  nondecorative figure in accessible-final output.
- Image elements should provide optional alt text and decorative/artifact fields.

Recommended outcome:

- Keep the accepted accessibility requirements in `spec.md`.
- SP2-008 defines the pinned Typst PDF/UA-1 path, semantic mapping, and bundled
  veraPDF validation gate for the staged accessible-final feature.

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
- The default exported PDF filename pattern is `{date:YYYY-MM-DD}.pdf`.

Recommended outcome:

- Keep the accepted print/export workflow requirements in `spec.md`.
- SP2-016 now defines reader-order panel output and required facing-page preview
  without adding professional imposition scope.

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
- Autosave errors should show an immediate toast, persistent save/unprotected
  state until resolved, and full details in diagnostics.

Recommended outcome:

- Keep the accepted error and supportability requirements in `spec.md`.
- SP2-017 defines the stable error-code catalog, redaction, readiness, and
  diagnostic bundle contracts.

### SR-016: Local File Conflict Behavior

Status: Decided

Even a local app can encounter conflicts if the same workspace is opened by two
app processes, restored from backup while open, or stored in a synchronized
folder.

Relevant spec areas: `Offline Application And Workspace`, `Persistence And
Build`, `Undo And Redo`.

Decisions:

- The app prevents the same workspace from being opened for editing by two app
  processes at the same time.
- Project and template saves use both file locks and canonical SHA-256 optimistic
  revision checks.
- When a file changes on disk while the project is open, the app prompts
  the user to choose between accepting the disk change or keeping the current
  workspace version.
- Automatic merge is not required.
- Conflict recovery prevents silent data loss and always preserves base, disk,
  and current versions plus conflict metadata before resolution.

Recommended outcome:

- Keep the accepted local file conflict behavior in `spec.md`.
- SP2-014 defines the lock file, stale-lock recovery, revision token, conflict
  backup, journal, and startup-recovery contracts.

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
- Approval/finalization is required but may be staged after the initial v1
  release.

## Second Pass Review

Status: Decided

The second pass reviewed the current `spec.md` and this decision record from all
review-team perspectives: lead software architect, product UX specialist, local
file-safety/security architect, data model and persistence architect, Typst/PDF
layout engineer, and QA/accessibility/reliability lead.

Original overall finding: the first-pass product decisions were captured, but
several architecture-significant contracts were too vague. SP2-001 through
SP2-023 now resolve those persisted JSON, portable bundle, local security,
layout/PDF validity, packaging, workflow, and data-loss contracts in `spec.md`.

### SP2-001: Normative Scope And Release Gates

Status: Decided

Severity: Critical

Affected spec areas: `Goals`, `User Settings`, `Undo And Redo`, `Release Staging
And Optional Enhancements`.

Original finding: The spec mixed required behavior, optional behavior, and future work
without defining how `must`, `should`, and `may` map to release scope. Some
features, such as undo/redo and user settings, are specified as behavior but also
listed as future work.

Recommended spec improvement: Add a normative-language and release-scope section
that defines MVP requirements, deferred features, optional enhancements, and the
meaning of `must`, `should`, and `may` in this document.

Decisions:

- Use `Required v1`, `Required, may be staged`, `Deferred`, and `Optional
  enhancement` as release-scope labels.
- Requirements without an explicit release-scope exception default to `Required
  v1`.
- User settings panel, margin guide visibility UI, undo/redo, canvas snapping,
  strong inspector validation, faithful grid/stack editor rendering, rich text,
  page-level margin elements, folded/booklet workflow, final page-count
  publication constraints, resource pack import, diagnostic bundle export, and
  file-based AI contract import/export are `Required v1`.
- AI-assisted template filling beyond file exchange may be staged after manual
  template workflows.
- Resource pack creation, export, update, and replacement may be staged.
- Tagged/accessible final PDFs may be staged.
- Approval/finalization may be staged.
- Local AI helper launch/configuration may be staged; file-based exchange is
  sufficient for v1.
- Multiple-workspace management and moving workspaces from the UI are deferred
  from v1.
- Editor/PDF synchronized scrolling, drag-to-resize, element alignment controls,
  and multi-element selection/select all remain optional enhancements.

Applied outcome:

- Added `Normative Language And Release Scope` to `spec.md`.
- Replaced the contradictory future-work list with release staging and optional
  enhancement categories.
- Updated affected feature sections to reflect their release timing.

### SP2-002: Exact JSON Schemas And Workspace Metadata

Status: Decided

Severity: Critical

Affected spec areas: `Document Model`, `Element Types`, `Resource Identity`,
`Assets`, `Resource Packs`, `Import And Export Bundles`, `Local File Conflicts`,
`Validation Expectations`.

Finding: The spec says distributed JSON schemas define persisted validity, but
the normative schema shapes are still described narratively. Workspace metadata
is also implied for resource ids, asset records, revisions, locks, provenance,
and artifact state, but no workspace metadata contract exists.

Recommended spec improvement: Add schema contracts or appendices for document
JSON, page setup, common elements, wrappers, page elements, rich text, assets,
resource packs, bundles, AI contracts/imports, custom elements, workspace
metadata, user settings, and generated artifact records.

Decisions:

- Use JSON Schema Draft 2020-12 for persisted JSON contracts.
- Store v1 schemas under `schema/v1/`.
- Use stable hierarchical schema ids in the form
  `https://church-bulletin-builder.local/schema/v1/<schema-name>.schema.json`.
- Resolve schema ids through a bundled local schema catalog; never fetch schemas
  from the network at runtime.
- Use `document.schema.json` as the authoritative portable root for both
  bulletins and templates.
- Treat existing `template.schema.json` as a legacy compatibility schema or
  wrapper if retained; it must not define a divergent root model.
- Define the v1 schema set as `common.schema.json`, `document.schema.json`,
  `element.schema.json`, `richText.schema.json`, `customElement.schema.json`,
  `ai-exchange.schema.json`, `manifest.schema.json`, `workspace.schema.json`,
  `asset-record.schema.json`, `font-record.schema.json`, `settings.schema.json`,
  `artifact-record.schema.json`, and `diagnostic-catalog.schema.json`.
- Keep portable document JSON limited to renderable/movable document content,
  page setup, field contracts/values, visual elements, page elements, custom
  element data, portable references, and accessibility semantics.
- Keep local resource ids, paths, locks, conflicts, revisions, settings, build
  artifacts, diagnostics, installed pack state, and local AI helper state in
  workspace-local metadata.
- Every persisted root JSON file includes an integer `version` field.
- Document, workspace, settings, asset record, font record, artifact record,
  manifest, custom element, and AI exchange versions are independent.
- Structural JSON Schema validation is separate from semantic app validation.
  Semantic validation handles cross-tree and cross-record rules such as id
  uniqueness, valid bindings, asset resolution, import remapping, and
  finalization readiness.
- The workspace layout is rooted at `workspace.json` and `settings.json`, with
  portable documents under `bulletins/<local-resource-id>/document.json` and
  `templates/<local-resource-id>/template.json`, asset records under
  `assets/<local-resource-id>/asset.json`, font records/faces under
  `fonts/<local-resource-id>/`, installed pack metadata under
  `resource-packs/<local-resource-id>/pack.json`, generated build artifacts under
  `artifacts/<local-resource-id>/<build-id>.*`, and recovery state under
  `.workspace.lock`, `transactions/`, `conflicts/`, and `ai-exchange/`.

Applied outcome:

- Added `Schema Organization, Versions, And Storage Boundaries` to `spec.md`.
- Updated `Project Files` in `spec.md` with the decided workspace layout.
- SP2-003 through SP2-010 dependencies are now decided; encoding their
  field-level contracts in `schema/v1/` is the next schema-generation step.

### SP2-003: Asset Identity And Portability Conflict

Status: Decided

Severity: Critical

Affected spec areas: `Resource Identity`, `Image`, `Assets`, `Resource Packs`,
`Import And Export Bundles`, `AI-Assisted Data Import`.

Finding: Local resource ids are not supposed to live in portable project JSON,
but image JSON stores `data.assetRef` as `asset:<uuid>`. Imports also assign new
local ids, while asset references are expected to remain stable across export,
import, and workspace moves.

Recommended spec improvement: Define separate identity classes for local
workspace resource ids, portable asset ids, bundle entry ids, resource-pack
content ids, and document element ids. Specify import remapping, manifest maps,
collision handling, provenance, and when document JSON is rewritten.

Decisions:

- Workspace and local resource ids are app-generated UUIDv4 values. Local
  resource ids are scoped to one workspace; they own
  workspace registry records, storage paths, artifacts, and local operational
  state, and never appear as portable document identity.
- `asset:<uuid>` remains the canonical document value, but its UUID is a portable
  asset id for one immutable binary revision, not a local asset resource id.
- The workspace asset resolver maps each portable asset id to a local asset
  resource id and verified SHA-256 digest.
  `assets/<local-resource-id>/` always uses the local resource id.
- Replacing asset bytes is copy-on-write and creates both a new portable asset id
  and local asset resource. Metadata-only edits retain identity, and old
  revisions remain while referenced.
- SHA-256 digests establish byte equality and integrity; they are not resource or
  portable identity. Equal bytes with different portable ids remain distinct
  identities even if physical storage is deduplicated.
- Project/template bundle manifests have a bundle id, manifest-scoped entry ids,
  and an explicit map from every referenced portable asset id to an asset entry
  id. Paths and display names are not entry identity.
- A bundle id identifies one export instance for validation/provenance and is not
  an update identity. Importing the same ordinary bundle again creates another
  local document copy.
- A pack has a publisher-stable `packId`; every item has a `contentId` unique
  within that pack. `(packId, contentId)` is the logical pack-content identity
  across versions and maps to destination local ids in installed-pack metadata.
- A changed pack asset keeps its logical content id but receives a new portable
  asset id and hash. Reusing one portable asset id for different bytes inside a
  pack or archive is invalid.
- Document element ids are portable but scoped to one document. Whole-document
  duplicate/import preserves them; duplicate ids inside an imported document
  block normal import. Inserting a subtree into the same document remaps incoming
  collisions and its internal references. Wrapper/placement namespaces remain
  part of SP2-019.
- AI files use an `exchangeId`, exchange-scoped target handles, portable
  field-contract identity/version/hash, and portable asset refs. They do not
  expose or accept workspace-local template, bulletin, or asset resource ids.
- New bundle imports always allocate a new local bulletin/template id. A new
  portable asset id gets a new local asset id; the same portable id plus the same
  verified bytes may reuse the existing local asset.
- The same portable asset id with different bytes inside one archive is invalid.
  A collision between a valid import and existing workspace content stops normal
  import; a user-confirmed isolated-copy import mints a new portable asset id and
  rewrites the entire staged incoming reference closure transactionally. Existing
  destination bindings are never changed.
- Import planning records source entry/content ids, source and remapped portable
  asset ids, destination local resource ids, hashes, and provenance in the
  transaction journal before commit. Failed imports must not expose partial
  mappings or documents.
- Changing only local resource ids does not rewrite portable document JSON.
  Rewrites occur for portable-id collision remaps, safe legacy-path migration,
  explicit asset replace/relink, element/subtree collision repair, or applying a
  reviewed AI asset selection.
- Exported source local ids are optional provenance only. Import never trusts
  them as destination ids or paths, and imported content has no live dependency
  on its source archive.

Applied outcome:

- Expanded `Resource Identity` in `spec.md` with normative identity classes,
  portable asset resolution, collision/remapping behavior, provenance, and
  document rewrite rules.
- Updated `Image`, `Assets`, `Resource Packs`, `Import And Export Bundles`, and
  `AI-Assisted Data Import` to use the separated identities consistently.
- Left the legacy schemas unchanged; the new primitives and resolver/manifest
  fields belong in the `schema/v1/` schema set established by SP2-002.

### SP2-004: Template, Custom Element, And AI Data Source Of Truth

Status: Decided

Severity: Critical

Affected spec areas: `Document Model`, `AI-Assisted Data Import`, `Custom
Elements And Bindings`, `Template And Custom Element Lifecycle`.

Finding: The spec allows template `schema`, bulletin `fieldValues`, element
`data`, custom element `dataFields`, bindings, and AI field values, but it does
not define which layer is authoritative or how edits, re-imports, schema updates,
manual overrides, and conflicts interact.

Recommended spec improvement: Define a shared field-contract model with stable
field ids, value types, defaults, constraints, binding paths, materialization into
visual elements, manual override behavior, source-template metadata, schema
versioning, and AI import validation rules.

Decisions:

- `fieldContract`, `fieldValues`, bindings, and the shared typed value model are
  authoritative; legacy `schema`/`dataFields` are migration input.
- Bound values resolve stored value, contract default, binding fallback, then
  missing. Bound targets have no competing persisted literal.
- Bindings use allowlisted content-data JSON Pointers. Editing writes the field;
  explicit detach materializes the value and removes the binding atomically.
- Contract id/version/canonical hash govern compatibility. Manual values win on
  re-import, and incompatible removed values remain inert/orphaned until reviewed.
- Custom instances pin definition id/version/hash and store scoped field values;
  expansion is transient and pack/library updates never rewrite them silently.
- AI proposals use the same types, validate against base/current field hashes,
  and receive origin `ai` only after field-level acceptance.

Applied outcome:

- Added `Field Contracts, Values, And Bindings` and rewrote the AI/custom-element
  lifecycle sections around the shared source-of-truth model.

### SP2-005: Rich Text AST And Safe Typst Output

Status: Decided

Severity: Critical

Affected spec areas: `Text`, `AI-Assisted Data Import`, `Accessibility
Requirements`, `Validation Expectations`.

Finding: Rich text is expected to support headings, lists, scripture formatting,
and inline bold/italic, but no persisted representation is defined. The current
allowance for validated Typst-supported markup risks unsafe or inconsistent Typst
generation unless the allowed grammar is explicit.

Recommended spec improvement: Define a structured rich-text AST with allowed
block nodes, inline marks, list rules, heading levels, scripture-specific nodes,
plain-text fallback, paste sanitization, accessibility semantics, and Typst
rendering rules. Prefer structural data over raw Typst.

Decisions:

- Text uses a discriminated plain/rich `data.content`; legacy `data.text`
  migrates and cannot coexist as a second source.
- The v1 AST allows document, paragraph, heading 1–6, bullet/ordered list,
  list-item, blockquote, scripture, text, and line-break nodes.
- Inline marks are only strong/emphasis; list depth is capped and canonical
  normalization/plain-text fallback are deterministic.
- Clipboard HTML/RTF is untrusted and reduces to the allowlist; active/hidden/
  unknown constructs cannot reach the persisted AST.
- Typst is generated only by node-specific app code with escaped leaves. Raw
  Typst/HTML/Markdown is never a rich-text or AI field value.

Applied outcome:

- Replaced narrative rich text with a persisted AST, paste rules, fallback text,
  accessibility semantics, and safe Typst-generation contract under `Text`.

### SP2-006: Page-Level Element Placement, Layering, And Semantics

Status: Decided

Severity: Critical

Affected spec areas: `Document Model`, `Page Model`, `Page-Level Elements`,
`Page View`, `Selection And Inspector`, `Accessibility Requirements`.

Finding: `pageElements` now cover backgrounds, headers, footers, page numbers,
and decorations, but the persisted placement schema is missing. Target pages,
coordinate origin, anchor region, dimensions, z-order, clipping, selection,
repeat behavior, and accessibility reading order are undefined.

Recommended spec improvement: Define a page-level element schema with `purpose`,
`target`, `layer`, `region`, `anchor`, `x`, `y`, `width`, `height`, `zIndex`,
repeat/page-range behavior, artifact/read-order behavior, and validation rules.

Decisions:

- Each `pageElements` entry is a selectable placement wrapper around one native
  element with purpose, target, layer, region, anchor, offsets, authoritative
  box, z-index, clipping, and semantic metadata.
- Targets cover all/first/last/odd/even/range/explicit pages and render once for
  each match after body pagination.
- Region geometry, top-left coordinate direction, anchors, physical-page
  clipping, purpose/layer/region compatibility, and tie-breaking are defined.
- Visual z-order is independent of accessibility order. Artifacts are excluded;
  meaningful single-page furniture requires unique before/after-body ordering.
- Selecting a repeated occurrence edits its source definition; layers/structure
  navigation keeps overlapped content reachable.

Applied outcome:

- Replaced `Page-Level Elements` with the normative wrapper schema, geometry,
  targeting, layering, semantics, selection, and validation contract.

### SP2-007: Pagination And Breakability Matrix

Status: Decided

Severity: Critical

Affected spec areas: `Pagination And Overflow`, `Page View`, `Text`, `Grid`,
`Stack`, `Canvas`, `Flow Layout`.

Finding: The spec says text and oversized elements may split at natural break
points, but breakability is not defined per element/container type. Typst behavior
depends on boxes, borders, padding, grids, stacks, and generated structure.

Recommended spec improvement: Add a breakability matrix covering every element
and container type. Specify where breaks are allowed, what stays unbreakable, how
borders/backgrounds continue across pages, and which overflow cases are warnings
or blocking errors.

Decisions:

- Added per-type rules: text, grid rows, and vertical stacks may fragment;
  images/dates/music/horizontal stacks/canvases are unbreakable; page furniture
  never paginates.
- Only supported auto-height structures fragment; fixed/unbreakable ancestors
  suppress descendant break points.
- Fragment borders/backgrounds/padding/margins/gaps have deterministic first,
  middle, and last-page behavior.
- `breakPolicy` is `auto` or `avoid`; avoid cannot legalize an oversized
  indivisible element.
- Horizontal overflow, oversized indivisible content, clipped semantic content,
  and no-progress pagination block manual/final builds.
- Page breaks are top-level body elements only; intentional leading/trailing/
  consecutive blanks warn but remain deterministic.

Applied outcome:

- Replaced narrative overflow handling with the complete breakability matrix and
  fragment/error rules under `Pagination And Overflow`.

### SP2-008: PDF Accessibility Toolchain And Semantic Mapping

Status: Decided

Severity: Critical

Affected spec areas: `Accessibility Requirements`, `Text`, `Image`, `Page-Level
Elements`, `Print And Export Workflows`, `Persistence And Build`.

Finding: Final PDFs are expected to be tagged/accessible, but the spec does not
define the PDF accessibility target, toolchain, validation tool, semantic role
mapping, or finalization behavior when tags cannot be produced.

Recommended spec improvement: Add a PDF accessibility output contract covering
the target standard or subset, Typst/post-processor strategy, document language
and title metadata, heading/list/table/figure/artifact mapping, reading order,
alt/decorative behavior, validation tooling, and finalization pass/fail rules.

Decisions:

- The staged accessible-final target is PDF/UA-1 on PDF 1.7 using pinned bundled
  Typst support and an offline pinned veraPDF validator profile.
- Document metadata includes title/language; accessible finalization never
  silently downgrades to untagged output.
- Paragraphs, headings, lists, scripture, layout/table grids, figures, artifacts,
  and meaningful page furniture have explicit semantic mappings.
- Body/grid/stack/canvas/custom/page-furniture reading order is deterministic and
  independent of paint order.
- Nondecorative figures require alt text for accessible final; artifact content
  is excluded. Automated validation plus human-authored metadata/order review is
  required.

Applied outcome:

- Added `PDF Accessibility Output Contract`, document accessibility metadata,
  grid table semantics, validator gates, and accessible-final readiness rules.

### SP2-009: Build Artifact Identity, Finalization, And Export Semantics

Status: Decided

Severity: Critical

Affected spec areas: `Persistence Contract`, `Persistence And Build`, `Print And
Export Workflows`, `Import And Export Bundles`.

Finding: Generated PDFs, preview PDFs, latest built PDFs, finalized PDFs, and
exported PDFs are not clearly distinguished. Finalization records metadata, but
there is no build artifact record tying output to document revision, assets,
fonts, Typst version, validation result, or PDF hash.

Recommended spec improvement: Define artifact types and build records. A final
approval should approve a specific immutable artifact with build id, document
hash, Typst source hash, asset/font hashes, app version, Typst version, PDF hash,
page count, diagnostics, and stale triggers. Define whether export copies the
approved artifact or rebuilds.

Decisions:

- Artifact kinds are preview, draft, final candidate, and imported diagnostic;
  approval references an immutable final candidate rather than creating a new PDF.
- UUID build ids are distinct from monotonic preview request sequences and build
  statuses cover queued/running/succeeded/failed/canceled/timed out.
- Records bind document/Typst hashes, asset/font closure, app/renderer/Typst/
  validator versions/hashes, validation evidence, PDF hash/size/page count, and
  output profile into a build-input signature.
- Input changes make an artifact/approval stale without mutating historical
  bytes. Preview and imported diagnostics can never become current/final.
- Current export rebuilds only when no matching current artifact exists;
  approved export verifies and byte-copies the exact approved PDF.

Applied outcome:

- Added `Build Artifacts And Approval Identity` and aligned finalization, export,
  bundle inclusion, and stale-state semantics with immutable build records.

### SP2-010: Resource Pack And Bundle Manifest Contracts

Status: Decided

Severity: Critical

Affected spec areas: `Resource Packs`, `Import And Export Bundles`, `Local File
Safety`, `Assets`.

Finding: Resource packs and bundles depend on deterministic manifests, updates,
dependency tracking, asset remapping, compatibility checks, and rollback, but the
manifest schemas are not defined. Per-entry hashes, sizes, content ids, media
types, dependencies, and rewrite rules are missing.

Recommended spec improvement: Add minimum manifest schemas for `.pak` and `.zip`
bundles. Include format version, canonical paths, declared sizes, SHA-256 hashes,
content ids, dependency lists, media types, schema versions, source/provenance,
asset maps, deterministic ordering, and import rewrite rules.

Decisions:

- `manifest.schema.json` discriminates resource packs, project bundles, and
  template bundles with exact root counts/totals, compatibility, maps, and entry
  closure.
- Bundle entries use manifest-scoped `entryId`; pack entries use pack-scoped
  `contentId`. Their dependencies/maps use the corresponding identity type.
- Every payload declares required flag, canonical path, media type, exact
  uncompressed size, SHA-256, schema/version, typed refs, dependencies, and
  bounded provenance/license metadata.
- Canonical path rules reject cross-platform aliases/unsafe forms; every payload
  member is declared exactly once and verified before content import.
- RFC 8785 serialization, canonical array/archive ordering, fixed zip metadata,
  digest/signature coverage, and deterministic rewrite traversal are defined.
- Remapping touches only typed schema fields in quarantine, revalidates the whole
  closure, and commits with the journaled import transaction.

Applied outcome:

- Added `Archive Manifest Contract` and refined pack/bundle export/import fields,
  artifact inclusion, asset/font maps, deterministic signing input, and rewrite
  rules.

### SP2-011: Resource Pack Trust And Update Safety

Status: Decided

Severity: Critical

Affected spec areas: `Resource Packs`, `Local File Safety`, `Assets`, `Template
And Custom Element Lifecycle`.

Finding: Stable pack ids and explicit confirmation do not prevent a malicious
`.pak` from spoofing a trusted pack update. Update/replace can also remove
pack-managed assets, fonts, styles, or schemas that existing documents still
reference.

Recommended spec improvement: Define a resource-pack trust model with publisher
identity, signatures or equivalent verification, signer-change warnings,
downgrade handling, dependency impact analysis, transactional update/rollback,
and retention or copy-on-write for referenced pack content.

Decisions:

- Signed packs use Ed25519 over the canonical manifest/entry digest; invalid
  claimed signatures block. Signature continuity and content safety are separate.
- First import may accept an unsigned pack as visibly unverified, but unsigned
  installations cannot update/replace in place.
- Trusted signer fingerprints are locally pinned. Signer changes require a
  dual-signed transition or separate high-risk association; pack id alone grants
  no authority.
- Positive release sequence governs no-op/equivocation/update/downgrade behavior;
  semantic version remains display metadata.
- Update performs three-way local/base/incoming impact analysis. Local conflicts
  are preserved/detached rather than overwritten.
- Every changed resource is copy-on-write; referenced retired revisions remain
  resolvable. Transactional commit/rollback advances installed state last and
  never weakens local AI/privacy policy silently.

Applied outcome:

- Added `Resource Pack Trust And Update Safety` with signature, key pinning,
  sequence, signer-transition, impact, retention, and rollback requirements.

### SP2-012: Security Threat Model And Untrusted Content Policies

Status: Decided

Severity: Critical

Affected spec areas: `Offline Application And Workspace`, `Local File Safety`,
`Resource Packs`, `Assets`, `Persistence And Build`, `AI-Assisted Data Import`.

Finding: The spec has good local file-safety controls, but no explicit threat
model. Archive edge cases, SVG rendering, font parsing, imported PDFs, generated
Typst, untrusted Markdown/readmes, diagnostics, and UI rendering of imported text
need fail-closed policies.

Recommended spec improvement: Add a security threat model defining trusted
components, untrusted content classes, same-user process assumptions,
confidentiality and integrity goals, no-network expectations, and fail-closed
behavior. Expand policies for archives, SVGs, fonts, imported PDFs, Typst, safe
Markdown, and untrusted UI text.

Decisions:

- Trusted components, all untrusted data classes, confidentiality/integrity/
  availability goals, offline behavior, and same-user/compromised-OS non-goals
  are explicit.
- Complex binary parsing runs in restricted no-network workers and fails closed
  on missing isolation, crash, timeout, ambiguity, or unsupported input.
- JSON/archive/path/link/device/normalization/race rules prevent imported content
  from selecting code, roots, commands, or undeclared payload.
- SVG, font, PDF, generated Typst, safe Markdown, imported UI text, and diagnostic
  output each have allowlist/no-execution/no-fetch policies.
- Signatures/user confirmation never bypass content validation; diagnostics and
  security checks remain bounded, redacted, offline, and deterministic.

Applied outcome:

- Added `Security Threat Model` and expanded `Local File Safety` with fail-closed
  per-content parsing/render/build policies.

### SP2-013: AI Helper Execution Boundary

Status: Decided

Severity: Critical

Affected spec areas: `Goals`, `Assets`, `Local File Safety`, `AI-Assisted Data
Import`, `Error Messages And Support`.

Finding: A controlled working directory does not prevent an external AI helper
from reading the filesystem, inheriting environment secrets, using the network,
or modifying files outside the exchange directory. Validating output protects
document integrity but not confidentiality.

Recommended spec improvement: Define whether external helpers are outside the app
trust boundary or must run under enforceable isolation. Specify opt-in, command
allowlists, environment sanitization, network policy, file permissions, working
directory contents, timeout/cancellation, output limits, cleanup, logging, and
redaction.

Decisions:

- Required manual file exchange treats an externally run helper as outside the
  app trust boundary and warns that it may read/retain/transmit exported data.
- Staged managed launch exists only when enforceable platform isolation succeeds;
  otherwise the app directs users to file exchange.
- User-created profiles pin executable path/hash/fixed arguments/runtime roots;
  imports cannot configure them and changed bytes require reapproval.
- Each run is explicitly approved, no-shell, least-privilege, no-network, with
  sanitized environment and only owner-only read-only input plus bounded output/
  scratch visible.
- Time, process tree, file/count/JSON/output/log limits, cancellation, cleanup,
  24-hour pending expiry, redaction, and fixed result paths are defined.
- Output remains untrusted and cannot mutate a document before normal validation
  and field review.

Applied outcome:

- Expanded `AI-Assisted Data Import` with the external-helper disclosure and
  enforceable managed-helper execution boundary.

### SP2-014: Autosave, Locking, Conflict, And Crash Recovery State Machines

Status: Decided

Severity: Critical

Affected spec areas: `Persistence Contract`, `Persistence And Build`, `Local File
Conflicts`, `Resource Packs`, `Import And Export Bundles`.

Finding: Autosave is authoritative, but max save latency, retry policy, crash
recovery, failed-autosave shutdown behavior, conflict handling during dirty
autosave/build, stale-lock recovery, and partial import rollback are not
measurable.

Recommended spec improvement: Define state machines for autosave, file locks,
optimistic revision checks, conflicts, import transactions, startup recovery, and
crash recovery. Include content-hash revision tokens, lock-file format, conflict
backup location, transaction logs, atomic metadata commits, rollback, and maximum
data-loss windows.

Decisions:

- Persistence states are clean/dirty/saving/save-failed/conflicted/read-only with
  a 500 ms debounce, a two-second maximum autosave-attempt latency, a five-second
  healthy-storage durability bound, bounded retries, recovery snapshots, and no
  silent close/discard. Failure of both canonical and recovery writes exposes a
  persistent unprotected state.
- Canonical SHA-256 revision tokens plus locks and immediate pre-replace checks
  govern atomic saves; edits during a save remain dirty.
- `.workspace.lock` has workspace/instance/process-start/host/timestamps and a
  five-second heartbeat. Stale recovery needs proven death or age plus explicit
  confirmation; PID alone is insufficient.
- Conflict directories preserve base/disk/ours metadata and offer disk/current/
  export-both resolution without automatic merge or overwrite races.
- Multi-resource journals persist planned ids/remaps and staged/commit/rollback
  hashes. Registry visibility/installed state advances only at the commit point.
- Startup resolves journals/recovery before editable access and never guesses on
  contradictory state. Final builds require the exact clean persisted revision.

Applied outcome:

- Added `Save, Lock, Conflict, And Recovery State Machines` and updated workspace
  layout/build/import/pack semantics for measurable crash-safe behavior.

### SP2-015: Font Determinism And Font Portability

Status: Decided

Severity: High

Affected spec areas: `Style Model`, `Offline Application And Workspace`,
`Resource Packs`, `Persistence And Build`, `Import And Export Bundles`.

Finding: The default font is `Calibri`, which may not be available or legally
bundleable on Linux. Font family matching, duplicate imported fonts, missing
weights, glyph fallback, and font export dependencies can change pagination and
PDF accessibility.

Recommended spec improvement: Define bundled open fonts, font records, font ids
or managed references, fallback stacks, font precedence, glyph diagnostics,
embedding/subsetting rules, non-exportable font behavior, and whether bundles
must include redistributable referenced fonts.

Decisions:

- Pinned bundled Noto Sans faces and Noto Sans Symbols 2 replace Calibri as the
  deterministic default/symbol fallback, with exact ids/licenses/hashes.
- Portable `font:<uuid>`, local font records, immutable face/family revisions,
  `style.fontRef`, and explicit fallback refs replace family-name identity.
- Builds never search OS fonts; style/weight matching, fallback order, variable
  axes, missing-face warnings, missing-glyph blocks, and build face evidence are
  deterministic.
- Isolated validation, collision remapping, legacy family migration, pack
  copy-on-write, and retention follow managed-resource rules.
- Portable bundles include all permitted nonbuilt-in font dependencies. A
  nonredistributable/nonembeddable font blocks portable/final output instead of
  silent substitution; PDFs embed/subset used faces with Unicode mapping for
  accessible output.

Applied outcome:

- Added `font-record.schema.json` scope, workspace font storage, portable font
  identity, `Font Identity, Resolution, And Portability`, build evidence, and
  manifest font maps.

### SP2-016: Booklet And Folded Output Definition

Status: Decided

Severity: High

Affected spec areas: `Primary Bulletin Workflow`, `Page Model`, `Print And
Export Workflows`, `Page View`.

Finding: Folded/booklet bulletins are expected, but exported PDFs are in reading
order and professional imposition is out of scope. Users may still expect panel
ordering, facing-page preview, blank-page insertion, simple 2-up output, fold
guides, or mirrored margins.

Recommended spec improvement: Define required output modes and explicit
non-goals. Specify reader-order panel PDF, optional or out-of-scope imposed sheet
PDF, panel size versus sheet size, page-count handling, blank-page behavior,
facing-page preview, fold guides, and mirrored margin support or exclusion.

Decisions:

- Required output is a reader-order PDF whose physical page is one finished
  logical panel; `page.layoutIntent` does not change order/size.
- Facing Page View is required and uses editor-only blank slots. No blank pages
  are added automatically; non-multiple-of-four counts warn only when
  `page.layoutIntent` is `foldedBooklet`.
- Portable `page.finalPageCountRequirement` supports exact, minimum, maximum,
  and multiple-of constraints. The verified reader-order PDF count includes
  intentional blank pages and excludes editor placeholders.
- Page Setup exposes the constraint and a booklet `Multiple of 4` quick setting.
  A mismatch blocks current/final/approved export and finalization without
  silently adding blanks; only an explicitly labeled non-publication draft or
  historical diagnostic action is allowed.
- Fixed and explicit mirrored inner/outer margins are supported with left/right
  binding and parity resolved before page-furniture regions.
- Built-in `5.5in x 8.5in` and `7in x 8.5in` folded presets are defined.
- Imposed/2-up sheet PDF, signature ordering, crop/bleed/fold marks, creep,
  duplex configuration, and sheet-size output are explicit v1 non-goals.

Applied outcome:

- Added exact folded/booklet page, facing-preview, configurable blocking
  page-count, mirrored-margin, preset, and non-goal requirements across
  Page/Print/User Settings.

### SP2-017: Validation, Error Codes, Diagnostics, And Final Readiness

Status: Decided

Severity: High

Affected spec areas: `Validation Expectations`, `Persistence Contract`, `Error
Messages And Support`, `Print And Export Workflows`, `Accessibility
Requirements`.

Finding: The spec requires stable error codes, actionable errors, diagnostic
bundles, and finalization gates, but does not define an error taxonomy,
diagnostic redaction rules, or a final-readiness checklist. Missing assets,
missing fonts, untagged PDFs, missing alt text, horizontal overflow, and stale
artifacts need operation-specific severity.

Recommended spec improvement: Add an error catalog with code families, severity,
JSON Pointer/source location, user summary, diagnostic details, recovery action,
and redaction rules. Add final-readiness gates for print and accessibility,
including which warnings are overridable.

Decisions:

- Stable codes use `CBB-<DOMAIN>-<NNNN>` with separate severity and operation
  disposition plus structured location/recovery/correlation fields. A bundled,
  versioned catalog validated by `diagnostic-catalog.schema.json` is normative
  and includes the required baseline codes.
- Imported diagnostic text is inert; logs/bundles use allowlisted content and
  redact secrets, environment, private content, and absolute path prefixes.
- Draft, print-final, and accessible-final profiles define operation-specific
  treatment for fields, save state, assets, fonts/glyphs, overflow, alt text,
  tags, configured page-count requirements, stale artifacts, and build
  verification.
- Final candidates require exact saved revision, valid complete dependency/
  layout/output-requirement closure, verified immutable PDF, and profile review.
- Only cataloged warnings are waivable; integrity/security/save/overflow/stale/
  conformance and configured page-count failures are not. Waivers bind to
  artifact/readiness evidence.

Applied outcome:

- Added `Diagnostic Codes And Redaction`, readiness profiles/matrix/checklists,
  waiver rules, and approval evidence requirements.

### SP2-018: Missing Asset Operation Severity

Status: Decided

Severity: High

Affected spec areas: `Assets`, `Persistence Contract`, `Print And Export
Workflows`, `Import And Export Bundles`.

Finding: The spec both allows missing-image placeholders in the editor/PDF and
says missing referenced assets should be relinked before export or build. This is
ambiguous for live preview, draft manual build, finalization, and bundle export.

Recommended spec improvement: Define missing-asset behavior by operation. For
example, editor and live preview may show placeholders, draft builds may warn,
and finalization/final export may block unless the user explicitly exports a
draft with placeholders.

Decisions:

- The referenced closure covers body/page/custom/field/binding/output refs;
  unrelated library assets do not affect readiness.
- Edit/save/live preview preserve unresolved refs and same-size safe placeholders
  with persistent draft/not-ready status.
- Manual placeholder output is available only as explicitly confirmed draft,
  recorded in artifact/export metadata with a `-DRAFT` filename proposal.
- Current/final/accessible/approval and self-contained bundle export block; pack
  export/import blocks when a required selected dependency is missing.
- Asset deletion requires a same-transaction relink/reference removal; readiness
  always re-resolves rather than trusting an old preview.

Applied outcome:

- Added the operation matrix and deletion/relink/final-readiness rules under
  `Assets` and aligned artifact/readiness behavior.

### SP2-019: Element Model, Selection, And Drag/Drop Precision

Status: Decided

Severity: High

Affected spec areas: `Document Model`, `Container Child Wrappers`, `Grid`,
`Stack`, `Canvas`, `Selection And Inspector`, `Drag And Drop`.

Finding: Element id uniqueness, wrapper id scope, child array fields, grid cell
repair, stack index ordering, canvas z-order, page-break placement, selection of
overlapped/repeated content, and drag/drop source-to-target semantics are still
ambiguous.

Recommended spec improvement: Define document-global selectable ids or path-based
addressing, container child schemas, ordering precedence, deterministic repair
rules, hit-testing/layer precedence, page-break allowed parents, and a drag/drop
decision table with undo transaction boundaries.

Decisions:

- Native elements and all placement wrappers use distinct typed ids in one
  document-global selectable collision domain.
- Grid/stack/canvas use closed required `children` wrappers; grid coordinates,
  stack array order, and canvas back-to-front array order are authoritative.
- Occupied/invalid grid imports block; explicit recovery reflows row-major without
  deletion. Stack/canvas indices/order normalize deterministically.
- Page breaks are top-level body-only. Hit testing follows paint order while
  structure/layers and cycle selection keep overlapped/repeated nodes reachable.
- The source/destination table defines create/move/wrap/unwrap/id behavior.
  Validation happens before source removal and one successful drop is one undo/
  autosave transaction; invalid/no-op drops change nothing.

Applied outcome:

- Expanded container wrappers, grid/stack/canvas ordering/repair, page breaks,
  Drag And Drop, and Selection And Inspector with exact semantics.

### SP2-020: Size, Performance, And Resource Limits

Status: Decided

Severity: High

Affected spec areas: `Persistence And Build`, `Local File Safety`, `Resource
Packs`, `Assets`, `AI-Assisted Data Import`.

Finding: The spec requires size limits but defers numeric values and omits some
limit categories. Local denial-of-service risks include huge JSON depth, long
strings, element counts, image pixel counts, SVG complexity, font counts, PDF
page counts, archive compression ratios, and AI output size.

Recommended spec improvement: Define required limit categories, default caps,
warning thresholds, hard caps, configurability, fail-closed behavior, and
actionable error messages for each content type.

Decisions:

- Added deterministic warning/hard caps for JSON sizes/depth/strings, persisted/
  expanded nodes, nesting/rich text, asset counts/bytes/pixels, SVG complexity,
  PDFs, fonts, archives/ratios, AI input/output, PDF pages, and runtimes.
- Limits are checked from declarations and actual streamed/decoded values. Hard
  caps abort the transaction; warning thresholds require visible review.
- Workspace policy may lower thresholds, normal UI cannot raise hard caps, and
  security ceilings are never raiseable or machine-RAM-dependent.
- Existing over-limit data is bounded read-only/recovery only. Diagnostics name
  observed/limit/recovery and long operations expose progress/cancellation.
- Boundary, deceptive-input, cancellation, cleanup, and rollback tests are
  release requirements.

Applied outcome:

- Added `Size, Performance, And Resource Limits` and replaced the prior
  unspecified-limit wording in build/file-safety sections.

### SP2-021: Packaging, Install, Update, And Uninstall Acceptance

Status: Decided

Severity: High

Affected spec areas: `Offline Application And Workspace`, `Project Files`,
`Persistence Contract`.

Finding: Package formats are named, but installer/update behavior is not
specified. Release QA needs minimum OS expectations, signing verification,
desktop integration, bundled Typst/font verification, failed update rollback,
uninstall behavior, and workspace migration behavior.

Recommended spec improvement: Add platform-specific packaging acceptance criteria
for signed MSI, Linux package signing expectations, AppImage behavior, AUR/native
pacman expectations, desktop entries, offline launch, update over previous
versions, failed-update rollback, and uninstall preserving workspace data unless
the user explicitly removes it.

Decisions:

- Required x86-64 QA baselines are Windows 11, Ubuntu 24.04 LTS, Debian 12, and a
  recorded current Arch snapshot; ARM remains optional.
- MSI/update payloads use timestamped Authenticode. Linux artifacts use signed
  release manifests; pacman metadata is signed and AUR pins/verifies upstream.
- Desktop/icon/MIME/AppImage behavior, offline clean-system smoke build,
  non-ASCII paths, and bundled component self-report/verification are acceptance
  gates.
- Offline MSI/package updates and side-by-side AppImage updates preserve a
  runnable prior app on failure; installers never migrate workspace content.
- Journaled first-launch migration preserves pre-migration state. Downgrades do
  not rewrite newer workspaces, and uninstall preserves workspaces/exports unless
  a separate exact-path deletion is confirmed.

Applied outcome:

- Added `Packaging And Release Acceptance` with platform signing, integration,
  offline smoke, upgrade/rollback/migration, and uninstall criteria.

### SP2-022: Date, Filename, Locale, And Settings Determinism

Status: Decided

Severity: Medium

Affected spec areas: `Date`, `Print And Export Workflows`, `User Settings`,
`Lengths And Units`.

Finding: Date values, export filename tokens, time zone behavior, locale fallback,
global versus per-workspace settings, and unit rounding are not deterministic
enough for reproducible output and cross-platform QA.

Recommended spec improvement: Define ISO date storage, date-only semantics,
format tokens, filename date-source priority, invalid filename handling, locale
fallback, global/per-workspace setting boundaries, and length rounding rules.

Decisions:

- Date-only values are validated proleptic-Gregorian `YYYY-MM-DD` without time
  zone conversion; operational timestamps are RFC 3339 UTC.
- Portable publication date and pinned BCP-47 locale data drive a closed date
  token grammar. Missing export dates prompt and never use wall clock silently.
- Filename patterns have closed substitutions, cross-platform NFC sanitization,
  reserved-name/length/extension/collision rules, and affect labels only.
- Application-global, workspace, and portable output settings have explicit
  boundaries; final page-count requirements remain portable document data, and
  workspace defaults seed but never mutate existing documents.
- Exact unit constants, decimal/rational parsing, single `0.001pt` half-away
  rounding, six-digit inch persistence, and no-drift behavior are defined.

Applied outcome:

- Reworked `Date`, `Lengths And Units`, `User Settings`, and export naming with
  deterministic storage/formatting/settings contracts.

### SP2-023: Document Library And Weekly Workflow Details

Status: Decided

Severity: Medium

Affected spec areas: `Primary Bulletin Workflow`, `Resource Identity`, `Project
Files`, `Import And Export Bundles`.

Finding: The weekly template workflow is the ideal path, but the spec does not
define template selection, draft return, required field validation, document
library search/filter/sort, duplicate display names in lists, recent documents,
or source-pack grouping.

Recommended spec improvement: Add baseline library and weekly-creation workflow
requirements covering template chooser, field-filling screens, drafts, required
field validation, search/filter/sort, duplicate disambiguation, recent items, and
source-pack grouping.

Decisions:

- Library rows are keyed by local identity, retain broken entries for recovery,
  expose baseline actions, and show name/kind/date/state/time/source metadata.
- Search normalization/token behavior, filters, stable sorts/tie-breakers, ten
  recent distinct resources, and duplicate accessible disambiguation are exact.
- Template chooser groups personal/imported and each pack with publisher/version/
  trust, compatibility, page size, required count, and preview.
- New Bulletin transactionally creates a draft before the field form; setup step
  persists and resumes after restart, with copied contract/bindings/source hashes
  but no local live link.
- Missing required values allow save/preview and visible incomplete drafts while
  blocking final candidate/finalization/export; completion/clearing updates
  workflow/readiness and stales approval deterministically.
- Configured output requirements, including final page count, participate in the
  same incomplete/ready state and block publication without blocking editing.

Applied outcome:

- Added `Document Library And Weekly Creation` with library/search/filter/sort/
  recents/source grouping and resumable template-driven creation requirements.

## Second Pass Outcome

SP2-001 through SP2-023 are decided and applied to `spec.md`. The next spec
generation step is to encode these decisions in the `schema/v1/` JSON Schemas
and then perform architecture/implementation planning against the normative
contracts. Legacy schemas remain migration/reference material until that schema
generation is complete.
