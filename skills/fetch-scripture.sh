#!/usr/bin/env bash
# Fetch a scripture passage from Bible Gateway (NIV 2011) and output
# clean text with paragraph breaks — no cross-references, footnotes, or HTML.
# Usage: bash skills/fetch-scripture.sh "Genesis 1:1-5"
set -euo pipefail

PASSAGE="$1"
ENCODED=$(echo "$PASSAGE" | sed 's/ /%20/g; s/:/%3A/g')

curl -s "https://www.biblegateway.com/passage/?search=${ENCODED}&version=NIV" \
  | perl -0777 -ne '
    # Extract the std-text div (contains actual scripture paragraphs)
    /<div[^>]*class=[\x27"]std-text[\x27"][^>]*>(.*?)<\/div>\s*<\/div>\s*<\/div>\s*<\/div>/s || next;
    $html = $1;

    # Extract each <p> tag content
    while ($html =~ /<p[^>]*>(.*?)<\/p>/sg) {
        $text = $1;

        # Replace <br> with space (preserves word boundaries in poetry)
        $text =~ s|<br\s*/?>| |g;
        # Remove all other HTML tags
        $text =~ s/<[^>]*>//g;
        # Remove HTML entities
        $text =~ s/&nbsp;//g;
        $text =~ s/&rsquo;/\x27/g;
        $text =~ s/&lsquo;/\x27/g;
        $text =~ s/&rdquo;/\x22/g;
        $text =~ s/&ldquo;/\x22/g;
        # Remove footnote markers [a], [b]...
        $text =~ s/\[[a-z]\]//g;
        # Remove cross-reference markers (A), (AB)...
        $text =~ s/\([A-Z]+\)//g;
        # Collapse whitespace
        $text =~ s/\s+/ /g;
        $text =~ s/^\s+|\s+$//g;

        print "$text\n\n" if $text;
    }
  '
