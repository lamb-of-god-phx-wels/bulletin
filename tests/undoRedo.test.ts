import { describe, expect, it } from 'vitest';
import { UndoRedoHistory } from '../src/components/useUndoRedo';

describe('undo and redo history', () => {
  it('tracks every recorded atomic state in both directions', () => {
    const history = new UndoRedoHistory<{ text: string; order: number[] }>();
    const first = { text: '', order: [1, 2] };
    const second = { text: 'A', order: [1, 2] };
    const third = { text: 'AB', order: [2, 1] };
    history.record(first);
    history.record(second);

    expect(history.undo(third)?.value).toEqual(second);
    expect(history.undo(second)?.value).toEqual(first);
    expect(history.redo(first)?.value).toEqual(second);
    expect(history.redo(second)?.value).toEqual(third);
  });

  it('clears redo after a new edit and keeps immutable snapshots', () => {
    const history = new UndoRedoHistory<{ values: number[] }>();
    const original = { values: [1] };
    history.record(original);
    original.values.push(2);

    expect(history.undo({ values: [3] })?.value).toEqual({ values: [1] });
    history.record({ values: [4] });
    expect(history.canRedo).toBe(false);
  });

  it('honors the configured history limit', () => {
    const history = new UndoRedoHistory<number>(2);
    history.record(1);
    history.record(2);
    history.record(3);
    expect(history.undo(4)?.value).toBe(3);
    expect(history.undo(3)?.value).toBe(2);
    expect(history.undo(2)).toBeUndefined();
  });
});
