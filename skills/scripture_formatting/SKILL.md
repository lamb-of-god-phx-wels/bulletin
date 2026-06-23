# Scripture Formatting Skill

Fetch NIV 2011 passages from Bible Gateway, determine paragraph breaks from
HTML `<p>` tags, and produce LaTeX `\verseref{}` calls with proper Unicode
quote characters (`\char"201C` / `\char"201D`).

## When to use

- Any time a scripture passage needs to be included in the bulletin.
- The user requests a specific reading, psalm, or sermon text.

## Workflow

### 1. Fetch the Passage HTML

```
curl -s "https://www.biblegateway.com/passage/?search=<PASSAGE>&version=NIV" \
  | sed -n '/<div class="passage-text">/,/<div class="passage-attributes">/p'
```

Or use the helper script:

```
bash skills/fetch-scripture.sh "Genesis 1:1-5"
```

### 2. Identify Paragraph Breaks

Each `<p>` tag in the `.passage-text` div is one paragraph — NOT each verse.
Multiple verses can share a `<p>`, and a single verse can span multiple `<p>`s
(e.g., dialogue shifts within a verse like Exodus 3:4).

**Rules:**
- Within a `<p>`: all `\verseref{}` calls go on consecutive lines (no blank line).
- Between `<p>`s: insert a blank line in the LaTeX source (`\par` break).
- If a single verse has multiple `<p>`s in the source, keep all the text inside
  one `\verseref{}` and use a blank line inside the braces.

### 3. Format Verses

```
\verseref{1}{text for verse one}
\verseref{2}{text for verse two continues same paragraph}

\verseref{3}{text for verse three starts new paragraph}
```

### 4. Quote Characters

Use `\char"201C` (left double), `\char"201D` (right double),
`\char"2018` (left single), `\char"2019` (right single).

**⚠️ Always add `{}` after closing quotes** to prevent TeX from gobbling the
space. Opening quotes do NOT need `{}`.

| Pattern | Fix |
|---|---|
| `\char"201D At` | `\char"201D{} At` |
| `\char"2019 and` | `\char"2019{} and` |
| `\char"2019 \char"201D` | `\char"2019{} \char"201D` |

### 5. Verify

After inserting into the `.tex` file, compile and visually check:
- Paragraph breaks match the source (every `<p>` is a new paragraph)
- No missing spaces after closing quotes
- Dashes use Unicode em `—` / en `–` (not `---`/`--`)

## Helper Script

`skills/fetch-scripture.sh` fetches the passage and outputs the plain text
with blank lines at paragraph boundaries — safe for bash invocation (no
scripture text sent to LLM).
