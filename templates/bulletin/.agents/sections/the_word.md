# The Word

## Subsections

The following subsections are commonly included in the "The Word" section:

* First Reading - scripture reading
* Psalm
* Children's Message
* Gospel Reading - scripture reading
* Hymn of the Day
* Sermon - scripture reading
* Confession of Faith


## Scripture Readings

Read `.agents/scripture_readings.md`


## Psalm/Hymn of the Day

Read `.agents/songs.md`


## Children's Message

This is a simple subsection with only the title "Children's Message" and no
subtitle or body.


## Sermon

The sermon section is formatted the same as a scripture reading.

* Do not use the sermon title as the subsection title/subtitle.
* Add the scripture reading for the referenced scripture.
* CRITICAL: Do not invent a title/small note. Use what is given only.
* Use `\reading{Sermon}{Scripture ref}{}` or `\sermon{}{Scripture ref}`
  — leave the title/subtitle empty if no sermon title is provided.
  Do NOT pass the sermon series name or theme as the sermon title.

## Confession of Faith

This is a regular subsection with the following format:

```
**CONFESSION OF FAITH:** *<Confession Name>*

**<Confession body>**
```

* The body is bold.
* The body must be indented `1.55em` from the left margin (same as
  responsive reading congregation lines). Use `{\leftskip=1.55em ...}`.
* This subsection must not be broken across pages.
  Use `\needspace{15\baselineskip}` (not `5\baselineskip`) to keep the
  heading, subtitle, and all creed paragraphs together.
* The `<Confession body>` comes from the `assets/confessions/<confession>.md`.
    * Use the title of the `.md` as the `<Confession Name>`.
* Preserve paragraphs.
    * Use 1.5 em spacing between paragraphs.
