import { describe, expect, it, vi } from "vitest";

import {
  VerifiedQuarantineReceipt,
  readVerifiedQuarantineReceipt,
  runQuarantineRequest,
  type PrivilegedQuarantineOutputVerifierPort,
  type QuarantineTimerPort,
  type QuarantineWorkerPort,
  type VerifiedQuarantineOutputEvidence,
} from "./broker.js";
import {
  QUARANTINE_HARD_LIMITS,
  quarantineHandle,
  validateQuarantineRequest,
  validateQuarantineResult,
  type ArchiveSuccess,
  type InspectArchiveRequest,
  type SanitizeSvgRequest,
  type SvgSuccess,
} from "./protocol.js";

const INPUT = quarantineHandle(`qh:${"a".repeat(64)}`);
const OUTPUT = quarantineHandle(`qh:${"b".repeat(64)}`);

function request(limits = QUARANTINE_HARD_LIMITS.sanitizeSvg): SanitizeSvgRequest {
  return {
    version: 1,
    requestId: "11111111-1111-4111-8111-111111111111",
    operation: "sanitizeSvg",
    input: INPUT,
    output: OUTPUT,
    limits,
  };
}

function success(overrides: Partial<SvgSuccess> = {}): SvgSuccess {
  return {
    version: 1,
    requestId: request().requestId,
    operation: "sanitizeSvg",
    status: "succeeded",
    output: OUTPUT,
    outputHash: `sha256:${"c".repeat(64)}`,
    outputBytes: 100,
    mediaType: "image/svg+xml",
    observed: { inputBytes: 100, xmlNodes: 10, pathCommands: 20 },
    ...overrides,
  };
}

const immediateTimer: QuarantineTimerPort = {
  async raceTimeout(work) {
    return { kind: "completed", value: await work };
  },
};

const validOutputVerifier: PrivilegedQuarantineOutputVerifierPort = {
  async verifyAndRehash(verification) {
    return {
      version: 1,
      requestId: verification.requestId,
      operation: verification.operation,
      output: verification.output,
      hash: `sha256:${"c".repeat(64)}`,
      byteSize: 100,
      mediaType: "image/svg+xml",
    };
  },
};

