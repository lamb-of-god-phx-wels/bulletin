import {
  canonicalRevisionToken,
  canonicalStringify,
  hashBytes,
  type CanonicalRevisionToken,
  type CbbDocument,
  type LocalResourceId,
  type SchemaCatalog,
} from "@cbb/core";
import {
  AutosaveController,
  BuildOrchestrator,
  CompositeWorkspaceStartupRecovery,
  DocumentPersistenceService,
  ImmutableArtifactStore,
  JournaledTransactionCoordinator,
  NodeWorkspaceRetentionSource,
  NodeArtifactStartupRecovery,
  NodeRecoverySnapshotStore,
  NodeWorkspaceTransactionStorage,
  SaveJournalRecoveryService,
  RetentionCoordinator,
  WORKSPACE_REGISTRY_PATH,
  WorkspacePreferencesService,
  WorkspaceService,
  createArtifactRecordSchemaValidator,
  createImmutableBuildArtifactBridge,
  createNodeArtifactStoragePort,
  createNodeNoFollowResourceByteVerifier,
  createNodeServicePorts,
  decodeCanonicalJson,
  assetRevisionRetentionNodeId,
  fontRevisionRetentionNodeId,
  parseWorkspaceRegistry,
  resolveWorkspacePath,
  workspaceResourceTransactionPaths,
  type ArtifactPdfValidatorPort,
  type ArtifactRecord,
  type AutosaveControllerOptions,
  type AutosaveSchedulerPort,
  type BoundCompileArtifactSink,
  type BuildAdmissionResult,
  type BuildOrchestratorPorts,
  type BuildQueueState,
  type ChurchProfile,
  type CompileArtifactInstallRequest,
  type CompileArtifactSinkBinding,
  type ComposeArtifactInstallRequest,
  type CreateWorkspaceInput,
  type EditableWorkspaceSession,
  type ManualBuildSubmission,
  type ImmutableBuildArtifactBridge,
  type ImmutableBuildArtifactBridgeOptions,
  type NoFollowResourceByteVerifier,
  type OpenWorkspaceOptions,
  type OpenWorkspaceResult,
  type PreferenceLoadResult,
  type PreferenceSaveResult,
  type PreparedTransaction,
  type PreviewBuildSubmission,
  type ReadOnlyWorkspaceSession,
  type RecoverySnapshotCandidate,
  type RecoverySnapshotCleanupRequest,
  type RecoverySnapshotCleanupResult,
  type RecoverySnapshotDiscovery,
  type RecoverySnapshotOutcome,
  type RecoverySnapshotPruneOutcome,
  type RecoverySnapshotPruneRequest,
  type RecoverySnapshotRecord,
  type RetentionCleanupResult,
  type RetentionPlan,
  type RetentionPinLease,
  type RevalidateArtifactInstallRequest,
  type SaveDocumentRequest,
  type SaveDocumentResult,
  type ServicePorts,
  type ShutdownDisposition,
  type TransactionDigest,
  type TransactionJournal,
  type TransactionRequest,
  type WorkspaceSettings,
} from "@cbb/services";

const MAX_WORKSPACE_REGISTRY_BYTES = 100 * 1024 * 1024;
const ownedClose = Symbol("ownedClose");

export type M3DocumentSaveRequest = Omit<SaveDocumentRequest, "session">;

export interface M3DocumentPersistence {
  save(request: M3DocumentSaveRequest): Promise<SaveDocumentResult>;
}

export interface M3WorkspacePreferences {
  loadSettings(): Promise<PreferenceLoadResult<WorkspaceSettings>>;
  loadChurchProfile(): Promise<PreferenceLoadResult<ChurchProfile>>;
  saveSettings(
    value: WorkspaceSettings,
    baseHash: CanonicalRevisionToken | null,
  ): Promise<PreferenceSaveResult<WorkspaceSettings>>;
  saveChurchProfile(
    value: ChurchProfile,
    baseHash: CanonicalRevisionToken | null,
  ): Promise<PreferenceSaveResult<ChurchProfile>>;
}

export interface M3WorkspaceTransactions {
  prepare(request: TransactionRequest): Promise<PreparedTransaction>;
  commit(transactionId: string): Promise<TransactionJournal>;
  rollback(transactionId: string): Promise<TransactionJournal>;
}

