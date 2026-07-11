# Church Bulletin Builder Architecture

This document defines the software architecture for the Church Bulletin
Builder specified in `spec.md`. It records the technology decisions, the
process and trust topology, the module decomposition, the core data pipeline,
and the mechanisms that satisfy the spec's cross-cutting contracts
(determinism, offline-first operation, crash safety, untrusted-content
handling, and staged delivery). Behavior remains normatively defined by
`spec.md`; where this document names spec sections it is mapping requirements
to owning components, not restating them.

Decisions already made in `spec-review.md` (offline packaged desktop app;
Windows + Linux targets; signed `.msi`; AppImage/`.deb`/AUR/pacman; app-managed
workspace; bundled pinned Typst CLI) are treated as fixed inputs.

## Architecture Drivers

The requirements that most strongly shape the architecture, in priority order:

1. **Deterministic generation.** All editable state lives in JSON; Typst
   source is generated deterministically from it; the same
   `renderInputHash` must reproduce byte-equivalent visual output. Hashes
   (RFC 8785 canonical JSON + SHA-256) drive save conflict detection,
   staleness, readiness, and approval identity. No floating-point drift, no
   wall-clock or environment leakage into output.
2. **Offline-first with two narrow network exceptions.** Editing, building,
   validating, exporting, backup, restore, and help must work with networking
   disabled. Only an explicitly configured Shared church library connection
   and a user-invoked Scripture provider may make bounded, brokered requests.
3. **Untrusted content everywhere.** Every imported byte (archives, SVG,
   raster, fonts, PDFs, JSON, provider responses, clipboard) is untrusted and
   must be parsed with bounded resources in a no-network isolated worker,
   staged in quarantine, and committed only through journaled transactions.
4. **Crash safety and recovery.** Atomic writes, a 5-second crash-loss bound,
   save/lock/conflict/recovery state machines, journaled multi-resource
   transactions with deterministic startup recovery.
5. **Two-audience editing.** A protected `Weekly Content` mode for
   non-technical volunteers and an explicit `Customize Layout` mode for
   authors, over one document model. Mode is editor state and can never
   change output bytes.
6. **Editor fidelity with PDF authority.** The editor approximates Typst
   pagination (shared break matrix and fragment rules) but the compiled PDF
   is always authoritative; the two must never disagree about semantics, only
   possibly about pixels.
7. **Accessibility as a release gate.** WCAG 2.2 AA editor UI on Windows and
   Linux platform accessibility APIs; keyboard-only and screen-reader task
   acceptance; a staged PDF/UA-1 tagged-output pipeline with an external
   validator.
8. **Identity discipline.** Sixteen-plus non-interchangeable identity classes;
   portable ids never mix with workspace-local ids; immutable
   revision-per-portable-id for assets, fonts, songs, and Scripture catalog
   entries; copy-on-write everywhere.
9. **Bounded resources.** A normative limits table (JSON sizes, node counts,
   raster pixels, archive ratios, backup closure caps) that must be enforced
   identically on all machines regardless of available memory.

## Technology Stack

### Decision summary

| Concern | Decision |
| --- | --- |
| Application shell | Electron (pinned Chromium), sandboxed renderer |
| Language | TypeScript everywhere (strict mode) |
| Core domain logic | Runtime-agnostic TypeScript packages (no Electron/DOM imports) |
| UI framework | React, immutable document store, patch-based undo |
| PDF preview | pdf.js rendering artifact/preview PDFs in the renderer |
| Typst compilation | Bundled pinned Typst CLI (>= 0.14 for `ua-1`), subprocess |
| Booklet imposition | App-owned deterministic compositor (pinned library, e.g. pdf-lib-class tooling wrapped behind our own versioned module) |
| PDF/UA validation | Bundled pinned validator built on veraPDF profiles (bundled JRE) — staged with `accessibleFinal` |
| Untrusted parsing | Electron `utilityProcess` workers, OS-sandboxed, no network; parsers preferentially compiled to WASM for memory isolation |
| Exact arithmetic | Rational/decimal length arithmetic module (integer numerators over pt), rounding only at emission |
| Canonical JSON | RFC 8785 (JCS) implementation shared by all hashing |
| Schema validation | Bundled JSON Schema 2020-12 validator over the local schema catalog |
| Secrets | OS credential facilities (Windows Credential Manager, libsecret) behind a credential-broker interface; JSON stores opaque references only |
| Packaging | electron-builder: signed `.msi` (WiX), AppImage, `.deb`; native `PKGBUILD` for pacman/AUR pinning the signed release artifacts |

