import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NodeBubblewrapQuarantineWorker,
  NodeLinuxPdfFlattenWorker,
  type QuarantineWorkerPort,
} from "@cbb/workers";
import { hexToSha256Hash } from "@cbb/core";
import { NodeClosedTrustedComponentExecutor } from "./nodeExecutor.js";
import { createSignedNodeLinuxQuarantineWorker } from "./signedQuarantineRuntime.js";
import type {
  TrustedComponentExecutionGrant,
  TrustedComponentIdentity,
  TrustedComponentLocator,
  TrustedComponentRegistry,
  TrustedComponentRole,
} from "./types.js";

const HASH = hexToSha256Hash("a".repeat(64));

afterEach(() => vi.restoreAllMocks());

function locator(token: string): TrustedComponentLocator {
  return Object.freeze({ token }) as TrustedComponentLocator;
}

function identity(role: TrustedComponentRole, id: string): TrustedComponentIdentity {
  return Object.freeze({
    role,
    id,
    version: "1",
    platform: "linux",
    arch: "x64",
    hash: HASH,
    byteSize: 1,
  });
}

describe("signed Linux quarantine construction", () => {
  it("constructs PDF routing only while every target callback remains nested and live", async () => {
    const executor = new NodeClosedTrustedComponentExecutor();
    const broker = identity("executionBroker", "broker");
    const targets = {
      quarantineExecute: identity("quarantineWorker", "quarantine"),
      pdfFlatten: identity("pdfFlattener", "pdftocairo"),
      pdfInspect: identity("pdfInspector", "pdfinfo"),
      pdfStructuralInspect: identity("pdfStructuralInspector", "qpdf"),
      pdfRuntimeBind: identity("pdfRuntimeClosure", "runtime"),
    } as const;
    const live = new Set<string>();
    const registry = {
      execution: {
        async authorize(request: { operation: keyof typeof targets }) {
          return Object.freeze({
            token: `grant:${request.operation}`,
            operation: request.operation,
            broker,
            target: targets[request.operation],
          }) as TrustedComponentExecutionGrant;
        },
        async invoke({ grant, payload }: {
          grant: TrustedComponentExecutionGrant;
          payload: Parameters<NodeClosedTrustedComponentExecutor["ownsPayload"]>[0];
        }) {
          live.add(grant.operation);
          try {
            await executor.invoke({
              operation: grant.operation,
              brokerPath: "/trusted/broker",
              targetPath: `/trusted/${grant.target.id}`,
              payload,
            });
          } finally {
            live.delete(grant.operation);
          }
        },
      },
    } as unknown as TrustedComponentRegistry;
    const fakeStatic: QuarantineWorkerPort = {
      isolationAvailable: true,
      async execute() { return {}; },
      async terminate() {},
    };
    const fakePdf: QuarantineWorkerPort = {
      isolationAvailable: true,
      async execute() { return {}; },
      async terminate() {},
    };
    vi.spyOn(NodeBubblewrapQuarantineWorker, "create")
      .mockResolvedValue(fakeStatic as NodeBubblewrapQuarantineWorker);
    vi.spyOn(NodeLinuxPdfFlattenWorker, "create").mockImplementation(async () => {
      expect([...live].sort()).toEqual([
        "pdfFlatten", "pdfInspect", "pdfRuntimeBind", "pdfStructuralInspect",
      ]);
      return fakePdf as NodeLinuxPdfFlattenWorker;
    });

    const worker = await createSignedNodeLinuxQuarantineWorker({
      registry,
      executor,
      executionBroker: locator("broker"),
      quarantineWorker: locator("quarantine"),
      pdfFlattener: locator("flattener"),
      pdfInspector: locator("inspector"),
      pdfStructuralInspector: locator("structural"),
      pdfRuntimeClosure: locator("runtime"),
      runtimeRoot: "/private/static-runtime",
      pdfPrivateRuntimeRoot: "/private/pdf-runtime",
      handles: {} as never,
    });
    expect(worker.isolationAvailable).toBe(true);
    expect(live.size).toBe(0);
  });
});
