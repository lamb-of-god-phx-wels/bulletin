#import "../../../styles/bulletin.typ": *

#let prayers() = [
  #divider("The Prayers")

  #bulletin-heading("Prayer of the Church")

  #v(5em)

  #bulletin-heading("The Lord's Prayer")

  #pad(left: 1.55em)[#strong[Our Father in heaven, hallowed be your name, your kingdom come, your will be done on earth as in heaven. Give us today our daily bread. Forgive us our sins, as we forgive those who sin against us. Lead us not into temptation, but deliver us from evil. For the kingdom, the power, and the glory are yours now and forever. Amen.]]

  #bulletin-heading("Blessing")

  #liturgy[
    #minister[Brothers and sisters, go in peace.#linebreak()Live in harmony with one another.#linebreak()Serve the Lord with gladness.]

    #minister[The Lord bless you and keep you.#linebreak()The Lord make his face shine on you and be gracious to you.#linebreak()The Lord look on you with favor and give #textcross() you peace.]

    #congregation[Amen.]
  ]

  #song("Closing Hymn", "Hymn Name (CW 000)")

  #hymn-verses((
    [Verse one of the hymn.],
    [Verse two of the hymn.],
    [Verse three of the hymn.],
  ))
]
