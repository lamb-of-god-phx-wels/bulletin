import type { HeadingBlock, LegacySectionHeadingBlock, Paragraph } from '../shared/types';
import { effectiveHeadingLevel } from '../shared/headings';
import { paragraphsFromPlainText } from '../shared/plainText';
import { RichTextEditor } from './RichTextEditor';

const plainText = (content: Paragraph[]) => content.map(paragraph => paragraph.children.map(run => run.type === 'text' ? run.text : run.type === 'lineBreak' ? '\n' : '✠').join('')).join('\n\n');

export function HeadingFields({ block, onChange }: {
  block: HeadingBlock | LegacySectionHeadingBlock;
  onChange(block: HeadingBlock): void;
}) {
  const normalized = (): HeadingBlock => {
    const { type: _type, ...rest } = block;
    return { ...rest, type: 'heading', level: effectiveHeadingLevel(block) };
  };
  const change = (changes: Partial<HeadingBlock>) => onChange({ ...normalized(), ...changes });
  return <>
    <label>Level<select value={effectiveHeadingLevel(block)} onChange={event => change({ level: event.target.value as HeadingBlock['level'] })}><option value="h1">H1</option><option value="h2">H2</option><option value="h3">H3</option></select></label>
    <label>Heading<RichTextEditor content={block.content ?? paragraphsFromPlainText(block.text)} label="Heading text" onChange={content => change({ text: plainText(content), content })} /></label>
    <label>Subheading (optional)<input value={'subheading' in block ? block.subheading ?? '' : ''} onChange={event => change({ subheading: event.target.value || undefined })} /></label>
    <label>Caption (optional)<textarea rows={3} value={'caption' in block ? block.caption ?? '' : ''} onChange={event => change({ caption: event.target.value || undefined })} /></label>
  </>;
}
