# Data-Driven PDF Component Architecture

## 1. Purpose

This document defines the initial architecture for a JSON-driven PDF builder that supports reusable, nested components with strongly defined input contracts and declarative data binding.

The system is intended to support:

- Reusable document components.
- JSON-based document and component descriptors.
- Nested component composition.
- Explicit downward data flow through component inputs.
- Controlled upward propagation through component outputs or exports.
- Runtime and compile-time validation.
- Deterministic PDF generation.
- Future visual editing and live preview.
- Extension with additional components and data types.

The initial built-in component set is:

- `text`
- `paragraph`
- `heading`
- `announcements`
- `announcement`
- `responsiveReadingItem`
- `responsiveReading`
- `inlineScriptureReading`
- `scriptureReading`
- `songVerse`
- `song`
- `spacer`

---

## 2. Architectural Principles

### 2.1 Declarative descriptors

Documents and components are described as JSON data. Descriptors declare what should be rendered rather than directly invoking PDF drawing operations.

```json
{
  "type": "heading",
  "inputs": {
    "text": "Sunday Worship",
    "subHeading": "Third Sunday after Pentecost",
    "caption": "July 12, 2026"
  }
}
```

### 2.2 Explicit component boundaries

Every component has a declared input contract. A component should not implicitly inspect arbitrary parent or global state.

Data flows downward through `inputs`.

```text
Document data
    ↓
Parent component inputs
    ↓
Child component inputs
```

Data required by a parent from a nested component should flow upward only through declared exports.

```text
Child exports
    ↑
Parent aggregation
    ↑
Document-level metadata or output
```

### 2.3 Immutable evaluation contexts

Bindings are evaluated against immutable contexts. Components do not mutate shared document data or parent data.

### 2.4 Separation of concerns

The system separates:

1. Descriptor validation.
2. Component and type resolution.
3. Binding compilation.
4. Data evaluation.
5. Semantic component expansion.
6. Layout.
7. Pagination.
8. PDF rendering.

Complex components should be reduced to a small set of layout primitives before pagination and rendering.

### 2.5 Deterministic execution

Bindings and component evaluation must be side-effect-free and deterministic. The same descriptor, input data, component registry, and rendering configuration should produce the same document.

---

## 3. High-Level Pipeline

```text
Document JSON
    ↓
JSON Schema validation
    ↓
Semantic validation
    ↓
Component resolution
    ↓
Binding compilation
    ↓
Component tree evaluation
    ↓
Semantic component expansion
    ↓
Layout tree generation
    ↓
Measurement and pagination
    ↓
Late binding
    ↓
PDF drawing operations
```

### 3.1 Descriptor tree

The descriptor tree contains user-authored JSON and unresolved bindings.

### 3.2 Evaluated component tree

The evaluated tree contains concrete values but may still contain semantic components such as `song` or `scriptureReading`.

### 3.3 Layout tree

The layout tree contains only native layout primitives such as:

- block
- inline
- stack
- row
- text run
- spacer
- page break
- keep-together region

### 3.4 Render tree

The render tree contains fully measured and positioned drawing instructions.

---

## 4. Document Descriptor

A document should declare its language version, component dependencies, root data contract, and root component.

```json
{
  "$schema": "https://example.invalid/schemas/pdf-document.schema.json",
  "documentVersion": "1.0",
  "dataSchema": {
    "$ref": "./bulletin-data.schema.json"
  },
  "root": {
    "type": "heading",
    "inputs": {
      "text": {
        "$bind": "data.title"
      }
    }
  }
}
```

A larger document will normally use a structural root component such as a `document`, `stack`, `section`, or custom component. Those structural components are outside the initial semantic component list but are required internally by the rendering architecture.

---

## 5. Common Component Descriptor Shape

All component instances use the same base shape.

```json
{
  "type": "componentType",
  "id": "optional-stable-id",
  "inputs": {},
  "when": true,
  "style": {},
  "metadata": {}
}
```

### 5.1 `type`

The registered component type.

### 5.2 `id`

An optional stable instance identifier. Repeated components should derive stable identities from source data rather than array indexes.

### 5.3 `inputs`

The component's declared input values. Each value may be:

- A literal.
- A path binding.
- A template binding.
- A structured expression.
- A nested component descriptor, when permitted by the input type.
- An array containing any permitted values.

### 5.4 `when`

An optional boolean or boolean binding. A false value removes the component from the evaluated tree.

### 5.5 `style`

Optional presentation properties. Styles should be validated separately from semantic inputs.

### 5.6 `metadata`

Optional non-rendered document metadata, such as editor labels, source references, bookmarks, or accessibility information.

