import { isCanonicalUuid, type IdPort } from "@cbb/core";
import type { StartupRecoveryResult as TransactionStartupRecoveryResult } from "../transactions/index.js";
import { serviceDiagnostic } from "./diagnostics.js";
import type {
  StartupRecoveryPort,
  StartupRecoveryResult,
  WorkspaceRegistry,
} from "./types.js";

export interface MultiTransactionStartupRecoveryPort {
  recoverStartup(): Promise<TransactionStartupRecoveryResult>;
}

export interface WorkspaceRecoveryRegistryPort {
  reload(root: string): Promise<WorkspaceRegistry>;
}

/**
 * Run save-journal recovery first, then generic transaction recovery, before
 * any editable document session is returned. Any ambiguity stops the chain and
 * opens read-only; later recovery stages never run after an earlier ambiguity.
 */
export class CompositeWorkspaceStartupRecovery implements StartupRecoveryPort {
  constructor(
    private readonly saveRecovery: StartupRecoveryPort,
    private readonly transactionsForRoot: (
      root: string,
    ) => MultiTransactionStartupRecoveryPort,
    private readonly registry: WorkspaceRecoveryRegistryPort,
    private readonly ids: IdPort,
  ) {}

  async recover(
    root: string,
    loadedRegistry: WorkspaceRegistry,
  ): Promise<StartupRecoveryResult> {
    const saves = await this.saveRecovery.recover(root, loadedRegistry);
    if (saves.status === "readOnly") return saves;

    const transactions = await this.transactionsForRoot(root).recoverStartup();
    if (transactions.mode === "readOnly") {
      const correlationId = this.ids.randomUuid();
      if (!isCanonicalUuid(correlationId)) {
        throw new TypeError("Id port returned an invalid recovery correlation id");
      }
      return {
        status: "readOnly",
        registry: saves.registry,
        diagnostics: [
          ...saves.diagnostics,
          serviceDiagnostic({
            code: "CBB-SAVE-0001",
            correlationId,
            operation: "recover-workspace-transactions",
            userSummary:
              "An interrupted workspace operation could not be recovered safely.",
            technicalDetail: transactions.problems
              .map((problem) => `${problem.transactionId}: ${problem.message}`)
              .join("\n"),
            recoveryActions: ["cancel"],
          }),
        ],
      };
    }

    // A completed transaction may have advanced workspace.json as its final
    // commit marker. Reload only after all journals are resolved.
    const registry = await this.registry.reload(root);
    return {
      status: "ok",
      registry,
      diagnostics: saves.diagnostics,
    };
  }
}
