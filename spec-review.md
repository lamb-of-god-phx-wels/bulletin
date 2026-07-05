# Spec Review Action Items

This document captures recommendations, risks, and client decisions from the
initial review of `spec.md`. Use it as a working checklist before architecture,
planning, and implementation.

## Review Team

- Lead software architect and UX reviewer.
- Product UX specialist for document-editor workflows.
- Security and authorization architect.
- Data model, JSON schema, and persistence architect.
- Typst/PDF rendering and layout engineer.
- QA, accessibility, and reliability lead.

## Highest Priority Decisions

### SR-001: Define The Product Mode

Status: Open

The spec currently mixes a local disk-backed GUI app with an authenticated
multi-user sharing system.

Relevant spec areas: `Goals`, `Project Files`, `Users, Ownership, And Sharing`.

Questions:

- Is v1 local-only, authenticated multi-user, or hybrid?
- If hybrid, which features work offline and which require authentication?
- Are resources scoped only by user, or also by church, organization, or tenant?

Recommended outcome:

- Add a `Product Mode And Release Scope` section to `spec.md`.
- Explicitly identify v1 behavior and deferred behavior.
- Separate local-only behavior from authenticated/shared behavior.

### SR-002: Use Stable Resource Identity For Storage

Status: Open

Display names are currently used in project paths and PDF paths, but project
names are only unique inside a user's namespace and shared projects may collide.

Relevant spec areas: `Project Files`, `Users, Ownership, And Sharing`,
`Persistence And Build`.

Questions:

- Should persisted JSON contain resource ids, or should ids live only in the
  authorization/resource database?
- Should folders and generated artifacts be keyed by resource id instead of
  display name?
- What is the required behavior for rename, duplicate, archive, delete, and
  restore?

Recommended outcome:

- Add a `Resource Identity And Storage` section.
- Require stable resource ids for storage paths, preview artifacts, PDFs, and
  URLs.
- Treat display names as mutable metadata only.

### SR-003: Define Viewer, Editor, And Owner Behavior

Status: Open

Viewer access conflicts with immediate inspector edits and autosave behavior.

Relevant spec areas: `Users, Ownership, And Sharing`, `Selection And Inspector`.

Questions:

- Can Viewers build, preview, or download PDFs?
- Can Viewers make temporary local edits that are never saved?
- Should Viewers be prompted to duplicate the resource before editing?
- Can Editors share resources, or only Owners?
- Can there be multiple Owners?
- Can ownership be transferred?

Recommended outcome:

- Add a permission matrix for list, open, edit, save, duplicate, delete, share,
  build, preview, download, export, and create-from-template.
- Define read-only editor UI behavior for Viewer resources.
- Define ownership transfer separately from access grants.

### SR-004: Define Sharing Dependency Rules

Status: Open

Projects can reference private assets or templates. The current spec says to
warn before sharing, but the resulting behavior is not deterministic.

Relevant spec areas: `Users, Ownership, And Sharing`, `Assets`, `Custom Elements
And Bindings`.

Questions:

- When a shared project references a private asset, should sharing be blocked?
- Should the app offer to share required assets automatically?
- Should recipients see missing-asset placeholders for inaccessible assets?
- Should shared-template use create an independent copy or keep a live reference?

Recommended outcome:

- Add a `Sharing Dependency Rules` section.
- Require build and preview authorization checks against the project and every
  referenced asset/template at execution time.
- Make dependency sharing deterministic: block, explicitly share dependencies,
  or allow broken placeholders.

### SR-005: Define The Persistence Contract

Status: Open

JSON is described as canonical, but versioning, normalization, migration, and
generated-file consistency are not fully specified.

Relevant spec areas: `Document Model`, `Validation Expectations`, `Persistence
And Build`.

Questions:

- Should opening an older document rewrite it immediately, or only on explicit
  save?
- Should unknown fields in future-version documents be preserved, stripped, or
  cause load failure?
- Which validation failures are hard errors, warnings, safe migrations, or
  default-fill cases?

Recommended outcome:

- Add a `Persistence Contract` section.
- Define JSON as canonical and Typst/PDF as derived artifacts.
- Require atomic saves and stale-derived-file handling.
- Define migration ordering, idempotency, forward-version rejection, and
  non-lossy migration expectations.

### SR-006: Canonicalize Lengths And Units

