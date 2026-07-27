# Component definitions

This folder contains the reusable semantic components used by the v2 document
engine. A definition declares an input contract, a composition of trusted
native layout primitives, named formatting parts, editor metadata, and preview
sample data.

`prepackaged/` contains the omakase components shipped with Bulletin Builder.
Workspace components use the same versioned JSON contract. Invalid definitions,
missing dependencies, and duplicate identities are quarantined individually;
they must never prevent the application from opening.

The definition contract is
[`schemas/component-definition.schema.json`](../schemas/component-definition.schema.json).
Component definitions are distinct from template instances and weekly bulletin
data.
