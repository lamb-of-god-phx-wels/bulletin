#import "../../../styles/bulletin.typ": *

#let announcements(meta) = [
  #align(center)[#text(size: 14pt, weight: "bold")[ANNOUNCEMENTS]]

  #announcement("Bible Classes")[
    #announcement-list((
      [Children's Sunday School - Children meet at the front of church at 10:45am on Sundays after our service and fellowship.],
      [Sunday Bible Class - After the children's lesson, there is a 19-minute study.],
    ))
  ]

  #announcement("Giving to Lamb of God")[If you wish to give your offering to Lamb of God online, this QR code is provided for your convenience. Several types of payment are accepted on this secure site.]

  #giving-qr(meta.givingurl)

  #announcement("Sunday Fellowship Hosting")[Thank you to all who have helped with our fellowship hosting this year. Please consider taking your turn in the next few months. The sign-up sheet is in the fellowship hall.]

  #pagebreak()
]
