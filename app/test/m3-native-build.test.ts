import { generateKeyPairSync, sign } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MANDATORY_BUNDLED_FONTS,
  hashBytes,
  parseLocalResourceId,
  type Sha256Hash,
} from "@cbb/core";
import {
  NodeCompileOutputHandleRegistry,
  NodeClosedTrustedComponentExecutor,
  createNodeTrustedComponentRegistry,
  createNodeArtifactPdfValidator,
  createNodeCompileOutputReader,
  createSignedNodeOfflineTypstSandbox,
  createSignedNodeBubblewrapQuarantineWorker,
  createSignedNodePdfInfoInspector,
  trustedComponentSigningBytes,
  runIsolatedTypstCompile,
  type ResourceStagingEntry,
  type SignedTrustedComponentManifest,
  type TrustedComponentManifestContent,
  type VerifiedResourceClosure,
} from "@cbb/services";
import { NodeQuarantineHandleStore } from "@cbb/workers";

const executeFile = promisify(execFile);

const RUN_NATIVE = process.platform === "linux" && process.env["CBB_RUN_NATIVE_M3"] === "1";
const TYPST = "/usr/bin/typst";
const BWRAP = "/usr/bin/bwrap";
const PDFINFO = "/usr/bin/pdfinfo";
const NOTO_SANS = "/usr/share/fonts/noto/NotoSans-Regular.ttf";
const NOTO_SYMBOLS = "/usr/share/fonts/noto/NotoSansSymbols2-Regular.ttf";
const NATIVE_EXPECTED_RELEASE = Object.freeze({
  applicationId: "church-bulletin-builder",
  releaseId: "m3-native-smoke.1",
  releaseSequence: 1,
  profile: "m3-v1",
});

async function bytes(path: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path));
}

