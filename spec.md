# Church Bulletin Builder Spec

This document is the source-of-truth behavior spec for the Typst Church Bulletin
Builder. It describes the JSON document model, editor behavior, and Typst/PDF
rendering rules the app should preserve as new features are added.

## Goals

The builder provides a local GUI-first workflow for creating church bulletins and
reusable bulletin templates without hand-editing Typst for normal layout work.

The builder must:

- Store all editable layout/content state in JSON.
- Generate Typst source deterministically from that JSON.
- Compile PDFs with the Typst CLI and shared project assets.
- Let non-technical users place and edit elements with predictable visual
  feedback.
- Keep the editor's page, margin, flow, and canvas behavior aligned with the
  rendered PDF wherever practical.

## Project Files

Projects are disk-backed folders under `typst/`.

- Bulletins are stored in `typst/content/<name>/document.json`.
- Generated bulletin Typst is stored beside it as `document.typ`.
- Templates are stored in `typst/app/templates/<name>/template.json`.
- Generated template Typst is stored beside it as `template.typ`.
- Built PDFs are stored as `typst/pdf/<name>.pdf`.
- Live preview PDFs are temporary files under `typst/pdf/.preview/`.

Project names may contain only letters, numbers, spaces, underscores, and
hyphens, with a maximum length of 64 characters.

Project names must be unique within a user's own project namespace. Shared
projects from other users may have the same display name and should be shown
with owner context in the UI when needed.

## Users, Ownership, And Sharing

The builder should support authenticated users. After authentication is added,
project, template, and asset operations must run in the context of the current
user.

Every user-created resource must have an owner:

- Bulletin projects.
- Template projects.
- Uploaded or imported assets.

Resources are private to their owner by default. A user should only see resources
they own or resources that have been shared with them.

The authorization subsystem owns resource identity and access metadata. For each
owned resource it should track:

- Stable resource id.
- Owner user id.
- Users and groups with explicit access.
- Access level for each grant.
- Display metadata needed by the UI.

Owners can share projects, templates, and assets with other users. Sharing should
support at least these access levels:

- Viewer: can open and use the resource but cannot save changes to it.
- Editor: can open, use, and save changes to the resource.
- Owner: has full control, including sharing and deletion.

The server must enforce access control for all resource operations. The client UI
may hide unavailable actions, but client-side checks are not sufficient.

Access control applies to:

- Project and template listing, loading, saving, deleting, building, and preview.
- Asset listing, upload/import, preview, and rendering.
- PDF and live-preview PDF access.
- Template-based project creation.

Generated files inherit access from their source resource. A project PDF should
be visible only to users who can access that project.

When a resource references another resource, the builder must preserve a valid
access path for collaborators. For example, if a shared project uses a private
asset, the owner must either share that asset too or the app must warn before the
project is shared.

Shared resources should remain single resources rather than copied forks by
default. A user may explicitly duplicate a shared resource into their own
namespace when they need an independent copy.

System-provided church assets or starter templates may exist as system-owned
resources. They should use the same access-control model as user-created
resources, even if they are shared with all users by default.

## Document Model

Every project has this top-level shape:

```json
{
  "version": 1,
  "kind": "bulletin",
  "name": "07 05 2026",
  "page": {},
  "elements": []
}
```

The `kind` field is either `bulletin` or `template`. Bulletins and templates use
the same layout model; they differ by storage location and user workflow.

The `elements` array is a linear flow. The order in this array is the order used
by the editor, Typst generation, and PDF output.

Each element has these common fields:

- `id`: stable editor identifier matching `^[A-Za-z][A-Za-z0-9_-]*$`.
- `type`: element type.
- `name`: user-facing label in the inspector.
- `width`: element width.
- `height`: element height.
- `margin`: vertical flow spacing around the element.
- `padding`: inset inside the element box.
- `style`: visual style object.
- `schema`: optional data-field definitions for template/custom workflows.
- `data`: type-specific content.

Numeric length values are editor pixels. During Typst generation they convert to
points at `0.75pt` per editor pixel. Unit strings are preserved where legal.

## Page Model

The page model defines both the editor page and the Typst PDF page.

- `page.width` and `page.height` are editor dimensions in pixels.
- `page.typstWidth` and `page.typstHeight` are Typst page lengths.
- `page.background` is the PDF/editor page fill color and defaults to `#ffffff`.
- `page.margins.top`, `right`, `bottom`, and `left` define the content box.
- Legacy `inner` and `outer` margins may be normalized to `left` and `right`.

The default physical page is `7in` by `8.5in`. The editor's default matching
pixel size is `672` by `816`, using `96px` per inch.

Margins are mandatory layout constraints. Flow elements, canvas elements, and
canvas children must stay inside the page content box in both the editor and the
generated PDF. Elements may not intentionally render into margins.

