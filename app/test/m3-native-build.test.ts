import { generateKeyPairSync, sign } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, copyFile, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalJsonBytes,
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

interface PackagedRuntime {
  readonly root: string;
  readonly tool: { readonly path: string; readonly hash: Sha256Hash; readonly byteSize: number };
  readonly manifest: { readonly path: string; readonly hash: Sha256Hash; readonly byteSize: number };
}

async function elfRuntimePaths(executable: string): Promise<{
  readonly loader: { readonly source: string; readonly name: string };
  readonly libraries: readonly { readonly source: string; readonly name: string }[];
}> {
  const [{ stdout: programHeaders }, { stdout: dependencies }] = await Promise.all([
    executeFile("readelf", ["-lW", executable], {
      env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", LANG: "C" },
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    }),
    executeFile("ldd", [executable], {
      env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", LANG: "C" },
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    }),
  ]);
  const interpreter = /Requesting program interpreter:\s*([^\]]+)\]/u.exec(programHeaders)?.[1];
  if (interpreter === undefined || !interpreter.startsWith("/")) {
    throw new Error("Native smoke requires a dynamically linked ELF tool");
  }
  const loaderSource = await realpath(interpreter);
  const loaderName = interpreter.split("/").at(-1);
  if (loaderName === undefined) throw new Error("Dynamic loader name is unavailable");
  const libraries = new Map<string, string>();
  for (const line of dependencies.split(/\r?\n/u)) {
    const value = line.trim();
    if (value.length === 0 || value.startsWith("linux-vdso")) continue;
    if (value.includes("not found")) throw new Error(`Unresolved native dependency: ${value}`);
    const path = /=>\s*(\/[^\s]+)/u.exec(value)?.[1] ?? /^(\/[^\s]+)/u.exec(value)?.[1];
    if (path === undefined) continue;
    const resolved = await realpath(path);
    if (resolved !== loaderSource) {
      const name = path.split("/").at(-1);
      if (name === undefined) throw new Error("Library name is unavailable");
      const existing = libraries.get(name);
      if (existing !== undefined && existing !== resolved) {
        throw new Error(`Runtime library name collision: ${name}`);
      }
      libraries.set(name, resolved);
    }
  }
  return {
    loader: { source: loaderSource, name: loaderName },
    libraries: [...libraries]
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([name, source]) => ({ name, source })),
  };
}

async function packageRuntime(options: {
  readonly parent: string;
  readonly directoryName: string;
  readonly toolName: string;
  readonly toolPath: string;
  readonly manifestName: string;
  readonly manifestKind: string;
}): Promise<PackagedRuntime> {
  const root = join(options.parent, options.directoryName);
  await Promise.all([
    mkdir(join(root, "bin"), { recursive: true }),
    mkdir(join(root, "lib"), { recursive: true }),
  ]);
  const closure = await elfRuntimePaths(options.toolPath);
  const copied = new Map<string, Uint8Array>();
  const install = async (source: string, relativePath: string, executable: boolean): Promise<void> => {
    const destination = join(root, ...relativePath.split("/"));
    const sourceBytes = await bytes(source);
    const existing = copied.get(relativePath);
    if (existing !== undefined && hashBytes(existing) !== hashBytes(sourceBytes)) {
      throw new Error(`Runtime basename collision: ${relativePath}`);
    }
    if (existing !== undefined) return;
    await copyFile(source, destination);
    await chmod(destination, executable ? 0o700 : 0o600);
    copied.set(relativePath, sourceBytes);
  };
  await install(options.toolPath, `bin/${options.toolName}`, true);
  const loaderName = closure.loader.name;
  await install(closure.loader.source, `lib/${loaderName}`, true);
  for (const library of closure.libraries) {
    await install(library.source, `lib/${library.name}`, false);
  }
  const files = [...copied]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([path, value]) => ({ path, hash: hashBytes(value), byteSize: value.byteLength }));
  const manifestBytes = canonicalJsonBytes({
    version: 1,
    kind: options.manifestKind,
    loaderPath: `lib/${loaderName}`,
    libraryDirectories: ["lib"],
    files,
  });
  const manifestPath = join(root, options.manifestName);
  await writeFile(manifestPath, manifestBytes, { mode: 0o600 });
  const toolBytes = copied.get(`bin/${options.toolName}`)!;
  return {
    root,
    tool: {
      path: join(root, "bin", options.toolName),
      hash: hashBytes(toolBytes),
      byteSize: toolBytes.byteLength,
    },
    manifest: {
      path: manifestPath,
      hash: hashBytes(manifestBytes),
      byteSize: manifestBytes.byteLength,
    },
  };
}

