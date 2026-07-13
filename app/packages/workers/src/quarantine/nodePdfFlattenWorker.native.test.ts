import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { canonicalJsonBytes, hashBytes, type Sha256Hash } from "@cbb/core";
import { expect, it } from "vitest";
import { runQuarantineRequest, type QuarantineTimerPort } from "./broker.js";
import { NodeQuarantineHandleStore } from "./nodeHandles.js";
import { NodeLinuxPdfFlattenWorker } from "./nodePdfFlattenWorker.js";
import { QUARANTINE_HARD_LIMITS, type FlattenPdfRequest } from "./protocol.js";

const executeFile = promisify(execFile);
const RUN_NATIVE = process.platform === "linux" && process.env["CBB_RUN_NATIVE_M3"] === "1";
const TYPST = "/usr/bin/typst";
const PDFTOCAIRO = "/usr/bin/pdftocairo";
const PDFINFO = "/usr/bin/pdfinfo";
const QPDF = "/usr/bin/qpdf";
const BWRAP = "/usr/bin/bwrap";
const NOTO_SANS = "/usr/share/fonts/noto/NotoSans-Regular.ttf";

interface InstalledFile {
  readonly bytes: Uint8Array;
  executable: boolean;
}

interface PackagedTool {
  readonly path: string;
  readonly hash: Sha256Hash;
  readonly byteSize: number;
  readonly version: string;
}

async function elfClosure(executable: string): Promise<{
  readonly loader: { readonly source: string; readonly name: string };
  readonly libraries: readonly { readonly source: string; readonly name: string }[];
}> {
  const [{ stdout: headers }, { stdout: dependencies }] = await Promise.all([
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
  const interpreter = /Requesting program interpreter:\s*([^\]]+)\]/u.exec(headers)?.[1];
  const loaderName = interpreter?.split("/").at(-1);
  if (interpreter === undefined || !interpreter.startsWith("/") || loaderName === undefined) {
    throw new Error("Native PDF smoke requires dynamic ELF tools");
  }
  const loaderSource = await realpath(interpreter);
  const libraries = new Map<string, string>();
  for (const line of dependencies.split(/\r?\n/u)) {
    const value = line.trim();
    if (value.length === 0 || value.startsWith("linux-vdso")) continue;
    if (value.includes("not found")) throw new Error(`Unresolved PDF runtime dependency: ${value}`);
    const requestedPath = /=>\s*(\/[^\s]+)/u.exec(value)?.[1] ??
      /^(\/[^\s]+)/u.exec(value)?.[1];
    if (requestedPath === undefined) continue;
    const source = await realpath(requestedPath);
    if (source === loaderSource) continue;
    const name = requestedPath.split("/").at(-1);
    if (name === undefined) throw new Error("PDF runtime SONAME is unavailable");
    const previous = libraries.get(name);
    if (previous !== undefined && previous !== source) {
      throw new Error(`PDF runtime SONAME collision: ${name}`);
    }
    libraries.set(name, source);
  }
  return {
    loader: { source: loaderSource, name: loaderName },
    libraries: [...libraries]
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([name, source]) => ({ name, source })),
  };
}

