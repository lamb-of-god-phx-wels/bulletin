import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { copyAssetWithoutOverwrite, numberedAssetName } from '../electron/assets';

describe('asset imports', () => {
  it('keeps the original name for the first asset and numbers later collisions', () => {
    expect(numberedAssetName('logo.png', 1)).toBe('logo.png');
    expect(numberedAssetName('logo.png', 2)).toBe('logo-2.png');
    expect(numberedAssetName('sermon.series.logo.svg', 3)).toBe('sermon.series.logo-3.svg');
  });

  it('preserves both files when imported assets share a basename', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'bulletin-assets-'));
    try {
      const church = path.join(root, 'church');
      const series = path.join(root, 'series');
      const destination = path.join(root, 'assets');
      await Promise.all([church, series, destination].map(folder => mkdir(folder)));
      await writeFile(path.join(church, 'logo.png'), 'church logo');
      await writeFile(path.join(series, 'logo.png'), 'series logo');
      const first = await copyAssetWithoutOverwrite(path.join(church, 'logo.png'), destination);
      const second = await copyAssetWithoutOverwrite(path.join(series, 'logo.png'), destination);
      expect(path.basename(first)).toBe('logo.png');
      expect(path.basename(second)).toBe('logo-2.png');
      expect(await readFile(first, 'utf8')).toBe('church logo');
      expect(await readFile(second, 'utf8')).toBe('series logo');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
