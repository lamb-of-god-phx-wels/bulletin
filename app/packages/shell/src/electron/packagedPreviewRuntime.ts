import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  canonicalRevisionToken,
  createSanitizedRenderProjection,
  fromJson,
  hashBytes,
  parseLocalResourceId,
  renderInputHash,
  resolveDocument,
  validateDocumentSemantics,
  type CbbDocument,
  type HashJsonObject,
  type PinnedToolIdentity,
  type RenderLocaleIdentity,
  type SchemaCatalog,
  type Sha256Hash,
} from "@cbb/core";
import {
  DeterministicBuildProvider,
  IsolatedBuildExecution,
  NodeClosedTrustedComponentExecutor,
  NodeCompileOutputHandleRegistry,
  WORKSPACE_REGISTRY_PATH,
  assertManagedPathHasNoSymlink,
  canonicalDocumentPath,
  computeFontFamilyDigest,
  createNodeArtifactPdfValidator,
  createNodeCompileOutputReader,
  createNodeFileSystemPort,
  createNodeM3TrustedComponentRegistry,
  createNodeResourceStagingBytePort,
  createResourceResolverIndex,
  createSignedNodeBubblewrapQuarantineWorker,
  createSignedNodeOfflineTypstSandbox,
  createSignedNodePdfInfoInspector,
  decodeCanonicalJson,
  materializeMandatoryFontFallbacks,
  nodeBuildRunnerTimer,
  parseWorkspaceRegistry,
  resolveVerifiedResourceClosure,
  resolveWorkspacePath,
  trustedComponentPathSegments,
  type ArtifactPdfValidatorPort,
  type BuildOrchestratorPorts,
  type BuildQueueHash,
  type FontRevisionRecord,
  type ManagedFontFaceRecord,
  type NoFollowResourceByteVerifier,
  type ResourceByteVerificationRequest,
  type ResourceProjectionReferences,
  type ResourceStagingEntry,
  type ResourceStagingBytePort,
  type SignedTrustedComponentManifest,
  type TrustedComponentArch,
  type TrustedComponentIdentity,
  type TrustedComponentPlatform,
  type TrustedComponentRegistry,
  type TrustedComponentReleaseIdentity,
  type TrustedPublicKeyRegistry,
  type VerifiedResourceClosure,
  type WorkspaceRegistry,
} from "@cbb/services";
import {
  NodeQuarantineHandleStore,
  QUARANTINE_HARD_LIMITS,
  runQuarantineRequest,
  type QuarantineTimerPort,
} from "@cbb/workers";
import {
  createM3BuildArtifactBridge,
  type M3ApplicationServiceRootOptions,
  type M3WorkspaceBuildContext,
} from "../composition.js";
import type {
  M4ManagedImageCanonicalizer,
  M4SelectedImageInput,
} from "../ipc/nodeManagedImageImport.js";

const TRUST_FILE = "native/m3/trusted-component-trust.json";
const MANIFEST_FILE = "native/m3/trusted-components.json";
const MAX_CONFIGURATION_BYTES = 4 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;
const MAX_RESOURCE_RECORD_BYTES = 4 * 1024 * 1024;
const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.+:-]{0,127}$/u;
const SAFE_KEY_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;

interface PackagedTrustFile {
  readonly version: 1;
  readonly kind: "trustedComponentTrust";
  readonly appVersion: string;
  readonly expectedRelease: TrustedComponentReleaseIdentity;
  readonly keys: readonly {
    readonly signingKeyId: string;
    readonly publicKeySpkiBase64: string;
  }[];
}

interface StablePackagedFile {
  readonly bytes: Uint8Array;
  readonly hash: Sha256Hash;
  readonly byteSize: number;
}

interface BundledFontFile {
  readonly relativePath: string;
  readonly hash: Sha256Hash;
  readonly byteSize: number;
}

interface PackagedRegistry {
  readonly appRoot: string;
  readonly manifest: SignedTrustedComponentManifest;
  readonly registry: TrustedComponentRegistry;
  readonly bundledFonts: readonly FontRevisionRecord[];
  readonly bundledFontFiles: ReadonlyMap<string, BundledFontFile>;
  readonly typst: TrustedComponentIdentity;
  readonly pdfInspector: TrustedComponentIdentity;
  readonly schemaCatalog: TrustedComponentIdentity;
  readonly localeData: TrustedComponentIdentity;
}

export interface PackagedM3PreviewRuntime {
  readonly serviceOptions: Pick<
    M3ApplicationServiceRootOptions,
    "trustedRuntime" | "artifactPdfValidator" | "createBuildPorts"
  >;
  /** Lazy release-owned image quarantine capability; never backed by PATH or JS parsing. */
  readonly imageCanonicalizer: M4ManagedImageCanonicalizer;
}