async function packagePdfRuntime(root: string): Promise<{
  readonly tools: Readonly<Record<"pdftocairo" | "pdfinfo" | "qpdf", PackagedTool>>;
  readonly manifest: { readonly path: string; readonly hash: Sha256Hash; readonly byteSize: number };
}> {
  const installed = new Map<string, InstalledFile>();
  const addFile = async (
    source: string,
    relativePath: string,
    executable: boolean,
  ): Promise<void> => {
    const sourceBytes = new Uint8Array(await readFile(source));
    const previous = installed.get(relativePath);
    if (previous !== undefined) {
      if (hashBytes(previous.bytes) !== hashBytes(sourceBytes)) {
        throw new Error(`PDF runtime path collision: ${relativePath}`);
      }
      if (executable && !previous.executable) {
        previous.executable = true;
        await chmod(join(root, ...relativePath.split("/")), 0o700);
      }
      return;
    }
    const destination = join(root, ...relativePath.split("/"));
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
    await chmod(destination, executable ? 0o700 : 0o600);
    installed.set(relativePath, { bytes: sourceBytes, executable });
  };

  const toolSources = { pdftocairo: PDFTOCAIRO, pdfinfo: PDFINFO, qpdf: QPDF } as const;
  let loader: { readonly source: string; readonly name: string } | undefined;
  for (const [name, source] of Object.entries(toolSources)) {
    await addFile(source, `bin/${name}`, true);
    const closure = await elfClosure(source);
    if (loader !== undefined &&
      (loader.source !== closure.loader.source || loader.name !== closure.loader.name)) {
      throw new Error("PDF tools require different dynamic loaders");
    }
    loader = closure.loader;
    await addFile(closure.loader.source, `lib/${closure.loader.name}`, true);
    for (const library of closure.libraries) {
      await addFile(library.source, `lib/${library.name}`, false);
    }
  }
  if (loader === undefined) throw new Error("PDF runtime loader is unavailable");

  const copyTree = async (sourceRoot: string, relativeRoot: string): Promise<void> => {
    for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
      const sourcePath = join(sourceRoot, entry.name);
      const relativePath = `${relativeRoot}/${entry.name}`;
      const resolved = entry.isSymbolicLink() ? await realpath(sourcePath) : sourcePath;
      const stats = await lstat(resolved);
      if (stats.isDirectory()) await copyTree(resolved, relativePath);
      else if (stats.isFile()) await addFile(resolved, relativePath, false);
    }
  };
  await copyTree("/etc/fonts", "etc/fonts");
  await addFile(NOTO_SANS, "usr/share/fonts/noto/NotoSans-Regular.ttf", false);

  const files = [...installed]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([path, value]) => ({
      path,
      hash: hashBytes(value.bytes),
      byteSize: value.bytes.byteLength,
    }));
  const manifestBytes = canonicalJsonBytes({
    version: 1,
    kind: "cbbPdfRuntimeClosure",
    loaderPath: `lib/${loader.name}`,
    libraryDirectories: ["lib"],
    files,
  });
  const manifestPath = join(root, "cbb-pdf-runtime.json");
  await writeFile(manifestPath, manifestBytes, { mode: 0o600 });
  const tool = (name: keyof typeof toolSources, version: string): PackagedTool => {
    const value = installed.get(`bin/${name}`)!;
    return {
      path: join(root, "bin", name),
      hash: hashBytes(value.bytes),
      byteSize: value.bytes.byteLength,
      version,
    };
  };
  return {
    tools: {
      pdftocairo: tool("pdftocairo", "26.05.0"),
      pdfinfo: tool("pdfinfo", "26.05.0"),
      qpdf: tool("qpdf", "12.3.2"),
    },
    manifest: {
      path: manifestPath,
      hash: hashBytes(manifestBytes),
      byteSize: manifestBytes.byteLength,
    },
  };
}

