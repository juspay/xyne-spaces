import { useMemo } from 'react';

import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { queries } from '@/src/zero/queries';

import type { TicketsMultiSelectFilterOption } from '@/src/features/xyne-desks/tickets/components/tickets-multi-select-filter';

export type UseChannelBoardFilterOptionsReturn = {
  options: TicketsMultiSelectFilterOption[];
  /** boardId → display name, for the Board column. */
  boardNameById: ReadonlyMap<string, string>;
};

/**
 * Boards of the channel's project (dashboard "Boards" filter in channel mode).
 * Scalar rows only — cheap enough to keep live while the screen is open.
 */
export function useChannelBoardFilterOptions(
  projectId: string | null | undefined,
): UseChannelBoardFilterOptionsReturn {
  const [boards] = useCachedQuery(queries.boardsListByProject({ projectId: projectId ?? '' }), {
    enabled: Boolean(projectId),
    ttl: '10m',
  });

  return useMemo(() => {
    const options: TicketsMultiSelectFilterOption[] = [];
    const boardNameById = new Map<string, string>();
    for (const board of boards ?? []) {
      const id = board.id;
      const name = (board.name ?? '').trim();
      if (!id || !name) continue;
      boardNameById.set(id, name);
      options.push({ id, label: name });
    }
    return { options, boardNameById };
  }, [boards]);
}
