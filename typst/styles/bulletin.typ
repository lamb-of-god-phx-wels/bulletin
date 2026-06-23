// Shared Typst style and formatting helpers for the weekly bulletin.

#let body-font = "Calibri"
#let heading-font = "Eras Demi ITC"
#let symbol-font = "Wingdings"

#let bulletin-style(doc) = {
  set page(
    width: 7in,
    height: 8.5in,
    margin: (top: 0.4in, bottom: 0.5in, left: 0.4in, right: 0.4in),
    numbering: "1",
    number-align: center,
  )
  set text(font: body-font, size: 11pt)
  set par(first-line-indent: 0pt, spacing: 0.35em)
  doc
}

#let litcross() = text(font: symbol-font, size: 15pt)[+]
#let textcross() = text(font: symbol-font)[+]

#let upper-text(value) = upper(str(value))

#let cover-page(meta) = {
  set page(numbering: none)
  line(length: 100%, stroke: 1.25pt)
  v(0.05in)
  grid(
    columns: (1fr, auto),
    text(font: heading-font, size: 16pt)[#meta.churchseason],
    align(right)[#text(font: heading-font, size: 16pt)[#meta.date]],
  )
  v(0.05in)
  line(length: 100%, stroke: 1.25pt)

  v(1fr)
  align(center)[#meta.serieslogo]
  v(0.7in)
  align(center)[#text(font: heading-font, size: 16pt, weight: "bold")[#upper-text(meta.theme)]]
  v(1fr)

  grid(
    columns: (1fr, 2.25in),
    column-gutter: 0.2in,
    align(bottom)[
      #line(length: 100%, stroke: 0.4pt)
      #v(2pt)
      #line(length: 100%, stroke: 0.4pt)
    ],
    align(right)[#meta.churchlogo],
  )
  pagebreak()
  set page(numbering: "1")
}

#let theme-bar(theme) = {
  line(length: 100%, stroke: 0.75pt)
  v(-0.25em)
  align(center)[#text(font: heading-font, size: 14pt)[#theme]]
  v(-0.45em)
  line(length: 100%, stroke: 0.75pt)
  v(0.6em)
}

#let divider(title) = {
  v(1em)
  align(center)[#text(font: heading-font, size: 14pt)[#litcross() #h(0.5em) #title #h(0.5em) #litcross()]]
  v(0.45em)
}

#let bulletin-heading(title, subtitle: none) = block(above: 0.8em, below: 0.15em, breakable: false)[
  #strong[#upper-text(title)]
  #if subtitle != none [
    #linebreak()
    #emph[#subtitle]
  ]
]

#let subheading(title) = block(above: 0.65em, below: 0.2em, breakable: false)[#strong[#title]]

#let rubric(body) = block(above: 0.35em, below: 0.35em)[
  #align(center)[#text(size: 9pt, style: "italic")[#body]]
]

#let guest-block(title, body) = [
  #strong[#upper-text(title)]
  #linebreak()
  #body
]

#let speaker-line(label, body, bold: false) = grid(
  columns: (1.55em, 1fr),
  column-gutter: 0pt,
  [#if bold { strong(label + ":") } else { label + ":" }],
  [#if bold { strong(body) } else { body }],
)

#let minister(body) = speaker-line("M", body)
#let minister-cont(body) = pad(left: 1.55em)[#body]
#let congregation(body) = speaker-line("C", body, bold: true)
#let congregation-cont(body) = pad(left: 1.55em)[#strong[#body]]
#let reader(body) = speaker-line("R", body)
#let pastor(body) = speaker-line("P", body)

#let responsive-minister(body) = block(below: 0.8em)[#minister(body)]
#let responsive-congregation(body) = block(below: 0.8em)[#congregation(body)]

#let liturgy(body) = block(above: 0.35em, below: 0.45em)[
  #set par(spacing: 0.8em)
  #body
]

#let song(kind, title) = block(above: 0.8em, below: 0.35em, breakable: false)[
  #strong[#upper-text(kind):] #emph[#title]
]

#let hymn-verses(verses) = {
  v(0.35em)
  for (index, verse) in verses.enumerate() {
    grid(
      columns: (0.5in, 0.25in, 1fr),
      column-gutter: 0pt,
      [],
      [#str(index + 1).],
      [#verse],
    )
    v(1.5em)
  }
  v(0.35em)
}

#let refrain(body) = block(above: 0.25em, below: 0.25em)[#pad(left: 1.55em)[Refrain: #body]]

#let reading(label, reference, summary) = block(above: 0.8em, below: 0.35em, breakable: false)[
  #strong[#upper-text(label):] #reference
  #if summary != "" [
    #linebreak()
    #emph[#summary]
  ]
]

#let scripture(body) = pad(left: 1.5em, right: 1.5em)[
  #set par(spacing: 0.35em)
  #body
]

#let verseref(number, body) = [#super[#number] #body]

#let silent-prayer() = rubric[Silent prayer.]

#let corporate-text(body) = [
  #set par(spacing: 1.5em)
  #strong[#body]
]

#let announcement(title, body) = block(above: 0.8em, breakable: false)[
  #strong[#upper-text(title)]
  #v(0.2em)
  #body
]

#let announcement-list(items) = list(
  tight: true,
  indent: 1.3em,
  ..items,
)

#let giving-qr(url) = align(center)[
  #box(width: 1.25in, height: 1.25in, stroke: 0.75pt, inset: 0.08in)[
    #align(center)[#text(size: 8pt)[Giving QR#linebreak()#url]]
  ]
]
