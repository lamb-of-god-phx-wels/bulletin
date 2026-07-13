import { mkdtemp, readFile } from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createSchemaCatalog,
  fromJson,
  hashBytes,
  parseLocalResourceId,
  parsePortableAssetRef,
  resolveDocument,
  type IdPort,
  type SchemaObject,
} from "../packages/core/src/index.js";
import {
  DocumentPersistenceService,
  JournaledTransactionCoordinator,
  NodeWorkspaceTransactionStorage,
  SaveJournalRecoveryService,
  WorkspaceService,
  createNodeFileSystemPort,
  createNodeNoFollowResourceByteVerifier,
  createResourceResolverIndex,
  parseWorkspaceRegistry,
  planAssetRevisionInstall,
  materializeMandatoryFontFallbacks,
  resolveVerifiedResourceClosure,
  workspaceResourceTransactionPaths,
  type ClockPort,
  type EditableWorkspaceSession,
  type ProcessIdentityPort,
  type SchedulerPort,
  type ServicePorts,
  type TransactionDigest,
} from "../packages/services/src/index.js";
import {
  QUARANTINE_HARD_LIMITS,
  quarantineHandle,
  runQuarantineRequest,
  type VerifiedQuarantineReceipt,
} from "@cbb/workers";

const FIXTURE_PATH = resolve(process.cwd(), "test/fixtures/full-featured-bulletin.json");
const LOGO_PATH = resolve(process.cwd(), "test/fixtures/demo-logo.svg");
const ASSET_REF = parsePortableAssetRef(
  "asset:44444444-4444-4444-8444-444444444444",
);

async function verifiedSvgReceipt(bytes: Uint8Array): Promise<VerifiedQuarantineReceipt> {
  const input = quarantineHandle(`qh:${"a".repeat(64)}`);
  const output = quarantineHandle(`qh:${"b".repeat(64)}`);
  const request = {
    version: 1 as const,
    requestId: "70000000-0000-4000-8000-000000000001",
    operation: "sanitizeSvg" as const,
    input,
    output,
    limits: QUARANTINE_HARD_LIMITS.sanitizeSvg,
  };
  const hash = hashBytes(bytes);
  const result = await runQuarantineRequest(
    request,
    {
      isolationAvailable: true,
      execute: async () => ({
        version: 1,
        requestId: request.requestId,
        operation: request.operation,
        status: "succeeded",
        output,
        outputHash: hash,
        outputBytes: bytes.byteLength,
        mediaType: "image/svg+xml",
        observed: { inputBytes: bytes.byteLength, xmlNodes: 1, pathCommands: 0 },
      }),
      terminate: async () => undefined,
    },
    { raceTimeout: async (work) => ({ kind: "completed", value: await work }) },
    {
      verifyAndRehashInput: async (verification) => ({
        version: 1,
        requestId: verification.requestId,
        operation: verification.operation,
        input: verification.input,
        hash,
        byteSize: bytes.byteLength,
      }),
      verifyAndRehash: async (verification) => ({
        version: 1,
        requestId: verification.requestId,
        operation: verification.operation,
        output: verification.output,
        hash,
        byteSize: bytes.byteLength,
        mediaType: "image/svg+xml",
      }),
      cleanupInput: async () => undefined,
      discardOutput: async () => undefined,
    },
  );
  if (result.status !== "succeeded") throw new Error("SVG quarantine verification failed");
  return result.receipt;
}

function catalog() {
  const root = resolve(process.cwd(), "schemas/v1");
  const schemas = new Map<string, SchemaObject>();
  for (const name of readdirSync(root).filter((entry) => entry.endsWith(".json"))) {
    const schema = JSON.parse(readFileSync(join(root, name), "utf8")) as SchemaObject;
    schemas.set(schema.$id, schema);
  }
  return createSchemaCatalog(schemas);
}

function ids(): IdPort {
  let value = 1;
  return {
    randomUuid() {
      return `00000000-0000-4000-8000-${(value++).toString(16).padStart(12, "0")}`;
    },
  };
}

const clock: ClockPort = { now: () => new Date("2026-07-12T12:00:00.000Z") };
const scheduler: SchedulerPort = {
  setInterval: () => ({ timer: true }),
  clearInterval: () => undefined,
};
const processIdentity: ProcessIdentityPort = {
  current: () => ({
    pid: 123,
    hostUserDiscriminator: `sha256:${"9".repeat(64)}`,
    processStartedAt: "2026-07-12T11:59:00.000Z",
  }),
  check: async () => "liveMatch",
};

