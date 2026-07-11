# Church Bulletin Builder Spec

This document is the source-of-truth behavior spec for the Typst Church Bulletin
Builder. It describes the JSON document model, editor behavior, and Typst/PDF
rendering rules the app should preserve as new features are added.

## Goals

The builder provides a completely offline, GUI-first desktop workflow for
creating church bulletins and reusable bulletin templates without hand-editing
Typst for normal layout work.

The builder must:

- Store all editable layout/content state in JSON.
- Generate Typst source deterministically from that JSON.
- Compile PDFs locally with a bundled Typst CLI and local workspace assets.
- Let non-technical users place and edit elements with predictable visual
  feedback.
- Support pastor, church secretary, and volunteer workflows without requiring
  technical layout or Typst knowledge.
- Optimize the normal weekly workflow around creating a bulletin from a reusable
  template.
- Keep the editor's page, margin, flow, and canvas behavior aligned with the
  rendered PDF wherever practical.
- Run entirely from local files with no network dependency or separately started
  service.
- Treat church-specific logos, images, templates, starter bulletins, and other
  reusable content as data that can be imported, exported, backed up, and moved
  independently of the application.
- Support AI-assisted content import by exposing machine-readable template data
  contracts and validating AI-generated data before applying it to a bulletin.

## Normative Language And Release Scope

The terms `must`, `should`, and `may` describe requirement strength:

- `must`: mandatory behavior for the feature's stated release scope.
- `should`: expected behavior for the feature's stated release scope. A deviation
  requires a documented reason and must not undermine a related `must`.
- `may`: optional behavior.

Release-scope labels:

- `Required v1`: required before the first supported v1 release.
- `Required, may be staged`: a committed product requirement that may ship after
  the initial v1 release or in a later v1 phase. Architecture should preserve a
  clear implementation path, but the feature is not an initial v1 release gate.
- `Deferred`: intentionally outside v1. Architecture should avoid preventing a
  later implementation, but v1 does not need to provide the feature.
- `Optional enhancement`: useful but not committed. It must not block a release
  or add architectural complexity unless implementation is justified separately.

Unless a requirement is explicitly assigned another release-scope label, it is
`Required v1`. A release-scope label changes delivery timing, not the intended
behavior once the feature is implemented.

Explicit release scope:

| Feature | Release scope |
| --- | --- |
| User settings panel | Required v1 |
| Margin guide visibility UI | Required v1 |
| Undo and redo | Required v1 |
| Canvas snapping | Required v1 |
| Strong inspector validation | Required v1 |
| Faithful grid/stack editor rendering | Required v1 |
| Rich text editing | Required v1 |
| Page-level margin elements | Required v1 |
| Folded/booklet workflow | Required v1 |
| Final page-count publication constraints | Required v1 |
| Resource pack import | Required v1 |
| Diagnostic bundle export | Required v1 |
| File-based AI contract import/export | Required v1 |
| AI-assisted template filling beyond file exchange | Required, may be staged after manual template workflows |
| Resource pack creation/export/update/replace | Required, may be staged |
| Tagged/accessible final PDFs | Required, may be staged |
| Approval/finalization workflow | Required, may be staged |
| Local AI helper launch/configuration | Required, may be staged; file exchange is sufficient for v1 |
| Multiple workspaces | Deferred |
| Moving workspaces from the UI | Deferred |
| Editor/PDF synchronized scrolling | Optional enhancement |
| Drag-to-resize | Optional enhancement |
| Element alignment controls | Optional enhancement |
| Multi-element selection and select all | Optional enhancement |

## Schema Organization, Versions, And Storage Boundaries

JSON Schema Draft 2020-12 is the schema language for persisted JSON contracts.
Schemas are distributed with the app under `schema/v1/`. The current schemas in
`schema/` should be treated as legacy draft material until they are refactored
into the v1 schema set below.

Schema ids must use a stable hierarchical URI convention so references can be
resolved by an app-owned local schema catalog without network access:

```text
https://church-bulletin-builder.local/schema/v1/<schema-name>.schema.json
```

The URI identifies the schema only; the app must not fetch schemas from the
network at runtime. Schema references must resolve through the bundled schema
catalog.

Required schema organization:

| Schema | Scope |
| --- | --- |
| `common.schema.json` | Shared ids, versions, lengths, colors, style primitives, hashes, timestamps, field contracts, bindings, and portable reference primitives. |
| `document.schema.json` | Authoritative portable document root for both `bulletin` and `template` documents. |
| `element.schema.json` | Recursive discriminated union for all normal visual elements and container child wrappers. |
| `richText.schema.json` | Structured rich-text AST used by text fields and rich-text template fields. |
| `customElement.schema.json` | Reusable custom element definitions and custom element instance metadata, reusing `element.schema.json`. |
| `ai-exchange.schema.json` | File-based AI template contracts and AI import results. |
| `manifest.schema.json` | Resource pack, project bundle, and template bundle manifests. |
| `workspace.schema.json` | Workspace-local registry, resource records, revision state, import provenance, conflict state, and installed pack state. |
| `asset-record.schema.json` | Workspace-local asset metadata, binary revision, media details, sanitization state, and AI visibility. |
| `font-record.schema.json` | Workspace-local managed font family/face metadata, immutable hashes, validation, licensing, and portability state. |
| `settings.schema.json` | Discriminated versioned application-global and workspace editor/export preferences. |
| `artifact-record.schema.json` | Build records, generated Typst/PDF records, diagnostics references, stale state, and approval references. |
| `diagnostic-catalog.schema.json` | Bundled versioned stable diagnostic-code meanings, default severity/disposition, locations, recovery actions, and redaction class. |

`common.schema.json` must define separate, non-interchangeable primitives for
local resource ids, portable asset/font ids and typed references, bundle ids,
bundle entry ids, pack ids, pack-scoped content ids, field-contract ids, document
element ids, and AI exchange ids. Portable schemas must not reference the
local-resource-id primitive. `workspace.schema.json` and
`asset-record.schema.json` must define the
portable-asset-id resolver and local import/provenance maps;
`manifest.schema.json` must define archive entry identity and portable asset
maps. A single generic `identifier` definition must not erase these boundaries.

`document.schema.json` is the authoritative root for portable bulletin and
template JSON. `template.schema.json`, if retained, is a legacy compatibility
schema or wrapper and must not define a divergent root model.

Portable document JSON may contain only data needed to preserve and render the
bulletin/template in another workspace:

- Document schema version, kind, display name, and explicitly portable document
  metadata.
- Page setup and output-affecting document settings.
- Normal body flow elements and page-level elements.
- Template field contracts and bulletin field values.
- Custom element definitions, custom element instance metadata, and bindings.
- Portable asset references and other portable references defined by schema.
- Accessibility semantics that affect final PDF output.

Portable document JSON must not contain:

- Workspace-local resource ids.
- Absolute filesystem paths.
- Local asset storage paths.
- Workspace locks, conflict state, revision tokens, or recovery records.
- User editor preferences.
- Generated Typst, PDFs, thumbnails, diagnostics, build logs, or preview state.
- Installed resource-pack state or local import/update state.
- Local AI helper configuration or private execution logs.

Workspace-local metadata owns local identity, storage, privacy, operational state,
and derived artifacts. It should include:

- Workspace schema version and workspace id.
- Local resource records for bulletins, templates, assets, fonts, resource
  packs, reusable schemas, AI exchanges, and generated artifacts.
- Relative storage paths for app-managed resources.
- Display metadata used by lists, search, sorting, and disambiguation.
- Created, imported, modified, and last-opened timestamps.
- Content hashes, revision tokens, and stale-state metadata.
- Asset binary metadata, dimensions, media type, source provenance, sanitization
  state, and AI visibility.
- Import provenance, bundle/resource-pack remapping tables, and installed pack
  state.
- Workspace locks, file conflict records, transaction/recovery records, and
  conflict backup references.
- Build records, generated artifact records, diagnostics references, finalization
  records, and approved artifact references.
- User/workspace editor settings.

Versioning rules:

- Every persisted root JSON file must include an integer `version` field.
- Each root schema owns its own version sequence. Document, workspace, settings,
  asset record, font record, artifact record, manifest, custom element, and AI
  exchange versions are independent.
- Version `1` is the first version governed by this spec.
- Compatible changes that can be default-filled without changing meaning may be
  handled by normalization within the same version.
- Changes that alter persisted meaning, required fields, reference semantics,
  validation behavior, or rendering output must increment the affected root
  version.
- Migrations are ordered by root type and version. They run in memory on open or
  import and are written only at the next approved persistence point.
- Unknown fields from newer versions may be preserved only in explicitly inert
  preservation locations or sidecars defined by the relevant schema. Unknown
  fields must never affect rendering, file access, Typst generation, AI export,
  import trust decisions, or build/finalization state unless the app version
  explicitly understands them.

JSON Schema validation checks structural shape, primitive types, field presence,
enum values, and local field constraints. Semantic validation is a separate app
layer and must enforce cross-record and cross-tree rules such as document-global
element id uniqueness, valid bindings, valid page targets, one child per grid
cell or stack index, asset-reference resolution, import remapping, stale artifact
calculation, and finalization readiness.

## Primary Bulletin Workflow

The primary users are pastors, church secretaries, and volunteers. The app should
assume users may be familiar with the bulletin content but not with document
layout systems, Typst, JSON, or local workspace internals.

The ideal weekly workflow is template-driven:

- Choose a reusable bulletin template.
- Fill date-specific, service-specific, and congregation-specific fields.
- Edit body content such as hymns, readings, announcements, prayers, and notes.
- Review the generated PDF preview.
- Run final validation/build.
- Approve/finalize the bulletin when the staged approval workflow is available.
- Export the final PDF for printing or distribution.

Creating a bulletin from scratch, duplicating a prior bulletin, and importing a
starter bulletin may be supported, but they are secondary workflows. Formal
templates and resource packs should provide the default starting point for weekly
bulletin creation.

## Document Library And Weekly Creation

The home/library view lists bulletins and templates by local resource identity.
Each row/card shows display name, kind, publication date when available,
draft/readiness/approval state, modified time, source/provenance, and missing or
conflict state. A missing/corrupt registry entry remains visible with recovery,
diagnostics, and confirmed removal actions; it is never silently dropped.

Baseline library actions are open/resume setup, duplicate, rename, delete with
confirmation, import, and eligible export. Recent documents contain the ten most
recently opened distinct local resource ids, newest first; missing registry ids
are pruned. Opening updates workspace-local `lastOpenedAt` without mutating
portable document JSON.

Search indexes display name, description, tags, kind, publication-date text, and
source-pack/publisher display names. Body full-text search is not required v1.
Index/query text uses Unicode NFKC plus default case folding; whitespace-separated
query tokens must each match a substring of at least one indexed field. Results
remain keyed by local id even when names are identical.

Required filters cover kind, `draft`/`active` workflow state, `incomplete`/`ready`
readiness state, current/stale/unfinalized approval when available,
personal/imported/pack source, publication-date range, and
missing-dependency/readiness state. Sorts include last opened, modified, created,
publication date, and normalized name in useful directions. Bulletin default is
last-opened descending. Template chooser default is source group then normalized
name. Ties resolve by normalized name, created time, then local resource id,
independent of filesystem enumeration.

Workflow and readiness are separate workspace-record enums. `workflowState` is
`draft` until the initial setup is completed once, then `active`; it does not
return to draft. `readinessState` is derived as `incomplete` or `ready` from the
current contract, dependencies, and configured output requirements. Thus
clearing a required value or violating a final page-count requirement on an
active bulletin yields `active` plus `incomplete` and stales approval.
For that requirement, readiness is `ready` only when the newest current verified
preview or manual artifact count satisfies it; a missing or stale count remains
`incomplete` pending pagination.

Missing/null sort values always follow non-null values in either direction.
Template source groups order personal/imported first, then packs by normalized
pack name, normalized publisher, and `packId`; entries use the stable tie-breakers
above.

Duplicate display names remain legal. Rows add kind, source group,
publication/modified time, and provenance; if still indistinguishable, they show
a short local-id suffix only as secondary support metadata. Accessible row labels
include the same disambiguators.

The template chooser groups personal/imported templates separately from each
installed pack. Pack headers show pack name, claimed publisher, version, and
trust state. Cards show description, logical page/panel size, modified date,
required-field count, compatibility problems, and preview when available.
Incompatible templates are disabled with a reason. Bulletins based on a pack can
be filtered by that provenance but are not live pack-managed children.

Weekly creation is transactional:

1. `New Bulletin` opens the template chooser; blank, duplicate, and import are
   visible secondary actions.
2. Choosing a template allocates a local bulletin id, copies normalized portable
   content/contract/bindings, records source contract/document hashes and pack
   provenance, and commits a `draft` before the field form opens.
3. The field form follows contract group/order metadata, uses type-appropriate
   controls/defaults, and validates on field commit, step transition, and review.
4. Users may save/close or enter the editor with required fields missing. The
   workspace resource record stores the current setup step so reopen resumes it.
5. Missing/invalid required values remain visible, allow autosave and preview,
   and block `finalCandidate`, finalization, and final export.
6. Completing initial setup changes workflow state to `active`; clearing a
   required value later keeps it active but changes readiness to `incomplete` and
   stales any approval.

The copied bulletin has no live source-template link or source local resource id.
Bound edits update authoritative field values or use explicit Detach Binding.
AI values remain proposals until reviewed. Autosave, conflict, undo, and preview
semantics are identical to ordinary editor changes, including across restart.

## Offline Application And Workspace

The builder is a packaged desktop application for Windows and Linux, including
Arch Linux. A non-technical user should install it once and launch it from a
normal desktop, Start Menu, or app-launcher shortcut.

Distribution formats:

- Windows: signed `.msi` installer.
- Linux: AppImage, `.deb`, AUR package, and native pacman package.

The application bundle includes the editor runtime, pinned Typst executable,
bundled Noto fonts/licenses, JSON schemas, migration logic, generic app resources,
and the pinned PDF/UA validator when accessible output ships. The signed release
manifest records their versions/hashes and startup self-check reports missing or
changed required components. The application bundle must not
include church-specific logos, images, templates, starter bulletins, or other
organization-specific content. Church-specific content is imported as resource
packs or created by the user in the application.

On first launch, the app should offer to create a local workspace in the
system-default user data location or let the user choose a different workspace
location. If the user accepts the default, the app creates the workspace without
requiring direct file-system interaction.

V1 supports one configured workspace at a time. The user may choose its location
during first launch, but multiple-workspace management and moving an existing
workspace from the UI are deferred. When those deferred features are implemented,
the app should support multiple registered workspaces with one active workspace,
and should update its workspace registry only after a requested move succeeds.

Default workspace locations:

- Windows: `%APPDATA%/Church Bulletin Builder/`.
- Linux: `${XDG_DATA_HOME:-~/.local/share}/church-bulletin-builder/`.

The workspace is app-managed data. It may be hidden or stored in a location that
users do not normally browse. Normal interaction with bulletins, templates,
assets, PDFs, resource packs, and exports should happen through the
application UI.

The app does not need a dedicated full-workspace backup and restore command.
Project/template export and import plus resource pack import are the v1 app-level
transfer and backup mechanisms. Resource pack creation/export becomes an
additional transfer mechanism when that committed staged feature is implemented.

Only local workspace data is in scope. The operating system account and
file-system permissions are the access boundary for workspace data.

### Security Threat Model

Security goals are to preserve document/workspace integrity, avoid unintended
disclosure of local content or credentials, keep imported content from escaping
approved roots or executing code, and remain available under malformed or
resource-exhausting local input. The app is offline: normal editing, import,
build, validation, and help must make no network request. External links are
never fetched automatically.

Trusted computing components are limited to the installed/signed app code, its
bundled schema catalog, pinned Typst and any included validator binaries, bundled
fonts, and OS security primitives after their package hashes/signatures pass
startup or install verification. User confirmation expresses intent but does
not make malformed content safe.

Untrusted input includes every project/bundle/pack/AI file, archive name/path,
JSON string, Markdown/readme, SVG/raster image, font, imported PDF/Typst
diagnostic, clipboard payload, filename, metadata field, diagnostic attachment,
and helper output received outside the installed app. It remains untrusted after
signature verification; signatures establish publisher continuity, not safety.

The OS user account and filesystem permissions are the confidentiality boundary.
A malicious process already running as the same user is outside the protection
the app can guarantee: it may read or change workspace files. Locks, hashes,
revision checks, and conflict backups detect or limit accidental/concurrent
changes but are not claimed as a sandbox against that attacker. Workspace-at-rest
encryption is not provided by this specification; users rely on OS/device
encryption when required.

Untrusted content is parsed with bounded depth/size in quarantine and fails
closed before becoming visible workspace state. Validation errors, parser
crashes, timeouts, or unsupported constructs must not fall back to permissive
rendering. Imported bytes never choose executable paths, command arguments,
filesystem roots, schema locations, or output destinations.

Complex archive, SVG, raster, PDF, and font parsing runs in a restricted
no-network worker with access only to the input handle and bounded output area.
A worker crash/timeout or unavailable required isolation rejects the item; the
app must not retry it through an unrestricted parser.

Content-specific policy:

- Archives reject traversal, link/device entries, encrypted/unsupported entries,
  duplicate normalized paths, unsafe compression ratios, trailing hidden data
  that violates the format, and entries absent from the validated manifest.
- SVG rejects scripts, event handlers, animation, `foreignObject`, external or
  network/file references, embedded active content, and unbounded filters/path
  complexity. Preview/build uses a sanitized derivative or bounded rasterization,
  never browser document execution.
- Fonts are parsed and shaped as untrusted binary input under resource limits in
  the required isolated worker. Invalid tables, unsupported containers, missing
  isolation, and fonts Typst cannot load are rejected before installation.
- Imported PDFs are diagnostic/visual input only. JavaScript, forms, actions,
  attachments, launch/file/network references, and embedded media are never
  executed. Preview uses a bounded trusted renderer. Before a PDF may become a
  build asset, that worker produces and verifies a flattened action-free
  re-rendered PDF or bounded raster derivative; Typst never receives the original
  imported bytes. The derivative is one visual figure and source tags are not
  trusted.
- Generated Typst comes only from the validated app model and escaped values.
  Raw imported Typst is never compiled as canonical document source. The CLI runs
  with an app-controlled root, bounded environment/resources, and no network.
- Readmes render a safe Markdown subset: paragraphs, headings, emphasis, code,
  and lists. Raw HTML, images, embedded media, automatic URL fetching, file/shell
  links, and executable extensions are disabled. Opening an allowed external URL
  requires a visible user action and warning.
- UI text is rendered as text, length-limited, and never interpreted as HTML,
  terminal escapes, format strings, or commands. Dangerous control/bidi
  characters are rejected or visibly represented in security-sensitive names.

Logs and diagnostic bundles apply the redaction contract under `Error Messages
And Support`. Secrets, environment values, arbitrary absolute paths, private
content, and helper prompts/output are excluded by default. Security validation
must itself be offline and deterministic.

### Packaging And Release Acceptance

The required v1 CPU/OS baseline is x86-64 Windows 11, Ubuntu 24.04 LTS, Debian
12, and Arch Linux. AppImage is tested on all supported Linux baselines; `.deb`
is tested on Ubuntu/Debian; native pacman and AUR flows are tested on a recorded
current Arch snapshot. ARM packages are optional. Each release records exact QA
OS images/snapshots.

Windows acceptance:

- The `.msi` and any offline update payload are Authenticode-signed by the
  project publisher and timestamped. Invalid, altered, or wrong-publisher
  packages are rejected before installation.
