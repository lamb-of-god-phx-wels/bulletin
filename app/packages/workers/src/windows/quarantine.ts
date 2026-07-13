import { canonicalStringify } from "@cbb/core";
import type { QuarantineWorkerPort } from "../quarantine/broker.js";
import {
  validateQuarantineRequest,
  type QuarantineHandle,
  type QuarantineOperation,
  type QuarantineRequest,
} from "../quarantine/protocol.js";
import {
  WINDOWS_M3_SANDBOX_POLICY,
  WindowsSandboxBrokerError,
  type WindowsSandboxAllowedTool,
  type WindowsSandboxBrokerPort,
} from "./broker.js";

const CAPABILITY = /^wcap:[0-9a-f]{64}$/u;
const RESERVATION = /^wqres:[0-9a-f]{64}$/u;
const MAX_ONE_SHOT_REQUESTS = 100_000;

/** Request to the app-owned native handle table; this boundary may see qh handles, never paths. */
export interface WindowsQuarantineCapabilityReservationRequest {
  readonly version: 1;
  readonly requestId: string;
  readonly operation: QuarantineOperation;
  readonly input: QuarantineHandle;
  readonly output: QuarantineHandle;
}

export interface WindowsQuarantineCapabilityReleaseRequest {
  readonly version: 1;
  readonly requestId: string;
  readonly reservationId: string;
  readonly inputCapability: string;
  readonly outputCapability: string;
}

export interface WindowsQuarantineCapabilityDiscardRequest {
  readonly version: 1;
  readonly requestId: string;
}

/**
 * A production implementation duplicates only the prepared input/output OS
 * handles into the signed broker. It must not resolve or return filesystem paths.
 */
export interface WindowsQuarantineCapabilityPort {
  /** Invalid evidence must be self-revoking; discard is the request-bound backstop. */
  reserve(request: WindowsQuarantineCapabilityReservationRequest): Promise<unknown>;
  release(request: WindowsQuarantineCapabilityReleaseRequest): Promise<void>;
  /** Idempotently revoke a pending, malformed, or canceled request reservation. */
  discard(request: WindowsQuarantineCapabilityDiscardRequest): Promise<void>;
}

export interface NodeWindowsQuarantineWorkerOptions {
  readonly broker: WindowsSandboxBrokerPort;
  readonly capabilities: WindowsQuarantineCapabilityPort;
  readonly worker: WindowsSandboxAllowedTool;
}

export type NodeWindowsQuarantineCapabilityErrorKind =
  | "invalidConfiguration"
  | "capabilityRejected"
  | "duplicateRequest"
  | "canceled";

export class NodeWindowsQuarantineCapabilityError extends Error {
  readonly code = "CBB-SECURITY-0001" as const;

  constructor(public readonly kind: NodeWindowsQuarantineCapabilityErrorKind) {
    super("Windows quarantine capability transfer failed closed");
    this.name = "NodeWindowsQuarantineCapabilityError";
  }
}

interface Reservation {
  readonly reservationId: string;
  readonly inputCapability: string;
  readonly outputCapability: string;
}

interface ActiveRequest {
  readonly request: QuarantineRequest;
  canceled: boolean;
  reservation?: Reservation;
  reservationReady?: Promise<Reservation>;
  cleanupPromise?: Promise<void>;
}

function fail(kind: NodeWindowsQuarantineCapabilityErrorKind): never {
  throw new NodeWindowsQuarantineCapabilityError(kind);
}

function exact(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("capabilityRejected");
  }
  const record = value as Readonly<Record<string, unknown>>;
  const own = Reflect.ownKeys(record);
  if (
    own.length !== keys.length ||
    own.some((key) => typeof key !== "string" || !keys.includes(key)) ||
    keys.some((key) => !Object.hasOwn(record, key))
  ) fail("capabilityRejected");
  return record;
}

