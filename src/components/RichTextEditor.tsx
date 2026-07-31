import { useLayoutEffect, useRef } from 'react';
import type { Marks, Paragraph } from '../shared/types';
import { renderStructuredContent, scriptureContentFromEditor } from './ScriptureEditor';

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pastedHtml = (value: string) => value.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(paragraph => `<div>${escape(paragraph).replace(/\n/g, '<br>') || '<br data-placeholder>'}</div>`).join('');

export function RichTextEditor({ content, label, onChange }: { content: Paragraph[]; label: string; onChange(content: Paragraph[]): void }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const signatureRef = useRef('');
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
  const command = (name: 'bold' | 'italic' | 'removeFormat') => {
    editorRef.current?.focus();
    editorRef.current?.ownerDocument.execCommand(name, false);
    emit();
  };
  const applyMark = (mark: Marks[number]) => {
    const editor = editorRef.current;
    const selection = editor?.ownerDocument.getSelection();
    if (!editor || !selection?.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    const span = editor.ownerDocument.createElement('span');
    span.dataset.marks = mark;
    span.append(range.extractContents());
    range.insertNode(span);
    selection.removeAllRanges();
    const next = editor.ownerDocument.createRange();
    next.selectNodeContents(span); selection.addRange(next);
    emit();
  };
  return <div className="rich-text-editor-shell">
    <div className="rich-text-toolbar" role="toolbar" aria-label={`${label} formatting`}>
      <button type="button" className="typography-bold" aria-label="Bold" title="Bold" onMouseDown={event => event.preventDefault()} onClick={() => command('bold')}>B</button>
      <button type="button" className="typography-italic" aria-label="Italic" title="Italic" onMouseDown={event => event.preventDefault()} onClick={() => command('italic')}>I</button>
      <button type="button" aria-label="Small caps" title="Small caps" onMouseDown={event => event.preventDefault()} onClick={() => applyMark('smallCaps')}>Aᴀ</button>
      <button type="button" aria-label="Clear formatting" title="Clear formatting" onMouseDown={event => event.preventDefault()} onClick={() => command('removeFormat')}>Clear</button>
    </div>
    <div ref={editorRef} className="rich-text-editor" contentEditable role="textbox" aria-label={label} aria-multiline="true" spellCheck suppressContentEditableWarning onInput={emit} onPaste={event => {
      event.preventDefault();
      editorRef.current?.ownerDocument.execCommand('insertHTML', false, pastedHtml(event.clipboardData.getData('text/plain')));
      emit();
    }} />
  </div>;
}
