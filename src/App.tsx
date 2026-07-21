import { useEffect, useMemo, useRef, useState } from 'react';
import { DocumentView } from './components/DocumentView';
import { WeeklyEditor } from './components/WeeklyEditor';
import { TemplateBuilder } from './components/TemplateBuilder';
import { createBulletin, defaultTemplate } from './shared/defaults';
import { paginate } from './shared/pagination';
import type { BulletinDocumentV1, LibraryItemV1, LibraryManifestV1, TemplateV1, ValidationIssue, WorkspaceSummary } from './shared/types';
import { validateBulletin } from './shared/validation';

type Screen = 'weekly' | 'templates' | 'library';
type Confirmation = { title: string; message: string; confirmLabel: string; action(): Promise<void> };

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
  const dirty = useRef(false);
  const savedRevision = useRef(0);
  const statusSequence = useRef(0);
  const reportStatus = (message: string) => { statusSequence.current += 1; setStatus(message); };

  useEffect(() => {
    const root = localStorage.getItem('bulletin-workspace');
    if (root) void loadWorkspace(root);
    else if (window.bulletin?.platform === 'browser') void window.bulletin.chooseWorkspace().then(next => { if (next) return loadWorkspace(next); });
  }, []);

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
      const selectedTemplate = [...next.templates].sort((a, b) => b.template.version - a.template.version)[0];
      setTemplate(selectedTemplate?.template ?? defaultTemplate); setTemplatePath(selectedTemplate?.path ?? '');
      const latest = [...next.bulletins].sort((a, b) => b.document.info.date.localeCompare(a.document.info.date))[0];
      if (latest) openDocument(latest.document, latest.path); else startNew(selectedTemplate?.template ?? defaultTemplate);
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
  function openDocument(next: BulletinDocumentV1, path: string) { setDocument(next); setRelativePath(path); savedRevision.current = next.revision; dirty.current = false; reportStatus('Saved'); setScreen('weekly'); }
  function startNew(from = template) { const next = createBulletin(from); const base = `bulletins/${next.info.date}/bulletin.json`; const path = workspace?.bulletins.some(item => item.path === base) ? `bulletins/${next.info.date}/bulletin-${Date.now()}.json` : base; openDocument(next, path); dirty.current = true; }
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
    const next = publish ? { ...template, status: 'published' as const, version: template.version + 1 } : { ...template, status: 'draft' as const };
    try { const path = await window.bulletin.saveTemplate(workspace.root, next); setTemplate(next); setTemplatePath(path); setWorkspace(current => current ? { ...current, templates: current.templates.some(item => item.path === path) ? current.templates.map(item => item.path === path ? { path, template: next } : item) : [...current.templates, { path, template: next }] } : current); reportStatus(`${publish ? 'Published' : 'Saved'} ${path}`); } catch (error) { reportStatus(error instanceof Error ? error.message : String(error)); throw error; }
  }
  async function deleteCurrentTemplate() {
    if (!workspace || !window.bulletin || !templatePath || workspace.templates.length <= 1) return;
    try {
      await window.bulletin.deleteTemplate(workspace.root, templatePath);
      const templates = workspace.templates.filter(item => item.path !== templatePath);
      const selected = [...templates].sort((a, b) => b.template.version - a.template.version)[0];
      setWorkspace({ ...workspace, templates }); setTemplate(selected.template); setTemplatePath(selected.path);
      reportStatus('Template version deleted');
    } catch (error) { reportStatus(error instanceof Error ? error.message : String(error)); }
  }
  function confirmTemplateDelete() {
    setConfirmation({ title: 'Delete template version?', message: `${template.name} version ${template.version}${template.status === 'draft' ? ' draft' : ''} will be permanently removed.`, confirmLabel: 'Delete version', action: deleteCurrentTemplate });
  }

  if (!workspace) return <div className="welcome-screen"><div className="brand-mark">✠</div><div className="eyebrow">Bulletin Builder</div><h1>Sunday’s bulletin,<br />without the busywork.</h1><p>Choose the folder your church already syncs with SharePoint. Templates, approved content, and weekly projects will live there together.</p><button className="primary large" onClick={chooseWorkspace}>Choose bulletin workspace</button><small>Windows and Arch Linux · local-first · no account required</small></div>;

  const pageCount = document ? paginate(document.blocks, template, workspace.library).length : 0;
  const issues = document ? validateBulletin(document, workspace.library) : [];
  const statusIsError = /blocked|conflict|required|failed|error|missing|unavailable|does not|could not|invalid|enter |choose |paste |fetch /i.test(status);
  const workspaceName = availableWorkspaces.find(item => item.root === workspace.root)?.name ?? (workspace.root.startsWith('local:') ? workspace.root.slice(6).replaceAll('-', ' ') : workspace.root);
  return <div className="app-shell">
    <aside className="sidebar"><div className="app-brand"><span>✠</span><div><b>Bulletin</b><small>Builder</small></div></div><nav><button className={screen === 'weekly' ? 'active' : ''} onClick={() => setScreen('weekly')}><span>◫</span>This week</button><button className={screen === 'templates' ? 'active' : ''} onClick={() => setScreen('templates')}><span>◇</span>Templates</button><button className={screen === 'library' ? 'active' : ''} onClick={() => setScreen('library')}><span>▤</span>Library</button></nav><div className="recent"><div className="eyebrow">Recent bulletins</div>{workspace.bulletins.slice().sort((a, b) => b.document.info.date.localeCompare(a.document.info.date)).slice(0, 6).map(item => <button key={item.path} onClick={() => openDocument(item.document, item.path)}><b>{new Date(`${item.document.info.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</b><span>{item.document.info.title}</span></button>)}</div><div className="sidebar-bottom"><button onClick={chooseWorkspace}>⌂ Change workspace</button><span title={workspace.root}>{workspaceName}</span></div></aside>
    <main className="main-area">
      <header className="topbar"><div><div className="eyebrow">{screen === 'weekly' ? 'Weekly bulletin' : screen}</div><h1>{screen === 'weekly' ? document?.info.title ?? 'No bulletin selected' : screen === 'templates' ? template.name : workspace.library?.name}</h1></div><div className="top-actions"><span className={`save-status ${statusIsError ? 'error' : ''}`}>{status}</span>{screen === 'weekly' && <>{document && <button className="danger-text" onClick={confirmBulletinDelete}>Delete</button>}<button className="secondary" onClick={() => startNew()}>New week</button><button type="button" className="primary" disabled={!window.bulletin || !document || exporting} onClick={() => void exportPdf()}>{exporting ? 'Preparing…' : window.bulletin?.platform === 'browser' ? 'Print / Save PDF' : 'Export PDF'}</button></>}</div></header>
      {screen === 'weekly' && document && <div className="weekly-layout"><section className="editor-pane"><WeeklyEditor document={document} library={workspace.library} root={workspace.root} relativePath={relativePath} onChange={changeDocument} onError={reportStatus} /></section><section className="preview-pane"><div className="preview-toolbar"><div><b>Print preview</b><span>{pageCount} pages · 7 × 8.5 in</span></div><div className={issues.length ? 'validation warning' : 'validation'}>{issues.length ? `${issues.length} item${issues.length === 1 ? '' : 's'} to finish` : '✓ Ready to export'}</div></div><DocumentView document={document} template={template} library={workspace.library} root={workspace.root} /></section></div>}
      {screen === 'weekly' && !document && <div className="empty-state"><span>◫</span><h2>No bulletins yet</h2><p>Create a bulletin from the current template when you’re ready to begin.</p><button className="primary" onClick={() => startNew()}>Create bulletin</button></div>}
      {screen === 'templates' && <div className="template-screen"><TemplateBuilder template={template} onChange={setTemplate} onSave={saveTemplate} onDelete={confirmTemplateDelete} canDelete={workspace.templates.length > 1 && Boolean(templatePath)} /><div className="builder-preview"><DocumentView document={document ?? createBulletin(template)} template={template} library={workspace.library} root={workspace.root} /></div></div>}
      {screen === 'library' && <LibraryView workspace={workspace} onError={reportStatus} onSave={async library => { if (!window.bulletin) return; try { await window.bulletin.saveLibrary(workspace.root, library); setWorkspace({ ...workspace, library }); reportStatus('Library saved'); } catch (error) { const message = error instanceof Error ? error.message : String(error); reportStatus(message); throw error; } }} />}
    </main>
    {statusIsError && <div className="error-toast" role="alert"><span>!</span><div><b>Something needs attention</b><p>{status}</p></div><button aria-label="Dismiss error" onClick={() => reportStatus('Ready')}>×</button></div>}
    {exportIssues.length > 0 && <div className="modal-backdrop" role="presentation"><section className="export-issues-modal" role="dialog" aria-modal="true" aria-labelledby="export-issues-title"><header><div><div className="eyebrow">Export checklist</div><h2 id="export-issues-title">Review {exportIssues.length} item{exportIssues.length === 1 ? '' : 's'}</h2></div><button aria-label="Close export checklist" onClick={() => setExportIssues([])}>×</button></header><div className="export-issue-list">{exportIssues.map((issue, index) => <div key={`${issue.path}-${index}`}><span>{index + 1}</span><div><b>{issue.message}</b><small>{issue.path}</small></div></div>)}</div><footer><p>You can return to the editor to fix these items, or export the current preview as it appears now.</p><div className="export-checklist-actions"><button className="secondary" onClick={() => setExportIssues([])}>Back to editor</button><button className="primary" onClick={() => void performExport()}>Export anyway</button></div></footer></section></div>}
    {confirmation && <ConfirmDialog confirmation={confirmation} onCancel={() => setConfirmation(undefined)} onConfirm={async () => { const action = confirmation.action; setConfirmation(undefined); await action(); }} />}
    {workspacePicker && <WorkspacePicker workspaces={availableWorkspaces} current={workspace.root} onClose={() => setWorkspacePicker(false)} onSelect={async root => { setWorkspacePicker(false); await loadWorkspace(root); }} onCreate={async name => { try { const root = await window.bulletin!.createWorkspace!(name); setAvailableWorkspaces(await window.bulletin!.listWorkspaces!()); setWorkspacePicker(false); await loadWorkspace(root); } catch (error) { reportStatus(error instanceof Error ? error.message : String(error)); } }} />}
  </div>;
}

function ConfirmDialog({ confirmation, onCancel, onConfirm }: { confirmation: Confirmation; onCancel(): void; onConfirm(): Promise<void> }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}><section className="confirmation-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title"><div className="eyebrow">Please confirm</div><h2 id="confirmation-title">{confirmation.title}</h2><p>{confirmation.message}</p><p>This action cannot be undone.</p><div><button className="secondary" autoFocus onClick={onCancel}>Cancel</button><button className="danger" onClick={() => void onConfirm()}>{confirmation.confirmLabel}</button></div></section></div>;
}

function WorkspacePicker({ workspaces, current, onClose, onSelect, onCreate }: { workspaces: Array<{ root: string; name: string }>; current: string; onClose(): void; onSelect(root: string): void; onCreate(name: string): void }) {
  const [name, setName] = useState('');
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="workspace-modal" role="dialog" aria-modal="true" aria-labelledby="workspace-title"><header><div><div className="eyebrow">Local storage</div><h2 id="workspace-title">Choose workspace</h2></div><button aria-label="Close" onClick={onClose}>×</button></header><div className="workspace-list">{workspaces.map(item => <button className={item.root === current ? 'selected' : ''} key={item.root} onClick={() => onSelect(item.root)}><span className="workspace-icon">⌂</span><span><b>{item.name}</b><small>{item.root === current ? 'Current workspace' : 'Stored in this browser'}</small></span>{item.root === current && <strong>✓</strong>}</button>)}</div><div className="new-workspace"><label>New workspace name<input autoFocus value={name} placeholder="e.g. Sunday Worship" onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && name.trim()) onCreate(name.trim()); }} /></label><button className="primary" disabled={!name.trim()} onClick={() => onCreate(name.trim())}>Create workspace</button></div></section></div>;
}

function LibraryView({ workspace, onSave, onError }: { workspace: WorkspaceSummary; onSave(library: LibraryManifestV1): Promise<void>; onError(message: string): void }) {
  const items = workspace.library?.items ?? [];
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{ id: string; title: string; kind: LibraryItemV1['kind']; text: string; notice: string; asset?: NonNullable<LibraryItemV1['assets']>[number] }>({ id: '', title: '', kind: 'song', text: '', notice: '' });
  const groups = useMemo(() => items.reduce<Record<string, typeof items>>((result, item) => {
    (result[item.kind] ??= []).push(item); return result;
  }, {}), [items]);
  const chooseAsset = async () => {
    if (!window.bulletin || !draft.id) return;
    try { const asset = await window.bulletin.importAsset(workspace.root, `assets/library/${draft.id}`); if (asset) setDraft({ ...draft, asset }); }
    catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  };
  const addItem = async () => {
    const id = draft.id || draft.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    if (!id || !draft.title.trim()) { onError('Enter a title and stable ID before saving the library item.'); return; }
    const version = Math.max(0, ...items.filter(item => item.id === id).map(item => item.version)) + 1;
    const item: LibraryItemV1 = { id, version, kind: draft.kind, title: draft.title,
      ...(draft.text ? { content: draft.text.split(/\n\s*\n/).map(text => ({ type: 'paragraph' as const, children: [{ type: 'text' as const, text: text.replace(/\n/g, ' ') }] })) } : {}),
      ...(draft.notice ? { license: { notice: draft.notice } } : {}), ...(draft.asset ? { assets: [draft.asset] } : {}) };
    try { await onSave({ ...(workspace.library ?? { schemaVersion: 1, name: 'Church Library' }), items: [...items, item] }); setAdding(false); setDraft({ id: '', title: '', kind: 'song', text: '', notice: '' }); }
    catch { /* The parent reports the actionable error. */ }
  };
  return <div className="library-screen"><div className="library-intro"><div><div className="eyebrow">Approved content</div><h2>{items.length} library items</h2><p>Songs, liturgy, artwork, fonts, and licensing metadata are versioned in the synced workspace.</p></div><div><button className="primary" onClick={() => setAdding(!adding)}>＋ Add library item</button><div className="library-path">{workspace.root}/library.json</div></div></div>{adding && <section className="editor-card library-form"><div className="field-row"><label>Title<input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value, id: draft.id || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-') })} /></label><label>Stable ID<input value={draft.id} onChange={e => setDraft({ ...draft, id: e.target.value })} /></label></div><label>Kind<select value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as LibraryItemV1['kind'] })}><option value="song">Song</option><option value="music">Music</option><option value="liturgy">Liturgy</option><option value="image">Image</option><option value="church-info">Church information</option><option value="font">Font</option></select></label><label>Structured text<textarea rows={6} value={draft.text} onChange={e => setDraft({ ...draft, text: e.target.value })} placeholder="Separate paragraphs or verses with a blank line" /></label><label>Copyright or license notice<textarea rows={3} value={draft.notice} onChange={e => setDraft({ ...draft, notice: e.target.value })} /></label><div className="builder-actions"><button className="secondary" disabled={!draft.id} onClick={chooseAsset}>{draft.asset ? draft.asset.alt : 'Attach image or PDF'}</button><button className="primary" onClick={addItem}>Save item</button></div></section>}{items.length === 0 ? <div className="empty-state"><span>▤</span><h2>Your shared library is ready</h2><p>Add the first reusable item above. Weekly editors will immediately offer songs and liturgy.</p></div> : Object.entries(groups).map(([kind, entries]) => <section className="library-group" key={kind}><h3>{kind}</h3>{entries?.map(item => <article key={`${item.id}-${item.version}`}><div><b>{item.title}</b><small>{item.id} · version {item.version}</small></div><span>{item.license ? 'Licensed' : 'No notice'}</span></article>)}</section>)}</div>;
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