### Why Electron (and not Tauri or native)

The three candidates seriously considered were Electron, Tauri, and a
Qt-based native app.

Electron is selected because:

- **Rendering consistency.** The editor is a precision WYSIWYG surface whose
  pagination approximation, drag feedback, and typography must behave
  identically on Windows 11, Ubuntu, Debian, and Arch. Tauri uses the OS
  webview (WebView2 on Windows, WebKitGTK on Linux); WebKitGTK lags Chromium
  in layout, font shaping, and accessibility-tree fidelity, and varies across
  the four required Linux baselines. One pinned Chromium removes an entire
  class of per-distro rendering and a11y bugs, which matters because
  release acceptance includes screen-reader task tests on GNOME/Orca.
- **Accessibility maturity.** Chromium exposes complete UIA (Windows) and
  AT-SPI (Linux) trees. WCAG 2.2 AA plus the keyboard/screen-reader
  acceptance matrix is a v1 gate, so this is a primary driver rather than a
  nicety.
- **Process/isolation primitives fit the threat model.** Electron's
  sandboxed renderer (no Node), context-isolated preload, and
  `utilityProcess` map directly onto the spec's required split between UI,
  privileged services, and restricted no-network parse workers.
- **Prototype continuity.** The demo-branch prototype is a JS/Node web app;
  its document-model, Typst-generation, and server logic port into the core
  packages rather than being rewritten in another language.
- Packaging requirements (signed `.msi`, AppImage, `.deb`) are first-class in
  the Electron ecosystem; pacman/AUR packages are straightforward wrappers
  over the signed release tarball per the AUR pinning rules in the spec.

Tauri's genuine advantages (smaller binaries, Rust memory safety in the core)
are addressed differently: binary size is not a spec requirement, and memory
safety for the *dangerous* code paths — font, SVG, PDF, and archive parsing —
is obtained by running vetted parsers compiled to WASM inside sandboxed
utility processes, which is a stronger boundary than "written in Rust in the
main process" regardless of shell choice. Embedding Typst as a Rust library
(possible under Tauri) is explicitly not desired: the spec pins a Typst CLI
executable with a recorded hash, and a subprocess with a controlled root,
sanitized environment, and kill-on-timeout is the better isolation and
determinism story anyway.

A native Qt app was rejected on team fit, prototype discontinuity, and the
cost of rebuilding rich-text editing and the design system from scratch.

### Why the core is runtime-agnostic TypeScript

Everything that decides *what the document means* — schema validation,
migration, field/binding/rule resolution, geometry, Typst generation,
hashing, readiness evaluation, rights generation — lives in pure TypeScript
packages with no Electron, DOM, or Node-API imports (filesystem and process
access are injected ports). Consequences:

- The deterministic pipeline is testable headlessly and in CI on golden
  files, without a display server.
- The same resolution/pagination-approximation code runs in the renderer
  (editor preview) and in the main process (build path), guaranteeing the
  "identical fragment semantics even when pixel measurements differ" rule by
  construction.
- A future non-Electron host (CLI batch renderer for tests, a different
  shell) does not require a rewrite.

## Process And Trust Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│ Renderer process (sandboxed, no Node, context-isolated)                │
│   React UI · editor surface · inspector · pdf.js preview              │
│   core packages (resolution, editor pagination approximation)         │
└───────────────▲────────────────────────────────────────────────────────┘
                │ typed IPC (schema-validated request/response + events)
┌───────────────┴────────────────────────────────────────────────────────┐
│ Main process (privileged orchestrator)                                 │
│   workspace service · persistence + transaction journal · registry    │
│   build orchestrator · artifact store · readiness engine              │
│   diagnostics service · credential broker · network broker            │
│   crash/recovery + single-instance + workspace lock                   │
└──┬──────────┬──────────┬──────────┬──────────┬─────────────────────────┘
   │          │          │          │          │
   ▼          ▼          ▼          ▼          ▼
 Quarantine  Typst      Booklet    PDF/UA     AI helper launcher (staged)
 parse       compile    compositor validator  isolated profile, no net
 worker(s)   runner     worker     worker
 (utility    (spawns    (utility   (utility
 process,    pinned     process)   process,
 sandboxed,  CLI; app-             bundled
 no network, controlled            JRE)
 handle-only root, no
 I/O)        network)
