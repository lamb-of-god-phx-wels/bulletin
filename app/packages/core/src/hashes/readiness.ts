import type { HashPort } from "../canonical/index.js";
import { canonicalStringify, hashCanonical } from "../canonical/index.js";
import type {
  DocumentReadinessProjection,
  HashJsonObject,
  HashJsonValue,
  ReadinessEvidenceKind,
  ReadinessEvidenceRecord,
  ReadinessEvidenceStatus,
  ReadinessHashInput,
  ReadinessInputHash,
  ReadinessProfileId,
} from "./types.js";
import {
  assertExactKeys,
  assertHashJson,
  assertNamedHashes,
  assertNonemptyString,
  assertPlainObject,
  assertSha256,
  cloneHashJson,
  compareUtf16,
  HashInputError,
} from "./validation.js";

const PROFILE_IDS = new Set<ReadinessProfileId>([
  "draft",
  "printFinal",
  "accessibleFinal",
]);
const EVIDENCE_KINDS = new Set<ReadinessEvidenceKind>([
  "dependencyValidation",
  "privateWorkAcknowledgement",
  "scriptureImportReview",
  "rightsFinding",
  "rightsAssociationReview",
  "generatedRightsCoverage",
  "publicationLicenseEvaluation",
  "usagePolicyEvaluation",
  "pageCountEvaluation",
  "warningAcknowledgement",
  "accessibilityValidation",
]);
const EVIDENCE_STATUSES = new Set<ReadinessEvidenceStatus>([
  "pass",
  "warning",
  "block",
  "acknowledged",
  "notApplicable",
]);

function recordAt(value: unknown, path: string): Record<string, unknown> {
  assertPlainObject(value, path);
  return value;
}

function normalizeProfile(value: unknown): HashJsonObject {
  const path = "$readiness.profile";
  const profile = recordAt(value, path);
  assertExactKeys(profile, path, ["profileId", "version", "rulesHash"], [
    "profileId",
    "version",
    "rulesHash",
  ]);
  if (typeof profile["profileId"] !== "string" || !PROFILE_IDS.has(profile["profileId"] as ReadinessProfileId)) {
    throw new HashInputError(`${path}.profileId`, "unknown readiness profile");
  }
  assertNonemptyString(profile["version"], `${path}.version`);
  assertSha256(profile["rulesHash"], `${path}.rulesHash`);
  return {
    profileId: profile["profileId"],
    version: profile["version"],
    rulesHash: profile["rulesHash"],
  };
}

function normalizePublicationContexts(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HashInputError(
      "$readiness.projection.publicationContexts",
      "expected a nonempty array",
    );
  }
  const seen = new Set<string>();
  const output: string[] = [];
  for (let index = 0; index < value.length; index++) {
    const context = value[index];
    if (
      context !== "printedNonsalableChurchBulletin" &&
      context !== "digitalNonsalableChurchBulletin"
    ) {
      throw new HashInputError(
        `$readiness.projection.publicationContexts[${index}]`,
        "unknown publication context",
      );
    }
    if (seen.has(context)) {
      throw new HashInputError(
        `$readiness.projection.publicationContexts[${index}]`,
        `duplicate publication context ${context}`,
      );
    }
    seen.add(context);
    output.push(context);
  }
  return output.sort(compareUtf16);
}

function requireArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new HashInputError(path, "expected an array");
  return value;
}

function normalizeProjection(value: DocumentReadinessProjection): HashJsonObject {
  const path = "$readiness.projection";
  const projection = recordAt(value, path);
  const keys = [
    "metadataContext",
    "rightsPolicy",
    "publicationContexts",
    "fieldReview",
    "fieldReviewContexts",
    "contentReview",
    "contentReviewContexts",
    "pageChecks",
    "weeklyReviews",
    "rightsRecords",
    "rightsAssociations",
    "scriptureImports",
  ] as const;
  assertExactKeys(projection, path, keys, keys);
  for (const arrayKey of [
    "fieldReview",
    "fieldReviewContexts",
    "contentReview",
    "contentReviewContexts",
    "weeklyReviews",
    "rightsRecords",
    "rightsAssociations",
    "scriptureImports",
  ] as const) {
    requireArray(projection[arrayKey], `${path}.${arrayKey}`);
  }
  const cloned = cloneHashJson(projection, path, false) as Record<string, HashJsonValue>;
  cloned["publicationContexts"] = normalizePublicationContexts(
    projection["publicationContexts"],
  );
  assertNamedHashes(cloned, path);
  return cloned;
}

function normalizeEvidence(
  evidence: readonly ReadinessEvidenceRecord[],
): readonly HashJsonObject[] {
  if (!Array.isArray(evidence)) {
    throw new HashInputError("$readiness.evidence", "expected an array");
  }
  const byIdentity = new Map<string, HashJsonObject>();
  for (let index = 0; index < evidence.length; index++) {
    const path = `$readiness.evidence[${index}]`;
    const record = recordAt(evidence[index], path);
    assertExactKeys(record, path, ["kind", "subject", "status", "evidenceHash"], [
      "kind",
      "subject",
      "status",
      "evidenceHash",
    ]);
    if (typeof record["kind"] !== "string" || !EVIDENCE_KINDS.has(record["kind"] as ReadinessEvidenceKind)) {
      throw new HashInputError(`${path}.kind`, "unknown readiness evidence kind");
    }
    assertNonemptyString(record["subject"], `${path}.subject`);
    if (
      typeof record["status"] !== "string" ||
      !EVIDENCE_STATUSES.has(record["status"] as ReadinessEvidenceStatus)
    ) {
      throw new HashInputError(`${path}.status`, "unknown readiness evidence status");
    }
    assertSha256(record["evidenceHash"], `${path}.evidenceHash`);
    const normalized: HashJsonObject = {
      kind: record["kind"],
      subject: record["subject"],
      status: record["status"],
      evidenceHash: record["evidenceHash"],
    };
    const identity = `${record["kind"]}\u0000${record["subject"]}`;
    const prior = byIdentity.get(identity);
    if (prior !== undefined && canonicalStringify(prior) !== canonicalStringify(normalized)) {
      throw new HashInputError(
        path,
        `conflicting readiness evidence for ${record["kind"]}:${record["subject"]}`,
      );
    }
    byIdentity.set(identity, normalized);
  }
  return [...byIdentity.values()].sort((a, b) => {
    const kindOrder = compareUtf16(a["kind"] as string, b["kind"] as string);
    return kindOrder !== 0
      ? kindOrder
      : compareUtf16(a["subject"] as string, b["subject"] as string);
  });
}

/** Hash current readiness inputs without invalidating reusable PDF bytes. */
export function readinessInputHash(
  input: ReadinessHashInput,
  hashPort?: HashPort,
): ReadinessInputHash {
  assertHashJson(input, "$readiness");
  const record = recordAt(input, "$readiness");
  assertExactKeys(
    record,
    "$readiness",
    ["renderInputHash", "profile", "projection", "evidence"],
    ["renderInputHash", "profile", "projection", "evidence"],
  );
  assertSha256(record["renderInputHash"], "$readiness.renderInputHash");

  return hashCanonical(
    {
      format: "cbb-readiness-input-v1",
      renderInputHash: record["renderInputHash"],
      profile: normalizeProfile(record["profile"]),
      projection: normalizeProjection(input.projection),
      evidence: normalizeEvidence(input.evidence),
    },
    hashPort,
  );
}
