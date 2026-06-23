#!/usr/bin/env bash
# Build a Typst bulletin: scaffold content, generate private data, compile PDF.
# Terminal output is filtered for common PII patterns.
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: bash typst/scripts/build.sh \"MM DD YYYY\"" >&2
  exit 2
fi

DATE_DIR="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TYPST_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$TYPST_DIR/.." && pwd)"
TEMPLATE_DIR="$TYPST_DIR/templates/bulletin"
CONTENT_DIR="$TYPST_DIR/content/$DATE_DIR"
PDF_DIR="$TYPST_DIR/pdf"
PDF_PATH="$PDF_DIR/$DATE_DIR.pdf"
INFO_FILE="$REPO_ROOT/assets/church/information.md"
PRIVATE_DATA="$CONTENT_DIR/private-data.typ"

pii_filter() {
  grep -vE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|[0-9]{3}[-. ][0-9]{3}[-. ][0-9]{4}|pastorcell|council' || true
}

typst_escape() {
  sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

mkdir -p "$TYPST_DIR/content" "$PDF_DIR"

if [ ! -f "$CONTENT_DIR/bulletin.typ" ]; then
  mkdir -p "$CONTENT_DIR"
  cp -R "$TEMPLATE_DIR"/. "$CONTENT_DIR"
  echo "--- Created typst/content/$DATE_DIR from template ---"
fi

if [ -f "$INFO_FILE" ]; then
  PASTOR_CELL=$(awk '
    /^## Pastor$/ { flag = 1; count = 0; next }
    /^## / && flag { flag = 0; next }
    flag && /^[[:space:]]*- / {
      gsub(/^[[:space:]]*- /, "")
      gsub(/^[[:space:]]/, "")
      if (count == 2) { print $0; exit }
      count++
    }
  ' "$INFO_FILE" | typst_escape)

  {
    printf '#let private = (\n'
    printf '  pastorcell: "%s",\n' "$PASTOR_CELL"
    printf '  council: (\n'
    awk '
      function esc(s) {
        gsub(/\\/, "\\\\", s)
        gsub(/"/, "\\\"", s)
        return s
      }
      /^## Council Members$/ { flag = 1; count = 0; next }
      /^## / && flag { flag = 0; next }
      flag && /^[[:space:]]*- / {
        gsub(/^[[:space:]]*- /, "")
        gsub(/^[[:space:]]/, "")
        if (count == 0) name = $0
        else if (count == 1) email = $0
        else if (count == 2) {
          phone = $0
          printf "    (name: \"%s\", email: \"%s\", phone: \"%s\"),\n", esc(name), esc(email), esc(phone)
        }
        count++
        if (count > 2) count = 0
      }
    ' "$INFO_FILE"
    printf '  ),\n'
    printf ')\n'
  } > "$PRIVATE_DATA"
  echo "--- Generated private data ---" | pii_filter
else
  cp "$TEMPLATE_DIR/private-data.typ" "$PRIVATE_DATA"
  echo "--- No private info file found; using empty private data ---"
fi

if ! command -v typst >/dev/null 2>&1; then
  echo "--- FAILED: typst command not found ---" >&2
  exit 127
fi

echo "--- Compiling Typst ---"
set +e
typst compile --root "$REPO_ROOT" --font-path "$REPO_ROOT/assets/fonts" "$CONTENT_DIR/bulletin.typ" "$PDF_PATH" 2>&1 | pii_filter
STATUS=${PIPESTATUS[0]}
set -e

if [ "$STATUS" -ne 0 ]; then
  echo "--- FAILED: Typst compile exited with $STATUS ---" >&2
  exit "$STATUS"
fi

if command -v pdfinfo >/dev/null 2>&1; then
  PAGES=$(pdfinfo "$PDF_PATH" 2>/dev/null | awk '/^Pages:/ { print $2 }')
  if [ -n "${PAGES:-}" ] && [ "$((PAGES % 4))" -ne 0 ]; then
    echo "--- WARNING: $PAGES pages is not a multiple of 4 for booklet printing ---"
  fi
  echo "--- SUCCESS: typst/pdf/$DATE_DIR.pdf (${PAGES:-?} pages) ---"
else
  echo "--- SUCCESS: typst/pdf/$DATE_DIR.pdf ---"
fi