Status: Open

Persisted plain numbers are editor pixels, but inspector plain numbers in many
fields mean inches. This needs one clear rule.

Relevant spec areas: `Document Model`, `Lengths And Units`, `Page Model`.

Questions:

- Should dimensions entered as inches be persisted as explicit strings such as
  `"1in"`, or converted to editor pixels?
- Should `page.width` and `page.height` be derived from Typst page size, or can
  they diverge?
- Which fields allow `%`, `em`, `fr`, and `auto`?

Recommended outcome:

- Add a per-field unit allowance matrix.
- Define one canonical persisted representation.
- Define which page size representation wins if editor and Typst sizes disagree.

### SR-007: Resolve Image Asset References

Status: Open

The image element model uses `data.path`, while the asset model says project JSON
should reference UUID-backed managed assets.

Relevant spec areas: `Image`, `Assets`.

Questions:

- Should the canonical image field be `assetRef`, `assetUri`, or something else?
- How long should legacy `assets/...` paths remain valid?
- How should missing, revoked, or inaccessible assets render in the editor and
  PDF?

Recommended outcome:

- Replace canonical image `data.path` with a managed asset reference.
- Treat filesystem paths as migration-only input or system asset references.
- Define missing-asset and broken-permission behavior.

### SR-008: Define Pagination And Overflow Rules

Status: Open

The spec does not fully define what happens when text, images, grids, stacks, or
canvases exceed available page space.

Relevant spec areas: `Page Model`, `Element Types`, `Flow Layout`, `Page View`.

Questions:

- Should top-level elements stay together or split across pages?
- What happens when an element is taller than the page content area?
- Should text boxes split across pages?
- Is PDF preview the authoritative layout when editor measurement differs?

Recommended outcome:

- Add a `Pagination And Overflow Rules` section.
- Define behavior for oversized breakable and unbreakable elements.
- Define whether margin spacing is suppressed or preserved at page boundaries.
- Define editor/PDF parity tolerances and the source of truth.

### SR-009: Specify Container Layout Semantics

Status: Open

Grid, stack, and canvas behavior needs more precise rendering rules.

Relevant spec areas: `Grid`, `Stack`, `Canvas`.

Questions:

- Are grids equal-width/equal-height tracks, content-sized tracks, or configurable
  tracks?
- How should duplicate grid children in the same cell be handled?
- Should canvas children be clipped, clamped, or allowed to overflow?
- Should canvas children be clamped to canvas height or page content height?

Recommended outcome:

- Define grid track sizing, gap math, empty cells, collisions, and overflow.
- Define horizontal stack gap accounting, child width overrides, and overflow.
- Define canvas origin, z-order, clipping, padding interaction, auto-height, and
  child clamping.

### SR-010: Define Template And Custom Element Lifecycle

Status: Open

Templates, custom element schemas, element-level `schema`, and bindings are not
yet clearly separated.

Relevant spec areas: `Document Model`, `Custom Elements And Bindings`.

Questions:

- Are templates copied into bulletins or live-linked?
- Are custom elements reusable schema definitions, instantiated element types, or
  both?
- How are custom element field values stored?
- What happens when a source template or custom element schema changes?

Recommended outcome:

- Add a `Template And Custom Element Lifecycle` section.
- Define copy-on-create versus live reference behavior.
- Define version pinning, update behavior, and broken-reference behavior.

### SR-011: Add Autosave, Build, And Preview Reliability Rules

Status: Open

Autosave and live preview are central workflows but lack detailed reliability and
failure behavior.

Relevant spec areas: `Selection And Inspector`, `Persistence And Build`.

Questions:

- Should autosave be authoritative, or should users explicitly save before final
  build/publication?
- What happens when live preview fails but JSON autosave succeeds?
- What build time is acceptable for launch?
- What are the maximum project size, element count, and asset size targets?

Recommended outcome:

- Add an `Autosave, Build Queue, And Recovery` section.
- Define debounce timing, dirty/saved indicators, retry behavior, and save
  failure recovery.
- Define build IDs, stale preview rejection, cancellation of obsolete builds,
  manual build priority, timeouts, diagnostics, and partial-output cleanup.

### SR-012: Define Security Boundaries For PDFs, Previews, Assets, And Typst

Status: Open

Generated artifacts and asset access must be authorization-checked and safe from
path traversal or unintended file exposure.

