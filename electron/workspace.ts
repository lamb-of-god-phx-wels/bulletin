import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  ArchivedWorkspaceRecord, AssetRef, BulletinDocumentV1, ChurchWeekName, LibraryItemV1, LibraryManifestV1, SharedRecordKind,
  PageTemplateV1, TemplateV1, WorkspaceConflict, WorkspaceSummary
} from '../src/shared/types.js';
import type { DeclarativeComponentDefinition } from '../src/component-engine/types.js';
import { defaultPageTemplate, defaultTemplate } from '../src/shared/defaults.js';
import { normalizeCanvasBlocks } from '../src/shared/canvas.js';
import { normalizeLibrary } from '../src/shared/library.js';
import { meetsMinimumVersion } from '../src/shared/version.js';

interface WorkspaceFileV2 {
  schemaVersion: 2;
  name: string;
  libraryName: string;
  createdAt: string;
  migratedAt?: string;
  legacyLibraryHash?: string;
  minimumAppVersion?: string;
  minimumAppMessage?: string;
}

interface SyncRecord<T> {
  format: 'bulletin-shared-record-v2';
  kind: 'library-item' | 'church-week' | 'component';
  recordId: string;
  revision: number;
  baseRevision: number;
  updatedAt: string;
  archivedAt?: string;
  value: T;
}

interface LibraryRecords {
  name: string;
  items: Map<string, SyncRecord<LibraryItemV1>>;
  churchWeeks: Map<string, SyncRecord<ChurchWeekName>>;
  components: Map<string, SyncRecord<DeclarativeComponentDefinition>>;
  conflicts: WorkspaceConflict[];
}

interface Tombstone {
  schemaVersion: 1;
  kind: SharedRecordKind;
  originalPath: string;
  recordId?: string;
  deletedAt: string;
}

interface ArchivedFile {
  format: 'bulletin-archive-v1';
  originalPath: string;
  archivedAt: string;
  value: unknown;
}

function normalizeWorkspacePath(relative: string) {
  return relative.replaceAll('\\', '/');
}

function workspaceRelative(root: string, file: string) {
  return normalizeWorkspacePath(path.relative(root, file));
}

function inside(root: string, relative: string) {
  const target = path.resolve(root, normalizeWorkspacePath(relative));
  const normalizedRoot = path.resolve(root) + path.sep;
  if (target !== path.resolve(root) && !target.startsWith(normalizedRoot)) throw new Error('Path leaves the selected workspace.');
  return target;
}

async function readJson<T>(file: string): Promise<T> { return JSON.parse(await readFile(file, 'utf8')) as T; }

async function atomicJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
}

async function exists(file: string) {
  try { await stat(file); return true; } catch { return false; }
}

function safeSegment(value: string) {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 64) || 'record';
  return `${slug}-${createHash('sha256').update(value.toLocaleLowerCase()).digest('hex').slice(0, 10)}`;
}

const itemKey = (item: Pick<LibraryItemV1, 'id' | 'version'>) => `${item.id}:${item.version}`;
const churchWeekKey = (item: Pick<ChurchWeekName, 'sourceName'>) => item.sourceName.toLocaleLowerCase();
const componentKey = (item: Pick<DeclarativeComponentDefinition, 'type' | 'version'>) => `${item.type}:${item.version}`;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

function recordPath(root: string, kind: SyncRecord<unknown>['kind'], value: LibraryItemV1 | ChurchWeekName | DeclarativeComponentDefinition) {
  if (kind === 'library-item') {
    const item = value as LibraryItemV1;
    return inside(root, `library/items/${safeSegment(item.id)}/v${item.version}.json`);
  }
  if (kind === 'church-week') return inside(root, `library/church-weeks/${safeSegment((value as ChurchWeekName).sourceName)}.json`);
  const component = value as DeclarativeComponentDefinition;
  return inside(root, `library/components/${safeSegment(component.type)}/v${component.version}.json`);
}

function makeRecord<T>(kind: SyncRecord<T>['kind'], recordId: string, value: T, previous?: SyncRecord<T>): SyncRecord<T> {
  return {
    format: 'bulletin-shared-record-v2',
    kind,
    recordId,
    revision: (previous?.revision ?? 0) + 1,
    baseRevision: previous?.revision ?? 0,
    updatedAt: new Date().toISOString(),
    value
  };
}