```

Trust rules enforced by this topology:

- **Renderer is untrusted-adjacent.** It renders user and imported content,
  so it holds no filesystem, network, or credential capability. All
  privileged operations go through a typed, versioned IPC contract; imported
  strings cross IPC as data and are schema-validated on the main-process
  side. The IPC surface is the natural place to enforce "imported bytes
  never choose executable paths, filesystem roots, or output destinations."
- **Quarantine parse workers** handle every complex untrusted format
  (zip, SVG, raster decode, font tables, imported PDF flattening). They
  receive an input handle and a bounded output directory handle, nothing
  else; they have no network and run under the OS sandbox. A crash or
  timeout rejects the item — there is no unrestricted retry path.
- **The Typst runner** is the only component that invokes the pinned CLI. It
  materializes an app-controlled build root (generated `.typ` + resolved
  canonical assets + approved fonts only), sanitizes the environment,
  disables package fetching, enforces the 30 s default / 120 s max timeout,
  and cleans partial outputs. Compile requests reference resolved content by
  hash, so the runner cannot be steered to arbitrary paths.
- **The network broker** is the only component with network capability. It
  speaks only the closed operations of configured connections (pack-feed
  head/release/publish; Scripture provider adapter calls), only to
  connection-approved HTTPS origins, streams response bodies to quarantine
  handles with byte/time limits, and never sees workspace paths or
  credentials in the clear (the credential broker attaches authorization at
  the transport edge from OS storage).
- **The credential broker** wraps OS credential facilities; the rest of the
  app deals only in opaque references, satisfying the secrets-management
  contract (never in JSON, logs, diagnostics, backups, or command lines).

## Module Architecture

Core packages (runtime-agnostic, dependency direction top → bottom):

| Package | Owns | Key spec contracts |
| --- | --- | --- |
| `core/ids` | Identity-class branded types, UUID minting, id-namespace rules | Resource Identity; non-interchangeable primitives |
| `core/canonical` | RFC 8785 serialization, SHA-256 helpers, hash-type wrappers | every `sha256:` contract |
| `core/geometry` | Length parsing/printing, exact rational arithmetic, unit tables, page/content-box math, mirrored margins | Lengths And Units; Page Model |
| `core/schema` | Bundled schema catalog, structural validation, semantic validation registry, migration engine (ordered, idempotent, in-memory) | Schema Organization; Persistence Contract migrations |
| `core/richtext` | Rich-text AST, normalization, plain-text derivation, clipboard sanitization, Scripture block structures | Text element; Scripture structures |
| `core/document` | Document/element tree model, wrappers, field contracts, field values + item ids, bindings, content rules, custom-element definitions/instances, authoring policy | Document Model; Field Contracts; Conditional/Repeatable |
| `core/resolve` | Deterministic resolution pipeline: field values → conditional exclusion → repeat expansion → custom-element expansion → resolved render tree | resolution-order invariants |
| `core/rights` | Credit records, projection hashes, rights generation (Copyrights & Permissions rows), usage-policy exact-integer evaluation, license-bound evaluation | Hymn/Song And Rights; Copyrights And Permissions |
| `core/layout` | Break matrix, fragment rules, breakability analysis, editor pagination approximation | Flow Layout; Pagination And Overflow |
| `core/typstgen` | Render projection → deterministic Typst emission; escaping; app-owned semantic constructs; length rounding at emission | deterministic generation; AST-leaves-as-data |
| `core/hashes` | `canonicalRevisionToken`, `renderInputHash`, `readinessInputHash` builders over the field classification catalog (render-affecting / readiness-only / inert) | Persistence And Build hash model |
| `core/readiness` | Readiness matrix engine, profiles (`draft`/`printFinal`/`accessibleFinal`), findings, waiver rules, page-count gate | Final Readiness Profiles |
| `core/diagnostics` | Diagnostic catalog types, `CBB-*` codes, redaction classes, structured diagnostic records | Diagnostic Codes And Redaction |
| `core/manifest` | Archive manifest model, canonical archive serialization, entry/dependency validation, signature/key-transition verification (Ed25519) | Archive Manifest Contract; Pack Trust |
| `core/scripture` | Paste normalizer (versioned), reference parsing, provider adapter contract, sanitized-HTML → Scripture AST conversion rules | Scripture Import And Formatting |
| `core/ai-exchange` | `.ai-template.json` / `.ai-import.json` models, contract hashing, import validation/merge rules | AI contract import/export |

Service layer (main process; each service is the single writer for its
state):

| Service | Owns |
| --- | --- |
| `svc/workspace` | Workspace layout, registry (`workspace.json`), locks + heartbeat, single instance, settings, Church Profile, weekly-work records |
| `svc/persistence` | Atomic save protocol, save journal, document state machine (`clean/dirty/saving/saveFailed/conflicted/readOnly`), recovery snapshots, 5-second flush bound, conflict capture |
| `svc/transactions` | Multi-resource transaction journal (`planned…rolledBack`), startup recovery, id-allocation persistence |
| `svc/assets` | Asset store (original/canonical/derived), resolver (portable id → local id + digest), raster canonicalization, SVG sanitization requests, missing-asset resolution |
| `svc/fonts` | Font records, family digests, validation via quarantine worker, resolver, embedding-permission enforcement |
| `svc/library` | Song Library, Scripture catalog, Saved Sections (immutable revisions, copy-on-write) |
| `svc/build` | Build queue (manual priority, preview supersession by `requestSequence`), Typst runner, compositor, revalidation, artifact records + immutability, preview lifecycle |
| `svc/export` | Review/Export orchestration, filename pattern engine, atomic export + hash verification, export event records, watermarking policy |
| `svc/history` | Version History snapshots, Trash, retention graph, permanent-deletion reference checking |
| `svc/backup` | Full backup/handoff creation + verification, restore transactions, backup closure projection against caps |
| `svc/packs` | Pack import/update/replace, trust state, signer continuity, quarantine workflow |
| `svc/sync` | Shared-library connections, head checks, download/publish flows, idempotent publish records |
| `svc/scripture-provider` | Adapter registry, connection records, request confirmation flow |
| `svc/ai` | Exchange records, managed-helper profiles + launcher (staged) |
| `svc/diagnostics` | Log sink with redaction, diagnostic bundles, About/version reporting |

UI layer (renderer): `ui/store` (immutable document state, patch-based
undo/redo, selection, mode), `ui/editor` (Page/Contiguous views, drag-drop,
direct editing), `ui/inspector`, `ui/structure`, `ui/preview` (pdf.js +
source-map navigation), `ui/review-export`, `ui/library`, `ui/settings`,
`ui/design-system` (tokens, themes, a11y primitives).

## The Document Pipeline

The heart of the system is one deterministic pipeline, used identically by
the live preview, manual builds, and readiness evaluation:

```
document.json ──normalize/migrate──► canonical document
      │                                   │
      │                                   ├─► canonicalRevisionToken (save/conflict identity)
      │                                   │
      ▼                                   ▼