- Install/upgrade creates a normal Start Menu entry, correct icon, uninstall
  registration, and optional desktop shortcut without requiring a terminal.
- A clean or per-user install must not require separate Node, Typst, font,
  schema, Java, or runtime downloads.

Linux acceptance:

- Every AppImage, `.deb`, and pacman release appears in a SHA-256 release
  manifest with a detached project signature. Pacman package/repository metadata
  is signed.
- The AUR recipe pins and verifies the signed upstream source/artifact and exact
  checksum; it must not execute unpinned network-fetched build code.
- AppImage launches without root after being made executable and ships valid
  desktop/icon metadata. Optional desktop integration requires user action and
  the AppImage never self-modifies.
- `.deb`/pacman install and uninstall update desktop/MIME caches correctly. The
  app may associate `.pak`, but must not claim the generic `.zip` type.

On a supported clean system with networking disabled after acquisition, every
package must launch, create/select a workspace, verify bundled schemas/fonts/
Typst and the validator when the accessible-output stage is included, create a
bulletin, and build a PDF. The smoke workflow covers
paths containing spaces and non-ASCII characters. About/diagnostics reports app,
schema-set, Typst, bundled-font-set, and included validator versions/hashes.

The application has no required in-app network updater. MSI/package-manager
updates use verified offline packages; AppImage updates are manual side-by-side.
Upgrade acceptance covers the immediately previous supported app release and the
oldest directly migratable workspace version. Install/update failure leaves the
previous application runnable or prior AppImage available.

Installers never migrate workspace content. First launch after update performs
any workspace migration through the journaled recovery contract. Failure leaves
the pre-migration workspace unchanged and provides recovery/reinstall guidance.
Downgrades do not silently rewrite or down-migrate a newer workspace; an
incompatible older app opens it read-only or refuses with a clear version error.

Default uninstall removes application binaries, recreatable caches, shortcuts,
and registrations while preserving workspaces, settings containing user choices,
and exports. Removing application data is a separate explicit action showing the
exact path. A custom external workspace is never deleted merely because the app
is uninstalled. Acquisition/AUR builds may require network access; installed app
runtime, validation, and PDF generation may not.

## Project Files

Projects are disk-backed folders inside the local workspace. Storage paths use
app-generated stable local resource ids, not editable display names. Portable
document JSON and workspace-local metadata are stored separately.

Workspace layout:

```text
<workspace>/
  .workspace.lock
  workspace.json
  settings.json
  bulletins/<local-resource-id>/document.json
  templates/<local-resource-id>/template.json
  assets/<local-resource-id>/asset.json
  assets/<local-resource-id>/original
  assets/<local-resource-id>/derived/
  fonts/<local-resource-id>/font.json
  fonts/<local-resource-id>/faces/<face-id>
  resource-packs/<local-resource-id>/pack.json
  artifacts/<local-resource-id>/<build-id>.json
  artifacts/<local-resource-id>/<build-id>.typ
  artifacts/<local-resource-id>/<build-id>.pdf
  preview/
  ai-exchange/
  transactions/
  conflicts/
```

Workspace file roles:

- `workspace.json` is the authoritative workspace-local registry and resource
  metadata file governed by `workspace.schema.json`.
- `.workspace.lock` is the exclusive editing lock described by the recovery
  state machine; it is not portable content.
- `settings.json` stores user/workspace editor preferences governed by
  `settings.schema.json`.
- `bulletins/<local-resource-id>/document.json` and
  `templates/<local-resource-id>/template.json` are portable document files
  governed by `document.schema.json`.
- `assets/<local-resource-id>/asset.json` stores workspace-local asset metadata
  governed by `asset-record.schema.json`.
- `assets/<local-resource-id>/original` stores the original imported asset binary
  after validation. Sanitized/rasterized/generated derivatives live under
  `assets/<local-resource-id>/derived/`.
- `fonts/<local-resource-id>/font.json` and `faces/` store one managed immutable
  font-family revision and its validated face binaries under
  `font-record.schema.json`.
- `resource-packs/<local-resource-id>/pack.json` stores workspace-local installed
  pack metadata and import provenance governed by `workspace.schema.json` or a
  `$defs` record referenced by it.
- `artifacts/<local-resource-id>/<build-id>.json` stores the build/artifact record
  governed by `artifact-record.schema.json`.
- `artifacts/<local-resource-id>/<build-id>.typ` and `.pdf` are derived outputs
  tied to the artifact record.
- `preview/` stores temporary live-preview outputs and may be cleaned during app
  startup.
- `ai-exchange/` stores owner-only bounded helper exchange/run state and may not
  expose the rest of the workspace to a helper.
- `transactions/` stores import/save/update transaction journals needed for
  rollback or startup recovery.
- `conflicts/` stores conflict backups created during stale-save, external-file,
  or recovery flows.

Generated Typst and PDFs are derived artifacts. They must be associated with an
artifact record rather than treated as standalone source-of-truth project files.

Project names may contain only letters, numbers, spaces, underscores, and
hyphens, with a maximum length of 64 characters.

Project names are user-facing display labels. They do not determine storage
identity and do not need to be globally unique. If duplicate names exist, the UI
should disambiguate them with metadata such as kind, last modified time, source
resource pack, or containing folder.

## Resource Identity

Every workspace-managed resource has a stable local resource id. Local resource
ids are used for workspace storage paths, generated artifacts, local references,
and workspace metadata. They are not user-facing names and are never portable
document identity.

Workspace-managed resources include:

- Bulletin projects.
- Template projects.
- Managed assets.
- Imported resource packs.
- Custom element schemas and other reusable library entries when they are stored
  independently.

Identity classes must not be substituted for one another:

| Identity class | Scope and meaning | Persisted location |
| --- | --- | --- |
| Workspace id | App-generated UUIDv4 identifying one workspace. A true workspace move preserves it; importing resources does not copy it into documents. | Workspace metadata and bounded provenance only. |
| Local resource id | App-generated UUIDv4 unique within one workspace. Identifies a bulletin, template, asset record, installed pack, or other managed local resource. | Workspace metadata and workspace storage paths only. |
| Portable asset id | App- or pack-author-generated UUIDv4 identifying one immutable asset binary revision. Its canonical reference form is `asset:<uuid>`. It is not a workspace resource id. | Portable documents, archive manifests, AI asset catalogs, and the workspace asset resolver. |
| Portable font id | App- or pack-author-generated UUIDv4 identifying one immutable managed font-family revision. Its canonical reference form is `font:<uuid>`. | Portable style/font dependencies, archive manifests, and the workspace font resolver. |
| Bundle id | UUIDv4 identifying one exported project/template bundle instance for validation and provenance. It is not an update identity. | Bundle manifest and local import provenance. |
| Bundle entry id | UUIDv4 unique within one bundle manifest. Identifies an archive entry independently of its path or display name. | Bundle manifest and local import remap records only. |
| Resource pack id | Publisher-stable UUIDv4 identifying a pack across pack versions. | Pack manifest and installed-pack metadata. |
| Resource pack content id | Publisher-stable UUIDv4 unique within one pack. The pair `(packId, contentId)` identifies one logical pack item across pack versions. | Pack manifest and installed-pack provenance. |
| Field contract id | Portable UUIDv4 identifying one field-contract lineage across compatible contract versions. | Portable documents, custom definitions, and AI exchanges. |
| Document element id | Identifier for one visual element instance, scoped to a single document. It is not a resource, asset, pack-content, or manifest-entry id. | Portable document JSON. |
| AI exchange id | UUIDv4 identifying one exported AI contract/import exchange and its local target-resolution record. | AI exchange JSON and workspace-local exchange metadata. |

UUID-valued identities must use the canonical lowercase hyphenated UUID text
form. Newly minted v1 UUID identities use random UUIDv4 values. All ids are
opaque: filenames, display names, array positions, and content hashes must not be
parsed or used as substitutes for them. A SHA-256 digest identifies bytes for
integrity and revision comparison; it is not a local resource id or portable
asset id.

Local resource ids live in workspace metadata rather than inside portable
project or template JSON. This keeps document JSON portable and allows imported
projects, templates, and resource packs to receive new local ids without routine
document rewrites. Export manifests may include source local resource ids as
optional provenance, but import must treat them as informational, must never use
them as destination storage ids, and must assign a new local id when creating a
new local copy.

### Portable Asset Resolution

The UUID portion of `asset:<uuid>` is a portable asset id, not the local asset
resource id used in `assets/<local-resource-id>/`. A portable asset id identifies
exactly one immutable binary revision. Changing or replacing the bytes creates a
new portable asset id; editing display metadata does not.

The workspace asset resolver maps each portable asset id to a local asset
resource id and the verified SHA-256 digest of that binary. Asset records store
both identities. The `<local-resource-id>` segment in workspace paths is always
the local asset resource id. A renderer must resolve `data.assetRef` through this
map and must never interpolate its UUID directly into a filesystem path.

The same portable asset id may be referenced by many elements and documents. A
duplicate bulletin/template keeps its portable asset references while receiving
a new local document resource id. A whole-workspace move keeps both local ids and
the resolver unchanged. A standalone `document.json` without its referenced
assets may therefore open with unresolved assets; the supported cross-workspace
transfer unit is a project/template bundle containing the document, asset map,
and binaries.

Every asset-valued persisted location must reuse the same `assetRef` primitive,
including image data, field defaults and values, binding fallbacks, custom
element instance data, and AI field values. A user-created independent duplicate
of an asset library item receives new local and portable asset ids; duplicating a
document does not independently duplicate its referenced assets.

Each project/template bundle manifest must map every referenced portable asset id
to a bundle asset entry id. Each asset entry supplies the validated archive path,
SHA-256 digest, byte size, media type, and other fields defined by the manifest
contract. On import, the app builds a complete source-entry-to-local-resource map
in quarantine before committing any resource:

- An incoming portable asset id not present in the destination receives a new
  local asset resource id and resolver entry.
- An incoming portable asset id already mapped to the same verified bytes may
  reuse the existing local asset resource. New provenance may be appended, but
  imported display metadata, AI visibility, sanitization state, and other local
  policy must not silently replace destination-local values. A missing or corrupt
  destination binary requires explicit repair and is not an equality match.
- The same portable asset id associated with different bytes inside one archive
  is invalid and blocks import.
- If an otherwise valid incoming portable asset id is already associated with
  different bytes in the destination workspace, normal import must stop and show
  the collision. If the user confirms an isolated-copy import, the app must mint
  a new portable asset id for the incoming asset and transactionally rewrite
  every reference in the incoming closure. Existing destination resources must
  never be rebound or overwritten.
- Equal bytes under different portable asset ids remain distinct logical asset
  revisions. Physical binary deduplication is allowed, but it must not collapse
  their identities or provenance.

The import transaction must persist the destination local resource ids, any
portable-id remaps, and all document/manifest reference changes atomically. The
source archive is never modified.

### Other Identity And Remapping Rules

Bundle ids and entry ids describe one archive; they do not make ordinary project
bundles updateable. Importing the same project/template bundle again creates a
new local document resource. Entry ids and archive paths never become workspace
storage ids.

Pack identity is two-level. `packId` identifies the publisher's pack, while
`contentId` identifies a logical item only in that pack. An asset item may retain
the same `(packId, contentId)` across pack releases while using a new portable
asset id when its bytes change. Imported-pack metadata maps source
`(packId, contentId)` pairs and source portable ids to the destination local
resource ids. A matching pair is an update/replace candidate, not permission to
overwrite; confirmation and pack-trust rules still apply. Reusing a content id
for a different resource kind is invalid.

Document element ids are portable and scoped to one document, so importing or
duplicating a complete document preserves them. Element ids do not collide with
ids in another document. Duplicate element ids inside an incoming complete
document are a semantic validation error, not a reason for silent repair. When
the user explicitly inserts or merges an element subtree into an existing
document, collisions with that document must be resolved by assigning new ids to
the incoming nodes and rewriting all references within the incoming subtree.
Wrapper and placement id namespaces are defined with the element-model contract.

Workspace provenance records should include the import source type, bundle id or
pack id/version, entry id or content id, source portable asset id, destination
portable asset id when remapped, destination local resource id, verified content
hash, original display filename/path, and import time when applicable. Provenance
does not grant filesystem access and is never used as a live dependency on the
source archive.

Changing local resource ids alone must not rewrite portable document JSON.
Document JSON is rewritten only for a normal user document edit or a required
portable normalization, including:

- A portable asset-id collision remap in an incoming import closure.
- Safe legacy-path migration to a portable asset reference.
- Explicit asset replace/relink to a different immutable asset revision.
- An element/subtree insertion collision or an explicit, user-visible repair.
- Applying a reviewed AI asset selection to a document.

The top-level document `name` field is the document display name. A display name
is a mutable label shown to the user in lists, tabs, inspectors, exports, and
dialogs. Display names are not unique identifiers and must not determine storage
paths.

Duplicate display names are allowed. When duplicates exist, the UI should show
secondary metadata sufficient to distinguish resources. Useful disambiguation
metadata includes:

- Resource kind, such as bulletin, template, asset, or resource pack.
- Last modified time.
- Created or imported time.
- Source resource pack name and version, when applicable.
- Document date or service date, when present.
- Media type, dimensions, or original filename for assets.
- Short local resource id only as an advanced or last-resort disambiguator.

Rename changes display metadata only. Rename must not change the local resource
id, storage path, generated artifact path, or internal references.

Duplicate creates a new local resource with a new local resource id and copied
content. Imported projects and templates always receive new local resource ids
when imported as new copies.

## Document Model

Every project has this top-level shape:

```json
{
  "version": 1,
  "kind": "bulletin",
  "name": "07 05 2026",
  "metadata": {
    "title": "July 5, 2026 Bulletin",
    "language": "en-US",
    "publicationDate": "2026-07-05"
  },
  "page": {},
  "pageElements": [],
  "elements": []
}
```

The `kind` field is either `bulletin` or `template`. Bulletins and templates use
the same layout model; they differ by storage location and user workflow.

Creating a bulletin from a template copies the template content into a new
bulletin. Bulletins are not live-linked to the source template by default.

Templates may include a top-level `fieldContract` for manual form filling,
custom workflows, and AI-assisted imports. Bulletins created from templates keep
a copied contract plus `fieldValues`, bindings, and portable `sourceTemplate`
lineage. Legacy top-level `schema` data is migration input and must normalize to
the shared field-contract model.

The `elements` array is the normal body flow. The order in this array is the
order used by the editor, Typst generation, and PDF output.

The optional `pageElements` array contains explicit page-level elements such as
backgrounds, page numbers, headers, footers, and decorative elements. Page-level
elements render independently from normal body flow and may be anchored in page
margin regions when their placement allows it. Missing `pageElements` should be
treated as an empty array during normalization.

Each element has these common fields:

- `id`: stable document-global visual node identifier matching
  `^[A-Za-z][A-Za-z0-9_-]*$`.
- `type`: element type.
- `name`: user-facing label in the inspector.
- `width`: element width.
- `height`: element height.
- `breakPolicy`: `auto` (default) or `avoid` for supported flow fragmentation.
- `margin`: vertical flow spacing around the element.
- `padding`: inset inside the element box.
- `style`: visual style object.
- `fieldContract`: optional scoped field contract for reusable/custom workflows;
  legacy element `schema` arrays are migration input only.
- `bindings`: optional ordered bindings from contract fields to allowlisted
  type-specific `data` leaves.
- `data`: type-specific content.

Persisted physical layout lengths should use explicit unit strings, with inches
as the default unit for page, margin, element size, spacing, canvas position, and
container gap fields. Editor pixels are a derived display/interaction projection,
not the preferred persisted representation for physical layout. Legacy numeric
length values are interpreted as editor pixels during migration and should be
normalized to explicit unit strings where safe.

### Field Contracts, Values, And Bindings

The field contract is the sole definition of fillable data. Templates, document
fields, custom-element definitions, AI contracts, and AI imports must reuse the
same field definition and value types rather than creating parallel schemas.

A `fieldContract` contains:

- `id`: portable UUIDv4 identifying the contract lineage.
- `version`: positive integer incremented when field meaning or validation
  changes.
- `name` and optional `description`.
- Optional ordered `groups` with unique stable `id`, `label`, and optional
  `description` for form presentation.
- `fields`: ordered field definitions with ids unique within the contract.

Each field definition contains `id`, `label`, `type`, and `required`, plus
optional `description`, `groupId`, `nullable`, `default`, `examples`,
`constraints`, `semanticRole`, and AI instructions. A `groupId` must resolve in
the same contract. Groups render in group-array order, ungrouped fields render
after them, and field-array order is authoritative within each group. The only
v1 semantic role is `publicationDate`, allowed on a date field at most once per
document. Field ids match `^[A-Za-z][A-Za-z0-9_-]*$`, are stable across label
changes, and must not be reused for a different meaning.

Field values use these canonical JSON representations:

| Field type | Canonical value |
| --- | --- |
| `text` | JSON string. |
| `richText` | Structured rich-text document defined under `Text`. |
| `date` | ISO 8601 calendar date string `YYYY-MM-DD`. |
| `number` | Finite JSON number; `NaN` and infinities are invalid. |
| `boolean` | JSON boolean. |
| `choice` | Stable choice id declared by the field, not its display label. |
| `assetRef` | Portable `asset:<uuid>` reference. |
| `array` | JSON array whose items validate against the declared item field. |
| `object` | JSON object whose properties validate against declared child fields. |

`nullable: true` explicitly permits JSON `null`; omission and `null` are not
interchangeable. Constraints are type-specific and may include string length or
pattern, numeric minimum/maximum, choice definitions, array item/count limits,
object properties, and asset media-type restrictions. Defaults and examples must
validate against the same field definition.

String patterns use a documented linear-time, RE2-compatible subset without
backreferences or lookaround and run under validation limits; an import cannot
supply an unbounded backtracking expression.

Bulletin `fieldValues` is an object keyed by field id. Each stored entry contains
`value` and `origin`, where origin is `manual`, `ai`, `imported`, or
`materializedDefault`. Origin supports review and conflict handling but does not
bypass validation. An omitted field resolves to its contract default when one
exists; defaults need not be copied into `fieldValues` merely to render.

Effective bound values resolve in this order:

1. A stored, valid `fieldValues[fieldId].value`.
2. The field's valid contract default.
3. The binding's optional schema-valid fallback.
4. Missing, which is a validation result when the field is required.

Bindings are stored on the owning visual element as an ordered `bindings` array.
Each binding has a document-unique `id`, `scope` (`document` or `local`), a
`fieldId`, and a `target` RFC 6901 JSON Pointer relative to that element, plus an
optional fallback/closed deterministic format object. Only schema-declared
content-bearing `data` leaves may be addressed in v1. Bindings must not target
style, geometry, ids, types, children, wrapper/page placement, pagination/layout
control, arbitrary paths, or properties whose value type is incompatible with
the field. A normally required target may be omitted only when a valid binding
supplies it.

While a binding exists, the resolved field value is authoritative for its target.
The renderer materializes the value into a transient render tree; it must not
persist a second competing copy in element `data` or `style`. Editing a bound
property updates the corresponding field value and sets its origin to `manual`.
An explicit `Detach binding` action removes the binding and writes the currently
resolved value into the target property as one undoable document edit; that
literal property is authoritative afterward.

Custom-element definitions use the same field-contract shape. A custom-element
instance stores its values using the same field-value records, scoped to that
definition instance. Bindings inside the definition resolve against the instance
scope unless they explicitly declare the enclosing document scope. Ambiguous or
cyclic binding scopes are invalid.

