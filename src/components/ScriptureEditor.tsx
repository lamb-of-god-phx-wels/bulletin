import { useLayoutEffect, useRef, useState } from 'react';
import { scriptureParagraphsFromText } from '../shared/scriptureText';
import type { Inline, Marks, Paragraph } from '../shared/types';

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

function renderRuns(container: HTMLElement, content: Paragraph[]) {
  container.replaceChildren();
  const owner = container.ownerDocument;
  for (const paragraph of content.length ? content : [{ type: 'paragraph' as const, children: [{ type: 'text' as const, text: '' }] }]) {
    const line = owner.createElement('div');
    line.dataset.scriptureParagraph = '';
    if (!paragraph.children.length || (paragraph.children.length === 1 && paragraph.children[0].type === 'text' && !paragraph.children[0].text)) {
      const placeholder = owner.createElement('br');
      placeholder.dataset.placeholder = '';
      line.append(placeholder);
    } else {
      for (const run of paragraph.children) {
        if (run.type === 'lineBreak') {
          const breakElement = owner.createElement('br');
          breakElement.dataset.hardBreak = '';
          line.append(breakElement);
        } else if (run.type === 'symbol') {
          const symbol = owner.createElement('span');
          symbol.dataset.symbol = run.name;
          symbol.textContent = '✠';
          line.append(symbol);
        } else if (run.marks?.includes('superscript')) {
          const verse = owner.createElement('sup');
          verse.dataset.verseMarker = '';
          verse.contentEditable = 'false';
          verse.title = `Verse ${run.text}. Click to edit.`;
          verse.textContent = run.text;
          line.append(verse);
        } else {
          const text = owner.createTextNode(run.text);
          if (run.marks?.length) {
            const marked = owner.createElement('span');
            marked.dataset.marks = run.marks.join(',');
            marked.append(text);
            line.append(marked);
          } else {
            line.append(text);
          }
        }
      }
    }
    container.append(line);
  }
}

function parseInline(node: Node, runs: Inline[], inheritedMarks?: Marks) {
  if (node.nodeType === Node.TEXT_NODE) {
    const parts = (node.textContent ?? '').replace(/\u200b/g, '').split('\n');
    parts.forEach((part, index) => {
      if (index) appendRun(runs, { type: 'lineBreak' });
      if (part) appendRun(runs, { type: 'text', text: part, ...(inheritedMarks?.length ? { marks: inheritedMarks } : {}) });
    });
    return;
  }
  if (!(node instanceof HTMLElement)) return;
  if (node.matches('br[data-placeholder]')) return;
  if (node.tagName === 'BR') {
    appendRun(runs, { type: 'lineBreak' });
    return;
  }
  if (node.matches('[data-verse-marker]') || node.tagName === 'SUP') {
    const text = (node.textContent ?? '').trim();
    if (text) appendRun(runs, { type: 'text', text, marks: ['superscript'] });
    return;
  }
  if (node.dataset.symbol === 'cross') {
    appendRun(runs, { type: 'symbol', name: 'cross' });
    return;
  }
  const ownMarks = node.dataset.marks?.split(',').filter(Boolean) as Marks | undefined;
  const marks = ownMarks?.length ? ownMarks : inheritedMarks;
  const isNestedBlock = node.tagName === 'DIV' || node.tagName === 'P';
  if (isNestedBlock && runs.length && runs.at(-1)?.type !== 'lineBreak') appendRun(runs, { type: 'lineBreak' });
  node.childNodes.forEach(child => parseInline(child, runs, marks));
}

export function scriptureContentFromEditor(container: HTMLElement): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  let looseRuns: Inline[] = [];
  const flushLoose = () => {
    if (!looseRuns.length) return;
    paragraphs.push({ type: 'paragraph', children: looseRuns });
    looseRuns = [];
  };
  container.childNodes.forEach(node => {
    if (node instanceof HTMLElement && (node.tagName === 'DIV' || node.tagName === 'P')) {
      flushLoose();
      const children: Inline[] = [];
      node.childNodes.forEach(child => parseInline(child, children));
      paragraphs.push({ type: 'paragraph', children: children.length ? children : [{ type: 'text', text: '' }] });
    } else {
      parseInline(node, looseRuns);
    }
  });
  flushLoose();
  return paragraphs.length ? paragraphs : [{ type: 'paragraph', children: [{ type: 'text', text: '' }] }];
}

function safePasteHtml(text: string) {
  const content = scriptureParagraphsFromText(text, { detectLeadingNumbers: true });
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return content.map(paragraph => `<div>${paragraph.children.map(run => {
    if (run.type === 'lineBreak') return '<br data-hard-break>';
    if (run.type === 'symbol') return '✠';
    if (run.marks?.includes('superscript')) return `<sup data-verse-marker contenteditable="false">${escape(run.text)}</sup>`;
    return escape(run.text);
  }).join('') || '<br data-placeholder>'}</div>`).join('');
}

