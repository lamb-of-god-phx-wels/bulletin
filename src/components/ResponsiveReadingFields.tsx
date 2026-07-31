import { useEffect, useRef, useState } from 'react';
import type { ResponsiveReadingBlock, ResponsiveReadingSettings, TemplateV1 } from '../shared/types';
import { responsiveReadingEditorContent, safeParseResponsiveReadingContent } from '../shared/responsiveReading';
import { InlineTypographyControls } from './InlineTypographyControls';
import { RichTextEditor } from './RichTextEditor';

export function ResponsiveReadingFields({ block, settings, template, onChange }: {
  block: ResponsiveReadingBlock;
  settings: ResponsiveReadingSettings;
  template: TemplateV1;
  onChange(block: ResponsiveReadingBlock): void;
}) {
  const [parseError, setParseError] = useState('');
  const [editorContent, setEditorContent] = useState(() => responsiveReadingEditorContent(block.entries, settings));
  const emittedEntriesRef = useRef<string | undefined>(undefined);
  const entriesSignature = JSON.stringify(block.entries);
  const settingsSignature = JSON.stringify(settings);
  useEffect(() => {
    if (emittedEntriesRef.current === entriesSignature) {
      emittedEntriesRef.current = undefined;
      return;
    }
    setEditorContent(responsiveReadingEditorContent(block.entries, settings));
    setParseError('');
  }, [entriesSignature, settingsSignature]);
  return <div className="responsive-reading-fields">
    <div className="responsive-reading-heading-controls">
      {block.heading ? <>
        <div className="field-row responsive-reading-heading-row">
          <label>Heading<input value={block.heading.text} onChange={event => onChange({ ...block, heading: { ...block.heading!, text: event.target.value } })} /></label>
          <button type="button" className="danger-text" onClick={() => {
            const { heading: _heading, ...next } = block;
            onChange(next);
          }}>Remove heading</button>
        </div>
        <InlineTypographyControls block={block.heading} template={template} onChange={presentation => onChange({ ...block, heading: { ...block.heading!, presentation } })} />
      </> : <button type="button" className="secondary" onClick={() => onChange({ ...block, heading: { id: `${block.id}-heading`, type: 'heading', text: '' } })}>＋ Heading</button>}
    </div>
    <RichTextEditor
      content={editorContent}
      label="Responsive reading"
      className="responsive-reading-editor"
      enterMode="responsiveLines"
      onChange={content => {
        const result = safeParseResponsiveReadingContent(content, settings, block.entries);
        if (result.error) {
          setParseError(result.error);
          return;
        }
        setParseError('');
        emittedEntriesRef.current = JSON.stringify(result.entries);
        onChange({ ...block, entries: result.entries! });
      }}
    />
    {parseError && <p className="validation warning responsive-reading-error" role="alert">{parseError}</p>}
    <small className="field-help">Start each response with {settings.labels.leader}:, {settings.labels.follower}:, or {settings.labels.all}:. Unprefixed lines continue the previous response.</small>
  </div>;
}
