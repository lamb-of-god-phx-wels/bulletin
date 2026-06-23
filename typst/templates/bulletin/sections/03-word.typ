#import "../../../styles/bulletin.typ": *

#let word() = [
  #divider("The Word")

  #reading("First Reading", "Book Chapter:Verse", "Summary of the reading.")

  #scripture[
    Scripture text goes here.
  ]

  #reading("Gospel Reading", "Book Chapter:Verse", "Summary of the reading.")

  #scripture[
    Scripture text goes here.
  ]

  #reading("Sermon", "Book Chapter:Verse", "")

  #scripture[
    Scripture text goes here.
  ]

  #reading("Confession of Faith", "Apostles' Creed", "")

  #corporate-text[
    I believe in God, the Father almighty, maker of heaven and earth.

    I believe in Jesus Christ, his only Son, our Lord, who was conceived by the Holy Spirit, born of the virgin Mary, suffered under Pontius Pilate, was crucified, died, and was buried. He descended into hell. The third day he rose again from the dead. He ascended into heaven and is seated at the right hand of God the Father almighty. From there he will come to judge the living and the dead.

    I believe in the Holy Spirit, the holy Christian Church, the communion of saints, the forgiveness of sins, the resurrection of the body, and the life everlasting. Amen.
  ]
]
