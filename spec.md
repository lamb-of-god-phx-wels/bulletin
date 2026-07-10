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
- Approve/finalize the bulletin.
- Export the final PDF for printing or distribution.

Creating a bulletin from scratch, duplicating a prior bulletin, and importing a
starter bulletin may be supported, but they are secondary workflows. Formal
templates and resource packs should provide the default starting point for weekly
bulletin creation.

## Offline Application And Workspace

The builder is a packaged desktop application for Windows and Linux, including
Arch Linux. A non-technical user should install it once and launch it from a
normal desktop, Start Menu, or app-launcher shortcut.

Distribution formats:

- Windows: signed `.msi` installer.
- Linux: AppImage, `.deb`, AUR package, and native pacman package.

The application bundle includes the editor runtime, the Typst executable,
required application fonts, JSON schemas, migration logic, and generic app
resources required for the application to run. The application bundle must not
include church-specific logos, images, templates, starter bulletins, or other
organization-specific content. Church-specific content is imported as resource
packs or created by the user in the application.

On first launch, the app should offer to create a local workspace in the
system-default user data location or let the user choose a different workspace
location. If the user accepts the default, the app creates the workspace without
requiring direct file-system interaction.

The app should support multiple workspaces, with one active workspace open at a
time. The UI should let the user create, select, and move workspaces without
manually editing app metadata or storage paths. Moving a workspace should update
the app's workspace registry only after the move succeeds.

Default workspace locations:

- Windows: `%APPDATA%/Church Bulletin Builder/`.
- Linux: `${XDG_DATA_HOME:-~/.local/share}/church-bulletin-builder/`.

The workspace is app-managed data. It may be hidden or stored in a location that
users do not normally browse. Normal interaction with bulletins, templates,
assets, PDFs, resource packs, and exports should happen through the
application UI.

The app does not need a dedicated full-workspace backup and restore command.
Project, template, and resource pack export/import workflows are the supported
app-level transfer and backup mechanism.

Only local workspace data is in scope. The operating system account and
file-system permissions are the access boundary for workspace data.

## Project Files

Projects are disk-backed folders inside the local workspace. Storage paths use
app-generated stable resource ids, not editable display names.

- Bulletins are stored in `<workspace>/bulletins/<resource-id>/document.json`.
- Generated bulletin Typst is stored beside it as `document.typ`.
- Templates are stored in `<workspace>/templates/<resource-id>/template.json`.
- Generated template Typst is stored beside it as `template.typ`.
- Imported assets are stored under `<workspace>/assets/<asset-uuid>/`.
- Imported resource pack metadata is stored under `<workspace>/resource-packs/`.
- Built PDFs are stored under `<workspace>/pdf/<resource-id>/`.
- Live preview PDFs are temporary files under `<workspace>/preview/`.

Project names may contain only letters, numbers, spaces, underscores, and
hyphens, with a maximum length of 64 characters.

Project names are user-facing display labels. They do not determine storage
identity and do not need to be globally unique. If duplicate names exist, the UI
should disambiguate them with metadata such as kind, last modified time, source
resource pack, or containing folder.

## Resource Identity

Every workspace-managed resource has a stable local resource id. Resource ids are
used for workspace storage paths, generated artifacts, local references, and
workspace metadata. Resource ids are not user-facing names.

Workspace-managed resources include:

- Bulletin projects.
- Template projects.
- Managed assets.
- Imported resource packs.
- Custom element schemas and other reusable library entries when they are stored
  independently.

