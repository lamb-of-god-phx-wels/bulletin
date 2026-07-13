import {
  NodeBubblewrapQuarantineWorker,
  type NodeBubblewrapQuarantineWorkerOptions,
} from "@cbb/workers";
import { NodeClosedTrustedComponentExecutor } from "./nodeExecutor.js";
import type {
  TrustedComponentLocator,
  TrustedComponentRegistry,
} from "./types.js";

export interface SignedNodeBubblewrapQuarantineWorkerOptions
extends Omit<NodeBubblewrapQuarantineWorkerOptions, "bubblewrap" | "worker"> {
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
        bubblewrap: { path: brokerPath, hash: grant.broker.hash },
        worker: {
          path: targetPath,
          hash: grant.target.hash,
          staticallyLinked: true,
        },
      });
    },
  });
  await options.registry.execution.invoke({ grant, payload });
  if (worker === undefined) {
    throw new Error("Signed quarantine worker is unavailable");
  }
  return worker;
}
