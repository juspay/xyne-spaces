import { useMemo } from 'react';

import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { queries } from '@/src/zero/queries';

import type { TicketsMultiSelectFilterOption } from '../components/tickets-multi-select-filter';

/**
 * Desk board stages for the Stages filter (mirrors dashboard StageFilterPopup).
 * Resolves boardId from email_channel_preferences, then stagesByBoard.
 */
export function useTicketStageFilterOptions(channelId: string): {
  options: TicketsMultiSelectFilterOption[];
  boardId: string | null;
} {
  const [prefs] = useCachedQuery(queries.getEmailChannelPreference({ channelId }), {
    enabled: Boolean(channelId),
    ttl: '10m',
  });

  const boardId = useMemo(() => {
    const row = prefs?.[0] as { boardId?: string | null } | undefined;
    return row?.boardId?.trim() || null;
  }, [prefs]);

  const [stages] = useCachedQuery(queries.stagesByBoard({ boardId: boardId ?? '' }), {
    enabled: Boolean(boardId),
    ttl: '10m',
  });

  const options = useMemo((): TicketsMultiSelectFilterOption[] => {
    const names = new Set<string>();
    const list: TicketsMultiSelectFilterOption[] = [];
    for (const stage of stages ?? []) {
      const name = stage.name?.trim();
      if (!name || names.has(name)) continue;
      names.add(name);
      list.push({ id: name, label: name });
    }
    return list;
  }, [stages]);

  return { options, boardId };
}