The content box is:

```text
content width = page width - left margin - right margin
content height = page height - top margin - bottom margin
```

## Lengths And Units

The model accepts these length forms:

- Plain number: editor pixels.
- `pt`, `in`, `cm`, `mm`, `em`: absolute or font-relative length strings.
- `%`: percentage lengths where allowed.
- `fr`: fractional layout lengths where allowed by schema.
- `auto`: automatic size where allowed by schema.

The inspector should display physical page, margin, element size, element
spacing, canvas position, grid spacing, and stack spacing fields in inches by
default. Users may type plain numbers in those fields, and plain numbers in
inch-mode fields mean inches.

Font size and border width remain raw length fields. They accept plain numbers
or explicit length strings and are not displayed as inches by default.

## Style Model

The style object may contain:

- `font`: font family name, default `Calibri`.
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

## Element Types

### Text

Text elements have `type: "text"` and store content in `data.text`.

They render as styled text inside a block. Text content is escaped before Typst
generation.

### Image

Image elements have `type: "image"` and store image data in:

- `data.path`: path under the repository `assets/` directory.
- `data.fit`: `contain`, `cover`, or `stretch` in the schema.
- `data.alt`: optional future accessibility text.
- `data.caption`: optional future caption text.

The current Typst renderer supports `contain` and `cover`; any other value falls
back to `contain`.

### Date

Date elements have `type: "date"` and store date data in:

- `data.value`: date string.
- `data.format`: display format.
- `data.locale`: optional locale, default `en-US`.
- `data.prefix`: optional text before the date.
- `data.suffix`: optional text after the date.

The renderer formats dates in JavaScript before writing Typst text.

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

### Grid

Grid elements have `type: "grid"` and arrange child elements into rows and
columns.

Grid data includes:

- `data.rows`: minimum row count.
- `data.columns`: column count.
- `data.cellPadding`: current gap/gutter value.
- `data.rowGap`: reserved by schema for future row-specific gaps.
- `data.columnGap`: reserved by schema for future column-specific gaps.

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
- Canvas height is capped to the page content height.
- `auto` canvas height grows to fit children, with a minimum visual height.
- Canvas children are clamped so their boxes remain inside the canvas width and
  page content height.
- Canvas child `auto` width uses an editor natural-size estimate for placement
  and clamping.

### Page Break

Page break elements have `type: "pageBreak"` and force following flow content
onto the next PDF page.

In Typst they render as `#pagebreak()`. In editor Page View, they consume the
remaining visible content area of the current page so the next flow element
starts on the next page.

## Flow Layout

Top-level elements are rendered in linear order. Normal flow elements render as
Typst blocks. `margin` emits vertical spacing before and after the block when
greater than zero.

Flow width is resolved against the page content box. Fixed widths wider than the
content box are clamped before Typst generation. Percentage and `auto` widths
are preserved.

The editor inserts new palette-click elements immediately after the selected
top-level flow element. If nothing is selected, if the page setup is selected,
or if no selected element maps to a top-level flow position, new elements append
to the end.

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
- Elements do not appear in top or bottom margins.
- If an element would cross the bottom margin and can fit on a fresh page, it is
  moved to the next page by an editor-only spacer.
- If an element begins after a page's content area, it is moved to the next
  page's content start.
- Page break elements expand to the end of the current page content area.

Editor-only pagination spacers are not persisted in JSON and must not affect
Typst generation.

Margin guide visibility is only a view preference. Hiding margin guides must not
change the page content box, pagination, element clamping, generated Typst, or
PDF output.

## User Settings

User settings are editor preferences, not document content. They should be
persisted per authenticated user after authentication is added. Before
authentication is implemented, they may be stored locally in the browser or app
workspace.

User settings should not be stored in project JSON unless they intentionally
change the document output. Page setup values such as page size, page color, and
margins are project settings, not user settings.

Editable user settings:

- View mode: `contiguous` or `page`. Controls whether the drag-and-drop editor
  shows one continuous flow or the scroll-based Page View.
- Margin guide visibility: `true` or `false`. Controls whether Page View draws
  top, right, bottom, and left margin guides. Margins continue to constrain
  layout even when guides are hidden.
- Live PDF preview: `true` or `false`. Controls whether edits automatically
  trigger live preview builds.
- Build detail visibility: `true` or `false`. Controls whether build output is
  expanded in the UI.
- Canvas snap: `true` or `false`. Controls whether canvas child movement snaps
  to a grid when canvas snapping is implemented.
- Canvas snap grid size: positive length. Controls the snap interval when canvas
  snapping is enabled.

User settings should travel with the user, not with a shared project. Opening a
shared project should use the current user's settings for editor view mode,
margin visibility, live preview behavior, and canvas snapping.

## Drag And Drop

