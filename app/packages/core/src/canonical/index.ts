/**
 * @cbb/core/canonical — RFC 8785 canonical JSON serialization and SHA-256
 * hashing primitives.
 *
 * All exports are runtime-agnostic (no node: imports, no WebCrypto dependency).
 *
 * @module
 */

export type { JsonValue } from "./jcs.js";
export { canonicalJsonBytes, canonicalStringify } from "./jcs.js";

export type { HashPort } from "./sha256.js";
export type { Sha256Hash } from "./sha256.js";
export {
  bytesToHex,
  hashBytes,
  hashCanonical,
  hexToSha256Hash,
  sha256Bytes,
  sha256Hex,
} from "./sha256.js";
