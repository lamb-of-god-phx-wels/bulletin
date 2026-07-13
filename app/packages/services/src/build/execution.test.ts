import { describe, expect, it, vi } from "vitest";
import {
  BUNDLED_NOTO_SANS_FAMILY,
  BUNDLED_NOTO_SANS_FONT_REF,
  BUNDLED_NOTO_SANS_SYMBOLS_2_FAMILY,
  BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF,
  hashBytes,
  hexToSha256Hash,
  parseLocalResourceId,
} from "@cbb/core";
import type { VerifiedResourceClosure } from "../resources/index.js";
import {
  IsolatedBuildExecution,
  type BuildQueueHash,
  type OrchestratedRunnerRequest,
} from "./index.js";
import type {
  BuildOutputHandle,
  BuildRootHandle,
  IsolatedTypstSandboxPort,
} from "./runner.js";

const SOURCE = "#text(\"Hello\")";
const SOURCE_HASH = hashBytes(new TextEncoder().encode(SOURCE));
const REVISION = hexToSha256Hash("a".repeat(64)) as BuildQueueHash;
const RENDER = hexToSha256Hash("b".repeat(64)) as BuildQueueHash;
const FONT_1 = hexToSha256Hash("c".repeat(64));
const FONT_2 = hexToSha256Hash("d".repeat(64));
const TOOL_HASH = hexToSha256Hash("e".repeat(64));
const ROOT = "root:opaque" as BuildRootHandle;
const OUTPUT = "output:opaque" as BuildOutputHandle;

const CLOSURE: VerifiedResourceClosure = {
  assets: [],
  fonts: [
    {
      fontRef: BUNDLED_NOTO_SANS_FONT_REF,
      familyDigest: hexToSha256Hash("f".repeat(64)),
      selectedFaces: [{ faceId: "regular", faceHash: FONT_1, faceIndex: 0, embedding: "subset" }],
    },
    {
      fontRef: BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF,
      familyDigest: hexToSha256Hash("1".repeat(64)),
      selectedFaces: [{ faceId: "regular", faceHash: FONT_2, faceIndex: 0, embedding: "subset" }],
    },
  ],
  assetBindings: {},
  fontBindings: {
    [BUNDLED_NOTO_SANS_FONT_REF]: { familyName: BUNDLED_NOTO_SANS_FAMILY },
    [BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF]: { familyName: BUNDLED_NOTO_SANS_SYMBOLS_2_FAMILY },
  },
  stagingEntries: [
    {
      kind: "fontFace",
      fontRef: BUNDLED_NOTO_SANS_FONT_REF,
      faceId: "regular",
      locator: {
        kind: "fontFace",
        localId: parseLocalResourceId("10000000-0000-4000-8000-000000000001"),
        faceId: "regular",
      },
      relativePath: "fonts/f0000-0000.ttf",
      hash: FONT_1,
      byteSize: 100,
      format: "ttf",
    },
    {
      kind: "fontFace",
      fontRef: BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF,
      faceId: "regular",
      locator: {
        kind: "fontFace",
        localId: parseLocalResourceId("10000000-0000-4000-8000-000000000002"),
        faceId: "regular",
      },
      relativePath: "fonts/f0001-0000.ttf",
      hash: FONT_2,
      byteSize: 100,
      format: "ttf",
    },
  ],
  warnings: [],
  totals: {
    assetCount: 0,
    assetBytes: 0,
    fontFamilyCount: 2,
    fontFaceCount: 2,
    fontBytes: 200,
  },
};

function request(buildId = "20000000-0000-4000-8000-000000000001"): OrchestratedRunnerRequest {
  return {
    request: {
      kind: "preview",
      buildId,
      localResourceId: "30000000-0000-4000-8000-000000000001",
      documentRevision: REVISION,
      renderInputHash: RENDER,
      editGeneration: 1,
      requestSequence: 1,
    },
    generatedSource: { source: SOURCE, sourceHash: SOURCE_HASH },
    provenance: {
      projectionHandle: "projection:test",
      localResourceId: "30000000-0000-4000-8000-000000000001",
      documentRevision: REVISION,
      renderInputHash: RENDER,
      editGeneration: 1,
      sourceHash: SOURCE_HASH,
      resourceClosureHash: hexToSha256Hash("2".repeat(64)),
      artifactMetadata: {
        renderProjectionHash: hexToSha256Hash("3".repeat(64)),
        generatorVersion: "test",
        outputForm: "readerOrder",
        readinessProfile: "draft",
      },
    } as unknown as OrchestratedRunnerRequest["provenance"],
    resources: CLOSURE,
  };
}

function sandbox(waitForAbort = false): IsolatedTypstSandboxPort {
  return {
    isolationProfile: "offlineTypstV1",
    verifyTrustedTool: async () => true,
    createBuildRoot: async () => ROOT,
    stageSource: async (_root, bytes, hash) => ({ observedHash: hash, observedByteSize: bytes.byteLength }),
    stageResource: async (_root, entry) => ({ observedHash: entry.hash, observedByteSize: entry.byteSize }),
    compile: async (_root, signal) => waitForAbort
      ? new Promise((resolve) => signal?.addEventListener("abort", () => resolve({ kind: "canceled" }), { once: true }))
      : { kind: "succeeded" },
    verifyPdf: async () => ({
      handle: OUTPUT,
      hash: hexToSha256Hash("4".repeat(64)),
      byteSize: 100,
      pageCount: 1,
      pdfVersion: "1.7",
      magicVerified: true,
    }),
    terminate: vi.fn(async () => undefined),
    cleanup: vi.fn(async () => undefined),
  };
}

function execution(adapter: IsolatedTypstSandboxPort) {
  return new IsolatedBuildExecution({
    sandbox: adapter,
    timer: { raceTimeout: async (work) => ({ kind: "completed", value: await work }) },
    tool: { toolId: "typst", version: "0.14.2", executableHash: TOOL_HASH },
    sinks: { bind: () => ({ persistCompile: async () => ({ installed: true }) }) },
  });
}

describe("isolated orchestrator execution adapter", () => {
  it("binds a sink and maps a verified low-level success", async () => {
    await expect(execution(sandbox()).execute(request(), new AbortController().signal)).resolves.toEqual({
      kind: "succeeded",
      diagnosticCodes: [],
    });
  });

  it("cancels the same sandbox process tree by build id", async () => {
    const adapter = sandbox(true);
    const runner = execution(adapter);
    const build = request();
    const pending = runner.execute(build, new AbortController().signal);
    await Promise.resolve();
    await runner.cancelProcessTree(build.request.buildId);
    await expect(pending).resolves.toMatchObject({ kind: "canceled" });
    expect(adapter.terminate).toHaveBeenCalled();
  });
});
