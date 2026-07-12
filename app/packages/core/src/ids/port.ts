/**
 * IdPort — injected capability for UUID minting.
 *
 * Core never calls crypto or any platform API directly.  Callers inject an
 * implementation of this interface.  For production use in the Electron shell,
 * inject `{ randomUuid: () => crypto.randomUUID() }`.  For deterministic tests,
 * inject the `sequentialIdPort` exported from this module.
 */
export interface IdPort {
  /**
   * Return a new random UUIDv4 string in canonical lowercase-hyphenated form,
   * e.g. `"550e8400-e29b-41d4-a716-446655440000"`.
   */
  randomUuid(): string;
}

/**
 * A deterministic IdPort for use in tests.
 *
 * Each call returns the next UUID in a predictable sequence.  The sequence is
 * seeded with a fixed prefix so that test output is stable across runs.
 *
 * Reset the counter between test suites by constructing a new instance.
 */
export function makeSequentialIdPort(startIndex = 0): IdPort {
  let counter = startIndex;
  return {
    randomUuid(): string {
      const n = counter++;
      // Produce a valid lowercase-hyphenated UUID string.
      // Format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      // We fill most octets with 00, use the counter in the last 4 hex digits,
      // and set the version/variant bits as required by RFC 4122.
      const hex = n.toString(16).padStart(12, "0");
      return `00000000-0000-4000-8000-${hex.slice(-12).padStart(12, "0")}`;
    },
  };
}