describe.runIf(RUN_NATIVE)("native M3 offline build spine", () => {
  it("isolates Typst, stages exact mandatory fonts, inspects PDF, and persists before cleanup", async () => {
    const parent = await mkdtemp(join(tmpdir(), "cbb-m3-native-"));
    const buildParent = join(parent, "builds");
    const inspectParent = join(parent, "inspect");
    const quarantineRuntime = join(parent, "quarantine-runtime");
    const quarantineHandles = join(parent, "quarantine-handles");
    const quarantineSource = join(parent, "quarantine-worker.c");
    const quarantineExecutable = join(parent, "quarantine-worker");
    await mkdir(buildParent, { mode: 0o700 });
    await Promise.all([
      mkdir(quarantineRuntime, { mode: 0o700 }),
      mkdir(quarantineHandles, { mode: 0o700 }),
    ]);
    await writeFile(quarantineSource, [
      "#include <string.h>",
      "int main(int argc, char **argv) {",
      "  return argc == 2 && strcmp(argv[1], \"--probe\") == 0 ? 0 : 64;",
      "}",
      "",
    ].join("\n"));
    await executeFile(process.env["CC"] ?? "/usr/bin/cc", [
      "-static", "-O2", "-s", "-o", quarantineExecutable, quarantineSource,
    ], {
      env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin" },
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });

    const [typstBytes, bwrapBytes, pdfinfoBytes, quarantineBytes, sansBytes, symbolsBytes] = await Promise.all([
      bytes(TYPST), bytes(BWRAP), bytes(PDFINFO), bytes(quarantineExecutable), bytes(NOTO_SANS), bytes(NOTO_SYMBOLS),
    ]);
    const typstHash = hashBytes(typstBytes);
    const bwrapHash = hashBytes(bwrapBytes);
    const executor = new NodeClosedTrustedComponentExecutor();
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const content: TrustedComponentManifestContent = {
      version: 1,
      kind: "trustedComponentManifest",
      signingKeyId: "native-smoke-key",
      release: NATIVE_EXPECTED_RELEASE,
      components: [
        { role: "executionBroker", id: "bubblewrap", version: "0.11.2", platform: "linux", arch: "x64", relativePath: "usr/bin/bwrap", hash: bwrapHash, byteSize: bwrapBytes.byteLength },
        { role: "pdfInspector", id: "poppler-pdfinfo", version: "26.05.0", platform: "linux", arch: "x64", relativePath: "usr/bin/pdfinfo", hash: hashBytes(pdfinfoBytes), byteSize: pdfinfoBytes.byteLength },
        { role: "quarantineWorker", id: "quarantine-worker", version: "m3-probe.1", platform: "linux", arch: "x64", relativePath: quarantineExecutable.slice(1), hash: hashBytes(quarantineBytes), byteSize: quarantineBytes.byteLength },
        { role: "typstCli", id: "typst", version: "0.14.2", platform: "linux", arch: "x64", relativePath: "usr/bin/typst", hash: typstHash, byteSize: typstBytes.byteLength },
      ],
    };
    const manifest: SignedTrustedComponentManifest = {
      ...content,
      signature: sign(null, trustedComponentSigningBytes(content), privateKey).toString("base64"),
    };
    const registry = await createNodeTrustedComponentRegistry({
      appRoot: "/",
      manifest,
      trustedKeys: {
        getEd25519PublicKey: (id) => id === "native-smoke-key"
          ? new Uint8Array(publicKey.export({ format: "der", type: "spki" }))
          : undefined,
      },
      expectedRelease: NATIVE_EXPECTED_RELEASE,
      expectedPlatform: "linux",
      expectedArch: "x64",
      nativeExecutor: executor,
    });
    const brokerComponent = await registry.resolve({ role: "executionBroker", id: "bubblewrap" });
    const typstComponent = await registry.resolve({ role: "typstCli", id: "typst" });
    const pdfComponent = await registry.resolve({ role: "pdfInspector", id: "poppler-pdfinfo" });
    const quarantineComponent = await registry.resolve({ role: "quarantineWorker", id: "quarantine-worker" });
    const quarantine = await createSignedNodeBubblewrapQuarantineWorker({
      runtimeRoot: quarantineRuntime,
      handles: await NodeQuarantineHandleStore.create(quarantineHandles),
      registry,
      executor,
      executionBroker: brokerComponent.locator,
      quarantineWorker: quarantineComponent.locator,
    });
    expect(quarantine.isolationAvailable).toBe(true);
    const inspector = await createSignedNodePdfInfoInspector({
      privateInspectionParent: inspectParent,
      registry,
      executor,
      executionBroker: brokerComponent.locator,
      pdfInspector: pdfComponent.locator,
    });
    const pdfs = createNodeArtifactPdfValidator({
      inspector,
      pinnedIdentity: inspector.identity,
    });
    const outputHandles = await NodeCompileOutputHandleRegistry.create(buildParent);
    const resourceBytes = new Map<Sha256Hash, Uint8Array>([
      [hashBytes(sansBytes), sansBytes],
      [hashBytes(symbolsBytes), symbolsBytes],
    ]);
    const sandbox = await createSignedNodeOfflineTypstSandbox({
      privateBuildParent: buildParent,
      registry,
      executor,
      executionBroker: brokerComponent.locator,
      typst: typstComponent.locator,
      resources: {
        async read(entry) {
          const value = resourceBytes.get(entry.hash);
          if (value === undefined) throw new Error("unknown staged resource");
          return new Uint8Array(value);
        },
      },
      pdfs,
      outputHandles,
    });

    const localIds = [
      parseLocalResourceId("10000000-0000-4000-8000-000000000001"),
      parseLocalResourceId("10000000-0000-4000-8000-000000000002"),
    ] as const;
    const fontBytes = [sansBytes, symbolsBytes] as const;
    const stagingEntries: ResourceStagingEntry[] = MANDATORY_BUNDLED_FONTS.map(
      (font, index) => ({
        kind: "fontFace" as const,
        fontRef: font.fontRef,
        faceId: "regular",
        locator: { kind: "fontFace" as const, localId: localIds[index]!, faceId: "regular" },
        relativePath: `fonts/f${index.toString().padStart(4, "0")}-0000.ttf`,
        hash: hashBytes(fontBytes[index]!),
        byteSize: fontBytes[index]!.byteLength,
        format: "ttf" as const,
      }),
    );
    const closure: VerifiedResourceClosure = Object.freeze({
      assets: Object.freeze([]),
      fonts: Object.freeze(MANDATORY_BUNDLED_FONTS.map((font, index) => Object.freeze({
        fontRef: font.fontRef,
        familyDigest: hashBytes(new TextEncoder().encode(font.familyName)),
        selectedFaces: Object.freeze([Object.freeze({
          faceId: "regular",
          faceHash: stagingEntries[index]!.hash,
          faceIndex: 0,
          embedding: "subset" as const,
        })]),
      }))),
      assetBindings: Object.freeze({}),
      fontBindings: Object.freeze(Object.fromEntries(
        MANDATORY_BUNDLED_FONTS.map((font) => [font.fontRef, Object.freeze({ familyName: font.familyName })]),
      )),
      stagingEntries: Object.freeze(stagingEntries),
      warnings: Object.freeze([]),
      totals: Object.freeze({
        assetCount: 0,
        assetBytes: 0,
        fontFamilyCount: 2,
        fontFaceCount: 2,
        fontBytes: sansBytes.byteLength + symbolsBytes.byteLength,
      }),
    });
    const source = [
      '#set text(font: ("Noto Sans", "Noto Sans Symbols 2"))',
      "= Native M3 build",
      "Offline, deterministic, and isolated.",
    ].join("\n");
    const outputReader = createNodeCompileOutputReader(outputHandles);
    const result = await runIsolatedTypstCompile(
      {
        buildId: "30000000-0000-4000-8000-000000000001",
        source,
        sourceHash: hashBytes(new TextEncoder().encode(source)),
        resources: closure,
      },
      { toolId: "typst", version: "0.14.2", executableHash: typstHash },
      sandbox,
      {
        async raceTimeout(work, timeoutMs) {
          return Promise.race([
            work.then((value) => ({ kind: "completed" as const, value })),
            new Promise<{ readonly kind: "timedOut" }>((resolveTimeout) => {
              setTimeout(() => resolveTimeout({ kind: "timedOut" }), timeoutMs);
            }),
          ]);
        },
      },
      {
        async persistCompile(evidence) {
          const pdfBytes = await outputReader.readVerifiedPdf(evidence.pdf.handle);
          return Object.freeze({
            pdfHash: hashBytes(pdfBytes),
            byteSize: pdfBytes.byteLength,
            pageCount: evidence.pdf.pageCount,
          });
        },
      },
    );
    expect(result).toMatchObject({
      status: "succeeded",
      artifact: { pageCount: 1 },
    });
  }, 60_000);
});
