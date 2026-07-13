import { typstStringLiteral } from "./escape.js";

/** Cannot collide with a persisted/resolved node id (those never contain `$` or `:`). */
export const INTENTIONAL_BLANK_NAVIGATION_RESOLVED_ID =
  "$cbb:intentional-blank" as const;

export function isIntentionalBlankNavigationResolvedId(value: string): boolean {
  return value === INTENTIONAL_BLANK_NAVIGATION_RESOLVED_ID;
}

export type SourceRegion = "body" | "page-background" | "page-foreground";

export interface TypstSourceMapEntry {
  readonly resolvedId: string;
  readonly sourceElementId: string;
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
    sourceElementId: string,
    region: SourceRegion,
    emit: (builder: TypstSourceBuilder) => void,
    includeNavigationMarker = true,
  ): void {
    const startByte = this.#byteOffset;
    const startLine = this.#line;
    if (includeNavigationMarker) {
      this.navigationMarker(resolvedId, sourceElementId, region);
    }
    emit(this);
    this.#entries.push({
      resolvedId,
      sourceElementId,
      region,
      startByte,
      endByte: this.#byteOffset,
      startLine,
      endLine: this.#line,
    });
  }

  /**
   * Emit invisible, queryable layout metadata. A trusted post-compile Typst
   * query turns these identities into physical PDF page locations.
   */
  navigationMarker(
    resolvedId: string,
    sourceElementId: string,
    region: SourceRegion,
  ): void {
    this.append(
      `#metadata((resolvedId: ${typstStringLiteral(resolvedId)}, sourceElementId: ${typstStringLiteral(sourceElementId)}, region: ${typstStringLiteral(region)})) <cbb-source>\n`,
    );
  }

  build(): { readonly source: string; readonly sourceMap: TypstSourceMap } {
    return {
      source: this.#parts.join(""),
      sourceMap: { version: 1, entries: [...this.#entries] },
    };
  }
}
