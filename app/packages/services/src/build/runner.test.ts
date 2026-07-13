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
  runIsolatedTypstCompile,
  type BuildOutputHandle,
  type BuildRootHandle,
  type BuildRunnerTimerPort,
  type IsolatedTypstSandboxPort,
  type SandboxCompileResult,
  type TrustedTypstRequirement,
  type VerifiedPdfOutput,
} from "./runner.js";

const SOURCE = "#text(\"Hello\")";
const SOURCE_BYTES = new TextEncoder().encode(SOURCE);
const SOURCE_HASH = hashBytes(SOURCE_BYTES);
const TOOL: TrustedTypstRequirement = {
  toolId: "typst",
  version: "typst 0.15.0",
  executableHash: hexToSha256Hash("a".repeat(64)),
};
const ROOT = "root:opaque" as BuildRootHandle;
const OUTPUT = "output:opaque" as BuildOutputHandle;
const FONT_HASH_1 = hexToSha256Hash("c".repeat(64));
const FONT_HASH_2 = hexToSha256Hash("d".repeat(64));
const CLOSURE: VerifiedResourceClosure = {
  assets: [],
  fonts: [
    {
      fontRef: BUNDLED_NOTO_SANS_FONT_REF,
      familyDigest: hexToSha256Hash("e".repeat(64)),
      selectedFaces: [{ faceId: "regular", faceHash: FONT_HASH_1, faceIndex: 0, embedding: "subset" }],
    },
    {
      fontRef: BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF,
      familyDigest: hexToSha256Hash("f".repeat(64)),
      selectedFaces: [{ faceId: "regular", faceHash: FONT_HASH_2, faceIndex: 0, embedding: "subset" }],
    },
  ],
  assetBindings: {},
  fontBindings: {
    [BUNDLED_NOTO_SANS_FONT_REF]: { familyName: BUNDLED_NOTO_SANS_FAMILY },
    [BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF]: {
      familyName: BUNDLED_NOTO_SANS_SYMBOLS_2_FAMILY,
    },
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
      hash: FONT_HASH_1,
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
      hash: FONT_HASH_2,
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

function pdf(overrides: Partial<VerifiedPdfOutput> = {}): VerifiedPdfOutput {
  return {
    handle: OUTPUT,
    hash: hexToSha256Hash("b".repeat(64)),
    byteSize: 100,
    pageCount: 1,
    pdfVersion: "1.7",
    magicVerified: true,
    ...overrides,
  };
}

function sandbox(
  overrides: Partial<IsolatedTypstSandboxPort> = {},
): IsolatedTypstSandboxPort {
  return {
    isolationProfile: "offlineTypstV1",
    async verifyTrustedTool() {
      return true;
    },
    async createBuildRoot() {
      return ROOT;
    },
    async stageSource(_root, source) {
      return { observedHash: hashBytes(source), observedByteSize: source.byteLength };
    },
    async stageResource(_root, entry) {
      return { observedHash: entry.hash, observedByteSize: entry.byteSize };
    },
    async compile(): Promise<SandboxCompileResult> {
      return { kind: "succeeded" };
    },
    async verifyPdf() {
      return pdf();
    },
    async terminate() {},
    async cleanup() {},
    ...overrides,
  };
}

const timer: BuildRunnerTimerPort = {
  async raceTimeout(work) {
    return { kind: "completed", value: await work };
  },
};

function request(overrides: Record<string, unknown> = {}) {
  return {
    buildId: "11111111-1111-4111-8111-111111111111",
    source: SOURCE,
    sourceHash: SOURCE_HASH,
    resources: CLOSURE,
    ...overrides,
  };
}

describe("isolated Typst runner", () => {
  it("stages, verifies, persists, and always cleans a successful build", async () => {
    const cleanup = vi.fn(async () => undefined);
    const persistCompile = vi.fn(async () => ({ artifactId: "artifact-1" }));
    const result = await runIsolatedTypstCompile(
      request(),
      TOOL,
      sandbox({ cleanup }),
      timer,
      { persistCompile },
    );
    expect(result).toEqual({ status: "succeeded", artifact: { artifactId: "artifact-1" } });
    expect(persistCompile).toHaveBeenCalledWith(
      expect.objectContaining({ sourceHash: SOURCE_HASH, pdf: pdf() }),
    );
    expect(cleanup).toHaveBeenCalledWith(ROOT);
  });

  it("fails closed before root creation without isolation or a verified tool", async () => {
    const createBuildRoot = vi.fn(async () => ROOT);
    await expect(
      runIsolatedTypstCompile(
        request(),
        TOOL,
        sandbox({ isolationProfile: "unavailable", createBuildRoot }),
        timer,
        { async persistCompile() {} },
      ),
    ).resolves.toMatchObject({
      status: "failed",
      kind: "isolationUnavailable",
      code: "CBB-SECURITY-0001",
    });
    expect(createBuildRoot).not.toHaveBeenCalled();

    await expect(
      runIsolatedTypstCompile(
        request(),
        TOOL,
        sandbox({ async verifyTrustedTool() { return false; }, createBuildRoot }),
        timer,
        { async persistCompile() {} },
      ),
    ).resolves.toMatchObject({ kind: "untrustedTool" });
  });

  it("terminates timed-out work and removes the partial root", async () => {
    const terminate = vi.fn(async () => undefined);
    const cleanup = vi.fn(async () => undefined);
    const timedOut: BuildRunnerTimerPort = {
      async raceTimeout() {
        return { kind: "timedOut" };
      },
    };
    const result = await runIsolatedTypstCompile(
      request(),
      TOOL,
      sandbox({ terminate, cleanup }),
      timedOut,
      { async persistCompile() {} },
    );
    expect(result).toMatchObject({ kind: "timedOut", code: "CBB-BUILD-0002" });
    expect(terminate).toHaveBeenCalledWith(ROOT);
    expect(cleanup).toHaveBeenCalledWith(ROOT);
  });

  it("fails closed when the sandbox cannot authoritatively remove its build root", async () => {
    const persistCompile = vi.fn(async () => ({ artifactId: "must-not-escape" }));
    const result = await runIsolatedTypstCompile(
      request(),
      TOOL,
      sandbox({ async cleanup() { throw new Error("root remains owned"); } }),
      timer,
      { persistCompile },
    );
    expect(persistCompile).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      status: "failed",
      kind: "cleanupFailed",
      code: "CBB-SECURITY-0001",
    });
  });

  it("rejects staging mismatches and invalid PDF evidence without persisting", async () => {
    const persistCompile = vi.fn(async () => undefined);
    await expect(
      runIsolatedTypstCompile(
        request(),
        TOOL,
        sandbox({
          async stageSource() {
            return {
              observedHash: hexToSha256Hash("c".repeat(64)),
              observedByteSize: 1,
            };
          },
        }),
        timer,
        { persistCompile },
      ),
    ).resolves.toMatchObject({ kind: "stagingFailed" });
    expect(persistCompile).not.toHaveBeenCalled();

    await expect(
      runIsolatedTypstCompile(
        request(),
        TOOL,
        sandbox({ async verifyPdf() { return pdf({ pageCount: 1001 }); } }),
        timer,
        { persistCompile },
      ),
    ).resolves.toMatchObject({ kind: "invalidPdf" });
    expect(persistCompile).not.toHaveBeenCalled();
  });

  it("rejects request-controlled aliases, source changes, and excessive timeouts", async () => {
    await expect(
      runIsolatedTypstCompile(
        request({
          resources: {
            ...CLOSURE,
            fonts: [],
            fontBindings: {},
            stagingEntries: [],
          },
        }),
        TOOL,
        sandbox(),
        timer,
        { async persistCompile() {} },
      ),
    ).resolves.toMatchObject({ kind: "invalidRequest" });
    const unsafeClosure = {
      ...CLOSURE,
      stagingEntries: [
        {
          kind: "asset" as const,
          assetRef: "asset:11111111-1111-4111-8111-111111111111" as never,
          locator: { kind: "assetCanonical" as const, localId: "11111111-1111-4111-8111-111111111111" as never },
          relativePath: "../secret",
          hash: `sha256:${"d".repeat(64)}` as const,
          byteSize: 1,
          mediaType: "image/png",
        },
      ],
    };
    await expect(
      runIsolatedTypstCompile(
        request({ resources: unsafeClosure }),
        TOOL,
        sandbox(),
        timer,
        { async persistCompile() {} },
      ),
    ).resolves.toMatchObject({ kind: "invalidRequest" });
    await expect(
      runIsolatedTypstCompile(
        request({ source: "changed" }),
        TOOL,
        sandbox(),
        timer,
        { async persistCompile() {} },
      ),
    ).resolves.toMatchObject({ kind: "invalidRequest" });
    await expect(
      runIsolatedTypstCompile(
        request({ timeoutMs: 120_001 }),
        TOOL,
        sandbox(),
        timer,
        { async persistCompile() {} },
      ),
    ).resolves.toMatchObject({ kind: "invalidRequest" });
  });
});
