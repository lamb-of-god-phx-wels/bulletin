import { watch, type FSWatcher } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

async function directories(root: string): Promise<string[]> {
  const result = [root];
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory()) result.push(...await directories(path.join(root, entry.name)));
  }
  return result;
}

export async function startWorkspaceWatcher(
  root: string,
  onChange: (paths: string[]) => void,
  debounceMs = 800
): Promise<() => void> {
  const watchers = new Map<string, FSWatcher>();
  const changed = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  let closed = false;

  const flush = () => {
    timer = undefined;
    const paths = [...changed];
    changed.clear();
    if (paths.length && !closed) onChange(paths);
  };
  const schedule = (relative: string) => {
    if (relative.endsWith('.tmp')) return;
    changed.add(relative);
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  };
  const scan = async () => {
    if (closed) return;
    for (const directory of await directories(root)) {
      if (closed || watchers.has(directory)) continue;
      try {
        const watcher = watch(directory, (_event, fileName) => {
          schedule(path.relative(root, path.join(directory, fileName?.toString() ?? '')));
          void scan();
        });
        watcher.on('error', () => { watcher.close(); watchers.delete(directory); });
        watchers.set(directory, watcher);
      } catch { /* A synced directory may not be hydrated yet. */ }
    }
  };

  await scan();
  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
  };
}
