import {
  BUNDLED_NOTO_SANS_FAMILY,
  BUNDLED_NOTO_SANS_FONT_REF,
  BUNDLED_NOTO_SANS_SYMBOLS_2_FAMILY,
  BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF,
} from "@cbb/core";
import type { PortableFontRef } from "@cbb/core";
import {
  TrustedComponentError,
  type TrustedBundledFontFaceBinding,
  type TrustedComponentManifestEntry,
  type TrustedComponentRole,
  type VerifiedTrustedComponentManifest,
} from "./types.js";

export const CBB_TRUSTED_COMPONENT_APPLICATION_ID = "church-bulletin-builder" as const;
export const M3_TRUSTED_COMPONENT_RELEASE_PROFILE = "m3-v1" as const;

export const M3_REQUIRED_SINGLETON_COMPONENT_ROLES = Object.freeze([
  "executionBroker",
  "quarantineWorker",
  "typstCli",
  "typstRuntimeClosure",
  "pdfInspector",
  "pdfStructuralInspector",
  "pdfFlattener",
  "pdfRuntimeClosure",
  "bookletCompositor",
  "schemaCatalog",
  "localeData",
  "genericStarterSet",
] as const satisfies readonly TrustedComponentRole[]);

export const M3_OPTIONAL_SINGLETON_COMPONENT_ROLES = Object.freeze([
  "pdfUaValidator",
] as const satisfies readonly TrustedComponentRole[]);

function face(
  portableFontRef: PortableFontRef,
  familyName: string,
  faceId: string,
  weight: number,
  style: TrustedBundledFontFaceBinding["style"],
): TrustedBundledFontFaceBinding {
  return Object.freeze({
    portableFontRef,
    familyName,
    faceId,
    faceIndex: 0,
    format: "ttf",
    weight,
    style,
    stretch: 1,
  });
}

/** Exact static face matrix owned by the M3 release profile. */
export const M3_MANDATORY_BUNDLED_FONT_FACES = Object.freeze([
  face(BUNDLED_NOTO_SANS_FONT_REF, BUNDLED_NOTO_SANS_FAMILY, "regular", 400, "normal"),
  face(BUNDLED_NOTO_SANS_FONT_REF, BUNDLED_NOTO_SANS_FAMILY, "medium", 500, "normal"),
  face(BUNDLED_NOTO_SANS_FONT_REF, BUNDLED_NOTO_SANS_FAMILY, "semibold", 600, "normal"),
  face(BUNDLED_NOTO_SANS_FONT_REF, BUNDLED_NOTO_SANS_FAMILY, "bold", 700, "normal"),
  face(BUNDLED_NOTO_SANS_FONT_REF, BUNDLED_NOTO_SANS_FAMILY, "italic", 400, "italic"),
  face(BUNDLED_NOTO_SANS_FONT_REF, BUNDLED_NOTO_SANS_FAMILY, "mediumItalic", 500, "italic"),
  face(BUNDLED_NOTO_SANS_FONT_REF, BUNDLED_NOTO_SANS_FAMILY, "semiboldItalic", 600, "italic"),
  face(BUNDLED_NOTO_SANS_FONT_REF, BUNDLED_NOTO_SANS_FAMILY, "boldItalic", 700, "italic"),
  face(
    BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF,
    BUNDLED_NOTO_SANS_SYMBOLS_2_FAMILY,
    "regular",
    400,
    "normal",
  ),
]);

function bindingKey(binding: TrustedBundledFontFaceBinding): string {
  return `${binding.portableFontRef}\u0000${binding.faceId}`;
}

function sameBinding(
  left: TrustedBundledFontFaceBinding,
  right: TrustedBundledFontFaceBinding,
): boolean {
  return left.portableFontRef === right.portableFontRef &&
    left.familyName === right.familyName &&
    left.faceId === right.faceId &&
    left.faceIndex === right.faceIndex &&
    left.format === right.format &&
    left.weight === right.weight &&
    left.style === right.style &&
    left.stretch === right.stretch;
}

function fail(subject: string): never {
  throw new TrustedComponentError("requiredReleaseSet", undefined, subject);
}

/**
 * Assert the complete signed M3 application component profile.
 * PDF/UA validation remains staged, so pdfUaValidator is permitted but not
 * required. Extra bundled families are allowed, but the two built-in portable
 * revisions must contain exactly the release-owned static face matrix.
 */
export function assertRequiredM3ReleaseSet(
  manifest: VerifiedTrustedComponentManifest,
): void {
  if (
    manifest.release.applicationId !== CBB_TRUSTED_COMPONENT_APPLICATION_ID ||
    manifest.release.profile !== M3_TRUSTED_COMPONENT_RELEASE_PROFILE
  ) {
    fail("release");
  }
  for (const role of M3_REQUIRED_SINGLETON_COMPONENT_ROLES) {
    if (manifest.components.filter((entry) => entry.role === role).length !== 1) {
      fail(role);
    }
  }
  for (const role of M3_OPTIONAL_SINGLETON_COMPONENT_ROLES) {
    if (manifest.components.filter((entry) => entry.role === role).length > 1) {
      fail(role);
    }
  }

  const mandatoryRefs = new Set<string>([
    BUNDLED_NOTO_SANS_FONT_REF,
    BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF,
  ]);
  const expected = new Map(
    M3_MANDATORY_BUNDLED_FONT_FACES.map((binding) => [bindingKey(binding), binding]),
  );
  const observed = new Map<string, TrustedComponentManifestEntry>();
  for (const entry of manifest.components) {
    if (entry.role !== "bundledFontFace") continue;
    const binding = entry.fontFaceBinding;
    if (binding === undefined) fail(`${entry.role}:${entry.id}`);
    const key = bindingKey(binding);
    if (observed.has(key)) fail(key);
    observed.set(key, entry);
    if (mandatoryRefs.has(binding.portableFontRef)) {
      const required = expected.get(key);
      if (required === undefined || !sameBinding(required, binding)) fail(key);
    }
  }
  for (const [key, binding] of expected) {
    const entry = observed.get(key);
    if (entry?.fontFaceBinding === undefined || !sameBinding(binding, entry.fontFaceBinding)) {
      fail(key);
    }
  }
}
