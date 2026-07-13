# Church Bulletin Builder Spec

This document is the source-of-truth behavior spec for the Typst Church Bulletin
Builder. It describes the JSON document model, editor behavior, and Typst/PDF
rendering rules the app should preserve as new features are added.

## Goals

The builder provides an offline-first, GUI-first desktop workflow for creating
church bulletins and reusable bulletin templates without hand-editing Typst for
normal layout work. Creating, editing, reviewing, building, exporting, backup,
restore, and help remain fully usable without a network connection. Explicitly
configured staged integrations may connect a Shared church library or retrieve a
Scripture passage; neither is required for normal weekly work.

The builder must:

- Make the normal weekly task a protected content-filling and proofreading
  workflow; users must not need to understand or manipulate layout structures to
  replace readings, hymns, announcements, dates, or images.
- Separate the default `Weekly Content` experience from an explicitly entered
  `Customize Layout` experience so routine edits cannot accidentally damage
  reusable structure, page setup, headers, footers, or branding.
- Store all editable layout/content state in JSON.
- Generate Typst source deterministically from that JSON.
- Compile PDFs locally with a bundled Typst CLI and local workspace assets.
- Let non-technical users place and edit elements with predictable visual
  feedback.
- Support pastor, church secretary, and volunteer workflows without requiring
  technical layout or Typst knowledge.
- Optimize the normal weekly workflow around creating a bulletin from a reusable
  template, optionally carrying forward reviewed values from the prior compatible
  bulletin.
- Make interruption, safe resume, stale-content detection, review, backup,
  volunteer handoff, and print confidence first-class product concerns.
- Keep the editor's page, margin, flow, and canvas behavior aligned with the
  rendered PDF wherever practical.
- Keep the complete weekly bulletin workflow local and usable with networking
  disabled. Only an explicitly configured Shared church library connection or a
  user-invoked authorized Scripture provider may make its narrowly scoped network
  requests; failure must not prevent opening, editing, reviewing, exporting,
  backing up, restoring, or closing locally saved work.
- Let an authorized pack maintainer publish a dependency-complete resource-pack
  release to a Shared church library and let subscribers check for and review
  newer releases without synchronizing the rest of the workspace.
- Let volunteers paste and consistently format Scripture offline, with an
  authorized provider connector as an optional convenience, while preserving
  exact wording, source provenance, translation attribution, and rights review.
- Track structured rights metadata for Hymn/Song and Scripture content and
  generate the bulletin's Copyrights & Permissions section from content that
  actually renders.
- Treat church-specific logos, images, templates, starter bulletins, and other
  reusable content as data that can be imported, exported, backed up, and moved
  independently of the application.
- Support optional, reviewable AI suggestions that map selected pastor
  instructions into structured bulletin fields without making AI necessary or
  responsible for layout, pagination, readiness, or publication.

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
| First-run onboarding and generic starter templates | Required v1 |
| Church profile, Song Library, Scripture catalog, and saved sections | Required v1 |
| Weekly Content and Customize Layout modes | Required v1 |
| Create This Week rollover and stale-content review | Required v1 |
| Conditional and repeatable template sections | Required v1 |
| No-code template authoring | Required v1 |
| Margin guide visibility UI | Required v1 |
| Undo and redo | Required v1 |
| Cross-session document snapshots and trash/restore | Required v1 |
| Full-workspace backup and restore | Required v1 |
| Canvas snapping | Required v1 |
| Strong inspector validation | Required v1 |
| Faithful grid/stack editor rendering | Required v1 |
| Direct on-page rich text editing | Required v1 |
| Page thumbnails, zoom, and selection-to-preview navigation | Required v1 |
| Basic drag-to-resize and image crop/focal-point controls | Required v1 |
| Page-level margin elements | Required v1 |
| Folded/booklet workflow | Required v1 |
| Basic two-up print-ready booklet PDF | Required v1 |
| Final page-count publication constraints | Required v1 |
| Review and Export workflow using `printFinal` | Required v1 |
| Resource pack import | Required, may be staged after the core weekly workflow |
| Diagnostic bundle export | Required v1 |
| File-based AI contract import/export | Required, may be staged after manual weekly workflows |
| AI-assisted instruction-to-field suggestions | Required, may be staged after manual template workflows |
| Resource pack creation/export/update/replace | Required, may be staged |
| Shared church library hosted pack publishing, update checks, and pull updates | Required, may be staged after resource pack creation/export/update/replace |
| Offline Paste Scripture formatting and attribution | Required v1 |
| Authorized Bible Gateway Scripture connector | Required, may be staged after offline Scripture formatting |
| Structured Hymn/Song rights and generated Copyrights & Permissions block | Required v1 |
| Tagged/accessible final PDFs | Required, may be staged |
| Persisted approval records and approval history | Required, may be staged |
| Local AI helper launch/configuration | Required, may be staged |
| Multiple workspaces | Deferred |
| Moving workspaces from the UI | Deferred |
| Editor/PDF synchronized scrolling | Optional enhancement |
| Element alignment controls | Optional enhancement |
| Multi-element selection and select all | Optional enhancement |

A feature explicitly labeled `Required, may be staged` may be omitted completely
from an initial release, but any shipped portion satisfies every applicable
validation, transaction, privacy, and security requirement in this spec. Scope
pressure never permits a weaker partial importer, archive parser, or helper
executor. Required v1 template authoring and Customize Layout features are not
implicitly stageable merely because they are advanced workflows.

Shared church library support must not ship as a reduced network importer. It
depends on the complete applicable pack manifest, signature continuity,
quarantine, archive limits, dependency closure, three-way comparison, journaled
update, rollback, and retention requirements. The first supported release has
one publishing authority per connected pack and any number of subscribers;
concurrent multi-author coediting or automatic semantic merge is deferred unless
separately specified. The Bible Gateway connector must not ship without an
authorized provider agreement, supported authentication, translation-specific
rights metadata, and the same local snapshot/review behavior as offline paste.

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
| `richText.schema.json` | Structured rich-text AST used by text fields and rich-text template fields, including structured Scripture passages and source snapshots. |
| `rights.schema.json` | Shared song-work, rights-record snapshot, publication-credit, congregation-license-display, and generated-rights-block policy primitives. |
| `scripture-catalog.schema.json` | Workspace/pack Scripture translation and presentation-preset revision records with portable identity, rights/usage-policy snapshots, provider mappings, redistribution decision, and hashes. |
| `customElement.schema.json` | Reusable custom element definitions and custom element instance metadata, reusing `element.schema.json`. |
| `ai-exchange.schema.json` | File-based AI template contracts and AI import results. |
| `manifest.schema.json` | Resource pack, project bundle, and template bundle manifests. |
| `workspace.schema.json` | Workspace-local registry, resource records, revision state, import provenance, conflict state, installed pack state, Song Library/Scripture catalog records, pack-maintainer drafts, Shared church library connections, and Scripture-provider configuration. |
| `pack-feed.schema.json` | Hosted pack-feed head and immutable-release metadata exchanged by a Shared church library provider; network exchange only, never portable document state. |
| `church-profile.schema.json` | Workspace-local reusable congregation details, preferred output/Scripture/publication-context defaults, Rights & Licenses display records/policy, brand/library references, schedule, favorites, and spelling dictionary. |
| `weekly-work.schema.json` | Private per-bulletin instructions, checklist, rollover decisions, and resume state that never affect rendering. |
| `backup-manifest.schema.json` | Full-workspace backup/handoff contents, hashes, versions, exclusions, restore identity, and verification state. |
| `asset-record.schema.json` | Workspace-local asset metadata, binary revision, media details, sanitization state, and AI visibility. |
| `font-record.schema.json` | Workspace-local managed font family/face metadata, immutable hashes, validation, licensing, and portability state. |
| `settings.schema.json` | Discriminated versioned application-global and workspace editor/export preferences; per-connection choices live only in their connection records. |
| `artifact-record.schema.json` | Build records, generated Typst/PDF records, Scripture normalizer/presentation and generated-rights evidence, diagnostics references, stale state, and approval references. |
| `diagnostic-catalog.schema.json` | Bundled versioned stable diagnostic-code meanings, default severity/disposition, locations, recovery actions, and redaction class. |

`common.schema.json` must define separate, non-interchangeable primitives for
local resource ids, portable asset/font ids and typed references, bundle ids,
bundle entry ids, pack ids, pack-scoped content ids, field-contract ids, document
element ids, content-rule ids, repeat-item ids, history snapshot ids,
Church Profile schedule ids, weekly checklist item ids, backup/handoff ids, and AI
exchange ids, portable song-work/rights-credit/Scripture-translation ids, and
workspace-local Shared library/Scripture-provider connection and pack-draft ids.
Portable schemas must not reference the local-resource-id primitive.
`workspace.schema.json` and
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
- Intended print/digital publication contexts that affect rights readiness but
  not rendered PDF bytes.
- Normal body flow elements and page-level elements.
- Template field contracts, bulletin field values, and canonical field/content
  review dispositions required to preserve readiness.
- Portable authoring policies, conditional/repeatable content rules, and
  template-only sample field values.
- Custom element definitions, custom element instance metadata, and bindings.
- Structured Scripture content/source/rights snapshots, Hymn/Song rights
  snapshots, generated Copyrights & Permissions block policy, and copied
  document rights-review policy.
- Portable asset references and other portable references defined by schema.
- Accessibility semantics that affect final PDF output.

Portable document JSON must not contain:

- Workspace-local resource ids.
- Absolute filesystem paths.
- Local asset storage paths.
- Workspace locks, conflict state, revision tokens, or recovery records.
- User editor preferences.
- Church Profile, private weekly instructions/checklists, resume position,
  uncommitted setup choices, Version History, and Trash state. Canonical
  per-field rollover dispositions needed for readiness are portable document
  state, not workspace-only state.
- Generated Typst, PDFs, thumbnails, diagnostics, build logs, or preview state.
- Installed resource-pack state or local import/update state.
- Shared-library endpoints, connection/authentication state, opaque credential
  references, pack-maintainer drafts, Scripture-provider credentials, or network
  request history.
- Local AI helper configuration or private execution logs.

Workspace-local metadata owns local identity, storage, privacy, operational state,
and derived artifacts. It should include:

- Workspace schema version and workspace id.
- Local resource records for bulletins, templates, assets, fonts, songs/right
  metadata, Scripture translation/preset catalog revisions, resource packs, pack
  drafts, reusable schemas, AI exchanges, and generated artifacts.
- Relative storage paths for app-managed resources.
- Display metadata used by lists, search, sorting, and disambiguation.
- Created, imported, modified, and last-opened timestamps.
- Content hashes, revision tokens, and stale-state metadata.
- Asset binary metadata, dimensions, media type, source provenance, sanitization
  state, and AI visibility.
- Import provenance, bundle/resource-pack remapping tables, and installed pack
  state.
- Shared-library connection role/state, endpoint approval, last-common/observed
  release identities, publish/update outcomes, and opaque OS-credential-store
  references; raw secrets are never workspace metadata.
- Scripture-provider capability/authentication state and Church Profile Rights &
  Licenses data, excluding provider passwords/tokens from JSON.
- Workspace locks, file conflict records, transaction/recovery records, and
  conflict backup references.
- Build records, generated artifact records, diagnostics references, finalization
  records, and approved artifact references.
- User/workspace editor settings.
- Church Profile, private weekly-work records, cross-restart history snapshots,
  Trash metadata, and backup/handoff records.

Versioning rules:

- Every persisted root JSON file must include an integer `version` field.
- Each root schema owns its own version sequence. Document, workspace, settings,
  Church Profile, weekly work, backup manifest, asset record, font record,
  artifact record, manifest, custom element, rights record, Scripture catalog,
  pack feed, and AI exchange versions are independent.
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

The primary experience is:

```text
This Week -> Fill and check -> Edit and proof -> Review and Export
```

The app has two explicit editing modes:

- `Weekly Content` is the default for a bulletin. It exposes fillable fields,
  template-permitted optional/repeatable sections, direct text editing, image
  replacement, the weekly brief/checklist, issue navigation, page preview, and
  export. Template layout, page setup, repeated page elements, and protected
  branding remain locked unless their author explicitly made a control available
  in this mode.
- `Customize Layout` is an intentional advanced mode for creating or changing
  templates and structural layout. It exposes grids, stacks, canvases, page
  elements, dimensions, styles, bindings, ordering, and edit-policy controls.
  Entering it from a bulletin must explain that structural changes affect only
  that bulletin unless the user explicitly saves or updates a template.

Mode is editor state, not rendered document state. Changing modes must never
change PDF bytes, create an undo entry, or silently unlock a protected element.
An ordinary bulletin always opens in Weekly Content after a new app session. If
recovery shows that an interrupted session was customizing layout, the resume
card may offer `Continue layout editing`, but the safe default remains Weekly
Content. Templates open in Customize Layout.

The ideal weekly workflow is template-driven and interruption-safe:

1. `Create This Week's Bulletin` recommends the last-used compatible template and
   also offers other templates, `Use Last Bulletin`, blank, and import as
   secondary choices.
2. The user selects the service label/schedule and may choose a prior bulletin
   with the same field-contract lineage as a carry-forward source. The current
   template structure is used rather than blindly copying an outdated layout.
3. Rollover policies clear, carry, derive, and request review as defined below.
   Only after the source/schedule is known does the user confirm the derived or
   entered publication date and suggested display name. The app warns when a
   bulletin for the same date/service label already exists.
4. The setup form follows the template's groups and order. The user may paste a
   pastor's instructions into the private weekly brief, connect checklist items
   to fields/sections, skip unresolved items, and resume later.
5. The user edits content directly in Weekly Content mode. Layout remains
   protected. AI, when available, may propose field values but is never required.
6. The app presents a stale-content and completeness review, then an authoritative
   PDF preview.
7. `Review and Export` saves the exact revision, runs the selected readiness
   profile, presents the generated artifact and checklist, and exports that exact
   verified artifact.
8. Formal approval may be recorded when the staged approval feature is present;
   its absence does not remove the required v1 Review and Export step.

`Use Last Bulletin` remains available for documents without a suitable formal
template. It duplicates the prior document, assigns fresh local identity, asks
for the new publication date before normal editing, and runs the same rollover,
stale-content, review, and export checks. The UI must explain whether it is using
the current template with prior values or making a complete copy of the prior
bulletin. It never copies prior `fieldReview` or `contentReview`; decisions are
recreated against the new bulletin's date, rules, bindings, and effective
values.

Blank creation, raw duplication, and import are supported advanced/secondary
paths. Generic built-in starters ensure that a fresh installation never opens an
empty template chooser.

### Weekly Brief, Checklist, And Resume

Each local bulletin may have one versioned workspace-local weekly-work record.
`weekly-work/<local-resource-id>/work.json` is authoritative; any registry count,
resume label, or last-position summary is a revision-keyed rebuildable cache. The
record contains:

- A private pasted-text brief titled `This week's instructions`.
- Ordered checklist items. Each has a stable UUIDv4 item id, nonempty text,
  `required` boolean, and `unresolved`, `handled`, or `notApplicable` state. The
  creation control labels `required` as `Must finish before a ready-to-print
  PDF`, defaults it to `true`, and offers `Reminder only`; the status is always
  visible and keyboard editable rather than inferred from wording.
- Optional source evidence containing brief Unicode-scalar start/end offsets,
  cached excerpt, and excerpt hash. Brief edits update offsets when deterministic;
  otherwise the evidence is marked stale while preserving the cached excerpt.
- An optional discriminated link to exactly one document field (scope/field id),
  visual document node id, conditional/repeat rule id, or workspace-local Saved
  Section id. Imported strings can never construct an unvalidated link.
- The most recently active setup step, field, editor selection, page, scroll
  position, and open panel needed to resume work.
- The chosen rollover source and any uncommitted setup choices. Committed
  per-field carry/clear/confirm dispositions live in portable `fieldReview` so
  readiness survives history, transfer, and restore.

This work record is output-inert and is never portable document content. A full
workspace backup includes it by default so recovery is complete, with an explicit
privacy warning and optional exclusion. A handoff includes it only by explicit
opt-in. A bulletin project export may include it as an explicitly selected
private workspace attachment; a template export never does. Any backup, handoff,
or project transfer that would omit a record containing an unresolved required
item is blocked until the user includes the record, handles/reclassifies the
item, or marks it not applicable. Silent omission must never make the receiving
bulletin appear more ready. Weekly work is excluded from diagnostic bundles, AI
exchange, and generated PDFs by default. Sending any part of it to an AI helper
requires an explicit per-run selection.

The app must autosave checklist and resume state independently of PDF builds.
Brief text is covered by the same autosave, bounded recovery snapshot, atomic
write, retry, and five-second crash-loss contract. Selecting brief text offers
`Add checklist item`; users can also type an item and later attach/detach source
evidence or a content link. Weekly-work edits have a local in-session undo/redo
history while focus is in the brief/checklist; they do not create document undo
entries or stale PDF output.

The workspace also keeps private, cross-restart weekly-work snapshots before the
first weekly-work edit in an app session and before clearing the brief, deleting
any checklist item, or restoring another weekly-work version. The user can restore
one from `Instructions and checklist history`; restore first snapshots the
current record. At least the newest 20 automatic snapshots per bulletin are
retained. They follow the same privacy, backup, handoff, Trash, and permanent-
deletion rules as the live weekly-work record and never enter portable document
JSON.

Reopening from the home screen shows a plain summary such as `3 items still
needed` and returns to the last meaningful task. A resolved checklist does not
replace field/schema validation; it is a human workflow aid.

The brief/checklist may be pinned beside setup/Page View at wide sizes and opens
as a focus-preserving drawer/tab at narrow sizes. Navigating to linked content
keeps the supporting source excerpt available and provides a return action.

After Version History restore, contract migration, subtree replacement, or
resource removal, weekly-work links and resume targets are revalidated in the
same transaction. A dangling target is cleared from navigation, preserved as a
plain labeled unresolved reference for review, and never rebound by matching a
name or reused id. It must not make otherwise readable `work.json` invalid.

### Stale-Content Review

Before print-final export, the app runs deterministic stale-content checks. The
review includes:

- Every value whose rollover mode requires confirmation and has not been
  reviewed for the current bulletin.
- Carried or literal date values that conflict with the current publication date
  or a template-declared date role.
- Template-declared placeholder terms and unresolved tokens such as fields the
  template explicitly marks as examples or temporary content.
- Recognized weekly-field placeholders `TBD`, `TODO`, and bracketed replacement
  prompts; users may confirm an intentional literal occurrence for this bulletin.
- Required weekly-brief checklist items that remain unresolved.
- A duplicate bulletin with the same publication date and service label.
- Content inherited from an older complete-document duplicate whose source date
  remains visibly present.
- In `Use Last Bulletin`, unchanged unbound content review targets marked
  `everyBulletin` or `whenDuplicated`. For legacy content without a hint, Date
  and Hymn/Song always require review and other eligible unbound body content
  defaults to `whenDuplicated`; the user can confirm unchanged, edit, or mark a
  clearly persistent item `none` in Customize Layout.

Stale-content findings are warnings unless they also violate a required field or
another final-readiness rule. Each finding must use a user-facing label, show why
it was raised, and provide `Go to content`, `Confirm for this week`, or another
specific resolution. The app must not silently replace a suspected stale value.

## Church Profile, Song Library, And Saved Sections

The workspace provides a user-facing `Church Profile` for information commonly
reused when creating templates and bulletins. It may contain congregation name,
address, contact information, locale/time zone, one or more usual service
weekday/time labels, logo/approved asset refs, brand colors, preferred bundled
or managed fonts, default page/output preset, favorite and last-used templates,
preferred Scripture translation/presentation preset, congregation rights/license
display records, preferred bulletin publication contexts, and an optional local
spelling dictionary. The Church Profile
schema defines a closed set of type-safe `profileKey` values that templates may
offer during creation.

V1 mappable `profileKey` values and field types are closed:

| Profile key | Compatible field type |
| --- | --- |
| `churchName` | `text` |
| `mailingAddress` | `text` |
| `locationAddress` | `text` |
| `phone` | `text` |
| `email` | `text` |
| `website` | `text` |
| `defaultServiceLabel` | `text` |
| `logo` | `assetRef` restricted to supported image media |

Brand colors/fonts, locale/time zone, page/output preset, favorites, dictionary,
service schedules, Scripture defaults, publication contexts, and Rights &
Licenses records are not field-mappable keys; template authoring uses their
dedicated typed controls. The profile root has a canonical revision hash.

Each service schedule has stable UUIDv4 `scheduleId`, nonempty normalized label,
ISO weekday `1` through `7`, optional local `HH:MM` time, valid IANA time zone,
`enabled`, and optional inclusive `effectiveFrom`/`effectiveThrough` date-only
bounds. Overlapping schedules are legal but setup requires user selection when
more than one matches; labels are display metadata, never schedule identity.

The optional Scripture defaults contain a portable `translation:<uuid>` plus
display label from the reviewed local/bundled catalog and a named presentation
preset. The preset controls only reference
placement, verse-number presentation, paragraph policy, translation-label
placement, and visual style; it never supplies or rewrites Scripture wording.
Selecting a default does not grant provider authorization or translation rights.

The optional `defaultPublicationContexts` is a nonempty unique subset of the two
portable document context values. A bulletin from a template copies the
template's contexts; a blank bulletin/new template uses this Profile field or,
when absent, both v1 defaults. Later Profile changes never alter existing
documents.

`Rights & Licenses` stores congregation-level publication information separately
from any song or Scripture work: stable UUID record id, provider/display name,
optional congregation license display number, optional inclusive date-only
`effectiveFrom`/`effectiveThrough`, and private notes. Missing bounds are open;
an inverted range is invalid. It also stores `unknownRightsPolicy` as `review` or `block`,
defaulting to `review`; review requires an explicit final acknowledgement while
block requires complete metadata. Neither policy can waive a required credit
line. A record may also hold an opaque OS-credential reference for a future
reporting integration, but never a password/token in profile JSON. Only a user-
reviewed publication display string is copied into a bulletin rights snapshot.
The effective unknown-rights choice is copied into the new document's portable
`rightsPolicy`; later Profile changes do not change its readiness. Private notes
and credentials never render.

Choosing a publication display compares the bulletin `metadata.publicationDate`
to those inclusive bounds and shows `Valid for this bulletin date`, `Outside the
recorded dates`, `Dates not recorded`, or `Set the bulletin date`. An out-of-range
record cannot be used as current license display until corrected/reviewed;
missing dates require review but do not claim invalidity. The portable copied
snapshot includes exact display line,
bounds, and `sourceDisplayRevisionHash` over only provider label/display line/
effective bounds; Profile private notes, credential refs, and unrelated fields
are excluded. Validity is derived against the current document publication date
and recorded in readiness evidence, never as a drift-prone persisted result. A
later bulletin-date edit re-evaluates readiness locally without changing credit
identity or song association and never consults the live Profile.

The Church Library includes a user-facing `Songs` collection. Each immutable song
revision has a portable song-work id, revision number/hash, title and alternate
title, optional number/source, contributors with roles, optional rich content,
and the structured rights records defined under `Hymn/Song And Rights`. It also
has a separate closed `packRedistribution` decision: status `allowed`,
`prohibited`, or `unknown`; allowed scope `metadataOnly` or `completeEntry`;
the closed `metadataFieldAllowlist` defined under Resource Packs when scope is
`metadataOnly`;
optional inclusive date-only `effectiveFrom`/`effectiveThrough`; and reviewed
basis/source/license id, time, and evidence hash. Status defaults to `unknown`; a
credit line, congregation display license, provider login, or
permission to print one bulletin never implies permission to redistribute the
song in a pack. Users can create, import, search, duplicate, revise, archive, or
move a song to Trash.
Until pack authoring ships, this default record remains internal `unknown` state
and no redistribution question appears in normal Song/right setup. When that
stage is installed, controls appear only after `Share in a church pack` or in the
maintainer's Advanced pack review, never in the weekly insert path.
Inserting a song copies the exact content/rights revision into the bulletin;
later Song Library or pack updates never rewrite a bulletin silently.

The Church Library also owns `Scripture translations & formatting`. Each
immutable `scripture-catalog.schema.json` revision has portable
`translation:<uuid>`, positive revision, canonical revision hash, display label/
aliases, optional verified provider-kind/provider-translation mappings with
catalog/adapter version, and a nonempty rights array whose
`scriptureTranslation` records contain the applicable portable usage-policy/
counter snapshots. It may also contain a named presentation-preset snapshot and
a separate pack-redistribution decision. Credentials, authorization
state, arbitrary provider responses/HTML, and congregation-private notes are
forbidden. A record saved from `Other translation` remains `unknown` until the
user reviews its rights; provider mappings can be added only through a verified
catalog match, never label similarity.

Users can search/select, create/review, archive, or update these records without
technical ids. Any substantive label/rights/policy/presentation/provider-mapping
change creates a new immutable catalog revision and follows credit-key lifecycle
rules. Inserting Scripture copies the exact selected revision's identity, rights,
and policy snapshot; it continues to use the document presentation. A catalog
presentation preset appears only as a separate previewed `Apply this Scripture
format to the bulletin` document edit (or an explicit author-created block
override), never as a silent side effect of passage insertion. Later local/
provider/pack catalog changes never rewrite the document. The same
`(translationId, revision)` with a
different canonical hash is invalid; unrelated side-by-side collisions use the
reviewed whole-closure remap rule.

Church Profile data is workspace-local reusable input, not a live render-time
dependency. Creating a template or bulletin copies the selected values and
portable references into that document. Changing the profile must not rewrite
historical bulletins or existing templates. The UI may offer an explicit reviewed
update for a current template or bulletin and must show every affected value.

The normal UI calls reusable visual content `Saved Sections`. Users can:

- Save an eligible selected section for reuse.
- Insert a saved section from favorites, recent items, thumbnails, or search.
- Rename, duplicate, archive, or move a saved section to Trash.
- Choose `Change only here`/`Make independent` for one inserted instance.
- Choose `Update saved section` only through an explicit review that identifies
  other templates or future insertions affected by the reusable definition.

Custom-element definitions and pinned revisions may implement Saved Sections,
but `custom element`, `definition revision`, `binding`, `detach`, ids, and hashes
are advanced/internal terms. An inserted saved section pins or copies the exact
revision according to the custom-element lifecycle; existing bulletins never
change silently.

Church Profile, Songs, Scripture catalog/presets, rights metadata, and Saved
Sections are part of full-
workspace backup/restore. Their ordinary screens must not expose filesystem paths
or workspace identity.

## Document Library And Weekly Creation

The home view is task-oriented rather than a database table. Its default sections
are `This Week`, `Recent Bulletins`, `Favorite Templates`, and `Recently
Exported`. The primary action is `Create This Week's Bulletin`. A resumable card
shows the publication/service label, last edit time, the next meaningful action,
and one plain-language summary such as `3 items still needed`, `Ready to review`,
or `Ready to print`.

When one unfinished recent bulletin is the likely current service, `Continue
This Week's Bulletin` becomes the primary action and new creation remains
available beside it. The app never guesses between multiple plausible drafts;
it shows them for user choice.

Template cards provide keyboard-accessible `Favorite`/`Remove favorite` actions;
favorites are workspace-local orderable metadata. Recently Exported cards offer
`Open PDF`, `Show in folder`, and `Resume bulletin`. If exported bytes were moved
or deleted externally, the card remains with `File missing`, offers rebuild from
a current matching artifact when possible, and never opens a different same-name
file by guessing.

