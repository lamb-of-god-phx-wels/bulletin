import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { AppUpdateService, type UpdaterAdapter } from '../electron/updater';

class FakeUpdater extends EventEmitter implements UpdaterAdapter {
  autoDownload = false;
  autoInstallOnAppQuit = true;
  allowPrerelease = true;
  logger: unknown;
  checkForUpdates = vi.fn(async () => undefined);
  quitAndInstall = vi.fn();
}

describe('application update lifecycle', () => {
  it('configures stable background downloads and publishes progress', () => {
    const updater = new FakeUpdater();
    const statuses: string[] = [];
    const service = new AppUpdateService({ updater, currentVersion: '0.2.0', enabled: true, broadcast: status => statuses.push(status.phase), startupDelayMs: 60_000, intervalMs: 60_000 });
    service.initialize();
    updater.emit('update-available', { version: '0.3.0', releaseNotes: 'New release' });
    updater.emit('download-progress', { percent: 42.5 });
    updater.emit('update-downloaded', { version: '0.3.0' });
    expect(updater).toMatchObject({ autoDownload: true, autoInstallOnAppQuit: false, allowPrerelease: false });
    expect(statuses).toEqual(['available', 'downloading', 'ready']);
    expect(service.getStatus()).toMatchObject({ phase: 'ready', currentVersion: '0.2.0', availableVersion: '0.3.0', percent: 100 });
    service.dispose();
  });

  it('does not check in development mode', async () => {
    const updater = new FakeUpdater();
    const service = new AppUpdateService({ updater, currentVersion: '0.2.0', enabled: false, broadcast: vi.fn() });
    service.initialize();
    await service.check();
    expect(service.getStatus().phase).toBe('disabled');
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('installs only after a download is ready', () => {
    const updater = new FakeUpdater();
    const service = new AppUpdateService({ updater, currentVersion: '0.2.0', enabled: true, broadcast: vi.fn(), startupDelayMs: 60_000, intervalMs: 60_000 });
    service.initialize();
    expect(() => service.install()).toThrow(/not finished/);
    updater.emit('update-downloaded', { version: '0.3.0' });
    service.install();
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
    service.dispose();
  });
});
