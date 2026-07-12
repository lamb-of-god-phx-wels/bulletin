import { resolve } from "node:path";

/**
 * Serializes mutations to one workspace across all service instances in this
 * process. The durable workspace lease excludes cooperating processes; this
 * coordinator closes the remaining in-process read/compare/replace race
 * between document saves and generic resource transactions.
 */
class WorkspaceMutationCoordinator {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(workspaceRoot: string, operation: () => Promise<T>): Promise<T> {
    const key = resolve(workspaceRoot);
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => current);
    this.tails.set(key, tail);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release?.();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}

const coordinator = new WorkspaceMutationCoordinator();

export function withWorkspaceMutation<T>(
  workspaceRoot: string,
  operation: () => Promise<T>,
): Promise<T> {
  return coordinator.run(workspaceRoot, operation);
}
