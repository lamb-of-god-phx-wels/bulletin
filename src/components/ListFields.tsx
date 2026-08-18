import { useEffect, useRef, useState } from 'react';
import type { LibraryManifestV1, ListBlock } from '../shared/types';
import { listItemEditorContent, setListHeadingsEnabled, updateListItemEditorContent } from '../shared/listItems';
import { ImageAssetDialog } from './ImageAssetDialog';
import { RichTextEditor } from './RichTextEditor';
import { ToggleSwitch } from './ToggleSwitch';

export function ListFields({ block, library, root, targetFolder, onLibraryChange, onError, onChange }: {
  block: ListBlock;
  library?: LibraryManifestV1;
  root?: string;
  targetFolder: string;
  onLibraryChange?(library: LibraryManifestV1, alreadySaved?: boolean): Promise<void>;
  onError?(message: string): void;
  onChange(block: ListBlock): void;
}) {
  const [graphicIndex, setGraphicIndex] = useState<number>();
  const [focusHeadingId, setFocusHeadingId] = useState<string>();
  const fieldsRef = useRef<HTMLDivElement>(null);
  const updateItem = (index: number, changes: Partial<ListBlock['items'][number]>) => onChange({
    ...block,
    items: block.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...changes } : item),
  });
  useEffect(() => {
    if (!focusHeadingId) return;
    const item = Array.from(fieldsRef.current?.querySelectorAll<HTMLElement>('[data-list-item-id]') ?? []).find(candidate => candidate.dataset.listItemId === focusHeadingId);
    const heading = item?.querySelector<HTMLElement>('[role="textbox"]');
    if (!heading) return;
    heading.focus();
    const range = heading.ownerDocument.createRange();
    range.selectNodeContents(heading.firstElementChild ?? heading);
    const selection = heading.ownerDocument.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    setFocusHeadingId(undefined);
  }, [block.items, focusHeadingId]);
  const updateContent = (index: number, content: ListBlock['items'][number]['content']) => {
    const result = updateListItemEditorContent(block, index, content);
    onChange(result.block);
    if (result.createdItemId) setFocusHeadingId(result.createdItemId);
  };
  return <div className="announcement-fields list-fields" ref={fieldsRef}>
    <div className="field-row list-options">
      <label>List style<select value={block.style ?? 'plain'} onChange={event => onChange({ ...block, style: event.target.value as NonNullable<ListBlock['style']> })}><option value="plain">Plain</option><option value="bulleted">Bulleted</option><option value="numbered">Numbered</option></select></label>
      <div className="toggle-option-row"><span>Use first line as heading</span><ToggleSwitch label="Use first line as heading" checked={block.headingsEnabled !== false} onChange={headingsEnabled => onChange(setListHeadingsEnabled(block, headingsEnabled))} /></div>
    </div>
    {block.items.map((item, index) => <section className="announcement-editor" data-list-item-id={item.id} key={item.id}>
      <div className="announcement-editor-heading"><b>{item.title || `Item ${index + 1}`}</b><button className="danger-text" aria-label={`Remove ${item.title || 'item'}`} onClick={() => onChange({ ...block, items: block.items.filter((_, itemIndex) => itemIndex !== index) })}>×</button></div>
      <label>{block.headingsEnabled === false ? 'Content' : 'Heading and content'}</label>
      <RichTextEditor content={listItemEditorContent(item, block.headingsEnabled !== false)} label={`${item.title || `Item ${index + 1}`} ${block.headingsEnabled === false ? 'content' : 'heading and content'}`} className={`list-item-editor ${block.headingsEnabled === false ? '' : 'list-item-combined-editor'}`.trim()} preservePastedLines preserveLocalEditsWhileFocused onChange={content => updateContent(index, content)} />
      <div className="field-row announcement-graphic-controls">
        <button className="secondary" disabled={!root} onClick={() => setGraphicIndex(index)}>{item.asset ? 'Replace graphic…' : 'Add graphic…'}</button>
        {item.asset && <><label>Graphic side<select value={item.assetSide ?? 'right'} onChange={event => updateItem(index, { assetSide: event.target.value as 'left' | 'right' })}><option value="left">Left</option><option value="right">Right</option></select></label><button className="danger-text" onClick={() => { const next = { ...item }; delete next.asset; delete next.assetSide; onChange({ ...block, items: block.items.map((entry, itemIndex) => itemIndex === index ? next : entry) }); }}>Remove graphic</button></>}
      </div>
    </section>)}
    <button className="secondary" onClick={() => onChange({ ...block, items: [...block.items, { id: `list-item-${Date.now()}`, title: 'New item', content: [] }] })}>＋ Item</button>
    {graphicIndex !== undefined && root && <ImageAssetDialog library={library} root={root} targetFolder={targetFolder} onLibraryChange={onLibraryChange} onError={onError} onClose={() => setGraphicIndex(undefined)} onSelect={asset => { updateItem(graphicIndex, { asset, assetSide: block.items[graphicIndex].assetSide ?? 'right' }); setGraphicIndex(undefined); }} />}
  </div>;
}
