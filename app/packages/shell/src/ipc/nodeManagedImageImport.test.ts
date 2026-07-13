import { readFileSync, readdirSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  canonicalJsonBytes,
  createSchemaCatalog,
  hashBytes,
  type SchemaObject,
} from "@cbb/core";
import {
  decodeCanonicalJson,
  parseWorkspaceRegistry,
  type TransactionRequest,
  type WorkspaceRegistry,
} from "@cbb/services";
import {
  QUARANTINE_HARD_LIMITS,
  quarantineHandle,
  runQuarantineRequest,
  type QuarantineRequest,
  type QuarantineSuccess,
  type VerifiedQuarantineReceipt,
} from "@cbb/workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { M3ApplicationServiceRoot, type M3EditableWorkspace } from "../composition.js";
import { M4_IMAGE_ASSET_LIMITS, NodeM4ImageAssetCatalog } from "./nodeImageAssetCatalog.js";
import {
  NodeM4ManagedImageImporter,
  type M4CanonicalizedImage,
  type M4ManagedImageCanonicalizer,
  type M4SelectedImageInput,
} from "./nodeManagedImageImport.js";

const roots: string[] = [];
let receiptSequence = 0;

function catalog() {
  const directory = resolve(process.cwd(), "schemas/v1");
  const schemas = new Map<string, SchemaObject>();
  for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".json"))) {
    const schema = JSON.parse(readFileSync(join(directory, name), "utf8")) as SchemaObject;
    schemas.set(schema.$id, schema);
  }
  return createSchemaCatalog(schemas);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function verifiedReceipt(
  input: M4SelectedImageInput,
  canonicalBytes: Uint8Array,
  width = 2,
  height = 3,
): Promise<VerifiedQuarantineReceipt> {
  receiptSequence += 1;
  const token = receiptSequence.toString(16).padStart(2, "0");
  const inputHandle = quarantineHandle(`qh:${"a".repeat(62)}${token}`);
  const outputHandle = quarantineHandle(`qh:${"b".repeat(62)}${token}`);
  const requestId = `00000000-0000-4000-8000-${receiptSequence.toString(16).padStart(12, "0")}`;
  const request: QuarantineRequest = input.operation === "canonicalizeRaster"
    ? {
        version: 1,
        requestId,
        operation: input.operation,
        input: inputHandle,
        output: outputHandle,
        limits: QUARANTINE_HARD_LIMITS.canonicalizeRaster,
      }
    : {
        version: 1,
        requestId,
        operation: input.operation,
        input: inputHandle,
        output: outputHandle,
        limits: QUARANTINE_HARD_LIMITS.sanitizeSvg,
      };
  const base = {
    version: 1 as const,
    requestId,
    status: "succeeded" as const,
    output: outputHandle,
    outputHash: hashBytes(canonicalBytes) as `sha256:${string}`,
    outputBytes: canonicalBytes.byteLength,
  };
  const result: QuarantineSuccess = input.operation === "canonicalizeRaster"
    ? {
        ...base,
        operation: input.operation,
        mediaType: "image/png",
        observed: {
          inputBytes: input.bytes.byteLength,
          decodedPixels: width * height,
          width,
          height,
        },
      }
    : {
        ...base,
        operation: input.operation,
        mediaType: "image/svg+xml",
        observed: { inputBytes: input.bytes.byteLength, xmlNodes: 1, pathCommands: 0 },
      };
  const broker = await runQuarantineRequest(
    request,
    {
      isolationAvailable: true,
      execute: async () => result,
      terminate: async () => undefined,
    },
    { raceTimeout: async (work) => ({ kind: "completed", value: await work }) },
    {
      verifyAndRehashInput: async (verification) => ({
        version: 1,
        requestId: verification.requestId,
        operation: verification.operation,
        input: verification.input,
        hash: hashBytes(input.bytes),
        byteSize: input.bytes.byteLength,
      }),
      verifyAndRehash: async (verification) => ({
        version: 1,
        requestId: verification.requestId,
        operation: verification.operation,
        output: verification.output,
        hash: hashBytes(canonicalBytes),
        byteSize: canonicalBytes.byteLength,
        mediaType: input.operation === "canonicalizeRaster" ? "image/png" : "image/svg+xml",
      }),
      cleanupInput: async () => undefined,
      discardOutput: async () => undefined,
    },
  );
  if (broker.status !== "succeeded") throw new Error("Could not mint test receipt");
  return broker.receipt;
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "cbb-m4-managed-image-"));
  roots.push(root);
  const registry: WorkspaceRegistry = {
    version: 1,
    kind: "workspace",
    workspaceId: "90000000-0000-4000-8000-000000000009" as WorkspaceRegistry["workspaceId"],
    assets: [],
  };
  await writeFile(join(root, "workspace.json"), canonicalJsonBytes(registry));
  const requests = new Map<string, TransactionRequest>();
  let transactionSequence = 0;
  const prepare = vi.fn(async (request: TransactionRequest) => {
    transactionSequence += 1;
    const transactionId = `70000000-0000-4000-8000-${transactionSequence.toString().padStart(12, "0")}`;
    requests.set(transactionId, request);
    return { transactionId, allocations: {}, journal: {} as never };
  });
  const commit = vi.fn(async (transactionId: string) => {
    const request = requests.get(transactionId);
    const marker = request?.mutations.find((mutation) => mutation.commitMarker === true);
    if (marker?.operation !== "put") throw new Error("Missing registry commit marker");
    await writeFile(join(root, "workspace.json"), marker.newBytes);
    return {} as never;
  });
  const rollback = vi.fn(async () => ({} as never));
  const workspace = {
    root,
    registry,
    transactions: { prepare, commit, rollback },
  } as unknown as M3EditableWorkspace;
  return { root, registry, workspace, prepare, commit, rollback };
}

