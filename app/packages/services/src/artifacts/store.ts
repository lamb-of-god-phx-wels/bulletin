import { canonicalStringify } from "@cbb/core";
import type { Sha256Hash } from "@cbb/core";
import type { CompileArtifactSinkPort } from "../build/runner.js";
import type {
  ArtifactCurrencyInputs,
  ArtifactCurrencyResult,
  ArtifactInstallJournal,
  ArtifactOwnedByteLocator,
  ArtifactPdfEvidence,
  ArtifactRecord,
  ArtifactRecordLocator,
  ArtifactResourceClosure,
  ArtifactStorePorts,
  BoundCompileArtifactSink,
  CompileArtifactInstallRequest,
  CompileArtifactSinkBinding,
  ComposeArtifactInstallRequest,
  ObservedPdfIdentity,
  RevalidateArtifactInstallRequest,
} from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HASH = /^sha256:[0-9a-f]{64}$/u;
const UTC = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z$/u;
const DIAGNOSTIC = /^CBB-[A-Z]+-[0-9]{4}$/u;
const MAX_ARTIFACT_BYTES = 1024 * 1024 * 1024;
const SOURCE_NODE_ID = /^[A-Za-z][A-Za-z0-9_-]*$/u;
const NAVIGATION_REGIONS = new Set(["body", "page-background", "page-foreground"]);

function validateNavigationMap(
  map: CompileArtifactInstallRequest["navigationMap"],
  pageCount: number,
): void {
  if (
    map === null || typeof map !== "object" || map.version !== 1 ||
    !Array.isArray(map.entries) || map.entries.length > 50_000
  ) throw new ArtifactStoreError("invalidEvidence", "PDF navigation evidence is invalid.");
  const seen = new Set<string>();
  for (const entry of map.entries) {
    const key = `${entry.resolvedId}\u0000${entry.sourceElementId}\u0000${entry.region}\u0000${entry.pageNumber}`;
    if (
      typeof entry.resolvedId !== "string" || entry.resolvedId.length < 1 || entry.resolvedId.length > 512 ||
      !SOURCE_NODE_ID.test(entry.sourceElementId) ||
      !Number.isSafeInteger(entry.pageNumber) || entry.pageNumber < 1 || entry.pageNumber > pageCount ||
      !NAVIGATION_REGIONS.has(entry.region) || seen.has(key)
    ) throw new ArtifactStoreError("invalidEvidence", "PDF navigation evidence is invalid.");
    seen.add(key);
  }
}

export type ArtifactStoreErrorKind =
  | "invalidRecord"
  | "invalidEvidence"
  | "immutableCollision"
  | "sourceMismatch"
  | "byteVerificationFailed"
  | "cleanupFailed";

export class ArtifactStoreError extends Error {
  public constructor(
    public readonly kind: ArtifactStoreErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "ArtifactStoreError";
  }
}

interface OwnedInstall {
  readonly locator: ArtifactOwnedByteLocator;
  readonly bytes: Uint8Array;
  readonly expectedHash: Sha256Hash;
  readonly pdf?: Omit<ArtifactPdfEvidence, "relativePath">;
}

function installJournal(
  record: ArtifactRecord,
  owned: readonly OwnedInstall[],
): ArtifactInstallJournal {
  return Object.freeze({
    version: 1,
    kind: "artifactInstallJournal",
    record,
    ownedBytes: Object.freeze(owned.map((item) => Object.freeze({
      extension: item.locator.extension,
      hash: item.expectedHash,
      byteSize: item.bytes.byteLength,
    })).sort((left, right) => left.extension < right.extension ? -1 : 1)),
  });
}

interface ResolvedSource {
  readonly selected: ArtifactRecord;
  readonly owner: ArtifactRecord;
  readonly pdfBytes: Uint8Array;
  readonly pdf: ArtifactPdfEvidence;
  readonly sourceTypstHash?: Sha256Hash;
}

function recordLocator(record: Pick<ArtifactRecord, "bulletinLocalId" | "buildId">): ArtifactRecordLocator {
  return {
    kind: "artifactRecord",
    bulletinLocalId: record.bulletinLocalId,
    buildId: record.buildId,
  };
}

function byteLocator(
  record: Pick<ArtifactRecord, "bulletinLocalId" | "buildId">,
  extension: "typ" | "pdf",
): ArtifactOwnedByteLocator {
  return {
    kind: "artifactOwnedByte",
    bulletinLocalId: record.bulletinLocalId,
    buildId: record.buildId,
    extension,
  };
}

