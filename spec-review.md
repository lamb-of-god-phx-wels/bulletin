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

## Second Pass Review

Status: Open

The second pass reviewed the current `spec.md` and this decision record from all
review-team perspectives: lead software architect, product UX specialist, local
file-safety/security architect, data model and persistence architect, Typst/PDF
layout engineer, and QA/accessibility/reliability lead.

Overall finding: the first-pass product decisions are captured, but several
architecture-significant contracts remain too vague. Items that affect persisted
JSON, portable bundle formats, local security boundaries, final PDF validity, or
data-loss behavior should be resolved in `spec.md` before implementation plans
depend on them.

### SP2-001: Normative Scope And Release Gates

Severity: Critical

Affected spec areas: `Goals`, `User Settings`, `Undo And Redo`, `Known Future
Work`.

Finding: The spec mixes required behavior, optional behavior, and future work
without defining how `must`, `should`, and `may` map to release scope. Some
features, such as undo/redo and user settings, are specified as behavior but also
listed as future work.

Recommended spec improvement: Add a normative-language and release-scope section
that defines MVP requirements, deferred features, optional enhancements, and the
meaning of `must`, `should`, and `may` in this document.

### SP2-002: Exact JSON Schemas And Workspace Metadata

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

### SP2-003: Asset Identity And Portability Conflict

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

### SP2-004: Template, Custom Element, And AI Data Source Of Truth

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

### SP2-005: Rich Text AST And Safe Typst Output

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

### SP2-006: Page-Level Element Placement, Layering, And Semantics

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

### SP2-007: Pagination And Breakability Matrix

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

### SP2-008: PDF Accessibility Toolchain And Semantic Mapping

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

### SP2-009: Build Artifact Identity, Finalization, And Export Semantics

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

### SP2-010: Resource Pack And Bundle Manifest Contracts

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

### SP2-011: Resource Pack Trust And Update Safety

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

### SP2-012: Security Threat Model And Untrusted Content Policies

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

### SP2-013: AI Helper Execution Boundary

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

### SP2-014: Autosave, Locking, Conflict, And Crash Recovery State Machines

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

### SP2-015: Font Determinism And Font Portability

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

### SP2-016: Booklet And Folded Output Definition

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

### SP2-017: Validation, Error Codes, Diagnostics, And Final Readiness

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

### SP2-018: Missing Asset Operation Severity

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

### SP2-019: Element Model, Selection, And Drag/Drop Precision

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

### SP2-020: Size, Performance, And Resource Limits

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

### SP2-021: Packaging, Install, Update, And Uninstall Acceptance

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

### SP2-022: Date, Filename, Locale, And Settings Determinism

Severity: Medium

Affected spec areas: `Date`, `Print And Export Workflows`, `User Settings`,
`Lengths And Units`.

Finding: Date values, export filename tokens, time zone behavior, locale fallback,
global versus per-workspace settings, and unit rounding are not deterministic
enough for reproducible output and cross-platform QA.

Recommended spec improvement: Define ISO date storage, date-only semantics,
format tokens, filename date-source priority, invalid filename handling, locale
fallback, global/per-workspace setting boundaries, and length rounding rules.

### SP2-023: Document Library And Weekly Workflow Details

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

## Proposed Next Step

Resolve or explicitly defer the Critical and High second-pass findings above
before architecture and implementation planning. In particular, prioritize the
contracts that affect persisted JSON, portable files, security boundaries,
build/finalization artifacts, and tagged PDF feasibility.
