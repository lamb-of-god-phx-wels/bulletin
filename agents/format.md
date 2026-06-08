#

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

- Cover
- Information/Welcome
- Service
    - The Gathering
    - The Word
    - The Prayers
- Announcements


### Cover

- Exactly one complete page (first page)
- Contains the following information:
    - Church-designated Sunday (e.g., "Second Sunday After Pentecost")
        - This is pulled from https://builder.christianworship.com, though
          naming is modified like the example ("Pentecost 2" -> "Second Sunday
          After Pentecost", or "First Sunday after Pentecost - Holy Trinity" ->
          "Trinity Sunday")
        - Top of the page
        - Left-justified
        - Full width border line above and below
            - 0.5" space between border lines
            - Text centered between these
    - Date (e.g., "June 7, 2026")
        - Same line as the Sunday name
        - Right-justified
    - Sermon series logo
        - Centered horizontally
    - Sermon title
        - All caps
        - Centered horizontally
        - Together with the sermon series/image, vertically 
        - About 0.5"-1" below series logo
    - Church logo
        - This is "img/ChurchLogo.png"
        - Aligned to bottom of the page (adhering to margins)
        - Right-justified
        - 2.25" wide
        - Accompanied by a double-line border
            - 3.875" wide
            - Aligned to bottom margin
            - Left-justified        
- Fonts
    - Church-designated Sunday, Date, and Sermon Title
        - Eras Demi ITC
        - 16 (14 if it doesn't fit)


### Information/Welcome

- Exactly one complete page
- At the top there is a section containing:
    - Church photo, left aligned
    - Two rows of text, left aligned to the right of the photo, flush against the photo (no gap)
    - Each row can only take one line.
    - Source: information.md
    - Photo width: 1.75in (height proportional)
    - First row (church name):
        - Full church name
        - Eras Demi ITC
        - 17 pt (or to fit, 20pt line spacing)
        - White background
        - Black foreground
        - Left-padded 0.08in inside box
    - Second row (slogan):
        - Church Slogan
        - Eras Demi ITC
        - 12 pt (or to fit, 16pt line spacing, always smaller than name)
        - Grey background (#A4A4A4)
        - White foreground
        - Left-padded 0.08in inside box
    - Both rows stacked flush (no gap), each filling exactly 50% of photo height
    - Example:
        ```
        ________________________________________________________________________________
        |            |                                                                 |
        | Photo      | Lamb of God Lutheran Church                                     |
        |            |_________________________________________________________________|
        |            |                                                                 |
        |            | Reaching Up. Reaching Out. Reaching Across.                     |
        |____________|_________________________________________________________________|
        ```
- Pastor/church information (no header)
    - Source: information.md
    - Two columns
    - Text within each column is centered
    - Calibri
    - 12 pt
    - First column:
        - `<pastor's name>`
        - Church Phone: `<church phone>`
        - Cell Phone: `<pastor's cell phone>`
    - Second column:
        - `<pastor's email>`
        - `<website>`
        - `<address>`
- Horizontal rule
    - 0.75 pt
    - 0.15" space above, 0.08" space below
- Council information (no header)
    - Source: information.md
    - Table as follows:
    - | COUNCIL MEMBER | EMAIL | PHONE |
      |:---------------|:------|:------|
      | Name           | email | phone |
      | Name           | email | phone |
      | ...            | ...   | ...   |
    - Calibri
    - 12 pt
    - Column headers underlined, all caps
    - Generous row spacing (1.6x line height)
    - Column headers underlined only (no bold)
- Horizontal rule
    - 0.75 pt
    - 0.1" space above, 0.08" space below
- Guest information
    - Source: information.md
    - Calibri
    - 12 pt
    - Left-justified
    - Titles
        - All caps
        - Bold
    - No additional space between title and content
    - 1em blank line between groups
- Horizontal rule
    - 0.5 pt
    - 0.1" space above, 0.08" space below
- Links
    - Source: information.md
    - Centered
    - Calibri
    - 10 pt
    - Content:
        - WEBSITE: `<website>`
        - CALENDAR: `<calendar>`
        - FACEBOOK: `<facebook>`
        - INSTAGRAM: `<instagram>`
