import { useCallback, useMemo } from 'react';

import type { Stage } from '../routes/KanbanBoardScreen/KanbanBoardScreen.types';
import { useKanbanStageOrder } from './useKanbanStageOrder';

/**
 * Shared logic for per-user kanban column reordering.
 *
 * Wraps `useKanbanStageOrder` (localStorage persistence) with the two pieces
 * every kanban screen needs:
 *   1. `orderedStages` — the API stage list rearranged to match the saved order
 *   2. `handleReorder`  — the drag-drop handler that computes and saves the new order
 *
 * Both `KanbanBoardScreen` and `SupportKanbanBoard` call this with their own
 * stage array and scope key, avoiding duplicated memo/callback logic.
 *
 * Saved order contains stage IDs from the API. If stages change (added,
 * removed, renamed, or IDs change after a DB reset), unmatched saved entries
 * are ignored and the original API order is used.
 *
 * When `scopeKey` is null/undefined (no board/channel/project context), no
 * order is persisted — the original API order is used as-is.
 */
export function useKanbanColumnReorder(stages: Stage[], scopeKey?: string | null) {
  const { order: savedOrder, save: saveOrder } = useKanbanStageOrder(scopeKey);

  const orderedStages = useMemo<Stage[]>(() => {
    if (!savedOrder) return stages;
    const byId = new Map(stages.map(s => [s.id, s]));
    const mapped = savedOrder.map(k => byId.get(k)).filter(Boolean) as Stage[];
    const mappedIds = new Set(mapped.map(s => s.id));
    const rest = stages.filter(s => !mappedIds.has(s.id));
    return [...mapped, ...rest];
  }, [stages, savedOrder]);

  const handleReorder = useCallback(
    (draggedId: string, targetId: string) => {
      // No scope — don't persist, just use API order.
      if (!scopeKey) return;
      const currentOrder = orderedStages.map(s => s.id);
      const fromIndex = currentOrder.indexOf(draggedId);
      const toIndex = currentOrder.indexOf(targetId);
      if (fromIndex === -1 || toIndex === -1) return;
      const next = [...currentOrder];
      next.splice(fromIndex, 1);
      next.splice(toIndex, 0, draggedId);
      saveOrder(next);
    },
    [orderedStages, saveOrder, scopeKey],
  );

  return { orderedStages, handleReorder } as const;
}
