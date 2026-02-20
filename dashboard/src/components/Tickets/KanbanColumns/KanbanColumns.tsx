import React from 'react';
import { Circle, CircleDashed } from 'lucide-react';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useSortable } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { Virtuoso } from 'react-virtuoso';
import type { Ticket, TicketTag } from '@xyne/shared';
import type {
  Stage,
  SortableTicketCardProps,
  DroppableStageProps,
} from '../../../routes/KanbanBoardScreen/KanbanBoardScreen.types';
import { TicketCard } from '../TicketCard/TicketCard';
import Button from '../../ui/Button';
import { CollapseIcon } from '../../../assets/icons/CollapseIcon';
import { ExpandIcon } from '../../../assets/icons/ExpandIcon';
import { cn } from '../../../utils/classNames';
import { StatusOptions } from '../TicketTable/TicketTableHelper';
import { StageCircleIcon } from '../../../assets/icons/StageIcon';
import InProgressIcon from '../../../assets/icons/InProgressIcon';

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
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
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

interface KanbanColumnsProps {
  stages: Stage[];
  ticketsByStage: Record<string, Ticket[]>;
  tagsByTicketId: Map<string, TicketTag[]>;
  onTicketClick: (ticket: Ticket) => void;
  keyPrefix?: string;
  availableTags?: string[];
  containerClassName?: string;
  visibleColumns?: Set<string> | undefined;
}

export const KanbanIcon = ({ stage }: { stage: Stage }) => {
  const stageId = stage.id.toLowerCase();
  const stageName = stage.name.toLowerCase();

  const statusOption = StatusOptions.find(opt => opt.label.toLowerCase() === stageName);
  if (statusOption) {
    return <>{statusOption.icon}</>;
  }

  if (['done', 'completed', 'resolved'].includes(stageId)) {
    return <StageCircleIcon size={14} />;
  }
  if (stageId === 'to_do' || stageName === 'to do') {
    return <CircleDashed className='w-4 h-4 text-orange-500' />;
  }
  if (stageId === 'in_progress' || stageName === 'in progress') {
    return <InProgressIcon className='w-4 h-4 text-blue-500' />;
  }

  return <Circle className='w-4 h-4' style={{ color: stage.color }} />;
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
        'flex gap-1 sm:gap-4 p-2 sm:p-3 h-full bg-white overflow-x-auto min-w-screen no-scrollbar',
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
                'flex flex-col rounded-lg transition-all duration-300 ease-in-out bg-[#FAFAFA] h-full',
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
                      <KanbanIcon stage={stage} />
                      <h3 className='text-xs font-medium truncate  uppercase'>{stage.name}</h3>
                      <span className='text-xs px-2 py-0.5 rounded-full'>
                        {stageTickets.length}
                      </span>
                    </div>

                    <div className='flex items-center gap-1'>
                      <Button
                        variant='ghost'
                        onClick={() => toggleCollapse(stage.id)}
                        className='!p-0 !bg-transparent'
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
                  >
                    <div className='flex flex-col items-center gap-2 w-full h-full'>
                      <KanbanIcon stage={stage} />
                      <h3
                        className={cn(
                          'text-sm font-medium whitespace-nowrap w-fit',
                          '[transform-origin:center] [writing-mode:vertical-rl] [text-orientation:mixed]',
                        )}
                      >
                        {stage.name}
                      </h3>
                      <span
                        className={cn(
                          'text-sm py-2 px-0.5 rounded-full',
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
                    >
                      <ExpandIcon />
                    </Button>
                  </div>
                )}
              </div>

              {!isCollapsed && (
                <SortableContext items={ticketIds} strategy={verticalListSortingStrategy}>
                  <div className='flex-1 min-h-0'>
                    <Virtuoso
                      increaseViewportBy={200}
                      minOverscanItemCount={20}
                      defaultItemHeight={118}
                      data={stageTickets}
                      itemContent={(index, ticket) => (
                        <div className={index === 0 ? 'pt-3 px-3 pb-1.5' : 'px-3 pb-1.5'}>
                          <SortableTicketCard
                            key={ticket.id}
                            ticket={ticket}
                            tags={tagsByTicketId.get(ticket.id) || []}
                            availableTags={availableTags}
                            onClick={() => onTicketClick(ticket)}
                            visibleColumns={visibleColumns}
                          />
                        </div>
                      )}
                      style={{ height: '100%' }}
                    />
                  </div>
                </SortableContext>
              )}
            </div>
          </DroppableStage>
        );
      })}
    </div>
  );
};
