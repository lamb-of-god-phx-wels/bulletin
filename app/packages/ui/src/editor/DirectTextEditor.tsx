import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ClipboardEvent,
} from "react";
import {
  sanitizeExternalHtml,
  type BlockNode,
  type RichTextDocument,
  type TextContent,
} from "@cbb/core";
import { Button } from "../design-system/index.js";
import { createSetTextContentCommand } from "../store/commands/commands.js";
import type { EditorStore } from "../store/editorStore.js";
import { RichTextView } from "./RichTextView.js";
import { canonicalSpellingWord } from "./spelling.js";

type ParagraphStyle = "paragraph" | "heading1" | "heading2" | "heading3" | "heading4" | "heading5" | "heading6";
type BlockToggle = "bulletList" | "orderedList" | "blockquote";
type BlockStyle = ParagraphStyle | BlockToggle;
type Mark = "strong" | "emphasis";
type PressedState = boolean | "mixed";
type MaterializedTextContent =
  | { readonly kind: "plain"; readonly text: string }
  | { readonly kind: "richText"; readonly document: RichTextDocument };

const EMPTY_RICH_TEXT_DOCUMENT: RichTextDocument = Object.freeze({
  type: "document",
  blocks: Object.freeze([{ type: "paragraph", children: Object.freeze([]) }]),
}) as RichTextDocument;

function materializeTextContent(content: TextContent): MaterializedTextContent {
  return content.kind === "plain"
    ? { kind: "plain", text: content.text ?? "" }
    : { kind: "richText", document: content.document ?? EMPTY_RICH_TEXT_DOCUMENT };
}

interface SelectionFormattingState {
  readonly strong: PressedState;
  readonly emphasis: PressedState;
  readonly paragraphStyles: readonly ParagraphStyle[];
  readonly bulletList: PressedState;
  readonly orderedList: PressedState;
  readonly blockquote: PressedState;
}

interface BlockFormattingContext {
  readonly paragraphStyle: ParagraphStyle;
  readonly listStyle?: "bulletList" | "orderedList" | undefined;
  readonly blockquote: boolean;
}

const DEFAULT_BLOCK_FORMATTING: BlockFormattingContext = {
  paragraphStyle: "paragraph",
  blockquote: false,
};

function initialBlockFormatting(content: MaterializedTextContent): BlockFormattingContext {
  if (content.kind === "plain") return DEFAULT_BLOCK_FORMATTING;
  const visit = (
    block: BlockNode | undefined,
    inherited: BlockFormattingContext,
  ): BlockFormattingContext => {
    if (block === undefined || block.type === "scripture") return inherited;
    if (block.type === "paragraph") return inherited;
    if (block.type === "heading") {
      return { ...inherited, paragraphStyle: `heading${block.level}` };
    }
    if (block.type === "blockquote") {
      return visit(block.children[0], { ...inherited, blockquote: true });
    }
    const firstChild = block.children[0]?.children[0];
    return visit(firstChild, { ...inherited, listStyle: block.type });
  };
  return visit(content.document.blocks[0], DEFAULT_BLOCK_FORMATTING);
}

function initialMarks(content: MaterializedTextContent): readonly Mark[] {
  if (content.kind === "plain") return [];
  const first = content.document.blocks[0];
  const inlines = first?.type === "paragraph" || first?.type === "heading"
    ? first.children
    : first?.type === "blockquote"
      ? first.children[0]?.type === "paragraph" ? first.children[0].children : []
      : first?.type === "bulletList" || first?.type === "orderedList"
        ? first.children[0]?.children[0]?.type === "paragraph" ? first.children[0].children[0].children : []
        : [];
  const text = inlines.find((node) => node.type === "text");
  return text?.type === "text" ? text.marks ?? [] : [];
}

