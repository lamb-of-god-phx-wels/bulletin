import { useEffect, useMemo, useRef, useState } from 'react';
import legacyExample from '../example_bulletin.json';
import { DocumentView } from './components/DocumentView';
import { WeeklyEditor } from './components/WeeklyEditor';
import { TemplateBuilder } from './components/TemplateBuilder';
import { createBulletin, defaultTemplate } from './shared/defaults';
import { migrateLegacyBulletin } from './shared/migrate';
import { paginate } from './shared/pagination';
import type { BulletinDocumentV1, LibraryItemV1, LibraryManifestV1, TemplateV1, WorkspaceSummary } from './shared/types';
import { validateBulletin } from './shared/validation';

type Screen = 'weekly' | 'templates' | 'library';

export default function App() {
  if (new URLSearchParams(location.search).get('print') === '1') return <PrintApp />;
  return <DesktopApp />;
}

function DesktopApp() {
  const [workspace, setWorkspace] = useState<WorkspaceSummary>();
  const [screen, setScreen] = useState<Screen>('weekly');
  const [document, setDocument] = useState<BulletinDocumentV1>();
  const [relativePath, setRelativePath] = useState('');
  const [template, setTemplate] = useState<TemplateV1>(defaultTemplate);
  const [status, setStatus] = useState('Ready');
  const dirty = useRef(false);
  const savedRevision = useRef(0);

  useEffect(() => {
    const root = localStorage.getItem('bulletin-workspace');
    if (root && window.bulletin) void loadWorkspace(root);
    else if (!window.bulletin) {
      const example = migrateLegacyBulletin(legacyExample);
      setWorkspace({ root: 'Browser demo', bulletins: [{ path: 'example_bulletin.json', document: example }], templates: [{ path: 'template.json', template: defaultTemplate }], library: { schemaVersion: 1, name: 'Demo library', items: [] } });
      openDocument(example, 'example_bulletin.json');
    }
  }, []);

  useEffect(() => {
    if (!dirty.current || !document || !workspace || !window.bulletin || !relativePath) return;
    setStatus('Saving…');
    const timer = setTimeout(() => {
      const expected = savedRevision.current;
      void window.bulletin!.saveBulletin(workspace.root, relativePath, document, expected).then(result => {
        savedRevision.current = result.revision; dirty.current = false;
        setDocument(current => current ? { ...current, revision: result.revision, updatedAt: result.updatedAt } : current);
        setStatus('Saved');
      }).catch(error => setStatus(error instanceof Error ? error.message : String(error)));
    }, 700);
    return () => clearTimeout(timer);
  }, [document, relativePath, workspace]);

  async function loadWorkspace(root: string) {
    if (!window.bulletin) return;
    try {
      const next = await window.bulletin.openWorkspace(root); setWorkspace(next); localStorage.setItem('bulletin-workspace', root);
      const selectedTemplate = [...next.templates].sort((a, b) => b.template.version - a.template.version)[0]?.template ?? defaultTemplate;
      setTemplate(selectedTemplate);
      const latest = [...next.bulletins].sort((a, b) => b.document.info.date.localeCompare(a.document.info.date))[0];
      if (latest) openDocument(latest.document, latest.path); else startNew(selectedTemplate);
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  }
  async function chooseWorkspace() { const root = await window.bulletin?.chooseWorkspace(); if (root) await loadWorkspace(root); }
  function openDocument(next: BulletinDocumentV1, path: string) { setDocument(next); setRelativePath(path); savedRevision.current = next.revision; dirty.current = false; setStatus('Saved'); setScreen('weekly'); }
  function startNew(from = template) { const next = createBulletin(from); openDocument(next, `bulletins/${next.info.date}/bulletin.json`); dirty.current = true; }
  function changeDocument(next: BulletinDocumentV1) { dirty.current = true; setStatus(window.bulletin ? 'Unsaved changes' : 'Browser preview'); setDocument(next); }
  async function exportPdf() {
    if (!document || !workspace || !window.bulletin) return;
    const issues = validateBulletin(document, workspace.library); if (issues.length) { setStatus(`${issues[0].path}: ${issues[0].message}`); return; }
    setStatus('Preparing PDF…');
    try { const output = await window.bulletin.exportPdf(workspace.root, relativePath, document); setStatus(output ? `Exported ${output}` : 'Export canceled'); } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  }
  async function saveTemplate(publish: boolean) {
    if (!workspace || !window.bulletin) return;
    const next = publish ? { ...template, status: 'published' as const, version: template.version + 1 } : { ...template, status: 'draft' as const };
    try { const path = await window.bulletin.saveTemplate(workspace.root, next); setTemplate(next); setStatus(`${publish ? 'Published' : 'Saved'} ${path}`); } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  }

  if (!workspace) return <div className="welcome-screen"><div className="brand-mark">✠</div><div className="eyebrow">Bulletin Builder</div><h1>Sunday’s bulletin,<br />without the busywork.</h1><p>Choose the folder your church already syncs with SharePoint. Templates, approved content, and weekly projects will live there together.</p><button className="primary large" onClick={chooseWorkspace}>Choose bulletin workspace</button><small>Windows and Arch Linux · local-first · no account required</small></div>;

  const pageCount = document ? paginate(document.blocks, template, workspace.library).length : 0;
  const issues = document ? validateBulletin(document, workspace.library) : [];
  return <div className="app-shell">
    <aside className="sidebar"><div className="app-brand"><span>✠</span><div><b>Bulletin</b><small>Builder</small></div></div><nav><button className={screen === 'weekly' ? 'active' : ''} onClick={() => setScreen('weekly')}><span>◫</span>This week</button><button className={screen === 'templates' ? 'active' : ''} onClick={() => setScreen('templates')}><span>◇</span>Templates</button><button className={screen === 'library' ? 'active' : ''} onClick={() => setScreen('library')}><span>▤</span>Library</button></nav><div className="recent"><div className="eyebrow">Recent bulletins</div>{workspace.bulletins.slice().sort((a, b) => b.document.info.date.localeCompare(a.document.info.date)).slice(0, 6).map(item => <button key={item.path} onClick={() => openDocument(item.document, item.path)}><b>{new Date(`${item.document.info.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</b><span>{item.document.info.title}</span></button>)}</div><div className="sidebar-bottom"><button onClick={chooseWorkspace}>⌂ Change workspace</button><span title={workspace.root}>{workspace.root}</span></div></aside>
    <main className="main-area">
      <header className="topbar"><div><div className="eyebrow">{screen === 'weekly' ? 'Weekly bulletin' : screen}</div><h1>{screen === 'weekly' ? document?.info.title : screen === 'templates' ? template.name : workspace.library?.name}</h1></div><div className="top-actions"><span className={`save-status ${status.includes('Conflict') || status.includes('required') ? 'error' : ''}`}>{status}</span>{screen === 'weekly' && <><button className="secondary" onClick={() => startNew()}>New week</button><button className="primary" disabled={!window.bulletin || !document} onClick={exportPdf}>Export PDF</button></>}</div></header>
      {screen === 'weekly' && document && <div className="weekly-layout"><section className="editor-pane"><WeeklyEditor document={document} library={workspace.library} root={workspace.root} relativePath={relativePath} onChange={changeDocument} /></section><section className="preview-pane"><div className="preview-toolbar"><div><b>Print preview</b><span>{pageCount} pages · 7 × 8.5 in</span></div><div className={issues.length ? 'validation warning' : 'validation'}>{issues.length ? `${issues.length} item${issues.length === 1 ? '' : 's'} to finish` : '✓ Ready to export'}</div></div><DocumentView document={document} template={template} library={workspace.library} root={workspace.root} /></section></div>}
      {screen === 'templates' && <div className="template-screen"><TemplateBuilder template={template} onChange={setTemplate} onSave={saveTemplate} /><div className="builder-preview"><DocumentView document={document ?? createBulletin(template)} template={template} library={workspace.library} root={workspace.root} /></div></div>}
      {screen === 'library' && <LibraryView workspace={workspace} onSave={async library => { if (!window.bulletin) return; await window.bulletin.saveLibrary(workspace.root, library); setWorkspace({ ...workspace, library }); setStatus('Library saved'); }} />}
    </main>
  </div>;
}

function LibraryView({ workspace, onSave }: { workspace: WorkspaceSummary; onSave(library: LibraryManifestV1): Promise<void> }) {
  const items = workspace.library?.items ?? [];
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{ id: string; title: string; kind: LibraryItemV1['kind']; text: string; notice: string; asset?: NonNullable<LibraryItemV1['assets']>[number] }>({ id: '', title: '', kind: 'song', text: '', notice: '' });
  const groups = useMemo(() => items.reduce<Record<string, typeof items>>((result, item) => {
    (result[item.kind] ??= []).push(item); return result;
  }, {}), [items]);
  const chooseAsset = async () => {
    if (!window.bulletin || !draft.id) return;
    const asset = await window.bulletin.importAsset(workspace.root, `assets/library/${draft.id}`);
    if (asset) setDraft({ ...draft, asset });
  };
  const addItem = async () => {
    const id = draft.id || draft.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    if (!id || !draft.title) return;
    const version = Math.max(0, ...items.filter(item => item.id === id).map(item => item.version)) + 1;
    const item: LibraryItemV1 = { id, version, kind: draft.kind, title: draft.title,
      ...(draft.text ? { content: draft.text.split(/\n\s*\n/).map(text => ({ type: 'paragraph' as const, children: [{ type: 'text' as const, text: text.replace(/\n/g, ' ') }] })) } : {}),
      ...(draft.notice ? { license: { notice: draft.notice } } : {}), ...(draft.asset ? { assets: [draft.asset] } : {}) };
    await onSave({ ...(workspace.library ?? { schemaVersion: 1, name: 'Church Library' }), items: [...items, item] });
    setAdding(false); setDraft({ id: '', title: '', kind: 'song', text: '', notice: '' });
  };
  return <div className="library-screen"><div className="library-intro"><div><div className="eyebrow">Approved content</div><h2>{items.length} library items</h2><p>Songs, liturgy, artwork, fonts, and licensing metadata are versioned in the synced workspace.</p></div><div><button className="primary" onClick={() => setAdding(!adding)}>＋ Add library item</button><div className="library-path">{workspace.root}/library.json</div></div></div>{adding && <section className="editor-card library-form"><div className="field-row"><label>Title<input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value, id: draft.id || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-') })} /></label><label>Stable ID<input value={draft.id} onChange={e => setDraft({ ...draft, id: e.target.value })} /></label></div><label>Kind<select value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as LibraryItemV1['kind'] })}><option value="song">Song</option><option value="music">Music</option><option value="liturgy">Liturgy</option><option value="image">Image</option><option value="church-info">Church information</option><option value="font">Font</option></select></label><label>Structured text<textarea rows={6} value={draft.text} onChange={e => setDraft({ ...draft, text: e.target.value })} placeholder="Separate paragraphs or verses with a blank line" /></label><label>Copyright or license notice<textarea rows={3} value={draft.notice} onChange={e => setDraft({ ...draft, notice: e.target.value })} /></label><div className="builder-actions"><button className="secondary" disabled={!draft.id} onClick={chooseAsset}>{draft.asset ? draft.asset.alt : 'Attach image or PDF'}</button><button className="primary" onClick={addItem}>Save item</button></div></section>}{items.length === 0 ? <div className="empty-state"><span>▤</span><h2>Your shared library is ready</h2><p>Add the first reusable item above. Weekly editors will immediately offer songs and liturgy.</p></div> : Object.entries(groups).map(([kind, entries]) => <section className="library-group" key={kind}><h3>{kind}</h3>{entries?.map(item => <article key={`${item.id}-${item.version}`}><div><b>{item.title}</b><small>{item.id} · version {item.version}</small></div><span>{item.license ? 'Licensed' : 'No notice'}</span></article>)}</section>)}</div>;
}

function PrintApp() {
  const [job, setJob] = useState<{ root: string; document: BulletinDocumentV1 }>();
  const [workspace, setWorkspace] = useState<WorkspaceSummary>();
  useEffect(() => { void window.bulletin?.getPrintJob().then(value => { const next = value as typeof job; if (!next) return; setJob(next); return window.bulletin!.openWorkspace(next.root).then(setWorkspace); }); }, []);
  if (!job || !workspace) return <div>Preparing print layout…</div>;
  const template = workspace.templates.find(item => item.template.id === job.document.template.id && item.template.version === job.document.template.version)?.template ?? defaultTemplate;
  return <DocumentView document={job.document} template={template} library={workspace.library} root={job.root} print onReady={() => window.bulletin?.printReady()} />;
}
