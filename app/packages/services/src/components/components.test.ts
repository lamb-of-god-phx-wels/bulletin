import {
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import {
  link,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalJsonBytes, hashBytes } from "@cbb/core";
import {
  createNodeTrustedComponentRegistry,
  trustedComponentSigningBytes,
  verifyTrustedComponentManifest,
} from "./index.js";
import type {
  SignedTrustedComponentManifest,
  TrustedComponentManifestContent,
  TrustedComponentManifestEntry,
  TrustedPublicKeyRegistry,
} from "./index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(label = "app"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `cbb-components-${label}-`));
  roots.push(root);
  return root;
}

interface SigningFixture {
  readonly privateKey: KeyObject;
  readonly publicKeyDer: Uint8Array;
  readonly registry: TrustedPublicKeyRegistry;
}

function signingFixture(keyId = "release-key-1"): SigningFixture {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyDer = new Uint8Array(publicKey.export({ format: "der", type: "spki" }));
  return {
    privateKey,
    publicKeyDer,
    registry: {
      getEd25519PublicKey(requested) {
        return requested === keyId ? publicKeyDer : undefined;
      },
    },
  };
}

function entry(
  bytes: Uint8Array,
  overrides: Partial<TrustedComponentManifestEntry> = {},
): TrustedComponentManifestEntry {
  return {
    role: "typstCli",
    id: "typst",
    version: "0.15.2",
    platform: "linux",
    arch: "x64",
    relativePath: "tools/typst/typst",
    hash: hashBytes(bytes),
    byteSize: bytes.byteLength,
    ...overrides,
  };
}

function content(
  components: readonly TrustedComponentManifestEntry[],
  signingKeyId = "release-key-1",
): TrustedComponentManifestContent {
  return {
    version: 1,
    kind: "trustedComponentManifest",
    signingKeyId,
    components,
  };
}

function signContent(
  unsigned: TrustedComponentManifestContent,
  privateKey: KeyObject,
): SignedTrustedComponentManifest {
  return {
    ...unsigned,
    signature: sign(null, trustedComponentSigningBytes(unsigned), privateKey).toString("base64"),
  };
}

function signUnvalidatedContent(
  unsigned: Record<string, unknown>,
  privateKey: KeyObject,
): Record<string, unknown> {
  return {
    ...unsigned,
    signature: sign(null, canonicalJsonBytes(unsigned), privateKey).toString("base64"),
  };
}

async function installEntry(root: string, component: TrustedComponentManifestEntry, bytes: Uint8Array) {
  const target = join(root, ...component.relativePath.split("/"));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  return target;
}

function verifyOptions(manifest: unknown, registry: TrustedPublicKeyRegistry) {
  return {
    manifest,
    trustedKeys: registry,
    expectedPlatform: "linux" as const,
    expectedArch: "x64" as const,
  };
}

async function expectKind(operation: Promise<unknown>, kind: string): Promise<void> {
  await expect(operation).rejects.toMatchObject({
    code: "CBB-PACKAGE-0001",
    kind,
  });
}

