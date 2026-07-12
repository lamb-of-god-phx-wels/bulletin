# Church Bulletin Builder Implementation Plan

## Summary

Build the application as a strict TypeScript monorepo with an Electron shell,
sandboxed React renderer, runtime-agnostic domain packages, privileged
main-process services, and isolated workers. Delivery is split into an initial
supported v1 and explicitly staged follow-up waves.

Each milestone must leave the repository buildable and tested. Persisted formats
are implemented schema-first, and untrusted import functionality cannot ship
without its complete quarantine and transaction controls.

## Implementation Phases

1. **Repository and contract foundation**
   - Establish the `app/core`, `app/services`, `app/workers`, `app/ui`,
     `app/shell`, `app/schemas`, `app/starters`, and `app/test` boundaries with
     strict TypeScript and enforced dependency rules.
   - Refactor legacy schemas into the complete Draft 2020-12 `schema/v1`
     catalog defined by the spec, with stable offline `$id` resolution.
   - Implement branded identity types, RFC 8785 canonicalization, SHA-256
     wrappers, field classification, schema validation, normalization, and
     ordered idempotent migrations.
   - Add CI gates for type checking, schema references, field classification,
     forbidden core dependencies, deterministic fixtures, accessibility
     checks, and platform packaging smoke tests.

2. **Deterministic document and rendering core**
   - Implement exact rational geometry, page setup, rich-text ASTs, elements
     and containers, field contracts and bindings, conditional/repeatable
     rules, custom elements, and accessibility semantics.
   - Build the single resolution pipeline in the required order: field
     substitution, conditional exclusion, repeat expansion, then
     custom-element expansion.
   - Derive render projections, revision/render/readiness hashes, rights
     projections, and structured diagnostics from normalized state.
   - Implement deterministic Typst emission with leaf-level escaping, fixed
     rounding, source maps, controlled fonts/assets, and no raw Typst
     passthrough.
   - Validate the core with cross-platform golden documents, schema round
     trips, expansion limits, exact-arithmetic cases, and repeated-build
     determinism tests.

3. **Workspace, persistence, and trusted build spine**
   - Implement workspace creation/onboarding, registry and settings storage,
     Church Profile storage, locking/heartbeat, serialized resource writers,
     atomic saves, autosave, recovery snapshots, conflict capture, and
     read-only fallback.
   - Implement journaled multi-resource transactions and deterministic startup
     recovery before documents can open.
   - Add immutable asset/font revisions, portable-reference resolvers, bounded
     quarantine workers, and the retention graph used by history, Trash,
     artifacts, and backup.
   - Implement the prioritized build queue, isolated pinned Typst runner,
     preview supersession, immutable artifact records, hash verification,
     timeouts, and cleanup.
   - Add fault-injection coverage for every durable state transition, including
     interrupted renames, journal replay, stale locks, failed recovery, and
     save conflicts.

4. **Editor and template authoring**
   - Build the accessible application shell, design system, document library,
     first-run flow, generic starter templates, settings, offline help, and
     stable task-language catalog.
   - Implement the immutable command store and patch-based undo/redo, with
     command capability checks shared by `Weekly Content` and
     `Customize Layout`.
   - Deliver Page and Contiguous views, faithful grid/stack/canvas rendering,
     shared pagination rules, direct rich-text editing, structure/layers
     navigation, inspector edit buffers, strong validation, drag/drop parity
     commands, snapping, margin guides, resize, and image crop/focal-point
     editing.
   - Add pdf.js preview with page thumbnails, zoom, stale/build states, and
     selection-to-preview navigation through generator source maps.
   - Complete no-code template authoring: field contracts, locks, bindings,
     conditional and repeatable sections, custom elements, Saved Sections,
     and template lifecycle controls.

