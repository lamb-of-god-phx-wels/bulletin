import {
  quarantineInputByteLimit,
  quarantineMediaTypesFor,
  quarantineObservedInputBytes,
  quarantineOutputByteLimit,
  validateQuarantineRequest,
  validateQuarantineResult,
  type QuarantineFailure,
  type QuarantineFailureReason,
  type QuarantineHandle,
  type QuarantineMediaType,
  type QuarantineOperation,
  type QuarantineRequest,
  type QuarantineResult,
  type QuarantineSuccess,
} from "./protocol.js";

const HASH = /^sha256:[0-9a-f]{64}$/u;
const RECEIPT_SECRET = Object.freeze({});

export interface QuarantineWorkerPort {
  /** True only for the required OS-sandboxed, no-network execution adapter. */
  readonly isolationAvailable: boolean;
  /** Worker messages remain unknown until closed protocol validation succeeds. */
  execute(request: QuarantineRequest): Promise<unknown>;
  /** Idempotently stop and reap the request process. */
  terminate(requestId: string): Promise<void>;
}

export interface QuarantineTimerPort {
  raceTimeout<Result>(work: Promise<Result>, timeoutMs: number): Promise<
    | { readonly kind: "completed"; readonly value: Result }
    | { readonly kind: "timedOut" }
  >;
}

/** Path-free request for privileged verification of the app-owned input. */
export interface QuarantineInputVerificationRequest {
  readonly version: 1;
  readonly requestId: string;
  readonly operation: QuarantineOperation;
  readonly input: QuarantineHandle;
  readonly maximumBytes: number;
}

/** Privileged identity of the exact stable bytes supplied to the worker. */
export interface RehashedQuarantineInput {
  readonly version: 1;
  readonly requestId: string;
  readonly operation: QuarantineOperation;
  readonly input: QuarantineHandle;
  readonly hash: `sha256:${string}`;
  readonly byteSize: number;
}

/** Path-free verifier request. No worker-supplied path or hash crosses this boundary. */
export interface QuarantineOutputVerificationRequest {
  readonly version: 1;
  readonly requestId: string;
  readonly operation: QuarantineOperation;
  readonly output: QuarantineHandle;
  readonly maximumBytes: number;
  readonly maximumEntries: number;
  readonly maximumEntryBytes: number;
  readonly allowedMediaTypes: readonly QuarantineMediaType[];
}

/** Privileged observation produced by independently reading and hashing the opaque output. */
export interface RehashedQuarantineOutput {
  readonly version: 1;
  readonly requestId: string;
  readonly operation: QuarantineOperation;
  readonly output: QuarantineHandle;
  readonly hash: `sha256:${string}`;
  readonly byteSize: number;
  readonly mediaType: QuarantineMediaType;
}

/**
 * One privileged owner for the opaque handles. The broker never receives a
 * path, and failed/canceled work cannot leave an output capability behind.
 */
export interface PrivilegedQuarantineHandlePort {
  verifyAndRehashInput(request: QuarantineInputVerificationRequest): Promise<unknown>;
  verifyAndRehash(request: QuarantineOutputVerificationRequest): Promise<unknown>;
  cleanupInput(input: QuarantineHandle): Promise<void>;
  discardOutput(output: QuarantineHandle): Promise<void>;
}

/** Compatibility name for consumers that describe the combined port by its output role. */
export type PrivilegedQuarantineOutputVerifierPort = PrivilegedQuarantineHandlePort;

/** Evidence safe to translate into a services resource-install request. */
export interface VerifiedQuarantineOutputEvidence {
  readonly version: 1;
  readonly kind: "verifiedQuarantineOutput";
  readonly requestId: string;
  readonly operation: QuarantineOperation;
  readonly output: QuarantineHandle;
  readonly outputHash: `sha256:${string}`;
  readonly outputBytes: number;
  readonly mediaType: QuarantineMediaType;
  /** Detached, closed worker metadata bound to these independently rehashed bytes. */
  readonly result: QuarantineSuccess;
}

const RECEIPTS = new WeakMap<object, VerifiedQuarantineOutputEvidence>();

/** Runtime capability minted only after privileged input and output verification. */
export class VerifiedQuarantineReceipt {
  public constructor(secret: unknown, evidence: VerifiedQuarantineOutputEvidence) {
    if (secret !== RECEIPT_SECRET) {
      throw new TypeError("Verified quarantine receipts can only be broker-minted");
    }
    RECEIPTS.set(this, evidence);
    Object.freeze(this);
  }
}

/** Reject structural lookalikes; only a live broker-minted capability unwraps. */
export function readVerifiedQuarantineReceipt(
  receipt: unknown,
): VerifiedQuarantineOutputEvidence {
  const evidence = receipt !== null && typeof receipt === "object"
    ? RECEIPTS.get(receipt)
    : undefined;
  if (evidence === undefined) {
    throw new TypeError("Value is not a broker-verified quarantine receipt");
  }
  return evidence;
}

