import {
  createNodeWindowsSandboxBroker,
  NodeWindowsQuarantineWorker,
  type WindowsAuthenticodeVerifierPort,
  type WindowsQuarantineCapabilityPort,
  type WindowsSandboxAllowedTool,
  type WindowsSandboxBrokerPort,
  type WindowsSandboxNativeTransportFactory,
} from "@cbb/workers";
import { canonicalStringify } from "@cbb/core";
import type { CompileOutputReaderPort } from "../artifacts/index.js";
import type { ResourceStagingBytePort } from "../build/nodeSandbox.js";
import {
  NodeClosedTrustedComponentExecutor,
  type TrustedComponentExecutionGrant,
  type TrustedComponentExecutionOperation,
  type TrustedComponentIdentity,
  type TrustedComponentLocator,
  type TrustedComponentRegistry,
} from "../components/index.js";
import {
  NodeWindowsOfflineTypstSandbox,
  createWindowsBrokerCompileOutputReader,
  type WindowsSandboxCapabilityPort,
} from "./buildSandbox.js";
import { NodeWindowsPdfInspector } from "./pdfInspector.js";

export interface WindowsNativeToolBindingExpectation {
  readonly operation: TrustedComponentExecutionOperation;
  readonly toolId: string;
  readonly target: TrustedComponentIdentity;
}

export interface CreatePrivilegedWindowsToolBindingSessionRequest {
  readonly version: 1;
  readonly broker: TrustedComponentIdentity;
  readonly tools: readonly WindowsNativeToolBindingExpectation[];
}

export interface BindPrivilegedWindowsToolRequest {
  readonly version: 1;
  readonly operation: TrustedComponentExecutionOperation;
  readonly toolId: string;
  readonly broker: TrustedComponentIdentity;
  readonly target: TrustedComponentIdentity;
  /** Transient closed-executor values; native code must retain handles, not these strings. */
  readonly brokerPath: string;
  readonly targetPath: string;
}

export interface SealedPrivilegedWindowsM3Bindings {
  /** Transport must execute only the exact handle-bound tool closure supplied at creation. */
  readonly transports: WindowsSandboxNativeTransportFactory;
  readonly capabilities: WindowsSandboxCapabilityPort;
  readonly quarantineCapabilities: WindowsQuarantineCapabilityPort;
  /** Closes every retained tool/helper handle and the originating binding session. */
  close(): Promise<void>;
}

/**
 * Privileged native bridge required because a registry execution grant binds
 * one broker/target pair. It opens and hash-binds each target during that
 * pair's one-shot callback, then seals the exact three-tool closure.
 */
export interface PrivilegedWindowsToolBindingSession {
  bindTarget(request: BindPrivilegedWindowsToolRequest): Promise<void>;
  seal(): Promise<SealedPrivilegedWindowsM3Bindings>;
  close(): Promise<void>;
}

export interface PrivilegedWindowsToolBindingPort {
  create(
    request: CreatePrivilegedWindowsToolBindingSessionRequest,
  ): Promise<PrivilegedWindowsToolBindingSession>;
}

export interface SignedNodeWindowsM3RuntimeOptions {
  readonly registry: TrustedComponentRegistry;
  readonly executor: NodeClosedTrustedComponentExecutor;
  readonly executionBroker: TrustedComponentLocator;
  readonly typst: TrustedComponentLocator;
  readonly pdfInspector: TrustedComponentLocator;
  readonly quarantineWorker: TrustedComponentLocator;
  readonly nativeBindings: PrivilegedWindowsToolBindingPort;
  readonly authenticode: WindowsAuthenticodeVerifierPort;
  /** Independently installed trust anchor; the signed manifest cannot choose it. */
  readonly brokerSignerSha256Thumbprint: string;
  readonly architecture: "x64" | "arm64";
  readonly resources: ResourceStagingBytePort;
}

export interface SignedNodeWindowsM3Runtime {
  readonly broker: WindowsSandboxBrokerPort;
  readonly typstSandbox: NodeWindowsOfflineTypstSandbox;
  readonly pdfInspector: NodeWindowsPdfInspector;
  readonly quarantineWorker: NodeWindowsQuarantineWorker;
  readonly compileOutputReader: CompileOutputReaderPort;
  close(): Promise<void>;
}

interface GrantedTool {
  readonly operation: TrustedComponentExecutionOperation;
  readonly toolId: string;
  readonly grant: TrustedComponentExecutionGrant;
}

function runtimeFailure(): Error {
  const error = new Error("Signed Windows M3 runtime is unavailable");
  error.name = "SignedNodeWindowsM3RuntimeError";
  return error;
}

function allowedTool(tool: GrantedTool): WindowsSandboxAllowedTool {
  return Object.freeze({
    toolId: tool.toolId,
    version: tool.grant.target.version,
    hash: tool.grant.target.hash,
  });
}

function validSealed(value: SealedPrivilegedWindowsM3Bindings): boolean {
  return value !== null && typeof value === "object" &&
    typeof value.transports?.connect === "function" &&
    typeof value.capabilities?.createInput === "function" &&
    typeof value.capabilities?.readOutput === "function" &&
    typeof value.capabilities?.release === "function" &&
    typeof value.quarantineCapabilities?.reserve === "function" &&
    typeof value.quarantineCapabilities?.release === "function" &&
    typeof value.quarantineCapabilities?.discard === "function" &&
    typeof value.close === "function";
}

