import { describe, expect, it } from "vitest";

import {
  computeRetentionPlan,
  deletionBlocker,
  type RetentionGraphInput,
} from "./retentionGraph.js";

describe("retention graph", () => {
  it("retains shared immutable dependencies by reachability, not reference counts", () => {
    const input: RetentionGraphInput = {
      nodes: [
        { id: "asset", kind: "assetRevision", byteSize: 10 },
        { id: "orphan", kind: "fontRevision", byteSize: 7 },
        { id: "doc-b", kind: "document", byteSize: 2 },
        { id: "doc-a", kind: "document", byteSize: 1 },
      ],
      references: [
        { from: "doc-b", to: "asset", kind: "documentDependency" },
        { from: "doc-a", to: "asset", kind: "documentDependency" },
      ],
      roots: [
        { nodeId: "doc-b", reason: "activeWorkspaceResource" },
        { nodeId: "doc-a", reason: "activeWorkspaceResource" },
      ],
    };
    const plan = computeRetentionPlan(input);
    expect(plan.retained.map((node) => node.id)).toEqual(["asset", "doc-a", "doc-b"]);
    expect(plan.deletable.map((node) => node.id)).toEqual(["orphan"]);
    expect(plan.retainedByteSize).toBe(13);
    expect(plan.deletableByteSize).toBe(7);
  });

  it("retains compile evidence through revalidation and composed artifact parents", () => {
    const plan = computeRetentionPlan({
      nodes: [
        { id: "compile", kind: "artifact", byteSize: 100 },
        { id: "compose", kind: "artifact", byteSize: 80 },
        { id: "revalidate", kind: "artifact", byteSize: 1 },
      ],
      references: [
        { from: "compose", to: "compile", kind: "artifactParent" },
        { from: "revalidate", to: "compose", kind: "artifactEvidence" },
      ],
      roots: [{ nodeId: "revalidate", reason: "retainedArtifact" }],
    });
    expect(plan.deletable).toEqual([]);
    expect(deletionBlocker(plan, "compile")).toEqual({
      root: { nodeId: "revalidate", reason: "retainedArtifact" },
      path: [
        { from: "revalidate", to: "compose", kind: "artifactEvidence" },
        { from: "compose", to: "compile", kind: "artifactParent" },
      ],
    });
  });

  it("handles cycles and active build/backup pins without looping", () => {
    const plan = computeRetentionPlan({
      nodes: [
        { id: "a", kind: "resourcePack", byteSize: 1 },
        { id: "b", kind: "assetRevision", byteSize: 1 },
        { id: "build-pin", kind: "other", byteSize: 0 },
        { id: "backup-pin", kind: "backupTransaction", byteSize: 0 },
      ],
      references: [
        { from: "a", to: "b", kind: "packMembership" },
        { from: "b", to: "a", kind: "other" },
        { from: "build-pin", to: "a", kind: "transactionPin" },
        { from: "backup-pin", to: "b", kind: "transactionPin" },
      ],
      roots: [
        { nodeId: "build-pin", reason: "activeBuild" },
        { nodeId: "backup-pin", reason: "activeBackupOrRestore" },
      ],
    });
    expect(plan.retained.map((node) => node.id)).toEqual([
      "a",
      "b",
      "backup-pin",
      "build-pin",
    ]);
  });

  it("is stable regardless of input order and chooses a deterministic root/path", () => {
    const forward = computeRetentionPlan({
      nodes: [
        { id: "z-root", kind: "document", byteSize: 1 },
        { id: "a-root", kind: "document", byteSize: 1 },
        { id: "shared", kind: "assetRevision", byteSize: 1 },
      ],
      references: [
        { from: "z-root", to: "shared", kind: "documentDependency" },
        { from: "a-root", to: "shared", kind: "documentDependency" },
      ],
      roots: [
        { nodeId: "z-root", reason: "activeWorkspaceResource" },
        { nodeId: "a-root", reason: "activeWorkspaceResource" },
      ],
    });
    const reverse = computeRetentionPlan({
      nodes: [...[
        { id: "z-root", kind: "document" as const, byteSize: 1 },
        { id: "a-root", kind: "document" as const, byteSize: 1 },
        { id: "shared", kind: "assetRevision" as const, byteSize: 1 },
      ]].reverse(),
      references: [...[
        { from: "z-root", to: "shared", kind: "documentDependency" as const },
        { from: "a-root", to: "shared", kind: "documentDependency" as const },
      ]].reverse(),
      roots: [...[
        { nodeId: "z-root", reason: "activeWorkspaceResource" as const },
        { nodeId: "a-root", reason: "activeWorkspaceResource" as const },
      ]].reverse(),
    });
    expect(reverse).toEqual(forward);
    expect(forward.explanations["shared"]?.root.nodeId).toBe("a-root");
  });

  it("fails closed for missing endpoints, duplicate identities, and unsafe sizes", () => {
    expect(() =>
      computeRetentionPlan({
        nodes: [{ id: "a", kind: "document", byteSize: 0 }],
        references: [{ from: "a", to: "missing", kind: "other" }],
        roots: [],
      }),
    ).toThrow(/missing endpoint/);
    expect(() =>
      computeRetentionPlan({
        nodes: [
          { id: "a", kind: "document", byteSize: 0 },
          { id: "a", kind: "artifact", byteSize: 0 },
        ],
        references: [],
        roots: [],
      }),
    ).toThrow(/Duplicate retention node/);
    expect(() =>
      computeRetentionPlan({
        nodes: [{ id: "a", kind: "document", byteSize: Number.MAX_SAFE_INTEGER + 1 }],
        references: [],
        roots: [],
      }),
    ).toThrow(/Invalid byteSize/);
  });
});