/** Schema-required display/reference string; never accepted from a caller. */
function relativePath(
  record: Pick<ArtifactRecord, "bulletinLocalId" | "buildId">,
  extension: "typ" | "pdf" | "log",
): string {
  return `artifacts/${record.bulletinLocalId}/${record.buildId}.${extension}`;
}

function sameOptionalStrings(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  return canonicalStringify(left ?? []) === canonicalStringify(right ?? []);
}

function sameWatermark(left: ArtifactRecord["watermark"], right: ArtifactRecord["watermark"]): boolean {
  return canonicalStringify(left ?? null) === canonicalStringify(right ?? null);
}

function resourceKey(resource: ArtifactResourceClosure["assets"][number]): string {
  return resource.assetRef;
}

function fontKey(resource: ArtifactResourceClosure["fontFaces"][number]): string {
  return `${resource.fontRef}\0${resource.faceId}`;
}

function validateResources(resources: ArtifactResourceClosure): void {
  if (resources.assets.length > 5_000 || resources.fontFaces.length > 256) {
    throw new ArtifactStoreError("invalidEvidence", "Artifact resource closure exceeds hard limits.");
  }
  const assets = new Set<string>();
  let previousAsset = "";
  for (const asset of resources.assets) {
    const key = resourceKey(asset);
    if (
      key <= previousAsset ||
      assets.has(key) ||
      !HASH.test(asset.binaryHash) ||
      !Number.isSafeInteger(asset.byteSize) ||
      asset.byteSize < 0 ||
      asset.byteSize > 536_870_912 ||
      asset.mediaType.length === 0
    ) {
      throw new ArtifactStoreError("invalidEvidence", "Artifact asset evidence is not canonical.");
    }
    previousAsset = key;
    assets.add(key);
  }
  const fonts = new Set<string>();
  let previousFont = "";
  for (const face of resources.fontFaces) {
    const key = fontKey(face);
    if (
      key <= previousFont ||
      fonts.has(key) ||
      !HASH.test(face.familyDigest) ||
      !HASH.test(face.faceHash) ||
      !Number.isSafeInteger(face.byteSize) ||
      face.byteSize < 0 ||
      face.byteSize > 52_428_800 ||
      !face.embeddingPermitted
    ) {
      throw new ArtifactStoreError("invalidEvidence", "Artifact font evidence is not canonical.");
    }
    previousFont = key;
    fonts.add(key);
  }
}

