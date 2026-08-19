import { BoardType } from '@xyne/shared';
import type { RouteResolution, RouteStep, StageLike, TransitionLike } from './types';

export interface RouteResolutionInput {
  boardType: string;
  currentStageId: string;
  /** All stages on the board. */
  stages: ReadonlyArray<Pick<StageLike, 'id' | 'sequenceNumber'>>;
  /** All configured transitions on the board (explicit fromStageId->toStageId and global fromStageId:null rows). */
  transitions: ReadonlyArray<TransitionLike>;
  /** Admin-configured Standard Path (ordered stage IDs). Empty = not configured. */
  standardPathStageIds: ReadonlyArray<string>;
}

function findTransition(
  transitions: ReadonlyArray<TransitionLike>,
  fromStageId: string,
  toStageId: string,
): TransitionLike | null {
  const explicit = transitions.find((t) => t.fromStageId === fromStageId && t.toStageId === toStageId);
  if (explicit) return explicit;
  const global = transitions.find((t) => t.fromStageId == null && t.toStageId === toStageId);
  return global ?? null;
}

/**
 * Resolve the remaining route (ordered stage steps) used to build a
 * forecast from the ticket's current stage onward. Does not consult
 * `Board.metadata.etaManagement.autoRecomputeEnabled` - that gate is the
 * caller's responsibility (detection can run even when automatic extension
 * is off).
 */
export function resolveForecastRoute(input: RouteResolutionInput): RouteResolution {
  const { boardType, currentStageId, stages, transitions, standardPathStageIds } = input;

  if (boardType === BoardType.DEFAULT || boardType === BoardType.RELEASE) {
    const currentStage = stages.find((s) => s.id === currentStageId);
    if (!currentStage) {
      return { kind: 'NOT_APPLICABLE' };
    }
    const remaining = [...stages]
      .filter((s) => s.sequenceNumber > currentStage.sequenceNumber)
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber);

    const steps: RouteStep[] = [];
    let fromId = currentStageId;
    for (const stage of remaining) {
      steps.push({
        stageId: stage.id,
        transition: findTransition(transitions, fromId, stage.id),
        requireExplicitTransition: false,
      });
      fromId = stage.id;
    }
    return { kind: 'ROUTE', steps };
  }

  if (boardType === BoardType.NON_LINEAR) {
    if (standardPathStageIds.length === 0) {
      // Non-linear boards cannot be forecast reliably without an expected route.
      return { kind: 'NOT_APPLICABLE' };
    }
    const currentIndex = standardPathStageIds.indexOf(currentStageId);
    if (currentIndex === -1) {
      return { kind: 'DEVIATED', offPathStageId: currentStageId };
    }
    const remainingIds = standardPathStageIds.slice(currentIndex + 1);
    const steps: RouteStep[] = [];
    let fromId = currentStageId;
    for (const stageId of remainingIds) {
      steps.push({
        stageId,
        transition: findTransition(transitions, fromId, stageId),
        requireExplicitTransition: true,
      });
      fromId = stageId;
    }
    return { kind: 'ROUTE', steps };
  }

  // FLOW (and any other board type): automatic due-date management is deferred this
  // release regardless of forecast availability - callers that only need detection for
  // Flow/Release boards with comparable ETA data work directly off the active stage
  // deadline, not this route.
  return { kind: 'NOT_APPLICABLE' };
}
