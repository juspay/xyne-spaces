import React from 'react';
import { DragableSixDots, EyeOff, PlusDefault as Plus, ThreeDotsMenuHorizontal } from '@xyne/icons';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Ticket, TicketTagMapping, FormEntityValues } from '@xyne/shared';
import { TicketStatusV2 } from '@xyne/shared';

type TicketWithTags = Ticket & { tagMappings?: TicketTagMapping[] };
import type {
  DroppableStageProps,
  SortableTicketCardProps,
  Stage,
} from '../../../routes/KanbanBoardScreen/KanbanBoardScreen.types';
import type { BoardSlaPolicy } from '../../../hooks/useChannelSlaPolicy';
import { ticketBoardSnapshotSignature } from '../../../routes/KanbanBoardScreen/KanbanBoardScreen.utils';
import {
  type KanbanTicketsPageBaseArgs,
  useKanbanTicketsPage,
} from '../../../routes/KanbanBoardScreen/useKanbanTicketsPage';
import { TicketCard } from '../TicketCard/TicketCard';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { cn } from '../../../utils/classNames';
import { KanbanIcon } from './KanbanIcon';
import { HiddenColumnsPanel } from '../HiddenColumnsPanel/HiddenColumnsPanel';

// Re-exported for the many call sites that already import it from here.
export { KanbanIcon };

const VIRTUAL_ROW_HEIGHT = 130;
const VIRTUAL_OVERSCAN = 25;

/**
 * Column order, per device. Keyed by the stage ids themselves, so every board
 * keeps its own order without the caller passing an identity in, and a board
 * whose stages changed falls back to its natural order.
 */
const COLUMN_LAYOUT_PREFIX = 'xyne:kanban-column-layout:';
const COLUMN_LAYOUT_CHANGE_EVENT = 'xyne:kanban-column-layout-change';

interface ColumnLayout {
  order: string[];
}

/** A factory, not a constant: callers keep these arrays in state. */
const emptyColumnLayout = (): ColumnLayout => ({ order: [] });

const readColumnLayout = (key: string): ColumnLayout => {
  try {
    const raw = localStorage.getItem(COLUMN_LAYOUT_PREFIX + key);
    return { ...emptyColumnLayout(), ...(raw ? (JSON.parse(raw) as Partial<ColumnLayout>) : {}) };
  } catch {
    return emptyColumnLayout();
  }
};

const writeColumnLayout = (key: string, patch: Partial<ColumnLayout>): void => {
  try {
    const next = { ...readColumnLayout(key), ...patch };
    localStorage.setItem(COLUMN_LAYOUT_PREFIX + key, JSON.stringify(next));
    // Grouped boards render one instance per group; they share a key and follow.
    // Only on success: otherwise the re-read would undo what the drag just did.
    window.dispatchEvent(new Event(COLUMN_LAYOUT_CHANGE_EVENT));
  } catch {
    // Storage blocked or full — the layout lives for this session only.
  }
};

/** Visible grip — the only part of a column that starts a reorder drag. */
const ColumnDragHandle: React.FC<{
  stageId: string;
  onDraggedStageChange: (stageId: string | null) => void;
}> = ({ stageId, onDraggedStageChange }) => (
  <div
    draggable
    onDragStart={event => {
      event.dataTransfer.setData('text/plain', stageId); // Firefox needs data to start a drag.
      onDraggedStageChange(stageId);
    }}
    onDragEnd={() => onDraggedStageChange(null)}
    title='Drag to reorder column'
    className='cursor-grab text-muted-foreground active:cursor-grabbing'
  >
    <DragableSixDots className='size-4' />
  </div>
);

const SortableTicketCard: React.FC<SortableTicketCardProps> = ({
  ticket,
  tags,
  onClick,
  availableTags = [],
  onLoadMoreTags,
  hasMoreTags = false,
  onSearchTags,
  visibleColumns,
  activeTicketId,
  showEmailReads,
  slaPolicies,
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: ticket.id,
    data: { ticket },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      data-track-category='Tickets'
      data-track-name='DragTicketCard'
      data-track-metadata={JSON.stringify({ ticketId: ticket.id })}
    >
      <TicketCard
        ticket={ticket}
        isCompact={true}
        tags={tags}
        onClick={onClick}
        availableTags={availableTags}
        onLoadMoreTags={onLoadMoreTags}
        hasMoreTags={hasMoreTags}
        onSearchTags={onSearchTags}
        visibleColumns={visibleColumns}
        {...(activeTicketId !== undefined && { activeTicketId })}
        {...(showEmailReads !== undefined && { showEmailReads })}
        {...(slaPolicies !== undefined && { slaPolicies })}
      />
    </div>
  );
};

