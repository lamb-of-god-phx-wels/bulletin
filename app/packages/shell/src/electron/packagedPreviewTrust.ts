import type { Sha256Hash } from "@cbb/core";

/**
 * Release-build trust pin for `native/m3/trusted-component-trust.json`.
 *
 * Source/development builds intentionally ship without a pin or native bundle.
 * Release automation must replace this value at compile time with the SHA-256
 * of the separately generated trust file. The pin makes its expected release
 * identity and Ed25519 public keys application-owned rather than selectable by
 * the adjacent signed component manifest.
 */
export const M4_PACKAGED_M3_TRUST_FILE_HASH: Sha256Hash | undefined = undefined;