The palette creates new elements. Existing elements can be reordered or moved
between supported containers.

Supported moves:

- Palette element into top-level flow.
- Existing top-level element reorder within top-level flow.
- Palette element or existing top-level element into any container.
- Container child from any container into any other container.
- Canvas child back into top-level flow.

Drag rules:

- Self drops are ignored.
- Dropping an element into its own descendant is ignored.
- A dragged container child uses its wrapper id as the draggable identity.
- Flow insertion before or after a canvas is allowed at the canvas top and
  bottom edge zones.
- Dropping onto a canvas surface positions the child by pointer location, then
  clamps it into the canvas bounds.

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

The selected id may refer to the page setup, a top-level element, or a container
child wrapper.

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

Inspector edits update the JSON model immediately, rerender the editor, autosave,
and schedule a live PDF build when Live PDF is enabled.

Keyboard behavior:

- `Delete` removes the selected element unless the page setup is selected.
- Arrow keys move a selected canvas child by one editor pixel.
- `Ctrl` plus an arrow key moves a selected canvas child by ten editor pixels.
- Arrow keys inside text inputs keep their normal text-editing behavior.
- Font-size arrow controls increment or decrement the selected font size.

## Undo And Redo

The editor should maintain an undo/redo history for document-editing actions.
The history is an editor session feature and does not need to persist across app
reloads unless explicitly implemented later.

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

## Persistence And Build

The app autosaves project JSON and regenerated Typst after edits. Manual saves
also normalize the project through the storage layer.

Manual builds:

- Save and render the project.
- Run `typst compile` from the repository root.
- Use the repository root as Typst root.
- Use `assets/fonts` as the Typst font path.
- Write the PDF to `typst/pdf/<name>.pdf`.
- Update the PDF preview frame when the build succeeds.

Live builds:

- Compile a normalized project snapshot without overwriting the main project
  files for every preview.
- Write preview Typst/PDF files under `typst/pdf/.preview/`.
- Defer queued live builds while a drag is active.
- Run the most recent queued live build after dragging ends.

## Assets

Assets should be stored by UUID, not by user-provided filename. The original
filename should be stored as display metadata in the asset database or equivalent
authorization-owned data structure.

Asset records should include:

- Asset UUID.
- Owner user id.
- Original filename for display.
- Media type.
- Storage location for the binary object.
- Users and groups with access.
- Access level for each grant.

Asset ownership and sharing must be managed by the authorization subsystem. The
asset service must check authorization before listing, reading, previewing,
rendering, updating, deleting, or sharing an asset.

Project JSON should reference managed assets by UUID or by a stable asset URI
that contains the UUID. It should not reference a user's private filesystem path
or depend on the original filename as an identifier.

Image assets must resolve through the app's asset service. Existing global
filesystem assets may continue to resolve under the repository `assets/`
directory during migration. Legacy filesystem paths are normalized to start with
`assets/` and must not contain `..`.

The server must not expose files outside `assets/` through the asset endpoint.
The asset list intentionally excludes `assets/church/information.md`.

Asset references should be stable across users who have access to the asset. A
shared project should not depend on another user's private filesystem path.

## Custom Elements And Bindings

Custom element schemas are reusable visual element definitions with named data
fields. A custom element schema includes:

- Stable `id` and user-facing `name`.
- `dataFields` describing bulletin-time inputs.
- `elements` containing the visual structure.
- Optional `defaultPlacement` and `previewData`.

Visual element bindings may point to custom data field ids. Bindings contain a
required `fieldId` and optional fallback/format metadata. Compatibility between
data fields and bound properties is described by schema metadata.

Custom element execution/render expansion remains a schema-level capability and
should be implemented without changing the common visual element model.

## Validation Expectations

The JSON schemas in `typst/schema/` define the valid persisted shape. Runtime
normalization should continue to protect older or partial project files by
filling defaults and migrating legacy layout details where safe.

Validation should reject or normalize:

- Unsafe project names.
- Asset paths outside `assets/`.
- Invalid page sizes.
- Invalid element ids.
- Negative persisted sizes and spacing where the schema forbids them.
- Unknown properties where the relevant schema sets `additionalProperties` to
  `false`.

When adding new persisted fields, update the relevant schema, normalization,
editor inspector, renderer, and this spec together.

## Known Future Work

These items are planned or tracked in `typst/todo.md`:

- User authentication, per-user resources, and sharing.
- User settings panel, including margin guide visibility.
- Synchronize editor scrolling with PDF preview scrolling.
- Drag-to-resize with resized dimensions saved as absolute inches.
- Undo and redo.
- Optional canvas snapping.
- Element alignment controls.
- Packaged executable workflow.
- Multi-element selection and select all.
- More faithful grid/stack editor rendering.
- Stronger input validation in the inspector.