export interface LoadPackagedM3PreviewRuntimeOptions {
  readonly applicationRoot: string;
  readonly workspaceRoot: string;
  readonly appVersion: string;
  readonly catalog: SchemaCatalog;
  /** Compile-time release pin; never derive this value from the trust file itself. */
  readonly expectedTrustFileHash?: Sha256Hash;
  /** Fixed defaults are production-owned; overrides exist only for isolated tests. */
  readonly trustRelativePath?: string;
  readonly manifestRelativePath?: string;
}

function runtimeFailure(): Error {
  const error = new Error("The signed PDF preview runtime is unavailable or damaged.");
  error.name = "PackagedM3PreviewRuntimeError";
  return error;
}

function errorCode(error: unknown): unknown {
  return error !== null && typeof error === "object" && "code" in error
    ? (error as { readonly code?: unknown }).code
    : undefined;
}

function strictDescendant(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child.length > 0 && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function sameFile(
  left: { readonly dev: bigint; readonly ino: bigint },
  right: { readonly dev: bigint; readonly ino: bigint },
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

async function ensurePrivateDirectory(rootPath: string, relativePath: string): Promise<string> {
  try {
    const root = resolve(rootPath);
    const rootInfo = await lstat(root, { bigint: true });
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory() || await realpath(root) !== root) {
      throw runtimeFailure();
    }
    let current = root;
    for (const segment of trustedComponentPathSegments(relativePath)) {
      current = resolve(current, segment);
      if (!strictDescendant(root, current)) throw runtimeFailure();
      try {
        await mkdir(current, { mode: 0o700 });
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
      }
      const info = await lstat(current, { bigint: true });
      if (info.isSymbolicLink() || !info.isDirectory() || await realpath(current) !== current) {
        throw runtimeFailure();
      }
    }
    return current;
  } catch {
    throw runtimeFailure();
  }
}

async function stablePackagedFile(
  appRoot: string,
  relativePath: string,
  maximumBytes: number,
  optional = false,
): Promise<StablePackagedFile | undefined> {
  try {
    if (
      !Number.isSafeInteger(maximumBytes) || maximumBytes < 1 ||
      typeof constants.O_NOFOLLOW !== "number" || constants.O_NOFOLLOW === 0
    ) throw runtimeFailure();
    const segments = trustedComponentPathSegments(relativePath);
    let current = appRoot;
    for (const segment of segments.slice(0, -1)) {
      current = resolve(current, segment);
      const directory = await lstat(current, { bigint: true });
      if (directory.isSymbolicLink() || !directory.isDirectory()) throw runtimeFailure();
    }
    const candidate = resolve(appRoot, ...segments);
    if (!strictDescendant(appRoot, candidate)) throw runtimeFailure();
    const before = await lstat(candidate, { bigint: true });
    if (
      before.isSymbolicLink() || !before.isFile() || before.nlink !== 1n ||
      before.size < 1n || before.size > BigInt(maximumBytes)
    ) throw runtimeFailure();
    const canonical = await realpath(candidate);
    if (!strictDescendant(appRoot, canonical)) throw runtimeFailure();
    const handle = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat({ bigint: true });
      if (!opened.isFile() || opened.nlink !== 1n || !sameFile(before, opened)) {
        throw runtimeFailure();
      }
      const byteSize = Number(opened.size);
      const bytes = new Uint8Array(byteSize);
      const digest = createHash("sha256");
      let position = 0;
      while (position < byteSize) {
        const result = await handle.read(bytes, position, byteSize - position, position);
        if (result.bytesRead < 1) throw runtimeFailure();
        digest.update(bytes.subarray(position, position + result.bytesRead));
        position += result.bytesRead;
      }
      const extra = Buffer.allocUnsafe(1);
      if ((await handle.read(extra, 0, 1, position)).bytesRead !== 0) throw runtimeFailure();
      const after = await handle.stat({ bigint: true });
      if (after.nlink !== 1n || after.size !== opened.size || !sameFile(opened, after)) {
        throw runtimeFailure();
      }
      return {
        bytes,
        hash: `sha256:${digest.digest("hex")}` as Sha256Hash,
        byteSize,
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (optional && errorCode(error) === "ENOENT") return undefined;
    throw runtimeFailure();
  }
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[] = allowed,
): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.every((key) => typeof key === "string" && allowed.includes(key)) &&
    required.every((key) => Object.hasOwn(value, key));
}

function parseRelease(value: unknown): TrustedComponentReleaseIdentity {
  if (!plainRecord(value) || !exactKeys(
    value,
    ["applicationId", "releaseId", "releaseSequence", "profile"],
  )) throw runtimeFailure();
  if (
    typeof value["applicationId"] !== "string" || !SAFE_TOKEN.test(value["applicationId"]) ||
    typeof value["releaseId"] !== "string" || !SAFE_TOKEN.test(value["releaseId"]) ||
    !Number.isSafeInteger(value["releaseSequence"]) || (value["releaseSequence"] as number) < 1 ||
    typeof value["profile"] !== "string" || !SAFE_TOKEN.test(value["profile"])
  ) throw runtimeFailure();
  return Object.freeze({
    applicationId: value["applicationId"],
    releaseId: value["releaseId"],
    releaseSequence: value["releaseSequence"],
    profile: value["profile"],
  }) as TrustedComponentReleaseIdentity;
}

function parseTrust(value: unknown, appVersion: string): {
  readonly trust: PackagedTrustFile;
  readonly keys: TrustedPublicKeyRegistry;
} {
  if (!plainRecord(value) || !exactKeys(
    value,
    ["version", "kind", "appVersion", "expectedRelease", "keys"],
  )) throw runtimeFailure();
  if (
    value["version"] !== 1 || value["kind"] !== "trustedComponentTrust" ||
    typeof value["appVersion"] !== "string" || value["appVersion"] !== appVersion ||
    !Array.isArray(value["keys"]) || value["keys"].length < 1 || value["keys"].length > 8
  ) throw runtimeFailure();
  const keyMap = new Map<string, Uint8Array>();
  const keys = value["keys"].map((raw) => {
    if (!plainRecord(raw) || !exactKeys(raw, ["signingKeyId", "publicKeySpkiBase64"])) {
      throw runtimeFailure();
    }
    const signingKeyId = raw["signingKeyId"];
    const encoded = raw["publicKeySpkiBase64"];
    if (
      typeof signingKeyId !== "string" || !SAFE_KEY_ID.test(signingKeyId) ||
      typeof encoded !== "string" || encoded.length < 1 || encoded.length > 4_096 ||
      keyMap.has(signingKeyId)
    ) throw runtimeFailure();
    const der = new Uint8Array(Buffer.from(encoded, "base64"));
    if (der.byteLength < 32 || der.byteLength > 1_024 || Buffer.from(der).toString("base64") !== encoded) {
      throw runtimeFailure();
    }
    keyMap.set(signingKeyId, der);
    return Object.freeze({ signingKeyId, publicKeySpkiBase64: encoded });
  });
  const trust: PackagedTrustFile = Object.freeze({
    version: 1,
    kind: "trustedComponentTrust",
    appVersion,
    expectedRelease: parseRelease(value["expectedRelease"]),
    keys: Object.freeze(keys),
  });
  return {
    trust,
    keys: Object.freeze({
      getEd25519PublicKey(signingKeyId: string) {
        const key = keyMap.get(signingKeyId);
        return key === undefined ? undefined : new Uint8Array(key);
      },
    }),
  };
}

function currentPlatform(): TrustedComponentPlatform {
  if (process.platform === "linux" || process.platform === "win32") return process.platform;
  throw runtimeFailure();
}

function currentArch(): TrustedComponentArch {
  if (process.arch === "x64" || process.arch === "arm64") return process.arch;
  throw runtimeFailure();
}

function oneComponent(
  registry: TrustedComponentRegistry,
  role: TrustedComponentIdentity["role"],
): TrustedComponentIdentity {
  const matches = registry.components.filter((component) => component.role === role);
  if (matches.length !== 1 || matches[0] === undefined) throw runtimeFailure();
  return matches[0];
}

function bundledFontKey(localId: string, faceId: string): string {
  return `${localId}\u0000${faceId}`;
}

function packagedBundledFonts(
  manifest: SignedTrustedComponentManifest,
): {
  readonly records: readonly FontRevisionRecord[];
  readonly files: ReadonlyMap<string, BundledFontFile>;
} {
  const families = new Map<string, {
    readonly localId: ReturnType<typeof parseLocalResourceId>;
    readonly familyName: string;
    readonly faces: ManagedFontFaceRecord[];
  }>();
  const files = new Map<string, BundledFontFile>();
  for (const component of manifest.components) {
    if (component.role !== "bundledFontFace" || component.fontFaceBinding === undefined) continue;
    const binding = component.fontFaceBinding;
    const portableId = binding.portableFontRef.slice("font:".length);
    const localId = parseLocalResourceId(portableId);
    const family = families.get(binding.portableFontRef) ?? {
      localId,
      familyName: binding.familyName,
      faces: [],
    };
    if (family.localId !== localId || family.familyName !== binding.familyName) throw runtimeFailure();
    const face: ManagedFontFaceRecord = Object.freeze({
      faceId: binding.faceId,
      faceIndex: binding.faceIndex,
      format: binding.format,
      weight: binding.weight,
      style: binding.style,
      stretch: binding.stretch,
      hash: component.hash,
      byteSize: component.byteSize,
    });
    if (family.faces.some((candidate) => candidate.faceId === face.faceId)) throw runtimeFailure();
    family.faces.push(face);
    families.set(binding.portableFontRef, family);
    files.set(bundledFontKey(localId, face.faceId), Object.freeze({
      relativePath: component.relativePath,
      hash: component.hash,
      byteSize: component.byteSize,
    }));
  }
  const records = [...families.entries()].sort(([left], [right]) => left.localeCompare(right)).map(
    ([portableFontId, family]): FontRevisionRecord => {
      const faces = Object.freeze([...family.faces].sort((left, right) => left.faceId.localeCompare(right.faceId)));
      return Object.freeze({
        version: 1,
        kind: "fontRecord",
        localId: family.localId,
        portableFontId: portableFontId as FontRevisionRecord["portableFontId"],
        familyDigest: computeFontFamilyDigest(faces),
        displayName: family.familyName,
        familyName: family.familyName,
        typstFamilyName: family.familyName,
        redistributionAsserted: true,
        exportable: true,
        pdfEmbeddingPermitted: true,
        pdfSubsettingPermitted: true,
        validationState: "validated",
        unicodeCoverageSummary: "Release-owned signed font face closure",
        faces,
      });
    },
  );
  return { records: Object.freeze(records), files };
}

async function loadRegistry(
  options: LoadPackagedM3PreviewRuntimeOptions,
  executor: NodeClosedTrustedComponentExecutor,
): Promise<PackagedRegistry | undefined> {
  let appRoot: string;
  try {
    appRoot = await realpath(resolve(options.applicationRoot));
    const rootStats = await lstat(appRoot, { bigint: true });
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) throw runtimeFailure();
  } catch {
    throw runtimeFailure();
  }
  const trustPath = options.trustRelativePath ?? TRUST_FILE;
  const manifestPath = options.manifestRelativePath ?? MANIFEST_FILE;
  const [trustFile, manifestFile] = await Promise.all([
    stablePackagedFile(appRoot, trustPath, MAX_CONFIGURATION_BYTES, true),
    stablePackagedFile(appRoot, manifestPath, MAX_CONFIGURATION_BYTES, true),
  ]);
  if (trustFile === undefined && manifestFile === undefined) return undefined;
  if (trustFile === undefined || manifestFile === undefined) throw runtimeFailure();
  if (
    options.expectedTrustFileHash === undefined ||
    !/^sha256:[0-9a-f]{64}$/u.test(options.expectedTrustFileHash) ||
    trustFile.hash !== options.expectedTrustFileHash
  ) throw runtimeFailure();
  let trustValue: unknown;
  let manifest: SignedTrustedComponentManifest;
  try {
    trustValue = decodeCanonicalJson(trustFile.bytes, { maximumDepth: 16, maximumStringBytes: 16_384 });
    manifest = decodeCanonicalJson(manifestFile.bytes, {
      maximumDepth: 16,
      maximumStringBytes: 16_384,
    }) as SignedTrustedComponentManifest;
  } catch {
    throw runtimeFailure();
  }
  const parsedTrust = parseTrust(trustValue, options.appVersion);
  let registry: TrustedComponentRegistry;
  try {
    registry = await createNodeM3TrustedComponentRegistry({
      appRoot,
      manifest,
      trustedKeys: parsedTrust.keys,
      expectedRelease: parsedTrust.trust.expectedRelease,
      expectedPlatform: currentPlatform(),
      expectedArch: currentArch(),
      nativeExecutor: executor,
    });
  } catch {
    throw runtimeFailure();
  }
  const bundled = packagedBundledFonts(manifest);
  return {
    appRoot,
    manifest,
    registry,
    bundledFonts: bundled.records,
    bundledFontFiles: bundled.files,
    typst: oneComponent(registry, "typstCli"),
    pdfInspector: oneComponent(registry, "pdfInspector"),
    schemaCatalog: oneComponent(registry, "schemaCatalog"),
    localeData: oneComponent(registry, "localeData"),
  };
}

