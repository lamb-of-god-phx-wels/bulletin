export interface M4RendererDirtyStatePort {
  hasRendererShutdownBlockers(): boolean;
}

/**
 * Check renderer save state only after already-delivered IPC has had one main
 * process turn to settle. The BrowserWindow must be input-disabled before this
 * begins so a new edit cannot race the final decision.
 */
export async function rendererAllowsShutdown(state: M4RendererDirtyStatePort): Promise<boolean> {
  await new Promise<void>((resolvePending) => setImmediate(resolvePending));
  return !state.hasRendererShutdownBlockers();
}