The complete library remains available under `All Bulletins`, `Templates`,
`Saved Sections`, and `Trash`. Resources remain keyed by local identity, but ids
are never ordinary card content. Normal cards show display name, kind when
ambiguous, publication date, modified time, and one plain-language state.
Approval history, source/provenance, pack trust, conflicts, missing dependencies,
and advanced state details appear under `Details` or `More`, except that a
problem blocking the user's current action is summarized on the card.

A missing/corrupt registry entry remains visible in the complete library with
recovery and diagnostic actions; it is never silently dropped. It does not crowd
the `This Week` view unless it is the current bulletin or blocks a current task.

Baseline library actions are open/resume, duplicate, rename, archive/unarchive,
move to Trash, import, and eligible export. Permanent deletion is available only from Trash
under the trash-retention contract. Recent documents contain the ten most
recently opened distinct local resource ids, newest first; missing registry ids
are pruned. Opening updates workspace-local `lastOpenedAt` without mutating
portable document JSON.

Search indexes display name, description, tags, kind, publication-date text,
source-pack/publisher display names, and derived plain text from bulletin,
template, and Saved Section rich text. Current-document find/replace and
workspace body full-text search are required v1 and remain entirely local.
Inactive conditional content follows the explicitly labeled indexing/find rules
under `Template-Authored Conditional And Repeatable Content`.
Index/query text uses Unicode NFKC plus default case folding; whitespace-separated
query tokens must each match a substring of at least one indexed field. Results
remain keyed by local id even when names are identical.

Advanced filters under `More` cover kind, `draft`/`active` workflow state,
`incomplete`/`ready` primary-output readiness summary, output-specific readiness,
current/stale/unfinalized approval when available,
personal/imported/pack source, publication-date range, and
missing-dependency/readiness state. Sorts include last opened, modified, created,
publication date, and normalized name in useful directions. Bulletin default is
last-opened descending. Template chooser default is source group then normalized
name. Ties resolve by normalized name, created time, then local resource id,
independent of filesystem enumeration.

Workflow and readiness are separate workspace concepts. `workflowState` is
`draft` until the initial setup is completed once, then `active`; it does not
return to draft. Readiness is derived as `incomplete` or `ready` for each
applicable `{ readinessProfile, outputForm }` pair and may be cached in the
workspace registry as `readinessByOutput` only with its input hashes. Cache keys
are the closed tuple rather than a concatenated display string. Folded reader-
order and Booklet-print readiness can therefore disagree without either
overwriting the other.

The home-card readiness summary uses the user's last selected publication target.
Before one exists, it uses `printFinal`/`readerOrder` for standard pages and
`printFinal`/`bookletTwoUp` for folded work. If another common output differs, the
card adds a plain secondary summary such as `Reading-order PDF ready; booklet
needs setup`. An unresolved required weekly-work item makes every final target
incomplete; non-required reminders do not but remain in Review and Export. Thus
clearing a required value or violating a final page-count requirement on an
active bulletin yields `active` plus an incomplete target and stales affected
approval. Readiness that depends on page count is `ready` only when the newest
current verified preview or manual artifact supplies a matching count; a missing
or stale count remains `incomplete` pending pagination.

Archive state is separate workspace-local organization metadata with optional
`archivedAt`; it does not change portable content, readiness, approval, or
artifact currency. Archived items leave the default recent view but remain
searchable under the archived filter and can be restored with `Unarchive`.

Missing/null sort values always follow non-null values in either direction.
Template source groups order personal/imported first, then packs by normalized
pack name, normalized publisher, and `packId`; entries use the stable tie-breakers
above.

Duplicate display names remain legal. Rows add kind, source group,
publication/modified time, and provenance; if still indistinguishable, they show
a short local-id suffix only as secondary support metadata. Accessible row labels
include the same disambiguators.

The template chooser begins with last-used and favorite templates, then generic
built-in starters, personal/imported templates, and installed packs. Cards show
preview, task-oriented output description such as `Full letter page` or `Folded
letter booklet`, modified date, required-item count, and compatibility problems.
Pack publisher/version/trust appears in details. An incompatible template remains
focusable and selectable so its reason and recovery action can be read; it cannot
advance to creation. Bulletins based on a pack can be filtered by that provenance
but are not live pack-managed children.

Weekly creation is transactional:

1. `Create This Week's Bulletin` opens the recommendation/chooser described in
   the primary workflow; blank, raw duplicate, and import are visible secondary
   actions.
2. Choosing a template reserves a local bulletin id and stages normalized
   portable content, contract, bindings, edit policies, source hashes, and pack
   provenance without exposing an ordinary library row. The user selects an
   optional compatible rollover source and Church Profile schedule/service.
3. The app computes any derived-date candidate, then the user confirms service
   label, publication date, and a suggested nonempty display name or explicitly
   chooses `Decide later`. The transaction commits a recoverable `draft` on the
   first field/content/layout edit, `Save and close`, or `Enter bulletin`.
4. The field form follows contract group/order metadata, uses type-appropriate
   controls/defaults, and validates on field commit, step transition, and review.
5. Users may save/close or enter the editor with required fields missing. The
   authoritative weekly-work record stores the current setup step; the workspace
   registry may cache only its revision-keyed resume summary.
6. Missing/invalid required values remain visible, allow autosave and preview,
   and block `finalCandidate`, finalization, and final export.
7. Completing initial setup changes workflow state to `active`; clearing a
   required value later keeps it active but changes readiness to `incomplete` and
   stales any approval.
8. Canceling an unchanged staged creation discards it. Canceling after a change
   offers `Keep draft` (safe default) or `Discard`; discard cleans the stage or
   moves an already committed draft to Trash. A crash recovers a changed stage as
   a clearly named draft and removes a verified unchanged abandoned stage.
   Unnamed/unmodified setup drafts must not accumulate in the main library.

The copied bulletin has no live source-template link or source local resource id.
Bound edits update authoritative field values or use the user-facing `Make
independent` action (`Detach Binding` in the internal model).
AI values remain proposals until reviewed. Autosave, conflict, undo, and preview
semantics are identical to ordinary editor changes, including across restart.

## Offline-First Application And Workspace

The builder is a packaged desktop application for Windows and Linux, including
Arch Linux. A non-technical user should install it once and launch it from a
normal desktop, Start Menu, or app-launcher shortcut.

Distribution formats:

- Windows: signed `.msi` installer.
- Linux: AppImage, `.deb`, AUR package, and native pacman package.

The application bundle includes the editor runtime, pinned Typst executable,
bundled Noto fonts/licenses, JSON schemas, migration logic, generic app resources,
generic accessibility-ready starter templates,
the pinned/app-owned booklet compositor,
and the pinned PDF/UA validator when accessible output ships. The signed release
manifest records their versions/hashes and startup self-check reports missing or
changed required components. The application bundle must not
include church-specific logos, images, templates, starter bulletins, or other
organization-specific content. Church-specific content is imported as resource
packs or created by the user in the application. Generic starters must contain no
denominational, congregation, pastor, address, logo, or organization-specific
content. Required starters cover a simple single-column service, a folded
letter-panel booklet, a simple announcements/news sheet, and a blank
accessibility-ready layout with confirmed page setup. `Accessibility-ready` means the template
captures semantic headings/order/alt prompts; its PDF is not represented as
screen-reader-accessible unless the staged tagged-PDF capability is installed and
passes validation.

On first launch, the recommended path creates a local workspace in the
system-default user data location without showing or requiring a filesystem path.
`Choose another location` is available under Advanced. The app then provides a
short, skippable, resumable setup that asks for:

- Church/congregation name and optional logo/contact details for Church Profile.
- The normal output description in task language: full sheet, folded booklet, or
  another starter/paper preset.
- A preferred starter or supported bulletin/template bundle to import; `Import a
  church pack` appears only when that staged capability is installed.
- Whether to create a practice bulletin and walk through Review and Export.

The user may skip every church-specific question and return later. The first-run
empty state always offers `Use a starter`, `Import a bulletin or template`, and
`Start blank`; it adds `Import a church pack` only when supported. The chooser
lists supported extensions and never implies arbitrary Word/PDF conversion. It
must never strand the user in an empty chooser.

V1 supports one configured workspace at a time. The user may choose its location
during first launch, but multiple-workspace management and moving an existing
workspace from the UI are deferred. When those deferred features are implemented,
the app should support multiple registered workspaces with one active workspace,
and should update its workspace registry only after a requested move succeeds.

Default workspace locations:

- Windows: `%LOCALAPPDATA%/Church Bulletin Builder/`.
- Linux: `${XDG_DATA_HOME:-~/.local/share}/church-bulletin-builder/`.

The workspace is app-managed data. It may be hidden or stored in a location that
users do not normally browse. Normal interaction with bulletins, templates,
assets, PDFs, resource packs, and exports should happen through the
application UI.

The app must provide dedicated full-workspace backup and restore. Individual
project/template exports and resource packs remain useful sharing formats, but
they do not replace a complete backup or volunteer-handoff workflow. The backup
contract is defined under `Workspace Backup, Version History, Trash, And
Handoff`.

Canonical bulletin, template, Church Profile, rights, and reusable-library state
remains local. A Shared church library publish may transmit only the explicitly
selected resource-pack closure. A Scripture request may transmit only the
reference, selected translation, provider-required authorization, and bounded
request metadata disclosed by its action. Neither integration is workspace sync.
The operating-system account and filesystem permissions remain the access
boundary for local workspace data.

### Security Threat Model

Security goals are to preserve document/workspace integrity, avoid unintended
disclosure of local content or credentials, keep imported content from escaping
approved roots or executing code, and remain available under malformed or
resource-exhausting local or network input. The app is offline-first: normal
editing, local-file import, build, validation, export, backup, restore, and help
make no network request. Network requests occur only through an explicitly
configured Shared church library or a user-invoked authorized Scripture provider,
follow the contracts below, and never begin merely because a bulletin was opened.
Imported content, readmes, images, homepage/support metadata, and external links
never initiate a request automatically.

Trusted computing components are limited to the installed/signed app code, its
bundled schema catalog, pinned Typst, booklet compositor, any included validator
binaries, bundled fonts, and OS security primitives after their package hashes/signatures pass
startup or install verification. User confirmation expresses intent but does
not make malformed content safe.

Untrusted input includes every project/bundle/pack/backup/handoff/AI file,
downloaded pack, pack-feed/provider response, Scripture-provider response or
HTML fragment, redirect target, archive name/path, JSON string, Markdown/readme,
SVG/raster image, font, imported PDF/Typst diagnostic, clipboard payload,
filename, metadata field, diagnostic attachment, and helper output received
outside the installed app. It remains untrusted after TLS, authentication, or
signature verification; those establish a service session or publisher
continuity, not content safety.

Authentication secrets and publisher private keys reside only in an OS
credential facility or equivalently protected provider facility. Workspace JSON
may store an opaque reference but never a token, password, cookie, authorization
header, raw invitation, or private key. Secrets are forbidden from document/pack
JSON, command lines, clipboard, ordinary backups/handoffs, logs, diagnostics, and
crash reports. URL query/fragment, authorization material, and unapproved provider
error bodies are redacted.

The optional network client is a narrow broker, not a general URL fetcher. It
receives no arbitrary workspace path; downloads go only to a bounded quarantine
handle, and complex archive/font/image/SVG/PDF parsing continues in the existing
restricted no-network worker. Provider HTML is sanitized to the allowlisted
Scripture model before persistence and is never rendered as browser content.

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
  app may associate `.pak`, `.cbb-backup`, and `.cbb-handoff`, but must not claim
  the generic `.zip` type.

On a supported clean system with networking disabled after acquisition, every
package must launch, create/select a workspace, verify bundled schemas/fonts/
Typst and the validator when the accessible-output stage is included, create a
bulletin, and build a PDF. The smoke workflow covers
paths containing spaces and non-ASCII characters. About/diagnostics reports app,
schema-set, Typst, booklet compositor, generic-starter set, bundled-font-set, and
included validator versions/hashes.

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
is uninstalled. Acquisition/AUR builds may require network access. Installed-app
startup, core editing, validation, and PDF generation remain fully usable
offline; only explicitly enabled integrations may make the bounded requests
defined in this spec. There remains no required in-app network updater.

### Task-Based Product Acceptance

Initial v1 and every release changing weekly editing, setup, review, export,
recovery, or printing must pass recorded task acceptance in addition to unit,
schema, security, and rendering tests.

The primary benchmark uses at least five representative non-technical church
volunteers, a prepared Church Profile/template/prior bulletin, and terse pastor
notes. Without facilitator help, at least four must create the next bulletin,
paste the notes, carry two announcements, omit one optional section, correct a
surfaced stale value, close and resume at the same instruction/field/page, review
the PDF, and export the intended print-ready result. Median completion time must
not exceed 15 minutes. Weekly Content must not expose JSON, Typst, ids, hashes,
bindings, definitions, artifacts, contracts, or build-signature terminology.

A second representative-author benchmark starts from a generic starter. At least
four of five volunteers must, without facilitator help, create/save a template,
make Date/Text/Hymn content weekly fields with rollover behavior, add one optional
section and one repeatable announcement section, protect layout, test the weekly
workflow, and create a usable new bulletin from it in no more than 30 minutes.
The task is also run keyboard-only with a trained keyboard user and with each
screen-reader/platform combination in the release accessibility matrix; a
failure of required non-drag authoring operations blocks release.

A representative rights task uses a prepared bulletin and a supplied passage
copied from Bible Gateway. Without facilitator help, at least four of five
volunteers must use Paste Scripture, verify/correct the reference and translation,
review every proposed exclusion, insert the passage in the bulletin's existing
format, add a Hymn/Song with saved rights metadata, and confirm that Copyrights &
Permissions updates without retyping its credit. They must complete it without
entering Customize Layout, diagnostics, JSON, or provider-technical settings. At
least four finish within 10 minutes with no wrong translation, unreviewed omitted
source fragment, lost wording, or missing/incorrect generated credit. The exact
task is also run keyboard-only and with every screen-reader/platform combination
in the accessibility matrix; a critical content/credit error blocks release.

A representative church-library setup task gives five non-technical church
administrators supplied song title/contributor/component, exact publication
credit, and congregation display-license text. At least four must create/review/
save the Song Library revision and then have a separate
weekly use reuse it without retyping in 10 minutes, with no credential entered in
a publication field and no rights associated with the wrong song.

When Shared church libraries ship, a task-language subscriber benchmark has at
least four of five volunteers connect from a supplied invitation, check, identify
the update/size/source, download, review changes, update, and confirm a prior
bulletin remains unchanged in 10 minutes without exposing endpoints, digests,
signing keys, or manifests. An offline retry variant must end with saved local
content usable and no false success.

When pack authoring ships, at least four of five representative maintainers must
choose supplied reusable content, encounter redistribution review only inside the
pack flow, resolve one allowed complete entry and one metadata-only song, remove
one blocked dependency, inspect the exact closure, and export a valid pack within
15 minutes. No prohibited/private song bytes or congregation license display may
appear in the resulting archive.

Release acceptance also covers:

- Clean install to first useful PDF with a generic starter, without importing a
  pack, choosing a workspace path, opening diagnostics, using AI, or using a
  terminal.
- Complete keyboard-only weekly setup/edit/review/export, including permitted
  repeat-item reorder and image replacement/crop. A separate Customize Layout
  keyboard task covers general create, move, reparent, and resize.
- The accessibility matrix is Windows 11 with built-in Narrator and a
  release-pinned NVDA version, plus Ubuntu 24.04 GNOME with its release-pinned
  Orca version. The release record names OS image, desktop, app runtime, AT
  version, and speech/braille configuration. Tests cover onboarding, Weekly
  Content, rich-text caret/selection/format-state and validation announcements,
  Customize Layout/structure tree, template authoring, Church Library, Review
  and Export, backup/restore, Trash, and Settings.
- Windows and Linux at 125%, 150%, and 200% scaling and the required `900 x 480`
  logical viewport, including 1920x1080 physical display at 200% and 1366x768 at
  100%/125%, with forced/high-contrast colors; no lost controls, clipped dialogs,
  required application-level horizontal scrolling, or lost focus/selection.
- Resume/recovery after normal close, process interruption, autosave failure,
  stale preview, missing image, and accidental Move to Trash within the stated
  crash-loss bound.
- Startup, open, edit, build, export, backup, and restore with networking disabled
  while Shared church libraries and a Scripture connector are configured. Core
  tasks remain usable, opening makes no request unless that library's check-on-
  open opt-in is active, and every unavailable integration reports local work as
  safe without producing a bulletin-readiness error.
- When Shared church libraries ship, keyboard and screen-reader tasks cover
  connect, exact-data disclosure, check, review/update, publish, cancel, retry,
  disconnect, and the unpublished-close reminder. Regression tests cover a
  nonblocking head-only check-on-open with zero archive bytes, declared-size/
  free-space and metered-network review before explicit download, offline/
  timeout/authentication failure, corrupt or over-limit download, invalid
  signature/digest, signer change, equivocation,
  downgrade, incompatible release, update rollback, simultaneous publisher head
  advancement, failed post-publish head verification, and restore-disabled
  connections. No case silently changes the installed pointer or discards a
  maintainer draft. Pack export/publish tests also cover unknown, prohibited,
  before/at/after inclusive effective dates, metadata-only, complete-entry, and
  dependency-narrower redistribution
  decisions and prove no blocked bytes leave quarantine/the device.
- Scripture regression tests cover deterministic normalization across supported
  OS/locale combinations; exact wording and punctuation from approved source
  projection through editor/preview/PDF; formatting-only transformations;
  accessible exclusion and old/new diffs; connector absent/offline/unauthorized/
  failing; translation-catalog and attribution-rule changes; quotation-policy
  counts exactly at and one over each supported limit, including aggregate active
  passages and exact basis-point cross-multiplication with no locale/rounding
  drift; print-only, digital-only, and combined contexts (context-only edits keep
  PDF bytes current but stale readiness, while a reviewed disclosure update may
  repaginate); explicit refresh; post-import modification; and two identical
  passages remaining separate editable content. Paragraph-only wording edits and
  reviewed paragraph-to-verse conversion must change the render hash and stale/
  rebuild the preview.
- When the Bible Gateway connector ships, keyboard/screen-reader tests cover
  Connect/Reconnect/Disconnect, exact host/data/permission disclosure, catalog
  refresh, saved-local-content behavior, and restored `authenticationRequired`
  state. Security tests cover adapter/catalog hash tampering, unapproved API/auth/
  content origins or redirects, credential redaction/revocation, and conditional
  About/diagnostic version reporting.
- Rights-generation regression tests cover the same song used twice, distinct
  arrangements/translations/settings, conditional exclusion, repeat changes,
  content-only and rights-only edits invalidating the two-sided association
  review, custom-element expansion, removal, undo/redo, duplication, Version
  History, backup/restore, and handoff. They verify deterministic deduplication,
  correct source navigation, missing-block repair with page-impact preview, long
  credit lines wrapping/paginating without clipping, publication-license dates
  before/at/after each inclusive bound plus bulletin-date changes, and a handoff restoring the
  selected active Song/rights/translation catalog with all Profile/document
  references closed and no private credential/provenance leakage.
- A transferred bulletin renders its exact saved Scripture and rights snapshots
  with no network, original Song Library/pack, Bible Gateway connection, or
  Church Profile. Provider/profile/library changes never rewrite it silently.
- Long translated UI labels, a Unicode label such as `St. John’s — Comunidad de
  Fe`, duplicate document names, constrained-height dialogs, and dates around
  locale/time-zone boundaries.
- Review navigation for missing weekly content, overflow, low-resolution image,
  leading/trailing blank page, stale preview, and page-count mismatch.
- A real two-sided one-sheet test and complete multi-sheet booklet on a recorded
  printer for each required Letter/half-letter, Legal/7-by-8.5, and A4/A5 pair,
  covering left and right binding across the matrix. The release records PDF
  viewer/version, OS print path, printer model/firmware, driver/version, paper,
  duplex/flip, orientation, and scale settings. Order, side orientation, safe
  inset, fold, covers, and intentional blanks match preview.
- Verified full backup, restore to clean and nonempty destinations, Version
  History and private weekly-work-history restore, private brief/checklist
  recovery, Trash restore, and handoff restore on another supported machine,
  including the unresolved-required-item include/omit gate.

A failed required task is a release blocker even when schema/rendering tests pass.

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
  church-profile.json
  bulletins/<local-resource-id>/document.json
  templates/<local-resource-id>/template.json
  saved-sections/<local-resource-id>/definition.json
  weekly-work/<local-resource-id>/work.json
  assets/<local-resource-id>/asset.json
  assets/<local-resource-id>/original
  assets/<local-resource-id>/canonical
  assets/<local-resource-id>/derived/
  fonts/<local-resource-id>/font.json
  fonts/<local-resource-id>/faces/<face-id>
  songs/<local-resource-id>/song.json
  scripture-catalog/<local-resource-id>/translation.json
  resource-packs/<local-resource-id>/pack.json
  pack-drafts/<local-resource-id>/draft.json
  shared-libraries/<connection-id>/connection.json
  scripture-providers/<connection-id>/connection.json
  artifacts/<local-resource-id>/<build-id>.json
  artifacts/<local-resource-id>/<build-id>.typ
  artifacts/<local-resource-id>/<build-id>.pdf
  preview/
  ai-exchange/
  history/<local-resource-id>/<snapshot-id>.json
  history/<local-resource-id>/weekly-work/<snapshot-id>.json
  trash/<local-resource-id>/trash.json
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
- `church-profile.json` stores the optional workspace Church Profile governed by
  `church-profile.schema.json`.
- `bulletins/<local-resource-id>/document.json` and
  `templates/<local-resource-id>/template.json` are portable document files
  governed by `document.schema.json`.
- `saved-sections/` stores reusable pinned custom-element/Saved Section
  definitions and workspace display metadata.
- `weekly-work/<local-resource-id>/work.json` stores the output-inert private
  brief/checklist/resume record governed by `weekly-work.schema.json`.
- `assets/<local-resource-id>/asset.json` stores workspace-local asset metadata
  governed by `asset-record.schema.json`.
- `assets/<local-resource-id>/original` stores inert source provenance when
  retained. `canonical` stores the exact immutable build-safe bytes identified
  by the portable asset id. Other sanitized/rasterized/generated derivatives
  live under `derived/` and cannot enter a build unless promoted to a new
  canonical portable revision.
- `fonts/<local-resource-id>/font.json` and `faces/` store one managed immutable
  font-family revision and its validated face binaries under
  `font-record.schema.json`.
- `songs/<local-resource-id>/song.json` stores one immutable Song Library
  content/rights revision governed by `rights.schema.json` and workspace display
  metadata. A new content or rights revision is copy-on-write.
- `scripture-catalog/<local-resource-id>/translation.json` stores one immutable
  translation/rights/usage-policy/presentation revision governed by
  `scripture-catalog.schema.json`; credentials and live provider state are
  forbidden.
- `resource-packs/<local-resource-id>/pack.json` stores workspace-local installed
  pack metadata and import provenance governed by `workspace.schema.json` or a
  `$defs` record referenced by it.
- `pack-drafts/<local-resource-id>/draft.json` is the authoritative workspace-
  local definition of a maintainer's selected pack membership and publish
  projection. It contains stable pack id, editable pack metadata, ordered local
  resource/dependency roots, reviewed per-entry redistribution decisions/evidence,
  current projection hash, and optional last published release identity.
  Publishing exports its validated closure as a normal `.pak`;
  the draft file itself is never uploaded.
- `shared-libraries/<connection-id>/connection.json` stores nonsecret connection
  role/state, approved service origin, opaque remote-library locator, preferences,
  release identities, and outcomes. Usable credentials/private keys never appear
  in this file.
- `scripture-providers/<connection-id>/connection.json` stores the nonsecret
  signed-adapter identity/hash, approved provider origins, redacted display/state/
  catalog/outcome fields, and optional opaque OS-credential reference under
  `workspace.schema.json`; usable credentials and response content never appear.
- `artifacts/<local-resource-id>/<build-id>.json` stores the build/artifact record
  governed by `artifact-record.schema.json`.
- `artifacts/<local-resource-id>/<build-id>.pdf` exists for a compile/compose
  artifact that owns new PDF bytes. A `.typ` exists only for a reader-order
  compile. A revalidation record may reference content-addressed bytes/evidence
  owned by its verified source build and need not create either file. A booklet-
  two-up compositor artifact owns no synthetic Typst source and instead
  references its immutable parent reader artifact.
- `preview/` stores temporary live-preview outputs and may be cleaned during app
  startup.
- `ai-exchange/` stores owner-only bounded helper exchange/run state and may not
  expose the rest of the workspace to a helper.
- `history/` stores immutable canonical document snapshots and separately
  privacy-scoped weekly-work snapshots/reasons needed by cross-restart recovery.
- `trash/` stores deletion time, prior library kind/location, dependency
  retention, and restore metadata; moving to Trash does not rewrite portable
  document content.
- `transactions/` stores import/save/pack-update and hosted-publish operation
  journals needed for rollback, idempotent reconciliation, or startup recovery.
- `conflicts/` stores conflict backups created during stale-save, external-file,
  or recovery flows.

Generated Typst and PDFs are derived artifacts. They must be associated with an
artifact record rather than treated as standalone source-of-truth project files.

Project names are nonempty Unicode display labels normalized to NFC, trimmed of
leading/trailing whitespace, and limited to 120 Unicode scalar values. They may
contain ordinary language and punctuation, including apostrophes and periods.
They must not contain NUL, unpaired surrogates, C0/C1 control characters other
than ordinary spaces, or bidi controls that would make a security-sensitive
display ambiguous. Filesystem-forbidden characters are handled only when a name
is expanded into an export filename; they are not a reason to reject the display
label itself.

Project names are user-facing display labels. They do not determine storage
identity and do not need to be globally unique. If duplicate names exist, the UI
should disambiguate them with metadata such as kind, last modified time, source
resource pack, publication date, or service label.

## Resource Identity

Every workspace-managed resource has a stable local resource id. Local resource
ids are used for workspace storage paths, generated artifacts, local references,
and workspace metadata. They are not user-facing names and are never portable
document identity.

Workspace-managed resources include:

- Bulletin projects.
- Template projects.
- Managed assets.
- Song Library revisions and reusable rights metadata.
- Scripture translation/presentation catalog revisions.
- Imported resource packs.
- Pack-maintainer drafts and Shared church library connections.
- Custom element schemas and other reusable library entries when they are stored
  independently.

Identity classes must not be substituted for one another:

| Identity class | Scope and meaning | Persisted location |
| --- | --- | --- |
| Workspace id | App-generated UUIDv4 identifying one workspace. A true workspace move preserves it; importing resources does not copy it into documents. | Workspace metadata and bounded provenance only. |
| Local resource id | App-generated UUIDv4 unique within one workspace. Identifies a bulletin, template, asset record, installed pack, or other managed local resource. | Workspace metadata and workspace storage paths only. |
| Portable asset id | App- or pack-author-generated UUIDv4 identifying one immutable asset binary revision. Its canonical reference form is `asset:<uuid>`. It is not a workspace resource id. | Portable documents, archive manifests, AI asset catalogs, and the workspace asset resolver. |
| Portable font id | App- or pack-author-generated UUIDv4 identifying one immutable managed font-family revision. Its canonical reference form is `font:<uuid>`. | Portable style/font dependencies, archive manifests, and the workspace font resolver. |
| Portable song-work id | App- or pack-author-generated UUIDv4 identifying one logical song/work lineage across immutable content/rights revisions. Its canonical reference form is `song:<uuid>`. | Song Library records, portable Hymn/Song source snapshots, and archive manifests. |
| Portable Scripture-translation id | Catalog- or app-generated UUIDv4 identifying one reviewed translation identity; its canonical form is `translation:<uuid>` and it is never derived from a label/acronym. | Church Profile defaults, Scripture blocks, rights/policy catalog records, and pack metadata. |
| Rights credit id | Portable UUIDv4 identifying one exact rights component/credit lineage; its canonical form is `credit:<uuid>` and identity never derives from title text. | Song/Scripture rights snapshots and generated attribution evidence. |
| Bundle id | UUIDv4 identifying one exported project/template bundle instance for validation and provenance. It is not an update identity. | Bundle manifest and local import provenance. |
| Bundle entry id | UUIDv4 unique within one bundle manifest. Identifies an archive entry independently of its path or display name. | Bundle manifest and local import remap records only. |
| Resource pack id | Publisher-stable UUIDv4 identifying a pack across pack versions. | Pack manifest and installed-pack metadata. |
| Resource pack content id | Publisher-stable UUIDv4 unique within one pack. The pair `(packId, contentId)` identifies one logical pack item across pack versions. | Pack manifest and installed-pack provenance. |
| Pack draft id | App-generated UUIDv4 identifying one workspace-local maintainer working definition for a pack. | Pack-draft and workspace metadata only. |
| Shared library connection id | App-generated UUIDv4 identifying one workspace-local remote relationship and its preferences/outcomes; it is not pack identity. | Workspace/shared-library metadata only. |
| Scripture-provider connection id | App-generated UUIDv4 identifying one workspace-local adapter/authentication relationship; it is not a translation or document identity. | Workspace/Scripture-provider metadata only. |
| Field contract id | Portable UUIDv4 identifying one field-contract lineage across compatible contract versions. | Portable documents, custom definitions, and AI exchanges. |
| Document element id | Identifier for one visual element instance, scoped to a single document. It is not a resource, asset, pack-content, or manifest-entry id. | Portable document JSON. |
| Content-rule id | Identifier for one conditional/repeatable rule, scoped to a document and separate from visual node and field ids. | Portable document JSON. |
| Repeat-item id | UUIDv4 identifying one item in a repeat-bound array, scoped to a document and paired with its value across reorder. | Portable bulletin field-value metadata. |
| Church Profile schedule id | UUIDv4 identifying one stable schedule within a workspace profile; it may appear only as inert derivation evidence in a bulletin. | Church Profile and portable field-review evidence. |
| Weekly checklist item id | UUIDv4 identifying one private task within a bulletin's workspace-local weekly-work record. | Weekly-work JSON only. |
| History snapshot id | UUIDv4 identifying one immutable workspace-local document snapshot. | Version History metadata only. |
| Backup/handoff id | UUIDv4 identifying one backup or handoff archive instance and restore record. | Backup manifest and workspace-local backup history. |
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
exactly one immutable canonical build-safe binary revision. The originally
uploaded source may be stored separately as inert provenance. Changing,
replacing, or regenerating the canonical bytes creates a new portable asset id;
editing display/source metadata does not.

The workspace asset resolver maps each portable asset id to a local asset
resource id and the verified SHA-256 digest of that binary. Asset records store
both identities plus any source-original/sanitizer provenance. The
`<local-resource-id>` segment in workspace paths is always
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
SHA-256 digest, byte size, media type of the canonical build-safe bytes, and
other fields defined by the manifest contract. On import, the app builds a
complete source-entry-to-local-resource map in quarantine before committing any
resource:

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
content. Duplicating a bulletin clears prior `fieldReview` decisions,
`contentReview` decisions, weekly private work, approval/final status, and
current-artifact association, then creates fresh pending review records/source
evidence required by the new date and duplication context. The new copy is a
draft needing date/rollover review and cannot inherit publication readiness
merely because effective values have the same hashes. Duplicating a template
copies sample/default/authoring state but no bulletin review state. Imported
projects and templates always receive new local resource ids when imported as
new copies.

## Document Model

Every project has this top-level shape:

```json
{
  "version": 2,
  "kind": "bulletin",
  "name": "07 05 2026",
  "metadata": {
    "title": "July 5, 2026 Bulletin",
    "language": "en-US",
    "publicationDate": "2026-07-05",
    "serviceLabel": "Sunday Worship"
  },
  "page": {},
  "scripturePresentation": {},
  "rightsPolicy": { "unknownRightsPolicy": "review" },
  "publicationContexts": [
    "printedNonsalableChurchBulletin",
    "digitalNonsalableChurchBulletin"
  ],
  "fieldReview": [],
  "contentReview": [],
  "contentRules": [],
  "pageElements": [],
  "elements": []
}
```

The root `version` identifies the document-envelope format. It is independent of
custom-element `definitionVersion` values and field-contract `version` values.

The `kind` field is either `bulletin` or `template`. Bulletins and templates use
the same layout model; they differ by storage location and user workflow.

`metadata.serviceLabel` is an optional portable user-facing label used to
distinguish multiple services on one publication date. It is not identity. The
weekly duplicate-date warning compares publication date plus normalized service
label when present and publication date alone otherwise.

When a text/choice field declares `semanticRole: "serviceLabel"`, its effective
display value controls the metadata mirror using the same single-transaction,
mismatch-error, and no-guess rules as the publication-date mirror. A choice
stores its stable id in the field but mirrors its current display label into
metadata; changing choice labels is therefore a reviewed contract/template
change.

Creating a bulletin from a template copies the template content into a new
bulletin. Bulletins are not live-linked to the source template by default.

Templates may include a top-level `fieldContract` for manual form filling,
custom workflows, and AI-assisted imports. Bulletins created from templates keep
a copied contract plus `fieldValues`, bindings, and portable `sourceTemplate`
lineage. Legacy top-level `schema` data is migration input and must normalize to
the shared field-contract model.

A template may include output-inert `sampleFieldValues` using the same canonical
value types for authoring/test preview. Samples are visibly identified, are
forbidden on bulletins, are never copied during bulletin creation, and never
resolve as defaults. Converting a sample into a default is an explicit template
edit.

Templates and bulletins may include a top-level `authoringPolicy` inherited by
nodes that do not override it. It is portable, output-inert authoring guidance
with `contentLocked` and `layoutLocked` booleans, both defaulting to `false`.
Native elements own content/style policy; container and page-placement wrappers
own placement policy. Weekly Content mode always protects layout and additionally
honors content locks. Customize Layout may change a lock only through an explicit
undoable action that explains the affected scope. Locks are guardrails, not an
access-control boundary, and never affect PDF bytes.

The `elements` array is the normal body flow. The order in this array is the
order used by the editor, Typst generation, and PDF output.

The optional `pageElements` array contains explicit page-level elements such as
backgrounds, page numbers, headers, footers, and decorative elements. Page-level
elements render independently from normal body flow and may be anchored in page
margin regions when their placement allows it. Missing `pageElements` should be
treated as an empty array during normalization.

The optional top-level `contentRules` array stores the closed conditional and
repeatable presentation rules defined below. Missing rules normalize to an empty
array. Rule ids match the field-id lexical pattern, are unique within the
document's rule namespace, and are not visual node ids.

The optional top-level `scripturePresentation` is the document-wide formatting
authority for Scripture blocks. It contains the formatting fields defined under
`Scripture Import And Formatting`; missing values use that section's exact v1
defaults.
A Church Profile or template may seed it, but profile changes never become a live
dependency. Changing it is one undoable render-affecting document edit that
updates every Scripture block without an override and never changes a passage-
fidelity projection.

The optional top-level portable `rightsPolicy` is readiness-only and contains
`unknownRightsPolicy` as `review` or `block`, defaulting to `review`. Church
Profile/template settings seed it when a document is created: a bulletin from a
template copies the template policy; a blank bulletin/new template uses the
current Profile choice or the v1 default. It is copied state rather than a live
Profile dependency. Changing it is an explicit undoable bulletin/template edit
and never changes displayed credit lines by itself.

The top-level portable readiness-only `publicationContexts` is a nonempty unique
array drawn from `printedNonsalableChurchBulletin` and
`digitalNonsalableChurchBulletin`. It records intended distribution, not PDF
output form: a reader-order PDF may be printed and a print-ready PDF may also be
emailed/posted. New documents default to both unless a template or Church Profile
explicitly seeds another choice. Review and Export asks in task language `How
will this bulletin be shared?` with `Print copies` and `Share the PDF by email or
online`; changing the checked set is an undoable readiness-only document edit.

Bulletin-only portable `contentReview` is an ordered array of closed review
records. Each record has disposition `pending`, `confirmedUnchanged`, `edited`,
or `notApplicable`, stores a `reviewHash`, and identifies exactly one target:

- `{ "scope": "document", "targetNodeId": "..." }` for a stable native node in
  the document/page tree; or
- `{ "scope": "custom", "ownerNodeId": "...", "definitionNodeId": "..." }`
  for one stable node inside the pinned definition of a specific custom-instance
  owner.

The target tuple is unique within `contentReview`; conflicting duplicate records
are invalid. Every record seeded from a template or duplicate retains closed
`sourceEvidence`; it is required while disposition is `pending` or
`confirmedUnchanged` and contains `sourceKind` (`template` or
`bulletinDuplicate`), source document hash, source content-projection hash,
optional source publication date, and an optional source target using the same
discriminated shape. Those portable hashes/dates are explanation and comparison
evidence, not a live link; currentness can be recomputed after transfer without
the source bulletin. Records sort by the canonical target tuple, are output-
inert, and affect readiness only.

A content-review projection contains only review-eligible literal/unbound
content-bearing `data` leaves. A partly bound element excludes its bound leaves
but may still review its remaining literal leaves. Each leaf inherits the nearest
explicit `weeklyReview`; an explicitly hinted descendant is excluded from an
ancestor projection and becomes its own target, preventing duplicate parent/
child prompts. Otherwise the app aggregates sibling leaves with the same
effective hint at the nearest meaningful native node. Inside a custom instance,
the target always pairs the owner instance with the pinned definition node; a
definition node id alone can never merge reviews from two instances. Nodes with
no eligible unbound leaves cannot receive a content-review record.

The `reviewHash` covers target identity, the canonical current resolved content
projection, complete source evidence, current bulletin publication date/service
label, and conditional context. Bulletin creation/duplication seeds `pending`
records for applicable targets; editing an included leaf writes `edited` and
recomputes the record. A projection, source-evidence, date, service, hint, or
conditional-context change invalidates the decision. Templates forbid
`contentReview`; a bulletin duplication never copies its source's decisions.

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
- `authoringPolicy`: optional content/layout lock override inherited from the
  document or containing wrapper.
- `weeklyReview`: optional `everyBulletin`, `whenDuplicated`, or `none`
  authoring hint for unbound content; it affects stale-content review, not PDF
  bytes.
- `data`: type-specific content.

There is no generic persisted `hidden` flag in v1. Output exclusion belongs to a
validated conditional-content rule. Structure-tree collapse/filtering and
selection visibility are ephemeral editor state and never affect output.

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
`constraints`, `semanticRole`, AI instructions, `weeklyBehavior`, and
`profileKey`. A `groupId` must resolve in the same contract. A `profileKey` must
be one of the closed Church Profile keys and its value type must be compatible
with the field. Groups render in group-array order, ungrouped fields render after
them, and field-array order is authoritative within each group. A group may
reference one top-level conditional rule id for matching setup-form visibility;
it cannot declare a parallel inline condition. Required fields used only by an
inactive group do not block readiness. The v1 semantic roles are
`publicationDate` on a date field and `serviceLabel` on a text/choice field, each
allowed at most once per document. Field ids
match `^[A-Za-z][A-Za-z0-9_-]*$`, are stable across label changes, and must not be
reused for a different meaning.

`weeklyBehavior` is a closed object with:

- `rolloverPolicy`: `clear`, `keep`, `ask`, or `deriveConfirm`.
- `reviewExpectation`: `everyBulletin`, `whenCarried`, or `none`.
- For `deriveConfirm`, `derivation` is the closed object
  `{ "kind": "nextScheduledServiceDate", "serviceLabelHint"?: "..." }`, valid
  only for a date field. A hint helps setup but never selects schedule identity.

An absent weekly behavior defaults to `ask`; imported legacy content must not
silently inherit values. A `publicationDate` field must use `clear` or
`deriveConfirm`, never `keep`. A derivation creates a labeled candidate and
always requires confirmation; it must not assume Sunday or use the wall clock as
an unreviewed publication date.

`nextScheduledServiceDate` chooses the user-selected enabled Church Profile
schedule after the rollover source publication date. Without a source it uses the first
match on/after the current date in the workspace display time zone. The setup
shows candidate schedules matching the hint/service label, but labels never
choose identity and confirmation remains mandatory. Multiple matches require the
user to choose one before a candidate is stored.

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

Top-level bulletin `fieldValues` and each native owner-scoped `fieldValues` store
are objects keyed by a field id from their corresponding contract. Each stored
entry contains `value` and `origin`, where origin is `manual`, `ai`, `imported`,
`materializedDefault`, `carriedForward`, `profile`, or `derived`. Origin supports
rollover and conflict handling but does not bypass validation. An omitted field
resolves to its contract default when one exists; defaults need not be copied
into `fieldValues` merely to render.

An array entry used by a repeat rule also contains `itemIds`: canonical UUIDv4
values with the same length/order as the array. Add assigns a fresh id; remove
removes the paired id; reorder moves value and id together. A bulletin
materializes every effective repeat-bound default into `fieldValues` with origin
`materializedDefault` and fresh item ids during creation/setup, before normal
rendering or review. Template authoring previews may use explicitly ephemeral
item identities that never enter a bulletin. A full
document duplicate may preserve item ids because they are document-scoped; a new
bulletin carrying prior array values assigns fresh ids. AI/import replacement
assigns fresh ids unless a validated exchange format explicitly carries the
current ids and passes conflict review.

Bulletins additionally contain portable `fieldReview` as an ordered array, so a
clear/keep/confirm decision survives bundle transfer, Version History, and a
workspace restore without collisions between scoped contracts. Each closed
entry's `target` has exactly one of these shapes:

- `{ "scope": "document", "fieldId": "..." }` for the top-level document
  contract/value store; or
- `{ "scope": "local", "ownerNodeId": "...", "fieldId": "..." }` for the
  stable native element/custom-instance node that owns the scoped contract and
  value store.

The target tuple is unique within `fieldReview`; entries sort by scope, owner node
id when present, then field id. Transient repeated-instance ids and array indices
are forbidden. The remainder of each closed entry contains:

- `disposition`: `kept`, `clearedPrior`, `edited`, `derivedConfirmed`,
  `profileAccepted`, `confirmedUnchanged`, or `notApplicable`.
- `reviewHash`: `sha256:<lowercase-hex>` over RFC 8785 canonical review context:
  the complete target tuple, contract id/version/hash, the stored/default field
  value or `missing`, sorted active binding ids and any target-local fallbacks
  actually used, plus sorted active conditional/repeat rule uses of that field
  and, whenever rollover or review policy requires a decision for this bulletin,
  current publication date/service label.
- Optional inert source publication date and source value hash for explaining a
  carried decision; these never resolve a value.
- For `derivedConfirmed`, required inert `derivationEvidence` with kind, selected
  schedule id/label, Church Profile revision hash, base date/time-zone rule, and
  resulting date. It explains/revalidates the decision but is not a live profile
  dependency after creation.

A review record is current only while its target still resolves to the same
scoped field and its `reviewHash` matches. Any field edit, default/contract/
binding/rule change, owner removal, or conditional activation that alters review
context removes or invalidates the record. Thus `notApplicable` cannot remain
current after its section becomes active even when the underlying value is still
missing. A manual edit writes `edited`; confirming an unchanged carried value
writes `confirmedUnchanged`. Templates must not contain `fieldReview`; a newly
created bulletin begins with records created only by its reviewed setup
decisions.

Effective bound values resolve in this order:

1. A stored, valid `fieldValues[fieldId].value`.
2. The field's valid contract default.
3. The binding's optional schema-valid fallback.
4. Missing, which is a validation result when the field is required.

A binding fallback is target-local and never becomes the field's stored/default
value. Different bindings may have different fallbacks; their ids and only the
fallbacks actually used are part of the field's aggregate `reviewHash` above.

When creating a bulletin with a compatible prior-bulletin source, rollover is
resolved before the setup review:

- `clear` stores no prior value. A valid contract default may still resolve.
- `keep` copies the prior stored value or contract default with origin
  `carriedForward`; review is required when `reviewExpectation` is `whenCarried`
  or `everyBulletin`. A target-local binding fallback is never promoted into a
  field value.
- `ask` presents only the prior stored value or contract default with `Keep`,
  `Clear`, and `Edit` and stores nothing until the user decides. When neither
  exists it presents `No prior value`; target-local binding fallbacks are never
  offered or promoted as a field value.
- `deriveConfirm` produces a value with origin `derived` but no current
  `fieldReview` record until explicitly confirmed.
- A compatible `profileKey` may offer the current Church Profile value with
  origin `profile`; the setup review shows it separately from defaults and prior
  values.

Unresolved `ask` decisions and fields lacking a current required `fieldReview`
record block print-final readiness but not save, close, or preview. Compatibility
requires matching contract lineage and field meaning/type. A contract change
requires a declared compatible migration or explicit reviewed field mapping.

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

#### Template-Authored Conditional And Repeatable Content

Conditional and repeatable content are closed declarative template features.
They are separate from ordinary content bindings and are the only field-driven
rules permitted to affect structure in v1. They must not contain scripts,
arbitrary expressions, arbitrary JSON mutation, or AI-controlled layout changes.
They persist in top-level `contentRules` as a discriminated union with
`kind: "conditional"` or `kind: "repeat"`; unknown kinds are invalid.

A conditional rule contains a unique id, one stable `targetNodeId`, `scope`
(`document` or `item`), a controlling boolean/choice field or item-property path,
and one allowlisted condition: boolean equality, choice equality, or choice
inequality, plus bounded nonempty `activateLabel` and `inactiveLabel` used by
Weekly Content. `item` scope is valid only when the target is inside one repeat
prototype and the path resolves to a compatible property of that repeater's array
item schema. When inactive:

- The target remains in the authoritative template/document tree but is excluded
  from rendered/PDF text, output layout, pagination, and accessible reading
  order. Workspace library search may index it with a visible `Not used this
  week` result label; current-document find has an `Include unused sections`
  option off by default.
- Weekly Content shows an editor-only protected placeholder and the
  template-authored action label, such as `Include Communion this week`; the
  placeholder consumes no persisted/PDF pagination space.
- Required fields whose only uses are within that inactive branch do not block
  readiness.

A missing or null conditional controller is `unresolved`, never implicitly false
and never true because of `does not equal`. Preview excludes the branch and shows
an editor-only `Choose a value` placeholder; final readiness blocks until the
controller resolves or the template provides a valid explicit inactive choice.

The inactive label, such as `Not used this week`, lets the user make that
decision explicitly. A conditional rule is output-affecting
portable document state and must be included in build signatures.

A repeatable rule contains a unique id, an array field, exactly one
`prototypeNodeId` resolving to a native element in the authoritative tree,
item-scope bindings, `emptyState`, a bounded `maxItems`, and
`userReorderable`, plus bounded `itemLabel` and `addLabel`. Weekly Content
provides labeled `Add`, `Remove`, and, when allowed, `Move up`/`Move down`
actions without requiring drag. Array order is authoritative output and reading
order; its `minItems`/`maxItems` constraints govern allowed counts.

`emptyState` is either `{ "mode": "collapse" }` or `{ "mode": "show",
"nodeId": "..." }`, where the node is a static sibling owned by that rule.
That node renders only when the effective array is empty and cannot be another
rule's target/prototype; nonempty arrays exclude it. Empty arrays render according
to the policy; editor placeholders remain output-inert.
Missing arrays are unresolved and block when the field/rule is required. A valid
nullable `null` is treated as empty only when the rule explicitly sets
`nullIsEmpty: true`; otherwise it is unresolved. Rule `maxItems` must be at most
the field constraint maximum when one exists, and the combined minimum/maximum
must admit at least one valid count.

Repeat `itemBindings` are a separate closed binding variant; ordinary element
bindings retain only `document`/`local` scope. Each item binding has a
document-unique id, an RFC 6901 `itemPath` relative to one array item, a
`targetNodeId` resolving to the prototype root or one of its descendants, a
`target` pointer relative to that node, and the same allowlisted deterministic
format/fallback rules as ordinary content bindings. The item path must resolve in
the array item schema and be type-compatible with the target. The pointer may
target only a content-bearing `data` leaf on the declared node, never style,
geometry, children, ids, rule fields, or pagination controls. During expansion it
reads only the current item; editing the rendered target updates that exact array
item/property.

Repeated instances are transient render expansions rather than competing
persisted copies; the prototype node itself is not additionally rendered outside
the expansions. Diagnostic and selection identity is deterministically derived
from the rule id plus the paired stable `itemId`, never the current index; editing
an item updates the corresponding array value. Reordering an allowed repeater
reorders the value/id pairs as one undoable
edit. Only Customize Layout/template authoring may create, retarget, or delete a
conditional or repeatable rule.

A node may be the direct target of at most one conditional rule and the prototype
of at most one repeat rule. Rules cannot target transient repeated-instance ids.
Their dependency/target graph must be acyclic. Resolution first computes field
values, then applies ancestor conditional exclusion in document tree order, then
expands active repeat prototypes in array order; conditional rules inside a
prototype are evaluated independently for each item scope. A rule excluded by an
inactive ancestor is not evaluated for readiness except for the ancestor's
controlling value. These rules make editor, search, pagination, accessibility,
and Typst generation deterministic.

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
is incompatible unless an explicit migration is defined. Changing weekly
behavior or profile mapping increments the field-contract version and appears in
the reviewed diff. Changing a conditional/repeatable rule changes the portable
document revision/hash and appears in template-update review even when field
types remain compatible. Re-import or contract
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
it to the authoritative targeted field-value store with origin `ai` and writes
`edited` to the matching scoped `fieldReview.target`; later imports do not
replace `manual` values unless the user selects those fields explicitly.

## Page Model

The page model defines both the editor page and the Typst PDF page.

- `page.typstWidth` and `page.typstHeight` are the canonical persisted physical
  finished logical-page/panel lengths, never imposed sheet dimensions.
- `page.layoutIntent` is `singlePage` (legacy persisted label shown as `Standard
  pages`) or `foldedBooklet`. It selects standard versus folded setup/review/
  output workflow and initial presentation, but never itself reorders the
  reader-order PDF or limits a standard document to one page.
- `page.width` and `page.height` are derived editor dimensions in pixels, or
  legacy persisted editor dimensions that should be migrated when safe.
- `page.background` is the PDF/editor page fill color and defaults to `#ffffff`.
- `page.marginMode` is `fixed` (default) or `mirrored`; `page.binding` is `left`
  (default) or `right`.
- Optional `page.finalPageCountRequirement` defines a portable blocking
  publication constraint evaluated after authoritative PDF pagination.
- Optional `page.printSafeInset` stores top/right/bottom/left printer-safe review
  guides for standard reader-order pages. It is readiness-only and never clips or
  changes PDF bytes.
- `page.bookletPrintSetup` is forbidden for standard documents. It is optional
  while editing or exporting reader-order output from folded work and required
  before any Booklet-print preview, finalization, or export. When present, it
  stores the authoritative portable two-up sheet/duplex/scale/safe-inset choices.
- Fixed `page.margins.top`, `right`, `bottom`, and `left` define the content box.
- Mirrored margins use `top`, `bottom`, `inner`, and `outer`; their physical
  left/right mapping follows logical page parity and binding direction.

Every new template and bulletin stores an explicit finished logical page/panel
size selected by its starter, template, or plain-language page setup. There is no
congregation-specific global page-size default. Blank creation asks for full
sheet or folded booklet, printer paper/preset, binding/fold when relevant, and
the resulting finished size before final output. A valid Church Profile default
may preselect a choice but the setup shows it for confirmation.

Legacy documents that omit physical dimensions may use the former `7in` by
`8.5in` migration fallback with a persistent `Confirm page size` finding. New v1
documents may not rely on that fallback. Editor dimensions are always derived at
`96px` per inch; for example, `7in` by `8.5in` projects to `672` by `816` pixels.

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

When present, `page.printSafeInset` is a closed object of nonnegative physical
`top`, `right`, `bottom`, and `left` lengths measured inward from the finished
logical page. Page View/Review may show guides and findings, but this
readiness-only setting never moves/clips content or changes reader PDF bytes.

When present on `foldedBooklet`, `page.bookletPrintSetup` is a closed object
containing:

- Explicit landscape `sheetWidth`/`sheetHeight`, with width greater than height.
- `duplexFlip`: `shortEdge` or `longEdge`.
- Decimal `scale` greater than `0` and at most `1`, default `1`.
- `safeInset.top/right/bottom/left/fold`: nonnegative physical lengths. `fold`
  is the protected distance on each side of the center fold.

Let `slotWidth = sheetWidth / 2`. Safe-inset geometry is valid only when
`sheetHeight - safeInset.top - safeInset.bottom > 0`,
`slotWidth - safeInset.left - safeInset.fold > 0`, and
`slotWidth - safeInset.right - safeInset.fold > 0`. Thus the outer and fold bands
leave a nonempty printable region in both slots; equality, overlap, or a band
outside the sheet is invalid. An absent setup leaves reader-order work available
and presents `Set up booklet printing` instead of treating arbitrary defaults as
confirmed.

Document `page.binding` is the only binding authority; booklet setup must not
store a second value. V1 performs no automatic panel rotation. The scaled
finished panel must fit one half-sheet slot in its stored orientation; otherwise
setup is invalid and offers a compatible sheet/panel preset or explicit smaller
scale. Changing this object is a portable document edit that stales only booklet-
two-up evidence, not a matching reader-order PDF: sheet/flip/scale changes stale
booklet render input, while safe-inset-only changes stale readiness but can reuse
identical imposed bytes.

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
The normal UI translates this into a direct summary such as `You need 2 more
pages for this booklet` and may offer the undoable `Add intentional blank pages`
action defined by Review and Export.
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

V1 numeric/length controls accept the bundled UI locale's decimal separator and
display a localized example; ambiguous grouping separators are not accepted in
layout fields. Persisted JSON numbers/length strings always normalize to ASCII
`.` and remain locale-independent.

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
- Grid track definitions: physical lengths,
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
- `verticalAlign`: `top` (default), `center`, or `bottom`. It aligns content only
  when the resolved content box has excess height; it never changes the outer
  box, pagination rules, or reading order.

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
- `scripture`: the structured passage/source/formatting block defined under
  `Scripture Import And Formatting`; it is not an arbitrary nested paragraph
  container.

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
nesting level. For a Scripture block it emits the configured reference/
translation placement and each verse's label/text in canonical order without
using inert source text as a second rendered copy; for `paragraphOnly` it emits
the stored paragraphs in order with no invented verse labels.

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

### Scripture Import And Formatting

The normal UI presents one `Insert Scripture` flow with two capability-aware
sources:

- `Paste Scripture` is required v1, entirely offline, and always available.
- `From Bible Gateway` is required but may be staged. It appears only when an
  authorized provider connector is installed/configured and may use only a
  supported API/provider agreement; webpage scraping is forbidden.

The flow asks for reference and translation, preselects but does not lock the
Church Profile preference, shows the exact passage/attribution and formatted
preview, then inserts only after confirmation. Provider failure offers `Retry`
and `Paste Scripture` and never delays local editing. A provider exposes only
translations authorized for that connection. The app never asks a normal
volunteer to place a Bible website password/token in document, template, pack,
or ordinary settings JSON.

