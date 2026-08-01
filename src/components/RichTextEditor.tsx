import { useEffect, useLayoutEffect, useRef } from 'react';
import type { CustomBlockStyle, Inline, InlineTextStyle, Marks, Paragraph, TextRun } from '../shared/types';
import { renderStructuredContent, scriptureContentFromEditor } from './ScriptureEditor';
import { useRichTextEditing, type RichTextAdapter, type RichTextToolbarState } from './RichTextEditing';

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pastedHtml = (value: string) => value.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(paragraph => `<div>${escape(paragraph).replace(/\n/g, '<br>') || '<br data-placeholder>'}</div>`).join('');
type EditableMark = Extract<Marks[number], 'bold' | 'italic' | 'smallCaps'>;
type SelectionOffsets = { start: number; end: number };

const markOrder: Marks[number][] = ['bold', 'italic', 'smallCaps', 'superscript'];
type ParagraphAlignment = NonNullable<Paragraph['align']>;

function sameMarks(left?: Marks, right?: Marks) {
  return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
}

function sameStyle(left?: InlineTextStyle, right?: InlineTextStyle) {
  return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});
}

function appendRun(runs: Inline[], run: Inline) {
  const previous = runs.at(-1);
  if (run.type === 'text' && previous?.type === 'text' && sameMarks(previous.marks, run.marks) && sameStyle(previous.style, run.style)) {
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

function selectedTextStyle(content: Paragraph[], start: number, end: number): InlineTextStyle {
  const runs = selectedRuns(content, start, end);
  if (!runs.length) return {};
  const common = <K extends keyof InlineTextStyle>(key: K) => {
    const value = runs[0].style?.[key];
    return runs.every(run => run.style?.[key] === value) ? value : undefined;
  };
  return { fontFamily: common('fontFamily'), fontSizePt: common('fontSizePt'), textTransform: common('textTransform') };
}

export function formatTextStyleRange(content: Paragraph[], start: number, end: number, changes: InlineTextStyle): Paragraph[] {
  if (start === end) return content;
  let cursor = 0;
  return content.map(paragraph => {
    const children: Inline[] = [];
    for (const run of paragraph.children) {
      if (run.type !== 'text') { appendRun(children, run); continue; }
      const runStart = cursor;
      const runEnd = cursor + run.text.length;
      const selectionStart = Math.max(runStart, start);
      const selectionEnd = Math.min(runEnd, end);
      if (selectionStart >= selectionEnd) appendRun(children, run);
      else {
        const before = selectionStart - runStart;
        const after = selectionEnd - runStart;
        if (before) appendRun(children, { ...run, text: run.text.slice(0, before) });
        const style = { ...(run.style ?? {}), ...changes };
        Object.keys(style).forEach(key => style[key as keyof InlineTextStyle] === undefined && delete style[key as keyof InlineTextStyle]);
        appendRun(children, { ...run, text: run.text.slice(before, after), ...(Object.keys(style).length ? { style } : { style: undefined }) });
        if (after < run.text.length) appendRun(children, { ...run, text: run.text.slice(after) });
      }
      cursor = runEnd;
    }
    return { ...paragraph, children };
  });
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

export function formatParagraphRange(content: Paragraph[], start: number, end: number, changes: Pick<Paragraph, 'align' | 'lineHeight'>): Paragraph[] {
  let cursor = 0;
  return content.map(paragraph => {
    const length = paragraph.children.reduce((total, run) => total + (run.type === 'text' ? run.text.length : 1), 0);
    const paragraphEnd = cursor + length;
    const selected = start === end ? start >= cursor && start <= paragraphEnd : start <= paragraphEnd && end >= cursor;
    cursor = paragraphEnd;
    return selected ? { ...paragraph, ...changes } : paragraph;
  });
}

export function structuredTextForClipboard(content: Paragraph[]) {
  return content.map((paragraph, index) => {
    const text = paragraph.children.map(run => run.type === 'text' ? run.text : run.type === 'symbol' ? '✠' : '\n').join('');
    return `${index ? paragraph.breakBefore === 'line' ? '\n' : '\n\n' : ''}${text}`;
  }).join('');
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

function selectedParagraphIndexes(editor: HTMLElement): { start: number; end: number } | undefined {
  const selection = editor.ownerDocument.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return;
  const paragraphs = Array.from(editor.querySelectorAll<HTMLElement>(':scope > [data-scripture-paragraph]'));
  const containingParagraph = (node: Node, offset: number) => {
    if (node === editor) {
      const child = editor.children[Math.min(offset, Math.max(0, editor.children.length - 1))];
      return child instanceof HTMLElement ? child : undefined;
    }
    const element = node.nodeType === Node.ELEMENT_NODE ? node as HTMLElement : node.parentElement;
    return element?.closest<HTMLElement>('[data-scripture-paragraph]');
  };
  const start = containingParagraph(range.startContainer, range.startOffset);
  const end = containingParagraph(range.endContainer, range.endOffset);
  const startIndex = start ? paragraphs.indexOf(start) : -1;
  const endIndex = end ? paragraphs.indexOf(end) : -1;
  if (startIndex < 0 || endIndex < 0) return;
  return { start: Math.min(startIndex, endIndex), end: Math.max(startIndex, endIndex) };
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

export function RichTextEditor({ content, label, onChange, className, enterMode = 'paragraph', variant = 'field', readOnly = false, onReset, verticalAlign, onVerticalAlignChange, onEditingFocus, onEditingBlur, onRender, commitDelayMs }: {
  content: Paragraph[];
  label: string;
  onChange(content: Paragraph[]): void;
  className?: string;
  enterMode?: 'paragraph' | 'responsiveLines';
  variant?: 'field' | 'preview' | 'canvas';
  readOnly?: boolean;
  onReset?(): void;
  verticalAlign?: CustomBlockStyle['verticalAlign'];
  onVerticalAlignChange?(value: CustomBlockStyle['verticalAlign']): void;
  onEditingFocus?(): void;
  onEditingBlur?(): void;
  onRender?(editor: HTMLElement): void;
  commitDelayMs?: number;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const signatureRef = useRef('');
  const consecutiveEnterRef = useRef(false);
  const toolbarStateRef = useRef<RichTextToolbarState>({ marks: [] });
  const pendingRef = useRef<{ marks: EditableMark[]; style: InlineTextStyle }>({ marks: [], style: {} });
  const adapterRef = useRef<RichTextAdapter | undefined>(undefined);
  const savedSelectionRef = useRef<SelectionOffsets | undefined>(undefined);
  const savedParagraphSelectionRef = useRef<{ start: number; end: number } | undefined>(undefined);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onRenderRef = useRef(onRender);
  onRenderRef.current = onRender;
  const commitTimerRef = useRef<number | undefined>(undefined);
  const pendingCommitRef = useRef<Paragraph[] | undefined>(undefined);
  const editing = useRichTextEditing();
  const delay = commitDelayMs ?? (variant === 'preview' ? 500 : 0);
  const commitChange = (next: Paragraph[]) => {
    pendingCommitRef.current = next;
    if (!delay) {
      pendingCommitRef.current = undefined;
      onChangeRef.current(next);
      return;
    }
    if (commitTimerRef.current !== undefined) window.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = window.setTimeout(() => {
      commitTimerRef.current = undefined;
      const pending = pendingCommitRef.current;
      pendingCommitRef.current = undefined;
      if (pending) onChangeRef.current(pending);
    }, delay);
  };
  const flushCommit = () => {
    if (commitTimerRef.current !== undefined) window.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = undefined;
    const pending = pendingCommitRef.current;
    pendingCommitRef.current = undefined;
    if (pending) onChangeRef.current(pending);
  };
  useEffect(() => () => flushCommit(), []);
  const signature = JSON.stringify(content);
  const renderEditorContent = (editor: HTMLElement, next: Paragraph[]) => {
    renderStructuredContent(editor, next);
    onRenderRef.current?.(editor);
  };
  useLayoutEffect(() => {
    if (!editorRef.current || signatureRef.current === signature) return;
    renderEditorContent(editorRef.current, content);
    signatureRef.current = signature;
  }, [content, signature]);
  const emit = () => {
    if (!editorRef.current) return;
    const next = scriptureContentFromEditor(editorRef.current);
    signatureRef.current = JSON.stringify(next);
    commitChange(next);
    onRenderRef.current?.(editorRef.current);
  };
  const preserveSelection = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const offsets = selectionOffsets(editor);
    if (offsets) savedSelectionRef.current = offsets;
    const paragraphs = selectedParagraphIndexes(editor);
    if (paragraphs) savedParagraphSelectionRef.current = paragraphs;
  };
  const commandSelection = () => {
    preserveSelection();
    return savedSelectionRef.current;
  };
  const stateForSelection = (): RichTextToolbarState => {
    const editor = editorRef.current;
    const offsets = editor ? selectionOffsets(editor) ?? savedSelectionRef.current : undefined;
    if (!editor || !offsets) return toolbarStateRef.current;
    const current = scriptureContentFromEditor(editor);
    const marks = offsets.start === offsets.end ? pendingRef.current.marks : selectedTextMarks(current, offsets.start, offsets.end);
    const style = offsets.start === offsets.end ? pendingRef.current.style : selectedTextStyle(current, offsets.start, offsets.end);
    let cursor = 0;
    const paragraph = current.find(item => {
      const length = item.children.reduce((total, run) => total + (run.type === 'text' ? run.text.length : 1), 0);
      const found = offsets.start >= cursor && offsets.start <= cursor + length;
      cursor += length;
      return found;
    });
    return { marks, ...style, align: paragraph?.align, lineHeight: paragraph?.lineHeight, verticalAlign, canReset: Boolean(onReset) };
  };
  const updateToolbar = () => {
    preserveSelection();
    const state = stateForSelection();
    toolbarStateRef.current = state;
    if (adapterRef.current) editing.refresh(adapterRef.current);
  };
  const applyFormatting = (mark?: EditableMark) => {
    const editor = editorRef.current;
    if (!editor) return;
    const offsets = commandSelection();
    if (!offsets) return;
    if (offsets.start === offsets.end) {
      if (!mark) pendingRef.current = { marks: [], style: {} };
      else pendingRef.current = { ...pendingRef.current, marks: pendingRef.current.marks.includes(mark) ? pendingRef.current.marks.filter(value => value !== mark) : [...pendingRef.current.marks, mark] };
      updateToolbar();
      return;
    }
    const next = formatTextRange(scriptureContentFromEditor(editor), offsets.start, offsets.end, mark);
    renderEditorContent(editor, next);
    restoreSelection(editor, offsets);
    signatureRef.current = JSON.stringify(next);
    commitChange(next);
    editor.focus();
  };
  const applyInlineStyle = (changes: InlineTextStyle) => {
    const editor = editorRef.current;
    if (!editor) return;
    const offsets = commandSelection();
    if (!offsets) return;
    if (offsets.start === offsets.end) {
      pendingRef.current = { ...pendingRef.current, style: { ...pendingRef.current.style, ...changes } };
      updateToolbar();
      return;
    }
    const next = formatTextStyleRange(scriptureContentFromEditor(editor), offsets.start, offsets.end, changes);
    renderEditorContent(editor, next);
    restoreSelection(editor, offsets);
    signatureRef.current = JSON.stringify(next);
    commitChange(next);
    updateToolbar();
  };
  const applyParagraphChanges = (changes: Pick<Paragraph, 'align' | 'lineHeight'>) => {
    const editor = editorRef.current;
    if (!editor) return;
    const offsets = commandSelection();
    if (!offsets) return;
    const current = scriptureContentFromEditor(editor);
    const indexes = selectedParagraphIndexes(editor) ?? savedParagraphSelectionRef.current;
    const next = indexes
      ? current.map((paragraph, index) => index >= indexes.start && index <= indexes.end ? { ...paragraph, ...changes } : paragraph)
      : formatParagraphRange(current, offsets.start, offsets.end, changes);
    renderEditorContent(editor, next);
    restoreSelection(editor, offsets);
    signatureRef.current = JSON.stringify(next);
    commitChange(next);
    updateToolbar();
  };
  const clearFormatting = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const offsets = commandSelection();
    if (!offsets) return;
    if (offsets.start === offsets.end) {
      pendingRef.current = { marks: [], style: {} };
      updateToolbar();
      return;
    }
    const withoutMarks = formatTextRange(scriptureContentFromEditor(editor), offsets.start, offsets.end);
    const next = formatTextStyleRange(withoutMarks, offsets.start, offsets.end, { fontFamily: undefined, fontSizePt: undefined, textTransform: undefined });
    renderEditorContent(editor, next);
    restoreSelection(editor, offsets);
    signatureRef.current = JSON.stringify(next);
    commitChange(next);
    updateToolbar();
  };
  const finishEditing = () => {
    const editor = editorRef.current;
    const focused = editor?.ownerDocument.activeElement;
    if (!editor || focused === editor || (focused instanceof Element && (editor.contains(focused) || focused.closest('.global-rich-text-toolbar')))) return;
    flushCommit();
    onEditingBlur?.();
    if (adapterRef.current) editing.deactivate(adapterRef.current);
  };
  const safeRichHtml = (html: string, plain: string) => {
    if (!editorRef.current || !html) return pastedHtml(plain);
    const source = editorRef.current.ownerDocument.createElement('div');
    source.innerHTML = html;
    const destination = editorRef.current.ownerDocument.createElement('div');
    renderStructuredContent(destination, scriptureContentFromEditor(source));
    return destination.innerHTML;
  };
  const adapter = adapterRef.current ?? ({ id: `rich-text-${Math.random().toString(36).slice(2)}` } as RichTextAdapter);
  Object.assign(adapter, {
    state: stateForSelection,
    mark: applyFormatting,
    inlineStyle: applyInlineStyle,
    paragraph: applyParagraphChanges,
    clear: clearFormatting,
    verticalAlign: onVerticalAlignChange,
    reset: onReset,
    preserveSelection,
    finish: finishEditing,
    focus: () => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      if (savedSelectionRef.current) restoreSelection(editor, savedSelectionRef.current);
    },
  });
  adapterRef.current = adapter;
  return <div className={`rich-text-editor-shell rich-text-${variant}`} onClick={variant === 'field' ? undefined : event => event.stopPropagation()}>
    <div ref={editorRef} className={`rich-text-editor ${className ?? ''}`.trim()} contentEditable={!readOnly} role="textbox" aria-label={label} aria-multiline="true" spellCheck suppressContentEditableWarning onBeforeInput={event => {
      if (readOnly || event.nativeEvent.inputType !== 'insertText' || !event.nativeEvent.data) return;
      const pending = pendingRef.current;
      if (!pending.marks.length && !Object.keys(pending.style).length) return;
      const editor = editorRef.current;
      const selection = editor?.ownerDocument.getSelection();
      if (!editor || !selection?.rangeCount || !editor.contains(selection.getRangeAt(0).commonAncestorContainer)) return;
      event.preventDefault();
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const span = editor.ownerDocument.createElement('span');
      if (pending.marks.length) span.dataset.marks = pending.marks.join(',');
      if (Object.keys(pending.style).length) span.dataset.textStyle = JSON.stringify(pending.style);
      span.textContent = event.nativeEvent.data;
      range.insertNode(span);
      range.setStartAfter(span); range.collapse(true);
      selection.removeAllRanges(); selection.addRange(range);
      emit(); updateToolbar();
    }} onInput={event => {
      if (!['insertLineBreak', 'insertParagraph'].includes(event.nativeEvent.inputType)) consecutiveEnterRef.current = false;
      emit(); updateToolbar();
    }} onMouseUp={() => { consecutiveEnterRef.current = false; updateToolbar(); }} onKeyDown={event => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && ['b', 'i'].includes(event.key.toLowerCase())) {
        event.preventDefault();
        applyFormatting(event.key.toLowerCase() === 'b' ? 'bold' : 'italic');
        return;
      }
      if (enterMode !== 'responsiveLines') return;
      if (event.key !== 'Enter') {
        consecutiveEnterRef.current = false;
        return;
      }
      event.preventDefault();
      const editor = editorRef.current;
      const selection = editor?.ownerDocument.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
      const start = range?.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range?.startContainer.parentElement;
      const paragraph = start?.closest<HTMLElement>('[data-scripture-paragraph]');
      if (!editor || !selection || !range || !paragraph || !editor.contains(paragraph)) return;
      if (consecutiveEnterRef.current && paragraph.dataset.breakBefore === 'line' && !(paragraph.textContent ?? '').replace(/\u200b/g, '').trim()) {
        delete paragraph.dataset.breakBefore;
        consecutiveEnterRef.current = false;
        emit();
        return;
      }
      range.deleteContents();
      const tailRange = editor.ownerDocument.createRange();
      tailRange.setStart(range.startContainer, range.startOffset);
      tailRange.setEnd(paragraph, paragraph.childNodes.length);
      const tail = tailRange.extractContents();
      const next = editor.ownerDocument.createElement('div');
      next.dataset.scriptureParagraph = '';
      next.dataset.breakBefore = 'line';
      if (tail.childNodes.length) next.append(tail);
      const caretAnchor = editor.ownerDocument.createTextNode('\u200b');
      if (!tail.childNodes.length) next.append(caretAnchor);
      else next.prepend(caretAnchor);
      paragraph.after(next);
      const nextRange = editor.ownerDocument.createRange();
      nextRange.setStart(caretAnchor, 1);
      nextRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(nextRange);
      consecutiveEnterRef.current = true;
      emit();
    }} onKeyUp={updateToolbar} onFocus={() => { editing.activate(adapter); updateToolbar(); onEditingFocus?.(); }} onBlur={() => {
      preserveSelection();
      window.setTimeout(() => {
        const focused = editorRef.current?.ownerDocument.activeElement;
        if (focused instanceof Element && focused.closest('.global-rich-text-toolbar')) return;
        finishEditing();
      });
    }} onCopy={event => {
      if (enterMode !== 'responsiveLines') return;
      const editor = editorRef.current;
      const selection = editor?.ownerDocument.getSelection();
      if (!editor || !selection?.rangeCount || selection.isCollapsed) return;
      const range = selection.getRangeAt(0);
      if (!editor.contains(range.commonAncestorContainer)) return;
      const container = editor.ownerDocument.createElement('div');
      container.append(range.cloneContents());
      event.preventDefault();
      event.clipboardData.setData('text/plain', structuredTextForClipboard(scriptureContentFromEditor(container)));
      event.clipboardData.setData('text/html', container.innerHTML);
    }} onPaste={event => {
      event.preventDefault();
      editorRef.current?.ownerDocument.execCommand('insertHTML', false, safeRichHtml(event.clipboardData.getData('text/html'), event.clipboardData.getData('text/plain')));
      emit();
    }} />
  </div>;
}
