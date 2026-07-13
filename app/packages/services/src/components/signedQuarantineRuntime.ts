import {
  NodeBubblewrapQuarantineWorker,
  NodeLinuxPdfFlattenWorker,
  RoutedLinuxQuarantineWorker,
  type NodeBubblewrapQuarantineWorkerOptions,
  type QuarantineWorkerPort,
} from "@cbb/workers";
import { NodeClosedTrustedComponentExecutor } from "./nodeExecutor.js";
import type {
  TrustedComponentLocator,
  TrustedComponentRegistry,
} from "./types.js";

export interface SignedNodeBubblewrapQuarantineWorkerOptions
extends Omit<NodeBubblewrapQuarantineWorkerOptions, "executionBroker" | "worker"> {
  readonly registry: TrustedComponentRegistry;
  readonly executor: NodeClosedTrustedComponentExecutor;
  readonly executionBroker: TrustedComponentLocator;
  readonly quarantineWorker: TrustedComponentLocator;
}

/**
 * Construct the Linux quarantine transport only inside a one-shot grant for
 * the exact signed broker and statically linked worker. The returned adapter
 * owns those paths privately and rehashes both before every request.
 */
export async function createSignedNodeBubblewrapQuarantineWorker(
  options: SignedNodeBubblewrapQuarantineWorkerOptions,
): Promise<NodeBubblewrapQuarantineWorker> {
  const grant = await options.registry.execution.authorize({
    operation: "quarantineExecute",
    broker: options.executionBroker,
    target: options.quarantineWorker,
  });
  let worker: NodeBubblewrapQuarantineWorker | undefined;
  const payload = options.executor.mint({
    operation: "quarantineExecute",
    timeoutMs: 15_000,
    execute: async ({ brokerPath, targetPath, signal }) => {
      if (signal.aborted) return;
      worker = await NodeBubblewrapQuarantineWorker.create({
        runtimeRoot: options.runtimeRoot,
        handles: options.handles,
        ...(options.maximumMessageBytes === undefined
          ? {}
          : { maximumMessageBytes: options.maximumMessageBytes }),
        executionBroker: { path: brokerPath, hash: grant.broker.hash },
        worker: {
          path: targetPath,
          hash: grant.target.hash,
          staticallyLinked: true,
        },
      });
    },
  });
  await options.registry.execution.invoke({ grant, payload });
  if (worker === undefined || !worker.isolationAvailable) {
    throw new Error("Signed quarantine worker is unavailable");
  }
  return worker;
}

export interface SignedNodeLinuxQuarantineWorkerOptions
extends SignedNodeBubblewrapQuarantineWorkerOptions {
  readonly pdfFlattener: TrustedComponentLocator;
  readonly pdfInspector: TrustedComponentLocator;
  readonly pdfStructuralInspector: TrustedComponentLocator;
  readonly pdfRuntimeClosure: TrustedComponentLocator;
  readonly pdfPrivateRuntimeRoot: string;
  readonly maximumPdfRuntimeMs?: number;
}

/** Bind static parsing and external PDF flattening into one closed operation router. */
export async function createSignedNodeLinuxQuarantineWorker(
  options: SignedNodeLinuxQuarantineWorkerOptions,
): Promise<QuarantineWorkerPort> {
  const staticWorker = await createSignedNodeBubblewrapQuarantineWorker(options);
  const flattenGrant = await options.registry.execution.authorize({
    operation: "pdfFlatten",
    broker: options.executionBroker,
    target: options.pdfFlattener,
  });
  const inspectGrant = await options.registry.execution.authorize({
    operation: "pdfInspect",
    broker: options.executionBroker,
    target: options.pdfInspector,
  });
  const structuralGrant = await options.registry.execution.authorize({
    operation: "pdfStructuralInspect",
    broker: options.executionBroker,
    target: options.pdfStructuralInspector,
  });
  const runtimeGrant = await options.registry.execution.authorize({
    operation: "pdfRuntimeBind",
    broker: options.executionBroker,
    target: options.pdfRuntimeClosure,
  });
  let pdfWorker: NodeLinuxPdfFlattenWorker | undefined;
  if (
    flattenGrant.broker.hash !== inspectGrant.broker.hash ||
    flattenGrant.broker.hash !== structuralGrant.broker.hash ||
    flattenGrant.broker.hash !== runtimeGrant.broker.hash
  ) throw new Error("PDF runtime broker identity mismatch");
  const flattenPayload = options.executor.mint({
    operation: "pdfFlatten",
    timeoutMs: 120_000,
    execute: async ({ targetPath: flattenerPath, signal: flattenSignal }) => {
      if (flattenSignal.aborted) throw new Error("PDF flattener binding canceled");
      const inspectPayload = options.executor.mint({
        operation: "pdfInspect",
        timeoutMs: 30_000,
        execute: async ({ targetPath: inspectorPath, signal: inspectSignal }) => {
          if (flattenSignal.aborted || inspectSignal.aborted) {
            throw new Error("PDF inspector binding canceled");
          }
          const structuralPayload = options.executor.mint({
            operation: "pdfStructuralInspect",
            timeoutMs: 30_000,
            execute: async ({ targetPath: structuralInspectorPath, signal: structuralSignal }) => {
              if (flattenSignal.aborted || inspectSignal.aborted || structuralSignal.aborted) {
                throw new Error("PDF structural inspector binding canceled");
              }
              const runtimePayload = options.executor.mint({
                operation: "pdfRuntimeBind",
                timeoutMs: 30_000,
                execute: async ({ brokerPath, targetPath, signal: runtimeSignal }) => {
                  if (
                    flattenSignal.aborted || inspectSignal.aborted ||
                    structuralSignal.aborted || runtimeSignal.aborted
                  ) throw new Error("PDF runtime binding canceled");
                  pdfWorker = await NodeLinuxPdfFlattenWorker.create({
                    executionBroker: { path: brokerPath, hash: runtimeGrant.broker.hash },
                    flattener: {
                      path: flattenerPath,
                      hash: flattenGrant.target.hash,
                      byteSize: flattenGrant.target.byteSize,
                      version: flattenGrant.target.version,
                    },
                    inspector: {
                      path: inspectorPath,
                      hash: inspectGrant.target.hash,
                      byteSize: inspectGrant.target.byteSize,
                      version: inspectGrant.target.version,
                    },
                    structuralInspector: {
                      path: structuralInspectorPath,
                      hash: structuralGrant.target.hash,
                      byteSize: structuralGrant.target.byteSize,
                      version: structuralGrant.target.version,
                    },
                    runtimeManifest: {
                      path: targetPath,
                      hash: runtimeGrant.target.hash,
                      byteSize: runtimeGrant.target.byteSize,
                    },
                    privateRuntimeRoot: options.pdfPrivateRuntimeRoot,
                    handles: options.handles,
                    ...(options.maximumPdfRuntimeMs === undefined
                      ? {}
                      : { maximumRuntimeMs: options.maximumPdfRuntimeMs }),
                  });
                },
              });
              await options.registry.execution.invoke({ grant: runtimeGrant, payload: runtimePayload });
            },
          });
          await options.registry.execution.invoke({ grant: structuralGrant, payload: structuralPayload });
        },
      });
      await options.registry.execution.invoke({ grant: inspectGrant, payload: inspectPayload });
    },
  });
  await options.registry.execution.invoke({ grant: flattenGrant, payload: flattenPayload });
  if (pdfWorker === undefined || !pdfWorker.isolationAvailable) {
    throw new Error("Signed PDF flattening worker is unavailable");
  }
  return new RoutedLinuxQuarantineWorker(staticWorker, pdfWorker);
}
