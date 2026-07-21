import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
});