---

## 6. Binding Model

Bindings use explicit JSON objects so they can be distinguished from literal strings.

### 6.1 Path binding

```json
{
  "$bind": "inputs.heading.text"
}
```

### 6.2 Root document data binding

```json
{
  "$bind": "data.serviceTitle"
}
```

### 6.3 Template binding

```json
{
  "$template": "{{data.churchName}} — {{data.serviceDate}}"
}
```

### 6.4 Structured expression

```json
{
  "$expr": {
    "op": "coalesce",
    "args": [
      {
        "path": "inputs.displayName"
      },
      {
        "path": "inputs.songId"
      }
    ]
  }
}
```

### 6.5 Default values

```json
{
  "$bind": "inputs.caption",
  "default": ""
}
```

### 6.6 Required values

```json
{
  "$bind": "inputs.reference",
  "required": true
}
```

### 6.7 Recommended context namespaces

Bindings should use explicit namespaces:

- `data`: root document data.
- `inputs`: current component inputs.
- `locals`: values introduced by repeat, scope, or transformation nodes.
- `computed`: component-defined derived values.
- `slot`: values explicitly passed to slot content.
- `environment`: locale, renderer settings, and similar read-only configuration.
- `page`: late-bound page information.

Implicit scope searching should not be supported.

---

## 7. Component Definition Model

Built-in and user-defined components should conform to a common internal definition.

```typescript
interface ComponentDefinition {
  type: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;

  compile(
    descriptor: ComponentDescriptor,
    context: CompilerContext
  ): CompiledComponent;

  evaluate(
    component: CompiledComponent,
    context: EvaluationContext
  ): EvaluatedComponent;

  expand(
    component: EvaluatedComponent,
    context: ExpansionContext
  ): LayoutNode[];
}
```

### 7.1 Input schema

Defines the valid inputs and their types.

### 7.2 Output schema

Defines optional exports made available to parent components or document collectors.

### 7.3 Compile

Validates and compiles bindings and expressions.

### 7.4 Evaluate

Resolves all non-layout-dependent data.

### 7.5 Expand

Converts the semantic component into native layout nodes.

---

## 8. Type System

The component system requires both primitive and structured types.

### 8.1 Primitive types

- `string`
- `integer`
- `number`
- `boolean`
- `null`

### 8.2 Composite types

- arrays
- objects
- unions
- enums
- component references
- semantic structured values

### 8.3 Initial domain types

The initial component set requires these domain-specific types:

- `heading`
- `announcement`
- `speakerType`
- `responsiveReadingItem`
- `structuredText`
- `songVerse`
- `leadSheet`
- length unit

### 8.4 Component value versus component instance

A distinction should be made between:

1. A component instance to be rendered.
2. A structured data object whose shape is inferred from a component's inputs.

For example, `announcement.inputs.heading` is listed as type `heading`. That could mean either:

```json
{
  "heading": {
    "text": "Community Dinner",
    "subHeading": "",
    "caption": ""
  }
}
```

or:

```json
{
  "heading": {
    "type": "heading",
    "inputs": {
      "text": "Community Dinner"
    }
  }
}
```

The recommended architecture supports both but distinguishes them explicitly.

Use `headingData` for plain data:

```json
{
  "text": "Community Dinner",
  "subHeading": null,
  "caption": null
}
```

Use `component<heading>` for a renderable component descriptor:

```json
{
  "type": "heading",
  "inputs": {
    "text": "Community Dinner"
  }
}
```

For the initial implementation, nested semantic values should preferably be plain data objects. The owning component decides how to render them. This preserves consistent styling and keeps component inputs serializable and easy to validate.

---

## 9. Reusable Data Schemas

### 9.1 `headingData`

```json
{
  "$id": "headingData",
  "type": "object",
  "required": ["text"],
  "properties": {
    "text": {
      "type": "string"
    },
    "subHeading": {
      "type": ["string", "null"]
    },
    "caption": {
      "type": ["string", "null"]
    }
  },
  "additionalProperties": false
}
```

### 9.2 `speakerType`

```json
{
  "$id": "speakerType",
  "type": "string",
  "enum": ["leader", "follower"]
}
```

### 9.3 `announcementData`

```json
{
  "$id": "announcementData",
  "type": "object",
  "required": ["heading", "body"],
  "properties": {
    "heading": {
      "$ref": "headingData"
    },
    "body": {
      "$ref": "richContent"
    }
  },
  "additionalProperties": false
}
```

### 9.4 `responsiveReadingItemData`

