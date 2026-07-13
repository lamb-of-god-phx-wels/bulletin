import { hashBytes } from "@cbb/core";
import { describe, expect, it, vi } from "vitest";
import {
  QUARANTINE_HARD_LIMITS,
  type QuarantineHandle,
  type QuarantineRequest,
} from "../quarantine/protocol.js";
import {
  WINDOWS_M3_SANDBOX_POLICY,
  type WindowsSandboxBrokerPort,
  type WindowsSandboxInvocation,
} from "./broker.js";
import {
  NodeWindowsQuarantineWorker,
  type WindowsQuarantineCapabilityPort,
  type WindowsQuarantineCapabilityDiscardRequest,
  type WindowsQuarantineCapabilityReleaseRequest,
  type WindowsQuarantineCapabilityReservationRequest,
} from "./quarantine.js";

const INPUT = `qh:${"1".repeat(64)}` as QuarantineHandle;
const OUTPUT = `qh:${"2".repeat(64)}` as QuarantineHandle;
const INPUT_CAPABILITY = `wcap:${"4".repeat(64)}`;
const OUTPUT_CAPABILITY = `wcap:${"5".repeat(64)}`;
const RESERVATION = `wqres:${"6".repeat(64)}`;
const WORKER = Object.freeze({
  toolId: "quarantine-worker",
  version: "1.0.0",
  hash: hashBytes(new TextEncoder().encode("quarantine-worker.exe")),
});

function request(): QuarantineRequest {
  return {
    version: 1,
    requestId: "11111111-1111-4111-8111-111111111111",
    operation: "sanitizeSvg",
    input: INPUT,
    output: OUTPUT,
    limits: { ...QUARANTINE_HARD_LIMITS.sanitizeSvg },
  };
}

function capabilities(raw?: unknown): {
  readonly port: WindowsQuarantineCapabilityPort;
  readonly reserve: ReturnType<typeof vi.fn>;
  readonly release: ReturnType<typeof vi.fn>;
  readonly discard: ReturnType<typeof vi.fn>;
} {
  const reserve = vi.fn(async (value: WindowsQuarantineCapabilityReservationRequest) => raw ?? ({
    version: 1,
    kind: "windowsQuarantineCapabilityReservation",
    requestId: value.requestId,
    operation: value.operation,
    input: value.input,
    output: value.output,
    reservationId: RESERVATION,
    inputCapability: INPUT_CAPABILITY,
    outputCapability: OUTPUT_CAPABILITY,
    oneShot: true,
  }));
  const release = vi.fn(async (_value: WindowsQuarantineCapabilityReleaseRequest) => undefined);
  const discard = vi.fn(async (_value: WindowsQuarantineCapabilityDiscardRequest) => undefined);
  return { port: { reserve, release, discard }, reserve, release, discard };
}

function broker(response: unknown = { status: "fake-worker-response" }): {
  readonly port: WindowsSandboxBrokerPort;
  readonly invoke: ReturnType<typeof vi.fn>;
  readonly cancel: ReturnType<typeof vi.fn>;
} {
  const invoke = vi.fn(async (_invocation: WindowsSandboxInvocation) => response);
  const cancel = vi.fn(async (_requestId: string) => undefined);
  return {
    invoke,
    cancel,
    port: {
      sessionId: `wsb:${"3".repeat(64)}`,
      policy: WINDOWS_M3_SANDBOX_POLICY,
      allowedTools: [WORKER],
      invoke,
      cancel,
      async close() {},
    },
  };
}

