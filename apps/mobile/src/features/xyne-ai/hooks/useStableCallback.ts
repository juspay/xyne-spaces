import { useCallback, useLayoutEffect, useRef } from 'react';

/** A function with constant identity that always calls the latest `callback`. */
export const useStableCallback = <Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
): ((...args: Args) => Result) => {
  const latest = useRef(callback);
  useLayoutEffect(() => {
    latest.current = callback;
  });
  return useCallback((...args: Args) => latest.current(...args), []);
};
