import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react';
import { imageFolderAncestors, imageFolderDescendantIds, imageFolderNameAvailable } from '../shared/images.js';
import { randomId } from '../shared/id.js';
import {
  libraryRecordIcon,
  libraryRecordTypeLabel,
  setCatalogEntry,
  type LibraryCatalogRecord,
  type LibraryRecordType
} from '../shared/libraryCatalog.js';
import type { LibraryManifestV1 } from '../shared/types.js';

const builtinsFolder = '__builtins__';
const locationKey = (root: string) => `bulletin-library-folder:${root}`;
const viewKey = (root: string) => `bulletin-library-view:${root}`;
const browseModeKey = (root: string) => `bulletin-library-browse-mode:${root}`;
const filterKey = (root: string) => `bulletin-library-filter:${root}`;

function ImageThumbnail({ root, record }: { root: string; record: LibraryCatalogRecord }) {
  const host = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [source, setSource] = useState('');
  const family = record.value as { versions?: Array<{ assets?: Array<{ path: string }> }> };
  const path = family.versions?.[0]?.assets?.[0]?.path;
  useEffect(() => {
    if (!host.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setVisible(true);
    }, { rootMargin: '160px' });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !path || !window.bulletin) return;
    let active = true;
    void window.bulletin.readAsset(root, path).then(value => {
      if (active) setSource(value);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [root, path, visible]);
  return <span ref={host} className="library-record-thumbnail">
    {source ? <img src={source} alt="" loading="lazy" /> : <span>{libraryRecordIcon.image}</span>}
  </span>;
}

function Tree({ library, parentId, current, onOpen }: { library: LibraryManifestV1; parentId?: string; current?: string; onOpen(id?: string): void }) {
  const children = (library.folders ?? []).filter(folder => folder.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name));
  if (!children.length) return null;
  return <ul>{children.map(folder => <li key={folder.id}>
    <button className={current === folder.id ? 'active' : ''} onClick={() => onOpen(folder.id)}><span>▸</span>{folder.name}</button>
    <Tree library={library} parentId={folder.id} current={current} onOpen={onOpen} />
  </li>)}</ul>;
}

