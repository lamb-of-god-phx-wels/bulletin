import { canonicalStringify } from "@cbb/core";
import {
  NodeClosedTrustedComponentExecutor,
  type TrustedComponentExecutionGrant,
  type TrustedComponentLocator,
  type TrustedComponentRegistry,
} from "../components/index.js";
import {
  NodePdfInfoInspector,
  type NodePdfInfoInspectorOptions,
} from "../artifacts/index.js";
import {
  NodeOfflineTypstSandbox,
  NodeTypstSandboxError,
  type NodeOfflineTypstSandboxOptions,
} from "./nodeSandbox.js";

export interface SignedNodeOfflineTypstSandboxOptions
extends Omit<NodeOfflineTypstSandboxOptions, "typst" | "executionBroker" | "runtimeManifest"> {
  readonly registry: TrustedComponentRegistry;
  readonly executor: NodeClosedTrustedComponentExecutor;
  readonly executionBroker: TrustedComponentLocator;
  readonly typst: TrustedComponentLocator;
  readonly typstRuntime: TrustedComponentLocator;
}

export interface SignedNodePdfInfoInspectorOptions
extends Omit<NodePdfInfoInspectorOptions, "pdfinfo" | "executionBroker" | "runtimeManifest"> {
  readonly registry: TrustedComponentRegistry;
  readonly executor: NodeClosedTrustedComponentExecutor;
  readonly executionBroker: TrustedComponentLocator;
  readonly pdfInspector: TrustedComponentLocator;
  readonly pdfRuntime: TrustedComponentLocator;
}

function sameBroker(
  left: TrustedComponentExecutionGrant,
  right: TrustedComponentExecutionGrant,
): boolean {
  return canonicalStringify(left.broker) === canonicalStringify(right.broker);
}

/** Construct the Linux sandbox only from the exact signed broker/Typst grant. */
export async function createSignedNodeOfflineTypstSandbox(
  options: SignedNodeOfflineTypstSandboxOptions,
): Promise<NodeOfflineTypstSandbox> {
  const [grant, runtimeGrant] = await Promise.all([
    options.registry.execution.authorize({
      operation: "typstCompile",
      broker: options.executionBroker,
      target: options.typst,
    }),
    options.registry.execution.authorize({
      operation: "typstRuntimeBind",
      broker: options.executionBroker,
      target: options.typstRuntime,
    }),
  ]);
  if (!sameBroker(grant, runtimeGrant)) {
    throw new NodeTypstSandboxError("componentVerificationFailed");
  }
  let sandbox: NodeOfflineTypstSandbox | undefined;
  const runtimePayload = options.executor.mint({
    operation: "typstRuntimeBind",
    timeoutMs: 30_000,
    execute: async ({ brokerPath: runtimeBrokerPath, targetPath: runtimePath, signal }) => {
      if (signal.aborted) throw new NodeTypstSandboxError("isolationUnavailable");
      const toolPayload = options.executor.mint({
        operation: "typstCompile",
        timeoutMs: 30_000,
        execute: async ({ brokerPath, targetPath, signal: toolSignal }) => {
          if (signal.aborted || toolSignal.aborted || brokerPath !== runtimeBrokerPath) {
            throw new NodeTypstSandboxError("isolationUnavailable");
          }
          sandbox = await NodeOfflineTypstSandbox.create({
            privateBuildParent: options.privateBuildParent,
            typst: {
              path: targetPath,
              toolId: "typst",
              version: grant.target.version,
              hash: grant.target.hash,
              byteSize: grant.target.byteSize,
            },
            runtimeManifest: {
              path: runtimePath,
              hash: runtimeGrant.target.hash,
              byteSize: runtimeGrant.target.byteSize,
            },
            executionBroker: { path: brokerPath, hash: grant.broker.hash },
            resources: options.resources,
            pdfs: options.pdfs,
            outputHandles: options.outputHandles,
          });
          if (signal.aborted || toolSignal.aborted) {
            throw new NodeTypstSandboxError("isolationUnavailable");
          }
        },
      });
      await options.registry.execution.invoke({ grant, payload: toolPayload });
    },
  });
  await options.registry.execution.invoke({ grant: runtimeGrant, payload: runtimePayload });
  if (sandbox === undefined) throw new NodeTypstSandboxError("isolationUnavailable");
  return sandbox;
}

/** Construct the PDF inspector only from the exact signed broker/target grant. */
export async function createSignedNodePdfInfoInspector(
  options: SignedNodePdfInfoInspectorOptions,
): Promise<NodePdfInfoInspector> {
  const [grant, runtimeGrant] = await Promise.all([
    options.registry.execution.authorize({
      operation: "pdfInspect",
      broker: options.executionBroker,
      target: options.pdfInspector,
    }),
    options.registry.execution.authorize({
      operation: "pdfRuntimeBind",
      broker: options.executionBroker,
      target: options.pdfRuntime,
    }),
  ]);
  if (!sameBroker(grant, runtimeGrant)) throw new Error("Signed PDF runtime is unavailable");
  let inspector: NodePdfInfoInspector | undefined;
  const runtimePayload = options.executor.mint({
    operation: "pdfRuntimeBind",
    timeoutMs: 30_000,
    execute: async ({ brokerPath: runtimeBrokerPath, targetPath: runtimePath, signal }) => {
      if (signal.aborted) throw new Error("PDF inspection initialization canceled");
      const toolPayload = options.executor.mint({
        operation: "pdfInspect",
        timeoutMs: 15_000,
        execute: async ({ brokerPath, targetPath, signal: toolSignal }) => {
          if (signal.aborted || toolSignal.aborted || brokerPath !== runtimeBrokerPath) {
            throw new Error("PDF inspection initialization canceled");
          }
          inspector = await NodePdfInfoInspector.create({
            privateInspectionParent: options.privateInspectionParent,
            pdfinfo: {
              path: targetPath,
              toolId: grant.target.id,
              version: grant.target.version,
              hash: grant.target.hash,
              byteSize: grant.target.byteSize,
            },
            runtimeManifest: {
              path: runtimePath,
              hash: runtimeGrant.target.hash,
              byteSize: runtimeGrant.target.byteSize,
            },
            executionBroker: { path: brokerPath, hash: grant.broker.hash },
          });
          if (signal.aborted || toolSignal.aborted) {
            throw new Error("PDF inspection initialization canceled");
          }
        },
      });
      await options.registry.execution.invoke({ grant, payload: toolPayload });
    },
  });
  await options.registry.execution.invoke({ grant: runtimeGrant, payload: runtimePayload });
  if (inspector === undefined) throw new Error("Signed PDF inspector is unavailable");
  return inspector;
}
