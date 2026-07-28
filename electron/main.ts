import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { PDFDocument, clip, endPath, popGraphicsState, pushGraphicsState, rectangle } from 'pdf-lib';
import type { BulletinDocumentV1, BulletinApi } from '../src/shared/types.js';
import { paginate } from '../src/shared/pagination.js';
import { createRevision, deleteBulletin, deleteTemplate, inside, openWorkspace, readAssetData, saveBulletin, saveLibrary, saveTemplate } from './workspace.js';
import { lookupBibleGatewayWeb } from './bibleGatewayScraper.js';
import { templateForBulletin } from '../src/shared/documentLayout.js';
import { canvasAssetRefs, canvasSpace, effectiveCanvasScene } from '../src/shared/canvas.js';
import { copyAssetWithoutOverwrite } from './assets.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | undefined;
let printJob: { root: string; document: BulletinDocumentV1 } | undefined;
let printReady: (() => void) | undefined;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1050, minHeight: 700,
    backgroundColor: '#f4f1e9',
    webPreferences: { preload: path.join(dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
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
  ipcMain.handle('bulletin:delete', (_event, ...args: Parameters<BulletinApi['deleteBulletin']>) => deleteBulletin(...args));
  ipcMain.handle('template:save', (_event, ...args: Parameters<BulletinApi['saveTemplate']>) => saveTemplate(...args));
  ipcMain.handle('template:delete', (_event, ...args: Parameters<BulletinApi['deleteTemplate']>) => deleteTemplate(...args));
  ipcMain.handle('library:save', (_event, ...args: Parameters<BulletinApi['saveLibrary']>) => saveLibrary(...args));
  ipcMain.handle('revision:create', (_event, ...args: Parameters<BulletinApi['createRevision']>) => createRevision(...args));
  ipcMain.handle('asset:read', (_event, root: string, relative: string) => readAssetData(root, relative));
  ipcMain.handle('asset:import', async (_event, root: string, targetFolder: string) => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Page assets', extensions: ['png', 'jpg', 'jpeg', 'svg', 'pdf'] }] });
    if (result.canceled) return null;
    const source = result.filePaths[0];
    const folder = inside(root, targetFolder); await mkdir(folder, { recursive: true });
    const destination = await copyAssetWithoutOverwrite(source, folder);
    const extension = path.extname(source).toLowerCase();
    const mediaType = extension === '.png' ? 'image/png' : extension === '.svg' ? 'image/svg+xml' : extension === '.pdf' ? 'application/pdf' : 'image/jpeg';
    return { path: path.relative(root, destination), mediaType, alt: path.basename(source) };
  });
  ipcMain.handle('scripture:lookup', (_event, input: Parameters<BulletinApi['lookupScripture']>[0]) => lookupBibleGatewayWeb(input));
  ipcMain.handle('scripture:open', async (_event, reference: string, translation: string) => {
    const url = new URL('https://www.biblegateway.com/passage/');
    url.searchParams.set('search', reference); url.searchParams.set('version', translation.toUpperCase());
    await shell.openExternal(url.toString());
  });
  ipcMain.handle('print:job', () => printJob);
  ipcMain.on('print:ready', () => printReady?.());
  ipcMain.handle('pdf:export', (_event, root: string, relative: string, document: BulletinDocumentV1) => exportPdf(root, relative, document));
}

async function exportPdf(root: string, relative: string, document: BulletinDocumentV1) {
  const workspace = await openWorkspace(root);
  const referencedAssets = document.blocks.flatMap(block => {
    const assets = 'asset' in block && block.asset ? [block.asset] : [];
    if (block.type === 'canvasCover') assets.push(...canvasAssetRefs(effectiveCanvasScene(block)));
    if ('libraryItemId' in block) assets.push(...(workspace.library?.items.filter(item => item.id === block.libraryItemId && (!block.libraryItemVersion || item.version === block.libraryItemVersion)).sort((a, b) => b.version - a.version)[0]?.assets ?? []));
    return assets;
  });
  await Promise.all(referencedAssets.map(asset => readFile(inside(root, asset.path))));
  const suggested = `${document.info.date} ${document.info.title}.pdf`.replace(/[<>:"/\\|?*]/g, '-');
  const options = { title: 'Export bulletin PDF', defaultPath: inside(root, path.join(path.dirname(relative), 'exports', suggested)), filters: [{ name: 'PDF', extensions: ['pdf'] }] };
  const choice = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
  if (choice.canceled || !choice.filePath) return null;
  printJob = { root, document };
  const printWindow = new BrowserWindow({ show: false, webPreferences: { preload: path.join(dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
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
  const chromium = await PDFDocument.load(raw);
  // Replacement runs from the back so earlier page indexes remain stable.
  const workspace = await openWorkspace(root);
  const storedTemplate = workspace.templates.find(t => t.template.id === document.template.id && t.template.version === document.template.version)?.template ?? (await import('../src/shared/defaults.js')).defaultTemplate;
  const pages = paginate(document.blocks, templateForBulletin(storedTemplate, document), workspace.library);
  for (let index = pages.length - 1; index >= 0; index--) {
    const block = pages[index].blocks[0];
    if (block?.type === 'canvasCover') {
      const scene = effectiveCanvasScene(block);
      const background = scene.background?.asset;
      if (background?.mediaType === 'application/pdf') {
        const source = await PDFDocument.load(await readFile(inside(root, background.path)));
        const sourceIndex = Math.max(0, Math.min(source.getPageCount() - 1, (background.page ?? 1) - 1));
        const embeddedBackground = await output.embedPage(source.getPage(sourceIndex));
        const embeddedOverlay = await output.embedPage(chromium.getPage(index));
        const margin = document.layout?.marginIn ?? storedTemplate.theme.marginIn;
        const space = canvasSpace(scene, margin);
        const box = { x: space.x * 72, y: 612 - (space.y + space.height) * 72, width: space.width * 72, height: space.height * 72 };
        const fit = scene.background?.fit ?? 'cover';
        const scaleX = box.width / embeddedBackground.width;
        const scaleY = box.height / embeddedBackground.height;
        const scale = fit === 'fill' ? undefined : fit === 'contain' ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY);
        const width = scale === undefined ? box.width : embeddedBackground.width * scale;
        const height = scale === undefined ? box.height : embeddedBackground.height * scale;
        output.removePage(index);
        const page = output.insertPage(index, [504, 612]);
        page.pushOperators(pushGraphicsState(), rectangle(box.x, box.y, box.width, box.height), clip(), endPath());
        page.drawPage(embeddedBackground, { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height });
        page.pushOperators(popGraphicsState());
        page.drawPage(embeddedOverlay, { x: 0, y: 0, width: 504, height: 612 });
      }
      continue;
    }
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
