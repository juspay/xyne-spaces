import { useMemo } from 'react';

import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { queries } from '@/src/zero/queries';

import type { TicketsMultiSelectFilterOption } from '@/src/features/xyne-desks/tickets/components/tickets-multi-select-filter';

/**
 * Stage options for a chat channel.
 *
 * Stages belong to boards; a channel's tickets can sit on any board of the
 * channel's project, so with no board selected we list every stage across the
 * project (`stagesByBoards({ projectId })`, deduped by name). With exactly one
 * board selected the list narrows to that board (`stagesByBoard`).
 *
 * Not the desks hook: that one resolves the board via email_channel_preferences,
 * which only desk channels have.
 */
export function useChannelStageFilterOptions(
  projectId: string | null | undefined,
  selectedBoardIds: readonly string[],
): TicketsMultiSelectFilterOption[] {
  const singleBoardId = selectedBoardIds.length === 1 ? (selectedBoardIds[0] ?? null) : null;

  const [projectStages] = useCachedQuery(queries.stagesByBoards({ projectId: projectId ?? '' }), {
    enabled: Boolean(projectId) && !singleBoardId,
    ttl: '10m',
  });
  const [boardStages] = useCachedQuery(queries.stagesByBoard({ boardId: singleBoardId ?? '' }), {
    enabled: Boolean(singleBoardId),
    ttl: '10m',
  });

  return useMemo(() => {
    const stages = singleBoardId ? boardStages : projectStages;
    const seen = new Set<string>();
    const options: TicketsMultiSelectFilterOption[] = [];
    for (const stage of stages ?? []) {
      const name = (stage.name ?? '').trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      options.push({ id: name, label: name });
    }
    return options;
  }, [singleBoardId, boardStages, projectStages]);
}
