import { useLayoutEffect, useRef, useState } from 'react';
import type { Inline, Marks, Paragraph, TextRun } from '../shared/types';
import { renderStructuredContent, scriptureContentFromEditor } from './ScriptureEditor';

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pastedHtml = (value: string) => value.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(paragraph => `<div>${escape(paragraph).replace(/\n/g, '<br>') || '<br data-placeholder>'}</div>`).join('');
type EditableMark = Extract<Marks[number], 'bold' | 'italic' | 'smallCaps'>;
type SelectionOffsets = { start: number; end: number };

const markOrder: Marks[number][] = ['bold', 'italic', 'smallCaps', 'superscript'];

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

export function RichTextEditor({ content, label, onChange }: { content: Paragraph[]; label: string; onChange(content: Paragraph[]): void }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const signatureRef = useRef('');
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
  const toolbarButton = (mark: EditableMark, text: string, title: string, className?: string) =>
    <button type="button" className={`${className ?? ''} ${activeMarks.includes(mark) ? 'active' : ''}`.trim()} aria-label={title} aria-pressed={activeMarks.includes(mark)} title={`${title} selected text`} onMouseDown={event => event.preventDefault()} onClick={() => applyFormatting(mark)}>{text}</button>;
  return <div className="rich-text-editor-shell">
    <div className="rich-text-toolbar" role="toolbar" aria-label={`${label} formatting`}>
      {toolbarButton('bold', 'B', 'Bold', 'typography-bold')}
      {toolbarButton('italic', 'I', 'Italic', 'typography-italic')}
      {toolbarButton('smallCaps', 'Aᴀ', 'Small caps')}
      <button type="button" aria-label="Clear formatting" title="Clear formatting from selected text" onMouseDown={event => event.preventDefault()} onClick={() => applyFormatting()}>Clear</button>
    </div>
    <div ref={editorRef} className="rich-text-editor" contentEditable role="textbox" aria-label={label} aria-multiline="true" spellCheck suppressContentEditableWarning onInput={() => { emit(); updateToolbar(); }} onMouseUp={updateToolbar} onKeyUp={updateToolbar} onFocus={updateToolbar} onPaste={event => {
      event.preventDefault();
      editorRef.current?.ownerDocument.execCommand('insertHTML', false, pastedHtml(event.clipboardData.getData('text/plain')));
      emit();
    }} />
  </div>;
}
