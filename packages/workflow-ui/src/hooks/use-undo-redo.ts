import { useCallback, useRef, useState } from 'react';

export interface UseUndoRedoReturn<T> {
  state: T;
  setState: (next: T | ((prev: T) => T)) => void;
  /** Change the present state without adding a history entry. */
  amend: (next: (prev: T) => T) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  reset: (initial: T) => void;
}

/**
 * Generic undo/redo stack for immutable state values.
 *
 * Every call to `setState` pushes to the history stack.
 * `undo()` / `redo()` navigate the stack without mutating it.
 */
export function useUndoRedo<T>(initialState: T, maxHistory = 50): UseUndoRedoReturn<T> {
  const [state, setStateInternal] = useState<T>(initialState);
  const pastRef = useRef<T[]>([]);
  const futureRef = useRef<T[]>([]);

  const setState = useCallback((next: T | ((prev: T) => T)) => {
    setStateInternal((prev) => {
      const past = pastRef.current;
      past.push(prev);
      if (past.length > maxHistory) {
        past.shift();
      }
      futureRef.current = [];
      return typeof next === 'function' ? (next as (prev: T) => T)(prev) : next;
    });
  }, [maxHistory]);

  const amend = useCallback((next: (prev: T) => T) => setStateInternal(next), []);

  const undo = useCallback(() => {
    setStateInternal((current) => {
      const past = pastRef.current;
      if (past.length === 0) return current;
      const previous = past.pop()!;
      futureRef.current.push(current);
      return previous;
    });
  }, []);

  const redo = useCallback(() => {
    setStateInternal((current) => {
      const future = futureRef.current;
      if (future.length === 0) return current;
      const next = future.pop()!;
      pastRef.current.push(current);
      return next;
    });
  }, []);

  const reset = useCallback((initial: T) => {
    pastRef.current = [];
    futureRef.current = [];
    setStateInternal(initial);
  }, []);

  return {
    state,
    setState,
    amend,
    undo,
    redo,
    canUndo: pastRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
    reset,
  };
}
