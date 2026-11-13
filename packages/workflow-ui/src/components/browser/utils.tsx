import { useLayoutEffect, useRef, useState } from 'react';
import { FolderCard } from './FolderCard.js';
import type { BrowserEntry, LeadingRenderer } from './types.js';

export const defaultLeading: LeadingRenderer = (entry, size) =>
  entry.kind === 'folder' ? <FolderCard size={size} /> : null;

/** Coerce a value to a string safe to render as a React child. Malformed entry
 *  data (e.g. a workflow whose metadata.name parsed to an object) would otherwise
 *  throw React #31 and blank the whole list. */
export function asText(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

export function isEntryDisabled(
  entry: BrowserEntry,
  disableFiles: boolean,
  disableFolders: boolean,
): boolean {
  return (
    (entry.kind === 'file' && disableFiles) ||
    (entry.kind === 'folder' && disableFolders)
  );
}

export function useScrollMargin(
  scrollParentRef: React.RefObject<HTMLElement | null>,
): {
  listRef: React.RefObject<HTMLDivElement | null>;
  scrollMargin: number;
} {
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect((): (() => void) | undefined => {
    const list = listRef.current;
    const scroller = scrollParentRef.current;
    if (!list || !scroller) {
      return undefined;
    }
    const measure = (): void => {
      const lr = list.getBoundingClientRect();
      const sr = scroller.getBoundingClientRect();
      const next = lr.top - sr.top + scroller.scrollTop;
      setScrollMargin((prev) => (prev === next ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scroller);
    if (list.parentElement) {
      ro.observe(list.parentElement);
    }
    return (): void => {
      ro.disconnect();
    };
  }, [scrollParentRef]);
  return { listRef, scrollMargin };
}