The translation picker lists verified bundled/local catalog records by familiar
label/name; the connector arm limits it further to provider-authorized records.
`Other translation` in Paste Scripture asks for a display label, mints a portable
opaque `translation:<uuid>`, and creates an explicit `unknown`
`scriptureTranslation` rights record. It may be saved as a reusable local/Profile
choice only through reviewed rights/catalog details. A label, abbreviation, or
typed provider name never becomes identity and never fuzzy-matches an existing
translation or credit.

The versioned provider adapter/catalog supplies the exact translation attribution
and every machine-enforceable quotation/reproduction constraint required by its
current authorized contract, such as publication context and verse/word/portion
limits. The insertion review shows the applicable rule and evaluates the proposed
passage; Review and Export re-evaluates aggregate active quotations. A known
prohibited/exceeded use blocks provider insertion or final output with a specific
recovery action. A connector must not offer a translation whose governing policy
is unavailable. Manual paste with unverified policy remains available but creates
an `unknown` rights finding; the app never presents its check as legal clearance.
Verse/word/portion counting uses version-pinned adapter rules and the readiness
report records the policy, counter version, scope, observed value, and limit.

A `scripture` block is closed, discriminated by `structureKind`, and contains:

- `structureKind`: `verseStructured` or `paragraphOnly`.
- User-facing `reference`. It is nonempty for `verseStructured` and any imported
  passage; `paragraphOnly` without import evidence may retain an empty legacy/
  incomplete draft reference with a final-readiness finding.
  `canonicalReference` in the app's documented OSIS-compatible subset is required
  for `verseStructured` and optional for `paragraphOnly`; it is never guessed from
  the display reference.
- `translationId` in canonical `translation:<uuid>` form and user-facing
  `translationLabel`. It is nonempty for known/imported passages; a known mapping
  reuses its verified catalog id and an unlisted manual translation uses the
  minted opaque id above. A
  `paragraphOnly` block without import evidence may preserve an empty legacy
  label, but it still receives an opaque id/unknown rights record and cannot be
  final-ready until corrected/reviewed. Identity is never guessed from display
  text.
- Optional closed `sourceCatalog` with matching translation id, positive catalog
  revision, canonical revision hash, and copied display/source label. It is
  required when insertion claims a known local/bundled/provider catalog record,
  absent for an unsaved `Other translation`, output-inert provenance, and never a
  live dependency.
- A `verseStructured` block has ordered nonempty `verses`. Each has a canonical
  verse id, bounded display label, `paragraphStart`, and ordered inline
  `text`/`lineBreak` children using the shared marks. Verse ids are unique and in
  canonical passage order; `paragraphs` is forbidden.
- A `paragraphOnly` block has ordered nonempty `paragraphs`, each with ordered
  inline `text`/`lineBreak` children using the shared marks; `verses` and verse
  labels are forbidden. It is the valid non-lossy target for reviewed ambiguous
  manual paste and legacy Scripture, not a claim about verse boundaries.
- Optional closed `formattingOverride`; without it the block uses the top-level
  `scripturePresentation`. The shared shape contains `referencePlacement`
  (`before` or `after`), `verseNumberStyle` (`inline`, `superscript`, or
  `hidden`), `paragraphPolicy` (`publisher` or `oneVerse`), nonnegative paragraph
  spacing as a supported physical length, `translationLabelPlacement`
  (`withReference`, `afterPassage`, or
  `hidden`), and optional named typography-preset snapshot. An override is an
  explicit Customize Layout/template-authoring choice, not an import artifact.
  It is a complete materialized presentation snapshot with every v1 field; no
  field-by-field merge occurs. `Make formatting different` copies the current
  effective document presentation before editing, and `Use document formatting`
  deletes the override. Document presentation changes therefore do not affect an
  overridden block. Normalization/hashing always uses the resulting complete
  effective shape; partial overrides are invalid.
- Optional closed `importSnapshot` and a required nonempty `rights` array with at
  least one `scriptureTranslation` record. Missing translation metadata produces
  an explicit `unknown` record; public domain or no displayed-credit requirement
  must be an explicit reviewed record rather than inferred from absence.
- Optional closed `importReview` with disposition `changesConfirmed`, the
  `reviewedFidelityHash` over the reviewed current passage-fidelity projection,
  `reviewedRightsProjectionHash` over ordered `(creditKey,
  creditProjectionHash)` pairs, and review time. It can
  acknowledge a deliberate edit but cannot replace source evidence or label
  edited wording as provider-original.

Missing `scripturePresentation` or missing fields use the exact v1 defaults:
reference `before`, verse numbers `superscript`, publisher paragraphs,
paragraph spacing `6pt`, translation label `withReference`, and no typography
preset (inherit the surrounding resolved body style). Normalization materializes
these values for hashing/rendering without writing them until the next permitted
persistence point.

An `importSnapshot` is a closed `sourceKind` (`paste` or `provider`)
discriminated union and mirrors the block `structureKind`. Both arms contain the
reviewed display reference; canonical reference required/optional under the same
variant rule; translation id/label; required normalizer/importer id and version;
exact sanitized source text; exact verse/publisher-paragraph boundaries for
`verseStructured` or paragraph boundaries/content for `paragraphOnly`; SHA-256
`sourceTextHash`; `importedFidelityHash` over the passage-fidelity
projection at import, and `rightsProjectionHash` over ordered `(creditKey,
creditProjectionHash)` pairs plus source evidence for the exact
block `rights` projection captured at import. The `provider` arm additionally
requires provider id, adapter id/version, requested reference/translation, and
retrieval time; it may contain a validated canonical HTTPS source URL that is
never fetched automatically. The `paste` arm forbids retrieval/response evidence
and provider-verified claims; it may retain a user-supplied source label and inert
validated HTTPS source URL explicitly labeled unverified. An `importReview` is
invalid without an `importSnapshot`. The block's `rights` array is the
only portable/rendered attribution snapshot; the import record does not contain
a second editable copy. Raw provider HTML, authorization data, cookies, and
unbounded response metadata are forbidden. Source text is inert comparison/
provenance; the active variant's `verses` or `paragraphs` remain the only
rendered/editable wording. The passage-
fidelity projection contains `structureKind`, display/canonical reference,
translation id/label, and either ordered canonical verse ids/display labels/
publisher-paragraph boundaries/line breaks/exact verse text or the exact ordered
paragraph-only inline content. It excludes presentation policy, rights, and
provenance.

`Modified after import` is derived by comparing the current canonical passage-
fidelity projection with the stored import hash. It is never a drift-prone
persisted boolean. `Attribution changed after import` is derived by comparing the
current ordered rights projection with the stored import rights hash. Formatting-
only changes do not change either projection. A reference, translation, verse
id/label, wording, punctuation, or capitalization
edit is permitted but creates a visible review finding; the app never describes
it as provider-original afterward. Changing translation id/label also invalidates
the prior translation-rights association; the app requires selection/review of a
matching catalog rights revision or an explicit `unknown` record and never keeps
the old credit silently. `Review source` shows the import/current passage and
attribution diffs and offers restore/refresh or `Keep reviewed changes`. The
latter stores `importReview` for the current
passage and rights projections, and any later change to either invalidates it by
hash comparison.
`Refresh passage` is explicit, shows old/new wording and attribution, and
replaces the snapshot/content/rights only as one reviewed undoable edit. Opening,
previewing, building, and exporting never refetch a saved passage.

Formatting changes presentation and paragraph grouping only. It must never use
AI or another transformation to rewrite, modernize, summarize, correct,
capitalize, or punctuate Scripture text. `Paste Scripture` shows original and
structured results side by side before insert. Ambiguous verse parsing remains
editable in that review rather than silently assigning references. The user may
insert it as `paragraphOnly`; that variant preserves stored paragraphs, ignores
verse-number styling, and uses paragraph spacing while explaining that
`oneVerse` formatting requires reviewed verse structure. `Structure verses`
shows a complete paragraph-to-verse diff and changes variants only after explicit
confirmation as one undoable edit; it never fabricates provider provenance.

Provider HTML/JSON is untrusted, bounded, sanitized, and converted only into this
allowlisted structure. Editorial headings, footnotes, cross-references, links,
ads, scripts, and provider styling are omitted unless an adapter contract
explicitly models and licenses a supported data field; omission is shown in the
preview. Every provider/importer preserves Unicode wording after required NFC and
safe-control normalization and records the transformation version.

Scripture renders as a semantic grouped quotation/section. Reference and
any non-hidden translation label are present in configured reading order even
when visually placed after the passage. `translationLabelPlacement: "hidden"`
omits that label from both visual and assistive passage output; it never removes
the canonical translation id/label, rights record, or required generated
attribution. Visible verse numbers are selectable/accessible text, not decorative
images; hidden verse labels are excluded from visual and assistive output while
canonical verse boundaries remain in the model. Scripture translation rights
contribute to the generated Copyrights & Permissions block below.

### Authorized Scripture Provider Connector

This staged connector has a closed provider trust boundary. Only an adapter
shipped in the signed application or a verified optional component may register
a provider. Its immutable descriptor contains adapter id/version/binary hash,
provider display name, API contract version, fixed approved HTTPS API and
authorization origins, any separately approved content-download origin, allowed
authentication method/scopes, translation-catalog version/hash, and supported
rights/usage-policy/counter versions. A document, pack, backup, handoff, readme,
provider response, or pasted URL cannot install an adapter or add/change an
origin.

The workspace's closed nonsecret connector record contains local connection id,
adapter id/version/hash, copied approved origins, provider/account display label,
state `active`, `paused`, or `authenticationRequired`, opaque OS-credential
reference, last verified catalog identity, last connection/auth outcome/time,
and bounded diagnostic code. Tokens, passwords, cookies, authorization headers,
and raw provider responses are forbidden. API redirects fail unless the signed
descriptor names the exact destination origin; authorization redirects follow
only the descriptor's closed authentication flow, and credentials never go to a
content origin.

`Connect Bible Gateway`/`Reconnect` shows the provider/host, requested account
permission, available-translation/catalog purpose, and data categories future
passage requests may send before leaving the app/signing in. Each `From Bible
Gateway` action separately confirms its exact reference, translation id, adapter
metadata, destination host, and required authorization category before sending.
The app never asks the volunteer to paste an API token into ordinary settings.
`Disconnect` confirms that saved passages/rights remain local, revokes/
deletes the usable credential reference when supported, sets the record paused,
and never removes document/catalog snapshots. Connection, authentication, catalog
refresh, and passage retrieval are explicit user actions; no Scripture request
runs at app/document open or in the background.

Full backup may include this nonsecret descriptor but restore always sets it
`authenticationRequired`, removes any usable credential reference, and requires
the full host/data/permission disclosure again. Handoff excludes it. When the
connector component is installed, About/diagnostics reports adapter/API/catalog/
policy/counter versions and hashes plus redacted state/outcome; absent components
produce no dead weekly control and Paste Scripture remains complete.

### Image

Image elements have `type: "image"` and store image data in:

- `data.assetRef`: portable asset reference in the form `asset:<uuid>`. The UUID
  identifies an immutable asset binary revision and is not a workspace-local
  resource id.
- `data.fit`: `contain` or `cover`.
- `data.focalPoint`: optional closed object with finite decimal `x` and `y` from
  `0` through `1`, defaulting to `{ "x": 0.5, "y": 0.5 }`. It selects the
  preferred crop center for `cover` and has no visual effect for `contain`.
- `data.alt`: optional accessibility text.
- `data.decorative`: optional boolean indicating that the image should be
  treated as decorative/artifact content for accessible PDF output.

Unknown fit values are validation errors and must never silently change
rendering. Legacy `stretch` migrates once to `contain` with a visible diagnostic
because distortion is not supported. Editor Page View, crop preview, and Typst
rendering must resolve the same focal point against the same destination aspect
ratio.

Focal coordinates use the canonical oriented source raster with `(0,0)` at its
top left. For oriented source `W x H` and destination aspect `r = width/height`,
`cover` uses `visibleH=H, visibleW=H*r` when `W/H >= r`; otherwise
`visibleW=W, visibleH=W/r`. The crop origin is
`clamp(focalX*W-visibleW/2, 0, W-visibleW)` and the corresponding y expression.
The renderer carries these decimal values through its crop transform and rounds
only emitted physical lengths by the standard length rule.

Effective raster PPI conservatively uses the floor of visible source pixels in
each axis divided by final printed inches in that axis, then reports the smaller
value. Booklet-print inches include the explicit imposed scale. Replace Image
resets focal point to center by default and offers `Keep current crop point` only
with a preview of the new binary; old alt text/decorative state still requires
review.

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

### Hymn/Song And Rights

Music elements have `type: "music"` and are presented to users as `Hymn/Song`.
Their `data` supports:

- Optional `number`.
- Required nonempty `title`.
- Optional `instructions` describing what worshipers do.
- Optional `source`.
- Optional `richContent` using the shared rich-text AST for permitted hymn/song
  text or service material.
- Optional closed `sourceSong` snapshot with portable `song:<uuid>` work ref,
  source revision/hash, and copied display metadata; it is provenance, not a live
  Song Library dependency.
- Required closed `rightsAssociationReview` with `reviewedSongContentHash`,
  `reviewedRightsProjectionHash`, and review time. The content hash covers
  normalized number/title/source, rich content, and `sourceSong` work/revision
  identity, excluding style, placement, rights, and the review record. The rights
  hash covers the ordered `(creditKey, creditProjectionHash)` pairs. Together
  they bind that exact content identity to that exact rights set.
- Required nonempty `rights` array. A newly created song without known metadata
  receives one explicit `unknown` record rather than silently implying public
  domain.

Each closed rights record is governed by `rights.schema.json` and contains:

- Stable portable `creditKey` in the form `credit:<uuid>`. It identifies one
  exact rights/credit lineage and never derives from a title string.
- Required lowercase SHA-256 `creditProjectionHash` over every substantive
  component/status/work/contributor/credit/display/usage-policy field, excluding
  the hash itself, output-inert provenance/retrieval evidence, and readiness-only
  publication-license effective bounds. It provides exact equality checking, not
  fuzzy equivalence.
- `component`: `text`, `tune`, `arrangement`, `translation`, `setting`,
  `recording`, `scriptureTranslation`, or `other`.
- `status`: `copyrighted`, `publicDomain`, or `unknown`. Public domain must be an
  explicit reviewed assertion; absent metadata is `unknown`.
- Work/title plus optional edition, arrangement, tune, or translation identity
  needed to distinguish the contribution.
- Ordered contributors with nonempty name and closed role (`author`, `composer`,
  `arranger`, `translator`, `adapter`, `publisher`, or `other`).
- Optional copyright year/holder, administrator, license provider, and provider
  song/catalog/reporting id.
- `creditRequiredWhen`: `always`, `renderedText`, or `never`, plus the exact
  bounded `requiredCreditLine` when required. It contains one or more nonempty
  publication lines separated only by normalized LF; other controls are invalid.
- Optional closed user-reviewed `publicationLicenseDisplay` copied from Church
  Profile with provider label, exact `displayLine`, and
  `sourceDisplayRevisionHash` defined above. It
  also contains optional inclusive `effectiveFrom`/`effectiveThrough`; current
  validity/result is derived from document publication date and is not persisted.
  It cannot contain a credential, private note, or account value not explicitly
  approved for publication.
- For a Scripture translation/provider, optional closed `usagePolicySnapshot`
  with provider rule id/version, nonempty `applicablePublicationContexts` using
  the document's closed values, exact numeric quotation constraints when machine-
  enforceable, optional exact
  `requiredPublicationDisclosureLine`, policy-source hash, and portable counter
  id/version. Current passage/aggregate counts are derived rather than stored as
  permission. Each numeric constraint has closed metric
  `verses`/`words`/`passages`/`portionBasisPoints`, scope
  `passage`/`bulletin`/`translation`, and a nonnegative integer limit. A
  `portionBasisPoints` constraint additionally contains basis metric `verses` or
  `words` and the exact positive translation-corpus `basisUnitCount` from that
  policy revision. Evaluation uses exact integer cross-multiplication
  `observedUnits * 10000 <= limitBasisPoints * basisUnitCount`, with no floating-
  point rounding. The pinned counter defines word boundaries and verse/passage
  counting; every operand needed offline is inside the snapshot. Unsupported
  provider rules are never approximated into this shape.

`requiredPublicationDisclosureLine` is the reviewed union of publication text
required across every context listed in that snapshot and is always rendered for
an active applicable record. The generator never filters it from the selected
document contexts. Changing `publicationContexts` is therefore readiness-only:
expanding beyond snapshot coverage blocks until the user refreshes/reviews a
covering rights snapshot, and only that rights-record edit may change rendered
lines/pagination.
- Closed metadata source/revision evidence, optional retrieval time, and source
  hash. Metadata provenance does not itself grant permission.

Different arrangements, translations, settings, or required credit lines require
distinct credit keys. Reusing the same Song Library revision preserves keys.
The provider catalog reuses one stable key for the same Scripture translation/
rights-policy revision, including manual paste when the user selects that verified
catalog entry; an unknown/manual record receives a new key and is never merged by
fuzzy translation-label matching.
Any edit that changes the canonical `creditProjectionHash` mints a new
`credit:<uuid>`; only output-inert provenance/retrieval evidence may change while
preserving a key. The edit, new key/hash, all affected Song rights-association or
Scripture import-review hashes, and source navigation update atomically. Import/
pack collision validation rejects the same key with new meaning; a reviewed
side-by-side unrelated collision remaps the whole incoming typed closure.
Conflicting records with one credit key are invalid. Legacy `copyrightNotice` or
`licenseReference` strings migrate into one preserved `other`/`unknown` record
requiring review; they are not discarded or treated as structured proof.

The renderer produces one semantic grouped Hymn/Song block in that order and
omits empty optional rows; it never displays an unfinished placeholder box.
Rights lines do not render beside the hymn unless an explicit song-specific
instruction is part of content; they contribute to the generated block below.
The normal field labels are `Hymn number`, `Title`, `What worshipers do`,
`Source`, and `Copyright and permissions`. The title/metadata portion stays with
the first rich-content paragraph. Rich content fragments under the normal rich-
text rules; a fixed-height or `breakPolicy: "avoid"` ancestor may suppress that
break as defined by pagination rules.

Inserting from the Song Library or a pack copies the exact content/rights
revision as one undoable edit and immediately shows `Copyright details included`
or `Needs copyright information`. Editing copied rights changes only that
bulletin unless the user explicitly updates a Song Library revision. An existing
or finalized bulletin never changes because a central song/pack record changes.
Changing either the song-identity/content projection or rights projection without
reviewing the pair makes the applicable reviewed hash stale, preserves the old
metadata for comparison, and shows `Review copyright details`; it never silently
associates that credit with newly titled/replaced content. Confirming the
association or completing a rights edit updates both hashes only after the exact
content/credit review as one undoable edit.

### Copyrights And Permissions

The native element `type: "rightsAttribution"` is presented as `Copyrights &
Permissions`. It stores only heading, optional introductory text, visual style,
closed `groupOrder`, sort policy, and whether explicit public-domain lines are
included. `groupOrder` is a no-duplicate permutation of `scripture`, `music`, and
`other`, defaulting to that order; v1 sort policy is only `firstAppearance`.
`scriptureTranslation` maps to Scripture, the text/tune/arrangement/translation/
setting/recording components map to Music, and `other` maps to Other. Generated
credit rows are a derived projection and must never be persisted as a second
editable copy.

Generation traverses only the resolved content that actually renders after
bindings, conditional exclusion, repeat expansion, and custom-element expansion.
It collects Hymn/Song rights and Scripture translation-attribution snapshots,
applies `creditRequiredWhen` (`always`, only when governed text renders, or
`never`) against that resolved source. For each active record, the displayed-line
projection is, in order, the LF-separated exact stored `requiredCreditLine` lines
when applicable, its exact
`usagePolicySnapshot.requiredPublicationDisclosureLine` when present, and its
exact `publicationLicenseDisplay.displayLine` when present. Identical
nonempty lines within one record collapse; identical publication-display lines
from different records collapse only when their text and
`sourceDisplayRevisionHash` match, while retaining all source navigation. The
generator never composes a
credit from contributor/account metadata. When block policy includes public-
domain items, an explicit `publicDomain` record with no stored line may instead
emit the app-owned localized status form `<work title> — Public domain`; it is
labeled as status, not invented permission or a publication credit. An unknown/
incomplete record still creates a readiness finding even when it cannot safely
generate a line. The generator deduplicates by identical `creditKey` plus
`creditProjectionHash` and keeps
different arrangements/translations/credit lines separate. Within each configured
group, default order is first rendered occurrence, then component rank
`scriptureTranslation`, `text`, `translation`, `tune`, `arrangement`, `setting`,
`recording`, `other`, then `creditKey`. The generator and ordering version are
pinned and recorded in build evidence.

Removing, undoing, or conditionally hiding a contributing item removes only its
derived contribution; repeated use of the same revision produces one credit.
When no contribution remains, the element collapses to zero output height and
does not affect pagination. Generated rows are read-only. `Edit copyright
details` navigates to each source item; users may edit only block heading,
introductory text, grouping/order policy, public-domain policy, and style.

At most one `rightsAttribution` element may be active in the resolved bulletin.
Generic starters include it in a suitable end-matter location, collapsed when
empty. If a template lacks one, adding the first attributable item offers `Add
Copyrights & Permissions` with placement and pagination preview; the app does not
silently insert a layout-changing element. Required credits without an active
generated block prevent final output.

The exact resolved contribution set, publication-license display snapshots,
generated lines, and generator version are render-affecting. Missing/unknown
rights decisions and imported-Scripture modification state are readiness-
affecting. Attribution metadata never implies permission, validates a user's
license, or completes CCLI/One License reporting; the normal UI says so wherever
rights are edited or reviewed.

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

A wrapper may carry an `authoringPolicy` layout-lock override for its placement.
It never controls the wrapped native element's content lock and never affects
rendering. Page-placement wrappers use the same placement-lock rule.

Deleting a nonempty container in Customize Layout must never discard descendants
without naming that consequence. The UI offers `Delete section and contents` or,
when the parent can accept every child deterministically, `Keep contents`. The
chosen removal/unwrap, id/wrapper normalization, selection, and validation are one
undoable transaction. Weekly Content cannot delete protected containers.

### Grid

Grid elements have `type: "grid"` and arrange child elements into rows and
columns.

Grid data includes:

- `data.rows`: minimum row count.
- `data.columns`: column count.
- `data.rowTracks`: optional row track sizes.
- `data.columnTracks`: optional column track sizes.
- `data.cellPadding`: legacy/current uniform gap/gutter value.
- `data.rowGap`: optional row gap; when absent it inherits `cellPadding`.
- `data.columnGap`: optional column gap; when absent it inherits `cellPadding`.
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

Editor and Typst rendering must apply resolved row/column gaps identically.
Setting either explicit gap is a normal v1 layout edit; `cellPadding` remains the
backward-compatible uniform fallback and must not be applied in addition.

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
onto the next PDF page. `data.intent` is `flowBreak` (default) or
`intentionalBlank`.

A `flowBreak` renders the ordinary `#pagebreak()` behavior. An
`intentionalBlank` ends the current content page when necessary, creates exactly
one complete blank logical page, and begins following content after it; at the end
it creates one trailing blank. Page View and sheet preview label that page
`Intentional blank page` with an editor-only control to remove/change intent.
Intent is portable, included in page count/build signature, and prevents that
specific blank from being reported as accidental. Migrated/consecutive legacy
breaks remain `flowBreak` and continue to receive leading/trailing/consecutive
warnings until explicitly confirmed.

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

Normal page-level creation uses task actions: `Add header`, `Add footer`, `Add
page number`, and `Add background`, followed by `Apply to` choices such as all,
first, odd/even, range, or specific pages. Region, anchor, offset, layer, and
z-index live under advanced layout controls. Selecting a repeated source shows a
persistent chip such as `Editing footer on all pages`; deletion, conversion, or
retargeting names its full scope before commit.

## Flow Layout

Top-level elements are rendered in linear order. Normal flow elements render as
Typst blocks. `margin` emits vertical spacing before and after the block when
greater than zero.

Flow width is resolved against the page content box. Fixed widths wider than the
content box are not silently clamped by the renderer. Interactive controls may
offer the largest valid width before commit with visible feedback; an imported or
otherwise persisted oversized width remains the user's value, produces
`CBB-LAYOUT-0001`, and blocks final build until an explicit undoable resize fixes
it. Percentage and `auto` widths are preserved.

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
| Hymn/Song | Metadata stays with the first content paragraph; rich content otherwise follows normal rich-text break points. A Hymn/Song without rich content is unbreakable. |
| Copyrights & Permissions | Breakable between generated credit entries; its heading stays with the first entry and each entry stays together when it fits on a fresh page. Credit text wraps and is never clipped. An empty block has zero output height. |
| Grid | Breakable only between rows. A row and all of its cells are unbreakable in v1. |
| Vertical stack | Breakable between children and within a breakable child. |
| Horizontal stack | Unbreakable as one row. |
| Canvas | Always unbreakable and limited to one content area. |
| Flow page break | Ends the current content page before the next top-level flow element and renders no content. |
| Intentional-blank page break | Ends the current content page when necessary, emits one complete labeled blank logical page, then begins following content on the next page. |
| Page-level placement | Never paginates; it is clipped to its target page/region. |
| Custom element | Expands as its declared v1 vertical-stack break model; breakable between expanded roots and within breakable roots. Unknown/ambiguous models are invalid. |

Only the breakable content identified by the matrix fragments: auto-height text,
grids, vertical stacks, the rich-content portion of Hymn/Song, generated
Copyrights & Permissions between its credit entries, and custom-element
expansions through their declared vertical-stack break model. Hymn/Song,
Copyrights & Permissions, and custom elements delegate to those stated break
points rather than introducing a competing rule. An explicit fixed-height outer
box is unbreakable unless its type schema defines fragment semantics, and an
unbreakable ancestor suppresses descendant break points. Intended image cropping
through `fit: cover` and explicit page-region clipping are not overflow; clipped
semantic text or normal-flow content is.

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
their containing layout box. Interactive edits reject an invalid commit or offer
an explicit visible `Use maximum size` correction that becomes the persisted
undoable edit. Existing/imported values are preserved with an error marker and
exact correction; they are never mutated merely by open/preview. Draft/final
build disposition follows the readiness matrix and unresolved overflow always
blocks final output.

Page breaks are valid only as direct members of the top-level `elements` array.
They are invalid in grids, stacks, canvases, custom-element expansions, and
`pageElements`. Consecutive/start/end legacy `flowBreak` elements may create blank
logical pages but remain unconfirmed and produce validation warnings. A confirmed
blank uses one `intentionalBlank` element and is excluded from accidental-blank
warnings while remaining visible in review.

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
- A `flowBreak` expands only through the remainder of the current content page.
  An `intentionalBlank` additionally displays exactly one complete following
  page labeled `Intentional blank page`, matching the persisted/PDF behavior.
- Facing presentation pairs logical pages according to the folded-output
  contract and uses clearly editor-only blank slots; it never inserts document
  pages or changes pagination.

Editor-only pagination spacers are not persisted in JSON and must not affect
Typst generation.

Margin guide visibility is only a view preference. Hiding margin guides must not
change the page content box, pagination, element clamping, generated Typst, or
PDF output.

## Application UI And Frontend Design

These requirements govern the application interface, not the visual design of a
bulletin. Normal weekly work must not expose or require knowledge of Typst, JSON,
workspace paths, resource ids, bindings, hashes, or build internals.

### Information Architecture And Editing Modes

Primary application navigation is:

- `This Week`: the default landing view and current resume/create action.
- `Bulletins`: current, recent, archived, and trashed bulletin documents.
- `Templates`: template selection, creation, testing, and management.
- `Church Library`: Church Profile, Songs and rights, Scripture translations &
  formatting, Saved Sections, images, fonts, and other congregation-owned
  reusable content. When installed,
  `Shared libraries` appears here for hosted pack connections.
- `Settings` and `Help`.

Resource-pack provenance/trust, diagnostics, raw AI exchanges, workspace paths,
and other administrative information remain available under `Details`,
`Advanced`, or `Diagnostics`; they must not dominate the weekly workflow.

The current editing mode is always visibly named. Weekly Content permits the
content operations defined by the template while protecting layout. Customize
Layout exposes the palette, structure/layers tree, page setup, placement,
resize, style, and authoring-policy controls. A disabled control must state
whether the current mode, a template lock, selection type, validation condition,
or unavailable staged feature is responsible and offer the applicable next
action. The complete weekly setup, proof, and export flow must be possible
without entering Customize Layout.

### Responsive Desktop Layout And Scaling

A logical pixel is an OS-scaled application coordinate. The complete weekly
workflow must remain usable in a `900 x 480` logical-pixel content viewport and
at 125%, 150%, and 200% operating-system scaling on every supported Windows and
Linux platform.

At wide sizes the app may show navigation, structure/editor, inspector, and PDF
preview together. As space narrows, secondary panels collapse into labeled
drawers or tabs. Collapsing, reopening, or moving a panel must preserve its
selection, focus target, scroll position, uncommitted control text, and document
state. Facing Page View may present one page at a time when the viewport cannot
show a useful pair; that responsive presentation must not change the configured
view or document.

Normal weekly work must not require application-level horizontal scrolling. A
page or PDF surface may pan horizontally only after deliberate zoom beyond `Fit
width`. Text, controls, dialogs, menus, and status messages must not clip or
overlap at supported sizes/scales. An over-height dialog keeps its title and
actions reachable while its body scrolls. No required action may exist only on
hover.

### Direct Content Editing

Editable bulletin text must be editable in place with identical content/keyboard
semantics on Page View and Contiguous View.
Clicking editable text places a caret at the indicated content; `Enter` or `F2`
begins editing a keyboard-selected text element. `Escape` ends the direct-edit
session and returns focus to the element without undoing committed text.
Autosave, validation, preview refresh, and unrelated rerendering must not
unexpectedly move the caret, collapse the selection, or steal focus.

A contextual toolbar exposes every v1 rich-text operation supported by the AST:
paragraph, semantic heading level, bold, italic, bulleted list, numbered list,
block quotation, and `Insert Scripture`. Controls
reflect mixed and active selection state. Conventional `Ctrl`/`Cmd+B` and
`Ctrl`/`Cmd+I` shortcuts work without conflicting with application undo/redo or
native text movement. Paste follows the sanitization contract under `Text` and
is one undoable edit.

Bound text edits update the authoritative field value. Locked or computed text
remains selectable and copyable but is never silently detached; the UI explains
its source and offers `Make independent` only when permitted. Continuous typing
may form meaningful undo groups; formatting, paste, focus change, or a pause
boundary ends the current group.

Invoking rich formatting on unbound canonical plain content first converts it to
the equivalent one-paragraph rich-text AST as part of the same undoable command.
A property bound to a `text` field cannot silently change type; rich controls are
disabled with an explanation. Customize Layout may offer `Convert weekly field
to rich text`, which performs a reviewed contract/binding migration and preserves
the plain value as equivalent rich text.

Activating an editable date uses the same accessible date control as its setup
field and shows a live formatted example; ordinary users never need to type date-
format tokens. Activating an editable image uses the Replace/Adjust Crop actions
below. These direct controls update the authoritative bound value when present.

The editor provides fully offline spellcheck with `Ignore`, `Ignore all`, and
`Add to church dictionary`. The private dictionary belongs to Church Profile
and full-workspace backup. Find and replace works across editable text and field
values in the current bulletin, previews replace-all matches, and skips locked
or computed content with an explanation. Neither feature may make a network
request. One confirmed replace-all is one validated undo/autosave transaction.

Overflow/clipping markers are attached to the affected on-page content and name
the problem. They offer only valid actions such as `Allow automatic height`,
`Resize in Customize Layout`, `Move to next page`, or `Go to issue`; they must not
imply that a clipped preview is ready to publish.

### Scripture And Rights Assistance

`Insert Scripture` is available from Add, the rich-text toolbar, and compatible
rich-text weekly fields. The required offline flow asks for reference,
translation, and pasted passage text, then shows source text beside the normalized
bulletin preview, recognized verse/paragraph structure, every non-whitespace
fragment proposed for exclusion, effective document Scripture presentation, and
translation credit lines that will contribute to Copyrights & Permissions.

Users can correct parsing without entering Customize Layout. `Back`, `Insert`,
translation/reference controls, exclusion decisions, and the complete source-
versus-preview comparison are keyboard/screen-reader operable. Parsing completion
and errors use polite announcements without moving focus. Ambiguous content
falls back to an editable clean-paste preview and is never discarded by guess.

When the staged authorized connector is present, `From Bible Gateway` replaces
only the paste-acquisition step; it uses the identical sanitizer, structure,
preview, rights snapshot, and explicit insertion transaction. The action shows
that the requested reference/translation will be sent. It never sends the
bulletin, pastor notes, Church Profile, or unrelated content. Missing/expired
authorization, rate limits, offline state, or provider failure keeps `Paste
Scripture` available and leaves the document unchanged.

`Add Hymn/Song` searches the Song Library first and shows number/title/source
plus plain status `Copyright details included`, `Public domain`, or `Needs
copyright information`. Creating a one-off song asks only for the weekly content
first, then offers three clear rights choices: `Add copyright details`, `I have
confirmed this is public domain`, or `I don't know yet`. The last choice creates
the explicit unknown record and visible review task; it never blocks saving or
closing. The rights form leads with the exact publication credit line and an
optional reviewed Church Profile license display, with component identities,
contributors, catalog ids, provenance, and policy evidence under `More details`.
It states that attribution/license numbers do not establish permission.

Placing a saved song copies its content and rights in the same transaction and
announces where its credit will appear. If the document has no active Copyrights
& Permissions element, the inline task offers `Add at end` and a page-impact
preview; dismissing it preserves the finding for Review and Export. Editing a
copied song offers `Change only this bulletin` by default and a separately
reviewed `Save a new Song Library revision` action.

Insertion into a compatible bound rich-text field updates that authoritative
field. It never silently converts a plain-text field or detaches a binding. The
passage, import snapshot, rights records, review evidence, autosave, and preview
refresh form one undoable document transaction. Reimport/refresh shows an
accessible textual old/new wording and attribution diff before replacement.

Selecting a Scripture block shows `Edit passage`, `Review source`, `Use document
formatting`/`Make formatting different`, and `Edit attribution`. `Review source`
shows the exact import/current diff and, as applicable, `Restore imported
content`, `Refresh passage`, or `Keep reviewed changes`; the last action records
a review of the current passage/rights hashes without changing the original-
source claim. Selecting
a generated Copyrights & Permissions row shows subject, rights status, source
count, and `Go to source`; generated credit text is selectable/searchable but
never directly editable. Long credit lines wrap and paginate rather than clip.

### PDF Preview And Page Navigation

The generated PDF preview is visually and semantically distinct from editable
Page View. It provides page thumbnails, current/total page count, previous/next
page, `Fit page`, `Fit width`, and explicit zoom from 25% through 200%. Zoom,
thumbnail selection, and preview scroll position are view state and never affect
output.

Every thumbnail has an accessible name containing page number, current/stale
state, blank/intentional-blank status, and finding count. Review also provides a
page-by-page textual outline of ordered semantic content and findings. Booklet
sheet preview has an equivalent textual map, for example `Sheet 1 front: page 8
left; page 1 right`, including back-side rotation/flip instructions.

A textual/semantic review does not claim to prove visual appearance. Final review
records `visualReviewMethod` as `self` or `assisted`; a user may complete the
visual check with a trusted sighted reviewer while independently completing all
keyboard/screen-reader validation and content-order tasks. The UI must not imply
that automated or textual checks certify aesthetics or accurate descriptions.

The preview always communicates one of `Updating preview`, `Preview current`,
`Preview out of date`, or `Preview failed`. A stale preview remains inspectable,
but a persistent banner or overlay inside the frame states that it is the last
successful result; color or a toolbar badge alone is insufficient. A failed
refresh never replaces the last successful preview.

Selecting editable content or activating `Go to field`/`Go to item` from a
finding opens the relevant editor location and brings its PDF page into view when
a current or stale source map is available. This selection-to-preview navigation
is required even though continuous synchronized scrolling is optional. Preview
controls and state labeling remain available when preview is a narrow-screen tab
or drawer.

### Inspector And Validation Interaction

The inspector groups ordinary controls under `Content`, `Layout`, `Appearance`,
and `Accessibility`; `Content` is the default in Weekly Content. Uncommon and
technical controls are collapsed under `Advanced`. Page setup shows one editable
`Finished page size`, page color, margins, layout/fold choice, and binding.
Derived editor-pixel dimensions are implementation details, not a second page
size.
For folded documents, `page.binding` is labeled `Booklet opens on` or `Spine
side`, never simply `Binding`, so it cannot be confused with a linked weekly
field.

Controls are type-appropriate: repeatable rows for arrays, grouped child fields
for objects, labeled choices, asset picker/replace, and locale-safe date input.
Physical lengths use familiar presets plus a visible unit selector; raw unit
syntax remains available under Advanced. Date formatting provides named presets
and a live example, with raw format tokens under Advanced.

Appearance controls show Church Profile brand colors and recent document colors,
permit an exact accessible color value under Advanced, and preview managed fonts
using their actual faces. Contrast findings update before commit without
silently altering the chosen bulletin colors.

Inspector and setup controls use an edit buffer. Validation runs when a control
is committed, loses focus, changes setup step, or is reviewed; the app must not
announce an error for each intermediate keystroke. Syntactically unparseable
control text remains visible/editable and in recovery state but does not replace
the last canonical value or trigger autosave/build as document data. A parseable
committed value may enter canonical JSON with a semantic finding. Each committed
change is one undo transaction unless continuous editing applies.

Unparseable edit buffers are durably bounded under
`transactions/edit-buffer/<local-resource-id>/` with control identity and base
revision. Panel navigation preserves them. Closing the document/app offers `Fix
now`, `Keep recovery text`, or `Discard`; the safe default keeps the buffer and
startup/reopen offers restoration only when the base control still exists and its
canonical value has not conflicted. Backup/final export requires buffers to be
committed or explicitly discarded and never silently omits typed recovery text.

An error appears beside its control, identifies the problem in plain language,
and suggests correction. Review separates blocking findings from confirmation
items and provides keyboard-operable navigation. Navigation opens the necessary
panel, focuses the control/content, and brings the affected page into view.
An error summary may receive focus after an explicit step/review action but must
not steal focus during ordinary typing or blur validation.
Required, invalid, warning, success, and disabled states use text/icon/state as
well as color; required controls use a textual indication rather than only an
asterisk, and a disabled control exposes its reason.

### Structure And Layers View

Customize Layout includes a keyboard-accessible tree covering body, nested
containers, and page-level items by layer. Rows use user-facing names/types rather
than wrapper ids. Selection synchronizes with editor and inspector. The tree
supports expand/collapse, select, add before/after, duplicate, move before/after,
move into/out of a container, delete, and permitted layer/order changes without
dragging.

Clipped, overlapped, content/layout-locked, conditionally inactive,
decorative/artifact, and repeated page-level nodes remain discoverable. Their
state is shown and announced with text, not color alone. Selecting a repeated
rendered instance selects its source and announces the page as transient context.
Persisted authoring policy and conditional output state must be distinguished
from ephemeral selection, hover, collapsed-tree, clipping, paint-order, and page
context.

### Image Interaction And Resize

Selecting an image prominently exposes `Replace image`; a `cover` image also
exposes `Adjust crop`, while a `contain` image offers `Crop to fill` and previews
the fit change before committing. The inspector also shows
thumbnail, display filename, layout dimensions, fit, effective print resolution,
alt text, and decorative choice. Replacement uses managed-asset import/library,
preserves placement/dimensions/style, and asks the user to review whether the
prior alt/decorative choice still describes the new bytes.

`Adjust crop` previews the exact `cover` crop at destination aspect ratio and
updates `data.focalPoint`. A keyboard-operable focal-point control or numeric x/y
controls produces the same result as dragging. Missing-image placeholders remain
selectable and offer `Find replacement` at the point of failure.

In Customize Layout, resizable images, canvas children, and page-level elements
have visible handles. Dragging previews resolved size, respects model/page/
container bounds, and commits physical dimensions as one undoable edit. Images
preserve aspect ratio by default with an explicit unlock where independent
dimensions are supported. Labeled width/height inspector controls provide the
same result for keyboard users. Grid gutters may be resized visually when their
track model permits it; common equal/two-column presets remain available.

For placed raster images, Review and Export shows effective pixels per inch after
crop and scaling. A default warning is raised below 150 effective PPI; the
diagnostic explains that vector images are not evaluated this way and lets a
user replace, resize, or explicitly acknowledge the print-quality risk.

### Application Design System And Language

The application uses a documented design system with semantic tokens for app
color, typography, spacing, control size, focus, borders, elevation, and status.
App theme is independent of bulletin output. Navigation, buttons, fields,
rich-text controls, tabs, trees, dialogs, banners, toasts, progress, empty/
loading/error/disabled states, and destructive confirmations are defined for
light, dark, and supported high-contrast/forced-color modes.

Primary, navigation, status, and destructive actions use visible text labels;
icons supplement rather than replace them. Compact conventional formatting
controls may use symbols only with accessible names, state, and tooltips. A
destructive confirmation names the item and consequence, focuses a safe default,
and never relies on generic `Are you sure?`. A toast may acknowledge success but
is never the only location of an unresolved save, conflict, preview, validation,
or export failure.

Normal UI uses task language. These mappings are normative examples:

| Internal concept | Normal UI language |
| --- | --- |
| document/project | Bulletin |
| custom element/definition | Saved section |
| binding | Linked weekly field |
| detach binding | Make independent / Change only this item |
| resource pack / hosted feed | Shared church library / Details |
| push/pull synchronization | Publish changes / Check for updates / Update shared library |
| `rightsAttribution` | Copyrights & Permissions |
| build/artifact | Update preview / Create PDF / PDF |
| `draft` profile | Draft PDF |
| `printFinal` + standard reader-order output | Print-ready PDF |
| `printFinal` + folded reader-order output | Reading-order PDF — email/screen/archive |
| `printFinal` + folded imposed output | Booklet-print PDF — print two-sided and fold |
| `accessibleFinal` profile | Accessible PDF |
| readiness incomplete/current | Needs attention / Ready to print |

JSON pointers, schemas/contracts and hashes, local/portable/wrapper ids, artifact
signatures, and raw diagnostic codes remain hidden from ordinary screens. They
may appear in copyable Advanced diagnostics but never replace plain-language
summary and recovery.

### Application Accessibility

The supported desktop UI must conform to WCAG 2.2 AA where applicable and expose
correct roles, names, descriptions, values, states, hierarchy, and focus through
each platform accessibility API. Focus is visible/logical, restored to the
invoking control after a dialog/drawer, and preserved when responsive panels move
or collapse. Save, preview, validation, import, and export status changes are
announced without repeatedly interrupting text entry.

Every create, reorder, move, placement, crop, and resize operation required for
normal work has a labeled non-drag action using the same validation, identity,
undo, autosave, and preview semantics as pointer interaction. Keyboard-only users
can complete setup, edit, replace/crop an image, resolve findings, review pages,
and export each supported output.

The UI supports reduced motion and forced/high-contrast modes, never communicates
state by color alone, and remains usable at 200% scaling. Pointer targets are at
least `24 x 24` logical pixels; primary and frequent editor controls should be at
least `32 x 32`. Automated checks plus keyboard-only and screen-reader task tests
on both Windows and Linux are release acceptance requirements.

### Onboarding And Offline Help

The app includes a skippable first-bulletin tour, contextual help beside template,
margin, image, and booklet controls, an offline searchable task-based help center,
and a plain-language glossary. Normal help calls the workspace `Your bulletin
library`; filesystem language appears only in advanced settings/diagnostics.
Help must be usable with networking disabled and cover first bulletin, weekly
rollover, stale-content review, template creation, backup/handoff, accessible
authoring, Paste Scripture/source review, song rights/Copyrights & Permissions,
Review and Export, and one-sheet booklet test printing. When Shared church
libraries ship, it also covers connect/disconnect, publish versus check/update,
offline behavior, close reminders, update review, and conflict recovery without
instructing volunteers to edit endpoints, manifests, or workspace files.

## User Settings

User settings are editor preferences, not document content. Application-global
and workspace roots are separate versioned variants of `settings.schema.json`.

The application-global root is
`%APPDATA%/Church Bulletin Builder/app-settings.json` on Windows and
`${XDG_CONFIG_HOME:-~/.config}/church-bulletin-builder/settings.json` on Linux.
It uses `{ "scope": "application" }`; workspace `settings.json` uses
`{ "scope": "workspace" }`. Both include independent integer versions.

Application-global settings include UI language/theme, window state, the active
workspace registration, the bounded previous-library return record created only
by restore, and defaults for editor view/snap, export filename pattern, and
display time zone. Workspace settings contain optional overrides for those
editor/export/time-zone defaults. Portable document page setup, layout intent,
language/locale, publication date, final page-count requirements, and every
value that can change PDF bytes or publication eligibility remain in document
JSON.

A user settings panel exposing the v1 settings below is required in v1.

User settings should not be stored in project JSON unless they intentionally
change the document output. Page setup values such as page size, page color, and
margins are project settings, not user settings.

Editable user settings:

- Application UI language from the bundled supported locale set.
- Application theme: `system`, `light`, or `dark`. This never changes bulletin
  page colors or PDF output.
- View mode: `contiguous` or `page`. Controls whether the drag-and-drop editor
  shows one continuous flow or the scroll-based Page View. `page` is the default
  for new workspaces; Contiguous View is available under advanced view controls.
- Page View presentation: `single` or `facing`. Facing is the default for a new
  document whose `page.layoutIntent` is `foldedBooklet`.
- Preview zoom default: `fitPage`, `fitWidth`, or an explicit percentage from 25
  through 200. Per-document current zoom/scroll remains resume state.
- Margin guide visibility: `true` or `false`. Controls whether Page View draws
  top, right, bottom, and left margin guides. Margins continue to constrain
  layout even when guides are hidden.
- Live PDF preview: `true` or `false`. Controls whether edits automatically
  trigger live preview builds.
- Advanced `Technical PDF details`: `true` or `false`. Controls whether bounded
  build/validator details are expanded in Diagnostics; it is not a normal weekly
  setting or primary status label.
- Canvas snap: `true` or `false`. Controls whether canvas child movement snaps
  to a grid.
- Canvas snap grid size: positive length. Controls the snap interval when canvas
  snapping is enabled.
- Export filename pattern, default `{date:YYYY-MM-DD} {name}.pdf`.
- Offline spellcheck enabled and Church Profile dictionary management.
- Workspace display time zone: valid IANA zone id; it never changes date-only
  fields or portable PDF output.

Shared-library preferences are workspace-local and keyed by connection id, but
their single authoritative persisted copy is the applicable
`shared-libraries/<connection-id>/connection.json` record governed by
`workspace.schema.json`; the Settings screen edits that record and
`settings.json` must not duplicate them.
`checkOnOpen` defaults to `false`; a newly confirmed publisher connection's
`remindOnClose` defaults to `true`. There is no silent auto-download or auto-
install setting in the first release. Connection identity, role, authorization
state, last-common release, and outcome are operational metadata rather than
portable settings.
Scripture-provider configuration exposes capability-gated `Connect Bible
Gateway`, `Reconnect`, redacted provider/account/host/catalog status, and
`Disconnect` under the signed-adapter disclosure contract, but never a stored
credential value, editable arbitrary origin, or option to fetch passages
automatically.

User settings should stay with the local application/workspace, not with an
imported or exported project bundle. Opening an imported project should use the
current workspace's settings for editor view mode, margin visibility, live
preview behavior, and canvas snapping.

Workspace defaults seed new portable documents only. Changing a default does not
alter existing document output. An absent workspace override inherits the
application default; the effective value is never written into a document merely
because it was read.

Workspace creation seeds display time zone from a valid detected system IANA
zone, otherwise `UTC`. `page.layoutIntent` seeds the initial presentation until
the user explicitly chooses `single` or `facing`; that view preference remains
output-inert and never changes the document's standard/folded workflow intent.

## Drag And Drop

The palette creates new elements. Existing elements can be reordered or moved
between supported containers in Customize Layout. Weekly Content exposes only
template-permitted repeatable/conditional content actions, not general drag/drop.
Every supported move below has the labeled structure-tree/menu alternative
required by Application Accessibility.

Supported moves:

- Palette element into top-level flow.
- Existing top-level element reorder within top-level flow.
- Palette element or existing top-level element into any container.
- Container child from any container into any other container.
- Container child from any grid, stack, or canvas back into top-level flow.

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

- Page setup: one editable Finished page size, page color, margins, layout/fold
  choice, and binding. Derived editor pixels are view/zoom implementation detail.
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
a `Cycle selection` command moves through overlapping ancestors/siblings. Its
platform shortcut must not conflict with the OS/window manager and it is also
available from a labeled menu.
The keyboard-accessible structure/layers view can select any node regardless of
overlap or clipping. Repeated page-level content selects its source placement;
the rendered page number is context only. Conditionally inactive,
content/layout-locked, clipped, or artifact nodes remain discoverable with their
distinct state announced; none is generically described as hidden.

Committed, parseable inspector edits update the JSON model, rerender, autosave,
and schedule live PDF when enabled only if `renderInputHash` changes; readiness-
only edits refresh findings without recompiling. Syntactically incomplete/unparseable control
text stays in the transient/recovery edit buffer and must not replace canonical
JSON until commit, as defined by `Inspector And Validation Interaction`.

Keyboard behavior:

- `Delete` invokes the permitted removal action unless page setup is selected;
  protected or nonempty-container cases follow their explanation/choice rules.
- Arrow keys move a selected canvas child by the snap interval when snapping is
  enabled, otherwise by `1/96in`, independent of zoom.
- `Shift` plus an arrow key moves it by ten times that interval.
- Arrow keys inside text inputs keep their normal text-editing behavior.
- Font-size arrow controls increment or decrement the selected font size.

## Accessibility Requirements

The desktop editor UI must meet the `Application Accessibility` contract above,
including WCAG 2.2 AA where applicable, platform accessibility APIs, scaling,
focus, status announcements, and non-drag alternatives for every core operation.

Accessible-document authoring help is required v1 even when tagged PDF export is
staged:

- Inserting/replacing an image asks the user either to describe it or mark it
  decorative; the choice can be deferred but remains visible in review.
- Heading controls distinguish semantic level from visual size and warn about a
  skipped level without silently rewriting it.
- Creating a grid asks whether it is layout or tabular data. Table choice guides
  header rows/columns and summary entry.
- Canvas/page content provides a reading-order review with numbered overlay plus
  a keyboard-operable list when semantic and paint order differ.
- Appearance controls warn when configured text/background colors do not meet
  the app's WCAG contrast guidance; visual meaning must never depend on color
  alone.

Tagged/accessible final PDF output is a committed requirement that may be staged
after the initial v1 release. When implemented, tagged PDF output must include a
meaningful reading order and semantic structure for headings, paragraphs, lists,
tables, figures, page numbers, and decorative artifacts where those concepts are
represented by the document model. Live preview PDFs may omit tags and make no
accessibility claim; every `accessibleFinal` manual build/export must contain the
required tags and pass the accessible-output validation contract.

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
| Scripture/blockquote | Grouped quotation/section with reference and any visually included translation label in configured reading order; a hidden translation label remains represented by its generated rights attribution, not invisible assistive-only passage text. A visible/raised verse label remains semantic inline text followed by a natural separating space; visual raising never changes extracted/spoken order. |
| Copyrights & Permissions | Semantic heading followed by grouped sections and selectable plain-text paragraphs/list items in generated display order. |
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

The Scripture source/normalization preview and refresh diff expose additions,
removals, exclusions, ambiguous parsing, and selected fragments through text and
accessibility state rather than color. Generated credit lines remain selectable,
searchable, contrast-compliant text, wrap under scaling, and paginate without
truncation. Each generated editor entry's accessible name contains subject,
rights status, and contributing-source count; `Go to source` moves focus to the
named Scripture or Hymn/Song item.

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

The editor must maintain undo/redo for document-editing actions in the current
run. Cross-restart recovery is provided separately by Version History snapshots;
the in-session undo stack itself need not serialize across reloads.

Undoable actions should include:

- Element insertion, deletion, duplication, and reorder.
- Moving elements into, out of, or between containers.
- Inspector edits to page setup, element fields, style fields, wrapper fields,
  and type-specific data.
- Direct rich-text edits and formatting.
- Scripture paste/provider insertion, source-review confirmation, refresh,
  wording edits, and document/passage presentation changes.
- Hymn/Song rights edits and insertion/configuration of the generated Copyrights
  & Permissions element; derived row changes are part of their source edit and
  never a second undo action.
- Image replacement, crop/focal-point changes, and alt/decorative changes.
- Drag or inspector resize, grid-gutter resize, and authoring-policy lock changes.
- Conditional-section decisions and repeatable-item add/remove/reorder.
- `Make independent`, no-code field creation, and template-authoring changes.
- Canvas child movement by drag, inspector edit, or arrow keys.
- Container child placement changes.

Actions that should not create undo entries:

- Selection changes.
- Weekly Content/Customize Layout, Page/Contiguous, and panel-view changes.
- Preview zoom, page navigation, thumbnail selection, and scroll changes.
- Margin guide visibility changes.
- Live PDF toggle changes.
- Technical PDF detail visibility changes.
- Manual save/build commands that do not otherwise change the document.

Redo history should be cleared whenever the user performs a new undoable action
after undoing. Consecutive text edits in the same inspector field may be grouped
into one history entry when they are part of a continuous edit.

Undo/redo must restore the document JSON and rerender the editor. It should also
restore the most relevant selection when possible. After undo or redo, autosave
and preview/readiness refresh follows the same render/readiness-hash rules as any
other document edit.

Keyboard shortcuts:

- `Ctrl+Z` or `Cmd+Z`: undo.
- `Ctrl+Shift+Z`, `Cmd+Shift+Z`, or `Ctrl+Y`: redo.

Undo/redo shortcuts inside text inputs should preserve normal text-editing
behavior while the input itself owns the edit. Once an inspector field commits a
document change, that committed change should be undoable by the editor history.

Duplicating an element or subtree assigns fresh ids to every duplicated visual
node, wrapper, binding, conditional/repeatable rule, and other id whose namespace
is document-unique. It rewrites references within only the duplicated closure and
preserves immutable portable asset/font refs. It never copies scoped field/content
review decisions to the fresh targets; applicable content targets receive new
pending source evidence and scoped fields require their own current decisions.
The duplication is validated as a complete staged edit before commit and is
exactly one undo transaction; it must never rely on later duplicate-id repair.

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

