import {
  hashCanonical,
  type NativeElement,
  type NodeId,
  type RightsCreditRefString,
} from "@cbb/core";

const FALLBACK_CREDIT_KEY = "credit:00000000-0000-4000-8000-000000000001";

function creditKeyForNode(nodeId: NodeId): RightsCreditRefString {
  const compact = nodeId.startsWith("n") ? nodeId.slice(1).toLowerCase() : "";
  if (!/^[0-9a-f]{32}$/u.test(compact)) return FALLBACK_CREDIT_KEY;
  return `credit:${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

/** Safe, explicit one-off starting point for the Structure Hymn/Song action. */
export function defaultMusicElement(id: NodeId): Extract<NativeElement, { type: "music" }> {
  const title = "New hymn or song";
  const richContent = {
    type: "document" as const,
    blocks: [{ type: "paragraph" as const, children: [] }],
  };
  const creditKey = creditKeyForNode(id);
  const rightsProjection = {
    component: "other" as const,
    status: "unknown" as const,
    workTitle: title,
    contributors: [],
    creditRequiredWhen: "never" as const,
  };
  const creditProjectionHash = hashCanonical(rightsProjection);
  const rights = [{ creditKey, creditProjectionHash, ...rightsProjection }];

  return {
    id,
    type: "music",
    name: "New hymn or song",
    data: {
      title,
      richContent,
      rights,
      rightsAssociationReview: {
        reviewedSongContentHash: hashCanonical({ title, richContent }),
        reviewedRightsProjectionHash: hashCanonical(
          rights.map((record) => ({
            creditKey: record.creditKey,
            creditProjectionHash: record.creditProjectionHash,
          })),
        ),
        reviewTime: "1970-01-01T00:00:00Z",
      },
    },
  };
}
