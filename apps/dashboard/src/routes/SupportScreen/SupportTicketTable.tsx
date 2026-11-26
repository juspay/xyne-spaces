import { ReactElement, useEffect, useMemo, useRef } from 'react';
import type { Ticket, TicketTag } from '@xyne/shared';
import { type TicketPriority } from '@xyne/shared';
import { queries } from '../../zero/queries';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useGetChannelUserStatus } from '../../hooks/useChannels';
import { dataLoadDuration, safeRecordMetric } from '../../services/otel';
import { logger, Event } from '../../utils/logger';
import { TicketTable } from '../../components/Tickets/TicketTable/TicketTable';
import type {
  DynamicFieldFilterEntry,
  DynamicFieldQueryFilter,
} from '../../utils/board/dynamicFieldFilters';
import type { ResolvedDisplayFormField } from '../../utils/board/resolveDisplayFormFields';
import { useSupportKanbanTicketsPage } from './useSupportKanbanTicketsPage';
import { useKanbanCounts } from '../KanbanBoardScreen/useKanbanCounts';

const MATCH_EVERY_STAGE = { stage: '', otherStageNames: [] as string[] };

export interface SupportTicketTableProps {
  channelId: string;
  ticketFilter: {
    assignedTo: string[] | undefined;
    createdBy: string[] | undefined;
    priority: TicketPriority[] | undefined;
    stageName: string[] | undefined;
    conversationIdWhitelist: string[] | undefined;
    userGroups: string[] | undefined;
    lastEmailAtStart: number | undefined;
    lastEmailAtEnd: number | undefined;
    createdAtStart: number | undefined;
    createdAtEnd: number | undefined;
    dynamicFieldFilters?: DynamicFieldQueryFilter[] | undefined;
    conversationLabelId?: string | undefined;
  };
  dynamicFieldEntries?: DynamicFieldFilterEntry[];
  visibleColumns?: Set<string>;
  dynamicFieldColumns?: ResolvedDisplayFormField[];
  onBoardIdResolved: (boardId: string) => void;
  onTicketClick: (ticket: Ticket) => void;
  onTicketsLoaded?: (tickets: Ticket[]) => void;
  selectedIds?: ReadonlySet<string>;
  onSelectionChange?: (tickets: Ticket[]) => void;
}

/**
 * Table view for the Support screen. Mirrors SupportKanbanBoard's pattern —
 * owns its own channel-scoped Zero subscription so it only fetches while
 * mounted (i.e. only when the Table view is active).
 */