function packagedVerifier(packaged: PackagedRegistry): NoFollowResourceByteVerifier {
  return Object.freeze({
    async verify(request: ResourceByteVerificationRequest) {
      if (request.locator.kind !== "fontFace") throw runtimeFailure();
      const file = packaged.bundledFontFiles.get(
        bundledFontKey(request.locator.localId, request.locator.faceId),
      );
      if (
        file === undefined || file.hash !== request.expectedHash ||
        file.byteSize !== request.expectedByteSize || file.byteSize > request.maximumByteSize
      ) throw runtimeFailure();
      const observed = await stablePackagedFile(
        packaged.appRoot,
        file.relativePath,
        request.maximumByteSize,
      );
      if (observed === undefined || observed.hash !== file.hash || observed.byteSize !== file.byteSize) {
        throw runtimeFailure();
      }
      return { observedHash: observed.hash, observedByteSize: observed.byteSize };
    },
  });
}

function combinedVerifier(
  workspace: NoFollowResourceByteVerifier,
  packaged: PackagedRegistry,
): NoFollowResourceByteVerifier {
  const release = packagedVerifier(packaged);
  return Object.freeze({
    verify(request: ResourceByteVerificationRequest) {
      if (
        request.locator.kind === "fontFace" &&
        packaged.bundledFontFiles.has(bundledFontKey(request.locator.localId, request.locator.faceId))
      ) return release.verify(request);
      return workspace.verify(request);
    },
  });
}