function initialFormattingState(content: MaterializedTextContent): SelectionFormattingState {
  const marks = initialMarks(content);
  const block = initialBlockFormatting(content);
  return {
    strong: marks.includes("strong"),
    emphasis: marks.includes("emphasis"),
    paragraphStyles: [block.paragraphStyle],
    bulletList: block.listStyle === "bulletList",
    orderedList: block.listStyle === "orderedList",
    blockquote: block.blockquote,
  };
}

function elementWithinEditor(node: Node, editor: HTMLElement): HTMLElement | undefined {
  let element = node.nodeType === Node.ELEMENT_NODE
    ? node as HTMLElement
    : node.parentElement ?? undefined;
  while (element !== undefined && element !== editor && !editor.contains(element)) {
    element = element.parentElement ?? undefined;
  }
  return element;
}

function hasMark(node: Node, editor: HTMLElement, mark: Mark): boolean {
  const tags = mark === "strong" ? new Set(["STRONG", "B"]) : new Set(["EM", "I"]);
  let element = elementWithinEditor(node, editor);
  while (element !== undefined && element !== editor) {
    if (tags.has(element.tagName)) return true;
    element = element.parentElement ?? undefined;
  }
  return false;
}

function blockFormattingForNode(node: Node, editor: HTMLElement): BlockFormattingContext {
  let element = elementWithinEditor(node, editor);
  let paragraphStyle: ParagraphStyle = "paragraph";
  let listStyle: BlockFormattingContext["listStyle"];
  let blockquote = false;
  while (element !== undefined && element !== editor) {
    const tag = element.tagName;
    if (/^H[1-6]$/u.test(tag)) paragraphStyle = `heading${tag.slice(1)}` as ParagraphStyle;
    if (listStyle === undefined && tag === "UL") listStyle = "bulletList";
    if (listStyle === undefined && tag === "OL") listStyle = "orderedList";
    if (tag === "BLOCKQUOTE") blockquote = true;
    element = element.parentElement ?? undefined;
  }
  return { paragraphStyle, listStyle, blockquote };
}

function firstTextDescendant(node: Node, fromEnd: boolean): Text | undefined {
  if (node.nodeType === Node.TEXT_NODE) return node as Text;
  const children = node.childNodes;
  const indices = fromEnd
    ? Array.from({ length: children.length }, (_, index) => children.length - index - 1)
    : Array.from({ length: children.length }, (_, index) => index);
  for (const index of indices) {
    const child = children[index];
    if (child === undefined) continue;
    const text = firstTextDescendant(child, fromEnd);
    if (text !== undefined) return text;
  }
  return undefined;
}

function caretTextNode(range: Range): Text | undefined {
  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    return range.startContainer as Text;
  }
  const container = range.startContainer;
  const next = container.childNodes[range.startOffset];
  if (next !== undefined) {
    const text = firstTextDescendant(next, false);
    if (text !== undefined) return text;
  }
  const previous = container.childNodes[range.startOffset - 1];
  return previous === undefined ? undefined : firstTextDescendant(previous, true);
}

function selectedTextNodes(editor: HTMLElement, range: Range): readonly Text[] {
  if (range.collapsed) {
    const text = caretTextNode(range);
    return text === undefined ? [] : [text];
  }
  const view = editor.ownerDocument.defaultView;
  const showText = view?.NodeFilter.SHOW_TEXT ?? 4;
  const walker = editor.ownerDocument.createTreeWalker(editor, showText);
  const result: Text[] = [];
  for (let candidate = walker.nextNode(); candidate !== null; candidate = walker.nextNode()) {
    if ((candidate.nodeValue?.length ?? 0) === 0) continue;
    try {
      if (range.intersectsNode(candidate)) result.push(candidate as Text);
    } catch {
      // A stale selection can briefly reference a node React just replaced.
    }
  }
  return result;
}

function pressedState(values: readonly boolean[]): PressedState {
  if (values.length === 0) return false;
  const first = values[0] ?? false;
  return values.every((value) => value === first) ? first : "mixed";
}

