/**
 * Boards Hook - Fetches boards for a project using Zero query
 * Aligned with dashboard's useCachedQuery pattern
 */

import { useMemo } from 'react';
import { useQuery } from './useQuery';
import { queries } from '@/src/zero/queries';

type BoardRow = {
  id: string;
  name?: string | null;
};

export const useBoards = (
  projectId: string | undefined,
): {
  boards: readonly BoardRow[];
  isLoading: boolean;
  isReady: boolean;
} => {
  const [boards, details] = useQuery(queries.boardsListByProject({ projectId: projectId || '' }), {
    enabled: !!projectId,
  });

  return useMemo(() => {
    const isReady = !!projectId && details.type === 'complete';
    const isLoading = !!projectId && !isReady;
    const list: BoardRow[] =
      isReady && Array.isArray(boards)
        ? boards.map(board => ({
            id: board.id,
            name: board.name ?? null,
          }))
        : [];
    return {
      boards: list,
      isLoading,
      isReady,
    };
  }, [boards, details.type, projectId]);
};
