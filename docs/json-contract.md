# JSON contract v1

Three versioned documents form the durable interface:

- `BulletinDocumentV1` contains the complete weekly semantic block sequence, a pinned template version, resolved Scripture snapshots, and narrow per-week layout hints.
- `TemplateV1` contains the 7 × 8.5-inch page contract, theme, reusable starter blocks, and filler-page policy.
- `LibraryManifestV1` catalogs immutable versions of church-approved text and assets with their copyright notices.

The corresponding JSON Schemas are the machine-readable source of truth in `schemas/`.

## Bulletin blocks

Every block has a stable `id` and discriminating `type`. Supported types are:

| Type | Purpose |
| --- | --- |
| `titlePage`, `churchInfo` | Full-page identity content |
| `heading`, `sectionHeading`, `sermonTitle` | Document hierarchy |
| `richText`, `responsiveReading` | Structured paragraphs and minister/congregation responses |
| `scriptureReading` | Reference, translation, caption, and a reproducible resolved snapshot |
| `song`, `libraryText` | Version-resolved approved library content |
| `announcements`, `copyright` | Back matter and generated notices |
| `fullPageAsset` | Inserted image or original PDF page |
| `spacer` | Small, bounded semantic spacing |
| `custom` | User-defined text layout with named weekly or bulletin-data bindings |

Rich text is represented as paragraphs containing text or named-symbol runs. It deliberately excludes arbitrary HTML and CSS. The only weekly layout hints are `pageBreakBefore`, `keepTogether`, `density`, `fit`, and `cropAnchor`.

A reusable custom-block definition is stored in the workspace library. It has a human-readable `name`, a `layoutText` string, named `bindings`, and presentation settings for width, placement, padding, spacing, alignment, typography, fill, and border. Placeholders use double braces, such as `{{serviceTime}}`. A binding can expose a new weekly input or read `info.title`, `info.date`, `info.churchWeek`, `info.series`, or `church.name`.

Adding a custom block to a template creates a self-contained snapshot with a `definitionId`. Later edits to or deletion of the library definition do not invalidate already-published templates and bulletins. Weekly values are stored on the bulletin block under `values`.

## Reproducibility

- Bible passage text is copied into the bulletin with its source, retrieval timestamp, translation, and attribution. A later network failure therefore cannot change an existing bulletin.
- Bulletins pin template and selected library-item versions. Legacy unpinned references resolve to the highest available version, while old versions remain in the manifest for reproducible published projects.
- One-off assets are copied into that week's project folder. All paths are workspace-relative, and paths escaping the workspace are rejected.
- Export snapshots are stored in `revisions/`; PDF output is padded to a multiple of four pages.

## Future music and AI tools

Library assets accept named `variant` values. A future music compositor can publish verse-specific PNG variants without changing the renderer's core content model.

A future AI importer should emit proposed changes—not an entire trusted document. Each proposal should identify a JSON path, source excerpt, proposed value, and confidence; the weekly user selects changes, and the resulting document must pass the same schema and semantic validation as manual edits.