Every legacy Scripture block migrates to a current discriminated variant. Only
legacy data already carrying valid canonical verse ids/order becomes
`verseStructured`; all other blocks become `paragraphOnly`, preserving display
reference, translation label (including empty), paragraph order, inline wording,
marks, and line breaks exactly. Migration reuses a translation id only for a
verified exact catalog mapping and copies that catalog's exact rights revision;
otherwise it transactionally mints one opaque `translation:<uuid>` and one
`credit:<uuid>` rights record with component
`scriptureTranslation`, status `unknown`, `creditRequiredWhen: "never"`, the
preserved translation label or editor-only `Translation not recorded` subject,
and computed `creditProjectionHash`, with no invented credit line. It omits
`importSnapshot` and `importReview`, never
fabricates Bible Gateway/provider provenance, retrieval evidence, exact-source
claims, attribution, canonical references, or verse boundaries, and persists
allocated ids/hashes idempotently before removing legacy fields. Missing labels/
reference and paragraph-only structure receive the readiness actions below while
the exact legacy content remains available for edit/preview; any presentation
change follows the output-affecting migration review below.

Every legacy Music element migrates once to the structured rights contract. If
`music.data.copyrightNotice` and/or `licenseReference` is nonempty, their values
join in original field order with an explicit LF into one newly minted
`credit:<uuid>` record with component `other`, status `unknown`,
`creditRequiredWhen: "always"`, preserved `requiredCreditLine`, and computed
`creditProjectionHash`. If both are empty/absent, migration still creates one
new `other`/`unknown` record with `creditRequiredWhen: "never"` and no invented
credit text. It computes a current `rightsAssociationReview` pair for the exact
legacy song content/rights while unknown status continues to require review.
The migration persists allocated keys/hashes transactionally before removing
legacy fields, so retry cannot mint a second identity or create competing
sources. Existing templates/bulletins never receive a rightsAttribution element
silently; generic starters include one, and attributable legacy content without
one receives the same previewed corrective action as newly added content.
Documents without `rightsPolicy` normalize to `{ "unknownRightsPolicy":
"review" }`; the next permitted persistence writes that portable default rather
than consulting the current Church Profile.
Documents without `publicationContexts` normalize to both closed nonsalable
print/digital values; the next permitted persistence writes that portable default
rather than inferring intent from output form or the current Church Profile.

Before an output-affecting migration is persisted, the app creates a verified
pre-migration Version History snapshot, shows a plain-language impact review
including possible pagination/font/image changes, and requires confirmation.
Schema normalization that only fills output-equivalent defaults may persist with
the next ordinary save but still records its migration version.

Documents with a newer unsupported root version open read-only with warnings and
`Export original` unless that newer version explicitly declares a compatible,
bounded feature contract the app fully understands and can round-trip. Unknown
output-affecting behavior must never be treated as inert merely because unknown
fields can be preserved. If the app cannot safely inspect/preserve the original,
loading fails with an informative error rather than stripping data.

Saves must be atomic. The app should write to a temporary file in the target
directory, validate the written content when practical, and replace the previous
file only after the write succeeds. Failed saves must leave the previous valid
document intact and show an actionable error.

Generated Typst/PDF becomes visually stale when `renderInputHash` changes, not
merely whenever output-inert canonical JSON changes. Readiness evidence becomes
stale when `readinessInputHash` changes. The app tracks both and recompiles or
revalidates before export as required. A visually stale live preview must not be
presented as current output.

Validation outcomes:

- Hard errors: display names that violate the bounded Unicode label contract,
  invalid resource ids, unreadable or
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

The app autosaves canonical document/workspace JSON after edits. Generated Typst
is derived build input: live-preview Typst remains ephemeral and persisted manual
Typst belongs only to its immutable artifact record. Manual saves normalize the
project through the local storage layer but do not create a standalone current
Typst source file.

Persistence, rendering, and readiness use distinct hashes:

- `canonicalRevisionToken` hashes complete normalized portable document JSON and
  drives optimistic save/conflict/Version History identity.
- `renderInputHash` hashes the deterministic resolved render projection plus
  output-affecting assets, fonts, tools, locale, and output options. The projection
  materializes effective values/rules and excludes schema-declared output-inert
  state such as authoring policies, source lineage, orphaned values, template
  samples, field origins/field/content review records, stable UI item ids,
  Scripture source URL/retrieval/raw-source evidence, rights provenance/Song
  Library lineage, and unknown inert preservation data. It includes current
  Scripture `structureKind`, the active `verses` or `paragraphs` render
  projection, and effective presentation; Hymn/Song displayed content; the
  active generated-rights contribution projection/lines/order, block policy, and
  attribution-generator version.
- `readinessInputHash` hashes the render input hash plus the selected readiness
  profile, final page-count and printer-safe/readiness-only output settings,
  current `fieldReview`/review context,
  weekly/content-review expectations and current `contentReview`, dependency
  validation, required private-work acknowledgements, Scripture import/source
  review, the portable document `rightsPolicy`, required/unknown/conflicting
  rights findings, current Hymn/Song rights-association reviews, generated-block
  coverage, current document publication date plus each copied publication-
  license effective-bound/result evaluation, every active canonical
  `usagePolicySnapshot`, the complete selected `publicationContexts`, counter/
  policy versions,
  resolved active passage/aggregate count inputs and evaluation result, and
  permitted warning acknowledgements.

Shared-library remote freshness, connection status, observed head, and
unpublished-draft status are operational workspace metadata. They never enter a
document's canonical/render/readiness hashes and update availability alone cannot
make a bulletin or PDF stale.

The schema/catalog must classify every persisted field as render-affecting,
readiness-only, or inert; unknown fields are always inert/rejected under the
version rules and cannot enter a projection. Changing only readiness/inert state
must not make Page/PDF preview stale or force byte-identical recompilation. Review
and Export may reuse a verified PDF whose render signature still matches, but it
creates current readiness/final-candidate evidence tied to the current canonical
revision and readiness hash. Approval becomes stale when either its render or
readiness hash changes.

Autosave is authoritative for document persistence. Users should not need to
perform a separate manual save before final build or publication, although manual
save may remain available as an explicit command.

The state machine distinguishes dirty, saving, saved, save failed, building,
current/stale/failed preview, and manual-build states. Normal UI translates these
to `Changes not saved yet`, `Saving`, `All changes saved`, `Changes not
protected`, `Updating preview`, `Preview current/out of date/failed`, `Creating
PDF`, and `Couldn't create PDF`/`PDF ready`; raw state names and `manual build`
remain Advanced diagnostics.

Save protection and preview/build freshness are independent indicators. `Saved`
must not imply that the preview is current, and a current preview must not hide
`changes not protected` or a save failure.

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
build from the latest saved normalized state. Every manual build captures the
document revision and edit generation at start. An edit while it runs makes its
result stale immediately; that result may be retained historically but cannot
replace a newer preview or export as current without a final input-signature
recheck.

Project size, element count, asset/font/archive complexity, and generated-output
limits are the deterministic warning/hard caps under `Local File Safety`. Build
and import decisions must not vary silently with available machine memory.

Manual builds:

- Save and normalize the project.
- Reader-order compile builds render/run Typst; readiness-only revalidation may
  reuse a verified matching reader artifact under the artifact contract below.
- Booklet-two-up compose builds verify a parent reader artifact and run only the
  pinned compositor; readiness-only revalidation may reuse matching composed
  bytes under the artifact contract.
- Use an app-controlled Typst root that contains only the generated source and
  resolved local assets needed for the build.
- Use bundled application fonts and any imported resource fonts that are valid
  for the current project.
- For a reader-order compile, write an artifact record plus generated Typst/PDF
  under `<workspace>/artifacts/<local-resource-id>/<build-id>.*`. For a
  booklet-two-up compose, write a compositor artifact/PDF referencing the
  verified immutable parent reader artifact and no `.typ`. Revalidation writes
  its new record and reuses the verified source bytes/evidence as specified
  below rather than inventing per-build source files.
- Update the PDF preview frame when the build succeeds.

Live builds:

- Compile a normalized project snapshot without overwriting the main project
  files for every preview.
- Write preview Typst/PDF files under `<workspace>/preview/`.
- Defer queued live builds while a drag is active.
- Run the most recent queued live build after dragging ends.

### Build Artifacts And Approval Identity

The terms in this section are internal. They may appear in Advanced diagnostics,
but they must not be labels or required concepts in Weekly Content or Review and
Export.

Build ids are app-generated UUIDv4 values scoped to a local resource. Every
successful persisted build produces an immutable artifact record and mode-
specific immutable evidence. A reader-order `compile` owns generated `.typ` and
`.pdf`; `compose` owns an imposed `.pdf` plus its parent-reader evidence and no
synthetic `.typ`; `revalidate` references/content-address-deduplicates the
verified source PDF and its Typst or parent/compositor evidence without claiming
new generated source. Any recorded file is never modified in place after its
hash is recorded.

Artifact kinds are distinct:

| Kind | Meaning |
| --- | --- |
| `preview` | Ephemeral snapshot for the live preview. Never finalizable or directly publishable. |
| `draft` | Persisted manual build that may contain explicitly accepted draft warnings/placeholders. |
| `finalCandidate` | Persisted manual build that passed the selected final-readiness profile. |
| `importedDiagnostic` | PDF/Typst supplied by an imported bundle. Untrusted diagnostic attachment, never current output. |

Every user-exportable `draft` record identifies its watermark text/version and
PDF draft metadata. A draft artifact without the required visible watermark is
not eligible for the Draft export action.
A `PROOF` review copy is also a `draft` artifact/output option even when its
source revision passes `printFinal`; it is never an approved/current publication
artifact and records the proof watermark in its signature.

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
canonical revision token, `renderInputHash`, applicable `readinessInputHash`,
tool/schema identities, diagnostic codes, and a bounded log reference.
`startedAt` exists only after execution begins;
`completedAt` is required only for terminal status. Preview records include
`editGeneration`; draft/final records also require the canonical persisted
revision token.

Output form is distinct from readiness profile. It is `readerOrder` for normal
logical-page PDFs or `bookletTwoUp` for the required imposed booklet PDF. A
`bookletTwoUp` record includes sheet dimensions/derived orientation, binding, flip guidance,
scale, safe inset, imposition algorithm version, logical input page count/hash,
imposed side count, and required parent reader build id/PDF hash/input signature.
Retention cannot remove that parent or its evidence while the booklet artifact,
approval, export event, history, Trash, or backup references it. Changing any
output-affecting option stales booklet bytes; a safe-inset-only change stales
readiness evidence. Neither stales a separate reader-order artifact whose own
signature still matches.

Artifact `executionMode` is `compile`, `revalidate`, or `compose`. A `revalidate`
final-candidate is allowed for either output form when only canonical readiness/
inert state changed and its source is a successful persisted artifact with
identical output form/output-affecting options/watermark (a final target therefore cannot reuse
draft-watermarked bytes), never preview/importedDiagnostic. It records current
canonical/readiness hashes, required `sourceRenderBuildId`, source PDF hash,
render input hash, and source Typst hash for reader-order or parent/compositor
evidence for booklet-two-up. It reuses/content-address-deduplicates verified
immutable bytes without invoking Typst/compositor. A `compose` booklet record
uses the parent-reader contract above. Retention keeps every referenced source-
render record/evidence. UI still presents one current reviewed PDF, not a
technical reuse operation.

Only a `succeeded` record includes output evidence:

- Reader-order compile: normalized render projection/hash and generated Typst
  hash plus generator/renderer version; full canonical JSON hash is recorded
  separately only as persistence/readiness evidence.
- Booklet-two-up: verified parent reader build id, PDF hash, input signature, and
  compositor version/hash; it must not claim or require generated Typst of its
  own.
- Sorted portable asset refs and verified binary hashes.
- Sorted font refs, face/revision hashes, and embedding/subsetting decisions.
- Scripture-presentation/normalizer versions when used and the generated
  Copyrights & Permissions contribution-projection hash, displayed-credit hash,
  attribution-generator version, Scripture usage-policy/counter versions, and
  applicable aggregate-evaluation hash, plus publication-license bound evaluation
  hash/current bulletin date when used.
- App version/build identity, bundled Typst version/executable hash, schema
  versions, booklet-compositor version/hash when used, validator version/profile,
  locale/language, and output options.
- Validation report hash, acknowledged draft warnings, and paths/hashes for
  bounded build logs.
- PDF relative path, SHA-256, byte size, output PDF page count, PDF version/
  standards, and accessibility-validation result when requested. Booklet-two-up
  additionally records the verified reader-order `logicalPageCount` used for
  publication constraints.

The existing `build-input signature` term is the `renderInputHash`. A PDF is
visually current when that hash matches. Document edits, resolved binding/field
value changes, content rules, asset/font replacement/loss, output-form changes,
relevant rendering settings, or a different renderer/tool version change it.
Readiness-only edits leave the PDF current but require a current readiness report
and final-candidate/approval evidence. Staleness never mutates historical bytes;
it prevents presenting unmatched visual or readiness evidence as current.

An approval record includes approval id/time, optional local approver display
label, build id, render input hash, readiness input/report hashes, PDF hash,
selected profile, and any permitted warning waivers with reasons. Editing input
represented by either hash marks that approval stale. Approval records and artifact files are local metadata
and are not copied into portable document JSON.

Ordinary current-PDF export uses the newest successful, non-stale persisted
manual artifact matching selected readiness profile, output form, complete output
options, render input hash, and current readiness evidence; otherwise it saves
and rebuilds/revalidates first. Exporting an approved PDF copies the exact approved artifact bytes after
verifying their hash and never rebuilds behind the approval. A stale approval
requires re-finalization for a new current export; an explicitly requested
historical copy must be labeled as historical rather than current.

When `page.finalPageCountRequirement` is present, an artifact is eligible for
current, final, or approved export only when its verified reader-order logical
page count satisfies that requirement. For `readerOrder` this is the output PDF
page count; for `bookletTwoUp` it is `logicalPageCount`, not the imposed sheet-
side count. A successful PDF with a mismatching logical count may be retained or
exported only through an explicitly labeled non-publication draft or historical
diagnostic action; it can never be a `finalCandidate` or current publication
artifact. This gate applies even before the staged approval UI is implemented.

Export writes to a temporary destination, verifies the copied hash, then replaces
or renames atomically. The local export event records build id, PDF hash,
destination display filename, a private workspace-local destination locator/OS
bookmark for `Open`/`Show in folder`, time, and whether it was draft/current/
approved. The locator is never portable and is redacted from diagnostics.
Preview files are never used as the source of a final export.

When a project/template bundle includes Typst or PDF, the manifest labels its
artifact kind, build id, input signature, and hashes. Import stores it only as an
`importedDiagnostic`; it does not inherit current, approved, or final status.

## Print And Export Workflows

PDF export is the required publication workflow. The app may later offer a direct
system print dialog, but exported PDFs are the canonical output for printing,
sharing outside the app, and archiving.

### Review And Export

`Review and Export` is the required v1 route from editing to a PDF. Build kinds,
artifact records, profiles, hashes, and approval identity remain internal. Normal
UI uses `Draft PDF`, `Print-ready PDF` for standard pages, explicit
`Reading-order PDF`/`Booklet-print PDF` for folded work, and, when installed,
`Accessible PDF`, plus `Must fix`, `Please review`, and `Ready to export`.

The workflow saves the latest edit, waits for the exact durable revision, builds
or refreshes the authoritative preview, and presents:

- Page thumbnails/count with fit, zoom, and navigation controls.
- `Must fix` separately from `Please review`; every finding identifies its field,
  element, section, or page and provides `Go to...` navigation with focus.
- Required weekly values and rollover review, unresolved brief items,
  stale-content findings, overflow/clipping, assets/fonts/glyphs, accidental
  blank pages, image effective resolution, and stale output.
- Imported Scripture whose current passage or attribution projection neither
  matches its import snapshot nor has a current import review, missing/invalid
  translation attribution,
  stale Hymn/Song rights associations, unknown/conflicting song
  rights, and every required credit not represented by the active generated
  Copyrights & Permissions block. Each offers `Go to source`/`Review source` and
  explains conditionally excluded contributions.
- Finished page size, margins, selected printer-safe inset, fold/binding, logical
  and imposed sheet-side counts where applicable, output filename, and
  destination in task language.
- Intended `Print copies`/`Share the PDF by email or online` publication contexts,
  every Scripture policy evaluation for those checked contexts, and a correction
  action when a policy snapshot does not cover the intended use.
- A persistent stale-preview overlay whenever displayed bytes do not represent
  the saved revision.

`Must fix` blocks print-ready/accessible output. A separately selected Draft PDF
may proceed only where the readiness matrix permits. Every Draft PDF adds
`-DRAFT` to the proposed filename, carries draft status in PDF metadata, and has
a visible `DRAFT — NOT READY TO PRINT` watermark on every page. Renaming the file
cannot remove that status. The UI may instead create an otherwise-ready pastor
review copy with a clearly chosen `PROOF` watermark.

Immediately before copying, final export rechecks the current
`canonicalRevisionToken`, `renderInputHash`, selected profile/output form/options,
`readinessInputHash` and readiness-report hash, and verified PDF hash against the
chosen final-candidate record. Any mismatch returns to save/build/review rather
than exporting stale evidence. After success the app offers `Open PDF` and `Show
in folder`. When staged approval is installed, it occurs within this workflow
rather than requiring a separate artifact/final-candidate UI.

### Folded And Booklet Output

For `layoutIntent: "foldedBooklet"`, v1 produces two deterministic output
choices:

- `Reading-order PDF — email, screen, or archive`: pages are the document's
  finished logical panels in reading order. Page 1 is the front cover; the last
  page is a back cover only when the document contains one.
- `Booklet-print PDF — print two-sided and fold`: PDF pages are front/back sides
  of two-up printer sheets in booklet order.

Accessible/PDF-UA output is always reader-order. The imposed Booklet-print PDF
is a print artifact and must not claim PDF/UA conformance or replace the
accessible reader-order export.

A document's finished logical size is one panel. Booklet print setup separately
edits the persisted `page.bookletPrintSetup` sheet, duplex, scale, and safe-inset
fields in plain language; binding comes only from `page.binding`. These are shown
in Review and Export and recorded in output options/build signature. They are
never inferred only from a printer driver. The app need not provide a system
print dialog.

Imposition consumes only the verified current reader-order PDF and app-owned
page geometry through a bundled/pinned deterministic compositor. The artifact
record includes compositor version/hash and reader-order input PDF hash. A
failure or page/hash mismatch blocks booklet output and never alters the
reader-order artifact.

The app does not automatically add blank pages to reach a multiple of four.
An imposed booklet requires a logical count divisible by four. If no explicit
page-count rule forbids it, Review and Export may offer `Add intentional blank
pages`; it previews their locations, requires confirmation, and adds the needed
top-level `pageBreak` elements with `intentionalBlank` intent as one undoable
document edit before rebuilding. It never
adds imposition-only pages silently. A `singlePage` document receives no booklet
warning solely from its count.

If the document sets `page.finalPageCountRequirement.multipleOf: 4`, a
non-multiple-of-four count is a blocking publication diagnostic under
`CBB-LAYOUT-0004` for both reader-order and booklet-print final output. Without
that explicit requirement, the reader-order PDF may still be final after a
warning, but Booklet-print remains unavailable until the document count is a
multiple of four. No warning weakens an explicit requirement.
The non-explicit booklet incompatibility uses `CBB-LAYOUT-0005`; it blocks only
Booklet-print output and remains a review warning for reader-order output.

Facing Page View is required for the folded/booklet workflow. For left-bound
left-to-right documents it shows page 1 alone on the right, then 2–3, 4–5, and so
on; a final unmatched page is shown beside an editor-only blank placeholder.
Right-bound documents mirror that presentation. Placeholders, fold hints, and
sheet outlines in the editor are view state and never persisted or exported.
Facing View is labeled `Reader pages — not printer sheets`; the separate
Booklet-print sheet preview is labeled with sheet sides/front/back so the two
cannot reasonably be mistaken for one another.

Page setup supports `marginMode: "fixed" | "mirrored"` and
`binding: "left" | "right"`. Fixed mode uses top/right/bottom/left. Mirrored
mode stores top/bottom/inner/outer; for left binding, odd pages place inner on the
left and even pages on the right, with right binding reversed. Page-level margin
regions resolve after this parity mapping.

For left binding and `P` logical pages, sheet `i` from `0` through `P/4 - 1`
places `P-2i | 1+2i` on its front and `2+2i | P-1-2i` on its back. Right binding
mirrors left/right placement. The sheet preview shows every front/back side with
logical page numbers, intentional blanks, fold, orientation, and the exact
instruction such as `Print two-sided; flip on short edge`.

Each imposed PDF page has `MediaBox`, `CropBox`, and `TrimBox` exactly equal to
the stored sheet width/height and no bleed expansion. In a top-left layout
coordinate system, slots are `[0, sheetWidth/2]` and
`[sheetWidth/2, sheetWidth]`, both full sheet height. Each logical panel is scaled
by the explicit scale and centered in its slot; no crop, auto-fit, or panel
rotation is allowed. For landscape sheets, a short-edge setup writes front/back
sheet sides in the same upright viewer orientation; long-edge setup rotates the
complete back side 180 degrees. Right binding mirrors slot assignment before that
back-side transform. The compositor converts this geometry exactly to PDF bottom-
left coordinates using decimal/rational arithmetic and the standard length
rounding rule.

Safe-inset validation transforms actual placed content bounds at final scale. It
warns/blocks according to profile when content enters the outer top/right/bottom/
left inset or the protected band extending `safeInset.fold` to either side of
sheet center. Inset guides/checks never clip or move content silently.

The app validates panel-to-sheet fit, printer-safe inset, blank intent, and image
resolution and provides a one-sheet test-print guide/action. Professional
multi-signature planning, creep compensation, bleed/crop/fold marks, and
commercial-press controls remain non-goals; basic two-up ordering, sheet output,
and duplex guidance are required.

The test action creates `booklet-printer-test.pdf`, a non-publication two-page PDF
representing the front and back of one sheet with app-owned calibration content:
large front/back/top/bottom labels, left/right panel numbers, fold line, binding
side, safe-inset boxes, and flip-direction arrows. It uses the selected sheet/
flip transform but no church/document content, requires no document readiness,
and carries `PRINTER SETUP TEST — NOT BULLETIN CONTENT` visibly and in metadata.
It opens the matching offline fold/flip instructions and does not require a
built-in system print dialog. It is a calibration/test export event, never a
bulletin artifact, final candidate, approval source, or Recently Exported
bulletin card.

Page sizes:

- Required booklet preset pairs are Letter landscape `11in x 8.5in` to
  half-letter panels `5.5in x 8.5in`, Legal landscape `14in x 8.5in` to `7in x
  8.5in` panels, and A4 landscape `297mm x 210mm` to standard A5 `148mm x
  210mm` panels centered in each half-sheet slot. Letter, Legal, A4, and their
  panel sizes also exist as ordinary page presets. No preset is a silent
  universal default.
- Templates, bulletins, and resource packs may define their own page-size and
  page-setup configurations.
- Page size, margins, and final page-count requirements are document
  output/publication settings and must be stored in project or template JSON,
  not only in user preferences.

Export naming:

- Workspace `exportFilenamePattern` is configurable and defaults to
  `{date:YYYY-MM-DD} {name}.pdf`.
- Supported substitutions are `{date:<date-format>}`, `{name}`, `{service}`, and `{kind}`;
  `{{` and `}}` emit literal braces. Date comes only from valid
  `metadata.publicationDate`; service comes only from `metadata.serviceLabel`.
  If a required date is absent, prompt for it rather
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
- The proposed Booklet-print filename adds `-booklet` before `.pdf`; Draft and
  proof variants add `-DRAFT` or `-PROOF` after any output-form suffix. Users may
  edit a safe filename, but the embedded watermark/status rules still apply.
- Exported filenames are display/output labels only and must not affect local
  resource ids, artifact identity, PDF bytes, or internal workspace paths.

Finalization and optional persisted approval:

- Finalization through Review and Export is required initial v1. It runs
  `printFinal`/`accessibleFinal`, verifies the final candidate, presents the
  readiness report, and exports the exact reviewed bytes.
- Persisted approval records/history may be staged. When installed, `Approve this
  PDF` records approval of the already finalized candidate within the same
  workflow; it does not defer or duplicate required v1 finalization.
- Finalization saves the current document, selects `printFinal` or
  `accessibleFinal`, runs that readiness profile and a persisted manual build,
  verifies the PDF, and presents the complete readiness report.
- Finalization compares the verified reader-order logical page count with every
  configured
  final page-count condition. A mismatch blocks finalization and all
  current/final/approved export; it is not a waivable warning.
- Blocking validation errors or failed builds prevent final approval/export until
  resolved.
- Non-blocking warnings may be shown during finalization but should not prevent
  approval unless they affect print-readiness or accessible final output.
- When persisted approval is installed, final approval references the immutable
  final-candidate build id, build-input signature, PDF hash, readiness-report
  hash, profile, approval time, and permitted waivers. Export destinations are
  separate events, not approval identity.
- An edit changing approval's render/readiness hash marks it stale and requires
  finalization before a new final PDF. A schema-declared inert authoring/view
  change alone does not invalidate identical approved bytes/evidence.

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
- Diagnostic bundle export excludes bulletin/template text, Church Profile,
  weekly briefs/checklists, spelling dictionary, PDFs, images, fonts, and other
  private church data unless the user explicitly confirms each category for that
  bundle.

Autosave errors should show an immediate toast and record full details in
diagnostics. If an autosave error means the latest document state is not safely
persisted, the document persistence/unprotected state must remain visible until
the problem is resolved.

The app should define actionable handling for at least these failure classes:
corrupt JSON, failed migration, hard validation failure, missing asset, missing
or invalid font, missing bundled Typst executable, Typst compile error, compile
timeout, missing/failed booklet compositor, disk full, file permission failure,
failed backup/restore/history/Trash operation, failed archive import, unsupported
bundle/resource-pack version, unsafe imported content, and workspace/file
conflict. It also covers Shared church library offline/timeout/authentication/
head-conflict/integrity/compatibility failures, Scripture parsing/provider/
fidelity/attribution findings, and missing/unknown/conflicting rights or
generated-block coverage.

### Diagnostic Codes And Redaction

Stable diagnostic codes use `CBB-<DOMAIN>-<NNNN>`. Defined domains are `DOC`,
`SCHEMA`, `FIELD`, `ASSET`, `FONT`, `LAYOUT`, `BUILD`, `PDF`, `SAVE`,
`CONFLICT`, `IMPORT`, `PACK`, `SYNC`, `SCRIPTURE`, `RIGHTS`, `BACKUP`,
`SECURITY`, `AI`, and `PACKAGE`. A code's meaning and default severity cannot be
repurposed; behavior changes require a new code.

The app bundles a versioned `diagnostic-catalog.json` validated by
`diagnostic-catalog.schema.json`. It is normative for code meaning, default
severity, per-operation disposition, acknowledgeability, recovery actions, and
redaction class. A release may add/retire codes but never reuse one. The baseline
assigns a code to every readiness-matrix condition and required failure class;
conditions do not fall back to unstructured text. It includes:

| Code | Meaning |
| --- | --- |
| `CBB-DOC-0001` | Malformed/unsupported document JSON. |
| `CBB-DOC-0002` | Stale-content or unresolved weekly-work review finding. |
| `CBB-SCHEMA-0001` | Structural or semantic schema failure. |
| `CBB-FIELD-0001` | Missing/invalid required field-contract value. |
| `CBB-FIELD-0002` | Required rollover decision or confirmation is unresolved. |
| `CBB-ASSET-0001` | Unresolved required portable asset. |
| `CBB-ASSET-0002` | Raster image has low effective print resolution. |
| `CBB-FONT-0001` | Missing/invalid font revision. |
| `CBB-FONT-0002` | Missing glyph after explicit fallback closure. |
| `CBB-FONT-0003` | Redistribution/embedding permission blocks output. |
| `CBB-FONT-0004` | Requested face uses a deterministic managed substitute. |
| `CBB-LAYOUT-0001` | Horizontal or physical-page overflow. |
| `CBB-LAYOUT-0002` | Oversized unbreakable fragment. |
| `CBB-LAYOUT-0003` | Clipped semantic content or no-progress pagination. |
| `CBB-LAYOUT-0004` | Final PDF page count violates the document requirement. |
| `CBB-LAYOUT-0005` | Folded document count cannot produce a two-up booklet. |
| `CBB-LAYOUT-0006` | Content enters a configured printer-safe inset or fold band. |
| `CBB-LAYOUT-0007` | Booklet-print setup is missing or geometrically invalid. |
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
| `CBB-PACK-0002` | Pack export/publish redistribution decision is missing, prohibited, outside its effective dates, or narrower than the selected closure. |
| `CBB-SYNC-0001` | Shared-library check or transfer could not complete; installed local content is unchanged. |
| `CBB-SYNC-0002` | Shared-library authentication or authorization must be renewed. |
| `CBB-SYNC-0003` | Hosted head changed before publish; local and incoming work require review. |
| `CBB-SYNC-0004` | Hosted feed/release identity, length, digest, signature, or compatibility validation failed. |
| `CBB-SYNC-0005` | Published bytes could not be verified as the visible hosted head. |
| `CBB-SCRIPTURE-0001` | Scripture parsing, source-fidelity, reference, translation, or required-attribution finding. |
| `CBB-RIGHTS-0001` | Required, missing, unknown, or undisplayed rights metadata. |
| `CBB-RIGHTS-0002` | Conflicting rights identity or invalid Copyrights & Permissions aggregation. |
| `CBB-BACKUP-0001` | Backup, restore, history, Trash, or handoff verification failed. |
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
| Unresolved `ask` rollover or required confirmation | Warning | Warning | Block | Block |
| Required private weekly checklist item unresolved | Warning | Warning | Block | Block |
| Non-required private checklist reminder unresolved | Reminder | Allow with visible reminder | Acknowledge | Acknowledge |
| Save failure/conflict or unsaved build revision | Non-final preview allowed | Block | Block | Block |
| Missing asset | Placeholder warning | Explicit placeholder draft only | Block | Block |
| Missing/invalid/non-embeddable font | Diagnostic/fallback preview only | Block | Block | Block |
| Missing glyph after fallback stack | Tofu diagnostic | Block | Block | Block |
| Missing requested face with deterministic managed substitute | Warning | Allow | Acknowledge | Acknowledge |
| Imported Scripture passage or attribution differs from its import snapshot and has no current import review | Warning with review action | Allow with visible warning | Block until reviewed | Block until reviewed |
| `paragraphOnly` Scripture has no verified canonical verse structure | Review marker with `Structure verses` | Allow | Acknowledge | Acknowledge |
| `paragraphOnly` Scripture has an empty reference or translation label | Warning with correction action | Explicit labeled draft only | Block | Block |
| Required Scripture attribution is missing | Warning with corrective action | Explicit labeled draft only | Block | Block |
| Known provider/catalog Scripture policy prohibits or omits a selected publication context | Error with context action | Block | Block | Block |
| Known Scripture quotation/reproduction constraint is exceeded | Error with scope/count/action | Block | Block | Block |
| Required rights record is missing/incomplete or has no active Copyrights & Permissions block | Warning with corrective action | Explicit labeled draft only | Block | Block |
| Hymn/Song content or rights set differs from its rights-association review | Warning with exact content/credit review | Allow with visible warning | Block until reviewed | Block until reviewed |
| Rights status is `unknown` | Reminder | Allow with visible reminder | Acknowledge or block under document `rightsPolicy` | Acknowledge or block under document `rightsPolicy` |
| Publication-license display is outside effective dates or bulletin date is unavailable | Warning with date/license action | Explicit labeled draft only | Block | Block |
| Publication-license display dates are unrecorded | Reminder | Allow | Acknowledge or block under document `rightsPolicy` | Acknowledge or block under document `rightsPolicy` |
| Conflicting content for one credit key or invalid rights aggregation | Error | Block | Block | Block |
| Rights explicitly marked `publicDomain`, with no separate required-credit/policy finding | Show status | Allow | Allow | Allow |
| Horizontal/physical-page overflow or clipped semantic content | Error marker | Block | Block | Block |
| Content enters configured printer-safe inset/fold band | Guide warning | Allow | Acknowledge | Acknowledge for reader-order only |
| Configured final page-count requirement not met | Show expected/actual | Explicit labeled draft only | Block | Block |
| Missing alt on non-decorative image | Warning | Allow | Allow | Block |
| Raster image below 150 effective PPI | Warning | Allow | Acknowledge | Acknowledge |
| Folded count not divisible by four without explicit count requirement | Show expected/actual | Allow reader-order draft | Allow reader-order; block booklet-print | Allow reader-order; booklet-print not applicable |
| Booklet-print setup missing/invalid | Show setup action | Reader-order unaffected; block booklet draft | Reader-order unaffected; block booklet-print | Not applicable |
| Untagged/nonconforming PDF | Warning/not applicable | Allow without claim | Allow without accessibility claim | Block |
| Stale artifact | Show/rebuild | Rebuild | Rebuild/finalize | Rebuild/finalize |
| Build/PDF verification failure | Editing remains available | Block | Block | Block |

Every final candidate requires:

- The canonical document is successfully saved and the build revision matches.
- Structural and semantic schemas pass, required field values resolve, and no
  unresolved conflict/recovery transaction exists.
- Every rollover value required for review is confirmed and the stale-content
  review has no blocking result.
- Every imported Scripture passage has a current import/source decision, its required
  translation attribution resolves, every known provider/catalog policy snapshot
  covers each selected publication context, its active aggregate use satisfies
  every machine-enforceable constraint, and no connector/source evidence is
  misrepresented as an exact unmodified quotation. Manual/unverified policy
  remains an `unknown` rights condition governed by the document `rightsPolicy`.
- Every active required rights contribution has a usable credit line and is
  represented exactly once by the active Copyrights & Permissions block; no
  stale Hymn/Song rights association, credit-key conflict, or invalid aggregation
  remains. Every copied publication-license display is valid for the bulletin
  date or has the permitted current unrecorded-date acknowledgement.
- All referenced assets/fonts resolve to verified bytes; no missing glyph or
  placeholder remains.
- No horizontal overflow, oversized unbreakable element, clipped required
  content, invalid page target, or unintended blank-page error remains.
- A successful current persisted manual build exists, the PDF opens, its hash
  and page count match the artifact record, and all dependencies/tool hashes are
  recorded.
- The verified reader-order logical page count satisfies
  `page.finalPageCountRequirement`
  when that portable document requirement is present.

`printFinal` also requires Review and Export confirmation of page size, margins,
page count, blank intent, image-resolution warnings, any configured printer-safe
inset, and the visual PDF preview. For Booklet-print it also requires configured
sheet safe inset, sheet preview, binding, duplex guidance, scale, and divisible-
by-four count. The readiness report records the visual-review method without
treating assisted review as inferior. `accessibleFinal` additionally requires
title/language, valid heading/list/table semantics, unambiguous reading order,
alt text for every non-decorative figure, successful PDF/UA-1 generation, and no
external validator conformance failure. It inherits reader-order `printFinal`
content/page/blank/image checks but not booklet sheet/imposition checks, because
accessible output is never imposed.

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
shows modified/source dates, plain content/dependency summaries, and read-only
thumbnails/page previews when safely renderable. It offers `Use version saved
outside the app`, `Keep my current work`, `Save my work as a new bulletin`, or
`Export both`; technical `disk`/`ours` language remains Advanced. `Export both`
is identified as the safest no-loss choice when the user is unsure, without
claiming either version is semantically correct.
Keeping the current version requires confirmation and a fresh optimistic check
immediately before replace. Automatic semantic merge is out of scope.

Multi-resource imports, pack updates, asset migration, and other transactions
use `transactions/<transaction-id>.json` with states `planned`, `staged`,
`committing`, `committed`, `rollingBack`, `rolledBack`, or `failed`. The journal
contains source digest, allocated id/remap tables, intended writes, old/new
hashes, and completed steps. Fresh ids are allocated once during planning and
reused by retries. Staged files are invisible to the workspace registry until a
commit marker is durable; installed-pack/version pointers advance last.

Shared-library download/application uses this same local journal. Publication
has a separate durable operation record containing the clean pack-draft
projection hash, expected prior hosted head, idempotency key, generated archive
identity, upload outcome, and verified returned/visible head. Recovery may retry
an idempotent conditional request or re-read head, but never guesses that an
upload was published, deletes an immutable remote release, advances local
`published` state without matching head evidence, or discards the local draft.

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

## Workspace Backup, Version History, Trash, And Handoff

V1 provides one-action full-workspace backup and transactional restore through
the application UI. A backup is a versioned, hash-manifested archive governed by
`backup-manifest.schema.json`. Full backups use `.cbb-backup`; handoff packages
use `.cbb-handoff`. Both are zip-compatible but the app must not claim the
generic `.zip` association. A full backup contains:

- Workspace registry and workspace settings.
- Church Profile and private spelling dictionary.
- Every canonical managed resource registered by the workspace: bulletins,
  templates, Saved Sections, Song Library revisions, Scripture catalog/presets,
  and rights snapshots, all managed assets/fonts/custom definitions, installed
  and fully downloaded staged
  resource-pack releases, pack-maintainer drafts, pack trust/update state, and
  nonsecret Shared church library/Scripture-provider connection descriptors,
  including currently unreferenced Church Library items.
- Cross-restart Version History and Trash with their retained dependencies.
- Current/final retained artifact records and PDFs needed for church archives.
- Private weekly-work records by default, with a category-level privacy warning
  and an explicit option to exclude them from an ordinary user-created backup.

A handoff is intentionally a user-reviewed selected closure rather than a full
copy of the source workspace. Its defaults and required dependency closure are
defined below; weekly private work is excluded by default and remains subject to
the unresolved-required-item transfer gate. Its captured resource map covers all
and only the selected/included source resources.

Both archive kinds exclude locks, active transaction journals, preview/cache
files, executable AI helper profiles, credentials/secrets, provider access or
refresh tokens, authorization cookies/headers, publisher private signing keys,
raw environment data, and unredacted diagnostic/AI logs. A hosted release's
continued availability is never treated as backup: the backup contains every
pack byte/revision needed to preserve the captured installed, staged, or draft
state locally. Backup creation uses a user-selected
destination outside the workspace, writes atomically, verifies manifest/hashes by
rereading the completed archive, and reports success only after verification.
Before capture, the app flushes canonical saves, resolves/blocks active conflicts
and committing transactions, and takes a short workspace snapshot lock to record
registry revision plus the complete full-backup resource-path/hash map. Immutable
resources may copy after the lock releases, but any missing/hash-mismatched member
aborts the backup; edits after the captured revision belong to the next backup.
The UI warns that a backup contains private church data and never silently places
it in a public folder.
Home/Settings show the last verified backup time and destination display name.
After the first final export and when no verified backup has succeeded for 30
days, the app offers a dismissible, non-blocking backup reminder.

Restore treats the archive as untrusted input and uses the same bounded archive,
schema, path, asset, and font validation as imports. It stages/journals every
write. Restore into a nonempty destination requires a verified pre-restore backup
that includes all destination user state, including private weekly work,
regardless of the ordinary backup exclusion option, plus an explicit `Restore as
a separate workspace` or `Replace current workspace`
choice; it must not silently merge identities. Although general multi-workspace
management is deferred, restore-as-separate may create and switch to one new
workspace after the transaction succeeds. Failure leaves the prior configured
workspace usable and selected.

Every restored Shared church library connection starts `paused` with no usable
credential reference, no automatic opening check, and a visible `Reconnect`
action. Reauthorization rechecks the provider/origin, role, library identity,
signer continuity, and current remote head; restoration never resumes network
traffic or publication merely because a former connection descriptor exists.

Version History stores immutable canonical document snapshots deduplicated by
hash. It creates a snapshot:

- Before the first document edit in an editor run.
- Before a destructive, batch, migration, contract-update, or structural repair.
- Before restoring another version.
- At every successful print-final/accessible-final or explicit `PROOF` export.

The history view shows time, reason, publication/display label, and associated
export when present. It also provides a bounded read-only page preview/thumbnails
when renderable and a content/change summary covering fields, sections, page
setup, dependencies, and source date; technical JSON diff remains Advanced.
Restoring first snapshots current state, then atomically
makes the chosen snapshot a new current revision; it never deletes later history.
At least the newest 20 automatic snapshots per document and every final-export
snapshot are retained until the user reviews a cleanup. Storage cleanup must show
what will be removed and must never delete the only copy of current content.

For workspace library resources, ordinary `Delete` means `Move to Trash`.
Deleting an element inside an open document remains an undoable document edit.
Trash preserves local identity,
portable content, private weekly work, retained artifacts, dependencies, history,
prior library kind, and restore
metadata. Restore returns the resource to its prior kind; duplicate display names
remain legal. V1 does not auto-empty Trash. Permanent deletion is available only
inside Trash or `Empty Trash`, names the affected resources, requires explicit
confirmation, and may collect an asset/font/definition revision only when no
active document, Song Library/rights or Scripture-catalog revision, installed or
staged pack, pack draft, history snapshot, trashed item, retained artifact, recovery/conflict
record, or in-progress backup/restore references it.

`Create volunteer handoff package` uses the verified backup format and includes
Church Profile, canonical congregation documents/templates, Saved Sections, the
reviewed active Song Library/rights and Scripture translation/preset catalog
needed for continuing weekly work, their complete dependency closure, and
selected archived finals. The category review names song text/rights/license
data and lets the user omit unneeded archived/inactive library revisions while
preserving every selected document/Profile favorite/default reference. It
excludes device-specific window
state/paths, helper configuration, Shared church library connection descriptors,
Scripture-provider connection descriptors, credentials/signing keys, locks, logs,
caches, and weekly private notes by
default. A user may explicitly include an installed pack's portable bytes as
content, but never its connection or publishing authority. Its Church Profile
projection may include reviewed publication-display license records but excludes
Rights & Licenses private notes by default and always excludes credential
references. Song/translation records exclude private notes, credential refs, and
nonessential provider/retrieval provenance by default while retaining portable
content/credit/policy snapshots needed to render and review. The review lists
every included/excluded category and lets the user
explicitly add private weekly/license notes when appropriate. Import on the next
machine uses the same transactional restore flow.

### Backup And Handoff Manifest Contract

`backup-manifest.json` is the required root member of `.cbb-backup` and
`.cbb-handoff`. Its closed root contains:

- Schema `version`, `kind` (`fullBackup` or `handoff`), backup/handoff id, source
  workspace id, creation time, creating app version, and all relevant root schema
  versions.
- Captured workspace-registry revision/hash. For `fullBackup`, the resource map
  covers the complete captured source workspace; for `handoff`, it covers every
  resource in the selected closure and does not claim to enumerate excluded
  source resources.
- Explicit included and excluded category lists; an exclusion is data, not an
  omitted/unknown decision.
- A complete ordered `entries` array. Each entry has UUID entry id, resource kind
  when applicable, canonical safe relative path, exact byte size, SHA-256,
  required flag, and dependency ids.
- Declared entry count/total bytes and kind-required roots. A full backup requires
  workspace and settings entry ids plus the Church Profile entry when a profile
  exists. A handoff requires its handoff registry and selected Church Profile
  root when present; portable workspace settings are included only when selected,
  and device-specific settings are forbidden.

Every nondirectory payload member appears exactly once in `entries`; undeclared,
duplicate, aliased, symlink/device, encrypted, or unsafe members block restore.
Canonical path, JSON, hashing, streaming verification, quarantine, and
transaction rules reuse the archive safety contract. Single-file ZIP64 is
permitted/required above classic ZIP limits; split/multi-volume archives remain
invalid. Handoff subsets must still
declare a complete dependency closure for every selected canonical resource.

`Replace current workspace` restores the backed-up source workspace identity
after the verified safety backup of the destination. `Restore as a separate
workspace` mints a new workspace id while preserving scoped local resource ids
and rewrites only workspace-id provenance/registry fields transactionally. The
new copy remains inactive until the user chooses `Switch to restored library`.
After switching, a restore-specific `Return to previous library` action remains
available until explicitly dismissed; this bounded recovery affordance does not
constitute general multiple-workspace management.

## Assets

Assets should be stored under an app-generated local resource UUID, not a
user-provided filename or portable asset id. The original filename should be
stored as display metadata in the local asset metadata store.

Asset records should include:

- Local asset resource id.
- Portable asset id for the immutable binary revision.
- Verified SHA-256 digest and byte size of the exact canonical build-safe binary
  identified by that portable revision.
- Separate source-original digest/size and the sanitizer/rasterizer identity when
  canonical bytes were derived from an untrusted original.
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

An `asset:<uuid>` always identifies exact immutable canonical bytes permitted as
renderer/build input, not merely the originally uploaded bytes. For an already
safe raster the canonical and original bytes may be identical. For SVG, PDF, or
another format requiring sanitation/flattening, the untrusted source original is
provenance only and the portable id/hash identify the validated derivative.
Changing canonical bytes because sanitization/rasterization logic changes creates
a new portable asset id; artifact signatures record the sanitizer identity. A
bundle includes the canonical bytes required to reproduce rendering and may
include the source original only as an explicitly inert optional provenance item.

Canonical raster creation applies and removes EXIF/orientation metadata, stores
the resulting top-left oriented pixel width/height, fixes the color/profile
policy under the pinned decoder version, and strips active/non-render metadata.
Animated/multiframe raster input is not canonical v1 image content: import stops
and may offer a reviewed `Use first frame as a still image` conversion that mints
canonical static bytes/id. Editor, crop, PPI, and Typst never reinterpret source
orientation or animation independently.

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
| Draft manual build/export | Require explicit `Build/Export Draft With Placeholders` confirmation, record the warning, mark the artifact draft, add `-DRAFT`, PDF draft metadata, and the required visible draft watermark. |
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

For each placed raster image, effective print PPI is computed from the cropped
source pixel region and final printed placement size, including booklet scale.
`CBB-ASSET-0002` warns below 150
PPI in Review and Export. It is acknowledgeable for print final, does not apply
to vector assets, and reports the current value plus replace/resize/crop actions.

Moving a referenced asset to Trash is rejected unless the same confirmed transaction
relinks or removes every reference. Final readiness always re-resolves the
current closure and never trusts an older successful preview.

## Resource Packs

Resource packs are importable local content bundles with the `.pak` extension.
They represent an arbitrary collection of reusable content, such as church logos,
approved images, fonts, templates, starter bulletins, custom element schemas,
styles, Song Library/right records, Scripture presentation presets, and optional
metadata.

Resource packs are data, not application code. They may be distributed as files
or through an explicitly configured hosted Shared church library and are always
installed through the same app-owned validation/review workflow. The application
bundle must not change when a church creates, publishes, updates, or distributes
its own resource pack.

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
  metadata; claims are not trusted until cryptographically verified and locally
  accepted.
- Optional description.
- Optional author, church, or organization display metadata.
- Optional homepage, support, or contact metadata.
- Optional license metadata for the pack and included content.
- Optional minimum compatible app version.
- Optional readme path, defaulting to `readme.md` when present.
- Manifest entries for included assets, templates, starter bulletins, custom
  element schemas, styles, fonts, songs/rights metadata, Scripture presentation
  presets, AI template contracts, sample AI data imports, and other supported
  content.
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
- `songs/` for Song Library records and portable rights snapshots.
- `scripture/` for reusable Scripture presentation/rights metadata, never
  provider credentials or cached arbitrary webpages.
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
- Never require the original resource-pack file or a live feed connection after
  import. A later update always arrives as another complete `.pak`, whether
  selected locally or downloaded through a Shared church library, and follows
  the identical identity, signature, review, conflict, transaction, and rollback
  path.

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

Pack Song/Scripture-library updates are also copy-on-write. Changed song content,
rights, redistribution data, or associations create a new immutable Song Library
revision under the same song-work id; changed Scripture catalog/presentation/
rights data creates a new immutable preset/catalog revision. Review shows wording,
structure, credit/display/policy, association, and redistribution diffs. Installed
pack mappings advance only after confirmation, while existing bulletins/templates
remain pinned and every referenced prior revision is retained.

The same `(song:<uuid>, revision)` or Scripture catalog id/revision may not name
different canonical projections, and one `creditKey` may not name a different
`creditProjectionHash`. Such conflicts block an in-lineage update as equivocation.
For a genuinely unrelated side-by-side import, a reviewed collision remap mints
new incoming portable ids, rewrites every typed reference/hash/association in the
quarantined closure, and revalidates it before commit; existing local content is
never rewritten.

Resource packs may be exported from the app when the user wants to distribute a
curated set of reusable local content. Exported resource packs should be `.pak`
zip-compatible archives containing `manifest.json`, selected resources,
referenced assets, included fonts when selected, AI-ready metadata when selected,
and an optional `readme.md`.

Pack export/publish has a separate redistribution gate. Every selected entry and
binary in its dependency closure has a reviewed draft `redistributionDecision`
with status `allowed`, `prohibited`, or `unknown`; allowed scope
`metadataOnly` or `completeEntry`; review basis/source/license id, reviewer time,
optional inclusive date-only `effectiveFrom`/`effectiveThrough`, and evidence
hash. A song `metadataOnly` decision also contains a unique
`metadataFieldAllowlist` subset of `contributors`, `copyrightStatus`, and
`publicCreditLine`. Default is `unknown`. At export/publish, effective bounds are compared to
the operation's workspace-time-zone local date; the operation record preserves
that date/zone and both bounds are inclusive. Missing bounds are open and an
inverted range is invalid. Attribution, a required credit line, a
congregation display license, provider access, or permission for local bulletin
use is never treated as redistribution authority. `unknown`/`prohibited`, an
out-of-effective-range decision, or a closure wider than its allowed scope blocks
pack export and hosted
publish and offers remove, replace, supply/review evidence, or cancel.

Song records seed this decision from `packRedistribution`. `metadataOnly`
produces a distinct closed `songMetadata` entry, never a stripped `songRecord`.
Its base projection contains portable source work id, title/alternate title,
number/source citation, and only the public redistribution assertion (status,
scope, metadata-field allowlist, effective bounds, and evidence hash); a reviewed per-field
allowlist may additionally include public contributor name/role, copyright
status, and exact public credit line. It always excludes rich song text, media,
dependencies, active credit keys/projection hashes, congregation
`publicationLicenseDisplay`, provider reporting/catalog/account ids, usage-policy
snapshots, private notes, credential references, and provenance/retrieval/source
evidence, including raw review basis/source/license id/reviewer identity/time.
Full evidence remains only in the local draft. `songMetadata` has no dependencies
and is informational on import; using
it to create a local insertable song requires new rights identities and explicit
review. The preview/validator enumerates every projected field and verifies this
closed projection before any bytes leave the device. Template/starter/Saved
Section decisions cover embedded Scripture, song text, media, fonts, and
expanded dependencies rather than approving only the root JSON. The manifest
records each exported assertion/scope/evidence hash for downstream review, but
an importer treats it as provenance rather than proof of permission. Imported
assertions do not set a destination draft/Song Library decision to `allowed`
until that workspace explicitly reviews their evidence and scope.

Resource pack import is committed but may be staged after the core weekly
workflow. Creating/exporting packs and applying updates/replacements may be
staged further. If import is absent, generic starters and self-contained project/
template bundles still support a useful first release. If any pack import ships,
the complete applicable quarantine, validation, transaction, dependency, and
trust rules in this spec are mandatory; scope pressure never permits a weaker
partial importer. Until update/replace is available, importing a pack whose
stable identity already exists stops with an informative message rather than
silently replacing content.

### Shared Church Library Experience And Hosted Releases

This capability is `Required, may be staged after resource pack creation/export/
update/replace`. `Shared church library` is its normal-UI name. `Resource pack`,
endpoint, digest, signer fingerprint, and release sequence remain in Details/
Advanced. The feature transports one complete dependency-closed pack release at
a time; it never presents a loose asset/template upload as independently safe
when that item has pack dependencies.

The product separates two tasks instead of exposing an ambiguous bidirectional
`Sync` command:

- A maintainer with connection role `publisher` uses `Publish changes` to create
  and publish a new immutable pack release.
- A connection with role `subscriber` uses `Check for updates`, then `Review
  update` and `Update shared library` for a newer compatible release.

The Shared libraries screen and connected-pack details show a non-color-only
plain status: `Saved locally — not published`, `Checking`, `Up to date`, `Update
available`, `Needs review`, `Couldn't connect — your local work is safe`, or
`Sign in again`, plus `Paused — reconnect to check for updates` for a restored/
paused connection. They show local/remote display version when different and last
successful check; sequence/digest/signer/endpoint/transaction details are behind
Details. `Check now` is always available and `Check all` appears for two or more
connections. Checks are cancellable, keyboard accessible, and never block
unrelated editing.

`Connect a shared library` reviews the provider/host, church/library display
name, requested role, and exact categories the app may send before confirmation.
Normal setup uses task-language sign-in/invitation rather than requiring raw URLs,
tokens, hashes, or fingerprints when the provider supports it. Advanced provider
setup may expose safe connection details. Imported packs, documents, bundles,
readmes, backups, or metadata cannot create/alter a connection, approve an
origin, supply credentials, enable checking, or trigger traffic.

`Check for updates when the app opens` is a per-connection opt-in. The local
workspace becomes usable first; only then may one nonblocking `Read head` begin.
Opening checks and `Check now` are metadata-only and never download archive
bytes. A successful check shows `Update available`, release notes, and declared
archive size. `Review update` shows size, destination/free-space result, metered-
network warning when the OS can identify one, and `Download and review`; only
that explicit action may stream the candidate into bounded quarantine. The app
does not expose a silent auto-download/install preference. `Auto-refresh` means
automatic availability checking, never downloading, activating, replacing,
retiring, or removing workspace content. Availability/failure is operational
status, not a bulletin-readiness finding.

A publisher's `Remind me to publish when closing` defaults on when that connection
is confirmed. After local autosave is clean, the app prompts only when closing the
pack-authoring surface/app with a draft publish projection different from the
last successfully published projection. Multiple packs use one accessible
summary. Actions are `Publish now`, `Review changes`, `Close and publish later`,
and `Don't remind me for this library`. Failure/cancel leaves a durable
unpublished state plus `Retry`/safe close; it never offers discard or blocks
closing because the network is unavailable. Subscribers are never prompted to
publish merely because an update exists.

Installed/subscribed packs and maintainer drafts are distinct. Editing a pack-
managed item does not make its user a publisher or alter the hosted release. The
user explicitly chooses `Make an independent copy` or, when authorized, `Create
a maintainer draft from this release`. Existing bulletins/detached copies remain
pinned through publication or pull update. Disconnecting removes/invalidates the
remote relationship/credential reference after confirmation but keeps installed
content and never deletes bulletins/templates.

A closed Shared library connection record contains connection id; stable pack
id; bounded normalized church/library display name (metadata, never identity);
role `subscriber` or `publisher`; provider kind; canonical approved HTTPS
service origin, optional separately approved canonical HTTPS download origin, and
opaque remote-library locator; opaque OS-credential reference; durable state
`active`, `paused`, or `authenticationRequired`; applicable last-
common/installed/published release identity; last observed head; last check/
successful transfer times; bounded outcome/code; and its two preferences. Tokens,
passwords, cookies, raw authorization headers, invitation secrets, and private
signing keys are forbidden.