Local resource ids should live in workspace metadata rather than inside the
portable project or template JSON document. This keeps document JSON portable and
allows imported projects, templates, and resource packs to receive new local ids
without rewriting normal document content. Export manifests may include source
resource ids as provenance metadata, but import must assign new local ids when
creating a new local copy.

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
  "page": {},
  "pageElements": [],
  "elements": []
}
```

The `kind` field is either `bulletin` or `template`. Bulletins and templates use
the same layout model; they differ by storage location and user workflow.

Creating a bulletin from a template copies the template content into a new
bulletin. Bulletins are not live-linked to the source template by default.

Templates may include a top-level `schema` object that defines named data fields
for manual form filling, custom workflows, and AI-assisted imports. Bulletins
created from templates may store filled values in a top-level `fieldValues`
object keyed by stable field id when values remain connected to the template
contract. If a workflow expands values directly into element `data`, it should
still preserve enough source metadata to support later review or re-import when
that behavior is intended.

The `elements` array is the normal body flow. The order in this array is the
order used by the editor, Typst generation, and PDF output.

The optional `pageElements` array contains explicit page-level elements such as
backgrounds, page numbers, headers, footers, and decorative elements. Page-level
elements render independently from normal body flow and may be anchored in page
margin regions when their placement allows it. Missing `pageElements` should be
treated as an empty array during normalization.

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

Persisted physical layout lengths should use explicit unit strings, with inches
as the default unit for page, margin, element size, spacing, canvas position, and
container gap fields. Editor pixels are a derived display/interaction projection,
not the preferred persisted representation for physical layout. Legacy numeric
length values are interpreted as editor pixels during migration and should be
normalized to explicit unit strings where safe.

## Page Model

The page model defines both the editor page and the Typst PDF page.

- `page.typstWidth` and `page.typstHeight` are the canonical persisted physical
  page lengths.
- `page.width` and `page.height` are derived editor dimensions in pixels, or
  legacy persisted editor dimensions that should be migrated when safe.
- `page.background` is the PDF/editor page fill color and defaults to `#ffffff`.
- `page.margins.top`, `right`, `bottom`, and `left` define the content box.
- Legacy `inner` and `outer` margins may be normalized to `left` and `right`.

The default physical page is `7in` by `8.5in`. The editor's matching pixel size
is derived using `96px` per inch, so the default editor projection is `672` by
`816` pixels.

Margins are mandatory layout constraints for normal body content. Flow elements,
canvas elements, and canvas children in the normal `elements` flow must stay
inside the page content box in both the editor and the generated PDF.

Explicit page-level elements may render in page margin regions when they are used
for page numbers, headers, footers, backgrounds, or decorative content. They must
stay within the physical page bounds, must not affect normal body pagination, and
must not allow arbitrary normal flow content to escape the content box.

The content box is:

```text
content width = page width - left margin - right margin
content height = page height - top margin - bottom margin
```

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

Text elements should support rich text editing. Rich text support should cover
headings, paragraph styles, bulleted and numbered lists, scripture formatting,
and inline bold/italic. Plain `data.text` remains valid for simple text fields.
When a structured rich-text representation is present, it should be validated
against the text schema and rendered deterministically to Typst without allowing
arbitrary unvalidated Typst source.

### Image

Image elements have `type: "image"` and store image data in:

- `data.assetRef`: stable managed asset URI in the form `asset:<uuid>`.
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
the local workspace asset library and normalize the image to `data.assetRef` at
the next safe persistence point. If the legacy path cannot be resolved, the app
should preserve unresolved source metadata for diagnostics and show the missing
asset relink workflow.

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
- `data.rowTracks`: optional row track sizes.
- `data.columnTracks`: optional column track sizes.
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

Grid tracks are configurable. When explicit track sizes are omitted, rows and
columns default to equal-sized tracks. Percentage tracks should be used for the
default equal-width/equal-height behavior. Explicit track definitions may use the
units allowed by the length/unit rules for grid tracks.

Only one child is allowed in a grid cell. If the user needs multiple elements in
a cell, they should place a stack, grid, or canvas inside that cell and nest the
additional elements inside the nested container. Drops or imports that would
place multiple direct children in the same cell should be rejected or resolved by
user choice before persistence.

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

### Page Break

Page break elements have `type: "pageBreak"` and force following flow content
onto the next PDF page.