function validateRecordInvariants(record: ArtifactRecord): void {
  if (
    record.version !== 1 ||
    record.kind !== "artifactRecord" ||
    !UUID.test(record.buildId) ||
    !UUID.test(record.bulletinLocalId) ||
    !UTC.test(record.createdAt) ||
    !HASH.test(record.canonicalRevisionToken) ||
    !HASH.test(record.renderInputHash) ||
    (record.readinessInputHash !== undefined && !HASH.test(record.readinessInputHash)) ||
    record.toolIdentities.length > 32 ||
    record.schemaIdentities.length > 32 ||
    record.diagnosticCodes.length > 1_000 ||
    record.diagnosticCodes.some((code) => !DIAGNOSTIC.test(code)) ||
    (record.boundedLogRef !== undefined && record.boundedLogRef !== relativePath(record, "log"))
  ) {
    throw new ArtifactStoreError("invalidRecord", "Artifact common identity is invalid.");
  }
  if (record.status === "queued") {
    if (record.startedAt !== undefined || record.completedAt !== undefined || record.outputEvidence !== undefined) {
      throw new ArtifactStoreError("invalidRecord", "Queued artifacts cannot claim lifecycle/output evidence.");
    }
  } else if (record.status === "running") {
    if (!UTC.test(record.startedAt ?? "") || record.completedAt !== undefined || record.outputEvidence !== undefined) {
      throw new ArtifactStoreError("invalidRecord", "Running artifact lifecycle is invalid.");
    }
  } else if (record.status === "succeeded") {
    if (!UTC.test(record.startedAt ?? "") || !UTC.test(record.completedAt ?? "") || record.outputEvidence === undefined) {
      throw new ArtifactStoreError("invalidRecord", "Succeeded artifact lacks complete evidence.");
    }
  } else if (!UTC.test(record.completedAt ?? "") || record.outputEvidence !== undefined) {
    throw new ArtifactStoreError("invalidRecord", "Non-success artifact owns output evidence.");
  }
  if (record.artifactKind === "preview") {
    if (
      !Number.isSafeInteger(record.editGeneration) ||
      Number(record.editGeneration) < 0 ||
      !Number.isSafeInteger(record.requestSequence) ||
      Number(record.requestSequence) < 1
    ) throw new ArtifactStoreError("invalidRecord", "Preview identity is incomplete.");
  }
  if (record.artifactKind === "draft") {
    if (record.watermark === undefined || record.readinessInputHash === undefined) {
      throw new ArtifactStoreError("invalidRecord", "Draft artifact lacks watermark/readiness evidence.");
    }
  }
  if (record.artifactKind === "finalCandidate") {
    if (
      record.readinessInputHash === undefined ||
      record.watermark !== undefined ||
      (record.readinessProfile !== "printFinal" && record.readinessProfile !== "accessibleFinal")
    ) throw new ArtifactStoreError("invalidRecord", "Final-candidate identity is invalid.");
  }
  const evidence = record.outputEvidence;
  if (record.status !== "succeeded" || evidence === undefined) return;
  validateResources(evidence.resources);
  if (record.executionMode !== evidence.mode) {
    throw new ArtifactStoreError("invalidRecord", "Execution mode and output evidence disagree.");
  }
  if (evidence.pdf.hash === undefined || !HASH.test(evidence.pdf.hash)) {
    throw new ArtifactStoreError("invalidEvidence", "PDF evidence hash is invalid.");
  }
  if (evidence.mode === "compile") {
    if (
      record.outputForm !== "readerOrder" ||
      evidence.typstRelativePath !== relativePath(record, "typ") ||
      evidence.pdf.relativePath !== relativePath(record, "pdf") ||
      !HASH.test(evidence.typstHash) ||
      !HASH.test(evidence.renderProjectionHash) ||
      evidence.generatorVersion.length === 0
    ) throw new ArtifactStoreError("invalidEvidence", "Compile ownership evidence is invalid.");
    if (evidence.navigationMap !== undefined) {
      validateNavigationMap(evidence.navigationMap, evidence.pdf.pageCount);
    }
  } else if (evidence.mode === "compose") {
    if (
      record.outputForm !== "bookletTwoUp" ||
      evidence.pdf.relativePath !== relativePath(record, "pdf") ||
      !UUID.test(evidence.parentReaderBuildId) ||
      !HASH.test(evidence.parentReaderPdfHash) ||
      !HASH.test(evidence.parentRenderInputHash)
    ) throw new ArtifactStoreError("invalidEvidence", "Compose parent/output evidence is invalid.");
  } else if (
    !UUID.test(evidence.sourceRenderBuildId) ||
    !HASH.test(evidence.sourcePdfHash) ||
    !HASH.test(evidence.sourceRenderInputHash) ||
    (evidence.sourceTypstHash !== undefined && !HASH.test(evidence.sourceTypstHash))
  ) {
    throw new ArtifactStoreError("invalidEvidence", "Revalidation source evidence is invalid.");
  }
  if (
    evidence.mode === "revalidate" &&
    (record.artifactKind === "preview" || record.artifactKind === "importedDiagnostic")
  ) {
    throw new ArtifactStoreError("invalidEvidence", "Preview/imported artifacts cannot claim revalidation.");
  }
}

function pdfEvidenceMatches(
  observed: ObservedPdfIdentity,
  expected: Omit<ArtifactPdfEvidence, "relativePath">,
): boolean {
  return observed.hash === expected.hash &&
    observed.byteSize === expected.byteSize &&
    observed.pageCount === expected.pageCount &&
    observed.pdfVersion === expected.pdfVersion &&
    sameOptionalStrings(observed.standards, expected.standards) &&
    observed.validationReportHash === expected.validationReportHash;
}

export function queryArtifactCurrency(
  record: ArtifactRecord,
  current: ArtifactCurrencyInputs,
): ArtifactCurrencyResult {
  const reasons: ArtifactCurrencyResult["reasons"][number][] = [];
  if (record.status !== "succeeded") reasons.push("notSucceeded");
  if (record.artifactKind === "preview" || record.artifactKind === "importedDiagnostic") {
    reasons.push("notPublishableKind");
  }
  if (record.renderInputHash !== current.renderInputHash) reasons.push("renderInputChanged");
  if (record.outputForm !== current.outputForm) reasons.push("outputFormChanged");
  if (record.readinessProfile !== current.readinessProfile) reasons.push("readinessProfileChanged");
  if (
    record.readinessInputHash !== undefined &&
    record.readinessInputHash !== current.readinessInputHash
  ) reasons.push("readinessInputChanged");
  const visualCurrent = !reasons.includes("notSucceeded") &&
    !reasons.includes("renderInputChanged") &&
    !reasons.includes("outputFormChanged");
  const readinessCurrent = visualCurrent &&
    !reasons.includes("readinessInputChanged") &&
    !reasons.includes("readinessProfileChanged");
  return {
    visualCurrent,
    readinessCurrent,
    current: readinessCurrent && !reasons.includes("notPublishableKind"),
    reasons,
  };
}