describe("durable M3 workspace/resource spine", () => {
  it("saves a bulletin, transactionally installs its asset, and resolves verified build bytes", async () => {
    const parent = await mkdtemp(join(tmpdir(), "cbb-m3-spine-"));
    const root = join(parent, "workspace");
    const idPort = ids();
    const ports: ServicePorts = {
      fileSystem: createNodeFileSystemPort(),
      clock,
      scheduler,
      ids: idPort,
      processIdentity,
    };
    const schemas = catalog();
    const saveRecovery = new SaveJournalRecoveryService(ports, schemas);
    const workspace = new WorkspaceService(ports, schemas, saveRecovery, "m3-test");
    const opened = await workspace.create({ root, displayName: "Test Church" });
    expect(opened.status).toBe("editable");
    if (opened.status !== "editable") return;
    const session = opened.session as EditableWorkspaceSession;

    const raw = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as unknown;
    const document = fromJson(raw, schemas);
    const bulletinId = parseLocalResourceId(
      "10000000-0000-4000-8000-000000000001",
    );
    const saved = await new DocumentPersistenceService(ports, schemas).save({
      session,
      resourceKind: "bulletin",
      localResourceId: bulletinId,
      displayName: "Sunday Bulletin",
      document,
      baseDocument: null,
      baseRevisionToken: null,
    });
    expect(saved.status).toBe("saved");
    if (saved.status !== "saved") return;

    const logoBytes = new Uint8Array(await readFile(LOGO_PATH));
    const assetLocalId = parseLocalResourceId(
      "50000000-0000-4000-8000-000000000001",
    );
    const planned = planAssetRevisionInstall({
      sourceDigest: hashBytes(logoBytes) as TransactionDigest,
      registry: saved.registry,
      canonicalBytes: logoBytes,
      validationReceipt: await verifiedSvgReceipt(logoBytes),
      record: {
        version: 1,
        kind: "assetRecord",
        localId: assetLocalId,
        portableAssetId: ASSET_REF,
        displayName: "Demo logo",
        mediaType: "image/svg+xml",
        canonicalHash: hashBytes(logoBytes),
        byteSize: logoBytes.byteLength,
        sanitizationState: "validated",
        aiVisibility: "private",
        importedAt: "2026-07-12T12:00:00.000Z",
      },
    });
    const transactionStorage = new NodeWorkspaceTransactionStorage({
      workspaceRoot: root,
      fileSystem: ports.fileSystem,
      ids: idPort,
      catalog: schemas,
      resources: workspaceResourceTransactionPaths,
    });
    let transactionNumber = 0;
    const transactions = new JournaledTransactionCoordinator({
      storage: transactionStorage,
      clock: { now: () => "2026-07-12T12:00:00.000Z" },
      ids: { allocate: () => `tx_${++transactionNumber}` },
      hashes: { digest: (bytes) => hashBytes(bytes) as TransactionDigest },
    });
    const prepared = await transactions.prepare(planned.request);
    await transactions.commit(prepared.transactionId);
    await expect(transactions.recoverStartup()).resolves.toMatchObject({ mode: "readWrite" });

    const registry = parseWorkspaceRegistry(
      JSON.parse(await readFile(join(root, "workspace.json"), "utf8")),
      schemas,
    );
    expect(registry.assets?.[0]).toMatchObject({
      localId: assetLocalId,
      storagePath: `assets/${assetLocalId}/asset.json`,
    });
    expect(new Uint8Array(await readFile(join(root, "assets", assetLocalId, "canonical")))).toEqual(
      logoBytes,
    );

    const assetRecord = JSON.parse(
      await readFile(join(root, "assets", assetLocalId, "asset.json"), "utf8"),
    ) as unknown;
    const index = createResourceResolverIndex({ assets: [assetRecord], fonts: [] });
    const resolved = resolveDocument(document);
    const verifier = await createNodeNoFollowResourceByteVerifier(root);
    await expect(verifier.verify({
      locator: { kind: "assetCanonical", localId: assetLocalId },
      expectedHash: hashBytes(logoBytes),
      expectedByteSize: logoBytes.byteLength,
      maximumByteSize: 500 * 1024 * 1024,
    })).resolves.toEqual({
      observedHash: hashBytes(logoBytes),
      observedByteSize: logoBytes.byteLength,
    });
    await expect(resolveVerifiedResourceClosure({
      projection: materializeMandatoryFontFallbacks(resolved.projection),
      index,
      verifier,
    })).rejects.toMatchObject({ kind: "missingFont" });
    await session.lease.release();
  });
});
