# Block descriptors

This folder contains the JSON definitions used by the template block library.

`prepackaged/` holds the omakase block set shipped with the application. Each
file contains display metadata and a complete prototype `BulletinBlock`. The
application loads these files at runtime and gives every inserted copy fresh
IDs, so descriptors can safely include nested blocks and formatting.

The contract is documented by
[`schemas/block-descriptor-v1.schema.json`](../schemas/block-descriptor-v1.schema.json).
Workspace-imported and versioned block descriptors can use the same shape.
