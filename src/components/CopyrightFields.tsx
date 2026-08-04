import type { CopyrightBlock } from '../shared/types';
import { paragraphsHaveVisibleContent } from '../shared/plainText';
import { RichTextEditor } from './RichTextEditor';

export function CopyrightFields({ block, onChange }: { block: CopyrightBlock; onChange(block: CopyrightBlock): void }) {
  const before = block.beforeNotices ?? block.extra ?? [];
  const updateBefore = (beforeNotices: CopyrightBlock['beforeNotices']) => {
    const { extra: _legacy, ...current } = block;
    onChange({ ...current, beforeNotices: paragraphsHaveVisibleContent(beforeNotices) ? beforeNotices : undefined });
  };
  return <div className="copyright-fields">
    <label className="check"><input type="checkbox" checked={block.suppressGeneratedNotices ?? false} onChange={event => onChange({ ...block, suppressGeneratedNotices: event.target.checked })} />Suppress generated notices</label>
    <label>Before generated notices</label>
    <RichTextEditor content={before} label="Copyright text before generated notices" onChange={updateBefore} />
    <small className="field-help">Library and Scripture notices are inserted automatically after this text.</small>
    <label>After generated notices</label>
    <RichTextEditor content={block.afterNotices ?? []} label="Copyright text after generated notices" onChange={afterNotices => onChange({ ...block, afterNotices: paragraphsHaveVisibleContent(afterNotices) ? afterNotices : undefined })} />
    <small className="field-help">Use this for a OneLicense.net notice or other text that must remain at the end.</small>
  </div>;
}