Relevant spec areas: `Users, Ownership, And Sharing`, `Persistence And Build`,
`Assets`.

Questions:

- Should PDFs and previews ever be served as static files, or only through
  authenticated endpoints?
- What should happen to existing preview/PDF URLs immediately after access is
  revoked?
- Are SVG uploads allowed?

Recommended outcome:

- Require authenticated, authorized delivery for PDFs and live previews.
- Scope previews by user, session, and resource id with non-guessable names.
- Require canonical path validation, symlink escape rejection, upload type/size
  limits, MIME sniffing, and safe SVG policy.
- Restrict Typst compilation to authorized generated source, assets, and fonts.

### SR-013: Add Accessibility Requirements

Status: Open

The spec relies heavily on drag-and-drop and visual feedback, but does not define
complete accessibility behavior.

Relevant spec areas: `Drag And Drop`, `Selection And Inspector`, `Style Model`,
`Image`.

Questions:

- Should the app target WCAG 2.1 AA, WCAG 2.2 AA, or another standard?
- Must every drag/drop operation have a keyboard-only equivalent for launch?
- Are generated PDFs expected to be accessible/tagged?
- Should image alt text be required, optional, or required unless decorative?

Recommended outcome:

- Add an `Accessibility Requirements` section.
- Require keyboard equivalents for pointer workflows.
- Define focus order, visible focus, screen-reader labels, shortcut conflicts,
  contrast thresholds, and reduced-motion behavior.
- Define editor accessibility separately from PDF accessibility.

### SR-014: Add Print And Export Workflows

Status: Open

The spec focuses on PDF generation but does not define practical publication and
printing workflows.

Relevant spec areas: `Goals`, `Page Model`, `Persistence And Build`.

Questions:

- Is folded or booklet bulletin printing required?
- Is `7in` by `8.5in` the final physical page size or one preset among many?
- Are bleed, print-safe margins, crop marks, or imposition required?
- What should exported files be named?

Recommended outcome:

- Add a `Print And Export Workflows` section.
- Define page presets, final PDF naming, booklet/folded output if needed, and
  publication approval flow.

### SR-015: Add Error States And Supportability

Status: Open

The spec names many operations but does not define user-facing error recovery or
diagnostics.

Relevant spec areas: `Validation Expectations`, `Persistence And Build`,
`Assets`, `Users, Ownership, And Sharing`.

Questions:

- What error detail should be shown to non-technical users?
- Should users be able to export a diagnostic bundle?
- Where should build logs and autosave errors be visible?

Recommended outcome:

- Add an `Error Messages And Support` section.
- Define handling for corrupt JSON, failed migration, validation failure, denied
  access, missing asset, missing Typst CLI, missing fonts, compile timeout, disk
  full, permission denied, and failed upload.
- Require actionable errors, stable error codes, and copyable diagnostics.

### SR-016: Define Concurrency And Conflict Behavior

Status: Open

Authenticated sharing implies possible simultaneous access, but conflict behavior
is not defined.

Relevant spec areas: `Users, Ownership, And Sharing`, `Persistence And Build`,
`Undo And Redo`.

Questions:

- Is simultaneous multi-user editing in scope?
- Should the app use locking, optimistic concurrency, or last-writer-wins?
- What should happen when access is revoked while a project is open?

Recommended outcome:

- Add a `Concurrency` section.
- Require resource versions or ETags.
- Define stale-save detection, conflict UX, and revocation behavior for open
  editors, queued builds, previews, and cached PDFs.

## Additional Product Workflow Questions

- Who is the primary user: pastor, church secretary, designer, volunteer, or
  multiple roles?
- Are bulletins usually created from scratch, from last week's bulletin, or from
  formal templates?
- Do users need rich text editing, headings, lists, scripture formatting, and
  inline bold/italic?
- Should designs be allowed to place backgrounds, page numbers, headers,
  footers, or decorative elements in margins?
- Should margin rendering be forbidden for all elements, or should there be
  explicit page-level elements that may render outside the content box?
- Should users have an approval/finalization step before publishing the PDF?

## Proposed Next Step

Address the open items in priority order, starting with product mode, resource
identity, permissions, persistence, and layout overflow. After those decisions
are made, update `spec.md` with normative requirements and remove ambiguity from
the implementation path.