In Typst they render as `#pagebreak()`. In editor Page View, they consume the
remaining visible content area of the current page so the next flow element
starts on the next page.

### Page-Level Elements

Page-level elements live in the top-level `pageElements` array rather than the
normal body `elements` flow. They use the common visual element model where
practical, plus page-placement metadata that describes their purpose, target page
range, and anchor region.

Supported page-level purposes should include:

- `background`: page background artwork or color treatment.
- `header`: repeated or page-specific heading content.
- `footer`: repeated or page-specific footer content.
- `pageNumber`: generated page number content.
- `decoration`: non-essential decorative artwork or rules.

Page-level elements may render in the top, bottom, left, or right margin regions
when their purpose and placement require it. They do not participate in normal
flow layout, do not create page breaks, and must not consume content-box height.
The editor should make page-level elements selectable and editable without
confusing them with body flow elements.

Page-level elements should be able to apply to all pages, first page only, last
page only, odd/even pages, or explicit page ranges when the schema supports those
targets. Unsupported page targeting should be rejected during validation rather
than silently ignored.

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

Vertical overflow may continue onto following pages at natural break points.
Natural break points include text line/paragraph boundaries, flow element
boundaries, stack child boundaries, and other renderer-supported vertical break
locations that preserve readable output.

Text elements may split across pages. When a text element splits, text should
continue in normal reading order and preserve styling, width, padding, and
available content area constraints.

An element taller than the page content area should split vertically when it has
natural vertical break points. If it has no safe vertical break point, it should
render with an overflow warning and remain constrained to the page content width.

Horizontal overflow is an error. Elements, container children, rows, columns,
images, and text must not intentionally extend beyond the page content width or
their containing layout box. The editor should clamp, reject, or warn before
persisting horizontal sizes/positions that cannot render within the allowed
width. Builds should fail or surface a blocking validation error when unresolved
horizontal overflow remains.

Page breaks force following flow content to the next page. Normal-flow vertical
spacing at page boundaries should not create visible body content in top or
bottom margins.

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

Editor-only pagination spacers are not persisted in JSON and must not affect
Typst generation.

Margin guide visibility is only a view preference. Hiding margin guides must not
change the page content box, pagination, element clamping, generated Typst, or
PDF output.

## User Settings

User settings are editor preferences, not document content. They should be
persisted locally in the app workspace or the platform's application settings
location.

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

User settings should stay with the local application/workspace, not with an
imported or exported project bundle. Opening an imported project should use the
current workspace's settings for editor view mode, margin visibility, live
preview behavior, and canvas snapping.

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

Generated final PDFs are expected to be accessible/tagged PDFs. Tagged PDF output
should include a meaningful reading order and semantic structure for headings,
paragraphs, lists, tables, figures, page numbers, and decorative artifacts where
those concepts are represented by the document model. Live preview PDFs may
prioritize speed, but final manual builds and exported PDFs should include PDF
tags when the selected output format is PDF.

Image alt text is optional. Image elements should still expose an optional alt
text field and an optional decorative/artifact setting. When alt text is
provided, it should be included in tagged PDF output. When an image is marked
decorative, the tagged PDF should mark it as an artifact or otherwise hide it
from assistive reading order where supported. Missing alt text must not block
normal save, build, or export.

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
retry when appropriate. Manual build/export should warn or block when the latest
document state has not been saved successfully.

Live preview failures are non-blocking when JSON autosave succeeds. If live
preview build fails but autosave succeeds, the document remains saved, the app
shows the preview failure, keeps the last successful preview marked as stale when
available, and provides build diagnostics plus retry/manual build actions.

Builds should have a 30 second timeout by default. Timed-out builds should fail
with diagnostics and clean up partial outputs.

Live preview builds should be debounced and identified by monotonically
increasing build ids. Obsolete queued or running preview builds may be canceled
when a newer build supersedes them. Only the newest successful build may update
the live preview. A later failed build must not replace the last successful PDF;
it should mark that PDF as stale.

