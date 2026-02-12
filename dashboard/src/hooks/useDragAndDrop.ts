import { useCallback, useState } from 'react';
import { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { toast } from 'sonner';
import type { Ticket, TicketStatusV2 } from '@xyne/shared';
import { TicketStageRequestStatus } from '@xyne/shared';
import type { Zero } from '@rocicorp/zero';
import { mutators } from '../zero/mutators';
import type { Stage } from '../routes/KanbanBoardScreen/KanbanBoardScreen.types';
import { useAuth } from './useAuth';

interface UseDragAndDropProps {
  localTickets: Ticket[];
  setLocalTickets: React.Dispatch<React.SetStateAction<Ticket[]>>;
  zero: Zero;
  stages: Stage[];
  mode: 'stage' | 'status'; // 'stage' for board view, 'status' for project/all view
  onStageFormRequired?: (data: {
    ticket: Ticket;
    targetStage: Stage;
    formId: string;
    hasApprovers: boolean;
  }) => void;
  onBackwardStageChange?: (data: {
    ticket: Ticket;
    stageName: string;
    fromSequenceNumber: number;
    newStatus?: TicketStatusV2;
  }) => void;
  stageFormMap?: Map<string, string>; // Map of stageId -> formId
  stageFormSubmissions?: Array<{
    id: string;
    stageId: string;
    status: TicketStageRequestStatus;
    formId?: string | null;
  }>;
}

export const useDragAndDrop = ({
  localTickets,
  setLocalTickets,
  zero,
  stages,
  mode,
  onStageFormRequired,
  onBackwardStageChange,
  stageFormMap = new Map(),
  stageFormSubmissions = [],
}: UseDragAndDropProps): {
  activeTicket: Ticket | null;
  handleDragStart: (event: DragStartEvent) => void;
  handleDragEnd: (event: DragEndEvent) => void;
} => {
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const { user: currentUser } = useAuth();

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
        // Board view: Update stageName
        const newStageId = overTicket?.stageName || over.id;
        const targetStage = stages.find(s => s.id === newStageId || s.name === newStageId);

        const newStageName = targetStage?.name;
        const newStatus = targetStage?.defaultTicketStatusV2;

        // Handle moving to a different stage
        if (newStageName && activeTicket.stageName !== newStageName) {
          const currentStage = stages.find(s => s.name === activeTicket.stageName);

          if (currentStage && targetStage) {
            // Check if board has any stage with approvers
            const boardHasStagesWithApproval =
              stages.some(s => s.approvers && s.approvers.length > 0) ?? false;
            // Check if board has any stage with forms
            const boardHasStagesWithForms = stageFormMap.size > 0;
            // Enforce sequential movement if board has EITHER approvers OR forms
            const shouldEnforceSequentialMovement =
              boardHasStagesWithApproval || boardHasStagesWithForms;

            if (shouldEnforceSequentialMovement) {
              // Check if moving backward
              const isMovingBackward =
                targetStage.sequenceNumber !== undefined &&
                currentStage.sequenceNumber !== undefined &&
                targetStage.sequenceNumber < currentStage.sequenceNumber;

              if (isMovingBackward) {
                // Trigger callback to show confirmation dialog
                onBackwardStageChange?.({
                  ticket: activeTicket,
                  stageName: newStageName,
                  fromSequenceNumber: targetStage.sequenceNumber!,
                  ...(newStatus !== undefined && { newStatus }),
                });
                return;
              }

              // Forward movement - enforce sequential movement
              const isNextStage =
                currentStage.sequenceNumber !== undefined &&
                targetStage.sequenceNumber === currentStage.sequenceNumber + 1;

              if (!isNextStage) {
                // Block movement - only sequential forward movement allowed
                toast.warning('Can only move to next stage in this Board');
                return;
              }

              // Check if target stage requires approval (has approvers)
              const targetStageApprovers = targetStage.approvers;
              const targetStageFormId = stageFormMap.get(targetStage.id);
              const hasApprovers = targetStageApprovers && targetStageApprovers.length > 0;

              // CASE 1: Stage has approvers → requires approval (with or without form)
              if (hasApprovers) {
                const isApprover =
                  targetStageApprovers.some(a => a.userId === currentUser?.id) ?? false;

                if (!isApprover) {
                  // If form exists, open modal for form submission + approval
                  if (targetStageFormId) {
                    onStageFormRequired?.({
                      ticket: activeTicket,
                      targetStage,
                      formId: targetStageFormId,
                      hasApprovers: true,
                    });
                    return;
                  }

                  // No form, create approval request (to be approved from TicketDetails)
                  const rejectedApproval = stageFormSubmissions?.find(
                    s =>
                      s.stageId === targetStage.id &&
                      s.status === TicketStageRequestStatus.REJECTED &&
                      !s.formId,
                  );

                  if (rejectedApproval) {
                    // Update the rejected request to submitted
                    void zero.mutate(
                      mutators.ticketStageRequest.upsert({
                        id: rejectedApproval.id,
                        ticketId: activeTicket.id,
                        stageId: targetStage.id,
                        status: TicketStageRequestStatus.SUBMITTED,
                        updatedBy: currentUser?.id || '',
                        updatedAt: Date.now(),
                        requestActivityId: crypto.randomUUID(),
                      }),
                    );
                    toast.success('Stage change request resubmitted for approval');
                  } else {
                    // Create a new approval request
                    void zero.mutate(
                      mutators.ticketStageRequest.upsert({
                        id: crypto.randomUUID(),
                        ticketId: activeTicket.id,
                        stageId: targetStage.id,
                        status: TicketStageRequestStatus.SUBMITTED,
                        updatedBy: currentUser?.id || '',
                        updatedAt: Date.now(),
                        requestActivityId: crypto.randomUUID(),
                      }),
                    );
                    toast.success('Stage change request submitted for approval');
                  }
                  return;
                }
              }
              // CASE 2: Stage has NO approvers → no approval needed
              else {
                // If form exists, open modal for form submission only (no approval)
                if (targetStageFormId) {
                  onStageFormRequired?.({
                    ticket: activeTicket,
                    targetStage,
                    formId: targetStageFormId,
                    hasApprovers: false,
                  });
                  return;
                }
                // No form, directly update stage (no approval needed)
              }
            }
          }

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
    [
      localTickets,
      setLocalTickets,
      zero,
      stages,
      mode,
      onStageFormRequired,
      onBackwardStageChange,
      stageFormMap,
      stageFormSubmissions,
      currentUser,
    ],
  );

  return {
    activeTicket,
    handleDragStart,
    handleDragEnd,
  };
};
