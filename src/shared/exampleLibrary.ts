import type { LibraryManifestV1 } from './types.js';

export const exampleLibrary: LibraryManifestV1 = {
  schemaVersion: 1,
  name: 'Lamb of God Example Library',
  items: [
    { id: 'cw399', version: 1, kind: 'song', title: 'To God Be the Glory (CW 399)', license: { notice: 'To God Be the Glory, Text, Tune, Setting: public domain.' } },
    { id: 'give-thanks', version: 1, kind: 'song', title: 'Give Thanks', license: { notice: 'Give Thanks, by Henry Smith © 1970 by Integrity’s Hosanna! Music. All rights reserved. Used by permission.' } },
    { id: '130', version: 1, kind: 'song', title: 'I Will Wait for You (Psalm 130)', license: { notice: 'I Will Wait for You (Psalm 130), Words and Music by Keith Getty, Jordan Kauflin, Matt Merker and Stuart Townend © 2018.' } },
    { id: 'cw385', version: 1, kind: 'song', title: 'Chief of Sinners Though I Be (CW 385)', license: { notice: 'Chief of Sinners Though I Be, Text and Tune: public domain. Setting © 1993 Kermit G. Moldenhauer. Used by permission.' } },
    { id: 'apostles-creed', version: 1, kind: 'liturgy', title: 'Apostles’ Creed' },
    { id: 'lord-s-prayer', version: 1, kind: 'liturgy', title: 'Lord’s Prayer' },
    {
      id: 'his-mercy-is-more', version: 1, kind: 'song', title: 'His Mercy Is More',
      assets: [{ path: 'assets/example_2026-06-07/his-mercy-is-more.png', mediaType: 'image/png', variant: 'score' }],
      license: { notice: 'His Mercy Is More, by Matt Boswell and Matt Papa; © 2016 Getty Music Hymns and Songs, Getty Music Publishing, Love Your Enemies Publishing, Messenger Hymns.' }
    }
  ]
};
