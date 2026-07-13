/**
 * @cbb/services — main-process service layer for the Church Bulletin Builder.
 *
 * Runs in the Electron main process. Owns workspace, persistence, build,
 * assets, fonts, library, export, history, backup, and other services.
 */

export const SERVICES_PACKAGE_NAME = "@cbb/services" as const;

export * from "./ports/index.js";
export * from "./workspace/index.js";
export * from "./persistence/index.js";
export * from "./autosave/index.js";
export {
  JournaledTransactionCoordinator,
  NodeWorkspaceTransactionStorage,
  TRANSACTION_JOURNAL_SCHEMA_ID,
  TransactionAmbiguityError,
  TransactionInputError,
  TransactionStateError,
} from "./transactions/index.js";
export type {
  DeleteResourceMutation,
  DurableBlob,
  JournaledResourceStep,
  PreparedTransaction,
  PutResourceMutation,
  ResourceMutation,
  StartupRecoveryAction as TransactionStartupRecoveryAction,
  StartupRecoveryProblem as TransactionStartupRecoveryProblem,
  StartupRecoveryResult as TransactionStartupRecoveryResult,
  TransactionClockPort,
  TransactionDigest,
  TransactionFailure,
  TransactionHashPort,
  TransactionIdPort,
  TransactionJournal,
  TransactionPayload,
  TransactionRequest,
  TransactionState,
  TransactionStoragePort,
  NodeWorkspaceTransactionStorageOptions,
  TransactionResourcePathPort,
} from "./transactions/index.js";
export * from "./resources/index.js";
export * from "./components/index.js";
export * from "./build/index.js";
export * from "./artifacts/index.js";
export * from "./history/retentionGraph.js";
export * from "./history/retentionProjection.js";
export * from "./history/nodeRetention.js";
export * from "./windows/buildSandbox.js";
export * from "./windows/pdfInspector.js";
export * from "./windows/signedRuntime.js";
