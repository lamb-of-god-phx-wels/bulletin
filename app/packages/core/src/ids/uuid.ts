/**
 * UUID validation and normalisation.
 *
 * The spec requires UUIDs to be stored in canonical lowercase-hyphenated form:
 *   xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 * where each `x` is a lowercase hexadecimal digit.
 */

/** Regex that matches a canonical lowercase-hyphenated UUID. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Return `true` iff `value` is a canonical lowercase-hyphenated UUID string.
 */
export function isCanonicalUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Normalise `value` to a canonical lowercase-hyphenated UUID string, or return
 * `null` if the value cannot be recognised as any UUID form.
 *
 * Accepted non-canonical inputs:
 *   - Uppercase hex digits (lowercased).
 *   - Compact form without hyphens (32 hex chars, any case).
 *   - Curly-brace wrapped form: `{xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx}`.
 *
 * This helper is intended for migration/import paths only.  Newly minted UUIDs
 * are always already canonical.
 */
export function normaliseUuid(value: string): string | null {
  const trimmed = value.trim();

  // Strip optional curly braces.
  const stripped = trimmed.startsWith("{") && trimmed.endsWith("}")
    ? trimmed.slice(1, -1)
    : trimmed;

  // Already canonical or just needs lowercasing.
  const lower = stripped.toLowerCase();
  if (UUID_RE.test(lower)) {
    return lower;
  }

  // Compact form: 32 hex chars, no hyphens.
  if (/^[0-9a-f]{32}$/.test(lower)) {
    return (
      `${lower.slice(0, 8)}-${lower.slice(8, 12)}-` +
      `${lower.slice(12, 16)}-${lower.slice(16, 20)}-${lower.slice(20)}`
    );
  }

  return null;
}
