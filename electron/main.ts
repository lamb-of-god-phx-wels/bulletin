import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import type { BulletinDocumentV1, BulletinApi, ScriptureBlock } from '../src/shared/types.js';
import { paginate } from '../src/shared/pagination.js';
import { validateBulletin } from '../src/shared/validation.js';
import { createRevision, inside, openWorkspace, readAssetData, saveBulletin, saveLibrary, saveTemplate } from './workspace.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | undefined;
let printJob: { root: string; document: BulletinDocumentV1 } | undefined;
let printReady: (() => void) | undefined;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1050, minHeight: 700,
    backgroundColor: '#f4f1e9',
    webPreferences: { preload: path.join(dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  if (!app.isPackaged) void mainWindow.loadURL('http://localhost:5173');
  else void mainWindow.loadFile(path.join(dirname, '../../dist/index.html'));
}

app.whenReady().then(() => { app.on('session-created', session => session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))); registerIpc(); createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });

function registerIpc() {
  ipcMain.handle('workspace:choose', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], title: 'Choose the synced bulletin workspace' });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('workspace:open', (_event, root: string) => openWorkspace(root));
  ipcMain.handle('bulletin:save', (_event, ...args: Parameters<BulletinApi['saveBulletin']>) => saveBulletin(...args));
  ipcMain.handle('template:save', (_event, ...args: Parameters<BulletinApi['saveTemplate']>) => saveTemplate(...args));
  ipcMain.handle('library:save', (_event, ...args: Parameters<BulletinApi['saveLibrary']>) => saveLibrary(...args));
  ipcMain.handle('revision:create', (_event, ...args: Parameters<BulletinApi['createRevision']>) => createRevision(...args));
  ipcMain.handle('asset:read', (_event, root: string, relative: string) => readAssetData(root, relative));
  ipcMain.handle('asset:import', async (_event, root: string, targetFolder: string) => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Page assets', extensions: ['png', 'jpg', 'jpeg', 'svg', 'pdf'] }] });
    if (result.canceled) return null;
    const source = result.filePaths[0];
    const folder = inside(root, targetFolder); await mkdir(folder, { recursive: true });
    const destination = path.join(folder, path.basename(source)); await copyFile(source, destination);
    const extension = path.extname(source).toLowerCase();
    const mediaType = extension === '.png' ? 'image/png' : extension === '.svg' ? 'image/svg+xml' : extension === '.pdf' ? 'application/pdf' : 'image/jpeg';
    return { path: path.relative(root, destination), mediaType, alt: path.basename(source) };
  });
  ipcMain.handle('scripture:lookup', (_event, input: Parameters<BulletinApi['lookupScripture']>[0]) => lookupScripture(input));
  ipcMain.handle('print:job', () => printJob);
  ipcMain.on('print:ready', () => printReady?.());
  ipcMain.handle('pdf:export', (_event, root: string, relative: string, document: BulletinDocumentV1) => exportPdf(root, relative, document));
}