Creating a bulletin copies the normalized field contract, values/default state,
bindings, and template content. `sourceTemplate` may record the source contract
id/version/hash, source document hash and display name, and optional
`packId`/`contentId`/pack version. It must not contain a source workspace-local
resource id.

Field-contract versions are independent of the document schema version. Adding
an optional field with no rendering effect may be compatible; removing a field,
reusing an id, changing type, tightening constraints, or changing binding meaning
is incompatible unless an explicit migration is defined. Re-import or contract
update must show a per-field diff. Existing `manual` values win by default and
are never overwritten silently. Removed or incompatible values move to a
portable inert `orphanedFieldValues` map until the user remaps or deletes them;
the renderer ignores that map.

`contractHash` is `sha256:<lowercase-hex>` over the RFC 8785 canonical
`fieldContract`, excluding the hash field itself. It is comparison evidence, not
a replacement for contract id/version.

Automatic AI application requires exact target contract id, version, and
canonical hash. Any version or hash mismatch requires an explicit reviewed
contract migration and complete revalidation before proposals can apply.
Proposed values use the same field schemas and review. Accepting a value writes
it to `fieldValues` with origin `ai`; later imports do not replace `manual`
values unless the user selects those fields explicitly.

## Page Model

The page model defines both the editor page and the Typst PDF page.

- `page.typstWidth` and `page.typstHeight` are the canonical persisted physical
  finished logical-page/panel lengths, never imposed sheet dimensions.
- `page.layoutIntent` is `singlePage` (default) or `foldedBooklet`; it chooses
  initial editor presentation only and does not reorder PDF pages.
- `page.width` and `page.height` are derived editor dimensions in pixels, or
  legacy persisted editor dimensions that should be migrated when safe.
- `page.background` is the PDF/editor page fill color and defaults to `#ffffff`.
- `page.marginMode` is `fixed` (default) or `mirrored`; `page.binding` is `left`
  (default) or `right`.
- Optional `page.finalPageCountRequirement` defines a portable blocking
  publication constraint evaluated after authoritative PDF pagination.
- Fixed `page.margins.top`, `right`, `bottom`, and `left` define the content box.
- Mirrored margins use `top`, `bottom`, `inner`, and `outer`; their physical
  left/right mapping follows logical page parity and binding direction.

The default physical page is `7in` by `8.5in`. The editor's matching pixel size
is derived using `96px` per inch, so the default editor projection is `672` by
`816` pixels.

Built-in folded-panel presets include `5.5in` by `8.5in` and `7in` by `8.5in`.

Margins are mandatory layout constraints for normal body content. Flow elements,
canvas elements, and canvas children in the normal `elements` flow must stay
inside the page content box in both the editor and the generated PDF.

Explicit page-level elements may render in page margin regions when they are used
for page numbers, headers, footers, backgrounds, or decorative content. They must
stay within the physical page bounds, must not affect normal body pagination, and
must not allow arbitrary normal flow content to escape the content box.

The content box is:

```text
content width = page width - resolved physical left margin
                - resolved physical right margin
content height = page height - top margin - bottom margin
```

`page.finalPageCountRequirement` is absent when the document has no final
page-count constraint. When present, it is a closed object containing either:

- `exact`: a positive integer final page count; or
- One or more of `minimum`, `maximum`, and `multipleOf`, all positive integers.

`exact` cannot coexist with the other fields. `minimum` must not exceed
`maximum`; `multipleOf` must be at least 2; and every value is capped by the
generated-PDF page hard cap. The combined conditions must admit at least one
valid count from 1 through that cap. All supplied non-exact conditions apply
together: `exact` requires equality, `minimum`/`maximum` are inclusive, and
`multipleOf` requires a zero remainder. For example:

```json
{
  "page": {
    "finalPageCountRequirement": {
      "minimum": 4,
      "maximum": 24,
      "multipleOf": 4
    }
  }
}
```

The authoritative count is the verified generated PDF's logical reader-order
page count. It includes intentional blank pages created by page breaks and
excludes editor-only facing-page placeholders. Page-level elements cannot change
the count. Editor pagination may show an early diagnostic, but final/current
export and finalization must re-evaluate the exact persisted artifact count.

Page Setup must expose Exact, Minimum, Maximum, and Multiple Of controls and show
the latest verified count when current, otherwise a clearly labeled pagination
estimate, against the requirement. `CBB-LAYOUT-0004` reports the normalized
requirement, actual count, and actions to edit content, add an intentional page
break, or change the requirement. Templates preserve and copy the requirement.
The booklet workflow offers `Multiple of 4` as a quick setting;
`layoutIntent: "foldedBooklet"` alone does not silently add a constraint to an
existing or migrated document. Changing the requirement is a document edit that
stales current finalization/approval evidence.

## Lengths And Units

The model accepts these length forms where each field permits them:

- Explicit inch string, such as `"1in"`: preferred for physical layout fields.
- Plain number: legacy editor pixels for physical layout fields, accepted during
  migration; for non-physical raw fields such as font size and border width,
  plain-number behavior is field-specific.
- `pt`, `in`, `cm`, `mm`, `em`: absolute or font-relative length strings.
- `%`: percentage lengths where allowed.
- `fr`: fractional layout lengths where allowed by schema.
- `auto`: automatic size where allowed by schema.

The inspector should display physical page, margin, element size, element
spacing, canvas position, grid spacing, and stack spacing fields in inches by
default. Users may type plain numbers in those fields, and plain numbers in
inch-mode fields mean inches. Inch-mode plain-number input should be persisted as
explicit inch strings, using `.` as the decimal separator in stored JSON.

A future locale-aware input layer may accept locale-specific decimal entry, but
persisted JSON length strings remain locale-independent.

Canonical page size rule:

- `page.typstWidth` and `page.typstHeight` are authoritative for physical output.
- Editor dimensions are derived from physical page size at `96px` per inch.
- If legacy `page.width`/`page.height` disagree with canonical physical page
  size, the physical Typst lengths win and editor dimensions should be
  recalculated during normalization.

Unit allowance by field category:

- Page size: explicit physical lengths, preferably `in`; `pt`, `cm`, and `mm`
  are allowed.
- Margins, padding, element fixed width/height, element margin, canvas `x`/`y`,
  grid gaps, stack gaps, and snap grid size: explicit physical lengths,
  preferably `in`; `pt`, `cm`, and `mm` are allowed.
- Element width where responsive sizing is allowed: physical lengths, `%`, and
  `auto` where schema permits.
- Element height where automatic sizing is allowed: physical lengths and `auto`
  where schema permits.
- Grid track definitions, when configurable tracks are added: physical lengths,
  `%`, `fr`, and `auto` where schema permits.
- Font size: `pt`, `em`, or plain number interpreted by the font-size schema;
  not displayed as inches by default.
- Border width: `pt`, physical lengths, or plain number interpreted by the
  border-width schema; not displayed as inches by default.

Font size and border width remain raw length fields. They accept plain numbers
or explicit length strings and are not displayed as inches by default.

Persisted decimal parsing uses ASCII `.` with decimal/rational arithmetic as the
source of truth, not binary floating-point round trips. Exact conversions are
`1in = 72pt`, `1cm = 72/2.54pt`, `1mm = 72/25.4pt`, and legacy
`1px = 0.75pt`. Relative `%`, `fr`, and `em` values resolve only after their
containing basis or font size is known.

Generated absolute Typst lengths round once to `0.001pt`, half away from zero,
strip trailing zeros, and normalize negative zero to zero. Inspector-created inch
values persist with at most six fractional digits using the same rule. Display
rounding never mutates stored values until the user edits them, and repeated
open/save/build cycles must not introduce conversion drift. The build record
captures the length-normalization and locale-data versions.

## Style Model

The style object may contain:

- `fontRef`: managed immutable `font:<uuid>` family revision. New documents use
  the exact bundled Noto Sans ref shipped in the app's font catalog.
- `font`: legacy family-name string accepted only for migration/relink UI.
- `fontSize`: text size, default `11`.
- `fontWeight`: `regular`, `medium`, `semibold`, or `bold`.
- `fontStyle`: `normal` or `italic`.
- `color`: text color, default `#251d18`.
- `background`: box fill color, default `transparent`.
- `borderColor`: stroke color, default `#d8cdbd`.
- `borderWidth`: stroke width, default `0`.
- `align`: `left`, `center`, `right`, or `justify`.
- `verticalAlign`: reserved by schema for future vertical alignment behavior.

New elements should default to no visible border by using `borderWidth: 0`.
Typst generation should only emit a stroke when `borderWidth` is greater than
zero.

## Font Identity, Resolution, And Portability

The app bundles pinned static faces for Noto Sans regular, medium, semibold,
bold, and their italic counterparts, plus Noto Sans Symbols 2 as the built-in
symbol fallback. These open fonts replace Calibri as the product default. Exact
upstream versions, license files, portable font ids, face ids, byte sizes, and
SHA-256 hashes are recorded in the signed application distribution manifest.

A portable `font:<uuid>` identifies one immutable font-family revision: an
ordered set of exact face binaries and metadata. Changing any face bytes or
variable-axis defaults creates a new portable font id. The workspace resolver
maps that id to one local font resource. Old bundled/imported revisions remain
available while referenced by documents or retained artifacts.

Each `font-record.schema.json` record contains:

- Local resource id, portable font id, family digest, source provenance, and
  original/display/family/internal/PostScript names.
- License id/text reference, user/importer redistribution assertion,
  exportability, and PDF embedding/subsetting permission.
- Validation state, validating app/Typst versions, and Unicode coverage summary.
- Ordered face records with face id/index, format, numeric weight, style,
  stretch/variable-axis coordinates, SHA-256, and byte size.

The family digest is `sha256:<lowercase-hex>` over an RFC 8785 canonical array
sorted by face id. Each tuple contains face id/index, format, weight, style,
stretch, canonical sorted axis coordinates, face SHA-256, and byte size. Names
and local provenance are excluded so metadata edits do not change binary
identity.

Weight names resolve to `regular=400`, `medium=500`, `semibold=600`, and
`bold=700`. Resolution uses the exact selected `fontRef`, requested style, then
nearest numeric weight; an equal distance chooses the lighter weight. If the
requested italic/upright style is absent, the nearest opposite style may be used
with a warning. The app never synthesizes bold or italic, and variable-font axes
must use recorded values rather than environment defaults.

Documents may define ordered `fontFallbackRefs`. The effective stack is selected
`fontRef`, document fallbacks, bundled Noto Sans, then bundled Noto Sans Symbols
2, with duplicate refs removed. Preview and build use only this explicit managed
closure; they never search platform-installed fonts or accept a different face
because it shares a family name.

Glyph resolution walks that stack deterministically. The build record lists
every selected face hash and fallback use. A missing/invalid font ref is a hard
build error. A deterministic substitute for a missing requested weight/style is
a warning. A missing glyph after the complete stack may render a visible tofu
marker in the editor/live preview, but it blocks manual/final export and reports
the Unicode code point plus element/field location.

Font import is copy-on-write and runs through isolated validation. It verifies
container/table bounds and checksums, face names/counts, axes, embedding flags,
Typst loadability, size limits, and declared hashes. The same portable font id
and family digest may reuse an existing record; the same id with different faces
is a collision handled by transactional isolated-copy remapping of only the
incoming typed `fontRef` closure. Equal names never select or merge identities.

Legacy family-name migration is deterministic:

- One exact managed family match pins that `fontRef`.
- Multiple different matches require user selection.
- Missing `Calibri` maps to bundled Noto Sans with a pagination-change warning.
- Another missing family requires relink/substitution before manual export.

When both legacy `font` and canonical `fontRef` appear, `fontRef` is
authoritative and the legacy string is inert migration metadata. New saves write
only `fontRef` after successful migration.

Project/template bundles include every non-built-in primary/fallback font binary
and license required by their document when redistribution is permitted.
Built-in faces may be omitted only when the manifest declares their exact
portable ids/hashes and a compatible application dependency. A nonredistributable
font blocks portable bundle/pack export until the user substitutes a permitted
font; no silent substitution is allowed.

Absent or unknown redistribution permission defaults to nonredistributable.
Absent/unknown embedding permission blocks PDF output. Parsed font embedding
restrictions are authoritative minimums: manifest/pack/user claims may make
policy stricter but can never loosen restrictions found in validated font data.

PDF generation embeds/subsets every used permitted face and must not depend on
viewer-installed fonts. Accessible output additionally requires Unicode mapping
for every glyph. A changed font record, fallback stack, resolved face hash, or
embedding decision makes earlier build artifacts stale.

## Element Types

### Text

Text elements have `type: "text"` and store canonical content in a discriminated
`data.content` value:

```json
{ "kind": "plain", "text": "Welcome" }
```

or:

```json
{
  "kind": "richText",
  "document": { "type": "document", "blocks": [] }
}
```

Legacy `data.text` is accepted only as migration input and normalizes to plain
content. Plain content and rich content must not coexist as competing sources.
A plain-text fallback for search, diagnostics, or accessibility is derived from
the canonical content and is not separately editable persisted state.

The v1 rich-text AST root is `{ "type": "document", "blocks": [...] }`. Allowed
block nodes are:

- `paragraph`: ordered inline children.
- `heading`: `level` from `1` through `6` plus ordered inline children.
- `bulletList`: ordered `listItem` children.
- `orderedList`: ordered `listItem` children and optional positive `start`.
- `blockquote`: one or more paragraph/list blocks.
- `scripture`: optional plain-text `reference` and `translation` plus one or more
  paragraph blocks.

A `listItem` contains one or more paragraph or nested-list blocks. Lists may nest
at most four levels. Empty documents are valid while editing; empty list items,
invalid heading levels, and structurally impossible node combinations are not.

Allowed inline nodes are:

- `text`: a nonempty Unicode string plus an optional unique `marks` array.
- `lineBreak`: an explicit line break within the current block.

The only v1 inline marks are `strong` and `emphasis`. Marks carry no arbitrary
attributes. Raw Typst, HTML, CSS, URLs, embedded images, executable expressions,
custom style spans, and unknown nodes are not part of the AST.

Canonical mark order is `strong`, then `emphasis`. Normalization removes empty
text leaves and merges adjacent text leaves with identical marks. Derived plain
text concatenates inline text, converts `lineBreak` to LF, separates blocks with
a blank line, prefixes list items with stable bullets/numbers and two spaces per
nesting level, and emits scripture reference/translation before its paragraphs.

Clipboard paste is untrusted input. Plain-text paste creates paragraphs and line
breaks. HTML or rich clipboard paste may preserve only the allowed block/mark
semantics; scripts, styles, links, images, hidden content, event handlers, and
unknown elements are removed, with readable descendant text retained when safe.
Control characters other than supported whitespace are rejected or replaced
with visible safe text. Paste is one undoable edit.

Typst generation walks the validated AST and emits app-owned semantic Typst
constructs. Every text leaf is escaped as data; no leaf may become Typst source.
Headings map to semantic headings, lists to semantic list constructs,
blockquotes/scripture to semantic grouped paragraphs, and marks to strong or
emphasis constructs. Unsupported nodes block rendering instead of falling back
to raw markup.

The same AST is used for `richText` field defaults, field values, custom-element
values, and AI imports. AI-produced strings cannot opt into Typst markup. Rich
text contributes its structural heading/list/paragraph order to tagged PDF
output and its derived plain text to search and diagnostics.

### Image

Image elements have `type: "image"` and store image data in:

- `data.assetRef`: portable asset reference in the form `asset:<uuid>`. The UUID
  identifies an immutable asset binary revision and is not a workspace-local
  resource id.
- `data.fit`: `contain`, `cover`, or `stretch` in the schema.
- `data.alt`: optional accessibility text.
- `data.decorative`: optional boolean indicating that the image should be
  treated as decorative/artifact content for accessible PDF output.
- `data.caption`: optional future caption text.

The current Typst renderer supports `contain` and `cover`; any other value falls
back to `contain`.

Legacy image data may contain `data.path` pointing to an approved filesystem
asset. Legacy filesystem asset paths remain valid indefinitely for read and
migration compatibility, but newly written documents, templates, resource packs,
and exports must use `data.assetRef` rather than `data.path`. When a safe legacy
path resolves successfully, migration should automatically copy the asset into
the local workspace asset library, mint both the local asset resource id and
portable asset id, add the resolver entry, and normalize the image to
`data.assetRef` at the next safe persistence point. Those workspace and document
changes must commit atomically. If the legacy path cannot be resolved, the app
should preserve unresolved source metadata for diagnostics and show the missing
asset relink workflow.

### Date

Date elements have `type: "date"` and store date data in:

- `data.value`: valid proleptic-Gregorian date-only string `YYYY-MM-DD`.
- `data.format`: app-owned token format, default `MMMM D, YYYY`.
- `data.locale`: optional canonical BCP 47 locale override.
- `data.prefix`: optional text before the date.
- `data.suffix`: optional text after the date.

Date-only values are parsed as year/month/day components and never round-trip
through a UTC or local date-time conversion. They have no time zone. Operational
timestamps use RFC 3339 UTC with `Z`; workspace time zone affects only their UI
display.

Portable `metadata.publicationDate` is the canonical service/publication date for
filename generation and library filtering. At most one date field may declare
`semanticRole: "publicationDate"`. When present, that field's effective
`fieldValues` value controls the metadata mirror: field edits update metadata,
and direct metadata edits/export prompts update that field in the same undoable
transaction. Without such a field, metadata is authoritative. A mismatch is a
semantic error requiring deterministic resynchronization; export never guesses
from the first date element or current wall clock.

Date formatting uses version-pinned bundled locale data, not OS formatter output.
Supported longest-match tokens are `YYYY`, `YY`, `MMMM`, `MMM`, `MM`, `M`,
`DD`, `D`, `dddd`, and `ddd`; text inside `[...]` is literal. Unknown alphabetic
tokens are validation errors. Locale resolution tries exact bundled BCP 47 tag,
then its language-only tag, then `en-US`, with a diagnostic on fallback. A date
element locale overrides document language; otherwise document language applies.

`YYYY` is the four-digit year and `YY` its last two digits; `MMMM`/`MMM` are
localized full/abbreviated month names; `MM`/`M` are padded/unpadded month;
`DD`/`D` are padded/unpadded day; and `dddd`/`ddd` are localized full/abbreviated
weekday names. Supported years are `0001` through `9999`.

### Music

Music elements have `type: "music"`. They are placeholders for future hymn,
psalm, song, and lead-sheet import support.

Current rendering displays `data.title` and `data.notes` in a centered box.

### Container Child Wrappers

In this spec, a container is a grid, stack, or canvas element. Container
children are wrapper objects around native visual elements. The wrapper owns
container-specific layout data. The wrapped `element` owns the normal element
fields, including name, size, style, data, and nested children.

Container child wrappers have their own ids so the editor can select, drag, and
inspect a child placement separately from the wrapped native element.

Every visual element id and every container/page-placement wrapper id shares one
document-global `nodeId` namespace and must be unique across body, nested, and
page-level trees. The persisted property remains `id`; `nodeId` is the semantic
type, not a second field. Field, binding, contract, and resource ids use separate
namespaces and cannot be selected as visual nodes.

Every grid/stack/canvas stores wrappers in a `children` array. A wrapper contains
exactly one native `element`, has exactly one parent, and cannot be shared by
reference. Container-specific fields are forbidden on the wrong wrapper kind.
Cycles, duplicate node ids, or an element reachable through more than one parent
are hard semantic errors.