async function workspaceFile(root: string): Promise<WorkspaceFileV2> {
  return readJson<WorkspaceFileV2>(inside(root, 'workspace.json'));
}

export async function workspaceCompatibility(root: string, currentVersion: string) {
  const metadataPath = inside(root, 'workspace.json');
  if (!await exists(metadataPath)) return { currentVersion, writable: true };
  const metadata = await readJson<WorkspaceFileV2>(metadataPath);
  const writable = meetsMinimumVersion(currentVersion, metadata.minimumAppVersion);
  return {
    currentVersion,
    ...(metadata.minimumAppVersion ? { minimumAppVersion: metadata.minimumAppVersion } : {}),
    writable,
    ...(!writable ? { message: metadata.minimumAppMessage ?? `Bulletin Builder ${metadata.minimumAppVersion} or newer is required to edit this workspace.` } : {})
  };
}

export async function assertWorkspaceWritable(root: string, currentVersion: string) {
  const compatibility = await workspaceCompatibility(root, currentVersion);
  if (!compatibility.writable) throw new Error(compatibility.message);
}

export async function ensureWorkspace(root: string) {
  await Promise.all([
    'bulletins', 'templates', 'assets', 'assets/blobs', 'library/items', 'library/church-weeks',
    'library/components', 'page-templates', 'archive', 'tombstones'
  ].map(folder => mkdir(inside(root, folder), { recursive: true })));
  const legacyLibrary = inside(root, 'library.json');
  if (!await exists(legacyLibrary)) await atomicJson(legacyLibrary, { schemaVersion: 1, name: 'Lamb of God Library', items: [] } satisfies LibraryManifestV1);
  const metadataPath = inside(root, 'workspace.json');
  if (!await exists(metadataPath)) {
    await atomicJson(metadataPath, {
      schemaVersion: 2,
      name: path.basename(path.resolve(root)) || 'Bulletin workspace',
      libraryName: 'Lamb of God Library',
      createdAt: new Date().toISOString()
    } satisfies WorkspaceFileV2);
  }
  const templatePath = inside(root, `templates/${defaultTemplate.id}/v${defaultTemplate.version}.json`);
  const pageTemplatePath = inside(root, `page-templates/${defaultPageTemplate.id}/v${defaultPageTemplate.version}.json`);
  const hasActiveTemplates = (await jsonFiles(inside(root, 'templates'))).length > 0;
  const hasArchivedTemplates = (await jsonFiles(inside(root, 'archive/templates'))).length > 0;
  if (!hasActiveTemplates && !hasArchivedTemplates && !await exists(templatePath)) await atomicJson(templatePath, defaultTemplate);
  const hasActivePageTemplates = (await jsonFiles(inside(root, 'page-templates'))).length > 0;
  const hasArchivedPageTemplates = (await jsonFiles(inside(root, 'archive/page-templates'))).length > 0;
  if (!hasActivePageTemplates && !hasArchivedPageTemplates && !await exists(pageTemplatePath)) await atomicJson(pageTemplatePath, defaultPageTemplate);
  await migrateLegacyLibrary(root);
}

async function jsonFiles(folder: string): Promise<string[]> {
  try {
    const entries = await readdir(folder, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async entry => entry.isDirectory() ? jsonFiles(path.join(folder, entry.name)) : [path.join(folder, entry.name)]));
    return nested.flat().filter(file => file.endsWith('.json'));
  } catch { return []; }
}

async function migrateLegacyLibrary(root: string) {
  const metadata = await workspaceFile(root);
  const legacyPath = inside(root, 'library.json');
  const stored = await readJson<LibraryManifestV1>(legacyPath);
  const library = normalizeLibrary(stored);
  if (library !== stored) await atomicJson(legacyPath, library);
  const legacyLibraryHash = createHash('sha256').update(JSON.stringify(library)).digest('hex');
  if (metadata.migratedAt && metadata.legacyLibraryHash === legacyLibraryHash) return;
  for (const item of library.items) {
    const file = recordPath(root, 'library-item', item);
    await importLegacyRecord(file, makeRecord('library-item', itemKey(item), item));
  }
  for (const name of library.churchWeekNames ?? []) {
    const file = recordPath(root, 'church-week', name);
    await importLegacyRecord(file, makeRecord('church-week', churchWeekKey(name), name));
  }
  for (const definition of library.componentDefinitions ?? []) {
    const file = recordPath(root, 'component', definition);
    await importLegacyRecord(file, makeRecord('component', componentKey(definition), definition));
  }
  await atomicJson(inside(root, 'workspace.json'), {
    ...metadata,
    libraryName: library.name,
    migratedAt: metadata.migratedAt ?? new Date().toISOString(),
    legacyLibraryHash
  } satisfies WorkspaceFileV2);
}

