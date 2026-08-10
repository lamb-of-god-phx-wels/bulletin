import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { FontReference } from '../shared/types.js';
import { fontReferenceValue, parseFontReference } from '../shared/fonts.js';
import { useFontOptions } from './LibraryFonts.js';

export function FontPicker({ label, fontRef, fontFamily, disabled, familiesOnly = false, onChange }: {
  label: string;
  fontRef?: FontReference;
  fontFamily?: string;
  disabled?: boolean;
  familiesOnly?: boolean;
  onChange(ref: FontReference): void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState({ left: 0, top: 0 });
  const options = useFontOptions().filter(option => !familiesOnly || option.group === 'Font families');
  const value = fontRef ? fontReferenceValue(fontRef) : fontFamily === 'body' || fontFamily === 'display' ? `role:${fontFamily}` : fontFamily ? `legacy:${fontFamily}` : 'role:body';
  const selected = options.find(option => option.value === value);
  const groups = [...new Set(options.map(option => option.group))];
  const matches = options.filter(option => option.label.toLowerCase().includes(query.trim().toLowerCase()));
  const choose = (ref: FontReference) => { onChange(ref); setOpen(false); setQuery(''); };
  useLayoutEffect(() => {
    const popover = popoverRef.current;
    if (!open || !popover) return;
    popover.showPopover();
    return () => { if (popover.matches(':popover-open')) popover.hidePopover(); };
  }, [open]);
  return <div className="font-picker" onBlur={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <span id={`${id}-label`}>{label}</span>
    <button ref={buttonRef} type="button" className="font-picker-control" aria-labelledby={`${id}-label`} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => { const rect = buttonRef.current?.getBoundingClientRect(); if (rect) setAnchor({ left: rect.left, top: rect.bottom + 4 }); setOpen(current => !current); }}>
      <span className="font-picker-sample" aria-hidden="true" style={{ fontFamily: selected?.previewFamily }}>Ag</span>
      <span className="font-picker-value">{selected?.label ?? fontFamily ?? 'Unresolved font'}</span><span aria-hidden="true">⌄</span>
    </button>
    <select className="font-picker-native" aria-label={label} tabIndex={-1} disabled={disabled} value={value} onChange={event => choose(parseFontReference(event.target.value))}>
        {!selected && <option value={value}>{fontFamily ?? 'Unresolved font'}</option>}
        {groups.map(group => <optgroup label={group} key={group}>{options.filter(option => option.group === group).map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</optgroup>)}
    </select>
    {open && <div ref={popoverRef} className="font-picker-popover" popover="manual" style={{ left: anchor.left, top: anchor.top }}>
      <input autoFocus type="search" aria-label={`Search ${label.toLowerCase()}`} value={query} placeholder="Search fonts" onChange={event => setQuery(event.target.value)} />
      <div className="font-picker-options" role="listbox" aria-labelledby={`${id}-label`}>
        {groups.map(group => {
          const groupOptions = matches.filter(option => option.group === group);
          return groupOptions.length ? <section key={group}><b>{group}</b>{groupOptions.map(option => <button type="button" role="option" aria-selected={option.value === value} key={option.value} onMouseDown={event => event.preventDefault()} onClick={() => choose(option.ref)}><span style={{ fontFamily: option.previewFamily }}>Ag</span><span>{option.label}</span>{option.value === value && <strong>✓</strong>}</button>)}</section> : null;
        })}
        {!matches.length && <p>No matching fonts</p>}
      </div>
    </div>}
  </div>;
}
