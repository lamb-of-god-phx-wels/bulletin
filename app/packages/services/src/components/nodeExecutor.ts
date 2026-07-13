import { randomUUID } from "node:crypto";
import {
  TRUSTED_COMPONENT_EXECUTION_LIMITS,
  type TrustedComponentExecutionOperation,
  type TrustedComponentOperationPayload,
} from "./types.js";
import type { PrivilegedNodeTrustedComponentExecutorPort } from "./nodeRegistry.js";

const MAX_PENDING_OPERATIONS = 128;

export interface ClosedTrustedComponentPaths {
  readonly brokerPath: string;
  readonly targetPath: string;
}

export interface ClosedTrustedComponentOperationContext extends ClosedTrustedComponentPaths {
  readonly signal: AbortSignal;
}

export interface MintClosedTrustedComponentOperationRequest {
  readonly operation: TrustedComponentExecutionOperation;
  readonly timeoutMs: number;
  readonly execute: (context: ClosedTrustedComponentOperationContext) => Promise<void>;
}

interface PendingOperation {
  readonly operation: TrustedComponentExecutionOperation;
  readonly timeoutMs: number;
  readonly execute: MintClosedTrustedComponentOperationRequest["execute"];
  consumed: boolean;
}

function failure(): Error {
  const error = new Error("Closed trusted component operation failed");
  error.name = "ClosedTrustedComponentExecutorError";
  return error;
}

/**
 * Main-process bridge between path-free registry grants and platform adapters.
 * Paths exist only for the duration of a one-shot callback and never become a
 * property of the payload, grant, registry, result, or thrown error.
 */
export class NodeClosedTrustedComponentExecutor
implements PrivilegedNodeTrustedComponentExecutorPort {
  private readonly entries = new WeakMap<object, PendingOperation>();
  private pendingCount = 0;

  mint(request: MintClosedTrustedComponentOperationRequest): TrustedComponentOperationPayload {
    const limit = TRUSTED_COMPONENT_EXECUTION_LIMITS[request.operation]?.maximumRuntimeMs;
    if (
      limit === undefined ||
      !Number.isSafeInteger(request.timeoutMs) ||
      request.timeoutMs < 1 ||
      request.timeoutMs > limit ||
      typeof request.execute !== "function" ||
      this.pendingCount >= MAX_PENDING_OPERATIONS
    ) throw failure();
    const payload = Object.freeze({
      token: `trusted-payload:${randomUUID()}`,
      operation: request.operation,
      timeoutMs: request.timeoutMs,
    }) as TrustedComponentOperationPayload;
    this.entries.set(payload, {
      operation: request.operation,
      timeoutMs: request.timeoutMs,
      execute: request.execute,
      consumed: false,
    });
    this.pendingCount += 1;
    return payload;
  }

  ownsPayload(
    payload: TrustedComponentOperationPayload,
    operation: TrustedComponentExecutionOperation,
  ): boolean {
    const entry = this.entries.get(payload);
    return entry !== undefined && !entry.consumed && entry.operation === operation;
  }

  async invoke(request: {
    readonly operation: TrustedComponentExecutionOperation;
    readonly brokerPath: string;
    readonly targetPath: string;
    readonly payload: TrustedComponentOperationPayload;
  }): Promise<void> {
    const entry = this.entries.get(request.payload);
    if (
      entry === undefined || entry.consumed || entry.operation !== request.operation ||
      request.payload.operation !== request.operation ||
      request.payload.timeoutMs !== entry.timeoutMs
    ) throw failure();
    entry.consumed = true;
    this.pendingCount -= 1;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        entry.execute(Object.freeze({
          brokerPath: request.brokerPath,
          targetPath: request.targetPath,
          signal: controller.signal,
        })),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort("trustedComponentTimeout");
            reject(failure());
          }, entry.timeoutMs);
          timer.unref();
        }),
      ]);
    } catch {
      throw failure();
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
