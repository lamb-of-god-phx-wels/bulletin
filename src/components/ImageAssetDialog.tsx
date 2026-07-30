import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import {
  imageFolderAncestors,
  imageFolderChildren,
  imageFolderDescendantIds,
  imageFolderNameAvailable,
  imageLibraryId,
  libraryImageChoices,
  nextImageLibraryItem,
  setImageCatalogEntry
} from '../shared/images.js';
import { randomId } from '../shared/id.js';
import type { AssetRef, LibraryImageFolder, LibraryManifestV1 } from '../shared/types.js';

const folderKey = (root: string) => `bulletin-image-folder:${root}`;
const viewKey = (root: string) => `bulletin-image-view:${root}`;

function Thumbnail({ root, asset, alt }: { root: string; asset: AssetRef; alt: string }) {
  const container = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [source, setSource] = useState('');
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (!container.current) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) setVisible(true); }, { rootMargin: '160px' });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    setSource(''); setMissing(false);
    void window.bulletin?.readAsset(root, asset.path).then(value => { if (active) setSource(value); }).catch(() => { if (active) setMissing(true); });
    return () => { active = false; };
  }, [root, asset.path, visible]);
  return <span ref={container} className="library-image-thumbnail">{source ? <img src={source} alt={alt} loading="lazy" /> : <i>{missing ? 'Missing' : 'Loading…'}</i>}</span>;
}

function FolderTree({ folders, parentId, currentId, onOpen }: { folders: LibraryImageFolder[]; parentId?: string; currentId?: string; onOpen(id?: string): void }) {
  const children = folders.filter(folder => folder.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name));
  if (!children.length) return null;
  return <ul>{children.map(folder => <li key={folder.id}>
    <button className={currentId === folder.id ? 'active' : ''} onClick={() => onOpen(folder.id)}><span>▸</span>{folder.name}</button>
    <FolderTree folders={folders} parentId={folder.id} currentId={currentId} onOpen={onOpen} />
  </li>)}</ul>;
}

