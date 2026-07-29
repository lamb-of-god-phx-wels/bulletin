import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createBulletin, defaultTemplate } from '../src/shared/defaults';
import {
  assertWorkspaceWritable, createRevision, deleteBulletin, deleteTemplate, openWorkspace, permanentlyDeleteArchived,
  resolveWorkspaceConflict, restoreArchived, saveBulletin, saveLibrary, saveTemplate
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
    expect(JSON.parse(await readFile(join(root, revision), 'utf8')).info.date).toBe('2026-06-07');
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
    await saveLibrary(root, {
      ...secondView.library!,
      churchWeekNames: [{ sourceName: 'Proper 12', displayName: 'Ninth Sunday after Pentecost' }]
    }, secondView.library);
    const merged = await openWorkspace(root);
    expect(merged.library?.items).toContainEqual(song);
    expect(merged.library?.churchWeekNames).toEqual([{ sourceName: 'Proper 12', displayName: 'Ninth Sunday after Pentecost' }]);
    expect((await readdir(join(root, 'library', 'items'))).length).toBe(1);
  });

  it('rejects stale edits to the same church-week override', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bulletin-workspace-')); roots.push(root);
    const initial = await openWorkspace(root);
    const withOverride = { ...initial.library!, churchWeekNames: [{ sourceName: 'Proper 12', displayName: 'Pentecost 9' }] };
    await saveLibrary(root, withOverride, initial.library);
    const left = await openWorkspace(root);
    const right = await openWorkspace(root);
    await saveLibrary(root, { ...left.library!, churchWeekNames: [{ sourceName: 'Proper 12', displayName: 'Ninth Sunday after Pentecost' }] }, left.library);
    await expect(saveLibrary(root, { ...right.library!, churchWeekNames: [{ sourceName: 'Proper 12', displayName: 'Summer Sunday' }] }, right.library)).rejects.toThrow(/Conflict/);
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
    await restoreArchived(root, archived);
    expect((await openWorkspace(root)).bulletins).toHaveLength(1);
    await deleteBulletin(root, relative);
    workspace = await openWorkspace(root);
    await permanentlyDeleteArchived(root, workspace.sync!.archivedRecords.find(item => item.kind === 'bulletin')!);
    await writeFile(join(root, relative), JSON.stringify({ ...document, revision: 1 }));
    expect((await openWorkspace(root)).bulletins).toHaveLength(0);
  });
});
