import { useRef, useState, type ElementType, type MouseEvent } from 'react';

export function EditableElementName({ value, onRename, as: Tag = 'span' }: { value: string; onRename(value?: string): void; as?: ElementType }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const cancel = useRef(false);
  if (editing) return <Tag className="editable-element-name editing"><input autoFocus aria-label="Element name" value={draft} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onChange={event => setDraft(event.target.value)} onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
    if (event.key === 'Escape') { event.preventDefault(); cancel.current = true; event.currentTarget.blur(); }
  }} onBlur={() => {
    setEditing(false);
    if (cancel.current) { cancel.current = false; return; }
    const next = draft.trim();
    onRename(next || undefined);
  }} /></Tag>;
  return <Tag className="editable-element-name" title="Double-click to rename" onDoubleClick={(event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDraft(value);
    setEditing(true);
  }}>{value}</Tag>;
}
