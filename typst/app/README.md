# Church Bulletin Builder

This is a local web app for building Typst-based church bulletins and reusable
templates with a GUI-first workflow.

## Run

From the repository root:

```bash
cd typst/app
npm start
```

Then open `http://localhost:5177`.

## Current Capabilities

- Create disk-backed bulletin and template projects.
- Store projects as JSON:
  - Bulletins: `typst/content/<name>/document.json`
  - Templates: `typst/app/templates/<name>/template.json`
- Generate Typst source beside each project.
- Compile PDFs to `typst/pdf/<name>.pdf`.
- Drag elements from the palette into a page-width linear flow.
- Reorder existing elements by dragging them between live insertion slots.
- Fine tune `width`, `height`, margin, padding, font, colors, and borders.
- Edit type-specific data for text, image, grid, stack, and music elements.
- Autosave changes.
- Rebuild the PDF preview automatically when `Live PDF` is enabled.

## Element Types

- `Textbox` - styled text content.
- `Image` - image asset from the shared `assets/` folder.
- `Grid Container` - basic rows, columns, and cell text.
- `Stack Container` - vertical or horizontal list of text items.
- `Music` - placeholder for future hymn, psalm, song, and lead-sheet support.

## Notes

- The flow editor shows page width and element order, while the PDF preview is
  the final paginated Typst output.
- Templates and bulletins use the same document model; the app stores them in
  different folders.
- The music import tool, nested container editing, resize handles, and AI import
  workflow are still future work.
