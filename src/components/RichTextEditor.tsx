import { useLayoutEffect, useRef, useState } from 'react';
import type { Inline, Marks, Paragraph, TextRun } from '../shared/types';
import { renderStructuredContent, scriptureContentFromEditor } from './ScriptureEditor';

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pastedHtml = (value: string) => value.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(paragraph => `<div>${escape(paragraph).replace(/\n/g, '<br>') || '<br data-placeholder>'}</div>`).join('');
type EditableMark = Extract<Marks[number], 'bold' | 'italic' | 'smallCaps'>;
type SelectionOffsets = { start: number; end: number };

const markOrder: Marks[number][] = ['bold', 'italic', 'smallCaps', 'superscript'];
type ParagraphAlignment = NonNullable<Paragraph['align']>;

function sameMarks(left?: Marks, right?: Marks) {
  return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
}

function appendRun(runs: Inline[], run: Inline) {
  const previous = runs.at(-1);
  if (run.type === 'text' && previous?.type === 'text' && sameMarks(previous.marks, run.marks)) {
    previous.text += run.text;
  } else {
    runs.push(run);
  }
}

function selectedRuns(content: Paragraph[], start: number, end: number) {
  const runs: TextRun[] = [];
  let cursor = 0;
  for (const paragraph of content) {
    for (const run of paragraph.children) {
      if (run.type !== 'text') continue;
      const runEnd = cursor + run.text.length;
      if (start < runEnd && end > cursor) runs.push(run);
      cursor = runEnd;
    }
  }
  return runs;
}

export function selectedTextMarks(content: Paragraph[], start: number, end: number): EditableMark[] {
  if (start === end) return [];
  const runs = selectedRuns(content, start, end);
  if (!runs.length) return [];
  return (['bold', 'italic', 'smallCaps'] as EditableMark[]).filter(mark =>
    runs.every(run => run.marks?.includes(mark)),
  );
}

export function formatTextRange(
  content: Paragraph[],
  start: number,
  end: number,
  mark?: EditableMark,
): Paragraph[] {
  if (start === end) return content;
  const active = mark ? selectedTextMarks(content, start, end).includes(mark) : false;
  let cursor = 0;
  return content.map(paragraph => {
    const children: Inline[] = [];
    for (const run of paragraph.children) {
      if (run.type !== 'text') {
        appendRun(children, run);
        continue;
      }
      const runStart = cursor;
      const runEnd = cursor + run.text.length;
      const selectionStart = Math.max(runStart, start);
      const selectionEnd = Math.min(runEnd, end);
      if (selectionStart >= selectionEnd) {
        appendRun(children, run);
      } else {
        const before = selectionStart - runStart;
        const after = selectionEnd - runStart;
        if (before) appendRun(children, { ...run, text: run.text.slice(0, before) });
        const marks = mark
          ? active
            ? (run.marks ?? []).filter(value => value !== mark)
            : [...new Set([...(run.marks ?? []), mark])].sort((left, right) => markOrder.indexOf(left) - markOrder.indexOf(right))
          : [];
        appendRun(children, {
          ...run,
          text: run.text.slice(before, after),
          ...(marks.length ? { marks } : { marks: undefined }),
        });
        if (after < run.text.length) appendRun(children, { ...run, text: run.text.slice(after) });
      }
      cursor = runEnd;
    }
    return { ...paragraph, children };
  });
}

export function alignParagraphRange(content: Paragraph[], start: number, end: number, align: ParagraphAlignment): Paragraph[] {
  let cursor = 0;
  return content.map(paragraph => {
    const length = paragraph.children.reduce((total, run) => total + (run.type === 'text' ? run.text.length : 1), 0);
    const paragraphEnd = cursor + length;
    const selected = start === end
      ? start >= cursor && start <= paragraphEnd
      : start <= paragraphEnd && end >= cursor;
    cursor = paragraphEnd;
    return selected ? { ...paragraph, align } : paragraph;
  });
}

