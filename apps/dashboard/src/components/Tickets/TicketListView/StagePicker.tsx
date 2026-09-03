import { ReactElement, useMemo, useRef, useState } from 'react';
import { ChevronDown } from '@xyne/icons';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { Popover } from '../../ui/Popover/Popover';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { getStageColor } from '../../../routes/KanbanBoardScreen/KanbanBoardScreen.utils';
import { cn } from '../../../utils/classNames';
import { surfaceMutationError } from '../../../utils/zeroMutationToast';
import { useAuth } from '../../../hooks/useAuth';
import { useCurrentUserRoleIds } from '../../../hooks/useRoles';
import { TicketStageRequestStatus, BoardType, ApproverType, FormContextType } from '@xyne/shared';
import type { Ticket, TicketStageRequest, ReenterMode } from '@xyne/shared';
import { getReachableStageIds, findMatchingTransition } from '../../../utils/stageTransitionUtils';
import { StageFormModal } from '../StageFormModal/StageFormModal';
import type { StageVisitEta } from '../StageFormFields/useStageForm';
import type { Stage } from '../../../routes/KanbanBoardScreen/KanbanBoardScreen.types';
import { Button } from '../../ui/Button/Button';

interface StagePickerProps {
  ticketId: string;
  stageName: string | null | undefined;
  stageLabel: string;
  boardId?: string | null;
  /**
   * When provided, called instead of mutating Zero / opening StageFormModal.
   * By design this bypasses form and approval gates — the parent owns persistence
   * and any form UI (e.g. bulk stage updates). Prefer omitting this prop when the
   * picker should enforce transition forms itself.
   */
  onStageChange?:
    | ((
        ticketId: string,
        newStageName: string,
        currentStageName: string | null | undefined,
      ) => void)
    | undefined;
  /** Fired after a stage change is successfully initiated (not when a form gate opens). */
  onAfterStageChange?: ((stageName: string) => void) | undefined;
}

const SUPPORT_STAGES: ReadonlyArray<string> = ['Backlog', 'To Do', 'In Progress', 'Review', 'Done'];

type StageGateStage = {
  id: string;
  sequenceNumber?: number | null;
  approvers?: readonly {
    userId: string | null;
    roleId: string | null | undefined;
    approverType?: string | null;
  }[];
};

type LinearStageGateResult =
  | { action: 'blocked'; message: string; description?: string }
  | { action: 'open_form'; formId: string; hasApprovers: boolean }
  | { action: 'submit_approval' }
  | { action: 'proceed' };

const resolveTransitionFormId = (
  isNonLinearBoard: boolean,
  matchingTransitionFormId: string | null | undefined,
  targetStageId: string,
  stageFormMap: ReadonlyMap<string, string>,
): string | null => {
  if (isNonLinearBoard) {
    return matchingTransitionFormId ?? null;
  }
  return matchingTransitionFormId ?? stageFormMap.get(targetStageId) ?? null;
};

const evaluateLinearStageGate = ({
  currentStage,
  targetStage,
  stageFormMap,
  stages,
}: {
  currentStage: StageGateStage;
  targetStage: StageGateStage;
  stageFormMap: ReadonlyMap<string, string>;
  stages: readonly StageGateStage[];
}): LinearStageGateResult => {
  const boardHasStagesWithApproval = stages.some(s => (s.approvers?.length ?? 0) > 0);
  const boardHasStagesWithForms = stageFormMap.size > 0;
  const shouldEnforceSequentialMovement = boardHasStagesWithApproval || boardHasStagesWithForms;

  if (!shouldEnforceSequentialMovement) {
    const targetStageFormId = stageFormMap.get(targetStage.id);
    if (targetStageFormId) {
      const hasApprovers = (targetStage.approvers?.length ?? 0) > 0;
      return { action: 'open_form', formId: targetStageFormId, hasApprovers };
    }
    return { action: 'proceed' };
  }

  const currentSeq = currentStage.sequenceNumber;
  const targetSeq = targetStage.sequenceNumber;

  if (
    currentSeq !== null &&
    currentSeq !== undefined &&
    targetSeq !== null &&
    targetSeq !== undefined &&
    targetSeq < currentSeq
  ) {
    return {
      action: 'blocked',
      message: 'Sequential movement only',
      description: 'Backward stage changes require confirmation from ticket details',
    };
  }

  const isNextStage =
    currentSeq !== null &&
    currentSeq !== undefined &&
    targetSeq !== null &&
    targetSeq !== undefined &&
    targetSeq === currentSeq + 1;

  if (!isNextStage) {
    return {
      action: 'blocked',
      message: 'Sequential movement only',
      description: 'You can only move to the next stage',
    };
  }

  const targetStageFormId = stageFormMap.get(targetStage.id);
  const hasApprovers = (targetStage.approvers?.length ?? 0) > 0;

  if (targetStageFormId) {
    return { action: 'open_form', formId: targetStageFormId, hasApprovers };
  }

  if (hasApprovers) {
    return { action: 'submit_approval' };
  }

  return { action: 'proceed' };
};