```json
{
  "$id": "responsiveReadingItemData",
  "type": "object",
  "required": ["speaker", "speakerType", "lines"],
  "properties": {
    "speaker": {
      "type": "string"
    },
    "speakerType": {
      "$ref": "speakerType"
    },
    "lines": {
      "type": "array",
      "items": {
        "oneOf": [
          {
            "type": "string"
          },
          {
            "$ref": "inlineScriptureReadingData"
          }
        ]
      }
    }
  },
  "additionalProperties": false
}
```

### 9.5 `inlineScriptureReadingData`

```json
{
  "$id": "inlineScriptureReadingData",
  "type": "object",
  "required": ["reference", "text"],
  "properties": {
    "reference": {
      "type": "string"
    },
    "text": {
      "$ref": "structuredText"
    }
  },
  "additionalProperties": false
}
```

### 9.6 `songVerseData`

```json
{
  "$id": "songVerseData",
  "type": "object",
  "required": ["lines"],
  "properties": {
    "verseNumber": {
      "type": ["string", "integer", "null"]
    },
    "lines": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "additionalProperties": false
}
```

---

## 10. Structured Text

`structuredText` is required for scripture and may later be reused for announcements, prayers, liturgy, and song lyrics.

A plain string is insufficient because the system must preserve:

- Paragraph boundaries.
- Explicit line breaks.
- Verse numbers.
- Verse boundaries.
- Inline emphasis.
- Future footnotes or annotations.

### 10.1 Recommended representation

```json
{
  "blocks": [
    {
      "type": "paragraph",
      "inlines": [
        {
          "type": "verseNumber",
          "value": "1"
        },
        {
          "type": "text",
          "value": "In the beginning was the Word, "
        },
        {
          "type": "text",
          "value": "and the Word was with God.",
          "emphasis": "italic"
        }
      ]
    },
    {
      "type": "lineBreak"
    },
    {
      "type": "paragraph",
      "inlines": [
        {
          "type": "verseNumber",
          "value": "2"
        },
        {
          "type": "text",
          "value": "He was in the beginning with God."
        }
      ]
    }
  ]
}
```

### 10.2 Minimal first version

The first version may support:

```json
{
  "verses": [
    {
      "number": "1",
      "text": "In the beginning was the Word..."
    },
    {
      "number": "2",
      "text": "He was in the beginning with God."
    }
  ]
}
```

The richer block-and-inline representation is recommended long-term because it avoids later migrations when inline formatting is added.

---

## 11. Rich Content

`announcement.inputs.body` is currently `any`. Leaving it unbounded will weaken validation and complicate rendering.

Define a `richContent` union instead.

```json
{
  "$id": "richContent",
  "oneOf": [
    {
      "type": "string"
    },
    {
      "$ref": "structuredText"
    },
    {
      "type": "array",
      "items": {
        "$ref": "contentNode"
      }
    }
  ]
}
```

A `contentNode` may initially permit:

- `text`
- `paragraph`
- `heading`
- `inlineScriptureReading`
- `spacer`

This creates a controlled way to build complex announcement bodies without accepting arbitrary JSON.

Example:

```json
{
  "heading": {
    "text": "Community Dinner"
  },
  "body": [
    {
      "type": "paragraph",
      "inputs": {
        "text": "Dinner will be served at 6:00 PM."
      }
    },
    {
      "type": "text",
      "inputs": {
        "text": "Volunteers are needed."
      }
    }
  ]
}
```

---

## 12. Initial Component Contracts

## 12.1 `text`

Renders a single text value. It should normally behave as an inline-capable text run, though it may also be used as a block when placed in a block container.

### Inputs

| Input | Type | Required |
|---|---|---:|
| `text` | `string` | Yes |

### Example

```json
{
  "type": "text",
  "inputs": {
    "text": {
      "$bind": "data.footerText"
    }
  }
}
```

### Expansion

```text
text
    ↓
TextRun
```

---

## 12.2 `paragraph`

Renders a text value with paragraph layout behavior.

### Inputs

| Input | Type | Required |
|---|---|---:|
| `text` | `string` or `structuredText` | Yes |

Although the initial list specifies `string`, accepting `structuredText` is recommended to preserve formatting and reduce future migration.

### Layout behavior

- Begins a block.
- Supports paragraph spacing.
- Supports line wrapping.
- May support first-line indentation.
- Should be splittable across pages unless explicitly configured otherwise.

### Expansion

```text
paragraph
    ↓
Block
    └── TextRun[]
```

---

## 12.3 `heading`

Renders a primary heading with optional secondary and caption text.

### Inputs

| Input | Type | Required |
|---|---|---:|
| `text` | `string` | Yes |
| `subHeading` | `string` | No |
| `caption` | `string` | No |