### Grid

Grid elements have `type: "grid"` and arrange child elements into rows and
columns.

Grid data includes:

- `data.rows`: minimum row count.
- `data.columns`: column count.
- `data.rowTracks`: optional row track sizes.
- `data.columnTracks`: optional column track sizes.
- `data.cellPadding`: current gap/gutter value.
- `data.rowGap`: reserved by schema for future row-specific gaps.
- `data.columnGap`: reserved by schema for future column-specific gaps.
- `data.semanticRole`: `layout` (default) or `table`.
- `data.tableSemantics`: required only for table role, with nonempty `summary`,
  nonnegative unique `headerRows`, and nonnegative unique `headerColumns` within
  the configured grid bounds.

Grid children are wrapper objects:

```json
{
  "id": "wrap_...",
  "row": 0,
  "column": 0,
  "element": {}
}
```

The wrapper owns the zero-based `row` and `column` placement fields. The wrapped
`element` is a native visual element.

Grid wrapper fields are app-maintained layout data. They should be visible as
placement context when inspecting a grid child, but they should not be directly
user-editable in the inspector. Empty cells render as empty slots in the editor
and empty grid cells in Typst.

Grid tracks are configurable. When explicit track sizes are omitted, rows and
columns default to equal-sized tracks. Percentage tracks should be used for the
default equal-width/equal-height behavior. Explicit track definitions may use the
units allowed by the length/unit rules for grid tracks.

Only one child is allowed in a grid cell. If the user needs multiple elements in
a cell, they should place a stack, grid, or canvas inside that cell and nest the
additional elements inside the nested container. Drops or imports that would
place multiple direct children in the same cell should be rejected or resolved by
user choice before persistence.

Grid canonical order is row, then column, then wrapper id. Row/column are
nonnegative integers within configured bounds. Interactive drops to an occupied
cell do not mutate the document; the UI may offer an explicit same-grid swap or
ask for another cell. Imported duplicate occupancy is invalid. A user-confirmed
repair keeps the first wrapper in canonical source order, places later wrappers
into the next empty row-major cells, grows the declared row count when allowed,
and records every move as one repair transaction; it never deletes a child.

Reducing grid columns with occupied cells requires `Reflow` or `Cancel`. Reflow
processes old cells row-major (original array order breaks impossible ties) and
assigns the next row-major cells under the new column count, expanding rows.
Reducing the minimum row count below an occupied row is rejected; rows never
discard children implicitly.

A semantic table grid requires a nonempty summary, at least one declared header
row or column, exactly one cell wrapper at every logical table coordinate, and no
spans in v1. Header scope is derived from declared header rows/columns. A layout
grid must never emit table tags.

### Stack

Stack elements have `type: "stack"` and arrange child elements vertically or
horizontally.

Stack data includes:

- `data.direction`: `vertical` or `horizontal`.
- `data.gap`: spacing between children.

Stack children are wrapper objects:

```json
{
  "id": "wrap_...",
  "index": 0,
  "element": {}
}
```

The wrapper owns the zero-based `index` ordering field. The wrapped `element` is
a native visual element.

Stack wrapper fields are app-maintained layout data. They should be visible as
placement context when inspecting a stack child, but they should not be directly
user-editable in the inspector.

Vertical stacks render as Typst stacks. Horizontal stacks render as equal-width
Typst grid columns.

Each stack index owns one direct child. If the user needs multiple elements at a
single stack position, they should insert a nested container at that position.

The `children` array is the authoritative stack order. Wrapper `index` is a
derived persisted consistency field and must equal its zero-based array position.
Normalization rewrites stale/duplicate indices to array order with a warning;
sorting by a conflicting imported index is not allowed because it could silently
change reading order.

### Canvas

Canvas elements have `type: "canvas"` and provide absolute placement within a
bounded page-content container. The editor shows a dashed placement surface; the
PDF output renders the canvas as an invisible box.

Canvas children are wrapper objects:

```json
{
  "id": "wrap_...",
  "x": 0,
  "y": 0,
  "element": {}
}
```

The wrapper owns `x` and `y` placement. The wrapped `element` owns its own name,
size, style, data, and nested children.

Canvas wrapper fields are user-editable layout data. When a canvas child is
selected, the inspector should allow editing wrapper `x` and `y` as well as the
wrapped element fields.

Canvas sizing rules:

- A canvas defaults to `width: "100%"`, `height: "auto"`, `padding: 0`, and
  `borderWidth: 0`.
- Canvas width is capped to the page content width.
- Canvas height is capped to the page content height and a canvas should always
  fit on a single page.
- `auto` canvas height grows to fit children, with a minimum visual height.
- Canvas children are clamped so their boxes remain inside the canvas width and
  canvas height.
- Canvas child `auto` width uses an editor natural-size estimate for placement
  and clamping.

Canvas `children` array order is the canonical paint and default reading order:
earlier children paint behind later children. Hit testing begins with the last
painted eligible child. Bring Forward/Send Backward commands change array order
as one undoable edit. Canvas wrappers have no independent `zIndex` in v1, so two
competing ordering mechanisms cannot disagree.

A canvas wrapper may have nonnegative `semanticOrder` when accessibility reading
order must differ from paint order. If any child declares it, every semantic
child must declare a unique value; partial/duplicate order blocks accessible
finalization. It never affects paint or hit testing.

### Page Break

Page break elements have `type: "pageBreak"` and force following flow content
onto the next PDF page.

In Typst they render as `#pagebreak()`. In editor Page View, they consume the
remaining visible content area of the current page so the next flow element
starts on the next page.

### Page-Level Elements

Page-level elements live in the top-level `pageElements` array rather than the
normal body `elements` flow. Each entry is a placement wrapper around one native
visual `element`:

```json
{
  "id": "page_wrap_1",
  "purpose": "footer",
  "target": { "mode": "all" },
  "layer": "overlay",
  "region": "bottomMargin",
  "anchor": "bottomCenter",
  "x": "0in",
  "y": "0in",
  "width": "100%",
  "height": "auto",
  "zIndex": 0,
  "clipToRegion": true,
  "semantic": { "mode": "artifact" },
  "element": {}
}
```

The page placement wrapper and wrapped element have distinct ids in the
document-global node-id namespace. The wrapper owns page targeting and placement;
the native element owns visual content and style.

Required placement fields and behavior:

- `purpose`: `background`, `header`, `footer`, `pageNumber`, or `decoration`.
- `target.mode`: `all`, `first`, `last`, `odd`, `even`, `range`, or `pages`.
  `range` has one-based inclusive `start`/`end`; `pages` has a sorted unique list
  of positive one-based page numbers.
- `layer`: `background`, `underlay`, or `overlay`. Body flow paints after all
  background/underlay entries and before overlay entries.
- `region`: `page`, `content`, `topMargin`, `bottomMargin`, `leftMargin`, or
  `rightMargin` after mirrored margins are resolved for the target page.
- `anchor`: `topLeft`, `topCenter`, `topRight`, `centerLeft`, `center`,
  `centerRight`, `bottomLeft`, `bottomCenter`, or `bottomRight`.
- `x` and `y`: offsets from the selected region/anchor; positive x moves right
  and positive y moves down.
- `width` and `height`: physical, percentage, or `auto` lengths allowed by the
  page-element schema.
- `zIndex`: integer from `-1000` through `1000` within a layer.
- `clipToRegion`: boolean. Content always clips to the physical page; when true
  it also clips to its selected region.
- `semantic.mode`: `artifact` or `content`. Content mode also requires
  `readingOrder` of `beforeBody` or `afterBody` and an integer `order`.

The wrapper's width/height are the authoritative placement box. Its `element`
uses the closed `pageContentElement` schema variant: the normal native fields and
type-specific content, but flow-only `width`, `height`, `margin`, and
`breakPolicy` are forbidden. Padding/style remain content-box properties. Legacy
nested flow sizes migrate to the wrapper. The renderer supplies the resolved
wrapper box to the native element, avoiding two competing size sources.

The coordinate origin is the physical page's top-left corner. Region rectangles
are resolved first, then the anchor point, then x/y offsets. The element's
matching anchor point is placed at that location. Placement outside the physical
page is invalid; it is never allowed to enlarge the PDF page box.

The content region is the resolved content box. Top/bottom margin regions span
only between left/right content edges; left/right margin regions span only
between top/bottom content edges. Corner areas belong to `page` only. Mirrored
margins resolve before these rectangles.

| Purpose | Allowed region | Allowed layer/semantics |
| --- | --- | --- |
| `background` | `page` | `background`, artifact only. |
| `header` | Top/left/right margin | `overlay`; artifact by default, content only when target matches one page. |
| `footer` | Bottom/left/right margin | `overlay`; artifact by default, content only when target matches one page. |
| `pageNumber` | Any margin | `overlay`, artifact only. |
| `decoration` | Any region | Any page layer, artifact only. |

For content semantics, `(readingOrder, order)` must be unique among content
placements on every matched page. A tie is invalid. Visual layer/z-order never
defines accessibility order.

Each definition renders once on every page matched by `target`. Target matching
is evaluated after body pagination; page-level content cannot change page count.
`last`, odd/even, page ranges, and generated page numbers use the final logical
reader-order page number. An empty target is a validation error.

Layer order is `background`, `underlay`, body flow, then `overlay`. Within a
page-level layer, lower `zIndex` paints first; ties use `pageElements` array order.
Background purpose must use the background layer. Page numbers and repeated
headers/footers default to artifacts. Backgrounds and decorations are always
artifacts. A meaningful non-repeated header/footer may use content semantics;
content semantics are invalid for background/decoration purposes.

Page-level elements never participate in normal flow, create page breaks, or
consume content-box height. They cannot contain page-break elements. Generated
page numbers are app-owned text, not user-supplied Typst expressions.

The editor exposes page-level entries through a layers/structure view. Selecting
any rendered repeated instance selects the source placement definition and shows
the current page as transient context; edits affect all matched pages. A command
may duplicate and retarget an entry to customize one page. Overlapped entries use
layer/z-order hit testing and remain selectable from the structure view.

## Flow Layout

Top-level elements are rendered in linear order. Normal flow elements render as
Typst blocks. `margin` emits vertical spacing before and after the block when
greater than zero.

Flow width is resolved against the page content box. Fixed widths wider than the
content box are clamped before Typst generation. Percentage and `auto` widths
are preserved.

Normal body flow must not render into page margins. Content that belongs in
headers, footers, page numbers, backgrounds, or decorative margin regions must be
modeled as explicit page-level elements instead of normal flow elements.

The editor inserts new palette-click elements immediately after the selected
top-level flow element. If nothing is selected, if the page setup is selected,
or if no selected element maps to a top-level flow position, new elements append
to the end.

## Pagination And Overflow

PDF output is the authoritative layout when editor measurement and rendered PDF
measurement differ. The editor should approximate PDF pagination and show live
preview output so users can resolve differences.

Top-level flow may continue onto following pages only at the break locations in
this matrix:

| Element/container | v1 break behavior |
| --- | --- |
| Plain or rich text | Breakable between paragraphs, list items, scripture paragraphs, and text lines. A heading stays with at least the first two lines of following content when space permits. |
| Image | Unbreakable. It moves to the next page when it fits there; an image box taller than a fresh content area is blocking overflow. |
| Date | Unbreakable. |
| Music placeholder | Unbreakable. |
| Grid | Breakable only between rows. A row and all of its cells are unbreakable in v1. |
| Vertical stack | Breakable between children and within a breakable child. |
| Horizontal stack | Unbreakable as one row. |
| Canvas | Always unbreakable and limited to one content area. |
| Page break | Forces a break before the next top-level flow element and renders no content. |
| Page-level placement | Never paginates; it is clipped to its target page/region. |
| Custom element | Expands as its declared v1 vertical-stack break model; breakable between expanded roots and within breakable roots. Unknown/ambiguous models are invalid. |

Only auto-height text, grids, and vertical stacks fragment under these rules. An
explicit fixed-height outer box is unbreakable unless its type schema defines
fragment semantics, and an unbreakable ancestor suppresses descendant break
points. Intended image cropping through `fit: cover` and explicit page-region
clipping are not overflow; clipped semantic text or normal-flow content is.

Text continuation preserves reading order, width, and style. Paragraphs should
avoid a single orphan first/last line when Typst can do so without violating a
hard constraint. List markers stay with their first content line. A heading at
the bottom of a page moves with following content when possible.

When a grid splits, it does so between complete rows. Grid side borders and cell
backgrounds repeat on each fragment; the outer top border/radius/padding belongs
to the first fragment and the outer bottom border/radius/padding to the last.
Intermediate fragments have square open continuation edges. A row taller than a
fresh content area is blocking overflow.

When a vertical stack or other decorated breakable box splits, background and
side borders repeat on every fragment. Top decoration/padding appears only on the
first fragment and bottom decoration/padding only on the last. Margins apply to
the complete element, not independently to each fragment. These fragment rules
must be identical in the editor approximation and generated Typst semantics even
when pixel measurements differ.

Outer margins and stack/grid gaps at a page boundary are emitted once rather
than duplicated on both fragments. A paginator iteration that consumes no
content terminates with a blocking diagnostic instead of retrying indefinitely.

Elements may expose `breakPolicy: "auto" | "avoid"`; `auto` uses the matrix and
`avoid` first moves the complete element to a fresh page. `avoid` does not make an
oversized element legal: when it cannot fit on a fresh page, a naturally
breakable element falls back to its matrix rule with a warning, while an
unbreakable element remains a blocking error.

Horizontal overflow is an error. Elements, container children, rows, columns,
images, and text must not intentionally extend beyond the page content width or
their containing layout box. The editor should clamp, reject, or warn before
persisting horizontal sizes/positions that cannot render within the allowed
width. Builds should fail or surface a blocking validation error when unresolved
horizontal overflow remains.

Page breaks are valid only as direct members of the top-level `elements` array.
They are invalid in grids, stacks, canvases, custom-element expansions, and
`pageElements`. Consecutive page breaks intentionally create blank logical pages;
a page break at the start creates a leading blank page and one at the end creates
a trailing blank page, with validation warnings so accidental blanks are visible.

An unbreakable element taller than a fresh page content area, a grid row taller
than that area, unresolved horizontal overflow, or content clipped outside an
allowed box blocks manual/final builds. Editor and live preview may show a clipped
error representation with diagnostics, but must not imply the layout is
publishable. Normal-flow vertical spacing at page boundaries collapses so it does
not create visible body content in top or bottom margins.

## Page View

The editor has two visual modes:

- Contiguous View: a continuous linear editor surface.
- Page View: a scroll-based page simulation with visible page boundaries and
  optional margin guides.

Page View must remain scroll-based. It should segment content into PDF-like
pages without replacing the editor with separate page documents.

Page View behavior:

- Top, right, bottom, and left margins are visibly marked when the user has
  enabled margin guide visibility.
- Content begins at the top margin of each page.
- Normal body elements do not appear in top or bottom margins.
- Explicit page-level headers, footers, page numbers, backgrounds, and
  decorative elements may appear in margin regions and should remain visually
  distinguishable from normal body flow while editing.
- If an unbreakable element would cross the bottom margin and can fit on a fresh
  page, it is moved to the next page by an editor-only spacer.
- If a breakable element crosses the bottom margin, Page View should segment it
  at a natural vertical break point where practical.
- If an element begins after a page's content area, it is moved to the next
  page's content start.
- Page break elements expand to the end of the current page content area.
- Facing presentation pairs logical pages according to the folded-output
  contract and uses clearly editor-only blank slots; it never inserts document
  pages or changes pagination.

Editor-only pagination spacers are not persisted in JSON and must not affect
Typst generation.

Margin guide visibility is only a view preference. Hiding margin guides must not
change the page content box, pagination, element clamping, generated Typst, or
PDF output.

## User Settings

User settings are editor preferences, not document content. Application-global
and workspace roots are separate versioned variants of `settings.schema.json`.

The application-global root is
`%APPDATA%/Church Bulletin Builder/app-settings.json` on Windows and
`${XDG_CONFIG_HOME:-~/.config}/church-bulletin-builder/settings.json` on Linux.
It uses `{ "scope": "application" }`; workspace `settings.json` uses
`{ "scope": "workspace" }`. Both include independent integer versions.

Application-global settings include UI language/theme, window state, update
preference, active/recent workspace registration, and defaults for editor view/
snap, export filename pattern, and display time zone. Workspace settings contain
optional overrides for those editor/export/time-zone defaults. Portable document
page setup, layout intent, language/locale, publication date, final page-count
requirements, and every value that can change PDF bytes or publication
eligibility remain in document JSON.

A user settings panel exposing the v1 settings below is required in v1.

User settings should not be stored in project JSON unless they intentionally
change the document output. Page setup values such as page size, page color, and
margins are project settings, not user settings.

Editable user settings:

- View mode: `contiguous` or `page`. Controls whether the drag-and-drop editor
  shows one continuous flow or the scroll-based Page View.
- Page View presentation: `single` or `facing`. Facing is the default for a new
  document whose `page.layoutIntent` is `foldedBooklet`.
- Margin guide visibility: `true` or `false`. Controls whether Page View draws
  top, right, bottom, and left margin guides. Margins continue to constrain
  layout even when guides are hidden.
- Live PDF preview: `true` or `false`. Controls whether edits automatically
  trigger live preview builds.
- Build detail visibility: `true` or `false`. Controls whether build output is
  expanded in the UI.
- Canvas snap: `true` or `false`. Controls whether canvas child movement snaps
  to a grid.
- Canvas snap grid size: positive length. Controls the snap interval when canvas
  snapping is enabled.
- Export filename pattern, default `{date:YYYY-MM-DD}.pdf`.
- Workspace display time zone: valid IANA zone id; it never changes date-only
  fields or portable PDF output.

User settings should stay with the local application/workspace, not with an
imported or exported project bundle. Opening an imported project should use the
current workspace's settings for editor view mode, margin visibility, live
preview behavior, and canvas snapping.

Workspace defaults seed new portable documents only. Changing a default does not
alter existing document output. An absent workspace override inherits the
application default; the effective value is never written into a document merely
because it was read.

Workspace creation seeds display time zone from a valid detected system IANA
zone, otherwise `UTC`. `page.layoutIntent` supplies the initial presentation only
until the user explicitly chooses `single` or `facing`; the explicit workspace
view preference wins thereafter but remains output-inert.

## Drag And Drop

The palette creates new elements. Existing elements can be reordered or moved
between supported containers.

Supported moves:

- Palette element into top-level flow.
- Existing top-level element reorder within top-level flow.
- Palette element or existing top-level element into any container.
- Container child from any container into any other container.
- Canvas child back into top-level flow.

Drop semantics are deterministic:

| Source | Top-level flow | Empty grid cell | Stack gap | Canvas point |
| --- | --- | --- | --- | --- |
| Palette | Create a new native element at the insertion index. | Create a native element plus grid wrapper. | Create a native element plus stack wrapper. | Create a native element plus canvas wrapper at the clamped point. |
| Existing top-level element | Reorder while preserving element id. | Remove from flow and create a grid wrapper. | Remove from flow and create a stack wrapper. | Remove from flow and create a canvas wrapper. |
| Existing container child | Remove its wrapper and insert the native element. | Move the placement, preserving native id and wrapper id while changing wrapper fields. | Same. | Same. |
| Page break (palette/existing) | Create or reorder only. | Reject. | Reject. | Reject. |

