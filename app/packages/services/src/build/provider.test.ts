import { describe, expect, it, vi } from "vitest";
import {
  BUNDLED_NOTO_SANS_FAMILY,
  BUNDLED_NOTO_SANS_FONT_REF,
  BUNDLED_NOTO_SANS_SYMBOLS_2_FAMILY,
  BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF,
  canonicalRevisionToken,
  createSanitizedRenderProjection,
  generateTypst,
  hashBytes,
  hashCanonical,
  parseLocalResourceId,
  renderInputHash,
  resolveDocument,
  type CbbDocument,
  type HashJsonObject,
  type PinnedToolIdentity,
  type Sha256Hash,
} from "@cbb/core";
import {
  materializeMandatoryFontFallbacks,
  resourceClosureExecutionHash,
  type ResourceProjectionReferences,
  type VerifiedResourceClosure,
} from "../resources/index.js";
import type {
  BuildQueueHash,
  BuildQueueRequest,
  CurrentBuildInputs,
} from "./queue.js";
import type {
  TrustedBuildProjectionRequest,
  TrustedBuildProvenance,
} from "./orchestrator.js";
import {
  DeterministicBuildProvider,
  DeterministicBuildProviderError,
  type DeterministicBuildProviderOptions,
} from "./provider.js";

const RESOURCE_ID = "11111111-1111-4111-8111-111111111111";
const BUILD_ID = "22222222-2222-4222-8222-222222222222";
const FONT_LOCAL_IDS = [
  parseLocalResourceId("33333333-3333-4333-8333-333333333333"),
  parseLocalResourceId("44444444-4444-4444-8444-444444444444"),
] as const;

function hash(label: string): Sha256Hash {
  return hashBytes(new TextEncoder().encode(label));
}

const TOOL: PinnedToolIdentity = Object.freeze({
  toolId: "cbb-typst-generator",
  version: "m3-test-v1",
  toolHash: hash("generator tool"),
});

const DOCUMENT: CbbDocument = Object.freeze({
  version: 2,
  kind: "bulletin",
  name: "Deterministic provider fixture",
  metadata: { title: "Sunday Worship", language: "en-US" },
  page: { typstWidth: "5.5in", typstHeight: "8.5in" },
  elements: Object.freeze([{
    id: "welcome",
    type: "text" as const,
    name: "Welcome",
    data: { content: { kind: "plain" as const, text: "Welcome in the name of Jesus." } },
  }]),
});

const FONT_REFS = [
  BUNDLED_NOTO_SANS_FONT_REF,
  BUNDLED_NOTO_SANS_SYMBOLS_2_FONT_REF,
] as const;
const FONT_FAMILIES = [
  BUNDLED_NOTO_SANS_FAMILY,
  BUNDLED_NOTO_SANS_SYMBOLS_2_FAMILY,
] as const;

function closure(suffix = "stable"): VerifiedResourceClosure {
  const faceHashes = FONT_REFS.map((_, index) => hash(`face-${index}-${suffix}`));
  const byteSizes = [101, 103] as const;
  return Object.freeze({
    assets: Object.freeze([]),
    fonts: Object.freeze(FONT_REFS.map((fontRef, index) => Object.freeze({
      fontRef,
      familyDigest: hash(`family-${index}-${suffix}`),
      selectedFaces: Object.freeze([Object.freeze({
        faceId: "regular",
        faceHash: faceHashes[index] as Sha256Hash,
        faceIndex: 0,
        embedding: "subset" as const,
      })]),
    }))),
    assetBindings: Object.freeze({}),
    fontBindings: Object.freeze(Object.fromEntries(FONT_REFS.map((fontRef, index) => [
      fontRef,
      Object.freeze({ familyName: FONT_FAMILIES[index] as string }),
    ]))),
    stagingEntries: Object.freeze(FONT_REFS.map((fontRef, index) => Object.freeze({
      kind: "fontFace" as const,
      fontRef,
      faceId: "regular",
      locator: Object.freeze({
        kind: "fontFace" as const,
        localId: FONT_LOCAL_IDS[index] as (typeof FONT_LOCAL_IDS)[number],
        faceId: "regular",
      }),
      relativePath: `fonts/f000${index}-0000.ttf`,
      hash: faceHashes[index] as Sha256Hash,
      byteSize: byteSizes[index] as number,
      format: "ttf" as const,
    }))),
    warnings: Object.freeze([]),
    totals: Object.freeze({
      assetCount: 0,
      assetBytes: 0,
      fontFamilyCount: 2,
      fontFaceCount: 2,
      fontBytes: byteSizes[0] + byteSizes[1],
    }),
  }) as VerifiedResourceClosure;
}

