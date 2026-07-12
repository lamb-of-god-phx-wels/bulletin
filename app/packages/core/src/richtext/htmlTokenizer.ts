/**
 * Minimal, bounded HTML tokenizer for clipboard sanitization.
 *
 * Design constraints (spec §"Text" lines 2328-2333):
 *  - No DOM dependency — runtime-agnostic (no document.createElement etc.).
 *  - Strictly bounded: reject inputs over MAX_HTML_BYTES.
 *  - Only produces tokens needed to build the allowed-vocabulary AST.
 *  - Unknown tags → their text content is retained (spec: "readable descendant
 *    text retained when safe").
 *  - Scripts, styles, and event handlers: removed including content.
 *
 * This is an intentionally simple tokenizer — it handles well-formed clipboard
 * HTML from browsers, not arbitrary adversarial markup. Its safety comes from
 * the allowlist-driven consumer in sanitize.ts, not from HTML completeness.
 */

/** Maximum UTF-8 encoded byte length accepted. Clipboard pastes are not large documents. */
export const MAX_HTML_BYTES = 512 * 1024; // 512 KiB

export type HtmlToken =
  | { kind: "openTag"; tag: string; attrs: Map<string, string>; selfClose: boolean }
  | { kind: "closeTag"; tag: string }
  | { kind: "text"; raw: string }
  | { kind: "doctype" }
  | { kind: "comment" };

export class HtmlSizeError extends Error {
  constructor(bytes: number) {
    super(
      `HTML input too large: ${bytes} bytes (limit ${MAX_HTML_BYTES} bytes)`,
    );
    this.name = "HtmlSizeError";
  }
}

/**
 * Count UTF-8 encoded bytes for a string without allocating a Buffer/TextEncoder.
 * This matches what the byte-limit guard enforces.
 */
function utf8ByteLength(s: string): number {
  let count = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x80) {
      count += 1;
    } else if (code < 0x800) {
      count += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate — the pair encodes a supplementary character (4 bytes),
      // but consume the low surrogate here so we don't double-count.
      count += 4;
      i++; // skip low surrogate
    } else {
      count += 3;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Attribute parser
// ---------------------------------------------------------------------------

/**
 * Parse the attribute string of an open tag into a Map.
 * Values are HTML-decoded minimally (just `&amp;`, `&lt;`, `&gt;`, `&quot;`,
 * `&#39;`, `&apos;`).
 */
function parseAttrs(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  // Regex: name, optional =, optional quoted/unquoted value.
  // We keep this simple: clipboard HTML is machine-generated and well-formed.
  const attrRe = /([A-Za-z][A-Za-z0-9:_-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]*)))?/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(raw)) !== null) {
    const name = (m[1] ?? "").toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? "";
    map.set(name, htmlDecodeAttr(value));
  }
  return map;
}

/**
 * Decode HTML entities in attribute values.
 *
 * Single-pass replacement: numeric entities and named non-ampersand entities
 * are decoded before &amp; — this prevents double-decoding:
 * '&amp;lt;' → '&lt;' (literal), not '<'.
 */
/** Map a numeric code point to a string, replacing lone surrogates with U+FFFD. */
function safeFromCodePoint(cp: number): string {
  // Surrogate range 0xD800–0xDFFF cannot be encoded in UTF-8 and are invalid
  // as standalone characters; replace with the Unicode replacement character.
  if (cp >= 0xd800 && cp <= 0xdfff) return "�";
  if (cp <= 0 || cp > 0x10ffff) return "";
  return String.fromCodePoint(cp);
}

