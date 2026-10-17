import { useRef, type MutableRefObject } from 'react';

/** Keeps a mutable ref aligned with the latest render value (for async / stable callbacks). */
export const useLatestRef = <T>(value: T): MutableRefObject<T> => {
  const ref = useRef(value);
  ref.current = value;
  return ref;
};