Manual builds take priority over live preview builds. Starting a manual build
should save the current document, cancel or defer obsolete live preview work, and
build from the latest saved normalized state.

Project size, element count, and asset size limits are not fixed by this spec.
The app should still surface clear errors when a project or asset is too large to
save, import, preview, or build reliably on the current machine.

Manual builds:

- Save and render the project.
- Run the bundled Typst executable.
- Use an app-controlled Typst root that contains only the generated source and
  resolved local assets needed for the build.
- Use bundled application fonts and any imported resource fonts that are valid
  for the current project.
- Write the PDF under `<workspace>/pdf/<resource-id>/`.
- Update the PDF preview frame when the build succeeds.

Live builds:

- Compile a normalized project snapshot without overwriting the main project
  files for every preview.
- Write preview Typst/PDF files under `<workspace>/preview/`.
- Defer queued live builds while a drag is active.
- Run the most recent queued live build after dragging ends.

## Print And Export Workflows

PDF export is the required publication workflow. The app may later offer a direct
system print dialog, but exported PDFs are the canonical output for printing,
sharing outside the app, and archiving.

Folded or booklet-style bulletins are an expected working model. The default
`7in` by `8.5in` physical page represents one finished folded panel/page. The
editor should support booklet-oriented document setup and preview/navigation
where practical, including a view that helps users understand facing pages or
folded order. Exported PDFs are in document reading order by default.

The app is not required to generate professional printer imposition, crop marks,
bleed marks, or print-safe margin overlays. If users need printer-specific
imposition, they may use operating-system, printer-driver, or external PDF tools
outside the app.

Page sizes:

- `7in` by `8.5in` is the default page-size preset, not the only supported page
  size.
- Built-in presets should include common paper and bulletin sizes where useful,
  such as letter, legal, A4, and folded-panel presets.
- Templates, bulletins, and resource packs may define their own page-size and
  page-setup configurations.
- Page size and margins are document output settings and must be stored in the
  project or template JSON, not only in user preferences.

Export naming:

- Export filename formatting should be configurable.
- The default exported PDF filename format is `YYYY-MM-DD.pdf`.
- If the configured filename already exists at the destination, the app should
  prompt to replace it or generate a disambiguated filename.
- Exported filenames are display/output labels only and must not affect local
  resource ids or internal workspace storage paths.

Approval and finalization:

- The app should provide an approval/finalization step before publishing the
  final PDF.
- Finalization should save the current document, run validation, run a manual
  build, and show whether the generated PDF is ready to publish.
- Blocking validation errors or failed builds prevent final approval/export until
  resolved.
- Non-blocking warnings may be shown during finalization but should not prevent
  approval unless they affect print-readiness or accessible final output.
- Final approval should record local metadata such as approval time, approved
  output path, document revision, and build id when available.
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

Autosave errors should show an ephemeral toast error message and record full
details in diagnostics. If an autosave error means the latest document state is
not safely persisted, the document persistence state must remain visible until
the problem is resolved.

The app should define actionable handling for at least these failure classes:
corrupt JSON, failed migration, hard validation failure, missing asset, missing
or invalid font, missing bundled Typst executable, Typst compile error, compile
timeout, disk full, file permission failure, failed archive import, unsupported
bundle/resource-pack version, unsafe imported content, and workspace/file
conflict.

## Local File Conflicts

The app should prevent the same workspace from being opened for editing by more
than one app process at the same time. Opening a workspace should acquire an
app-managed workspace lock. If another live process holds the lock, the second
process should show a clear message and refuse to open that workspace for
editing. If a stale lock is detected, the app may offer a recovery flow after
explaining the risk.

Project and template saves should use both file locks and optimistic version
checks. Before replacing a document file, the app should confirm that the file on
disk still matches the revision, timestamp, or content hash that was last loaded
or saved by the current process. If it does not match, the save should stop and
enter conflict recovery instead of silently overwriting the changed file.