function htmlDecodeAttr(s: string): string {
  return s.replace(
    /&(?:#(\d+)|#x([0-9a-fA-F]+)|lt|gt|quot|apos|#39|amp);/g,
    (_match, dec: string | undefined, hex: string | undefined) => {
      if (dec !== undefined) {
        return safeFromCodePoint(parseInt(dec, 10));
      }
      if (hex !== undefined) {
        return safeFromCodePoint(parseInt(hex, 16));
      }
      const name = _match.slice(1, -1); // strip leading & and trailing ;
      if (name === "lt") return "<";
      if (name === "gt") return ">";
      if (name === "quot") return '"';
      if (name === "apos" || name === "#39") return "'";
      if (name === "amp") return "&";
      return _match;
    },
  );
}

// ---------------------------------------------------------------------------
// Text content decoder
// ---------------------------------------------------------------------------

/**
 * Decode HTML entities in text content (minimal set + numeric).
 *
 * Single-pass replacement: numeric entities and named non-ampersand entities
 * are decoded before &amp; — this prevents double-decoding:
 * '&amp;lt;' → '&lt;' (literal), not '<'.
 */
export function htmlDecodeText(s: string): string {
  return s.replace(
    /&(?:#(\d+)|#x([0-9a-fA-F]+)|nbsp|lt|gt|quot|apos|#39|amp);/g,
    (_match, dec: string | undefined, hex: string | undefined) => {
      if (dec !== undefined) {
        return safeFromCodePoint(parseInt(dec, 10));
      }
      if (hex !== undefined) {
        return safeFromCodePoint(parseInt(hex, 16));
      }
      const name = _match.slice(1, -1); // strip leading & and trailing ;
      if (name === "nbsp") return " ";
      if (name === "lt") return "<";
      if (name === "gt") return ">";
      if (name === "quot") return '"';
      if (name === "apos" || name === "#39") return "'";
      if (name === "amp") return "&";
      return _match;
    },
  );
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

/**
 * Tokenize `html` into a flat token stream.
 *
 * @throws {HtmlSizeError} when the UTF-8 encoded byte length of `html` exceeds
 *   MAX_HTML_BYTES.
 */
export function tokenize(html: string): HtmlToken[] {
  const byteLen = utf8ByteLength(html);
  if (byteLen > MAX_HTML_BYTES) {
    throw new HtmlSizeError(byteLen);
  }

  const tokens: HtmlToken[] = [];
  let pos = 0;

  while (pos < html.length) {
    const ltIdx = html.indexOf("<", pos);

    if (ltIdx === -1) {
      // Rest is text.
      const raw = html.slice(pos);
      if (raw.length > 0) tokens.push({ kind: "text", raw });
      break;
    }

    // Emit text before the tag.
    if (ltIdx > pos) {
      tokens.push({ kind: "text", raw: html.slice(pos, ltIdx) });
    }

    pos = ltIdx + 1; // skip '<'

    if (pos >= html.length) break;

    const ch = html[pos];

    // Comment: <!-- … -->
    if (html.startsWith("!--", pos)) {
      const end = html.indexOf("-->", pos + 3);
      if (end === -1) {
        pos = html.length;
      } else {
        pos = end + 3;
      }
      tokens.push({ kind: "comment" });
      continue;
    }

    // DOCTYPE
    if (ch === "!" || html.startsWith("!doctype", pos) || html.startsWith("!DOCTYPE", pos)) {
      const end = html.indexOf(">", pos);
      pos = end === -1 ? html.length : end + 1;
      tokens.push({ kind: "doctype" });
      continue;
    }

    // Close tag: </tag>
    if (ch === "/") {
      pos++; // skip '/'
      const end = html.indexOf(">", pos);
      if (end === -1) {
        pos = html.length;
        continue;
      }
      const tag = html.slice(pos, end).trim().toLowerCase();
      pos = end + 1;
      tokens.push({ kind: "closeTag", tag });
      continue;
    }

    // Open/self-closing tag: <tag ...> or <tag .../>
    const tagEnd = findTagEnd(html, pos);
    if (tagEnd === -1) {
      pos = html.length;
      continue;
    }

    const tagContent = html.slice(pos, tagEnd);
    pos = tagEnd + 1;

    const selfClose = tagContent.endsWith("/");
    const body = selfClose ? tagContent.slice(0, -1) : tagContent;

    // Split tag name from attributes.
    const spaceIdx = body.search(/[\s]/);
    let tagName: string;
    let attrStr: string;
    if (spaceIdx === -1) {
      tagName = body.toLowerCase().trim();
      attrStr = "";
    } else {
      tagName = body.slice(0, spaceIdx).toLowerCase().trim();
      attrStr = body.slice(spaceIdx);
    }

    if (tagName.length === 0) continue;

    tokens.push({
      kind: "openTag",
      tag: tagName,
      attrs: parseAttrs(attrStr),
      selfClose,
    });
  }

  return tokens;
}

/**
 * Find the `>` closing a tag, respecting quoted attribute values.
 * Returns the index of `>` or -1 if not found.
 */
function findTagEnd(html: string, start: number): number {
  let i = start;
  while (i < html.length) {
    const c = html[i];
    if (c === ">") return i;
    if (c === '"') {
      i++;
      while (i < html.length && html[i] !== '"') i++;
    } else if (c === "'") {
      i++;
      while (i < html.length && html[i] !== "'") i++;
    }
    i++;
  }
  return -1;
}
