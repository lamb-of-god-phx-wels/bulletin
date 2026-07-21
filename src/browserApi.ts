import legacyExample from '../example_bulletin.json';
import { defaultTemplate } from './shared/defaults';
import { migrateLegacyBulletin } from './shared/migrate';
import type { AssetRef, BulletinApi, BulletinDocumentV1, LibraryManifestV1, TemplateV1, WorkspaceSummary } from './shared/types';

const databaseName = 'bulletin-builder';
const workspaceStore = 'workspaces';
const assetStore = 'assets';
const workspaceIndexKey = 'bulletin-browser-workspaces';
let databasePromise: Promise<IDBDatabase> | undefined;

function database() {
  return databasePromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(workspaceStore)) db.createObjectStore(workspaceStore);
      if (!db.objectStoreNames.contains(assetStore)) db.createObjectStore(assetStore);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getRecord<T>(storeName: string, key: string): Promise<T | undefined> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

async function putRecord(storeName: string, key: string, value: unknown) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function workspaceList(): Array<{ root: string; name: string }> {
  try { return JSON.parse(localStorage.getItem(workspaceIndexKey) ?? '[]'); }
  catch { return []; }
}

function setWorkspaceList(value: Array<{ root: string; name: string }>) {
  localStorage.setItem(workspaceIndexKey, JSON.stringify(value));
}

function clone<T>(value: T): T { return structuredClone(value); }
function slug(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'workspace'; }

async function createWorkspace(name: string, seedExample = false) {
  const existing = workspaceList();
  const base = `local:${slug(name)}`;
  let root = base; let suffix = 2;
  while (existing.some(item => item.root === root)) root = `${base}-${suffix++}`;
  const summary: WorkspaceSummary = {
    root,
    templates: [{ path: `templates/${defaultTemplate.id}/v1.json`, template: clone(defaultTemplate) }],
    bulletins: seedExample ? [{ path: 'bulletins/2026-06-07/bulletin.json', document: migrateLegacyBulletin(legacyExample) }] : [],
    library: { schemaVersion: 1, name: `${name} Library`, items: [] }
  };
  await putRecord(workspaceStore, root, summary);
  setWorkspaceList([...existing, { root, name }]);
  return root;
}

async function ensureDefaultWorkspace() {
  const existing = workspaceList();
  if (existing.length) return existing[0].root;
  return createWorkspace('Lamb of God', true);
}

function chooseFile(): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.png,.jpg,.jpeg,.svg,.pdf';
    input.hidden = true;
    document.body.append(input);
    const finish = (file: File | null) => { input.remove(); resolve(file); };
    input.onchange = () => finish(input.files?.[0] ?? null);
    input.addEventListener('cancel', () => finish(null), { once: true });
    input.click();
  });
}

function dataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file);
  });
}

function mediaType(file: File): AssetRef['mediaType'] {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) return 'application/pdf';
  if (file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')) return 'image/png';
  if (file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) return 'image/svg+xml';
  return 'image/jpeg';
}

async function summary(root: string) {
  const value = await getRecord<WorkspaceSummary>(workspaceStore, root);
  if (!value) throw new Error(`Workspace “${root}” no longer exists.`);
  return value;
}

export async function installBrowserApi() {
  if (window.bulletin) return;
  const defaultRoot = await ensureDefaultWorkspace();
  const api: BulletinApi & { getPrintJob(): Promise<unknown>; printReady(): void } = {
    platform: 'browser',
    chooseWorkspace: async () => defaultRoot,
    listWorkspaces: async () => workspaceList(),
    createWorkspace: name => createWorkspace(name.trim() || 'New workspace'),
    openWorkspace: async root => clone(await summary(root)),
    saveBulletin: async (root, path, document, expectedRevision) => {
      const current = await summary(root);
      const existing = current.bulletins.find(item => item.path === path);
      if (existing && existing.document.revision !== expectedRevision) throw new Error(`Conflict: expected revision ${expectedRevision}, found ${existing.document.revision}.`);
      const saved = { ...document, revision: expectedRevision + 1, updatedAt: new Date().toISOString() };
      const bulletins = existing ? current.bulletins.map(item => item.path === path ? { path, document: saved } : item) : [...current.bulletins, { path, document: saved }];
      await putRecord(workspaceStore, root, { ...current, bulletins });
      return { revision: saved.revision, updatedAt: saved.updatedAt };
    },
    saveTemplate: async (root, template) => {
      const current = await summary(root);
      const path = `templates/${template.id}/v${template.version}${template.status === 'draft' ? '-draft' : ''}.json`;
      const saved = { ...template, updatedAt: new Date().toISOString() };
      const existing = current.templates.find(item => item.path === path);
      const templates = existing ? current.templates.map(item => item.path === path ? { path, template: saved } : item) : [...current.templates, { path, template: saved }];
      await putRecord(workspaceStore, root, { ...current, templates });
      return path;
    },
    saveLibrary: async (root, library) => { const current = await summary(root); await putRecord(workspaceStore, root, { ...current, library }); },
    createRevision: async (root, bulletinPath, document, label) => {
      const key = `${root}:revision:${bulletinPath}:${Date.now()}:${label}`; await putRecord(workspaceStore, key, document); return key;
    },
    exportPdf: async (root, _path, document) => {
      localStorage.setItem('bulletin-print-job', JSON.stringify({ root, document }));
      const printUrl = `${location.pathname}?print=1`;
      history.pushState({}, '', printUrl);
      window.dispatchEvent(new Event('bulletin:open-print'));
      return 'Opening print preview';
    },
    importAsset: async (root, targetFolder) => {
      const file = await chooseFile(); if (!file) return null;
      const path = `${targetFolder}/${Date.now()}-${file.name}`;
      await putRecord(assetStore, `${root}:${path}`, await dataUrl(file));
      return { path, mediaType: mediaType(file), alt: file.name };
    },
    readAsset: async (root, path) => { const value = await getRecord<string>(assetStore, `${root}:${path}`); if (!value) throw new Error(`Asset “${path}” is unavailable.`); return value; },
    lookupScripture: async input => {
      const response = await fetch('/__bulletin/bible-gateway', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? 'BibleGateway.com import failed.'); return payload;
    },
    openScripture: async (reference, translation) => { window.open(`https://www.biblegateway.com/passage/?search=${encodeURIComponent(reference)}&version=${encodeURIComponent(translation)}`, '_blank', 'noopener,noreferrer'); },
    getPrintJob: async () => JSON.parse(localStorage.getItem('bulletin-print-job') ?? 'null'),
    printReady: () => undefined
  };
  window.bulletin = api;
}
