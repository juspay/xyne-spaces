import { useState } from 'react';

export interface CursorPages {
  /** Cursor for the page being shown; undefined on the first page. */
  cursor: string | undefined;
  /** 1-based page number. */
  page: number;
  hasPrev: boolean;
  next: (nextCursor: string) => void;
  prev: () => void;
}

/**
 * Prev/next paging over a cursor-paged list. The admin list endpoints only hand back
 * the next cursor, so the cursors already visited are kept as a stack. Any change to
 * `resetKey` (the serialized filters) drops back to the first page.
 */
export function useCursorPages(resetKey: string): CursorPages {
  const [state, setState] = useState<{ key: string; cursors: string[] }>({
    key: resetKey,
    cursors: [],
  });
  const cursors = state.key === resetKey ? state.cursors : [];

  return {
    cursor: cursors[cursors.length - 1],
    page: cursors.length + 1,
    hasPrev: cursors.length > 0,
    next: nextCursor => setState({ key: resetKey, cursors: [...cursors, nextCursor] }),
    prev: () => setState({ key: resetKey, cursors: cursors.slice(0, -1) }),
  };
}