A container-to-container move may preserve the wrapper id because it remains the
same selectable placement, but it replaces container-specific fields atomically.
Moving to top-level deletes the placement wrapper; moving from top-level creates
a fresh wrapper id. Palette creation always creates fresh ids. Page-level
placements are managed in the layers view and are not implicit body-flow drag
sources/targets.

Drag rules:

- Self drops are ignored.
- Dropping an element into its own descendant is ignored.
- A drop whose fully resolved source and destination location are identical is a
  no-op. It preserves every id and creates no undo entry, autosave generation,
  preview build, or selection change.
- A dragged container child uses its wrapper id as the draggable identity.
- Flow insertion before or after a canvas is allowed at the canvas top and
  bottom edge zones.
- Dropping onto a canvas surface positions the child by pointer location, then
  clamps it into the canvas bounds.
- Validate the complete destination before removing the source. A rejected drop
  changes nothing.
- One successful drop, including source removal, wrapper conversion, index/cell
  normalization, and selection update, is exactly one undo transaction and one
  autosave edit generation.
- An occupied grid cell, invalid descendant/self target, page-break container
  target, or limit violation rejects the drop unless the UI presents and the user
  confirms a separately specified repair such as a same-grid swap.

Editor drag feedback:

- When the dragged element is close to an insertable top-level flow location,
  the editor should render a temporary insertion target labeled `Drop here` for
  new elements or `Move here` for existing elements.
- The insertion target is editor-only. It is not persisted to JSON and must not
  affect Typst generation.
- When dragging over a container, the destination sub-region should be
  highlighted so the user can see where the element will land before dropping.
- Grid containers should highlight the target cell or cell insertion region.
- Stack containers should highlight the target insertion position between or
  around stack children.
- Canvas containers should highlight the target placement region with a preview
  marker sized like the dragged element after clamping.
- Container edge zones that insert before or after the container in top-level
  flow should show the top-level insertion target instead of the container
  placement highlight.

## Selection And Inspector

Selection is ephemeral editor state, never portable JSON. A `selectionRef` is
either page setup or a document-global node id plus optional transient rendered
page context. The node id may identify a top-level/native element or a
container/page-placement wrapper. Selecting a wrapper makes its wrapped native
element available to the inspector without changing which node owns placement.

The inspector must show fields appropriate to the selection:

- Page setup: editor page size, PDF page size, page color, and margins.
- Top-level element: common fields, style fields, and type-specific data fields.
- Canvas element: name, width, height, margin, and canvas placement guidance.
- Grid child: read-only wrapper `row`/`column` plus wrapped element fields.
- Stack child: read-only wrapper `index` plus wrapped element fields.
- Canvas child: editable wrapper `x`/`y` plus wrapped element fields.

When a child of a grid, stack, or canvas is selected, the inspector should show
both the wrapper fields and the wrapped native element fields. Grid and stack
wrapper fields are not user-editable in the inspector. Canvas wrapper fields are
user-editable in the inspector.

Hit testing follows visible paint order: overlay page elements, body/canvas
front-to-back, underlay, then background. The deepest eligible node wins, while
an `Alt`/cycle-selection command moves through overlapping ancestors/siblings.
The keyboard-accessible structure/layers view can select any node regardless of
overlap or clipping. Repeated page-level content selects its source placement;
the rendered page number is context only. Hidden, locked, or artifact nodes must
remain discoverable in the structure view with their state announced.

Inspector edits update the JSON model immediately, rerender the editor, autosave,
and schedule a live PDF build when Live PDF is enabled.

Keyboard behavior:

- `Delete` removes the selected element unless the page setup is selected.
- Arrow keys move a selected canvas child by one editor pixel.
- `Ctrl` plus an arrow key moves a selected canvas child by ten editor pixels.
- Arrow keys inside text inputs keep their normal text-editing behavior.
- Font-size arrow controls increment or decrement the selected font size.

## Accessibility Requirements

The desktop editor UI should target WCAG 2.2 AA where the standard applies to a
desktop application. The app should remain practical for non-technical users, but
basic editor navigation, form controls, dialogs, menus, and document operations
must not depend only on pointer precision or visual color changes.

Editor accessibility requirements:

- Provide a logical keyboard focus order for the main editor, palette,
  inspector, preview, dialogs, and diagnostic views.
- Provide visible focus indicators for interactive controls.
- Provide accessible names and descriptions for controls, icons, inspector
  fields, validation messages, and build/export actions.
- Avoid shortcut conflicts with text editing and operating-system conventions.
- Meet WCAG 2.2 AA contrast guidance for normal text, important UI text, focus
  indicators, and non-text controls where practical.
- Respect operating-system reduced-motion preferences for animated previews,
  drag feedback, and transitions.
- Do not rely on color alone to communicate errors, warnings, selection, drop
  targets, or build state.

Every drag/drop operation does not need an exact keyboard-only equivalent.
However, users should still be able to complete core document work without drag
precision by using the inspector, menus, keyboard shortcuts, or structural
commands where practical. Required keyboard-accessible operations include opening
and selecting documents, editing text and fields, deleting selected elements,
undo/redo, save, build, export, page setup edits, and navigating validation or
diagnostic output.

Tagged/accessible final PDF output is a committed requirement that may be staged
after the initial v1 release. When implemented, tagged PDF output must include a
meaningful reading order and semantic structure for headings, paragraphs, lists,
tables, figures, page numbers, and decorative artifacts where those concepts are
represented by the document model. Live preview PDFs may prioritize speed, but
final manual builds and exported PDFs produced by the tagged-PDF stage should
include PDF tags.

Image alt text is optional. Image elements should still expose an optional alt
text field and an optional decorative/artifact setting. When alt text is
provided, it should be included in tagged PDF output. When an image is marked
decorative, the tagged PDF should mark it as an artifact or otherwise hide it
from assistive reading order where supported. Missing alt text must not block
normal save, live preview, or explicitly draft output. It blocks PDF/UA final
output for a non-decorative image.

### PDF Accessibility Output Contract

When the staged accessible-output feature ships, its normative target is
PDF/UA-1 (ISO 14289-1) on PDF 1.7. The app must bundle and pin a Typst version
from 0.14 or newer that supports tagged PDF and the `ua-1` export standard.
Accessible builds invoke
that supported mode rather than merely asserting conformance in metadata. A
post-processor may be added only if it preserves visual output and semantics,
has a pinned version, and is included in the build record; v1 architecture must
not depend on manual tag repair in a proprietary tool.

The app must bundle an offline pinned PDF/UA validator based on veraPDF validation
profiles. A successful Typst compile is necessary but
not sufficient: an accessible final candidate must have no PDF/UA-1 conformance
failures from the external validator. Validator warnings and human-review items
remain visible in the readiness report.

Portable document metadata for accessible output includes:

- `language`: a valid BCP 47 language tag, default `en-US`.
- `title`: nonempty machine-readable title, initially defaulted from document
  name but confirmed during finalization.
- Optional author/subject/keywords that do not expose workspace-local data.

The renderer sets language before document content and maps semantics as follows:

| Document construct | Tagged-PDF meaning |
| --- | --- |
| Paragraph | Paragraph. |
| Heading levels 1–6 | Corresponding semantic heading level. Heading levels must not skip solely for visual sizing. |
| Bullet/ordered list | List, list item, label, and item body. |
| Scripture/blockquote | Grouped quotation/section with reference text in reading order. |
| Grid used only for layout | Layout grouping, not a data table. |
| Grid explicitly marked `semanticRole: "table"` | Table/row/header-cell/data-cell structure; declared header cells and a table summary are required. |
| Non-decorative image | Figure with alternative description. |
| Decorative image/background/decoration/page number | PDF artifact excluded from reading order. |
| Meaningful page-level content | Content before or after body according to its explicit semantic order. |

Body reading order follows top-level `elements`. Grid content reads row-major,
stack content follows canonical child order, and canvas/custom content follows an
explicit semantic order when it differs from array order. Ambiguous semantic
order blocks accessible finalization. Repeated headers/footers and page numbers
are artifacts by default to avoid repetition.

Every non-decorative image requires nonempty alt text for an accessible final.
Images of text should be rejected from accessible finalization unless an
equivalent description preserves the text and the user explicitly acknowledges
the limitation. An imported PDF used as a visual asset is one figure; its source
tags are not assumed to survive embedding.

Accessible finalization requires automated PDF/UA validation plus a user-visible
review of document title/language, heading order, meaningful image descriptions,
table headers, color-independent meaning, and reading order. Automated success
must not be presented as proof that human-authored descriptions are accurate.
Failure to produce or validate tags blocks only the accessible final profile; it
must never silently downgrade that request to an untagged PDF.

## Undo And Redo

The editor should maintain an undo/redo history for document-editing actions.
The history belongs to the current editor run and does not need to persist across
app reloads unless explicitly implemented later.

Undoable actions should include:

- Element insertion, deletion, duplication, and reorder.
- Moving elements into, out of, or between containers.
- Inspector edits to page setup, element fields, style fields, wrapper fields,
  and type-specific data.
- Canvas child movement by drag, inspector edit, or arrow keys.
- Container child placement changes.

Actions that should not create undo entries:

- Selection changes.
- View mode changes.
- Margin guide visibility changes.
- Live PDF toggle changes.
- Build detail visibility changes.
- Manual save/build commands that do not otherwise change the document.

Redo history should be cleared whenever the user performs a new undoable action
after undoing. Consecutive text edits in the same inspector field may be grouped
into one history entry when they are part of a continuous edit.

Undo/redo must restore the document JSON and rerender the editor. It should also
restore the most relevant selection when possible. After undo or redo, autosave
and live preview scheduling should behave the same as after any other document
edit.

Keyboard shortcuts:

- `Ctrl+Z` or `Cmd+Z`: undo.
- `Ctrl+Shift+Z`, `Cmd+Shift+Z`, or `Ctrl+Y`: redo.

Undo/redo shortcuts inside text inputs should preserve normal text-editing
behavior while the input itself owns the edit. Once an inspector field commits a
document change, that committed change should be undoable by the editor history.

## Persistence Contract

Project and template JSON are the canonical editable document state. Generated
Typst, PDFs, preview PDFs, import summaries, build logs, and thumbnails are
derived artifacts.

Opening a document may normalize or migrate it in memory so the current app can
edit and render it safely. Opening an older document must not rewrite the stored
JSON immediately. Migrated or normalized JSON is written back only on explicit
save, autosave after a user document edit, or another user-confirmed operation
that persists the document.

Migrations should be ordered, deterministic, idempotent, and non-lossy wherever
practical. A migration should preserve source metadata needed for diagnostics
when it changes or removes legacy fields.

Documents with a newer unsupported version should be loaded with warnings when
the app can preserve and safely operate on the document. Unknown fields from a
newer document should be preserved when possible. If the app cannot safely load,
preserve, edit, or render the document without likely data loss, loading should
fail with an informative error instead of silently stripping data.

Saves must be atomic. The app should write to a temporary file in the target
directory, validate the written content when practical, and replace the previous
file only after the write succeeds. Failed saves must leave the previous valid
document intact and show an actionable error.

Derived artifacts become stale whenever canonical JSON or referenced assets
change. The app should track stale generated Typst/PDF artifacts and regenerate
them before manual build/export when required. Stale live previews must not be
presented as current output.

Validation outcomes:

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
- Missing required `fieldContract` values are draft warnings during edit, save,
  and preview. They do not make the document structurally unreadable or prevent
  saving, but they block final readiness until resolved.
- Safe migrations: legacy margin names, safe legacy asset references, missing
  defaults, older enum aliases, legacy layout details with deterministic modern
  equivalents, and compatible schema-version upgrades.
- Default-fill cases: omitted optional style fields, omitted optional page
  fields, omitted optional element fields with defined defaults, empty optional
  data objects, and missing user preference values.

## Persistence And Build

The app autosaves project JSON and regenerated Typst after edits. Manual saves
also normalize the project through the local storage layer.

Autosave is authoritative for document persistence. Users should not need to
perform a separate manual save before final build or publication, although manual
save may remain available as an explicit command.

The UI should show document persistence state, including dirty, saving, saved,
save failed, building preview, preview current, preview stale, preview failed,
manual build running, and manual build failed/succeeded states.

Autosave failures are blocking document reliability issues. If autosave fails,
the app should preserve unsaved in-memory changes, show an actionable error, and
retry when appropriate. Manual build/export must block when the latest document
state has not been saved successfully.

Live preview failures are non-blocking when JSON autosave succeeds. If live
preview build fails but autosave succeeds, the document remains saved, the app
shows the preview failure, keeps the last successful preview marked as stale when
available, and provides build diagnostics plus retry/manual build actions.

Builds should have a 30 second timeout by default. Timed-out builds should fail
with diagnostics and clean up partial outputs.

Every build has a UUIDv4 build id. Live preview requests additionally use a
monotonically increasing per-document `requestSequence` for supersession.
Obsolete queued or running preview builds may be canceled when a newer sequence
supersedes them. Only the newest successful request may update live preview. A
later failed request must not replace the last successful PDF; it marks that PDF
stale.

Manual builds take priority over live preview builds. Starting a manual build
should save the current document, cancel or defer obsolete live preview work, and
build from the latest saved normalized state.

Project size, element count, asset/font/archive complexity, and generated-output
limits are the deterministic warning/hard caps under `Local File Safety`. Build
and import decisions must not vary silently with available machine memory.

Manual builds:

- Save and render the project.
- Run the bundled Typst executable.
- Use an app-controlled Typst root that contains only the generated source and
  resolved local assets needed for the build.
- Use bundled application fonts and any imported resource fonts that are valid
  for the current project.
- Write an artifact record plus generated Typst/PDF outputs under
  `<workspace>/artifacts/<local-resource-id>/<build-id>.*`.
- Update the PDF preview frame when the build succeeds.

Live builds:

- Compile a normalized project snapshot without overwriting the main project
  files for every preview.
- Write preview Typst/PDF files under `<workspace>/preview/`.
- Defer queued live builds while a drag is active.
- Run the most recent queued live build after dragging ends.

### Build Artifacts And Approval Identity

Build ids are app-generated UUIDv4 values scoped to a local resource. A successful
persisted build produces an immutable artifact record plus immutable `.typ` and
`.pdf` files. Files must never be modified in place after their hashes are
recorded.

Artifact kinds are distinct:

| Kind | Meaning |
| --- | --- |
| `preview` | Ephemeral snapshot for the live preview. Never finalizable or directly publishable. |
| `draft` | Persisted manual build that may contain explicitly accepted draft warnings/placeholders. |
| `finalCandidate` | Persisted manual build that passed the selected final-readiness profile. |
| `importedDiagnostic` | PDF/Typst supplied by an imported bundle. Untrusted diagnostic attachment, never current output. |

`approved` is not another mutable PDF kind. An approval record references one
specific immutable `finalCandidate` build and its PDF hash. An `export` is an
event that copies a verified artifact; it is not implicitly a rebuild.

Build status is `queued`, `running`, `succeeded`, `failed`, `canceled`, or
`timedOut`. Typst/PDF output fields are valid only for `succeeded`; every other
terminal status removes partial outputs but retains bounded diagnostics. Preview
records identify the in-memory `editGeneration`; draft/final candidates require
a successfully persisted document revision token.

Every build record includes artifact-record version, build id, local document
resource id, kind/status, `createdAt`, selected output/readiness profile,
normalized input-snapshot hash, tool/schema identities, diagnostic codes, and a
bounded log reference. `startedAt` exists only after execution begins;
`completedAt` is required only for terminal status. Preview records include
`editGeneration`; draft/final records also require the canonical persisted
revision token.

Only a `succeeded` record includes output evidence:

- SHA-256 of normalized portable document JSON and generated Typst plus
  generator/renderer version.
- Sorted portable asset refs and verified binary hashes.
- Sorted font refs, face/revision hashes, and embedding/subsetting decisions.
- App version/build identity, bundled Typst version/executable hash, schema
  versions, validator version/profile, locale/language, and output options.
- Validation report hash, acknowledged draft warnings, and paths/hashes for
  bounded build logs.
- PDF relative path, SHA-256, byte size, page count, PDF version/standards, and
  accessibility-validation result when requested.

The build-input signature is the canonical digest of the document revision,
assets, fonts, renderer/tool versions, schemas, locale, and output options. An
artifact is current only when its signature matches the requested build state.
Document edits, binding/field changes, asset/font replacement or loss, output
profile changes, relevant settings changes, renderer/schema migration, or a
different pinned tool version make it stale for a new export. Staleness never
mutates or invalidates the historical artifact bytes; it prevents presenting
them as current.

An approval record includes approval id/time, optional local approver display
label, build id, build-input signature, PDF hash, readiness-report hash, selected
profile, and any permitted warning waivers with reasons. Editing any build input
marks that approval stale. Approval records and artifact files are local metadata
and are not copied into portable document JSON.

Ordinary current-PDF export uses the newest successful, non-stale persisted
manual artifact matching the selected profile; otherwise it saves and rebuilds
first. Exporting an approved PDF copies the exact approved artifact bytes after
verifying their hash and never rebuilds behind the approval. A stale approval
requires re-finalization for a new current export; an explicitly requested
historical copy must be labeled as historical rather than current.

When `page.finalPageCountRequirement` is present, an artifact is eligible for
current, final, or approved export only when its verified `pageCount` satisfies
that requirement. A successful PDF with a mismatching count may be retained or
exported only through an explicitly labeled non-publication draft or historical
diagnostic action; it can never be a `finalCandidate` or current publication
artifact. This gate applies even before the staged approval UI is implemented.

Export writes to a temporary destination, verifies the copied hash, then replaces
or renames atomically. The local export event records build id, PDF hash,
destination display filename, time, and whether it was draft/current/approved.
Preview files are never used as the source of a final export.

When a project/template bundle includes Typst or PDF, the manifest labels its
artifact kind, build id, input signature, and hashes. Import stores it only as an
`importedDiagnostic`; it does not inherit current, approved, or final status.

## Print And Export Workflows

PDF export is the required publication workflow. The app may later offer a direct
system print dialog, but exported PDFs are the canonical output for printing,
sharing outside the app, and archiving.

### Folded And Booklet Output

The required booklet output is a reader-order logical-page PDF. The default
`7in` by `8.5in` physical page is one finished panel/page, not a printer sheet.
PDF page 1 is the front cover, pages 2 onward follow reading order, and the last
page is the back cover only when the document actually contains one.

The app does not automatically add blank pages to reach a multiple of four.
Explicit top-level page breaks may create intentional blank logical pages. When
`page.layoutIntent` is `foldedBooklet`, a non-multiple-of-four page count receives
a print/booklet warning because an external imposition tool or printer driver
may add blanks, but it does not change the reader-order PDF. `singlePage`
documents do not receive this warning solely because of their page count.

If the document sets `page.finalPageCountRequirement.multipleOf: 4`, a
non-multiple-of-four count is instead a blocking publication diagnostic under
`CBB-LAYOUT-0004`. The general booklet warning never weakens an explicit
requirement, and the app does not satisfy the requirement by silently adding
blank pages.

Facing Page View is required for the folded/booklet workflow. For left-bound
left-to-right documents it shows page 1 alone on the right, then 2–3, 4–5, and so
on; a final unmatched page is shown beside an editor-only blank placeholder.
Right-bound documents mirror that presentation. Placeholders, fold hints, and
sheet outlines in the editor are view state and never persisted or exported.

Page setup supports `marginMode: "fixed" | "mirrored"` and
`binding: "left" | "right"`. Fixed mode uses top/right/bottom/left. Mirrored
mode stores top/bottom/inner/outer; for left binding, odd pages place inner on the
left and even pages on the right, with right binding reversed. Page-level margin
regions resolve after this parity mapping.