function formattingForSelection(
  editor: HTMLElement,
  selection: Selection | null,
): SelectionFormattingState | undefined {
  if (selection === null || selection.rangeCount === 0) return undefined;
  const range = selection.getRangeAt(0);
  if (
    !editor.contains(range.startContainer) ||
    !editor.contains(range.endContainer)
  ) {
    return undefined;
  }
  const textNodes = selectedTextNodes(editor, range);
  const contextNodes: readonly Node[] = textNodes.length === 0
    ? [range.startContainer]
    : textNodes;
  const blockContexts = contextNodes.map((node) => blockFormattingForNode(node, editor));
  const paragraphStyles = [...new Set(blockContexts.map((context) => context.paragraphStyle))];
  return {
    strong: pressedState(contextNodes.map((node) => hasMark(node, editor, "strong"))),
    emphasis: pressedState(contextNodes.map((node) => hasMark(node, editor, "emphasis"))),
    paragraphStyles,
    bulletList: pressedState(blockContexts.map((context) => context.listStyle === "bulletList")),
    orderedList: pressedState(blockContexts.map((context) => context.listStyle === "orderedList")),
    blockquote: pressedState(blockContexts.map((context) => context.blockquote)),
  };
}

function sameFormattingState(
  left: SelectionFormattingState,
  right: SelectionFormattingState,
): boolean {
  return left.strong === right.strong &&
    left.emphasis === right.emphasis &&
    left.bulletList === right.bulletList &&
    left.orderedList === right.orderedList &&
    left.blockquote === right.blockquote &&
    left.paragraphStyles.length === right.paragraphStyles.length &&
    left.paragraphStyles.every((style, index) => style === right.paragraphStyles[index]);
}

function supportsLosslessDirectEditing(content: MaterializedTextContent): boolean {
  if (content.kind === "plain") return true;
  const containsScripture = (blocks: readonly BlockNode[]): boolean => blocks.some((block) =>
    block.type === "scripture" ||
    (block.type !== "paragraph" && block.type !== "heading" &&
      containsScripture(block.children.flatMap((child) =>
        child.type === "listItem" ? child.children : [child]
      )))
  );
  return !containsScripture(content.document.blocks);
}

