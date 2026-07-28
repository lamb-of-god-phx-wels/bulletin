import { contextBridge, ipcRenderer } from 'electron';
import type { BulletinApi } from '../src/shared/types.js';

const api: BulletinApi & { getPrintJob(): Promise<unknown>; printReady(): void } = {
  platform: 'electron',
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  openWorkspace: root => ipcRenderer.invoke('workspace:open', root),
  saveBulletin: (...args) => ipcRenderer.invoke('bulletin:save', ...args),
  deleteBulletin: (...args) => ipcRenderer.invoke('bulletin:delete', ...args),
  saveTemplate: (...args) => ipcRenderer.invoke('template:save', ...args),
  deleteTemplate: (...args) => ipcRenderer.invoke('template:delete', ...args),
  saveLibrary: (...args) => ipcRenderer.invoke('library:save', ...args),
  createRevision: (...args) => ipcRenderer.invoke('revision:create', ...args),
  exportPdf: (...args) => ipcRenderer.invoke('pdf:export', ...args),
  importAsset: (...args) => ipcRenderer.invoke('asset:import', ...args),
  readAsset: (...args) => ipcRenderer.invoke('asset:read', ...args),
  lookupScripture: input => ipcRenderer.invoke('scripture:lookup', input),
  openScripture: (...args) => ipcRenderer.invoke('scripture:open', ...args),
  openChurchYearSource: () => ipcRenderer.invoke('church-year:open'),
  getPrintJob: () => ipcRenderer.invoke('print:job'),
  printReady: () => ipcRenderer.send('print:ready')
};
contextBridge.exposeInMainWorld('bulletin', api);