function combinedResourceBytes(
  workspace: ResourceStagingBytePort,
  packaged: PackagedRegistry,
): ResourceStagingBytePort {
  return Object.freeze({
    async read(entry: ResourceStagingEntry) {
      if (entry.locator.kind !== "fontFace") return workspace.read(entry);
      const file = packaged.bundledFontFiles.get(
        bundledFontKey(entry.locator.localId, entry.locator.faceId),
      );
      if (file === undefined) return workspace.read(entry);
      if (file.hash !== entry.hash || file.byteSize !== entry.byteSize) throw runtimeFailure();
      const observed = await stablePackagedFile(packaged.appRoot, file.relativePath, file.byteSize);
      if (observed === undefined || observed.hash !== file.hash || observed.byteSize !== file.byteSize) {
        throw runtimeFailure();
      }
      return observed.bytes;
    },
  });
}

async function currentRegistry(
  context: M3WorkspaceBuildContext,
  catalog: SchemaCatalog,
): Promise<WorkspaceRegistry> {
  const fileSystem = createNodeFileSystemPort();
  await assertManagedPathHasNoSymlink(fileSystem, context.root, WORKSPACE_REGISTRY_PATH);
  const bytes = await fileSystem.readFileNoFollow(
    resolveWorkspacePath(context.root, WORKSPACE_REGISTRY_PATH),
    MAX_DOCUMENT_BYTES,
  );
  const registry = parseWorkspaceRegistry(decodeCanonicalJson(bytes), catalog);
  if (registry.workspaceId !== context.session.registry.workspaceId) throw runtimeFailure();
  return registry;
}

