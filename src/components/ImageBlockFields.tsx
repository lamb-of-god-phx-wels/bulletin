import { useState } from 'react';
import type { ImageBlock, LibraryManifestV1 } from '../shared/types.js';
import { ImageAssetDialog } from './ImageAssetDialog.js';

export function ImageBlockFields({
  block,
  library,
  root,
  targetFolder,
  onLibraryChange,
  onChange,
  onError
}: {
  block: ImageBlock;
  library?: LibraryManifestV1;
  root?: string;
  targetFolder: string;
  onLibraryChange?(library: LibraryManifestV1, alreadySaved?: boolean): Promise<void>;
  onChange(block: ImageBlock): void;
  onError?(message: string): void;
}) {
  const [choosing, setChoosing] = useState(false);
  return <>
    <p className="helper">{block.alt ?? block.asset.alt ?? block.asset.path}</p>
    <div className="field-row">
      <label>Height (in)<input type="number" min=".25" max="8.5" step=".0625" value={block.heightIn ?? 2.5} onChange={event => onChange({ ...block, heightIn: event.currentTarget.valueAsNumber })} /></label>
      <label>Fit<select value={block.fit ?? 'contain'} onChange={event => onChange({ ...block, fit: event.target.value as ImageBlock['fit'] })}><option value="contain">Contain</option><option value="cover">Cover</option><option value="fill">Fill</option></select></label>
    </div>
    <button className="secondary" disabled={!root} onClick={() => setChoosing(true)}>Add from library…</button>
    {choosing && root && <ImageAssetDialog library={library} root={root} targetFolder={targetFolder} onLibraryChange={onLibraryChange} onSelect={asset => onChange({ ...block, asset, alt: asset.alt })} onClose={() => setChoosing(false)} onError={onError} />}
  </>;
}