When a file changes on disk while the project is open, the app should prompt the
user to choose between the disk version and the current in-workspace version. The
app is not required to perform automatic merges. If the user accepts the disk
version, the project should reload from disk after warning about any unsaved
in-memory changes. If the user keeps the current version, the app should save it
only after confirmation and preserve a conflict backup when practical.

When a referenced workspace file is manually moved, renamed, deleted, or becomes
unreadable outside the app, the app should mark the affected resource as missing
or stale and prompt the user to relink, restore, import, or remove the reference.
The app must not silently recreate, delete, or overwrite user-modified files to
resolve the conflict.

Resource metadata should include enough revision information to detect stale
paths, stale generated artifacts, and changed asset binaries. Conflict handling
should preserve undo history where practical, but preventing silent data loss is
more important than preserving the current undo stack.

## Assets

Assets should be stored by UUID, not by user-provided filename. The original
filename should be stored as display metadata in the local asset metadata store.

Asset records should include:

- Asset UUID.
- Original filename for display.
- Media type.
- Storage location for the binary object.
- Source metadata such as imported resource pack id, imported bundle id, or
  manual upload/import source when available.
- AI visibility: `private`, `approved`, or `public`, defaulting to `private`.

The app's local asset library owns asset identity and metadata. Asset listing,
upload/import, preview, rendering, update, delete, and export operations work
against the local workspace.

AI visibility controls whether an asset may be exposed to a local AI helper or
included in an AI template contract's asset catalog. Private assets must not be
included in AI helper inputs or exported AI contracts unless the user explicitly
approves them. Approved and public assets may be included in AI helper context
and may be selected by AI output using managed `asset:<uuid>` references.

Project JSON should reference managed assets by stable asset URI in the form
`asset:<uuid>`. It should not reference arbitrary private filesystem paths or
depend on the original filename as an identifier.

Image assets must resolve through the app's local asset service. Legacy
filesystem asset references may be supported during migration only when they
resolve inside an approved legacy asset root. Legacy filesystem paths must not be
absolute and must not contain `..`.

The app must not resolve asset paths outside approved local asset roots. Path
resolution must canonicalize paths before reading and must reject traversal or
symlink escapes outside the workspace or approved import/build directories.

Asset references should remain stable when a project is exported, imported, or
moved to another workspace.

Project and template exports must include all referenced managed asset binaries.
If a referenced asset is missing from the local workspace, the app should ask the
user to add, import, or relink the asset before export or build proceeds. Users
should be able to relink a missing asset to another local managed asset or import
a replacement into the local asset library.

When an image asset is missing, the editor and PDF renderer should represent it
with an SVG missing-image icon sized to the image element's resolved container
box. The placeholder should preserve layout dimensions so missing assets are
visible without changing surrounding layout.

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
- Store imported assets in the local asset library with app-generated UUIDs.
- Store imported fonts in the local workspace font library with metadata linking
  them to the source pack.
- Preserve original names as display metadata.
- Track source pack metadata for display and diagnostics.
- Never require the original resource pack file to remain available after import;
  updates occur by importing another `.pak` with compatible update metadata.

Duplicate and update handling must be deterministic. When importing a pack whose
stable pack id or content ids match already imported local content, the app
should present a replace/update summary and require explicit user
confirmation before replacing compatible existing content. Display-name matches
alone are not storage identity, but the import summary should call them out so
the user understands what names will appear in the library.

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

Resource packs may be exported from the app when the user wants to distribute a
curated set of reusable local content. Exported resource packs should be `.pak`
zip-compatible archives containing `manifest.json`, selected resources,
referenced assets, included fonts when selected, AI-ready metadata when selected,
and an optional `readme.md`.

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