async function exportPdf(root: string, relative: string, document: BulletinDocumentV1) {
  const workspace = await openWorkspace(root);
  const issues = validateBulletin(document, workspace.library);
  if (issues.length) throw new Error(`${issues[0].path}: ${issues[0].message}`);
  const referencedAssets = document.blocks.flatMap(block => {
    const assets = 'asset' in block && block.asset ? [block.asset] : [];
    if ('libraryItemId' in block) assets.push(...(workspace.library?.items.filter(item => item.id === block.libraryItemId && (!block.libraryItemVersion || item.version === block.libraryItemVersion)).sort((a, b) => b.version - a.version)[0]?.assets ?? []));
    return assets;
  });
  await Promise.all(referencedAssets.map(asset => readFile(inside(root, asset.path))));
  const suggested = `${document.info.date} ${document.info.title}.pdf`.replace(/[<>:"/\\|?*]/g, '-');
  const choice = await dialog.showSaveDialog({ title: 'Export bulletin PDF', defaultPath: inside(root, path.join(path.dirname(relative), 'exports', suggested)), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (choice.canceled || !choice.filePath) return null;
  printJob = { root, document };
  const printWindow = new BrowserWindow({ show: false, webPreferences: { preload: path.join(dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  try {
    const loaded = new Promise<void>(resolve => { printReady = resolve; });
    if (!app.isPackaged) await printWindow.loadURL('http://localhost:5173?print=1');
    else await printWindow.loadFile(path.join(dirname, '../../dist/index.html'), { query: { print: '1' } });
    await Promise.race([loaded, new Promise<void>((_, reject) => setTimeout(() => reject(new Error('Print preview timed out.')), 15000))]);
    const raw = await printWindow.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { marginType: 'none' } });
    const merged = await replacePdfPages(raw, root, document);
    await mkdir(path.dirname(choice.filePath), { recursive: true });
    await writeFile(choice.filePath, merged);
    await createRevision(root, relative, document, 'export');
    return choice.filePath;
  } finally {
    printWindow.destroy(); printReady = undefined; printJob = undefined;
  }
}

async function replacePdfPages(raw: Buffer, root: string, document: BulletinDocumentV1) {
  const output = await PDFDocument.load(raw);
  // Replacement runs from the back so earlier page indexes remain stable.
  const workspace = await openWorkspace(root);
  const pages = paginate(document.blocks, workspace.templates.find(t => t.template.id === document.template.id && t.template.version === document.template.version)?.template ?? (await import('../src/shared/defaults.js')).defaultTemplate, workspace.library);
  for (let index = pages.length - 1; index >= 0; index--) {
    const block = pages[index].blocks[0];
    if (!block || (block.type !== 'fullPageAsset' && block.type !== 'titlePage') || !block.asset || block.asset.mediaType !== 'application/pdf') continue;
    const source = await PDFDocument.load(await readFile(inside(root, block.asset.path)));
    const sourceIndex = Math.max(0, (block.asset.page ?? 1) - 1);
    const embedded = await output.embedPage(source.getPage(sourceIndex));
    const scale = Math.min(504 / embedded.width, 612 / embedded.height);
    output.removePage(index);
    const page = output.insertPage(index, [504, 612]);
    page.drawPage(embedded, { x: (504 - embedded.width * scale) / 2, y: (612 - embedded.height * scale) / 2, width: embedded.width * scale, height: embedded.height * scale });
  }
  return Buffer.from(await output.save());
}

async function lookupScripture(input: { reference: string; translation: string; username?: string; password?: string }): Promise<ScriptureBlock['resolved']> {
  if (!input.username || !input.password) throw new Error('Bible Gateway credentials are not configured. Paste the passage text instead.');
  const tokenUrl = new URL('https://api.biblegateway.com/2/request_access_token');
  tokenUrl.searchParams.set('username', input.username); tokenUrl.searchParams.set('password', input.password);
  const tokenResponse = await fetch(tokenUrl);
  if (!tokenResponse.ok) throw new Error(`Bible Gateway authorization failed (${tokenResponse.status}).`);
  const tokenData = await tokenResponse.json() as { access_token?: string; error?: { errmsg?: string } };
  if (!tokenData.access_token) throw new Error(tokenData.error?.errmsg ?? 'Bible Gateway did not return an access token.');
  const lookup = new URL(`https://api.biblegateway.com/2/bible/${encodeURIComponent(input.reference)}/${encodeURIComponent(input.translation.toLowerCase())}`);
  lookup.searchParams.set('access_token', tokenData.access_token); lookup.searchParams.set('objects', 'data,attribution');
  const response = await fetch(lookup);
  if (!response.ok) throw new Error(`Bible Gateway lookup failed (${response.status}).`);
  const payload = await response.json() as any;
  const entry = Array.isArray(payload) ? payload[0] : payload;
  const html = entry?.data?.content ?? entry?.content ?? '';
  const text = String(html).replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
  if (!text) throw new Error('Bible Gateway returned no passage text.');
  return { content: text.split(/\n+/).map(line => ({ type: 'paragraph', children: [{ type: 'text', text: line }] })), source: 'bible-gateway', retrievedAt: new Date().toISOString(), attribution: entry?.attribution?.text ?? `${input.translation.toUpperCase()} via Bible Gateway` };
}
