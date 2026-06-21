# Scripture Readings

- Scripture readings are treated as quotes with increased indentation.
- Each verse is preceded by a superscript verse number.
- Font style: regular
- Use NIV 2011 by default. You may use https://www.biblegateway.com/ for this.

## ⚠️ CRITICAL: Preserve Paragraph Structure

This is the most commonly missed rule. You MUST get this right.

**The problem:** Each time you fetch scripture, you must preserve the source's
paragraph groupings. Do NOT split every verse onto its own paragraph — the
verse number alone does NOT indicate a paragraph break.

**How to determine paragraph breaks:**
- Look at the Bible Gateway page. Multiple verses are grouped into visual
  paragraphs (separated by blank lines in their text view).
- Each of those visual paragraphs becomes one paragraph GROUP in LaTeX.

**How to write it in LaTeX:**
```
\verseref{1}{verse one text}  \verseref{2}{verse two continues same paragraph}
\verseref{3}{verse three still same paragraph}

\verseref{4}{new paragraph group starts here}
\verseref{5}{continues same paragraph}
\verseref{6}{still same paragraph}
```
- Within a paragraph group: **NO blank lines** between consecutive `\verseref{}`
  calls. They stay in the same paragraph.
- Between paragraph groups: Insert a **blank line** in the LaTeX source to
  create a `\par` break with `\parskip` spacing.

**When in doubt, fetch the passage from Bible Gateway and count the visual
paragraphs. Each `<p>` tag / visual block is one paragraph group — not each
verse.**
