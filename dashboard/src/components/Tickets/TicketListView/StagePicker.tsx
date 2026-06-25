import { ReactElement, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { Popover } from '../../ui/Popover/Popover';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { getStageColor } from '../../../routes/KanbanBoardScreen/KanbanBoardScreen.utils';
import { cn } from '../../../utils/classNames';
import { useAuth } from '../../../hooks/useAuth';
import { TicketStageRequestStatus, BoardType, ApproverType, FormContextType } from '@xyne/shared';
import type { Ticket, TicketStageRequest } from '@xyne/shared';
import {
  getReachableStageIds,
  findMatchingTransition,
  isCurrentStageRestricted,
} from '../../../utils/stageTransitionUtils';
import { StageFormModal } from '../StageFormModal/StageFormModal';
import type { Stage } from '../../../routes/KanbanBoardScreen/KanbanBoardScreen.types';

interface StagePickerProps {
  ticketId: string;
  stageName: string | null | undefined;
  stageLabel: string;
  boardId?: string | null;
  /** When provided, called instead of directly mutating zero — allows the parent to intercept and show a form. */
  onStageChange?: (
    ticketId: string,
    newStageName: string,
    currentStageName: string | null | undefined,
  ) => void;
}

const SUPPORT_STAGES: ReadonlyArray<string> = ['Backlog', 'To Do', 'In Progress', 'Review', 'Done'];

export function StagePicker({
  ticketId,
  stageName,
  stageLabel,
  boardId,
  onStageChange,
}: StagePickerProps): ReactElement {
  const [open, setOpen] = useState(false);
  const zero = useZero();
  const { user: currentUser } = useAuth();

  const currentStage = stageName ?? '';

  const [formModal, setFormModal] = useState<{
    targetStage: Stage;
    formId: string;
    hasApprovers: boolean;
  } | null>(null);

  // Lazy-fetch the full ticket (only non-linear form modals need it) so a list doesn't fetch every row.
  const [ticketData] = useCachedQuery(queries.ticketByIdV2({ ticketId }), {
    enabled: !!boardId && (open || formModal !== null),
  });

  const openFormModal = (targetStage: Stage, formId: string, hasApprovers: boolean): void => {
    setFormModal({ targetStage, formId, hasApprovers });
  };

  // Query stages for this board.
  // Not gated by `open` so the data is always ready when the user clicks.
  const [stages] = useCachedQuery(queries.stagesByBoard({ boardId: boardId ?? '' }), {
    enabled: !!boardId,
  });

  // Query board details to determine boardType (linear vs non-linear).
  // Not gated by `open` to avoid a null boardData on the first render after opening,
  // which would incorrectly set isNonLinear=false and bypass the form gate.
  const [boardData] = useCachedQuery(queries.boardDetailById({ boardId: boardId ?? '' }), {
    enabled: !!boardId,
  });

  const isNonLinear = boardData?.boardType === BoardType.NON_LINEAR;

  // Transitions (with approvers) are fetched via the dedicated query, not embedded in boardDetailById.
  const [boardStageTransitions] = useCachedQuery(
    queries.getStageTransitionsByBoardId({ boardId: boardId ?? '' }),
    {
      enabled: !!boardId && isNonLinear,
    },
  );

  // Only NON_LINEAR boards use transition-based gating; linear boards keep the legacy path.
  const stageTransitions = useMemo(() => {
    if (!isNonLinear || !boardStageTransitions) return [];
    return boardStageTransitions;
  }, [isNonLinear, boardStageTransitions]);

  const hasTransitions = stageTransitions.length > 0;

  // Maps toStageId → formId, aggregating both stage-level formContextMappings and
  // transition-level formIds. Used to detect form requirements for unrestricted source stages.
  const stageFormMap = useMemo(() => {
    const map = new Map<string, string>();
    if (stages) {
      stages.forEach(stage => {
        if (stage.formContextMappings && stage.formContextMappings.length > 0) {
          stage.formContextMappings
            .filter(mapping => mapping.contextType === FormContextType.STAGE)
            .forEach(mapping => {
              map.set(mapping.contextId, mapping.formId);
            });
        }
      });
    }
    stageTransitions.forEach(t => {
      if (t.formId) {
        map.set(t.toStageId, t.formId);
      }
    });
    return map;
  }, [stages, stageTransitions]);

  // Show only reachable stages for NON_LINEAR boards.
  // A stage is restricted only when it has outgoing transitions.
  // Stages with no outgoing transitions remain unrestricted.
  const reachableStages = useMemo(() => {
    const availableStages: ReadonlyArray<string> = boardId
      ? (stages?.map(s => s.name) ?? [])
      : SUPPORT_STAGES;
    if (!isNonLinear || !stages || stageTransitions.length === 0) return availableStages;
    const currentStageObj = stages.find(s => s.name === currentStage);
    if (!currentStageObj) return availableStages;
    const reachableIds = getReachableStageIds(stageTransitions, currentStageObj.id);
    if (!reachableIds) return availableStages;
    return availableStages.filter(name => {
      const obj = stages.find(s => s.name === name);
      return obj && reachableIds.has(obj.id);
    });
  }, [boardId, stageTransitions, stages, currentStage, isNonLinear]);

  // Always-current refs for the async .server.then() recovery handler.
  const stageTransitionsRef = useRef(stageTransitions);
  stageTransitionsRef.current = stageTransitions;
  const stagesRef = useRef(stages);
  stagesRef.current = stages;

  const setStage = (next: string): void => {
    if (next === currentStage) {
      setOpen(false);
      return;
    }

    // No board context — fallback
    if (!boardId || !boardData) {
      if (onStageChange) {
        onStageChange(ticketId, next, stageName);
      } else {
        void zero.mutate(
          mutators.ticket.update({ id: ticketId, stageName: next, updatedAt: Date.now() }),
        );
      }
      setOpen(false);
      return;
    }

    const currentStageObj = stages?.find(s => s.name === currentStage);
    const targetStageObj = stages?.find(s => s.name === next);

    if (hasTransitions && currentStageObj) {
      const restricted = isCurrentStageRestricted(stageTransitions, currentStageObj.id);

      if (restricted) {
        if (!targetStageObj) {
          toast.error('Stage not found');
          setOpen(false);
          return;
        }

        const matchingTransition = findMatchingTransition(
          stageTransitions,
          currentStageObj.id,
          targetStageObj.id,
        );

        if (!matchingTransition) {
          if (isNonLinear) {
            toast.error('This stage transition is not allowed');
            setOpen(false);
            return;
          }
          // Linear board without explicit transition — fall through to direct move
        } else {
          // NON_LINEAR: use edge formId only (not stageFormMap) to avoid form on every move.
          const transitionFormId: string | null = isNonLinear
            ? (matchingTransition.formId ?? null)
            : (matchingTransition.formId ?? stageFormMap.get(targetStageObj.id) ?? null);

          if (transitionFormId) {
            if (onStageChange) {
              onStageChange(ticketId, next, stageName);
            } else {
              // Edge-specific: only the matched edge's approvers count.
              const hasApproversForTarget =
                (matchingTransition.transitionApprovers?.length ?? 0) > 0;
              openFormModal(
                {
                  id: targetStageObj.id,
                  name: next,
                  color: getStageColor(next),
                  sequenceNumber: targetStageObj.sequenceNumber ?? undefined,
                },
                transitionFormId,
                hasApproversForTarget,
              );
            }
            setOpen(false);
            return;
          }

          // Approval gate
          if (matchingTransition.requiresApproval) {
            const approvers = matchingTransition.transitionApprovers ?? [];
            const isApprover = approvers.some(
              a =>
                (a.approverType ?? ApproverType.USER) === ApproverType.USER &&
                a.userId === currentUser?.id,
            );

            if (!isApprover) {
              // Reuse the existing record's ID for revisits (unique constraint on ticketId+stageId)
              const existingForTargetStage = (
                ticketData?.ticketStageRequests as TicketStageRequest[] | undefined
              )?.find((r: TicketStageRequest) => r.stageId === targetStageObj.id);
              void zero.mutate(
                mutators.ticketStageRequest.upsert({
                  id: existingForTargetStage?.id ?? uuidv4(),
                  ticketId,
                  stageId: targetStageObj.id,
                  status: TicketStageRequestStatus.SUBMITTED,
                  updatedBy: currentUser?.id || '',
                  updatedAt: Date.now(),
                  requestActivityId: uuidv4(),
                }),
              );
              toast.success('Stage change request submitted for approval');
              setOpen(false);
              return;
            }
            // Approver falls through to direct move (self-approval via nonLinear.transition)
          }
        }
      }
      // Unrestricted source / no matching edge on a NON_LINEAR board: forms are edge-specific,
      // so with no matching transition there is no form gate — fall through to the move.
      // (Previously this opened a form via stageFormMap keyed by target stage, which fired the
      // form on every move into the stage.)
    }

    // Execute move
    if (onStageChange) {
      onStageChange(ticketId, next, stageName);
    } else if (isNonLinear) {
      // Fire mutation; if Zero cache missed the formId, open form from server error details.
      const capturedTargetStageObj = targetStageObj;
      const capturedCurrentStageObj = currentStageObj;
      const transResult = zero.mutate(
        mutators.nonLinear.transition({ ticketId, toStageName: next, now: Date.now() }),
      );
      void (
        transResult as {
          server: Promise<
            | {
                type: string;
                error?: { type: string; message: string; details?: { formId?: string } };
              }
            | undefined
          >;
        }
      ).server.then(async serverResult => {
        if (
          serverResult?.type === 'error' &&
          serverResult.error?.message === 'This transition requires a form to be submitted'
        ) {
          const stageShape = capturedTargetStageObj
            ? {
                id: capturedTargetStageObj.id,
                name: next,
                color: getStageColor(next),
                sequenceNumber: capturedTargetStageObj.sequenceNumber ?? undefined,
              }
            : null;

          // 2. Try latest transitions from ref (Zero may have synced by now).
          // Use capturedCurrentStageObj (captured at click time) — stagesRef may be null
          // after setOpen(false) disables the query.
          const latestTransitions = stageTransitionsRef.current;
          const latestMt =
            latestTransitions.length > 0 && capturedTargetStageObj
              ? latestTransitions.find(
                  t =>
                    t.fromStageId === capturedCurrentStageObj?.id &&
                    t.toStageId === capturedTargetStageObj.id,
                )
              : undefined;

          // 1. Try server error details (fastest path).
          const directFormId = serverResult.error.details?.formId;
          if (directFormId && stageShape) {
            openFormModal(
              stageShape,
              directFormId,
              (latestMt?.transitionApprovers?.length ?? 0) > 0,
            );
            return;
          }

          const refFormId = latestMt?.formId ?? null;
          if (refFormId && stageShape) {
            openFormModal(stageShape, refFormId, (latestMt?.transitionApprovers?.length ?? 0) > 0);
            return;
          }

          // 3. Force-fetch from Zero server as final fallback.
          // No try/catch: Zero queries resolve through the cache and don't throw here.
          if (boardId && stageShape) {
            const freshTransitions = await zero.run(
              queries.getStageTransitionsByBoardId({ boardId }),
              { type: 'complete' },
            );
            if (freshTransitions && capturedTargetStageObj) {
              const freshMt = freshTransitions.find(
                t =>
                  t.fromStageId === capturedCurrentStageObj?.id &&
                  t.toStageId === capturedTargetStageObj.id,
              );
              const freshFormId = freshMt?.formId ?? null;
              if (freshFormId) {
                openFormModal(
                  stageShape,
                  freshFormId,
                  (freshMt?.transitionApprovers?.length ?? 0) > 0,
                );
              }
            }
          }
        }
      });
    } else {
      void zero.mutate(
        mutators.ticket.update({ id: ticketId, stageName: next, updatedAt: Date.now() }),
      );
    }
    setOpen(false);
  };

  const dotColor = getStageColor(currentStage);

  const trigger = (
    <button
      type='button'
      onClick={e => {
        e.stopPropagation();
        setOpen(prev => !prev);
      }}
      onKeyDown={e => e.stopPropagation()}
      className='inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted transition-colors whitespace-nowrap'
      aria-label='Change stage'
      data-track-category='Tickets'
      data-track-name='ToggleRowStage'
    >
      <span
        className='inline-block w-1.5 h-1.5 rounded-full'
        style={{ backgroundColor: dotColor }}
      />
      <span>{stageLabel}</span>
      <ChevronDown className='w-3 h-3 opacity-60' />
    </button>
  );

  return (
    <>
      <Popover
        trigger={trigger}
        open={open}
        onOpenChange={setOpen}
        modal
        align='end'
        sideOffset={4}
        className='p-1 w-44'
      >
        <div className='flex flex-col'>
          {reachableStages.map(stage => (
            <button
              key={stage}
              type='button'
              onClick={e => {
                e.stopPropagation();
                setStage(stage);
              }}
              className={cn(
                'w-full text-left px-2 py-1.5 text-xs hover:bg-muted rounded-sm flex items-center gap-2',
                currentStage === stage && 'bg-muted',
              )}
              data-track-category='Tickets'
              data-track-name='SelectRowStage'
            >
              <span
                className='inline-block w-1.5 h-1.5 rounded-full'
                style={{ backgroundColor: getStageColor(stage) }}
              />
              <span className='text-foreground'>{stage}</span>
            </button>
          ))}
        </div>
      </Popover>

      {formModal && ticketData && (
        <StageFormModal
          isOpen
          onClose={() => setFormModal(null)}
          ticket={ticketData as unknown as Ticket}
          targetStage={formModal.targetStage}
          sourceStageName={stageName || ''}
          formId={formModal.formId}
          hasApprovers={formModal.hasApprovers}
          isNonLinearBoard
        />
      )}
    </>
  );
}
