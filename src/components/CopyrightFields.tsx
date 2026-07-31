import type { CopyrightBlock } from '../shared/types';
import { RichTextEditor } from './RichTextEditor';

export function CopyrightFields({ block, onChange }: { block: CopyrightBlock; onChange(block: CopyrightBlock): void }) {
  return <div className="copyright-fields">
    <label className="check"><input type="checkbox" checked={block.suppressGeneratedNotices ?? false} onChange={event => onChange({ ...block, suppressGeneratedNotices: event.target.checked })} />Suppress generated notices</label>
    <label>Additional copyright text</label>
    <RichTextEditor content={block.extra ?? []} label="Additional copyright text" onChange={extra => onChange({ ...block, extra })} />
    <small className="field-help">Library and Scripture notices are generated automatically.</small>
  </div>;
}