async function importLegacyRecord<T>(file: string, incoming: SyncRecord<T>) {
  if (!await exists(file)) { await atomicJson(file, incoming); return; }
  const existing = await readJson<SyncRecord<T>>(file);
  if (same(existing.value, incoming.value)) return;
  const conflictFile = file.replace(/\.json$/, `.legacy-conflict-${Date.now()}-${randomUUID()}.json`);
  await atomicJson(conflictFile, incoming);
}

function conflict(kind: SharedRecordKind, recordId: string, paths: string[]): WorkspaceConflict {
  return {
    id: `${kind}:${recordId}`,
    kind,
    recordId,
    paths,
    message: `${paths.length} synchronized copies of ${recordId} differ. Choose which version to keep.`
  };
}

async function loadRecordFolder<T>(root: string, relative: string, kind: SyncRecord<T>['kind']) {
  const groups = new Map<string, Array<{ file: string; record: SyncRecord<T> }>>();
  for (const file of await jsonFiles(inside(root, relative))) {
    try {
      const record = await readJson<SyncRecord<T>>(file);
      if (record.format !== 'bulletin-shared-record-v2' || record.kind !== kind || !record.recordId) continue;
      groups.set(record.recordId, [...(groups.get(record.recordId) ?? []), { file, record }]);
    } catch { /* A syncing or invalid JSON file is ignored until the next scan. */ }
  }
  const records = new Map<string, SyncRecord<T>>();
  const conflicts: WorkspaceConflict[] = [];
  for (const [recordId, copies] of groups) {
    copies.sort((left, right) => right.record.revision - left.record.revision || right.record.updatedAt.localeCompare(left.record.updatedAt));
    const winner = copies[0].record;
    records.set(recordId, winner);
    if (copies.some(copy => !same(copy.record.value, winner.value))) {
      conflicts.push(conflict(kind, recordId, copies.map(copy => workspaceRelative(root, copy.file))));
    }
  }
  return { records, conflicts };
}

async function loadLibraryRecords(root: string): Promise<LibraryRecords> {
  const [items, churchWeeks, components, metadata] = await Promise.all([
    loadRecordFolder<LibraryItemV1>(root, 'library/items', 'library-item'),
    loadRecordFolder<ChurchWeekName>(root, 'library/church-weeks', 'church-week'),
    loadRecordFolder<DeclarativeComponentDefinition>(root, 'library/components', 'component'),
    workspaceFile(root)
  ]);
  return {
    name: metadata.libraryName,
    items: items.records,
    churchWeeks: churchWeeks.records,
    components: components.records,
    conflicts: [...items.conflicts, ...churchWeeks.conflicts, ...components.conflicts]
  };
}

function libraryManifest(records: LibraryRecords): LibraryManifestV1 {
  const items = [...records.items.values()].filter(record => !record.archivedAt).map(record => record.value);
  const churchWeekNames = [...records.churchWeeks.values()].filter(record => !record.archivedAt).map(record => record.value);
  const componentDefinitions = [...records.components.values()].filter(record => !record.archivedAt).map(record => record.value);
  return normalizeLibrary({
    schemaVersion: 1,
    name: records.name,
    items,
    ...(churchWeekNames.length ? { churchWeekNames } : {}),
    ...(componentDefinitions.length ? { componentDefinitions } : {})
  });
}

