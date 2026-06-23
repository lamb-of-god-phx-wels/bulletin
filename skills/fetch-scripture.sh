#!/usr/bin/env bash
# Fetch a scripture passage from Bible Gateway (NIV 2011) and output
# paragraph-separated text with verse numbers inline.
# Usage: bash skills/fetch-scripture.sh "Genesis 1:1-5"
set -euo pipefail

PASSAGE="$1"
ENCODED=$(echo "$PASSAGE" | sed 's/ /%20/g; s/:/%3A/g')

curl -s "https://www.biblegateway.com/passage/?search=${ENCODED}&version=NIV" \
  | sed -n '/<div class="passage-text">/,/<div class="passage-attributes">/p' \
  | sed -n '/<p[ >]/,/<\/p>/p' \
  | sed 's|<br */>|\n|g' \
  | sed 's/<[^>]*>//g' \
  | sed '/^[[:space:]]*$/d' \
  | sed 's/^[[:space:]]*//; s/[[:space:]]*$//'