async function readWorkspaceRecord(
  context: M3WorkspaceBuildContext,
  relativePath: string,
  expectedHash: string,
): Promise<unknown> {
  const fileSystem = createNodeFileSystemPort();
  await assertManagedPathHasNoSymlink(fileSystem, context.root, relativePath);
  const bytes = await fileSystem.readFileNoFollow(
    resolveWorkspacePath(context.root, relativePath),
    MAX_RESOURCE_RECORD_BYTES,
  );
  if (hashBytes(bytes) !== expectedHash) throw runtimeFailure();
  return decodeCanonicalJson(bytes);
}

async function resourceIndex(
  context: M3WorkspaceBuildContext,
  catalog: SchemaCatalog,
  packaged: PackagedRegistry,
) {
  const registry = await currentRegistry(context, catalog);
  const assets = await Promise.all((registry.assets ?? []).map(async (record) => {
    const expected = `assets/${record.localId}/asset.json`;
    if (record.kind !== "asset" || record.storagePath !== expected) throw runtimeFailure();
    return readWorkspaceRecord(context, expected, record.contentHash);
  }));
  const fonts = await Promise.all((registry.fonts ?? []).map(async (record) => {
    const expected = `fonts/${record.localId}/font.json`;
    if (record.kind !== "font" || record.storagePath !== expected) throw runtimeFailure();
    return readWorkspaceRecord(context, expected, record.contentHash);
  }));
  return createResourceResolverIndex({
    assets,
    fonts: [...fonts, ...packaged.bundledFonts],
  });
}

async function loadSavedDocument(
  context: M3WorkspaceBuildContext,
  catalog: SchemaCatalog,
  localResourceId: string,
): Promise<CbbDocument> {
  const registry = await currentRegistry(context, catalog);
  const record = [...registry.bulletins ?? [], ...registry.templates ?? []]
    .find((candidate) => candidate.localId === localResourceId);
  if (record === undefined || (record.kind !== "bulletin" && record.kind !== "template")) {
    throw runtimeFailure();
  }
  const expectedPath = canonicalDocumentPath(record.kind, parseLocalResourceId(localResourceId));
  if (record.storagePath !== expectedPath) throw runtimeFailure();
  const fileSystem = createNodeFileSystemPort();
  await assertManagedPathHasNoSymlink(fileSystem, context.root, expectedPath);
  const bytes = await fileSystem.readFileNoFollow(
    resolveWorkspacePath(context.root, expectedPath),
    MAX_DOCUMENT_BYTES,
  );
  const document = fromJson(decodeCanonicalJson(bytes), catalog);
  const semantic = validateDocumentSemantics(document);
  if (!semantic.valid || document.kind !== record.kind || canonicalRevisionToken(document) !== record.contentHash) {
    throw runtimeFailure();
  }
  return document;
}

