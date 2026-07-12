import type { HashPort, Sha256Hash } from "@cbb/core";
import { hashCanonical } from "@cbb/core";
import type { ManagedFontFaceRecord } from "./types.js";

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sortedAxes(
  axes: Readonly<Record<string, number>> | undefined,
): Readonly<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const key of Object.keys(axes ?? {}).sort(compareText)) {
    const value = axes?.[key];
    if (value !== undefined) result[key] = value;
  }
  return result;
}

/**
 * The exact closed projection hashed for a managed font-family revision.
 * Display names, license policy, validation provenance, and local identity are
 * intentionally absent.
 */
export function fontFamilyDigestProjection(
  faces: readonly ManagedFontFaceRecord[],
): readonly unknown[] {
  return [...faces]
    .sort((left, right) => compareText(left.faceId, right.faceId))
    .map((face) => [
      face.faceId,
      face.faceIndex,
      face.format,
      face.weight,
      face.style,
      face.stretch,
      sortedAxes(face.variableAxisCoordinates),
      face.hash,
      face.byteSize,
    ]);
}

/** RFC 8785 + SHA-256 family digest defined by the Font Identity contract. */
export function computeFontFamilyDigest(
  faces: readonly ManagedFontFaceRecord[],
  hashPort?: HashPort,
): Sha256Hash {
  return hashCanonical(fontFamilyDigestProjection(faces), hashPort);
}