export interface M3RecoverySnapshots {
  flush(snapshot: RecoverySnapshotRecord): Promise<RecoverySnapshotOutcome>;
  pruneCovered(
    request: RecoverySnapshotPruneRequest,
  ): Promise<RecoverySnapshotPruneOutcome>;
  listValidSnapshots(
    localResourceId: RecoverySnapshotRecord["localResourceId"],
  ): Promise<readonly RecoverySnapshotCandidate[]>;
  discoverNewerSnapshots(
    localResourceId: RecoverySnapshotRecord["localResourceId"],
    evidence: Parameters<NodeRecoverySnapshotStore["discoverNewerSnapshots"]>[1],
  ): Promise<RecoverySnapshotDiscovery>;
  cleanupExact(
    request: RecoverySnapshotCleanupRequest,
  ): Promise<RecoverySnapshotCleanupResult>;
}

export interface M3ArtifactServices {
  readArtifact(
    bulletinLocalId: string,
    buildId: string,
  ): Promise<ArtifactRecord | undefined>;
  persistNonSuccess(record: ArtifactRecord): Promise<ArtifactRecord>;
  persistCompile(request: CompileArtifactInstallRequest): Promise<ArtifactRecord>;
  persistCompose(request: ComposeArtifactInstallRequest): Promise<ArtifactRecord>;
  persistRevalidation(request: RevalidateArtifactInstallRequest): Promise<ArtifactRecord>;
  bindCompileSink(binding: CompileArtifactSinkBinding): BoundCompileArtifactSink;
}

export interface M3BuildServices {
  getState(): BuildQueueState;
  submitPreview(submission: PreviewBuildSubmission): Promise<BuildAdmissionResult>;
  submitManual(submission: ManualBuildSubmission): Promise<BuildAdmissionResult>;
  cancel(buildId: string): Promise<void>;
  setDragActive(localResourceId: string, active: boolean): Promise<void>;
  whenIdle(): Promise<void>;
}

export interface M3RetentionServices {
  project(): Promise<RetentionPlan>;
  cleanupResourceRevision<Result>(
    nodeId: string,
    cleanupExact: () => Promise<Result>,
  ): Promise<RetentionCleanupResult<Result>>;
  cleanupArtifact<Result>(
    nodeId: string,
    cleanupExact: () => Promise<Result>,
  ): Promise<RetentionCleanupResult<Result>>;
}

export interface M3DocumentAutosaveOptions {
  readonly localResourceId: LocalResourceId;
  readonly resourceKind: "bulletin" | "template";
  readonly displayName: string;
  readonly initialDocument: CbbDocument;
  readonly initialRevisionToken: CanonicalRevisionToken;
  readonly scheduler: AutosaveSchedulerPort;
  readonly onStateChange?: AutosaveControllerOptions["onStateChange"];
}

export interface M3WorkspaceCloseBlocker {
  readonly localResourceId: LocalResourceId;
  readonly disposition: Extract<ShutdownDisposition, { readonly status: "block" }>;
}

export interface M3WorkspaceCloseOptions {
  /** Explicit user-confirmed discard. Closing never implies this permission. */
  readonly discardUnsaved?: boolean;
}

export type M3WorkspaceCloseResult =
  | { readonly status: "closed" }
  | {
      readonly status: "blocked";
      readonly blockers: readonly M3WorkspaceCloseBlocker[];
    };

export interface M3WorkspaceBuildContext {
  readonly root: string;
  readonly session: EditableWorkspaceSession;
  readonly documents: M3DocumentPersistence;
  readonly preferences: M3WorkspacePreferences;
  readonly transactions: M3WorkspaceTransactions;
  readonly recoverySnapshots: M3RecoverySnapshots;
  readonly resourceVerifier: NoFollowResourceByteVerifier;
  readonly retention: M3RetentionServices;
  readonly artifacts?: M3ArtifactServices;
}

export type M3BuildArtifactBridgeOptions = Omit<
  ImmutableBuildArtifactBridgeOptions,
  "artifacts"
>;

/** Bind trusted build lifecycle/output adapters to this workspace's artifact store. */
export function createM3BuildArtifactBridge(
  context: M3WorkspaceBuildContext,
  options: M3BuildArtifactBridgeOptions,
): ImmutableBuildArtifactBridge {
  if (context.artifacts === undefined) {
    throw new TypeError("Artifact persistence is unavailable without a trusted PDF validator");
  }
  return createImmutableBuildArtifactBridge({
    ...options,
    artifacts: context.artifacts,
  });
}