async function rawRecords<T extends { id: string }>(root: string, relative: string, kind: SharedRecordKind, accept: (file: string) => boolean, key: (value: T) => string) {
  const groups = new Map<string, Array<{ path: string; value: T }>>();
  for (const file of (await jsonFiles(inside(root, relative))).filter(accept)) {
    try {
      const value = await readJson<T>(file);
      if (!value?.id) continue;
      const recordId = key(value);
      groups.set(recordId, [...(groups.get(recordId) ?? []), { path: workspaceRelative(root, file), value }]);
    } catch { /* Ignore incomplete SharePoint downloads until a later scan. */ }
  }
  const values: Array<{ path: string; value: T }> = [];
  const conflicts: WorkspaceConflict[] = [];
  for (const [recordId, copies] of groups) {
    copies.sort((left, right) => {
      const l = left.value as T & { revision?: number; updatedAt?: string };
      const r = right.value as T & { revision?: number; updatedAt?: string };
      return (r.revision ?? 0) - (l.revision ?? 0) || (r.updatedAt ?? '').localeCompare(l.updatedAt ?? '');
    });
    values.push(copies[0]);
    if (copies.some(copy => !same(copy.value, copies[0].value))) conflicts.push(conflict(kind, recordId, copies.map(copy => copy.path)));
  }
  return { values, conflicts };
}

async function loadTombstones(root: string) {
  const result: Tombstone[] = [];
  for (const file of await jsonFiles(inside(root, 'tombstones'))) {
    try {
      const value = await readJson<Tombstone>(file);
      if (value.schemaVersion === 1 && value.originalPath) result.push({
        ...value,
        originalPath: normalizeWorkspacePath(value.originalPath)
      });
    } catch { /* Ignore incomplete synchronized tombstones. */ }
  }
  return result;
}

async function archivedRawRecords(root: string): Promise<ArchivedWorkspaceRecord[]> {
  const result: ArchivedWorkspaceRecord[] = [];
  for (const file of await jsonFiles(inside(root, 'archive'))) {
    const relative = workspaceRelative(root, file);
    const derivedOriginalPath = relative.slice('archive/'.length);
    try {
      const stored = await readJson<Record<string, unknown> | ArchivedFile>(file);
      const fileStat = await stat(file);
      const archived = stored.format === 'bulletin-archive-v1' ? stored as ArchivedFile : undefined;
      const originalPath = normalizeWorkspacePath(archived?.originalPath ?? derivedOriginalPath);
      const value = (archived?.value ?? stored) as Record<string, unknown>;
      const syncKind = value.format === 'bulletin-shared-record-v2' ? value.kind as SharedRecordKind : undefined;
      const kind: SharedRecordKind = syncKind ?? (originalPath.startsWith('bulletins/') ? 'bulletin' : originalPath.startsWith('page-templates/') ? 'page-template' : 'template');
      const displayValue = (value.value && typeof value.value === 'object' ? value.value : value) as Record<string, unknown>;
      const label = kind === 'bulletin'
        ? String((displayValue.info as { title?: string } | undefined)?.title ?? displayValue.id ?? path.basename(originalPath))
        : String(displayValue.name ?? displayValue.title ?? displayValue.sourceName ?? displayValue.id ?? path.basename(originalPath));
      result.push({ id: `archive:${relative}`, kind, label, path: relative, originalPath, archivedAt: archived?.archivedAt ?? fileStat.mtime.toISOString() });
    } catch { /* Invalid archived records remain on disk for manual recovery. */ }
  }
  return result;
}

function assetRefs(value: unknown, result: AssetRef[] = []): AssetRef[] {
  if (!value || typeof value !== 'object') return result;
  const candidate = value as Partial<AssetRef>;
  if (typeof candidate.path === 'string' && typeof candidate.mediaType === 'string') result.push(candidate as AssetRef);
  for (const nested of Object.values(value as Record<string, unknown>)) assetRefs(nested, result);
  return result;
}