export function ImageAssetDialog({
  library,
  root,
  targetFolder,
  onLibraryChange,
  onSelect,
  onClose,
  onError,
  manageOnly = false,
  initialFolderId
}: {
  library?: LibraryManifestV1;
  root: string;
  targetFolder: string;
  onLibraryChange?(library: LibraryManifestV1, alreadySaved?: boolean): Promise<void>;
  onSelect?(asset: AssetRef): void;
  onClose(): void;
  onError?(message: string): void;
  manageOnly?: boolean;
  initialFolderId?: string;
}) {
  const choices = useMemo(() => libraryImageChoices(library), [library]);
  const validRemembered = () => {
    const stored = localStorage.getItem(folderKey(root));
    if (!stored) return undefined;
    let remembered: string[];
    try { remembered = JSON.parse(stored) as string[]; }
    catch { remembered = [stored]; }
    return [...remembered].reverse().find(id => library?.folders?.some(folder => folder.id === id));
  };
  const [folderId, setFolderId] = useState<string | undefined>(() =>
    initialFolderId && library?.folders?.some(folder => folder.id === initialFolderId) ? initialFolderId : validRemembered()
  );
  const [view, setView] = useState<'thumbnails' | 'list'>(() => localStorage.getItem(viewKey(root)) === 'list' ? 'list' : 'thumbnails');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploaded, setUploaded] = useState<AssetRef>();
  const [addingToLibrary, setAddingToLibrary] = useState(false);
  const [title, setTitle] = useState('');
  const [id, setId] = useState('');
  const [notice, setNotice] = useState('');
  const [uploadFolderId, setUploadFolderId] = useState<string | undefined>(folderId);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [anchor, setAnchor] = useState<string>();
  const [cut, setCut] = useState<Set<string>>(new Set());
  const base = library ?? { schemaVersion: 1 as const, name: 'Church Library', items: [] };
  const folders = library?.folders ?? [];
  const currentFolders = imageFolderChildren(library, folderId);
  const currentImages = choices.filter(choice => choice.folderId === folderId && choice.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const visibleIds = [...currentFolders.map(folder => `folder:${folder.id}`), ...currentImages.map(image => `image:${image.id}`)];

  const fail = (error: unknown) => onError?.(error instanceof Error ? error.message : String(error));
  const openFolder = (id?: string) => {
    setFolderId(id); setSelected(new Set()); setAnchor(undefined);
    if (id) localStorage.setItem(folderKey(root), JSON.stringify(imageFolderAncestors(library, id).map(folder => folder.id))); else localStorage.removeItem(folderKey(root));
  };
  const changeView = (next: 'thumbnails' | 'list') => { setView(next); localStorage.setItem(viewKey(root), next); };
  const selectEntry = (key: string, event: MouseEvent) => {
    if (event.shiftKey && anchor && visibleIds.includes(anchor)) {
      const [start, end] = [visibleIds.indexOf(anchor), visibleIds.indexOf(key)].sort((a, b) => a - b);
      setSelected(new Set(visibleIds.slice(start, end + 1)));
    } else if (event.ctrlKey || event.metaKey) {
      setSelected(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
      setAnchor(key);
    } else {
      setSelected(new Set([key])); setAnchor(key);
    }
  };
  const saveLibrary = async (next: LibraryManifestV1, alreadySaved = false) => {
    if (!onLibraryChange) return;
    setSaving(true);
    try { await onLibraryChange(next, alreadySaved); }
    catch (error) { fail(error); throw error; }
    finally { setSaving(false); }
  };
  const createFolder = async (parentId = folderId) => {
    const name = window.prompt('Folder name');
    if (!name?.trim()) return undefined;
    if (!imageFolderNameAvailable(library, name, parentId)) { onError?.('Folder names must be unique within the same folder.'); return undefined; }
    const folder = { id: `image-folder-${randomId()}`, name: name.trim(), ...(parentId ? { parentId } : {}) };
    await saveLibrary({ ...base, folders: [...folders, folder] });
    return folder.id;
  };
  const upload = async (directToLibrary = false) => {
    if (!window.bulletin) return;
    try {
      const asset = await window.bulletin.importAsset(root, targetFolder);
      if (!asset) return;
      if (asset.mediaType === 'application/pdf') { onError?.('Choose a PNG, JPEG, or SVG for an Image element.'); return; }
      const suggested = (asset.alt ?? 'Library image').replace(/\.[^.]+$/, '');
      setUploaded(asset); setTitle(suggested); setId(imageLibraryId(suggested)); setUploadFolderId(folderId); setAddingToLibrary(directToLibrary);
    } catch (error) { fail(error); }
  };
  const saveToLibrary = async () => {
    if (!uploaded || !onLibraryChange || !title.trim() || !id.trim()) return;
    try {
      const item = nextImageLibraryItem(base, { id, title, asset: uploaded, notice });
      const existingCatalog = base.catalog?.find(entry => entry.targetKind === 'library-item' && entry.targetId === item.id);
      const withItem = { ...base, items: [...base.items, item] };
      const next = setImageCatalogEntry(withItem, {
        imageId: item.id,
        folderId: existingCatalog?.folderId ?? uploadFolderId,
        displayName: title.trim()
      });
      await saveLibrary(next);
      onSelect?.({ ...uploaded, alt: title.trim() });
      if (!manageOnly) onClose();
      else { setUploaded(undefined); setAddingToLibrary(false); }
    } catch { /* saveLibrary reports the error */ }
  };
  const renameSelection = async () => {
    if (selected.size !== 1) return;
    const key = [...selected][0];
    if (key.startsWith('folder:')) {
      const folder = folders.find(item => item.id === key.slice(7)); if (!folder) return;
      const name = window.prompt('Folder name', folder.name);
      if (!name?.trim() || name.trim() === folder.name) return;
      if (!imageFolderNameAvailable(library, name, folder.parentId, folder.id)) { onError?.('Folder names must be unique within the same folder.'); return; }
      await saveLibrary({ ...base, folders: folders.map(item => item.id === folder.id ? { ...item, name: name.trim() } : item) });
    } else {
      const imageId = key.slice(6);
      const image = choices.find(item => item.id === imageId); if (!image) return;
      const name = window.prompt('Image display name', image.title);
      if (!name?.trim() || name.trim() === image.title) return;
      const current = base.catalog?.find(entry => entry.targetKind === 'library-item' && entry.targetId === imageId);
      await saveLibrary(setImageCatalogEntry(base, { imageId, folderId: current?.folderId, displayName: name.trim() }));
    }
  };
  const moveSelection = async (destination?: string) => {
    const selectedFolders = [...selected].filter(key => key.startsWith('folder:')).map(key => key.slice(7));
    const selectedImages = [...selected].filter(key => key.startsWith('image:')).map(key => key.slice(6));
    if (selectedFolders.some(id => id === destination || imageFolderDescendantIds(library, id).has(destination ?? ''))) {
      onError?.('A folder cannot be moved inside itself or one of its subfolders.'); return;
    }
    const nextFolders = folders.map(folder => selectedFolders.includes(folder.id) ? { ...folder, parentId: destination } : folder);
    let next: LibraryManifestV1 = { ...base, folders: nextFolders };
    for (const imageId of selectedImages) {
      const current = next.catalog?.find(entry => entry.targetKind === 'library-item' && entry.targetId === imageId);
      const image = choices.find(item => item.id === imageId);
      next = setImageCatalogEntry(next, { imageId, folderId: destination, displayName: current?.displayName ?? image?.title });
    }
    await saveLibrary(next);
    setSelected(new Set());
    setCut(new Set());
  };
  const deleteSelection = async () => {
    if (!selected.size) return;
    const selectedFolderIds = [...selected].filter(key => key.startsWith('folder:')).map(key => key.slice(7));
    const selectedImageIds = new Set([...selected].filter(key => key.startsWith('image:')).map(key => key.slice(6)));
    const allFolderIds = new Set(selectedFolderIds);
    for (const id of selectedFolderIds) for (const child of imageFolderDescendantIds(library, id)) allFolderIds.add(child);
    const nestedImages = choices.filter(image => image.folderId && allFolderIds.has(image.folderId)).map(image => image.id);
    const nonEmpty = nestedImages.length > 0 || folders.some(folder => selectedFolderIds.includes(folder.parentId ?? ''));
    if (nonEmpty) {
      if (!window.confirm('This folder is not empty. Use the danger override to send the complete folder tree and every image inside it to Trash?')) return;
      if (!window.confirm('Delete the folder tree and all contained image families? Existing bulletins will keep their embedded asset references.')) return;
      nestedImages.forEach(id => selectedImageIds.add(id));
    } else if (!window.confirm(`Send ${selected.size} selected item${selected.size === 1 ? '' : 's'} to Trash?`)) return;
    const next: LibraryManifestV1 = {
      ...base,
      items: base.items.filter(item => !selectedImageIds.has(item.id)),
      folders: folders.filter(folder => !allFolderIds.has(folder.id)),
      catalog: (base.catalog ?? []).filter(entry => entry.targetKind !== 'library-item' || !selectedImageIds.has(entry.targetId))
    };
    if (window.bulletin?.trashLibraryImages) {
      try {
        const saved = await window.bulletin.trashLibraryImages(root, [...allFolderIds], [...selectedImageIds], base);
        await saveLibrary(saved, true);
      } catch (error) { fail(error); return; }
    } else await saveLibrary(next);
    setSelected(new Set());
    setCut(new Set());
    if (folderId && allFolderIds.has(folderId)) openFolder(undefined);
  };
  const folderOptions = [{ id: '', name: 'Library root', depth: 0 }, ...folders.map(folder => ({ id: folder.id, name: folder.name, depth: imageFolderAncestors(library, folder.id).length }))];
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
      if (event.key.toLocaleLowerCase() === 'x' && selected.size) {
        event.preventDefault();
        setCut(new Set(selected));
      }
      if (event.key.toLocaleLowerCase() === 'v' && cut.size) {
        event.preventDefault();
        setSelected(new Set(cut));
        const selectedFolders = [...cut].filter(key => key.startsWith('folder:')).map(key => key.slice(7));
        if (selectedFolders.some(id => id === folderId || imageFolderDescendantIds(library, id).has(folderId ?? ''))) {
          onError?.('A folder cannot be pasted inside itself or one of its subfolders.');
          return;
        }
        const selectedImages = [...cut].filter(key => key.startsWith('image:')).map(key => key.slice(6));
        const nextFolders = folders.map(folder => selectedFolders.includes(folder.id) ? { ...folder, parentId: folderId } : folder);
        let next: LibraryManifestV1 = { ...base, folders: nextFolders };
        for (const imageId of selectedImages) {
          const current = next.catalog?.find(entry => entry.targetKind === 'library-item' && entry.targetId === imageId);
          const image = choices.find(item => item.id === imageId);
          next = setImageCatalogEntry(next, { imageId, folderId, displayName: current?.displayName ?? image?.title });
        }
        void saveLibrary(next).then(() => { setCut(new Set()); setSelected(new Set()); });
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [selected, cut, folderId, library, folders, base, choices]);

  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="image-library-dialog" role="dialog" aria-modal="true" aria-labelledby="image-library-title">
      <header><div><div className="eyebrow">Shared image library</div><h2 id="image-library-title">{manageOnly ? 'Manage images' : 'Add from library'}</h2></div><button aria-label="Close" onClick={onClose}>×</button></header>
      <div className="image-library-toolbar">
        <button className="secondary" onClick={() => void createFolder()}>＋ Folder</button>
        <button className="secondary" onClick={() => void upload(true)}>Upload here…</button>
        <button className="secondary" disabled={selected.size !== 1} onClick={() => void renameSelection()}>Rename</button>
        <label>Move to<select disabled={!selected.size} value="" onChange={event => { const destination = event.target.value || undefined; void moveSelection(destination); }}><option value="">Choose…</option>{folderOptions.map(folder => <option key={folder.id || 'root'} value={folder.id}>{' '.repeat(folder.depth * 2)}{folder.name}</option>)}</select></label>
        <button className="danger-text" disabled={!selected.size} onClick={() => void deleteSelection()}>Delete</button>
        <span />
        <button className={view === 'thumbnails' ? 'active' : ''} title="Thumbnail view" onClick={() => changeView('thumbnails')}>▦</button>
        <button className={view === 'list' ? 'active' : ''} title="List view" onClick={() => changeView('list')}>☷</button>
      </div>
      <div className="image-library-browser">
        <aside>
          <button className={!folderId ? 'active' : ''} onClick={() => openFolder(undefined)}>▾ Images</button>
          <FolderTree folders={folders} currentId={folderId} onOpen={openFolder} />
        </aside>
        <main>
          <div className="image-library-path">
            <button onClick={() => openFolder(undefined)}>Images</button>
            {imageFolderAncestors(library, folderId).map(folder => <span key={folder.id}>› <button onClick={() => openFolder(folder.id)}>{folder.name}</button></span>)}
            <input type="search" placeholder="Filter this folder" value={search} onChange={event => setSearch(event.target.value)} />
          </div>
          <div className={`image-library-entries ${view}`}>
            {currentFolders.map(folder => {
              const key = `folder:${folder.id}`;
              return <button draggable className={`image-library-folder ${selected.has(key) ? 'selected' : ''} ${cut.has(key) ? 'cut' : ''}`} key={folder.id}
                onClick={event => selectEntry(key, event)} onDoubleClick={() => openFolder(folder.id)}
                onDragStart={event => { if (!selected.has(key)) setSelected(new Set([key])); event.dataTransfer.setData('text/plain', key); }}
                onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void moveSelection(folder.id); }}>
                <span>📁</span><b>{folder.name}</b><small>Folder</small>
              </button>;
            })}
            {currentImages.map(image => {
              const key = `image:${image.id}`;
              return <button draggable className={`image-library-image ${selected.has(key) ? 'selected' : ''} ${cut.has(key) ? 'cut' : ''}`} key={image.id}
                onClick={event => selectEntry(key, event)}
                onDoubleClick={() => { if (!manageOnly) { onSelect?.({ ...image.asset, alt: image.title }); onClose(); } }}
                onDragStart={event => { if (!selected.has(key)) setSelected(new Set([key])); event.dataTransfer.setData('text/plain', key); }}>
                <Thumbnail root={root} asset={image.asset} alt={image.title} /><b>{image.title}</b><small>{image.asset.alt ?? image.asset.path} · v{image.version}</small>
              </button>;
            })}
            {!currentFolders.length && !currentImages.length && <p className="image-library-empty">This folder is empty.</p>}
          </div>
        </main>
      </div>
      <footer>
        <span>{cut.size ? `${cut.size} item${cut.size === 1 ? '' : 's'} cut · open a folder and press Ctrl+V` : selected.size ? `${selected.size} selected` : 'Choose a folder or image'}</span>
        <div className="builder-actions">
          <button className="secondary" onClick={onClose}>{manageOnly ? 'Done' : 'Cancel'}</button>
          {!manageOnly && <button className="secondary" onClick={() => void upload(false)}>Upload one-time image…</button>}
          {!manageOnly && <button className="primary" disabled={selected.size !== 1 || ![...selected][0]?.startsWith('image:')} onClick={() => {
            const image = choices.find(choice => `image:${choice.id}` === [...selected][0]);
            if (image) { onSelect?.({ ...image.asset, alt: image.title }); onClose(); }
          }}>Add image</button>}
        </div>
      </footer>
      {uploaded && <div className="image-upload-sheet">
        {!addingToLibrary ? <>
          <h3>Add this image to the library?</h3>
          <p><b>{uploaded.alt ?? uploaded.path}</b> can be used only here, or saved for everyone.</p>
          <div className="builder-actions"><button className="secondary" onClick={() => { onSelect?.(uploaded); onClose(); }}>Use once</button>{onLibraryChange && <button className="primary" onClick={() => setAddingToLibrary(true)}>Add to library…</button>}</div>
        </> : <>
          <h3>Save image to library</h3>
          <div className="field-row"><label>Display name<input autoFocus value={title} onChange={event => { const previous = imageLibraryId(title); const next = event.target.value; setTitle(next); if (!id || id === previous) setId(imageLibraryId(next)); }} /></label><label>Stable ID<input value={id} onChange={event => setId(event.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-'))} /></label></div>
          <div className="field-row"><label>Folder<select value={uploadFolderId ?? ''} onChange={event => setUploadFolderId(event.target.value || undefined)}>{folderOptions.map(folder => <option key={folder.id || 'root'} value={folder.id}>{' '.repeat(folder.depth * 2)}{folder.name}</option>)}</select></label><button className="secondary inline-folder-create" onClick={async () => { const created = await createFolder(uploadFolderId); if (created) setUploadFolderId(created); }}>＋ New folder</button></div>
          <label>Copyright or license notice<textarea rows={3} value={notice} onChange={event => setNotice(event.target.value)} /></label>
          <p className="helper">Using an existing stable ID creates a new image version without moving its folder.</p>
          <div className="builder-actions"><button className="secondary" disabled={saving} onClick={() => { setUploaded(undefined); setAddingToLibrary(false); }}>Cancel</button><button className="primary" disabled={saving || !title.trim() || !id.trim()} onClick={() => void saveToLibrary()}>{saving ? 'Saving…' : 'Save to library and use'}</button></div>
        </>}
      </div>}
    </section>
  </div>;
}
