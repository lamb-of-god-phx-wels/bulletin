import {
  quarantineMediaTypesFor,
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
  terminate(requestId: string): Promise<void>;
}

export interface QuarantineTimerPort {
  raceTimeout<Result>(work: Promise<Result>, timeoutMs: number): Promise<
    | { readonly kind: "completed"; readonly value: Result }
    | { readonly kind: "timedOut" }
  >;
}

/** Path-free verifier request. No worker-supplied path or hash crosses this boundary. */
export interface QuarantineOutputVerificationRequest {
  readonly version: 1;
  readonly requestId: string;
  readonly operation: QuarantineOperation;
  readonly output: QuarantineHandle;
  readonly maximumBytes: number;
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

export interface PrivilegedQuarantineOutputVerifierPort {
  /**
   * Resolve only the app-owned opaque handle, enforce `maximumBytes`, inspect
   * the exact media type, and independently hash stable immutable bytes.
   */
  verifyAndRehash(request: QuarantineOutputVerificationRequest): Promise<unknown>;
}

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

/**
 * Runtime capability minted only after privileged rehash verification.
 * Its evidence is deliberately absent from enumerable object properties.
 */
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
  /** Closed worker report retained for operation-specific metadata only. */
  readonly result: QuarantineSuccess;
  /** Runtime-unforgeable capability carrying privileged byte identity. */
  readonly receipt: VerifiedQuarantineReceipt;
}

export type QuarantineBrokerResult = VerifiedQuarantineBrokerSuccess | QuarantineFailure;

function failure(
  request: QuarantineRequest,
  reason: QuarantineFailure["reason"],
  message: string,
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
    case "isolationUnavailable":
      return "Required isolated content validation is unavailable.";
    case "workerCrash":
      return "The isolated content worker failed.";
    case "timeout":
      return "The isolated content worker timed out.";
    case "canceled":
      return "The isolated content operation was canceled.";
    case "limitExceeded":
      return "Untrusted content exceeded an authorized processing limit.";
    case "invalidContent":
      return "Untrusted content failed isolated validation.";
    case "malformedResult":
      return "The isolated worker returned invalid output.";
    case "outputVerificationFailed":
      return "The isolated output failed privileged byte verification.";
  }
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Privileged output evidence is not an object");
  }
  return value as Record<string, unknown>;
}

function validateRehashedOutput(
  value: unknown,
  request: QuarantineOutputVerificationRequest,
): RehashedQuarantineOutput {
  const evidence = record(value);
  const expectedKeys = [
    "version", "requestId", "operation", "output", "hash", "byteSize", "mediaType",
  ];
  const keys = Reflect.ownKeys(evidence);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key)) ||
    expectedKeys.some((key) => !Object.prototype.hasOwnProperty.call(evidence, key)) ||
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

/** Execute one operation with no in-process/permissive fallback. */
export async function runQuarantineRequest(
  requestValue: unknown,
  worker: QuarantineWorkerPort,
  timer: QuarantineTimerPort,
  outputs: PrivilegedQuarantineOutputVerifierPort,
  timeoutMs = 30_000,
): Promise<QuarantineBrokerResult> {
  validateQuarantineRequest(requestValue);
  const request = requestValue;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new RangeError("Quarantine timeout must be between 1 and 120000ms");
  }
  if (worker.isolationAvailable !== true) {
    return failure(request, "isolationUnavailable", failureMessage("isolationUnavailable"));
  }
  let raced:
    | { readonly kind: "completed"; readonly value: unknown }
    | { readonly kind: "timedOut" };
  try {
    raced = await timer.raceTimeout(worker.execute(request), timeoutMs);
  } catch {
    await worker.terminate(request.requestId).catch(() => undefined);
    return failure(request, "workerCrash", failureMessage("workerCrash"));
  }
  if (raced.kind === "timedOut") {
    await worker.terminate(request.requestId).catch(() => undefined);
    return failure(request, "timeout", failureMessage("timeout"));
  }

  let result: QuarantineResult;
  try {
    // Detach from a hostile/custom port's mutable object before validation and
    // before the asynchronous privileged rehash step.
    const detachedValue: unknown = structuredClone(raced.value);
    validateQuarantineResult(detachedValue, request);
    result = detachedValue;
  } catch {
    await worker.terminate(request.requestId).catch(() => undefined);
    return failure(request, "malformedResult", failureMessage("malformedResult"));
  }
  if (result.status === "failed") {
    return failure(request, result.reason, failureMessage(result.reason));
  }

  const verificationRequest: QuarantineOutputVerificationRequest = Object.freeze({
    version: 1,
    requestId: request.requestId,
    operation: request.operation,
    output: request.output,
    maximumBytes: quarantineOutputByteLimit(request),
    allowedMediaTypes: Object.freeze([...quarantineMediaTypesFor(request.operation)]),
  });
  try {
    const observed = validateRehashedOutput(
      await outputs.verifyAndRehash(verificationRequest),
      verificationRequest,
    );
    if (
      observed.hash !== result.outputHash ||
      observed.byteSize !== result.outputBytes ||
      observed.mediaType !== result.mediaType
    ) throw new TypeError("Worker output claims disagree with privileged evidence");
    return Object.freeze({
      status: "succeeded",
      result,
      receipt: mintReceipt(observed, result),
    });
  } catch {
    await worker.terminate(request.requestId).catch(() => undefined);
    return failure(
      request,
      "outputVerificationFailed",
      failureMessage("outputVerificationFailed"),
    );
  }
}
