import { ReactElement, useMemo } from 'react';
import type { Ticket, TicketTag } from '@xyne/shared';
import { TicketTable } from '../../components/Tickets/TicketTable/TicketTable';
import { useTableTicketsPage, type UseTableTicketsPageOptions } from './useTableTicketsPage';

interface TableGroupSectionProps {
  args: Omit<UseTableTicketsPageOptions, 'enabled' | 'pageSize'>;
  enabled: boolean;
  pageSize: number;
  totalCount?: number;
  /** true = section scrolls internally (grouped); false = page scroll (none). */
  internalScroll?: boolean;
  /** Overrides row-open routing (the screen's handler knows SDLC hubs etc.). */
  onTicketOpen?: (ticket: Ticket) => void;
  scrollElement: HTMLElement | null;
  visibleColumns: Set<string>;
  isComfortView: boolean;
  availableTags: string[];
}

type RowTagMapping = { id: string; tagName: string; ticketId: string; workspaceId: string };

/** One table group: mounts the cursor-paging hook and feeds the list. */
export const TableGroupSection = ({
  args,
  enabled,
  pageSize,
  totalCount,
  internalScroll = false,
  onTicketOpen,
  scrollElement,
  visibleColumns,
  isComfortView,
  availableTags,
}: TableGroupSectionProps): ReactElement => {
  const { tickets, isLoading, isLoadingMore, hasMore, loadMore, isSearchMode } =
    useTableTicketsPage({ ...args, enabled, pageSize });

  const ticketTags = useMemo(() => {
    const map = new Map<string, TicketTag[]>();
    for (const ticket of tickets) {
      const mappings = (ticket as { tagMappings?: ReadonlyArray<RowTagMapping> }).tagMappings ?? [];
      if (mappings.length > 0) {
        map.set(
          ticket.id,
          mappings.map(m => ({
            workspaceId: m.workspaceId,
            id: m.id,
            name: m.tagName,
            ticketId: m.ticketId,
          })) as TicketTag[],
        );
      }
    }
    return map;
  }, [tickets]);

  const table = (
    <TicketTable
      tickets={tickets as Ticket[]}
      ticketTags={ticketTags}
      availableTags={availableTags}
      visibleColumns={visibleColumns}
      isComfortView={isComfortView}
      hasMore={hasMore}
      isLoadingMore={isLoadingMore}
      isLoading={isLoading}
      onLoadMore={loadMore}
      {...(totalCount !== undefined && !isSearchMode ? { totalCount } : {})}
      {...(onTicketOpen ? { onRowClick: onTicketOpen } : {})}
      {...(internalScroll ? {} : { scrollElement })}
    />
  );

  if (!internalScroll) return table;
  return <div className='flex max-h-[60vh] min-h-0 flex-col'>{table}</div>;
};
