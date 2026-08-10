# JSON contract v1

Four versioned documents form the durable interface:

- `BulletinDocumentV1` contains the complete weekly semantic block sequence, a pinned template version, resolved Scripture snapshots, and narrow per-week layout hints.
- `TemplateV1` contains the 7 × 8.5-inch page contract, theme, reusable starter blocks, and filler-page policy.
- `PageTemplateV1` contains one publishable physical page, its margin policy, and an ordered mixture of native and canvas blocks.
- `LibraryManifestV1` catalogs immutable versions of church-approved text and assets with their copyright notices.

The corresponding JSON Schemas are the machine-readable source of truth in `schemas/`.

## Bulletin blocks

Every block has a stable `id` and discriminating `type`. Supported types are:

| Type | Purpose |
| --- | --- |
| `templatePage` | Full-page reusable content |
| `canvas` | An explicitly sized inch-based positioned region |
| `heading`, `sectionHeading`, `sermonTitle` | Document hierarchy |
| `paragraph`, `richText`, `responsiveReading` | Optional-header paragraphs, free text, and minister/congregation responses |
| `scriptureReading` | Reference, translation, caption, and a reproducible resolved snapshot |
| `song` | Version-resolved approved music content |
| `list`, `copyright` | Generalized rich lists and generated notices |
| `image` | A flow-sized image with contain, cover, or fill fitting |
| `fullPageAsset` | Inserted image or original PDF page |
| `spacer` | Small, bounded semantic spacing |
| `group` | A recursively nested collection of blocks |
| `custom` | User-defined text layout with named weekly or bulletin-data bindings |

Rich text is represented as paragraphs containing text or named-symbol runs. It deliberately excludes arbitrary HTML and CSS. Every block can carry `layout` flow hints (`pageBreakBefore`, `keepTogether`, `density`, `fit`, and `cropAnchor`) and a structured `presentation` override. Presentation supports width, horizontal placement, four-side padding, before/after spacing, text alignment, typography, colors, fill, and borders. A template block establishes the default; a copied block in a weekly bulletin can override it without modifying the template.

A bulletin may set `layout.marginIn` to override the template's uniform page margin for that bulletin only. Preview pagination, guides, print rendering, and PDF export all use the effective override. Omitting it restores the pinned template's margin.

An inserted `templatePage` pins a page-template ID and version and embeds a complete snapshot. Local edits therefore remain available if the shared source is archived. Upgrading deliberately replaces the snapshot; exploding removes the wrapper and inserts its blocks into normal host flow. Fixed-margin pages use their saved margin, while inherited pages use the host margin.

Canvas scenes position native bulletin blocks and rectangle/line shapes using inch geometry. Native blocks retain the same bindings, content fields, assets, and presentation model they use in normal flow. Legacy canvas text and image objects are normalized to native `richText` and `image` blocks while preserving IDs, geometry, and z-order.

Native `richText`, including paragraph text and rich text positioned on a canvas, may bind to bulletin fields or versioned reusable text in the library. Bound text supports deterministic date formats and a local override that can be reset to the source value.

Container blocks use a recursive `children` array. Each `paragraph` contains an optional header `richText` child plus a body `richText` child. The container keeps them together semantically while each text child retains its own bindings, margins, padding, typography, ID, and presentation override. Setting the header’s bottom margin and body’s top margin to zero produces no forced gap.

Historical `churchInfo`, `libraryText`, and `announcements` blocks remain readable and editable for compatibility, but new documents compose the same results from native paragraphs, lists, images, and reusable page templates.

A reusable custom-block definition is stored in the workspace library. It has a human-readable `name`, a `layoutText` string, named `bindings`, and presentation settings for width, placement, padding, spacing, alignment, typography, fill, and border. Placeholders use double braces, such as `{{serviceTime}}`. A binding can expose a new weekly input or read `info.title`, `info.date`, `info.churchWeek`, `info.series`, or `church.name`.

Adding a custom block to a template creates a self-contained snapshot with a `definitionId`. Later edits to or deletion of the library definition do not invalidate already-published templates and bulletins. Weekly values are stored on the bulletin block under `values`.

## Reproducibility

- Bible passage text is copied into the bulletin with its source, retrieval timestamp, translation, and attribution. A later network failure therefore cannot change an existing bulletin.
- Bulletins pin template and selected library-item versions. Legacy unpinned references resolve to the highest available version, while old versions remain in the manifest for reproducible published projects.
- Reusable page instances pin and embed their published source version. The synchronized source lives under `page-templates/<id>/`.
- Weekly edits to shared song lyrics or reusable text are stored as `contentOverride` paragraphs on that bulletin block. The source library version remains unchanged and can be restored at any time.
- One-off assets are copied into that week's project folder. All paths are workspace-relative, and paths escaping the workspace are rejected.
- Export snapshots are stored in `revisions/`; PDF output is padded to a multiple of four pages.

## Portable fonts

Fonts are workspace assets rather than operating-system dependencies. In **Library → Fonts**, add a font family, select all of its TTF, OTF, WOFF, or WOFF2 files together, review the detected weight and style for each face, add any license notice, and save. Updating an existing family creates a new version; existing references stay pinned until explicitly upgraded.

Templates define named font roles under **Theme → Font roles**. Every theme has a required Body role and may add roles such as Display, Scripture, Caption, or Hymn. A role selects one exact font-family version. Changing that selection updates all content using the role, while content assigned directly to a family remains pinned to that family version.

Font pickers show theme roles first and direct font families second. Prefer roles for normal template design and direct families for deliberate exceptions. Missing bold or italic faces may be synthesized and are reported as warnings. A missing family file or legacy system-only CSS family is a blocking portability error and must be imported or replaced before PDF export.

## Future music and AI tools

Library assets accept named `variant` values. A future music compositor can publish verse-specific PNG variants without changing the renderer's core content model.

A future AI importer should emit proposed changes—not an entire trusted document. Each proposal should identify a JSON path, source excerpt, proposed value, and confidence; the weekly user selects changes, and the resulting document must pass the same schema and semantic validation as manual edits.
