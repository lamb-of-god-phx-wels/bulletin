import type { RenderProjection } from "../document/resolvedTypes.js";
import { parsePortableFontRef } from "../ids/index.js";

/**
 * Release-owned portable identities for the built-in fallback families.
 *
 * These ids make no claim about font bytes. The signed distribution manifest
 * and validated font records must supply the exact face hashes and bytes for
 * these revisions before a build can proceed.
 */
export const BUNDLED_NOTO_SANS_FONT_REF = parsePortableFontRef(
  "font:2d86a3b7-0e75-4af0-9449-8f3d6121c6a1",
);
export const BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF = parsePortableFontRef(
  "font:9f30b40a-d0d2-4fac-b5bb-fac7f5968d2e",
);

export const BUNDLED_NOTO_SANS_FAMILY = "Noto Sans" as const;
export const BUNDLED_NOTO_SANS_SYMBOLS_2_FAMILY =
  "Noto Sans Symbols 2" as const;

export const MANDATORY_BUNDLED_FONTS = Object.freeze([
  Object.freeze({
    fontRef: BUNDLED_NOTO_SANS_FONT_REF,
    familyName: BUNDLED_NOTO_SANS_FAMILY,
  }),
  Object.freeze({
    fontRef: BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF,
    familyName: BUNDLED_NOTO_SANS_SYMBOLS_2_FAMILY,
  }),
] as const);

export const MANDATORY_BUNDLED_FONT_REFS = Object.freeze(
  MANDATORY_BUNDLED_FONTS.map((font) => font.fontRef),
);

type FontFallbackProjection = Pick<
  RenderProjection,
  "fontFallbackRefs" | "referencedFonts"
>;

/** The mandatory revisions must occur exactly once, as the final fallbacks. */
export function hasMaterializedMandatoryBundledFonts(
  projection: FontFallbackProjection,
): boolean {
  const refs = projection.fontFallbackRefs;
  if (
    !Array.isArray(refs) ||
    new Set(refs).size !== refs.length ||
    refs.length < MANDATORY_BUNDLED_FONT_REFS.length
  ) {
    return false;
  }
  const referenced = projection.referencedFonts;
  if (!Array.isArray(referenced)) return false;
  const referencedRefs = referenced.map((entry) => entry.fontRef);
  if (new Set(referencedRefs).size !== referencedRefs.length) return false;
  if (refs.some((fontRef) => !referencedRefs.includes(fontRef))) return false;
  const mandatoryStart = refs.length - MANDATORY_BUNDLED_FONT_REFS.length;
  for (const [index, mandatoryRef] of MANDATORY_BUNDLED_FONT_REFS.entries()) {
    if (refs[mandatoryStart + index] !== mandatoryRef) return false;
    if (refs.indexOf(mandatoryRef) !== mandatoryStart + index) return false;
  }
  return true;
}

export function assertMaterializedMandatoryBundledFonts(
  projection: FontFallbackProjection,
  operation: string,
): void {
  if (!hasMaterializedMandatoryBundledFonts(projection)) {
    throw new TypeError(
      `${operation}: projection must end with the release-owned Noto Sans and Noto Sans Symbols 2 fallback refs`,
    );
  }
}