function localeIdentity(packaged: PackagedRegistry, languageTag: string): RenderLocaleIdentity {
  if (typeof languageTag !== "string" || languageTag.length < 1 || languageTag.length > 128) {
    throw runtimeFailure();
  }
  return Object.freeze({
    languageTag,
    dataVersion: packaged.localeData.version,
    dataHash: packaged.localeData.hash,
  });
}

async function previewIdentity(
  document: CbbDocument,
  resources: { resolve(projection: ResourceProjectionReferences): Promise<VerifiedResourceClosure> },
  tools: readonly PinnedToolIdentity[],
  packaged: PackagedRegistry,
) {
  const resolved = resolveDocument(document);
  if (resolved.findings.some((finding) => finding.severity === "error")) throw runtimeFailure();
  const effective = materializeMandatoryFontFallbacks(resolved.projection);
  const closure = await resources.resolve(effective as unknown as ResourceProjectionReferences);
  return {
    documentRevision: canonicalRevisionToken(document) as BuildQueueHash,
    renderInputHash: renderInputHash({
      projection: createSanitizedRenderProjection(effective as unknown as HashJsonObject),
      assets: closure.assets,
      fonts: closure.fonts,
      tools,
      locale: localeIdentity(packaged, effective.locale),
      outputOptions: {
        outputForm: "readerOrder",
        pdfConformance: "standard",
        watermark: { kind: "proof", text: "PREVIEW", version: "m3-v1" },
      },
    }) as BuildQueueHash,
    editGeneration: 0,
    saveState: "clean" as const,
  };
}

async function createBuildPorts(
  context: M3WorkspaceBuildContext,
  catalog: SchemaCatalog,
  packaged: PackagedRegistry,
  executor: NodeClosedTrustedComponentExecutor,
  artifactValidator: ArtifactPdfValidatorPort,
): Promise<BuildOrchestratorPorts> {
  if (context.artifacts === undefined) throw runtimeFailure();
  const buildRoot = await ensurePrivateDirectory(context.root, "preview/runtime/builds");
  const [workspaceBytes, outputHandles] = await Promise.all([
    createNodeResourceStagingBytePort(context.root),
    NodeCompileOutputHandleRegistry.create(buildRoot),
  ]);
  const stagedBytes = combinedResourceBytes(workspaceBytes, packaged);
  const brokerIdentity = oneComponent(packaged.registry, "executionBroker");
  const typstIdentity = packaged.typst;
  const broker = await packaged.registry.resolve({ role: "executionBroker", id: brokerIdentity.id });
  const typst = await packaged.registry.resolve({ role: "typstCli", id: typstIdentity.id });
  const typstRuntimeIdentity = oneComponent(packaged.registry, "typstRuntimeClosure");
  const typstRuntime = await packaged.registry.resolve({
    role: "typstRuntimeClosure",
    id: typstRuntimeIdentity.id,
  });
  const sandbox = await createSignedNodeOfflineTypstSandbox({
    privateBuildParent: buildRoot,
    registry: packaged.registry,
    executor,
    executionBroker: broker.locator,
    typst: typst.locator,
    typstRuntime: typstRuntime.locator,
    resources: stagedBytes,
    pdfs: artifactValidator,
    outputHandles,
  });
  const verifier = combinedVerifier(context.resourceVerifier, packaged);
  const resources = Object.freeze({
    async resolve(projection: ResourceProjectionReferences) {
      return resolveVerifiedResourceClosure({
        projection,
        index: await resourceIndex(context, catalog, packaged),
        verifier,
      });
    },
  });
  const tools: readonly PinnedToolIdentity[] = Object.freeze([Object.freeze({
    toolId: "typst",
    version: typstIdentity.version,
    toolHash: typstIdentity.hash,
  })]);
  const snapshots = Object.freeze({
    async load(request: { readonly localResourceId: string }) {
      const document = await loadSavedDocument(context, catalog, request.localResourceId);
      return { document, current: await previewIdentity(document, resources, tools, packaged) };
    },
  });
  const provider = new DeterministicBuildProvider({
    snapshots,
    resources,
    tools,
    localeIdentity: (languageTag) => localeIdentity(packaged, languageTag),
  });
  const outputReader = createNodeCompileOutputReader(outputHandles);
  const bridge = createM3BuildArtifactBridge(context, {
    clock: { now: () => new Date() },
    outputReader,
    tools: [{ toolId: "typst", version: typstIdentity.version, hash: typstIdentity.hash }],
    schemas: [{
      schemaId: "cbb-schema-catalog",
      version: 1,
      hash: packaged.schemaCatalog.hash,
    }],
  });
  const execution = new IsolatedBuildExecution({
    sandbox,
    timer: nodeBuildRunnerTimer,
    tool: {
      toolId: "typst",
      version: typstIdentity.version,
      executableHash: typstIdentity.hash,
    },
    sinks: bridge.executionSinks,
  });
  const currentInputs = Object.freeze({
    async readCurrent(localResourceId: string) {
      const document = await loadSavedDocument(context, catalog, localResourceId);
      return previewIdentity(document, resources, tools, packaged);
    },
  });
  return Object.freeze({
    ids: { mintBuildId: () => randomUUID() },
    projections: provider,
    saves: {
      async saveAndReadClean() {
        // M4 exposes saved-document preview only. A future export surface must
        // bind its own authoritative save adapter instead of treating preview
        // state as permission to create a final artifact.
        throw runtimeFailure();
      },
    },
    currentInputs,
    resources: provider,
    runner: execution,
    artifacts: bridge.artifactStatuses,
  });
}

