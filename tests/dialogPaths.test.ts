import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DialogPathStore } from '../electron/dialogPaths';

describe('dialog path memory', () => {
  it('persists independent locations across store instances', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'bulletin-dialogs-'));
    try {
      const stateFile = path.join(root, 'settings', 'dialog-paths.json');
      const first = new DialogPathStore(stateFile);
      await first.remember('asset', '/art/series');
      await first.remember('export', '/bulletins/exports');

      const restored = new DialogPathStore(stateFile);
      expect(await restored.get('asset')).toBe('/art/series');
      expect(await restored.get('export')).toBe('/bulletins/exports');
      expect(await restored.get('workspace')).toBeUndefined();
      expect(JSON.parse(await readFile(stateFile, 'utf8'))).toEqual({
        asset: '/art/series',
        export: '/bulletins/exports'
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
