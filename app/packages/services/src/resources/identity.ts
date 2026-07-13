import { hashCanonical, type Sha256Hash } from "@cbb/core";
import type { VerifiedResourceClosure } from "./types.js";

/**
 * Bind projection-time render provenance to the exact aliases and immutable
 * byte identities later staged by the runner. Workspace-local locators and
 * warnings are intentionally excluded from output identity.
 */
export function resourceClosureExecutionHash(
  closure: VerifiedResourceClosure,
): Sha256Hash {
  return hashCanonical({
    assets: closure.assets,
    fonts: closure.fonts,
    assetBindings: closure.assetBindings,
    fontBindings: closure.fontBindings,
    stagingEntries: closure.stagingEntries.map((entry) => entry.kind === "asset"
      ? {
          kind: entry.kind,
          assetRef: entry.assetRef,
          relativePath: entry.relativePath,
          hash: entry.hash,
          byteSize: entry.byteSize,
          mediaType: entry.mediaType,
          ...(entry.canonicalRasterDimensions === undefined
            ? {}
            : { canonicalRasterDimensions: entry.canonicalRasterDimensions }),
        }
      : {
          kind: entry.kind,
          fontRef: entry.fontRef,
          faceId: entry.faceId,
          relativePath: entry.relativePath,
          hash: entry.hash,
          byteSize: entry.byteSize,
          format: entry.format,
        }),
    totals: closure.totals,
  }) as Sha256Hash;
}
