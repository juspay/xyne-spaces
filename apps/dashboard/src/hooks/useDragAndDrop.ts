import { useCallback, useRef, useState } from 'react';
import { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { toast } from 'sonner';
import type { Ticket, TicketStatusV2 } from '@xyne/shared';
import { TicketStageRequestStatus, type TicketStageRequest, ApproverType } from '@xyne/shared';
import type { Zero } from '@rocicorp/zero';
import { generateKeyBetween } from 'fractional-indexing';
import { mutators } from '../zero/mutators';
import { queries } from '../zero/queries';
import type { Stage } from '../routes/KanbanBoardScreen/KanbanBoardScreen.types';
import { sortByKanbanPosition } from '../routes/KanbanBoardScreen/KanbanBoardScreen.utils';
import { useAuth } from './useAuth';
import { useCurrentUserRoleIds } from './useRoles';
import { v4 as uuidv4 } from 'uuid';
import { findMatchingTransition } from '../utils/stageTransitionUtils';

export interface StageTransitionInfo {
  id: string;
  fromStageId?: string | null;
  toStageId: string;
  formId?: string | null;
  requiresApproval: boolean;
  approvers?: Array<{ approverId: string; approverType: ApproverType }>;
}

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
  isNonLinearBoard?: boolean;
  transitions?: StageTransitionInfo[];
  /** Keep sortable ordering but prevent moving a ticket to another stage/status column. */
  allowCrossColumnMove?: boolean;
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
  isNonLinearBoard = false,
  transitions,
  allowCrossColumnMove = true,
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
  const currentUserRoleIds = useCurrentUserRoleIds();

  // Always-current ref so the async .server.then() handler sees up-to-date transitions.
  const transitionsRef = useRef(transitions ?? []);
  transitionsRef.current = transitions ?? [];

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
          if (!allowCrossColumnMove) {
            toast.info('Ticket stages are updated by the SDLC workflow');
            return;
          }
          const currentStage = stages.find(s => s.name === activeTicket.stageName);

          if (currentStage && targetStage) {
            if (transitions) {
              const hasTransitions = transitions.length > 0;

              if (hasTransitions) {
                const matchingTransition = findMatchingTransition(
                  transitions,
                  currentStage.id,
                  targetStage.id,
                );

                // NON_LINEAR is edge-gated: a move must match an edge. A terminal stage (no
                // outgoing edges) matches none and is blocked. Linear boards fall through.
                if (isNonLinearBoard && !matchingTransition) {
                  toast.error('This stage transition is not allowed');
                  return;
                }

                if (matchingTransition) {
                  // NON_LINEAR: use edge formId only (not stageFormMap) to avoid a form firing
                  // on every move into a stage. Linear boards also consult stageFormMap.
                  const formId: string | null = isNonLinearBoard
                    ? (matchingTransition.formId ?? null)
                    : (matchingTransition.formId ?? stageFormMap?.get(targetStage.id) ?? null);

                  if (formId) {
                    void onStageFormRequired?.({
                      ticket: activeTicket,
                      targetStage,
                      formId,
                      hasApprovers: matchingTransition.requiresApproval,
                    });
                    return;
                  }

                  if (matchingTransition.requiresApproval) {
                    const isApprover =
                      matchingTransition.approvers?.some(a => {
                        if (a.approverType === ApproverType.ROLE) {
                          return currentUserRoleIds.includes(a.approverId);
                        }
                        return a.approverId === (currentUser?.id ?? '');
                      }) ?? false;

                    if (!isApprover) {
                      // Reuse the existing record's ID for revisits (unique constraint on ticketId+stageId)
                      const existingForTarget = (
                        activeTicket as Ticket & {
                          ticketStageRequests?: TicketStageRequest[];
                        }
                      ).ticketStageRequests?.find(
                        (r: TicketStageRequest) => r.stageId === targetStage.id,
                      );
                      void zero.mutate(
                        mutators.ticketStageRequest.upsert({
                          id: existingForTarget?.id ?? uuidv4(),
                          ticketId: activeTicket.id,
                          stageId: targetStage.id,
                          status: TicketStageRequestStatus.SUBMITTED,
                          updatedBy: currentUser?.id || '',
                          updatedAt: Date.now(),
                          requestActivityId: uuidv4(),
                        }),
                      );
                      toast.success('Stage change request submitted for approval');
                      return;
                    }
                    // Approver falls through to nonLinear.transition (self-approval)
                  }

                  // Valid transition (form/approval handled above) — fall through to the move.
                }
                // Linear board with no matching edge: fall through to the legacy gate below.
              }
            }

            // Legacy sequential enforcement + stage-level form/approval gates
            // Used for linear boards without explicitly defined transitions.
            if (!isNonLinearBoard && (!transitions || transitions.length === 0)) {
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
                  ? (targetStageApprovers.some(a => {
                      const type = (a.approverType ?? 'USER') as 'USER' | 'ROLE';
                      if (type === 'ROLE') {
                        return !!a.roleId && currentUserRoleIds.includes(a.roleId);
                      }
                      return a.userId === currentUser?.id;
                    }) ?? false)
                  : false;

                const ticketRequests = await zero.run(
                  queries.getTicketStageRequests({ ticketId: activeTicket.id }),
                  { type: 'complete' },
                );
                // Find active (non-APPROVED) request for status-checking purposes (rejected flow etc.)
                const existingRequest = ticketRequests?.find(
                  (r: TicketStageRequest) =>
                    r.stageId === targetStage.id && r.status !== TicketStageRequestStatus.APPROVED,
                );
                // Also find ANY request including APPROVED — needed for ID reuse on revisits.
                // ticket_stage_requests has @@unique([ticketId, stageId]): inserting a new UUID
                // for the same stage fails; reusing the existing ID converts INSERT to UPDATE.
                const existingForStageId = ticketRequests?.find(
                  (r: TicketStageRequest) => r.stageId === targetStage.id,
                )?.id;
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
                          id: existingForStageId ?? uuidv4(),
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
                        id: existingRequest?.id ?? existingForStageId ?? uuidv4(),
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
          }

          // Compute kanban position in target column if reordering is enabled
          const kanbanPosition =
            canReorder && targetStage
              ? computeNewPosition(targetStage.id, activeTicket.id, overTicket?.id ?? null)
              : undefined;

          // Capture the pre-move state so the optimistic update can be rolled back if the server
          // rejects the transition. Zero rolls back its OWN cache automatically, but this separate
          // React `localTickets` state is not tied to Zero — without an explicit revert the ticket
          // stays in the wrong column / vanishes (the re-sync effect compares only ticket IDs, not
          // stageName, so it won't correct a same-ID stage mismatch) until the next unrelated action.
          const preMoveStageName = activeTicket.stageName;
          const preMoveStatusV2 = activeTicket.statusV2;
          const preMoveKanbanPosition = activeTicket.kanbanPosition;
          const revertOptimisticMove = (): void => {
            setLocalTickets(prev =>
              prev.map(t =>
                t.id === activeTicket.id
                  ? {
                      ...t,
                      stageName: preMoveStageName,
                      statusV2: preMoveStatusV2,
                      kanbanPosition: preMoveKanbanPosition,
                    }
                  : t,
              ),
            );
          };

          setLocalTickets(prev =>
            prev.map(t =>
              t.id === activeTicket.id
                ? {
                    ...t,
                    stageName: newStageName,
                    ...(newStatus && { statusV2: newStatus }),
                    ...(kanbanPosition !== undefined && { kanbanPosition }),
                    updatedAt: Date.now(),
                  }
                : t,
            ),
          );

          if (isNonLinearBoard) {
            // NON_LINEAR boards: use the nonLinear.transition Zero mutator.
            // The frontend form/approval gates run before reaching this point, so
            // at this call site the transition is pre-validated (no form required, or
            // approver self-approving). The mutator handles ETA + visitIndex server-side.
            const transitionResult = zero.mutate(
              mutators.nonLinear.transition({
                ticketId: activeTicket.id,
                toStageName: newStageName,
                now: Date.now(),
              }),
            );
            // MutatorResult is { client: Promise, server: Promise }, not a Promise itself.
            // Watch .server to catch application errors (e.g. "not allowed", "form required").
            // Capture these for the async callback (closure over current loop iteration).
            const capturedTicket = activeTicket;
            const capturedTargetStage = targetStage;
            const handleFormRequiredRecovery = async (errorMessage: string): Promise<void> => {
              if (
                errorMessage !== 'This transition requires a form to be submitted' ||
                !onStageFormRequired ||
                !capturedTargetStage
              ) {
                // Server rejected the move (e.g. "stage transition is not allowed") — roll the
                // optimistic move back so the ticket returns to its source column.
                revertOptimisticMove();
                toast.error(errorMessage);
                return;
              }

              const latestTransitions = transitionsRef.current;
              const currentStageObj = stages.find(s => s.name === capturedTicket.stageName);
              const mt =
                latestTransitions.length > 0 && currentStageObj
                  ? findMatchingTransition(
                      latestTransitions,
                      currentStageObj.id,
                      capturedTargetStage.id,
                    )
                  : undefined;
              // Use formId from the matched transition only — latestFormMap is ambiguous when
              // multiple transitions go to the same stage with different formIds.
              let recoveredFormId: string | null = mt?.formId ?? null;
              let recoveredMt = mt;

              // Cache miss: force-fetch from Zero server with type:'complete' to get latest formId.
              // No try/catch: Zero queries resolve through the cache and don't throw here.
              if (!recoveredFormId && capturedTicket.boardId) {
                const freshTransitions = await zero.run(
                  queries.getStageTransitionsByBoardId({ boardId: capturedTicket.boardId }),
                  { type: 'complete' },
                );
                if (freshTransitions) {
                  const currentStageId = currentStageObj?.id;
                  const freshMt = freshTransitions.find(
                    t => t.fromStageId === currentStageId && t.toStageId === capturedTargetStage.id,
                  );
                  recoveredFormId = freshMt?.formId || null;
                  recoveredMt = freshMt
                    ? {
                        id: freshMt.id,
                        fromStageId: freshMt.fromStageId ?? null,
                        toStageId: freshMt.toStageId,
                        formId: freshMt.formId ?? null,
                        requiresApproval: freshMt.requiresApproval ?? false,
                      }
                    : undefined;
                }
              }

              if (recoveredFormId) {
                // Form gate: keep the optimistic move — the form modal will confirm (on submit)
                // or it will be rolled back by the regular re-sync if abandoned.
                void onStageFormRequired({
                  ticket: capturedTicket,
                  targetStage: capturedTargetStage,
                  formId: recoveredFormId,
                  hasApprovers: recoveredMt?.requiresApproval ?? false,
                });
              } else {
                // Couldn't resolve a form to satisfy the gate — roll back the optimistic move.
                revertOptimisticMove();
                toast.error(errorMessage);
              }
            };

            // Zero RESOLVES .server (never rejects) for ApplicationErrors:
            // { type: "error", error: { type: "app", message: "...", details?: {...} } }
            // See mutator-proxy.js #makeApplicationErrorResultDetails.
            const serverPromise = (
              transitionResult as {
                server: Promise<
                  | { type: string; error?: { message?: string; details?: { formId?: string } } }
                  | undefined
                >;
              }
            ).server;
            void serverPromise
              .then(async result => {
                if (result?.type === 'error' && result.error?.message) {
                  // Fast path: server included formId in error details — open form directly.
                  const directFormId = result.error.details?.formId;
                  if (
                    directFormId &&
                    result.error.message === 'This transition requires a form to be submitted' &&
                    onStageFormRequired &&
                    capturedTargetStage
                  ) {
                    const currentStageId2 = stages.find(
                      s => s.name === capturedTicket.stageName,
                    )?.id;
                    const fastPathMt =
                      transitionsRef.current.length > 0 && currentStageId2
                        ? findMatchingTransition(
                            transitionsRef.current,
                            currentStageId2,
                            capturedTargetStage.id,
                          )
                        : undefined;
                    void onStageFormRequired({
                      ticket: capturedTicket,
                      targetStage: capturedTargetStage,
                      formId: directFormId,
                      hasApprovers: fastPathMt?.requiresApproval ?? false,
                    });
                    return;
                  }
                  await handleFormRequiredRecovery(result.error.message);
                }
              })
              .catch(async (err: unknown) => {
                // Catch unexpected rejections (network errors, etc.)
                const msg =
                  err instanceof Error
                    ? err.message
                    : ((err as { message?: string })?.message ?? String(err));
                await handleFormRequiredRecovery(msg);
              });
            if (kanbanPosition !== undefined || newStatus) {
              void zero.mutate(
                mutators.ticket.update({
                  id: activeTicket.id,
                  ...(newStatus && { statusV2: newStatus }),
                  ...(kanbanPosition !== undefined && { kanbanPosition }),
                  updatedAt: Date.now(),
                }),
              );
            }
          } else {
            // DEFAULT/RELEASE boards: use Zero mutation for optimistic, instant updates.
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
              prev.map(t =>
                t.id === activeTicket.id
                  ? { ...t, kanbanPosition: newPosition, updatedAt: Date.now() }
                  : t,
              ),
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
          if (!allowCrossColumnMove) {
            toast.info('Ticket stages are updated by the SDLC workflow');
            return;
          }
          // Update local state immediately for smooth UI
          setLocalTickets(prev =>
            prev.map(t =>
              t.id === activeTicket.id ? { ...t, statusV2: newStatus, updatedAt: Date.now() } : t,
            ),
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
      currentUserRoleIds,
      isNonLinearBoard,
      transitions,
      allowCrossColumnMove,
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