function selectionOffsets(editor: HTMLElement): SelectionOffsets | undefined {
  const selection = editor.ownerDocument.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return;
  const offsetTo = (node: Node, offset: number) => {
    const measure = editor.ownerDocument.createRange();
    measure.selectNodeContents(editor);
    measure.setEnd(node, offset);
    return measure.toString().length;
  };
  return { start: offsetTo(range.startContainer, range.startOffset), end: offsetTo(range.endContainer, range.endOffset) };
}

function restoreSelection(editor: HTMLElement, offsets: SelectionOffsets) {
  const walker = editor.ownerDocument.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    nodes.push(node as Text);
    node = walker.nextNode();
  }
  if (!nodes.length) return;
  const point = (target: number) => {
    let cursor = 0;
    for (const text of nodes) {
      const end = cursor + (text.textContent?.length ?? 0);
      if (target <= end) return { node: text, offset: Math.max(0, target - cursor) };
      cursor = end;
    }
    const last = nodes.at(-1)!;
    return { node: last, offset: last.textContent?.length ?? 0 };
  };
  const start = point(offsets.start);
  const end = point(offsets.end);
  const range = editor.ownerDocument.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  const selection = editor.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function RichTextEditor({ content, label, onChange, className, enterMode = 'paragraph' }: { content: Paragraph[]; label: string; onChange(content: Paragraph[]): void; className?: string; enterMode?: 'paragraph' | 'lineBreaks' }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const signatureRef = useRef('');
  const consecutiveEnterRef = useRef(false);
  const [activeMarks, setActiveMarks] = useState<EditableMark[]>([]);
  const signature = JSON.stringify(content);
  useLayoutEffect(() => {
    if (!editorRef.current || signatureRef.current === signature) return;
    renderStructuredContent(editorRef.current, content);
    signatureRef.current = signature;
  }, [content, signature]);
  const emit = () => {
    if (!editorRef.current) return;
    const next = scriptureContentFromEditor(editorRef.current);
    signatureRef.current = JSON.stringify(next);
    onChange(next);
  };
  const updateToolbar = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const offsets = selectionOffsets(editor);
    if (!offsets) return;
    const current = scriptureContentFromEditor(editor);
    setActiveMarks(selectedTextMarks(current, offsets.start, offsets.end));
  };
  const applyFormatting = (mark?: EditableMark) => {
    const editor = editorRef.current;
    if (!editor) return;
    const offsets = selectionOffsets(editor);
    if (!offsets || offsets.start === offsets.end) return;
    const next = formatTextRange(scriptureContentFromEditor(editor), offsets.start, offsets.end, mark);
    renderStructuredContent(editor, next);
    restoreSelection(editor, offsets);
    signatureRef.current = JSON.stringify(next);
    onChange(next);
    setActiveMarks(selectedTextMarks(next, offsets.start, offsets.end));
    editor.focus();
  };
  const applyAlignment = (align: ParagraphAlignment) => {
    const editor = editorRef.current;
    if (!editor) return;
    const selection = editor.ownerDocument.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
    if (!range || !editor.contains(range.commonAncestorContainer)) return;
    const paragraphs = Array.from(editor.querySelectorAll<HTMLElement>(':scope > [data-scripture-paragraph]'));
    const selected = range.collapsed
      ? paragraphs.filter(paragraph => paragraph.contains(range.startContainer) || paragraph === range.startContainer)
      : paragraphs.filter(paragraph => range.intersectsNode(paragraph));
    for (const paragraph of selected) {
      paragraph.dataset.align = align;
      paragraph.style.textAlign = align;
    }
    emit();
    editor.focus();
  };
  const insertCross = () => {
    const editor = editorRef.current;
    const selection = editor?.ownerDocument.getSelection();
    if (!editor || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    const symbol = editor.ownerDocument.createElement('span');
    symbol.dataset.symbol = 'cross';
    symbol.textContent = '✠';
    range.deleteContents();
    range.insertNode(symbol);
    range.setStartAfter(symbol);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    emit();
    editor.focus();
  };
  const safeRichHtml = (html: string, plain: string) => {
    if (!editorRef.current || !html) return pastedHtml(plain);
    const source = editorRef.current.ownerDocument.createElement('div');
    source.innerHTML = html;
    const destination = editorRef.current.ownerDocument.createElement('div');
    renderStructuredContent(destination, scriptureContentFromEditor(source));
    return destination.innerHTML;
  };
  const toolbarButton = (mark: EditableMark, text: string, title: string, className?: string) =>
    <button type="button" className={`${className ?? ''} ${activeMarks.includes(mark) ? 'active' : ''}`.trim()} aria-label={title} aria-pressed={activeMarks.includes(mark)} title={`${title} selected text`} onMouseDown={event => event.preventDefault()} onClick={() => applyFormatting(mark)}>{text}</button>;
  return <div className="rich-text-editor-shell">
    <div className="rich-text-toolbar" role="toolbar" aria-label={`${label} formatting`}>
      {toolbarButton('bold', 'B', 'Bold', 'typography-bold')}
      {toolbarButton('italic', 'I', 'Italic', 'typography-italic')}
      {toolbarButton('smallCaps', 'Aᴀ', 'Small caps')}
      <button type="button" aria-label="Clear formatting" title="Clear formatting from selected text" onMouseDown={event => event.preventDefault()} onClick={() => applyFormatting()}>Clear</button>
      <span className="rich-text-toolbar-group" aria-label="Paragraph alignment">
        <button type="button" aria-label="Align left" title="Align paragraph left" onMouseDown={event => event.preventDefault()} onClick={() => applyAlignment('left')}>≡</button>
        <button type="button" aria-label="Align center" title="Center paragraph" onMouseDown={event => event.preventDefault()} onClick={() => applyAlignment('center')}>≣</button>
        <button type="button" aria-label="Align right" title="Align paragraph right" onMouseDown={event => event.preventDefault()} onClick={() => applyAlignment('right')}>≡</button>
      </span>
      <button type="button" aria-label="Insert cross" title="Insert cross" onMouseDown={event => event.preventDefault()} onClick={insertCross}>✠</button>
    </div>
    <div ref={editorRef} className={`rich-text-editor ${className ?? ''}`.trim()} contentEditable role="textbox" aria-label={label} aria-multiline="true" spellCheck suppressContentEditableWarning onInput={event => {
      if (!['insertLineBreak', 'insertParagraph'].includes(event.nativeEvent.inputType)) consecutiveEnterRef.current = false;
      emit(); updateToolbar();
    }} onMouseUp={updateToolbar} onKeyDown={event => {
      if (enterMode !== 'lineBreaks') return;
      if (event.key !== 'Enter') {
        consecutiveEnterRef.current = false;
        return;
      }
      event.preventDefault();
      if (consecutiveEnterRef.current) {
        const editor = editorRef.current;
        const selection = editor?.ownerDocument.getSelection();
        const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
        const start = range?.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range?.startContainer.parentElement;
        const paragraph = start?.closest<HTMLElement>('[data-scripture-paragraph]');
        if (editor && selection && range && paragraph && editor.contains(paragraph)) {
          range.deleteContents();
          const tailRange = editor.ownerDocument.createRange();
          tailRange.setStart(range.startContainer, range.startOffset);
          tailRange.setEnd(paragraph, paragraph.childNodes.length);
          const tail = tailRange.extractContents();
          const next = editor.ownerDocument.createElement('div');
          next.dataset.scriptureParagraph = '';
          if (tail.childNodes.length) next.append(tail);
          else {
            const placeholder = editor.ownerDocument.createElement('br');
            placeholder.dataset.placeholder = '';
            next.append(placeholder);
          }
          paragraph.after(next);
          const nextRange = editor.ownerDocument.createRange();
          nextRange.setStart(next, 0);
          nextRange.collapse(true);
          selection.removeAllRanges();
          selection.addRange(nextRange);
          consecutiveEnterRef.current = false;
          emit();
        }
        return;
      }
      consecutiveEnterRef.current = true;
      editorRef.current?.ownerDocument.execCommand('insertLineBreak');
    }} onKeyUp={updateToolbar} onFocus={updateToolbar} onPaste={event => {
      event.preventDefault();
      editorRef.current?.ownerDocument.execCommand('insertHTML', false, safeRichHtml(event.clipboardData.getData('text/html'), event.clipboardData.getData('text/plain')));
      emit();
    }} />
  </div>;
}
