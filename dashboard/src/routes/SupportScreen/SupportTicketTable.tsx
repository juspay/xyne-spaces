import { ReactElement, useEffect, useMemo, useRef } from 'react';
import type { Ticket, TicketTag } from '@xyne/shared';
import type { TicketPriority } from '@xyne/shared';
import { queries } from '../../zero/queries';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useGetChannelUserStatus } from '../../hooks/useChannels';
import { dataLoadDuration, safeRecordMetric } from '../../services/otel';
import { logger, Event } from '../../utils/logger';
import { TicketTable } from '../../components/Tickets/TicketTable/TicketTable';

export interface SupportTicketTableProps {
  channelId: string;
  ticketFilter: {
    assignedTo: string[] | undefined;
    priority: TicketPriority[] | undefined;
    stageName: string[] | undefined;
    userGroups: string[] | undefined;
    lastEmailAtStart: number | undefined;
    lastEmailAtEnd: number | undefined;
  };
  onBoardIdResolved: (boardId: string) => void;
  onTicketClick: (ticket: Ticket) => void;
  onTicketsLoaded?: (tickets: Ticket[]) => void;
}

/**
 * Table view for the Support screen. Mirrors SupportKanbanBoard's pattern —
 * owns its own channel-scoped Zero subscription so it only fetches while
 * mounted (i.e. only when the Table view is active).
 */
export const SupportTicketTable = ({
  channelId,
  ticketFilter,
  onBoardIdResolved,
  onTicketClick,
  onTicketsLoaded,
}: SupportTicketTableProps): ReactElement => {
  const channelUserStatus = useGetChannelUserStatus(channelId);
  const isMember = !!channelUserStatus;

  const [supportTickets, supportTicketsDetails] = useCachedQuery(
    queries.supportTicketsFilteredV3({
      channelId,
      isMember,
      ...ticketFilter,
    }),
    { enabled: !!channelId },
  );

  // Records table-view load duration, mirroring Kanban/List's SUPPORT_TICKETS_LOADED
  // instrumentation so load times stay comparable across all three views.
  const filterKey = useMemo(
    () =>
      JSON.stringify({
        c: channelId,
        a: ticketFilter.assignedTo ?? null,
        p: ticketFilter.priority ?? null,
        s: ticketFilter.stageName ?? null,
        g: ticketFilter.userGroups ?? null,
        ds: ticketFilter.lastEmailAtStart ?? null,
        de: ticketFilter.lastEmailAtEnd ?? null,
      }),
    [
      channelId,
      ticketFilter.assignedTo,
      ticketFilter.priority,
      ticketFilter.stageName,
      ticketFilter.userGroups,
      ticketFilter.lastEmailAtStart,
      ticketFilter.lastEmailAtEnd,
    ],
  );
  const loadStartTimeRef = useRef<number | null>(Date.now());
  useEffect(() => {
    loadStartTimeRef.current = Date.now();
  }, [filterKey]);
  useEffect(() => {
    if (supportTicketsDetails.type !== 'complete') return;
    if (loadStartTimeRef.current === null) return;
    const duration = Date.now() - loadStartTimeRef.current;
    logger.info(Event.SUPPORT_TICKETS_LOADED, {
      source: 'SupportTicketTable',
      message: 'Support table tickets loaded',
      durationMs: duration,
      channelId,
      url: window.location.href,
    });
    safeRecordMetric(() => {
      dataLoadDuration.record(duration, {
        source: 'SupportTicketTable',
        event: Event.SUPPORT_TICKETS_LOADED,
        platform: logger.platformName,
      });
    });
    loadStartTimeRef.current = null;
  }, [supportTicketsDetails.type, filterKey, channelId]);

  // Resolve the board id from the first loaded ticket, same as SupportKanbanBoard —
  // needed so stage-related columns can look up board type (linear vs non-linear).
  const firstRowBoardId = supportTickets?.[0]?.boardId;
  useEffect(() => {
    if (firstRowBoardId) onBoardIdResolved(firstRowBoardId);
  }, [firstRowBoardId, onBoardIdResolved]);

  // Report loaded tickets up so the parent can source the merge dialog.
  useEffect(() => {
    if (supportTickets) onTicketsLoaded?.(supportTickets as Ticket[]);
  }, [supportTickets, onTicketsLoaded]);

  // supportTicketsFilteredV3 already relates tagMappings on every row, so unlike
  // Board's ticketsQueryV2 there's no fallback path needed here.
  const tagsByTicketId = useMemo(() => {
    const map = new Map<string, TicketTag[]>();
    for (const ticket of supportTickets ?? []) {
      const tags = (ticket.tagMappings ?? []).map(m => ({
        id: m.tagId,
        name: m.tagName,
        ticketId: m.ticketId,
      }));
      if (tags.length > 0) map.set(ticket.id, tags as TicketTag[]);
    }
    return map;
  }, [supportTickets]);

  const projectId = supportTickets?.[0]?.projectId ?? undefined;
  const [projectTags] = useCachedQuery(
    queries.projectTagsByProjectId({ projectId: projectId || '' }),
    { enabled: !!projectId },
  );
  const availableTags = useMemo(() => {
    if (!projectTags || projectTags.length === 0) return [];
    return Array.from(new Set(projectTags.map(tag => tag.name))).sort();
  }, [projectTags]);

  return (
    <TicketTable
      tickets={(supportTickets ?? []) as Ticket[]}
      ticketTags={tagsByTicketId}
      availableTags={availableTags}
      onTitleClick={onTicketClick}
    />
  );
};
