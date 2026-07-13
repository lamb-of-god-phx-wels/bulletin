import { hashBytes } from "@cbb/core";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runQuarantineRequest } from "./broker.js";
import { NodeQuarantineHandleStore } from "./nodeHandles.js";
import {
  QUARANTINE_HARD_LIMITS,
  quarantineArchiveClosureHash,
  validateQuarantineResult,
  type InspectArchiveRequest,
  type QuarantineOperation,
  type SanitizeSvgRequest,
} from "./protocol.js";

const temporaryRoots: string[] = [];
const encoder = new TextEncoder();
const bytes = (value: string): Uint8Array => encoder.encode(value);

async function temporaryRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `cbb-quarantine-${label}-`));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true }),
  ));
});

async function svgHarness(): Promise<{
  readonly store: NodeQuarantineHandleStore;
  readonly request: SanitizeSvgRequest;
}> {
  const root = await temporaryRoot("svg");
  const store = await NodeQuarantineHandleStore.create(root);
  const input = await store.registerInput(bytes("<svg/>"));
  const output = await store.prepareOutput("sanitizeSvg");
  return {
    store,
    request: {
      version: 1,
      requestId: "11111111-1111-4111-8111-111111111111",
      operation: "sanitizeSvg",
      input,
      output,
      limits: QUARANTINE_HARD_LIMITS.sanitizeSvg,
    },
  };
}

function outputVerification(
  request: { readonly requestId: string; readonly operation: QuarantineOperation; readonly output: SanitizeSvgRequest["output"] },
) {
  return {
    version: 1 as const,
    requestId: request.requestId,
    operation: request.operation,
    output: request.output,
    maximumBytes: 1024,
    maximumEntries: 1,
    maximumEntryBytes: 1024,
    allowedMediaTypes: ["image/svg+xml"] as const,
  };
}