export interface M3TrustedRuntimeGate {
  /** Verify the complete signed M3 component set and its execution broker. */
  verify(): Promise<void>;
}

export interface M3ApplicationServiceRootOptions {
  readonly catalog: SchemaCatalog;
  readonly appVersion: string;
  /** Defaults to the production Node service ports. Primarily injectable for tests. */
  readonly ports?: ServicePorts;
  /** Required whenever any trusted artifact/build adapter is enabled. */
  readonly trustedRuntime?: M3TrustedRuntimeGate;
  /** Artifact persistence remains unavailable until a pinned PDF inspector is supplied. */
  readonly artifactPdfValidator?: ArtifactPdfValidatorPort;
  /**
   * Platform build execution and projection adapters are deliberately injected.
   * The composition root owns the resulting queue, but never supplies a permissive
   * in-process fallback when these trusted adapters are absent.
   */
  readonly createBuildPorts?: (
    context: M3WorkspaceBuildContext,
  ) => BuildOrchestratorPorts | Promise<BuildOrchestratorPorts>;
}

export type M3WorkspaceOpenResult =
  | { readonly status: "editable"; readonly workspace: M3EditableWorkspace }
  | Extract<OpenWorkspaceResult, { readonly status: "readOnly" | "failed" }>;

class WorkspaceLifetime {
  private closing = false;
  private readonly pending = new Set<Promise<unknown>>();

  constructor(private readonly session: EditableWorkspaceSession) {}

  assertOpen(): void {
    if (this.closing) throw new Error("The workspace service lifetime is closed");
  }

  run<T>(operation: () => Promise<T>, authorize: boolean): Promise<T> {
    const work = (async () => {
      this.assertOpen();
      if (authorize) await this.session.lease.heartbeat();
      this.assertOpen();
      return operation();
    })();
    this.pending.add(work);
    void work.finally(() => this.pending.delete(work)).catch(() => undefined);
    return work;
  }

  beginClose(): void {
    this.closing = true;
  }

  async finishClose(): Promise<void> {
    await Promise.allSettled([...this.pending]);
    await this.session.lease.release();
  }
}

class OwnedDocumentPersistence implements M3DocumentPersistence {
  constructor(
    private readonly service: DocumentPersistenceService,
    private readonly session: EditableWorkspaceSession,
    private readonly lifetime: WorkspaceLifetime,
    private readonly retention: RetentionCoordinator,
  ) {}

  save(request: M3DocumentSaveRequest): Promise<SaveDocumentResult> {
    return this.lifetime.run(
      () => this.retention.mutate(
        () => this.service.save({ ...request, session: this.session }),
      ),
      false,
    );
  }
}

class OwnedWorkspacePreferences implements M3WorkspacePreferences {
  constructor(
    private readonly service: WorkspacePreferencesService,
    private readonly session: EditableWorkspaceSession,
    private readonly lifetime: WorkspaceLifetime,
  ) {}

  loadSettings(): Promise<PreferenceLoadResult<WorkspaceSettings>> {
    return this.lifetime.run(() => this.service.loadSettings(this.session), false);
  }

  loadChurchProfile(): Promise<PreferenceLoadResult<ChurchProfile>> {
    return this.lifetime.run(() => this.service.loadChurchProfile(this.session), false);
  }

  saveSettings(
    value: WorkspaceSettings,
    baseHash: CanonicalRevisionToken | null,
  ): Promise<PreferenceSaveResult<WorkspaceSettings>> {
    return this.lifetime.run(
      () => this.service.saveSettings({ session: this.session, value, baseHash }),
      false,
    );
  }

  saveChurchProfile(
    value: ChurchProfile,
    baseHash: CanonicalRevisionToken | null,
  ): Promise<PreferenceSaveResult<ChurchProfile>> {
    return this.lifetime.run(
      () => this.service.saveChurchProfile({ session: this.session, value, baseHash }),
      false,
    );
  }
}

class OwnedTransactions implements M3WorkspaceTransactions {
  constructor(
    private readonly coordinator: JournaledTransactionCoordinator,
    private readonly lifetime: WorkspaceLifetime,
    private readonly retention: RetentionCoordinator,
  ) {}