async function bindGrantedTool(
  options: SignedNodeWindowsM3RuntimeOptions,
  session: PrivilegedWindowsToolBindingSession,
  tool: GrantedTool,
  finalize: ((
    brokerPath: string,
    sealed: SealedPrivilegedWindowsM3Bindings,
    signal: AbortSignal,
  ) => Promise<void>) | undefined,
): Promise<void> {
  let callbackCompleted = false;
  const payload = options.executor.mint({
    operation: tool.operation,
    timeoutMs: 30_000,
    execute: async ({ brokerPath, targetPath, signal }) => {
      if (signal.aborted) throw runtimeFailure();
      await session.bindTarget({
        version: 1,
        operation: tool.operation,
        toolId: tool.toolId,
        broker: tool.grant.broker,
        target: tool.grant.target,
        brokerPath,
        targetPath,
      });
      if (signal.aborted) throw runtimeFailure();
      if (finalize !== undefined) {
        const sealed = await session.seal();
        if (!validSealed(sealed)) throw runtimeFailure();
        if (signal.aborted) {
          await sealed.close().catch(() => undefined);
          throw runtimeFailure();
        }
        await finalize(brokerPath, sealed, signal);
      }
      callbackCompleted = true;
    },
  });
  await options.registry.execution.invoke({ grant: tool.grant, payload });
  if (!callbackCompleted) throw runtimeFailure();
}

/**
 * Construct the complete Windows M3 runtime from opaque registry locators.
 * No public option accepts a helper/tool path. The signed broker is created
 * while the final closed-executor callback still owns its freshly verified path.
 */
export async function createSignedNodeWindowsM3Runtime(
  options: SignedNodeWindowsM3RuntimeOptions,
): Promise<SignedNodeWindowsM3Runtime> {
  const [typstGrant, pdfGrant, quarantineGrant] = await Promise.all([
    options.registry.execution.authorize({
      operation: "typstCompile",
      broker: options.executionBroker,
      target: options.typst,
    }),
    options.registry.execution.authorize({
      operation: "pdfInspect",
      broker: options.executionBroker,
      target: options.pdfInspector,
    }),
    options.registry.execution.authorize({
      operation: "quarantineExecute",
      broker: options.executionBroker,
      target: options.quarantineWorker,
    }),
  ]);
  const tools: readonly GrantedTool[] = Object.freeze([
    Object.freeze({ operation: "typstCompile", toolId: "typst", grant: typstGrant }),
    Object.freeze({ operation: "pdfInspect", toolId: "pdf-inspector", grant: pdfGrant }),
    Object.freeze({
      operation: "quarantineExecute",
      toolId: "quarantine-worker",
      grant: quarantineGrant,
    }),
  ]);
  const brokerIdentity = typstGrant.broker;
  if (
    tools.some((tool) =>
      canonicalStringify(tool.grant.broker) !== canonicalStringify(brokerIdentity) ||
      tool.grant.broker.role !== "executionBroker" ||
      tool.grant.broker.platform !== "win32" ||
      tool.grant.target.platform !== "win32" ||
      tool.grant.target.arch !== brokerIdentity.arch
    ) ||
    options.architecture !== brokerIdentity.arch ||
    typstGrant.target.role !== "typstCli" ||
    pdfGrant.target.role !== "pdfInspector" ||
    quarantineGrant.target.role !== "quarantineWorker"
  ) throw runtimeFailure();

  const allowedTools = Object.freeze(tools.map(allowedTool));
  const session = await options.nativeBindings.create({
    version: 1,
    broker: brokerIdentity,
    tools: Object.freeze(tools.map((tool) => Object.freeze({
      operation: tool.operation,
      toolId: tool.toolId,
      target: tool.grant.target,
    }))),
  });
  let sealed: SealedPrivilegedWindowsM3Bindings | undefined;
  let broker: WindowsSandboxBrokerPort | undefined;
  let runtime: SignedNodeWindowsM3Runtime | undefined;
  try {
    await bindGrantedTool(options, session, tools[0]!, undefined);
    await bindGrantedTool(options, session, tools[1]!, undefined);
    await bindGrantedTool(options, session, tools[2]!, async (brokerPath, value, signal) => {
      sealed = value;
      broker = await createNodeWindowsSandboxBroker({
        helper: {
          path: brokerPath,
          hash: brokerIdentity.hash,
          signerSha256Thumbprint: options.brokerSignerSha256Thumbprint,
          architecture: options.architecture,
          version: brokerIdentity.version,
        },
        allowedTools,
        authenticode: options.authenticode,
        transports: value.transports,
      });
      if (signal.aborted) {
        await broker.close().catch(() => undefined);
        broker = undefined;
        throw runtimeFailure();
      }
      const typstTool = allowedTools[0]!;
      const pdfTool = allowedTools[1]!;
      const quarantineTool = allowedTools[2]!;
      const typstSandbox = new NodeWindowsOfflineTypstSandbox({
        broker,
        capabilities: value.capabilities,
        resources: options.resources,
        typst: {
          toolId: "typst",
          version: typstTool.version,
          executableHash: typstTool.hash,
        },
      });
      const pdfInspector = new NodeWindowsPdfInspector({
        broker,
        capabilities: value.capabilities,
        identity: pdfTool,
      });
      const quarantineWorker = new NodeWindowsQuarantineWorker({
        broker,
        capabilities: value.quarantineCapabilities,
        worker: quarantineTool,
      });
      let closed = false;
      runtime = Object.freeze({
        broker,
        typstSandbox,
        pdfInspector,
        quarantineWorker,
        compileOutputReader: createWindowsBrokerCompileOutputReader(value.capabilities),
        async close() {
          if (closed) return;
          closed = true;
          const results = await Promise.allSettled([broker!.close(), value.close()]);
          if (results.some((result) => result.status === "rejected")) throw runtimeFailure();
        },
      });
    });
    if (runtime === undefined) throw runtimeFailure();
    return runtime;
  } catch {
    await broker?.close().catch(() => undefined);
    await (sealed?.close() ?? session.close()).catch(() => undefined);
    throw runtimeFailure();
  }
}