export async function openWorkspace(root: string, currentVersion = '0.0.0'): Promise<WorkspaceSummary> {
  const compatibility = await workspaceCompatibility(root, currentVersion);
  if (compatibility.writable) await ensureWorkspace(root);
  const [bulletinRecords, templateRecords, pageTemplateRecords, records, archivedRaw, tombstones] = await Promise.all([
    rawRecords<BulletinDocumentV1>(
      root, 'bulletins', 'bulletin',
      file => !file.includes(`${path.sep}revisions${path.sep}`) && path.basename(file).startsWith('bulletin'),
      value => value.id
    ),
    rawRecords<TemplateV1>(root, 'templates', 'template', file => !file.includes(`${path.sep}revisions${path.sep}`), value => `${value.id}:${value.version}:${value.status}`),
    rawRecords<PageTemplateV1>(root, 'page-templates', 'page-template', file => !file.includes(`${path.sep}revisions${path.sep}`), value => `${value.id}:${value.version}:${value.status}`),
    loadLibraryRecords(root),
    archivedRawRecords(root),
    loadTombstones(root)
  ]);
  const deletedPaths = new Set(tombstones.map(item => item.originalPath));
  const deletedRecordIds = new Set(tombstones.filter(item => item.recordId).map(item => `${item.kind}:${item.recordId}`));
  for (const [key] of records.items) if (deletedRecordIds.has(`library-item:${key}`)) records.items.delete(key);
  for (const [key] of records.churchWeeks) if (deletedRecordIds.has(`church-week:${key}`)) records.churchWeeks.delete(key);
  for (const [key] of records.components) if (deletedRecordIds.has(`component:${key}`)) records.components.delete(key);
  const bulletins = bulletinRecords.values.filter(record => !deletedPaths.has(record.path)).map(record => ({ path: record.path, document: { ...record.value, blocks: normalizeCanvasBlocks(record.value.blocks) } }));
  const templates = templateRecords.values.filter(record => !deletedPaths.has(record.path)).map(record => ({ path: record.path, template: { ...record.value, starterBlocks: normalizeCanvasBlocks(record.value.starterBlocks) } }));
  const pageTemplates = pageTemplateRecords.values.filter(record => !deletedPaths.has(record.path)).map(record => ({ path: record.path, pageTemplate: { ...record.value, blocks: normalizeCanvasBlocks(record.value.blocks) } }));
  const library = libraryManifest(records);
  const refs = assetRefs({ bulletins, templates, pageTemplates, library });
  const unavailableAssets: string[] = [];
  for (const asset of refs) if (!await exists(inside(root, asset.path))) unavailableAssets.push(asset.path);
  return {
    root,
    bulletins,
    templates,
    pageTemplates,
    library,
    compatibility,
    sync: {
      schemaVersion: 2,
      lastScannedAt: new Date().toISOString(),
      conflicts: [...bulletinRecords.conflicts, ...templateRecords.conflicts, ...pageTemplateRecords.conflicts, ...records.conflicts],
      unavailableAssets: [...new Set(unavailableAssets)],
      archivedRecords: [
        ...archivedRaw,
        ...[...records.items.values()].filter(record => record.archivedAt).map(record => ({
          id: `library-item:${record.recordId}`, kind: 'library-item' as const, label: record.value.title,
          path: workspaceRelative(root, recordPath(root, 'library-item', record.value)), originalPath: workspaceRelative(root, recordPath(root, 'library-item', record.value)), archivedAt: record.archivedAt!
        })),
        ...[...records.churchWeeks.values()].filter(record => record.archivedAt).map(record => ({
          id: `church-week:${record.recordId}`, kind: 'church-week' as const, label: `${record.value.sourceName} → ${record.value.displayName}`,
          path: workspaceRelative(root, recordPath(root, 'church-week', record.value)), originalPath: workspaceRelative(root, recordPath(root, 'church-week', record.value)), archivedAt: record.archivedAt!
        })),
        ...[...records.components.values()].filter(record => record.archivedAt).map(record => ({
          id: `component:${record.recordId}`, kind: 'component' as const, label: record.value.name,
          path: workspaceRelative(root, recordPath(root, 'component', record.value)), originalPath: workspaceRelative(root, recordPath(root, 'component', record.value)), archivedAt: record.archivedAt!
        }))
      ]
    }
  };
}