### Example

```json
{
  "type": "heading",
  "inputs": {
    "text": "Morning Worship",
    "subHeading": "The Fourth Sunday of Advent",
    "caption": "December 20, 2026"
  }
}
```

### Layout behavior

- Should generally be kept with at least the first following content block.
- Empty optional values must not produce empty layout blocks.
- May create a document outline or bookmark annotation.
- May expose a normalized `headingData` export.

### Expansion

```text
heading
    ↓
KeepWithNext
    └── Stack
        ├── HeadingText
        ├── OptionalSubHeadingText
        └── OptionalCaptionText
```

---

## 12.4 `announcements`

Renders a collection of announcement data.

### Inputs

| Input | Type | Required |
|---|---|---:|
| `announcements` | `array<announcementData>` | Yes |

### Behavior

- Evaluates each announcement in order.
- Produces an `announcement` child for each array item.
- May introduce spacing or separators between announcements.
- Empty arrays may produce no output or a configurable placeholder.

### Example

```json
{
  "type": "announcements",
  "inputs": {
    "announcements": {
      "$bind": "data.announcements"
    }
  }
}
```

### Expansion

```text
announcements
    ↓
Stack
    ├── announcement
    ├── announcement
    └── announcement
```

---

## 12.5 `announcement`

Renders a single announcement.

### Inputs

| Input | Type | Required |
|---|---|---:|
| `heading` | `headingData` | Yes |
| `body` | `richContent` | Yes |

### Behavior

- Renders `heading` using the shared heading presentation rules.
- Renders body content using the rich-content renderer.
- Should attempt to keep the heading with the first body block.
- May export document metadata such as a normalized announcement title.

### Expansion

```text
announcement
    ↓
Stack
    ├── heading
    └── RichContent[]
```

---

## 12.6 `responsiveReadingItem`

Renders one speaker entry in a responsive reading.

### Inputs

| Input | Type | Required |
|---|---|---:|
| `speaker` | `string` | Yes |
| `speakerType` | `speakerType` | Yes |
| `lines` | `array<string \| inlineScriptureReadingData>` | Yes |

### Behavior

- Uses `speakerType` for semantic styling, not merely presentation.
- `leader` and `follower` should map to style tokens rather than hardcoded fonts.
- Each line may be plain text or inline scripture.
- Speaker labels should normally be kept with the first line.
- An item should be split across pages only when necessary.

### Example

```json
{
  "type": "responsiveReadingItem",
  "inputs": {
    "speaker": "Leader",
    "speakerType": "leader",
    "lines": [
      "Give thanks to the Lord, for he is good.",
      {
        "reference": "Psalm 136:1",
        "text": {
          "verses": [
            {
              "number": "1",
              "text": "His steadfast love endures forever."
            }
          ]
        }
      }
    ]
  }
}
```

---

## 12.7 `responsiveReading`

Renders a sequence of responsive reading items.

### Inputs

| Input | Type | Required |
|---|---|---:|
| `items` | `array<responsiveReadingItemData>` | Yes |

The original spelling `reasponsiveReadingItem` should be corrected to `responsiveReadingItem`.

### Behavior

- Preserves item order.
- Applies consistent spacing between speakers.
- May alternate or otherwise style entries by `speakerType`.
- Should avoid placing a speaker label alone at the bottom of a page.

### Expansion

```text
responsiveReading
    ↓
Stack
    ├── responsiveReadingItem
    ├── responsiveReadingItem
    └── responsiveReadingItem
```

---

## 12.8 `inlineScriptureReading`

Renders a scripture reference and scripture text inside another flow.

### Inputs

| Input | Type | Required |
|---|---|---:|
| `reference` | `string` | Yes |
| `text` | `structuredText` | Yes |

### Behavior

- Designed for composition inside paragraphs, announcements, responsive readings, or other content.
- Reference presentation may be inline, prefixed, suffixed, or rendered as a short label according to style configuration.
- Preserves verse numbers and explicit line boundaries.
- Must be splittable across lines.

### Expansion

```text
inlineScriptureReading
    ↓
InlineGroup
    ├── ReferenceTextRun
    └── StructuredTextRuns
```

---

## 12.9 `scriptureReading`

Renders a full scripture-reading section.

### Inputs

| Input | Type | Required |
|---|---|---:|
| `reference` | `string` | Yes |
| `text` | `structuredText` | Yes |
| `heading` | `headingData` | Yes |

### Behavior

- Reuses the data and rendering semantics of `inlineScriptureReading`.
- Adds a section heading.
- The heading should be kept with the reference and first scripture line.
- May generate a bookmark or table-of-contents annotation.
- Long readings must split safely across pages while preserving verse markers.

