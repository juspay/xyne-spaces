import { ReactElement, useCallback, useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import type { Ticket, TicketTag } from '@xyne/shared';
import { FormEntityType, type TicketPriority } from '@xyne/shared';
import { queries } from '../../zero/queries';
import { mutators } from '../../zero/mutators';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useGetChannelUserStatus } from '../../hooks/useChannels';
import { useZero } from '../../hooks/useZero';
import { surfaceMutationError } from '../../utils/zeroMutationToast';
import { dataLoadDuration, safeRecordMetric } from '../../services/otel';
import { logger, Event } from '../../utils/logger';
import { TicketTable } from '../../components/Tickets/TicketTable/TicketTable';
import {
  buildDynamicFieldColumns,
  type DynamicFieldSaveParams,
} from '../../components/Tickets/TicketTable/dynamicFieldColumns';
import {
  ticketMatchesDynamicFieldEntries,
  type DynamicFieldFilterEntry,
  type DynamicFieldQueryFilter,
  type FormEntityValueLike,
} from '../../utils/board/dynamicFieldFilters';
import type { ResolvedDisplayFormField } from '../../utils/board/resolveDisplayFormFields';

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
  const [supportTickets, supportTicketsDetails] = useCachedQuery(
    queries.supportTicketsFilteredV3({
      channelId,
      isMember,
      ...restTicketFilter,
      ...(conversationIdWhitelist !== undefined
        ? { conversationIds: conversationIdWhitelist }
        : {}),
      formEntityValueFieldIds: displayFieldIds,
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

  const dynamicallyFilteredTickets = useMemo(() => {
    if (!supportTickets || !dynamicFieldEntries?.length) return supportTickets;
    return supportTickets.filter(ticket =>
      ticketMatchesDynamicFieldEntries(
        (ticket as { formEntityValues?: FormEntityValueLike[] }).formEntityValues,
        dynamicFieldEntries,
      ),
    );
  }, [supportTickets, dynamicFieldEntries]);

  // Report loaded tickets up so the parent can source the merge dialog.
  useEffect(() => {
    if (dynamicallyFilteredTickets) onTicketsLoaded?.(dynamicallyFilteredTickets as Ticket[]);
  }, [dynamicallyFilteredTickets, onTicketsLoaded]);

  // supportTicketsFilteredV3 already relates tagMappings on every row, so unlike
  // Board's ticketsQueryV2 there's no fallback path needed here.
  const tagsByTicketId = useMemo(() => {
    const map = new Map<string, TicketTag[]>();
    for (const ticket of dynamicallyFilteredTickets ?? []) {
      const tags = (ticket.tagMappings ?? []).map(m => ({
        id: m.id,
        name: m.tagName,
        ticketId: m.ticketId,
      }));
      if (tags.length > 0) map.set(ticket.id, tags as TicketTag[]);
    }
    return map;
  }, [dynamicallyFilteredTickets]);

  const projectId = supportTickets?.[0]?.projectId ?? undefined;
  const [projectTags] = useCachedQuery(
    queries.projectTagsByProjectId({ projectId: projectId || '' }),
    { enabled: !!projectId },
  );
  const availableTags = useMemo(() => {
    if (!projectTags || projectTags.length === 0) return [];
    return Array.from(new Set(projectTags.map(tag => tag.name))).sort();
  }, [projectTags]);

  const zero = useZero();
  const handleDynamicFieldSave = useCallback(
    ({ ticket, field, valueId, newValue }: DynamicFieldSaveParams): void => {
      const fallback = `Failed to update ${field.fieldName}`;
      try {
        const mutation = valueId
          ? zero.mutate(
              mutators.formEntityValue.update({
                formEntityValueId: valueId,
                newValue,
                updatedAt: Date.now(),
              }),
            )
          : zero.mutate(
              mutators.formEntityValue.createV2({
                id: uuidv4(),
                entityId: ticket.id,
                entityType: FormEntityType.TICKET,
                fieldId: field.id,
                formId: field.formId,
                newValue,
                timestamp: Date.now(),
                ...(ticket.boardId ? { contextId: ticket.boardId } : {}),
              }),
            );
        void surfaceMutationError(mutation, fallback);
      } catch (error) {
        logger.error(Event.ZERO_MUTATION_ERROR, {
          source: 'SupportTicketTable',
          message: 'Dynamic field save rejected by the client mutator',
          fieldId: field.id,
          ticketId: ticket.id,
          error: error instanceof Error ? error.message : String(error),
        });
        toast.error(error instanceof Error ? error.message : fallback);
      }
    },
    [zero],
  );

  const extraColumns = useMemo(
    () => buildDynamicFieldColumns(dynamicFieldColumns ?? [], handleDynamicFieldSave),
    [dynamicFieldColumns, handleDynamicFieldSave],
  );

  return (
    <TicketTable
      tickets={(dynamicallyFilteredTickets ?? []) as Ticket[]}
      ticketTags={tagsByTicketId}
      availableTags={availableTags}
      onTitleClick={onTicketClick}
      {...(selectedIds !== undefined ? { selectedIds } : {})}
      {...(onSelectionChange !== undefined ? { onSelectionChange } : {})}
      {...(visibleColumns ? { visibleColumns } : {})}
      extraColumns={extraColumns}
    />
  );
};