export interface VerifiedQuarantineBrokerSuccess {
  readonly status: "succeeded";
  readonly result: QuarantineSuccess;
  readonly receipt: VerifiedQuarantineReceipt;
}

export type QuarantineBrokerResult = VerifiedQuarantineBrokerSuccess | QuarantineFailure;

export interface QuarantineRunOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

function failure(
  request: QuarantineRequest,
  reason: QuarantineFailure["reason"],
  message = failureMessage(reason),
): QuarantineFailure {
  return {
    version: 1,
    requestId: request.requestId,
    operation: request.operation,
    status: "failed",
    code: "CBB-SECURITY-0001",
    reason,
    message,
  };
}

function failureMessage(reason: QuarantineFailureReason): string {
  switch (reason) {
    case "isolationUnavailable": return "Required isolated content validation is unavailable.";
    case "workerCrash": return "The isolated content worker failed.";
    case "timeout": return "The isolated content worker timed out.";
    case "canceled": return "The isolated content operation was canceled.";
    case "limitExceeded": return "Untrusted content exceeded an authorized processing limit.";
    case "invalidContent": return "Untrusted content failed isolated validation.";
    case "malformedResult": return "The isolated worker returned invalid output.";
    case "outputVerificationFailed": return "The isolated output failed privileged byte verification.";
    case "inputVerificationFailed": return "The isolated input failed privileged byte verification.";
    case "cleanupFailed": return "The isolated content operation could not be cleaned up safely.";
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

function exactEvidence(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
): Record<string, unknown> {
  const evidence = record(value, label);
  const keys = Reflect.ownKeys(evidence);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key)) ||
    expectedKeys.some((key) => !Object.prototype.hasOwnProperty.call(evidence, key))
  ) throw new TypeError(`${label} is malformed`);
  return evidence;
}

function validateRehashedInput(
  value: unknown,
  request: QuarantineInputVerificationRequest,
): RehashedQuarantineInput {
  const evidence = exactEvidence(value, [
    "version", "requestId", "operation", "input", "hash", "byteSize",
  ], "Privileged input evidence");
  if (
    evidence["version"] !== 1 ||
    evidence["requestId"] !== request.requestId ||
    evidence["operation"] !== request.operation ||
    evidence["input"] !== request.input ||
    typeof evidence["hash"] !== "string" ||
    !HASH.test(evidence["hash"]) ||
    !Number.isSafeInteger(evidence["byteSize"]) ||
    (evidence["byteSize"] as number) < 0 ||
    (evidence["byteSize"] as number) > request.maximumBytes
  ) throw new TypeError("Privileged input evidence is malformed or unbound");
  return evidence as unknown as RehashedQuarantineInput;
}

function validateRehashedOutput(
  value: unknown,
  request: QuarantineOutputVerificationRequest,
): RehashedQuarantineOutput {
  const evidence = exactEvidence(value, [
    "version", "requestId", "operation", "output", "hash", "byteSize", "mediaType",
  ], "Privileged output evidence");
  if (
    evidence["version"] !== 1 ||
    evidence["requestId"] !== request.requestId ||
    evidence["operation"] !== request.operation ||
    evidence["output"] !== request.output ||
    typeof evidence["hash"] !== "string" ||
    !HASH.test(evidence["hash"]) ||
    !Number.isSafeInteger(evidence["byteSize"]) ||
    (evidence["byteSize"] as number) < 0 ||
    (evidence["byteSize"] as number) > request.maximumBytes ||
    typeof evidence["mediaType"] !== "string" ||
    !request.allowedMediaTypes.includes(evidence["mediaType"] as QuarantineMediaType)
  ) throw new TypeError("Privileged output evidence is malformed or unbound");
  return evidence as unknown as RehashedQuarantineOutput;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[key], seen);
  }
  return Object.freeze(value);
}

function mintReceipt(
  output: RehashedQuarantineOutput,
  result: QuarantineSuccess,
): VerifiedQuarantineReceipt {
  const evidence: VerifiedQuarantineOutputEvidence = Object.freeze({
    version: 1,
    kind: "verifiedQuarantineOutput",
    requestId: output.requestId,
    operation: output.operation,
    output: output.output,
    outputHash: output.hash,
    outputBytes: output.byteSize,
    mediaType: output.mediaType,
    result: deepFreeze(result),
  });
  return new VerifiedQuarantineReceipt(RECEIPT_SECRET, evidence);
}

async function raceCancellation<Result>(
  work: Promise<Result>,
  signal: AbortSignal | undefined,
): Promise<{ readonly kind: "completed"; readonly value: Result } | { readonly kind: "canceled" }> {
  if (signal === undefined) return { kind: "completed", value: await work };
  if (signal.aborted) return { kind: "canceled" };
  let listener: (() => void) | undefined;
  const canceled = new Promise<{ readonly kind: "canceled" }>((resolve) => {
    listener = () => resolve({ kind: "canceled" });
    signal.addEventListener("abort", listener, { once: true });
  });
  try {
    return await Promise.race([
      work.then((value) => ({ kind: "completed" as const, value })),
      canceled,
    ]);
  } finally {
    if (listener !== undefined) signal.removeEventListener("abort", listener);
  }
}

