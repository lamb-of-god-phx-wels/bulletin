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
const createTypeDescription: Record<LibraryRecordType, string> = {
  song: 'Lyrics, music, and presentation assets.',
  liturgy: 'Reusable service and worship text.',
  image: 'Artwork and photographs for bulletins.',
  font: 'A font available throughout the workspace.',
  'church-info': 'Reusable church contact information.',
  component: 'A reusable native content element.',
  'page-template': 'A reusable page design.',
  template: 'A reusable multi-page bulletin layout.'
};

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

function Tree({ library, parentId, current, onOpen, onContextMenu }: { library: LibraryManifestV1; parentId?: string; current?: string; onOpen(id?: string): void; onContextMenu?(id: string, event: MouseEvent): void }) {
  const children = (library.folders ?? []).filter(folder => folder.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name));
  if (!children.length) return null;
  return <ul>{children.map(folder => <li key={folder.id}>
    <button className={current === folder.id ? 'active' : ''} title={`${folder.name}\nFolder ID: ${folder.id}`} onClick={() => onOpen(folder.id)} onContextMenu={event => onContextMenu?.(folder.id, event)}><span>▸</span>{folder.name}</button>
    <Tree library={library} parentId={folder.id} current={current} onOpen={onOpen} onContextMenu={onContextMenu} />
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
  onCopy,
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
  onCopy?(records: LibraryCatalogRecord[], folderIds: string[], destinationFolderId?: string): Promise<void>;
  onCreate?(type: LibraryRecordType | 'folder', folderId?: string): void;
  onClose?(): void;
}) {
  const validStoredFolder = () => {
    const stored = localStorage.getItem(locationKey(root));
    return stored && (stored === builtinsFolder || library.folders?.some(folder => folder.id === stored)) ? stored : undefined;
  };
  const fixedTypes = allowedTypes?.length ? new Set(allowedTypes) : undefined;
  const [folderId, setFolderId] = useState<string | undefined>(validStoredFolder);
  const [backLocations, setBackLocations] = useState<Array<string | undefined>>([]);
  const [forwardLocations, setForwardLocations] = useState<Array<string | undefined>>([]);
  const [view, setView] = useState<'thumbnails' | 'list'>(() => localStorage.getItem(viewKey(root)) === 'list' ? 'list' : 'thumbnails');
  const [browseMode, setBrowseMode] = useState<'folders' | 'all'>(() => localStorage.getItem(browseModeKey(root)) === 'all' ? 'all' : 'folders');
  const [filter, setFilter] = useState<LibraryRecordType | 'all'>(() => {
    const stored = localStorage.getItem(filterKey(root)) as LibraryRecordType | null;
    return stored && libraryRecordTypeLabel[stored] && (!fixedTypes || fixedTypes.has(stored)) ? stored : 'all';
  });
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cut, setCut] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string>();
  const [focusedKey, setFocusedKey] = useState<string>();
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [choosingCreateType, setChoosingCreateType] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [folderError, setFolderError] = useState('');
  const [namingKey, setNamingKey] = useState<string>();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; keys: string[]; background?: boolean }>();
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const entriesRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const typeaheadRef = useRef('');
  const typeaheadTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const folders = library.folders ?? [];
  const types = Object.keys(libraryRecordTypeLabel) as LibraryRecordType[];
  const availableTypes = types.filter(type => !fixedTypes || fixedTypes.has(type));
  const creationFolderId = browseMode === 'folders' && folderId !== builtinsFolder ? folderId : undefined;
  const beginCreate = () => {
    if (!onCreate || !availableTypes.length) return;
    if (availableTypes.length === 1) onCreate(availableTypes[0], creationFolderId);
    else setChoosingCreateType(true);
  };
  const beginNewFolder = () => {
    if (!manage || folderId === builtinsFolder) return;
    setNamingKey(undefined); setNewFolderName(''); setFolderError(''); setCreatingFolder(true);
  };
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
  const keysSignature = keys.join('\u0000');

  const applyFolder = (next?: string) => {
    setFolderId(next); setSelected(new Set()); setAnchor(undefined); setFocusedKey(undefined);
    if (next) localStorage.setItem(locationKey(root), next); else localStorage.removeItem(locationKey(root));
  };
  const openFolder = (next?: string) => {
    if (next === folderId) return;
    setBackLocations(current => [...current, folderId]);
    setForwardLocations([]);
    applyFolder(next);
  };
  const goBack = () => {
    if (!backLocations.length || browseMode === 'all') return;
    const previous = backLocations.at(-1);
    setBackLocations(current => current.slice(0, -1));
    setForwardLocations(current => [...current, folderId]);
    applyFolder(previous);
  };
  const goForward = () => {
    if (!forwardLocations.length || browseMode === 'all') return;
    const next = forwardLocations.at(-1);
    setForwardLocations(current => current.slice(0, -1));
    setBackLocations(current => [...current, folderId]);
    applyFolder(next);
  };
  const goUp = () => {
    if (!folderId || browseMode === 'all') return;
    openFolder(folderId === builtinsFolder ? undefined : folders.find(folder => folder.id === folderId)?.parentId);
  };
  const choose = (key: string, event: MouseEvent) => {
    if (!manage) { setSelected(new Set([key])); setAnchor(key); setFocusedKey(key); return; }
    if (event.shiftKey && anchor && keys.includes(anchor)) {
      const [start, end] = [keys.indexOf(anchor), keys.indexOf(key)].sort((a, b) => a - b);
      setSelected(new Set(keys.slice(start, end + 1)));
      setFocusedKey(key);
    } else if (event.ctrlKey || event.metaKey) {
      setSelected(current => { const next = new Set(current); next.has(key) ? next.delete(key) : next.add(key); return next; });
      setAnchor(key); setFocusedKey(key);
    } else { setSelected(new Set([key])); setAnchor(key); setFocusedKey(key); }
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
    await onLibraryChange(next); setSelected(new Set()); setCut(new Set()); setCopied(new Set());
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
    if (!imageFolderNameAvailable(library, name, creationFolderId)) { setFolderError('A folder with that name already exists here.'); return; }
    await onLibraryChange({ ...library, folders: [...folders, { id: `library-folder-${randomId()}`, name, ...(creationFolderId ? { parentId: creationFolderId } : {}) }] });
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
  const deleteKeys = (keys: Set<string>) => onDelete?.(
    records.filter(record => keys.has(record.key)),
    [...keys].filter(key => key.startsWith('folder:')).map(key => key.slice(7))
  );
  const openKey = (key: string) => {
    if (key.startsWith('folder:')) { openFolder(key.slice(7)); return; }
    const record = records.find(item => item.key === key);
    if (record) manage ? onOpen?.(record) : onSelect?.(record);
  };
  const focusKey = (key: string) => requestAnimationFrame(() => {
    const element = entriesRef.current?.querySelector<HTMLElement>(`[data-library-key="${CSS.escape(key)}"]`);
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  const moveKeyboardToIndex = (index: number, extend: boolean, preserveSelection: boolean) => {
    if (!keys.length) return;
    const nextIndex = Math.max(0, Math.min(keys.length - 1, index));
    const nextKey = keys[nextIndex];
    if (extend && manage && anchor && keys.includes(anchor)) {
      const [start, end] = [keys.indexOf(anchor), nextIndex].sort((a, b) => a - b);
      setSelected(new Set(keys.slice(start, end + 1)));
    } else if (!preserveSelection) {
      setSelected(new Set([nextKey]));
      setAnchor(nextKey);
    }
    setFocusedKey(nextKey);
    focusKey(nextKey);
  };
  const moveKeyboardSelection = (direction: 'left' | 'right' | 'up' | 'down', extend: boolean, preserveSelection: boolean) => {
    if (!keys.length) return;
    const currentKey = focusedKey && keys.includes(focusedKey) ? focusedKey : [...selected].find(key => keys.includes(key));
    const currentIndex = currentKey ? keys.indexOf(currentKey) : -1;
    const columns = view === 'list'
      ? 1
      : Math.max(1, entriesRef.current ? getComputedStyle(entriesRef.current).gridTemplateColumns.split(' ').filter(Boolean).length : 1);
    const offset = direction === 'left' ? -1 : direction === 'right' ? 1 : direction === 'up' ? -columns : columns;
    const nextIndex = currentIndex < 0
      ? 0
      : Math.max(0, Math.min(keys.length - 1, currentIndex + offset));
    moveKeyboardToIndex(nextIndex, extend, preserveSelection);
  };
  const openContextMenu = (key: string | undefined, event: MouseEvent) => {
    event.preventDefault(); event.stopPropagation();
    if (!manage && !key) return;
    const keys = key ? (selected.has(key) ? [...selected] : [key]) : [];
    if (key && !selected.has(key)) { setSelected(new Set([key])); setAnchor(key); setFocusedKey(key); }
    setContextMenu({ x: Math.min(event.clientX, window.innerWidth - 224), y: Math.min(event.clientY, window.innerHeight - 300), keys, background: !key });
  };
  const closeContextMenu = () => setContextMenu(undefined);
  const openKeyboardContextMenu = () => {
    const key = focusedKey && keys.includes(focusedKey) ? focusedKey : [...selected].find(item => keys.includes(item));
    if (!key) return;
    const element = entriesRef.current?.querySelector<HTMLElement>(`[data-library-key="${CSS.escape(key)}"]`);
    const rect = element?.getBoundingClientRect();
    const contextKeys = selected.has(key) ? [...selected] : [key];
    if (!selected.has(key)) { setSelected(new Set([key])); setAnchor(key); setFocusedKey(key); }
    setContextMenu({
      x: Math.min(rect?.left ?? 16, window.innerWidth - 224),
      y: Math.min(rect?.bottom ?? 16, window.innerHeight - 300),
      keys: contextKeys
    });
  };
  const contextAction = (action: () => void | Promise<void>) => {
    closeContextMenu();
    void action();
  };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const editingField = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement;
      const protectedSelection = [...selected].some(key => records.find(record => record.key === key)?.builtin);
      const commandKey = event.ctrlKey || event.metaKey;
      if (event.key === 'Escape') {
        if (contextMenu) { event.preventDefault(); closeContextMenu(); return; }
        if (creatingFolder) { event.preventDefault(); setCreatingFolder(false); return; }
        if (choosingCreateType) { event.preventDefault(); setChoosingCreateType(false); return; }
        if (editingField) return;
        event.preventDefault();
        if (cut.size || copied.size) { setCut(new Set()); setCopied(new Set()); }
        else { setSelected(new Set()); setAnchor(undefined); setFocusedKey(undefined); }
        return;
      }
      if (!editingField && event.altKey && !commandKey) {
        if (event.key === 'ArrowLeft') { event.preventDefault(); goBack(); return; }
        if (event.key === 'ArrowRight') { event.preventDefault(); goForward(); return; }
        if (event.key === 'ArrowUp') { event.preventDefault(); goUp(); return; }
      }
      if (!editingField && event.key === 'Backspace' && !commandKey && !event.altKey) {
        event.preventDefault(); goUp(); return;
      }
      if (!editingField && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
        event.preventDefault(); openKeyboardContextMenu(); return;
      }
      if (!editingField && (event.key === 'Home' || event.key === 'End')) {
        event.preventDefault();
        moveKeyboardToIndex(event.key === 'Home' ? 0 : keys.length - 1, event.shiftKey, manage && commandKey);
        return;
      }
      if (!editingField && !event.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        moveKeyboardSelection(
          event.key.slice(5).toLocaleLowerCase() as 'left' | 'right' | 'up' | 'down',
          event.shiftKey,
          manage && commandKey
        );
        return;
      }
      if (!editingField && (event.key === ' ' || event.key === 'Spacebar')) {
        const key = focusedKey && keys.includes(focusedKey) ? focusedKey : keys[0];
        if (!key) return;
        event.preventDefault();
        if (manage && event.shiftKey && anchor && keys.includes(anchor)) {
          const [start, end] = [keys.indexOf(anchor), keys.indexOf(key)].sort((a, b) => a - b);
          setSelected(new Set(keys.slice(start, end + 1)));
        } else if (manage && commandKey) {
          setSelected(current => {
            const next = new Set(current);
            next.has(key) ? next.delete(key) : next.add(key);
            return next;
          });
          setAnchor(key);
        } else {
          setSelected(new Set([key]));
          setAnchor(key);
        }
        setFocusedKey(key);
        return;
      }
      if (event.key === 'Enter' && selected.size === 1 && !editingField) {
        event.preventDefault(); openKey([...selected][0]); return;
      }
      if (event.key === 'Delete' && manage && onDelete && selected.size && !editingField && !protectedSelection) {
        event.preventDefault(); void deleteKeys(selected); return;
      }
      if (event.key === 'F2' && manage && selected.size === 1 && !editingField && ![...selected].some(key => records.find(record => record.key === key)?.builtin)) {
        event.preventDefault(); rename(); return;
      }
      if (commandKey && !event.altKey && !editingField) {
        const key = event.key.toLocaleLowerCase();
        if (key === 'a' && manage) {
          event.preventDefault(); setSelected(new Set(keys));
          if (keys.length) { setAnchor(keys[0]); setFocusedKey(keys.at(-1)); focusKey(keys.at(-1)!); }
          return;
        }
        if (key === 'f') { event.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); return; }
        if (key === 'n' && event.shiftKey && manage && folderId !== builtinsFolder) {
          event.preventDefault(); beginNewFolder(); return;
        }
      }
      if (!commandKey && !event.altKey && !editingField && event.key.length === 1 && event.key !== ' ') {
        event.preventDefault();
        const previous = typeaheadRef.current;
        const query = `${previous}${event.key}`.toLocaleLowerCase();
        typeaheadRef.current = query;
        if (typeaheadTimerRef.current) clearTimeout(typeaheadTimerRef.current);
        typeaheadTimerRef.current = setTimeout(() => { typeaheadRef.current = ''; }, 750);
        const currentIndex = focusedKey ? keys.indexOf(focusedKey) : -1;
        const startIndex = previous ? Math.max(0, currentIndex) : currentIndex + 1;
        const labels = keys.map(key => key.startsWith('folder:')
          ? folders.find(folder => folder.id === key.slice(7))?.name ?? ''
          : records.find(record => record.key === key)?.title ?? '');
        for (let offset = 0; offset < keys.length; offset += 1) {
          const index = (startIndex + offset + keys.length) % keys.length;
          if (labels[index].toLocaleLowerCase().startsWith(query)) { moveKeyboardToIndex(index, false, false); break; }
        }
        return;
      }
      if (!commandKey || event.altKey || editingField) return;
      if (event.key.toLocaleLowerCase() === 'x' && manage && selected.size && !protectedSelection) { event.preventDefault(); setCut(new Set(selected)); setCopied(new Set()); }
      if (event.key.toLocaleLowerCase() === 'c' && manage && onCopy && selected.size && !protectedSelection) { event.preventDefault(); setCopied(new Set(selected)); setCut(new Set()); }
      if (event.key.toLocaleLowerCase() === 'v' && manage && browseMode === 'folders' && folderId !== builtinsFolder) {
        if (cut.size) { event.preventDefault(); void moveKeys(cut, folderId); }
        else if (copied.size && onCopy) { event.preventDefault(); void onCopy(records.filter(record => copied.has(record.key)), [...copied].filter(key => key.startsWith('folder:')).map(key => key.slice(7)), folderId); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selected, cut, copied, anchor, focusedKey, folderId, browseMode, view, keysSignature, library, records, manage, contextMenu, creatingFolder, choosingCreateType, backLocations, forwardLocations, onCopy, onDelete, onOpen, onSelect]);
  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = (event: PointerEvent) => { if (!contextMenuRef.current?.contains(event.target as Node)) closeContextMenu(); };
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') closeContextMenu(); };
    const dismissOnViewportChange = () => closeContextMenu();
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', keydown);
    window.addEventListener('resize', dismissOnViewportChange);
    window.addEventListener('scroll', dismissOnViewportChange, true);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('resize', dismissOnViewportChange);
      window.removeEventListener('scroll', dismissOnViewportChange, true);
    };
  }, [contextMenu]);
  const path = folderId && folderId !== builtinsFolder ? imageFolderAncestors(library, folderId) : [];
  const selectedRecord = selected.size === 1 ? records.find(record => record.key === [...selected][0]) : undefined;
  const content = <section className={`library-browser ${embedded ? 'embedded' : ''} ${browseMode === 'all' ? 'all-mode' : ''}`} role={embedded ? undefined : 'dialog'} aria-modal={embedded ? undefined : true}>
    <header><div><div className="eyebrow">{manage ? 'Synchronized reusable records' : 'Choose reusable content'}</div><h2>{title}</h2></div>{onClose && <button aria-label="Close library" onClick={onClose}>×</button>}</header>
    <div className="library-browser-toolbar">
      {manage && <><button className="secondary" onClick={beginNewFolder}>＋ Folder</button><button className="primary" disabled={!onCreate || !availableTypes.length || folderId === builtinsFolder} onClick={beginCreate}>＋ New</button><button className="secondary" disabled={selected.size !== 1 || selectedRecord?.builtin} onClick={rename}>Rename</button><label>Move to<select value="" disabled={!selected.size} onChange={event => { if (event.target.value) void moveKeys(selected, event.target.value === '__root__' ? undefined : event.target.value); }}><option value="">Choose…</option><option value="__root__">Library root</option>{folders.map(folder => <option value={folder.id} key={folder.id}>{' '.repeat(imageFolderAncestors(library, folder.id).length * 2)}{folder.name}</option>)}</select></label><button className="danger-text" disabled={!selected.size || [...selected].some(key => records.find(record => record.key === key)?.builtin)} onClick={() => void deleteKeys(selected)}>Delete</button></>}
      {actions}<span /><div className="library-browse-mode" role="radiogroup" aria-label="Library organization"><button role="radio" aria-checked={browseMode === 'folders'} className={browseMode === 'folders' ? 'active' : ''} onClick={() => { setBrowseMode('folders'); localStorage.setItem(browseModeKey(root), 'folders'); setSelected(new Set()); }}>Folder view</button><button role="radio" aria-checked={browseMode === 'all'} className={browseMode === 'all' ? 'active' : ''} onClick={() => { setBrowseMode('all'); localStorage.setItem(browseModeKey(root), 'all'); setSelected(new Set()); }}>All</button></div><button className={view === 'thumbnails' ? 'active' : ''} aria-label="Thumbnail view" onClick={() => { setView('thumbnails'); localStorage.setItem(viewKey(root), 'thumbnails'); }}>▦</button><button className={view === 'list' ? 'active' : ''} aria-label="List view" onClick={() => { setView('list'); localStorage.setItem(viewKey(root), 'list'); }}>☷</button>
    </div>
    <div className="library-browser-body">
      <aside onDragOver={event => { if (manage) event.preventDefault(); }} onDrop={event => dropInto(undefined, event)}><button className={!folderId ? 'active' : ''} onClick={() => openFolder(undefined)}>▾ Library</button><Tree library={library} current={folderId} onOpen={openFolder} onContextMenu={(id, event) => openContextMenu(`folder:${id}`, event)} /><button className={folderId === builtinsFolder ? 'active builtin' : 'builtin'} onClick={() => openFolder(builtinsFolder)}>◇ Built-ins</button></aside>
      <main onDragOver={event => { if (manage && folderId !== builtinsFolder) event.preventDefault(); }} onDrop={event => dropInto(folderId === builtinsFolder ? undefined : folderId, event)}>
        <div className="library-browser-path"><div className="library-history-controls"><button disabled={browseMode === 'all' || !backLocations.length} aria-label="Back" title="Back" onClick={goBack}>←</button><button disabled={browseMode === 'all' || !forwardLocations.length} aria-label="Forward" title="Forward" onClick={goForward}>→</button><button disabled={browseMode === 'all' || !folderId} aria-label="Up one folder" title="Up one folder" onClick={goUp}>↑</button></div>{browseMode === 'all' ? <b>All library items</b> : <><button onClick={() => openFolder(undefined)}>Library</button>{folderId === builtinsFolder ? <span>› Built-ins</span> : path.map(folder => <span key={folder.id}>› <button onClick={() => openFolder(folder.id)}>{folder.name}</button></span>)}</>}<input ref={searchRef} type="search" placeholder={browseMode === 'all' ? 'Search all library items' : 'Search this folder tree'} value={search} onChange={event => setSearch(event.target.value)} /></div>
        {!fixedTypes?.size || fixedTypes.size > 1 ? <div className="library-type-filters"><button className={activeFilter === 'all' ? 'active' : ''} onClick={() => { setFilter('all'); localStorage.removeItem(filterKey(root)); }}>All</button>{types.filter(type => !fixedTypes || fixedTypes.has(type)).map(type => <button className={activeFilter === type ? 'active' : ''} onClick={() => { setFilter(type); localStorage.setItem(filterKey(root), type); }} key={type}>{libraryRecordTypeLabel[type]}</button>)}</div> : <div className="library-type-filters locked"><b>{libraryRecordTypeLabel[[...fixedTypes][0]]}</b></div>}
        <div ref={entriesRef} className={`library-record-entries ${view}`} onContextMenu={event => openContextMenu(undefined, event)}>
          {visibleFolders.map(folder => { const key = `folder:${folder.id}`; return <button data-library-key={key} draggable={manage} title={`${folder.name}\nFolder ID: ${folder.id}`} onDragStart={event => beginDrag(key, event)} onDragOver={event => { if (manage) { event.preventDefault(); event.stopPropagation(); } }} onDrop={event => { event.stopPropagation(); dropInto(folder.id, event); }} className={`${selected.has(key) ? 'selected' : ''} ${focusedKey === key ? 'keyboard-focused' : ''} ${cut.has(key) ? 'cut' : ''}`} key={key} onClick={event => choose(key, event)} onContextMenu={event => openContextMenu(key, event)} onDoubleClick={() => openFolder(folder.id)}><span className="library-record-icon folder">📁</span><b>{folder.name}</b><small>Folder</small></button>; })}
          {visibleRecords.map(record => <button data-library-key={record.key} draggable={browseMode === 'folders' && manage && !record.builtin} title={`${record.title}\n${libraryRecordTypeLabel[record.type]} · Stable ID: ${record.targetId}`} onDragStart={event => beginDrag(record.key, event)} className={`${selected.has(record.key) ? 'selected' : ''} ${focusedKey === record.key ? 'keyboard-focused' : ''} ${cut.has(record.key) ? 'cut' : ''}`} key={record.key} onClick={event => choose(record.key, event)} onContextMenu={event => openContextMenu(record.key, event)} onDoubleClick={() => manage ? onOpen?.(record) : onSelect?.(record)}>{record.type === 'image' ? <ImageThumbnail root={root} record={record} /> : <span className="library-record-icon">{libraryRecordIcon[record.type]}</span>}<b>{record.title}</b><small>{libraryRecordTypeLabel[record.type]}{record.version ? ` · v${record.version}` : ''}{record.versionCount > 1 ? ` · ${record.versionCount} versions` : ''}{(browseMode === 'all' || searching) ? ` · ${record.builtin ? 'Built-ins' : record.folderId ? imageFolderAncestors(library, record.folderId).map(item => item.name).join(' / ') : 'Library'}` : ''}</small></button>)}
          {!visibleFolders.length && !visibleRecords.length && <p className="image-library-empty">No matching reusable records here.</p>}
        </div>
      </main>
    </div>
    <footer><span>{cut.size ? `${cut.size} cut · open a folder and press Ctrl+V` : copied.size ? `${copied.size} copied · open a folder and press Ctrl+V` : selected.size ? `${selected.size} selected` : `${visibleRecords.length} record${visibleRecords.length === 1 ? '' : 's'}`}</span><div>{onClose && <button className="secondary" onClick={onClose}>Cancel</button>}{manage && onOpen && <button className="primary" disabled={!selectedRecord} onClick={() => selectedRecord && onOpen(selectedRecord)}>Open</button>}{!manage && <button className="primary" disabled={!selectedRecord} onClick={() => selectedRecord && onSelect?.(selectedRecord)}>Choose</button>}</div></footer>
    {creatingFolder && <div className="library-folder-dialog" role="dialog" aria-modal="true" aria-labelledby="new-library-folder-title"><form onSubmit={event => { event.preventDefault(); void createFolder(); }}><h3 id="new-library-folder-title">{namingKey ? 'Rename item' : 'New folder'}</h3><label>{namingKey ? 'Name' : 'Folder name'}<input autoFocus value={newFolderName} onChange={event => { setNewFolderName(event.target.value); setFolderError(''); }} /></label>{folderError && <p className="field-error" role="alert">{folderError}</p>}<div><button type="button" className="secondary" onClick={() => setCreatingFolder(false)}>Cancel</button><button type="submit" className="primary">{namingKey ? 'Rename' : 'Create folder'}</button></div></form></div>}
    {choosingCreateType && <div className="library-folder-dialog" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setChoosingCreateType(false); }}><section className="library-create-type-dialog" role="dialog" aria-modal="true" aria-labelledby="library-create-type-title"><header><div><div className="eyebrow">New library item</div><h3 id="library-create-type-title">What would you like to create?</h3></div><button aria-label="Close" onClick={() => setChoosingCreateType(false)}>×</button></header><div className="library-create-type-options">{availableTypes.map(type => <button key={type} onClick={() => { setChoosingCreateType(false); onCreate?.(type, creationFolderId); }}><span>{libraryRecordIcon[type]}</span><b>{libraryRecordTypeLabel[type]}</b><small>{createTypeDescription[type]}</small></button>)}</div><footer><button className="secondary" onClick={() => setChoosingCreateType(false)}>Cancel</button></footer></section></div>}
    {contextMenu && (() => {
      const contextKeys = new Set(contextMenu.keys);
      const singleKey = contextMenu.keys.length === 1 ? contextMenu.keys[0] : undefined;
      const folder = singleKey?.startsWith('folder:') ? folders.find(item => item.id === singleKey.slice(7)) : undefined;
      const hasBuiltin = contextMenu.keys.some(key => records.find(item => item.key === key)?.builtin);
      const canModifySelection = manage && contextMenu.keys.length > 0 && !hasBuiltin;
      const canPaste = manage && (cut.size > 0 || (copied.size > 0 && Boolean(onCopy))) && browseMode === 'folders' && folderId !== builtinsFolder;
      return <div ref={contextMenuRef} className="library-context-menu" role="menu" aria-label="Library actions" style={{ left: Math.max(8, contextMenu.x), top: Math.max(8, contextMenu.y) }}>
        {singleKey && <button role="menuitem" onClick={() => contextAction(() => openKey(singleKey))}>{folder ? 'Open folder' : manage ? 'Open' : 'Choose'} <kbd>Enter</kbd></button>}
        {contextMenu.background && manage && <><button role="menuitem" disabled={!onCreate || !availableTypes.length || folderId === builtinsFolder} onClick={() => contextAction(beginCreate)}>New item…</button><button role="menuitem" disabled={folderId === builtinsFolder} onClick={() => contextAction(beginNewFolder)}>New folder <kbd>Ctrl+Shift+N</kbd></button></>}
        {manage && (contextMenu.background || canModifySelection) && <div className="library-context-separator" role="separator" />}
        {canModifySelection && <button role="menuitem" onClick={() => contextAction(() => { setCut(contextKeys); setCopied(new Set()); })}>Cut <kbd>Ctrl+X</kbd></button>}
        {canModifySelection && onCopy && <button role="menuitem" onClick={() => contextAction(() => { setCopied(contextKeys); setCut(new Set()); })}>Copy <kbd>Ctrl+C</kbd></button>}
        {contextMenu.background && <button role="menuitem" disabled={!canPaste} onClick={() => contextAction(() => cut.size ? moveKeys(cut, folderId) : onCopy?.(records.filter(item => copied.has(item.key)), [...copied].filter(key => key.startsWith('folder:')).map(key => key.slice(7)), folderId))}>Paste <kbd>Ctrl+V</kbd></button>}
        {canModifySelection && contextMenu.keys.length === 1 && <button role="menuitem" onClick={() => contextAction(rename)}>Rename <kbd>F2</kbd></button>}
        {canModifySelection && onDelete && <><div className="library-context-separator" role="separator" /><button role="menuitem" className="danger" onClick={() => contextAction(() => deleteKeys(contextKeys))}>Delete <kbd>Delete</kbd></button></>}
      </div>;
    })()}
  </section>;
  return embedded ? content : <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose?.(); }}>{content}</div>;
}