const LOCALE = Object.freeze({
  languageTag: "en-US",
  dataVersion: "cldr-test-v1",
  dataHash: hash("locale data"),
});

function expected(document: CbbDocument, resources: VerifiedResourceClosure) {
  const resolved = resolveDocument(document);
  const projection = materializeMandatoryFontFallbacks(resolved.projection);
  const sanitized = createSanitizedRenderProjection(
    projection as unknown as HashJsonObject,
  );
  const generated = generateTypst(
    { tree: resolved.tree, projection },
    { assets: resources.assetBindings, fonts: resources.fontBindings },
  );
  return {
    documentRevision: canonicalRevisionToken(document) as BuildQueueHash,
    renderInputHash: renderInputHash({
      projection: sanitized,
      assets: resources.assets,
      fonts: resources.fonts,
      tools: [TOOL],
      locale: LOCALE,
      outputOptions: {
        outputForm: "readerOrder",
        pdfConformance: "standard",
        watermark: { kind: "proof", text: "PREVIEW", version: "m3-v1" },
      },
    }) as BuildQueueHash,
    source: generated.source,
    sourceHash: hashBytes(new TextEncoder().encode(generated.source)),
    generatorVersion: generated.generatorVersion,
    projectionHash: hashCanonical(sanitized),
  };
}

function currentFor(document: CbbDocument, resources: VerifiedResourceClosure): CurrentBuildInputs {
  const identity = expected(document, resources);
  return {
    documentRevision: identity.documentRevision,
    renderInputHash: identity.renderInputHash,
    editGeneration: 7,
    saveState: "dirty",
  };
}

function preview(): TrustedBuildProjectionRequest {
  return { kind: "preview", localResourceId: RESOURCE_ID, requestSequence: 1 };
}

function providerWith(
  resourceResolver: DeterministicBuildProviderOptions["resources"],
  current: CurrentBuildInputs,
  overrides: Partial<DeterministicBuildProviderOptions> = {},
): DeterministicBuildProvider {
  return new DeterministicBuildProvider({
    snapshots: {
      async load() { return { document: DOCUMENT, current }; },
    },
    resources: resourceResolver,
    tools: [TOOL],
    localeIdentity(languageTag) {
      if (languageTag !== LOCALE.languageTag) throw new Error("unexpected locale");
      return LOCALE;
    },
    ...overrides,
  });
}

function executionRequest(
  prepared: Awaited<ReturnType<DeterministicBuildProvider["prepare"]>>,
): { readonly request: BuildQueueRequest; readonly provenance: TrustedBuildProvenance } {
  const request: BuildQueueRequest = {
    kind: "preview",
    buildId: BUILD_ID,
    localResourceId: prepared.localResourceId,
    documentRevision: prepared.documentRevision,
    renderInputHash: prepared.renderInputHash,
    editGeneration: prepared.editGeneration,
    requestSequence: 1,
  };
  const provenance = {
    projectionHandle: prepared.projectionHandle,
    localResourceId: prepared.localResourceId,
    documentRevision: prepared.documentRevision,
    renderInputHash: prepared.renderInputHash,
    editGeneration: prepared.editGeneration,
    sourceHash: prepared.sourceHash,
    resourceClosureHash: prepared.resourceClosureHash,
    artifactMetadata: prepared.artifactMetadata,
  } as TrustedBuildProvenance;
  return { request, provenance };
}

