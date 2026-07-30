import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { PDFDocument, clip, endPath, popGraphicsState, pushGraphicsState, rectangle, rgb } from 'pdf-lib';
import type { AppUpdateStatus, BulletinBlock, BulletinDocumentV1, BulletinApi, CanvasBlock, EditingState, LibraryManifestV1, TemplateV1 } from '../src/shared/types.js';
import { estimateBlockPoints, paginate } from '../src/shared/pagination.js';
import {
  assertWorkspaceWritable, createRevision, deleteBulletin, deletePageTemplate, deleteTemplate, inside, openWorkspace, permanentlyDeleteArchived,
  readAssetData, resolveWorkspaceConflict, restoreArchived, saveBulletin, saveLibrary, savePageTemplate, saveTemplate, trashLibraryImages, trashLibraryRecords
} from './workspace.js';
import { lookupBibleGatewayWeb } from './bibleGatewayScraper.js';
import { templateForBulletin } from '../src/shared/documentLayout.js';
import { canvasAssetRefs, canvasNativeBlocks, canvasSpace } from '../src/shared/canvas.js';
import { flattenBlocks } from '../src/shared/blocks.js';
import { copyAssetToBlobStore } from './assets.js';
import { DialogPathStore } from './dialogPaths.js';
import { startWorkspaceWatcher } from './workspaceWatcher.js';
import { createAppUpdateService, type AppUpdateService } from './updater.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | undefined;
let printJob: { root: string; document: BulletinDocumentV1 } | undefined;
let printReady: (() => void) | undefined;
let dialogPaths: DialogPathStore;
const workspaceWatchers = new Map<string, () => void>();
let updateService: AppUpdateService | undefined;
let editingState: EditingState = { bulletinDirty: false, templateDirty: false, auxiliaryDirty: false };
let closeConfirmed = false;

const hasUnsavedChanges = () => editingState.bulletinDirty || editingState.templateDirty || editingState.auxiliaryDirty;
const requireWritable = (root: string) => assertWorkspaceWritable(root, app.getVersion());
const publishUpdateStatus = (status: AppUpdateStatus) => mainWindow?.webContents.send('update:status', status);

function createWindow() {
  closeConfirmed = false;
  mainWindow = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1050, minHeight: 700,
    backgroundColor: '#f4f1e9',
    webPreferences: { preload: path.join(dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.on('close', event => {
    if (!closeConfirmed && editingState.bulletinDirty) {
      event.preventDefault();
      mainWindow?.webContents.send('app:request-close');
    }
  });
  if (!app.isPackaged) void mainWindow.loadURL('http://localhost:5173');
  else void mainWindow.loadFile(path.join(dirname, '../../dist/index.html'));
}

app.whenReady().then(() => {
  dialogPaths = new DialogPathStore(path.join(app.getPath('userData'), 'dialog-paths.json'));
  app.on('session-created', session => session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false)));
  registerIpc();
  createWindow();
  updateService = createAppUpdateService(app.getVersion(), app.isPackaged && process.platform === 'win32', publishUpdateStatus);
  updateService.initialize();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });

