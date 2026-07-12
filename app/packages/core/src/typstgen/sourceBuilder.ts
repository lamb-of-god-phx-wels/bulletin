export type SourceRegion = "body" | "page-background" | "page-foreground";

export interface TypstSourceMapEntry {
  readonly resolvedId: string;
  readonly region: SourceRegion;
  readonly startByte: number;
  readonly endByte: number;
  readonly startLine: number;
  readonly endLine: number;
}
export interface TypstSourceMap {
  readonly version: 1;
  readonly entries: readonly TypstSourceMapEntry[];
}

const encoder = new TextEncoder();

function countLineBreaks(value: string): number {
  let count = 0;
  for (let index = 0; index < value.length; index++) {
    if (value.charCodeAt(index) === 0x0a) count++;
  }
  return count;
}

/** Deterministic LF-only source accumulator with UTF-8 byte source spans. */
export class TypstSourceBuilder {
  readonly #parts: string[] = [];
  readonly #entries: TypstSourceMapEntry[] = [];
  #byteOffset = 0;
  #line = 1;

  append(source: string): void {
    if (source.includes("\r")) {
      throw new TypeError("Generated Typst source must use LF line endings");
    }
    this.#parts.push(source);
    this.#byteOffset += encoder.encode(source).byteLength;
    this.#line += countLineBreaks(source);
  }

  mapped(
    resolvedId: string,
    region: SourceRegion,
    emit: (builder: TypstSourceBuilder) => void
  ): void {
    const startByte = this.#byteOffset;
    const startLine = this.#line;
    emit(this);
    this.#entries.push({
      resolvedId,
      region,
      startByte,
      endByte: this.#byteOffset,
      startLine,
      endLine: this.#line,
    });
  }

  build(): { readonly source: string; readonly sourceMap: TypstSourceMap } {
    return {
      source: this.#parts.join(""),
      sourceMap: { version: 1, entries: [...this.#entries] },
    };
  }
}
