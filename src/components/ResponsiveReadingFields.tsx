import { useEffect, useRef, useState } from 'react';
import type { ResponsiveReadingBlock, ResponsiveReadingSettings, TemplateV1 } from '../shared/types';
import { responsiveReadingEditorContent, safeParseResponsiveReadingContent, shouldItalicizeSilentPrayer } from '../shared/responsiveReading';
import { RichTextEditor } from './RichTextEditor';
import { HeadingFields } from './HeadingFields';

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
  const annotateSpecialLines = (editor: HTMLElement | null) => {
    if (!editor) return;
    Array.from(editor.querySelectorAll<HTMLElement>(':scope > [data-scripture-paragraph]')).forEach(paragraph => {
      paragraph.dataset.responsiveElement = paragraph.textContent === 'Silent Prayer' ? 'silentPrayer' : '';
    });
  };
  useEffect(() => {
    if (emittedEntriesRef.current === entriesSignature) {
      emittedEntriesRef.current = undefined;
      return;
    }
    setEditorContent(responsiveReadingEditorContent(block.entries, settings));
    setParseError('');
  }, [entriesSignature, settingsSignature]);
  return <div className={`responsive-reading-fields ${shouldItalicizeSilentPrayer(settings) ? 'italicize-silent-prayer' : ''}`.trim()}>
    <div className="responsive-reading-heading-controls">
      {block.heading ? <>
        <div className="field-row responsive-reading-heading-row">
          <div><HeadingFields block={block.heading} onChange={heading => onChange({ ...block, heading })} /></div>
          <button type="button" className="danger-text" onClick={() => {
            const { heading: _heading, ...next } = block;
            onChange(next);
          }}>Remove heading</button>
        </div>
      </> : <button type="button" className="secondary" onClick={() => onChange({ ...block, heading: { id: `${block.id}-heading`, type: 'heading', level: 'h2', text: '' } })}>＋ Heading</button>}
    </div>
    <RichTextEditor
      content={editorContent}
      label="Responsive reading"
      className="responsive-reading-editor"
      enterMode="responsiveLines"
      onRender={annotateSpecialLines}
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
