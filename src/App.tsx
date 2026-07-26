import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { DocumentView } from './components/DocumentView';
import { WeeklyEditor } from './components/WeeklyEditor';
import { TemplateBuilder } from './components/TemplateBuilder';
import { TemplateSwitcher } from './components/TemplateSwitcher';
import { createBulletin, defaultTemplate } from './shared/defaults';
import { libraryFamilies, type LibraryFamily } from './shared/library';
import { paginate } from './shared/pagination';
import { paragraphsFromPlainText } from './shared/plainText';
import { duplicateTemplate, nextTemplateVersion, sortedTemplateRecords, templateChoices, templateForReference, templateVersions, type TemplateRecord } from './shared/templates';
import type { BulletinDocumentV1, LibraryItemV1, LibraryManifestV1, TemplateV1, ValidationIssue, WorkspaceSummary } from './shared/types';
import { validateBulletin } from './shared/validation';
import { templateForBulletin } from './shared/documentLayout';
import { prepackagedBlockDiagnostics } from './prepackagedBlocks';

type Screen = 'weekly' | 'templates' | 'library';
type Confirmation = { title: string; message: string; confirmLabel: string; action(): Promise<void> };
type LibraryDraft = { id: string; title: string; kind: LibraryItemV1['kind']; text: string; notice: string; asset?: NonNullable<LibraryItemV1['assets']>[number] };
const emptyLibraryDraft = (): LibraryDraft => ({ id: '', title: '', kind: 'song', text: '', notice: '' });
const libraryContentText = (item: LibraryItemV1) => item.content?.map(paragraph => paragraph.children.map(child => child.type === 'text' ? child.text : child.type === 'lineBreak' ? '\n' : '✠').join('')).join('\n\n') ?? '';
const previewZooms = [.5, .6, .72, .85, 1, 1.25];
const storedPreviewZoom = () => {
  const raw = localStorage.getItem('bulletin-preview-zoom');
  const value = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(value) && value >= .1 && value <= 2 ? value : undefined;
};

function PreviewZoomControls({ zoom, onChange, onFit }: { zoom: number; onChange(zoom: number): void; onFit(mode: 'width' | 'page', container: HTMLElement | null): void }) {
  const lower = [...previewZooms].reverse().find(value => value < zoom - .001) ?? previewZooms[0];
  const higher = previewZooms.find(value => value > zoom + .001) ?? previewZooms.at(-1)!;
  const options = previewZooms.includes(zoom) ? previewZooms : [...previewZooms, zoom].sort((left, right) => left - right);
  return <div className="preview-zoom">
    <div className="preview-zoom-steps">
      <button type="button" aria-label="Zoom out" title="Zoom out" disabled={zoom <= previewZooms[0]} onClick={() => onChange(lower)}>−</button>
      <select aria-label="Preview zoom" value={zoom} onChange={event => onChange(Number(event.target.value))}>{options.map(value => <option value={value} key={value}>{Math.round(value * 100)}%</option>)}</select>
      <button type="button" aria-label="Zoom in" title="Zoom in" disabled={zoom >= previewZooms.at(-1)!} onClick={() => onChange(higher)}>＋</button>
    </div>
    <div className="preview-zoom-presets">
      <button type="button" onClick={event => onFit('width', event.currentTarget.closest('.preview-pane, .builder-preview'))}>Fit to width</button>
      <button type="button" onClick={event => onFit('page', event.currentTarget.closest('.preview-pane, .builder-preview'))}>Fit to page</button>
      <button type="button" onClick={() => onChange(1)}>100%</button>
    </div>
  </div>;
}

export default function App() {
  const [printMode, setPrintMode] = useState(() => new URLSearchParams(location.search).get('print') === '1');
  useEffect(() => {
    const openPrint = () => setPrintMode(true);
    const syncLocation = () => setPrintMode(new URLSearchParams(location.search).get('print') === '1');
    window.addEventListener('bulletin:open-print', openPrint);
    window.addEventListener('popstate', syncLocation);
    return () => { window.removeEventListener('bulletin:open-print', openPrint); window.removeEventListener('popstate', syncLocation); };
  }, []);
  if (printMode) return <PrintApp />;
  return <DesktopApp />;
}

