import { contextBridge, ipcRenderer } from 'electron';
import type { BulletinApi } from '../src/shared/types.js';

const api: BulletinApi & { getPrintJob(): Promise<unknown>; printReady(): void } = {
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  openWorkspace: root => ipcRenderer.invoke('workspace:open', root),
  saveBulletin: (...args) => ipcRenderer.invoke('bulletin:save', ...args),
  saveTemplate: (...args) => ipcRenderer.invoke('template:save', ...args),
  saveLibrary: (...args) => ipcRenderer.invoke('library:save', ...args),
  createRevision: (...args) => ipcRenderer.invoke('revision:create', ...args),
  exportPdf: (...args) => ipcRenderer.invoke('pdf:export', ...args),
  importAsset: (...args) => ipcRenderer.invoke('asset:import', ...args),
  readAsset: (...args) => ipcRenderer.invoke('asset:read', ...args),
  lookupScripture: input => ipcRenderer.invoke('scripture:lookup', input),
  getPrintJob: () => ipcRenderer.invoke('print:job'),
  printReady: () => ipcRenderer.send('print:ready')
};
contextBridge.exposeInMainWorld('bulletin', api);
