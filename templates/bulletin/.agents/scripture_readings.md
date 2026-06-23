# Scripture Readings

- Scripture readings are treated as quotes with increased indentation.
- Each verse is preceded by a superscript verse number.
- Font style: regular
- Use NIV 2011 by default.

## ⚠️ CRITICAL: Bible Gateway HTML is the sole source of truth for paragraph structure

Always fetch the passage from Bible Gateway (https://www.biblegateway.com/) and use
the HTML `<p>` tags to determine the exact paragraph groupings. Do NOT guess,
infer, or rely on other sources. The `<p>` tag boundaries in the Bible Gateway
HTML definitively define where paragraph breaks go in the LaTeX output.

## ⚠️ CRITICAL: Never invent the "small note"

If a small note (as defined in `outline.md##Subsections`) is given, use that. If
not, then do not create one.


## ⚠️ CRITICAL: Preserve Paragraph Structure

This is the most commonly missed rule. You MUST get this right.

**The problem:** Each time you fetch scripture, you must preserve the source's
paragraph groupings. Do NOT split every verse onto its own paragraph — the
verse number alone does NOT indicate a paragraph break.

**How to determine paragraph breaks:**
- Fetch the passage from Bible Gateway and examine the HTML. Each `<p>` tag /
  visual block is one paragraph — NOT each verse.
- Multiple verses can be in the same `<p>` (same paragraph).
- **A single verse can span multiple `<p>` tags.** For example, in Exodus 3:4,
  the NIV splits it as:
  - `<p>`... "Moses! Moses!"`</p>`
  - `<p>`And Moses said, "Here I am."`</p>`
  Each `<p>` is its own paragraph, even though both belong to verse 4.

**How to write it in LaTeX:**
```
\verseref{1}{verse one text}  \verseref{2}{verse two continues same paragraph}
\verseref{3}{verse three still same paragraph}

\verseref{4}{When the Lord saw that he had gone over to look, God called to
him from within the bush, "Moses! Moses!"

And Moses said, "Here I am."}

\verseref{5}{"Do not come any closer," God said. "Take off your sandals, for
the place where you are standing is holy ground."}
\verseref{6}{Then he said, "I am the God of your father..."}
```
- Within a paragraph group: **NO blank lines** between consecutive `\verseref{}`
  calls. They stay in the same paragraph.
- Between paragraph groups: Insert a **blank line** in the LaTeX source to
  create a `\par` break with `\parskip` spacing.
- **Within a single `\verseref{}`:** If a verse has multiple paragraphs in the
  source, use a **blank line** inside the braces to create a paragraph break.
  This matches what the NIV does within a verse (e.g., dialogue shifts).

**When in doubt, fetch the passage from Bible Gateway and examine the HTML.
Each `<p>` tag / visual block is one paragraph — not each verse. Pay extra
attention when a single verse number appears across multiple `<p>` tags.**

## ⚠️ CRITICAL: `\char` gobbles the terminating space

`\char"XXXX` is a TeX primitive. It reads a hex number and **gobbles** the space
that follows, jamming the next word against the quote character. For example,
`\char"201D At` renders as `"At` with no space.

**The fix:** insert `{}` immediately after the hex number to prevent the space
from being eaten:

```
\verseref{6}{Then he said, ...\char"201D{} At this, Moses hid his face...}
```

`{` terminates the number (it is not gobbled), `}` closes the empty group, and
the following space becomes normal interword glue.

| What | Pattern | Fix |
|---|---|---|
| Closing double quote → word | `\char"201D At` | `\char"201D{} At` |
| Closing single quote → word | `\char"2019 and` | `\char"2019{} and` |
| Adjacent quotes | `\char"2019 \char"201D` | `\char"2019{} \char"201D` |

Opening quotes (`\char"201C`, `\char"2018`) do NOT need `{}` — the gobbled space
is correct because a left quote attaches directly to the following word.

**Always double-check** every `\char` in the source, especially:
- After every `\char"201D` and `\char"2019` (closing quotes).
- Between adjacent `\char` calls (e.g., nested single inside double).
