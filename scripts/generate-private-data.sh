#!/bin/bash
# Generate private-data.tex from assets/church/information.md
# Usage: ./scripts/generate-private-data.sh <content_date_dir>
# Example: ./scripts/generate-private-data.sh "content/06 07 2026"

set -euo pipefail

INFO_FILE="assets/church/information.md"
CONTENT_DIR="$1"
OUTPUT_FILE="$CONTENT_DIR/private-data.tex"

if [ ! -f "$INFO_FILE" ]; then
    echo "Error: $INFO_FILE not found" >&2
    exit 1
fi

if [ ! -d "$CONTENT_DIR" ]; then
    echo "Error: $CONTENT_DIR not found" >&2
    exit 1
fi

# Extract pastor cell phone (first phone under ## Pastor)
PASTOR_CELL=$(awk '
  /^## Pastor$/ { flag = 1; count = 0; next }
  /^## / && flag { flag = 0; next }
  flag && /^[[:space:]]*- / {
    gsub(/^[[:space:]]*- /, "")
    gsub(/^[[:space:]]/, "")
    if (count == 2) { print $0; exit }
    count++
  }
' "$INFO_FILE")

# Extract council rows.
# Format:
#   - Name
#       - email
#       - phone
COUNCIL_ROWS=$(awk '
  /^## Council Members$/ { flag = 1; count = 0; next }
  /^## / && flag { flag = 0; next }
  flag && /^[[:space:]]*- / {
    gsub(/^[[:space:]]*- /, "")
    gsub(/^[[:space:]]/, "")
    if (count == 0) name = $0
    else if (count == 1) email = $0
    else if (count == 2) {
      phone = $0
      printf "%s & %s & %s \\\\\n", name, email, phone
    }
    count++
    if (count > 2) count = 0
  }
' "$INFO_FILE")

cat > "$OUTPUT_FILE" <<EOF
\renewcommand{\PastorCell}{$PASTOR_CELL}
\renewcommand{\CouncilRows}{
$COUNCIL_ROWS}
EOF

echo "Generated $OUTPUT_FILE"
