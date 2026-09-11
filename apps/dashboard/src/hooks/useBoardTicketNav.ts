import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCachedQuery } from './useCachedQuery';
import { queries } from '../zero/queries';
import { useZero } from './useZero';
import { useShortcut } from '../shortcuts';
import type {
  KanbanTicketsPageRow,
  KanbanTicketsPageBaseArgs,
} from '../routes/KanbanBoardScreen/useKanbanTicketsPage';
import { useTicketKeysetWindow } from './useTicketKeysetWindow';
import { useBoardNavParams } from '../components/Tickets/boardNavStore';

export interface BoardTicketNavState {
  enabled: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  goPrev: () => void;
  goNext: () => void;
}

type NavRow = { id: string; conversationId: string | null; createdAt: number };
type Cursor = { createdAt: number; id: string };

export function useBoardTicketNav(ticketId: string): BoardTicketNavState {
  const zero = useZero();
  const [ticket] = useCachedQuery(queries.ticketByIdV2({ ticketId }), {
    enabled: !!ticketId,
  });
  const store = useBoardNavParams();
  const boardId = ticket?.boardId ?? '';

  const storeMatches =
    !!store?.baseArgs && (!store.baseArgs.boardId || store.baseArgs.boardId === boardId);
  const storeBaseArgs = storeMatches ? store.baseArgs : null;
  const columnType = storeMatches ? store.columnType : 'stage';
  const baseArgs = useMemo<KanbanTicketsPageBaseArgs | null>(
    () => storeBaseArgs ?? (boardId ? { viewMode: 'board', boardId } : null),
    [storeBaseArgs, boardId],
  );
  const enabled = !!baseArgs && !!ticket;

  const [, setSearchParams] = useSearchParams();
  const goTo = useCallback(
    (row: { id: string; conversationId: string | null }): void => {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.set('ticketId', row.id);
        if (row.conversationId) next.set('conversationId', row.conversationId);
        next.set('nofocus', '1');
        return next;
      });
    },
    [setSearchParams],
  );

  const currentRow: NavRow | null = ticket
    ? { id: ticket.id, conversationId: ticket.conversationId, createdAt: ticket.createdAt }
    : null;

  const fetchPage = useCallback(
    async (start: Cursor, dir: 'forward' | 'backward', limit: number): Promise<NavRow[]> => {
      if (!baseArgs) return [];
      const queryArgs = {
        ...baseArgs,
        overdueReferenceTime: baseArgs.overdueReferenceTime ?? undefined,
        columnType,
        stageName: '',
        start: { createdAt: start.createdAt, id: start.id },
        dir,
        limit,
      };
      const rows = (await zero.run(
        queries.kanbanTicketsPageV3({
          ...queryArgs,
        } as Parameters<typeof queries.kanbanTicketsPageV3>[0]),
        { type: 'complete' },
      )) as KanbanTicketsPageRow[];
      return rows.map(r => ({
        id: r.id,
        conversationId: r.conversationId,
        createdAt: r.createdAt,
      }));
    },
    [baseArgs, columnType, zero],
  );

  const { prev, next } = useTicketKeysetWindow<NavRow, Cursor>({
    currentId: ticketId,
    currentRow,
    idOf: r => r.id,
    cursorOf: r => ({ createdAt: r.createdAt, id: r.id }),
    fetchPage,
    radius: 5,
    pageSize: 10,
    enabled,
  });

  const hasPrev = !!prev;
  const hasNext = !!next;
  const goPrev = (): void => {
    if (prev) goTo(prev);
  };
  const goNext = (): void => {
    if (next) goTo(next);
  };

  useShortcut('j', goNext, {
    scope: 'global',
    description: 'Next ticket',
    category: 'Tickets',
    enabled: enabled && hasNext,
  });
  useShortcut('k', goPrev, {
    scope: 'global',
    description: 'Previous ticket',
    category: 'Tickets',
    enabled: enabled && hasPrev,
  });

  return { enabled, hasPrev, hasNext, goPrev, goNext };
}