### Expansion

```text
scriptureReading
    ↓
Stack
    ├── heading
    └── ScriptureBlock
        ├── Reference
        └── StructuredText
```

---

## 12.10 `songVerse`

Renders one verse or refrain-like unit.

### Inputs

| Input | Type | Required |
|---|---|---:|
| `verseNumber` | `string \| integer` | No |
| `lines` | `array<string>` | Yes |

### Behavior

- `verseNumber` may contain values such as `1`, `"1"`, `"Refrain"`, `"Chorus"`, or `"Bridge"`.
- The renderer should normalize integer values to strings.
- Empty line arrays should be rejected unless explicitly allowed.
- A verse should preferably remain together on one page.
- When a verse cannot fit on one page, it may split between lines.

### Example

```json
{
  "verseNumber": "Refrain",
  "lines": [
    "Alleluia, alleluia,",
    "Sing to the Lord."
  ]
}
```

---

## 12.11 `song`

Renders a song, hymn, or psalm.

### Inputs

| Input | Type | Required |
|---|---|---:|
| `type` | `songType` | Yes |
| `songId` | `string` | Yes |
| `displayName` | `string` | Yes |
| `showVerseNumber` | `boolean` | Yes |
| `verses` | `array<songVerseData>` | Yes |
| `music` | `leadSheet` | No |

Although the initial list specifies a free-form string for `type`, an enum is recommended:

```json
{
  "type": "string",
  "enum": ["song", "hymn", "psalm"]
}
```

Additional values can be introduced later through a versioned schema.

### `songId`

`songId` is a library key, not necessarily a display value. The rendering engine should not fetch remote data implicitly. Library resolution should occur before or during the component resolution phase through a registered content provider.

### `verses`

The original note says the array may contain strings for refrain-like one-off lines. This should instead be normalized to `songVerseData`.

```json
{
  "verseNumber": "Refrain",
  "lines": [
    "One-off refrain line"
  ]
}
```

This avoids a heterogeneous array and simplifies validation.

### Behavior

- Renders the display name and optional type-specific label.
- Resolves `songId` through a library provider when additional metadata is needed.
- Displays or suppresses verse labels using `showVerseNumber`.
- Preserves verse order.
- Attempts to keep individual verses together.
- May render optional lead-sheet notation when supported.
- The presence of `music` should not change the semantic meaning of the lyrics.

### Expansion

```text
song
    ↓
Stack
    ├── SongHeading
    ├── OptionalLeadSheet
    ├── songVerse
    ├── songVerse
    └── songVerse
```

---

## 12.12 `spacer`

Creates explicit layout space.

### Inputs

| Input | Type | Required |
|---|---|---:|
| `size` | `number` | Yes |
| `unit` | `lengthUnit` | Yes |

JSON has one numeric type, so the schema should use `number` rather than `float`.

Recommended initial units:

- `pt`
- `in`
- `mm`
- `cm`

Relative units such as `em`, `%`, `vh`, or `vw` should be deferred until their layout semantics are clearly defined.

### Example

```json
{
  "type": "spacer",
  "inputs": {
    "size": 12,
    "unit": "pt"
  }
}
```

### Behavior

- Converts the supplied length to PDF points during evaluation.
- Must reject negative sizes unless overlap is explicitly introduced as a separate feature.
- A spacer at a page boundary should normally collapse rather than create a blank page.
- Spacer behavior should be configurable for page-top and page-bottom collapsing.

---

## 13. Component Composition

### 13.1 Data-driven collection components

Collection components such as `announcements` and `responsiveReading` should generate child components from data.

Conceptually:

```json
{
  "type": "repeat",
  "items": {
    "$bind": "inputs.announcements"
  },
  "as": "announcement",
  "body": {
    "type": "announcement",
    "inputs": {
      "heading": {
        "$bind": "locals.announcement.heading"
      },
      "body": {
        "$bind": "locals.announcement.body"
      }
    }
  }
}
```

The public descriptor does not need to expose this implementation. It is the internal expansion behavior of the component.

### 13.2 Nested component data

Parent components should pass only declared data to nested components.

```text
announcements
    passes announcementData
        ↓
announcement
    passes headingData
        ↓
heading
```

### 13.3 Slots

Future custom components should support slots for caller-provided child content. Slot content should evaluate in the caller's lexical context and receive component data only through explicitly declared slot variables.

Slots are not required for the initial built-in semantic components, but the architecture should reserve them.

---

## 14. Upward Data Flow

