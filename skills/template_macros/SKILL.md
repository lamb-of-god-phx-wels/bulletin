---
name: template-macros
description: Compact reference of every LaTeX macro defined in the bulletin template. Use when editing bulletin sections or creating new content — avoids re-reading macros.tex.
---

# Template Macros Quick Reference

Compact summary of every LaTeX macro defined in `templates/bulletin/styles/macros.tex`.
Use this instead of re-reading the `.tex` files.

## Document Structure

```
bulletin.tex           # Entry: \input{preamble} → \input{metadata} → \begin{document}
styles/preamble.tex    # Fonts, geometry, packages
styles/macros.tex      # All custom macros below
sections/00-metadata.tex  # \newcommand defs for metadata fields
sections/01-welcome.tex   # Cover, pastor info, council, guest
sections/02-gathering.tex # Opening hymn, liturgy, song of praise, prayer of the day
sections/03-word.tex      # Readings, psalms, sermon, creed
sections/04-prayers.tex   # Prayers, Lord's Prayer, blessing, closing hymn
sections/05-announcements.tex
sections/06-back-page.tex # Prayer requests, copyright
```

## Section Headings

| Macro | Args | Effect |
|---|---|---|
| `\divider{text}` | 1 | Large centered text with vspace |
| `\bulletinheading{text}` | 1 | Bold uppercase, needspace 4 lines |
| `\subheading{text}` | 1 | Bold, needspace 3 lines |
| `\rubric{text}` | 1 | Small centered italic (instructions) |

## Liturgy & Responsive

| Macro | Args | Description |
|---|---|---|
| `\minister{text}` | 1 | "M: " with 1.55em indent |
| `\ministercont{text}` | 1 | Continuation same indent |
| `\congregation{text}` | 1 | Bold "C: " with indent |
| `\congregationcont{text}` | 1 | Bold continuation |
| `\reader{text}` | 1 | "R: " |
| `\pastor{text}` | 1 | "P: " |
| `\responsiveminister{text}` | 1 | With extra vspace |
| `\responsivecongregation{text}` | 1 | Bold with extra vspace |
| `\liturgy` | (env) | Vspace before/after, parskip 0.8em |

## Scripture & Sermon

| Macro | Args | Description |
|---|---|---|
| `\reading{label}{ref}{summary}` | 3 | Bold uppercase label, italic summary |
| `\sermon{title}{ref}` | 2 | "SERMON:" label (use `\reading{Sermon}{ref}{}` instead) |
| `\scripture` | (env) | Quote environment, parskip 0.35em |
| `\verseref{num}{text}` | 2 | Superscript verse number then text |

## Hymns

| Macro | Args | Description |
|---|---|---|
| `\song{type}{title}` | 2 | Bold uppercase type, italic title |
| `\hymnverses` | (env) | Numbered verse items |
| `\verseitem{text}` | 1 | Numbered verse with 0.5in indent |

## Other

| Macro | Args | Description |
|---|---|---|
| `\coverpage` | 0 | Season/date header, series logo, theme, church logo |
| `\silentprayer` | 0 | Centered italic "Silent prayer." |
| `\givingqr` | 0 | QR code from `\GivingURL` |
| `\announcement{title}{body}` | 2 | Needspace 4 lines |
| `\announcementlist` | (env) | Itemize with tight spacing |
| `\guestblock{title}{text}` | 2 | Bold uppercase title, then text |

## Metadata (set in 00-metadata.tex)

```
\ChurchSeason        → "Second Sunday After Pentecost"
\BulletinDate        → "June 7, 2026"
\BulletinTheme       → "God Loves Sinners*"
\SermonSeries        → "Say It Out Loud"
\SeriesLogoPath      → path to series logo
\ChurchPhotoPath     → path to church image
\ChurchLogoPath      → path to church logo
\PastorCell          → (from private-data.tex)
\CouncilRows         → (from private-data.tex)
\GivingURL           → giving URL
```

## Key Conventions

- Booklet: 7"×8.5" pages on 14"×8.5" paper, folded, page count multiple of 4
- Compile with XeLaTeX (NOT pdflatex)
- `private-data.tex` is `\InputIfFileExists`-guarded — safe to delete
