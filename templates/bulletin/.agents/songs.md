# Songs/Hymns/Psalms

## Conventions

Songs follow the format when only lyrics are given:

```
**<SONG DESIGNATION>:** *<Song Title> (CW/CWS 999)*

    1.  <Lyrics...>
        <Lyrics...>
        <Lyrics...>
    
    2.  <Lyrics...>
        <Lyrics...>
        <Lyrics...>
    
    3.  <...>
```
- Use the `\song{Designation}{Title}` macro for the title line. This applies
  to ALL song-like items: Opening Hymn, Song of Praise, Psalm, Closing Hymn,
  etc. Do NOT use `\bulletinheading{}` for them.
- When a "CW" or "CWS" number is given, it goes in parentheses after the title.
- The verse number is exactly 0.5" from the left margin
- The lyric text is exactly 0.75" from the left margin
- Don't be cute.
    - Use the text as-is
    - Do NOT add "Refrain" or "[Refrain]" or "\emph{Refrain}" or any label
      not present in the source text. If the source prints the refrain
      lyrics inline within each verse, you must print them inline too.
      Never alias/shortcut a refrain with just the word "Refrain".
    - If the source has no label before the refrain, do not add one in the
      bulletin.
- Hymns often have short lines. When a hymn would push past the bottom
  margin or encroach on the page number, merge adjacent short lines onto
  a single line (no extra space between them) to save vertical space.
  Use good judgment: lines under ~30 characters are candidates for merging.
  Never merge if it makes the line awkwardly long or hard to read.

If instead of lyrics, full sheet music is given (as image(s)), the image takes
the place of the lyrics and is centered horizontally.

## Asset Retrieval

If a hymn/psalm/song is requested, first search `/assets`. If not found, then
search the hymn/psalm/song asset directory given by the user. If the user did
not give that directory, ask for it.
