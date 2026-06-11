import { useCallback, useState } from 'react';
import { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { toast } from 'sonner';
import type { Ticket, TicketStatusV2 } from '@xyne/shared';
import { TicketStageRequestStatus, type TicketStageRequest } from '@xyne/shared';
import type { Zero } from '@rocicorp/zero';
import { generateKeyBetween } from 'fractional-indexing';
import { mutators } from '../zero/mutators';
import { queries } from '../zero/queries';
import type { Stage } from '../routes/KanbanBoardScreen/KanbanBoardScreen.types';
import { sortByKanbanPosition } from '../routes/KanbanBoardScreen/KanbanBoardScreen.utils';
import { useAuth } from './useAuth';
import { v4 as uuidv4 } from 'uuid';

interface UseDragAndDropProps {
  localTickets: Ticket[];
  setLocalTickets: React.Dispatch<React.SetStateAction<Ticket[]>>;
  zero: Zero;
  stages: Stage[];
  mode: 'stage' | 'status'; // 'stage' for board view, 'status' for project/all view
  canReorder: boolean;
  onStageFormRequired?: (data: {
    ticket: Ticket;
    targetStage: Stage;
    formId: string;
    hasApprovers: boolean;
  }) => Promise<void>;
  onBackwardStageChange?: (data: {
    ticket: Ticket;
    stageName: string;
    fromSequenceNumber: number;
    newStatus?: TicketStatusV2;
  }) => void;
  stageFormMap?: Map<string, string>; // Map of stageId -> formId
}

export const useDragAndDrop = ({
  localTickets,
  setLocalTickets,
  zero,
  stages,
  mode,
  canReorder,
  onStageFormRequired,
  onBackwardStageChange,
  stageFormMap = new Map(),
}: UseDragAndDropProps): {
  activeTicket: Ticket | null;
  handleDragStart: (event: DragStartEvent) => void;
  handleDragEnd: (event: DragEndEvent) => Promise<void>;
  rejectedApprovalConfirm: {
    ticket: Ticket;
    targetStage: Stage;
    requestId: string;
  } | null;
  confirmRejectedApproval: () => void;
  cancelRejectedApproval: () => void;
} => {
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const [rejectedApprovalConfirm, setRejectedApprovalConfirm] = useState<{
    ticket: Ticket;
    targetStage: Stage;
    requestId: string;
  } | null>(null);
  const { user: currentUser } = useAuth();

  const getColumnTickets = useCallback(
    (columnKey: string): Ticket[] => {
      const tickets =
        mode === 'stage'
          ? localTickets.filter(t => {
              const stage = stages.find(s => s.id === columnKey || s.name === columnKey);
              return stage ? t.stageName?.toLowerCase() === stage.name.toLowerCase() : false;
            })
          : localTickets.filter(t => t.statusV2 === (columnKey as typeof t.statusV2));
      return sortByKanbanPosition(tickets);
    },
    [localTickets, stages, mode],
  );

  const computeNewPosition = useCallback(
    (columnKey: string, activeId: string, overTicketId: string | null): string => {
      try {
        const allSorted = getColumnTickets(columnKey);
        const sorted = allSorted.filter(t => t.id !== activeId);

        if (sorted.length === 0) {
          return generateKeyBetween(null, null);
        }

        if (!overTicketId) {
          return generateKeyBetween(null, sorted[0]?.kanbanPosition ?? null);
        }

        const overIndex = sorted.findIndex(t => t.id === overTicketId);
        if (overIndex === -1) {
          return generateKeyBetween(null, sorted[0]?.kanbanPosition ?? null);
        }

        const activeIndexInFull = allSorted.findIndex(t => t.id === activeId);
        const overIndexInFull = allSorted.findIndex(t => t.id === overTicketId);

        let after: string | null;
        let before: string | null;

        if (activeIndexInFull === -1 || activeIndexInFull < overIndexInFull) {
          after = sorted[overIndex]?.kanbanPosition ?? null;
          before =
            overIndex + 1 < sorted.length ? (sorted[overIndex + 1]?.kanbanPosition ?? null) : null;
        } else {
          before = sorted[overIndex]?.kanbanPosition ?? null;
          after = overIndex - 1 >= 0 ? (sorted[overIndex - 1]?.kanbanPosition ?? null) : null;
        }

        return generateKeyBetween(after, before);
      } catch {
        return generateKeyBetween(null, null);
      }
    },
    [getColumnTickets],
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent): void => {
      const draggedTicket =
        (event.active.data.current as { ticket?: Ticket } | undefined)?.ticket ??
        localTickets?.find((t): boolean => t.id === event.active.id) ??
        null;
      if (draggedTicket) {
        setActiveTicket(draggedTicket);
      }
    },
    [localTickets],
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent): Promise<void> => {
      const { active, over } = event;
      setActiveTicket(null);

      if (!over) return;

      const activeTicket =
        (active.data.current as { ticket?: Ticket } | undefined)?.ticket ??
        localTickets?.find((t): boolean => t.id === active.id);
      const overTicket =
        (over.data.current as { ticket?: Ticket } | undefined)?.ticket ??
        localTickets?.find((t): boolean => t.id === over.id);

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

              // Check target stage properties
              const targetStageApprovers = targetStage.approvers;
              const targetStageFormId = stageFormMap.get(targetStage.id);
              const hasApprovers = targetStageApprovers && targetStageApprovers.length > 0;
              const isApprover = hasApprovers
                ? (targetStageApprovers.some(a => a.userId === currentUser?.id) ?? false)
                : false;

              const ticketRequests = await zero.run(
                queries.getTicketStageRequests({ ticketId: activeTicket.id }),
                { type: 'complete' },
              );
              const existingRequest = ticketRequests?.find(
                (r: TicketStageRequest) => r.stageId === targetStage.id,
              );
              const isRejectedRequest =
                existingRequest?.status === TicketStageRequestStatus.REJECTED;

              // If stage has a form, open modal for everyone
              if (targetStageFormId) {
                void onStageFormRequired?.({
                  ticket: activeTicket,
                  targetStage,
                  formId: targetStageFormId,
                  hasApprovers: hasApprovers ?? false,
                });
                return;
              }

              // No form - handle approval workflow
              if (hasApprovers) {
                // Stage has approvers - handle approval
                if (isApprover) {
                  // Approver: approve the request
                  if (isRejectedRequest && existingRequest) {
                    // Show confirmation dialog for rejected request
                    setRejectedApprovalConfirm({
                      ticket: activeTicket,
                      targetStage,
                      requestId: existingRequest.id,
                    });
                    return;
                  } else if (!existingRequest) {
                    void zero.mutate(
                      mutators.ticketStageRequest.upsert({
                        id: uuidv4(),
                        ticketId: activeTicket.id,
                        stageId: targetStage.id,
                        status: TicketStageRequestStatus.APPROVED,
                        updatedBy: currentUser?.id || '',
                        reviewedBy: currentUser?.id || '',
                        updatedAt: Date.now(),
                        approvedActivityId: uuidv4(),
                      }),
                    );
                    toast.success('Request approved');
                  }
                } else {
                  // Non-approver: submit for approval
                  void zero.mutate(
                    mutators.ticketStageRequest.upsert({
                      id: existingRequest ? existingRequest.id : uuidv4(),
                      ticketId: activeTicket.id,
                      stageId: targetStage.id,
                      status: TicketStageRequestStatus.SUBMITTED,
                      updatedBy: currentUser?.id || '',
                      updatedAt: Date.now(),
                      requestActivityId: uuidv4(),
                    }),
                  );
                  toast.success(
                    existingRequest
                      ? 'Stage change request resubmitted for approval'
                      : 'Stage change request submitted for approval',
                  );
                }
                return;
              }
            }
          }

          // Compute kanban position in target column if reordering is enabled
          const kanbanPosition =
            canReorder && targetStage
              ? computeNewPosition(targetStage.id, activeTicket.id, overTicket?.id ?? null)
              : undefined;

          setLocalTickets(prev =>
            prev.map(t =>
              t.id === activeTicket.id
                ? {
                    ...t,
                    stageName: newStageName,
                    ...(newStatus && { statusV2: newStatus }),
                    ...(kanbanPosition !== undefined && { kanbanPosition }),
                  }
                : t,
            ),
          );

          void zero.mutate(
            mutators.ticket.update({
              id: activeTicket.id,
              stageName: newStageName,
              ...(newStatus && { statusV2: newStatus }),
              ...(kanbanPosition !== undefined && { kanbanPosition }),
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
          if (canReorder) {
            const newPosition = computeNewPosition(
              activeTicket.stageName,
              activeTicket.id,
              overTicket.id,
            );

            setLocalTickets(prev =>
              prev.map(t => (t.id === activeTicket.id ? { ...t, kanbanPosition: newPosition } : t)),
            );

            void zero.mutate(
              mutators.ticket.update({
                id: activeTicket.id,
                kanbanPosition: newPosition,
                updatedAt: Date.now(),
              }),
            );
          } else {
            toast.info('Reordering is only available when viewing a single board');
          }
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
          toast.info('Reordering is only available when viewing a single board');
        }
      }
    },
    [
      localTickets,
      setLocalTickets,
      zero,
      stages,
      mode,
      canReorder,
      computeNewPosition,
      onStageFormRequired,
      onBackwardStageChange,
      stageFormMap,
      currentUser,
    ],
  );

  // Handler to confirm and approve a rejected request
  const confirmRejectedApproval = useCallback(() => {
    if (!rejectedApprovalConfirm) return;

    const { ticket, targetStage, requestId } = rejectedApprovalConfirm;
    const timestamp = Date.now();

    void zero.mutate(
      mutators.ticketStageRequest.upsert({
        id: requestId,
        ticketId: ticket.id,
        stageId: targetStage.id,
        status: TicketStageRequestStatus.APPROVED,
        updatedBy: currentUser?.id || '',
        reviewedBy: currentUser?.id || '',
        updatedAt: timestamp,
        approvedActivityId: uuidv4(),
      }),
    );

    // Also update ticket stage
    void zero.mutate(
      mutators.ticket.update({
        id: ticket.id,
        stageName: targetStage.name,
        ...(targetStage.defaultTicketStatusV2 && { statusV2: targetStage.defaultTicketStatusV2 }),
        updatedAt: timestamp,
      }),
    );

    toast.success('Request approved');
    setRejectedApprovalConfirm(null);
  }, [rejectedApprovalConfirm, zero, currentUser]);

  // Cancel rejected approval confirmation
  const cancelRejectedApproval = useCallback(() => {
    setRejectedApprovalConfirm(null);
  }, []);

  return {
    activeTicket,
    handleDragStart,
    handleDragEnd,
    rejectedApprovalConfirm,
    confirmRejectedApproval,
    cancelRejectedApproval,
  };
};
