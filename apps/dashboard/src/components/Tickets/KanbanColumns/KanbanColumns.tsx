import React from 'react';
import { Circle, DragableSixDots, PlusDefault as Plus } from '@xyne/icons';
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
import Button from '../../ui/Button';
import { CollapseIcon } from '../../../assets/icons/CollapseIcon';
import { ExpandIcon } from '../../../assets/icons/ExpandIcon';
import { cn } from '../../../utils/classNames';
import { StatusOptions } from '../TicketTable/TicketTableHelper';

const VIRTUAL_ROW_HEIGHT = 130;
const VIRTUAL_OVERSCAN = 25;

/**
 * Column order and hand-collapsed columns, per device. Keyed by the stage ids
 * themselves, so every board keeps its own order without the caller passing an
 * identity in, and a board whose stages changed falls back to its natural order.
 */
const COLUMN_LAYOUT_PREFIX = 'xyne:kanban-column-layout:';
const COLUMN_LAYOUT_CHANGE_EVENT = 'xyne:kanban-column-layout-change';

interface ColumnLayout {
  order: string[];
  collapsed: string[];
  /** Collapsed or expanded by hand — exempt from the auto-collapse below. */
  userToggled: string[];
}

/** A factory, not a constant: callers keep these arrays in state. */
const emptyColumnLayout = (): ColumnLayout => ({ order: [], collapsed: [], userToggled: [] });

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
  onLoadMore?: () => void;
  onTicketsChange?: (columnKey: string, tickets: Ticket[]) => void;
  availableTags: string[];
  visibleColumns?: Set<string> | undefined;
  activeTicketId?: string;
  showEmailReads?: boolean;
  onTicketClick: (e: React.MouseEvent | KeyboardEvent, ticket: Ticket) => void;
  onAddTicket?: () => void;
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
  onTicketsChange?: (columnKey: string, tickets: Ticket[]) => void;
  availableTags: string[];
  visibleColumns?: Set<string> | undefined;
  activeTicketId?: string;
  showEmailReads?: boolean;
  onTicketClick: (e: React.MouseEvent | KeyboardEvent, ticket: Ticket) => void;
  onAddTicket?: () => void;
  slaPolicies?: BoardSlaPolicy[];
}> = ({
  stage,
  columnKey,
  paginationArgs,
  columnType,
  allKnownTickets,
  onTicketsChange,
  availableTags,
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
      // Merge with cached tickets for optimistic updates if available
      if (allKnownTickets.length > 0) {
        const knownTicketsById = new Map(allKnownTickets.map(t => [t.id, t]));
        return tickets.map(ticket => knownTicketsById.get(ticket.id) ?? ticket);
      }
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
      // Grouping not ready yet - return empty to prevent showing wrong tickets
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
  ticketsByStage: Record<string, Ticket[]>;
  stageCounts?: Record<string, number>;
  onTicketClick: (e: React.MouseEvent | KeyboardEvent, ticket: Ticket) => void;
  keyPrefix?: string;
  /** Scopes the saved layout: status columns carry the same ids on every board. */
  layoutScope?: string;
  availableTags?: string[];
  containerClassName?: string;
  visibleColumns?: Set<string> | undefined;
  paginatedColumnConfig?: {
    columnType: 'stage' | 'status';
    baseArgs: KanbanTicketsPageBaseArgs;
  };
  /**
   * A search is active. Server counts are not refetched for the search term, so
   * they are either stale or absent — and a collapsed column unmounts its query,
   * so it can never report a match again. Both count display and auto-collapse
   * have to stop trusting `stageCounts` while this is true.
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

export const KanbanIcon = ({ status }: { status?: TicketStatusV2 | undefined }) => {
  if (!status) {
    return <Circle className='w-4 h-4 text-muted-foreground' />;
  }
  const statusOption = StatusOptions.find(opt => (opt.value as TicketStatusV2) === status);
  if (statusOption) {
    return <>{statusOption.icon}</>;
  }
  return <Circle className='w-4 h-4 text-muted-foreground' />;
};

export const KanbanColumns: React.FC<KanbanColumnsProps> = ({
  stages,
  ticketsByStage,
  stageCounts,
  onTicketClick,
  keyPrefix = '',
  layoutScope = '',
  containerClassName,
  availableTags = [],
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
  const stageCollapseSignature = React.useMemo(
    () => stages.map(stage => `${stage.id}:${stageCountById[stage.id] ?? 0}`).join('|'),
    [stages, stageCountById],
  );
  const userToggledCollapsedStageIdsRef = React.useRef<Set<string>>(new Set());
  const [collapsedStageIds, setCollapsedStageIds] = React.useState<string[]>([]);
  const [columnOrder, setColumnOrder] = React.useState<string[]>([]);
  const [draggedStageId, setDraggedStageId] = React.useState<string | null>(null);

  const layoutKey = [layoutScope, ...stages.map(stage => stage.id).sort()].join('|');
  const seededLayoutKeyRef = React.useRef('');
  if (seededLayoutKeyRef.current !== layoutKey) {
    // First render, or the board switched to a different set of stages.
    const saved = readColumnLayout(layoutKey);
    seededLayoutKeyRef.current = layoutKey;
    setColumnOrder(saved.order);
    setCollapsedStageIds(saved.collapsed);
    userToggledCollapsedStageIdsRef.current = new Set(saved.userToggled);
  }

  React.useEffect(() => {
    // Only the order follows other instances: re-seeding collapse on every write
    // would throw away what auto-collapse has worked out since.
    const syncOrder = (): void => setColumnOrder(readColumnLayout(layoutKey).order);
    window.addEventListener(COLUMN_LAYOUT_CHANGE_EVENT, syncOrder);
    return (): void => window.removeEventListener(COLUMN_LAYOUT_CHANGE_EVENT, syncOrder);
  }, [layoutKey]);

  const orderPositionById = new Map(columnOrder.map((stageId, index) => [stageId, index]));
  const orderedStages = columnOrder.length
    ? [...stages].sort(
        (a, b) => (orderPositionById.get(a.id) ?? 0) - (orderPositionById.get(b.id) ?? 0),
      )
    : stages;

  const moveColumnTo = (targetStageId: string): void => {
    setDraggedStageId(null);
    if (!draggedStageId || draggedStageId === targetStageId) return;

    const stageIds = orderedStages.map(stage => stage.id);
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

  React.useEffect(() => {
    // While counts cannot be trusted, release everything the user did not collapse
    // by hand. Collapsing here would unmount the column's query and hide matches
    // that can then never be fetched back.
    if (!countsAreReliable) {
      setCollapsedStageIds(prev => {
        const next = prev.filter(id => userToggledCollapsedStageIdsRef.current.has(id));
        return next.length === prev.length ? prev : next;
      });
      return;
    }

    if (!stages.some(stage => (stageCountById[stage.id] ?? 0) > 0)) {
      return;
    }

    setCollapsedStageIds(prev => {
      const next = new Set(prev);

      for (const stage of stages) {
        if (userToggledCollapsedStageIdsRef.current.has(stage.id)) {
          continue;
        }

        if ((stageCountById[stage.id] ?? 0) > 0) {
          next.delete(stage.id);
        } else {
          next.add(stage.id);
        }
      }

      return next.size === prev.length && prev.every(id => next.has(id)) ? prev : [...next];
    });
  }, [stageCollapseSignature, stages, stageCountById, countsAreReliable]);

  const toggleCollapse = (stageId: string): void => {
    userToggledCollapsedStageIdsRef.current.add(stageId);
    const next = collapsedStageIds.includes(stageId)
      ? collapsedStageIds.filter(id => id !== stageId)
      : [...collapsedStageIds, stageId];
    setCollapsedStageIds(next);
    writeColumnLayout(layoutKey, {
      collapsed: next,
      userToggled: [...userToggledCollapsedStageIdsRef.current],
    });
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
        const isCollapsed = collapsedStageIds.includes(stage.id);
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
                'group/kanbancol flex flex-col rounded-lg transition-all duration-300 ease-in-out bg-muted h-full',
                isCollapsed ? 'w-12 sm:w-14' : 'w-72 sm:w-96',
                draggedStageId === stage.id && 'opacity-40',
              )}
            >
              <div
                className={cn(
                  'flex items-center justify-between px-4 pt-3 pb-1 w-full',
                  isCollapsed && 'h-full min-h-[236px] flex-col gap-2',
                )}
              >
                {!isCollapsed ? (
                  /* EXPANDED HEADER */
                  <>
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
                      <ColumnDragHandle
                        stageId={stage.id}
                        onDraggedStageChange={setDraggedStageId}
                      />
                      <Button
                        variant='ghost'
                        onClick={() => toggleCollapse(stage.id)}
                        className='!p-0 !bg-transparent'
                        data-track-category='Tickets'
                        data-track-name='CollapseKanbanColumn'
                        data-track-metadata={JSON.stringify({
                          stageId: stage.id,
                          stageName: stage.name,
                        })}
                      >
                        <CollapseIcon />
                      </Button>
                    </div>
                  </>
                ) : (
                  /* COLLAPSED HEADER */
                  <div
                    className='flex flex-col items-center justify-between w-full h-full min-h-[236px] cursor-pointer'
                    onClick={() => toggleCollapse(stage.id)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleCollapse(stage.id);
                      }
                    }}
                    role='button'
                    tabIndex={0}
                    data-track-category='Tickets'
                    data-track-name='ExpandKanbanColumn'
                    data-track-metadata={JSON.stringify({
                      stageId: stage.id,
                      stageName: stage.name,
                    })}
                  >
                    <div className='flex flex-col items-center gap-2 w-full h-full'>
                      <ColumnDragHandle
                        stageId={stage.id}
                        onDraggedStageChange={setDraggedStageId}
                      />
                      <KanbanIcon status={stage.defaultTicketStatusV2} />
                      <h3
                        className={cn(
                          'text-sm font-medium whitespace-nowrap w-fit text-foreground',
                          '[transform-origin:center] [writing-mode:vertical-rl] [text-orientation:mixed]',
                        )}
                      >
                        {stage.name}
                      </h3>
                      <span
                        className={cn(
                          'text-sm py-2 px-0.5 rounded-full text-muted-foreground bg-muted-foreground/10',
                          '[transform-origin:center] [writing-mode:vertical-rl] [text-orientation:mixed]',
                        )}
                      >
                        {stageCount}
                      </span>
                    </div>

                    <Button
                      variant='ghost'
                      onClick={e => {
                        e.stopPropagation();
                        toggleCollapse(stage.id);
                      }}
                      className='!p-0 !bg-transparent'
                      data-track-category='Tickets'
                      data-track-name='CollapseKanbanColumn'
                      data-track-metadata={JSON.stringify({
                        stageId: stage.id,
                        stageName: stage.name,
                      })}
                    >
                      <ExpandIcon />
                    </Button>
                  </div>
                )}
              </div>

              {!isCollapsed && (
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
              )}
            </div>
          </DroppableStage>
        );
      })}
    </div>
  );
};