function registerIpc() {
  ipcMain.handle('workspace:choose', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], title: 'Choose the synced bulletin workspace', defaultPath: await dialogPaths.get('workspace') });
    if (result.canceled) return null;
    await dialogPaths.remember('workspace', result.filePaths[0]);
    return result.filePaths[0];
  });
  ipcMain.handle('workspace:open', async (_event, root: string) => {
    const workspace = await openWorkspace(root, app.getVersion());
    await watchWorkspace(root);
    return workspace;
  });
  ipcMain.handle('bulletin:save', async (_event, ...args: Parameters<BulletinApi['saveBulletin']>) => { await requireWritable(args[0]); return saveBulletin(...args); });
  ipcMain.handle('bulletin:delete', async (_event, ...args: Parameters<BulletinApi['deleteBulletin']>) => { await requireWritable(args[0]); return deleteBulletin(...args); });
  ipcMain.handle('template:save', async (_event, ...args: Parameters<BulletinApi['saveTemplate']>) => { await requireWritable(args[0]); return saveTemplate(...args); });
  ipcMain.handle('template:delete', async (_event, ...args: Parameters<BulletinApi['deleteTemplate']>) => { await requireWritable(args[0]); return deleteTemplate(...args); });
  ipcMain.handle('page-template:save', async (_event, ...args: Parameters<BulletinApi['savePageTemplate']>) => { await requireWritable(args[0]); return savePageTemplate(...args); });
  ipcMain.handle('page-template:delete', async (_event, ...args: Parameters<BulletinApi['deletePageTemplate']>) => { await requireWritable(args[0]); return deletePageTemplate(...args); });
  ipcMain.handle('library:save', async (_event, ...args: Parameters<BulletinApi['saveLibrary']>) => { await requireWritable(args[0]); return saveLibrary(...args); });
  ipcMain.handle('library:trash-images', async (_event, ...args: Parameters<NonNullable<BulletinApi['trashLibraryImages']>>) => { await requireWritable(args[0]); return trashLibraryImages(...args); });
  ipcMain.handle('library:trash-records', async (_event, ...args: Parameters<NonNullable<BulletinApi['trashLibraryRecords']>>) => { await requireWritable(args[0]); return trashLibraryRecords(...args); });
  ipcMain.handle('archive:restore', async (_event, root, record) => { await requireWritable(root); return restoreArchived(root, record); });
  ipcMain.handle('archive:delete', async (_event, root, record) => { await requireWritable(root); return permanentlyDeleteArchived(root, record); });
  ipcMain.handle('workspace:resolve-conflict', async (_event, root, conflictRecord, keepPath) => { await requireWritable(root); return resolveWorkspaceConflict(root, conflictRecord, keepPath); });
  ipcMain.handle('revision:create', async (_event, ...args: Parameters<BulletinApi['createRevision']>) => { await requireWritable(args[0]); return createRevision(...args); });
  ipcMain.handle('asset:read', (_event, root: string, relative: string) => readAssetData(root, relative));
  ipcMain.handle('asset:import', async (_event, root: string, targetFolder: string) => {
    await requireWritable(root);
    const result = await dialog.showOpenDialog({ properties: ['openFile'], defaultPath: await dialogPaths.get('asset'), filters: [{ name: 'Page assets', extensions: ['png', 'jpg', 'jpeg', 'svg', 'pdf'] }] });
    if (result.canceled) return null;
    const source = result.filePaths[0];
    await dialogPaths.remember('asset', path.dirname(source));
    void targetFolder; // Kept in the public API for browser compatibility.
    const destination = await copyAssetToBlobStore(source, root);
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
  ipcMain.handle('pdf:export', async (_event, root: string, relative: string, document: BulletinDocumentV1) => { await requireWritable(root); return exportPdf(root, relative, document); });
  ipcMain.handle('update:status', () => updateService?.getStatus() ?? { phase: 'disabled', currentVersion: app.getVersion() });
  ipcMain.handle('update:check', () => updateService?.check() ?? Promise.resolve({ phase: 'disabled', currentVersion: app.getVersion() }));
  ipcMain.handle('update:install', () => {
    if (hasUnsavedChanges()) throw new Error('Save or close unfinished bulletin, template, or library edits before installing the update.');
    updateService?.install();
  });
  ipcMain.on('editing:state', (_event, state: EditingState) => { editingState = state; });
  ipcMain.on('app:confirm-close', () => {
    closeConfirmed = true;
    mainWindow?.close();
  });
}

async function watchWorkspace(root: string) {
  if (workspaceWatchers.has(root)) return;
  const close = await startWorkspaceWatcher(root, paths => {
    mainWindow?.webContents.send('workspace:changed', { root, paths, occurredAt: new Date().toISOString() });
  });
  workspaceWatchers.set(root, close);
}

async function exportPdf(root: string, relative: string, document: BulletinDocumentV1) {
  const workspace = await openWorkspace(root, app.getVersion());
  const referencedAssets = flattenBlocks(document.blocks).flatMap(block => {
    const assets = 'asset' in block && block.asset ? [block.asset] : [];
    if (block.type === 'canvas') {
      assets.push(...canvasAssetRefs(block.scene));
      for (const native of canvasNativeBlocks(block.scene)) {
        if ('libraryItemId' in native) assets.push(...(workspace.library?.items.filter(item => item.id === native.libraryItemId && (!native.libraryItemVersion || item.version === native.libraryItemVersion)).sort((a, b) => b.version - a.version)[0]?.assets ?? []));
      }
    }
    if ('libraryItemId' in block) assets.push(...(workspace.library?.items.filter(item => item.id === block.libraryItemId && (!block.libraryItemVersion || item.version === block.libraryItemVersion)).sort((a, b) => b.version - a.version)[0]?.assets ?? []));
    return assets;
  });
  await Promise.all(referencedAssets.map(asset => readFile(inside(root, asset.path))));
  const suggested = `${document.info.date} ${document.info.title}.pdf`.replace(/[<>:"/\\|?*]/g, '-');
  const rememberedExportFolder = await dialogPaths.get('export');
  const options = { title: 'Export bulletin PDF', defaultPath: rememberedExportFolder ? path.join(rememberedExportFolder, suggested) : inside(root, path.join(path.dirname(relative), 'exports', suggested)), filters: [{ name: 'PDF', extensions: ['pdf'] }] };
  const choice = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
  if (choice.canceled || !choice.filePath) return null;
  await dialogPaths.remember('export', path.dirname(choice.filePath));
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
  const workspace = await openWorkspace(root, app.getVersion());
  const storedTemplate = workspace.templates.find(t => t.template.id === document.template.id && t.template.version === document.template.version)?.template ?? (await import('../src/shared/defaults.js')).defaultTemplate;
  const effectiveTemplate = templateForBulletin(storedTemplate, document);
  const pages = paginate(document.blocks, effectiveTemplate, workspace.library);
  for (let index = pages.length - 1; index >= 0; index--) {
    const block = pages[index].blocks[0];
    const margin = pages[index].marginIn ?? effectiveTemplate.theme.marginIn;
    const placements = pdfCanvasPlacements(pages[index].blocks, margin, effectiveTemplate, workspace.library);
    if (placements.length) {
      const embeddedOverlay = await output.embedPage(chromium.getPage(index));
      output.removePage(index);
      const page = output.insertPage(index, [504, 612]);
      page.drawRectangle({ x: 0, y: 0, width: 504, height: 612, color: rgb(1, 1, 1) });
      for (const { canvas, x, y } of placements) {
        const scene = canvas.scene;
        const background = scene.background!.asset!;
        const source = await PDFDocument.load(await readFile(inside(root, background.path)));
        const sourceIndex = Math.max(0, Math.min(source.getPageCount() - 1, (background.page ?? 1) - 1));
        const embeddedBackground = await output.embedPage(source.getPage(sourceIndex));
        const canvasWidth = (canvas.widthMode ?? 'contentBox') === 'fullPage' ? 7 : 7 - margin * 2;
        const space = canvasSpace(scene, 0, canvasWidth, canvas.heightIn);
        const box = { x: (x + space.x) * 72, y: 612 - (y + space.y + space.height) * 72, width: space.width * 72, height: space.height * 72 };
        const fit = scene.background?.fit ?? 'cover';
        const scaleX = box.width / embeddedBackground.width;
        const scaleY = box.height / embeddedBackground.height;
        const scale = fit === 'fill' ? undefined : fit === 'contain' ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY);
        const width = scale === undefined ? box.width : embeddedBackground.width * scale;
        const height = scale === undefined ? box.height : embeddedBackground.height * scale;
        page.pushOperators(pushGraphicsState(), rectangle(box.x, box.y, box.width, box.height), clip(), endPath());
        page.drawPage(embeddedBackground, { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height });
        page.pushOperators(popGraphicsState());
      }
      page.drawPage(embeddedOverlay, { x: 0, y: 0, width: 504, height: 612 });
      continue;
    }
    if (!block || block.type !== 'fullPageAsset' || !block.asset || block.asset.mediaType !== 'application/pdf') continue;
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

function pdfCanvasPlacements(blocks: BulletinBlock[], marginIn: number, template: TemplateV1, library?: LibraryManifestV1) {
  const placements: Array<{ canvas: CanvasBlock; x: number; y: number }> = [];
  let cursor = marginIn;
  const visit = (entries: BulletinBlock[], nested = false) => {
    for (const block of entries) {
      if (block.type === 'templatePage') {
        visit(block.blocks, true);
        continue;
      }
      if (block.type === 'group') {
        visit(block.children, nested);
        continue;
      }
      if (block.type === 'canvas' && block.scene.background?.asset?.mediaType === 'application/pdf') {
        placements.push({
          canvas: block,
          x: (block.widthMode ?? 'contentBox') === 'fullPage' ? 0 : marginIn,
          y: cursor
        });
      }
      cursor += estimateBlockPoints(block, { ...template, theme: { ...template.theme, marginIn } }, library) / 72;
    }
  };
  visit(blocks);
  return placements;
}
