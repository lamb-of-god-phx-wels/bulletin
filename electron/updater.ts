import updaterPackage from 'electron-updater';
import log from 'electron-log/main';
import type { AppUpdateStatus } from '../src/shared/types.js';

interface UpdateInfoLike {
  version: string;
  releaseNotes?: string | Array<{ version: string; note: string | null }> | null;
}

interface ProgressLike { percent: number }

export interface UpdaterAdapter {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  logger: unknown;
  on(event: string, listener: (...args: any[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

interface UpdateServiceOptions {
  updater: UpdaterAdapter;
  currentVersion: string;
  enabled: boolean;
  broadcast(status: AppUpdateStatus): void;
  startupDelayMs?: number;
  intervalMs?: number;
}

function releaseNotes(value: UpdateInfoLike['releaseNotes']): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (!Array.isArray(value)) return undefined;
  const notes = value.map(item => item.note ? `${item.version}\n${item.note}` : '').filter(Boolean);
  return notes.join('\n\n') || undefined;
}

export class AppUpdateService {
  private status: AppUpdateStatus;
  private startupTimer?: NodeJS.Timeout;
  private intervalTimer?: NodeJS.Timeout;
  private initialized = false;

  constructor(private readonly options: UpdateServiceOptions) {
    this.status = {
      phase: options.enabled ? 'idle' : 'disabled',
      currentVersion: options.currentVersion,
      ...(!options.enabled ? { message: 'Automatic updates are available in packaged Windows builds.' } : {})
    };
  }

  initialize() {
    if (this.initialized || !this.options.enabled) return;
    this.initialized = true;
    const updater = this.options.updater;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.on('checking-for-update', () => this.publish({ phase: 'checking', checkedAt: new Date().toISOString() }));
    updater.on('update-available', (info: UpdateInfoLike) => this.publish({
      phase: 'available',
      availableVersion: info.version,
      releaseNotes: releaseNotes(info.releaseNotes),
      checkedAt: new Date().toISOString()
    }));
    updater.on('update-not-available', () => this.publish({ phase: 'up-to-date', checkedAt: new Date().toISOString() }));
    updater.on('download-progress', (progress: ProgressLike) => this.publish({
      phase: 'downloading',
      percent: Math.max(0, Math.min(100, progress.percent)),
      availableVersion: this.status.availableVersion,
      releaseNotes: this.status.releaseNotes
    }));
    updater.on('update-downloaded', (info: UpdateInfoLike) => this.publish({
      phase: 'ready',
      availableVersion: info.version,
      releaseNotes: releaseNotes(info.releaseNotes) ?? this.status.releaseNotes,
      percent: 100
    }));
    updater.on('error', (error: Error) => this.publish({ phase: 'error', message: error.message || String(error) }));

    this.startupTimer = setTimeout(() => void this.check(), this.options.startupDelayMs ?? 20_000);
    this.startupTimer.unref();
    this.intervalTimer = setInterval(() => void this.check(), this.options.intervalMs ?? 6 * 60 * 60 * 1000);
    this.intervalTimer.unref();
  }

  getStatus() { return { ...this.status }; }

  async check() {
    if (!this.options.enabled) return this.getStatus();
    if (this.status.phase === 'checking' || this.status.phase === 'downloading') return this.getStatus();
    try {
      await this.options.updater.checkForUpdates();
    } catch (error) {
      this.publish({ phase: 'error', message: error instanceof Error ? error.message : String(error) });
    }
    return this.getStatus();
  }

  install() {
    if (this.status.phase !== 'ready') throw new Error('An update has not finished downloading.');
    this.options.updater.quitAndInstall(false, true);
  }

  dispose() {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
  }

  private publish(next: Omit<AppUpdateStatus, 'currentVersion'>) {
    this.status = { currentVersion: this.options.currentVersion, ...next };
    this.options.broadcast(this.getStatus());
  }
}

export function createAppUpdateService(currentVersion: string, enabled: boolean, broadcast: (status: AppUpdateStatus) => void) {
  const { autoUpdater } = updaterPackage;
  log.transports.file.level = 'info';
  autoUpdater.logger = log;
  return new AppUpdateService({ updater: autoUpdater, currentVersion, enabled, broadcast });
}