- A manifest describing the bundle contents and bundle format version.
- The project or template JSON.
- Referenced managed asset binaries and asset metadata.
- Referenced custom element schemas or style metadata when needed.
- Generated Typst for diagnostics.
- Latest built PDF output by default when one exists.

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
- Assign new local resource ids when importing as a new copy.
- Preserve document element ids unless an id collision inside the same document
  requires repair.
- Preserve display names, but avoid using display names as storage identity.
- Copy referenced assets into the local asset library.
- Report missing, unsupported, or unsafe bundle entries before import completes.

Export behavior:

- Export from the normalized current document state.
- Include all assets needed to open and render the exported project or template
  in another workspace.
- Avoid absolute local filesystem paths in exported JSON or manifests.
- Write a deterministic manifest so exported bundles can be inspected,
  validated, and re-imported reliably.

## Local File Safety

All imported files, resource packs, project/template bundles, assets, fonts, and
AI helper inputs should be treated as untrusted local content until validated.

SVG uploads and imports are allowed. SVG files must be treated as untrusted
images, not executable documents. The app should sanitize or safely render SVGs
before preview/build use, reject scripts and event handlers, reject external
network/file references, and avoid exposing arbitrary local files through SVG
links or embedded references.

Asset and bundle size limits should be reasonably generous for desktop use while
protecting the app from accidental huge imports. The exact numeric limits may be
configurable, but the app must enforce limits for individual assets, PDFs,
resource packs, project/template bundles, extracted archive size, and archive
entry count. When content exceeds a limit, the app should show an actionable
error that names the limit and the offending file or bundle.

Archive import safety:

- Scan archive entries for zip-slip paths before extraction.
- Reject absolute paths, empty paths, `..` traversal, platform-specific drive
  roots, and paths that normalize outside the intended extraction root.
- Reject or safely handle duplicate archive entries that normalize to the same
  output path.
- Extract imported archives to a quarantine/temp directory first.
- Validate manifests, file types, sizes, paths, fonts, assets, and referenced
  content before copying anything into the workspace.
- Copy only validated content from quarantine into the workspace.
- Clean up quarantine/temp content after successful import, failed import, or app
  restart recovery.

Filesystem safety:

- Canonicalize paths before reading or writing.
- Reject symlinks or hardlinks that escape approved workspace, import, preview,
  or build roots.
- Never follow imported archive entries directly into final workspace locations.
- Never allow generated Typst, imported manifests, SVGs, or AI helper output to
  read arbitrary local files.

Typst build safety:

- Build from an app-controlled root containing generated source plus resolved,
  validated, approved assets and fonts.
- Do not expose the full workspace or arbitrary user directories as the Typst
  root.
- Include only assets referenced by the normalized project/template and approved
  for the current build.

## AI-Assisted Data Import

The app should support AI-assisted creation of bulletin content from high-level
user instructions. AI assistance should fill structured template data, not make
the AI tool responsible for visual layout, pagination, storage paths, or Typst
generation.

The app remains an offline desktop app. AI support must not require a hosted
service or network access. The app should support file-based exchange with
external AI tools and should be able to launch/configure a local AI helper, such
as opencode, when the user has configured one.

When launching a local AI helper, the app should provide a controlled working
directory containing the AI template contract, user-provided source input, and
only the assets approved for AI access. The helper must not need arbitrary access
to the user's workspace. The app remains responsible for validating helper output
before applying anything to a bulletin.

Templates intended for AI filling must expose an AI-readable data contract. The
contract should include:

- Template id and template schema version.
- Template name, description, and intended use.
- Stable field ids.
- Field labels and human-readable descriptions.
- Field types, such as text, long text, date, number, boolean, choice, asset
  reference, array, or object.
- Required/optional status, defaults, examples, and validation constraints.
- Formatting instructions, such as date format, capitalization, tone, or maximum
  length.
- Binding metadata describing where each field is used in the visual template.
- An optional approved asset catalog containing only assets with `approved` or
  `public` AI visibility, including asset ids, names, media types, tags,
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
expose absolute local filesystem paths or private assets.

