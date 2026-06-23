#import "../../../styles/bulletin.typ": *

#let council-grid(member) = grid(
  columns: (1fr, 1fr, 1fr),
  column-gutter: 0.16in,
  [#member.name],
  [#member.email],
  [#member.phone],
)

#let welcome-page(meta, private) = {
  set par(spacing: 0pt)

  grid(
    columns: (1in, 1fr),
    column-gutter: 0pt,
    meta.churchphoto,
    [
      #box(width: 100%, height: 0.5in, inset: (left: 0.08in))[#text(font: heading-font, size: 18pt)[#meta.churchname]]
      #box(width: 100%, height: 0.5in, fill: rgb("#a4a4a4"), inset: (left: 0.08in))[#text(font: heading-font, size: 12pt, fill: white)[#meta.churchslogan]]
    ],
  )

  v(0.15in)

  grid(
    columns: (1fr, 1fr),
    column-gutter: 0.2in,
    align(center)[
      #meta.pastorname#linebreak()
      Church Phone: #meta.churchphone#linebreak()
      Cell Phone: #private.pastorcell
    ],
    align(center)[
      #meta.pastoremail#linebreak()
      #meta.churchwebsite#linebreak()
      #meta.churchaddress
    ],
  )

  v(0.15in)
  line(length: 100%, stroke: 0.75pt)
  v(0.08in)

  grid(
    columns: (1fr, 1fr, 1fr),
    column-gutter: 0.16in,
    [#underline[COUNCIL MEMBER]],
    [#underline[EMAIL]],
    [#underline[PHONE]],
  )
  for member in private.council {
    council-grid(member)
  }

  v(0.1in)
  line(length: 100%, stroke: 0.75pt)
  v(0.08in)

  guest-block("Welcome")[Thank you for joining us for worship this morning. In our service we gather before our almighty God to offer him our worship and praise. We also gather to strengthen ourselves through the study of God's holy and powerful Word.]

  v(1em)

  guest-block("Pastor's Office Hours")[If you would like to meet with Pastor Koepke, please contact him to make an appointment. Our pastor is here to serve both Lamb of God members and our community.]

  v(1em)

  guest-block("Children's Room")[We love having children in our service. However, if you feel your child needs to be taken out for a while, you may choose to use the children's room off the hallway near the mailboxes. We also ask everyone to reserve the back few rows for families with young children, making it easier to leave the church area if needed.]

  v(0.1in)
  line(length: 100%, stroke: 0.5pt)

  align(center)[#text(size: 9pt)[
    WEBSITE: #meta.churchwebsite#linebreak()
    CALENDAR: #meta.churchcalendar#linebreak()
    FACEBOOK: #meta.churchfacebook#linebreak()
    INSTAGRAM: #meta.churchinstagram
  ]]

  pagebreak()
}
