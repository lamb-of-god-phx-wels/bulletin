import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashBytes } from "@cbb/core";
import { describe, expect, it, vi } from "vitest";
import {
  WINDOWS_M3_SANDBOX_POLICY,
  WINDOWS_SANDBOX_BROKER_PROTOCOL,
  WindowsSandboxBrokerError,
  createNodeWindowsSandboxBroker,
  validateWindowsPeImage,
  validateWindowsSandboxBrokerResponse,
  validateWindowsSandboxBrokerHandshake,
  verifyPinnedWindowsSandboxBroker,
  type PinnedWindowsSandboxBroker,
  type WindowsSandboxAllowedTool,
} from "./broker.js";

function pe(machine = 0x8664): Uint8Array {
  const bytes = new Uint8Array(1024);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x4d;
  bytes[1] = 0x5a;
  view.setUint32(0x3c, 0x80, true);
  bytes.set([0x50, 0x45, 0, 0], 0x80);
  view.setUint16(0x84, machine, true);
  view.setUint16(0x86, 1, true);
  view.setUint16(0x94, 0xf0, true);
  view.setUint16(0x96, 0x0002, true);
  view.setUint16(0x98, 0x020b, true);
  const section = 0x80 + 24 + 0xf0;
  bytes.set(new TextEncoder().encode(".text\0\0\0"), section);
  view.setUint32(section + 16, 0x100, true);
  view.setUint32(section + 20, 0x200, true);
  view.setUint32(section + 36, 0x60000020, true);
  bytes[0x200] = 0xc3;
  return bytes;
}

const TOOLS: readonly WindowsSandboxAllowedTool[] = [{
  toolId: "typst",
  version: "0.14.2",
  hash: hashBytes(new TextEncoder().encode("typst-test-image")),
}];

function helper(path: string, bytes: Uint8Array): PinnedWindowsSandboxBroker {
  return {
    path,
    hash: hashBytes(bytes),
    signerSha256Thumbprint: "b".repeat(64),
    architecture: "x64",
    version: "1.0.0",
  };
}

function handshake(
  expected: PinnedWindowsSandboxBroker,
  challenge = "challenge",
): Record<string, unknown> {
  return {
    version: 1,
    kind: "cbbWindowsSandboxHandshake",
    protocol: WINDOWS_SANDBOX_BROKER_PROTOCOL,
    challenge,
    sessionId: `wsb:${"c".repeat(64)}`,
    helperHash: expected.hash,
    helperVersion: expected.version,
    signerSha256Thumbprint: expected.signerSha256Thumbprint,
    authenticodeVerified: true,
    appOwnedImage: true,
    policy: WINDOWS_M3_SANDBOX_POLICY,
    allowedTools: TOOLS,
  };
}