export function ScriptureEditor({ content, onChange }: { content: Paragraph[]; onChange(content: Paragraph[]): void }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const lastSignatureRef = useRef('');
  const selectedMarkerRef = useRef<HTMLElement | null>(null);
  const historyRef = useRef<Paragraph[][]>([content]);
  const historyIndexRef = useRef(0);
  const [verseNumber, setVerseNumber] = useState('');
  const [editingMarker, setEditingMarker] = useState(false);
  const signature = JSON.stringify(content);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor || signature === lastSignatureRef.current) return;
    renderRuns(editor, content);
    lastSignatureRef.current = signature;
    historyRef.current = [content];
    historyIndexRef.current = 0;
    selectedMarkerRef.current = null;
    setEditingMarker(false);
  }, [content, signature]);

  const saveSelection = () => {
    const editor = editorRef.current;
    const selection = editor?.ownerDocument.getSelection();
    if (!editor || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) savedRangeRef.current = range.cloneRange();
  };
  const emit = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const next = scriptureContentFromEditor(editor);
    const nextSignature = JSON.stringify(next);
    const currentHistory = historyRef.current[historyIndexRef.current];
    if (JSON.stringify(currentHistory) !== nextSignature) {
      historyRef.current = [...historyRef.current.slice(0, historyIndexRef.current + 1), next].slice(-100);
      historyIndexRef.current = historyRef.current.length - 1;
    }
    lastSignatureRef.current = nextSignature;
    onChange(next);
    saveSelection();
  };
  const moveThroughHistory = (by: number) => {
    const editor = editorRef.current;
    const target = historyIndexRef.current + by;
    if (!editor || target < 0 || target >= historyRef.current.length) return;
    historyIndexRef.current = target;
    const next = historyRef.current[target];
    renderRuns(editor, next);
    lastSignatureRef.current = JSON.stringify(next);
    onChange(next);
    editor.focus();
  };
  const chooseMarker = (marker: HTMLElement) => {
    selectedMarkerRef.current?.classList.remove('is-selected');
    selectedMarkerRef.current = marker;
    marker.classList.add('is-selected');
    setVerseNumber(marker.textContent ?? '');
    setEditingMarker(true);
  };
  const setMarker = () => {
    const number = verseNumber.trim();
    if (!/^\d{1,3}$/.test(number)) return;
    const editor = editorRef.current;
    if (!editor) return;
    if (selectedMarkerRef.current?.isConnected) {
      selectedMarkerRef.current.textContent = number;
      selectedMarkerRef.current.title = `Verse ${number}. Click to edit.`;
    } else {
      const owner = editor.ownerDocument;
      const marker = owner.createElement('sup');
      marker.dataset.verseMarker = '';
      marker.contentEditable = 'false';
      marker.title = `Verse ${number}. Click to edit.`;
      marker.textContent = number;
      const spacer = owner.createTextNode(' ');
      const range = savedRangeRef.current;
      if (range && editor.contains(range.commonAncestorContainer)) {
        range.deleteContents();
        range.insertNode(spacer);
        range.insertNode(marker);
        range.setStartAfter(spacer);
        range.collapse(true);
      } else {
        const paragraph = editor.querySelector<HTMLElement>('[data-scripture-paragraph]:last-child') ?? editor;
        paragraph.append(marker, spacer);
      }
      const selection = owner.getSelection();
      selection?.removeAllRanges();
      if (range) selection?.addRange(range);
      chooseMarker(marker);
    }
    emit();
  };
  const removeMarker = () => {
    const marker = selectedMarkerRef.current;
    if (!marker?.isConnected) return;
    marker.remove();
    selectedMarkerRef.current = null;
    setEditingMarker(false);
    setVerseNumber('');
    emit();
    editorRef.current?.focus();
  };

  return <div className="scripture-editor-shell">
    <div className="scripture-editor-toolbar">
      <label>Verse number<input inputMode="numeric" pattern="[0-9]{1,3}" value={verseNumber} placeholder="16" onMouseDown={saveSelection} onChange={event => setVerseNumber(event.target.value.replace(/\D/g, '').slice(0, 3))} /></label>
      <button type="button" className="secondary" disabled={!/^\d{1,3}$/.test(verseNumber)} onMouseDown={event => { event.preventDefault(); }} onClick={setMarker}>{editingMarker ? 'Update verse' : 'Insert verse'}</button>
      {editingMarker && <button type="button" className="danger-text" onMouseDown={event => event.preventDefault()} onClick={removeMarker}>Remove verse</button>}
      <span>Enter starts a paragraph · Shift+Enter inserts a line break</span>
    </div>
    <div
      ref={editorRef}
      className="scripture-rich-editor"
      contentEditable
      role="textbox"
      aria-label="Passage text"
      aria-multiline="true"
      spellCheck
      suppressContentEditableWarning
      onInput={emit}
      onKeyDown={event => {
        if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
        const key = event.key.toLowerCase();
        if (key === 'z' && !event.shiftKey) {
          event.preventDefault();
          moveThroughHistory(-1);
        } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
          event.preventDefault();
          moveThroughHistory(1);
        }
      }}
      onKeyUp={saveSelection}
      onMouseUp={saveSelection}
      onBlur={saveSelection}
      onClick={event => {
        const marker = (event.target as HTMLElement).closest<HTMLElement>('[data-verse-marker]');
        if (marker) chooseMarker(marker);
        else {
          selectedMarkerRef.current?.classList.remove('is-selected');
          selectedMarkerRef.current = null;
          setEditingMarker(false);
        }
      }}
      onPaste={event => {
        event.preventDefault();
        const text = event.clipboardData.getData('text/plain');
        editorRef.current?.ownerDocument.execCommand('insertHTML', false, safePasteHtml(text));
        emit();
      }}
    />
  </div>;
}
