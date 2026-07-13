import type {
  BuildExecutionPort,
  OrchestratedRunnerOutcome,
  OrchestratedRunnerRequest,
} from "./orchestrator.js";
import {
  runIsolatedTypstCompile,
  type BuildRunnerTimerPort,
  type CompileArtifactSinkPort,
  type IsolatedTypstSandboxPort,
  type TrustedTypstRequirement,
} from "./runner.js";

export interface BuildExecutionSinkPort {
  /** Bind trusted artifact metadata for exactly this prepared request. */
  bind(request: OrchestratedRunnerRequest): Promise<CompileArtifactSinkPort<unknown>> |
    CompileArtifactSinkPort<unknown>;
}

export interface IsolatedBuildExecutionOptions {
  readonly sandbox: IsolatedTypstSandboxPort;
  readonly timer: BuildRunnerTimerPort;
  readonly tool: TrustedTypstRequirement;
  readonly sinks: BuildExecutionSinkPort;
}

/** Real wall-clock timeout adapter; timeout does not cancel the work itself. */
export const nodeBuildRunnerTimer: BuildRunnerTimerPort = Object.freeze({
  async raceTimeout<Result>(work: Promise<Result>, timeoutMs: number) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work.then((value) => ({ kind: "completed" as const, value })),
        new Promise<{ readonly kind: "timedOut" }>((resolveTimeout) => {
          timer = setTimeout(() => resolveTimeout({ kind: "timedOut" }), timeoutMs);
          timer.unref();
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  },
});

function outcome(
  status: Awaited<ReturnType<typeof runIsolatedTypstCompile<unknown>>>,
): OrchestratedRunnerOutcome {
  if (status.status === "succeeded") return { kind: "succeeded", diagnosticCodes: [] };
  if (status.kind === "timedOut") {
    return { kind: "timedOut", diagnosticCodes: status.diagnosticCodes };
  }
  if (status.kind === "canceled") {
    return { kind: "canceled", diagnosticCodes: status.diagnosticCodes };
  }
  return { kind: "failed", diagnosticCodes: status.diagnosticCodes };
}

/**
 * Concrete BuildExecutionPort joining the queue/orchestrator to the isolated
 * low-level runner and an immutable artifact sink. Cancellation aborts the
 * same signal observed by the sandbox and therefore kills its process tree.
 */
export class IsolatedBuildExecution implements BuildExecutionPort {
  private readonly active = new Map<string, AbortController>();

  constructor(private readonly options: IsolatedBuildExecutionOptions) {}

  async execute(
    request: OrchestratedRunnerRequest,
    outerSignal: AbortSignal,
  ): Promise<OrchestratedRunnerOutcome> {
    const buildId = request.request.buildId;
    if (this.active.has(buildId)) {
      return { kind: "failed", diagnosticCodes: ["CBB-BUILD-0001"] };
    }
    const controller = new AbortController();
    const abort = () => controller.abort(outerSignal.reason);
    outerSignal.addEventListener("abort", abort, { once: true });
    if (outerSignal.aborted) abort();
    this.active.set(buildId, controller);
    try {
      const sink = await this.options.sinks.bind(request);
      const result = await runIsolatedTypstCompile(
        {
          buildId,
          source: request.generatedSource.source,
          sourceHash: request.generatedSource.sourceHash,
          resources: request.resources,
          timeoutMs: request.request.kind === "manual" ? 120_000 : 30_000,
        },
        this.options.tool,
        this.options.sandbox,
        this.options.timer,
        sink,
        controller.signal,
      );
      return outcome(result);
    } catch {
      return controller.signal.aborted
        ? { kind: "canceled", diagnosticCodes: ["CBB-BUILD-0002"] }
        : { kind: "failed", diagnosticCodes: ["CBB-BUILD-0001"] };
    } finally {
      outerSignal.removeEventListener("abort", abort);
      this.active.delete(buildId);
    }
  }

  async cancelProcessTree(buildId: string): Promise<void> {
    this.active.get(buildId)?.abort("buildCanceled");
  }
}
