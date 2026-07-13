import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalJsonBytes, hashBytes } from "@cbb/core";
import {
  CBB_TRUSTED_COMPONENT_APPLICATION_ID,
  M3_MANDATORY_BUNDLED_FONT_FACES,
  M3_TRUSTED_COMPONENT_RELEASE_PROFILE,
  trustedComponentSigningBytes,
  type SignedTrustedComponentManifest,
  type TrustedBundledFontFaceBinding,
  type TrustedComponentManifestContent,
  type TrustedComponentManifestEntry,
  type TrustedComponentReleaseIdentity,
  type TrustedComponentRole,
} from "@cbb/services";
import { loadM4SchemaCatalog } from "./schemaCatalog.js";
import { loadPackagedM3PreviewRuntime } from "./packagedPreviewRuntime.js";

const roots: string[] = [];
const APP_VERSION = "4.0.0-test.1";
const RELEASE: TrustedComponentReleaseIdentity = Object.freeze({
  applicationId: CBB_TRUSTED_COMPONENT_APPLICATION_ID,
  releaseId: "4.0.0-test.1",
  releaseSequence: 4,
  profile: M3_TRUSTED_COMPONENT_RELEASE_PROFILE,
});

interface Fixture {
  readonly entry: TrustedComponentManifestEntry;
  readonly bytes: Uint8Array;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function fixture(
  role: TrustedComponentRole,
  id: string,
  relativePath: string,
  fontFaceBinding?: TrustedBundledFontFaceBinding,
): Fixture {
  const bytes = new TextEncoder().encode(`packaged:${role}:${id}`);
  return {
    bytes,
    entry: {
      role,
      id,
      version: "4.0.0-test.1",
      platform: "linux",
      arch: process.arch as "x64" | "arm64",
      relativePath,
      hash: hashBytes(bytes),
      byteSize: bytes.byteLength,
      ...(fontFaceBinding === undefined ? {} : { fontFaceBinding }),
    },
  };
}

function releaseFixtures(): Fixture[] {
  const singletons = [
    fixture("executionBroker", "broker", "components/execution-broker"),
    fixture("quarantineWorker", "quarantine", "components/quarantine-worker"),
    fixture("typstCli", "typst", "components/typst"),
    fixture("typstRuntimeClosure", "typst-runtime", "components/typst-runtime.json"),
    fixture("pdfInspector", "pdfinfo", "components/pdfinfo"),
    fixture("pdfStructuralInspector", "qpdf", "components/qpdf"),
    fixture("pdfFlattener", "pdftocairo", "components/pdftocairo"),
    fixture("pdfRuntimeClosure", "pdf-runtime", "components/pdf-runtime.json"),
    fixture("bookletCompositor", "compositor", "components/compositor"),
    fixture("schemaCatalog", "schemas", "components/schemas.bin"),
    fixture("localeData", "locales", "components/locales.bin"),
    fixture("genericStarterSet", "starters", "components/starters.bin"),
  ];
  const fonts = M3_MANDATORY_BUNDLED_FONT_FACES.map((binding, index) => fixture(
    "bundledFontFace",
    `font-${index.toString().padStart(2, "0")}-${binding.faceId}`,
    `components/fonts/${index.toString().padStart(2, "0")}-${binding.faceId}.ttf`,
    binding,
  ));
  return [...singletons, ...fonts].sort((left, right) => {
    const a = `${left.entry.role}\u0000${left.entry.id}`;
    const b = `${right.entry.role}\u0000${right.entry.id}`;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function signedManifest(fixtures: readonly Fixture[], privateKey: KeyObject): SignedTrustedComponentManifest {
  const content: TrustedComponentManifestContent = {
    version: 1,
    kind: "trustedComponentManifest",
    signingKeyId: "release-key-1",
    release: RELEASE,
    components: fixtures.map(({ entry }) => entry),
  };
  return {
    ...content,
    signature: sign(null, trustedComponentSigningBytes(content), privateKey).toString("base64"),
  };
}

async function installValidRelease(root: string): Promise<{
  readonly fixtures: readonly Fixture[];
  readonly manifest: SignedTrustedComponentManifest;
  readonly trustHash: ReturnType<typeof hashBytes>;
}> {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const fixtures = releaseFixtures();
  for (const item of fixtures) {
    const path = join(root, ...item.entry.relativePath.split("/"));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, item.bytes);
  }
  const manifest = signedManifest(fixtures, privateKey);
  const trust = {
    version: 1,
    kind: "trustedComponentTrust",
    appVersion: APP_VERSION,
    expectedRelease: RELEASE,
    keys: [{
      signingKeyId: "release-key-1",
      publicKeySpkiBase64: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    }],
  };
  await mkdir(join(root, "native/m3"), { recursive: true });
  const trustBytes = canonicalJsonBytes(trust);
  await Promise.all([
    writeFile(join(root, "native/m3/trusted-component-trust.json"), trustBytes),
    writeFile(join(root, "native/m3/trusted-components.json"), canonicalJsonBytes(manifest)),
  ]);
  return { fixtures, manifest, trustHash: hashBytes(trustBytes) };
}

async function load(
  root: string,
  appVersion = APP_VERSION,
  expectedTrustFileHash?: ReturnType<typeof hashBytes>,
) {
  return loadPackagedM3PreviewRuntime({
    applicationRoot: root,
    workspaceRoot: join(root, "workspace"),
    appVersion,
    catalog: await loadM4SchemaCatalog(resolve(process.cwd(), "schemas/v1")),
    ...(expectedTrustFileHash === undefined ? {} : { expectedTrustFileHash }),
  });
}

describe.runIf(process.platform === "linux" && (process.arch === "x64" || process.arch === "arm64"))(
  "packaged M3 preview runtime",
  () => {
    it("keeps preview optional only when both fixed release files are absent", async () => {
      const root = await mkdtemp(join(tmpdir(), "cbb-preview-runtime-absent-"));
      roots.push(root);
      await expect(load(root)).resolves.toBeUndefined();

      await mkdir(join(root, "native/m3"), { recursive: true });
      await writeFile(
        join(root, "native/m3/trusted-component-trust.json"),
        canonicalJsonBytes({ version: 1 }),
      );
      await expect(load(root)).rejects.toThrow("signed PDF preview runtime");
    });

    it("loads a complete signed release and exposes only gated service adapters", async () => {
      const root = await mkdtemp(join(tmpdir(), "cbb-preview-runtime-valid-"));
      roots.push(root);
      const release = await installValidRelease(root);

      await expect(load(root)).rejects.toThrow("signed PDF preview runtime");
      const runtime = await load(root, APP_VERSION, release.trustHash);
      expect(runtime?.serviceOptions).toEqual(expect.objectContaining({
        trustedRuntime: expect.any(Object),
        artifactPdfValidator: expect.any(Object),
        createBuildPorts: expect.any(Function),
      }));
      expect(runtime?.imageCanonicalizer).toEqual(expect.objectContaining({
        canonicalize: expect.any(Function),
      }));
      await expect(runtime?.serviceOptions.trustedRuntime?.verify()).resolves.toBeUndefined();
      expect(await statMissing(join(root, "workspace"))).toBe(true);
    });

    it("rejects a mismatched packaged app version before trusting the manifest", async () => {
      const root = await mkdtemp(join(tmpdir(), "cbb-preview-runtime-version-"));
      roots.push(root);
      const release = await installValidRelease(root);
      await expect(load(root, "4.0.1", release.trustHash)).rejects.toThrow("signed PDF preview runtime");
    });

    it("re-verifies component bytes at the lifetime gate and rejects post-load tampering", async () => {
      const root = await mkdtemp(join(tmpdir(), "cbb-preview-runtime-tamper-"));
      roots.push(root);
      const release = await installValidRelease(root);
      const runtime = await load(root, APP_VERSION, release.trustHash);
      const typst = release.fixtures.find((item) => item.entry.role === "typstCli")!;
      await writeFile(
        join(root, ...typst.entry.relativePath.split("/")),
        new Uint8Array(typst.bytes.byteLength).fill(0x78),
      );
      await expect(runtime?.serviceOptions.trustedRuntime?.verify()).rejects.toThrow();
    });
  },
);

async function statMissing(path: string): Promise<boolean> {
  try {
    await import("node:fs/promises").then(({ stat }) => stat(path));
    return false;
  } catch (error) {
    return error !== null && typeof error === "object" && "code" in error &&
      (error as { readonly code?: unknown }).code === "ENOENT";
  }
}
