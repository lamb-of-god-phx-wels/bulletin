import { describe, expect, it, vi } from "vitest";
import { NodeClosedTrustedComponentExecutor } from "./nodeExecutor.js";

describe("closed trusted component executor", () => {
  it("owns and consumes a path-free payload exactly once", async () => {
    const executor = new NodeClosedTrustedComponentExecutor();
    const observed = vi.fn(async () => undefined);
    const payload = executor.mint({ operation: "typstCompile", timeoutMs: 1_000, execute: observed });
    expect(Object.keys(payload).sort()).toEqual(["operation", "timeoutMs", "token"]);
    expect(executor.ownsPayload(payload, "typstCompile")).toBe(true);
    await executor.invoke({
      operation: "typstCompile",
      brokerPath: "/private/broker",
      targetPath: "/private/typst",
      payload,
    });
    expect(observed).toHaveBeenCalledWith(expect.objectContaining({
      brokerPath: "/private/broker",
      targetPath: "/private/typst",
    }));
    expect(executor.ownsPayload(payload, "typstCompile")).toBe(false);
    await expect(executor.invoke({
      operation: "typstCompile",
      brokerPath: "/private/broker",
      targetPath: "/private/typst",
      payload,
    })).rejects.toThrow(/closed trusted component operation failed/i);
  });

  it("aborts timed-out operations without leaking component paths", async () => {
    const executor = new NodeClosedTrustedComponentExecutor();
    let signal: AbortSignal | undefined;
    const payload = executor.mint({
      operation: "pdfInspect",
      timeoutMs: 5,
      execute: async (context) => {
        signal = context.signal;
        await new Promise(() => undefined);
      },
    });
    const work = executor.invoke({
      operation: "pdfInspect",
      brokerPath: "/secret/broker",
      targetPath: "/secret/pdfinfo",
      payload,
    });
    await expect(work).rejects.toThrow("Closed trusted component operation failed");
    expect(signal?.aborted).toBe(true);
    await expect(work.catch((error: unknown) => String(error))).resolves.not.toContain("/secret/");
  });
});