Professional imposition, imposed/2-up sheet PDFs, automatic signature ordering,
crop/bleed/fold marks, printer creep compensation, duplex-printer settings, and
sheet-size output are explicit v1 non-goals. Users may apply those operations to
the reader-order PDF in operating-system, printer-driver, or external tools.

Page sizes:

- `7in` by `8.5in` is the default page-size preset, not the only supported page
  size.
- Built-in presets should include common paper and bulletin sizes where useful,
  such as letter, legal, A4, and folded-panel presets.
- Templates, bulletins, and resource packs may define their own page-size and
  page-setup configurations.
- Page size, margins, and final page-count requirements are document
  output/publication settings and must be stored in project or template JSON,
  not only in user preferences.

Export naming:

- Workspace `exportFilenamePattern` is configurable and defaults to
  `{date:YYYY-MM-DD}.pdf`.
- Supported substitutions are `{date:<date-format>}`, `{name}`, and `{kind}`;
  `{{` and `}}` emit literal braces. Date comes only from valid
  `metadata.publicationDate`. If a required date is absent, prompt for it rather
  than using today's date.
- Expansion normalizes to Unicode NFC, replaces control and portable-forbidden
  `/ \ : * ? " < > |` characters with `-`, removes path separators, trims
  surrounding spaces/trailing periods, collapses repeated replacement hyphens,
  and rejects `.`/`..` or Windows reserved device basenames.
- Cap the basename at 120 Unicode scalar values without splitting a scalar and
  append `.pdf` exactly once. If the result is empty/reserved, use
  `bulletin-<publication-date>.pdf` (or `bulletin.pdf` when no date is available
  after user review).
- A collision may prompt for replacement or use the lowest available ` (2)`,
  ` (3)`, and so on before `.pdf`.
- Exported filenames are display/output labels only and must not affect local
  resource ids, artifact identity, PDF bytes, or internal workspace paths.

Approval and finalization:

- Approval/finalization is a committed requirement that may be staged after the
  initial v1 release. Before that stage is available, users may manually build and
  export PDFs without a persisted approval record.
- When implemented, the app should provide an approval/finalization step before
  publishing the final PDF.
- Finalization saves the current document, selects `printFinal` or
  `accessibleFinal`, runs that readiness profile and a persisted manual build,
  verifies the PDF, and presents the complete readiness report.
- Finalization compares the verified artifact page count with every configured
  final page-count condition. A mismatch blocks finalization and all
  current/final/approved export; it is not a waivable warning.
- Blocking validation errors or failed builds prevent final approval/export until
  resolved.
- Non-blocking warnings may be shown during finalization but should not prevent
  approval unless they affect print-readiness or accessible final output.
- Final approval references the immutable final-candidate build id, build-input
  signature, PDF hash, readiness-report hash, profile, approval time, and
  permitted waivers. Export destinations are separate events, not approval
  identity.
- Editing the document after approval should mark the approval as stale and
  require another finalization before publishing a new final PDF.

## Error Messages And Support

The app should show non-technical users only the error detail needed to
understand and recover from the current problem. Critical errors that prevent an
operation from continuing should be visible at the point of failure. Detailed
technical information should be available in diagnostic views that are hidden by
default.

User-facing error behavior:

- Use plain-language summaries for blocking failures.
- Include the affected document, asset, bundle, or operation when known.
- Offer a clear recovery action such as retry, relink, choose another file,
  restore from import, open diagnostics, or cancel.
- Do not expose raw stack traces in normal dialogs or toasts.
- Use stable error codes for support and diagnostics.
- Keep non-blocking warnings out of the user's way unless they affect current
  save, build, export, import, or print-readiness.

Diagnostics behavior:

- Provide a diagnostic view that is hidden by default.
- Provide build logs in a separate window or panel that is hidden by default.
- Provide copyable diagnostics for validation failures, build failures, import
  failures, migration failures, and file-system failures.
- Allow the user to export a diagnostic bundle for support.
- Diagnostic bundles should include app version, platform, workspace metadata,
  relevant logs, validation reports, build diagnostics, recent error codes, and
  sanitized configuration details.
- Diagnostic bundle export should avoid including project content, PDFs, images,
  fonts, or other private church data unless the user explicitly confirms that
  content should be included.

Autosave errors should show an immediate toast and record full details in
diagnostics. If an autosave error means the latest document state is not safely
persisted, the document persistence/unprotected state must remain visible until
the problem is resolved.

The app should define actionable handling for at least these failure classes:
corrupt JSON, failed migration, hard validation failure, missing asset, missing
or invalid font, missing bundled Typst executable, Typst compile error, compile
timeout, disk full, file permission failure, failed archive import, unsupported
bundle/resource-pack version, unsafe imported content, and workspace/file
conflict.

### Diagnostic Codes And Redaction

Stable diagnostic codes use `CBB-<DOMAIN>-<NNNN>`. Defined domains are `DOC`,
`SCHEMA`, `FIELD`, `ASSET`, `FONT`, `LAYOUT`, `BUILD`, `PDF`, `SAVE`,
`CONFLICT`, `IMPORT`, `PACK`, `SECURITY`, `AI`, and `PACKAGE`. A code's meaning
and default severity cannot be repurposed; behavior changes require a new code.

The app bundles a versioned `diagnostic-catalog.json` validated by
`diagnostic-catalog.schema.json`. It is normative for code meaning, default
severity, per-operation disposition, acknowledgeability, recovery actions, and
redaction class. A release may add/retire codes but never reuse one. The baseline
assigns a code to every readiness-matrix condition and required failure class;
conditions do not fall back to unstructured text. It includes:

| Code | Meaning |
| --- | --- |
| `CBB-DOC-0001` | Malformed/unsupported document JSON. |
| `CBB-SCHEMA-0001` | Structural or semantic schema failure. |
| `CBB-FIELD-0001` | Missing/invalid required field-contract value. |
| `CBB-ASSET-0001` | Unresolved required portable asset. |
| `CBB-FONT-0001` | Missing/invalid font revision. |
| `CBB-FONT-0002` | Missing glyph after explicit fallback closure. |
| `CBB-FONT-0003` | Redistribution/embedding permission blocks output. |
| `CBB-FONT-0004` | Requested face uses a deterministic managed substitute. |
| `CBB-LAYOUT-0001` | Horizontal or physical-page overflow. |
| `CBB-LAYOUT-0002` | Oversized unbreakable fragment. |
| `CBB-LAYOUT-0003` | Clipped semantic content or no-progress pagination. |
| `CBB-LAYOUT-0004` | Final PDF page count violates the document requirement. |
| `CBB-BUILD-0001` | Typst compile failure. |
| `CBB-BUILD-0002` | Build timeout/cancellation. |
| `CBB-BUILD-0003` | PDF/output hash or parse verification failure. |
| `CBB-BUILD-0004` | Requested artifact is stale for the current input signature. |
| `CBB-PDF-0001` | Requested PDF/UA validation failure. |
| `CBB-PDF-0002` | Missing required accessible metadata, semantics, order, or alt text. |
| `CBB-SAVE-0001` | Canonical/recovery autosave failed. |
| `CBB-SAVE-0002` | Operation requires a current durably saved revision. |
| `CBB-CONFLICT-0001` | Optimistic revision conflict. |
| `CBB-IMPORT-0001` | Invalid/unsafe/incompatible archive or manifest. |
| `CBB-PACK-0001` | Pack signature/signer/release continuity failure. |
| `CBB-SECURITY-0001` | Required security validation/isolation failed. |
| `CBB-AI-0001` | Invalid/incompatible AI exchange or helper result. |
| `CBB-PACKAGE-0001` | Installed/bundled component verification failed. |

Each diagnostic record contains:

- Code, severity (`info`, `warning`, `error`, or `fatal`), operation,
  disposition (`allow`, `acknowledge`, or `block`), and correlation id. Severity
  describes the condition; disposition independently describes that operation.
- Plain-language user summary and separate bounded technical detail.
- Document/resource kind and safe display label when known.
- JSON Pointer, element/wrapper/field id, page, manifest entry id, or sanitized
  archive-relative path when applicable.
- For malformed source JSON, one-based line/column and zero-based UTF-8 byte
  offset when the parser can determine them safely.
- Recovery actions from a schema-defined list, such as retry, relink, substitute,
  open review, export recovery copy, or cancel.
- Optional cause code and tool exit classification, never an unrestricted stack
  trace in normal UI.

An error blocks the current operation. A fatal diagnostic means safe continuation
of the current workspace/process is impossible and triggers bounded recovery or
shutdown. Blocking findings are not overridden; choosing a separately labeled
draft operation is a different disposition.

Diagnostics are structured data; imported strings are escaped and cannot create
codes/actions. Logs redact credentials/tokens, environment values, home/workspace
absolute prefixes, helper inputs/output, document text, and private asset/font
names by default. Diagnostic bundle generation replaces local paths with stable
placeholders and lists every optional private-content category separately for
explicit confirmation. One confirmation cannot silently opt into all future
bundles.

### Final Readiness Profiles

Validation severity depends on the requested operation. The app exposes
`draft`, `printFinal`, and, when implemented, `accessibleFinal` readiness
profiles.

| Condition | Edit/preview | Draft | Print final | Accessible final |
| --- | --- | --- | --- | --- |
| Missing/invalid required field | Warning | Warning | Block | Block |
| Save failure/conflict or unsaved build revision | Non-final preview allowed | Block | Block | Block |
| Missing asset | Placeholder warning | Explicit placeholder draft only | Block | Block |
| Missing/invalid/non-embeddable font | Diagnostic/fallback preview only | Block | Block | Block |
| Missing glyph after fallback stack | Tofu diagnostic | Block | Block | Block |
| Missing requested face with deterministic managed substitute | Warning | Allow | Acknowledge | Acknowledge |
| Horizontal/physical-page overflow or clipped semantic content | Error marker | Block | Block | Block |
| Configured final page-count requirement not met | Show expected/actual | Explicit labeled draft only | Block | Block |
| Missing alt on non-decorative image | Warning | Allow | Allow | Block |
| Untagged/nonconforming PDF | Warning/not applicable | Allow without claim | Allow without accessibility claim | Block |
| Stale artifact | Show/rebuild | Rebuild | Rebuild/finalize | Rebuild/finalize |
| Build/PDF verification failure | Editing remains available | Block | Block | Block |

Every final candidate requires:

- The canonical document is successfully saved and the build revision matches.
- Structural and semantic schemas pass, required field values resolve, and no
  unresolved conflict/recovery transaction exists.
- All referenced assets/fonts resolve to verified bytes; no missing glyph or
  placeholder remains.
- No horizontal overflow, oversized unbreakable element, clipped required
  content, invalid page target, or unintended blank-page error remains.
- A successful current persisted manual build exists, the PDF opens, its hash
  and page count match the artifact record, and all dependencies/tool hashes are
  recorded.
- The verified artifact page count satisfies `page.finalPageCountRequirement`
  when that portable document requirement is present.

`printFinal` also requires a user review of page size, margins, page count, and
the visual PDF preview. When `page.layoutIntent` is `foldedBooklet`, that review
also includes the booklet warning state. `accessibleFinal` additionally requires
title/language, valid heading/list/table semantics, unambiguous reading order,
alt text for every non-decorative figure, successful PDF/UA-1 generation, and no
external validator conformance failure.

Warnings are overridable only when their diagnostic definition marks them
waivable for that profile. A waiver records code, build id, user reason, and
time. Missing/corrupt dependencies, save/conflict state, unsafe content, schema
failure, horizontal/clipped overflow, stale artifact, PDF hash mismatch, or
PDF/UA failure in `accessibleFinal` are never waivable. A configured final
page-count mismatch is also never waivable for a current/final/approved
operation. Approval records include the exact readiness report and waivers.

## Local File Conflicts

The app should prevent the same workspace from being opened for editing by more
than one app process at the same time. Opening a workspace should acquire an
app-managed workspace lock. If another live process holds the lock, the second
process should show a clear message and refuse to open that workspace for
editing. If a stale lock is detected, the app may offer a recovery flow after
explaining the risk.

Project and template saves should use both file locks and optimistic version
checks. Before replacing a document file, the app should confirm that the file on
disk still matches the canonical SHA-256 revision token last loaded or saved by
the current process; timestamps are UI hints only. If it does not match, save
stops and enters conflict recovery instead of silently overwriting the changed
file.

When a file changes on disk while the project is open, the app should prompt the
user to choose between the disk version and the current in-workspace version. The
app is not required to perform automatic merges. If the user accepts the disk
version, the project should reload from disk after warning about any unsaved
in-memory changes. If the user keeps the current version, the app should save it
only after confirmation and must preserve both versions in the conflict backup.

When a referenced workspace file is manually moved, renamed, deleted, or becomes
unreadable outside the app, the app should mark the affected resource as missing
or stale and prompt the user to relink, restore, import, or remove the reference.
The app must not silently recreate, delete, or overwrite user-modified files to
resolve the conflict.

Resource metadata should include enough revision information to detect stale
paths, stale generated artifacts, and changed asset binaries. Conflict handling
should preserve undo history where practical, but preventing silent data loss is
more important than preserving the current undo stack.

### Save, Lock, Conflict, And Recovery State Machines

Canonical JSON revision tokens are lowercase SHA-256 values over canonical
normalized bytes. Timestamps assist the UI but never replace the hash for
optimistic concurrency.

Document persistence states are `clean`, `dirty`, `saving`, `saveFailed`,
`conflicted`, and `readOnly`:

- An edit changes `clean` to `dirty` and schedules autosave after 500 ms of
  inactivity. Continuous edits must start a save attempt no later than two
  seconds after the first unsaved edit.
- A save snapshots the current in-memory revision and enters `saving`. Edits
  during that write remain dirty and schedule another save after it commits.
- Successful atomic replace enters `clean` only if no newer edits exist;
  otherwise it returns to `dirty`.
- Transient failure enters `saveFailed`, retains all in-memory edits and a
  recovery snapshot, and retries after 1, 2, 5, 10, then 30 seconds while the
  condition persists. User retry is always available.
- A disk hash different from the loaded base enters `conflicted`; autosave stops
  and never overwrites either version.

Autosave-attempt latency is at most two seconds. Under healthy storage, either the
canonical document or a bounded recovery snapshot under
`transactions/recovery/<local-resource-id>/` must be flushed within five seconds
of the oldest unsaved edit, giving a five-second normal crash-loss bound. If both
writes fail or miss that deadline, the UI enters persistent `changes not
protected` state and makes no durability claim. On normal shutdown,
the app waits for saving and blocks close while unsaved state remains, offering
Retry, Export Recovery Copy, or explicitly Discard. OS-forced termination cannot
be prevented, so startup offers any newer valid recovery snapshot instead of
applying it silently.

The workspace lock file is `<workspace>/.workspace.lock` and contains lock schema
version, workspace id, random app-instance id, PID, host/user discriminator,
app version, process start time, acquired time, and heartbeat time. The holder
updates a heartbeat every five seconds. Another instance must treat a live
process/instance match as locked. A lock is only a stale candidate after 30
seconds without heartbeat and a platform process-identity check shows no matching
live process; uncertain remote/filesystem cases require explicit read-only open
or user-confirmed recovery. PID alone is never sufficient because of reuse.

Every save acquires the relevant resource lock, verifies the current disk hash
equals its base token, writes and fsyncs a same-directory temporary file,
validates it, atomically replaces the target, and durably updates registry
metadata. Platform-specific durability steps may differ but a crash must leave
either the old complete version or the new complete version, never a partial
JSON file.

The document replace and registry-revision update use a small save journal under
`transactions/save/<transaction-id>.json` containing base/new document hashes
and before/after registry metadata. The durable document JSON is authoritative.
If startup finds the new valid document hash but old registry metadata, it
deterministically completes the recorded registry update; if it finds the old
hash, it rolls back the uncommitted metadata. Any third hash or invalid journal
enters read-only conflict recovery. The journal is marked committed only after
both files are durable, closing the two-file crash gap.

Conflict recovery preserves
`conflicts/<local-resource-id>/<YYYYMMDDTHHMMSSmmmZ>-<conflict-id>/base.json`,
`disk.json`, `ours.json`, and `conflict.json` with base/current/disk hashes and
safe metadata. The filesystem-safe UTC timestamp contains no colon. The UI
offers Use Disk Version, Keep My Version, Save Mine As New, or Export Both.
Keeping the current version requires confirmation and a fresh optimistic check
immediately before replace. Automatic semantic merge is out of scope.

Multi-resource imports, pack updates, asset migration, and other transactions
use `transactions/<transaction-id>.json` with states `planned`, `staged`,
`committing`, `committed`, `rollingBack`, `rolledBack`, or `failed`. The journal
contains source digest, allocated id/remap tables, intended writes, old/new
hashes, and completed steps. Fresh ids are allocated once during planning and
reused by retries. Staged files are invisible to the workspace registry until a
commit marker is durable; installed-pack/version pointers advance last.

On startup, a valid `planned`/`staged` transaction is rolled back, while an
interrupted `committing` transaction is completed only when every remaining step
is idempotent and all hashes match; otherwise it rolls back to recorded old
state. `committed` completes cleanup; `rollingBack` completes rollback;
`rolledBack` removes only verified transaction-owned residue. A `failed` journal
with proven complete rollback is quarantined for diagnostics and cleaned; failed
or contradictory rollback with possibly visible partial state opens the workspace
read-only for recovery. Unknown states or journal/byte disagreement also open
read-only—recovery never guesses. Rollback keeps referenced prior resources.
Startup finishes transaction recovery before opening documents for editing.

Manual build/finalization waits for the current document to reach `clean` and
builds that exact revision token. Live preview may use a labeled in-memory
snapshot while dirty, but it never becomes a persisted final artifact. Shutdown,
workspace close, or update installation must not proceed silently through
`saveFailed`, `conflicted`, or an unresolved committing transaction.

## Assets

Assets should be stored under an app-generated local resource UUID, not a
user-provided filename or portable asset id. The original filename should be
stored as display metadata in the local asset metadata store.

Asset records should include:

- Local asset resource id.
- Portable asset id for the immutable binary revision.
- Verified SHA-256 digest and byte size for that revision.
- Original filename for display.
- Media type.
- Storage location for the binary object.
- Source metadata such as source `packId`/`contentId` and local pack installation,
  source `bundleId`/`entryId`, or manual upload/import source when available.
- AI visibility: `private`, `approved`, or `public`, defaulting to `private`.

The app's local asset library owns local asset resources, resolver records, and
metadata. Asset listing, upload/import, preview, rendering, replace/relink,
delete, and export operations work against the local workspace. Replacing asset
bytes is copy-on-write: it creates a new portable asset id and local asset
resource rather than changing the bytes associated with an existing portable
asset id. Old asset revisions must remain available while referenced.

AI visibility controls whether an asset may be exposed to a local AI helper or
included in an AI template contract's asset catalog. Private assets must not be
included in AI helper inputs or exported AI contracts unless the user explicitly
approves them. Approved and public assets may be included in AI helper context
and may be selected by AI output using their portable `asset:<uuid>` references.

Project JSON should reference managed assets by portable asset URI in the form
`asset:<uuid>`. It must not contain the corresponding local asset resource id,
reference arbitrary private filesystem paths, or depend on the original filename
as an identifier.

Image assets must resolve through the app's local asset service. Legacy
filesystem asset references may be supported during migration only when they
resolve inside an approved legacy asset root. Legacy filesystem paths must not be
absolute and must not contain `..`.

