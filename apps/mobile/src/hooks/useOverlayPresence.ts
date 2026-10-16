import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Keeps a closing overlay mounted until its exit animation has finished.
 *
 * An overlay rendered straight from its open flag vanishes the instant that
 * flag flips, so the exit animation never plays — it only ever animates in.
 * This holds the mount for `exitDurationMs` past the close, then drops it.
 *
 * @param isOpen        the overlay's own open state
 * @param exitDurationMs how long its close animation runs
 * @returns whether the overlay should currently be rendered
 */
export function useOverlayPresence(isOpen: boolean, exitDurationMs: number): boolean {
  const [isMounted, setIsMounted] = useState(isOpen);

  useEffect(() => {
    if (isOpen) {
      setIsMounted(true);
      return;
    }
    if (!isMounted) return;

    const timeout = setTimeout(() => setIsMounted(false), exitDurationMs);
    return (): void => clearTimeout(timeout);
  }, [isOpen, isMounted, exitDurationMs]);

  return isMounted;
}

/**
 * `setTimeout` that cannot outlive the component that scheduled it.
 *
 * Deferring work until an animation lands is routine here — a sheet waits for
 * the button to collapse before it presents — but a bare `setTimeout` keeps
 * running after an unmount and lands its state update on nothing, or worse,
 * opens a surface on a screen the user has already left.
 */
export function useSafeTimeout(): (callback: () => void, delayMs: number) => void {
  const timeoutsRef = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(
    () => (): void => {
      for (const timeout of timeoutsRef.current) {
        clearTimeout(timeout);
      }
      timeoutsRef.current.clear();
    },
    [],
  );

  return useCallback((callback: () => void, delayMs: number): void => {
    const timeout = setTimeout(() => {
      timeoutsRef.current.delete(timeout);
      callback();
    }, delayMs);
    timeoutsRef.current.add(timeout);
  }, []);
}