function DesktopApp() {
  const initialPreviewZoom = storedPreviewZoom();
  const [workspace, setWorkspace] = useState<WorkspaceSummary>();
  const [screen, setScreen] = useState<Screen>('weekly');
  const [document, setDocument] = useState<BulletinDocumentV1>();
  const [relativePath, setRelativePath] = useState('');
  const [template, setTemplate] = useState<TemplateV1>(defaultTemplate);
  const [templatePath, setTemplatePath] = useState('');
  const [status, setStatus] = useState('Ready');
  const [workspacePicker, setWorkspacePicker] = useState(false);
  const [availableWorkspaces, setAvailableWorkspaces] = useState<Array<{ root: string; name: string }>>([]);
  const [exportIssues, setExportIssues] = useState<ValidationIssue[]>([]);
  const [exporting, setExporting] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [showRulers, setShowRulers] = useState(() => localStorage.getItem('bulletin-show-rulers') !== 'false');
  const [showGuides, setShowGuides] = useState(() => localStorage.getItem('bulletin-show-guides') === 'true');
  const [previewZoom, setPreviewZoom] = useState(initialPreviewZoom ?? .72);
  const [newBulletinPicker, setNewBulletinPicker] = useState(false);
  const previewZoomMode = useRef<'page' | 'width' | 'manual'>(initialPreviewZoom === undefined ? 'page' : 'manual');
  const dirty = useRef(false);
  const savedRevision = useRef(0);
  const statusSequence = useRef(0);
  const editorFocusTimer = useRef<number | undefined>(undefined);
  const previewFocusTimer = useRef<number | undefined>(undefined);
  const reportStatus = (message: string) => { statusSequence.current += 1; setStatus(message); };

  useEffect(() => {
    const root = localStorage.getItem('bulletin-workspace');
    if (window.bulletin?.platform === 'electron' && root?.startsWith('local:')) { localStorage.removeItem('bulletin-workspace'); return; }
    if (root) void loadWorkspace(root);
    else if (window.bulletin?.platform === 'browser') void window.bulletin.chooseWorkspace().then(next => { if (next) return loadWorkspace(next); });
  }, []);

  useEffect(() => {
    if (!workspace || screen === 'library') return;
    const container = window.document.querySelector<HTMLElement>('.preview-pane, .builder-preview');
    const stack = container?.querySelector<HTMLElement>('.document-stack');
    if (!container || !stack) return;
    const applyActiveFit = () => {
      if (previewZoomMode.current !== 'manual') fitPreview(previewZoomMode.current, container);
    };
    const timer = window.setTimeout(applyActiveFit);
    const observer = new ResizeObserver(applyActiveFit);
    observer.observe(stack);
    return () => { window.clearTimeout(timer); observer.disconnect(); };
  }, [workspace, document, screen, showRulers]);

  useEffect(() => {
    if (!dirty.current || !document || !workspace || !window.bulletin || !relativePath) return;
    const saveSequence = ++statusSequence.current;
    setStatus('Saving…');
    const timer = setTimeout(() => {
      const expected = savedRevision.current;
      void window.bulletin!.saveBulletin(workspace.root, relativePath, document, expected).then(result => {
        savedRevision.current = result.revision; dirty.current = false;
        const savedDocument = { ...document, revision: result.revision, updatedAt: result.updatedAt };
        setDocument(savedDocument);
        setWorkspace(current => current ? { ...current, bulletins: current.bulletins.some(item => item.path === relativePath) ? current.bulletins.map(item => item.path === relativePath ? { path: relativePath, document: savedDocument } : item) : [...current.bulletins, { path: relativePath, document: savedDocument }] } : current);
        if (statusSequence.current === saveSequence) setStatus('Saved');
      }).catch(error => reportStatus(error instanceof Error ? error.message : String(error)));
    }, 700);
    return () => clearTimeout(timer);
  }, [document, relativePath, workspace]);

  async function loadWorkspace(root: string) {
    if (!window.bulletin) return;
    try {
      const next = await window.bulletin.openWorkspace(root); setWorkspace(next); localStorage.setItem('bulletin-workspace', root);
      const selectedTemplate = templateChoices(next.templates)[0] ?? sortedTemplateRecords(next.templates)[0];
      setTemplate(selectedTemplate?.template ?? defaultTemplate); setTemplatePath(selectedTemplate?.path ?? '');
      const latest = [...next.bulletins].sort((a, b) => b.document.info.date.localeCompare(a.document.info.date))[0];
      if (latest) openDocument(latest.document, latest.path, next.templates); else startNew(selectedTemplate?.template ?? defaultTemplate);
    } catch (error) { reportStatus(error instanceof Error ? error.message : String(error)); }
  }
  async function chooseWorkspace() {
    if (!window.bulletin) return;
    if (window.bulletin.platform === 'browser') {
      setAvailableWorkspaces(await window.bulletin.listWorkspaces?.() ?? []); setWorkspacePicker(true); return;
    }
    try { const root = await window.bulletin.chooseWorkspace(); if (root) await loadWorkspace(root); }
    catch (error) { reportStatus(error instanceof Error ? error.message : String(error)); }
  }
  function selectTemplate(record: TemplateRecord) { setTemplate(record.template); setTemplatePath(record.path); }
  function openDocument(next: BulletinDocumentV1, path: string, records = workspace?.templates ?? []) { const record = templateForReference(records, next.template); if (record) selectTemplate(record); setDocument(next); setRelativePath(path); savedRevision.current = next.revision; dirty.current = false; reportStatus('Saved'); setScreen('weekly'); }
  function showWeekly() { if (document) { const record = templateForReference(workspace?.templates ?? [], document.template); if (record) selectTemplate(record); } setScreen('weekly'); }
  function startNew(from = template) { const next = createBulletin(from); const base = `bulletins/${next.info.date}/bulletin.json`; const path = workspace?.bulletins.some(item => item.path === base) ? `bulletins/${next.info.date}/bulletin-${Date.now()}.json` : base; openDocument(next, path); dirty.current = true; }
  function beginNewBulletin() { const choices = templateChoices(workspace?.templates ?? []); if (choices.length <= 1) { const choice = choices[0]; if (choice) selectTemplate(choice); startNew(choice?.template ?? template); return; } setNewBulletinPicker(true); }
  function changeDocument(next: BulletinDocumentV1) { dirty.current = true; setExportIssues([]); reportStatus('Unsaved changes'); setDocument(next); }
  async function deleteCurrentBulletin() {
    if (!document || !workspace || !window.bulletin) return;
    try {
      dirty.current = false;
      await window.bulletin.deleteBulletin(workspace.root, relativePath);
      const remaining = workspace.bulletins.filter(item => item.path !== relativePath);
      setWorkspace({ ...workspace, bulletins: remaining });
      const latest = [...remaining].sort((a, b) => b.document.info.date.localeCompare(a.document.info.date))[0];
      if (latest) openDocument(latest.document, latest.path);
      else { setDocument(undefined); setRelativePath(''); savedRevision.current = 0; }
      reportStatus('Bulletin deleted');
    } catch (error) { reportStatus(error instanceof Error ? error.message : String(error)); }
  }
  function confirmBulletinDelete() {
    if (!document) return;
    setConfirmation({ title: 'Delete bulletin?', message: `“${document.info.title}” for ${document.info.date} will be permanently removed.`, confirmLabel: 'Delete bulletin', action: deleteCurrentBulletin });
  }
  async function performExport() {
    if (!document || !workspace || !window.bulletin) return;
    setExportIssues([]);
    setExporting(true);
    reportStatus('Preparing PDF…');
    try { const output = await window.bulletin.exportPdf(workspace.root, relativePath, document); reportStatus(output ? (window.bulletin.platform === 'browser' ? 'Opening print preview…' : `Exported ${output}`) : 'Export canceled'); } catch (error) { reportStatus(error instanceof Error ? error.message : String(error)); }
    finally { setExporting(false); }
  }
  async function exportPdf() {
    if (!document || !workspace || !window.bulletin) return;
    const issues = validateBulletin(document, workspace.library);
    if (issues.length) { setExportIssues(issues); reportStatus(`Review ${issues.length} item${issues.length === 1 ? '' : 's'} before exporting.`); return; }
    await performExport();
  }
  async function saveTemplate(publish: boolean) {
    if (!workspace || !window.bulletin) return;
    const next = publish ? { ...template, status: 'published' as const, version: nextTemplateVersion(workspace.templates, template.id) } : { ...template, status: 'draft' as const };
    try { const path = await window.bulletin.saveTemplate(workspace.root, next); setTemplate(next); setTemplatePath(path); setWorkspace(current => current ? { ...current, templates: current.templates.some(item => item.path === path) ? current.templates.map(item => item.path === path ? { path, template: next } : item) : [...current.templates, { path, template: next }] } : current); reportStatus(`${publish ? 'Published' : 'Saved'} ${path}`); } catch (error) { reportStatus(error instanceof Error ? error.message : String(error)); throw error; }
  }
  async function createNewTemplate(name: string) {
    if (!workspace || !window.bulletin) return;
    const next = duplicateTemplate(template, name, workspace.templates);
    try {
      const path = await window.bulletin.saveTemplate(workspace.root, next);
      setWorkspace(current => current ? { ...current, templates: [...current.templates, { path, template: next }] } : current);
      setTemplate(next); setTemplatePath(path); reportStatus(`Created ${name}`);
    } catch (error) { reportStatus(error instanceof Error ? error.message : String(error)); throw error; }
  }
  function selectAfterTemplateDeletion(templates: TemplateRecord[], preferredId?: string) {
    const selected = templateChoices(templates).find(item => item.template.id === preferredId) ?? templateChoices(templates)[0] ?? sortedTemplateRecords(templates)[0];
    if (!selected) return;
    setWorkspace(current => current ? { ...current, templates } : current);
    setTemplate(selected.template);
    setTemplatePath(selected.path);
  }
  async function deleteCurrentTemplateVersion() {
    if (!workspace || !window.bulletin || !templatePath || workspace.templates.length <= 1) return;
    try {
      await window.bulletin.deleteTemplate(workspace.root, templatePath);
      const templates = workspace.templates.filter(item => item.path !== templatePath);
      selectAfterTemplateDeletion(templates, template.id);
      reportStatus('Template version deleted');
    } catch (error) { reportStatus(error instanceof Error ? error.message : String(error)); }
  }
  async function deleteCurrentTemplateFamily() {
    if (!workspace || !window.bulletin || templateChoices(workspace.templates).length <= 1) return;
    const versions = templateVersions(workspace.templates, template.id);
    try {
      for (const version of versions) await window.bulletin.deleteTemplate(workspace.root, version.path);
      const templates = workspace.templates.filter(item => item.template.id !== template.id);
      selectAfterTemplateDeletion(templates);
      reportStatus(`Deleted ${template.name} and ${versions.length} version${versions.length === 1 ? '' : 's'}`);
    } catch (error) { reportStatus(error instanceof Error ? error.message : String(error)); }
  }
  function confirmTemplateVersionDelete() {
    setConfirmation({ title: 'Delete template version?', message: `${template.name} version ${template.version}${template.status === 'draft' ? ' draft' : ''} will be permanently removed. Other versions will remain available.`, confirmLabel: 'Delete version', action: deleteCurrentTemplateVersion });
  }
  function confirmTemplateFamilyDelete() {
    const versions = workspace ? templateVersions(workspace.templates, template.id).length : 0;
    setConfirmation({ title: 'Delete template?', message: `“${template.name}” and all ${versions} version${versions === 1 ? '' : 's'} will be permanently removed.`, confirmLabel: 'Delete template', action: deleteCurrentTemplateFamily });
  }
  function toggleRulers() {
    setShowRulers(current => {
      const next = !current;
      localStorage.setItem('bulletin-show-rulers', String(next));
      return next;
    });
  }
  function toggleGuides() {
    setShowGuides(current => {
      const next = !current;
      localStorage.setItem('bulletin-show-guides', String(next));
      return next;
    });
  }
  function changePreviewZoom(zoom: number) {
    previewZoomMode.current = 'manual';
    setPreviewZoom(zoom);
    localStorage.setItem('bulletin-preview-zoom', String(zoom));
  }
  function fitPreview(mode: 'width' | 'page', container: HTMLElement | null) {
    const stack = container?.querySelector<HTMLElement>('.document-stack');
    if (!stack) return;
    const rulerWidth = showRulers ? 46 : 0;
    const rulerHeight = showRulers ? 75 : 0;
    const fitWidth = (stack.clientWidth - 48 - rulerWidth) / 672;
    const fitPage = Math.min(fitWidth, (stack.clientHeight - 56 - rulerHeight) / 816);
    const zoom = Math.round(Math.max(.1, Math.min(2, mode === 'width' ? fitWidth : fitPage)) * 1000) / 1000;
    previewZoomMode.current = mode;
    setPreviewZoom(zoom);
    localStorage.setItem('bulletin-preview-zoom', String(zoom));
  }
  function handlePreviewWheel(event: ReactWheelEvent<HTMLElement>) {
    if (!event.ctrlKey || event.deltaY === 0) return;
    event.preventDefault();
    previewZoomMode.current = 'manual';
    setPreviewZoom(current => {
      const currentIndex = previewZooms.indexOf(current);
      const nextIndex = Math.max(0, Math.min(previewZooms.length - 1, currentIndex + (event.deltaY < 0 ? 1 : -1)));
      const next = previewZooms[nextIndex];
      localStorage.setItem('bulletin-preview-zoom', String(next));
      return next;
    });
  }
  function focusEditorBlock(blockId: string) {
    const editor = window.document.querySelector<HTMLElement>(screen === 'templates' ? '.template-workbench' : '.editor-pane');
    const target = [...(editor?.querySelectorAll<HTMLElement>('[data-editor-block-id]') ?? [])].find(element => element.dataset.editorBlockId === blockId);
    if (!target || !editor) return;
    let ancestor: HTMLElement | null = target;
    while (ancestor && editor.contains(ancestor)) {
      if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
      ancestor = ancestor.parentElement;
    }
    if (editorFocusTimer.current !== undefined) window.clearTimeout(editorFocusTimer.current);
    editor.querySelectorAll('.editor-block-focus').forEach(element => element.classList.remove('editor-block-focus'));
    target.classList.remove('editor-block-focus');
    void target.offsetWidth;
    target.classList.add('editor-block-focus');
    target.focus({ preventScroll: true });
    target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    editorFocusTimer.current = window.setTimeout(() => {
      target.classList.remove('editor-block-focus');
      editorFocusTimer.current = undefined;
    }, 1800);
  }
  function focusPreviewBlock(blockId: string) {
    const preview = window.document.querySelector<HTMLElement>(screen === 'templates' ? '.builder-preview' : '.preview-pane');
    const target = [...(preview?.querySelectorAll<HTMLElement>('[data-block-id]') ?? [])].find(element => element.dataset.blockId === blockId);
    if (!target || !preview) return;
    if (previewFocusTimer.current !== undefined) window.clearTimeout(previewFocusTimer.current);
    preview.querySelectorAll('.preview-block-focus').forEach(element => element.classList.remove('preview-block-focus'));
    target.classList.remove('preview-block-focus');
    void target.offsetWidth;
    target.classList.add('preview-block-focus');
    target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    previewFocusTimer.current = window.setTimeout(() => {
      target.classList.remove('preview-block-focus');
      previewFocusTimer.current = undefined;
    }, 1800);
  }
  function handleEditorBlockClick(event: ReactMouseEvent<HTMLElement>) {
    const block = (event.target as Element).closest<HTMLElement>('[data-editor-block-id]');
    if (block && event.currentTarget.contains(block) && block.dataset.editorBlockId) focusPreviewBlock(block.dataset.editorBlockId);
  }

  if (!workspace) return <div className="welcome-screen"><div className="brand-mark">✠</div><div className="eyebrow">Bulletin Builder</div><h1>Sunday’s bulletin,<br />without the busywork.</h1><p>Choose the folder where your church keeps its bulletins.</p><button className="primary large" onClick={chooseWorkspace}>Choose bulletin workspace</button></div>;

  const pageCount = document ? paginate(document.blocks, templateForBulletin(template, document), workspace.library).length : 0;
  const issues = document ? validateBulletin(document, workspace.library) : [];
  const statusIsError = /blocked|conflict|required|failed|error|missing|unavailable|does not|could not|invalid|enter |choose |paste |fetch /i.test(status);
  const workspaceName = availableWorkspaces.find(item => item.root === workspace.root)?.name ?? (workspace.root.startsWith('local:') ? workspace.root.slice(6).replaceAll('-', ' ') : workspace.root);
  return <div className="app-shell">
    <aside className="sidebar"><div className="app-brand"><span>✠</span><div><b>Bulletin</b><small>Builder</small></div></div><nav><button className={screen === 'weekly' ? 'active' : ''} onClick={showWeekly}><span>◫</span>This week</button><button className={screen === 'templates' ? 'active' : ''} onClick={() => setScreen('templates')}><span>◇</span>Templates</button><button className={screen === 'library' ? 'active' : ''} onClick={() => setScreen('library')}><span>▤</span>Library</button></nav><div className="recent"><div className="eyebrow">Recent bulletins</div>{workspace.bulletins.slice().sort((a, b) => b.document.info.date.localeCompare(a.document.info.date)).slice(0, 6).map(item => <button key={item.path} onClick={() => openDocument(item.document, item.path)}><b>{new Date(`${item.document.info.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</b><span>{item.document.info.title}</span></button>)}</div><div className="sidebar-bottom"><button onClick={chooseWorkspace}>⌂ Change workspace</button><span title={workspace.root}>{workspaceName}</span></div></aside>
    <main className="main-area">
      <header className="topbar"><div><div className="eyebrow">{screen === 'weekly' ? 'Weekly bulletin' : screen}</div><h1>{screen === 'weekly' ? document?.info.title ?? 'No bulletin selected' : screen === 'templates' ? template.name : workspace.library?.name}</h1></div><div className="top-actions"><span className={`save-status ${statusIsError ? 'error' : ''}`}>{status}</span>{(screen === 'weekly' || screen === 'templates') && <><button type="button" className={`guide-toggle ${showGuides ? 'active' : ''}`} aria-label={`${showGuides ? 'Hide' : 'Show'} guides`} aria-pressed={showGuides} onClick={toggleGuides}>Guides</button><button type="button" className={`ruler-toggle ${showRulers ? 'active' : ''}`} aria-label={`${showRulers ? 'Hide' : 'Show'} rulers`} aria-pressed={showRulers} onClick={toggleRulers}>Rulers</button></>}{screen === 'weekly' && <>{document && <button className="danger-text" onClick={confirmBulletinDelete}>Delete</button>}<button className="secondary" onClick={beginNewBulletin}>New week</button><button type="button" className="primary" disabled={!window.bulletin || !document || exporting} onClick={() => void exportPdf()}>{exporting ? 'Preparing…' : window.bulletin?.platform === 'browser' ? 'Print / Save PDF' : 'Export PDF'}</button></>}</div></header>
      {prepackagedBlockDiagnostics.length > 0 && <div className="component-diagnostics-banner" role="status"><b>{prepackagedBlockDiagnostics.length} packaged component issue{prepackagedBlockDiagnostics.length === 1 ? '' : 's'}</b><span>{prepackagedBlockDiagnostics[0].message} The application skipped the affected definition and continued.</span></div>}
      {screen === 'weekly' && document && <div className="weekly-layout"><section className="editor-pane" onClick={handleEditorBlockClick}><WeeklyEditor document={document} template={template} library={workspace.library} root={workspace.root} relativePath={relativePath} onChange={changeDocument} onError={reportStatus} /></section><section className="preview-pane" onWheel={handlePreviewWheel}><div className="preview-toolbar"><div><b>Print preview</b><span>{pageCount} pages · 7 × 8.5 in</span></div><PreviewZoomControls zoom={previewZoom} onChange={changePreviewZoom} onFit={fitPreview} /><div className={issues.length ? 'validation warning' : 'validation'}>{issues.length ? `${issues.length} item${issues.length === 1 ? '' : 's'} to finish` : '✓ Ready to export'}</div></div><DocumentView document={document} template={template} library={workspace.library} root={workspace.root} rulers={showRulers} guides={showGuides} zoom={previewZoom} onBlockSelect={focusEditorBlock} /></section></div>}
      {screen === 'weekly' && !document && <div className="empty-state"><span>◫</span><h2>No bulletins yet</h2><p>Create a bulletin from one of your templates when you’re ready to begin.</p><button className="primary" onClick={beginNewBulletin}>Create bulletin</button></div>}
      {screen === 'templates' && <div className="template-screen"><div className="template-workbench" onClick={handleEditorBlockClick}><TemplateSwitcher records={workspace.templates} currentPath={templatePath} onSelect={path => { const record = workspace.templates.find(item => item.path === path); if (record) selectTemplate(record); }} onCreate={createNewTemplate} /><TemplateBuilder template={template} workspaceDescriptors={workspace.library?.blockDescriptors ?? []} library={workspace.library} root={workspace.root} onChange={setTemplate} onDescriptorsChange={async blockDescriptors => { if (!window.bulletin) return; const library = { ...(workspace.library ?? { schemaVersion: 1 as const, name: 'Shared Library', items: [] }), blockDescriptors }; try { await window.bulletin.saveLibrary(workspace.root, library); setWorkspace(current => current ? { ...current, library } : current); reportStatus('JSON block library saved'); } catch (error) { reportStatus(error instanceof Error ? error.message : String(error)); throw error; } }} onSave={saveTemplate} onDeleteVersion={confirmTemplateVersionDelete} onDeleteTemplate={confirmTemplateFamilyDelete} canDeleteVersion={workspace.templates.length > 1 && Boolean(templatePath)} canDeleteTemplate={templateChoices(workspace.templates).length > 1 && Boolean(templatePath)} /></div><div className="builder-preview" onWheel={handlePreviewWheel}><div className="preview-toolbar"><div><b>Template preview</b><span>7 × 8.5 in pages</span></div><PreviewZoomControls zoom={previewZoom} onChange={changePreviewZoom} onFit={fitPreview} /></div><DocumentView document={createBulletin(template)} template={template} library={workspace.library} root={workspace.root} rulers={showRulers} guides={showGuides} zoom={previewZoom} onBlockSelect={focusEditorBlock} /></div></div>}
      {screen === 'library' && <LibraryView workspace={workspace} onError={reportStatus} onSave={async library => { if (!window.bulletin) return; try { await window.bulletin.saveLibrary(workspace.root, library); setWorkspace({ ...workspace, library }); reportStatus('Library saved'); } catch (error) { const message = error instanceof Error ? error.message : String(error); reportStatus(message); throw error; } }} />}
    </main>
    {statusIsError && <div className="error-toast" role="alert"><span>!</span><div><b>Something needs attention</b><p>{status}</p></div><button aria-label="Dismiss error" onClick={() => reportStatus('Ready')}>×</button></div>}
    {exportIssues.length > 0 && <div className="modal-backdrop" role="presentation"><section className="export-issues-modal" role="dialog" aria-modal="true" aria-labelledby="export-issues-title"><header><div><div className="eyebrow">Export checklist</div><h2 id="export-issues-title">Review {exportIssues.length} item{exportIssues.length === 1 ? '' : 's'}</h2></div><button aria-label="Close export checklist" onClick={() => setExportIssues([])}>×</button></header><div className="export-issue-list">{exportIssues.map((issue, index) => <div key={`${issue.path}-${index}`}><span>{index + 1}</span><div><b>{issue.message}</b><small>{issue.path}</small></div></div>)}</div><footer><p>You can return to the editor to fix these items, or export the current preview as it appears now.</p><div className="export-checklist-actions"><button className="secondary" onClick={() => setExportIssues([])}>Back to editor</button><button className="primary" onClick={() => void performExport()}>Export anyway</button></div></footer></section></div>}
    {confirmation && <ConfirmDialog confirmation={confirmation} onCancel={() => setConfirmation(undefined)} onConfirm={async () => { const action = confirmation.action; setConfirmation(undefined); await action(); }} />}
    {newBulletinPicker && <NewBulletinDialog templates={templateChoices(workspace.templates)} onCancel={() => setNewBulletinPicker(false)} onSelect={record => { setNewBulletinPicker(false); selectTemplate(record); startNew(record.template); }} />}
    {workspacePicker && <WorkspacePicker workspaces={availableWorkspaces} current={workspace.root} onClose={() => setWorkspacePicker(false)} onSelect={async root => { setWorkspacePicker(false); await loadWorkspace(root); }} onCreate={async name => { try { const root = await window.bulletin!.createWorkspace!(name); setAvailableWorkspaces(await window.bulletin!.listWorkspaces!()); setWorkspacePicker(false); await loadWorkspace(root); } catch (error) { reportStatus(error instanceof Error ? error.message : String(error)); } }} />}
  </div>;
}

function ConfirmDialog({ confirmation, onCancel, onConfirm }: { confirmation: Confirmation; onCancel(): void; onConfirm(): Promise<void> }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}><section className="confirmation-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title"><div className="eyebrow">Please confirm</div><h2 id="confirmation-title">{confirmation.title}</h2><p>{confirmation.message}</p><p>This action cannot be undone.</p><div><button className="secondary" autoFocus onClick={onCancel}>Cancel</button><button className="danger" onClick={() => void onConfirm()}>{confirmation.confirmLabel}</button></div></section></div>;
}

function NewBulletinDialog({ templates, onCancel, onSelect }: { templates: TemplateRecord[]; onCancel(): void; onSelect(record: TemplateRecord): void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}><section className="new-bulletin-modal" role="dialog" aria-modal="true" aria-labelledby="new-bulletin-title"><header><div><div className="eyebrow">New week</div><h2 id="new-bulletin-title">Choose a template</h2></div><button aria-label="Close" onClick={onCancel}>×</button></header><div className="template-choice-list">{templates.map(record => <button key={record.path} onClick={() => onSelect(record)}><span>◇</span><div><b>{record.template.name}</b><small>Version {record.template.version}{record.template.status === 'draft' ? ' · Draft' : ' · Published'}</small></div><strong>Use template</strong></button>)}</div></section></div>;
}

function WorkspacePicker({ workspaces, current, onClose, onSelect, onCreate }: { workspaces: Array<{ root: string; name: string }>; current: string; onClose(): void; onSelect(root: string): void; onCreate(name: string): void }) {
  const [name, setName] = useState('');
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="workspace-modal" role="dialog" aria-modal="true" aria-labelledby="workspace-title"><header><div><div className="eyebrow">Local storage</div><h2 id="workspace-title">Choose workspace</h2></div><button aria-label="Close" onClick={onClose}>×</button></header><div className="workspace-list">{workspaces.map(item => <button className={item.root === current ? 'selected' : ''} key={item.root} onClick={() => onSelect(item.root)}><span className="workspace-icon">⌂</span><span><b>{item.name}</b><small>{item.root === current ? 'Current workspace' : 'Stored in this browser'}</small></span>{item.root === current && <strong>✓</strong>}</button>)}</div><div className="new-workspace"><label>New workspace name<input autoFocus value={name} placeholder="e.g. Sunday Worship" onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && name.trim()) onCreate(name.trim()); }} /></label><button className="primary" disabled={!name.trim()} onClick={() => onCreate(name.trim())}>Create workspace</button></div></section></div>;
}

function LibraryView({ workspace, onSave, onError }: { workspace: WorkspaceSummary; onSave(library: LibraryManifestV1): Promise<void>; onError(message: string): void }) {
  const items = workspace.library?.items ?? [];
  const [adding, setAdding] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState<Confirmation>();
  const [editing, setEditing] = useState<LibraryItemV1>();
  const [draft, setDraft] = useState<LibraryDraft>(emptyLibraryDraft);
  const [selectedVersions, setSelectedVersions] = useState<Record<string, number>>({});
  const families = useMemo(() => libraryFamilies(items), [items]);
  const groups = useMemo(() => families.reduce<Record<string, LibraryFamily[]>>((result, family) => {
    (result[family.kind] ??= []).push(family); return result;
  }, {}), [families]);
  const selectedItem = (family: LibraryFamily) => family.versions.find(item => item.version === selectedVersions[family.id]) ?? family.versions[0];
  const chooseAsset = async () => {
    if (!window.bulletin || !draft.id) return;
    try { const asset = await window.bulletin.importAsset(workspace.root, `assets/library/${draft.id}`); if (asset) setDraft({ ...draft, asset }); }
    catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  };
  const addItem = async () => {
    const id = draft.id || draft.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    if (!id || !draft.title.trim()) { onError('Enter a title and stable ID before saving the library item.'); return; }
    const version = Math.max(0, ...items.filter(item => item.id === id).map(item => item.version)) + 1;
    const item: LibraryItemV1 = { ...(editing?.aliases ? { aliases: editing.aliases } : {}), id, version, kind: draft.kind, title: draft.title,
      ...(draft.text ? { content: paragraphsFromPlainText(draft.text, { preserveLineBreaks: draft.kind === 'song' }) } : {}),
      ...(draft.notice ? { license: { notice: draft.notice, ...(editing?.license?.licenseNumber ? { licenseNumber: editing.license.licenseNumber } : {}) } } : {}), ...(draft.asset ? { assets: [draft.asset, ...(editing?.assets?.slice(1) ?? [])] } : {}) };
    try { await onSave({ ...(workspace.library ?? { schemaVersion: 1, name: 'Church Library' }), items: [...items, item] }); setSelectedVersions(current => ({ ...current, [id]: version })); setAdding(false); setEditing(undefined); setDraft(emptyLibraryDraft()); }
    catch { /* The parent reports the actionable error. */ }
  };
  const requestDelete = (item: LibraryItemV1) => {
    const newestVersion = Math.max(...items.filter(entry => entry.id === item.id).map(entry => entry.version));
    const usesItem = (block: BulletinDocumentV1['blocks'][number]) => 'libraryItemId' in block && block.libraryItemId === item.id && (block.libraryItemVersion ? block.libraryItemVersion === item.version : item.version === newestVersion);
    const references = workspace.bulletins.reduce((count, entry) => count + entry.document.blocks.filter(usesItem).length, 0) + workspace.templates.reduce((count, entry) => count + entry.template.starterBlocks.filter(usesItem).length, 0);
    setDeleteConfirmation({ title: 'Delete library item?', message: `${item.title}, version ${item.version}, will be removed from the shared library.${references ? ` It is currently referenced ${references} time${references === 1 ? '' : 's'} and those places will need a replacement.` : ''}`, confirmLabel: 'Delete item', action: async () => onSave({ ...(workspace.library ?? { schemaVersion: 1, name: 'Church Library' }), items: items.filter(entry => entry.id !== item.id || entry.version !== item.version) }) });
  };
  const beginEdit = (item: LibraryItemV1) => {
    setEditing(item); setAdding(true); setDraft({ id: item.id, title: item.title, kind: item.kind, text: libraryContentText(item), notice: item.license?.notice ?? '', asset: item.assets?.[0] });
  };
  const closeForm = () => { setAdding(false); setEditing(undefined); setDraft(emptyLibraryDraft()); };
  return <div className="library-screen"><div className="library-intro"><div><div className="eyebrow">Approved content</div><h2>{families.length} library item{families.length === 1 ? '' : 's'}</h2><p>{items.length} saved version{items.length === 1 ? '' : 's'} of songs, liturgy, artwork, fonts, and licensing metadata in the synced workspace.</p></div><div><button className="primary" onClick={() => { if (adding) closeForm(); else { setEditing(undefined); setDraft(emptyLibraryDraft()); setAdding(true); } }}>{adding ? 'Close form' : '＋ Add library item'}</button><div className="library-path">{workspace.root}/library.json</div></div></div>{adding && <section className="editor-card library-form"><h2>{editing ? `Edit ${editing.title}` : 'Add library item'}</h2>{editing && <p className="helper">Saving creates version {Math.max(...items.filter(item => item.id === editing.id).map(item => item.version)) + 1}; existing bulletins pinned to version {editing.version} will not change.</p>}<div className="field-row"><label>Title<input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value, id: draft.id || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-') })} /></label><label>Stable ID<input disabled={Boolean(editing)} value={draft.id} onChange={e => setDraft({ ...draft, id: e.target.value })} /></label></div><label>Kind<select value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as LibraryItemV1['kind'] })}><option value="song">Song</option><option value="liturgy">Liturgy</option><option value="image">Image</option><option value="church-info">Church information</option><option value="font">Font</option></select></label><label>Structured text<textarea rows={6} value={draft.text} onChange={e => setDraft({ ...draft, text: e.target.value })} placeholder="Separate paragraphs or verses with a blank line" /></label><label>Copyright or license notice<textarea rows={3} value={draft.notice} onChange={e => setDraft({ ...draft, notice: e.target.value })} /></label><div className="builder-actions"><button className="secondary" disabled={!draft.id} onClick={chooseAsset}>{draft.asset ? `Replace ${draft.asset.alt ?? 'image or PDF'}` : 'Attach image or PDF'}</button><button className="secondary" onClick={closeForm}>Cancel</button><button className="primary" onClick={addItem}>{editing ? 'Save new version' : 'Save item'}</button></div></section>}{families.length === 0 ? <div className="empty-state"><span>▤</span><h2>Your shared library is ready</h2><p>Add the first reusable item above. Weekly editors will immediately offer songs and liturgy.</p></div> : Object.entries(groups).map(([kind, entries]) => <section className="library-group" key={kind}><h3>{kind}</h3>{entries?.map(family => { const item = selectedItem(family); return <article key={family.id}><div><b>{item.title}</b><small>{item.id} · {family.versions.length} version{family.versions.length === 1 ? '' : 's'}</small></div><div className="library-item-actions"><select className="inline-version-select" aria-label={`Version for ${family.id}`} value={item.version} onChange={event => setSelectedVersions(current => ({ ...current, [family.id]: Number(event.target.value) }))}>{family.versions.map(version => <option value={version.version} key={version.version}>v{version.version}{version.title !== family.versions[0].title ? ` · ${version.title}` : ''}</option>)}</select><span>{item.license ? 'Licensed' : 'No notice'}</span><button className="text-button" onClick={() => beginEdit(item)}>Edit</button><button className="danger-text" onClick={() => requestDelete(item)}>Delete</button></div></article>; })}</section>)}{deleteConfirmation && <ConfirmDialog confirmation={deleteConfirmation} onCancel={() => setDeleteConfirmation(undefined)} onConfirm={async () => { const action = deleteConfirmation.action; setDeleteConfirmation(undefined); await action(); }} />}</div>;
}

function PrintApp() {
  const [job, setJob] = useState<{ root: string; document: BulletinDocumentV1 }>();
  const [workspace, setWorkspace] = useState<WorkspaceSummary>();
  const [ready, setReady] = useState(false);
  useEffect(() => { void window.bulletin?.getPrintJob().then(value => { const next = value as typeof job; if (!next) return; setJob(next); return window.bulletin!.openWorkspace(next.root).then(setWorkspace); }); }, []);
  if (!job || !workspace) return <div>Preparing print layout…</div>;
  const template = workspace.templates.find(item => item.template.id === job.document.template.id && item.template.version === job.document.template.version)?.template ?? defaultTemplate;
  const browser = window.bulletin?.platform === 'browser';
  return <div className="print-screen">{browser && <header className="print-controls"><div><b>{ready ? 'Print preview ready' : 'Preparing pages…'}</b><span>Choose “Save to PDF” in your browser’s print dialog.</span></div><div className="print-actions"><button className="secondary" onClick={() => { if (history.length > 1) history.back(); else window.close(); }}>Back to editor</button><button className="primary" disabled={!ready} onClick={() => window.print()}>Print / Save as PDF</button></div></header>}<DocumentView document={job.document} template={template} library={workspace.library} root={job.root} print onReady={() => { if (browser) setReady(true); else window.bulletin?.printReady(); }} /></div>;
}