Most initial components only consume data, but the system should support declared exports for future aggregation and metadata collection.

### 14.1 Component exports

Example:

```json
{
  "exports": {
    "title": {
      "type": "string",
      "value": {
        "$bind": "inputs.heading.text"
      }
    }
  }
}
```

Exports may be read by the immediate parent or collected from descendants.

### 14.2 Document annotations

Layout and navigation information should use document annotations rather than ordinary exports.

Examples:

- Heading bookmarks.
- Table-of-contents entries.
- Scripture-reference indexes.
- Song indexes.
- Internal PDF destinations.
- Accessibility structure tags.

### 14.3 Library references

Components such as `song` may declare external semantic dependencies such as `songId`. Resolution results should be attached to the evaluated component, not written back into root data.

---

## 15. Content Provider Architecture

The `song` component introduces a requirement for external content lookup.

```typescript
interface ContentProvider<T> {
  resolve(id: string, context: ResolveContext): Promise<T | null>;
}
```

Recommended providers include:

- `SongLibraryProvider`
- `ScriptureLibraryProvider`
- `ImageAssetProvider`
- `FontProvider`

Provider behavior should be explicit and configurable.

### 15.1 Resolution policies

- `embedded-only`: all data must already be present.
- `local-library`: permit registered local content libraries.
- `remote-library`: permit approved remote providers.
- `cached`: use a versioned local cache.

For reproducible PDFs, resolved external content should be lockable by version or content hash.

```json
{
  "songId": "hymnal:123",
  "libraryLock": {
    "version": "2026.1",
    "hash": "sha256-..."
  }
}
```

---

## 16. Styling Architecture

Semantic component inputs should remain separate from presentation.

```json
{
  "type": "heading",
  "inputs": {
    "text": "Morning Worship"
  },
  "style": {
    "variant": "serviceTitle"
  }
}
```

### 16.1 Style tokens

Use named style tokens:

- `text.default`
- `paragraph.default`
- `heading.primary`
- `heading.secondary`
- `announcement.heading`
- `responsiveReading.leader`
- `responsiveReading.follower`
- `scripture.reference`
- `scripture.verseNumber`
- `song.title`
- `song.verseNumber`

### 16.2 Theme inheritance

Style resolution should follow:

```text
Renderer defaults
    ↓
Document theme
    ↓
Component-type style
    ↓
Named variant
    ↓
Instance overrides
```

### 16.3 Semantic selectors

Style selectors may reference semantic values.

```json
{
  "responsiveReadingItem": {
    "variants": {
      "leader": {},
      "follower": {}
    }
  }
}
```

This avoids encoding presentation decisions inside component logic.

---

## 17. Layout and Pagination

### 17.1 Native layout primitives

Semantic components should expand into a limited native layout vocabulary:

- `TextRun`
- `InlineGroup`
- `Block`
- `Stack`
- `Row`
- `Spacer`
- `KeepTogether`
- `KeepWithNext`
- `PageBreak`
- `Canvas`
- `Image`

### 17.2 Measurement

Each native node supports:

```typescript
measure(constraints: LayoutConstraints): MeasuredSize;
layout(bounds: Rect): PositionedNode[];
```

### 17.3 Splitting policies

Components need explicit page-splitting behavior.

| Component | Default splitting behavior |
|---|---|
| `text` | Inline or block wrapping |
| `paragraph` | Split between lines |
| `heading` | Keep together and with next content |
| `announcement` | Keep heading with first body block |
| `responsiveReadingItem` | Keep speaker with first line |
| `inlineScriptureReading` | Split between lines |
| `scriptureReading` | Keep heading/reference with first line |
| `songVerse` | Prefer keep-together; split between lines if required |
| `song` | Split between verses |
| `spacer` | Collapse at page boundaries |

### 17.4 Orphan and widow control

Paragraph-like components should support:

- minimum lines at page bottom
- minimum lines at page top
- keep-with-next
- keep-together priority

These should be layout properties rather than semantic input fields.

---

## 18. Late-Bound Values

Some values are unknown until pagination:

- current page number
- total page count
- page-local headers and footers
- bookmark target pages
- table-of-contents page numbers

These values should be resolved in a separate late-binding phase.

Initial semantic component bindings should not depend on page values unless explicitly marked as late-bound.

---

## 19. Validation

Validation should occur in multiple layers.

### 19.1 JSON Schema validation

Validates:

- Required properties.
- Primitive types.
- Enum values.
- Object structure.
- Array item types.
- Unknown properties.

### 19.2 Semantic validation

Validates:

- Registered component types.
- Binding paths.
- Binding result types.
- Component input compatibility.
- Content provider availability.
- Cyclic computed values.
- Stable repeat keys.
- Unsupported nested content.
- Unsupported units.

### 19.3 Rendering validation

Validates:

- Font availability.
- Image decodability.
- Page constraints.
- Unbreakable content larger than a page.
- Unsupported lead-sheet features.
- Missing external resources.

### 19.4 Diagnostics

Each diagnostic should contain:

```typescript
interface Diagnostic {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  componentType?: string;
  instanceId?: string;
  jsonPointer?: string;
  binding?: string;
  sourceId?: string;
}
```

Example:

```text
ERROR COMPONENT_INPUT_TYPE
Expected structuredText for scriptureReading.inputs.text,
but received string.
Path: /root/children/4/inputs/text
```

---

## 20. JSON Schema Strategy

Use modular schemas:

```text
schemas/
├── document.schema.json
├── bindings.schema.json
├── expressions.schema.json
├── common.schema.json
├── structured-text.schema.json
├── rich-content.schema.json
├── components/
│   ├── text.schema.json
│   ├── paragraph.schema.json
│   ├── heading.schema.json
│   ├── announcements.schema.json
│   ├── announcement.schema.json
│   ├── responsive-reading-item.schema.json
│   ├── responsive-reading.schema.json
│   ├── inline-scripture-reading.schema.json
│   ├── scripture-reading.schema.json
│   ├── song-verse.schema.json
│   ├── song.schema.json
│   └── spacer.schema.json
└── data/
    ├── heading-data.schema.json
    ├── announcement-data.schema.json
    ├── responsive-reading-item-data.schema.json
    ├── inline-scripture-reading-data.schema.json
    ├── song-verse-data.schema.json
    └── lead-sheet.schema.json
```

Properties that accept a literal or binding should use reusable schema helpers.

```json
{
  "$defs": {
    "stringValue": {
      "oneOf": [
        {
          "type": "string"
        },
        {
          "$ref": "bindings.schema.json#/$defs/stringBinding"
        }
      ]
    }
  }
}
```

JSON Schema validates descriptor shape. It does not replace semantic type checking of expressions and binding paths.

---

## 21. Component Registry

```typescript
interface ComponentRegistry {
  register(definition: ComponentDefinition): void;
  get(type: string): ComponentDefinition | undefined;
  has(type: string): boolean;
}
```

The registry should distinguish:

- Native layout components.
- Built-in semantic components.
- User-defined descriptor components.
- Plugin-provided components.

Component names should be unique within a namespace.

```text
core:text
core:paragraph
core:heading
liturgy:responsiveReading
music:song
```

Short names may resolve through default namespaces.

---

## 22. Suggested Internal Type Definitions

```typescript
type BoundValue<T> =
  | T
  | PathBinding<T>
  | TemplateBinding
  | ExpressionBinding<T>;

interface ComponentDescriptor<TInputs = Record<string, unknown>> {
  type: string;
  id?: string | BoundValue<string>;
  inputs: {
    [K in keyof TInputs]: BoundValue<TInputs[K]>;
  };
  when?: BoundValue<boolean>;
  style?: StyleDescriptor;
  metadata?: Record<string, unknown>;
}
```

```typescript
interface EvaluationContext {
  data: unknown;
  inputs: Readonly<Record<string, unknown>>;
  locals: Readonly<Record<string, unknown>>;
  computed: Readonly<Record<string, unknown>>;
  environment: Readonly<RenderEnvironment>;
}
```

```typescript
interface RenderEnvironment {
  locale: string;
  timezone?: string;
  defaultLengthUnit: "pt" | "in" | "mm" | "cm";
  contentProviders: ContentProviderRegistry;
  theme: Theme;
}
```

---

## 23. Example Document Fragment

```json
{
  "type": "document",
  "children": [
    {
      "type": "heading",
      "inputs": {
        "text": {
          "$bind": "data.service.heading.text"
        },
        "subHeading": {
          "$bind": "data.service.heading.subHeading"
        },
        "caption": {
          "$bind": "data.service.heading.caption"
        }
      }
    },
    {
      "type": "spacer",
      "inputs": {
        "size": 12,
        "unit": "pt"
      }
    },
    {
      "type": "scriptureReading",
      "inputs": {
        "heading": {
          "$bind": "data.reading.heading"
        },
        "reference": {
          "$bind": "data.reading.reference"
        },
        "text": {
          "$bind": "data.reading.text"
        }
      }
    },
    {
      "type": "responsiveReading",
      "inputs": {
        "items": {
          "$bind": "data.responsiveReading"
        }
      }
    },
    {
      "type": "song",
      "inputs": {
        "type": "hymn",
        "songId": {
          "$bind": "data.closingSong.id"
        },
        "displayName": {
          "$bind": "data.closingSong.name"
        },
        "showVerseNumber": true,
        "verses": {
          "$bind": "data.closingSong.verses"
        },
        "music": {
          "$bind": "data.closingSong.music",
          "default": null
        }
      }
    },
    {
      "type": "announcements",
      "inputs": {
        "announcements": {
          "$bind": "data.announcements"
        }
      }
    }
  ]
}
```