const quarantineTimer: QuarantineTimerPort = Object.freeze({
  async raceTimeout<Result>(work: Promise<Result>, timeoutMs: number) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work.then((value) => ({ kind: "completed" as const, value })),
        new Promise<{ readonly kind: "timedOut" }>((resolveTimeout) => {
          timer = setTimeout(() => resolveTimeout({ kind: "timedOut" }), timeoutMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  },
});

async function createPackagedImageCanonicalizer(
  options: LoadPackagedM3PreviewRuntimeOptions,
  packaged: PackagedRegistry,
  executor: NodeClosedTrustedComponentExecutor,
): Promise<M4ManagedImageCanonicalizer> {
  const quarantineRoot = await ensurePrivateDirectory(
    options.workspaceRoot,
    "preview/runtime/image-quarantine",
  );
  const [handleRoot, workerRuntimeRoot] = await Promise.all([
    ensurePrivateDirectory(quarantineRoot, "handles"),
    ensurePrivateDirectory(quarantineRoot, "worker"),
  ]);
  const handles = await NodeQuarantineHandleStore.create(handleRoot);
  const brokerIdentity = oneComponent(packaged.registry, "executionBroker");
  const quarantineIdentity = oneComponent(packaged.registry, "quarantineWorker");
  const [broker, quarantine] = await Promise.all([
    packaged.registry.resolve({ role: "executionBroker", id: brokerIdentity.id }),
    packaged.registry.resolve({ role: "quarantineWorker", id: quarantineIdentity.id }),
  ]);
  const worker = await createSignedNodeBubblewrapQuarantineWorker({
    registry: packaged.registry,
    executor,
    executionBroker: broker.locator,
    quarantineWorker: quarantine.locator,
    runtimeRoot: workerRuntimeRoot,
    handles,
  });

  return Object.freeze({
    async canonicalize(input: M4SelectedImageInput) {
      const hard = QUARANTINE_HARD_LIMITS[input.operation];
      const limits = input.operation === "canonicalizeRaster"
        ? Object.freeze({ ...hard, outputBytes: Math.min(hard.outputBytes, 64 * 1024 * 1024) })
        : hard;
      if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength < 1 ||
        input.bytes.byteLength > limits.inputBytes) throw runtimeFailure();
      const inputHandle = await handles.registerInput(input.bytes);
      let outputHandle: Awaited<ReturnType<typeof handles.prepareOutput>> | undefined;
      try {
        outputHandle = await handles.prepareOutput(input.operation);
        const request = Object.freeze({
          version: 1 as const,
          requestId: randomUUID(),
          operation: input.operation,
          input: inputHandle,
          output: outputHandle,
          limits,
        });
        const result = await runQuarantineRequest(
          request,
          worker,
          quarantineTimer,
          handles,
          { timeoutMs: 120_000 },
        );
        if (result.status !== "succeeded") throw runtimeFailure();
        const consumed = await handles.consumeVerifiedOutput(result.receipt);
        if (consumed.kind !== "file" || consumed.mediaType !== result.result.mediaType ||
          consumed.hash !== result.result.outputHash ||
          consumed.bytes.byteLength !== result.result.outputBytes) throw runtimeFailure();
        return Object.freeze({
          bytes: consumed.bytes,
          mediaType: consumed.mediaType as "image/png" | "image/svg+xml",
          canonicalHash: consumed.hash,
          receipt: result.receipt,
          sanitizer: Object.freeze({
            toolId: quarantineIdentity.id,
            version: quarantineIdentity.version,
            toolHash: quarantineIdentity.hash,
          }),
          ...(result.result.operation === "canonicalizeRaster"
            ? {
                pixelWidth: result.result.observed.width,
                pixelHeight: result.result.observed.height,
              }
            : {}),
        });
      } catch (error) {
        await handles.cleanupInput(inputHandle).catch(() => undefined);
        if (outputHandle !== undefined) await handles.discardOutput(outputHandle).catch(() => undefined);
        throw error;
      }
    },
  });
}

/**
 * Discover and compose the release-owned M3 preview runtime.
 *
 * A normal source checkout intentionally contains neither trust anchor nor
 * native release bundle and therefore returns `undefined`. Once either fixed
 * file exists, absence or corruption of any part is fatal: the app never falls
 * back to PATH tools, unsigned binaries, or an in-process PDF parser.
 */
export async function loadPackagedM3PreviewRuntime(
  options: LoadPackagedM3PreviewRuntimeOptions,
): Promise<PackagedM3PreviewRuntime | undefined> {
  if (
    typeof options.appVersion !== "string" || options.appVersion.length < 1 ||
    typeof options.workspaceRoot !== "string" || !isAbsolute(options.workspaceRoot) ||
    process.platform !== "linux"
  ) {
    // A signed bundle on an unsupported platform is a packaging error rather
    // than permission to use the host's native tools.
    const trust = await stat(resolve(options.applicationRoot, options.trustRelativePath ?? TRUST_FILE))
      .then(() => true, (error: unknown) => errorCode(error) === "ENOENT" ? false : Promise.reject(error));
    const manifest = await stat(resolve(options.applicationRoot, options.manifestRelativePath ?? MANIFEST_FILE))
      .then(() => true, (error: unknown) => errorCode(error) === "ENOENT" ? false : Promise.reject(error));
    if (trust || manifest) throw runtimeFailure();
    return undefined;
  }
  const executor = new NodeClosedTrustedComponentExecutor();
  const packaged = await loadRegistry(options, executor);
  if (packaged === undefined) return undefined;
  const registry = packaged.registry;
  let imageCanonicalizerPromise: Promise<M4ManagedImageCanonicalizer> | undefined;
  const imageCanonicalizer: M4ManagedImageCanonicalizer = Object.freeze({
    canonicalize(input: M4SelectedImageInput) {
      imageCanonicalizerPromise ??= createPackagedImageCanonicalizer(options, packaged, executor);
      return imageCanonicalizerPromise.then((canonicalizer) => canonicalizer.canonicalize(input));
    },
  });
  let validatorPromise: Promise<ArtifactPdfValidatorPort> | undefined;
  const validator = (): Promise<ArtifactPdfValidatorPort> => {
    validatorPromise ??= (async () => {
      const runtimeRoot = await ensurePrivateDirectory(
        options.workspaceRoot,
        "preview/runtime/pdf-inspection",
      );
      const brokerIdentity = oneComponent(registry, "executionBroker");
      const pdfIdentity = oneComponent(registry, "pdfInspector");
      const pdfRuntimeIdentity = oneComponent(registry, "pdfRuntimeClosure");
      const [broker, pdf, pdfRuntime] = await Promise.all([
        registry.resolve({ role: "executionBroker", id: brokerIdentity.id }),
        registry.resolve({ role: "pdfInspector", id: pdfIdentity.id }),
        registry.resolve({ role: "pdfRuntimeClosure", id: pdfRuntimeIdentity.id }),
      ]);
      const inspector = await createSignedNodePdfInfoInspector({
        privateInspectionParent: runtimeRoot,
        registry,
        executor,
        executionBroker: broker.locator,
        pdfInspector: pdf.locator,
        pdfRuntime: pdfRuntime.locator,
      });
      return createNodeArtifactPdfValidator({ inspector, pinnedIdentity: inspector.identity });
    })();
    return validatorPromise;
  };
  const artifactPdfValidator: ArtifactPdfValidatorPort = Object.freeze({
    async verify(bytes: Uint8Array) {
      return (await validator()).verify(bytes);
    },
  });
  return Object.freeze({
    imageCanonicalizer,
    serviceOptions: Object.freeze({
      trustedRuntime: Object.freeze({
        async verify() {
          await Promise.all(registry.components.map((component) =>
            registry.resolve({ role: component.role, id: component.id })
          ));
        },
      }),
      artifactPdfValidator,
      createBuildPorts: (context: M3WorkspaceBuildContext) =>
        createBuildPorts(context, options.catalog, packaged, executor, artifactPdfValidator),
    }),
  });
}
