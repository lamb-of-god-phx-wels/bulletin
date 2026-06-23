#!/usr/bin/env bash
# Build a bulletin: generate private data, compile, and copy PDF.
# Output is sanitized — PII (phones, emails) is filtered from terminal.
# Usage: bash scripts/build.sh "06 07 2026"
set -euo pipefail

DATE_DIR="$1"
CONTENT_DIR="content/$DATE_DIR"
PDF_PATH="pdf/$DATE_DIR.pdf"

# PII filter — strips email and phone patterns from terminal output.
# Always returns 0 so pipeline exit codes from xelatex are preserved.
pii_filter() {
  grep -vE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|[0-9]{3}[-. ][0-9]{3}[-. ][0-9]{4}|CouncilRows|PastorCell'
}

echo "--- Generating private data ---"
scripts/generate-private-data.sh "$CONTENT_DIR" 2>&1 | pii_filter

echo "--- Compiling ---"

compile() {
  (
    cd "$CONTENT_DIR"
    xelatex -interaction=nonstopmode bulletin.tex 2>&1 | pii_filter | tail -"$1"
    return "${PIPESTATUS[0]}"
  )
}

compile 20
compile 5

if [ -f "$CONTENT_DIR/bulletin.pdf" ]; then
  cp "$CONTENT_DIR/bulletin.pdf" "$PDF_PATH"
  PAGES=$(pdfinfo "$PDF_PATH" 2>/dev/null | grep Pages | awk '{print $2}' || echo "?")
  echo "--- SUCCESS: pdf/$DATE_DIR.pdf ($PAGES pages) ---"
else
  echo "--- FAILED: PDF not produced ---"
  exit 1
fi