function canonicalizer(canonicalBytes: Uint8Array): M4ManagedImageCanonicalizer {
  return {
    async canonicalize(input): Promise<M4CanonicalizedImage> {
      const receipt = await verifiedReceipt(input, canonicalBytes);
      return {
        bytes: canonicalBytes,
        mediaType: input.operation === "canonicalizeRaster" ? "image/png" : "image/svg+xml",
        canonicalHash: hashBytes(canonicalBytes),
        receipt,
        sanitizer: {
          toolId: "quarantine-worker",
          version: "m4-test.1",
          toolHash: hashBytes(new TextEncoder().encode("signed worker")),
        },
        ...(input.operation === "canonicalizeRaster"
          ? { pixelWidth: 2, pixelHeight: 3 }
          : {}),
      };
    },
  };
}

function ids(...values: string[]) {
  let index = 0;
  return { randomUuid: () => values[index++]! };
}

describe("managed image import", () => {
  it("commits canonical bytes, record, and registry through a real owned journal transaction", async () => {
    const parent = await mkdtemp(join(tmpdir(), "cbb-m4-managed-image-integration-"));
    roots.push(parent);
    const root = join(parent, "workspace");
    const schemas = catalog();
    const services = new M3ApplicationServiceRoot({
      catalog: schemas,
      appVersion: "m4-image-import-test",
    });
    const created = await services.createWorkspace({ root, displayName: "Images" });
    expect(created.status).toBe("editable");
    if (created.status !== "editable") return;
    const original = new Uint8Array([0xff, 0xd8, 0xff, 0xdb]);
    const canonical = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7]);
    try {
      const importer = new NodeM4ManagedImageImporter({
        workspace: created.workspace,
        catalog: schemas,
        chooseImage: async () => ({
          status: "selected",
          input: { bytes: original, originalFilename: "logo.jpg", operation: "canonicalizeRaster" },
        }),
        canonicalizer: canonicalizer(canonical),
        ids: ids(
          "10000000-0000-4000-8000-000000000001",
          "20000000-0000-4000-8000-000000000002",
        ),
        clock: { now: () => new Date("2026-07-13T12:34:56.000Z") },
      });
      const outcome = await importer.import();
      if (outcome.status !== "imported") throw new Error("Expected imported image");
      const registry = await importerResultRegistry(root);
      const imageCatalog = new NodeM4ImageAssetCatalog({ workspaceRoot: root });
      await expect(imageCatalog.list(registry)).resolves.toEqual([outcome.asset]);
      await expect(imageCatalog.read(
        registry,
        outcome.asset.localAssetId,
        outcome.asset.assetRef,
      )).resolves.toEqual(canonical);
    } finally {
      await services.close();
    }
  });

  it("turns JPEG input into an immutable PNG record and atomically advances the registry", async () => {
    const value = await fixture();
    const original = new Uint8Array([0xff, 0xd8, 0xff, 0xdb]);
    const canonical = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
    const importer = new NodeM4ManagedImageImporter({
      workspace: value.workspace,
      catalog: catalog(),
      chooseImage: async () => ({
        status: "selected",
        input: {
          bytes: original,
          originalFilename: "/home/church/We\u0301ekly Logo.JPG",
          operation: "canonicalizeRaster",
        },
      }),
      canonicalizer: canonicalizer(canonical),
      ids: ids(
        "10000000-0000-4000-8000-000000000001",
        "20000000-0000-4000-8000-000000000002",
      ),
      clock: { now: () => new Date("2026-07-13T12:34:56.000Z") },
    });

    await expect(importer.import()).resolves.toEqual({
      status: "imported",
      asset: {
        localAssetId: "10000000-0000-4000-8000-000000000001",
        assetRef: "asset:20000000-0000-4000-8000-000000000002",
        displayName: "Wéekly Logo",
        mediaType: "image/png",
        byteSize: canonical.byteLength,
        pixelWidth: 2,
        pixelHeight: 3,
        importedAt: "2026-07-13T12:34:56.000Z",
      },
    });
    expect(value.prepare).toHaveBeenCalledOnce();
    expect(value.commit).toHaveBeenCalledOnce();
    expect(value.rollback).not.toHaveBeenCalled();
    const request = value.prepare.mock.calls[0]![0];
    expect(request.mutations.map((mutation) => [mutation.resourceKey, mutation.commitMarker ?? false])).toEqual([
      ["assetCanonical:10000000-0000-4000-8000-000000000001", false],
      ["assetRecord:10000000-0000-4000-8000-000000000001", false],
      ["workspaceRegistry", true],
    ]);
    const recordMutation = request.mutations[1];
    if (recordMutation?.operation !== "put") throw new Error("missing record mutation");
    const record = decodeCanonicalJson(recordMutation.newBytes) as Record<string, unknown>;
    expect(record).toMatchObject({
      originalFilename: "Wéekly Logo.JPG",
      mediaType: "image/png",
      canonicalHash: hashBytes(canonical),
      sourceOriginal: { hash: hashBytes(original), byteSize: original.byteLength },
      sanitizer: { toolId: "quarantine-worker", version: "m4-test.1" },
    });
    expect(JSON.stringify(record)).not.toMatch(/\/home|file:\/\//u);
  });

  it("installs sanitized SVG bytes without inventing raster dimensions", async () => {
    const value = await fixture();
    const original = new TextEncoder().encode("<svg><script/></svg>");
    const canonical = new TextEncoder().encode("<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
    const importer = new NodeM4ManagedImageImporter({
      workspace: value.workspace,
      catalog: catalog(),
      chooseImage: async () => ({
        status: "selected",
        input: { bytes: original, originalFilename: "mark.svg", operation: "sanitizeSvg" },
      }),
      canonicalizer: canonicalizer(canonical),
      ids: ids(
        "30000000-0000-4000-8000-000000000003",
        "40000000-0000-4000-8000-000000000004",
      ),
      clock: { now: () => new Date("2026-07-13T12:34:56.000Z") },
    });
    await expect(importer.import()).resolves.toMatchObject({
      status: "imported",
      asset: { mediaType: "image/svg+xml", displayName: "mark" },
    });
    const asset = (await importerResultRegistry(value.root)).assets?.[0];
    expect(asset?.kind).toBe("asset");
  });

  it("does no canonicalization or transaction work when the native chooser is canceled", async () => {
    const value = await fixture();
    const canonicalize = vi.fn();
    const importer = new NodeM4ManagedImageImporter({
      workspace: value.workspace,
      catalog: catalog(),
      chooseImage: async () => ({ status: "canceled" }),
      canonicalizer: { canonicalize },
    });
    await expect(importer.import()).resolves.toEqual({ status: "canceled" });
    expect(canonicalize).not.toHaveBeenCalled();
    expect(value.prepare).not.toHaveBeenCalled();
  });

  it("serializes concurrent imports so the second registry commit retains the first asset", async () => {
    const value = await fixture();
    const selected: M4SelectedImageInput[] = [
      {
        bytes: new Uint8Array([0xff, 0xd8, 0xff, 1]),
        originalFilename: "first.jpg",
        operation: "canonicalizeRaster",
      },
      {
        bytes: new Uint8Array([0xff, 0xd8, 0xff, 2]),
        originalFilename: "second.jpg",
        operation: "canonicalizeRaster",
      },
    ];
    const canonical = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const importer = new NodeM4ManagedImageImporter({
      workspace: value.workspace,
      catalog: catalog(),
      chooseImage: async () => ({ status: "selected", input: selected.shift()! }),
      canonicalizer: canonicalizer(canonical),
      ids: ids(
        "10000000-0000-4000-8000-000000000001",
        "20000000-0000-4000-8000-000000000002",
        "30000000-0000-4000-8000-000000000003",
        "40000000-0000-4000-8000-000000000004",
      ),
    });

    await Promise.all([importer.import(), importer.import()]);
    expect(value.prepare).toHaveBeenCalledTimes(2);
    const registry = await importerResultRegistry(value.root);
    expect(registry.assets?.map((asset) => asset.displayName)).toEqual(["first", "second"]);
  });

  it("refuses to make the installed image catalog unreadable by exceeding its row limit", async () => {
    const value = await fixture();
    const timestamp = "2026-07-13T12:34:56.000Z";
    const fullRegistry: WorkspaceRegistry = {
      ...value.registry,
      assets: Array.from({ length: M4_IMAGE_ASSET_LIMITS.rows }, (_, index) => {
        const suffix = index.toString(16).padStart(12, "0");
        const localId = `10000000-0000-4000-8000-${suffix}`;
        return {
          localId: localId as NonNullable<WorkspaceRegistry["assets"]>[number]["localId"],
          kind: "asset",
          displayName: `Image ${index + 1}`,
          storagePath: `assets/${localId}/asset.json`,
          contentHash: hashBytes(new TextEncoder().encode(localId)),
          createdAt: timestamp,
          modifiedAt: timestamp,
        };
      }),
    };
    await writeFile(join(value.root, "workspace.json"), canonicalJsonBytes(fullRegistry));
    const input: M4SelectedImageInput = {
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      originalFilename: "one-too-many.jpg",
      operation: "canonicalizeRaster",
    };
    const canonical = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const importer = new NodeM4ManagedImageImporter({
      workspace: value.workspace,
      catalog: catalog(),
      chooseImage: async () => ({ status: "selected", input }),
      canonicalizer: canonicalizer(canonical),
    });

    await expect(importer.import()).rejects.toThrow(/supported image limit/u);
    expect(value.prepare).not.toHaveBeenCalled();
  });

  it("rejects inconsistent canonical evidence before preparing and rolls back a failed commit", async () => {
    const invalid = await fixture();
    const input: M4SelectedImageInput = {
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      originalFilename: "bad.jpg",
      operation: "canonicalizeRaster",
    };
    const canonical = new Uint8Array([1, 2, 3]);
    const receipt = await verifiedReceipt(input, canonical);
    const importer = new NodeM4ManagedImageImporter({
      workspace: invalid.workspace,
      catalog: catalog(),
      chooseImage: async () => ({ status: "selected", input }),
      canonicalizer: {
        canonicalize: async () => ({
          bytes: canonical,
          mediaType: "image/png",
          canonicalHash: hashBytes(new Uint8Array([9])),
          receipt,
          sanitizer: {
            toolId: "quarantine-worker",
            version: "m4-test.1",
            toolHash: hashBytes(new Uint8Array([8])),
          },
          pixelWidth: 2,
          pixelHeight: 3,
        }),
      },
    });
    await expect(importer.import()).rejects.toThrow(/inconsistent/u);
    expect(invalid.prepare).not.toHaveBeenCalled();

    const failed = await fixture();
    failed.commit.mockRejectedValueOnce(new Error("durable commit failed"));
    const failedImporter = new NodeM4ManagedImageImporter({
      workspace: failed.workspace,
      catalog: catalog(),
      chooseImage: async () => ({ status: "selected", input }),
      canonicalizer: canonicalizer(canonical),
      ids: ids(
        "50000000-0000-4000-8000-000000000005",
        "60000000-0000-4000-8000-000000000006",
      ),
    });
    await expect(failedImporter.import()).rejects.toThrow("durable commit failed");
    expect(failed.rollback).toHaveBeenCalledOnce();
  });
});

async function importerResultRegistry(root: string): Promise<WorkspaceRegistry> {
  const bytes = new Uint8Array(await import("node:fs/promises").then((fs) => fs.readFile(join(root, "workspace.json"))));
  return parseWorkspaceRegistry(decodeCanonicalJson(bytes), catalog());
}
