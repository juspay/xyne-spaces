import React from 'react';
import { Circle } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Ticket, TicketTag } from '@xyne/shared';
import { TicketStatusV2 } from '@xyne/shared';
import type {
  DroppableStageProps,
  SortableTicketCardProps,
  Stage,
} from '../../../routes/KanbanBoardScreen/KanbanBoardScreen.types';
import { TicketCard } from '../TicketCard/TicketCard';
import Button from '../../ui/Button';
import { CollapseIcon } from '../../../assets/icons/CollapseIcon';
import { ExpandIcon } from '../../../assets/icons/ExpandIcon';
import { cn } from '../../../utils/classNames';
import { StatusOptions } from '../TicketTable/TicketTableHelper';

const VIRTUAL_ROW_HEIGHT = 130;
const VIRTUAL_OVERSCAN = 15;

const SortableTicketCard: React.FC<SortableTicketCardProps> = ({
  ticket,
  tags,
  onClick,
  availableTags = [],
  visibleColumns,
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: ticket.id,
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
  stageTickets: Ticket[];
  tagsByTicketId: Map<string, TicketTag[]>;
  availableTags: string[];
  visibleColumns?: Set<string> | undefined;
  onTicketClick: (e: React.MouseEvent | KeyboardEvent, ticket: Ticket) => void;
}> = ({ stageId, stageTickets, tagsByTicketId, availableTags, visibleColumns, onTicketClick }) => {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const scrollKey = `kanban-scroll-${stageId}`;

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const saved = sessionStorage.getItem(scrollKey);
    if (saved) el.scrollTop = parseInt(saved, 10);

    const onScroll = (): void => {
      sessionStorage.setItem(scrollKey, String(el.scrollTop));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [scrollKey]);

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
                tags={tagsByTicketId.get(ticket.id) || []}
                availableTags={availableTags}
                onClick={e => onTicketClick(e, ticket)}
                visibleColumns={visibleColumns}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

interface KanbanColumnsProps {
  stages: Stage[];
  ticketsByStage: Record<string, Ticket[]>;
  tagsByTicketId: Map<string, TicketTag[]>;
  onTicketClick: (e: React.MouseEvent | KeyboardEvent, ticket: Ticket) => void;
  keyPrefix?: string;
  availableTags?: string[];
  containerClassName?: string;
  visibleColumns?: Set<string> | undefined;
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
  tagsByTicketId,
  onTicketClick,
  keyPrefix = '',
  containerClassName,
  availableTags = [],
  visibleColumns,
}) => {
  const [collapsedStageIds, setCollapsedStageIds] = React.useState<string[]>([]);

  const toggleCollapse = (stageId: string) => {
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
        const isCollapsed = collapsedStageIds.includes(stage.id);

        return (
          <DroppableStage key={`${keyPrefix}${stage.id}`} id={stage.id}>
            <div
              className={cn(
                'flex flex-col rounded-lg transition-all duration-300 ease-in-out bg-muted h-full',
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
                        {stageTickets.length}
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
                        {stageTickets.length}
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
                  <SortableContext items={ticketIds} strategy={verticalListSortingStrategy}>
                    <VirtualizedStageList
                      stageId={stage.id}
                      stageTickets={stageTickets}
                      tagsByTicketId={tagsByTicketId}
                      availableTags={availableTags}
                      visibleColumns={visibleColumns}
                      onTicketClick={onTicketClick}
                    />
                  </SortableContext>
                </div>
              )}
            </div>
          </DroppableStage>
        );
      })}
    </div>
  );
};