describe("DeterministicBuildProvider", () => {
  it("binds exact snapshot revision, render identity, generation, and a closed resource projection", async () => {
    const resources = closure();
    const resolve = vi.fn(async (projection: ResourceProjectionReferences) => {
      expect(Object.keys(projection).sort()).toEqual([
        "fontFallbackRefs", "referencedAssets", "referencedFonts",
      ]);
      expect(projection.referencedAssets).toEqual([]);
      expect(projection.fontFallbackRefs).toEqual(FONT_REFS);
      expect(Object.isFrozen(projection)).toBe(true);
      expect(Object.isFrozen(projection.referencedFonts)).toBe(true);
      return resources;
    });
    const identities = expected(DOCUMENT, resources);
    const provider = providerWith({ resolve }, currentFor(DOCUMENT, resources));

    const prepared = await provider.prepare(preview());

    expect(prepared).toMatchObject({
      localResourceId: RESOURCE_ID,
      documentRevision: identities.documentRevision,
      renderInputHash: identities.renderInputHash,
      editGeneration: 7,
      source: identities.source,
      sourceHash: identities.sourceHash,
      resourceClosureHash: resourceClosureExecutionHash(resources),
      artifactMetadata: {
        renderProjectionHash: identities.projectionHash,
        generatorVersion: identities.generatorVersion,
        outputForm: "readerOrder",
        readinessProfile: "draft",
        watermark: { kind: "proof", text: "PREVIEW", version: "m3-v1" },
      },
    });
    expect(prepared.source).toContain("Welcome in the name of Jesus.");
    expect(Object.isFrozen(prepared)).toBe(true);

    await expect(provider.resolve(executionRequest(prepared))).resolves.toBe(resources);
    expect(resolve).toHaveBeenCalledTimes(2);
    await expect(provider.resolve(executionRequest(prepared))).rejects.toMatchObject({
      kind: "projectionChanged",
    });
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("rejects either a stale document revision or a forged render-input identity", async () => {
    const resources = closure();
    const exact = currentFor(DOCUMENT, resources);
    const resolver = { async resolve() { return resources; } };
    const staleRevision = providerWith(resolver, {
      ...exact,
      documentRevision: hash("stale revision") as BuildQueueHash,
    });
    await expect(staleRevision.prepare(preview())).rejects.toMatchObject({
      kind: "invalidSnapshot",
    });

    const forgedRender = providerWith(resolver, {
      ...exact,
      renderInputHash: hash("forged render") as BuildQueueHash,
    });
    await expect(forgedRender.prepare(preview())).rejects.toMatchObject({
      kind: "invalidSnapshot",
    });
  });

  it("captures current identity before asynchronous resource resolution can observe later edits", async () => {
    const resources = closure();
    const mutableCurrent = { ...currentFor(DOCUMENT, resources) };
    const provider = providerWith({
      async resolve() {
        mutableCurrent.editGeneration = 99;
        return resources;
      },
    }, mutableCurrent);

    await expect(provider.prepare(preview())).resolves.toMatchObject({
      editGeneration: 7,
      documentRevision: canonicalRevisionToken(DOCUMENT),
    });
    expect(mutableCurrent.editGeneration).toBe(99);
  });

  it("re-resolves immediately before execution and burns the handle on closure mismatch", async () => {
    const first = closure("first");
    const changed = closure("changed");
    const resolve = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(changed);
    const provider = providerWith({ resolve }, currentFor(DOCUMENT, first));
    const prepared = await provider.prepare(preview());
    const request = executionRequest(prepared);

    await expect(provider.resolve(request)).rejects.toMatchObject({
      kind: "projectionChanged",
    });
    await expect(provider.resolve(request)).rejects.toMatchObject({
      kind: "projectionChanged",
    });
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("classifies resource faults separately and rejects generation without exact font bindings", async () => {
    const resources = closure();
    const exact = currentFor(DOCUMENT, resources);
    const resolverFault = providerWith({
      async resolve() { throw new Error("private resolver detail"); },
    }, exact);
    await expect(resolverFault.prepare(preview())).rejects.toEqual(
      expect.objectContaining({
        name: "DeterministicBuildProviderError",
        kind: "resourceResolutionFailed",
        message: "Trusted deterministic build projection failed",
      }),
    );

    const badBindings = Object.freeze({
      ...resources,
      fontBindings: Object.freeze({}),
    });
    const generationFault = providerWith({
      async resolve() { return badBindings; },
    }, exact);
    await expect(generationFault.prepare(preview())).rejects.toMatchObject({
      kind: "generationFailed",
    });
  });

  it("enforces capacity across in-flight work and allows only explicit idempotent release", async () => {
    const resources = closure();
    const exact = currentFor(DOCUMENT, resources);
    let finishLoad: ((value: { document: CbbDocument; current: CurrentBuildInputs }) => void) | undefined;
    const provider = providerWith({ async resolve() { return resources; } }, exact, {
      maximumPreparedSnapshots: 1,
      snapshots: {
        load: () => new Promise((resolve) => { finishLoad = resolve; }),
      },
    });

    const firstPreparation = provider.prepare(preview());
    await expect(provider.prepare(preview())).rejects.toMatchObject({
      kind: "capacityExceeded",
    });
    finishLoad?.({ document: DOCUMENT, current: exact });
    const prepared = await firstPreparation;
    await expect(provider.prepare(preview())).rejects.toMatchObject({
      kind: "capacityExceeded",
    });

    provider.release("../../private/workspace");
    await expect(provider.prepare(preview())).rejects.toMatchObject({
      kind: "capacityExceeded",
    });
    provider.release(prepared.projectionHandle);
    provider.release(prepared.projectionHandle);

    const replacementPromise = provider.prepare(preview());
    finishLoad?.({ document: DOCUMENT, current: exact });
    await expect(replacementPromise).resolves.toMatchObject({
      projectionHandle: "projection:m3-00000002",
    });
  });

  it("requires a trusted readiness policy for every manual build", async () => {
    const resources = closure();
    const clean = { ...currentFor(DOCUMENT, resources), saveState: "clean" as const };
    const provider = providerWith({ async resolve() { return resources; } }, clean);
    await expect(provider.prepare({
      kind: "manual",
      localResourceId: RESOURCE_ID,
      artifactKind: "draft",
      savedInputs: clean,
    })).rejects.toMatchObject({ kind: "missingArtifactPolicy" });

    const incomplete = providerWith(
      { async resolve() { return resources; } },
      clean,
      {
        artifactPolicy: {
          metadata: () => ({
            outputForm: "readerOrder",
            readinessProfile: "draft",
            watermark: { kind: "draft", text: "DRAFT", version: "m3-v1" },
          }),
        },
      },
    );
    await expect(incomplete.prepare({
      kind: "manual",
      localResourceId: RESOURCE_ID,
      artifactKind: "draft",
      savedInputs: clean,
    })).rejects.toMatchObject({ kind: "missingArtifactPolicy" });

    const contradictory = providerWith(
      { async resolve() { return resources; } },
      clean,
      {
        artifactPolicy: {
          metadata: () => ({
            outputForm: "readerOrder",
            readinessProfile: "printFinal",
            readinessInputHash: hash("readiness"),
            watermark: { kind: "draft", text: "DRAFT", version: "m3-v1" },
          }),
        },
      },
    );
    await expect(contradictory.prepare({
      kind: "manual",
      localResourceId: RESOURCE_ID,
      artifactKind: "finalCandidate",
      savedInputs: clean,
    })).rejects.toMatchObject({ kind: "generationFailed" });
  });

  it("rejects invalid capacity configuration at construction", () => {
    const resources = closure();
    expect(() => providerWith(
      { async resolve() { return resources; } },
      currentFor(DOCUMENT, resources),
      { maximumPreparedSnapshots: 129 },
    )).toThrow(DeterministicBuildProviderError);
  });
});
