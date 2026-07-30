# TODO

* Undo/redo stack needs some work

* Move page set-up to preview area or somewhere out of the way but intuitive
* Communion sunday toggle
  * Generalize for custom bindable values
* Make the "compact" content spacing option work
* Fix per sub-block formatting
* Ability to overwrite "built-in" block formatting
  * e.g., song lyrics indented separate from heading
  * This should also be the base formatting granularity

## Template pages

* Change coordinate space thing to something Megan can understand
* Be able to add a new sermon series graphic and save it to the template
* Get some more text editing tools
  * Not all available formatting is available
* Text button and snaps to center vertical/horizontal, other elements, etc.
  * Togglable
  * Office-style
* Align/group capability
* Send to front/back/forward/back
* Reset to template defaults (undo all changes)
* Support copy/paste



## Template/bulletin builder

* Library items/selectors should be text search/filterable
* Make autosave optional
* Support revision history

* "Templates" -> "Bulletin Templates"
* Basic typography/formatting in main editing space rather than under "format" button
* table/grid support
* In "format" window, the preview should show the actual element preview rather than a generic example
* Support for split scripture references

* Songs
  * "Song or hymn" -> "song"
  * The Display Title should default to the library song title
  * Header section should be editable
  * Element header text should be the song header text
  * Remove version selector
  * Presentation should only show what's available
    * Should not be able to override image

* Responsive reading
  * Compact the UI
    * Also copyable
  * Add support for parsing a block of text
  * Rich text support
  * Optionaly heading

* Announcements
  * Graphics
  * QR code

* Revisioning - add date to version display

* Italics for song/asset names in copyright block


## Library

* "Close form" -> "Cancel"
* LIbrary needs search/filter
* Need to support different "kind" -> "type"
* Need to think of a way to re-use common liturgy which can comprise of several types of content (e.g., headings, responsive readings, rayers, etc).
  * Could save bulletin "subsections" and allow adding a bulletin "subsection" as an element
  * Could go even further and save these subsections as a library item, allowing binding
    * This would enable the ability to create a master template with subsection "selector"
    * Template then inserts "placeholder" which has selector for a bulltein "subsection"
* Image blocks should allow selection of library images in addition to one-time uploads.
  * When an image is uploaded, it should ask if you want to add the image to the library and give a form if yes.


* Extra "OneLicense.net copyright notice automatically at end
* Allow scripture blocks to span pages (unless keep together option is checked)
  * Don't add a "Continued" header on page break
* Text and inline scripture elements should be separate in the editable fields (think responsiveReading)
* Asset types need schemas (not all are a text field, copyright info, and picture/pdf)
* Fix inline scripture block formatting (responsive reading)
* New option (default enabled) to make "New Week" template creation date snap to the next Sunday.
