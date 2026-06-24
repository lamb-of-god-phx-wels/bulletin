# Bulletin Builder Prototype

This is a local, GUI-first prototype for creating and editing Typst bulletins.
It stores editable data as JSON and generates Typst/PDF output from that data.

## Run

From the repository root:

```bash
cd typst/app
npm start
```

Then open `http://localhost:5177`.

## What It Does

- Creates or loads `typst/content/<date>/bulletin.json`
- Regenerates `typst/content/<date>/bulletin.typ`
- Runs `typst/scripts/build.sh <date>`
- Shows `typst/pdf/<date>.pdf` in the browser preview
- Autosaves and rebuilds the PDF preview after edits settle for about one second

Use the `Live preview` toggle in the top bar to pause automatic rebuilds. The
`Build PDF` button still performs an immediate manual build.

## Prototype Limits

- It is not a full WYSIWYG editor yet.
- It edits structured bulletin fields, not arbitrary PDF coordinates.
- The PDF is generated output; `bulletin.json` is the source of truth.
- The giving QR is still the placeholder from the Typst style file.
