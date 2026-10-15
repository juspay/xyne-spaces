import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';

/**
 * Row-local state that resets when LegendList recycles the cell onto a new
 * `key` (C11). Assigning during render is the React-sanctioned "adjust state
 * when a prop changes" pattern — it avoids one frame of the previous row.
 */
export const useRecyclingState = <T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] => {
  const keyRef = useRef(key);
  const [value, setValue] = useState(initial);
  const keyChanged = keyRef.current !== key;
  if (keyChanged) {
    keyRef.current = key;
    setValue(initial);
  }
  const setKeyed = useCallback<Dispatch<SetStateAction<T>>>(next => {
    setValue(current => (typeof next === 'function' ? (next as (prev: T) => T)(current) : next));
  }, []);
  return [keyChanged ? initial : value, setKeyed];
};
