import { createElement, useRef, useState } from 'react';

export interface UndoRedoCommands {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

type HistoryStep<T> = { value: T };

export class UndoRedoHistory<T> {
  private past: T[] = [];
  private future: T[] = [];

  constructor(private readonly limit = 250) {}

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }

  record(previous: T) {
    this.past.push(structuredClone(previous));
    if (this.past.length > this.limit) this.past.splice(0, this.past.length - this.limit);
    this.future = [];
  }

  undo(current: T): HistoryStep<T> | undefined {
    const previous = this.past.pop();
    if (previous === undefined) return;
    this.future.unshift(structuredClone(current));
    return { value: structuredClone(previous) };
  }

  redo(current: T): HistoryStep<T> | undefined {
    const next = this.future.shift();
    if (next === undefined) return;
    this.past.push(structuredClone(current));
    return { value: structuredClone(next) };
  }

  reset() {
    this.past = [];
    this.future = [];
  }
}

export function useUndoRedoHistory<T>(limit = 250) {
  const history = useRef<UndoRedoHistory<T> | undefined>(undefined);
  if (!history.current) history.current = new UndoRedoHistory<T>(limit);
  const [, render] = useState(0);
  const changed = () => render(value => value + 1);
  return {
    canUndo: history.current.canUndo,
    canRedo: history.current.canRedo,
    record(previous: T) {
      history.current!.record(previous);
      changed();
    },
    undo(current: T) {
      const step = history.current!.undo(current);
      if (step) changed();
      return step?.value;
    },
    redo(current: T) {
      const step = history.current!.redo(current);
      if (step) changed();
      return step?.value;
    },
    reset() {
      history.current!.reset();
      changed();
    },
  };
}

export function UndoRedoButtons({ history }: { history: UndoRedoCommands }) {
  return createElement('div', { className: 'undo-redo-controls', role: 'group', 'aria-label': 'Edit history' },
    createElement('button', { type: 'button', className: 'secondary', disabled: !history.canUndo, title: 'Undo (Ctrl+Z)', 'aria-label': 'Undo', onClick: history.undo }, '↶'),
    createElement('button', { type: 'button', className: 'secondary', disabled: !history.canRedo, title: 'Redo (Ctrl+Y)', 'aria-label': 'Redo', onClick: history.redo }, '↷'),
  );
}

export function isUndoShortcut(event: KeyboardEvent | React.KeyboardEvent) {
  return (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'z' && !event.shiftKey;
}

export function isRedoShortcut(event: KeyboardEvent | React.KeyboardEvent) {
  return (event.ctrlKey || event.metaKey) && !event.altKey &&
    (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey));
}