export async function saveBulletin(root: string, relative: string, document: BulletinDocumentV1, expectedRevision: number) {
  const file = inside(root, relative);
  try {
    const existing = await readJson<BulletinDocumentV1>(file);
    if (existing.revision !== expectedRevision) throw new Error(`Conflict: this bulletin changed from revision ${expectedRevision} to ${existing.revision}. Reload it or save a copy.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const saved = { ...document, revision: expectedRevision + 1, updatedAt: new Date().toISOString() };
  await atomicJson(file, saved);
  return { revision: saved.revision, updatedAt: saved.updatedAt };
}

async function archiveJson(root: string, relative: string) {
  relative = normalizeWorkspacePath(relative);
  if (!relative.endsWith('.json')) throw new Error('Only JSON workspace records can be archived.');
  const source = inside(root, relative);
  if (!await exists(source)) return;
  const value = await readJson<unknown>(source);
  const destination = inside(root, path.join('archive', relative));
  await mkdir(path.dirname(destination), { recursive: true });
  const finalDestination = await exists(destination)
    ? destination.replace(/\.json$/, `-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.json`)
    : destination;
  await atomicJson(finalDestination, { format: 'bulletin-archive-v1', originalPath: relative, archivedAt: new Date().toISOString(), value } satisfies ArchivedFile);
  await unlink(source);
}

export const deleteBulletin = (root: string, relative: string) => archiveJson(root, relative);

export async function saveTemplate(root: string, template: TemplateV1, expectedUpdatedAt?: string, force = false) {
  const relative = `templates/${template.id}/v${template.version}${template.status === 'draft' ? '-draft' : ''}.json`;
  const file = inside(root, relative);
  if (await exists(file)) {
    const existing = await readJson<TemplateV1>(file);
    if (template.status === 'published' && !same(existing, template)) throw new Error(`Conflict: published template ${template.id} v${template.version} is immutable.`);
    if (!force && expectedUpdatedAt !== undefined && existing.updatedAt !== expectedUpdatedAt) {
      throw new Error(`Conflict: this template changed at ${existing.updatedAt}. Reload it or save a copy.`);
    }
    if (force && !same(existing, template)) await createTemplateRevision(root, relative, existing, 'conflict-backup');
  }
  await atomicJson(file, template);
  return relative;
}

export const deleteTemplate = (root: string, relative: string) => archiveJson(root, relative);

export async function savePageTemplate(root: string, pageTemplate: PageTemplateV1, expectedUpdatedAt?: string, force = false) {
  const relative = `page-templates/${pageTemplate.id}/v${pageTemplate.version}${pageTemplate.status === 'draft' ? '-draft' : ''}.json`;
  const file = inside(root, relative);
  if (await exists(file)) {
    const existing = await readJson<PageTemplateV1>(file);
    if (pageTemplate.status === 'published' && !same(existing, pageTemplate)) throw new Error(`Conflict: published page template ${pageTemplate.id} v${pageTemplate.version} is immutable.`);
    if (!force && expectedUpdatedAt !== undefined && existing.updatedAt !== expectedUpdatedAt) {
      throw new Error(`Conflict: this page template changed at ${existing.updatedAt}. Reload it or save a copy.`);
    }
    if (force && !same(existing, pageTemplate)) await archiveJson(root, relative);
  }
  await atomicJson(file, pageTemplate);
  return relative;
}

export const deletePageTemplate = (root: string, relative: string) => archiveJson(root, relative);

export async function restoreArchived(root: string, record: ArchivedWorkspaceRecord) {
  const source = inside(root, record.path);
  if (normalizeWorkspacePath(record.path).startsWith('archive/')) {
    const destination = inside(root, record.originalPath);
    if (await exists(destination)) throw new Error(`Conflict: ${record.originalPath} already exists. Resolve that copy before restoring.`);
    await mkdir(path.dirname(destination), { recursive: true });
    const stored = await readJson<ArchivedFile | unknown>(source);
    if (stored && typeof stored === 'object' && (stored as ArchivedFile).format === 'bulletin-archive-v1') {
      await atomicJson(destination, (stored as ArchivedFile).value);
      await unlink(source);
    } else {
      await rename(source, destination);
    }
    return;
  }
  const stored = await readJson<SyncRecord<unknown>>(source);
  const { archivedAt: _archivedAt, ...active } = stored;
  await atomicJson(source, { ...active, revision: stored.revision + 1, baseRevision: stored.revision, updatedAt: new Date().toISOString() });
}

export async function permanentlyDeleteArchived(root: string, record: ArchivedWorkspaceRecord) {
  const tombstone: Tombstone = {
    schemaVersion: 1,
    kind: record.kind,
    originalPath: record.originalPath,
    ...(!record.id.startsWith('archive:') ? { recordId: record.id.slice(record.id.indexOf(':') + 1) } : {}),
    deletedAt: new Date().toISOString()
  };
  await atomicJson(inside(root, `tombstones/${createHash('sha256').update(`${record.kind}:${record.originalPath}:${tombstone.recordId ?? ''}`).digest('hex')}.json`), tombstone);
  try { await unlink(inside(root, record.path)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

export async function resolveWorkspaceConflict(root: string, conflictRecord: WorkspaceConflict, keepPath: string) {
  if (!conflictRecord.paths.includes(keepPath)) throw new Error('The selected conflict copy is not part of this conflict.');
  for (const relative of conflictRecord.paths) if (relative !== keepPath) await archiveJson(root, relative);
}

async function writeLibraryDiff<T>(
  root: string,
  kind: SyncRecord<T>['kind'],
  current: Map<string, SyncRecord<T>>,
  previous: Map<string, T>,
  next: Map<string, T>,
  pathFor: (value: T) => string,
  force: boolean
) {
  const keys = new Set([...previous.keys(), ...next.keys()]);
  for (const key of keys) {
    const before = previous.get(key);
    const after = next.get(key);
    if (same(before, after)) continue;
    const stored = current.get(key);
    if (!force && !same(stored?.value, before)) throw new Error(`Conflict: shared record ${key} changed while you were editing it. Reload it or keep your version as a copy.`);
    if (force && stored && !same(stored.value, before)) await archiveJson(root, workspaceRelative(root, pathFor(stored.value)));
    if (!after) {
      if (stored && await exists(pathFor(stored.value))) await atomicJson(pathFor(stored.value), { ...stored, revision: stored.revision + 1, baseRevision: stored.revision, updatedAt: new Date().toISOString(), archivedAt: new Date().toISOString() });
      continue;
    }
    await atomicJson(pathFor(after), makeRecord(kind, key, after, stored));
  }
}

export async function saveLibrary(root: string, library: LibraryManifestV1, previous?: LibraryManifestV1, force = false) {
  await ensureWorkspace(root);
  const records = await loadLibraryRecords(root);
  const baseline = normalizeLibrary(previous ?? libraryManifest(records));
  const next = normalizeLibrary(library);
  await writeLibraryDiff(root, 'library-item', records.items,
    new Map(baseline.items.map(item => [itemKey(item), item])),
    new Map(next.items.map(item => [itemKey(item), item])),
    value => recordPath(root, 'library-item', value), force);
  await writeLibraryDiff(root, 'church-week', records.churchWeeks,
    new Map((baseline.churchWeekNames ?? []).map(item => [churchWeekKey(item), item])),
    new Map((next.churchWeekNames ?? []).map(item => [churchWeekKey(item), item])),
    value => recordPath(root, 'church-week', value), force);
  await writeLibraryDiff(root, 'component', records.components,
    new Map((baseline.componentDefinitions ?? []).map(item => [componentKey(item), item])),
    new Map((next.componentDefinitions ?? []).map(item => [componentKey(item), item])),
    value => recordPath(root, 'component', value), force);
  if (next.name !== records.name) {
    const metadata = await workspaceFile(root);
    await atomicJson(inside(root, 'workspace.json'), { ...metadata, libraryName: next.name });
  }
}

async function createTemplateRevision(root: string, templateRelative: string, template: TemplateV1, label: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const relative = path.join(path.dirname(templateRelative), 'revisions', `${stamp}-${label}.json`);
  await atomicJson(inside(root, relative), template);
  return relative;
}

export async function createRevision(root: string, bulletinRelative: string, document: BulletinDocumentV1, label: string) {
  const safeLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'revision';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const project = path.dirname(bulletinRelative);
  const relative = path.join(project, 'revisions', `${stamp}-${safeLabel}.json`);
  await atomicJson(inside(root, relative), document);
  return relative;
}

export async function readAssetData(root: string, relative: string) {
  const file = inside(root, relative);
  let bytes: Buffer;
  try { bytes = await readFile(file); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`Asset “${relative}” is waiting for SharePoint synchronization or is missing.`);
    throw error;
  }
  const extension = path.extname(file).toLowerCase();
  const media = extension === '.png' ? 'image/png' : extension === '.svg' ? 'image/svg+xml' : extension === '.pdf' ? 'application/pdf' : 'image/jpeg';
  return `data:${media};base64,${bytes.toString('base64')}`;
}

export { inside, atomicJson };
