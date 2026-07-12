/**
 * @cbb/workers — Electron utilityProcess workers for the Church Bulletin Builder.
 *
 * Each worker runs in a sandboxed OS process with no network access.
 * Workers handle untrusted content parsing: ZIP, SVG, raster decode,
 * font tables, PDF flattening, booklet composition, and PDF/UA validation.
 */

export const WORKERS_PACKAGE_NAME = "@cbb/workers" as const;