function validateReservation(raw: unknown, request: QuarantineRequest): Reservation {
  const evidence = exact(raw, [
    "version", "kind", "requestId", "operation", "input", "output",
    "reservationId", "inputCapability", "outputCapability", "oneShot",
  ]);
  if (
    evidence["version"] !== 1 ||
    evidence["kind"] !== "windowsQuarantineCapabilityReservation" ||
    evidence["requestId"] !== request.requestId ||
    evidence["operation"] !== request.operation ||
    evidence["input"] !== request.input || evidence["output"] !== request.output ||
    typeof evidence["reservationId"] !== "string" ||
    !RESERVATION.test(evidence["reservationId"]) ||
    typeof evidence["inputCapability"] !== "string" ||
    !CAPABILITY.test(evidence["inputCapability"]) ||
    typeof evidence["outputCapability"] !== "string" ||
    !CAPABILITY.test(evidence["outputCapability"]) ||
    evidence["inputCapability"] === evidence["outputCapability"] ||
    evidence["oneShot"] !== true
  ) fail("capabilityRejected");
  return Object.freeze({
    reservationId: evidence["reservationId"],
    inputCapability: evidence["inputCapability"],
    outputCapability: evidence["outputCapability"],
  });
}

export class NodeWindowsQuarantineWorker implements QuarantineWorkerPort {
  readonly isolationAvailable = true;
  private readonly broker: WindowsSandboxBrokerPort;
  private readonly capabilities: WindowsQuarantineCapabilityPort;
  private readonly seen = new Set<string>();
  private readonly active = new Map<string, ActiveRequest>();

  constructor(options: NodeWindowsQuarantineWorkerOptions) {
    if (
      canonicalStringify(options.broker.policy) !== canonicalStringify(WINDOWS_M3_SANDBOX_POLICY) ||
      !options.broker.allowedTools.some((tool) =>
        tool.toolId === options.worker.toolId && tool.version === options.worker.version &&
        tool.hash === options.worker.hash
      ) ||
      typeof options.capabilities.reserve !== "function" ||
      typeof options.capabilities.release !== "function" ||
      typeof options.capabilities.discard !== "function"
    ) throw new WindowsSandboxBrokerError("handshakeRejected");
    this.broker = options.broker;
    this.capabilities = options.capabilities;
  }

  async execute(request: QuarantineRequest): Promise<unknown> {
    validateQuarantineRequest(request);
    if (this.seen.has(request.requestId) || this.seen.size >= MAX_ONE_SHOT_REQUESTS) {
      fail("duplicateRequest");
    }
    this.seen.add(request.requestId);
    const ownedRequest = structuredClone(request);
    const state: ActiveRequest = { request: ownedRequest, canceled: false };
    this.active.set(request.requestId, state);
    state.reservationReady = this.capabilities.reserve({
      version: 1,
      requestId: ownedRequest.requestId,
      operation: ownedRequest.operation,
      input: ownedRequest.input,
      output: ownedRequest.output,
    }).then((raw) => {
      const reservation = validateReservation(raw, ownedRequest);
      state.reservation = reservation;
      return reservation;
    });

    try {
      const reservation = await state.reservationReady;
      if (state.canceled) fail("canceled");
      return await this.broker.invoke({
        requestId: ownedRequest.requestId,
        profile: "quarantineV1",
        action: "quarantine",
        payload: Object.freeze({
          request: Object.freeze({
            version: 1,
            requestId: ownedRequest.requestId,
            operation: ownedRequest.operation,
            input: reservation.inputCapability,
            output: reservation.outputCapability,
            limits: structuredClone(ownedRequest.limits),
          }),
          reservationId: reservation.reservationId,
        }),
      });
    } finally {
      try {
        await this.cleanup(state);
      } finally {
        this.active.delete(ownedRequest.requestId);
      }
    }
  }

  async terminate(requestId: string): Promise<void> {
    const state = this.active.get(requestId);
    if (state !== undefined) state.canceled = true;
    let cancellationError: unknown;
    try {
      await this.broker.cancel(requestId);
    } catch (error) {
      cancellationError = error;
    }
    if (state !== undefined) {
      await this.cleanup(state);
    }
    if (cancellationError !== undefined) throw cancellationError;
  }

  private cleanup(state: ActiveRequest): Promise<void> {
    state.cleanupPromise ??= state.reservation === undefined
      ? this.capabilities.discard({ version: 1, requestId: state.request.requestId })
      : this.capabilities.release({
          version: 1,
          requestId: state.request.requestId,
          reservationId: state.reservation.reservationId,
          inputCapability: state.reservation.inputCapability,
          outputCapability: state.reservation.outputCapability,
        });
    return state.cleanupPromise;
  }
}