async function clean(
  worker: QuarantineWorkerPort,
  handles: PrivilegedQuarantineHandlePort,
  request: QuarantineRequest,
  started: boolean,
  discardOutput: boolean,
): Promise<boolean> {
  const tasks: Promise<unknown>[] = [handles.cleanupInput(request.input)];
  if (started) tasks.push(worker.terminate(request.requestId));
  if (discardOutput) tasks.push(handles.discardOutput(request.output));
  const results = await Promise.allSettled(tasks);
  return results.every((result) => result.status === "fulfilled");
}

function outputVerificationRequest(request: QuarantineRequest): QuarantineOutputVerificationRequest {
  const archive = request.operation === "inspectArchive";
  return Object.freeze({
    version: 1,
    requestId: request.requestId,
    operation: request.operation,
    output: request.output,
    maximumBytes: quarantineOutputByteLimit(request),
    maximumEntries: archive ? request.limits.entries : 1,
    maximumEntryBytes: archive ? request.limits.entryBytes : quarantineOutputByteLimit(request),
    allowedMediaTypes: Object.freeze([...quarantineMediaTypesFor(request.operation)]),
  });
}

function isCanceled(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

/** Execute one operation with no in-process/permissive fallback. */
export async function runQuarantineRequest(
  requestValue: unknown,
  worker: QuarantineWorkerPort,
  timer: QuarantineTimerPort,
  handles: PrivilegedQuarantineHandlePort,
  options: number | QuarantineRunOptions = {},
): Promise<QuarantineBrokerResult> {
  validateQuarantineRequest(requestValue);
  const request = requestValue;
  const timeoutMs = typeof options === "number" ? options : (options.timeoutMs ?? 30_000);
  const signal = typeof options === "number" ? undefined : options.signal;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new RangeError("Quarantine timeout must be between 1 and 120000ms");
  }

  const failAndClean = async (
    reason: QuarantineFailureReason,
    started: boolean,
  ): Promise<QuarantineFailure> =>
    await clean(worker, handles, request, started, true)
      ? failure(request, reason)
      : failure(request, "cleanupFailed");

  if (worker.isolationAvailable !== true) {
    return failAndClean("isolationUnavailable", false);
  }
  if (isCanceled(signal)) return failAndClean("canceled", false);

  let input: RehashedQuarantineInput;
  try {
    const verification: QuarantineInputVerificationRequest = Object.freeze({
      version: 1,
      requestId: request.requestId,
      operation: request.operation,
      input: request.input,
      maximumBytes: quarantineInputByteLimit(request),
    });
    input = validateRehashedInput(await handles.verifyAndRehashInput(verification), verification);
  } catch {
    return failAndClean("inputVerificationFailed", false);
  }
  if (isCanceled(signal)) return failAndClean("canceled", false);

  let raced:
    | { readonly kind: "completed"; readonly value: unknown }
    | { readonly kind: "timedOut" }
    | { readonly kind: "canceled" };
  try {
    raced = await raceCancellation(
      timer.raceTimeout(worker.execute(request), timeoutMs),
      signal,
    ).then((outer) => outer.kind === "canceled" ? outer : outer.value);
  } catch {
    return failAndClean("workerCrash", true);
  }
  if (raced.kind === "timedOut") return failAndClean("timeout", true);
  if (raced.kind === "canceled") return failAndClean("canceled", true);

  let result: QuarantineResult;
  try {
    const detachedValue: unknown = structuredClone(raced.value);
    validateQuarantineResult(detachedValue, request);
    result = detachedValue;
  } catch {
    return failAndClean("malformedResult", true);
  }
  if (result.status === "failed") return failAndClean(result.reason, true);
  if (quarantineObservedInputBytes(result) !== input.byteSize) {
    return failAndClean("inputVerificationFailed", true);
  }

  try {
    const verification = outputVerificationRequest(request);
    const observed = validateRehashedOutput(
      await handles.verifyAndRehash(verification),
      verification,
    );
    if (
      observed.hash !== result.outputHash ||
      observed.byteSize !== result.outputBytes ||
      observed.mediaType !== result.mediaType
    ) throw new TypeError("Worker output claims disagree with privileged evidence");
    if (!await clean(worker, handles, request, true, false)) {
      await handles.discardOutput(request.output).catch(() => undefined);
      return failure(request, "cleanupFailed");
    }
    return Object.freeze({
      status: "succeeded",
      result,
      receipt: mintReceipt(observed, result),
    });
  } catch {
    return failAndClean("outputVerificationFailed", true);
  }
}