describe("NodeWindowsQuarantineWorker", () => {
  it("reserves qh entries once but sends the broker only request-bound wcap tokens", async () => {
    const fake = broker();
    const owner = capabilities();
    const worker = new NodeWindowsQuarantineWorker({
      broker: fake.port, capabilities: owner.port, worker: WORKER,
    });
    const value = request();

    await expect(worker.execute(value)).resolves.toEqual({ status: "fake-worker-response" });
    expect(owner.reserve).toHaveBeenCalledWith({
      version: 1,
      requestId: value.requestId,
      operation: value.operation,
      input: INPUT,
      output: OUTPUT,
    });
    expect(fake.invoke).toHaveBeenCalledTimes(1);
    const invocation = fake.invoke.mock.calls[0]?.[0] as WindowsSandboxInvocation;
    expect(invocation).toEqual({
      requestId: value.requestId,
      profile: "quarantineV1",
      action: "quarantine",
      payload: {
        request: {
          version: 1,
          requestId: value.requestId,
          operation: value.operation,
          input: INPUT_CAPABILITY,
          output: OUTPUT_CAPABILITY,
          limits: value.limits,
        },
        reservationId: RESERVATION,
      },
    });
    expect(JSON.stringify(invocation.payload)).not.toContain("qh:");
    expect(JSON.stringify(invocation.payload)).not.toContain("C:\\");
    expect(owner.release).toHaveBeenCalledOnce();
    expect(owner.release).toHaveBeenCalledWith({
      version: 1,
      requestId: value.requestId,
      reservationId: RESERVATION,
      inputCapability: INPUT_CAPABILITY,
      outputCapability: OUTPUT_CAPABILITY,
    });
  });

  it("makes each request id one-shot, including after successful release", async () => {
    const fake = broker();
    const owner = capabilities();
    const worker = new NodeWindowsQuarantineWorker({
      broker: fake.port, capabilities: owner.port, worker: WORKER,
    });
    await worker.execute(request());
    await expect(worker.execute(request())).rejects.toMatchObject({ kind: "duplicateRequest" });
    expect(owner.reserve).toHaveBeenCalledOnce();
    expect(fake.invoke).toHaveBeenCalledOnce();
    expect(owner.release).toHaveBeenCalledOnce();
  });

  it("rejects malformed capability evidence without invoking the broker", async () => {
    const fake = broker();
    const owner = capabilities({
      version: 1,
      kind: "windowsQuarantineCapabilityReservation",
      requestId: request().requestId,
      operation: request().operation,
      input: INPUT,
      output: OUTPUT,
      reservationId: RESERVATION,
      inputCapability: "C:\\host\\secret.svg",
      outputCapability: OUTPUT_CAPABILITY,
      oneShot: true,
      hostPath: "C:\\host\\secret.svg",
    });
    const worker = new NodeWindowsQuarantineWorker({
      broker: fake.port, capabilities: owner.port, worker: WORKER,
    });
    await expect(worker.execute(request())).rejects.toMatchObject({ kind: "capabilityRejected" });
    expect(fake.invoke).not.toHaveBeenCalled();
    expect(owner.release).not.toHaveBeenCalled();
    expect(owner.discard).toHaveBeenCalledOnce();
    expect(owner.discard).toHaveBeenCalledWith({
      version: 1,
      requestId: request().requestId,
    });
  });

  it("releases an active reservation exactly once when cancellation races finalization", async () => {
    let finish: ((value: unknown) => void) | undefined;
    const pendingResponse = new Promise((resolve) => { finish = resolve; });
    const fake = broker(pendingResponse);
    const owner = capabilities();
    const worker = new NodeWindowsQuarantineWorker({
      broker: fake.port, capabilities: owner.port, worker: WORKER,
    });
    const pending = worker.execute(request());
    await vi.waitFor(() => expect(fake.invoke).toHaveBeenCalledOnce());
    await worker.terminate(request().requestId);
    expect(fake.cancel).toHaveBeenCalledWith(request().requestId);
    expect(owner.release).toHaveBeenCalledOnce();
    finish?.({ status: "canceled" });
    await expect(pending).resolves.toEqual({ status: "canceled" });
    expect(owner.release).toHaveBeenCalledOnce();
  });

  it("discards a pending reservation immediately when canceled", async () => {
    let finishReservation: ((value: unknown) => void) | undefined;
    const reservation = new Promise((resolve) => { finishReservation = resolve; });
    const fake = broker();
    const owner = capabilities(reservation);
    const worker = new NodeWindowsQuarantineWorker({
      broker: fake.port, capabilities: owner.port, worker: WORKER,
    });
    const pending = worker.execute(request());
    await vi.waitFor(() => expect(owner.reserve).toHaveBeenCalledOnce());
    await worker.terminate(request().requestId);
    expect(owner.discard).toHaveBeenCalledOnce();
    expect(owner.release).not.toHaveBeenCalled();
    finishReservation?.({
      version: 1,
      kind: "windowsQuarantineCapabilityReservation",
      requestId: request().requestId,
      operation: request().operation,
      input: INPUT,
      output: OUTPUT,
      reservationId: RESERVATION,
      inputCapability: INPUT_CAPABILITY,
      outputCapability: OUTPUT_CAPABILITY,
      oneShot: true,
    });
    await expect(pending).rejects.toMatchObject({ kind: "canceled" });
    expect(fake.invoke).not.toHaveBeenCalled();
    expect(owner.discard).toHaveBeenCalledOnce();
  });

  it("rejects path-like qh requests before reservation and weakened broker policy", async () => {
    const fake = broker();
    const owner = capabilities();
    const worker = new NodeWindowsQuarantineWorker({
      broker: fake.port, capabilities: owner.port, worker: WORKER,
    });
    await expect(worker.execute({
      ...request(),
      input: "C:\\host\\secret.svg",
      hostPath: "C:\\host\\secret.svg",
    } as unknown as QuarantineRequest)).rejects.toThrow();
    expect(owner.reserve).not.toHaveBeenCalled();

    expect(() => new NodeWindowsQuarantineWorker({
      broker: {
        ...fake.port,
        policy: {
          ...WINDOWS_M3_SANDBOX_POLICY,
          network: { ...WINDOWS_M3_SANDBOX_POLICY.network, loopbackDenied: false },
        } as unknown as typeof WINDOWS_M3_SANDBOX_POLICY,
      },
      capabilities: owner.port,
      worker: WORKER,
    })).toThrow();
  });
});