  prepare(request: TransactionRequest): Promise<PreparedTransaction> {
    return this.lifetime.run(
      () => this.retention.mutate(() => this.coordinator.prepare(request)),
      true,
    );
  }

  commit(transactionId: string): Promise<TransactionJournal> {
    return this.lifetime.run(
      () => this.retention.mutate(() => this.coordinator.commit(transactionId)),
      true,
    );
  }

  rollback(transactionId: string): Promise<TransactionJournal> {
    return this.lifetime.run(
      () => this.retention.mutate(() => this.coordinator.rollback(transactionId)),
      true,
    );
  }
}

class OwnedRecoverySnapshots implements M3RecoverySnapshots {
  constructor(
    private readonly store: NodeRecoverySnapshotStore,
    private readonly lifetime: WorkspaceLifetime,
    private readonly retention: RetentionCoordinator,
  ) {}

  flush(snapshot: RecoverySnapshotRecord): Promise<RecoverySnapshotOutcome> {
    return this.lifetime.run(
      () => this.retention.mutate(() => this.store.flush(snapshot)),
      true,
    );
  }

  pruneCovered(request: RecoverySnapshotPruneRequest): Promise<RecoverySnapshotPruneOutcome> {
    return this.lifetime.run(
      () => this.retention.mutate(() => this.store.pruneCovered(request)),
      true,
    );
  }

  listValidSnapshots(
    localResourceId: RecoverySnapshotRecord["localResourceId"],
  ): Promise<readonly RecoverySnapshotCandidate[]> {
    return this.lifetime.run(() => this.store.listValidSnapshots(localResourceId), false);
  }

  discoverNewerSnapshots(
    localResourceId: RecoverySnapshotRecord["localResourceId"],
    evidence: Parameters<NodeRecoverySnapshotStore["discoverNewerSnapshots"]>[1],
  ): Promise<RecoverySnapshotDiscovery> {
    return this.lifetime.run(
      () => this.store.discoverNewerSnapshots(localResourceId, evidence),
      false,
    );
  }

  cleanupExact(request: RecoverySnapshotCleanupRequest): Promise<RecoverySnapshotCleanupResult> {
    return this.lifetime.run(
      () => this.retention.mutate(() => this.store.cleanupExact(request)),
      true,
    );
  }
}

class OwnedArtifacts implements M3ArtifactServices {
  constructor(
    private readonly store: ImmutableArtifactStore,
    private readonly lifetime: WorkspaceLifetime,
    private readonly retention: RetentionCoordinator,
  ) {}

  readArtifact(bulletinLocalId: string, buildId: string): Promise<ArtifactRecord | undefined> {
    return this.lifetime.run(() => this.store.readArtifact(bulletinLocalId, buildId), false);
  }

  persistNonSuccess(record: ArtifactRecord): Promise<ArtifactRecord> {
    return this.lifetime.run(
      () => this.retention.mutate(() => this.store.persistNonSuccess(record)),
      true,
    );
  }

  persistCompile(request: CompileArtifactInstallRequest): Promise<ArtifactRecord> {
    return this.lifetime.run(
      () => this.retention.mutate(() => this.store.persistCompile(request)),
      true,
    );
  }

  persistCompose(request: ComposeArtifactInstallRequest): Promise<ArtifactRecord> {
    return this.lifetime.run(
      () => this.retention.mutate(() => this.store.persistCompose(request)),
      true,
    );
  }

  persistRevalidation(request: RevalidateArtifactInstallRequest): Promise<ArtifactRecord> {
    return this.lifetime.run(
      () => this.retention.mutate(() => this.store.persistRevalidation(request)),
      true,
    );
  }

  bindCompileSink(binding: CompileArtifactSinkBinding): BoundCompileArtifactSink {
    this.lifetime.assertOpen();
    const sink = this.store.bindCompileSink(binding);
    return {
      persistCompile: (evidence) => this.lifetime.run(
        () => this.retention.mutate(() => sink.persistCompile(evidence)),
        true,
      ),
    };
  }
}

class OwnedRetention implements M3RetentionServices {
  constructor(
    private readonly coordinator: RetentionCoordinator,
    private readonly lifetime: WorkspaceLifetime,
  ) {}

  project(): Promise<RetentionPlan> {
    return this.lifetime.run(() => this.coordinator.project(), false);
  }

