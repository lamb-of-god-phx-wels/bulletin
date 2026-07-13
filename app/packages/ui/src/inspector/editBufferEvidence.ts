const FNV_OFFSET_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;

/**
 * A small, stable fingerprint used to decide whether recovered inspector text
 * was based on the value currently shown by a control. It is evidence for a
 * local recovery decision, not a security or identity primitive.
 */
export function inspectorCanonicalValueHash(value: string): string {
  let hash = FNV_OFFSET_64;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * FNV_PRIME_64);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}
