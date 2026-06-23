# General Formatting

- For double quotes, use Unicode left/right double quotation marks (```\char"201C``` /
```\char"201D```) instead of ASCII straight quotes (```"```), double back-ticks
(``` `` ```), or double single quotes (``` '' ```). If the source text uses those
conventions, convert them.
- For single quotes nested inside double quotes, use Unicode left/right single
quotation marks (```\char"2018``` / ```\char"2019```) instead of backtick/straight
apostrophe (``` ` ``` / ```'```).
- For long dashes, use Unicode em dash (```—```, U+2014) or en dash (```–```,
  U+2013) instead of LaTeX ```---``` or ```--```. If the source uses em/en dashes,
  preserve them as the Unicode character.
- ⚠️ Search your output for stray `---` or `--` BEFORE compiling — LaTeX will
  process them as ligatures, but they must be Unicode characters. Check every
  verse range (e.g., `Exodus 3:1—15` uses en dash `–`, not `--`).

## ⚠️ CRITICAL: `\char` gobbles the terminating space

`\char"XXXX` is a TeX primitive that reads a hex number. It **gobbles** the
space that follows the digits, so the next word jams against the quote
character. For example, `\char"201D At` renders as `"At` with no space.

**The fix:** always insert `{}` immediately after the hex number to prevent the
space from being eaten:

```
\verseref{6}{Then he said, ...\char"201D{} At this, Moses hid his face...}
```

`{` terminates the number without being gobbled, `}` closes the empty group,
and the space that follows becomes normal interword glue.

### Rules

| What | Pattern | Fix |
|---|---|---|
| Closing quote followed by a word | `\char"201D God` | `\char"201D{} God` |
| Closing single quote followed by word | `\char"2019 and` | `\char"2019{} and` |
| Adjacent quotes (nested) | `\char"2019 \char"201D` | `\char"2019{} \char"201D` |

Opening quotes (`\char"201C`, `\char"2018`) do NOT need this fix — the space
after the hex number is gobbled, but that is correct: an opening quote should
attach directly to the following word without word space.