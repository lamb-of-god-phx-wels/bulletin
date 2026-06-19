# Responsive Readings

Responsive readings follow the format:

```
M: <text that the minister reads>
**C: <text that the congregation reads>**
```
- There should be 0.8 em of space between `M` and `C` paragraphs (set by
  `\parskip` in the `liturgy` environment).
- `M` sections are regular font
- `C` sections are bold font
- No italics anywhere
- Only label a paragraph with `M:` or `C:` when the speaker changes from
  the previous paragraph. Consecutive lines by the same speaker must be
  combined into a single paragraph (same `\minister{}` or `\congregation{}`
  call) with `\\*` between the lines, or use `\ministercont{}` /
  `\congregationcont{}` for a separate continuation paragraph. Do NOT put
  extra vertical space between same-speaker lines.
- Body text must be indented the same on all lines: the first line (after the
  `M:` / `C:` label) and all wrapped/continuation lines should align. This
  is handled by `\leftskip=1.55em` + `\llap{label}` in the macros.

When a bible verse is referenced, use `\instruction{ref}` — it is
right-justified, italicized, and placed on the next line with no extra vertical
space above or below. Do NOT put a blank line after `\instruction{}`.