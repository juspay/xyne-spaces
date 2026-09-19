import { useMemo } from 'react';
import type { Board } from '@xyne/shared';
import { useCachedQuery } from './useCachedQuery';
import { queries } from '../zero/queries';

export interface UseChannelBoardsResult {
  /** Boards linked to the channel via channel_board_mappings, oldest link first. */
  boards: Board[];
  boardIds: string[];
  /**
   * False while the mapping query is still syncing. Callers MUST wait for this
   * before treating an empty `boards` as "this channel has no boards" — an
   * unsynced empty array is indistinguishable from a genuinely empty mapping,
   * and acting on it renders the empty state over a channel that has boards.
   */
  isSynced: boolean;
  hasBoards: boolean;
}

/**
 * Channel → boards, read exclusively from `channel_board_mappings`.
 *
 * This is the single source of truth. `channel.projectId` is deprecated and is
 * deliberately NOT consulted here, and there is no fallback to
 * `boardsListByProject`: a channel with no mapping rows genuinely has no boards
 * and callers should render the "no boards are configured" empty state.
 */
export const useChannelBoards = (channelId: string | undefined): UseChannelBoardsResult => {
  const [mappings, mappingDetails] = useCachedQuery(
    queries.boardsByChannel({ channelId: channelId ?? '' }),
    { enabled: !!channelId },
  );

  return useMemo(() => {
    const boards = (mappings ?? [])
      .map(mapping => mapping.board)
      .filter((board): board is Board => Boolean(board));

    return {
      boards,
      boardIds: boards.map(board => board.id),
      // A disabled query never completes, so a channelId-less caller is "synced
      // and empty" rather than stuck loading forever.
      isSynced: !channelId || mappingDetails.type === 'complete',
      hasBoards: boards.length > 0,
    };
  }, [mappings, mappingDetails.type, channelId]);
};
