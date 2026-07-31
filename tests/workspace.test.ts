import { cp, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createBulletin, defaultPageTemplate, defaultTemplate } from '../src/shared/defaults';
import {
  assertWorkspaceWritable, createRevision, deleteBulletin, deletePageTemplate, deleteTemplate, openWorkspace, permanentlyDeleteArchived,
  resolveWorkspaceConflict, restoreArchived, saveBulletin, saveLibrary, savePageTemplate, saveTemplate, trashLibraryImages, trashLibraryRecords
} from '../electron/workspace';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));

describe('shared workspace', () => {
  it('initializes a readable workspace and writes revisions atomically', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bulletin-workspace-')); roots.push(root);
    const workspace = await openWorkspace(root);
    expect(workspace.templates[0].template.id).toBe('lamb-of-god-weekly');
    const document = createBulletin(defaultTemplate, '2026-06-07');
    const relative = 'bulletins/2026-06-07/bulletin.json';
    const saved = await saveBulletin(root, relative, document, 0);
    expect(saved.revision).toBe(1);
    const revision = await createRevision(root, relative, { ...document, revision: 1 }, 'Sunday export');
    expect(JSON.parse(await readFile(join(root, revision), 'utf8'))).toMatchObject({
      info: { date: '2026-06-07' },
      revisionMetadata: { bulletinPath: relative, label: 'Sunday export' }
    });
    const reopened = await openWorkspace(root);
    expect(reopened.revisions).toEqual([expect.objectContaining({
      path: revision.replaceAll('\\', '/'),
      bulletinPath: relative,
      label: 'Sunday export',
      document: expect.objectContaining({ revision: 1 })
    })]);
  });

  it('opens a workspace read-only when the app is older than its minimum version', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bulletin-workspace-')); roots.push(root);
    await openWorkspace(root, '0.2.0');
    const metadataPath = join(root, 'workspace.json');
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    await writeFile(metadataPath, JSON.stringify({
      ...metadata,
      minimumAppVersion: '2.0.0',
      minimumAppMessage: 'Install the workspace migration release first.'
    }, null, 2));
    const before = await readFile(metadataPath, 'utf8');

    const workspace = await openWorkspace(root, '1.9.9');

    expect(workspace.compatibility).toEqual({
      currentVersion: '1.9.9',
      minimumAppVersion: '2.0.0',
      writable: false,
      message: 'Install the workspace migration release first.'
    });
    await expect(assertWorkspaceWritable(root, '1.9.9')).rejects.toThrow(/migration release/);
    expect(await readFile(metadataPath, 'utf8')).toBe(before);
    await expect(assertWorkspaceWritable(root, '2.0.0')).resolves.toBeUndefined();
  });

  it('refuses to overwrite an externally changed revision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bulletin-workspace-')); roots.push(root);
    const document = createBulletin(defaultTemplate, '2026-06-07');
    const relative = 'bulletins/2026-06-07/bulletin.json';
    await saveBulletin(root, relative, document, 0);
    await expect(saveBulletin(root, relative, document, 0)).rejects.toThrow(/Conflict/);
  });

  it('deletes bulletin and template JSON records', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bulletin-workspace-')); roots.push(root);
    await openWorkspace(root);
    const document = createBulletin(defaultTemplate, '2026-06-07');
    const bulletinPath = 'bulletins/2026-06-07/bulletin.json';
    await saveBulletin(root, bulletinPath, document, 0);
    const templatePath = await saveTemplate(root, { ...defaultTemplate, version: 2, status: 'draft' });
    await deleteBulletin(root, bulletinPath);
    await deleteTemplate(root, templatePath);
    const workspace = await openWorkspace(root);
    expect(workspace.bulletins).toHaveLength(0);
    expect(workspace.templates.some(item => item.path === templatePath)).toBe(false);
  });

  it('persists separate template families and versions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bulletin-workspace-')); roots.push(root);
    await openWorkspace(root);
    await saveTemplate(root, { ...defaultTemplate, id: 'festival-service', name: 'Festival Service', version: 1, status: 'draft' });
    await saveTemplate(root, { ...defaultTemplate, id: 'festival-service', name: 'Festival Service', version: 2, status: 'published' });
    const workspace = await openWorkspace(root);
    expect(workspace.templates.filter(item => item.template.id === 'festival-service').map(item => item.template.version).sort()).toEqual([1, 2]);
    expect(new Set(workspace.templates.map(item => item.template.id))).toEqual(new Set(['lamb-of-god-weekly', 'festival-service']));
  });

  it('persists, versions, and archives synchronized page templates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bulletin-workspace-')); roots.push(root);
    await openWorkspace(root);
    const draft = { ...structuredClone(defaultPageTemplate), id: 'festival-cover', name: 'Festival Cover', status: 'draft' as const };
    const draftPath = await savePageTemplate(root, draft);
    const published = { ...draft, version: 2, status: 'published' as const, updatedAt: new Date().toISOString() };
    await savePageTemplate(root, published);
    let workspace = await openWorkspace(root);
    expect(workspace.pageTemplates.filter(record => record.pageTemplate.id === 'festival-cover').map(record => record.pageTemplate.version).sort()).toEqual([1, 2]);
    await deletePageTemplate(root, draftPath);
    workspace = await openWorkspace(root);
    expect(workspace.pageTemplates.some(record => record.path === draftPath)).toBe(false);
    expect(workspace.sync?.archivedRecords.some(record => record.kind === 'page-template')).toBe(true);
  });

  it('persists the legacy music-to-song library migration when opening', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bulletin-workspace-')); roots.push(root);
    await openWorkspace(root);
    await writeFile(join(root, 'library.json'), JSON.stringify({ schemaVersion: 1, name: 'Legacy', items: [
      { id: 'anthem', version: 1, kind: 'song', title: 'Anthem', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Lyrics' }] }] },
      { id: 'anthem', version: 1, kind: 'music', title: 'Anthem music', assets: [{ path: 'assets/anthem.pdf', mediaType: 'application/pdf' }] }
    ] }));
    const workspace = await openWorkspace(root);
    expect(workspace.library?.items).toHaveLength(1);
    expect(workspace.library?.items[0]).toMatchObject({ kind: 'song', content: [{ children: [{ text: 'Lyrics' }] }], assets: [{ path: 'assets/anthem.pdf' }] });
    expect(await readFile(join(root, 'library.json'), 'utf8')).not.toContain('"music"');
  });

  it('stores library records independently and preserves unrelated concurrent additions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bulletin-workspace-')); roots.push(root);
    const firstView = await openWorkspace(root);
    const secondView = await openWorkspace(root);
    const song = { id: 'shared-song', version: 1, kind: 'song' as const, title: 'Shared Song' };
    await saveLibrary(root, { ...firstView.library!, items: [song] }, firstView.library);
    const localEvent = { id: 'church-anniversary', name: 'Church Anniversary', enabled: true, priority: 80, rules: [{ kind: 'annualDate' as const, month: 8, day: 15 }] };
    await saveLibrary(root, { ...secondView.library!, calendarEvents: [...secondView.library!.calendarEvents!, localEvent] }, secondView.library);
    const merged = await openWorkspace(root);
    expect(merged.library?.items).toContainEqual(song);
    expect(merged.library?.calendarEvents).toContainEqual(localEvent);
    expect((await readdir(join(root, 'library', 'items'))).length).toBe(1);
  });

  it('synchronizes image folders and catalog entries independently', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bulletin-workspace-')); roots.push(root);
    const initial = await openWorkspace(root);
    const library = {
      ...initial.library!,
      folders: [{ id: 'seasonal', name: 'Seasonal' }, { id: 'advent', name: 'Advent', parentId: 'seasonal' }],
      catalog: [{ targetKind: 'library-item' as const, targetId: 'banner', folderId: 'advent', displayName: 'Advent banner' }]
    };
    library.items = [...library.items, {
      id: 'banner', version: 1, kind: 'image' as const, title: 'Banner',
      assets: [{ path: 'assets/blobs/banner.png', mediaType: 'image/png' as const }]
    }];
    await saveLibrary(root, library, initial.library);
    const reopened = await openWorkspace(root);
    expect(reopened.library?.folders).toEqual(expect.arrayContaining(library.folders));
    expect(reopened.library?.catalog).toEqual(library.catalog);
    expect((await readdir(join(root, 'library', 'image-folders'))).length).toBe(2);
    expect((await readdir(join(root, 'library', 'image-catalog'))).length).toBe(1);
  });

  it('trashes and restores an image folder tree as one entry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bulletin-workspace-')); roots.push(root);
    const initial = await openWorkspace(root);
    const library = {
      ...initial.library!,
      items: [...initial.library!.items, { id: 'banner', version: 1, kind: 'image' as const, title: 'Banner', assets: [{ path: 'assets/blobs/banner.png', mediaType: 'image/png' as const }] }],
      folders: [{ id: 'seasonal', name: 'Seasonal' }, { id: 'advent', name: 'Advent', parentId: 'seasonal' }],
      catalog: [{ targetKind: 'library-item' as const, targetId: 'banner', folderId: 'advent', displayName: 'Advent banner' }]
    };
    await saveLibrary(root, library, initial.library);
    const active = await trashLibraryImages(root, ['seasonal', 'advent'], ['banner'], library);
    expect(active.items.some(item => item.id === 'banner')).toBe(false);
    const trashed = await openWorkspace(root);
    const bundle = trashed.sync?.archivedRecords.filter(record => record.kind === 'image-folder');
    expect(bundle).toHaveLength(1);
    expect(bundle?.[0].label).toBe('Seasonal');
    await restoreArchived(root, bundle![0]);
    const restored = await openWorkspace(root);
    expect(restored.library?.items.some(item => item.id === 'banner')).toBe(true);
    expect(restored.library?.folders).toEqual(expect.arrayContaining(library.folders));
    expect(restored.sync?.archivedRecords.filter(record => record.kind === 'image-folder')).toEqual([]);
  });

  it('trashes and restores a mixed reusable folder tree as one entry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bulletin-workspace-')); roots.push(root);
    const initial = await openWorkspace(root);
    const page = { ...defaultPageTemplate, id: 'festival-page', name: 'Festival page', version: 1, status: 'published' as const };
    await savePageTemplate(root, page);
    const library = {
      ...initial.library!,
      items: [...initial.library!.items, { id: 'festival-song', version: 1, kind: 'song' as const, title: 'Festival Song' }],
      folders: [{ id: 'festival', name: 'Festival' }, { id: 'easter', name: 'Easter', parentId: 'festival' }],
      catalog: [
        { targetKind: 'library-item' as const, targetId: 'festival-song', folderId: 'easter' },
        { targetKind: 'page-template' as const, targetId: 'festival-page', folderId: 'easter' }
      ]
    };
    await saveLibrary(root, library, initial.library);
    const active = await trashLibraryRecords(root, { folderIds: ['festival'], records: [] }, library);
    expect(active.library.items.some(item => item.id === 'festival-song')).toBe(false);
    expect(active.pageTemplateIds).toEqual(['festival-page']);
    const trashed = await openWorkspace(root);
    expect(trashed.pageTemplates.some(record => record.pageTemplate.id === 'festival-page')).toBe(false);
    const bundle = trashed.sync?.archivedRecords.filter(record => record.kind === 'library-folder');
    expect(bundle).toHaveLength(1);
    expect(bundle?.[0].label).toBe('Festival');
    await restoreArchived(root, bundle![0]);
    const restored = await openWorkspace(root);
    expect(restored.library?.items.some(item => item.id === 'festival-song')).toBe(true);
    expect(restored.library?.folders?.map(folder => folder.id)).toEqual(expect.arrayContaining(['festival', 'easter']));
    expect(restored.pageTemplates.some(record => record.pageTemplate.id === 'festival-page')).toBe(true);
  });

  it('rejects stale edits to the same calendar event', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bulletin-workspace-')); roots.push(root);
    const initial = await openWorkspace(root);
    const left = await openWorkspace(root);
    const right = await openWorkspace(root);
    const rename = (library: NonNullable<typeof initial.library>, name: string) => ({
      ...library,
      calendarEvents: library.calendarEvents!.map(event => event.id === 'proper-12' ? { ...event, name } : event)
    });
    await saveLibrary(root, rename(left.library!, 'Ninth Sunday after Pentecost'), left.library);
    await expect(saveLibrary(root, rename(right.library!, 'Summer Sunday'), right.library)).rejects.toThrow(/Conflict/);
  });

  it('seeds WELS events once and migrates old display names into synchronized calendar records', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bulletin-workspace-')); roots.push(root);
    await writeFile(join(root, 'library.json'), JSON.stringify({
      schemaVersion: 1,
      name: 'Legacy church',
      items: [],
      churchWeekNames: [{ sourceName: 'Proper 12', displayName: 'Ninth Sunday after Pentecost' }]
    }));

    const workspace = await openWorkspace(root);

    expect(workspace.library?.calendarEvents?.find(event => event.id === 'proper-12')?.name).toBe('Ninth Sunday after Pentecost');
    expect(workspace.library?.churchWeekNames).toBeUndefined();
    expect(workspace.sync?.archivedRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'church-week', label: 'Proper 12 → Ninth Sunday after Pentecost' })
    ]));
    expect((await readdir(join(root, 'library', 'calendar-events'))).length).toBeGreaterThan(40);
  });

  it('upgrades untouched version-one calendar presets while preserving church-owned records', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bulletin-workspace-')); roots.push(root);
    await openWorkspace(root);
    const calendarFolder = join(root, 'library', 'calendar-events');
    for (const file of await readdir(calendarFolder)) {
      const fullPath = join(calendarFolder, file);
      const record = JSON.parse(await readFile(fullPath, 'utf8'));
      if (record.value.id === 'proper-5') {
        record.value = {
          id: 'proper-5',
          name: 'Church-owned Pentecost name',
          enabled: true,
          priority: 40,
          rules: [{ kind: 'weekdayOnOrAfter', month: 6, day: 5, weekday: 0 }],
          aliases: ['Pentecost 4']
        };
        await writeFile(fullPath, JSON.stringify(record));
      }
      if (record.value.id === 'last-sunday-church-year') await unlink(fullPath);
    }
    const metadataPath = join(root, 'workspace.json');
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    await writeFile(metadataPath, JSON.stringify({ ...metadata, churchCalendarSeedVersion: 1 }));

    const upgraded = await openWorkspace(root);

    expect(upgraded.library?.calendarEvents?.find(event => event.id === 'proper-5')).toMatchObject({
      name: 'Church-owned Pentecost name',
      rules: [expect.objectContaining({ kind: 'weekdayInDateRange' })]
    });
    expect(upgraded.library?.calendarEvents?.some(event => event.id === 'last-sunday-church-year')).toBe(true);
    expect(JSON.parse(await readFile(metadataPath, 'utf8')).churchCalendarSeedVersion).toBe(2);
  });

  it('detects synchronized conflict copies and can retain one copy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bulletin-workspace-')); roots.push(root);
    const initial = await openWorkspace(root);
    const song = { id: 'conflicted-song', version: 1, kind: 'song' as const, title: 'Original' };
    await saveLibrary(root, { ...initial.library!, items: [song] }, initial.library);
    const family = (await readdir(join(root, 'library', 'items')))[0];
    const folder = join(root, 'library', 'items', family);
    const canonical = join(folder, 'v1.json');
    const copy = join(folder, 'v1-Taylor-PC-conflicted-copy.json');
    await cp(canonical, copy);
    const copiedRecord = JSON.parse(await readFile(copy, 'utf8'));
    copiedRecord.value.title = 'Conflicting copy';
    await writeFile(copy, JSON.stringify(copiedRecord));
    const conflicted = await openWorkspace(root);
    expect(conflicted.sync?.conflicts).toHaveLength(1);
    const syncConflict = conflicted.sync!.conflicts[0];
    const keepPath = syncConflict.paths.find(item => item.includes('conflicted-copy'))!;
    await resolveWorkspaceConflict(root, syncConflict, keepPath);
    expect((await openWorkspace(root)).sync?.conflicts).toHaveLength(0);
  });

  it('archives, restores, and permanently tombstones shared records', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bulletin-workspace-')); roots.push(root);
    const document = createBulletin(defaultTemplate, '2026-06-07');
    const relative = 'bulletins/2026-06-07/bulletin.json';
    await saveBulletin(root, relative, document, 0);
    await deleteBulletin(root, relative);
    let workspace = await openWorkspace(root);
    const archived = workspace.sync!.archivedRecords.find(item => item.kind === 'bulletin')!;
    expect(workspace.bulletins).toHaveLength(0);
    expect(archived).toMatchObject({
      path: 'archive/bulletins/2026-06-07/bulletin.json',
      originalPath: 'bulletins/2026-06-07/bulletin.json'
    });
    await restoreArchived(root, archived);
    expect((await openWorkspace(root)).bulletins).toHaveLength(1);
    await deleteBulletin(root, relative);
    workspace = await openWorkspace(root);
    await permanentlyDeleteArchived(root, workspace.sync!.archivedRecords.find(item => item.kind === 'bulletin')!);
    await writeFile(join(root, relative), JSON.stringify({ ...document, revision: 1 }));
    expect((await openWorkspace(root)).bulletins).toHaveLength(0);
  });
});
