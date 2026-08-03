import legacyExample from '../example_bulletin.json';
import { defaultPageTemplate, defaultTemplate } from './shared/defaults';
import { randomId } from './shared/id';
import { normalizeCanvasBlocks } from './shared/canvas';
import { normalizeLibrary } from './shared/library';
import { migrateLegacyBulletin } from './shared/migrate';
import { migrateChurchWeekNames, upgradeWelsCalendarPresets, welsCalendarPreset } from './shared/churchCalendar';
import { normalizeScriptureReference } from './shared/scriptureReference';
import type { AssetRef, BulletinApi, BulletinDocumentV1, LibraryManifestV1, TemplateV1, WorkspaceSummary } from './shared/types';
import churchLogoUrl from '../assets/church/logo.png';
import seriesLogoUrl from '../assets/sermon_series/say_it_out_loud/logo.png';
import churchBuildingUrl from '../assets/example_2026-06-07/church-building.png';
import psalmPartOneUrl from '../assets/example_2026-06-07/psalm-130-part-1.png';
import psalmPartTwoUrl from '../assets/example_2026-06-07/psalm-130-part-2.png';
import closingSongUrl from '../assets/example_2026-06-07/his-mercy-is-more.png';
import prayerCareQrUrl from '../assets/example_2026-06-07/prayer-care-qr.png';
import givingQrUrl from '../assets/example_2026-06-07/giving-qr.png';

const databaseName = 'bulletin-builder';
const workspaceStore = 'workspaces';
const assetStore = 'assets';
const workspaceIndexKey = 'bulletin-browser-workspaces';
let databasePromise: Promise<IDBDatabase> | undefined;
const exampleAssets: Record<string, string> = {
  'assets/church/logo.png': churchLogoUrl,
  'assets/sermon_series/say_it_out_loud/logo.png': seriesLogoUrl,
  'assets/example_2026-06-07/church-building.png': churchBuildingUrl,
  'assets/example_2026-06-07/psalm-130-part-1.png': psalmPartOneUrl,
  'assets/example_2026-06-07/psalm-130-part-2.png': psalmPartTwoUrl,
  'assets/example_2026-06-07/his-mercy-is-more.png': closingSongUrl,
  'assets/example_2026-06-07/prayer-care-qr.png': prayerCareQrUrl,
  'assets/example_2026-06-07/giving-qr.png': givingQrUrl
};
const exampleTemplate: TemplateV1 = {
  ...defaultTemplate,
  id: 'lamb-of-god-example',
  name: 'Lamb of God — June 7, 2026 Example',
  theme: {
    ...defaultTemplate.theme,
    bodyFont: 'CalibriLocal, Calibri, Arial, sans-serif',
    displayFont: 'ErasLocal, Georgia, serif',
    bodySizePt: 8,
    lineHeight: 1.16,
    marginIn: 0.3
  }
};

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
    templates: seedExample
      ? [{ path: `templates/${defaultTemplate.id}/v1.json`, template: clone(defaultTemplate) }, { path: `templates/${exampleTemplate.id}/v1.json`, template: clone(exampleTemplate) }]
      : [{ path: `templates/${defaultTemplate.id}/v1.json`, template: clone(defaultTemplate) }],
    pageTemplates: [{ path: `page-templates/${defaultPageTemplate.id}/v1.json`, pageTemplate: clone(defaultPageTemplate) }],
    revisions: [],
    bulletins: seedExample ? [{ path: 'bulletins/2026-06-07/bulletin.json', document: migrateLegacyBulletin(legacyExample) }] : [],
    library: { schemaVersion: 1, name: `${name} Library`, items: [], calendarEvents: welsCalendarPreset() }
  };
  await putRecord(workspaceStore, root, summary);
  setWorkspaceList([...existing, { root, name }]);
  return root;
}

async function ensureDefaultWorkspace() {
  const existing = workspaceList();
  if (existing.length) return existing[0].root;
  return createWorkspace('Lamb of God');
}

function chooseFile(kind: 'page' | 'font' = 'page'): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = kind === 'font' ? '.ttf,.otf,.woff,.woff2' : '.png,.jpg,.jpeg,.svg,.pdf';
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
  if (file.type === 'font/ttf' || file.name.toLowerCase().endsWith('.ttf')) return 'font/ttf';
  if (file.type === 'font/otf' || file.name.toLowerCase().endsWith('.otf')) return 'font/otf';
  if (file.type === 'font/woff' || file.name.toLowerCase().endsWith('.woff')) return 'font/woff';
  if (file.type === 'font/woff2' || file.name.toLowerCase().endsWith('.woff2')) return 'font/woff2';
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) return 'application/pdf';
  if (file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')) return 'image/png';
  if (file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) return 'image/svg+xml';
  return 'image/jpeg';
}