A release identity is the tuple `(packId, releaseSequence, manifestDigest,
archiveDigest, signerFingerprint)`, with a positive sequence and lowercase
`sha256:<64-lowercase-hex>` digests. Display version/time never replace it for
ordering, equality, concurrency, or trust.

The hosted provider exposes these logical operations regardless of transport:

1. `Read head` conditionally returns `notModified` or a closed `packFeedHead`
   containing feed-schema version, pack id, positive sequence, optional display
   version/release notes, manifest/archive digests, archive byte length, signer
   fingerprint, optional minimum app version, opaque immutable-release locator,
   publication time, and optimistic head token.
2. `Read release` returns the exact immutable `.pak` bytes identified by the
   head. The client checks length/archive digest before normal pack validation;
   feed metadata is never safety/authenticity proof. After full validation, the
   pack id, signed release sequence, canonical manifest digest, archive digest,
   and signer fingerprint must exactly match the head or the candidate is
   quarantined under `CBB-SYNC-0004`.
3. `Publish release` accepts a locally complete validated `.pak`, idempotency key,
   and exact expected prior head token/release identity. The provider stores it
   immutably and advances the visible head atomically only if the expected head
   matches. Comparison failure changes no visible head and returns conflict.

One `(packId, releaseSequence)` may never identify different bytes. Release
locators are opaque handles, not arbitrary content URLs. Transport uses
authenticated HTTPS with normal certificate/hostname validation. A separate
download origin is disclosed/approved at connection time; credentials never
cross origins or redirects. Non-HTTPS/unapproved redirects fail. Responses/error
text are untrusted, bounded, schema validated, and never executable markup.
Requests use bounded connect/idle/response/total-transfer limits, cancellation,
and automatic-check backoff. Offline, missing/deleted remote, timeout, auth, or
server failure changes no local canonical state/installed pointer.

Publishing waits for the pack draft and selected dependencies to be durably
clean. It computes the dependency closure, deterministically generates a `.pak`,
runs export/license checks, validates with the normal importer, obtains an
update-capable signature/sequence, and shows the upload inventory/change summary.
It reads the current head and requires equality with the draft's last common
release before conditional publish. Local state becomes `published` only after
the provider confirms the same digest as the visible head and the client
revalidates returned identity.

If another publisher advanced the head, last-write-wins/automatic semantic merge
are forbidden. The app enters `Needs review`, downloads/validates incoming, and
shows last-common/local/incoming changes. The user may retain/export local work,
resolve conflicts and rebase, or cancel. A successfully uploaded blob that loses
head comparison is not published local state and cannot affect subscribers.

A subscriber check compares complete release identity. Equal means `Up to date`;
same sequence/different digest is equivocation/tampering; lower sequence is a
reviewed downgrade; a higher compatible release is offered for the explicit
download/review flow and may stage only after that action. Before mutation the
app applies signer continuity and installed-snapshot/current-local/
incoming comparison, then shows additions, changes, removals, dependencies,
trust/signer changes, local modifications, compatibility, and license findings.
`Update shared library` reuses the journaled pack transaction, advances installed
pointers last, and retains referenced revisions. Cancel/failure leaves the prior
pack active/renderable.

Before first publication and material closure changes, a preflight reruns the
complete pack redistribution gate and lists content kind/count, destination, and
every license/restriction blocker. Only generated pack bytes leave the device.
Bulletins, Church Profile, weekly work, Version History,
Trash, exports, artifacts, backups, handoffs, settings, diagnostics, arbitrary
workspace files, and resources that merely refer to a selected resource but are
not in its declared forward dependency closure are never uploaded. Typed
references inside selected/dependency JSON necessarily remain in the generated
pack and are disclosed by the inventory.
Enabling a connection does not enable telemetry, analytics, remote content
indexing, provider discovery, an application updater, or calls to unrelated
endpoints; the broker allowlist contains only the disclosed head/release/publish
operations for that connection.
Hosted update requires the signed lineage/trust rules below; service-account
authentication alone is not signature continuity. Guided signing/key custody,
recovery, rotation, and publisher-role enforcement are release dependencies and
must not require normal volunteers to manipulate key files.

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

A candidate downloaded by the opt-in opening check has no additional authority.
Its presence in quarantine may shorten the later review, but it never satisfies
impact confirmation, signer/trust review, conflict resolution, update/replace
choice, or installed-pointer commit on the user's behalf.

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

Changing a pack asset/font/schema/template/song revision/Scripture catalog or
preset revision is copy-on-write. The dependency
impact summary lists every local template, bulletin, custom element, and artifact
that still references an old revision. Referenced old revisions are retained and
remain resolvable even when hidden from the current pack library. Garbage
collection may remove a revision only after the workspace proves no canonical
document, Saved Section/Song Library/right/Scripture-catalog revision, pack-maintainer draft,
installed or staged pack map, weekly-work attachment/link, Version History
snapshot, Trash item, recovery/conflict record, retained/source artifact, or in-
progress backup/restore references it. This is the same retention graph used by
Trash and workspace cleanup.

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

The offline-first app always supports file-based import and export bundles.
Project and template bundles use the `.zip` extension and are zip-compatible
archives. The optional Shared church library is only a hosted transport for the
same immutable resource-pack releases; it never replaces portable files, full
backup, or volunteer handoff.

Supported bundle workflows:

- Export a bulletin project for backup or transfer to another workspace.
- Import a bulletin project from a bundle.
- Export a template for reuse in another workspace.
- Import a template from a bundle.
- Export a resource pack containing an arbitrary selected set of reusable
  content.
- Import a resource pack.
- Under Advanced/Integrations when that staged feature is installed, export an AI
  template contract for a selected template.
- Under Advanced/Integrations when installed, import AI-generated data for a
  selected template or bulletin.

Project and template bundles should include:

- A manifest containing the bundle id, bundle format version, primary document
  entry id, entry records, dependency records, and portable-asset-id-to-entry-id
  map.
- The project or template JSON.
- Every portable Scripture import/rights snapshot and generated-attribution
  policy needed by that document, normally embedded in its canonical JSON. Raw
  provider HTML, connector credentials, live library connections, and Song
  Library workspace lineage are forbidden.
- Referenced managed asset binaries and asset metadata.
- Referenced custom element schemas or style metadata when needed.
- Generated Typst from the selected reader-order compile artifact for
  diagnostics. If the selected PDF is revalidated/booklet-two-up, include its
  declared source/parent reader Typst and dependency evidence; never invent
  compositor Typst.
- The approved current PDF by default when one exists, otherwise the newest
  non-stale persisted manual artifact. Preview/stale PDFs are never selected as
  current; any explicitly included historical artifact is labeled diagnostic.
- For a bulletin project only, an optional explicitly selected and privacy-
  labeled `weeklyWorkAttachment` containing that bulletin's weekly-work record
  and retained weekly-work snapshots. It is never part of template JSON or a
  template bundle.

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
- When a bulletin bundle includes a valid `weeklyWorkAttachment`, associate it
  only with the newly allocated bulletin local resource id after explicit privacy
  confirmation; it never enters portable document JSON or resolves by name.

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
  `style`, pack-only `songRecord`, pack-only informational `songMetadata`, pack-
  only `scriptureCatalogRecord`, `aiContract`, `aiSample`, `readme`, `typstDiagnostic`,
  `pdfDiagnostic`, bulletin-only
  `weeklyWorkAttachment`, or another schema-defined supported kind. A song
  record contains its complete portable rights snapshot; a
  `scriptureCatalogRecord` is the complete `scripture-catalog.schema.json`
  revision, including optional presentation preset, and never provider response
  HTML or credentials.
  A `songMetadata` entry uses only the closed metadata-only pack projection and
  has an empty dependency list.
- Explicit `required` boolean and canonical relative `path`.
- `mediaType`, nonnegative integer exact uncompressed `byteSize`, and lowercase
  64-hex SHA-256.
- Schema URI and root version matching parsed JSON content when applicable.
- Portable asset/font revision ref, inert source provenance, license metadata,
  and the pack-export redistribution assertion/scope/evidence hash when
  applicable. These are review provenance, never imported authority.
- Sorted dependency records containing target id, closed `relation` enum, and
  `required`; dependency targets exist in the same manifest.

Song-record dependencies include each asset/font/custom-definition revision
needed to render its saved content. Template/starter dependencies identify song
records only when the library item itself, rather than a copied portable
content/rights snapshot, is part of the reusable pack contract. Import resolves
the whole declared closure before exposing any item.

A `weeklyWorkAttachment` is valid only in a `projectBundle` whose root document
is a bulletin. It has exactly one required `weeklyWorkFor` dependency to that
root document and is forbidden in template bundles and resource packs.

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

All imported files, resource packs, project/template bundles, backups, handoff
packages, assets, fonts, AI helper inputs, downloaded pack/feed bytes, Scripture-
provider responses, provider markup, redirect targets, and remote metadata are
untrusted content until validated. TLS, authentication, or a valid pack signature
does not make response content safe to parse or render.

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

Network response safety for explicitly enabled integrations:

- Every request goes through the narrow integration broker, uses an approved
  canonical HTTPS origin with certificate/hostname validation, and has bounded
  connect, idle, response, and total-transfer timeouts plus user cancellation.
- Redirects are disabled unless the integration contract permits a separately
  disclosed HTTPS download origin. Authorization, cookies, client certificates,
  and other credentials never cross an origin or redirect boundary.
- Headers and declared lengths are bounded before allocation. Bodies stream to
  quarantine while enforcing observed byte limits and hashes; partial, over-limit,
  decompression-expanding, canceled, or mismatched responses are deleted and
  cannot change canonical workspace state.
- Feed/head JSON uses the same strict duplicate-key, Unicode, depth, string,
  schema, and version validation as local JSON. Downloaded `.pak` bytes use the
  complete archive, signature, dependency, review, and transaction pipeline.
- Scripture-provider markup is sanitized and converted to the allowlisted
  Scripture AST in an isolated bounded parser. Scripts, event handlers, CSS,
  links, remote media, hidden page chrome, and arbitrary HTML never enter the
  document, preview, logs, or diagnostic UI; proposed non-whitespace exclusions
  remain visible for review.
- A Scripture request sends only the disclosed reference, translation identifier,
  bounded adapter metadata, and provider-required authorization. A pack publish
  sends only the reviewed generated pack bytes and bounded conditional-publish
  metadata. Neither path sends bulletin text, pastor notes, Church Profile,
  weekly work, or unrelated workspace data.
- Provider/server error strings render only as escaped bounded text. Secrets are
  stored through the operating-system credential service and are redacted from
  request metadata, journals, notifications, logs, support bundles, backups, and
  handoffs.

### Size, Performance, And Resource Limits

`MiB` means 1,048,576 bytes and `GiB` means 1,073,741,824 bytes. File/JSON sizes
count exact binary or UTF-8 bytes; raster pixels are decoded width times height;
visual-node counts include native elements and wrappers recursively. Limits
apply when the observed value is greater than the threshold and are checked from
declarations and again while streaming/decoding.

| Category | Warning threshold | Hard cap |
| --- | ---: | ---: |
| Portable document JSON | 10 MiB | 50 MiB |
| Workspace metadata root | 25 MiB | 100 MiB |
| Bundle/pack manifest or non-helper exchange JSON | 5 MiB | 20 MiB |
| Hosted pack feed/head JSON | 256 KiB | 1 MiB |
| One Scripture-provider response body | 2 MiB | 10 MiB |
| Backup/handoff manifest JSON | 64 MiB | 128 MiB |
| Church Profile or one weekly-work JSON | 5 MiB | 20 MiB |
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
| One persisted generated Typst/PDF artifact file | 500 MiB | 1 GiB |
| Projected full-backup payload bytes before archive overhead | 40 GiB | 48 GiB |
| Projected full-backup payload entries | 150,000 | 190,000 |
| Completed backup/handoff archive bytes | 50 GiB | 52 GiB |
| Completed backup/handoff archive entries | 190,000 | 200,000 |

The helper boundary additionally caps stdout and stderr at 1 MiB each and total
scratch/output at 100 MiB. Builds keep the 30-second default timeout; normal
settings may raise it only to a 120-second hard maximum. Managed AI runs use
their separate five/fifteen-minute limits.

The general archive byte/entry caps apply to bundles, packs, and other imports.
Streamed backup/handoff formats use their explicit larger aggregate and manifest
caps while retaining all path, ratio, one-entry, JSON-depth, and parser-isolation
ceilings. Generated artifact files use the one-entry cap, so no valid retained
PDF or Typst file is individually unbackupable.

The projected full-backup closure counts every payload byte and entry a full
backup must retain: registry/settings/Profile, canonical resources, unreferenced
library items, weekly-work/live snapshots, Version History, Trash, retained
artifacts, and their dependencies. It also reserves the difference between the
48 GiB/190,000-entry payload caps and completed-archive caps for the manifest,
ZIP headers, and bounded format overhead. Before every mutating transaction the
app projects the post-commit full-backup closure and blocks a commit that would
cross either payload cap or the projected backup-manifest JSON hard cap. It warns
on approach and offers retention-aware cleanup; a supported workspace must never
become too large or entry-heavy for its required full-backup operation.

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

## Optional AI Assistance And Advanced Data Exchange

The complete normal workflow works without AI. The private weekly brief supports
manual checklist creation and field/section mapping in v1. AI is opt-in, off by
default, and may be staged after manual weekly/template workflows.

When installed/configured, the primary AI action is `Suggest from instructions`,
not raw JSON exchange. It may propose structured field values, checklist
mappings, and approved known-asset choices. Every proposal shows the supporting
source excerpt when one exists; a proposal without direct support is labeled
`Inferred — confirm this`. Users accept, edit, or reject each field. AI never
changes layout, pagination, readiness, diagnostic waivers, output destination, or
document data before reviewed application.

The AI capabilities in this section remain local and require no hosted service
or network access even when a Shared church library or Scripture connector is
configured. They may support file exchange with external AI tools and launching/
configuring a local helper when that staged feature is present. Before a managed
run, the UI identifies the exact helper and selected instructions/assets that
will be exposed.

`.ai-template.json` and `.ai-import.json` are Advanced/Integrations formats, not
the normal volunteer workflow. Contract ids/versions/hashes, target handles, raw
JSON, and file mechanics remain hidden from Weekly Content. Raw file exchange,
instruction-to-field suggestions, and managed-helper configuration are committed
staged features rather than initial-v1 gates; they may ship independently only
when the same validated proposal/privacy contract applies.

When launching a local AI helper, the app should provide a controlled working
directory containing the AI template contract, user-provided source input, and
only the assets approved for AI access. The helper must not need arbitrary access
to the user's workspace. The app remains responsible for validating helper output
before applying anything to a bulletin.

An externally run helper used through file exchange is outside the app trust
boundary. The app cannot promise that it will not read other files, environment
secrets, or the network; the Advanced exchange UI must say so.

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
  If that record is unavailable, the import must never update an existing
  bulletin because base hashes and offered-asset authority cannot be verified.
  At most, the user may create a new bulletin from a manually selected template
  whose contract id/version/hash matches exactly; no incoming asset ref is
  accepted without a verified catalog. Never match by display name.
- Compare each current field value with its exported base hash. A changed field
  is a conflict regardless of recorded origin and cannot be silently overwritten;
  the review shows base/current/proposed values.
- Accept an asset reference only when it was present in that exchange's exported
  asset catalog. Unknown refs become unresolved asset requests rather than global
  workspace lookups.
- Show a review screen with proposed field values, missing required values,
  validation errors, warnings, unresolved asset requests, and AI notes.
- Let the user accept, edit, reject, or resolve imported values before applying
  them. `Accept all valid suggestions` may select only schema-valid,
  non-conflicting proposals; inferred values and changes to manually edited
  fields still require individual review.
- Apply accepted values by creating a new bulletin from the target template or by
  updating the authoritative targeted field-value stores with origin `ai` and
  matching current scoped `fieldReview` records.
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
definition contains a stable portable `id` (referenced as `definitionId` by
instances), positive `definitionVersion`, canonical `definitionHash`,
user-facing name, shared `fieldContract`, native visual `elements` with
bindings, optional default placement, and schema-valid preview field values.
The canonical hash covers the complete definition revision, including its
semantic version and exact nested-definition pins, and excludes only the
`definitionHash` field itself. Its v1 `breakModel` is the constant
`verticalStack`, so multiple definition roots have the vertical-stack pagination
rule; a fixed-height or `avoid` instance can still suppress those descendant
breaks as specified.

A custom-element instance remains one native `type: "custom"` visual element. It
stores a pinned definition id/version/hash and scoped `fieldValues` using the
shared field-value records. The referenced definition revision is an embedded
portable document definition or an explicit bundle/pack dependency; it is never
resolved by display name or silently switched to the latest workspace revision.

New definitions begin at semantic revision 1. Finalizing one editing transaction
increments an existing definition exactly once when its output-affecting meaning
changes, recomputes its self-hash, and cascades the same single increment through
every ancestor whose nested pin consequently changes. Field-value edits on body
or page-level instances do not revise their target definitions. Every persisted
instance must carry the target definition's exact id, version, and hash.

The current document envelope is version 2. Version 1 documents normalize
purely in memory to version 2 by finalizing embedded definitions dependency-first
and repinning all nested, body, and page-level instances; only an explicit save
persists that result. Current-version documents are never repaired during open:
missing, stale, or mismatched revision evidence fails closed.

Bindings inside the definition use the shared binding model and default to the
instance's field scope. Effective values follow field value, contract default,
binding fallback, then missing. The renderer expands the pinned definition and
resolved values into a transient native render tree. Expanded visual values are
not persisted as a second editable tree.

Editing a custom instance field updates its scoped `fieldValues`. Structural or
literal edits inside the expansion require an explicit `Detach Custom Element`
command (shown as `Make independent` in normal UI) that replaces the instance
with newly identified native elements using
the current resolved values as one undoable transaction. The detached result no
longer receives definition updates.

## No-Code Template Authoring

Users must be able to create and maintain useful templates without editing JSON,
Typst, ids, bindings, or schemas. Required entry points are:

- `Save this bulletin as a template`.
- `Create a template` from a generic starter.
- `Duplicate template` and `Edit template`.
- From every supported bindable Text, Date, Image, and Hymn/Song content
  property, `Make this a weekly field`.
- `Scripture formatting` for the document-wide reference, verse-number,
  paragraph, translation-label, spacing, and typography choices.
- `How this bulletin is usually shared` with `Print copies` and `Share the PDF
  by email or online`, copied into future bulletins as rights-readiness intent.
- `Add/Move Copyrights & Permissions` plus its heading, grouping, and explicit
  public-domain display choices.
- `Change only this bulletin` and `Update template for future bulletins` where a
  local creation-template reference is known.

`Save this bulletin as a template` reviews bulletin-specific values. For each
weekly value the user can clear it, make it a template default, retain it only as
sample/test data, or map it to Church Profile. The app warns before preserving
dates, names, prayers, announcements, or other likely one-week content as a
template default.

`Make this a weekly field` creates the internal field definition and binding as
one undoable action. Its plain-language dialog supports label, help text,
required status, group, default, rollover policy, review expectation, and an
optional compatible Church Profile mapping. Internal ids and target pointers are
generated and never required user input.

Generic starters contain one collapsed Copyrights & Permissions element in
normal end-matter flow. Template authors configure Scripture presentation and
the generated block visually and can test representative long Scripture/credit
content for pagination without editing stored rows. When attributable content is
added to a custom template with no active block, authoring and weekly test mode
show `Add Copyrights & Permissions` with placement/page-impact preview. Saving a
template may preserve the unresolved review finding but never silently inserts,
duplicates, fixes to a page, or clips the block.

The setup-form designer supports visual creation/reordering of field groups and
fields, previewing the form as a weekly volunteer sees it, and identifying unused
fields/broken bindings. Conditional/repeatable setup uses language such as `Show
this section when`, active/inactive action labels, `Allow more than one`, item
fields/prototype, empty-state behavior, `Maximum items`, and `Let the weekly
editor reorder items`. The author must preview both active/empty states before
saving.

Template authors may supply sample/test values visibly distinct from defaults.
They are used only for template preview/testing and never become bulletin values
unless explicitly converted. `Test weekly workflow` exercises setup, Weekly
Content, conditional/repeatable behavior, stale checks, and readiness without
creating a normal library bulletin. Test edits live in a disposable sandbox and
are discarded on exit/reset; only an explicit `Apply changes to template` review
may commit authoring changes, never test bulletin values or review state.

Document, section, element, and placement locks are configured visually. The
authoring view shows what Weekly Content can change and warns about weekly fields
without visible bindings, visible bindings without usable fields, inaccessible
conditional controls, and repeaters without bounded item counts.
For unbound content it also exposes `Review every bulletin`, `Review when copied
from last bulletin`, and `Persistent — no weekly reminder`, mapping to the
`weeklyReview` hint.

`Update template for future bulletins` shows every layout, field, default, rule,
and lock change, creates a recoverable new template revision, and never rewrites
existing bulletins. `Change only this bulletin` leaves the template unchanged.

## Template And Custom Element Lifecycle

Templates are copied into bulletins when a bulletin is created from a template.
The copied bulletin receives its own local resource id and editable document JSON.
Later changes to the source template do not silently rewrite existing bulletins.

Workspace metadata may retain a local creation-template reference for `Open
source template` and the explicit no-code `Update template for future bulletins`
workflow. It is not portable, authoritative for rendering, or a live link.
Removing/replacing that template cannot damage the copied bulletin.

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

- Display names that violate the bounded Unicode label contract.
- Workspace-local resource ids or storage paths in portable document fields.
- Asset references that resolve outside approved local asset roots.
- Portable asset refs missing from a required bundle/pack asset map, duplicate
  asset-map keys, or one portable asset id associated with multiple binaries.
- Duplicate bundle entry ids, duplicate normalized archive paths, and unresolved
  manifest dependencies.
- Pack content ids reused for a different resource kind within the same pack id.
- Invalid pack/song redistribution statuses/scopes/evidence, a `metadataOnly`
  projection/`songMetadata` containing a non-allowlisted field or any dependency,
  or a pack export/
  publish closure with `unknown`, `prohibited`, out-of-effective-range, or insufficient-scope
  redistribution decisions.
- Invalid page sizes.
- `page.bookletPrintSetup` on standard pages, missing setup for requested Booklet-
  print output, or invalid sheet/scale/safe-inset geometry.
- Invalid or internally inconsistent `page.finalPageCountRequirement` objects.
- Invalid element ids.
- Duplicate element ids within the same complete document.
- Invalid authoring-policy inheritance or locks on the wrong node owner.
- Invalid or unknown top-level `rightsPolicy` fields/values.
- Empty, duplicate, or unknown top-level `publicationContexts` values.
- Invalid weekly behavior, incompatible Church Profile mappings, unresolved
  rollover review, or a publication-date field configured to `keep`.
- `fieldReview`/`contentReview` on a template, malformed review hashes/records,
  records for unknown/ineligible fields/nodes, or review state copied by a
  duplication transaction. A well-formed hash that no longer matches is retained
  for explanation but treated as unresolved readiness, not structural corruption.
- Conditional rules with missing/incompatible controls, non-allowlisted
  expressions, invalid targets, cycles, or ambiguous required-field scope.
- Repeatable rules with invalid array fields/prototypes/bindings, unbounded or
  contradictory item limits, or missing/duplicate/misaligned stable item ids.
- Invalid page-level element placement or unsupported page targeting.
- Normal-flow elements that intentionally render outside the content box.
- Rich-text content that contains unsupported blocks, invalid inline marks, or
  unvalidated Typst source.
- Raw provider HTML/markup, provider credentials, authorization data, remote
  media, fabricated provider provenance, unsupported Scripture source kinds,
  unsafe source URLs, or unbounded provider metadata in a document or pack.
- Malformed Scripture references/translation records, duplicate or out-of-order
  canonical verse ids, unsupported presentation/override values, malformed
  import snapshots/boundaries/hashes/import reviews, or source/display evidence
  that is internally inconsistent; either arm missing normalizer/importer
  identity/version, provider snapshots missing provider/adapter/request/retrieval
  evidence, paste snapshots containing provider-verified evidence, or an import
  review without an import snapshot. A well-formed stored
  import or import-review hash that no longer matches an edited passage is a
  readiness finding, not structural corruption.
- Invalid rights credit keys, mismatched `creditProjectionHash` values,
  components, statuses, contributor roles,
  credit-display conditions, publication-license snapshots/display lines, or
  empty/unbounded/unsafe required credit or policy-disclosure lines; invalid or
  internally inconsistent Scripture usage-policy rule ids/versions/contexts/
  limits/source hashes.
- Invalid/inverted publication-license effective dates or a malformed source
  revision hash. Applicability is recomputed readiness evidence, never a
  persisted result to validate.
- Missing/malformed Hymn/Song `rightsAssociationReview` or content/rights
  projection hashes. A well-formed reviewed hash that no longer matches current
  song content or rights is a readiness finding, not structural corruption.
- One credit key associated with conflicting canonical rights records, more than
  one active resolved `rightsAttribution` element, persisted generated credit
  rows, or a rights-attribution element placed as a fixed/page-level/clipped
  artifact instead of supported normal body flow.
- Rendered rights with required credit but no active Copyrights & Permissions
  element or usable credit line. This is a semantic readiness failure rather
  than permission for the renderer to invent text.
- Invalid Shared church library connection roles/states/origins, credential
  values stored in JSON, malformed feed/release identities, nonpositive release
  sequences, invalid digest/fingerprint forms, or a hosted locator treated as an
  arbitrary fetch URL.
- Invalid Scripture-catalog ids/revisions/provider mappings/rights/policy/preset
  shapes, credentials or response markup in a catalog record, or the same
  `(translationId, revision)` associated with different canonical hashes.
- A Scripture block `sourceCatalog` whose translation id does not match the block
  or whose revision/hash is malformed. When the named local catalog revision is
  available, a hash mismatch is stale provenance requiring review, not permission
  to rewrite the portable copied snapshot; absence is valid portability state.
- Image fit values other than `contain`/`cover` and focal points outside `[0,1]`.
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

- AI-assisted instruction-to-field suggestions and Advanced raw AI contract
  exchange.
- Resource pack import, creation, export, update, and replacement.
- Hosted Shared church library publishing, checking, staged download, and
  reviewed update, after the complete resource-pack create/export/update/
  replacement and signing contracts it depends on.
- Authorized Bible Gateway connector access, after the offline Paste Scripture
  normalizer/review flow is complete and an authorized provider agreement,
  authentication flow, translation catalog, and reproduction/attribution
  contract are available. Webpage scraping is never an interim implementation.
- Tagged/accessible final PDF output.
- Persisted approval records and approval history.
- Local AI helper launch and configuration.

Deferred from v1:

- Multiple-workspace management.
- Moving an existing workspace from the UI.

Optional enhancements:

- Synchronize editor scrolling with PDF preview scrolling.
- Element alignment controls.
- Multi-element selection and select all.

Weekly Content/Customize Layout separation, Create This Week rollover, generic
starters, Church Profile/Song Library/Scripture catalog/Saved Sections, no-code template authoring,
conditional/repeatable content, direct rich-text editing, page thumbnails/zoom/
selection navigation, offline Paste Scripture formatting/attribution, structured
Hymn/Song rights with the generated Copyrights & Permissions block, basic resize/
crop, Review and Export, basic booklet imposition, full backup/restore, Version
History, Trash, the user settings panel, margin guides, undo/redo, canvas
snapping, strong inspector validation, and faithful grid/stack rendering are v1
requirements and must not be tracked as future-only features.