resolution (core/resolve):        field classification catalog
  field values → conditionals →   (render-affecting / readiness-only / inert)
  repeats → custom expansion              │
      │                                   │
      ▼                                   ▼
resolved render tree ──project──► render projection ──► renderInputHash
      │                                (+ asset/font/tool/locale identities)
      ├──────────────► editor pagination approximation (core/layout, renderer)
      ▼
core/typstgen ──► deterministic .typ ──► Typst runner ──► reader-order PDF
                                              │                │
                                              ▼                ├─► compositor ─► booklet PDF
                                       artifact record ◄───────┘
                                              │
core/readiness (projection + review state + artifact evidence)
      └─► readinessInputHash → findings → finalCandidate / approval records
```

Rules the pipeline architecture enforces:

- **One resolution implementation.** Rights generation, accessibility
  semantics, readiness, search indexing, and Typst generation all consume
  the same resolved render tree, so "only content that actually renders"
  means the same thing everywhere.
- **Classification is data.** Every persisted field is classified
  render-affecting, readiness-only, or inert in a catalog owned by
  `core/schema`; the hash builders and staleness logic read that catalog.
  Adding a field without classifying it fails CI. This is what makes
  "readiness-only edits never force recompilation" reliable.
- **Exact arithmetic.** `core/geometry` represents lengths as rationals over
  pt with the canonical conversion constants; rounding (0.001 pt, half away
  from zero) happens exactly once, at Typst emission or JSON persistence.
  No floats cross module boundaries.
- **Escaping at the leaf.** `core/typstgen` walks validated ASTs and emits
  app-owned constructs; user text is always emitted as escaped data. Raw
  Typst never enters from documents, imports, or AI values (schema forbids
  it; the generator has no passthrough).
- **Editor approximation is honest.** `core/layout` implements the break
  matrix and fragment rules once; the renderer uses it with measured pixel
  heights, the generator relies on Typst for actual measurement. Divergence
  is possible only in measurements, never in break semantics; the PDF is
  authoritative and the preview state machine surfaces staleness.

## Persistence And Workspace Architecture

The workspace layout, schema set, and storage boundaries follow spec.md
(Project Files) exactly. Architectural mechanisms on top:

- **Single-writer services, serialized per resource.** Each managed resource
  has one owning service; writes are queued per resource id, eliminating
  intra-process races. Cross-resource operations must use the transaction
  journal.
- **Atomic save protocol** (in `svc/persistence`): lock → verify disk hash
  equals base token → write temp in target dir → fsync → validate → rename →
  durably update registry, journaled so startup can complete or roll back
  the two-file (document + registry) commit. Crash leaves old-complete or
  new-complete, never partial.
- **Autosave scheduling**: 500 ms debounce, ≤ 2 s from first unsaved edit to
  a save attempt, retry ladder (1/2/5/10/30 s), and an independent bounded
  recovery-snapshot writer that guarantees the 5-second crash-loss bound
  even when canonical saves fail. If both fail, the UI enters the persistent
  `changes not protected` state.
- **Locking**: `.workspace.lock` with instance id, PID, host/user
  discriminator, and 5 s heartbeat; staleness requires 30 s silence plus a
  process-identity check; uncertain cases open read-only.
- **Transactions**: imports, pack updates, migrations, restores, and asset
  migrations run as `planned → staged → committing → committed` journals
  with pre-allocated ids (retries reuse allocations), staged files invisible
  to the registry until the commit marker is durable, and pointer advances
  as the final step. Startup recovery runs before any document opens and
  never guesses — ambiguity opens the workspace read-only.
- **History/Trash/retention**: Version History snapshots are immutable and
  hash-deduplicated; Trash preserves identity and dependencies; a single
  retention graph (documents, snapshots, artifacts, pack maps, weekly-work
  links, conflict records, in-progress backups) answers every "may this
  revision be garbage-collected?" question for Trash, pack updates, and
  cleanup alike.
- **Backup closure projection**: `svc/backup` maintains the projected
  full-backup payload size/entry count; `svc/transactions` consults it
  before commit so the workspace can never grow past backupability caps.

## Identity And Hashing

- `core/ids` gives every identity class a distinct branded type (portable
  asset id, local resource id, credit key, content-rule id, …). Mixing them
  is a compile-time error; JSON boundaries re-validate at runtime. Portable
  schemas structurally cannot reference the local-resource-id type.
- Resolvers (assets, fonts) are the only translation points between portable
  ids and local storage; the renderer and generator resolve `asset:<uuid>`
  through them and never interpolate UUIDs into paths.
- Import remapping (bundle/pack collision rules, whole-closure remaps,
  element-id collision rewrites on subtree insertion) is implemented as
  schema-directed traversal in `core/manifest` + `svc/transactions` — the
  schema declares which fields are typed references; there is no
  string-search-and-replace path.
- All hashes are built from RFC 8785 canonical bytes via `core/canonical`;
  hash builders are pure functions over typed inputs so that the recorded
  evidence (artifact records, approval records, review hashes) is
  reproducible in tests.

## Editor And Frontend Architecture

- **State model.** The renderer holds the canonical in-memory document as an
  immutable value in `ui/store`. Edits are commands that produce JSON
  patches; undo/redo is the patch/inverse-patch stack with grouping rules
  (continuous typing coalesced; drag = one transaction; no entries for
  selection/view changes). Patches stream to the main process for autosave;
  the persisted-state machine feeds back save status.
- **Derived state is memoized, never stored.** Resolution output, editor
  pagination, rights rows, findings, and search text are derived from the
  document value + library state and cached by input hash. This makes
  "generated credit rows are never a second editable copy" and "mode changes
  never change bytes" structural properties.
- **Two modes as capability filtering.** Weekly Content vs Customize Layout
  is a UI capability mask over the same command set: commands declare their
  required mode and lock conditions (authoring policy, template locks), and
  disabled controls surface the reason. No separate document representation
  exists per mode.
- **Editor surface.** Page View segments the flow using `core/layout`
  approximation with editor-only spacers (never persisted, never affecting
  generation); Contiguous View shares the same element renderers. Drag/drop
  implements the deterministic source × target mapping table with full
  validation before any mutation and exactly one transaction per successful
  drop. Every drag operation has a labeled non-drag equivalent (structure
  tree / menu commands) sharing the same command implementations, which is
  how the accessibility parity requirement stays true over time.
- **Preview.** pdf.js renders preview/artifact PDFs with thumbnails, zoom,
  and state banners driven by the build state machine. Selection-to-preview
  navigation uses a source map emitted by `core/typstgen` (element id →
  page/region), recorded per artifact.
- **Inspector.** Edit-buffer semantics per the spec: commit-time validation,
  unparseable buffers persisted under `transactions/edit-buffer/`, one undo
  transaction per committed change.
- **Design system.** Semantic tokens with light/dark/high-contrast/forced
  colors; the task-language mapping table (spec.md:3592) is a single UI
  string catalog so internal terms cannot leak into normal screens.

## Untrusted Content, Import/Export, And Packs

All import paths share one spine:

```
bytes → quarantine dir → parse in sandboxed worker (bounded) →
manifest/schema/limit validation → user review summary →
journaled transaction (id allocation + remap tables) → commit
```

- `core/manifest` validates archive structure (canonical paths, declared
  entries, hashes, dependency closure, ZIP safety rules) before anything is
  parsed deeply; format-specific validation (fonts via shaping, SVG
  sanitization producing derivatives, raster canonicalization, PDF
  flattening) happens in quarantine workers with the limits table enforced
  during streaming.
- Sanitizers are versioned; canonical bytes produced by a sanitizer carry
  the sanitizer identity in provenance, and changing sanitizer output mints
  new portable asset ids (copy-on-write is universal).
- Pack trust (Ed25519 signatures, key pinning, signer continuity, key
  transitions, release sequences, equivocation detection) lives in
  `core/manifest` + `svc/packs`; trust state is workspace-local metadata and
  is never imported.
- Export is the inverse spine: normalized state → deterministic canonical
  archive serialization (sorted entries, fixed timestamps) → redistribution
  gate (packs) or dependency-completeness gate (bundles) → atomic write +
  re-read verification.

## Network Integrations

Both integrations are thin clients over the broker with all state machines
local:

- **Shared church library** (`svc/sync`): metadata-only head checks
  (explicit or per-connection opt-in on open, after the workspace is
  usable), explicit download into quarantine, then the standard pack update
  transaction. Publishing computes the draft closure, runs the
  redistribution gate, generates the archive deterministically, and uses
  idempotency-keyed conditional publish with durable operation records;
  head conflicts enter `Needs review` (no last-write-wins). Remote state
  never enters document hashes.
- **Scripture provider** (`svc/scripture-provider`): signed adapter
  descriptors, per-action user confirmation, responses sanitized in the
  worker into the allowlisted Scripture AST, then the same insertion
  transaction as Paste Scripture. Paste remains the always-available path;
  the connector only replaces acquisition.

## AI Boundary

- File exchange (`.ai-template.json` / `.ai-import.json`) is implemented
  entirely in `core/ai-exchange` + `svc/ai`: contract export projects the
  field contract + approved asset catalog through opaque exchange handles
  (never local ids/paths); import validates contract identity/version/hash,
  compares base hashes per field, and routes everything through the review
  UI into normal field-value writes with origin `ai` — one undoable edit.
- The managed helper launcher (staged) ships only where an enforceable OS
  isolation profile exists (sandboxed process, empty env allowlist, no
  network, exchange-directory-only filesystem, process-tree kill on
  timeout). Helper output is untrusted input into the same import validator.
- Nothing in the AI path can touch layout, readiness, waivers, or output
  destinations; the import schema has no vocabulary for them.

## Build, Artifacts, Readiness, Export

- `svc/build` owns the queue: manual builds save-then-build from the durable
  revision and take priority; preview builds compile labeled in-memory
  snapshots into `preview/` with per-document `requestSequence`
  supersession, deferred while dragging. Timeouts kill the process tree and
  clean partial output.
- Artifact records are immutable, hash-verified, and carry the full evidence
  set (tool hashes, font faces, asset digests, generator versions, rights
  projection hashes, page counts). `compile`, `compose`, and `revalidate`
  are distinct execution modes; booklet composition consumes only a verified
  parent reader artifact; revalidation reuses verified bytes by content
  address and never re-invokes tools.
- `core/readiness` evaluates the profile matrix against the projection,
  review state, and artifact evidence, producing findings with diagnostic
  codes and the non-waivable set enforced by the catalog. The page-count
  gate compares the verified reader-order logical page count.
- `svc/export` re-verifies the full hash chain immediately before copying
  bytes (never rebuilding behind an approval), applies the filename pattern
  engine and collision rules, watermarks drafts/proofs at build time (not
  export time), and records export events with private locators.

## Accessibility Architecture

- Editor: the design system bakes in focus management, roles/names/states,
  target sizes, announcement channels (status vs interruption), and
  non-color state signaling; command parity (drag vs labeled action) is
  enforced by implementing both over the same commands. CI runs automated
  checks; release acceptance runs the human task matrix.
- PDF: `core/typstgen` emits semantic mapping (headings, lists, tables with
  declared headers, figures/artifacts, reading order including page-level
  content semantics and canvas `semanticOrder`) so that when the staged
  `accessibleFinal` profile ships, tagged output is a generator capability
  plus the pinned Typst `ua-1` mode plus the bundled validator — not a
  retrofit. Accessible output is always reader-order.

## Packaging, Update, Uninstall

- One build pipeline produces: signed `.msi` (Authenticode + timestamp),
  AppImage, `.deb`, and a signed release tarball + SHA-256 manifest consumed
  by the pacman/AUR recipes (which pin and verify, never fetch unpinned
  build code).
- The bundle contains the editor runtime, pinned Typst executable, bundled
  Noto fonts + licenses, schema catalog, migration logic, generic starters,
  compositor, and (staged) validator + JRE; startup verifies component
  hashes and reports them in About/diagnostics. No church-specific content
  ships in the bundle.
- No in-app updater. First launch after an update runs workspace migration
  through the journaled recovery contract; downgrade opens read-only or
  refuses with a clear version error. Uninstall preserves workspaces.

## Cross-Cutting Rules For Contributors

- **Determinism hygiene.** No wall-clock, locale, environment, RNG, or
  machine-memory influence inside `core/*` pipeline code; timestamps and
  UUIDs are injected at service boundaries. Limits are constants, never
  scaled to hardware.
- **Diagnostics discipline.** All failures produce structured
  `CBB-<DOMAIN>-<NNNN>` records via `core/diagnostics`; user-facing text
  comes from the catalog; redaction classes are applied at the log sink, not
  ad hoc at call sites.
- **Schema-first changes.** A persisted-field change touches, in one PR: the
  schema, normalization/migration, the field classification catalog, the
  inspector, the renderer/generator if render-affecting, and `spec.md`.
- **Internal vocabulary stays internal.** UI strings come from the
  task-language catalog; ids/hashes/pointers appear only under
  Advanced/Diagnostics surfaces.

## Repository Layout (target)

```
app/
  core/            # runtime-agnostic packages (ids, canonical, geometry,
                   # schema, richtext, document, resolve, rights, layout,
                   # typstgen, hashes, readiness, diagnostics, manifest,
                   # scripture, ai-exchange)
  services/        # main-process services (workspace, persistence,
                   # transactions, assets, fonts, library, build, export,
                   # history, backup, packs, sync, scripture-provider, ai,
                   # diagnostics)
  workers/         # quarantine parsers, typst runner, compositor, validator
  ui/              # renderer (store, editor, inspector, structure, preview,
                   # review-export, library, settings, design-system)
  shell/           # electron main entry, ipc contract, preload, packaging
  schemas/         # bundled JSON Schema catalog (source of truth: /schema)
  starters/        # generic accessibility-ready starter templates
  test/            # golden files, pagination matrix, fuzz corpora,
                   # state-machine model tests, acceptance harnesses
```

## Testing Strategy

- **Golden determinism tests**: corpus of documents → normalized JSON,
  render projection, hashes, generated Typst, and (per pinned Typst) PDF
  page counts must be byte/hash-stable across platforms and repeated runs.
- **Pagination matrix tests**: every break-matrix and fragment rule has a
  paired test asserting editor-approximation semantics equal generated-Typst
  semantics on constructed fixtures.
- **State-machine model tests**: persistence, lock, conflict, transaction,
  and build queues tested with model-based/fault-injection tests (kill
  between fsync and rename, journal replay, heartbeat loss, PID reuse).
- **Security tests**: fuzzing + hostile-fixture suites for every quarantine
  parser (zip-slip, ratio bombs, SVG payloads, font table abuse, PDF
  actions), limits tested exactly-at/one-over, redaction snapshot tests.
- **Schema round-trips**: migration fixtures for every legacy shape
  (paths, `cellPadding`, legacy fonts, legacy Scripture/music), plus
  forward-compatibility (newer-version read-only) cases.
- **Accessibility**: automated audits in CI plus the release-gating human
  task matrix (Narrator/NVDA, Orca; keyboard-only flows).
- **Acceptance harnesses**: scripted versions of the spec's task benchmarks
  run in CI where automatable; the volunteer studies remain manual release
  gates.

## Delivery Staging

Aligned with the spec's release-scope table; architectural point: every
staged feature has its seam built in v1 so staging never forces rework.

1. **Foundation**: workspace + persistence + transactions + schema/migration
   engine; document model + resolution; geometry; Typst generation; build
   runner; artifact records. (Everything else depends on this spine.)
2. **Editor v1**: store/undo, Page View + approximation, inspector,
   drag/drop + parity commands, preview, direct editing, rich text.
3. **Weekly workflow**: templates → Create This Week, rollover, weekly
   work/brief/checklist, stale-content review, document library, Church
   Profile/Song Library/Scripture catalog, rights engine, Review & Export
   with `printFinal`, booklet compositor, backup/restore, history/trash.
4. **Staged wave 1**: resource-pack import (full quarantine pipeline is
   already mandatory), diagnostic bundles polish, AI contract file exchange.
5. **Staged wave 2**: pack creation/export/update, Shared church library,
   Scripture provider connector, `accessibleFinal` (validator + JRE),
   approval records, managed AI helper.

## Risks And Open Questions

- **Typst tagged-PDF maturity.** `accessibleFinal` depends on Typst ≥ 0.14
  `ua-1` output quality for our semantic mapping (tables, artifacts,
  reading order). Mitigation: the generator emits semantics from day one;
  validator integration is staged; track upstream and pin per release.
- **Editor pagination fidelity.** Approximating Typst's line breaking with
  DOM measurement will diverge in edge cases. Mitigation: PDF authority +
  staleness UX are spec'd; invest in a measurement harness comparing
  approximation vs compiled output over the golden corpus to keep divergence
  visibly small.
- **veraPDF/JRE bundling weight.** A bundled JRE is heavy; evaluate a
  profile-compatible native validator before wave 2, but do not block the
  architecture on it (worker boundary is validator-agnostic).
- **Electron on AUR/pacman.** Distro-packaged Electron versions drift; the
  pacman/AUR packages must bundle our pinned Electron rather than depend on
  the system package, at some size cost, to preserve the pinned-component
  guarantee.
- **Performance at hard caps.** 20 k persisted nodes / 50 k expanded nodes
  with memoized resolution needs early benchmarking; the derived-state
  cache keys (input hashes) are designed for incremental invalidation, but
  the budget must be validated in Foundation, not after Editor v1.
- **Exact-arithmetic library choice.** Rational-over-pt arithmetic needs a
  vetted implementation (or a small audited in-house module); decide in
  Foundation with the golden determinism tests as the acceptance bar.
