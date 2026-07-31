/** Normalizes a display-style reference without collapsing discontiguous verse ranges. */
export function normalizeScriptureReference(value: string): string {
  let reference = value.trim();
  if (reference.startsWith('(') && reference.endsWith(')')) reference = reference.slice(1, -1).trim();
  return reference
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/\s*,\s*/g, ',')
    .replace(/\s*;\s*/g, '; ')
    .replace(/\s+/g, ' ');
}
