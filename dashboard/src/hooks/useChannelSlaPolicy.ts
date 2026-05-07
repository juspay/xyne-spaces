import { useCallback } from 'react';
import { useZero } from './useZero';
import { queries } from '../zero/queries';
import { useCachedQuery } from './useCachedQuery';
import { mutators } from '../zero/mutators';
import { v4 as uuidv4 } from 'uuid';
import type { QueryResultType } from '@rocicorp/zero';

export type BoardSlaPolicy = QueryResultType<typeof queries.getBoardSlaPolicies>[number];

/**
 * Fetches active SLA policies for a single board.
 * Prefer `useBoardsSlaPolicies` when rendering a list of tickets — it
 * consolidates multiple boards into one Zero subscription.
 */
export function useBoardSlaPolicies(boardId: string | null): BoardSlaPolicy[] {
  const [policies] = useCachedQuery(queries.getBoardSlaPolicies({ boardId: boardId || '' }), {
    enabled: !!boardId,
  });
  return policies ?? [];
}

/**
 * Fetches active SLA policies for multiple boards in a single Zero subscription.
 * Returns a flat array of all policies; callers should filter by `boardId` and
 * `priority` to find the policy relevant to a specific ticket.
 *
 * Pass an empty array to disable the query (returns `[]`).
 */
export function useBoardsSlaPolicies(boardIds: string[]): BoardSlaPolicy[] {
  const [policies] = useCachedQuery(queries.getBoardSlaPoliciesByBoardIds({ boardIds }), {
    enabled: boardIds.length > 0,
  });
  return policies ?? [];
}

export function useUpsertBoardSlaPolicy() {
  const zero = useZero();

  return useCallback(
    (policy: {
      boardId: string;
      priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      responseHours: number;
      resolutionHours: number;
      businessHoursOnly: boolean;
      timezone: string;
      workdayStart: number;
      workdayEnd: number;
      isActive: boolean;
    }) => {
      zero.mutate(mutators.boardSlaPolicy.upsert({ id: uuidv4(), ...policy }));
    },
    [zero],
  );
}

export function useDeleteBoardSlaPolicy() {
  const zero = useZero();

  return useCallback(
    (id: string) => {
      zero.mutate(mutators.boardSlaPolicy.delete({ id }));
    },
    [zero],
  );
}
