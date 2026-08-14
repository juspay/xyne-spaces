import { useCallback, useMemo } from 'react';

import { logger, Event } from '../utils/logger';
import type { Stage } from '../routes/KanbanBoardScreen/KanbanBoardScreen.types';
import { useKanbanStageOrder } from './useKanbanStageOrder';

/**
 * Shared logic for per-user kanban column reordering.
 *
 * Wraps `useKanbanStageOrder` (localStorage persistence) with the pieces
 * every kanban screen needs:
 *   1. `orderedStages` — the API stage list rearranged to match the saved order
 *   2. `handleReorder`  — the drag-drop handler that computes and saves the new order
 *   3. `resetOrder`     — clears the saved order, restoring the API default
 *   4. `hasSavedOrder`  — whether a custom order is persisted (for showing reset UI)
 *
 * Currently only `SupportKanbanBoard` (Desk) uses this. Board/Project kanban
 * views are intentionally not wired — the feature is Desk-only per product scope.
 *
 * Saved order contains stage IDs from the API. If stages change (added,
 * removed, renamed, or IDs change after a DB reset), unmatched saved entries
 * are ignored and the original API order is used. Newly added stages that
 * aren't in the saved order are inserted at their `sequenceNumber` position
 * rather than appended to the far right, so admin-ordered workflow changes
 * are respected.
 *
 * When `scopeKey` is null/undefined (no board/channel/project context), no
 * order is persisted — the original API order is used as-is.
 */
export function useKanbanColumnReorder(stages: Stage[], scopeKey?: string | null) {
  const { order: savedOrder, save: saveOrder } = useKanbanStageOrder(scopeKey);

  const orderedStages = useMemo<Stage[]>(() => {
    if (!savedOrder) return stages;
    const byId = new Map(stages.map(s => [s.id, s]));
    const mapped = savedOrder.map(k => byId.get(k)).filter((s): s is Stage => !!s);
    const mappedIds = new Set(mapped.map(s => s.id));
    // Unmatched stages (new since last save) — insert at sequenceNumber
    // position instead of blindly appending to the far right.
    const rest = stages
      .filter(s => !mappedIds.has(s.id))
      .sort((a, b) => (a.sequenceNumber ?? Infinity) - (b.sequenceNumber ?? Infinity));
    const result = [...mapped];
    for (const stage of rest) {
      const insertIdx = result.findIndex(
        s => (s.sequenceNumber ?? Infinity) > (stage.sequenceNumber ?? Infinity),
      );
      if (insertIdx === -1) {
        result.push(stage);
      } else {
        result.splice(insertIdx, 0, stage);
      }
    }
    return result;
  }, [stages, savedOrder]);

  const handleReorder = useCallback(
    (draggedId: string, targetId: string) => {
      // No scope — don't persist, just use API order.
      if (!scopeKey) return;
      const currentOrder = orderedStages.map(s => s.id);
      if (!currentOrder.includes(draggedId) || !currentOrder.includes(targetId)) return;
      // Remove the dragged stage first, then recompute the target index
      // against the shorter array. This makes the landing position
      // direction-independent: the dragged stage always lands immediately
      // before the target stage, regardless of drag direction.
      const next = currentOrder.filter(id => id !== draggedId);
      const insertAt = next.indexOf(targetId);
      next.splice(insertAt, 0, draggedId);
      saveOrder(next);
      logger.info(Event.KANBAN_COLUMN_REORDERED, {
        scopeKey,
        stageCount: next.length,
      });
    },
    [orderedStages, saveOrder, scopeKey],
  );

  const resetOrder = useCallback(() => {
    saveOrder(null);
  }, [saveOrder]);

  const moveStage = useCallback(
    (stageId: string, direction: 'left' | 'right') => {
      if (!scopeKey) return;
      const currentOrder = orderedStages.map(s => s.id);
      const index = currentOrder.indexOf(stageId);
      if (index === -1) return;
      const swapIndex = direction === 'left' ? index - 1 : index + 1;
      if (swapIndex < 0 || swapIndex >= currentOrder.length) return;
      const next = [...currentOrder];
      const tmp = next[index]!;
      next[index] = next[swapIndex]!;
      next[swapIndex] = tmp;
      saveOrder(next);
      logger.info(Event.KANBAN_COLUMN_REORDERED, {
        scopeKey,
        stageCount: next.length,
      });
    },
    [orderedStages, saveOrder, scopeKey],
  );

  return {
    orderedStages,
    handleReorder,
    moveStage,
    resetOrder,
    hasSavedOrder: !!savedOrder,
  } as const;
}