describe("Node quarantine opaque handle store", () => {
  it("copies and rehashes a stable input, then detects later tampering", async () => {
    const { store, request } = await svgHarness();
    const verification = {
      version: 1 as const,
      requestId: request.requestId,
      operation: request.operation,
      input: request.input,
      maximumBytes: 1024,
    };
    await expect(store.verifyAndRehashInput(verification)).resolves.toMatchObject({
      hash: hashBytes(bytes("<svg/>")),
      byteSize: 6,
      input: request.input,
    });

    const binding = await store.bindForWorker(request);
    await writeFile(binding.inputPath, "changed");
    await expect(store.verifyAndRehashInput(verification)).rejects.toMatchObject({
      code: "CBB-SECURITY-0001",
      kind: "outputRejected",
    });
  });

  it("derives the output location, detects its closed media type, and cleans handles", async () => {
    const { store, request } = await svgHarness();
    const binding = await store.bindForWorker(request);
    expect(binding).toMatchObject({ outputKind: "file" });
    expect(binding.inputPath).not.toContain(request.input);
    expect(binding.outputPath).not.toContain(request.output);
    const output = bytes("<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
    await writeFile(binding.outputPath, output, { mode: 0o600 });

    await expect(store.verifyAndRehash(outputVerification(request))).resolves.toEqual({
      version: 1,
      requestId: request.requestId,
      operation: "sanitizeSvg",
      output: request.output,
      hash: hashBytes(output),
      byteSize: output.byteLength,
      mediaType: "image/svg+xml",
    });
    await store.cleanupInput(request.input);
    await store.discardOutput(request.output);
    await expect(readFile(binding.inputPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(binding.outputPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(store.cleanupInput(request.input)).resolves.toBeUndefined();
    await expect(store.discardOutput(request.output)).resolves.toBeUndefined();
  });

  it("reserves outputs per request and consumes verified receipts exactly once", async () => {
    const { store, request } = await svgHarness();
    const canonical = bytes("<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
    const workerResult = {
      version: 1 as const,
      requestId: request.requestId,
      operation: "sanitizeSvg" as const,
      status: "succeeded" as const,
      output: request.output,
      outputHash: hashBytes(canonical),
      outputBytes: canonical.byteLength,
      mediaType: "image/svg+xml" as const,
      observed: {
        inputBytes: bytes("<svg/>").byteLength,
        xmlNodes: 1,
        pathCommands: 0,
      },
    };
    expect(() => validateQuarantineResult(workerResult, request)).not.toThrow();
    const broker = await runQuarantineRequest(
      request,
      {
        isolationAvailable: true,
        async execute(workerRequest) {
          const binding = await store.bindForWorker(workerRequest);
          await writeFile(binding.outputPath, canonical, { mode: 0o600 });
          return workerResult;
        },
        async terminate() {},
      },
      { async raceTimeout(work) { return { kind: "completed", value: await work }; } },
      store,
    );
    if (broker.status === "failed") throw new Error(broker.reason);
    expect(broker).toMatchObject({ status: "succeeded" });
    if (broker.status !== "succeeded") return;
    await expect(store.consumeVerifiedOutput(broker.receipt)).resolves.toMatchObject({
      kind: "file",
      bytes: canonical,
      hash: hashBytes(canonical),
      mediaType: "image/svg+xml",
    });
    await expect(store.consumeVerifiedOutput(broker.receipt))
      .rejects.toMatchObject({ kind: "unknownHandle" });
  });

  it("rejects two request ids attempting to reserve the same output", async () => {
    const { store, request } = await svgHarness();
    await expect(store.bindForWorker(request)).resolves.toBeDefined();
    await expect(store.bindForWorker({
      ...request,
      requestId: "99999999-9999-4999-8999-999999999999",
    })).rejects.toMatchObject({ kind: "unknownHandle" });
    await store.cleanupInput(request.input);
    await store.discardOutput(request.output);
  });

  it("sweeps app-owned input and output residue before accepting new work", async () => {
    const root = await temporaryRoot("restart-sweep");
    const first = await NodeQuarantineHandleStore.create(root);
    const input = await first.registerInput(bytes("<svg/>"));
    const output = await first.prepareOutput("sanitizeSvg");
    const request: SanitizeSvgRequest = {
      version: 1,
      requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      operation: "sanitizeSvg",
      input,
      output,
      limits: QUARANTINE_HARD_LIMITS.sanitizeSvg,
    };
    const staleBinding = await first.bindForWorker(request);
    await writeFile(staleBinding.outputPath, "partial");

    const reopened = await NodeQuarantineHandleStore.create(root);
    await expect(readFile(staleBinding.inputPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(staleBinding.outputPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(reopened.registerInput(bytes("fresh"))).resolves.toMatch(/^qh:[0-9a-f]{64}$/u);
    await expect(reopened.prepareOutput("sanitizeSvg")).resolves.toMatch(/^qh:[0-9a-f]{64}$/u);
  });

  it("rejects symlink and hard-link output substitutions without reading their targets", async () => {
    const first = await svgHarness();
    const firstBinding = await first.store.bindForWorker(first.request);
    const victim = join(await temporaryRoot("victim"), "victim.svg");
    await writeFile(victim, "<svg>do not trust or remove</svg>");
    await rm(firstBinding.outputPath);
    await symlink(victim, firstBinding.outputPath);
    await expect(first.store.verifyAndRehash(outputVerification(first.request)))
      .rejects.toMatchObject({ kind: "outputRejected" });
    await first.store.discardOutput(first.request.output);
    expect(await readFile(victim, "utf8")).toContain("do not trust or remove");

    const second = await svgHarness();
    const secondBinding = await second.store.bindForWorker(second.request);
    await writeFile(secondBinding.outputPath, "<svg/>");
    await link(secondBinding.outputPath, join(await temporaryRoot("link"), "other.svg"));
    await expect(second.store.verifyAndRehash(outputVerification(second.request)))
      .rejects.toMatchObject({ kind: "outputRejected" });
  });

  it("rehashes the extracted archive closure with entry and aggregate budgets", async () => {
    const root = await temporaryRoot("archive");
    const store = await NodeQuarantineHandleStore.create(root);
    const input = await store.registerInput(bytes("fake archive bytes"));
    const output = await store.prepareOutput("inspectArchive");
    const request: InspectArchiveRequest = {
      version: 1,
      requestId: "22222222-2222-4222-8222-222222222222",
      operation: "inspectArchive",
      input,
      output,
      limits: QUARANTINE_HARD_LIMITS.inspectArchive,
    };
    const binding = await store.bindForWorker(request);
    await mkdir(join(binding.outputPath, "assets"));
    const logo = bytes("<svg/>");
    const bulletin = bytes("{\"version\":1}");
    await writeFile(join(binding.outputPath, "assets", "logo.svg"), logo);
    await writeFile(join(binding.outputPath, "bulletin.json"), bulletin);
    const closure = [
      { path: "assets/logo.svg", hash: hashBytes(logo) as `sha256:${string}`, byteSize: logo.byteLength },
      { path: "bulletin.json", hash: hashBytes(bulletin) as `sha256:${string}`, byteSize: bulletin.byteLength },
    ];
    const verification = {
      version: 1 as const,
      requestId: request.requestId,
      operation: request.operation,
      output,
      maximumBytes: logo.byteLength + bulletin.byteLength,
      maximumEntries: 2,
      maximumEntryBytes: bulletin.byteLength,
      allowedMediaTypes: ["application/vnd.cbb.quarantine-closure"] as const,
    };
    await expect(store.verifyAndRehash({ ...verification, maximumEntries: 1 }))
      .rejects.toMatchObject({ kind: "outputRejected" });
    await expect(store.verifyAndRehash({ ...verification, maximumBytes: logo.byteLength }))
      .rejects.toMatchObject({ kind: "outputRejected" });
    await expect(store.verifyAndRehash(verification)).resolves.toMatchObject({
      hash: quarantineArchiveClosureHash(closure),
      byteSize: logo.byteLength + bulletin.byteLength,
      mediaType: "application/vnd.cbb.quarantine-closure",
    });
  });

  it("rejects symlinks inside an archive closure", async () => {
    const root = await temporaryRoot("archive-link");
    const store = await NodeQuarantineHandleStore.create(root);
    const input = await store.registerInput(bytes("archive"));
    const output = await store.prepareOutput("inspectArchive");
    const request: InspectArchiveRequest = {
      version: 1,
      requestId: "33333333-3333-4333-8333-333333333333",
      operation: "inspectArchive",
      input,
      output,
      limits: QUARANTINE_HARD_LIMITS.inspectArchive,
    };
    const binding = await store.bindForWorker(request);
    const victim = join(await temporaryRoot("archive-victim"), "secret");
    await writeFile(victim, "secret");
    await symlink(victim, join(binding.outputPath, "linked"));
    await expect(store.verifyAndRehash({
      version: 1,
      requestId: request.requestId,
      operation: request.operation,
      output,
      maximumBytes: 100,
      maximumEntries: 2,
      maximumEntryBytes: 100,
      allowedMediaTypes: ["application/vnd.cbb.quarantine-closure"],
    })).rejects.toMatchObject({ kind: "outputRejected" });
  });
});