describe("quarantine protocol", () => {
  it("accepts exact hard caps and rejects one-over policy values", () => {
    expect(() => validateQuarantineRequest(request())).not.toThrow();
    expect(() =>
      validateQuarantineRequest(
        request({
          ...QUARANTINE_HARD_LIMITS.sanitizeSvg,
          xmlNodes: QUARANTINE_HARD_LIMITS.sanitizeSvg.xmlNodes + 1,
        }),
      ),
    ).toThrow(/hard cap/);
  });

  it("uses opaque handles and rejects path-shaped capabilities", () => {
    expect(() => quarantineHandle("/home/user/input.svg")).toThrow(/opaque/);
    expect(() => quarantineHandle("qh:../escape")).toThrow(/opaque/);
    expect(Object.keys(request()).sort()).toEqual([
      "input",
      "limits",
      "operation",
      "output",
      "requestId",
      "version",
    ]);
  });

  it("rejects unknown request operations, top-level fields, and limit fields", () => {
    expect(() => validateQuarantineRequest({
      ...request(),
      operation: "executeProgram",
    })).toThrow(/operation/);
    expect(() => validateQuarantineRequest({
      ...request(),
      path: "/tmp/input.svg",
    })).toThrow(/unknown fields/);
    expect(() => validateQuarantineRequest({
      ...request(),
      limits: { ...request().limits, shellCommands: 1 },
    })).toThrow(/unknown fields/);
    expect(() => validateQuarantineRequest({
      ...request(),
      limits: { inputBytes: 100, xmlNodes: 10 },
    })).toThrow(/missing/);
  });

  it("rejects observations above the request's lowered limit", () => {
    const lowered = request({ inputBytes: 100, xmlNodes: 10, pathCommands: 20 });
    expect(() => validateQuarantineResult(success(), lowered)).not.toThrow();
    expect(() =>
      validateQuarantineResult(
        success({ observed: { inputBytes: 100, xmlNodes: 11, pathCommands: 20 } }),
        lowered,
      ),
    ).toThrow(/authorized limit/);
  });

  it("rejects unknown result fields, statuses, media types, and observation fields", () => {
    expect(() => validateQuarantineResult({ ...success(), debugPath: "/tmp/output" }, request()))
      .toThrow(/unknown fields/);
    expect(() => validateQuarantineResult({ ...success(), status: "partiallySucceeded" }, request()))
      .toThrow(/status/);
    expect(() => validateQuarantineResult({ ...success(), mediaType: "text/html" }, request()))
      .toThrow(/media type/);
    expect(() => validateQuarantineResult({
      ...success(),
      observed: { ...success().observed, scriptCount: 1 },
    }, request())).toThrow(/unknown fields/);
    expect(() => validateQuarantineResult({
      version: 1,
      requestId: request().requestId,
      operation: "sanitizeSvg",
      status: "failed",
      code: "CBB-SECURITY-0001",
      reason: "arbitraryReason",
      message: "no",
    }, request())).toThrow(/malformed failure/);
  });

  it("validates archive paths, exact totals, aliases, and compression ratios", () => {
    const archiveRequest: InspectArchiveRequest = {
      version: 1,
      requestId: "22222222-2222-4222-8222-222222222222",
      operation: "inspectArchive",
      input: INPUT,
      output: OUTPUT,
      limits: {
        compressedBytes: 100,
        uncompressedBytes: 200,
        entries: 2,
        entryBytes: 150,
        compressionRatio: 10,
      },
    };
    const archiveSuccess: ArchiveSuccess = {
      version: 1,
      requestId: archiveRequest.requestId,
      operation: "inspectArchive",
      status: "succeeded",
      output: OUTPUT,
      outputHash: `sha256:${"d".repeat(64)}`,
      outputBytes: 150,
      mediaType: "application/zip",
      observed: {
        compressedBytes: 30,
        uncompressedBytes: 150,
        entries: 2,
        entryBytes: 100,
        compressionRatio: 5,
      },
      entries: [
        {
          path: "assets/logo.svg",
          compressedBytes: 10,
          uncompressedBytes: 50,
          hash: `sha256:${"e".repeat(64)}`,
        },
        {
          path: "documents/bulletin.json",
          compressedBytes: 20,
          uncompressedBytes: 100,
          hash: `sha256:${"f".repeat(64)}`,
        },
      ],
    };
    expect(() => validateQuarantineResult(archiveSuccess, archiveRequest)).not.toThrow();
    expect(() =>
      validateQuarantineResult(
        {
          ...archiveSuccess,
          entries: [
            archiveSuccess.entries[0]!,
            { ...archiveSuccess.entries[1]!, path: "ASSETS/LOGO.SVG" },
          ],
        },
        archiveRequest,
      ),
    ).toThrow(/aliased/);
    expect(() =>
      validateQuarantineResult(
        {
          ...archiveSuccess,
          entries: [
            { ...archiveSuccess.entries[0]!, path: "../escape" },
            archiveSuccess.entries[1]!,
          ],
        },
        archiveRequest,
      ),
    ).toThrow(/unsafe/);
    expect(() =>
      validateQuarantineResult(
        {
          ...archiveSuccess,
          observed: {
            ...archiveSuccess.observed,
            compressedBytes: 11,
            uncompressedBytes: 150,
          },
          entries: [
            {
              ...archiveSuccess.entries[0]!,
              compressedBytes: 1,
              uncompressedBytes: 50,
            },
            archiveSuccess.entries[1]!,
          ],
        },
        archiveRequest,
      ),
    ).toThrow(/compression ratio/);
  });

  it("fails closed when isolation is unavailable", async () => {
    const execute = vi.fn();
    const worker: QuarantineWorkerPort = {
      isolationAvailable: false,
      execute,
      async terminate() {},
    };
    await expect(runQuarantineRequest(
      request(), worker, immediateTimer, validOutputVerifier,
    )).resolves.toMatchObject({
      status: "failed",
      code: "CBB-SECURITY-0001",
      reason: "isolationUnavailable",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("terminates timed-out, crashed, and malformed isolated workers", async () => {
    const terminate = vi.fn(async () => undefined);
    const validWorker: QuarantineWorkerPort = {
      isolationAvailable: true,
      async execute() {
        return success();
      },
      terminate,
    };
    const timeoutTimer: QuarantineTimerPort = {
      async raceTimeout() {
        return { kind: "timedOut" };
      },
    };
    await expect(runQuarantineRequest(
      request(), validWorker, timeoutTimer, validOutputVerifier,
    )).resolves.toMatchObject({
      reason: "timeout",
    });
    expect(terminate).toHaveBeenCalledWith(request().requestId);

    const malformedWorker: QuarantineWorkerPort = {
      isolationAvailable: true,
      async execute() {
        return success({ outputHash: "sha256:nope" });
      },
      terminate,
    };
    await expect(runQuarantineRequest(
      request(), malformedWorker, immediateTimer, validOutputVerifier,
    )).resolves.toMatchObject({
      reason: "malformedResult",
    });

    const crashedWorker: QuarantineWorkerPort = {
      isolationAvailable: true,
      async execute() {
        throw new Error("worker exited");
      },
      terminate,
    };
    await expect(runQuarantineRequest(
      request(), crashedWorker, immediateTimer, validOutputVerifier,
    )).resolves.toMatchObject({
      reason: "workerCrash",
    });
  });

  it("independently rehashes output and rejects valid-looking worker hash claims", async () => {
    const terminate = vi.fn(async () => undefined);
    const worker: QuarantineWorkerPort = {
      isolationAvailable: true,
      async execute() {
        return success({ outputHash: `sha256:${"d".repeat(64)}` });
      },
      terminate,
    };
    await expect(runQuarantineRequest(
      request(), worker, immediateTimer, validOutputVerifier,
    )).resolves.toMatchObject({
      status: "failed",
      reason: "outputVerificationFailed",
    });
    expect(terminate).toHaveBeenCalledWith(request().requestId);
  });

  it("passes only an operation-bound opaque handle to the verifier and returns a real receipt", async () => {
    const verificationCalls: unknown[] = [];
    const verifier: PrivilegedQuarantineOutputVerifierPort = {
      async verifyAndRehash(verification) {
        verificationCalls.push(verification);
        expect(Object.keys(verification).sort()).toEqual([
          "allowedMediaTypes",
          "maximumBytes",
          "operation",
          "output",
          "requestId",
          "version",
        ]);
        expect(verification).not.toHaveProperty("path");
        expect(verification).not.toHaveProperty("outputHash");
        expect(verification.allowedMediaTypes).toEqual(["image/svg+xml"]);
        expect(verification.maximumBytes).toBe(request().limits.inputBytes);
        return {
          version: 1,
          requestId: verification.requestId,
          operation: verification.operation,
          output: verification.output,
          hash: success().outputHash,
          byteSize: success().outputBytes,
          mediaType: success().mediaType,
        };
      },
    };
    const worker: QuarantineWorkerPort = {
      isolationAvailable: true,
      async execute() { return success(); },
      async terminate() {},
    };
    const brokerResult = await runQuarantineRequest(request(), worker, immediateTimer, verifier);
    expect(brokerResult.status).toBe("succeeded");
    if (brokerResult.status !== "succeeded") throw new Error("expected success");
    expect(verificationCalls).toHaveLength(1);
    expect(Object.keys(brokerResult.receipt)).toEqual([]);
    expect(readVerifiedQuarantineReceipt(brokerResult.receipt)).toEqual({
      version: 1,
      kind: "verifiedQuarantineOutput",
      requestId: request().requestId,
      operation: "sanitizeSvg",
      output: OUTPUT,
      outputHash: success().outputHash,
      outputBytes: 100,
      mediaType: "image/svg+xml",
      result: success(),
    });
    expect(Object.isFrozen(readVerifiedQuarantineReceipt(brokerResult.receipt).result)).toBe(true);
    expect(Object.isFrozen(readVerifiedQuarantineReceipt(brokerResult.receipt).result.observed)).toBe(true);
  });

  it("rejects forged receipts and extraneous or unbound privileged evidence", async () => {
    const evidence: VerifiedQuarantineOutputEvidence = {
      version: 1,
      kind: "verifiedQuarantineOutput",
      requestId: request().requestId,
      operation: "sanitizeSvg",
      output: OUTPUT,
      outputHash: success().outputHash,
      outputBytes: 100,
      mediaType: "image/svg+xml",
      result: success(),
    };
    expect(() => new VerifiedQuarantineReceipt({}, evidence)).toThrow(/broker-minted/);
    expect(() => readVerifiedQuarantineReceipt({})).toThrow(/not a broker-verified/);

    const worker: QuarantineWorkerPort = {
      isolationAvailable: true,
      async execute() { return success(); },
      async terminate() {},
    };
    const extraneousVerifier: PrivilegedQuarantineOutputVerifierPort = {
      async verifyAndRehash(verification) {
        return {
          version: 1,
          requestId: verification.requestId,
          operation: verification.operation,
          output: verification.output,
          hash: success().outputHash,
          byteSize: 100,
          mediaType: "image/svg+xml",
          path: "/tmp/forged-output",
        };
      },
    };
    await expect(runQuarantineRequest(
      request(), worker, immediateTimer, extraneousVerifier,
    )).resolves.toMatchObject({ reason: "outputVerificationFailed" });

    const wrongOperationVerifier: PrivilegedQuarantineOutputVerifierPort = {
      async verifyAndRehash(verification) {
        return {
          version: 1,
          requestId: verification.requestId,
          operation: "inspectFont",
          output: verification.output,
          hash: success().outputHash,
          byteSize: 100,
          mediaType: "font/ttf",
        };
      },
    };
    await expect(runQuarantineRequest(
      request(), worker, immediateTimer, wrongOperationVerifier,
    )).resolves.toMatchObject({ reason: "outputVerificationFailed" });
  });
});