  cleanupResourceRevision<Result>(
    nodeId: string,
    cleanupExact: () => Promise<Result>,
  ): Promise<RetentionCleanupResult<Result>> {
    return this.lifetime.run(
      () => this.coordinator.cleanupResourceRevision(nodeId, cleanupExact),
      true,
    );
  }

  cleanupArtifact<Result>(
    nodeId: string,
    cleanupExact: () => Promise<Result>,
  ): Promise<RetentionCleanupResult<Result>> {
    return this.lifetime.run(
      () => this.coordinator.cleanupArtifact(nodeId, cleanupExact),
      true,
    );
  }
}

class OwnedBuildServices implements M3BuildServices {
  constructor(
    private readonly orchestrator: BuildOrchestrator,
    private readonly lifetime: WorkspaceLifetime,
  ) {}

  getState(): BuildQueueState {
    this.lifetime.assertOpen();
    return this.orchestrator.getState();
  }

  submitPreview(submission: PreviewBuildSubmission): Promise<BuildAdmissionResult> {
    return this.lifetime.run(() => this.orchestrator.submitPreview(submission), true);
  }

  submitManual(submission: ManualBuildSubmission): Promise<BuildAdmissionResult> {
    return this.lifetime.run(() => this.orchestrator.submitManual(submission), true);
  }

  cancel(buildId: string): Promise<void> {
    return this.lifetime.run(() => this.orchestrator.cancel(buildId), true);
  }

  setDragActive(localResourceId: string, active: boolean): Promise<void> {
    return this.lifetime.run(
      () => this.orchestrator.setDragActive(localResourceId, active),
      true,
    );
  }

  whenIdle(): Promise<void> {
    this.lifetime.assertOpen();
    return this.orchestrator.whenIdle();
  }

  async shutdown(): Promise<void> {
    const state = this.orchestrator.getState();
    const buildIds = new Set<string>([
      ...state.queued.map((entry) => entry.request.buildId),
      ...(state.running === undefined ? [] : [state.running.request.buildId]),
    ]);
    for (const buildId of buildIds) {
      await this.orchestrator.cancel(buildId).catch(() => undefined);
    }
    await this.orchestrator.whenIdle();
  }
}

/**
 * One editable, non-renderer workspace capability graph.
 *
 * The graph is created only after save and generic transaction recovery have
 * completed. Closing it first stops autosave/build work, drains owned calls,
 * and releases the workspace lease last.
 */
export class M3EditableWorkspace {
  readonly root: string;
  readonly registry: EditableWorkspaceSession["registry"];
  readonly documents: M3DocumentPersistence;
  readonly preferences: M3WorkspacePreferences;
  readonly transactions: M3WorkspaceTransactions;
  readonly recoverySnapshots: M3RecoverySnapshots;
  readonly resourceVerifier: NoFollowResourceByteVerifier;
  readonly retention: M3RetentionServices;
  readonly artifacts?: M3ArtifactServices;
  readonly build?: M3BuildServices;

  private readonly autosaves = new Map<AutosaveController, LocalResourceId>();
  private closed = false;

  constructor(
    private readonly session: EditableWorkspaceSession,
    documents: M3DocumentPersistence,
    preferences: M3WorkspacePreferences,
    transactions: M3WorkspaceTransactions,
    recoverySnapshots: M3RecoverySnapshots,
    resourceVerifier: NoFollowResourceByteVerifier,
    retention: M3RetentionServices,
    private readonly lifetime: WorkspaceLifetime,
    private readonly closeOwner: (
      workspace: M3EditableWorkspace,
      options: M3WorkspaceCloseOptions,
    ) => Promise<M3WorkspaceCloseResult>,
    artifacts?: M3ArtifactServices,
    private readonly ownedBuild?: OwnedBuildServices,
  ) {
    this.root = session.root;
    this.registry = session.registry;
    this.documents = documents;
    this.preferences = preferences;
    this.transactions = transactions;
    this.recoverySnapshots = recoverySnapshots;
    this.resourceVerifier = resourceVerifier;
    this.retention = retention;
    if (artifacts !== undefined) this.artifacts = artifacts;
    if (ownedBuild !== undefined) this.build = ownedBuild;
  }

