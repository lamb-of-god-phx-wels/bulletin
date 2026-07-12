import type { HashPort } from "../canonical/index.js";
import { hashCanonical } from "../canonical/index.js";
import type { FieldContract } from "../document/types.js";
import type {
  CanonicalRevisionToken,
  FieldContractHash,
  HashJsonValue,
} from "./types.js";
import { assertHashJson, cloneHashJson, HashInputError } from "./validation.js";

/**
 * Hash complete, already-normalized portable document JSON.
 *
 * Normalization/migration is intentionally not performed here: callers must
 * pass the same normalized snapshot that persistence will write.
 */
export function canonicalRevisionToken(
  normalizedDocument: unknown,
  hashPort?: HashPort,
): CanonicalRevisionToken {
  assertHashJson(normalizedDocument, "$document");
  return hashCanonical(normalizedDocument, hashPort);
}

/**
 * Hash a field contract while excluding its self-referential contractHash.
 */
export function fieldContractHash(
  contract: FieldContract,
  hashPort?: HashPort,
): FieldContractHash {
  assertHashJson(contract, "$contract");
  if (contract === null || typeof contract !== "object" || Array.isArray(contract)) {
    throw new HashInputError("$contract", "expected a field contract object");
  }

  const projected: Record<string, HashJsonValue> = {};
  for (const key of Object.keys(contract)) {
    if (key === "contractHash") continue;
    projected[key] = cloneHashJson(
      (contract as unknown as Record<string, unknown>)[key],
      `$contract.${key}`,
      false,
    );
  }
  return hashCanonical(projected, hashPort);
}
