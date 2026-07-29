import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startWorkspaceWatcher } from '../electron/workspaceWatcher';

describe('workspace synchronization watcher', () => {
  it('coalesces changes and discovers newly synchronized directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bulletin-watch-'));
    try {
      const events: string[][] = [];
      const close = await startWorkspaceWatcher(root, paths => events.push(paths), 25);
      await mkdir(join(root, 'library', 'items'), { recursive: true });
      await new Promise(resolve => setTimeout(resolve, 30));
      await writeFile(join(root, 'library', 'items', 'record.json'), '{}');
      await writeFile(join(root, 'workspace.json'), '{}');
      await new Promise(resolve => setTimeout(resolve, 100));
      close();
      expect(events.flat()).toContain('workspace.json');
      expect(events.flat().some(file => file.endsWith('record.json'))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