The app must not resolve asset paths outside approved local asset roots. Path
resolution must canonicalize paths before reading and must reject traversal or
symlink escapes outside the workspace or approved import/build directories.

Asset references remain stable when a project is exported, imported, or moved to
another workspace unless a verified portable-id collision requires the incoming
closure to be remapped. A relink or replacement selects a different immutable
asset revision and is therefore an explicit document edit.

Project and template exports must include all referenced managed asset binaries.
If a referenced asset is missing from the local workspace, the app should ask the
user to add, import, or relink it. Normal/final and bundle export block; only the
separately confirmed draft-placeholder operation below may proceed. Users should
be able to relink a missing asset to another local managed asset or import a
replacement into the local asset library.

When an image asset is missing, the editor, live-preview renderer, and explicitly
confirmed draft-placeholder PDF renderer should represent it with an SVG
missing-image icon sized to the image element's resolved container box. The
placeholder should preserve layout dimensions so missing assets are visible
without changing surrounding layout.

The referenced asset closure includes refs reachable through body/page elements,
custom-element expansion, field values/defaults, binding fallbacks, and selected
output dependencies. Unreferenced library assets do not affect readiness.

Missing-asset severity is operation-specific:

`CBB-ASSET-0001` means an unresolved required portable asset reference; its
disposition follows this table rather than changing code by operation.

| Operation | Required behavior |
| --- | --- |
| Open/edit/save | Allow the document, preserve the unresolved ref, show the same-size placeholder and warning, and offer relink/import. |
| Live preview | Render the placeholder and mark the preview `draft-with-placeholders`; do not present it as final-ready. |
| Draft manual build/export | Require explicit `Build/Export Draft With Placeholders` confirmation, record the warning, mark the artifact draft, and add `-DRAFT` to the proposed filename. |
| Normal current/final export | Block and offer relink or the separate draft-export action. |
| Finalization/approval | Block for every final-readiness profile. |
| Project/template bundle export | Block because the bundle must be self-contained. |
| Resource-pack export | Block when a selected entry or any required dependency in its export closure is missing. |
| Bundle/resource-pack import | Block the whole import transaction when a declared required asset is absent or invalid. |
| Diagnostic bundle | Omit the binary; include only redacted resolution diagnostics unless private content is separately approved. |

A draft placeholder must be visually unmistakable and contain no arbitrary
source path. Draft status cannot be removed by renaming the exported file; it is
also recorded in the artifact/export event. Relinking is one undoable document
edit and makes affected prior artifacts stale.

Deleting a referenced asset is rejected unless the same confirmed transaction
relinks or removes every reference. Final readiness always re-resolves the
current closure and never trusts an older successful preview.

## Resource Packs

Resource packs are importable local content bundles with the `.pak` extension.
They represent an arbitrary collection of reusable content, such as church logos,
approved images, fonts, templates, starter bulletins, custom element schemas,
styles, and optional metadata.

Resource packs are data, not application code. They are delivered separately from
the application and imported through the UI. The application bundle must not need
to change when a church creates, updates, or distributes its own resource pack.

A resource pack is a zip-compatible archive. It must contain a `manifest.json`
file at the archive root. The bundle may include a `readme.md` file that
describes the pack for the user. When present, the app should make the readme
available before or during import.

Resource pack manifest fields must include the required entries below and may
include the optional entries below:

- Resource pack format version.
- Stable pack id.
- Pack name.
- Optional version.
- Positive monotonic release sequence when signed update/rollback behavior is
  supported.
- Optional claimed publisher metadata and optional signature/key-transition
  metadata; claims are not trust until cryptographically verified and locally
  accepted.
- Optional description.
- Optional author, church, or organization display metadata.
- Optional homepage, support, or contact metadata.
- Optional license metadata for the pack and included content.
- Optional minimum compatible app version.
- Optional readme path, defaulting to `readme.md` when present.
- Manifest entries for included assets, templates, starter bulletins, custom
  element schemas, styles, fonts, AI template contracts, sample AI data imports,
  and other supported content.
- Dependency metadata for content that references other entries in the pack.
- Update metadata that lets the app identify whether a later `.pak` is an update
  to an already imported pack.

Every pack entry must have a `contentId` unique within that `packId`. The
`contentId` remains stable for the same logical item across pack versions and
must not be reused for a different kind or unrelated item. Each asset entry also
has a portable asset id and verified content hash. When an asset item's bytes
change in a later pack version, its `contentId` remains stable but its portable
asset id and hash change. A pack that associates one portable asset id with
different bytes is invalid.

Documents inside packs continue to use `asset:<portable-asset-id>`. The pack
manifest maps each referenced portable asset id to the corresponding asset
entry/content id. Those documents must not contain destination workspace ids.

Resource pack archives should use predictable top-level directories when they
contain those content types:

- `assets/` for image and media assets.
- `templates/` for template JSON.
- `bulletins/` for starter bulletin JSON.
- `custom-elements/` for custom element schemas.
- `styles/` for reusable style metadata.
- `fonts/` for included fonts.
- `ai/` for AI template contracts, sample prompts, and sample AI data imports.

Resource pack fonts may use any standard font format supported by the bundled
Typst version. The app must validate included fonts before importing them and
reject or report fonts that Typst cannot load.

Import behavior:

- Validate the resource pack before importing it.
- Show a summary of content that will be imported.
- Ask the user to confirm before copying imported content into the local
  workspace.
- Copy imported content into the local workspace after confirmation.
- Assign app-generated local resource ids to the installed pack and newly
  imported content. Preserve valid source portable asset ids, subject to the
  collision rules in `Portable Asset Resolution`.
- Store the complete `(packId, contentId)` and portable-asset-id remap tables in
  installed-pack metadata.
- Store imported fonts in the local workspace font library with metadata linking
  them to the source pack.
- Preserve original names as display metadata.
- Track source pack metadata for display and diagnostics.
- Never require the original resource pack file to remain available after import;
  updates occur by importing another `.pak` with compatible update metadata.

Duplicate and update handling must be deterministic. When importing a pack whose
`packId` matches an installed pack, the app compares only `(packId, contentId)`
pairs with that same pack. It should present a replace/update summary and require
explicit user confirmation before replacing compatible existing content.
Display-name matches alone are not storage identity, but the import summary
should call them out so the user understands what names will appear in the
library.

Resource packs support updates. When importing a newer pack with the same stable
pack id, the app should compare the incoming manifest against the imported pack
metadata and show what will be added, updated, or removed. The user must choose
whether to update or replace compatible existing pack-managed content before the
app applies changes. An update preserves existing pack-managed content that is
not replaced by the incoming pack. A replace may remove existing pack-managed
content that is absent from the incoming manifest, but only after explicit user
confirmation. Existing bulletins created from earlier pack templates must remain
unchanged by default and must not be silently rewritten by a pack update or
replace.

Pack asset updates are copy-on-write. A changed asset revision receives a new
portable asset id and local asset resource; pack-managed templates may be updated
to reference it only after confirmation. Earlier revisions must remain while
referenced by copied bulletins, detached templates, or other local content.

Resource packs may be exported from the app when the user wants to distribute a
curated set of reusable local content. Exported resource packs should be `.pak`
zip-compatible archives containing `manifest.json`, selected resources,
referenced assets, included fonts when selected, AI-ready metadata when selected,
and an optional `readme.md`.

Resource pack import is required in v1. Creating/exporting packs and applying
pack updates or replacements are committed requirements that may be staged after
initial v1 import support. Until update/replace support is available, importing a
pack whose stable identity already exists must stop with an informative message
rather than silently replacing existing content.

### Resource Pack Trust And Update Safety

Pack ids establish lineage, not publisher trust. The app supports signed and
unsigned packs:

- A signed pack uses Ed25519 over the canonical manifest/entry digest. Its
  manifest `signature` descriptor contains algorithm `Ed25519`, the embedded
  base64 raw 32-byte public key, optional display `keyId`, SHA-256 key
  fingerprint as `sha256:<64-lowercase-hex>`, and a canonical detached signature
  path containing exactly 64 raw Ed25519 signature bytes. The signature exists
  only at that path, never inline. Embedding the key makes offline first-import
  verification possible; `keyId` alone is never sufficient.
- A valid signature identifies possession of that key only. The user may
  explicitly trust a publisher key after verifying its fingerprint; trust state
  is workspace/local metadata and is never imported from a pack.
- An unsigned pack may be imported as `unverified` after a clear first-import
  warning and confirmation. Unsigned installations are immutable: later files
  import side-by-side and cannot update/replace that installation in place.
- An invalid, malformed, or unverifiable claimed signature is a blocking error;
  it must not be downgraded to unsigned.

Installed-pack state records claimed pack id/version, manifest digest, signature
status, signer fingerprint, positive monotonic release sequence when present,
user trust decision, import time, original entry snapshot, pack-content-to-local
maps, and local modification state. The UI shows
`trusted`, `signed-untrusted`, or `unverified` without implying that content is
safe merely because it is signed.

A pack update/replace is eligible only when its pack id matches and publisher
continuity is accepted. The same trusted signer is normal continuity. A changed
signer, unsigned-to-signed or signed-to-unsigned transition, or unrecognized key
is a high-risk event that stops normal update. The user may import side-by-side.
An in-place signer transition is valid only when transition metadata is signed
by both the pinned old key and incoming new key; otherwise associating a new
signer requires a separate warning showing both fingerprints and cannot
overwrite content in the same confirmation step.

The pack-only `keyTransition` descriptor contains `fromFingerprint`,
`toFingerprint`, positive `minimumReleaseSequence`, `oldSignaturePath`, and
`newSignaturePath`. The fingerprints must match the locally pinned old key and
the incoming manifest key. Both detached Ed25519 signatures cover UTF-8
`CBB-RESOURCE-PACK-KEY-TRANSITION-v1`, one NUL byte, then the RFC 8785 canonical
JSON bytes of `{packId, fromFingerprint, toFingerprint,
minimumReleaseSequence}`. A transition is invalid below that sequence or when
either signature/path/key binding fails; each transition signature path contains
exactly 64 raw Ed25519 signature bytes.

Update-capable signed packs require a positive `releaseSequence`; human-readable
semantic version remains display metadata. The same sequence and digest is
already installed. The same sequence with a different digest is equivocation or
tampering and blocks import. A lower sequence is a downgrade requiring an
explicit impact-reviewed flow. A higher sequence from the pinned/authorized
signer is only an eligible update and still requires entry validation, impact
review, and confirmation. Offline key pinning does not claim certificate
revocation checking.

Before an update, the app compares the last installed snapshot, current local
state, and incoming state:

- Incoming-only changes to an unmodified pack-owned item are update candidates.
- Local-only changes are retained and the item is detached or marked locally
  modified.
- Concurrent local and incoming changes are conflicts; preserve the local item
  and offer incoming content side-by-side unless the user resolves each conflict.
- Incoming removal hides/removes an unmodified pack-owned library item only in an
  explicitly confirmed replace. Normal update retains it.

Changing a pack asset/font/schema/template is copy-on-write. The dependency
impact summary lists every local template, bulletin, custom element, and artifact
that still references an old revision. Referenced old revisions are retained and
remain resolvable even when hidden from the current pack library. Garbage
collection may remove a revision only after the workspace proves no canonical
document, reusable content, recovery record, or retained artifact references it.

Pack update/replace runs as one journaled transaction. It validates and stages
the complete incoming closure, writes new immutable resources, updates only the
confirmed pack-owned mappings, then advances installed version/digest state as
the final commit step. Failure or cancellation restores the previous installed
state and leaves existing documents renderable. AI visibility and other local
privacy policy never become less restrictive merely because incoming metadata
requests it.

Installed state retains at least the previous successfully active pack content
map plus every referenced revision. An explicit rollback uses the same impact
review and journal machinery to restore that prior active map; it does not
rewrite copied documents or resurrect deleted local edits silently.

## Import And Export Bundles

The offline app transfers data through file-based import and export bundles.
Project and template bundles use the `.zip` extension and are zip-compatible
archives.

Supported bundle workflows:

- Export a bulletin project for backup or transfer to another workspace.
- Import a bulletin project from a bundle.
- Export a template for reuse in another workspace.
- Import a template from a bundle.
- Export a resource pack containing an arbitrary selected set of reusable
  content.
- Import a resource pack.
- Export an AI template contract for a selected template.
- Import AI-generated data for a selected template or bulletin.

Project and template bundles should include:

- A manifest containing the bundle id, bundle format version, primary document
  entry id, entry records, dependency records, and portable-asset-id-to-entry-id
  map.
- The project or template JSON.
- Referenced managed asset binaries and asset metadata.
- Referenced custom element schemas or style metadata when needed.
- Generated Typst from the selected persisted artifact for diagnostics.
- The approved current PDF by default when one exists, otherwise the newest
  non-stale persisted manual artifact. Preview/stale PDFs are never selected as
  current; any explicitly included historical artifact is labeled diagnostic.

Project and template bundle exports must include referenced assets. The app does
not support metadata-only project or template exports because imported documents
must remain portable and renderable in another workspace.

Import behavior:

- Validate the bundle manifest, JSON, asset references, and supported format
  version before import.
- Block import when the bundle format version is unsupported and show an
  informative error message that explains the incompatible version and, when
  possible, the required app version or recovery action.
- Show a user-readable import summary before writing to the workspace.
- Assign a new local resource id to every imported project/template copy. Assign
  new local ids to incoming asset entries unless the same portable asset id and
  verified bytes already resolve to an existing local asset.
- Preserve document element ids when they are unique within the incoming
  document. Duplicate ids inside a complete imported document block normal
  import; they are not silently repaired.
- Preserve display names, but avoid using display names as storage identity.
- Resolve each manifest asset map entry using the portable asset import and
  collision rules. A confirmed collision remap rewrites the staged incoming
  document, never an existing destination document.
- Report missing, unsupported, or unsafe bundle entries before import completes.
- Persist the planned id maps in the transaction journal so a retry uses the same
  allocations and cannot expose a partially remapped import.

Export behavior:

- Export from the normalized current document state.
- Include all assets needed to open and render the exported project or template
  in another workspace.
- Preserve document element ids and portable asset ids, and include an explicit
  map from every referenced portable asset id to its asset entry id even when the
  strings happen to match.
- Avoid absolute local filesystem paths in exported JSON or manifests.
- Do not use local resource ids, display names, or original filenames as archive
  entry identity or dependency resolution. Optional source local ids are
  provenance only and should be omitted when not needed.
- Write a deterministic manifest so exported bundles can be inspected,
  validated, and re-imported reliably.

### Archive Manifest Contract

Resource packs and project/template bundles use the same versioned
`manifest.schema.json` primitives. The root `kind` discriminates
`resourcePack`, `projectBundle`, and `templateBundle`; fields forbidden for that
kind must be rejected rather than ignored.

Every manifest root includes:

| Field | Contract |
| --- | --- |
| `version` | Positive `manifest.schema.json` version. |
| `kind` | Archive kind discriminator. |
| `formatVersion` | Positive version of that archive kind. |
| `bundleId` | UUIDv4 required for project/template bundles and absent for packs. |
| `pack` | Pack identity/name/version/compatibility metadata required for packs and absent for ordinary bundles. |
| `createdBy` | App/generator name and version; informational, not trusted authority. |
| `minimumAppVersion` | Optional compatible app-version floor. |
| `rootEntryId` | Exactly one primary document entry for project/template bundles. |
| `entries` | Complete ordered entry records. |
| `entryCount` | Declared number of payload entries, excluding the root manifest and descriptor-declared detached cryptographic material. |
| `totalUncompressedBytes` | Sum of declared payload `byteSize` values using the same exclusions. |
| `assetMap` | Complete portable-asset-ref to asset-entry mapping. |
| `fontMap` | Complete portable-font-ref to font-family entry mapping. |
| `source` | Optional bounded inert provenance with no absolute paths or authority. |
| `signature` | Optional pack signature descriptor for detached signature bytes, defined by the pack trust contract. |
| `keyTransition` | Optional pack-only old/new fingerprint, minimum-sequence, and detached dual-signature descriptor. |

Entry identity is discriminated by archive kind. An ordinary bundle entry has
`entryId` (UUIDv4 unique in that manifest) and forbids `contentId`; a pack entry
has `contentId` (UUIDv4 unique within its pack) and forbids `entryId`. Bundle
dependencies target entry ids. Pack dependencies target content ids so lineage
survives pack versions.

Every entry also includes:

- `kind`: `document`, `asset`, `fontFamily`, `fontFace`, `customElement`,
  `style`, `aiContract`, `aiSample`, `readme`, `typstDiagnostic`,
  `pdfDiagnostic`, or another schema-defined supported kind.
- Explicit `required` boolean and canonical relative `path`.
- `mediaType`, nonnegative integer exact uncompressed `byteSize`, and lowercase
  64-hex SHA-256.
- Schema URI and root version matching parsed JSON content when applicable.
- Portable asset/font revision ref, inert source provenance, and license metadata
  when applicable.
- Sorted dependency records containing target id, closed `relation` enum, and
  `required`; dependency targets exist in the same manifest.

For bundles, asset/font maps target `entryId`; for packs they target `contentId`.
Every typed reference in the required closure maps to exactly one compatible
entry and every mapped entry verifies bytes/media/schema. Pack maps cover all
standalone reusable asset/font entries, not only those referenced by the root
document. Ordinary bundle maps equal the primary document's transitive required
asset/font closure; extra optional diagnostics are entries but not dependency-map
members. A font-family entry depends on its exact face entries.

Every nondirectory archive member except detached cryptographic material declared
by `signature` or `keyTransition` appears exactly once in `entries`; undeclared
payload members block import. Unreferenced optional entries are shown in review
and copied only when selected.

Canonical archive paths use UTF-8 normalized to Unicode NFC and `/` separators.
They are nonempty, relative, and contain no `.`, `..`, backslash, drive/UNC root,
NUL/control character, trailing dot/space segment, Windows device-name segment,
or empty segment. Paths that collide after Unicode normalization or
case-insensitive comparison are invalid even on a case-sensitive host. Manifest
paths, not zip entry order or original filenames, determine entry association.

Import verifies before user confirmation: supported versions, schema shape,
unique ids/paths/content ids, declared and actual sizes/hashes/media types,
dependency closure, root kind, asset/font maps, compatibility bounds, archive
limits, and signature state. Dependencies must resolve and be acyclic in v1.
Unknown required entry kinds or dependencies block import; explicitly optional
unknown entries may be skipped only after the summary says so.

Canonical manifest serialization follows RFC 8785 JSON canonicalization for
hashing/signing. Export sorts bundle entries by `entryId`, pack entries by
`contentId`, dependencies by target/relation, typed maps by reference, and other
set-like arrays by their schema key. Zip
entries are emitted in canonical path order with normalized permissions, no
symlinks/hardlinks, no host-specific extra fields, and one fixed legal zip
timestamp (`1980-01-01 00:00:00`, with variable extended timestamps omitted).
`bundleId`, creation metadata, and signatures may vary between
exports; deterministic means canonical closure/serialization, not reuse of
identity values.

The manifest digest covers the complete canonical manifest, including signature
algorithm/key/path descriptor but no detached signature bytes, plus every entry
identity/path/byteSize/hash tuple in canonical order. The Ed25519 signed message
is UTF-8 `CBB-RESOURCE-PACK-SIGNATURE-v1`, one NUL byte, then the raw 32-byte
manifest digest. Only descriptor-declared detached signature/key-transition
members may be absent from `entries`/root totals. A mismatch blocks import.