const DroppableStage: React.FC<DroppableStageProps> = ({ id, children }) => {
  const { setNodeRef } = useDroppable({ id });

  return <div ref={setNodeRef}>{children}</div>;
};

const VirtualizedStageList: React.FC<{
  stageId: string;
  columnKey: string;
  stageTickets: Ticket[];
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: (() => void) | undefined;
  onTicketsChange?: ((columnKey: string, tickets: Ticket[]) => void) | undefined;
  availableTags: string[];
  onLoadMoreTags?: (() => void) | undefined;
  hasMoreTags?: boolean;
  onSearchTags?: ((query: string) => void) | undefined;
  visibleColumns?: Set<string> | undefined;
  activeTicketId?: string;
  showEmailReads?: boolean;
  onTicketClick: (e: React.MouseEvent | KeyboardEvent, ticket: Ticket) => void;
  onAddTicket?: (() => void) | undefined;
  slaPolicies?: BoardSlaPolicy[];
}> = ({
  stageId,
  columnKey,
  stageTickets,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
  onTicketsChange,
  onAddTicket,
  availableTags,
  onLoadMoreTags,
  hasMoreTags = false,
  onSearchTags,
  visibleColumns,
  activeTicketId,
  showEmailReads,
  onTicketClick,
  slaPolicies,
}) => {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const lastReportedTicketSnapshotRef = React.useRef<string>('');
  const scrollKey = `kanban-scroll-${stageId}`;
  const ticketSnapshotSignature = React.useMemo(
    () => stageTickets.map(ticket => ticketBoardSnapshotSignature(ticket)).join(','),
    [stageTickets],
  );

  React.useEffect(() => {
    if (!onTicketsChange) return;
    if (lastReportedTicketSnapshotRef.current === ticketSnapshotSignature) return;
    lastReportedTicketSnapshotRef.current = ticketSnapshotSignature;
    onTicketsChange(columnKey, stageTickets);
  }, [columnKey, onTicketsChange, stageTickets, ticketSnapshotSignature]);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const saved = sessionStorage.getItem(scrollKey);
    if (saved) el.scrollTop = parseInt(saved, 10);

    const onScroll = (): void => {
      sessionStorage.setItem(scrollKey, String(el.scrollTop));
      if (!hasMore || isLoadingMore || !onLoadMore) return;

      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (distanceFromBottom < VIRTUAL_ROW_HEIGHT * 3) {
        onLoadMore();
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [hasMore, isLoadingMore, onLoadMore, scrollKey]);

  const virtualizer = useVirtualizer({
    count: stageTickets.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => VIRTUAL_ROW_HEIGHT,
    overscan: VIRTUAL_OVERSCAN,
  });

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div ref={scrollRef} className='h-full overflow-y-auto pt-3 px-3'>
      <div
        className='relative w-full'
        style={{
          height: `${virtualizer.getTotalSize()}px`,
        }}
      >
        {virtualItems.map(virtualItem => {
          const ticket = stageTickets[virtualItem.index];
          if (!ticket) return null;

          return (
            <div
              key={ticket.id}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              className='absolute left-0 top-0 w-full pb-1.5'
              style={{
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <SortableTicketCard
                ticket={ticket}
                tags={((ticket as TicketWithTags).tagMappings ?? []).map(m => ({
                  workspaceId: m.workspaceId,
                  id: m.id,
                  name: m.tagName,
                  ticketId: m.ticketId,
                }))}
                availableTags={availableTags}
                onLoadMoreTags={onLoadMoreTags}
                hasMoreTags={hasMoreTags}
                onSearchTags={onSearchTags}
                onClick={e => onTicketClick(e, ticket)}
                visibleColumns={visibleColumns}
                {...(activeTicketId !== undefined && { activeTicketId })}
                {...(showEmailReads !== undefined && { showEmailReads })}
                {...(slaPolicies !== undefined && { slaPolicies })}
              />
            </div>
          );
        })}
      </div>
      {onAddTicket && (
        <button
          type='button'
          onClick={onAddTicket}
          data-track-category='Tickets'
          data-track-name='AddTicketInColumn'
          className='hidden group-hover/kanbancol:flex items-center gap-2 w-full mb-2 px-3 py-2 rounded-lg border border-dashed border-border text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-accent/40 hover:text-foreground'
        >
          <Plus className='h-3.5 w-3.5' />
          New ticket
        </button>
      )}
      {isLoadingMore && (
        <div className='py-3 text-center text-xs text-muted-foreground'>Loading more...</div>
      )}
    </div>
  );
};

const PaginatedStageList: React.FC<{
  stage: Stage;
  columnKey: string;
  paginationArgs: KanbanTicketsPageBaseArgs;
  columnType: 'stage' | 'status';
  allKnownTickets: Ticket[];
  onTicketsChange?: ((columnKey: string, tickets: Ticket[]) => void) | undefined;
  availableTags: string[];
  onLoadMoreTags?: (() => void) | undefined;
  hasMoreTags?: boolean;
  onSearchTags?: ((query: string) => void) | undefined;
  visibleColumns?: Set<string> | undefined;
  activeTicketId?: string;
  showEmailReads?: boolean;
  onTicketClick: (e: React.MouseEvent | KeyboardEvent, ticket: Ticket) => void;
  onAddTicket?: (() => void) | undefined;
  slaPolicies?: BoardSlaPolicy[];
}> = ({
  stage,
  columnKey,
  paginationArgs,
  columnType,
  allKnownTickets,
  onTicketsChange,
  availableTags,
  onLoadMoreTags,
  hasMoreTags = false,
  onSearchTags,
  visibleColumns,
  activeTicketId,
  showEmailReads,
  onTicketClick,
  onAddTicket,
  slaPolicies,
}) => {
  const columnValue = columnType === 'status' ? stage.id : stage.name;
  const columnStatus = stage.defaultTicketStatusV2;
  const { groupBy } = paginationArgs;
  const { tickets, hasMore, isLoadingMore, loadMore, isUsingDirectVespaRows } =
    useKanbanTicketsPage({
      ...paginationArgs,
      columnType,
      stageName: columnValue,
    });
  const renderedTickets = React.useMemo(() => {
    const isGroupByActive = groupBy && groupBy !== 'none';

    // When using direct Vespa rows, trust the results - they're already filtered
    // by group-specific Vespa filters (dynamic field tokens, assignee, priority, etc.)
    if (isUsingDirectVespaRows) {
      // If Vespa returned tickets, merge with cached tickets for optimistic updates
      if (tickets.length > 0) {
        if (allKnownTickets.length > 0) {
          const knownTicketsById = new Map(allKnownTickets.map(t => [t.id, t]));
          return tickets.map(ticket => knownTicketsById.get(ticket.id) ?? ticket);
        }
        return tickets;
      }
      // Vespa returned 0 tickets. This could be:
      // 1. A valid empty result (filters matched nothing) - respect it
      // 2. Vespa segregation filtered out tickets due to stage mismatch - use allKnownTickets
      //
      // To distinguish: if allKnownTickets has tickets that belong to this column,
      // use them (case 2). Otherwise, trust the empty result (case 1).
      if (allKnownTickets.length > 0) {
        const columnTickets = allKnownTickets.filter(ticket =>
          ticketBelongsToColumn(ticket, columnType, columnValue, columnStatus),
        );
        if (columnTickets.length > 0) {
          return columnTickets;
        }
      }
      // No tickets match - return empty (this is a valid filtered result)
      return tickets;
    }

    // In normal view (no grouping), trust server-side filtering
    if (!isGroupByActive) {
      if (allKnownTickets.length === 0) {
        return tickets;
      }
      // Merge with cached tickets for optimistic updates
      const knownTicketsById = new Map(allKnownTickets.map(t => [t.id, t]));
      return tickets.map(ticket => {
        const known = knownTicketsById.get(ticket.id);
        if (known && ticketBelongsToColumn(known, columnType, columnValue, columnStatus)) {
          return known;
        }
        return ticket;
      });
    }

    // In group by mode without direct Vespa rows, use allKnownTickets as source of truth.
    // This path is used when Zero query provides the tickets.
    if (allKnownTickets.length === 0) {
      // When allKnownTickets is empty but we have tickets from the hook, use them directly.
      // This prevents the view from being empty when filtering in group-by mode,
      // especially for priority grouping where the chicken-and-egg problem can occur:
      // - allKnownTickets comes from kanbanTicketsForGrouping
      // - kanbanTicketsForGrouping is built from tickets reported by columns
      // - But columns can't report tickets if they don't render any
      if (tickets.length > 0) {
        return tickets;
      }
      return [];
    }

    const knownTicketsById = new Map(allKnownTickets.map(ticket => [ticket.id, ticket]));
    const renderedTicketsById = new Map<string, Ticket>();

    for (const ticket of tickets) {
      const knownTicket = knownTicketsById.get(ticket.id);
      if (knownTicket) {
        // Ticket exists in client-side grouped data - use cached version
        // but validate it still belongs to this column
        const belongsToColumn = ticketBelongsToColumn(
          knownTicket,
          columnType,
          columnValue,
          columnStatus,
        );
        if (belongsToColumn) {
          renderedTicketsById.set(ticket.id, knownTicket);
        }
      }
      // If ticket is not in knownTicketsById, it doesn't belong to this group
      // according to client-side grouping - skip it
    }

    // Add-side reconciliation: a ticket whose LIVE status/stage now matches this
    // column must render here even if this column's (async, possibly stale) fetch
    // has not surfaced it yet. Right after a status change under a Vespa-backed
    // filter, the moved ticket is dropped from its old column above but the search
    // index has not yet returned it for the new column; without this loop the card
    // disappears from every column until Vespa reindexes.
    // allKnownTickets is scoped to THIS swimlane's tickets (group.allTickets), so
    // a ticket is only reconciled into its own group's column, never duplicated
    // across swimlanes when a groupBy is active.
    for (const knownTicket of allKnownTickets) {
      if (renderedTicketsById.has(knownTicket.id)) continue;
      if (!ticketBelongsToColumn(knownTicket, columnType, columnValue, columnStatus)) continue;
      renderedTicketsById.set(knownTicket.id, knownTicket);
    }

    return [...renderedTicketsById.values()];
  }, [
    allKnownTickets,
    columnStatus,
    columnType,
    columnValue,
    groupBy,
    isUsingDirectVespaRows,
    tickets,
  ]);

  const fetchedTicketSnapshotSignature = React.useMemo(
    () => tickets.map(ticket => ticketBoardSnapshotSignature(ticket)).join(','),
    [tickets],
  );
  const lastReportedFetchedTicketSnapshotRef = React.useRef<string>('');

  React.useEffect(() => {
    if (!onTicketsChange) return;
    if (lastReportedFetchedTicketSnapshotRef.current === fetchedTicketSnapshotSignature) return;
    lastReportedFetchedTicketSnapshotRef.current = fetchedTicketSnapshotSignature;
    onTicketsChange(columnKey, tickets);
  }, [columnKey, fetchedTicketSnapshotSignature, onTicketsChange, tickets]);

  return (
    <SortableContext
      items={renderedTickets.map(ticket => ticket.id)}
      strategy={verticalListSortingStrategy}
    >
      <VirtualizedStageList
        stageId={stage.id}
        columnKey={columnKey}
        stageTickets={renderedTickets}
        hasMore={hasMore}
        isLoadingMore={isLoadingMore}
        onLoadMore={loadMore}
        availableTags={availableTags}
        onLoadMoreTags={onLoadMoreTags}
        hasMoreTags={hasMoreTags}
        onSearchTags={onSearchTags}
        visibleColumns={visibleColumns}
        {...(activeTicketId !== undefined && { activeTicketId })}
        {...(showEmailReads !== undefined && { showEmailReads })}
        onTicketClick={onTicketClick}
        {...(onAddTicket !== undefined && { onAddTicket })}
        {...(slaPolicies !== undefined && { slaPolicies })}
      />
    </SortableContext>
  );
};

const ticketBelongsToColumn = (
  ticket: Ticket,
  columnType: 'stage' | 'status',
  columnValue: string,
  columnStatus?: TicketStatusV2,
): boolean => {
  if (columnType === 'status') {
    return ticket.statusV2 === columnStatus;
  }

  return ticket.stageName === columnValue;
};

interface KanbanColumnsProps {
  stages: Stage[];
  /** Columns parked in the hidden-columns panel — dropped from the strip entirely. */
  hiddenColumnIds?: string[];
  /** Omitted when the board has no hidden-columns panel to park a column in. */
  onHideColumn?: (stageId: string) => void;
  onUnhideColumn?: (stageId: string) => void;
  ticketsByStage: Record<string, Ticket[]>;
  stageCounts?: Record<string, number>;
  onTicketClick: (e: React.MouseEvent | KeyboardEvent, ticket: Ticket) => void;
  keyPrefix?: string;
  /** Scopes the saved layout: status columns carry the same ids on every board. */
  layoutScope?: string;
  availableTags?: string[];
  /** Callback to load more tags */
  onLoadMoreTags?: () => void;
  /** Whether there are more tags to load */
  hasMoreTags?: boolean;
  /** Callback for server-side tag search */
  onSearchTags?: (query: string) => void;
  containerClassName?: string;
  visibleColumns?: Set<string> | undefined;
  paginatedColumnConfig?: {
    columnType: 'stage' | 'status';
    baseArgs: KanbanTicketsPageBaseArgs;
  };
  /**
   * A search is active. Server counts are not refetched for the search term, so
   * they are either stale or absent, and the count display has to stop trusting
   * `stageCounts` while this is true.
   */
  searchActive?: boolean;
  allKnownTickets?: Ticket[];
  onTicketsChange?: (columnKey: string, tickets: Ticket[]) => void;
  onAddTicketInColumn?: (column: {
    status?: TicketStatusV2 | undefined;
    stageName?: string | undefined;
  }) => void;
  activeTicketId?: string;
  /** Only true for email-type desks; hides the email unread indicator in normal channels. */
  showEmailReads?: boolean;
  /**
   * SLA policies pre-fetched by the parent for the active board.
   * Passed through to each TicketCard so they skip their own per-card
   * Zero subscription (avoids N identical subscriptions for N tickets).
   * Only supplied when the board uses priority-based SLA mode; omit for
   * stage-based SLA (no policy fetch needed in that case).
   */
  slaPolicies?: BoardSlaPolicy[];
  /** Form field values by ticket ID - used for validating group membership when groupBy is a form field */
  formValuesByTicketId?: Map<string, FormEntityValues[]>;
  /** User names by ID - used for resolving user IDs to names in form field group validation */
  userNamesById?: Map<string, string>;
}

export const KanbanColumns: React.FC<KanbanColumnsProps> = ({
  stages,
  hiddenColumnIds,
  onHideColumn,
  onUnhideColumn,
  ticketsByStage,
  stageCounts,
  onTicketClick,
  keyPrefix = '',
  layoutScope = '',
  containerClassName,
  availableTags = [],
  onLoadMoreTags,
  hasMoreTags = false,
  onSearchTags,
  visibleColumns,
  activeTicketId,
  showEmailReads,
  slaPolicies,
  paginatedColumnConfig,
  searchActive,
  allKnownTickets,
  onTicketsChange,
  onAddTicketInColumn,
  formValuesByTicketId,
  userNamesById,
}) => {
  const columnType = paginatedColumnConfig?.columnType ?? 'stage';
  const isGroupByActive =
    paginatedColumnConfig?.baseArgs?.groupBy && paginatedColumnConfig.baseArgs.groupBy !== 'none';
  const knownTicketsForOptimisticMerge = React.useMemo(() => {
    // In group by mode, ticketsByStage contains only this group's tickets
    // Use it as source of truth to prevent tickets from appearing in wrong groups
    if (isGroupByActive) {
      return Object.values(ticketsByStage).flat();
    }
    // In normal mode, use allKnownTickets for optimistic updates
    return allKnownTickets ?? Object.values(ticketsByStage).flat();
  }, [allKnownTickets, isGroupByActive, ticketsByStage]);
  // Only the paginated board can starve a collapsed column of its count; the
  // non-paginated board always has every ticket in `ticketsByStage`.
  const countsAreReliable = !(paginatedColumnConfig && searchActive);
  const stageCountById = React.useMemo(() => {
    const counts: Record<string, number> = {};

    for (const stage of stages) {
      const loaded = ticketsByStage[stage.id]?.length ?? 0;
      counts[stage.id] = countsAreReliable
        ? (stageCounts?.[stage.id] ?? stageCounts?.[stage.name] ?? loaded)
        : loaded;
    }

    return counts;
  }, [stages, stageCounts, ticketsByStage, countsAreReliable]);
  const [columnOrder, setColumnOrder] = React.useState<string[]>([]);
  const [draggedStageId, setDraggedStageId] = React.useState<string | null>(null);

  const layoutKey = [layoutScope, ...stages.map(stage => stage.id).sort()].join('|');
  const seededLayoutKeyRef = React.useRef('');
  if (seededLayoutKeyRef.current !== layoutKey) {
    // First render, or the board switched to a different set of stages.
    seededLayoutKeyRef.current = layoutKey;
    setColumnOrder(readColumnLayout(layoutKey).order);
  }

  React.useEffect(() => {
    // Grouped boards render one instance per group off the same layout key.
    const syncOrder = (): void => setColumnOrder(readColumnLayout(layoutKey).order);
    window.addEventListener(COLUMN_LAYOUT_CHANGE_EVENT, syncOrder);
    return (): void => window.removeEventListener(COLUMN_LAYOUT_CHANGE_EVENT, syncOrder);
  }, [layoutKey]);

  const orderPositionById = new Map(columnOrder.map((stageId, index) => [stageId, index]));
  const bySavedOrder = (a: Stage, b: Stage): number =>
    (orderPositionById.get(a.id) ?? 0) - (orderPositionById.get(b.id) ?? 0);
  const visibleStages = hiddenColumnIds?.length
    ? stages.filter(stage => !hiddenColumnIds.includes(stage.id))
    : stages;
  const hiddenStages = hiddenColumnIds?.length
    ? stages.filter(stage => hiddenColumnIds.includes(stage.id))
    : [];
  const orderedStages = columnOrder.length ? [...visibleStages].sort(bySavedOrder) : visibleStages;

  const moveColumnTo = (targetStageId: string): void => {
    setDraggedStageId(null);
    if (!draggedStageId || draggedStageId === targetStageId) return;

    // Ordered over every stage, hidden ones included, so unhiding a column
    // restores it where it was rather than at the head of the strip.
    const stageIds = [...stages].sort(bySavedOrder).map(stage => stage.id);
    // Target index taken before the removal, so the column lands after the target
    // when dragged rightwards and before it when dragged leftwards.
    const fromIndex = stageIds.indexOf(draggedStageId);
    const toIndex = stageIds.indexOf(targetStageId);
    if (fromIndex === -1 || toIndex === -1) return; // A -1 would splice off the last column.
    stageIds.splice(fromIndex, 1);
    stageIds.splice(toIndex, 0, draggedStageId);
    setColumnOrder(stageIds);
    writeColumnLayout(layoutKey, { order: stageIds });
  };

  return (
    <div
      className={cn(
        'flex gap-1 sm:gap-4 p-2 sm:p-3 h-full bg-background overflow-x-auto min-w-screen no-scrollbar',
        containerClassName,
      )}
    >
      {orderedStages.map(stage => {
        const stageTickets = ticketsByStage[stage.id] || [];
        const ticketIds = stageTickets.map(t => t.id);
        const stageCount = stageCountById[stage.id] ?? stageTickets.length;
        const columnKey = `${keyPrefix}${stage.id}`;
        const handleAddTicket = onAddTicketInColumn
          ? (): void =>
              onAddTicketInColumn({
                status: stage.defaultTicketStatusV2,
                ...(columnType === 'stage' ? { stageName: stage.name } : {}),
              })
          : undefined;

        return (
          <DroppableStage key={`${keyPrefix}${stage.id}`} id={stage.id}>
            <div
              onDragOver={event => event.preventDefault()}
              onDrop={() => moveColumnTo(stage.id)}
              className={cn(
                'group/kanbancol flex flex-col rounded-lg bg-muted h-full w-72 sm:w-96',
                draggedStageId === stage.id && 'opacity-40',
              )}
            >
              <div className='flex items-center justify-between px-4 pt-3 pb-1 w-full'>
                <div className='flex items-center gap-2 min-w-0'>
                  <KanbanIcon status={stage.defaultTicketStatusV2} />
                  <h3 className='text-xs font-medium truncate uppercase text-foreground'>
                    {stage.name}
                  </h3>
                  <span className='text-xs px-2 py-0.5 rounded-full text-muted-foreground bg-muted-foreground/10'>
                    {stageCount}
                  </span>
                </div>

                <div className='flex items-center gap-1'>
                  <ColumnDragHandle stageId={stage.id} onDraggedStageChange={setDraggedStageId} />
                  {onHideColumn && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type='button'
                          aria-label={`${stage.name} column options`}
                          className='flex size-[26px] shrink-0 items-center justify-center rounded-[7px] text-muted-foreground transition-colors hover:bg-background hover:text-foreground'
                          data-track-category='Tickets'
                          data-track-name='OpenKanbanColumnMenu'
                          data-track-metadata={JSON.stringify({
                            stageId: stage.id,
                            stageName: stage.name,
                          })}
                        >
                          <ThreeDotsMenuHorizontal className='size-4' />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align='end' className='w-[214px] rounded-xl p-[5px]'>
                        <DropdownMenuItem
                          className='h-[34px] gap-2.5 rounded-lg px-2.5 text-[13.5px]'
                          onSelect={() => onHideColumn(stage.id)}
                          data-track-category='Tickets'
                          data-track-name='HideKanbanColumn'
                          data-track-metadata={JSON.stringify({
                            stageId: stage.id,
                            stageName: stage.name,
                          })}
                        >
                          <EyeOff className='size-4 shrink-0' />
                          <span>Hide column</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>

              <div className='flex-1 min-h-0'>
                {paginatedColumnConfig ? (
                  <PaginatedStageList
                    key={columnKey}
                    stage={stage}
                    columnKey={columnKey}
                    paginationArgs={paginatedColumnConfig.baseArgs}
                    columnType={paginatedColumnConfig.columnType}
                    allKnownTickets={knownTicketsForOptimisticMerge}
                    {...(onTicketsChange !== undefined ? { onTicketsChange } : {})}
                    availableTags={availableTags}
                    onLoadMoreTags={onLoadMoreTags}
                    hasMoreTags={hasMoreTags}
                    onSearchTags={onSearchTags}
                    visibleColumns={visibleColumns}
                    {...(activeTicketId !== undefined && { activeTicketId })}
                    {...(showEmailReads !== undefined && { showEmailReads })}
                    onTicketClick={onTicketClick}
                    {...(handleAddTicket ? { onAddTicket: handleAddTicket } : {})}
                    {...(slaPolicies !== undefined && { slaPolicies })}
                    {...(formValuesByTicketId !== undefined && { formValuesByTicketId })}
                    {...(userNamesById !== undefined && { userNamesById })}
                  />
                ) : (
                  <SortableContext items={ticketIds} strategy={verticalListSortingStrategy}>
                    <VirtualizedStageList
                      stageId={stage.id}
                      columnKey={columnKey}
                      stageTickets={stageTickets}
                      {...(onTicketsChange !== undefined ? { onTicketsChange } : {})}
                      availableTags={availableTags}
                      onLoadMoreTags={onLoadMoreTags}
                      hasMoreTags={hasMoreTags}
                      onSearchTags={onSearchTags}
                      visibleColumns={visibleColumns}
                      {...(activeTicketId !== undefined && { activeTicketId })}
                      {...(showEmailReads !== undefined && { showEmailReads })}
                      onTicketClick={onTicketClick}
                      {...(handleAddTicket ? { onAddTicket: handleAddTicket } : {})}
                      {...(slaPolicies !== undefined && { slaPolicies })}
                    />
                  </SortableContext>
                )}
              </div>
            </div>
          </DroppableStage>
        );
      })}

      {onUnhideColumn && (
        <HiddenColumnsPanel
          stages={hiddenStages}
          getCount={stage => stageCountById[stage.id] ?? 0}
          onUnhide={onUnhideColumn}
        />
      )}
    </div>
  );
};