const isStageApprover = (
  approvers: StageGateStage['approvers'],
  currentUserId: string | undefined,
  currentUserRoleIds: readonly string[],
): boolean => {
  if (!approvers || approvers.length === 0) return false;
  return approvers.some(approver => {
    const type = String(approver.approverType ?? ApproverType.USER);
    if (type === String(ApproverType.ROLE)) {
      return !!approver.roleId && currentUserRoleIds.includes(approver.roleId);
    }
    if (type === String(ApproverType.USER)) {
      return approver.userId === currentUserId;
    }
    return false;
  });
};

const getTransitionReenterMode = (
  transition?: { onReenter?: ReenterMode | null } | null,
): ReenterMode | null => transition?.onReenter ?? null;

export function StagePicker({
  ticketId,
  stageName,
  stageLabel,
  boardId,
  onStageChange,
  onAfterStageChange,
}: StagePickerProps): ReactElement {
  const [open, setOpen] = useState(false);
  const zero = useZero();
  const { user: currentUser } = useAuth();
  const currentUserRoleIds = useCurrentUserRoleIds();

  const currentStage = stageName ?? '';

  const [formModal, setFormModal] = useState<{
    targetStage: Stage;
    formId: string;
    hasApprovers: boolean;
    reenterMode: ReenterMode | null;
  } | null>(null);

  const [ticketStageRequests] = useCachedQuery(queries.getTicketStageRequests({ ticketId }), {
    enabled: formModal !== null,
  });

  const existingStageRequest = useMemo(() => {
    if (!formModal) return null;
    return (
      ticketStageRequests?.find(
        request =>
          request.stageId === formModal.targetStage.id &&
          (request.status === TicketStageRequestStatus.DRAFT ||
            request.status === TicketStageRequestStatus.SUBMITTED),
      ) ?? null
    );
  }, [formModal, ticketStageRequests]);

  // Lazy-fetch the full ticket (only non-linear form modals need it) so a list doesn't fetch every row.
  const [ticketData] = useCachedQuery(queries.ticketByIdV2({ ticketId }), {
    enabled: !!boardId && (open || formModal !== null),
  });

  const formModalTargetStageEtas = useMemo<StageVisitEta[]>(() => {
    if (!formModal || !ticketData) return [];
    const stageEtaEntries: ReadonlyArray<{
      id: string;
      stageId: string;
      version?: number | null;
      stageEnteredAt: number;
    }> = Array.isArray(ticketData.stageEtaEntries) ? ticketData.stageEtaEntries : [];
    return stageEtaEntries
      .filter(eta => eta.stageId === formModal.targetStage.id)
      .map(eta => ({
        id: eta.id,
        stageId: eta.stageId,
        version: eta.version ?? null,
        stageEnteredAt: eta.stageEnteredAt,
      }));
  }, [formModal, ticketData]);

  const openFormModal = (
    targetStage: Stage,
    formId: string,
    hasApprovers: boolean,
    reenterMode: ReenterMode | null = null,
  ): void => {
    setFormModal({ targetStage, formId, hasApprovers, reenterMode });
  };

  const toStageShape = (
    stageObj: {
      id: string;
      sequenceNumber?: number | null;
      defaultTicketStatusV2?: Stage['defaultTicketStatusV2'];
    },
    name: string,
  ): Stage => ({
    id: stageObj.id,
    name,
    color: getStageColor(name),
    ...(stageObj.sequenceNumber !== undefined && stageObj.sequenceNumber !== null
      ? { sequenceNumber: stageObj.sequenceNumber }
      : {}),
    ...(stageObj.defaultTicketStatusV2 && {
      defaultTicketStatusV2: stageObj.defaultTicketStatusV2,
    }),
  });

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

  // Show only reachable stages for NON_LINEAR boards. getReachableStageIds returns null
  // only when the board has no graph (legacy → unrestricted); otherwise it returns the
  // current stage's outgoing targets, which may be empty for a terminal stage.
  const reachableStages = useMemo(() => {
    const availableStages: ReadonlyArray<string> = boardId
      ? (stages?.map(s => s.name) ?? [])
      : SUPPORT_STAGES;
    if (!isNonLinear || !stages) return availableStages;
    const currentStageObj = stages.find(s => s.name === currentStage);
    if (!currentStageObj) return availableStages;
    const reachableIds = getReachableStageIds(stageTransitions, currentStageObj.id);
    if (reachableIds === null) return availableStages;
    // Reachable targets, plus the current stage (kept so the selected value still renders;
    // selecting it is a no-op in setStage). For a terminal stage this is the only row shown.
    const filtered = availableStages.filter(name => {
      const obj = stages.find(s => s.name === name);
      return obj && reachableIds.has(obj.id);
    });
    if (currentStage && !filtered.includes(currentStage)) filtered.push(currentStage);
    return filtered;
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
        onAfterStageChange?.(next);
      }
      setOpen(false);
      return;
    }

    // `stages` is loaded for this boardId only — name lookup is scoped to that list.
    const currentStageObj = stages?.find(s => s.name === currentStage);
    const targetStageObj = stages?.find(s => s.name === next);

    if (hasTransitions && currentStageObj) {
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

      // NON_LINEAR is edge-gated: a move must match an edge. A terminal stage (no outgoing
      // edges) matches none and is blocked. Linear boards fall through to the direct move.
      if (!matchingTransition) {
        if (isNonLinear) {
          toast.error('This stage transition is not allowed');
          setOpen(false);
          return;
        }
        // Linear board without explicit transition — fall through to direct move
      } else {
        // NON_LINEAR: use edge formId only (not stageFormMap) to avoid form on every move.
        const transitionFormId = resolveTransitionFormId(
          isNonLinear,
          matchingTransition.formId,
          targetStageObj.id,
          stageFormMap,
        );

        if (transitionFormId) {
          if (onStageChange) {
            onStageChange(ticketId, next, stageName);
          } else {
            const hasApproversForTarget = (matchingTransition.transitionApprovers?.length ?? 0) > 0;
            openFormModal(
              toStageShape(targetStageObj, next),
              transitionFormId,
              hasApproversForTarget,
              getTransitionReenterMode(matchingTransition),
            );
          }
          setOpen(false);
          return;
        }

        // Approval gate
        if (matchingTransition.requiresApproval) {
          const approvers = matchingTransition.transitionApprovers ?? [];
          const isApprover = approvers.some(a => {
            const type = a.approverType ?? ApproverType.USER;
            if (type === ApproverType.ROLE) {
              return !!a.roleId && currentUserRoleIds.includes(a.roleId);
            }
            return a.userId === currentUser?.id;
          });

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
            onAfterStageChange?.(next);
            setOpen(false);
            return;
          }
          // Approver falls through to direct move (self-approval via nonLinear.transition)
        }
      }
    }

    // Legacy linear-board gate when no explicit transition graph is configured.
    if (!isNonLinear && !hasTransitions && currentStageObj && targetStageObj) {
      const gateResult = evaluateLinearStageGate({
        currentStage: currentStageObj,
        targetStage: targetStageObj,
        stageFormMap,
        stages: stages ?? [],
      });

      if (gateResult.action === 'blocked') {
        toast.error(gateResult.message, {
          ...(gateResult.description ? { description: gateResult.description } : {}),
        });
        setOpen(false);
        return;
      }

      if (gateResult.action === 'open_form') {
        if (onStageChange) {
          onStageChange(ticketId, next, stageName);
        } else {
          openFormModal(
            toStageShape(targetStageObj, next),
            gateResult.formId,
            gateResult.hasApprovers,
          );
        }
        setOpen(false);
        return;
      }

      if (gateResult.action === 'submit_approval') {
        const isApprover = isStageApprover(
          targetStageObj.approvers,
          currentUser?.id,
          currentUserRoleIds,
        );
        if (!isApprover) {
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
          onAfterStageChange?.(next);
          setOpen(false);
          return;
        }
      }
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
                ...(capturedTargetStageObj.defaultTicketStatusV2 && {
                  defaultTicketStatusV2: capturedTargetStageObj.defaultTicketStatusV2,
                }),
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
              getTransitionReenterMode(latestMt),
            );
            return;
          }

          const refFormId = latestMt?.formId ?? null;
          if (refFormId && stageShape) {
            openFormModal(
              stageShape,
              refFormId,
              (latestMt?.transitionApprovers?.length ?? 0) > 0,
              getTransitionReenterMode(latestMt),
            );
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
                  getTransitionReenterMode(freshMt),
                );
              }
            }
          }
          return;
        }

        if (serverResult?.type !== 'error') {
          onAfterStageChange?.(next);
        }
      });
    } else {
      void surfaceMutationError(
        zero.mutate(
          mutators.ticket.update({
            id: ticketId,
            stageName: next,
            ...(targetStageObj?.defaultTicketStatusV2 && {
              statusV2: targetStageObj.defaultTicketStatusV2,
            }),
            updatedAt: Date.now(),
          }),
        ),
        'Failed to update stage',
      );
      onAfterStageChange?.(next);
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
            <Button
              key={stage}
              variant='ghost'
              type='button'
              trackId='ticket_set_stage_row'
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
            </Button>
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
          isNonLinearBoard={isNonLinear}
          existingRequest={existingStageRequest}
          reenterMode={formModal.reenterMode}
          targetStageEtas={formModalTargetStageEtas}
        />
      )}
    </>
  );
}
