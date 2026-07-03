# Church Bulletin Builder

## Overview

The Church Bulletin Builder is a fully featured application that streamlines the
process of creating weekly bulletins. 

## Features

* Generic template builder
* Build bulletins from templates or ad-hoc
* Drag-and-drop interface
* Fine tuning of element size and flow order
* Full control of styles
* Live previews
    * What you see is what you get (WYSIWYG)
* Hymn/Psalm/song import tool with lead sheet support (TBD)
* AI-driven import tool to auto-fill templates from terse instructions


## Template Builder

The template builder allows you to build full templates as well as custom
elements to use within templates or bulletins. The template allows you to create
a reusable skeleton (schema) with named sections and content blocks. These can
be used to create future bulletins by either manually filling in the content for
the pre-defined layout or importing content via the AI import tool.

### Features

* Create a bulletin template
    * Drag-and-drop flow ordering
    * Select an element to edit its properties (height, width, spacing, style, etc.)
    * Nest elements via containers

* Create an element template
    * Similar to bulletin template, but for a single element
    * Define:
        * Element name (must be unique)
        * Define style
        * Define schema
    * Beecoms available as an element block in template and bulletin builder


### Defining a Schema

Schemas allow you to imbue an element with data. Within a schema, each piece of
data has a name and a type. In the Bulletin Builder, when an element with the
schema is added, those named data become editable fields.

Data types:

* Text
* Image
* Music
* TBD...


### User Interface

Mock-up:

```
--------------------------------------------------------------------
| Toolbar                                                          |
-------------------------------------------------------------------|
|                                                                  | 
| -------------------  -------------------  ---------------------- |
| | Elements        |  | Element Data    |  | Drag-and-drop area | |
| |-----------------|  |-----------------|  | with rendering     | |
| | Text            |  |  Width  _______ |  |                    | |
| | Grid Container  |  | Height  _______ |  |                    | |
| | Stack Container |  |      X  _______ |  |                    | |
| | Image           |  |      Y  _______ |  |                    | |
| | Music           |  |                 |  |                    | |
| |                 |  |                 |  |                    | |
| -------------------  -------------------  ---------------------- |
--------------------------------------------------------------------
```




## Bulletin Builder

The Bulletin Builder is almost identical to the template builder with the main
difference being that data schemas are replaced with actual data inputs.


## Application Design

A bulletin is a folder on disk that represents a *typst* project
(`.typ`/`.json`). Templates are represented similarly. This enables data-driven
design and interaction with the frontend. The frontend is a web app that
provides a polished user interface for building and interacting with the
templates/bulletins and exporting as PDFs. 
