# Build

- When a user asks to build the document, use the templates/bulletin.tex
  template
- Load assets from the assets/ folder
- Before compiling, read `assets/church/information.md` and generate
  `private-data.tex` in the content directory with `\renewcommand` overrides
  for:
    - `\CouncilRows` — `Name & email & phone \\` for each council member
    - `\PastorCell` — pastor's cell phone
- If `assets/church/information.md` does not exist, prompt the user for that
  file, or prompt them for the individual fields if they prefer that.
- Compile with XeLaTeX
    - Place generated content in content/`<date>`/
- Compile to PDF to pdf/`<date>`.pdf
    - Date format: "MM DD YYYY"