const SPELLING_TOKEN = /[\p{L}\p{M}]+(?:['’\u2010-\u2015-][\p{L}\p{M}]+)*/gu;

interface SelectedSpellingWord {
  readonly display: string;
  readonly canonical: string;
  readonly range: Range;
}

function spellingWordAtSelection(
  editor: HTMLElement,
  selection: Selection | null,
): SelectedSpellingWord | undefined {
  if (selection === null || selection.rangeCount === 0) return undefined;
  const selectedRange = selection.getRangeAt(0);
  if (!editor.contains(selectedRange.startContainer) || !editor.contains(selectedRange.endContainer)) {
    return undefined;
  }
  if (!selectedRange.collapsed) {
    if (selectedRange.startContainer !== selectedRange.endContainer ||
      selectedRange.startContainer.nodeType !== Node.TEXT_NODE) return undefined;
    const display = selectedRange.toString();
    const canonical = canonicalSpellingWord(display);
    return canonical === undefined
      ? undefined
      : { display, canonical, range: selectedRange.cloneRange() };
  }
  const node = selectedRange.startContainer.nodeType === Node.TEXT_NODE
    ? selectedRange.startContainer as Text
    : caretTextNode(selectedRange);
  if (node === undefined) return undefined;
  const offset = selectedRange.startContainer === node
    ? selectedRange.startOffset
    : node.data.length;
  for (const match of node.data.matchAll(SPELLING_TOKEN)) {
    const start = match.index;
    const display = match[0] ?? "";
    const end = start + display.length;
    if (offset < start || offset > end) continue;
    const canonical = canonicalSpellingWord(display);
    if (canonical === undefined) return undefined;
    const range = editor.ownerDocument.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    return { display, canonical, range };
  }
  return undefined;
}

function wrapSpellingRange(range: Range, canonical: string): boolean {
  if (range.collapsed || range.startContainer !== range.endContainer ||
    range.startContainer.nodeType !== Node.TEXT_NODE) return false;
  const owner = range.startContainer.ownerDocument;
  if (owner === null) return false;
  const wrapper = owner.createElement("span");
  wrapper.dataset["cbbSpellingExclusion"] = canonical;
  wrapper.spellcheck = false;
  try {
    range.surroundContents(wrapper);
    return true;
  } catch {
    return false;
  }
}

function applySpellingExclusions(editor: HTMLElement, values: readonly string[]): void {
  const excluded = new Set(values.map(canonicalSpellingWord).filter((word): word is string => word !== undefined));
  if (excluded.size === 0) return;
  const view = editor.ownerDocument.defaultView;
  const walker = editor.ownerDocument.createTreeWalker(
    editor,
    view?.NodeFilter.SHOW_TEXT ?? 4,
  );
  const ranges: { readonly range: Range; readonly canonical: string }[] = [];
  for (let candidate = walker.nextNode(); candidate !== null; candidate = walker.nextNode()) {
    const text = candidate as Text;
    if (text.parentElement?.closest("[data-cbb-spelling-exclusion]") !== null) continue;
    for (const match of text.data.matchAll(SPELLING_TOKEN)) {
      const display = match[0] ?? "";
      const canonical = canonicalSpellingWord(display);
      if (canonical === undefined || !excluded.has(canonical)) continue;
      const range = editor.ownerDocument.createRange();
      range.setStart(text, match.index);
      range.setEnd(text, match.index + display.length);
      ranges.push({ range, canonical });
    }
  }
  for (const item of ranges.reverse()) wrapSpellingRange(item.range, item.canonical);
}

export interface DirectTextEditorProps {
  readonly nodeId: string;
  readonly content: TextContent;
  readonly contentTarget?: "textContent" | "musicRichContent" | undefined;
  readonly contentLabel?: string | undefined;
  readonly editable: boolean;
  readonly disabledReason?: string | undefined;
  readonly store: EditorStore;
  readonly selected: boolean;
  readonly fragmentIndices?: readonly number[] | undefined;
  readonly richFormattingAllowed?: boolean | undefined;
  readonly onInsertScripture?: ((nodeId: string, content: TextContent) => void) | undefined;
  readonly spellcheckEnabled?: boolean | undefined;
  readonly spellingDictionary?: readonly string[] | undefined;
  readonly onAddSpellingDictionaryWord?: ((word: string) => Promise<string>) | undefined;
  /** Increment to start editing from a keyboard-selected outer element. */
  readonly editRequest?: number | undefined;
}

export function DirectTextEditor({
  nodeId,
  content,
  contentTarget = "textContent",
  contentLabel = "Text",
  editable,
  disabledReason,
  store,
  selected,
  fragmentIndices,
  richFormattingAllowed = true,
  onInsertScripture,
  spellcheckEnabled = true,
  spellingDictionary = [],
  onAddSpellingDictionaryWord,
  editRequest = 0,
}: DirectTextEditorProps) {
  const currentContent = materializeTextContent(content);
  const toolbarId = useId();
  const editorRef = useRef<HTMLDivElement>(null);
  const displayRef = useRef<HTMLDivElement>(null);
  const handledEditRequest = useRef(editRequest);
  const restoreDisplayFocus = useRef(false);
  const typingPause = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const editingInitialContent = useRef(currentContent);
  const sessionUsesRichText = useRef(currentContent.kind === "richText");
  const session = useRef(0);
  const [editing, setEditing] = useState(false);
  const spellingRange = useRef<Range | undefined>(undefined);
  const [spellingReview, setSpellingReview] = useState<{ readonly display: string; readonly canonical: string }>();
  const [ignoredAllWords, setIgnoredAllWords] = useState<readonly string[]>([]);
  const [spellingMessage, setSpellingMessage] = useState("");
  const [dictionaryBusy, setDictionaryBusy] = useState(false);
  const [formatting, setFormatting] = useState<SelectionFormattingState>(() => initialFormattingState(currentContent));
  const losslessDirectEditing = supportsLosslessDirectEditing(currentContent);
  const canDirectEdit = editable && losslessDirectEditing;

  useEffect(() => {
    if (!editing || editorRef.current === null) return;
    editorRef.current.focus();
  }, [editing, nodeId]);

  useEffect(() => {
    if (!editing || !spellcheckEnabled || editorRef.current === null) return;
    const editor = editorRef.current;
    queueMicrotask(() => applySpellingExclusions(editor, [...spellingDictionary, ...ignoredAllWords]));
  }, [editing, ignoredAllWords, spellcheckEnabled, spellingDictionary]);

  useEffect(() => {
    if (spellcheckEnabled) return;
    setSpellingReview(undefined);
    setSpellingMessage("");
  }, [spellcheckEnabled]);

  useEffect(() => {
    if (editing) return;
    setFormatting(initialFormattingState(materializeTextContent(content)));
  }, [content, editing, nodeId]);

  useEffect(() => {
    if (!editing) return;
    const update = (): void => refreshSelectionFormatting();
    document.addEventListener("selectionchange", update);
    update();
    return () => document.removeEventListener("selectionchange", update);
  }, [editing, nodeId]);

  useEffect(() => {
    if (editRequest === handledEditRequest.current) return;
    handledEditRequest.current = editRequest;
    if (canDirectEdit) beginEditing();
  }, [canDirectEdit, editRequest]);

  useEffect(() => () => {
    if (typingPause.current !== undefined) clearTimeout(typingPause.current);
  }, []);

  useEffect(() => {
    if (editing || !restoreDisplayFocus.current) return;
    restoreDisplayFocus.current = false;
    displayRef.current?.focus();
  }, [editing]);

  function beginEditing(): void {
    if (!canDirectEdit) return;
    session.current++;
    editingInitialContent.current = materializeTextContent(content);
    sessionUsesRichText.current = content.kind === "richText";
    setSpellingReview(undefined);
    setSpellingMessage("");
    setEditing(true);
  }

  function refreshSelectionFormatting(): void {
    const editor = editorRef.current;
    if (editor === null) return;
    const next = formattingForSelection(editor, window.getSelection());
    if (next === undefined) return;
    setFormatting((current) => sameFormattingState(current, next) ? current : next);
  }

  function endTypingGroup(): void {
    if (typingPause.current !== undefined) clearTimeout(typingPause.current);
    typingPause.current = undefined;
    store.breakHistoryGroup();
  }

  function scheduleTypingBoundary(): void {
    if (typingPause.current !== undefined) clearTimeout(typingPause.current);
    typingPause.current = setTimeout(() => {
      typingPause.current = undefined;
      store.breakHistoryGroup();
    }, 750);
  }

  function commitContent(next: TextContent, grouped = true): void {
    store.execute(
      createSetTextContentCommand({
        nodeId,
        content: next,
        target: contentTarget,
        ...(grouped ? { historyGroup: `direct-text:${nodeId}:${session.current}` } : {}),
      }),
    );
  }

  function contentFromEditor(): TextContent {
    const editor = editorRef.current;
    if (editor === null) return editingInitialContent.current;
    if (!sessionUsesRichText.current) {
      return { kind: "plain", text: (editor.textContent ?? "").normalize("NFC") };
    }
    const sanitizedRoot = editor.cloneNode(true) as HTMLElement;
    for (const wrapper of sanitizedRoot.querySelectorAll(".cbb-rich-fragment")) {
      wrapper.replaceWith(...wrapper.childNodes);
    }
    for (const wrapper of sanitizedRoot.querySelectorAll("[data-cbb-spelling-exclusion]")) {
      wrapper.replaceWith(...wrapper.childNodes);
    }
    return {
      kind: "richText",
      document: sanitizeExternalHtml(sanitizedRoot.innerHTML),
    };
  }

  function commitEditor(grouped = true): void {
    commitContent(contentFromEditor(), grouped);
  }

  function toggleMark(mark: Mark): void {
    if (!richFormattingAllowed) return;
    endTypingGroup();
    sessionUsesRichText.current = true;
    document.execCommand(mark === "strong" ? "bold" : "italic", false);
    commitEditor(false);
    store.breakHistoryGroup();
    editorRef.current?.focus();
    refreshSelectionFormatting();
  }

  function changeBlockStyle(next: BlockStyle): void {
    if (!richFormattingAllowed) return;
    endTypingGroup();
    sessionUsesRichText.current = true;
    if (next === "bulletList") document.execCommand("insertUnorderedList", false);
    else if (next === "orderedList") document.execCommand("insertOrderedList", false);
    else document.execCommand(
      "formatBlock",
      false,
      next === "blockquote" ? "blockquote" : next === "paragraph" ? "p" : `h${next.slice(-1)}`,
    );
    setFormatting((current) => {
      if (next === "bulletList") {
        const enabled = current.bulletList !== true;
        return {
          ...current,
          bulletList: enabled,
          ...(enabled ? { orderedList: false } : {}),
        };
      }
      if (next === "orderedList") {
        const enabled = current.orderedList !== true;
        return {
          ...current,
          orderedList: enabled,
          ...(enabled ? { bulletList: false } : {}),
        };
      }
      if (next === "blockquote") return { ...current, blockquote: true };
      return { ...current, paragraphStyles: [next] };
    });
    commitEditor(false);
    store.breakHistoryGroup();
    editorRef.current?.focus();
    refreshSelectionFormatting();
  }

  function paste(event: ClipboardEvent<HTMLDivElement>): void {
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain").replaceAll("\u0000", "").normalize("NFC");
    const selection = window.getSelection();
    if (selection !== null && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const node = document.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    endTypingGroup();
    commitEditor(false);
    store.breakHistoryGroup();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (!editing && (event.key === "Enter" || event.key === "F2")) {
      event.preventDefault();
      beginEditing();
      return;
    }
    if (!editing) return;
    if (spellcheckEnabled && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) {
      event.preventDefault();
      reviewCurrentWord();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      restoreDisplayFocus.current = true;
      setEditing(false);
      endTypingGroup();
      return;
    }
    if (richFormattingAllowed && (event.ctrlKey || event.metaKey) && (event.key === "b" || event.key === "i")) {
      event.preventDefault();
      toggleMark(event.key === "b" ? "strong" : "emphasis");
    }
  }

  function reviewCurrentWord(): void {
    const editor = editorRef.current;
    const selected = editor === null ? undefined : spellingWordAtSelection(editor, window.getSelection());
    if (selected === undefined) {
      spellingRange.current = undefined;
      setSpellingReview(undefined);
      setSpellingMessage("Place the caret in a word, or select one word within a single formatting run.");
      return;
    }
    spellingRange.current = selected.range;
    setSpellingReview({ display: selected.display, canonical: selected.canonical });
    setSpellingMessage(`Reviewing “${selected.display}”.`);
  }

  function ignoreOccurrence(): void {
    const range = spellingRange.current;
    if (range === undefined || spellingReview === undefined || !wrapSpellingRange(range, spellingReview.canonical)) {
      setSpellingMessage("That word moved. Place the caret in it and open Word review again.");
      return;
    }
    setSpellingMessage(`Ignored this occurrence of “${spellingReview.display}” until this text editor closes.`);
    setSpellingReview(undefined);
    editorRef.current?.focus();
  }

  function ignoreAll(): void {
    if (spellingReview === undefined) return;
    setIgnoredAllWords((current) => current.includes(spellingReview.canonical)
      ? current
      : [...current, spellingReview.canonical]);
    setSpellingMessage(`Ignored every occurrence of “${spellingReview.display}” in this text while the bulletin is open.`);
    setSpellingReview(undefined);
    editorRef.current?.focus();
  }

  async function addToChurchDictionary(): Promise<void> {
    if (spellingReview === undefined || onAddSpellingDictionaryWord === undefined) return;
    const word = spellingReview.canonical;
    setDictionaryBusy(true);
    try {
      const message = await onAddSpellingDictionaryWord(word);
      setIgnoredAllWords((current) => current.includes(word) ? current : [...current, word]);
      setSpellingMessage(message);
      setSpellingReview(undefined);
    } catch (error) {
      setSpellingMessage(error instanceof Error ? error.message : "The Church Profile dictionary could not be saved.");
    } finally {
      setDictionaryBusy(false);
      editorRef.current?.focus();
    }
  }

  if (!editing) {
    return (
      <div
        ref={displayRef}
        className="cbb-direct-text"
        data-editable={canDirectEdit ? "true" : "false"}
        onClick={beginEditing}
        onKeyDown={onKeyDown}
        role={canDirectEdit ? "button" : "note"}
        tabIndex={selected && canDirectEdit ? 0 : -1}
        aria-label={canDirectEdit
          ? `Editable ${contentLabel.toLocaleLowerCase()}. Press Enter or F2 to edit.`
          : `Protected ${contentLabel.toLocaleLowerCase()}. ${disabledReason ?? `This ${contentLabel.toLocaleLowerCase()} cannot be edited here.`}`}
        title={!losslessDirectEditing
          ? "This structured text is preserved here. Use the structured text editor to change it without losing formatting."
          : disabledReason}
      >
        {currentContent.kind === "plain"
          ? currentContent.text.split(/\r?\n/u)
              .map((line, index) => ({ line, index }))
              .filter(({ index }) => fragmentIndices === undefined || fragmentIndices.includes(index))
              .map(({ line, index }) => <p data-cbb-fragment-index={index} key={index}>{line || <br />}</p>)
          : <RichTextView document={currentContent.document} fragmentIndices={fragmentIndices} />}
      </div>
    );
  }

  const blockStyle = formatting.paragraphStyles.length === 1
    ? formatting.paragraphStyles[0] ?? "paragraph"
    : "mixed";

  return (
    <div className="cbb-direct-edit-session">
      <div id={toolbarId} role="toolbar" aria-label="Text formatting" className="cbb-rich-toolbar">
        <label className="cbb-rich-style-control">
          <span className="cbb-visually-hidden">Paragraph style</span>
          <select
            aria-label="Paragraph style"
            value={blockStyle}
            disabled={!richFormattingAllowed}
            title={richFormattingAllowed ? undefined : "This weekly field accepts plain text only."}
            onMouseDown={(event) => event.stopPropagation()}
            onChange={(event) => changeBlockStyle(event.currentTarget.value as BlockStyle)}
          >
            {blockStyle === "mixed" ? <option value="mixed" disabled>Mixed styles</option> : null}
            <option value="paragraph">Paragraph</option>
            <option value="heading1">Heading 1</option>
            <option value="heading2">Heading 2</option>
            <option value="heading3">Heading 3</option>
            <option value="heading4">Heading 4</option>
            <option value="heading5">Heading 5</option>
            <option value="heading6">Heading 6</option>
          </select>
        </label>
        <Button
          aria-label="Bold"
          aria-pressed={formatting.strong}
          disabled={!richFormattingAllowed}
          title={richFormattingAllowed ? undefined : "This weekly field accepts plain text only."}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => toggleMark("strong")}
        >
          <strong aria-hidden="true">B</strong>
        </Button>
        <Button
          aria-label="Italic"
          aria-pressed={formatting.emphasis}
          disabled={!richFormattingAllowed}
          title={richFormattingAllowed ? undefined : "This weekly field accepts plain text only."}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => toggleMark("emphasis")}
        >
          <em aria-hidden="true">I</em>
        </Button>
        <Button
          aria-pressed={formatting.bulletList}
          disabled={!richFormattingAllowed}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => changeBlockStyle("bulletList")}
        >
          Bulleted list
        </Button>
        <Button
          aria-pressed={formatting.orderedList}
          disabled={!richFormattingAllowed}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => changeBlockStyle("orderedList")}
        >
          Numbered list
        </Button>
        <Button
          aria-pressed={formatting.blockquote}
          disabled={!richFormattingAllowed}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => changeBlockStyle("blockquote")}
        >
          Block quote
        </Button>
        <Button
          disabled={!richFormattingAllowed || onInsertScripture === undefined}
          title={onInsertScripture === undefined ? "Scripture insertion is available when the Scripture assistant is connected." : undefined}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onInsertScripture?.(nodeId, currentContent)}
        >
          Insert Scripture
        </Button>
        {spellcheckEnabled
          ? (
              <Button
                aria-expanded={spellingReview !== undefined}
                aria-controls={`${toolbarId}-spelling-review`}
                aria-keyshortcuts="Shift+F10"
                title="Place the caret in a word, then open Word review. Also available with Shift+F10."
                onMouseDown={(event) => event.preventDefault()}
                onClick={reviewCurrentWord}
              >
                Word review
              </Button>
            )
          : null}
        <Button
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            restoreDisplayFocus.current = true;
            setEditing(false);
            endTypingGroup();
          }}
        >
          Done
        </Button>
      </div>
      {spellcheckEnabled && (spellingReview !== undefined || spellingMessage.length > 0)
        ? (
            <div id={`${toolbarId}-spelling-review`} className="cbb-spelling-review" role="group" aria-label="Offline spelling actions">
              {spellingReview === undefined
                ? null
                : (
                    <>
                      <strong>“{spellingReview.display}”</strong>
                      <Button onMouseDown={(event) => event.preventDefault()} onClick={ignoreOccurrence}>Ignore once</Button>
                      <Button onMouseDown={(event) => event.preventDefault()} onClick={ignoreAll}>Ignore all in this text</Button>
                      <Button
                        disabled={dictionaryBusy || onAddSpellingDictionaryWord === undefined}
                        title={onAddSpellingDictionaryWord === undefined ? "The Church Profile is unavailable in this window." : undefined}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => { void addToChurchDictionary(); }}
                      >
                        Add to Church Profile dictionary
                      </Button>
                    </>
                  )}
              <span role="status" aria-live="polite">{spellingMessage}</span>
            </div>
          )
        : null}
      <div
        ref={editorRef}
        className="cbb-direct-text cbb-direct-text--editing"
        contentEditable
        spellCheck={spellcheckEnabled}
        suppressContentEditableWarning
        role="textbox"
        aria-label={`${contentLabel} content`}
        aria-multiline="true"
        aria-describedby={toolbarId}
        onInput={() => {
          commitEditor();
          scheduleTypingBoundary();
          refreshSelectionFormatting();
        }}
        onPaste={paste}
        onKeyDown={onKeyDown}
        onKeyUp={refreshSelectionFormatting}
        onPointerUp={refreshSelectionFormatting}
        onSelect={refreshSelectionFormatting}
        onBlur={(event) => {
          if (event.relatedTarget instanceof Node && event.currentTarget.parentElement?.contains(event.relatedTarget)) {
            return;
          }
          restoreDisplayFocus.current = false;
          setEditing(false);
          endTypingGroup();
        }}
      >
        {editingInitialContent.current.kind === "plain"
          ? editingInitialContent.current.text
          : <RichTextView document={editingInitialContent.current.document} />}
      </div>
    </div>
  );
}
