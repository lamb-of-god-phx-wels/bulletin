# Format

## Page Set-up

- The booklet pages are 7" wide by 8.5" tall.
- Margins
    - 0.4" on top and sides
    - 0.5" on the bottom
- The booklets are printed on 14" x 8.5" paper
    - The booklet sheets are folded in half to produce the booklet
    - Booklets must align to integer multiple of 4 pages for this reason
        - The last (back) page is allowed to be blank
            - In this case, there are options to put pictures/logos.
        - Otherwise, content should be padded in appropriate places to meet this
          requirement
- There is always a cover page as the front page
- Page numbers are centered at the bottom of every page except the cover page
    - Calibri
    - 12 pt
    - Centered vertically between bottom of page and bottom margin

## Assets

Assets are stored in the assets/ folder at the root of this repository. In the
future, these may move to a shared location outside of the repository.

### Folder Structure:

```
assets/
    church/ <-- Assets associated with the church
    fonts/
    sermon_series/ <-- Assets associated with invidual series
        <series_title>/
            logo.png <-- Use for sermon series logo
        
    



```
When new assets are added, keep them organized according to the structure given
above.

## Sections

- [Cover](/agents/sections/cover.md)
- [Welcome](/agents/sections/welcome.md)
- Service
    - [The Gathering](/agents/sections/the_gathering.md)
    - The Word
    - The Prayers
- Announcements
- If there are less than 2 lines of body in a section, insert a page braak
  before the section, unless the body itself is less than two lines (or no
  body).

## Subsections

Everything inside of a major section is considered a subsection. Subsections
follow the following format:

```
**<SUBSECTION TITLE>**[: *<Subtitle>*]
[*<Small note>*]

[<Content>]
```
- Calibri
- 11 pt
- Left-justified
- Title
    - `SUBSECTION TITLE`
        - Bold
        - All caps
    - `Subtitle` (optional)
        - Italics
        - Title case
        - Separate line from title
        - No space after title
    - `Content` (optional)
        - Regular case
        - Regular font style (unless otherwise noted)

## Special Subsections

The difference for a special subsection is that the title:
- Eras Demi ITC
- 11 pt
- No sub-title
- No small note
- Bookended by Maltese cross icons (✠) using the \litcross macro.

Special subsections do not require a page break.

## Scripture

- Scripture references are treated as quotes with increased indentation.
- Each verse is preceded by a superscript verse number.

## Responsive Readings

Responsive readings follow the format:

```
M: <text that the minister reads>
**C: <text that the congregation reads>
```

When a bible verse is referenced, that reference is right-justified and placed
on the same line as the last line of text if that text is <= half the page
width, otherwise it is placed on the next line. Bible references are italicized.

## Songs

See [Songs](/agents/sections/songs.md)





