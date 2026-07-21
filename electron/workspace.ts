import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BulletinDocumentV1, LibraryManifestV1, TemplateV1, WorkspaceSummary } from '../src/shared/types.js';
import { defaultTemplate } from '../src/shared/defaults.js';

function inside(root: string, relative: string) {
  const target = path.resolve(root, relative);
  const normalizedRoot = path.resolve(root) + path.sep;
  if (target !== path.resolve(root) && !target.startsWith(normalizedRoot)) throw new Error('Path leaves the selected workspace.');
  return target;
}

async function readJson<T>(file: string): Promise<T> { return JSON.parse(await readFile(file, 'utf8')) as T; }

async function atomicJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
}

export async function ensureWorkspace(root: string) {
  await Promise.all(['bulletins', 'templates', 'assets'].map(folder => mkdir(inside(root, folder), { recursive: true })));
  const libraryPath = inside(root, 'library.json');
  try { await stat(libraryPath); } catch { await atomicJson(libraryPath, { schemaVersion: 1, name: 'Lamb of God Library', items: [] } satisfies LibraryManifestV1); }
  const templatePath = inside(root, `templates/${defaultTemplate.id}/v${defaultTemplate.version}.json`);
  try { await stat(templatePath); } catch { await atomicJson(templatePath, defaultTemplate); }
}

async function jsonFiles(folder: string): Promise<string[]> {
  try {
    const entries = await readdir(folder, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async entry => entry.isDirectory() ? jsonFiles(path.join(folder, entry.name)) : [path.join(folder, entry.name)]));
    return nested.flat().filter(file => file.endsWith('.json'));
  } catch { return []; }
}

export async function openWorkspace(root: string): Promise<WorkspaceSummary> {
  await ensureWorkspace(root);
  const bulletinFiles = await jsonFiles(inside(root, 'bulletins'));
  const templateFiles = await jsonFiles(inside(root, 'templates'));
  const bulletins = await Promise.all(bulletinFiles.map(async file => ({ path: path.relative(root, file), document: await readJson<BulletinDocumentV1>(file) })));
  const templates = await Promise.all(templateFiles.map(async file => ({ path: path.relative(root, file), template: await readJson<TemplateV1>(file) })));
  const library = await readJson<LibraryManifestV1>(inside(root, 'library.json'));
  return { root, bulletins, templates, library };
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

export async function saveTemplate(root: string, template: TemplateV1) {
  const relative = `templates/${template.id}/v${template.version}${template.status === 'draft' ? '-draft' : ''}.json`;
  await atomicJson(inside(root, relative), { ...template, updatedAt: new Date().toISOString() });
  return relative;
}

export async function saveLibrary(root: string, library: LibraryManifestV1) {
  await atomicJson(inside(root, 'library.json'), library);
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
  const bytes = await readFile(file);
  const extension = path.extname(file).toLowerCase();
  const media = extension === '.png' ? 'image/png' : extension === '.svg' ? 'image/svg+xml' : extension === '.pdf' ? 'application/pdf' : 'image/jpeg';
  return `data:${media};base64,${bytes.toString('base64')}`;
}

export { inside, atomicJson };
