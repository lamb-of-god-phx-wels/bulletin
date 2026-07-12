import { canonicalStringify } from "../canonical/index.js";
import type {
  ResolvedRightsAttributionElement,
  ResolvedRightsContribution,
} from "../document/resolvedTypes.js";

export type RightsGroup = "scripture" | "music" | "other";

export interface GeneratedRightsEntry {
  readonly creditKey: string;
  readonly group: RightsGroup;
  /** Ordered, de-duplicated publication lines for this rights record. */
  readonly lines: readonly string[];
  /** LF-joined compatibility view consumed by the current Typst generator. */
  readonly line: string;
  readonly firstAppearance: number;
}

export interface RightsGenerationFinding {
  readonly code: "CBB-RIGHTS-0001" | "CBB-RIGHTS-0002";
  readonly severity: "error" | "warning";
  readonly creditKey: string;
  readonly message: string;
}

export interface GeneratedRightsBlock {
  readonly heading?: string;
  readonly introText?: string;
  readonly entries: readonly GeneratedRightsEntry[];
  readonly findings: readonly RightsGenerationFinding[];
}

function groupFor(contribution: ResolvedRightsContribution): RightsGroup {
  if (contribution.component === "scriptureTranslation") return "scripture";
  return contribution.component === "other" ? "other" : "music";
}

const COMPONENT_RANK: Readonly<Record<ResolvedRightsContribution["component"], number>> = {
  scriptureTranslation: 0,
  text: 1,
  translation: 2,
  tune: 3,
  arrangement: 4,
  setting: 5,
  recording: 6,
  other: 7,
};

function comparableProjection(contribution: ResolvedRightsContribution): string {
  // Appearance and applicability are derived from resolved traversal and are
  // not part of the persisted credit revision.
  return canonicalStringify({
    ...contribution,
    firstAppearance: 0,
    requiredCreditLineApplies: false,
  });
}

function appendUnique(lines: string[], seen: Set<string>, line: string): void {
  if (line.length === 0 || seen.has(line)) return;
  seen.add(line);
  lines.push(line);
}

/**
 * Generate the one derived Copyrights & Permissions block from active resolved
 * contributions. No editable/generated rows are persisted.
 */
export function generateRightsBlock(
  block: ResolvedRightsAttributionElement,
  contributions: readonly ResolvedRightsContribution[]
): GeneratedRightsBlock {
  const findings: RightsGenerationFinding[] = [];
  const firstByKey = new Map<string, ResolvedRightsContribution>();
  const uniqueByProjection = new Map<
    string,
    { readonly contribution: ResolvedRightsContribution; readonly index: number }
  >();

  for (const [index, contribution] of contributions.entries()) {
    const previous = firstByKey.get(contribution.creditKey);
    if (previous === undefined) {
      firstByKey.set(contribution.creditKey, contribution);
    } else if (
      previous.creditProjectionHash !== contribution.creditProjectionHash ||
      comparableProjection(previous) !== comparableProjection(contribution)
    ) {
      findings.push({
        code: "CBB-RIGHTS-0002",
        severity: "error",
        creditKey: contribution.creditKey,
        message: "Active content contains conflicting projections for one credit key.",
      });
    }

    // Only byte-equivalent credit revisions de-duplicate. A conflicting
    // same-key revision is invalid, but retaining its exact line in the
    // generated result avoids silently losing required publication text.
    const identity = `${contribution.creditKey}\u0000${contribution.creditProjectionHash}\u0000${comparableProjection(contribution)}`;
    const existing = uniqueByProjection.get(identity);
    if (existing === undefined) {
      uniqueByProjection.set(identity, { contribution, index });
    } else if (
      contribution.requiredCreditLineApplies &&
      !existing.contribution.requiredCreditLineApplies
    ) {
      // One credit revision can occur in multiple sources. The required line
      // applies if governed text renders in any occurrence, while ordering
      // remains anchored to the revision's first appearance.
      uniqueByProjection.set(identity, {
        contribution: {
          ...existing.contribution,
          requiredCreditLineApplies: true,
        },
        index: existing.index,
      });
    }
  }

  const includePublicDomainLines = block.data.includePublicDomainLines ?? false;
  const seenPublicationDisplays = new Set<string>();
  const sortableEntries: Array<{
    readonly component: ResolvedRightsContribution["component"];
    readonly entry: GeneratedRightsEntry;
  }> = [];
  for (const { contribution, index } of uniqueByProjection.values()) {
    const { creditKey } = contribution;
    const lines: string[] = [];
    const seenWithinRecord = new Set<string>();
    const requiredLines = !contribution.requiredCreditLineApplies
      ? []
      : contribution.requiredCreditLine?.split("\n") ?? [];
    if (contribution.requiredCreditLineApplies && requiredLines.length === 0) {
      findings.push({
        code: "CBB-RIGHTS-0001",
        severity: "error",
        creditKey,
        message: "An active required rights contribution has no required credit line.",
      });
    }
    for (const requiredLine of requiredLines) {
      appendUnique(lines, seenWithinRecord, requiredLine);
    }
    // Usage-policy disclosures and reviewed publication-license displays are
    // independent publication obligations. They remain active even when a
    // renderedText-gated required credit line does not apply to this source.
    if (contribution.usagePolicyDisclosureLine !== undefined) {
      appendUnique(lines, seenWithinRecord, contribution.usagePolicyDisclosureLine);
    }
    const publicationDisplay = contribution.publicationLicenseDisplay;
    if (publicationDisplay !== undefined) {
      const displayIdentity =
        `${publicationDisplay.displayLine}\u0000${publicationDisplay.sourceDisplayRevisionHash}`;
      if (!seenPublicationDisplays.has(displayIdentity)) {
        appendUnique(lines, seenWithinRecord, publicationDisplay.displayLine);
      }
      seenPublicationDisplays.add(displayIdentity);
    }
    if (
      lines.length === 0 &&
      includePublicDomainLines &&
      contribution.status === "publicDomain" &&
      contribution.workTitle !== undefined
    ) {
      appendUnique(
        lines,
        seenWithinRecord,
        `${contribution.workTitle} — Public domain.`,
      );
    }
    if (lines.length === 0) continue;
    sortableEntries.push({
      component: contribution.component,
      entry: {
        creditKey,
        group: groupFor(contribution),
        lines,
        line: lines.join("\n"),
        firstAppearance: contribution.firstAppearance ?? index,
      },
    });
  }

  const groupOrder = new Map<RightsGroup, number>(
    block.data.groupOrder.map((group, index) => [group, index])
  );
  sortableEntries.sort((left, right) => {
    const groupDelta =
      (groupOrder.get(left.entry.group) ?? Number.MAX_SAFE_INTEGER) -
      (groupOrder.get(right.entry.group) ?? Number.MAX_SAFE_INTEGER);
    if (groupDelta !== 0) return groupDelta;
    if (left.entry.firstAppearance !== right.entry.firstAppearance) {
      return left.entry.firstAppearance - right.entry.firstAppearance;
    }
    const componentDelta = COMPONENT_RANK[left.component] - COMPONENT_RANK[right.component];
    if (componentDelta !== 0) return componentDelta;
    if (left.entry.creditKey < right.entry.creditKey) return -1;
    if (left.entry.creditKey > right.entry.creditKey) return 1;
    return 0;
  });
  const entries = sortableEntries.map(({ entry }) => entry);

  return {
    ...(block.data.heading !== undefined ? { heading: block.data.heading } : {}),
    ...(block.data.introText !== undefined
      ? { introText: block.data.introText }
      : {}),
    entries,
    findings,
  };
}
