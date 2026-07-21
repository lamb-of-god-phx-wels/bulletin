import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createBulletin, defaultTemplate } from '../src/shared/defaults';
import { createRevision, deleteBulletin, deleteTemplate, openWorkspace, saveBulletin, saveTemplate } from '../electron/workspace';

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
});
