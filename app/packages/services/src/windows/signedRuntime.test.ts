import { hashBytes } from "@cbb/core";
import { describe, expect, it, vi } from "vitest";
import {
  NodeClosedTrustedComponentExecutor,
  type TrustedComponentExecutionGrant,
  type TrustedComponentIdentity,
  type TrustedComponentLocator,
  type TrustedComponentRegistry,
} from "../components/index.js";
import {
  createSignedNodeWindowsM3Runtime,
  type BindPrivilegedWindowsToolRequest,
  type PrivilegedWindowsToolBindingPort,
  type SealedPrivilegedWindowsM3Bindings,
} from "./signedRuntime.js";

const BROKER = identity("executionBroker", "windows-sandbox-broker");
const TYPST = identity("typstCli", "typst");
const PDF = identity("pdfInspector", "pdf-inspector");
const QUARANTINE = identity("quarantineWorker", "quarantine-worker");

function identity(
  role: TrustedComponentIdentity["role"],
  id: string,
): TrustedComponentIdentity {
  return Object.freeze({
    role,
    id,
    version: "1.0.0",
    platform: "win32",
    arch: "x64",
    hash: hashBytes(new TextEncoder().encode(`${role}:${id}`)),
    byteSize: 1_024,
  });
}

function locator(token: string): TrustedComponentLocator {
  return Object.freeze({ token }) as TrustedComponentLocator;
}

describe("signed Windows M3 runtime construction", () => {
  it.skipIf(process.platform === "win32")(
    "consumes the exact three signed grants and cleans sealed native bindings when Windows is unavailable",
    async () => {
      const executor = new NodeClosedTrustedComponentExecutor();
      const executionBroker = locator("broker");
      const typst = locator("typst");
      const pdfInspector = locator("pdf");
      const quarantineWorker = locator("quarantine");
      const targets = new Map<TrustedComponentLocator, TrustedComponentIdentity>([
        [typst, TYPST],
        [pdfInspector, PDF],
        [quarantineWorker, QUARANTINE],
      ]);
      const authorizations: unknown[] = [];
      const registry = {
        manifestHash: hashBytes(new TextEncoder().encode("manifest")),
        signingKeyId: "release-key",
        release: {
          applicationId: "church-bulletin-builder",
          releaseId: "test",
          releaseSequence: 1,
          profile: "m3",
        },
        components: [BROKER, TYPST, PDF, QUARANTINE],
        execution: {
          async authorize(request: {
            operation: TrustedComponentExecutionGrant["operation"];
            broker: TrustedComponentLocator;
            target: TrustedComponentLocator;
          }) {
            authorizations.push(request);
            return Object.freeze({
              token: `grant:${request.operation}`,
              operation: request.operation,
              broker: BROKER,
              target: targets.get(request.target)!,
            }) as TrustedComponentExecutionGrant;
          },
          async invoke({ grant, payload }: {
            grant: TrustedComponentExecutionGrant;
            payload: Parameters<NodeClosedTrustedComponentExecutor["ownsPayload"]>[0];
          }) {
            await executor.invoke({
              operation: grant.operation,
              brokerPath: "C:\\Program Files\\CBB\\windows-sandbox-broker.exe",
              targetPath: `C:\\Program Files\\CBB\\${grant.target.id}.exe`,
              payload,
            });
          },
        },
        async resolve() { throw new Error("not used"); },
      } as unknown as TrustedComponentRegistry;

      const sealedClose = vi.fn(async () => undefined);
      const sealed: SealedPrivilegedWindowsM3Bindings = {
        transports: { connect: vi.fn() },
        capabilities: {
          createInput: vi.fn(),
          readOutput: vi.fn(),
          release: vi.fn(),
        },
        quarantineCapabilities: {
          reserve: vi.fn(),
          release: vi.fn(),
          discard: vi.fn(),
        },
        close: sealedClose,
      };
      const bindTarget = vi.fn(async (_request: BindPrivilegedWindowsToolRequest) => undefined);
      const seal = vi.fn(async () => sealed);
      const sessionClose = vi.fn(async () => undefined);
      const createSession = vi.fn(async () => ({ bindTarget, seal, close: sessionClose }));
      const nativeBindings: PrivilegedWindowsToolBindingPort = { create: createSession };
      const authenticode = { verify: vi.fn() };

      await expect(createSignedNodeWindowsM3Runtime({
        registry,
        executor,
        executionBroker,
        typst,
        pdfInspector,
        quarantineWorker,
        nativeBindings,
        authenticode,
        brokerSignerSha256Thumbprint: "a".repeat(64),
        architecture: "x64",
        resources: { read: vi.fn() },
      })).rejects.toThrow("Signed Windows M3 runtime is unavailable");

      expect(authorizations).toEqual([
        { operation: "typstCompile", broker: executionBroker, target: typst },
        { operation: "pdfInspect", broker: executionBroker, target: pdfInspector },
        { operation: "quarantineExecute", broker: executionBroker, target: quarantineWorker },
      ]);
      expect(createSession).toHaveBeenCalledWith({
        version: 1,
        broker: BROKER,
        tools: [
          { operation: "typstCompile", toolId: "typst", target: TYPST },
          { operation: "pdfInspect", toolId: "pdf-inspector", target: PDF },
          { operation: "quarantineExecute", toolId: "quarantine-worker", target: QUARANTINE },
        ],
      });
      expect(bindTarget.mock.calls.map((call) => ({
        operation: call[0].operation,
        toolId: call[0].toolId,
        broker: call[0].broker,
        target: call[0].target,
      }))).toEqual([
        { operation: "typstCompile", toolId: "typst", broker: BROKER, target: TYPST },
        { operation: "pdfInspect", toolId: "pdf-inspector", broker: BROKER, target: PDF },
        {
          operation: "quarantineExecute",
          toolId: "quarantine-worker",
          broker: BROKER,
          target: QUARANTINE,
        },
      ]);
      expect(seal).toHaveBeenCalledOnce();
      expect(sealedClose).toHaveBeenCalledOnce();
      expect(sessionClose).not.toHaveBeenCalled();
      expect(authenticode.verify).not.toHaveBeenCalled();
    },
  );
});
