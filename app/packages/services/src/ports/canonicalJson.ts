import { canonicalJsonBytes } from "@cbb/core";

export interface CanonicalJsonReadLimits {
  readonly maximumDepth?: number;
  readonly maximumStringBytes?: number;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function preflightJsonText(
  text: string,
  maximumDepth: number,
  maximumStringBytes: number,
): void {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let stringBytes = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index] as string;
    if (inString) {
      if (!escaped && character === '"') {
        inString = false;
        continue;
      }
      stringBytes += utf8BytesAt(text, index);
      if (stringBytes > maximumStringBytes) {
        throw new RangeError("Canonical JSON string exceeds its read limit");
      }
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      stringBytes = 0;
    } else if (character === "{" || character === "[") {
      if (++depth > maximumDepth) {
        throw new RangeError("Canonical JSON nesting exceeds its read limit");
      }
    } else if (character === "}" || character === "]") {
      depth--;
      if (depth < 0) throw new SyntaxError("Canonical JSON delimiters are unbalanced");
    }
  }
  if (inString || escaped || depth !== 0) {
    throw new SyntaxError("Canonical JSON text is incomplete");
  }
}

function utf8BytesAt(text: string, index: number): number {
  const code = text.charCodeAt(index);
  if (code <= 0x7f) return 1;
  if (code <= 0x7ff) return 2;
  if (code >= 0xd800 && code <= 0xdbff) {
    const low = text.charCodeAt(index + 1);
    return low >= 0xdc00 && low <= 0xdfff ? 4 : 3;
  }
  if (code >= 0xdc00 && code <= 0xdfff) {
    const high = text.charCodeAt(index - 1);
    if (high >= 0xd800 && high <= 0xdbff) return 0;
  }
  return 3;
}

/**
 * Decode app-owned persisted JSON only when its bytes are the unique canonical
 * encoding. The exact round trip rejects duplicate keys, alternate number
 * spellings, hidden whitespace, and ambiguous key ordering before the value is
 * trusted by a schema.
 */
export function decodeCanonicalJson(
  bytes: Uint8Array,
  limits: CanonicalJsonReadLimits = {},
): unknown {
  const maximumDepth = limits.maximumDepth ?? 64;
  const maximumStringBytes = limits.maximumStringBytes ?? 1_048_576;
  if (
    !Number.isSafeInteger(maximumDepth) || maximumDepth < 1 ||
    !Number.isSafeInteger(maximumStringBytes) || maximumStringBytes < 1
  ) {
    throw new RangeError("Canonical JSON read limits are invalid");
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  preflightJsonText(text, maximumDepth, maximumStringBytes);
  const value = JSON.parse(text) as unknown;
  if (!equalBytes(bytes, canonicalJsonBytes(value))) {
    throw new SyntaxError("Persisted JSON is not in its unique canonical form");
  }
  return value;
}
