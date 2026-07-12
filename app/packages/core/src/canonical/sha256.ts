/**
 * SHA-256 implementation and hashing utilities.
 *
 * Architecture note:
 *   Core must be runtime-agnostic (no node: imports, no WebCrypto dependency).
 *   Callers that have access to a fast native hasher should inject it via
 *   HashPort. The pure-TS fallback is always available so core logic can hash
 *   without any platform dependency.
 *
 * Exports:
 *   HashPort         — interface for injecting a native SHA-256 hasher
 *   Sha256Hash       — branded string type: "sha256:<64 hex chars>"
 *   sha256Bytes      — pure-TS SHA-256 → Uint8Array (32 bytes)
 *   sha256Hex        — sha256Bytes → lowercase hex string
 *   hexToSha256Hash  — attach "sha256:" prefix and brand the result
 *   hashBytes        — hash Uint8Array → Sha256Hash using injected or fallback
 *   hashCanonical    — canonical-serialize + hash a value → Sha256Hash
 *
 * @module
 */

import { canonicalJsonBytes } from "./jcs.js";

// ---------------------------------------------------------------------------
// Port interface (dependency-injection point for a native hasher)
// ---------------------------------------------------------------------------

/**
 * Minimal capability interface for a SHA-256 hasher.
 * Callers with Node crypto or WebCrypto available should inject an
 * implementation; the pure-TS fallback is used when none is provided.
 *
 * Note: this is intentionally synchronous. Async variants are out of scope
 * for core; workers/services can wrap async crypto and call core synchronously
 * after awaiting the hash value.
 */
export interface HashPort {
  /** Return the raw 32-byte SHA-256 digest of `bytes`. */
  sha256(bytes: Uint8Array): Uint8Array;
}

// ---------------------------------------------------------------------------
// Branded type
// ---------------------------------------------------------------------------

/** Opaque branded string — "sha256:<64 lowercase hex chars>". */
export type Sha256Hash = string & { readonly __brand: "Sha256Hash" };

// ---------------------------------------------------------------------------
// Pure-TS SHA-256 (FIPS 180-4)
// ---------------------------------------------------------------------------

// SHA-256 initial hash values (first 32 bits of fractional parts of sqrt of
// first 8 primes).
const H0 = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

