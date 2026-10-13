import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';

/** How a browser finds in one of its pages. */
export interface FindControl {
  /** A new search, or — `step` — a move to the next or last match of this one. */
  find: (pageKey: string, text: string, forward: boolean, step: boolean) => void;
  /** Takes the marks down. */
  stop: (pageKey: string) => void;
}

/**
 * Finding in the page shown: null while closed. A search runs as it is typed,
 * settling first; clearing it or closing takes the marks down, and moving to
 * another page closes it.
 */
export function useFindInPage(
  control: FindControl,
  pageKey: string,
): {
  text: string | null;
  setText: (text: string) => void;
  open: () => void;
  close: () => void;
  step: (forward: boolean) => void;
  inputRef: MutableRefObject<HTMLInputElement | null>;
} {
  const [text, setText] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const controlRef = useRef(control);
  controlRef.current = control;

  const open = useCallback(() => {
    setText(current => current ?? '');
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

  useEffect(() => {
    if (text === null) return undefined;
    const timer = window.setTimeout(() => {
      if (text) controlRef.current.find(pageKey, text, true, false);
      else controlRef.current.stop(pageKey);
    }, 140);
    return () => window.clearTimeout(timer);
  }, [text, pageKey]);

  useEffect(() => {
    const key = pageKey;
    return () => {
      setText(null);
      controlRef.current.stop(key);
    };
  }, [pageKey]);

  const close = (): void => {
    setText(null);
    controlRef.current.stop(pageKey);
  };
  const step = (forward: boolean): void => {
    if (text) controlRef.current.find(pageKey, text, forward, true);
  };

  return { text, setText: value => setText(value), open, close, step, inputRef };
}