AI source input may be pasted text, a selected text document, selected image
files, or selected managed assets. Text and image fields are required for the
first AI-ready templates. Selected source images should be imported or staged
through the app so the helper can reference them without arbitrary filesystem
paths.

An AI data import result should be structured JSON. When exchanged as a file, it
should use the `.ai-import.json` extension. It should include:

- AI import format version.
- Target template id and compatible schema version.
- Optional target bulletin id when updating an existing bulletin.
- The original high-level user instruction, when available.
- Field values keyed by stable field id.
- Optional asset references using managed asset ids from the exported contract.
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

AI-generated text may use only text/markup forms supported by the target field
schema and Typst renderer. Fields that accept plain text should continue to
escape content before Typst generation. Fields that explicitly allow Typst
markup may preserve validated Typst-supported markup.

Import behavior:

- Validate the AI import result before applying it.
- Confirm the target template and schema version are compatible.
- Show a review screen with proposed field values, missing required values,
  validation errors, warnings, unresolved asset requests, and AI notes.
- Let the user accept, edit, reject, or resolve imported values before applying
  them.
- Apply accepted values by creating a new bulletin from the target template or by
  updating the current bulletin's template-bound field values.
- Preserve the original high-level instruction and AI tool metadata for
  diagnostics when available.
- Preserve template layout unless the user explicitly performs normal editor
  layout edits.
- Treat applying an AI import as an undoable document edit.
- Autosave and schedule live preview after the user applies the import.

Resource packs may include AI-ready templates, AI instructions, sample high-level
requests, sample AI data imports, and asset metadata useful for AI selection.

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

## Template And Custom Element Lifecycle

Templates are copied into bulletins when a bulletin is created from a template.
The copied bulletin receives its own local resource id and editable document JSON.
Later changes to the source template do not silently rewrite existing bulletins.

Custom elements have two related concepts:

- Custom element schema: the reusable definition, including data fields,
  bindings, visual structure, defaults, preview data, and schema version.
- Custom element instance: an instantiated use of that schema inside a template,
  bulletin, or another reusable structure.

Custom element instance field values are stored in the instance element's normal
`data` fields, just like other element content. The common visual element model
remains the persisted instance model; custom-element expansion should not require
a separate persisted visual tree shape.

Custom element instances should track enough schema metadata to know which schema
and schema version produced them. When a source custom element schema changes,
compatible schema updates may update existing instances. If data bindings,
required fields, field types, or visual structure changes cannot be applied
safely, the app should require user review and intervention before changing the
instance. Existing user-provided instance data should be preserved whenever
practical.

## Validation Expectations

The JSON schemas distributed with the app define the valid persisted shape.
Runtime normalization should continue to protect older or partial project files
by filling defaults and migrating legacy layout details where safe.

Validation should reject or normalize:

- Unsafe project names.
- Asset references that resolve outside approved local asset roots.
- Invalid page sizes.
- Invalid element ids.
- Invalid page-level element placement or unsupported page targeting.
- Normal-flow elements that intentionally render outside the content box.
- Rich-text content that contains unsupported blocks, invalid inline marks, or
  unvalidated Typst source.
- AI import files that target an incompatible template schema version.
- AI import field values with unknown field ids or invalid values for the field
  type/schema.
- Negative persisted sizes and spacing where the schema forbids them.
- Unknown properties where the relevant schema sets `additionalProperties` to
  `false`.

When adding new persisted fields, update the relevant schema, normalization,
editor inspector, renderer, and this spec together.

## Known Future Work

These items are planned or tracked in `typst/todo.md`:

- User settings panel, including margin guide visibility.
- Synchronize editor scrolling with PDF preview scrolling.
- Drag-to-resize with resized dimensions saved as absolute inches.
- Undo and redo.
- Optional canvas snapping.
- Element alignment controls.
- Multi-element selection and select all.
- More faithful grid/stack editor rendering.
- Stronger input validation in the inspector.
