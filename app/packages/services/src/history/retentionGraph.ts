/**
 * Deterministic retention reachability shared by history, Trash, resource
 * cleanup, artifact cleanup, and backup closure projection.
 *
 * Callers provide semantic identities, never filesystem paths. A deletion is
 * legal only when a node is unreachable from every durable root and temporary
 * pin. Reference counting is intentionally not used because cycles and shared
 * immutable revisions are valid.
 */

export type RetentionNodeKind =
  | "document"
  | "weeklyWork"
  | "assetRevision"
  | "fontRevision"
  | "songRevision"
  | "scriptureRevision"
  | "resourcePack"
  | "packDraft"
  | "historySnapshot"
  | "trashRecord"
  | "artifact"
  | "approval"
  | "conflict"
  | "recoverySnapshot"
  | "backupTransaction"
  | "other";

export interface RetentionNode {
  readonly id: string;
  readonly kind: RetentionNodeKind;
  readonly byteSize: number;
}

export type RetentionReferenceKind =
  | "documentDependency"
  | "snapshotDependency"
  | "artifactEvidence"
  | "artifactParent"
  | "packMembership"
  | "trashDependency"
  | "conflictEvidence"
  | "approvalEvidence"
  | "weeklyWorkOwner"
  | "transactionPin"
  | "other";

export interface RetentionReference {
  /** The retaining owner. */
  readonly from: string;
  /** The immutable dependency retained by the owner. */
  readonly to: string;
  readonly kind: RetentionReferenceKind;
}

export type RetentionRootReason =
  | "activeWorkspaceResource"
  | "installedOrStagedPack"
  | "packDraft"
  | "history"
  | "trash"
  | "approvalOrExport"
  | "conflictOrRecovery"
  | "retainedArtifact"
  | "activeBuild"
  | "activeBackupOrRestore"
  | "userPin";

export interface RetentionRoot {
  readonly nodeId: string;
  readonly reason: RetentionRootReason;
}

export interface RetentionGraphInput {
  readonly nodes: readonly RetentionNode[];
  readonly references: readonly RetentionReference[];
  readonly roots: readonly RetentionRoot[];
}

export interface RetentionPathStep {
  readonly from: string;
  readonly to: string;
  readonly kind: RetentionReferenceKind;
}

export interface RetentionExplanation {
  readonly root: RetentionRoot;
  readonly path: readonly RetentionPathStep[];
}

export interface RetentionPlan {
  readonly retained: readonly RetentionNode[];
  readonly deletable: readonly RetentionNode[];
  readonly retainedByteSize: number;
  readonly deletableByteSize: number;
  readonly explanations: Readonly<Record<string, RetentionExplanation>>;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareNodes(left: RetentionNode, right: RetentionNode): number {
  return compareText(left.id, right.id) || compareText(left.kind, right.kind);
}

function compareRoots(left: RetentionRoot, right: RetentionRoot): number {
  return compareText(left.nodeId, right.nodeId) || compareText(left.reason, right.reason);
}

function compareReferences(
  left: RetentionReference,
  right: RetentionReference,
): number {
  return (
    compareText(left.from, right.from) ||
    compareText(left.to, right.to) ||
    compareText(left.kind, right.kind)
  );
}

function addSize(total: number, value: number): number {
  const result = total + value;
  if (!Number.isSafeInteger(result)) {
    throw new RangeError("Retention graph byte total exceeds the safe integer range");
  }
  return result;
}

function validateNode(node: RetentionNode): void {
  if (node.id.length === 0 || /[\u0000-\u001f\u007f-\u009f]/.test(node.id)) {
    throw new TypeError("Retention node ids must be nonempty control-free identities");
  }
  if (!Number.isSafeInteger(node.byteSize) || node.byteSize < 0) {
    throw new TypeError(`Invalid byteSize for retention node ${node.id}`);
  }
}

/** Build the complete deterministic cleanup/backup projection. */
export function computeRetentionPlan(input: RetentionGraphInput): RetentionPlan {
  const nodes = [...input.nodes].sort(compareNodes);
  const byId = new Map<string, RetentionNode>();
  for (const node of nodes) {
    validateNode(node);
    if (byId.has(node.id)) {
      throw new TypeError(`Duplicate retention node ${node.id}`);
    }
    byId.set(node.id, node);
  }

  const references = [...input.references].sort(compareReferences);
  const adjacency = new Map<string, RetentionReference[]>();
  const referenceKeys = new Set<string>();
  for (const reference of references) {
    if (!byId.has(reference.from) || !byId.has(reference.to)) {
      throw new TypeError(
        `Retention reference ${reference.from} -> ${reference.to} has a missing endpoint`,
      );
    }
    const key = `${reference.from}\u0000${reference.to}\u0000${reference.kind}`;
    if (referenceKeys.has(key)) {
      throw new TypeError(`Duplicate retention reference ${reference.from} -> ${reference.to}`);
    }
    referenceKeys.add(key);
    const outgoing = adjacency.get(reference.from) ?? [];
    outgoing.push(reference);
    adjacency.set(reference.from, outgoing);
  }

  const roots = [...input.roots].sort(compareRoots);
  const rootKeys = new Set<string>();
  for (const root of roots) {
    if (!byId.has(root.nodeId)) {
      throw new TypeError(`Retention root ${root.nodeId} does not exist`);
    }
    const key = `${root.nodeId}\u0000${root.reason}`;
    if (rootKeys.has(key)) {
      throw new TypeError(`Duplicate retention root ${root.nodeId}/${root.reason}`);
    }
    rootKeys.add(key);
  }

  const explanations = new Map<string, RetentionExplanation>();
  const queue: string[] = [];
  for (const root of roots) {
    if (!explanations.has(root.nodeId)) {
      explanations.set(root.nodeId, { root, path: [] });
      queue.push(root.nodeId);
    }
  }
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    if (current === undefined) continue;
    const explanation = explanations.get(current);
    if (explanation === undefined) continue;
    for (const reference of adjacency.get(current) ?? []) {
      if (explanations.has(reference.to)) continue;
      explanations.set(reference.to, {
        root: explanation.root,
        path: [
          ...explanation.path,
          { from: reference.from, to: reference.to, kind: reference.kind },
        ],
      });
      queue.push(reference.to);
    }
  }

  const retained: RetentionNode[] = [];
  const deletable: RetentionNode[] = [];
  let retainedByteSize = 0;
  let deletableByteSize = 0;
  for (const node of nodes) {
    if (explanations.has(node.id)) {
      retained.push(node);
      retainedByteSize = addSize(retainedByteSize, node.byteSize);
    } else {
      deletable.push(node);
      deletableByteSize = addSize(deletableByteSize, node.byteSize);
    }
  }

  return {
    retained,
    deletable,
    retainedByteSize,
    deletableByteSize,
    explanations: Object.fromEntries(
      [...explanations.entries()].sort(([left], [right]) => compareText(left, right)),
    ),
  };
}

/** Explain why an immutable revision may not be removed. */
export function deletionBlocker(
  plan: RetentionPlan,
  nodeId: string,
): RetentionExplanation | undefined {
  return plan.explanations[nodeId];
}
