# LaTeX Bulletin

This is a LaTeX-based weekly church bulletin project. The templates in `templates/` produce print-ready booklets.

## Build

1. Create bulletin content from `templates/bulletin/` into `content/<date>/`
2. Load assets from `assets/`
3. Compile with XeLaTeX
4. Output PDF to `pdf/<date>.pdf`
    - Date format: "MM DD YYYY"

## Project Structure

- `templates/bulletin/` - Reusable bulletin template
- `agents/` - AI agent instructions and formatting rules
- `content/` - Bulletin content files
    - `<date>.build/` - .tex, sections, styles
- `pdf/` - Compiled PDFs
- `assets/` - Church logos, sermon series logos, fonts
- `doc/` - Documentation and screenshots

## Key Conventions

- Booklets are 7"x8.5" pages printed on 14"x8.5" paper, folded in half
- Page counts must be multiples of 4
- Always use the church-designated Sunday naming from the Christian Worship builder
- Read relevant agent files from `agents/` for formatting specifics when working on bulletins
