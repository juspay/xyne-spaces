import { useCallback, useMemo, useState } from 'react';
import type { TicketPriority } from '@xyne/shared';

import { useUsers } from '@/src/hooks/useUsers';
import { getUserDisplayName } from '@/src/utils/channel-utils';
import {
  formatAssigneeFilterLabel,
  formatMultiSelectFilterLabel,
  formatPriorityFilterLabel,
} from '@/src/features/xyne-desks/tickets/utils';

import type { ChannelTicketsFilters } from '../types';

const EMPTY_STRINGS: readonly string[] = Object.freeze([]);
const EMPTY_PRIORITIES: readonly TicketPriority[] = Object.freeze([]);

export type UseChannelTicketsFiltersReturn = {
  filters: ChannelTicketsFilters;
  hasActiveFilters: boolean;
  labels: { assignee: string; priority: string; stage: string; board: string };
  setAssigneeIds: (ids: string[]) => void;
  togglePriority: (priority: TicketPriority) => void;
  setStageNames: (names: string[]) => void;
  setBoardIds: (ids: string[]) => void;
  clearAll: () => void;
};

/**
 * Filter selection + chip labels. Arrays are replaced wholesale (never mutated) and
 * empty selections share a frozen constant, so downstream memos keyed on identity
 * stay stable across "clear" operations.
 */
export function useChannelTicketsFilters(
  boardNameById: ReadonlyMap<string, string>,
): UseChannelTicketsFiltersReturn {
  const users = useUsers();

  const [assigneeIds, setAssigneeIdsState] = useState<readonly string[]>(EMPTY_STRINGS);
  const [priorities, setPriorities] = useState<readonly TicketPriority[]>(EMPTY_PRIORITIES);
  const [stageNames, setStageNamesState] = useState<readonly string[]>(EMPTY_STRINGS);
  const [boardIds, setBoardIdsState] = useState<readonly string[]>(EMPTY_STRINGS);

  const setAssigneeIds = useCallback((ids: string[]) => {
    setAssigneeIdsState(ids.length > 0 ? ids : EMPTY_STRINGS);
  }, []);
  const setStageNames = useCallback((names: string[]) => {
    setStageNamesState(names.length > 0 ? names : EMPTY_STRINGS);
  }, []);
  const setBoardIds = useCallback((ids: string[]) => {
    setBoardIdsState(ids.length > 0 ? ids : EMPTY_STRINGS);
    // Stage names are board-scoped; a board change invalidates the selection.
    setStageNamesState(EMPTY_STRINGS);
  }, []);
  const togglePriority = useCallback((priority: TicketPriority) => {
    setPriorities(prev => {
      const next = prev.includes(priority) ? prev.filter(p => p !== priority) : [...prev, priority];
      return next.length > 0 ? next : EMPTY_PRIORITIES;
    });
  }, []);
  const clearAll = useCallback(() => {
    setAssigneeIdsState(EMPTY_STRINGS);
    setPriorities(EMPTY_PRIORITIES);
    setStageNamesState(EMPTY_STRINGS);
    setBoardIdsState(EMPTY_STRINGS);
  }, []);

  const assigneeLabel = useMemo(() => {
    if (assigneeIds.length === 0) return formatAssigneeFilterLabel([]);
    const byId = new Map(users.map(u => [u.id, u]));
    return formatAssigneeFilterLabel(
      assigneeIds.map(id => {
        const user = byId.get(id);
        return user ? getUserDisplayName(user) : 'Unknown';
      }),
    );
  }, [assigneeIds, users]);

  const priorityLabel = useMemo(() => formatPriorityFilterLabel(priorities), [priorities]);
  const stageLabel = useMemo(
    () => formatMultiSelectFilterLabel(stageNames, 'Stages'),
    [stageNames],
  );
  const boardLabel = useMemo(
    () =>
      formatMultiSelectFilterLabel(
        boardIds.map(id => boardNameById.get(id) ?? 'Unknown'),
        'Boards',
      ),
    [boardIds, boardNameById],
  );

  const filters = useMemo<ChannelTicketsFilters>(
    () => ({ assigneeIds, priorities, stageNames, boardIds }),
    [assigneeIds, priorities, stageNames, boardIds],
  );

  return {
    filters,
    hasActiveFilters:
      assigneeIds.length > 0 ||
      priorities.length > 0 ||
      stageNames.length > 0 ||
      boardIds.length > 0,
    labels: {
      assignee: assigneeLabel,
      priority: priorityLabel,
      stage: stageLabel,
      board: boardLabel,
    },
    setAssigneeIds,
    togglePriority,
    setStageNames,
    setBoardIds,
    clearAll,
  };
}
