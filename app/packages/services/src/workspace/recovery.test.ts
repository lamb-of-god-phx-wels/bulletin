import { describe, expect, it, vi } from "vitest";
import { parseWorkspaceId, type IdPort } from "@cbb/core";
import { CompositeWorkspaceStartupRecovery } from "./recovery.js";
import type { StartupRecoveryPort, WorkspaceRegistry } from "./types.js";

const BASE: WorkspaceRegistry = {
  version: 1,
  kind: "workspace",
  workspaceId: parseWorkspaceId("11111111-1111-4111-8111-111111111111"),
  bulletins: [],
};
const RELOADED: WorkspaceRegistry = { ...BASE, displayName: "Recovered" };
const ids: IdPort = {
  randomUuid: () => "22222222-2222-4222-8222-222222222222",
};

describe("composite workspace startup recovery", () => {
  it("runs save then transaction recovery and reloads the final registry", async () => {
    const order: string[] = [];
    const saveRecovery: StartupRecoveryPort = {
      async recover() {
        order.push("save");
        return { status: "ok", registry: BASE, diagnostics: [] };
      },
    };
    const composite = new CompositeWorkspaceStartupRecovery(
      saveRecovery,
      () => ({
        async recoverStartup() {
          order.push("transaction");
          return { mode: "readWrite", actions: [], problems: [] };
        },
      }),
      {
        async reload() {
          order.push("reload");
          return RELOADED;
        },
      },
      ids,
    );
    await expect(composite.recover("/workspace", BASE)).resolves.toEqual({
      status: "ok",
      registry: RELOADED,
      diagnostics: [],
    });
    expect(order).toEqual(["save", "transaction", "reload"]);
  });

  it("does not touch generic transactions after ambiguous save recovery", async () => {
    const recoverStartup = vi.fn();
    const saveRecovery: StartupRecoveryPort = {
      async recover() {
        return { status: "readOnly", registry: BASE, diagnostics: [] };
      },
    };
    const composite = new CompositeWorkspaceStartupRecovery(
      saveRecovery,
      () => ({ recoverStartup }),
      { async reload() { return RELOADED; } },
      ids,
    );
    await expect(composite.recover("/workspace", BASE)).resolves.toMatchObject({
      status: "readOnly",
    });
    expect(recoverStartup).not.toHaveBeenCalled();
  });

  it("stops before generic transactions after an ambiguous service-specific recovery", async () => {
    const recoverStartup = vi.fn();
    const additional: StartupRecoveryPort = {
      async recover(_root, registry) {
        return { status: "readOnly", registry, diagnostics: [] };
      },
    };
    const composite = new CompositeWorkspaceStartupRecovery(
      {
        async recover() {
          return { status: "ok", registry: BASE, diagnostics: [] };
        },
      },
      () => ({ recoverStartup }),
      { async reload() { return RELOADED; } },
      ids,
      [additional],
    );

    await expect(composite.recover("/workspace", BASE)).resolves.toMatchObject({
      status: "readOnly",
    });
    expect(recoverStartup).not.toHaveBeenCalled();
  });

  it("opens read-only and does not reload after ambiguous generic recovery", async () => {
    const reload = vi.fn(async () => RELOADED);
    const composite = new CompositeWorkspaceStartupRecovery(
      {
        async recover() {
          return { status: "ok", registry: BASE, diagnostics: [] };
        },
      },
      () => ({
        async recoverStartup() {
          return {
            mode: "readOnly",
            actions: [],
            problems: [{ transactionId: "tx_1", message: "hash disagreement" }],
          };
        },
      }),
      { reload },
      ids,
    );
    const result = await composite.recover("/workspace", BASE);
    expect(result.status).toBe("readOnly");
    expect(result.diagnostics[0]).toMatchObject({
      code: "CBB-SAVE-0001",
      operation: "recover-workspace-transactions",
      disposition: "block",
    });
    expect(reload).not.toHaveBeenCalled();
  });
});