export class ImmutableArtifactStore {
  public constructor(private readonly ports: ArtifactStorePorts) {}

  public async readArtifact(
    bulletinLocalId: string,
    buildId: string,
  ): Promise<ArtifactRecord | undefined> {
    if (!UUID.test(bulletinLocalId) || !UUID.test(buildId)) {
      throw new ArtifactStoreError("invalidRecord", "Artifact locator identity is invalid.");
    }
    const raw = await this.ports.storage.readRecord({
      kind: "artifactRecord",
      bulletinLocalId,
      buildId,
    });
    if (raw === undefined) return undefined;
    if (!await this.ports.records.validate(raw)) {
      throw new ArtifactStoreError("invalidRecord", "Stored artifact record failed schema validation.");
    }
    const record = raw as ArtifactRecord;
    validateRecordInvariants(record);
    return record;
  }

  private async hash(bytes: Uint8Array): Promise<Sha256Hash> {
    const hash = await this.ports.hashes.digest(bytes);
    if (!HASH.test(hash)) {
      throw new ArtifactStoreError("byteVerificationFailed", "Hash port returned an invalid digest.");
    }
    return hash;
  }

  private async verifyPdf(
    bytes: Uint8Array,
    expected: Omit<ArtifactPdfEvidence, "relativePath">,
  ): Promise<void> {
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_ARTIFACT_BYTES) {
      throw new ArtifactStoreError("byteVerificationFailed", "PDF bytes exceed artifact bounds.");
    }
    const observed = await this.ports.pdfs.verify(new Uint8Array(bytes));
    if ((await this.hash(bytes)) !== observed.hash || !pdfEvidenceMatches(observed, expected)) {
      throw new ArtifactStoreError("byteVerificationFailed", "PDF bytes disagree with verified evidence.");
    }
  }

  private async validateRecord(record: ArtifactRecord): Promise<void> {
    validateRecordInvariants(record);
    if (!await this.ports.records.validate(record)) {
      throw new ArtifactStoreError("invalidRecord", "Artifact record failed closed-schema validation.");
    }
  }

  private async ensureVacant(record: ArtifactRecord): Promise<void> {
    if (await this.ports.storage.readRecord(recordLocator(record)) !== undefined) {
      throw new ArtifactStoreError("immutableCollision", "Artifact record locator already exists.");
    }
    for (const extension of ["typ", "pdf"] as const) {
      if (await this.ports.storage.readOwnedByte(byteLocator(record, extension)) !== undefined) {
        throw new ArtifactStoreError("immutableCollision", "Artifact byte locator already exists.");
      }
    }
  }

  private async reverifyOwned(install: OwnedInstall): Promise<void> {
    const bytes = await this.ports.storage.readOwnedByte(install.locator);
    if (bytes === undefined || (await this.hash(bytes)) !== install.expectedHash) {
      throw new ArtifactStoreError("byteVerificationFailed", "Installed immutable bytes failed reread hashing.");
    }
    if (install.pdf !== undefined) await this.verifyPdf(bytes, install.pdf);
  }

  private async cleanupAfterFailure(
    record: ArtifactRecord,
    installed: readonly OwnedInstall[],
  ): Promise<void> {
    const locator = recordLocator(record);
    const durableRecord = await this.ports.storage.readRecord(locator);
    let mayRemoveBytes = durableRecord === undefined;
    if (durableRecord !== undefined) {
      let same = false;
      try {
        same = canonicalStringify(durableRecord) === canonicalStringify(record);
      } catch {
        same = false;
      }
      if (same) mayRemoveBytes = await this.ports.storage.deleteRecordIfUnchanged(locator, record);
    }
    if (!mayRemoveBytes) {
      throw new ArtifactStoreError(
        "cleanupFailed",
        "Artifact record could not be proven transaction-owned; output cleanup stopped.",
      );
    }
    for (const install of [...installed].reverse()) {
      const current = await this.ports.storage.readOwnedByte(install.locator);
      if (current === undefined) continue;
      if ((await this.hash(current)) !== install.expectedHash) {
        throw new ArtifactStoreError(
          "cleanupFailed",
          "Partial artifact bytes changed; cleanup refused to remove them.",
        );
      }
      if (!await this.ports.storage.deleteOwnedByteIfHash(install.locator, install.expectedHash)) {
        throw new ArtifactStoreError("cleanupFailed", "Partial artifact cleanup lost its hash check.");
      }
    }
  }

  private async install(
    record: ArtifactRecord,
    owned: readonly OwnedInstall[],
  ): Promise<ArtifactRecord> {
    await this.validateRecord(record);
    await this.ensureVacant(record);
    const journal = installJournal(record, owned);
    const journalPort = this.ports.storage.installJournal;
    let journalStarted = false;
    const installed: OwnedInstall[] = [];
    try {
      if (journalPort !== undefined) {
        await journalPort.begin(journal);
        journalStarted = true;
      }
      for (const item of owned) {
        if (item.locator.extension === "typ") {
          if (item.bytes.byteLength === 0 || item.bytes.byteLength > MAX_ARTIFACT_BYTES) {
            throw new ArtifactStoreError("byteVerificationFailed", "Typst bytes exceed artifact bounds.");
          }
          if ((await this.hash(item.bytes)) !== item.expectedHash) {
            throw new ArtifactStoreError("byteVerificationFailed", "Typst bytes disagree with their hash.");
          }
        } else if (item.pdf !== undefined) {
          await this.verifyPdf(item.bytes, item.pdf);
        }
        const created = await this.ports.storage.installOwnedByteExclusive(
          item.locator,
          new Uint8Array(item.bytes),
        );
        if (!created) throw new ArtifactStoreError("immutableCollision", "Artifact byte install would overwrite.");
        installed.push(item);
        await this.reverifyOwned(item);
      }
      if (!await this.ports.storage.installRecordExclusive(recordLocator(record), record)) {
        throw new ArtifactStoreError("immutableCollision", "Artifact record install would overwrite.");
      }
      const durable = await this.ports.storage.readRecord(recordLocator(record));
      if (
        durable === undefined ||
        !await this.ports.records.validate(durable) ||
        canonicalStringify(durable) !== canonicalStringify(record)
      ) {
        throw new ArtifactStoreError("invalidRecord", "Installed artifact record failed reread verification.");
      }
      if (journalStarted) {
        // The exact record is the durable commit marker. A finish failure may
        // leave recoverable bookkeeping residue, but must not roll back or
        // misreport a fully verified live artifact.
        await journalPort?.finish(journal).catch(() => undefined);
      }
      return record;
    } catch (error) {
      try {
        await this.cleanupAfterFailure(record, installed);
        if (journalStarted) await journalPort?.finish(journal);
      } catch (cleanup) {
        throw cleanup;
      }
      throw error;
    }
  }

  public async persistNonSuccess(record: ArtifactRecord): Promise<ArtifactRecord> {
    if (record.status === "succeeded" || record.outputEvidence !== undefined) {
      throw new ArtifactStoreError("invalidRecord", "Non-success API cannot persist successful output.");
    }
    return this.install(record, []);
  }

  public async persistCompile(request: CompileArtifactInstallRequest): Promise<ArtifactRecord> {
    const { metadata } = request;
    if (metadata.outputForm !== "readerOrder") {
      throw new ArtifactStoreError("invalidEvidence", "Compile artifacts must be reader-order output.");
    }
    validateNavigationMap(request.navigationMap, request.expectedPdf.pageCount);
    if ((await this.hash(request.source)) !== request.sourceHash) {
      throw new ArtifactStoreError("byteVerificationFailed", "Generated Typst hash changed before install.");
    }
    const record: ArtifactRecord = {
      version: 1,
      kind: "artifactRecord",
      ...metadata,
      status: "succeeded",
      executionMode: "compile",
      outputEvidence: {
        mode: "compile",
        renderProjectionHash: request.renderProjectionHash,
        typstRelativePath: relativePath(metadata, "typ"),
        typstHash: request.sourceHash,
        generatorVersion: request.generatorVersion,
        navigationMap: request.navigationMap,
        pdf: { ...request.expectedPdf, relativePath: relativePath(metadata, "pdf") },
        resources: request.resources,
      },
    };
    return this.install(record, [
      {
        locator: byteLocator(metadata, "typ"),
        bytes: new Uint8Array(request.source),
        expectedHash: request.sourceHash,
      },
      {
        locator: byteLocator(metadata, "pdf"),
        bytes: new Uint8Array(request.pdfBytes),
        expectedHash: request.expectedPdf.hash,
        pdf: request.expectedPdf,
      },
    ]);
  }

  private async loadRecord(bulletinLocalId: string, buildId: string): Promise<ArtifactRecord> {
    const locator: ArtifactRecordLocator = { kind: "artifactRecord", bulletinLocalId, buildId };
    const raw = await this.ports.storage.readRecord(locator);
    if (raw === undefined || !await this.ports.records.validate(raw)) {
      throw new ArtifactStoreError("sourceMismatch", "Referenced artifact record is missing or invalid.");
    }
    const record = raw as ArtifactRecord;
    validateRecordInvariants(record);
    if (record.status !== "succeeded" || record.outputEvidence === undefined) {
      throw new ArtifactStoreError("sourceMismatch", "Referenced artifact did not succeed.");
    }
    return record;
  }

  private async resolveSource(
    bulletinLocalId: string,
    buildId: string,
  ): Promise<ResolvedSource> {
    const visited = new Set<string>();
    const claimedTypstHashes: Sha256Hash[] = [];
    const selected = await this.loadRecord(bulletinLocalId, buildId);
    let current = selected;
    for (let depth = 0; depth < 64; depth += 1) {
      if (visited.has(current.buildId)) {
        throw new ArtifactStoreError("sourceMismatch", "Artifact source chain is cyclic.");
      }
      visited.add(current.buildId);
      const evidence = current.outputEvidence as NonNullable<ArtifactRecord["outputEvidence"]>;
      if (evidence.mode !== "revalidate") {
        const locator = byteLocator(current, "pdf");
        const pdfBytes = await this.ports.storage.readOwnedByte(locator);
        if (pdfBytes === undefined) {
          throw new ArtifactStoreError("sourceMismatch", "Referenced source PDF bytes are missing.");
        }
        await this.verifyPdf(pdfBytes, {
          hash: evidence.pdf.hash,
          byteSize: evidence.pdf.byteSize,
          pageCount: evidence.pdf.pageCount,
          pdfVersion: evidence.pdf.pdfVersion,
          ...(evidence.pdf.standards === undefined ? {} : { standards: evidence.pdf.standards }),
          ...(evidence.pdf.validationReportHash === undefined
            ? {}
            : { validationReportHash: evidence.pdf.validationReportHash }),
        });
        if (selected.outputEvidence?.pdf.hash !== evidence.pdf.hash) {
          throw new ArtifactStoreError("sourceMismatch", "Revalidation chain changed PDF identity.");
        }
        if (
          evidence.mode === "compile" &&
          claimedTypstHashes.some((hash) => hash !== evidence.typstHash)
        ) {
          throw new ArtifactStoreError("sourceMismatch", "Revalidation chain changed Typst identity.");
        }
        let sourceTypstHash: Sha256Hash | undefined;
        if (evidence.mode === "compile") {
          const typstBytes = await this.ports.storage.readOwnedByte(byteLocator(current, "typ"));
          if (typstBytes === undefined || (await this.hash(typstBytes)) !== evidence.typstHash) {
            throw new ArtifactStoreError("sourceMismatch", "Referenced source Typst bytes are missing or changed.");
          }
          sourceTypstHash = evidence.typstHash;
        } else {
          const parentRecord = await this.loadRecord(
            bulletinLocalId,
            evidence.parentReaderBuildId,
          );
          if (parentRecord.outputForm !== "readerOrder") {
            throw new ArtifactStoreError("sourceMismatch", "Compose parent is not reader-order evidence.");
          }
          const parent = await this.resolveSource(
            bulletinLocalId,
            evidence.parentReaderBuildId,
          );
          if (
            parent.selected.renderInputHash !== evidence.parentRenderInputHash ||
            parent.pdf.hash !== evidence.parentReaderPdfHash ||
            parent.pdf.pageCount !== evidence.logicalPageCount ||
            canonicalStringify(parent.selected.outputEvidence?.resources) !==
              canonicalStringify(evidence.resources)
          ) {
            throw new ArtifactStoreError("sourceMismatch", "Compose parent evidence is stale or contradictory.");
          }
        }
        return {
          selected,
          owner: current,
          pdfBytes,
          pdf: evidence.pdf,
          ...(sourceTypstHash === undefined ? {} : { sourceTypstHash }),
        };
      }
      if (
        evidence.sourcePdfHash !== evidence.pdf.hash ||
        evidence.sourceRenderInputHash !== current.renderInputHash
      ) {
        throw new ArtifactStoreError("sourceMismatch", "Revalidation record contradicts its source evidence.");
      }
      if (evidence.sourceTypstHash !== undefined) claimedTypstHashes.push(evidence.sourceTypstHash);
      const source = await this.loadRecord(bulletinLocalId, evidence.sourceRenderBuildId);
      if (
        source.outputEvidence?.pdf.hash !== evidence.sourcePdfHash ||
        source.renderInputHash !== evidence.sourceRenderInputHash ||
        source.outputForm !== current.outputForm ||
        source.artifactKind === "preview" ||
        source.artifactKind === "importedDiagnostic" ||
        !sameWatermark(source.watermark, current.watermark) ||
        canonicalStringify(source.outputEvidence?.resources) !== canonicalStringify(evidence.resources)
      ) {
        throw new ArtifactStoreError("sourceMismatch", "Revalidation source record does not match its claim.");
      }
      current = source;
    }
    throw new ArtifactStoreError("sourceMismatch", "Artifact source chain exceeds the depth limit.");
  }

  public async persistCompose(request: ComposeArtifactInstallRequest): Promise<ArtifactRecord> {
    const { metadata } = request;
    if (
      !UUID.test(metadata.buildId) ||
      !UUID.test(metadata.bulletinLocalId) ||
      !UUID.test(request.parentReaderBuildId) ||
      metadata.outputForm !== "bookletTwoUp"
    ) {
      throw new ArtifactStoreError("invalidEvidence", "Compose artifacts must be booklet output.");
    }
    const parent = await this.resolveSource(metadata.bulletinLocalId, request.parentReaderBuildId);
    if (
      parent.selected.outputForm !== "readerOrder" ||
      parent.selected.artifactKind === "preview" ||
      parent.selected.artifactKind === "importedDiagnostic" ||
      parent.selected.renderInputHash !== request.parentRenderInputHash ||
      parent.pdf.pageCount !== request.logicalPageCount ||
      canonicalStringify(parent.selected.outputEvidence?.resources) !== canonicalStringify(request.resources)
    ) {
      throw new ArtifactStoreError("sourceMismatch", "Compose parent reader evidence does not match.");
    }
    const record: ArtifactRecord = {
      version: 1,
      kind: "artifactRecord",
      ...metadata,
      status: "succeeded",
      executionMode: "compose",
      outputEvidence: {
        mode: "compose",
        parentReaderBuildId: parent.selected.buildId,
        parentReaderPdfHash: parent.pdf.hash,
        parentRenderInputHash: request.parentRenderInputHash,
        logicalPageCount: request.logicalPageCount,
        imposedSideCount: request.imposedSideCount,
        compositor: request.compositor,
        pdf: { ...request.expectedPdf, relativePath: relativePath(metadata, "pdf") },
        resources: request.resources,
      },
    };
    return this.install(record, [{
      locator: byteLocator(metadata, "pdf"),
      bytes: new Uint8Array(request.pdfBytes),
      expectedHash: request.expectedPdf.hash,
      pdf: request.expectedPdf,
    }]);
  }

  public async persistRevalidation(
    request: RevalidateArtifactInstallRequest,
  ): Promise<ArtifactRecord> {
    const { metadata } = request;
    if (
      !UUID.test(metadata.buildId) ||
      !UUID.test(metadata.bulletinLocalId) ||
      !UUID.test(request.sourceRenderBuildId) ||
      metadata.artifactKind === "preview" ||
      metadata.artifactKind === "importedDiagnostic"
    ) {
      throw new ArtifactStoreError("invalidEvidence", "Preview/imported artifacts cannot be revalidated.");
    }
    const source = await this.resolveSource(metadata.bulletinLocalId, request.sourceRenderBuildId);
    if (
      source.selected.artifactKind === "preview" ||
      source.selected.artifactKind === "importedDiagnostic" ||
      source.selected.outputForm !== metadata.outputForm ||
      source.selected.renderInputHash !== metadata.renderInputHash ||
      !sameWatermark(source.selected.watermark, metadata.watermark)
    ) {
      throw new ArtifactStoreError("sourceMismatch", "Revalidation source is not output-identical.");
    }
    const record: ArtifactRecord = {
      version: 1,
      kind: "artifactRecord",
      ...metadata,
      status: "succeeded",
      executionMode: "revalidate",
      outputEvidence: {
        mode: "revalidate",
        sourceRenderBuildId: source.selected.buildId,
        sourcePdfHash: source.pdf.hash,
        sourceRenderInputHash: source.selected.renderInputHash,
        ...(metadata.outputForm === "readerOrder"
          ? { sourceTypstHash: source.sourceTypstHash as Sha256Hash }
          : {}),
        pdf: source.pdf,
        resources: source.selected.outputEvidence?.resources as ArtifactResourceClosure,
      },
    };
    return this.install(record, []);
  }

  private runnerResourcesMatch(
    runner: Parameters<CompileArtifactSinkPort<ArtifactRecord>["persistCompile"]>[0]["resources"],
    artifact: ArtifactResourceClosure,
  ): boolean {
    if (runner.assets.length !== artifact.assets.length) return false;
    const stagingAssets = new Map(runner.stagingEntries.flatMap((entry) =>
      entry.kind === "asset" ? [[entry.assetRef as string, entry] as const] : [],
    ));
    for (const [index, identity] of runner.assets.entries()) {
      const expected = artifact.assets[index];
      const staged = stagingAssets.get(identity.assetRef);
      if (
        expected === undefined ||
        expected.assetRef !== identity.assetRef ||
        expected.binaryHash !== identity.binaryHash ||
        expected.mediaType !== identity.mediaType ||
        staged?.hash !== identity.binaryHash ||
        staged.byteSize !== expected.byteSize
      ) return false;
    }
    const selectedFaces = runner.fonts.flatMap((font) => font.selectedFaces.map((face) => ({
      fontRef: font.fontRef,
      familyDigest: font.familyDigest,
      ...face,
    }))).sort((left, right) =>
      (left.fontRef < right.fontRef ? -1 : left.fontRef > right.fontRef ? 1 : 0) ||
      (left.faceId < right.faceId ? -1 : left.faceId > right.faceId ? 1 : 0),
    );
    if (selectedFaces.length !== artifact.fontFaces.length) return false;
    const stagingFonts = new Map<string, Extract<
      (typeof runner.stagingEntries)[number],
      { readonly kind: "fontFace" }
    >>(runner.stagingEntries.flatMap((entry) =>
      entry.kind === "fontFace" ? [[`${entry.fontRef}\0${entry.faceId}`, entry] as const] : [],
    ));
    return selectedFaces.every((face, index) => {
      const expected = artifact.fontFaces[index];
      const staged = stagingFonts.get(`${face.fontRef}\0${face.faceId}`);
      return expected !== undefined &&
        expected.fontRef === face.fontRef &&
        expected.familyDigest === face.familyDigest &&
        expected.faceId === face.faceId &&
        expected.faceHash === face.faceHash &&
        expected.embeddingPermitted &&
        (face.embedding !== "subset" || expected.subsettingPermitted) &&
        staged?.hash === face.faceHash &&
        staged.byteSize === expected.byteSize;
    });
  }

  public bindCompileSink(binding: CompileArtifactSinkBinding): BoundCompileArtifactSink {
    return {
      persistCompile: async (evidence) => {
        if (
          evidence.buildId !== binding.metadata.buildId ||
          !binding.metadata.toolIdentities.some((tool) =>
            tool.toolId === evidence.tool.toolId &&
            tool.version === evidence.tool.version &&
            tool.hash === evidence.tool.executableHash,
          ) ||
          !this.runnerResourcesMatch(evidence.resources, binding.resources)
        ) {
          throw new ArtifactStoreError("invalidEvidence", "Runner evidence does not match artifact binding.");
        }
        const pdfBytes = await binding.outputReader.readVerifiedPdf(evidence.pdf.handle);
        return this.persistCompile({
          metadata: binding.metadata,
          source: evidence.source,
          sourceHash: evidence.sourceHash,
          pdfBytes,
          expectedPdf: {
            hash: evidence.pdf.hash,
            byteSize: evidence.pdf.byteSize,
            pageCount: evidence.pdf.pageCount,
            pdfVersion: evidence.pdf.pdfVersion,
          },
          renderProjectionHash: binding.renderProjectionHash,
          generatorVersion: binding.generatorVersion,
          navigationMap: evidence.pdf.navigationMap,
          resources: binding.resources,
        });
      },
    };
  }
}