describe.runIf(RUN_NATIVE)("native M3 offline build spine", () => {
  it("isolates Typst, stages exact mandatory fonts, inspects PDF, and persists before cleanup", async () => {
    const parent = await mkdtemp(join(tmpdir(), "cbb-m3-native-"));
    try {
    const buildParent = join(parent, "builds");
    const inspectParent = join(parent, "inspect");
    const quarantineRuntime = join(parent, "quarantine-runtime");
    const quarantineHandles = join(parent, "quarantine-handles");
    const quarantineSource = join(parent, "quarantine-worker.c");
    const quarantineExecutable = join(parent, "quarantine-worker");
    const brokerExecutable = join(parent, "execution-broker");
    await mkdir(buildParent, { mode: 0o700 });
    await Promise.all([
      mkdir(quarantineRuntime, { mode: 0o700 }),
      mkdir(quarantineHandles, { mode: 0o700 }),
    ]);
    const [typstRuntime, pdfRuntime] = await Promise.all([
      packageRuntime({
        parent,
        directoryName: "typst-runtime",
        toolName: "typst",
        toolPath: TYPST,
        manifestName: "cbb-typst-runtime.json",
        manifestKind: "cbbTypstRuntimeClosure",
      }),
      packageRuntime({
        parent,
        directoryName: "pdf-runtime",
        toolName: "pdfinfo",
        toolPath: PDFINFO,
        manifestName: "cbb-pdf-runtime.json",
        manifestKind: "cbbPdfRuntimeClosure",
      }),
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
    await writeFile(brokerExecutable, [
      `#!${process.execPath}`,
      "const fs = require('node:fs');",
      "const { createHash } = require('node:crypto');",
      "const { spawnSync } = require('node:child_process');",
      "const args = process.argv.slice(2);",
      "if (args.length === 1 && args[0] === '--cbb-linux-resource-broker-capabilities-v1') {",
      "  fs.writeSync(1, JSON.stringify({kind:'cbbLinuxResourceBrokerCapabilities',version:1,cpuTime:true,addressSpace:true,processCount:true,fileSize:true,openFiles:true,scratchQuota:true,outputQuota:true,mountIsolation:true,networkIsolation:true,processTreeTermination:true,runtimeClosureVerification:true}));",
      "} else {",
      "  const manifest = args.indexOf('--runtime-manifest-path');",
      "  const manifestHash = args.indexOf('--runtime-manifest-hash');",
      "  if (manifest >= 0 || manifestHash >= 0) {",
      "    if (manifest < 0 || manifestHash < 0) process.exit(74);",
      "    const observed = 'sha256:' + createHash('sha256').update(fs.readFileSync(args[manifest + 1])).digest('hex');",
      "    if (observed !== args[manifestHash + 1]) process.exit(75);",
      "  }",
      "  const marker = args.indexOf('--cbb-sandbox-argv-v1');",
      "  if (marker < 0) process.exit(72);",
      `  const result = spawnSync(${JSON.stringify(BWRAP)}, args.slice(marker + 1), { stdio: 'inherit', env: {} });`,
      "  process.exit(result.status === null ? 73 : result.status);",
      "}",
      "",
    ].join("\n"), { mode: 0o700 });

    const [brokerBytes, quarantineBytes, sansBytes, symbolsBytes] = await Promise.all([
      bytes(brokerExecutable), bytes(quarantineExecutable), bytes(NOTO_SANS), bytes(NOTO_SYMBOLS),
    ]);
    const typstHash = typstRuntime.tool.hash;
    const brokerHash = hashBytes(brokerBytes);
    const executor = new NodeClosedTrustedComponentExecutor();
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const content: TrustedComponentManifestContent = {
      version: 1,
      kind: "trustedComponentManifest",
      signingKeyId: "native-smoke-key",
      release: NATIVE_EXPECTED_RELEASE,
      components: [
        { role: "executionBroker", id: "cbb-linux-resource-broker", version: "m3-test.1", platform: "linux", arch: "x64", relativePath: brokerExecutable.slice(1), hash: brokerHash, byteSize: brokerBytes.byteLength },
        { role: "pdfInspector", id: "poppler-pdfinfo", version: "26.05.0", platform: "linux", arch: "x64", relativePath: pdfRuntime.tool.path.slice(1), hash: pdfRuntime.tool.hash, byteSize: pdfRuntime.tool.byteSize },
        { role: "pdfRuntimeClosure", id: "poppler-runtime", version: "26.05.0", platform: "linux", arch: "x64", relativePath: pdfRuntime.manifest.path.slice(1), hash: pdfRuntime.manifest.hash, byteSize: pdfRuntime.manifest.byteSize },
        { role: "quarantineWorker", id: "quarantine-worker", version: "m3-probe.1", platform: "linux", arch: "x64", relativePath: quarantineExecutable.slice(1), hash: hashBytes(quarantineBytes), byteSize: quarantineBytes.byteLength },
        { role: "typstCli", id: "typst", version: "0.14.2", platform: "linux", arch: "x64", relativePath: typstRuntime.tool.path.slice(1), hash: typstHash, byteSize: typstRuntime.tool.byteSize },
        { role: "typstRuntimeClosure", id: "typst-runtime", version: "0.14.2", platform: "linux", arch: "x64", relativePath: typstRuntime.manifest.path.slice(1), hash: typstRuntime.manifest.hash, byteSize: typstRuntime.manifest.byteSize },
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
    const brokerComponent = await registry.resolve({ role: "executionBroker", id: "cbb-linux-resource-broker" });
    const typstComponent = await registry.resolve({ role: "typstCli", id: "typst" });
    const pdfComponent = await registry.resolve({ role: "pdfInspector", id: "poppler-pdfinfo" });
    const pdfRuntimeComponent = await registry.resolve({ role: "pdfRuntimeClosure", id: "poppler-runtime" });
    const quarantineComponent = await registry.resolve({ role: "quarantineWorker", id: "quarantine-worker" });
    const typstRuntimeComponent = await registry.resolve({ role: "typstRuntimeClosure", id: "typst-runtime" });
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
      pdfRuntime: pdfRuntimeComponent.locator,
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
      typstRuntime: typstRuntimeComponent.locator,
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
      '#show <cbb-source>: it => context [#metadata((..it.value, page: here().page())) <cbb-located>]',
      '#metadata((resolvedId: "nativeTitle", sourceElementId: "nativeTitle", region: "body")) <cbb-source>',
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
            navigationMap: evidence.pdf.navigationMap,
          });
        },
      },
    );
    expect(result).toMatchObject({
      status: "succeeded",
      artifact: {
        pageCount: 1,
        navigationMap: {
          version: 1,
          entries: [{
            resolvedId: "nativeTitle",
            sourceElementId: "nativeTitle",
            pageNumber: 1,
            region: "body",
          }],
        },
      },
    });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  }, 120_000);
});
