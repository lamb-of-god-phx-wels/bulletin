import {
  MANDATORY_BUNDLED_FONT_REFS,
  isPortableFontRef,
  type RenderProjection,
} from "@cbb/core";
import type { PortableFontRef } from "@cbb/core";

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Materialize release-owned bundled fallback revisions into the effective
 * build projection before resource resolution, hashing, and Typst generation.
 * This prevents mandatory fonts from appearing as unexplained surplus hash
 * inputs while keeping them out of portable document JSON.
 */
export function materializeMandatoryFontFallbacks(
  projection: RenderProjection,
): RenderProjection {
  const mandatory = new Set<string>(MANDATORY_BUNDLED_FONT_REFS);
  const fallbackRefs: PortableFontRef[] = [];
  const seenFallback = new Set<string>();
  for (const fontRef of projection.fontFallbackRefs) {
    if (!isPortableFontRef(fontRef)) {
      throw new TypeError("Projection contains an invalid fallback font ref");
    }
    if (!mandatory.has(fontRef) && !seenFallback.has(fontRef)) {
      fallbackRefs.push(fontRef);
      seenFallback.add(fontRef);
    }
  }
  fallbackRefs.push(...MANDATORY_BUNDLED_FONT_REFS);
  const referenced = new Set<string>();
  for (const entry of projection.referencedFonts) {
    if (!isPortableFontRef(entry.fontRef)) {
      throw new TypeError("Projection contains an invalid referenced font ref");
    }
    referenced.add(entry.fontRef);
  }
  for (const fontRef of fallbackRefs) referenced.add(fontRef);
  const referencedFonts = [...referenced]
    .sort(compareText)
    .map((fontRef) => ({ fontRef: fontRef as PortableFontRef }));
  return {
    ...projection,
    fontFallbackRefs: fallbackRefs,
    referencedFonts,
  };
}