5. **Weekly workflow and v1 publication**
   - Implement Create This Week, optional compatible prior-bulletin rollover,
     canonical keep/replace/confirm decisions, weekly brief/checklist/resume
     state, stale-content detection, and protected proofreading.
   - Add Church Profile, immutable Song Library and Scripture catalog
     revisions, Saved Sections, offline Scripture paste normalization/review,
     provenance and attribution snapshots, hymn/song rights snapshots, and
     generated Copyrights & Permissions content based only on resolved output.
   - Implement draft/`printFinal` readiness evaluation, findings and permitted
     waivers, page-count constraints, manual and automatic review gates, and
     save-before-build behavior.
   - Implement reader-order export, deterministic two-up booklet composition,
     filename/collision policy, final hash-chain verification, and export-event
     records.
   - Complete cross-session history, Trash/restore, full-workspace
     backup/verification/restore, volunteer handoff, diagnostic bundle export,
     and recovery UX.
   - Run the spec's keyboard, screen-reader, volunteer-workflow, performance,
     offline, packaging, backup, booklet, and publication acceptance matrices
     before declaring v1 complete.

6. **Committed staged releases**
   - **Wave 1:** dependency-complete resource-pack import using the production
     quarantine/manifest/signature/transaction pipeline; file-based AI contract
     export, reviewed import, merge checks, and undoable application.
   - **Wave 2:** pack creation/export/update/replace; signed hosted Shared
     church library publishing and reviewed pull updates; authorized Scripture-
     provider integration; tagged `accessibleFinal` output and external
     validation; persisted approvals; isolated local AI-helper execution.
   - Ship no partial network importer, provider scraper, unrestricted helper,
     or reduced pack-validation path. Optional synchronized scrolling,
     alignment controls, and multi-selection remain outside committed delivery.

## Public Interfaces and Contracts

- Portable bulletin and template files use `document.schema.json`;
  workspace-local state never enters portable documents.
- Core packages expose pure typed functions for validation/migration,
  resolution, projection, hashing, Typst generation, rights generation,
  pagination semantics, and readiness evaluation.
- Filesystem, clocks, UUID generation, processes, credentials, and network
  access enter core logic only through injected service ports.
- Renderer/main communication uses a versioned, schema-validated IPC
  request/response/event contract. The renderer receives no Node, filesystem,
  network, process, or credential capability.
- All privileged mutations are service commands returning structured results
  and `CBB-*` diagnostics; long operations expose progress and cancellation
  where allowed.
- Build requests reference normalized content and resolved asset/font
  identities, never arbitrary paths. Network operations are closed,
  connection-scoped broker commands.
- Every persisted-field change must include its schema,
  normalization/migration, classification, UI editing path, relevant
  rendering/readiness behavior, and tests in the same change.

## Test and Release Gates

- Golden normalized JSON, projections, hashes, Typst, page counts, and relevant
  PDF evidence are stable across Windows and supported Linux targets.
- Migration tests cover every legacy schema plus newer-version read-only
  behavior.
- Model and fault-injection tests cover persistence, conflicts, transactions,
  recovery, build queues, history, Trash, and restore.
- Hostile fixtures and fuzzing cover JSON, archives, paths, SVG, raster, fonts,
  PDFs, clipboard input, and provider responses at exact and one-over resource
  limits.
- Automated WCAG checks run continuously; keyboard-only, NVDA/Narrator, and
  Orca task matrices gate releases.
- v1 acceptance requires normal weekly creation, review, build, export, backup,
  restore, and help to work with networking disabled.
- Signed Windows and Linux artifacts must verify bundled component hashes,
  preserve workspaces during update/uninstall, and handle unsupported
  downgrades safely.

## Assumptions and Defaults

- `spec.md` is authoritative for behavior and release scope;
  `architecture.md` controls implementation structure where it does not
  conflict.
- The current repository contains specifications and legacy schemas but no
  reusable application implementation.
- Initial v1 includes every `Required v1` item. "Required, may be staged,"
  deferred, and optional items follow the boundaries above.
- One local workspace is supported in v1; moving or managing multiple
  workspaces is deferred.
- The PDF is authoritative when editor pagination measurements differ.
- Exact dependency versions, tool hashes, signing identities, and provider
  credentials are pinned in release configuration rather than portable
  document data.
- Scripture-provider delivery remains disabled until an authorized agreement
  and compliant translation/rights contract exist.
