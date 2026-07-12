/**
 * Encode untrusted text as a Typst string literal.
 *
 * The generator never places user text into markup mode. Every leaf is passed
 * through this function and then supplied to an app-owned Typst function such
 * as `text(...)`. Typst's string escape grammar uses `\u{...}` for scalar
 * escapes; printable Unicode is retained verbatim for readable golden output.
 */
export function typstStringLiteral(value: string): string {
  let output = '"';

  // Reject invalid scalar sequences instead of allowing TextEncoder to
  // replace them with U+FFFD after render identity has already been computed.
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError("Typst strings require well-formed Unicode");
      }
      index++;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new TypeError("Typst strings require well-formed Unicode");
    }
  }

  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;

    switch (character) {
      case '"':
        output += '\\"';
        break;
      case "\\":
        output += "\\\\";
        break;
      case "\n":
        output += "\\n";
        break;
      case "\r":
        output += "\\r";
        break;
      case "\t":
        output += "\\t";
        break;
      default:
        if (
          codePoint < 0x20 ||
          (codePoint >= 0x7f && codePoint <= 0x9f) ||
          codePoint === 0x2028 ||
          codePoint === 0x2029
        ) {
          output += `\\u{${codePoint.toString(16)}}`;
        } else {
          output += character;
        }
    }
  }

  return output + '"';
}

/**
 * Validate an app-controlled build-relative path before it is emitted into an
 * image call. Resolution from portable ids to paths occurs outside core.
 */
export function assertSafeBuildRelativePath(path: string): void {
  if (path.length === 0) {
    throw new TypeError("Typst asset path must not be empty");
  }
  if (path.includes("\\") || path.includes("\0")) {
    throw new TypeError("Typst asset path must use safe forward-slash segments");
  }
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    throw new TypeError("Typst asset path must be build-root relative");
  }

  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new TypeError("Typst asset path contains an unsafe segment");
  }
}
