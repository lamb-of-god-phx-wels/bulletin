import {
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSchemaCatalog, hashBytes, type SchemaObject } from "@cbb/core";
import {
  CBB_TRUSTED_COMPONENT_APPLICATION_ID,
  M3_MANDATORY_BUNDLED_FONT_FACES,
  M3_TRUSTED_COMPONENT_RELEASE_PROFILE,
  createNodeM3TrustedComponentRegistry,
  createNodeTrustedComponentRegistry,
  trustedComponentSigningBytes,
  verifyTrustedComponentManifest,
} from "./index.js";
import type {
  SignedTrustedComponentManifest,
  TrustedBundledFontFaceBinding,
  TrustedComponentErrorKind,
  TrustedComponentLocator,
  TrustedComponentManifestContent,
  TrustedComponentManifestEntry,
  TrustedComponentOperationPayload,
  TrustedComponentReleaseIdentity,
  TrustedComponentRole,
  TrustedPublicKeyRegistry,
  PrivilegedNodeTrustedComponentExecutorPort,
} from "./index.js";

const roots: string[] = [];
const encoder = new TextEncoder();
const TEST_RELEASE: TrustedComponentReleaseIdentity = Object.freeze({
  applicationId: CBB_TRUSTED_COMPONENT_APPLICATION_ID,
  releaseId: "1.0.0-test.1",
  releaseSequence: 7,
  profile: M3_TRUSTED_COMPONENT_RELEASE_PROFILE,
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface SigningFixture {
  readonly privateKey: KeyObject;
  readonly registry: TrustedPublicKeyRegistry;
}

interface ComponentFixture {
  readonly entry: TrustedComponentManifestEntry;
  readonly bytes: Uint8Array;
}

function signingFixture(): SigningFixture {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyDer = new Uint8Array(publicKey.export({ format: "der", type: "spki" }));
  return {
    privateKey,
    registry: {
      getEd25519PublicKey(signingKeyId) {
        return signingKeyId === "release-key-1" ? publicKeyDer : undefined;
      },
    },
  };
}

async function temporaryRoot(label = "app"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `cbb-m3-components-${label}-`));
  roots.push(root);
  return root;
}

function component(
  role: TrustedComponentRole,
  id: string,
  relativePath: string,
  fontFaceBinding?: TrustedBundledFontFaceBinding,
): ComponentFixture {
  const bytes = encoder.encode(`trusted:${role}:${id}`);
  return {
    bytes,
    entry: {
      role,
      id,
      version: "1.0.0",
      platform: "linux",
      arch: "x64",
      relativePath,
      hash: hashBytes(bytes),
      byteSize: bytes.byteLength,
      ...(fontFaceBinding === undefined ? {} : { fontFaceBinding }),
    },
  };
}