---

## 24. Recommended Normalizations

The following changes are recommended before locking the first schema version.

### 24.1 Correct naming

Change:

```text
reasponsiveReadingItem
```

to:

```text
responsiveReadingItem
```

### 24.2 Use `number` rather than `float`

JSON Schema uses `number`. The implementation may represent it as a floating-point value internally.

### 24.3 Normalize song verses

Do not allow raw strings inside `song.inputs.verses`. Represent refrains and one-off lines as `songVerseData`.

```json
{
  "verseNumber": "Refrain",
  "lines": ["Sing praise to God."]
}
```

### 24.4 Replace `any`

Replace `announcement.inputs.body: any` with `richContent`.

### 24.5 Separate data types from component types

Use names such as:

- `headingData`
- `announcementData`
- `songVerseData`

for plain data, and:

- `heading`
- `announcement`
- `songVerse`

for renderable component types.

### 24.6 Constrain semantic strings

Use enums for values such as:

- `speakerType`
- `songType`
- `lengthUnit`

This permits reliable styling and validation.

---

## 25. Open Design Decisions

### 25.1 Announcement body format

Choose whether `richContent` initially supports:

1. Plain string only.
2. `structuredText`.
3. A restricted array of component descriptors.

The recommended first version supports all three through a controlled union.

### 25.2 Structured scripture representation

Choose between:

- Verse-oriented data.
- Block-and-inline rich text.

The block-and-inline representation is more extensible. The verse-oriented representation is simpler to author.

### 25.3 Lead-sheet representation

`leadSheet` remains unresolved. It should eventually define:

- Metadata.
- Musical key.
- Meter.
- Tempo.
- Measures.
- Chords.
- Lyrics alignment.
- Repeats.
- Endings.
- Rendering assets or notation primitives.

Until defined, `music` should be treated as an opaque, versioned object accepted only by a registered lead-sheet renderer.

```json
{
  "format": "leadSheet",
  "version": "0.1",
  "data": {}
}
```

### 25.4 Library resolution

Determine whether `songId`:

- supplements embedded song data,
- replaces embedded song data,
- or validates that embedded data matches a library record.

The recommended policy is that explicit descriptor inputs override resolved library defaults.

### 25.5 Inline versus block semantics

Define whether `text` is always inline, always block, or context-sensitive. The recommended approach is context-sensitive expansion into a `TextRun` when placed inside inline content and a text block otherwise.

---

## 26. Initial Implementation Scope

### Phase 1

Implement:

- JSON document loading.
- Modular JSON Schema validation.
- Literal and path bindings.
- Component registry.
- Immutable evaluation contexts.
- Initial semantic components.
- `headingData`, `announcementData`, `responsiveReadingItemData`, `structuredText`, and `songVerseData`.
- Native layout primitives.
- Basic pagination.
- PDF text rendering.
- Length conversion.
- Diagnostics.

### Phase 2

Add:

- Template and structured expression bindings.
- Rich announcement content.
- Content-provider registry.
- Song-library resolution.
- Bookmarks and document outline.
- Style themes and variants.
- Visual editor source mapping.
- Incremental preview evaluation.

### Phase 3

Add:

- Lead-sheet rendering.
- Slots and user-defined JSON components.
- Computed values.
- Component exports.
- Table-of-contents generation.
- Cross-references.
- Advanced orphan and widow control.
- Plugin components.

---

## 27. Final Recommended Model

The architecture should treat every semantic component as a pure transformation:

```text
evaluated layout nodes =
    component(
        validated immutable inputs,
        immutable evaluation context,
        resolved theme,
        registered content providers
    )
```

A component may produce:

- Layout nodes.
- Declared semantic exports.
- Document annotations.
- Diagnostics.

A component must not:

- Mutate parent data.
- Mutate root document data.
- Reach into undeclared parent internals.
- Execute arbitrary code from JSON.
- Perform uncontrolled network access.
- Depend on pagination during normal data evaluation.

This model supports deeply nested, data-bound document structures while preserving predictable behavior, strong validation, and a clear path from JSON descriptors to deterministic PDF output.