const timer: QuarantineTimerPort = {
  async raceTimeout(work, timeoutMs) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work.then((value) => ({ kind: "completed" as const, value })),
        new Promise<{ readonly kind: "timedOut" }>((resolve) => {
          timer = setTimeout(() => resolve({ kind: "timedOut" }), timeoutMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  },
};

it.skipIf(!RUN_NATIVE)(
  "flattens a real two-page Typst PDF through Poppler and qpdf inside Bubblewrap",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "cbb-native-pdf-flatten-"));
    try {
      const closureRoot = join(root, "closure");
      const handlesRoot = join(root, "handles");
      const privateRuntimeRoot = join(root, "runs");
      await Promise.all([mkdir(closureRoot), mkdir(handlesRoot)]);
      const runtime = await packagePdfRuntime(closureRoot);

      const sourcePath = join(root, "source.typ");
      const sourcePdfPath = join(root, "source.pdf");
      await writeFile(sourcePath, [
        '#set text(font: "Noto Sans")',
        "= First page",
        "This source is generated by real Typst.",
        "#pagebreak()",
        "= Second page",
        "The flattened result must retain two pages.",
      ].join("\n"));
      await executeFile(TYPST, ["compile", sourcePath, sourcePdfPath], {
        env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", LANG: "C.UTF-8" },
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      });
      const sourcePdf = new Uint8Array(await readFile(sourcePdfPath));
      expect(Buffer.from(sourcePdf.subarray(0, 5)).toString("ascii")).toBe("%PDF-");

      const brokerPath = join(root, "execution-broker");
      const bubblewrapPath = await realpath(BWRAP);
      await writeFile(brokerPath, [
        `#!${process.execPath}`,
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        "const { createHash } = require('node:crypto');",
        "const { spawnSync } = require('node:child_process');",
        "const args = process.argv.slice(2);",
        "if (args.length === 1 && args[0] === '--cbb-linux-resource-broker-capabilities-v1') {",
        "  fs.writeSync(1, JSON.stringify({kind:'cbbLinuxResourceBrokerCapabilities',version:1,cpuTime:true,addressSpace:true,processCount:true,fileSize:true,openFiles:true,scratchQuota:true,outputQuota:true,mountIsolation:true,networkIsolation:true,processTreeTermination:true,runtimeClosureVerification:true}));",
        "} else {",
        "  const manifest = args.indexOf('--runtime-manifest-path');",
        "  const expected = args.indexOf('--runtime-manifest-hash');",
        "  if (manifest < 0 || expected < 0) process.exit(74);",
        "  const manifestBytes = fs.readFileSync(args[manifest + 1]);",
        "  const hash = 'sha256:' + createHash('sha256').update(manifestBytes).digest('hex');",
        "  if (hash !== args[expected + 1]) process.exit(75);",
        "  const closure = JSON.parse(manifestBytes.toString('utf8'));",
        "  const closureRoot = path.dirname(args[manifest + 1]);",
        "  for (const entry of closure.files) {",
        "    const bytes = fs.readFileSync(path.join(closureRoot, ...entry.path.split('/')));",
        "    const observed = 'sha256:' + createHash('sha256').update(bytes).digest('hex');",
        "    if (bytes.length !== entry.byteSize || observed !== entry.hash) process.exit(78);",
        "  }",
        "  const marker = args.indexOf('--cbb-sandbox-argv-v1');",
        "  if (marker < 0) process.exit(76);",
        `  const result = spawnSync(${JSON.stringify(bubblewrapPath)}, args.slice(marker + 1), { stdio: 'inherit', env: {} });`,
        "  process.exit(result.status === null ? 77 : result.status);",
        "}",
      ].join("\n"), { mode: 0o700 });
      await chmod(brokerPath, 0o700);
      const brokerBytes = new Uint8Array(await readFile(brokerPath));

      const handles = await NodeQuarantineHandleStore.create(handlesRoot);
      const input = await handles.registerInput(sourcePdf);
      const output = await handles.prepareOutput("flattenPdf");
      const request: FlattenPdfRequest = {
        version: 1,
        requestId: "99999999-9999-4999-8999-999999999999",
        operation: "flattenPdf",
        input,
        output,
        limits: QUARANTINE_HARD_LIMITS.flattenPdf,
      };
      const worker = await NodeLinuxPdfFlattenWorker.create({
        executionBroker: { path: brokerPath, hash: hashBytes(brokerBytes) },
        flattener: runtime.tools.pdftocairo,
        inspector: runtime.tools.pdfinfo,
        structuralInspector: runtime.tools.qpdf,
        runtimeManifest: runtime.manifest,
        privateRuntimeRoot,
        handles,
        maximumRuntimeMs: 60_000,
      });
      const result = await runQuarantineRequest(request, worker, timer, handles, {
        timeoutMs: 60_000,
      });
      if (result.status === "failed") throw new Error(result.reason);
      expect(result.result).toMatchObject({
        operation: "flattenPdf",
        status: "succeeded",
        mediaType: "application/pdf",
        observed: { inputBytes: sourcePdf.byteLength, pages: 2 },
        flattenedPages: 2,
      });
      const consumed = await handles.consumeVerifiedOutput(result.receipt);
      expect(consumed).toMatchObject({
        kind: "file",
        mediaType: "application/pdf",
        hash: result.result.outputHash,
      });
      if (consumed.kind !== "file") throw new Error("Expected flattened PDF file output");
      expect(Buffer.from(consumed.bytes.subarray(0, 5)).toString("ascii")).toBe("%PDF-");
      expect(consumed.bytes.byteLength).toBe(result.result.outputBytes);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  150_000,
);
