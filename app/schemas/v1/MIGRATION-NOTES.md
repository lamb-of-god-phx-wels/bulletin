# V1 Schema Migration Notes

Legacy schema location: `/bulletin/schema/*.schema.json`
V1 schema location: `/bulletin/app/schemas/v1/`

This document records fields present in the legacy schemas that are absent,
renamed, or structurally changed in the v1 schemas.  It is the normative
reference for the migration engine (Milestone M3).

---

## Field-by-field migration table

### imageElement

1. **`data.path`** → Legacy used a local file-system path string.  V1 uses
   `data.assetRef` (`asset:<uuid>` portable reference).  Migration: hash the
   file, look up the asset catalog; if not found, import the file and create
   an asset record, then write `asset:<new-uuid>`.

2. **`data.caption`** → Not defined by the v1 Image spec (lines 2563-2609).
   Migration decision deferred: convert to an adjacent text element or drop
   with a warning surfaced to the volunteer.

3. **`data.fit` enum `"stretch"`** → V1 allows only `"contain"` and
   `"cover"`.  Migration: map `stretch` → `contain`.

4. **`bindings` object (per-element, keyed by field)** → V1 uses an ordered
   `bindings` array on `baseElementFields`.  Migration: convert each
   object property to an array entry; assign document-unique `id` values.

---

### musicElement

5. **`data.notes`** → Not present in v1 `musicElementData`.  Migration: drop
   silently or surface as a warning.

6. **`data.copyright`** → Not in v1 (rights are modeled as a structured
   `rights` array + `rightsAssociationReview`).  Migration: prompt the
   volunteer to enter structured rights data; the legacy string becomes a
   hint only.

7. **`data.hymnNumber`** → V1 uses `data.number`.  Migration: rename the
   field directly.

8. **`data.source`** → Present in v1 with the same name; no structural
   change.

---

### dateElement

9. **`data.locale` default `"en-US"`** → V1 has no schema-level default for
   `locale`; the app default is the workspace locale.  Migration: if the
   value is `"en-US"` drop it (let the app default apply); otherwise keep
   it.

---

### Layout container renames

10. **`gridLayoutElement`** → Renamed to `gridElement` in v1.
    `data.cellPadding` is now optional (has a fallback); `rows` and
    `columns` remain required.

11. **`stackLayoutElement`** → Renamed to `stackElement` in v1.

---

### Structural model changes

12. **Legacy element `schema` array** (embedded field-contract definitions
    on elements) → V1 uses a top-level `fieldContract` / `fieldValues`
    structure.  Migration: convert the embedded `schema` array to a
    `fieldContract` object.

13. **Legacy `bindings` object** (per-element, keyed by field name) → V1
    uses an ordered `bindings` array on `baseElementFields`.  Migration:
    convert the object to an ordered array; generate document-unique `id`
    strings for each entry.

14. **Legacy element `id` pattern** (`^[A-Za-z][A-Za-z0-9_-]*$`) → V1
    `nodeId` uses the same pattern.  No migration needed.

---

### pageBreakElement

15. **`data.intent`** → V1 adds `data.intent` (optional, defaults to
    `flowBreak`).  Legacy page-break elements have no `data` object; treat
    them as `flowBreak`.