Reference rewriting is schema-directed. The importer traverses only declared
asset/font/binding/reference fields and builds source-to-destination maps during
the planned transaction. It must never perform arbitrary string replacement.
Collision remaps update every typed reference in the quarantined incoming
closure, revalidate all rewritten JSON, and appear in the import summary before
commit. The original archive remains unchanged.

## Local File Safety

All imported files, resource packs, project/template bundles, assets, fonts, and
AI helper inputs should be treated as untrusted local content until validated.

JSON parsing rejects duplicate object keys, invalid Unicode, excessive
depth/count/string size, non-finite numbers, and unsupported root versions before
semantic processing. Imported strings are never interpreted as HTML, shell
input, executable templates, filesystem paths, or commands merely because of
their contents.

SVG uploads and imports are allowed. SVG files must be treated as untrusted
images, not executable documents. The app must reject DTDs/entities, scripts,
event handlers, animation, `foreignObject`, external file/network references,
CSS imports/URLs, unapproved embedded data, and over-limit filters/path
complexity. Persisted render/build input is the validated sanitized derivative,
not the original SVG. If sanitization cannot preserve a safe image, reject it.

The numeric warning/hard caps below protect individual inputs and aggregate
closures. Declarations never authorize allocating or extracting past an observed
hard cap.

Archive import safety:

- Scan archive entries for zip-slip paths before extraction.
- Reject encrypted, multi-volume, malformed, unsupported-compression, nested
  executable, and otherwise unsupported archives. Nested archives remain inert
  unless a separate explicit workflow validates/imports them.
- Reject absolute paths, empty paths, `..` traversal, platform-specific drive
  roots, and paths that normalize outside the intended extraction root.
- Reject symlink, hardlink, device, FIFO, socket, alternate-stream, NUL-containing,
  case/Unicode/trailing-dot-space alias, and duplicate normalized entries.
- Extract imported archives to a quarantine/temp directory first.
- Validate manifests, file types, sizes, paths, fonts, assets, and referenced
  content before copying anything into the workspace.
- Copy only validated content from quarantine into the workspace.
- Use no-follow, handle-relative extraction/write operations to prevent symlink
  races between validation and copy.
- Clean up quarantine/temp content after successful import, failed import, or app
  restart recovery.

Filesystem safety:

- Canonicalize paths before reading or writing.
- Reject symlinks or hardlinks that escape approved workspace, import, preview,
  or build roots.
- Never follow imported archive entries directly into final workspace locations.
- Never allow generated Typst, imported manifests, SVGs, or AI helper output to
  read arbitrary local files.

Font/PDF safety:

- Validate font magic, table bounds/checksums, face counts/names/axes, embedding
  flags, limits, and Typst loadability before exposing a face to the editor.
- Imported PDFs are inert diagnostic/visual inputs. Preview them only in the
  restricted renderer and never execute JavaScript, launch actions, forms,
  attachments, embedded media, or file/network links. Only the validated
  flattened/raster derivative may enter a Typst build; failed safe conversion
  rejects the PDF as a document asset.

Typst build safety:

- Build from an app-controlled root containing generated source plus resolved,
  validated, approved assets and fonts.
- Compile only app-generated Typst. Imported `.typ` diagnostics and raw Typst in
  JSON/Markdown/AI/pack content are never executed.
- Do not expose the full workspace or arbitrary user directories as the Typst
  root.
- Use a pinned offline package cache and sanitized environment; package fetching
  and arbitrary filesystem imports are forbidden.
- Include only assets referenced by the normalized project/template and approved
  for the current build.

### Size, Performance, And Resource Limits

`MiB` means 1,048,576 bytes. File/JSON sizes count exact binary or UTF-8 bytes;
raster pixels are decoded width times height; visual-node counts include native
elements and wrappers recursively. Limits apply when the observed value is
greater than the threshold and are checked from declarations and again while
streaming/decoding.

| Category | Warning threshold | Hard cap |
| --- | ---: | ---: |
| Portable document JSON | 10 MiB | 50 MiB |
| Workspace metadata root | 25 MiB | 100 MiB |
| Manifest/non-helper exchange JSON | 5 MiB | 20 MiB |
| JSON nesting depth | 32 | 64 |
| One JSON string | 256 KiB | 1 MiB |
| Persisted visual nodes | 5,000 | 20,000 |
| Expanded render nodes | 10,000 | 50,000 |
| Container nesting depth | 16 | 32 |
| Rich-text Unicode scalars/document | 1,000,000 | 5,000,000 |
| Referenced asset binaries/document | 1,000 | 5,000 |
| One general asset binary | 100 MiB | 500 MiB |
| Resolved document asset bytes | 1 GiB | 4 GiB |
| Raster decoded pixels | 40 megapixels | 100 megapixels |
| Raster width or height | 16,384 px | 32,768 px |
| SVG source bytes | 5 MiB | 20 MiB |
| SVG XML nodes | 50,000 | 200,000 |
| SVG path commands | 250,000 | 1,000,000 |
| Imported PDF bytes | 100 MiB | 500 MiB |
| Imported PDF pages | 200 | 1,000 |
| One font face file | 20 MiB | 50 MiB |
| Resolved font face files/document | 64 | 256 |
| Resolved font bytes/document | 250 MiB | 1 GiB |
| Archive compressed bytes | 250 MiB | 1 GiB |
| Archive total uncompressed bytes | 1 GiB | 4 GiB |
| Archive entries | 5,000 | 20,000 |
| One uncompressed archive entry | 250 MiB | 1 GiB |
| Entry/aggregate compression ratio | 100:1 | 200:1 |
| AI helper result JSON | 8 MiB | 10 MiB |
| AI selected-input total | 50 MiB | 100 MiB |
| Generated PDF pages | 250 | 1,000 |

The helper boundary additionally caps stdout and stderr at 1 MiB each and total
scratch/output at 100 MiB. Builds keep the 30-second default timeout; normal
settings may raise it only to a 120-second hard maximum. Managed AI runs use
their separate five/fifteen-minute limits.

Crossing a warning threshold requires a visible summary/confirmation for import
or export and a persistent diagnostic for existing content. Crossing a hard cap
fails closed before large allocation/extraction when practical and aborts the
whole transaction. The diagnostic names the item/category, observed value,
configured limit, and recovery action.

Workspace policy may lower warning and hard thresholds. Normal UI cannot raise a
hard cap, and JSON depth, raster dimensions/pixels, SVG complexity, archive
entry/ratio, and helper-output security ceilings are never user-raiseable.
Limits do not scale automatically with machine RAM so two supported platforms
make the same validation decision.

Existing over-limit local content may open only in bounded read-only/recovery
mode when its metadata can be inspected safely. Operations expected to exceed
one second expose progress and cancellation. Release tests cover exactly-at-limit
success, one-over failure, deceptive declarations, cancellation, cleanup, and
transaction rollback.

## AI-Assisted Data Import

The app should support AI-assisted creation of bulletin content from high-level
user instructions. AI assistance should fill structured template data, not make
the AI tool responsible for visual layout, pagination, storage paths, or Typst
generation.

The app remains an offline desktop app. AI support must not require a hosted
service or network access. The app should support file-based exchange with
external AI tools and should be able to launch/configure a local AI helper, such
as opencode, when the user has configured one.

File-based AI contract export/import is required in v1. Broader AI-assisted
template filling may be staged after manual template workflows, and launching or
configuring a local AI helper may also be staged. File exchange with an
externally run helper is sufficient for v1.

When launching a local AI helper, the app should provide a controlled working
directory containing the AI template contract, user-provided source input, and
only the assets approved for AI access. The helper must not need arbitrary access
to the user's workspace. The app remains responsible for validating helper output
before applying anything to a bulletin.

An externally run helper used through file exchange is outside the app trust
boundary. The app cannot promise that it will not read other files, environment
secrets, or the network; the exchange UI must say so. v1 satisfies AI exchange
without launching a helper process.

The staged app-managed helper launcher may ship only where the platform provides
an enforceable isolation profile. If the profile cannot be established, launch
must fail with guidance to use manual file exchange instead of running with weaker
silent protections.

Managed helper execution requirements:

- Helper profiles are workspace-local and created only through explicit user
  configuration. Imported packs/documents/contracts cannot add or change them.
  A profile stores canonical executable path, SHA-256, fixed arguments, approved
  runtime roots, timeout, and approval time; changed executable bytes require
  reapproval.
- Explicit opt-in and confirmation for every run, showing helper display name,
  executable path, verified hash, requested input assets, and limits.
- The configured helper is an exact executable plus argument-vector template.
  Never invoke a shell, evaluate command text from a document/import, or allow an
  AI file to choose executable/arguments.
- Mount/expose only a newly created owner-only exchange directory containing
  regular read-only input copies and a separate bounded output directory; never
  pass symlinks. The workspace, user home, SSH
  agent, credential stores, browser profiles, and unrelated temporary files are
  unavailable to the helper.
- Deny network access. Use a private empty home/temp area and a minimal allowlist
  environment such as locale and helper-required runtime paths. Remove proxy,
  token, cloud, Git, SSH, keychain, and application-secret variables.
- Run with least OS privilege, no elevation, no child-process escape, bounded
  CPU/memory/file count/output bytes, a five-minute default timeout and
  fifteen-minute hard timeout.
- Cancellation or timeout terminates the complete process tree. Partial output
  remains untrusted and is not applied.
- Accept only the fixed regular file `output/result.ai-import.json`. Attachments,
  symlinks, archives, executables, and every unexpected output entry are invalid
  in v1. A default maximum of 10 MiB applies within the broader resource-limit
  contract.
- Clean exchange directories after result acceptance/rejection, cancellation,
  failure, or expiry—not merely after validation. Retention for troubleshooting
  requires explicit user action and still applies redaction/privacy warnings.
  Valid pending-review run data is journaled and automatically expires after 24
  hours; startup resumes or expires that review deterministically.

Execution logs record exchange id, helper basename/hash, sanitized argument
shape, start/end/duration, exit status, limit/cancel reason, and output hashes.
They exclude environment values, source content, prompts, church data, and raw
helper output by default. Successful helper output remains untrusted, must pass
AI schema/security validation, and changes no document until field-level user
review and confirmation.

Templates intended for AI filling must expose an AI-readable data contract. The
contract should include:

- AI exchange id.
- An exchange-scoped opaque target handle, template field-contract id/version,
  and canonical contract hash. The target handle is mapped to the local template
  only in workspace metadata; it is not a local resource id.
- Template name, description, and intended use.
- Stable field ids.
- Field labels and human-readable descriptions.
- The exact shared field-contract types: `text`, `richText`, `date`, `number`,
  `boolean`, `choice`, `assetRef`, `array`, and `object`.
- Required/optional status, defaults, examples, and validation constraints.
- Formatting instructions, such as date format, capitalization, tone, or maximum
  length.
- Binding metadata describing where each field is used in the visual template.
- An optional approved asset catalog containing only assets with `approved` or
  `public` AI visibility, including portable asset refs, names, media types, tags,
  descriptions, dimensions when available, and any other metadata useful for
  selecting known logos/images.
- Optional AI instructions that explain how a high-level user request should be
  mapped into the template fields.
- Optional sample inputs and expected filled output.

AI-readable contracts must use stable field ids as the authoritative addressing
mechanism. AI tools must not rely on visual element names, display labels, array
positions, or generated Typst when assigning values.

The app should be able to export an AI template contract for a selected template
or resource pack. AI template contracts should use the `.ai-template.json`
extension. The exported contract should contain only the information an AI tool
needs to fill fields and select known approved/public assets. It should not
expose local resource ids, absolute local filesystem paths, or private assets.
Workspace-local exchange metadata must map the exchange id and opaque target
handle to the selected local resource, its revision/hash, canonical base hash for
each exported field value, and the exact portable asset refs that were offered.

AI source input may be pasted text, a selected text document, selected image
files, or selected managed assets. Text and image fields are required for the
first AI-ready templates. Selected source images should be imported or staged
through the app so the helper can reference them without arbitrary filesystem
paths.

An AI data import result should be structured JSON. When exchanged as a file, it
should use the `.ai-import.json` extension. It should include:

- AI import format version.
- The echoed AI exchange id, target handle, field-contract id/version, and
  contract hash.
- Optional exchange-scoped bulletin target handle when updating an existing
  bulletin. It must not be a workspace-local bulletin resource id.
- The original high-level user instruction, when available.
- Field values keyed by stable field id.
- Optional portable asset references drawn from the exported approved/public
  asset catalog.
- Optional unresolved asset requests for assets the AI could describe but not
  choose safely.
- Optional notes, warnings, confidence, or follow-up questions from the AI tool.
- Optional tool metadata for diagnostics.

AI data imports must not contain executable code, shell commands, arbitrary file
paths, unapproved Typst source, or layout mutations. If an AI tool needs to
suggest a layout change, that suggestion should be imported as a note for the
user, not applied automatically. The first supported AI output scope is data
fields only. The schema may reserve space for future user-reviewable editor edit
suggestions, but those suggestions must not be applied automatically.

AI-generated text uses either a plain JSON string or the allowlisted rich-text
AST required by the target field. Raw/escaped Typst markup is never a field value
format. Every plain string is escaped as data during generation.

Import behavior:

- Validate the AI import result before applying it.
- Resolve the target through the workspace-local exchange record and confirm the
  target revision and exact field-contract id/version/hash match.
  If the record is unavailable, require the user to select a compatible target;
  never match a target by display name.
- Compare each current field value with its exported base hash. A changed field
  is a conflict regardless of recorded origin and cannot be silently overwritten;
  the review shows base/current/proposed values.
- Accept an asset reference only when it was present in that exchange's exported
  asset catalog. Unknown refs become unresolved asset requests rather than global
  workspace lookups.
- Show a review screen with proposed field values, missing required values,
  validation errors, warnings, unresolved asset requests, and AI notes.
- Let the user accept, edit, reject, or resolve imported values before applying
  them.
- Apply accepted values by creating a new bulletin from the target template or by
  updating authoritative `fieldValues` with origin `ai`.
- Preserve the original high-level instruction and AI tool metadata for
  diagnostics when available.
- Preserve template layout unless the user explicitly performs normal editor
  layout edits.
- Treat applying an AI import as an undoable document edit.
- Autosave and schedule live preview after the user applies the import.

Resource packs may include AI-ready templates, AI instructions, sample high-level
requests, sample AI data imports, and asset metadata useful for AI selection.

## Custom Elements And Bindings

Custom-element definitions are reusable versioned visual definitions. A
definition contains portable `definitionId`, positive `definitionVersion`,
canonical `definitionHash`, user-facing name, shared `fieldContract`, native
visual `elements` with bindings, optional default placement, and schema-valid
preview field values. Its v1 `breakModel` is the constant `verticalStack`, so
multiple definition roots have the vertical-stack pagination rule; a fixed-height
or `avoid` instance can still suppress those descendant breaks as specified.

A custom-element instance remains one native `type: "custom"` visual element. It
stores a pinned definition id/version/hash and scoped `fieldValues` using the
shared field-value records. The referenced definition revision is an embedded
portable document definition or an explicit bundle/pack dependency; it is never
resolved by display name or silently switched to the latest workspace revision.

Bindings inside the definition use the shared binding model and default to the
instance's field scope. Effective values follow field value, contract default,
binding fallback, then missing. The renderer expands the pinned definition and
resolved values into a transient native render tree. Expanded visual values are
not persisted as a second editable tree.

Editing a custom instance field updates its scoped `fieldValues`. Structural or
literal edits inside the expansion require an explicit `Detach Custom Element`
command that replaces the instance with newly identified native elements using
the current resolved values as one undoable transaction. The detached result no
longer receives definition updates.

## Template And Custom Element Lifecycle

Templates are copied into bulletins when a bulletin is created from a template.
The copied bulletin receives its own local resource id and editable document JSON.
Later changes to the source template do not silently rewrite existing bulletins.

Custom elements have two related concepts:

- Custom element definition: the reusable pinned definition, including shared
  field contract, bindings, visual structure, defaults, preview data, version,
  and canonical hash.
- Custom element instance: an instantiated use of that definition inside a template,
  bulletin, or another reusable structure.

New bulletins copy/pin the exact custom-definition revisions used by the source
template. Pack or library updates never silently rewrite existing documents or
instances. An explicit update compares old/current/incoming definition hashes and
shows field, binding, and visual changes.

A compatible update may add optional fields or non-breaking visual defaults. An
id reuse, removed/required field, type/constraint change, changed binding target,
or structural change that could overwrite a user value requires explicit mapping
and review. Existing manual values win by default; incompatible values move to
the instance's inert orphaned-values map. The update, accepted mappings, and
definition revision switch form one undoable document transaction.

Pack-derived templates/styles/definitions remain pinned to the revision used
until a reviewed update occurs. Retiring pack content cannot delete any revision
still referenced by an instance or document.

## Validation Expectations

The JSON schemas distributed with the app define the valid persisted shape.
Runtime normalization should continue to protect older or partial project files
by filling defaults and migrating legacy layout details where safe.

Validation should reject or normalize:

- Unsafe project names.
- Workspace-local resource ids or storage paths in portable document fields.
- Asset references that resolve outside approved local asset roots.
- Portable asset refs missing from a required bundle/pack asset map, duplicate
  asset-map keys, or one portable asset id associated with multiple binaries.
- Duplicate bundle entry ids, duplicate normalized archive paths, and unresolved
  manifest dependencies.
- Pack content ids reused for a different resource kind within the same pack id.
- Invalid page sizes.
- Invalid or internally inconsistent `page.finalPageCountRequirement` objects.
- Invalid element ids.
- Duplicate element ids within the same complete document.
- Invalid page-level element placement or unsupported page targeting.
- Normal-flow elements that intentionally render outside the content box.
- Rich-text content that contains unsupported blocks, invalid inline marks, or
  unvalidated Typst source.
- AI import files with an unknown exchange/target handle, incompatible
  field-contract identity/version/hash, or asset refs absent from the exported
  catalog.
- AI import field values with unknown field ids or invalid values for the field
  type/schema.
- Negative persisted sizes and spacing where the schema forbids them.
- Unknown properties where the relevant schema sets `additionalProperties` to
  `false`.

A structurally valid page-count requirement does not prevent editing, saving, or
preview. After pagination, a mismatch produces `CBB-LAYOUT-0004`, marks readiness
incomplete, and blocks current/final/approved output while allowing only an
explicitly labeled non-publication draft or historical diagnostic export.

When adding new persisted fields, update the relevant schema, normalization,
editor inspector, renderer, and this spec together.

## Release Staging And Optional Enhancements

The normative release-scope table near the start of this spec is authoritative.
Implementation tracking may also exist in `typst/todo.md`, but that file must not
silently change product scope.

Committed requirements that may be staged after the initial v1 release:

- AI-assisted template filling beyond required file-based AI contract exchange.
- Resource pack creation, export, update, and replacement.
- Tagged/accessible final PDF output.
- Approval/finalization workflow.
- Local AI helper launch and configuration.

Deferred from v1:

- Multiple-workspace management.
- Moving an existing workspace from the UI.

Optional enhancements:

- Synchronize editor scrolling with PDF preview scrolling.
- Drag-to-resize with resized dimensions saved as absolute inches.
- Element alignment controls.
- Multi-element selection and select all.

The user settings panel, margin guide visibility UI, undo/redo, canvas snapping,
strong inspector validation, and faithful grid/stack editor rendering are v1
requirements and must not be tracked as future-only features.