// SHA-256 round constants (first 32 bits of fractional parts of cbrt of first
// 64 primes).
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Right-rotate a 32-bit integer. Works correctly in JS due to >>> 0. */
function rotr32(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

/**
 * Pure-TypeScript SHA-256 digest (FIPS 180-4).
 * Returns a 32-byte Uint8Array (big-endian).
 *
 * Tested against NIST FIPS 180-4 example vectors:
 *   - "" (empty)
 *   - "abc"
 *   - "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"
 *   - 1 000 000 × "a"
 */
export function sha256Bytes(input: Uint8Array): Uint8Array {
  const msgLen = input.length;

  // Pre-processing: padding to 512-bit (64-byte) block boundary.
  // Total padded length = ceil((msgLen + 9) / 64) * 64  (9 = 1 byte for 0x80 +
  // 8 bytes for 64-bit length)
  const paddedLen = Math.ceil((msgLen + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(input);
  padded[msgLen] = 0x80;
  // Write bit-length as a 64-bit big-endian integer in the last 8 bytes.
  // JS bitwise ops are 32-bit; split the 64-bit length into hi/lo 32-bit words.
  const bitLen = msgLen * 8;
  const bitLenHi = Math.floor(bitLen / 0x100000000); // high 32 bits
  const bitLenLo = bitLen >>> 0; // low 32 bits (safely mod 2^32)
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, bitLenHi, false); // big-endian
  view.setUint32(paddedLen - 4, bitLenLo, false); // big-endian

  // Initialize hash state.
  const h = new Uint32Array(H0); // copy; H0 is reused across calls

  // Work schedule buffer (64 words).
  const w = new Uint32Array(64);

  // Process each 512-bit (64-byte) block.
  for (let blockStart = 0; blockStart < paddedLen; blockStart += 64) {
    // Prepare message schedule.
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(blockStart + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      // w[i] is always defined because the Uint32Array has 64 elements
      // and we read indices 2..15 which are in range.
      const w15 = w[i - 15] as number;
      const w2 = w[i - 2] as number;
      const s0 =
        (rotr32(w15, 7) ^ rotr32(w15, 18) ^ (w15 >>> 3)) >>> 0;
      const s1 =
        (rotr32(w2, 17) ^ rotr32(w2, 19) ^ (w2 >>> 10)) >>> 0;
      w[i] =
        ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) >>> 0;
    }

    // Working variables.
    let a = h[0] as number;
    let b = h[1] as number;
    let c = h[2] as number;
    let d = h[3] as number;
    let e = h[4] as number;
    let f = h[5] as number;
    let g = h[6] as number;
    let hh = h[7] as number;

    // 64 rounds.
    for (let i = 0; i < 64; i++) {
      const S1 = (rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 =
        (hh + S1 + ch + (K[i] as number) + (w[i] as number)) >>> 0;
      const S0 = (rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (S0 + maj) >>> 0;

      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    // Add compressed chunk to the current hash value.
    h[0] = (h[0] as number + a) >>> 0;
    h[1] = (h[1] as number + b) >>> 0;
    h[2] = (h[2] as number + c) >>> 0;
    h[3] = (h[3] as number + d) >>> 0;
    h[4] = (h[4] as number + e) >>> 0;
    h[5] = (h[5] as number + f) >>> 0;
    h[6] = (h[6] as number + g) >>> 0;
    h[7] = (h[7] as number + hh) >>> 0;
  }

  // Produce the final 32-byte digest.
  const digest = new Uint8Array(32);
  const digestView = new DataView(digest.buffer);
  for (let i = 0; i < 8; i++) {
    digestView.setUint32(i * 4, h[i] as number, false); // big-endian
  }
  return digest;
}

// ---------------------------------------------------------------------------
// Hex / branded-string helpers
// ---------------------------------------------------------------------------

const HEX_CHARS = "0123456789abcdef";

/**
 * Convert a Uint8Array to a lowercase hex string (no prefix).
 * Uses a lookup table for performance.
 */
export function bytesToHex(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) {
    // byte is always 0–255 from a Uint8Array; both index accesses are safe.
    result +=
      (HEX_CHARS[byte >> 4] as string) + (HEX_CHARS[byte & 0xf] as string);
  }
  return result;
}

/**
 * Compute SHA-256 of a byte array and return the lowercase hex string
 * (no prefix).
 */
export function sha256Hex(input: Uint8Array): string {
  return bytesToHex(sha256Bytes(input));
}

/**
 * Attach the "sha256:" prefix and brand a hex string as Sha256Hash.
 * Does NOT validate that `hex` is exactly 64 lowercase hex chars.
 * Use only with output from sha256Hex / bytesToHex.
 */
export function hexToSha256Hash(hex: string): Sha256Hash {
  return ("sha256:" + hex) as Sha256Hash;
}

// ---------------------------------------------------------------------------
// High-level hash helpers
// ---------------------------------------------------------------------------

/**
 * Hash a Uint8Array → Sha256Hash using the provided HashPort, or the
 * pure-TS fallback if no port is supplied.
 *
 * The result string has the form "sha256:<64 lowercase hex chars>".
 */
export function hashBytes(
  input: Uint8Array,
  port?: HashPort,
): Sha256Hash {
  const rawDigest = port !== undefined ? port.sha256(input) : sha256Bytes(input);
  return hexToSha256Hash(bytesToHex(rawDigest));
}

/**
 * Canonical-serialize a value to RFC 8785 JSON bytes, then hash with SHA-256.
 *
 * The result is a Sha256Hash: "sha256:<64 lowercase hex chars>".
 *
 * This is the core primitive used by canonicalRevisionToken, renderInputHash,
 * and readinessInputHash computations.
 *
 * Key-insertion-order stability: because canonicalStringify sorts object keys
 * before serializing, two objects with the same keys/values but different
 * insertion orders produce the same hash.
 *
 * @throws {TypeError} for non-finite numbers, undefined, BigInt, or functions
 *   (same conditions as canonicalStringify).
 */
export function hashCanonical(value: unknown, port?: HashPort): Sha256Hash {
  const bytes = canonicalJsonBytes(value);
  return hashBytes(bytes, port);
}