function sorted(fixtures: readonly ComponentFixture[]): ComponentFixture[] {
  return [...fixtures].sort((left, right) => {
    const leftKey = `${left.entry.role}\u0000${left.entry.id}`;
    const rightKey = `${right.entry.role}\u0000${right.entry.id}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

function releaseComponents(): ComponentFixture[] {
  const singletons = [
    component("executionBroker", "broker", "native/execution-broker"),
    component("quarantineWorker", "quarantine-worker", "native/quarantine-worker"),
    component("typstCli", "typst", "native/typst"),
    component("pdfInspector", "pdf-inspector", "native/pdf-inspector"),
    component("bookletCompositor", "compositor", "native/booklet-compositor"),
    component("schemaCatalog", "schemas", "resources/schemas.bin"),
    component("localeData", "locales", "resources/locales.bin"),
    component("genericStarterSet", "starters", "resources/starters.bin"),
  ];
  const fonts = M3_MANDATORY_BUNDLED_FONT_FACES.map((binding, index) =>
    component(
      "bundledFontFace",
      `font-${index.toString(10).padStart(2, "0")}-${binding.faceId}`,
      `fonts/${index.toString(10).padStart(2, "0")}-${binding.faceId}.ttf`,
      binding,
    )
  );
  return sorted([...singletons, ...fonts]);
}

function manifestContent(
  fixtures: readonly ComponentFixture[],
  release: TrustedComponentReleaseIdentity = TEST_RELEASE,
): TrustedComponentManifestContent {
  return {
    version: 1,
    kind: "trustedComponentManifest",
    signingKeyId: "release-key-1",
    release,
    components: fixtures.map(({ entry }) => entry),
  };
}

function signedManifest(
  fixtures: readonly ComponentFixture[],
  privateKey: KeyObject,
  release: TrustedComponentReleaseIdentity = TEST_RELEASE,
): SignedTrustedComponentManifest {
  const content = manifestContent(sorted(fixtures), release);
  return {
    ...content,
    signature: sign(null, trustedComponentSigningBytes(content), privateKey).toString("base64"),
  };
}

async function install(root: string, fixtures: readonly ComponentFixture[]): Promise<void> {
  for (const fixture of fixtures) {
    const target = join(root, ...fixture.entry.relativePath.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, fixture.bytes);
  }
}

async function expectKind(
  operation: Promise<unknown>,
  kind: TrustedComponentErrorKind,
): Promise<void> {
  await expect(operation).rejects.toMatchObject({ code: "CBB-PACKAGE-0001", kind });
}

function registryOptions(
  root: string,
  fixtures: readonly ComponentFixture[],
  keys: SigningFixture,
  nativeExecutor: PrivilegedNodeTrustedComponentExecutorPort = {
    ownsPayload: () => true,
    async invoke() {},
  },
) {
  return {
    appRoot: root,
    manifest: signedManifest(fixtures, keys.privateKey),
    trustedKeys: keys.registry,
    expectedRelease: TEST_RELEASE,
    expectedPlatform: "linux" as const,
    expectedArch: "x64" as const,
    nativeExecutor,
  };
}

function operationPayload(
  operation: "quarantineExecute" | "typstCompile" | "pdfInspect",
  timeoutMs = operation === "pdfInspect" ? 10_000 : 30_000,
): TrustedComponentOperationPayload {
  return Object.freeze({
    token: `native-operation:${operation}`,
    operation,
    timeoutMs,
  }) as TrustedComponentOperationPayload;
}

describe("M3 signed release component profile", () => {
  it("keeps the persisted schema aligned with the closed runtime font binding contract", async () => {
    const schema = JSON.parse(await readFile(
      join(process.cwd(), "schemas/v1/trusted-components.schema.json"),
      "utf8",
    )) as SchemaObject;
    const catalog = createSchemaCatalog(new Map([[schema.$id, schema]]));
    const keys = signingFixture();
    const valid = signedManifest(releaseComponents(), keys.privateKey);
    expect(catalog.validateAgainst(schema.$id, valid).valid).toBe(true);

    const { release: _release, ...missingRelease } = valid;
    expect(catalog.validateAgainst(schema.$id, missingRelease).valid).toBe(false);
    expect(catalog.validateAgainst(schema.$id, {
      ...valid,
      release: { ...valid.release, releaseSequence: 0 },
    }).valid).toBe(false);

    const fontIndex = valid.components.findIndex(({ role }) => role === "bundledFontFace");
    const { fontFaceBinding: _binding, ...fontWithoutBinding } = valid.components[fontIndex]!;
    const missingBinding = {
      ...valid,
      components: valid.components.map((entry, index) =>
        index === fontIndex ? fontWithoutBinding : entry
      ),
    };
    expect(catalog.validateAgainst(schema.$id, missingBinding).valid).toBe(false);

    const typstIndex = valid.components.findIndex(({ role }) => role === "typstCli");
    const forbiddenBinding = {
      ...valid,
      components: valid.components.map((entry, index) =>
        index === typstIndex
          ? { ...entry, fontFaceBinding: M3_MANDATORY_BUNDLED_FONT_FACES[0] }
          : entry
      ),
    };
    expect(catalog.validateAgainst(schema.$id, forbiddenBinding).valid).toBe(false);
  });

  it("requires closed signed font-face bindings only on bundled font components", () => {
    const keys = signingFixture();
    const face = releaseComponents().find(({ entry }) => entry.role === "bundledFontFace");
    expect(face).toBeDefined();
    const { fontFaceBinding: _binding, ...missingBinding } = face!.entry;
    const invalidSignature = Buffer.alloc(64).toString("base64");
    expect(() => verifyTrustedComponentManifest({
      manifest: {
        ...manifestContent([{ ...face!, entry: missingBinding as TrustedComponentManifestEntry }]),
        signature: invalidSignature,
      },
      trustedKeys: keys.registry,
      expectedRelease: TEST_RELEASE,
      expectedPlatform: "linux",
      expectedArch: "x64",
    })).toThrowError(expect.objectContaining({ kind: "invalidFontBinding" }));

    const typst = component("typstCli", "typst", "native/typst");
    const wrongRole = {
      ...typst,
      entry: { ...typst.entry, fontFaceBinding: M3_MANDATORY_BUNDLED_FONT_FACES[0]! },
    };
    expect(() => verifyTrustedComponentManifest({
      manifest: {
        ...manifestContent([wrongRole]),
        signature: invalidSignature,
      },
      trustedKeys: keys.registry,
      expectedRelease: TEST_RELEASE,
      expectedPlatform: "linux",
      expectedArch: "x64",
    })).toThrowError(expect.objectContaining({ kind: "invalidFontBinding" }));
  });

  it("accepts one complete signed release set with the exact mandatory face catalog", async () => {
    const root = await temporaryRoot();
    const keys = signingFixture();
    const fixtures = releaseComponents();
    await install(root, fixtures);
    const registry = await createNodeM3TrustedComponentRegistry(registryOptions(root, fixtures, keys));

    expect(registry.components).toHaveLength(fixtures.length);
    expect(registry.components.filter(({ role }) => role === "bundledFontFace"))
      .toHaveLength(M3_MANDATORY_BUNDLED_FONT_FACES.length);
    expect(JSON.stringify(registry)).not.toContain("relativePath");
    expect(JSON.stringify(registry)).not.toContain(root);
  });

  it("rejects missing singleton roles, missing faces, mismatched bindings, and duplicates", async () => {
    const root = await temporaryRoot();
    const keys = signingFixture();
    const fixtures = releaseComponents();

    await expectKind(createNodeM3TrustedComponentRegistry(registryOptions(
      root,
      fixtures.filter(({ entry }) => entry.role !== "executionBroker"),
      keys,
    )), "requiredReleaseSet");

    await expectKind(createNodeM3TrustedComponentRegistry(registryOptions(
      root,
      [
        ...fixtures,
        component("executionBroker", "second-broker", "native/second-execution-broker"),
      ],
      keys,
    )), "requiredReleaseSet");

    await expectKind(createNodeM3TrustedComponentRegistry(registryOptions(
      root,
      [
        ...fixtures,
        component("pdfUaValidator", "validator-a", "native/validator-a"),
        component("pdfUaValidator", "validator-b", "native/validator-b"),
      ],
      keys,
    )), "requiredReleaseSet");

    const firstFaceIndex = fixtures.findIndex(({ entry }) => entry.role === "bundledFontFace");
    await expectKind(createNodeM3TrustedComponentRegistry(registryOptions(
      root,
      fixtures.filter((_, index) => index !== firstFaceIndex),
      keys,
    )), "requiredReleaseSet");

    const mismatched = fixtures.map((fixture, index) => index === firstFaceIndex
      ? {
          ...fixture,
          entry: {
            ...fixture.entry,
            fontFaceBinding: { ...fixture.entry.fontFaceBinding!, weight: 300 },
          },
        }
      : fixture);
    await expectKind(createNodeM3TrustedComponentRegistry(registryOptions(
      root,
      mismatched,
      keys,
    )), "requiredReleaseSet");

    const duplicated = component(
      "bundledFontFace",
      "duplicate-face-binding",
      "fonts/duplicate-face-binding.ttf",
      fixtures[firstFaceIndex]!.entry.fontFaceBinding,
    );
    await expectKind(createNodeM3TrustedComponentRegistry(registryOptions(
      root,
      [...fixtures, duplicated],
      keys,
    )), "requiredReleaseSet");
  });

  it("rejects a signed release set for a different platform before file use", async () => {
    const root = await temporaryRoot();
    const keys = signingFixture();
    const fixtures = releaseComponents();
    const wrongPlatform = fixtures.map((fixture, index) => index === 0
      ? { ...fixture, entry: { ...fixture.entry, platform: "win32" as const } }
      : fixture);
    await expectKind(createNodeM3TrustedComponentRegistry(registryOptions(
      root,
      wrongPlatform,
      keys,
    )), "platformMismatch");
  });

  it("rejects a self-consistent signed release outside the fixed M3 application profile", async () => {
    const root = await temporaryRoot();
    const keys = signingFixture();
    const fixtures = releaseComponents();
    const wrongProfile: TrustedComponentReleaseIdentity = {
      ...TEST_RELEASE,
      profile: "m4-v1",
    };
    await expectKind(createNodeM3TrustedComponentRegistry({
      ...registryOptions(root, fixtures, keys),
      manifest: signedManifest(fixtures, keys.privateKey, wrongProfile),
      expectedRelease: wrongProfile,
    }), "requiredReleaseSet");

    const wrongApplication: TrustedComponentReleaseIdentity = {
      ...TEST_RELEASE,
      applicationId: "another-application",
    };
    await expectKind(createNodeM3TrustedComponentRegistry({
      ...registryOptions(root, fixtures, keys),
      manifest: signedManifest(fixtures, keys.privateKey, wrongApplication),
      expectedRelease: wrongApplication,
    }), "requiredReleaseSet");
  });

  it("requires a privileged closed-operation executor for the production registry", async () => {
    const root = await temporaryRoot();
    const keys = signingFixture();
    const fixtures = releaseComponents();
    const { nativeExecutor: _nativeExecutor, ...withoutExecutor } = registryOptions(
      root,
      fixtures,
      keys,
    );
    await expectKind(createNodeM3TrustedComponentRegistry(withoutExecutor as never),
      "executionUnavailable");
  });
});

describe("opaque trusted component execution authority", () => {
  function executableComponents(): ComponentFixture[] {
    return sorted([
      component("executionBroker", "broker", "native/execution-broker"),
    component("quarantineWorker", "quarantine-worker", "native/quarantine-worker"),
      component("typstCli", "typst", "native/typst"),
      component("pdfInspector", "pdf-inspector", "native/pdf-inspector"),
    ]);
  }

  it("authorizes only allowlisted role pairs and rejects forged locators or path-bearing requests", async () => {
    const root = await temporaryRoot();
    const keys = signingFixture();
    const fixtures = executableComponents();
    await install(root, fixtures);
    const registry = await createNodeTrustedComponentRegistry(registryOptions(root, fixtures, keys));
    const broker = await registry.resolve({ role: "executionBroker", id: "broker" });
    const quarantine = await registry.resolve({ role: "quarantineWorker", id: "quarantine-worker" });
    const typst = await registry.resolve({ role: "typstCli", id: "typst" });
    const inspector = await registry.resolve({ role: "pdfInspector", id: "pdf-inspector" });

    const typstGrant = await registry.execution.authorize({
      operation: "typstCompile",
      broker: broker.locator,
      target: typst.locator,
    });
    const inspectGrant = await registry.execution.authorize({
      operation: "pdfInspect",
      broker: broker.locator,
      target: inspector.locator,
    });
    const quarantineGrant = await registry.execution.authorize({
      operation: "quarantineExecute",
      broker: broker.locator,
      target: quarantine.locator,
    });
    expect(quarantineGrant.target.role).toBe("quarantineWorker");
    expect(typstGrant).toMatchObject({
      operation: "typstCompile",
      broker: { role: "executionBroker", id: "broker" },
      target: { role: "typstCli", id: "typst" },
    });
    expect(inspectGrant.target.role).toBe("pdfInspector");
    expect(Object.isFrozen(typstGrant)).toBe(true);
    expect(JSON.stringify([typstGrant, inspectGrant])).not.toContain(root);
    expect(JSON.stringify([typstGrant, inspectGrant])).not.toContain("relativePath");

    const forged = Object.freeze({ token: broker.locator.token }) as TrustedComponentLocator;
    await expectKind(registry.execution.authorize({
      operation: "typstCompile",
      broker: forged,
      target: typst.locator,
    }), "invalidSelection");
    await expectKind(registry.execution.authorize({
      operation: "typstCompile",
      broker: typst.locator,
      target: broker.locator,
    }), "invalidSelection");
    await expectKind(registry.execution.authorize({
      operation: "pdfInspect",
      broker: broker.locator,
      target: typst.locator,
    }), "invalidSelection");
    await expectKind(registry.execution.authorize({
      operation: "typstCompile",
      broker: broker.locator,
      target: typst.locator,
      executablePath: "/usr/bin/typst",
    } as never), "invalidSelection");
  });

  it("consumes one-shot grants through the closed executor without exposing paths to callers", async () => {
    const root = await temporaryRoot();
    const keys = signingFixture();
    const fixtures = executableComponents();
    await install(root, fixtures);
    const observed: Array<{
      operation: string;
      brokerPath: string;
      targetPath: string;
      payload: TrustedComponentOperationPayload;
    }> = [];
    const registry = await createNodeTrustedComponentRegistry(registryOptions(
      root,
      fixtures,
      keys,
      {
        ownsPayload: (payload) => payload.token.startsWith("native-operation:"),
        async invoke(request) { observed.push(request); },
      },
    ));
    const broker = await registry.resolve({ role: "executionBroker", id: "broker" });
    const typst = await registry.resolve({ role: "typstCli", id: "typst" });
    const grant = await registry.execution.authorize({
      operation: "typstCompile",
      broker: broker.locator,
      target: typst.locator,
    });
    const payload = operationPayload("typstCompile");
    await expectKind(registry.execution.invoke({
      grant,
      payload: Object.freeze({
        ...payload,
        token: "foreign-operation:typstCompile",
      }) as TrustedComponentOperationPayload,
    }), "invalidSelection");
    await registry.execution.invoke({ grant, payload });

    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({
      operation: "typstCompile",
      payload,
    });
    expect(observed[0]!.brokerPath.startsWith(root)).toBe(true);
    expect(observed[0]!.targetPath.startsWith(root)).toBe(true);
    expect(JSON.stringify({ grant, payload, registry })).not.toContain(root);
    await expectKind(registry.execution.invoke({ grant, payload }), "invalidExecutionGrant");

    const forgedGrant = Object.freeze({ ...grant });
    await expectKind(registry.execution.invoke({
      grant: forgedGrant as typeof grant,
      payload,
    }), "invalidExecutionGrant");
  });

  it("binds the opaque payload to the authorized operation and fixed runtime cap", async () => {
    const root = await temporaryRoot();
    const keys = signingFixture();
    const fixtures = executableComponents();
    await install(root, fixtures);
    const registry = await createNodeTrustedComponentRegistry(registryOptions(root, fixtures, keys));
    const broker = await registry.resolve({ role: "executionBroker", id: "broker" });
    const typst = await registry.resolve({ role: "typstCli", id: "typst" });
    const grant = await registry.execution.authorize({
      operation: "typstCompile",
      broker: broker.locator,
      target: typst.locator,
    });

    await expectKind(registry.execution.invoke({
      grant,
      payload: operationPayload("pdfInspect"),
    }), "invalidExecutionGrant");
    await expectKind(registry.execution.invoke({
      grant,
      payload: operationPayload("typstCompile", 120_001),
    }), "invalidSelection");
    await expectKind(registry.execution.invoke({
      grant,
      payload: {
        token: "native-operation:mutable",
        operation: "typstCompile",
        timeoutMs: 30_000,
      } as TrustedComponentOperationPayload,
    }), "invalidSelection");
    await expectKind(registry.execution.invoke({
      grant,
      payload: {
        ...operationPayload("typstCompile"),
        executablePath: "/usr/bin/typst",
      } as never,
    }), "invalidSelection");
    await expect(registry.execution.invoke({
      grant,
      payload: operationPayload("typstCompile", 120_000),
    })).resolves.toBeUndefined();
  });

  it("re-verifies target bytes on invocation and consumes failed grants", async () => {
    const root = await temporaryRoot();
    const keys = signingFixture();
    const fixtures = executableComponents();
    await install(root, fixtures);
    const registry = await createNodeTrustedComponentRegistry(registryOptions(root, fixtures, keys));
    const broker = await registry.resolve({ role: "executionBroker", id: "broker" });
    const typst = await registry.resolve({ role: "typstCli", id: "typst" });
    const grant = await registry.execution.authorize({
      operation: "typstCompile",
      broker: broker.locator,
      target: typst.locator,
    });
    const typstFixture = fixtures.find(({ entry }) => entry.role === "typstCli")!;
    const target = join(root, ...typstFixture.entry.relativePath.split("/"));
    await writeFile(target, new Uint8Array(typstFixture.bytes.byteLength).fill(0x5a));

    await expectKind(registry.execution.invoke({
      grant,
      payload: operationPayload("typstCompile"),
    }), "componentVerificationFailed");
    await writeFile(target, typstFixture.bytes);
    await expectKind(registry.execution.invoke({
      grant,
      payload: operationPayload("typstCompile"),
    }), "invalidExecutionGrant");
  });

  it("redacts privileged executor failures and never retries a consumed grant", async () => {
    const root = await temporaryRoot();
    const keys = signingFixture();
    const fixtures = executableComponents();
    await install(root, fixtures);
    const registry = await createNodeTrustedComponentRegistry(registryOptions(
      root,
      fixtures,
      keys,
      {
        ownsPayload: () => true,
        async invoke(request) {
          throw new Error(`native failure at ${request.targetPath}`);
        },
      },
    ));
    const broker = await registry.resolve({ role: "executionBroker", id: "broker" });
    const typst = await registry.resolve({ role: "typstCli", id: "typst" });
    const grant = await registry.execution.authorize({
      operation: "typstCompile",
      broker: broker.locator,
      target: typst.locator,
    });
    const invocation = { grant, payload: operationPayload("typstCompile") };
    try {
      await registry.execution.invoke(invocation);
      throw new Error("expected executor failure");
    } catch (error) {
      expect(error).toMatchObject({ kind: "executionFailed" });
      expect(`${String(error)}${JSON.stringify(error)}`).not.toContain(root);
    }
    await expectKind(registry.execution.invoke(invocation), "invalidExecutionGrant");
  });

  it.runIf(process.platform !== "win32")(
    "re-verifies immediately and rejects replacement bytes and hardlinks",
    async () => {
      const root = await temporaryRoot();
      const outside = await temporaryRoot("outside");
      const keys = signingFixture();
      const fixtures = executableComponents();
      await install(root, fixtures);
      const registry = await createNodeTrustedComponentRegistry(registryOptions(root, fixtures, keys));
      const broker = await registry.resolve({ role: "executionBroker", id: "broker" });
      const typst = await registry.resolve({ role: "typstCli", id: "typst" });
      const typstFixture = fixtures.find(({ entry }) => entry.role === "typstCli")!;
      const target = join(root, ...typstFixture.entry.relativePath.split("/"));
      const request = {
        operation: "typstCompile" as const,
        broker: broker.locator,
        target: typst.locator,
      };

      const replacement = new Uint8Array(typstFixture.bytes.byteLength).fill(0xa5);
      await writeFile(target, replacement);
      await expectKind(registry.execution.authorize(request), "componentVerificationFailed");

      await writeFile(target, typstFixture.bytes);
      await expect(registry.execution.authorize(request)).resolves.toMatchObject({
        operation: "typstCompile",
      });

      const outsideFile = join(outside, "typst-hardlink-source");
      await writeFile(outsideFile, typstFixture.bytes);
      await unlink(target);
      await link(outsideFile, target);
      try {
        await registry.execution.authorize(request);
        throw new Error("expected component verification failure");
      } catch (error) {
        expect(error).toMatchObject({ kind: "componentVerificationFailed" });
        expect(`${String(error)}${JSON.stringify(error)}`).not.toContain(root);
        expect(`${String(error)}${JSON.stringify(error)}`).not.toContain(outside);
      }
    },
  );
});
