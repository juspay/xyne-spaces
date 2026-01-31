import { useCallback, useState } from 'react';
import { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import type { Ticket, TicketStatusV2 } from '@xyne/shared';
import type { Zero } from '@rocicorp/zero';
import { mutators } from '../zero/mutators';
import type { Stage } from '../routes/KanbanBoardScreen/KanbanBoardScreen.types';

interface UseDragAndDropProps {
  localTickets: Ticket[];
  setLocalTickets: React.Dispatch<React.SetStateAction<Ticket[]>>;
  zero: Zero;
  stages: Stage[];
  mode: 'stage' | 'status'; // 'stage' for board view, 'status' for project/all view
  stagesByBoardMap?: Map<string, Stage[]>; // For board-wise view
}

export const useDragAndDrop = ({
  localTickets,
  setLocalTickets,
  zero,
  stages,
  mode,
  stagesByBoardMap,
}: UseDragAndDropProps): {
  activeTicket: Ticket | null;
  handleDragStart: (event: DragStartEvent) => void;
  handleDragEnd: (event: DragEndEvent) => void;
} => {
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);

  const handleDragStart = useCallback(
    (event: DragStartEvent): void => {
      const ticket = localTickets?.find((t): boolean => t.id === event.active.id);
      if (ticket) {
        setActiveTicket(ticket);
      }
    },
    [localTickets],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent): void => {
      const { active, over } = event;
      setActiveTicket(null);

      if (!over) return;

      const activeTicket = localTickets?.find((t): boolean => t.id === active.id);
      const overTicket = localTickets?.find((t): boolean => t.id === over.id);

      if (!activeTicket) return;

      if (mode === 'stage') {
        // Board view or board-wise view: Update stageName
        const newStageId = overTicket?.stageName || over.id;

        // Find target stage in the appropriate stage list
        let targetStage: Stage | undefined;
        if (stagesByBoardMap) {
          // For board-wise view, search across all boards
          const allBoardStages = Array.from(stagesByBoardMap.values()).flat();
          targetStage = allBoardStages.find(s => s.id === newStageId || s.name === newStageId);
        } else {
          // For single board view
          targetStage = stages.find(s => s.id === newStageId || s.name === newStageId);
        }

        const newStageName = targetStage?.name;
        const newStatus = targetStage?.defaultTicketStatusV2;

        // Handle moving to a different stage
        if (newStageName && activeTicket.stageName !== newStageName) {
          // Update local state immediately for smooth UI
          setLocalTickets(prev =>
            prev.map(t =>
              t.id === activeTicket.id
                ? { ...t, stageName: newStageName, ...(newStatus && { statusV2: newStatus }) }
                : t,
            ),
          );

          // Update database
          void zero.mutate(
            mutators.ticket.update({
              id: activeTicket.id,
              stageName: newStageName,
              ...(newStatus && { statusV2: newStatus }),
              updatedAt: Date.now(),
            }),
          );
        }
        // Handle reordering within the same stage
        else if (
          active.id !== over.id &&
          overTicket &&
          activeTicket.stageName === overTicket.stageName
        ) {
          setLocalTickets(prev => {
            const activeIndex = prev.findIndex(t => t.id === active.id);
            const overIndex = prev.findIndex(t => t.id === over.id);
            return arrayMove(prev, activeIndex, overIndex);
          });
        }
      } else {
        // Project/All view: Update status
        const newStatusId =
          typeof over.id === 'string' ? over.id : (overTicket?.statusV2 ?? String(over.id));
        const targetStatus = stages.find(s => s.id === newStatusId);
        const newStatus = targetStatus?.id as TicketStatusV2 | undefined;

        // Handle moving to a different status
        if (newStatus && activeTicket.statusV2 !== newStatus) {
          // Update local state immediately for smooth UI
          setLocalTickets(prev =>
            prev.map(t => (t.id === activeTicket.id ? { ...t, statusV2: newStatus } : t)),
          );

          // Update database
          void zero.mutate(
            mutators.ticket.update({
              id: activeTicket.id,
              statusV2: newStatus,
              updatedAt: Date.now(),
            }),
          );
        }
        // Handle reordering within the same status
        else if (
          active.id !== over.id &&
          overTicket &&
          activeTicket.statusV2 === overTicket.statusV2
        ) {
          setLocalTickets(prev => {
            const activeIndex = prev.findIndex(t => t.id === active.id);
            const overIndex = prev.findIndex(t => t.id === over.id);
            return arrayMove(prev, activeIndex, overIndex);
          });
        }
      }
    },
    [localTickets, setLocalTickets, zero, stages, mode, stagesByBoardMap],
  );

  return {
    activeTicket,
    handleDragStart,
    handleDragEnd,
  };
};
