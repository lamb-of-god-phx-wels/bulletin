import { describe, expect, it } from "vitest";
import { rendererAllowsShutdown } from "./shutdownGuard.js";

describe("renderer shutdown guard", () => {
  it("allows a clean renderer and blocks dirty, saving, or failed work", async () => {
    let blocked = false;
    const state = { hasRendererShutdownBlockers: () => blocked };
    await expect(rendererAllowsShutdown(state)).resolves.toBe(true);
    blocked = true;
    await expect(rendererAllowsShutdown(state)).resolves.toBe(false);
  });

  it("drains an already-delivered save-state update before deciding", async () => {
    let blocked = false;
    queueMicrotask(() => { blocked = true; });
    await expect(rendererAllowsShutdown({
      hasRendererShutdownBlockers: () => blocked,
    })).resolves.toBe(false);
  });
});
