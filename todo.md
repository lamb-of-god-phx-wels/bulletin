# TODO

* Undo/redo stack needs some work
* Consolidate "Text" and "Reusable Library Text" into single "Text" element.
* Communion sunday toggle
  * Generalize for custom bindable values
* Make the "compact" content spacing option work
* Fix per sub-block formatting


## Template/bulletin builder

* Support revision history

* "Templates" -> "Bulletin Templates"
* table/grid support
* In "format" window, the preview should show the actual element preview rather than a generic example
* Support for split scripture references

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
* Extra "OneLicense.net copyright notice automatically at end
* Allow scripture blocks to span pages (unless keep together option is checked)
  * Don't add a "Continued" header on page break
* Text and inline scripture elements should be separate in the editable fields (think responsiveReading)
* Asset types need schemas (not all are a text field, copyright info, and picture/pdf)
* Fix inline scripture block formatting (responsive reading)
* New option (default enabled) to make "New Week" template creation date snap to the next Sunday.