describe("trusted component manifest signatures", () => {
  it("uses deterministic RFC 8785 signing bytes independent of object key insertion", () => {
    const bytes = new TextEncoder().encode("typst executable fixture");
    const normal = content([entry(bytes)]);
    const reordered = {
      components: [{
        byteSize: bytes.byteLength,
        hash: hashBytes(bytes),
        relativePath: "tools/typst/typst",
        arch: "x64",
        platform: "linux",
        version: "0.15.2",
        id: "typst",
        role: "typstCli",
      }],
      signingKeyId: "release-key-1",
      kind: "trustedComponentManifest",
      version: 1,
    };
    expect(trustedComponentSigningBytes(normal)).toEqual(
      trustedComponentSigningBytes(reordered),
    );

    const keys = signingFixture();
    expect(sign(null, trustedComponentSigningBytes(normal), keys.privateKey)).toEqual(
      sign(null, trustedComponentSigningBytes(reordered), keys.privateKey),
    );
  });

  it("verifies a trusted Ed25519 key and rejects tampering or wrong signatures", () => {
    const bytes = new TextEncoder().encode("trusted bytes");
    const keys = signingFixture();
    const manifest = signContent(content([entry(bytes)]), keys.privateKey);
    expect(verifyTrustedComponentManifest(verifyOptions(manifest, keys.registry)))
      .toMatchObject({ signingKeyId: "release-key-1", components: [{ id: "typst" }] });

    const tampered = {
      ...manifest,
      components: [{ ...manifest.components[0], version: "0.15.3" }],
    };
    expect(() => verifyTrustedComponentManifest(verifyOptions(tampered, keys.registry)))
      .toThrowError(expect.objectContaining({ kind: "invalidSignature" }));

    const otherKeys = signingFixture();
    expect(() => verifyTrustedComponentManifest(verifyOptions(manifest, otherKeys.registry)))
      .toThrowError(expect.objectContaining({ kind: "invalidSignature" }));
    expect(() => verifyTrustedComponentManifest(verifyOptions(
      { ...manifest, signature: Buffer.alloc(64, 9).toString("base64") },
      keys.registry,
    ))).toThrowError(expect.objectContaining({ kind: "invalidSignature" }));
  });

  it("rejects unknown/non-Ed25519 keys and signed entries for another platform", () => {
    const bytes = new TextEncoder().encode("trusted bytes");
    const keys = signingFixture();
    const manifest = signContent(content([entry(bytes)]), keys.privateKey);
    expect(() => verifyTrustedComponentManifest(verifyOptions(manifest, {
      getEd25519PublicKey: () => undefined,
    }))).toThrowError(expect.objectContaining({ kind: "unknownSigningKey" }));

    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey
      .export({ format: "der", type: "spki" });
    expect(() => verifyTrustedComponentManifest(verifyOptions(manifest, {
      getEd25519PublicKey: () => new Uint8Array(rsa),
    }))).toThrowError(expect.objectContaining({ kind: "invalidSigningKey" }));

    const windowsContent = content([entry(bytes, { platform: "win32" })]);
    const windowsManifest = signContent(windowsContent, keys.privateKey);
    expect(() => verifyTrustedComponentManifest(verifyOptions(windowsManifest, keys.registry)))
      .toThrowError(expect.objectContaining({ kind: "platformMismatch" }));
  });

  it("rejects duplicate role/id pairs, paths, and non-canonical array order", () => {
    const bytes = new TextEncoder().encode("trusted bytes");
    const keys = signingFixture();
    const first = entry(bytes, {
      role: "bundledFontFace",
      id: "noto-regular",
      relativePath: "fonts/NotoSans-Regular.ttf",
    });
    const duplicateId = { ...first, relativePath: "fonts/NotoSans-Regular-copy.ttf" };
    const duplicateManifest = signUnvalidatedContent(content([first, duplicateId]) as unknown as Record<string, unknown>, keys.privateKey);
    expect(() => verifyTrustedComponentManifest(verifyOptions(duplicateManifest, keys.registry)))
      .toThrowError(expect.objectContaining({ kind: "duplicateComponent" }));

    const second = entry(bytes, { role: "typstCli", id: "typst" });
    const duplicatePath = { ...second, relativePath: "FONTS/notosans-regular.TTF" };
    const pathManifest = signUnvalidatedContent(content([first, duplicatePath]) as unknown as Record<string, unknown>, keys.privateKey);
    expect(() => verifyTrustedComponentManifest(verifyOptions(pathManifest, keys.registry)))
      .toThrowError(expect.objectContaining({ kind: "duplicatePath" }));

    const unorderedManifest = signUnvalidatedContent(content([second, first]) as unknown as Record<string, unknown>, keys.privateKey);
    expect(() => verifyTrustedComponentManifest(verifyOptions(unorderedManifest, keys.registry)))
      .toThrowError(expect.objectContaining({ kind: "nonCanonicalOrder" }));
  });

  it.each([
    "../typst",
    "/usr/bin/typst",
    "C:/tools/typst.exe",
    "tools\\typst.exe",
    "tools//typst",
    "tools/a..b/typst",
    "tools/typst.",
    "tools/CON/typst",
  ])("rejects a signed unsafe component path: %s", (relativePath) => {
    const bytes = new TextEncoder().encode("trusted bytes");
    const keys = signingFixture();
    const unsafe = content([entry(bytes, { relativePath })]);
    const manifest = signUnvalidatedContent(unsafe as unknown as Record<string, unknown>, keys.privateKey);
    expect(() => verifyTrustedComponentManifest(verifyOptions(manifest, keys.registry)))
      .toThrowError(expect.objectContaining({ kind: "invalidManifest" }));
  });
});

