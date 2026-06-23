# Typst Bulletin

This is the Typst port of the Lamb of God weekly bulletin project. All Typst
files live under `typst/` and reuse the existing shared assets in `../assets/`.

## Layout

- `templates/bulletin/` - reusable weekly bulletin starter
- `styles/bulletin.typ` - shared page setup and formatting functions
- `content/<MM DD YYYY>/` - generated weekly bulletins
- `pdf/` - compiled Typst PDFs
- `scripts/build.sh` - scaffold, generate private data, compile

## Build

From the repository root:

```bash
bash typst/scripts/build.sh "06 07 2026"
```

The script creates `typst/content/06 07 2026/` from the template if needed,
generates `private-data.typ` locally, and compiles to
`typst/pdf/06 07 2026.pdf`.

## Requirements

- Typst CLI installed and available as `typst`
- Optional: `pdfinfo` for the booklet page-count warning

The build script passes `../assets/fonts` as a Typst font path so the bulletin
can use Calibri, Eras Demi ITC, and Wingdings from the existing assets folder.

## Private Data

Do not open generated `private-data.typ` files. They are ignored by git and are
generated only by `typst/scripts/build.sh` from `../assets/church/information.md`.

## QR Code

The LaTeX template uses a QR-code package. The Typst port includes a boxed
giving placeholder that prints the giving URL. Replace `giving-qr` in
`styles/bulletin.typ` with a Typst QR package or generated image when a real QR
code is needed.
