# Lamb of God Church Bulletin LaTeX Starter Kit

This project is a complete weekly bulletin starter kit modeled after the January 4, 2026 sample bulletin.

## Compile

Use XeLaTeX or LuaLaTeX.

```bash
xelatex bulletin.tex
```

Do **not** use `pdflatex`.

## Project layout

```text
bulletin.tex
styles/
  preamble.tex
  macros.tex
sections/
  00-metadata.tex
  01-welcome.tex
  02-gathering.tex
  03-word.tex
  04-prayers.tex
  05-announcements.tex
  06-back-page.tex
assets/
```

## Weekly workflow

1. Edit `sections/00-metadata.tex`.
2. Update the service content in `sections/02-gathering.tex`, `sections/03-word.tex`, and `sections/04-prayers.tex`.
3. Update announcements in `sections/05-announcements.tex`.
4. Compile with `xelatex bulletin.tex`.

## Booklet printing

Recommended: compile normally, then use your PDF reader's **Booklet** printing mode.

Linux alternative:

```bash
pdfbook2 bulletin.pdf
```

## Useful macros

```latex
\divider{The Gathering}

\bulletinheading{Invocation}

\begin{liturgy}
\minister{The Lord be with you.}
\congregation{And also with you.}
\end{liturgy}

\hymn{Opening Hymn}{Hymn Title (CW 123)}
\begin{hymnverses}
\verseitem{Verse text...}
\end{hymnverses}

\reading{First Reading}{Isaiah 60:1--6}{Introductory sentence.}
\begin{scripture}
Scripture text...
\end{scripture}

\announcement{Title}{Body text.}

\givingqr
```

## QR code

Set the giving URL in `sections/00-metadata.tex`:

```latex
\newcommand{\GivingURL}{https://example.com/give}
```

## Fonts

The template uses `Book Antiqua`, which is included with Windows.