  createDocumentAutosave(options: M3DocumentAutosaveOptions): AutosaveController {
    this.lifetime.assertOpen();
    if (options.initialDocument.kind !== options.resourceKind) {
      throw new TypeError("Autosave document kind does not match its workspace resource kind");
    }
    if (canonicalRevisionToken(options.initialDocument) !== options.initialRevisionToken) {
      throw new TypeError("Autosave initial document does not match its revision token");
    }
    let baseDocument = JSON.parse(canonicalStringify(options.initialDocument)) as CbbDocument;
    const autosave = new AutosaveController({
      workspaceId: this.session.registry.workspaceId,
      localResourceId: options.localResourceId,
      resourceKind: options.resourceKind,
      initialDocument: options.initialDocument,
      initialRevisionToken: options.initialRevisionToken,
      scheduler: options.scheduler,
      ...(options.onStateChange === undefined
        ? {}
        : { onStateChange: options.onStateChange }),
      canonical: {
        save: async (request) => {
          const saved = await this.documents.save({
            resourceKind: options.resourceKind,
            localResourceId: options.localResourceId,
            displayName: options.displayName,
            document: request.document,
            baseDocument,
            baseRevisionToken: request.baseRevisionToken,
          });
          if (saved.status === "saved") {
            baseDocument = JSON.parse(canonicalStringify(request.document)) as CbbDocument;
            return { status: "saved", revisionToken: saved.revisionToken };
          }
          if (saved.status === "conflicted") {
            const detail = saved.diagnostics[0]?.userSummary;
            return {
              status: "conflicted",
              ...(detail === undefined ? {} : { detail }),
            };
          }
          const detail = saved.diagnostics[0]?.userSummary;
          return {
            status: "failed",
            ...(detail === undefined ? {} : { detail }),
          };
        },
      },
      recovery: this.recoverySnapshots,
    });
    this.autosaves.set(autosave, options.localResourceId);
    return autosave;
  }

  close(options: M3WorkspaceCloseOptions = {}): Promise<M3WorkspaceCloseResult> {
    return this.closeOwner(this, options);
  }

  async [ownedClose](
    options: M3WorkspaceCloseOptions = {},
  ): Promise<M3WorkspaceCloseResult> {
    if (this.closed) return { status: "closed" };
    const blockers = [...this.autosaves].flatMap(([autosave, localResourceId]) => {
      const disposition = autosave.shutdownDisposition();
      return disposition.status === "block"
        ? [{ localResourceId, disposition }]
        : [];
    });
    if (blockers.length > 0 && options.discardUnsaved !== true) {
      return { status: "blocked", blockers };
    }
    if (options.discardUnsaved === true) {
      for (const autosave of this.autosaves.keys()) {
        autosave.confirmDiscardForShutdown();
      }
    }
    this.closed = true;
    for (const autosave of this.autosaves.keys()) autosave.enterReadOnly();
    this.autosaves.clear();
    this.lifetime.beginClose();
    await this.ownedBuild?.shutdown();
    await this.lifetime.finishClose();
    return { status: "closed" };
  }
}

interface WorkspaceTransactionServices {
  readonly coordinator: JournaledTransactionCoordinator;
  readonly storage: NodeWorkspaceTransactionStorage;
}

function transactionServices(
  root: string,
  ports: ServicePorts,
  catalog: SchemaCatalog,
): WorkspaceTransactionServices {
  const storage = new NodeWorkspaceTransactionStorage({
    workspaceRoot: root,
    fileSystem: ports.fileSystem,
    ids: ports.ids,
    catalog,
    resources: workspaceResourceTransactionPaths,
  });
  return {
    storage,
    coordinator: new JournaledTransactionCoordinator({
      storage,
      clock: { now: () => ports.clock.now().toISOString() },
      ids: { allocate: () => ports.ids.randomUuid() },
      hashes: { digest: (bytes) => hashBytes(bytes) as TransactionDigest },
    }),
  };
}