export function LibraryBrowserDialog({
  library,
  root,
  records,
  title = 'Library',
  allowedTypes,
  manage = false,
  embedded = false,
  actions,
  onLibraryChange,
  onSelect,
  onOpen,
  onDelete,
  onCreate,
  onClose
}: {
  library: LibraryManifestV1;
  root: string;
  records: LibraryCatalogRecord[];
  title?: string;
  allowedTypes?: LibraryRecordType[];
  manage?: boolean;
  embedded?: boolean;
  actions?: ReactNode;
  onLibraryChange(library: LibraryManifestV1): Promise<void>;
  onSelect?(record: LibraryCatalogRecord): void;
  onOpen?(record: LibraryCatalogRecord): void;
  onDelete?(records: LibraryCatalogRecord[], folderIds: string[]): Promise<void>;
  onCreate?(type: LibraryRecordType | 'folder', folderId?: string): void;
  onClose?(): void;
}) {
  const validStoredFolder = () => {
    const stored = localStorage.getItem(locationKey(root));
    return stored && (stored === builtinsFolder || library.folders?.some(folder => folder.id === stored)) ? stored : undefined;
  };
  const fixedTypes = allowedTypes?.length ? new Set(allowedTypes) : undefined;
  const [folderId, setFolderId] = useState<string | undefined>(validStoredFolder);
  const [view, setView] = useState<'thumbnails' | 'list'>(() => localStorage.getItem(viewKey(root)) === 'list' ? 'list' : 'thumbnails');
  const [browseMode, setBrowseMode] = useState<'folders' | 'all'>(() => localStorage.getItem(browseModeKey(root)) === 'all' ? 'all' : 'folders');
  const [filter, setFilter] = useState<LibraryRecordType | 'all'>(() => {
    const stored = localStorage.getItem(filterKey(root)) as LibraryRecordType | null;
    return stored && libraryRecordTypeLabel[stored] && (!fixedTypes || fixedTypes.has(stored)) ? stored : 'all';
  });
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cut, setCut] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string>();
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [folderError, setFolderError] = useState('');
  const [namingKey, setNamingKey] = useState<string>();
  const folders = library.folders ?? [];
  const types = Object.keys(libraryRecordTypeLabel) as LibraryRecordType[];
  const activeFilter = fixedTypes?.size === 1 ? [...fixedTypes][0] : filter;
  const descendantIds = folderId && folderId !== builtinsFolder ? imageFolderDescendantIds(library, folderId) : new Set<string>();
  const searching = Boolean(search.trim());
  const visibleFolders = browseMode === 'all' || searching || folderId === builtinsFolder ? [] : folders.filter(folder => folder.parentId === folderId).sort((a, b) => a.name.localeCompare(b.name));
  const visibleRecords = records.filter(record => {
    if (browseMode === 'folders' && (folderId === builtinsFolder ? !record.builtin : record.builtin)) return false;
    const inFolder = browseMode === 'all' || (searching
      ? !folderId || record.folderId === folderId || Boolean(record.folderId && descendantIds.has(record.folderId))
      : record.folderId === folderId);
    const typeAllowed = (!fixedTypes || fixedTypes.has(record.type)) && (activeFilter === 'all' || record.type === activeFilter);
    return inFolder && typeAllowed && (!searching || `${record.title} ${record.sourceTitle} ${record.targetId}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  });
  const keys = [...visibleFolders.map(folder => `folder:${folder.id}`), ...visibleRecords.map(record => record.key)];

  const openFolder = (next?: string) => {
    setFolderId(next); setSelected(new Set()); setAnchor(undefined);
    if (next) localStorage.setItem(locationKey(root), next); else localStorage.removeItem(locationKey(root));
  };
  const choose = (key: string, event: MouseEvent) => {
    if (!manage) { setSelected(new Set([key])); return; }
    if (event.shiftKey && anchor && keys.includes(anchor)) {
      const [start, end] = [keys.indexOf(anchor), keys.indexOf(key)].sort((a, b) => a - b);
      setSelected(new Set(keys.slice(start, end + 1)));
    } else if (event.ctrlKey || event.metaKey) {
      setSelected(current => { const next = new Set(current); next.has(key) ? next.delete(key) : next.add(key); return next; });
      setAnchor(key);
    } else { setSelected(new Set([key])); setAnchor(key); }
  };
  const moveKeys = async (moving: Set<string>, destination?: string) => {
    const folderIds = [...moving].filter(key => key.startsWith('folder:')).map(key => key.slice(7));
    if (folderIds.some(id => id === destination || imageFolderDescendantIds(library, id).has(destination ?? ''))) return;
    const recordKeys = new Set([...moving].filter(key => !key.startsWith('folder:')));
    let next: LibraryManifestV1 = {
      ...library,
      folders: folders.map(folder => folderIds.includes(folder.id) ? { ...folder, parentId: destination } : folder)
    };
    for (const record of records.filter(item => recordKeys.has(item.key) && !item.builtin)) {
      next = setCatalogEntry(next, {
        targetKind: record.targetKind, targetId: record.targetId, folderId: destination,
        displayName: library.catalog?.find(entry => entry.targetKind === record.targetKind && entry.targetId === record.targetId)?.displayName
      });
    }
    await onLibraryChange(next); setSelected(new Set()); setCut(new Set());
  };
  const beginDrag = (key: string, event: DragEvent) => {
    if (!manage || key.startsWith('builtin:')) return;
    const moving = selected.has(key) ? selected : new Set([key]);
    setSelected(moving);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-bulletin-library-keys', JSON.stringify([...moving]));
  };
  const dropInto = (destination: string | undefined, event: DragEvent) => {
    if (!manage) return;
    event.preventDefault();
    try {
      const keys = JSON.parse(event.dataTransfer.getData('application/x-bulletin-library-keys')) as string[];
      if (Array.isArray(keys) && keys.length) void moveKeys(new Set(keys), destination);
    } catch { /* Ignore drags from outside the library. */ }
  };
  const createFolder = async () => {
    const name = newFolderName.trim();
    if (!name) { setFolderError('Enter a name.'); return; }
    if (namingKey?.startsWith('folder:')) {
      const folder = folders.find(item => item.id === namingKey.slice(7));
      if (!folder) return;
      if (!imageFolderNameAvailable(library, name, folder.parentId, folder.id)) { setFolderError('A folder with that name already exists here.'); return; }
      await onLibraryChange({ ...library, folders: folders.map(item => item.id === folder.id ? { ...item, name } : item) });
      setCreatingFolder(false); setNewFolderName(''); setFolderError(''); setNamingKey(undefined); return;
    }
    if (namingKey) {
      const record = records.find(item => item.key === namingKey);
      if (!record || record.builtin) return;
      await onLibraryChange(setCatalogEntry(library, { targetKind: record.targetKind, targetId: record.targetId, folderId: record.folderId, displayName: name }));
      setCreatingFolder(false); setNewFolderName(''); setFolderError(''); setNamingKey(undefined); return;
    }
    if (!imageFolderNameAvailable(library, name, folderId)) { setFolderError('A folder with that name already exists here.'); return; }
    await onLibraryChange({ ...library, folders: [...folders, { id: `library-folder-${randomId()}`, name, ...(folderId ? { parentId: folderId } : {}) }] });
    setCreatingFolder(false); setNewFolderName(''); setFolderError(''); setNamingKey(undefined);
  };
  const rename = () => {
    if (selected.size !== 1) return;
    const key = [...selected][0];
    if (key.startsWith('folder:')) {
      const folder = folders.find(item => item.id === key.slice(7)); if (!folder) return;
      setNewFolderName(folder.name);
    } else {
      const record = records.find(item => item.key === key); if (!record || record.builtin) return;
      setNewFolderName(record.title);
    }
    setNamingKey(key); setFolderError(''); setCreatingFolder(true);
  };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
      if (event.key.toLocaleLowerCase() === 'x' && manage && selected.size) { event.preventDefault(); setCut(new Set(selected)); }
      if (event.key.toLocaleLowerCase() === 'v' && manage && cut.size && browseMode === 'folders' && folderId !== builtinsFolder) { event.preventDefault(); void moveKeys(cut, folderId); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selected, cut, folderId, browseMode, library, records]);
  const path = folderId && folderId !== builtinsFolder ? imageFolderAncestors(library, folderId) : [];
  const selectedRecord = selected.size === 1 ? records.find(record => record.key === [...selected][0]) : undefined;
  const content = <section className={`library-browser ${embedded ? 'embedded' : ''} ${browseMode === 'all' ? 'all-mode' : ''}`} role={embedded ? undefined : 'dialog'} aria-modal={embedded ? undefined : true}>
    <header><div><div className="eyebrow">{manage ? 'Synchronized reusable records' : 'Choose reusable content'}</div><h2>{title}</h2></div>{onClose && <button aria-label="Close library" onClick={onClose}>×</button>}</header>
    <div className="library-browser-toolbar">
      {manage && <><button className="secondary" onClick={() => { setNamingKey(undefined); setNewFolderName(''); setFolderError(''); setCreatingFolder(true); }}>＋ Folder</button><label>New<select value="" onChange={event => { const type = event.target.value as LibraryRecordType; if (type) onCreate?.(type, browseMode === 'folders' ? folderId : undefined); }}><option value="">Choose type…</option>{types.map(type => <option value={type} key={type}>{libraryRecordTypeLabel[type]}</option>)}</select></label><button className="secondary" disabled={selected.size !== 1 || selectedRecord?.builtin} onClick={rename}>Rename</button><label>Move to<select value="" disabled={!selected.size} onChange={event => { if (event.target.value) void moveKeys(selected, event.target.value === '__root__' ? undefined : event.target.value); }}><option value="">Choose…</option><option value="__root__">Library root</option>{folders.map(folder => <option value={folder.id} key={folder.id}>{' '.repeat(imageFolderAncestors(library, folder.id).length * 2)}{folder.name}</option>)}</select></label><button className="danger-text" disabled={!selected.size || [...selected].some(key => records.find(record => record.key === key)?.builtin)} onClick={() => void onDelete?.(records.filter(record => selected.has(record.key)), [...selected].filter(key => key.startsWith('folder:')).map(key => key.slice(7)))}>Delete</button></>}
      {actions}<span /><div className="library-browse-mode" role="radiogroup" aria-label="Library organization"><button role="radio" aria-checked={browseMode === 'folders'} className={browseMode === 'folders' ? 'active' : ''} onClick={() => { setBrowseMode('folders'); localStorage.setItem(browseModeKey(root), 'folders'); setSelected(new Set()); }}>Folder view</button><button role="radio" aria-checked={browseMode === 'all'} className={browseMode === 'all' ? 'active' : ''} onClick={() => { setBrowseMode('all'); localStorage.setItem(browseModeKey(root), 'all'); setSelected(new Set()); }}>All</button></div><button className={view === 'thumbnails' ? 'active' : ''} aria-label="Thumbnail view" onClick={() => { setView('thumbnails'); localStorage.setItem(viewKey(root), 'thumbnails'); }}>▦</button><button className={view === 'list' ? 'active' : ''} aria-label="List view" onClick={() => { setView('list'); localStorage.setItem(viewKey(root), 'list'); }}>☷</button>
    </div>
    <div className="library-browser-body">
      <aside onDragOver={event => { if (manage) event.preventDefault(); }} onDrop={event => dropInto(undefined, event)}><button className={!folderId ? 'active' : ''} onClick={() => openFolder(undefined)}>▾ Library</button><Tree library={library} current={folderId} onOpen={openFolder} /><button className={folderId === builtinsFolder ? 'active builtin' : 'builtin'} onClick={() => openFolder(builtinsFolder)}>◇ Built-ins</button></aside>
      <main onDragOver={event => { if (manage && folderId !== builtinsFolder) event.preventDefault(); }} onDrop={event => dropInto(folderId === builtinsFolder ? undefined : folderId, event)}>
        <div className="library-browser-path">{browseMode === 'all' ? <b>All library items</b> : <><button onClick={() => openFolder(undefined)}>Library</button>{folderId === builtinsFolder ? <span>› Built-ins</span> : path.map(folder => <span key={folder.id}>› <button onClick={() => openFolder(folder.id)}>{folder.name}</button></span>)}</>}<input type="search" placeholder={browseMode === 'all' ? 'Search all library items' : 'Search this folder tree'} value={search} onChange={event => setSearch(event.target.value)} /></div>
        {!fixedTypes?.size || fixedTypes.size > 1 ? <div className="library-type-filters"><button className={activeFilter === 'all' ? 'active' : ''} onClick={() => { setFilter('all'); localStorage.removeItem(filterKey(root)); }}>All</button>{types.filter(type => !fixedTypes || fixedTypes.has(type)).map(type => <button className={activeFilter === type ? 'active' : ''} onClick={() => { setFilter(type); localStorage.setItem(filterKey(root), type); }} key={type}>{libraryRecordTypeLabel[type]}</button>)}</div> : <div className="library-type-filters locked"><b>{libraryRecordTypeLabel[[...fixedTypes][0]]}</b></div>}
        <div className={`library-record-entries ${view}`}>
          {visibleFolders.map(folder => { const key = `folder:${folder.id}`; return <button draggable={manage} onDragStart={event => beginDrag(key, event)} onDragOver={event => { if (manage) { event.preventDefault(); event.stopPropagation(); } }} onDrop={event => { event.stopPropagation(); dropInto(folder.id, event); }} className={`${selected.has(key) ? 'selected' : ''} ${cut.has(key) ? 'cut' : ''}`} key={key} onClick={event => choose(key, event)} onDoubleClick={() => openFolder(folder.id)}><span className="library-record-icon folder">📁</span><b>{folder.name}</b><small>Folder</small></button>; })}
          {visibleRecords.map(record => <button draggable={browseMode === 'folders' && manage && !record.builtin} onDragStart={event => beginDrag(record.key, event)} className={`${selected.has(record.key) ? 'selected' : ''} ${cut.has(record.key) ? 'cut' : ''}`} key={record.key} onClick={event => choose(record.key, event)} onDoubleClick={() => manage ? onOpen?.(record) : onSelect?.(record)}>{record.type === 'image' ? <ImageThumbnail root={root} record={record} /> : <span className="library-record-icon">{libraryRecordIcon[record.type]}</span>}<b>{record.title}</b><small>{libraryRecordTypeLabel[record.type]}{record.version ? ` · v${record.version}` : ''}{record.versionCount > 1 ? ` · ${record.versionCount} versions` : ''}{(browseMode === 'all' || searching) ? ` · ${record.builtin ? 'Built-ins' : record.folderId ? imageFolderAncestors(library, record.folderId).map(item => item.name).join(' / ') : 'Library'}` : ''}</small></button>)}
          {!visibleFolders.length && !visibleRecords.length && <p className="image-library-empty">No matching reusable records here.</p>}
        </div>
      </main>
    </div>
    <footer><span>{cut.size ? `${cut.size} cut · open a folder and press Ctrl+V` : selected.size ? `${selected.size} selected` : `${visibleRecords.length} record${visibleRecords.length === 1 ? '' : 's'}`}</span><div>{onClose && <button className="secondary" onClick={onClose}>Cancel</button>}{!manage && <button className="primary" disabled={!selectedRecord} onClick={() => selectedRecord && onSelect?.(selectedRecord)}>Choose</button>}</div></footer>
    {creatingFolder && <div className="library-folder-dialog" role="dialog" aria-modal="true" aria-labelledby="new-library-folder-title"><form onSubmit={event => { event.preventDefault(); void createFolder(); }}><h3 id="new-library-folder-title">{namingKey ? 'Rename item' : 'New folder'}</h3><label>{namingKey ? 'Name' : 'Folder name'}<input autoFocus value={newFolderName} onChange={event => { setNewFolderName(event.target.value); setFolderError(''); }} /></label>{folderError && <p className="field-error" role="alert">{folderError}</p>}<div><button type="button" className="secondary" onClick={() => setCreatingFolder(false)}>Cancel</button><button type="submit" className="primary">{namingKey ? 'Rename' : 'Create folder'}</button></div></form></div>}
  </section>;
  return embedded ? content : <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose?.(); }}>{content}</div>;
}
