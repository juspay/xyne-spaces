import { useCallback, useEffect, useState } from 'react';

import { KANBAN_STAGE_ORDER_KEY } from '../constants/settings';

type StageOrderMap = Record<string, string[]>;

/**
 * Read and validate the saved stage-order map from localStorage.
 *
 * Defensive against corrupted / shape-mismatched data: any value that isn't
 * a plain object whose every value is an array of strings is treated as
 * empty (so the board falls back to the API order instead of crashing).
 */
function readAll(): StageOrderMap {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KANBAN_STAGE_ORDER_KEY) ?? '{}');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const result: StageOrderMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (Array.isArray(value) && value.every(v => typeof v === 'string')) {
        result[key] = value;
      }
    }
    return result;
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
      // Guard against QuotaExceededError (full storage, private browsing, etc.)
      // — degrade silently rather than crashing the drag handler.
      try {
        localStorage.setItem(KANBAN_STAGE_ORDER_KEY, JSON.stringify(all));
      } catch {
        return;
      }
      setOrder(next);
    },
    [scopeKey],
  );

  return { order, save } as const;
}