describe("Node trusted component registry", () => {
  it("verifies installed bytes and returns path-free immutable identities and locators", async () => {
    const root = await temporaryRoot();
    const bytes = new Uint8Array(192 * 1024 + 7);
    for (let index = 0; index < bytes.length; index++) bytes[index] = index % 239;
    const component = entry(bytes);
    await installEntry(root, component, bytes);
    const keys = signingFixture();
    const manifest = signContent(content([component]), keys.privateKey);
    const registry = await createNodeTrustedComponentRegistry({
      appRoot: root,
      manifest,
      trustedKeys: keys.registry,
      expectedPlatform: "linux",
      expectedArch: "x64",
    });

    const selected = await registry.resolve({ role: "typstCli", id: "typst" });
    expect(selected).toMatchObject({
      role: "typstCli",
      id: "typst",
      version: "0.15.2",
      hash: hashBytes(bytes),
      locator: { token: "trusted-component:0000" },
    });
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.components)).toBe(true);
    expect(Object.isFrozen(selected)).toBe(true);
    const serialized = JSON.stringify({ registry, selected });
    expect(serialized).not.toContain(root);
    expect(serialized).not.toContain("relativePath");
  });

  it("re-verifies selected bytes and rejects post-startup mutation", async () => {
    const root = await temporaryRoot();
    const bytes = new TextEncoder().encode("original trusted bytes");
    const component = entry(bytes);
    const target = await installEntry(root, component, bytes);
    const keys = signingFixture();
    const registry = await createNodeTrustedComponentRegistry({
      appRoot: root,
      manifest: signContent(content([component]), keys.privateKey),
      trustedKeys: keys.registry,
      expectedPlatform: "linux",
      expectedArch: "x64",
    });

    await writeFile(target, new TextEncoder().encode("tampered trusted bytes"));
    await expectKind(registry.resolve({ role: "typstCli", id: "typst" }), "componentVerificationFailed");
  });

  it("rejects changed/missing bytes and selection requests containing paths", async () => {
    const root = await temporaryRoot();
    const bytes = new TextEncoder().encode("trusted bytes");
    const component = entry(bytes);
    const keys = signingFixture();
    const manifest = signContent(content([component]), keys.privateKey);
    await expectKind(createNodeTrustedComponentRegistry({
      appRoot: root,
      manifest,
      trustedKeys: keys.registry,
      expectedPlatform: "linux",
      expectedArch: "x64",
    }), "componentVerificationFailed");

    await installEntry(root, component, bytes);
    const registry = await createNodeTrustedComponentRegistry({
      appRoot: root,
      manifest,
      trustedKeys: keys.registry,
      expectedPlatform: "linux",
      expectedArch: "x64",
    });
    await expectKind(registry.resolve({
      role: "typstCli",
      id: "typst",
      executablePath: "/usr/bin/typst",
    } as unknown as { role: "typstCli"; id: string }), "invalidSelection");
    await expectKind(registry.resolve({ role: "typstCli", id: "missing" }), "unknownComponent");
  });

  it.runIf(process.platform !== "win32")(
    "rejects symlink escapes and hardlinked installed components with redacted errors",
    async () => {
      const root = await temporaryRoot();
      const outside = await temporaryRoot("outside");
      const bytes = new TextEncoder().encode("trusted bytes");
      const component = entry(bytes);
      const target = join(root, ...component.relativePath.split("/"));
      await mkdir(dirname(target), { recursive: true });
      const outsideFile = join(outside, "typst");
      await writeFile(outsideFile, bytes);
      await symlink(outsideFile, target);
      const keys = signingFixture();
      const options = {
        appRoot: root,
        manifest: signContent(content([component]), keys.privateKey),
        trustedKeys: keys.registry,
        expectedPlatform: "linux" as const,
        expectedArch: "x64" as const,
      };
      try {
        await createNodeTrustedComponentRegistry(options);
        throw new Error("expected failure");
      } catch (error) {
        expect(error).toMatchObject({ kind: "componentVerificationFailed" });
        expect(`${String(error)}${JSON.stringify(error)}`).not.toContain(root);
        expect(`${String(error)}${JSON.stringify(error)}`).not.toContain(outside);
      }

      await rm(target);
      await link(outsideFile, target);
      await expectKind(createNodeTrustedComponentRegistry(options), "componentVerificationFailed");
    },
  );

  it("fails closed when the local manifest or app root is absent", async () => {
    const root = await temporaryRoot();
    const keys = signingFixture();
    await expectKind(createNodeTrustedComponentRegistry({
      appRoot: root,
      manifest: undefined,
      trustedKeys: keys.registry,
      expectedPlatform: "linux",
      expectedArch: "x64",
    }), "invalidManifest");

    const bytes = new TextEncoder().encode("trusted bytes");
    const manifest = signContent(content([entry(bytes)]), keys.privateKey);
    await expectKind(createNodeTrustedComponentRegistry({
      appRoot: join(root, "missing-private-root"),
      manifest,
      trustedKeys: keys.registry,
      expectedPlatform: "linux",
      expectedArch: "x64",
    }), "invalidAppRoot");
  });
});