function retainBuildResources(
  ports: BuildOrchestratorPorts,
  retention: RetentionCoordinator,
): BuildOrchestratorPorts {
  const leases = new Map<string, RetentionPinLease>();
  const release = async (buildId: string): Promise<void> => {
    const lease = leases.get(buildId);
    if (lease === undefined) return;
    leases.delete(buildId);
    await lease.release();
  };
  return {
    ...ports,
    resources: {
      resolve: async (request) => {
        if (leases.has(request.request.buildId)) {
          throw new Error("Build resource retention pin already exists");
        }
        const published = await retention.resolveAndPinActiveBuild(async () => {
          const resources = await ports.resources.resolve(request);
          const resourceNodeIds = [
            ...resources.assets.map((asset) =>
              assetRevisionRetentionNodeId(asset.assetRef, asset.binaryHash)
            ),
            ...resources.fonts.map((font) =>
              fontRevisionRetentionNodeId(font.fontRef, font.familyDigest)
            ),
          ];
          return {
            result: resources,
            pin: {
              buildId: request.request.buildId,
              localResourceId: request.request.localResourceId,
              documentRevision: request.request.documentRevision,
              resourceClosureHash: request.provenance.resourceClosureHash,
              resourceNodeIds,
            },
          };
        });
        leases.set(request.request.buildId, published.lease);
        return published.result;
      },
    },
    artifacts: {
      record: async (event) => {
        try {
          await ports.artifacts.record(event);
        } finally {
          if (event.type === "terminal") await release(event.request.buildId);
        }
      },
    },
  };
}

/**
 * Headless M3 main-process composition root. It contains no BrowserWindow,
 * preload, IPC, renderer, or permissive execution fallback.
 */
export class M3ApplicationServiceRoot {
  private readonly ports: ServicePorts;
  private readonly transactionServices = new Map<string, WorkspaceTransactionServices>();
  private readonly workspaceService: WorkspaceService;
  private active: M3EditableWorkspace | undefined;
  private operationTail: Promise<void> = Promise.resolve();
  private trustedRuntimeVerified = false;

  constructor(private readonly options: M3ApplicationServiceRootOptions) {
    if (options.appVersion.length === 0) throw new TypeError("appVersion is required");
    if (
      (options.artifactPdfValidator !== undefined || options.createBuildPorts !== undefined) &&
      options.trustedRuntime === undefined
    ) {
      throw new TypeError(
        "A trusted runtime verification gate is required for artifact or build adapters",
      );
    }
    this.ports = options.ports ?? createNodeServicePorts();
    const saveRecovery = new SaveJournalRecoveryService(this.ports, options.catalog);
    const composite = new CompositeWorkspaceStartupRecovery(
      saveRecovery,
      (root) => {
        const services = transactionServices(root, this.ports, options.catalog);
        this.transactionServices.set(root, services);
        return services.coordinator;
      },
      {
        reload: async (root) => parseWorkspaceRegistry(
          decodeCanonicalJson(await this.ports.fileSystem.readFileNoFollow(
            resolveWorkspacePath(root, WORKSPACE_REGISTRY_PATH),
            MAX_WORKSPACE_REGISTRY_BYTES,
          )),
          options.catalog,
        ),
      },
      this.ports.ids,
      [new NodeArtifactStartupRecovery(
        createArtifactRecordSchemaValidator(options.catalog),
        this.ports.ids,
      )],
    );
    this.workspaceService = new WorkspaceService(
      this.ports,
      options.catalog,
      composite,
      options.appVersion,
    );
  }

  openWorkspace(
    root: string,
    options: OpenWorkspaceOptions = {},
  ): Promise<M3WorkspaceOpenResult> {
    return this.serialize(async () => {
      await this.verifyTrustedRuntime();
      return this.openOwned(() => this.workspaceService.open(root, options));
    });
  }

  createWorkspace(input: CreateWorkspaceInput): Promise<M3WorkspaceOpenResult> {
    return this.serialize(async () => {
      await this.verifyTrustedRuntime();
      return this.openOwned(() => this.workspaceService.create(input));
    });
  }

  close(options: M3WorkspaceCloseOptions = {}): Promise<M3WorkspaceCloseResult> {
    return this.serialize(async () => {
      const active = this.active;
      if (active !== undefined) {
        const result = await active[ownedClose](options);
        if (result.status === "blocked") return result;
        this.active = undefined;
        this.transactionServices.delete(active.root);
      }
      this.transactionServices.clear();
      return { status: "closed" };
    });
  }

