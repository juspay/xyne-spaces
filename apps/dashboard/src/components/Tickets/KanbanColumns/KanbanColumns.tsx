import React from 'react';
import { Circle, Plus } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Ticket, TicketTagMapping } from '@xyne/shared';
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
  const { tickets, hasMore, isLoadingMore, loadMore } = useKanbanTicketsPage({
    ...paginationArgs,
    columnType,
    stageName: columnValue,
  });
  const renderedTickets = React.useMemo(() => {
    if (allKnownTickets.length === 0) return tickets;

    const knownTicketsById = new Map(allKnownTickets.map(ticket => [ticket.id, ticket]));
    const renderedTicketsById = new Map<string, Ticket>();

    for (const ticket of tickets) {
      const knownTicket = knownTicketsById.get(ticket.id);
      if (knownTicket) {
        if (!ticketBelongsToColumn(knownTicket, columnType, columnValue, columnStatus)) continue;
        renderedTicketsById.set(ticket.id, knownTicket);
        continue;
      }

      renderedTicketsById.set(ticket.id, ticket);
    }

    return [...renderedTicketsById.values()];
  }, [allKnownTickets, columnStatus, columnType, columnValue, tickets]);

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
}) => {
  const columnType = paginatedColumnConfig?.columnType ?? 'stage';
  const knownTicketsForOptimisticMerge = React.useMemo(
    () => allKnownTickets ?? Object.values(ticketsByStage).flat(),
    [allKnownTickets, ticketsByStage],
  );
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

  const toggleCollapse = (stageId: string) => {
    userToggledCollapsedStageIdsRef.current.add(stageId);
    setCollapsedStageIds(prev =>
      prev.includes(stageId) ? prev.filter(id => id !== stageId) : [...prev, stageId],
    );
  };

  return (
    <div
      className={cn(
        'flex gap-1 sm:gap-4 p-2 sm:p-3 h-full bg-background overflow-x-auto min-w-screen no-scrollbar',
        containerClassName,
      )}
    >
      {stages.map(stage => {
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
              className={cn(
                'group/kanbancol flex flex-col rounded-lg transition-all duration-300 ease-in-out bg-muted h-full',
                isCollapsed ? 'w-12 sm:w-14' : 'w-72 sm:w-96',
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
