import { FLOW_STAGE_NAMES, TicketStatusV2 } from '@xyne/shared';
import { Prisma } from '@prisma/client';
import { v5 as uuidv5 } from 'uuid';
import { db } from '@/database/client';
import { EntitySequenceService } from '@/services/entitySequenceService';

/** Single namespace for every deterministic flow-board id (tickets, stages, messages). */
export const FLOW_DETERMINISTIC_NAMESPACE = '98175b0b-310d-50de-852f-0f6df9be4c30';

interface EnsureFlowStageTransitionInput {
  targetStageName: string;
  transition: () => Promise<unknown | null>;
  readStageName: () => Promise<string | null>;
}

/**
 * A stage transition may commit its ticket write before later bookkeeping
 * fails. Verify the persisted postcondition before deciding that it failed so
 * FLOW retries can continue and evaluate downstream readiness.
 */
export async function ensureFlowStageTransition(
  input: EnsureFlowStageTransitionInput
): Promise<boolean> {
  try {
    const updated = await input.transition();
    if (updated) return true;
  } catch (error) {
    if ((await input.readStageName()) === input.targetStageName) return true;
    throw error;
  }

  return (await input.readStageName()) === input.targetStageName;
}

export function findSettledCascadeTicketId(
  steps: ReadonlyArray<{ ticketId: string; stageName: string }>,
  targetStageName: string
): string | null {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step?.stageName === targetStageName) return step.ticketId;
  }
  return null;
}

/**
 * Boards created before SKIPPED existed have no stage row or transitions for
 * it. Create them on first use instead of running a backfill. Idempotent and
 * complete: every call repairs a half-created state by (re)adding any missing
 * transition, so callers can rebuild their checks from the returned ids.
 */
export async function ensureFlowSkippedStage(
  boardId: string,
  workspaceId: string,
  createdBy: string
): Promise<{ stageId: string; fromStageIds: string[] }> {
  const stages = await db.stage.findMany({ where: { boardId } });
  // Deterministic id: a concurrent first use inserts once, the loser re-reads.
  const skippedStageId = uuidv5(`flow-stage-skipped:${boardId}`, FLOW_DETERMINISTIC_NAMESPACE);
  let skippedStage = stages.find((stage) => stage.name === FLOW_STAGE_NAMES.SKIPPED);
  if (!skippedStage) {
    const sequenceNumber = await EntitySequenceService.getNextBoardStageSequence(
      boardId,
      stages.reduce((max, stage) => Math.max(max, stage.sequenceNumber), 0)
    );
    try {
      skippedStage = await db.stage.create({
        data: {
          id: skippedStageId,
          workspaceId,
          boardId,
          name: FLOW_STAGE_NAMES.SKIPPED,
          sequenceNumber,
          defaultTicketStatusV2: TicketStatusV2.COMPLETED,
          createdBy,
        },
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      ) {
        throw error;
      }
      const refetched = await db.stage.findUnique({ where: { id: skippedStageId } });
      if (!refetched) throw error;
      skippedStage = refetched;
    }
  }
  const fromStageIds = [FLOW_STAGE_NAMES.TODO, FLOW_STAGE_NAMES.STARTED, FLOW_STAGE_NAMES.PAUSED, FLOW_STAGE_NAMES.BACKLOG]
    .map((fromName) => stages.find((stage) => stage.name === fromName)?.id)
    .filter((id): id is string => !!id);
  await db.stageTransition.createMany({
    data: fromStageIds.map((fromStageId) => ({
      workspaceId,
      boardId,
      fromStageId,
      toStageId: skippedStage.id,
      requiresApproval: false,
      bypassApprovalForAutomation: true,
      createdAt: new Date(),
    })),
    skipDuplicates: true,
  });
  return { stageId: skippedStage.id, fromStageIds };
}
