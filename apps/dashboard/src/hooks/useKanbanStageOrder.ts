import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'kanbanStageOrder';

function readAll(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, string[]>;
  } catch {
    return {};
  }
}

/**
 * Per-user kanban column order persisted in localStorage (UI-only).
 *
 * Stores `{ [scopeKey]: string[] }` where each array is the user's preferred
 * ordering of stage IDs. `scopeKey` is derived from the current view context
 * (channel, board, or a fallback) so different views remember their own order.
 * Stage IDs come directly from the API — if the API data changes (stages added,
 * removed, renamed, or IDs change after a DB reset), unmatched saved entries are
 * ignored and the original API order is used.
 *
 * When `scopeKey` is null/undefined (no board/channel/project context), no
 * order is persisted — the hook returns `null` and a no-op save.
 *
 * This never touches the shared `stages` table, `kanbanPosition`, or any other
 * user's view — purely a local presentation preference.
 */
export function useKanbanStageOrder(scopeKey?: string | null) {
  // Lazy initializer reads localStorage synchronously during the first render
  // so columns appear in the saved order immediately — no extra render cycle,
  // no flash of API-order-then-saved-order.
  const [order, setOrder] = useState<string[] | null>(() =>
    scopeKey ? (readAll()[scopeKey] ?? null) : null,
  );

  // Reload when the scope (view/channel/board) changes.
  useEffect(() => {
    setOrder(scopeKey ? (readAll()[scopeKey] ?? null) : null);
  }, [scopeKey]);

  const save = useCallback(
    (next: string[] | null) => {
      if (!scopeKey) return;
      const all = readAll();
      if (next === null || next.length === 0) {
        delete all[scopeKey];
      } else {
        all[scopeKey] = next;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
      setOrder(next);
    },
    [scopeKey],
  );

  return { order, save } as const;
}