export const SupportTicketTable = ({
  channelId,
  ticketFilter,
  dynamicFieldEntries,
  visibleColumns,
  dynamicFieldColumns,
  onBoardIdResolved,
  onTicketClick,
  onTicketsLoaded,
  selectedIds,
  onSelectionChange,
}: SupportTicketTableProps): ReactElement => {
  const channelUserStatus = useGetChannelUserStatus(channelId);
  const isMember = !!channelUserStatus;

  const displayFieldIds = useMemo(
    () =>
      dynamicFieldColumns && dynamicFieldColumns.length > 0
        ? dynamicFieldColumns.map(field => field.id)
        : undefined,
    [dynamicFieldColumns],
  );

  const { conversationIdWhitelist, ...restTicketFilter } = ticketFilter;
  const {
    groups: countGroups,
    isLoading: countsLoading,
    error: countsError,
  } = useKanbanCounts({
    viewMode: 'desk',
    columnType: 'stage',
    channelId,
    deskFilters: {
      ...(ticketFilter.assignedTo ? { assignedTo: ticketFilter.assignedTo } : {}),
      ...(ticketFilter.createdBy ? { createdBy: ticketFilter.createdBy } : {}),
      ...(ticketFilter.priority ? { priority: ticketFilter.priority } : {}),
      ...(ticketFilter.stageName ? { stageName: ticketFilter.stageName } : {}),
      ...(conversationIdWhitelist ? { conversationIds: conversationIdWhitelist } : {}),
      ...(ticketFilter.userGroups ? { userGroups: ticketFilter.userGroups } : {}),
      ...(ticketFilter.lastEmailAtStart !== undefined
        ? { lastEmailAtStart: ticketFilter.lastEmailAtStart }
        : {}),
      ...(ticketFilter.lastEmailAtEnd !== undefined
        ? { lastEmailAtEnd: ticketFilter.lastEmailAtEnd }
        : {}),
      ...(ticketFilter.createdAtStart !== undefined
        ? { createdAtStart: ticketFilter.createdAtStart }
        : {}),
      ...(ticketFilter.createdAtEnd !== undefined
        ? { createdAtEnd: ticketFilter.createdAtEnd }
        : {}),
      ...(ticketFilter.conversationLabelId
        ? { conversationLabelId: ticketFilter.conversationLabelId }
        : {}),
    },
    filters: {
      dynamicFields: Object.fromEntries(
        (dynamicFieldEntries ?? [])
          .filter(entry => entry.fieldType !== undefined)
          .map(entry => [entry.fieldId, entry.value]),
      ),
    },
    enabled: !!channelId,
  });
  const expectedCount =
    countsLoading || countsError
      ? undefined
      : countGroups.reduce((sum, group) => sum + group.totalCount, 0);
  const {
    tickets: supportTickets,
    isComplete,
    isSettled,
    hasMore,
    isLoadingMore,
    loadMore,
  } = useSupportKanbanTicketsPage({
    channelId,
    isMember,
    ...restTicketFilter,
    ...(conversationIdWhitelist !== undefined ? { conversationIds: conversationIdWhitelist } : {}),
    formEntityValueFieldIds: displayFieldIds,
    ...MATCH_EVERY_STAGE,
    ...(expectedCount !== undefined ? { expectedCount } : {}),
    enabled: !!channelId,
  });

  // Records table-view load duration, mirroring Kanban/List's SUPPORT_TICKETS_LOADED
  // instrumentation so load times stay comparable across all three views.
  const filterKey = useMemo(
    () =>
      JSON.stringify({
        c: channelId,
        a: ticketFilter.assignedTo ?? null,
        cb: ticketFilter.createdBy ?? null,
        p: ticketFilter.priority ?? null,
        s: ticketFilter.stageName ?? null,
        ci: ticketFilter.conversationIdWhitelist ?? null,
        g: ticketFilter.userGroups ?? null,
        ds: ticketFilter.lastEmailAtStart ?? null,
        de: ticketFilter.lastEmailAtEnd ?? null,
        cs: ticketFilter.createdAtStart ?? null,
        ce: ticketFilter.createdAtEnd ?? null,
        df: dynamicFieldEntries ?? null,
        cols: displayFieldIds ?? null,
        l: ticketFilter.conversationLabelId ?? null,
      }),
    [
      channelId,
      ticketFilter.assignedTo,
      ticketFilter.createdBy,
      ticketFilter.priority,
      ticketFilter.stageName,
      ticketFilter.conversationIdWhitelist,
      ticketFilter.userGroups,
      ticketFilter.lastEmailAtStart,
      ticketFilter.lastEmailAtEnd,
      ticketFilter.createdAtStart,
      ticketFilter.createdAtEnd,
      dynamicFieldEntries,
      displayFieldIds,
      ticketFilter.conversationLabelId,
    ],
  );
  const loadStartTimeRef = useRef<number | null>(Date.now());
  useEffect(() => {
    loadStartTimeRef.current = Date.now();
  }, [filterKey]);
  useEffect(() => {
    if (!isComplete) return;
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
  }, [isComplete, filterKey, channelId]);

  // Resolve the board id from the first loaded ticket, same as SupportKanbanBoard —
  // needed so stage-related columns can look up board type (linear vs non-linear).
  const firstRowBoardId = supportTickets[0]?.boardId;
  useEffect(() => {
    if (firstRowBoardId) onBoardIdResolved(firstRowBoardId);
  }, [firstRowBoardId, onBoardIdResolved]);

  // Report loaded tickets up so the parent can source the merge dialog.
  useEffect(() => {
    onTicketsLoaded?.(supportTickets);
  }, [supportTickets, onTicketsLoaded]);

  // supportKanbanTicketsPage already relates tagMappings on every row, so unlike
  // Board's ticketsQueryV2 there's no fallback path needed here.
  const tagsByTicketId = useMemo(() => {
    const map = new Map<string, TicketTag[]>();
    for (const ticket of supportTickets) {
      const { tagMappings } = ticket as Ticket & {
        tagMappings?: { id: string; tagName: string; ticketId: string }[];
      };
      const tags = (tagMappings ?? []).map(m => ({
        id: m.id,
        name: m.tagName,
        ticketId: m.ticketId,
      }));
      if (tags.length > 0) map.set(ticket.id, tags as TicketTag[]);
    }
    return map;
  }, [supportTickets]);

  const projectId = supportTickets[0]?.projectId ?? undefined;
  const [projectTags] = useCachedQuery(
    queries.projectTagsByProjectId({ projectId: projectId || '' }),
    { enabled: !!projectId },
  );
  const availableTags = useMemo(() => {
    if (!projectTags || projectTags.length === 0) return [];
    return Array.from(new Set(projectTags.map(tag => tag.name))).sort();
  }, [projectTags]);

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <TicketTable
        tickets={supportTickets}
        ticketTags={tagsByTicketId}
        availableTags={availableTags}
        onTitleClick={onTicketClick}
        {...(selectedIds !== undefined ? { selectedIds } : {})}
        {...(onSelectionChange !== undefined ? { onSelectionChange } : {})}
        {...(visibleColumns ? { visibleColumns } : {})}
        hasMore={hasMore}
        isLoadingMore={isLoadingMore}
        isLoading={!isSettled && supportTickets.length === 0}
        onLoadMore={loadMore}
        layout='columns'
        {...(dynamicFieldColumns ? { dynamicFieldColumns } : {})}
      />
    </div>
  );
};
