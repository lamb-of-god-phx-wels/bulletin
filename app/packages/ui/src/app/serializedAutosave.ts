import type { CbbDocument } from "@cbb/core";
import type {
  RendererBridge,
  RendererResourceKind,
  RendererSaveOutcome,
} from "../bridge/index.js";

export type AutosaveState =
  | { readonly status: "clean"; readonly message: string }
  | { readonly status: "dirty" | "saving"; readonly message: string }
  | { readonly status: "saveFailed"; readonly message: string };

interface DocumentSaveStateBridge {
  setDocumentSaveState?(
    localResourceId: string,
    state: "clean" | "dirty" | "saving" | "saveFailed",
  ): Promise<void> | void;
}

export interface SerializedAutosaveOptions {
  readonly bridge: Pick<RendererBridge, "saveDocument"> & DocumentSaveStateBridge;
  readonly localResourceId: string;
  readonly resourceKind: RendererResourceKind;
  readonly baseRevisionToken: string | null;
  readonly onStateChange?: (state: AutosaveState) => void;
  readonly onSaved?: (document: CbbDocument, revisionToken: string) => void;
}

function failureMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "Your latest changes could not be saved safely.";
}

export class SerializedDocumentAutosave {
  private tail: Promise<void> = Promise.resolve();
  private baseRevisionToken: string | null;
  private pending = 0;
  private disposed = false;
  private latestOutcome: RendererSaveOutcome | undefined;

  constructor(private readonly options: SerializedAutosaveOptions) {
    this.baseRevisionToken = options.baseRevisionToken;
  }

  enqueue(document: CbbDocument): Promise<RendererSaveOutcome> {
    this.pending += 1;
    this.publish({ status: "dirty", message: "Changes waiting to save" });
    this.reportHost("dirty");
    let resolveResult!: (outcome: RendererSaveOutcome) => void;
    const result = new Promise<RendererSaveOutcome>((resolve) => {
      resolveResult = resolve;
    });
    const save = async (): Promise<void> => {
      this.publish({ status: "saving", message: "Saving changes…" });
      await this.reportHost("saving");
      let outcome: RendererSaveOutcome;
      try {
        outcome = await this.options.bridge.saveDocument({
          localResourceId: this.options.localResourceId,
          resourceKind: this.options.resourceKind,
          displayName: document.name,
          document,
          baseRevisionToken: this.baseRevisionToken,
        });
      } catch (error) {
        outcome = { status: "failed", message: failureMessage(error) };
      }
      this.pending -= 1;
      this.latestOutcome = outcome;
      if (outcome.status === "saved") {
        this.baseRevisionToken = outcome.revisionToken;
        this.options.onSaved?.(document, outcome.revisionToken);
        if (this.pending === 0) {
          this.publish({ status: "clean", message: "All changes saved" });
          await this.reportHost("clean");
        }
      } else {
        this.publish({ status: "saveFailed", message: outcome.message });
        await this.reportHost("saveFailed");
      }
      resolveResult(outcome);
    };
    this.tail = this.tail.then(save, save);
    return result;
  }

  async flush(): Promise<void> {
    // Include saves enqueued while an earlier tail is settling. A successful
    // full-document save supersedes an earlier failure; an unsuperseded final
    // failure must keep the editor alive so its in-memory document is retained.
    let observedTail: Promise<void>;
    do {
      observedTail = this.tail;
      await observedTail;
    } while (observedTail !== this.tail);
    if (this.latestOutcome !== undefined && this.latestOutcome.status !== "saved") {
      throw new Error(this.latestOutcome.message);
    }
  }

  dispose(): void {
    this.disposed = true;
  }

  private publish(state: AutosaveState): void {
    if (!this.disposed) this.options.onStateChange?.(state);
  }

  private async reportHost(
    state: "clean" | "dirty" | "saving" | "saveFailed",
  ): Promise<void> {
    try {
      await this.options.bridge.setDocumentSaveState?.(this.options.localResourceId, state);
    } catch {
      // Host lifecycle reporting must not suppress the authoritative save.
    }
  }
}
