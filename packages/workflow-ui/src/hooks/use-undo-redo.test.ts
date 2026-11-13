import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUndoRedo } from './use-undo-redo.js';

describe('useUndoRedo', () => {
  it('starts with initial state', () => {
    const { result } = renderHook(() => useUndoRedo('a'));
    expect(result.current.state).toBe('a');
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it('updates state and enables undo', () => {
    const { result } = renderHook(() => useUndoRedo('a'));

    act(() => result.current.setState('b'));

    expect(result.current.state).toBe('b');
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it('undoes to previous state', () => {
    const { result } = renderHook(() => useUndoRedo('a'));

    act(() => result.current.setState('b'));
    act(() => result.current.undo());

    expect(result.current.state).toBe('a');
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
  });

  it('redoes to next state', () => {
    const { result } = renderHook(() => useUndoRedo('a'));

    act(() => result.current.setState('b'));
    act(() => result.current.undo());
    act(() => result.current.redo());

    expect(result.current.state).toBe('b');
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it('clears redo stack on new setState', () => {
    const { result } = renderHook(() => useUndoRedo('a'));

    act(() => result.current.setState('b'));
    act(() => result.current.undo());
    act(() => result.current.setState('c'));

    expect(result.current.state).toBe('c');
    expect(result.current.canRedo).toBe(false);
  });

  it('handles multiple undo/redo', () => {
    const { result } = renderHook(() => useUndoRedo(0));

    act(() => result.current.setState(1));
    act(() => result.current.setState(2));
    act(() => result.current.setState(3));

    act(() => result.current.undo());
    expect(result.current.state).toBe(2);
    act(() => result.current.undo());
    expect(result.current.state).toBe(1);
    act(() => result.current.redo());
    expect(result.current.state).toBe(2);
  });

  it('respects maxHistory', () => {
    const { result } = renderHook(() => useUndoRedo(0, 3));

    act(() => result.current.setState(1));
    act(() => result.current.setState(2));
    act(() => result.current.setState(3));
    act(() => result.current.setState(4));

    // History is capped at 3, so we can undo 3 times max
    act(() => result.current.undo()); // → 3
    act(() => result.current.undo()); // → 2
    act(() => result.current.undo()); // → 1
    act(() => result.current.undo()); // no-op — past is empty
    expect(result.current.state).toBe(1);
  });

  it('resets clears history', () => {
    const { result } = renderHook(() => useUndoRedo('a'));

    act(() => result.current.setState('b'));
    act(() => result.current.setState('c'));
    act(() => result.current.reset('x'));

    expect(result.current.state).toBe('x');
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });
});