async function summary(root: string) {
  let value = await getRecord<WorkspaceSummary>(workspaceStore, root);
  if (!value) throw new Error(`Workspace “${root}” no longer exists.`);
  value = { ...value, pageTemplates: value.pageTemplates ?? [], revisions: value.revisions ?? [] };
  if (!value.library) return value;
  const normalized = normalizeLibrary(value.library);
  const migratedLibrary = normalized.calendarEvents === undefined
    ? { ...normalized, calendarEvents: migrateChurchWeekNames(normalized.churchWeekNames ?? []) }
    : normalized;
  const upgradedEvents = upgradeWelsCalendarPresets(migratedLibrary.calendarEvents ?? []);
  const library = upgradedEvents === migratedLibrary.calendarEvents
    ? migratedLibrary
    : { ...migratedLibrary, calendarEvents: upgradedEvents };
  if (library === value.library) return value;
  const migrated = { ...value, library };
  await putRecord(workspaceStore, root, migrated);
  return migrated;
}

export async function installBrowserApi() {
  if (window.bulletin) return;
  const defaultRoot = await ensureDefaultWorkspace();
  const api: BulletinApi & { getPrintJob(): Promise<unknown>; printReady(): void } = {
    platform: 'browser',
    chooseWorkspace: async () => defaultRoot,
    listWorkspaces: async () => workspaceList(),
    createWorkspace: name => createWorkspace(name.trim() || 'New workspace'),
    openWorkspace: async root => {
      const current = clone(await summary(root));
      return {
        ...current,
        bulletins: current.bulletins.map(record => ({ ...record, document: { ...record.document, blocks: normalizeCanvasBlocks(record.document.blocks) } })),
        revisions: (current.revisions ?? []).map(record => ({ ...record, document: { ...record.document, blocks: normalizeCanvasBlocks(record.document.blocks) } })),
        templates: current.templates.map(record => ({ ...record, template: { ...record.template, starterBlocks: normalizeCanvasBlocks(record.template.starterBlocks) } })),
        pageTemplates: current.pageTemplates.map(record => ({ ...record, pageTemplate: { ...record.pageTemplate, blocks: normalizeCanvasBlocks(record.pageTemplate.blocks) } }))
      };
    },
    saveBulletin: async (root, path, document, expectedRevision) => {
      const current = await summary(root);
      const existing = current.bulletins.find(item => item.path === path);
      if (existing && existing.document.revision !== expectedRevision) throw new Error(`Conflict: expected revision ${expectedRevision}, found ${existing.document.revision}.`);
      const saved = { ...document, revision: expectedRevision + 1, updatedAt: new Date().toISOString() };
      const bulletins = existing ? current.bulletins.map(item => item.path === path ? { path, document: saved } : item) : [...current.bulletins, { path, document: saved }];
      await putRecord(workspaceStore, root, { ...current, bulletins });
      return { revision: saved.revision, updatedAt: saved.updatedAt };
    },
    deleteBulletin: async (root, path) => {
      const current = await summary(root);
      await putRecord(workspaceStore, root, { ...current, bulletins: current.bulletins.filter(item => item.path !== path) });
    },
    saveTemplate: async (root, template) => {
      const current = await summary(root);
      const path = `templates/${template.id}/v${template.version}${template.status === 'draft' ? '-draft' : ''}.json`;
      const saved = template;
      const existing = current.templates.find(item => item.path === path);
      const templates = existing ? current.templates.map(item => item.path === path ? { path, template: saved } : item) : [...current.templates, { path, template: saved }];
      await putRecord(workspaceStore, root, { ...current, templates });
      return path;
    },
    deleteTemplate: async (root, path) => {
      const current = await summary(root);
      await putRecord(workspaceStore, root, { ...current, templates: current.templates.filter(item => item.path !== path) });
    },
    savePageTemplate: async (root, pageTemplate) => {
      const current = await summary(root);
      const path = `page-templates/${pageTemplate.id}/v${pageTemplate.version}${pageTemplate.status === 'draft' ? '-draft' : ''}.json`;
      const existing = current.pageTemplates.find(item => item.path === path);
      const pageTemplates = existing ? current.pageTemplates.map(item => item.path === path ? { path, pageTemplate } : item) : [...current.pageTemplates, { path, pageTemplate }];
      await putRecord(workspaceStore, root, { ...current, pageTemplates });
      return path;
    },
    deletePageTemplate: async (root, path) => {
      const current = await summary(root);
      await putRecord(workspaceStore, root, { ...current, pageTemplates: current.pageTemplates.filter(item => item.path !== path) });
    },
    saveLibrary: async (root, library) => { const current = await summary(root); await putRecord(workspaceStore, root, { ...current, library: normalizeLibrary(library) }); },
    trashLibraryImages: async (root, folderIds, imageIds, previous) => {
      const folderSet = new Set(folderIds); const imageSet = new Set(imageIds);
      const library = normalizeLibrary({
        ...previous,
        items: previous.items.filter(item => !imageSet.has(item.id)),
        folders: (previous.folders ?? []).filter(folder => !folderSet.has(folder.id)),
        catalog: (previous.catalog ?? []).filter(entry => entry.targetKind !== 'library-item' || !imageSet.has(entry.targetId))
      });
      const current = await summary(root);
      await putRecord(workspaceStore, root, { ...current, library });
      return library;
    },
    trashLibraryRecords: async (root, selection, previous) => {
      const current = await summary(root);
      const folderIds = new Set(selection.folderIds);
      const keys = new Set(selection.records.map(record => `${record.targetKind}:${record.targetId}`));
      const library = normalizeLibrary({
        ...previous,
        items: previous.items.filter(item => !keys.has(`library-item:${item.id}`)),
        componentDefinitions: (previous.componentDefinitions ?? []).filter(item => !keys.has(`component:${item.type}`)),
        calendarEvents: (previous.calendarEvents ?? []).filter(item => !keys.has(`calendar-event:${item.id}`)),
        folders: (previous.folders ?? []).filter(folder => !folderIds.has(folder.id)),
        catalog: (previous.catalog ?? []).filter(entry => !keys.has(`${entry.targetKind}:${entry.targetId}`))
      });
      const pageTemplateIds = selection.records.filter(record => record.targetKind === 'page-template').map(record => record.targetId);
      const templateIds = selection.records.filter(record => record.targetKind === 'template').map(record => record.targetId);
      await putRecord(workspaceStore, root, {
        ...current,
        library,
        pageTemplates: current.pageTemplates.filter(record => !pageTemplateIds.includes(record.pageTemplate.id)),
        templates: current.templates.filter(record => !templateIds.includes(record.template.id))
      });
      return { library, pageTemplateIds, templateIds };
    },
    createRevision: async (root, bulletinPath, document, label) => {
      const current = await summary(root);
      const createdAt = new Date().toISOString();
      const path = `${bulletinPath.slice(0, bulletinPath.lastIndexOf('/'))}/revisions/${createdAt.replace(/[:.]/g, '-')}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'revision'}.json`;
      await putRecord(workspaceStore, root, {
        ...current,
        revisions: [{ path, bulletinPath, label, createdAt, document: clone(document) }, ...(current.revisions ?? [])]
      });
      return path;
    },
    exportPdf: async (root, _path, document) => {
      localStorage.setItem('bulletin-print-job', JSON.stringify({ root, document }));
      const printUrl = `${location.pathname}?print=1`;
      history.pushState({}, '', printUrl);
      window.dispatchEvent(new Event('bulletin:open-print'));
      return 'Opening print preview';
    },
    importAsset: async (root, targetFolder, kind = 'page') => {
      const file = await chooseFile(kind); if (!file) return null;
      const path = `${targetFolder}/${Date.now()}-${randomId()}-${file.name}`;
      await putRecord(assetStore, `${root}:${path}`, await dataUrl(file));
      return { path, mediaType: mediaType(file), alt: file.name };
    },
    readAsset: async (root, path) => { const value = await getRecord<string>(assetStore, `${root}:${path}`); if (!value && !exampleAssets[path]) throw new Error(`Asset “${path}” is unavailable.`); return value ?? exampleAssets[path]; },
    lookupScripture: async input => {
      const response = await fetch('/__bulletin/bible-gateway', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? 'BibleGateway.com import failed.'); return payload;
    },
    openScripture: async (reference, translation) => { window.open(`https://www.biblegateway.com/passage/?search=${encodeURIComponent(normalizeScriptureReference(reference))}&version=${encodeURIComponent(translation)}`, '_blank', 'noopener,noreferrer'); },
    getPrintJob: async () => JSON.parse(localStorage.getItem('bulletin-print-job') ?? 'null'),
    printReady: () => undefined
  };
  window.bulletin = api;
}
