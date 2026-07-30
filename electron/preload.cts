import { contextBridge, ipcRenderer } from 'electron';
import type { BulletinApi } from '../src/shared/types.js';

const api: BulletinApi & { getPrintJob(): Promise<unknown>; printReady(): void } = {
  platform: 'electron',
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  openWorkspace: root => ipcRenderer.invoke('workspace:open', root),
  onWorkspaceChanged: listener => {
    const handler = (_event: Electron.IpcRendererEvent, change: Parameters<typeof listener>[0]) => listener(change);
    ipcRenderer.on('workspace:changed', handler);
    return () => ipcRenderer.removeListener('workspace:changed', handler);
  },
  getUpdateStatus: () => ipcRenderer.invoke('update:status'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  reportEditingState: state => ipcRenderer.send('editing:state', state),
  onUpdateStatus: listener => {
    const handler = (_event: Electron.IpcRendererEvent, status: Parameters<typeof listener>[0]) => listener(status);
    ipcRenderer.on('update:status', handler);
    return () => ipcRenderer.removeListener('update:status', handler);
  },
  saveBulletin: (...args) => ipcRenderer.invoke('bulletin:save', ...args),
  deleteBulletin: (...args) => ipcRenderer.invoke('bulletin:delete', ...args),
  saveTemplate: (...args) => ipcRenderer.invoke('template:save', ...args),
  deleteTemplate: (...args) => ipcRenderer.invoke('template:delete', ...args),
  savePageTemplate: (...args) => ipcRenderer.invoke('page-template:save', ...args),
  deletePageTemplate: (...args) => ipcRenderer.invoke('page-template:delete', ...args),
  saveLibrary: (...args) => ipcRenderer.invoke('library:save', ...args),
  trashLibraryImages: (...args) => ipcRenderer.invoke('library:trash-images', ...args),
  restoreArchived: (...args) => ipcRenderer.invoke('archive:restore', ...args),
  permanentlyDeleteArchived: (...args) => ipcRenderer.invoke('archive:delete', ...args),
  resolveWorkspaceConflict: (...args) => ipcRenderer.invoke('workspace:resolve-conflict', ...args),
  createRevision: (...args) => ipcRenderer.invoke('revision:create', ...args),
  exportPdf: (...args) => ipcRenderer.invoke('pdf:export', ...args),
  importAsset: (...args) => ipcRenderer.invoke('asset:import', ...args),
  readAsset: (...args) => ipcRenderer.invoke('asset:read', ...args),
  lookupScripture: input => ipcRenderer.invoke('scripture:lookup', input),
  openScripture: (...args) => ipcRenderer.invoke('scripture:open', ...args),
  getPrintJob: () => ipcRenderer.invoke('print:job'),
  printReady: () => ipcRenderer.send('print:ready')
};
contextBridge.exposeInMainWorld('bulletin', api);
