import {
  NodeClosedTrustedComponentExecutor,
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
extends Omit<NodeOfflineTypstSandboxOptions, "typst" | "bubblewrap"> {
  readonly registry: TrustedComponentRegistry;
  readonly executor: NodeClosedTrustedComponentExecutor;
  readonly executionBroker: TrustedComponentLocator;
  readonly typst: TrustedComponentLocator;
}

export interface SignedNodePdfInfoInspectorOptions
extends Omit<NodePdfInfoInspectorOptions, "pdfinfo" | "bubblewrap"> {
  readonly registry: TrustedComponentRegistry;
  readonly executor: NodeClosedTrustedComponentExecutor;
  readonly executionBroker: TrustedComponentLocator;
  readonly pdfInspector: TrustedComponentLocator;
}

/** Construct the Linux sandbox only from the exact signed broker/Typst grant. */
export async function createSignedNodeOfflineTypstSandbox(
  options: SignedNodeOfflineTypstSandboxOptions,
): Promise<NodeOfflineTypstSandbox> {
  const grant = await options.registry.execution.authorize({
    operation: "typstCompile",
    broker: options.executionBroker,
    target: options.typst,
  });
  let sandbox: NodeOfflineTypstSandbox | undefined;
  const payload = options.executor.mint({
    operation: "typstCompile",
    timeoutMs: 30_000,
    execute: async ({ brokerPath, targetPath, signal }) => {
      if (signal.aborted) throw new NodeTypstSandboxError("isolationUnavailable");
      sandbox = await NodeOfflineTypstSandbox.create({
        privateBuildParent: options.privateBuildParent,
        typst: {
          path: targetPath,
          toolId: "typst",
          version: grant.target.version,
          hash: grant.target.hash,
        },
        bubblewrap: { path: brokerPath, hash: grant.broker.hash },
        resources: options.resources,
        pdfs: options.pdfs,
        outputHandles: options.outputHandles,
      });
    },
  });
  await options.registry.execution.invoke({ grant, payload });
  if (sandbox === undefined) throw new NodeTypstSandboxError("isolationUnavailable");
  return sandbox;
}

/** Construct the PDF inspector only from the exact signed broker/target grant. */
export async function createSignedNodePdfInfoInspector(
  options: SignedNodePdfInfoInspectorOptions,
): Promise<NodePdfInfoInspector> {
  const grant = await options.registry.execution.authorize({
    operation: "pdfInspect",
    broker: options.executionBroker,
    target: options.pdfInspector,
  });
  let inspector: NodePdfInfoInspector | undefined;
  const payload = options.executor.mint({
    operation: "pdfInspect",
    timeoutMs: 15_000,
    execute: async ({ brokerPath, targetPath, signal }) => {
      if (signal.aborted) throw new Error("PDF inspection initialization canceled");
      inspector = await NodePdfInfoInspector.create({
        privateInspectionParent: options.privateInspectionParent,
        pdfinfo: {
          path: targetPath,
          toolId: grant.target.id,
          version: grant.target.version,
          hash: grant.target.hash,
        },
        bubblewrap: { path: brokerPath, hash: grant.broker.hash },
      });
    },
  });
  await options.registry.execution.invoke({ grant, payload });
  if (inspector === undefined) throw new Error("Signed PDF inspector is unavailable");
  return inspector;
}
