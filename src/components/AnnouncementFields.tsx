import { useState } from 'react';
import type { AnnouncementsBlock, LibraryManifestV1 } from '../shared/types';
import { paragraphsFromPlainText } from '../shared/plainText';
import { ImageAssetDialog } from './ImageAssetDialog';
import { RichTextEditor } from './RichTextEditor';

export function AnnouncementFields({ block, library, root, targetFolder, onLibraryChange, onError, onChange }: {
  block: AnnouncementsBlock;
  library?: LibraryManifestV1;
  root?: string;
  targetFolder: string;
  onLibraryChange?(library: LibraryManifestV1, alreadySaved?: boolean): Promise<void>;
  onError?(message: string): void;
  onChange(block: AnnouncementsBlock): void;
}) {
  const [graphicIndex, setGraphicIndex] = useState<number>();
  const updateItem = (index: number, changes: Partial<AnnouncementsBlock['items'][number]>) => onChange({
    ...block,
    items: block.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...changes } : item),
  });
  return <div className="announcement-fields">
    {block.items.map((item, index) => <section className="announcement-editor" key={item.id}>
      <div className="announcement-editor-heading"><label>Title<RichTextEditor content={item.titleContent ?? paragraphsFromPlainText(item.title)} label={`${item.title || `Announcement ${index + 1}`} title`} onChange={titleContent => updateItem(index, { title: titleContent.map(paragraph => paragraph.children.map(run => run.type === 'text' ? run.text : '').join('')).join('\n\n'), titleContent })} /></label><button className="danger-text" aria-label={`Remove ${item.title || 'announcement'}`} onClick={() => onChange({ ...block, items: block.items.filter((_, itemIndex) => itemIndex !== index) })}>×</button></div>
      <label>Details</label>
      <RichTextEditor content={item.content} label={`${item.title || `Announcement ${index + 1}`} details`} onChange={content => updateItem(index, { content })} />
      <div className="field-row announcement-graphic-controls">
        <button className="secondary" disabled={!root} onClick={() => setGraphicIndex(index)}>{item.asset ? 'Replace graphic…' : 'Add graphic…'}</button>
        {item.asset && <><label>Graphic side<select value={item.assetSide ?? 'right'} onChange={event => updateItem(index, { assetSide: event.target.value as 'left' | 'right' })}><option value="left">Left</option><option value="right">Right</option></select></label><button className="danger-text" onClick={() => { const next = { ...item }; delete next.asset; delete next.assetSide; onChange({ ...block, items: block.items.map((entry, itemIndex) => itemIndex === index ? next : entry) }); }}>Remove graphic</button></>}
      </div>
    </section>)}
    <button className="secondary" onClick={() => onChange({ ...block, items: [...block.items, { id: `announcement-${Date.now()}`, title: 'New announcement', content: paragraphsFromPlainText('') }] })}>＋ Announcement</button>
    {graphicIndex !== undefined && root && <ImageAssetDialog library={library} root={root} targetFolder={targetFolder} onLibraryChange={onLibraryChange} onError={onError} onClose={() => setGraphicIndex(undefined)} onSelect={asset => { updateItem(graphicIndex, { asset, assetSide: block.items[graphicIndex].assetSide ?? 'right' }); setGraphicIndex(undefined); }} />}
  </div>;
}