describe("Windows sandbox broker trust protocol", () => {
  it("validates a complete PE32+ image and its pinned stable hash on Linux", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cbb-windows-pe-"));
    const path = join(directory, "cbb-sandbox-broker.exe");
    const bytes = pe();
    await writeFile(path, bytes);
    await expect(verifyPinnedWindowsSandboxBroker(helper(path, bytes))).resolves.toEqual({
      path,
      hash: hashBytes(bytes),
    });
    expect(() => validateWindowsPeImage(pe(0xaa64), "x64")).toThrow();
    const notExecutable = pe();
    new DataView(notExecutable.buffer).setUint32(0x80 + 24 + 0xf0 + 36, 0x40000040, true);
    expect(() => validateWindowsPeImage(notExecutable, "x64")).toThrow();
    await expect(verifyPinnedWindowsSandboxBroker({
      ...helper(path, bytes),
      hash: hashBytes(new TextEncoder().encode("wrong-image")),
    })).rejects.toMatchObject({ kind: "imageVerificationFailed" });
  });

  it("accepts only the exact challenge/image/tools and full mandatory policy", () => {
    const pinned = helper("/app/cbb-sandbox-broker.exe", pe());
    const accepted = validateWindowsSandboxBrokerHandshake(handshake(pinned), {
      challenge: "challenge",
      helper: pinned,
      allowedTools: TOOLS,
    });
    expect(accepted.policy.quotas.quarantineArchiveAggregateBytes).toBe(4_294_967_296);
    expect(accepted.policy.network).toMatchObject({
      enforcement: "windowsFilteringPlatform",
      inboundDenied: true,
      outboundDenied: true,
      loopbackDenied: true,
    });

    const weakened = handshake(pinned);
    weakened["policy"] = {
      ...WINDOWS_M3_SANDBOX_POLICY,
      job: { ...WINDOWS_M3_SANDBOX_POLICY.job, killOnJobClose: false },
    };
    expect(() => validateWindowsSandboxBrokerHandshake(weakened, {
      challenge: "challenge",
      helper: pinned,
      allowedTools: TOOLS,
    })).toThrow();
    expect(() => validateWindowsSandboxBrokerHandshake({
      ...handshake(pinned),
      unexpected: true,
    }, {
      challenge: "challenge",
      helper: pinned,
      allowedTools: TOOLS,
    })).toThrow();
    expect(() => validateWindowsSandboxBrokerHandshake({
      ...handshake(pinned),
      allowedTools: [{ ...TOOLS[0], hash: `sha256:${"d".repeat(64)}` }],
    }, {
      challenge: "challenge",
      helper: pinned,
      allowedTools: TOOLS,
    })).toThrow();
  });

  it("binds every fake-broker response to its session, request, profile, and action", () => {
    const sessionId = `wsb:${"c".repeat(64)}`;
    const request = {
      requestId: "11111111-1111-4111-8111-111111111111",
      profile: "pdfInspectV1" as const,
      action: "inspectPdf" as const,
      payload: { version: 1, input: `wcap:${"d".repeat(64)}` },
    };
    const response = {
      version: 1,
      kind: "cbbWindowsSandboxResponse",
      protocol: WINDOWS_SANDBOX_BROKER_PROTOCOL,
      sessionId,
      requestId: request.requestId,
      profile: request.profile,
      action: request.action,
      status: "succeeded",
      result: { pageCount: 1 },
    };
    expect(validateWindowsSandboxBrokerResponse(response, { sessionId, request })).toEqual({
      pageCount: 1,
    });
    for (const forged of [
      { ...response, sessionId: `wsb:${"e".repeat(64)}` },
      { ...response, requestId: "22222222-2222-4222-8222-222222222222" },
      { ...response, profile: "quarantineV1" },
      { ...response, action: "quarantine" },
      { ...response, status: "failed" },
      { ...response, hostPath: "C:\\smuggled\\document.pdf" },
    ]) {
      expect(() => validateWindowsSandboxBrokerResponse(forged, { sessionId, request })).toThrow();
    }
    expect(() => validateWindowsSandboxBrokerResponse(response, {
      sessionId,
      request: { ...request, profile: "quarantineV1" },
    })).toThrow();
    expect(() => validateWindowsSandboxBrokerResponse(response, {
      sessionId,
      request: {
        ...request,
        profile: "__proto__" as typeof request.profile,
      },
    })).toThrow(WindowsSandboxBrokerError);
  });

  it.skipIf(process.platform === "win32")("cannot construct production isolation off Windows", async () => {
    const authenticode = { verify: vi.fn() };
    const transports = { connect: vi.fn() };
    await expect(createNodeWindowsSandboxBroker({
      helper: helper("/app/cbb-sandbox-broker.exe", pe()),
      allowedTools: TOOLS,
      authenticode,
      transports,
    })).rejects.toMatchObject({ kind: "platformUnavailable" });
    expect(authenticode.verify).not.toHaveBeenCalled();
    expect(transports.connect).not.toHaveBeenCalled();
  });

  it.runIf(process.platform === "win32")("accepts the native seam only after signature and handshake proof", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cbb-windows-native-seam-"));
    const path = join(directory, "cbb-sandbox-broker.exe");
    const bytes = pe();
    await writeFile(path, bytes);
    const pinned = helper(path, bytes);
    const transport = {
      async handshake(raw: unknown) {
        const challenge = (raw as { readonly challenge: string }).challenge;
        return handshake(pinned, challenge);
      },
      async invoke() { throw new Error("not exercised"); },
      async cancel() {},
      async close() {},
    };
    const broker = await createNodeWindowsSandboxBroker({
      helper: pinned,
      allowedTools: TOOLS,
      authenticode: {
        async verify(request) {
          return {
            version: 1,
            kind: "windowsAuthenticodeEvidence",
            path: request.path,
            hash: request.hash,
            signerSha256Thumbprint: request.signerSha256Thumbprint,
            signatureValid: true,
            appOwnedImage: true,
          };
        },
      },
      transports: { connect: async () => transport },
    });
    expect(broker.policy).toEqual(WINDOWS_M3_SANDBOX_POLICY);
    await broker.close();
  });
});