  private async openOwned(
    operation: () => Promise<OpenWorkspaceResult>,
  ): Promise<M3WorkspaceOpenResult> {
    if (this.active !== undefined) {
      throw new Error("An editable workspace is already owned by this application root");
    }
    const result = await operation();
    if (result.status !== "editable") {
      this.transactionServices.clear();
      return result;
    }
    try {
      const workspace = await this.composeEditable(result.session);
      this.active = workspace;
      return { status: "editable", workspace };
    } catch (error) {
      this.transactionServices.delete(result.session.root);
      await result.session.lease.release().catch(() => undefined);
      throw error;
    }
  }

  private async composeEditable(
    session: EditableWorkspaceSession,
  ): Promise<M3EditableWorkspace> {
    const transactionsForWorkspace = this.transactionServices.get(session.root);
    if (transactionsForWorkspace === undefined) {
      throw new Error("Editable workspace recovery did not create its transaction coordinator");
    }
    const lifetime = new WorkspaceLifetime(session);
    const retentionCoordinator = new RetentionCoordinator(
      new NodeWorkspaceRetentionSource({
        root: session.root,
        fileSystem: this.ports.fileSystem,
        catalog: this.options.catalog,
        ids: this.ports.ids,
        transactions: transactionsForWorkspace.storage,
      }),
    );
    const documents = new OwnedDocumentPersistence(
      new DocumentPersistenceService(this.ports, this.options.catalog),
      session,
      lifetime,
      retentionCoordinator,
    );
    const preferences = new OwnedWorkspacePreferences(
      new WorkspacePreferencesService(this.ports, this.options.catalog),
      session,
      lifetime,
    );
    const transactions = new OwnedTransactions(
      transactionsForWorkspace.coordinator,
      lifetime,
      retentionCoordinator,
    );
    const recoverySnapshotStore = new NodeRecoverySnapshotStore({
      root: session.root,
      workspaceId: session.registry.workspaceId,
      fileSystem: this.ports.fileSystem,
      ids: this.ports.ids,
      catalog: this.options.catalog,
    });
    const recoverySnapshots = new OwnedRecoverySnapshots(
      recoverySnapshotStore,
      lifetime,
      retentionCoordinator,
    );
    const resourceVerifier = await createNodeNoFollowResourceByteVerifier(session.root);
    const retention = new OwnedRetention(retentionCoordinator, lifetime);
    let artifacts: OwnedArtifacts | undefined;
    if (this.options.artifactPdfValidator !== undefined) {
      artifacts = new OwnedArtifacts(
        new ImmutableArtifactStore({
          storage: await createNodeArtifactStoragePort(session.root),
          records: createArtifactRecordSchemaValidator(this.options.catalog),
          hashes: { digest: hashBytes },
          pdfs: this.options.artifactPdfValidator,
        }),
        lifetime,
        retentionCoordinator,
      );
    }
    const context: M3WorkspaceBuildContext = {
      root: session.root,
      session,
      documents,
      preferences,
      transactions,
      recoverySnapshots,
      resourceVerifier,
      retention,
      ...(artifacts === undefined ? {} : { artifacts }),
    };
    let build: OwnedBuildServices | undefined;
    if (this.options.createBuildPorts !== undefined) {
      const buildPorts = await this.options.createBuildPorts(context);
      build = new OwnedBuildServices(
        new BuildOrchestrator(retainBuildResources(buildPorts, retentionCoordinator)),
        lifetime,
      );
    }
    return new M3EditableWorkspace(
      session,
      documents,
      preferences,
      transactions,
      recoverySnapshots,
      resourceVerifier,
      retention,
      lifetime,
      (workspace, options) => this.releaseWorkspace(workspace, options),
      artifacts,
      build,
    );
  }

  private releaseWorkspace(
    workspace: M3EditableWorkspace,
    options: M3WorkspaceCloseOptions,
  ): Promise<M3WorkspaceCloseResult> {
    return this.serialize(async () => {
      if (this.active !== workspace) return { status: "closed" };
      const result = await workspace[ownedClose](options);
      if (result.status === "closed") {
        this.active = undefined;
        this.transactionServices.delete(workspace.root);
      }
      return result;
    });
  }

  private async verifyTrustedRuntime(): Promise<void> {
    if (this.trustedRuntimeVerified || this.options.trustedRuntime === undefined) return;
    await this.options.trustedRuntime.verify();
    this.trustedRuntimeVerified = true;
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(() => undefined, () => undefined);
    return result;
  }
}

export type M3ReadOnlyWorkspace = ReadOnlyWorkspaceSession;
