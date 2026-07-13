# CBB static quarantine worker

This package implements the closed JSON protocol consumed by
`NodeBubblewrapQuarantineWorker`. Release builds on glibc Linux enable static CRT
linking and must pass `scripts/verify-static.sh` before they are signed or entered
in a component manifest.

Implemented, fail-closed operations:

- `inspectArchive`: streaming single-disk ZIP extraction of stored/DEFLATE regular
  files, with central/local metadata agreement, CRC, path, alias, entry, byte, and
  compression-ratio enforcement. Encrypted and ZIP64 archives are rejected.
- `sanitizeSvg`: strict XML parsing and deterministic serialization of a small,
  inert SVG element/attribute allowlist.
- `canonicalizeRaster`: bounded PNG/JPEG decoding followed by deterministic RGBA8
  PNG encoding. Animated PNG and CMYK JPEG are rejected.
- `inspectFont`: OpenType/TrueType/TTC structural inspection through the same
  `ttf-parser` API used in the Typst font stack; the original bytes are copied to
  the verified output slot. WOFF/WOFF2 remain unavailable without their pinned
  decompression closure.

`flattenPdf` deliberately returns `isolationUnavailable`. The workspace has
dynamic Poppler/qpdf/Ghostscript installations but no statically linkable,
pinned PDF renderer. The bubblewrap transport exposes neither host `/usr` nor a
dynamic loader, and this worker does not weaken that boundary or claim a probe is
flattening. Completion requires a reviewed static renderer dependency whose
binary and resource closure can be signed in the M3 component manifest.

Build and verify without network access:

```sh
cargo build --release --offline --locked
./scripts/verify-static.sh target/x86_64-unknown-linux-gnu/release/cbb-quarantine-worker
cargo test --offline --locked
```

From the `app` workspace root, the equivalent clean gate is
`npm run verify:m3-quarantine:linux`. Its package-local script deliberately
changes into this directory before invoking Cargo so `.cargo/config.toml` and
the explicit static target cannot be bypassed by `--manifest-path` discovery.

Archive paths are currently restricted to safe ASCII. This is deliberately more
conservative than the protocol's NFC-safe Unicode allowance because the pinned
offline dependency closure does not contain a Unicode normalization library.

The textual `NotoSansTest-Regular.hex` test fixture is the small Noto test font
shipped by the system Noto package. Its embedded name/license records identify
Google and the SIL Open Font License 1.1; it is used only to make the font success
and malformed-table tests independent of host-installed fonts.
